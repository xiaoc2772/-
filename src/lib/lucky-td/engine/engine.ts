// 幸运塔防 确定性引擎（TS 实现）。契约见 docs/lucky-td-engine-spec.md。
// 注意：本文件是性能豁免区——引擎对 state 就地修改（30Hz 模拟核心，单一所有权），
// 外部消费方不得共享引用；Go 实现（backend/internal/luckytd）必须与本文件逐位一致。

import {
  activeSkillCooldownFor,
  activeSkillUpgradeCost,
  ACTIVE_SKILL_MAX_LEVEL,
  skillLevelAtkBonusPermyriad,
  skillLevelHpBonusPermyriad,
  skillLevelSpeedBonusPermyriad,
} from './active-skills';
import { cellKey, getEngineData, offsetKey, positionOnPath } from './data';
import { hashInit, hashMixUint32, seedToRngState, xorshift32 } from './rng';
import type {
  ActionResult,
  EnemyState,
  GameAction,
  GameResult,
  GameState,
  ReplayInput,
  ReplayOutput,
  SpawnEvent,
  UnitConfig,
  UnitState,
} from './types';
import { MAX_SQUAD_SIZE } from '../constants';

const data = getEngineData();

const STATUS_PLAYING = 0 as const;
const STATUS_WON = 1 as const;
const STATUS_LOST = 2 as const;

const ENEMY_GRUNT = data.config.enemies.findIndex((enemy) => enemy.id === 'grunt');
const ENEMY_WOLF = data.config.enemies.findIndex((enemy) => enemy.id === 'wolf');
const ENEMY_GOLEM = data.config.enemies.findIndex((enemy) => enemy.id === 'golem');
const ENEMY_PUPPET = data.config.enemies.findIndex((enemy) => enemy.id === 'puppet');
const ENEMY_BOSS = data.config.enemies.findIndex((enemy) => enemy.id === 'boss');
const ENEMY_DRONE = data.config.enemies.findIndex((enemy) => enemy.id === 'drone');
const ENEMY_SHOOTER = data.config.enemies.findIndex((enemy) => enemy.id === 'shooter');
const WAVE_THREAT_BUDGET = [5, 8, 12, 17, 23, 31, 41, 53, 68, 85, 105, 128, 154, 183, 216];
const LEGACY_WAVE_COUNT = 15;
const LEGACY_MAX_TRAIT_TIER = 4;
const EXTENDED_MAX_TRAIT_TIER = 9;
const WAVE_PATH_PREVIEW_LEAD_FRAMES = 60;

/** floor(value × permyriad / 10000)，全程非负整数。 */
function pm(value: number, permyriad: number): number {
  return Math.floor((value * permyriad) / 10000);
}

function mapCostRegenPermyriad(mapIdx: number): number {
  let value = 10000;
  for (const mechanic of data.maps[mapIdx].cfg.mechanics ?? []) {
    if (mechanic.costRegenPermyriad && mechanic.costRegenPermyriad > 0) {
      value = pm(value, mechanic.costRegenPermyriad);
    }
  }
  return value;
}

function mechanicAppliesToUnit(state: GameState, mechanicId: string, unit: UnitState): boolean {
  const mechanic = data.maps[state.mapIdx].cfg.mechanics.find((item) => item.id === mechanicId);
  if (!mechanic?.cells || mechanic.cells.length === 0) {
    return true;
  }
  return data.maps[state.mapIdx].mechanicCellSets[mechanicId]?.has(cellKey(unit.row, unit.col)) ?? false;
}

function mechanicAppliesToEnemy(state: GameState, mechanicId: string, enemy: EnemyState): boolean {
  const set = data.maps[state.mapIdx].mechanicCellSets[mechanicId];
  if (!set || set.size === 0) {
    return true;
  }
  const pos = enemyPosition(state, enemy);
  return set.has(cellKey(Math.floor(pos.y / 1000), Math.floor(pos.x / 1000)));
}

function unitHazardDamagePerSecond(state: GameState, unit: UnitState): number {
  let damage = 0;
  for (const mechanic of data.maps[state.mapIdx].cfg.mechanics ?? []) {
    if (!mechanic.unitDamagePerSecond || mechanic.unitDamagePerSecond <= 0) {
      continue;
    }
    if (mechanicAppliesToUnit(state, mechanic.id, unit)) {
      damage += mechanic.unitDamagePerSecond;
    }
  }
  return damage;
}

function skillLevel(state: GameState, typeIdx: number): number {
  return state.activeSkillLevels[typeIdx] ?? 1;
}

function effectiveMaxHp(state: GameState, cfg: UnitConfig, typeIdx: number): number {
  const bonus = skillLevelHpBonusPermyriad(skillLevel(state, typeIdx)) + (cfg.block > 0 ? state.meleeHpBonusPm : 0);
  return pm(cfg.hp, 10000 + bonus);
}

function effectiveAtk(state: GameState, cfg: UnitConfig, typeIdx: number): number {
  let atk = pm(cfg.atk, 10000 + skillLevelAtkBonusPermyriad(skillLevel(state, typeIdx)));
  if (state.rangedAtkBonusPm > 0 && cfg.tags.includes('rangedAtk')) {
    atk = pm(atk, 10000 + state.rangedAtkBonusPm);
  }
  if (cfg.block === 0) {
    for (const mechanic of data.maps[state.mapIdx].cfg.mechanics ?? []) {
      if (mechanic.rangedAtkPermyriad && mechanic.rangedAtkPermyriad > 0) {
        atk = pm(atk, mechanic.rangedAtkPermyriad);
      }
    }
  }
  for (const mechanic of data.maps[state.mapIdx].cfg.mechanics ?? []) {
    const multiplier = cfg.block > 0 ? mechanic.groundUnitAtkPermyriad : mechanic.highGroundUnitAtkPermyriad;
    if (multiplier && multiplier > 0) {
      atk = pm(atk, multiplier);
    }
  }
  return atk;
}

function effectiveUnitDef(state: GameState, unit: UnitState): number {
  const cfg = data.config.units[unit.typeIdx];
  let value = cfg.def;
  if (cfg.skill && cfg.skill.kind === 'shield' && unit.skillActive > 0) {
    value = pm(value, cfg.skill.permyriad);
  }
  for (const mechanic of data.maps[state.mapIdx].cfg.mechanics ?? []) {
    if (cfg.block > 0 && mechanic.groundUnitDefPermyriad && mechanic.groundUnitDefPermyriad > 0) {
      value = pm(value, mechanic.groundUnitDefPermyriad);
    }
    if (mechanic.cellUnitDefPermyriad && mechanic.cellUnitDefPermyriad > 0 && mechanicAppliesToUnit(state, mechanic.id, unit)) {
      value = pm(value, mechanic.cellUnitDefPermyriad);
    }
  }
  return value;
}

function effectiveInterval(state: GameState, cfg: UnitConfig, typeIdx: number): number {
  const speedBonus = skillLevelSpeedBonusPermyriad(skillLevel(state, typeIdx));
  return Math.max(6, Math.floor((cfg.interval * 10000) / (10000 + speedBonus)));
}

function effectiveEnemyDef(state: GameState, enemy: EnemyState): number {
  let value = enemy.def;
  for (const mechanic of data.maps[state.mapIdx].cfg.mechanics ?? []) {
    if (mechanic.cellEnemyDefPermyriad && mechanic.cellEnemyDefPermyriad > 0 && mechanicAppliesToEnemy(state, mechanic.id, enemy)) {
      value = pm(value, mechanic.cellEnemyDefPermyriad);
    }
  }
  return value;
}

function effectiveRangeSet(state: GameState, unit: UnitState): Set<number> {
  return data.unitRangeLevelSets[unit.typeIdx][skillLevel(state, unit.typeIdx) - 1][unit.dir];
}

function effectiveAuraSet(state: GameState, unit: UnitState): Set<number> {
  return data.auraLevelSets[unit.typeIdx][skillLevel(state, unit.typeIdx) - 1];
}

function nextUint32(state: GameState): number {
  state.rngState = xorshift32(state.rngState);
  return state.rngState;
}

function nextInt(state: GameState, n: number): number {
  return nextUint32(state) % n;
}

function enemyId(typeIdx: number): string {
  return data.config.enemies[typeIdx]?.id ?? '';
}

function isFlyingEnemy(typeIdx: number): boolean {
  return data.config.enemies[typeIdx]?.flying === true;
}

function pathListForEnemyType(map: (typeof data.maps)[number], typeIdx: number) {
  const paths = isFlyingEnemy(typeIdx) ? map.flightPaths : map.paths;
  return paths.length > 0 ? paths : map.paths;
}

function pathForEnemyType(map: (typeof data.maps)[number], typeIdx: number, pathIdx: number) {
  const paths = pathListForEnemyType(map, typeIdx);
  return paths[Math.max(0, pathIdx % paths.length)];
}

function enemyPath(state: GameState, enemy: EnemyState) {
  return pathForEnemyType(data.maps[state.mapIdx], enemy.typeIdx, enemy.pathIdx);
}

function randomPathForEnemy(state: GameState, map: (typeof data.maps)[number], typeIdx: number): number {
  return nextInt(state, pathListForEnemyType(map, typeIdx).length);
}

function unitCanHitEnemy(unitCfg: UnitConfig, enemy: EnemyState): boolean {
  return !(unitCfg.block > 0 && isFlyingEnemy(enemy.typeIdx));
}

function waveTraitTier(waveIndex: number): number {
  if (waveIndex <= LEGACY_WAVE_COUNT) {
    return Math.min(LEGACY_MAX_TRAIT_TIER, Math.floor(((waveIndex - 1) * 5) / (LEGACY_WAVE_COUNT - 1)));
  }
  const extendedTier = LEGACY_MAX_TRAIT_TIER + Math.floor(((waveIndex - LEGACY_WAVE_COUNT) * 5) / LEGACY_WAVE_COUNT);
  return Math.min(EXTENDED_MAX_TRAIT_TIER, extendedTier);
}

function weightedEnemyPick(state: GameState, entries: [number, number][]): number {
  let total = 0;
  for (const [, weight] of entries) {
    total += weight;
  }
  let roll = nextInt(state, total);
  for (const [typeIdx, weight] of entries) {
    if (roll < weight) {
      return typeIdx;
    }
    roll -= weight;
  }
  return entries[entries.length - 1][0];
}

function randomEnemyTypeForWave(state: GameState): number {
  const wave = state.waveIndex;
  const entries: [number, number][] = [];
  const add = (typeIdx: number, weight: number) => {
    if (typeIdx >= 0 && weight > 0) {
      entries.push([typeIdx, weight]);
    }
  };
  if (wave <= 1) {
    add(ENEMY_GRUNT, 100);
  } else if (wave <= 3) {
    add(ENEMY_GRUNT, 62);
    add(ENEMY_WOLF, 38);
  } else if (wave <= 5) {
    add(ENEMY_GRUNT, 36);
    add(ENEMY_WOLF, 30);
    add(ENEMY_GOLEM, 16);
    add(ENEMY_PUPPET, 11);
    add(ENEMY_DRONE, 16);
  } else if (wave <= 8) {
    add(ENEMY_GRUNT, 20);
    add(ENEMY_WOLF, 25);
    add(ENEMY_GOLEM, 25);
    add(ENEMY_PUPPET, 21);
    add(ENEMY_DRONE, 23);
    add(ENEMY_SHOOTER, 10);
  } else if (wave <= 11) {
    add(ENEMY_GRUNT, 12);
    add(ENEMY_WOLF, 22);
    add(ENEMY_GOLEM, 26);
    add(ENEMY_PUPPET, 24);
    add(ENEMY_DRONE, 24);
    add(ENEMY_BOSS, 9);
    add(ENEMY_SHOOTER, 14);
  } else if (wave <= 14) {
    add(ENEMY_GRUNT, 8);
    add(ENEMY_WOLF, 19);
    add(ENEMY_GOLEM, 28);
    add(ENEMY_PUPPET, 26);
    add(ENEMY_DRONE, 25);
    add(ENEMY_BOSS, 16);
    add(ENEMY_SHOOTER, 16);
  } else {
    add(ENEMY_GRUNT, 5);
    add(ENEMY_WOLF, 16);
    add(ENEMY_GOLEM, 30);
    add(ENEMY_PUPPET, 28);
    add(ENEMY_DRONE, 26);
    add(ENEMY_BOSS, 24);
    add(ENEMY_SHOOTER, 18);
  }
  return weightedEnemyPick(state, entries.length > 0 ? entries : [[0, 1]]);
}

function enemyThreatCost(typeIdx: number): number {
  switch (enemyId(typeIdx)) {
    case 'boss':
      return 18;
    case 'golem':
      return 6;
    case 'puppet':
      return 5;
    case 'shooter':
      return 5;
    case 'drone':
      return 4;
    case 'wolf':
      return 2;
    default:
      return 1;
  }
}

function maxEventCountForEnemy(typeIdx: number, waveIndex: number): number {
  switch (enemyId(typeIdx)) {
    case 'boss':
      return 1 + Math.min(2, Math.max(0, Math.floor((waveIndex - 10) / 3)));
    case 'golem':
    case 'puppet':
    case 'shooter':
      return 2 + Math.min(5, Math.max(0, Math.floor((waveIndex - 4) / 3)));
    case 'drone':
      return 3 + Math.min(7, Math.floor(waveIndex / 3));
    case 'wolf':
      return 3 + Math.min(8, Math.floor(waveIndex / 3));
    default:
      return 5 + Math.min(12, Math.floor((waveIndex * 9) / 10));
  }
}

function eventIntervalForEnemy(state: GameState, typeIdx: number): number {
  const wave = state.waveIndex;
  let base = 42;
  switch (enemyId(typeIdx)) {
    case 'boss':
      base = 64;
      break;
    case 'golem':
      base = 48;
      break;
    case 'puppet':
      base = 42;
      break;
    case 'drone':
      base = 32;
      break;
    case 'wolf':
      base = 28;
      break;
    default:
      base = 40;
      break;
  }
  return Math.max(12, base - Math.floor((wave * 6) / 5) + nextInt(state, 9));
}

function waveThreatBudget(state: GameState): number {
  const wave = state.waveIndex;
  const base =
    WAVE_THREAT_BUDGET[wave - 1]
    ?? WAVE_THREAT_BUDGET[WAVE_THREAT_BUDGET.length - 1] + (wave - WAVE_THREAT_BUDGET.length) * 24;
  const growth = Math.max(0, wave - 1) * 2 + Math.floor((wave * wave) / 18);
  return base + growth + nextInt(state, Math.max(2, Math.floor(base / 4)));
}

function waveGroupCount(state: GameState, pathCount: number): number {
  const wave = state.waveIndex;
  if (wave <= 2) {
    return 1;
  }
  const base = 1 + Math.floor((wave - 1) / 2);
  const laneBonus = Math.min(3, Math.max(0, pathCount - 1));
  const spread = Math.min(4, Math.max(1, Math.floor(wave / 3)));
  return Math.min(12, base + laneBonus + nextInt(state, spread + 1));
}

function buildRandomWaveEvents(state: GameState): SpawnEvent[] {
  const map = data.maps[state.mapIdx];
  const totalWaves = map.cfg.waves.length;
  const groupCount = waveGroupCount(state, Math.max(map.paths.length, map.flightPaths.length));
  let budget = waveThreatBudget(state);
  let delay = WAVE_PATH_PREVIEW_LEAD_FRAMES + nextInt(state, Math.max(1, 24 - Math.min(16, state.waveIndex)));
  const events: SpawnEvent[] = [];
  for (let group = 0; group < groupCount; group += 1) {
    const typeIdx = randomEnemyTypeForWave(state);
    const cost = enemyThreatCost(typeIdx);
    const groupsLeft = groupCount - group;
    const plannedBudget = Math.max(cost, Math.floor((budget + groupsLeft - 1) / groupsLeft));
    const maxCount = Math.max(1, Math.min(maxEventCountForEnemy(typeIdx, state.waveIndex), Math.floor(plannedBudget / cost) + 2));
    const minCount = Math.max(1, Math.min(maxCount, Math.floor(plannedBudget / (cost * 2))));
    const count = minCount + nextInt(state, maxCount - minCount + 1);
    const interval = eventIntervalForEnemy(state, typeIdx);
    for (let spawn = 0; spawn < count; spawn += 1) {
      events.push([delay + spawn * interval, typeIdx, randomPathForEnemy(state, map, typeIdx), 1, interval]);
    }
    budget = Math.max(0, budget - count * cost);
    delay += Math.max(18, 70 - state.waveIndex * 3) + nextInt(state, 28);
  }
  const bossCount = events.reduce((total, event) => total + (event[1] === ENEMY_BOSS ? event[3] : 0), 0);
  if (ENEMY_BOSS >= 0 && state.waveIndex >= 10 && bossCount === 0) {
    const count = state.waveIndex === LEGACY_WAVE_COUNT || state.waveIndex >= totalWaves ? 2 : 1;
    const bossDelay = 80 + nextInt(state, 120);
    const bossInterval = Math.max(45, 70 - state.waveIndex);
    for (let spawn = 0; spawn < count; spawn += 1) {
      events.push([bossDelay + spawn * bossInterval, ENEMY_BOSS, randomPathForEnemy(state, map, ENEMY_BOSS), 1, bossInterval]);
    }
  }
  return events;
}

function enemyHpPermyriad(typeIdx: number, waveIndex: number, tier: number): number {
  if (typeIdx === data.coinEnemyIdx) {
    return 10000;
  }
  let value = waveIndex <= 1 ? 6800 : waveIndex === 2 ? 7800 : 8500 + Math.max(0, waveIndex - 4) * 170 + tier * 180;
  switch (enemyId(typeIdx)) {
    case 'boss':
      value += 400 + tier * 160;
      break;
    case 'golem':
      value += 230 + tier * 100;
      break;
    case 'puppet':
      value += 130 + tier * 80;
      break;
    case 'drone':
      value -= 550;
      break;
    case 'wolf':
      value -= 220;
      break;
    default:
      break;
  }
  return value;
}

function enemyAtkPermyriad(typeIdx: number, waveIndex: number, tier: number): number {
  if (typeIdx === data.coinEnemyIdx) {
    return 10000;
  }
  let value = waveIndex <= 1 ? 6400 : waveIndex === 2 ? 7400 : 8300 + Math.max(0, waveIndex - 3) * 200 + tier * 130;
  switch (enemyId(typeIdx)) {
    case 'boss':
      value += 320 + tier * 110;
      break;
    case 'wolf':
      value += 60;
      break;
    case 'drone':
      value -= 150;
      break;
    default:
      break;
  }
  return value;
}

function enemySpeedPermyriad(typeIdx: number, waveIndex: number, tier: number): number {
  if (typeIdx === data.coinEnemyIdx) {
    return 10000;
  }
  let value = waveIndex <= 1 ? 8100 : waveIndex === 2 ? 8900 : 9400 + Math.max(0, waveIndex - 4) * 90 + tier * 80;
  switch (enemyId(typeIdx)) {
    case 'wolf':
      value += 1080 + tier * 140;
      break;
    case 'drone':
      value += 540 + tier * 90;
      break;
    case 'golem':
      value -= 900;
      break;
    case 'boss':
      value -= 1300;
      break;
    default:
      break;
  }
  return Math.max(6000, value);
}

function enemyAttackSpeedPermyriad(typeIdx: number, waveIndex: number, tier: number): number {
  if (typeIdx === data.coinEnemyIdx) {
    return 10000;
  }
  let value = 9900 + Math.max(0, waveIndex - 5) * 110 + tier * 90;
  if (enemyId(typeIdx) === 'wolf') {
    value += 260;
  }
  if (enemyId(typeIdx) === 'drone') {
    value += 150;
  }
  if (enemyId(typeIdx) === 'boss') {
    value += 250;
  }
  return value;
}

function enemyDefValue(typeIdx: number, waveIndex: number, tier: number): number {
  const cfg = data.config.enemies[typeIdx];
  if (typeIdx === data.coinEnemyIdx) {
    return cfg.def;
  }
  let value = cfg.def + Math.max(0, waveIndex - 5) * 4 + tier * 9;
  if (enemyId(typeIdx) === 'golem') {
    value += 16 + tier * 10;
  }
  return value;
}

function enemyResValue(typeIdx: number, waveIndex: number, tier: number): number {
  const cfg = data.config.enemies[typeIdx];
  if (typeIdx === data.coinEnemyIdx) {
    return cfg.res;
  }
  let value = cfg.res + Math.max(0, waveIndex - 7) * 50 + tier * 115;
  if (enemyId(typeIdx) === 'puppet') {
    value += 280 + tier * 115;
  }
  if (enemyId(typeIdx) === 'boss') {
    value += 180 + tier * 75;
  }
  return Math.min(6500, value);
}

function ok(): ActionResult {
  return { ok: true, message: '' };
}

function reject(message: string): ActionResult {
  return { ok: false, message };
}

export function initState(seed: string, mapId: string, squadIds: string[]): GameState {
  const mapIdx = data.mapIdToIdx[mapId];
  if (mapIdx === undefined) {
    throw new Error('未知地图');
  }
  if (squadIds.length < 1 || squadIds.length > MAX_SQUAD_SIZE) {
    throw new Error(`编队人数须为 1~${MAX_SQUAD_SIZE}`);
  }
  const squad: number[] = [];
  for (const unitId of squadIds) {
    const idx = data.unitIdToIdx[unitId];
    if (idx === undefined) {
      throw new Error(`未知单位: ${unitId}`);
    }
    if (squad.includes(idx)) {
      throw new Error(`编队重复单位: ${unitId}`);
    }
    squad.push(idx);
  }
  const eng = data.config.engine;
  const mapRegenPermyriad = mapCostRegenPermyriad(mapIdx);
  return {
    seed,
    rngState: seedToRngState(seed),
    frame: 0,
    status: STATUS_PLAYING,
    mapIdx,
    squad,
    costMilli: eng.initialCostMilli,
    costAcc: 0,
    lives: eng.initialLives,
    waveIndex: 1,
    phase: 0,
    intermissionRemaining: eng.intermissionFrames,
    waveFrame: -1,
    waveEvents: [],
    spawnCursor: [],
    spawnedInWave: 0,
    coinPlan: { active: 0, frame: 0, path: 0 },
    pendingBlessing: null,
    blessingsOwned: 0,
    regenMilliPerSec: pm(eng.costRegenMilliPerSec, mapRegenPermyriad),
    meleeHpBonusPm: 0,
    rangedAtkBonusPm: 0,
    nextWaveDebuffPm: 10000,
    debuffWave: 0,
    scoreWaves: 0,
    scoreKills: 0,
    scoreLucky: 0,
    unitSeq: 0,
    enemySeq: 0,
    units: [],
    enemies: [],
    redeployCooldown: data.config.units.map(() => 0),
    activeSkillLevels: data.config.units.map(() => 1),
    activeSkillCooldown: data.config.units.map(() => 0),
    waveHashes: [],
  };
}

function findUnitById(state: GameState, unitId: number): UnitState | null {
  return state.units.find((unit) => unit.id === unitId && unit.hp > 0) ?? null;
}

function applyDeploy(state: GameState, action: GameAction): ActionResult {
  const typeIdx = action.unit ?? -1;
  if (typeIdx < 0 || typeIdx >= data.config.units.length) {
    return reject('未知单位');
  }
  if (!state.squad.includes(typeIdx)) {
    return reject('单位不在编队中');
  }
  for (const unit of state.units) {
    if (unit.typeIdx === typeIdx) {
      return reject('该单位已在场上');
    }
  }
  if (state.redeployCooldown[typeIdx] > 0) {
    return reject('再部署冷却中');
  }
  const cfg = data.config.units[typeIdx];
  if (state.costMilli < cfg.cost * 1000) {
    return reject('费用不足');
  }
  const row = action.row ?? -1;
  const col = action.col ?? -1;
  const map = data.maps[state.mapIdx];
  if (row < 0 || row >= map.cfg.rows || col < 0 || col >= map.cfg.cols) {
    return reject('位置越界');
  }
  const dir = action.dir ?? -1;
  if (!Number.isInteger(dir) || dir < 0 || dir > 3) {
    return reject('朝向非法');
  }
  const key = cellKey(row, col);
  const validCell = cfg.block > 0 ? map.meleeCellSet.has(key) : map.rangedCellSet.has(key);
  if (!validCell) {
    return reject('该格不可部署此单位');
  }
  for (const unit of state.units) {
    if (unit.row === row && unit.col === col) {
      return reject('该格已有单位');
    }
  }
  state.costMilli -= cfg.cost * 1000;
  const maxHp = effectiveMaxHp(state, cfg, typeIdx);
  state.unitSeq += 1;
  state.units.push({
    id: state.unitSeq,
    typeIdx,
    row,
    col,
    dir,
    hp: maxHp,
    maxHp,
    atkCooldown: 0,
    spTimer: 0,
    sp: 0,
    skillActive: 0,
    attackCount: 0,
  });
  state.activeSkillCooldown[typeIdx] = activeSkillCooldownFor(typeIdx, state.activeSkillLevels[typeIdx] ?? 1);
  // 落位挤压：判定箱（半格 500）覆盖该格的地面敌人被推退半格，并解除阻挡待重新判定
  for (const enemy of state.enemies) {
    if (enemy.hp === 0 || !data.config.enemies[enemy.typeIdx].blockable) {
      continue;
    }
    const path = enemyPath(state, enemy);
    for (const cell of path.cells) {
      if (cell.row === row && cell.col === col && Math.abs(enemy.progress - cell.centerProgress) < 500) {
        enemy.progress = Math.max(0, enemy.progress - 500);
        enemy.blockedBy = 0;
        break;
      }
    }
  }
  return ok();
}

function applyRetreat(state: GameState, action: GameAction): ActionResult {
  const unitId = action.unitId ?? 0;
  const idx = state.units.findIndex((unit) => unit.id === unitId);
  if (idx < 0) {
    return reject('单位不存在');
  }
  const eng = data.config.engine;
  const unit = state.units[idx];
  const cfg = data.config.units[unit.typeIdx];
  const refund = pm(cfg.cost * 1000, eng.retreatRefundPermyriad);
  state.costMilli = Math.min(eng.costMaxMilli, state.costMilli + refund);
  for (const enemy of state.enemies) {
    if (enemy.blockedBy === unit.id) {
      enemy.blockedBy = 0;
    }
  }
  state.units.splice(idx, 1);
  state.redeployCooldown[unit.typeIdx] = cfg.redeploy;
  return ok();
}

function addMeleeHpBonus(state: GameState, bonusPm: number): void {
  state.meleeHpBonusPm += bonusPm;
  for (const unit of state.units) {
    const cfg = data.config.units[unit.typeIdx];
    if (cfg.block > 0) {
      const newMax = effectiveMaxHp(state, cfg, unit.typeIdx);
      unit.hp += newMax - unit.maxHp;
      unit.maxHp = newMax;
    }
  }
}

function applyBless(state: GameState, action: GameAction): ActionResult {
  const pending = state.pendingBlessing;
  if (!pending) {
    return reject('当前没有待选祝福');
  }
  const blessing = action.blessing ?? -1;
  if (!pending.options.includes(blessing)) {
    return reject('无效祝福选项');
  }
  const eng = data.config.engine;
  switch (blessing) {
    case 0:
      state.regenMilliPerSec = pm(eng.costRegenMilliPerSec, 12500);
      break;
    case 1:
      addMeleeHpBonus(state, 2000);
      break;
    case 2:
      state.rangedAtkBonusPm += 1200;
      break;
    case 3:
      state.lives = Math.min(eng.livesCap, state.lives + 2);
      break;
    case 4:
      state.nextWaveDebuffPm = 9000;
      state.debuffWave = state.waveIndex;
      break;
    case 5:
      state.costMilli = Math.min(eng.costMaxMilli, state.costMilli + 12000);
      break;
    case 6:
      state.costMilli = Math.min(eng.costMaxMilli, state.costMilli + 8000);
      cutRedeployCooldowns(state, 8 * 30);
      cutActiveSkillCooldowns(state, 6 * 30);
      break;
    case 7:
      state.rangedAtkBonusPm += 800;
      for (const enemy of state.enemies) {
        if (enemy.hp > 0 && isFlyingEnemy(enemy.typeIdx)) {
          enemy.shield = pm(enemy.shield, 6500);
          slowEnemy(enemy, 9000);
        }
      }
      break;
    case 8:
      for (const enemy of state.enemies) {
        enemy.shield = pm(enemy.shield, 5500);
      }
      state.nextWaveDebuffPm = Math.min(state.nextWaveDebuffPm, 9400);
      state.debuffWave = state.phase === 0 ? state.waveIndex : state.waveIndex + 1;
      break;
    case 9:
      state.lives = Math.min(eng.livesCap, state.lives + 1);
      addMeleeHpBonus(state, 1000);
      break;
    case 10:
      state.costMilli = Math.min(eng.costMaxMilli, state.costMilli + 18000);
      for (let i = 0; i < state.activeSkillCooldown.length; i += 1) {
        state.activeSkillCooldown[i] += 4 * 30;
      }
      break;
    case 11:
      for (const unit of state.units) {
        healUnit(unit, Math.max(1, pm(unit.maxHp, 1500)));
      }
      cutActiveSkillCooldowns(state, 10 * 30);
      state.scoreLucky += 6;
      break;
    default:
      return reject('未知祝福');
  }
  state.blessingsOwned |= 1 << blessing;
  state.pendingBlessing = null;
  return ok();
}

function applySkillUpgrade(state: GameState, action: GameAction): ActionResult {
  const unitId = action.unitId ?? 0;
  const unit = findUnitById(state, unitId);
  if (!unit) {
    return reject('单位不存在');
  }
  const typeIdx = unit.typeIdx;
  const level = state.activeSkillLevels[typeIdx];
  if (level >= ACTIVE_SKILL_MAX_LEVEL) {
    return reject('技能已满级');
  }
  const cost = activeSkillUpgradeCost(typeIdx, level);
  if (state.costMilli < cost * 1000) {
    return reject('费用不足');
  }
  state.costMilli -= cost * 1000;
  state.activeSkillLevels[typeIdx] = level + 1;
  const cfg = data.config.units[typeIdx];
  const newMax = effectiveMaxHp(state, cfg, typeIdx);
  unit.hp += newMax - unit.maxHp;
  unit.maxHp = newMax;
  return ok();
}

function enemiesInUnitRange(state: GameState, unit: UnitState): EnemyState[] {
  const cfg = data.config.units[unit.typeIdx];
  const rangeSet = effectiveRangeSet(state, unit);
  const enemies: EnemyState[] = [];
  for (const enemy of state.enemies) {
    if (enemy.hp === 0) {
      continue;
    }
    if (!unitCanHitEnemy(cfg, enemy)) {
      continue;
    }
    const path = enemyPath(state, enemy);
    const pos = positionOnPath(path, enemy.progress);
    const eRow = Math.floor(pos.y / 1000);
    const eCol = Math.floor(pos.x / 1000);
    if (rangeSet.has(offsetKey(eRow - unit.row, eCol - unit.col))) {
      enemies.push(enemy);
    }
  }
  enemies.sort((a, b) => {
    const pathA = enemyPath(state, a);
    const pathB = enemyPath(state, b);
    const remainA = pathA.lengthMilli - a.progress;
    const remainB = pathB.lengthMilli - b.progress;
    return remainA - remainB || a.id - b.id;
  });
  return enemies;
}

function enemyPosition(state: GameState, enemy: EnemyState): { x: number; y: number } {
  return positionOnPath(enemyPath(state, enemy), enemy.progress);
}

function healUnit(unit: UnitState, amount: number): boolean {
  if (unit.hp <= 0 || unit.hp >= unit.maxHp) {
    return false;
  }
  unit.hp = Math.min(unit.maxHp, unit.hp + amount);
  return true;
}

function healAllies(state: GameState, amount: number): boolean {
  let applied = false;
  for (const ally of state.units) {
    if (healUnit(ally, amount)) {
      applied = true;
    }
  }
  return applied;
}

function cutActiveSkillCooldowns(state: GameState, frames: number): void {
  for (let i = 0; i < state.activeSkillCooldown.length; i += 1) {
    state.activeSkillCooldown[i] = Math.max(0, state.activeSkillCooldown[i] - frames);
  }
}

function cutRedeployCooldowns(state: GameState, frames: number): void {
  for (let i = 0; i < state.redeployCooldown.length; i += 1) {
    state.redeployCooldown[i] = Math.max(0, state.redeployCooldown[i] - frames);
  }
}

function slowEnemy(enemy: EnemyState, speedPermyriad: number): void {
  enemy.speed = Math.max(18, pm(enemy.speed, speedPermyriad));
}

function damageEnemiesAround(
  state: GameState,
  attackerCfg: UnitConfig,
  center: { x: number; y: number },
  radius: number,
  amount: number,
  kind: number,
): boolean {
  const radiusSq = radius * radius;
  let applied = false;
  for (const enemy of state.enemies) {
    if (enemy.hp === 0 || !unitCanHitEnemy(attackerCfg, enemy)) {
      continue;
    }
    const pos = enemyPosition(state, enemy);
    const dx = pos.x - center.x;
    const dy = pos.y - center.y;
    if (dx * dx + dy * dy <= radiusSq) {
      dealDamage(state, attackerCfg, enemy, amount, kind);
      applied = true;
    }
  }
  return applied;
}

function applySkill(state: GameState, action: GameAction): ActionResult {
  const unitId = action.unitId ?? 0;
  const unit = findUnitById(state, unitId);
  if (!unit) {
    return reject('单位不存在');
  }
  const typeIdx = unit.typeIdx;
  if (state.activeSkillCooldown[typeIdx] > 0) {
    return reject('技能冷却中');
  }
  const cfg = data.config.units[typeIdx];
  const level = state.activeSkillLevels[typeIdx];
  const eng = data.config.engine;
  let applied = false;

  switch (typeIdx) {
    case 0: {
      state.costMilli = Math.min(eng.costMaxMilli, state.costMilli + (6000 + (level - 1) * 800));
      healUnit(unit, 110 + (level - 1) * 25);
      const target = pickEnemyTarget(state, unit, cfg);
      if (target) {
        dealDamage(state, cfg, target, 130 + (level - 1) * 30, 2);
        if (target.hp > 0) {
          target.progress = Math.max(0, target.progress - (220 + level * 25));
          target.blockedBy = 0;
        }
      }
      applied = true;
      break;
    }
    case 1:
      unit.skillActive = Math.max(unit.skillActive, 180 + (level - 1) * 15);
      healUnit(unit, 220 + (level - 1) * 45);
      unit.sp = 0;
      unit.spTimer = 0;
      for (const enemy of state.enemies) {
        if (enemy.hp > 0 && enemy.blockedBy === unit.id) {
          dealDamage(state, cfg, enemy, 160 + (level - 1) * 35, 2);
        }
      }
      applied = true;
      break;
    case 2: {
      const targets = enemiesInUnitRange(state, unit);
      if (targets.length === 0) {
        return reject('没有可作用目标');
      }
      const amount = 190 + (level - 1) * 45;
      for (const enemy of targets.slice(0, 3 + Math.ceil(level / 2))) {
        dealDamage(state, cfg, enemy, enemy.blockedBy === unit.id ? pm(amount, 13500) : amount, 2);
      }
      applied = true;
      break;
    }
    case 3: {
      const center = { x: unit.col * 1000 + 500, y: unit.row * 1000 + 500 };
      const radius = 1450 + (level - 1) * 60;
      const radiusSq = radius * radius;
      const amount = 240 + (level - 1) * 55;
      const speedPm = Math.max(5700, 8400 - (level - 1) * 300);
      for (const enemy of state.enemies) {
        if (enemy.hp === 0) {
          continue;
        }
        if (!unitCanHitEnemy(cfg, enemy)) {
          continue;
        }
        const pos = enemyPosition(state, enemy);
        const dx = pos.x - center.x;
        const dy = pos.y - center.y;
        if (dx * dx + dy * dy <= radiusSq) {
          dealDamage(state, cfg, enemy, amount, 1);
          if (enemy.hp > 0) {
            slowEnemy(enemy, speedPm);
          }
          applied = true;
        }
      }
      if (!applied) {
        return reject('没有可作用目标');
      }
      break;
    }
    case 4: {
      const targets = enemiesInUnitRange(state, unit);
      if (targets.length === 0) {
        return reject('没有可作用目标');
      }
      const amount = 220 + (level - 1) * 50;
      const priority = [...targets].sort((a, b) => {
        const af = data.config.enemies[a.typeIdx]?.flying === true ? 0 : 1;
        const bf = data.config.enemies[b.typeIdx]?.flying === true ? 0 : 1;
        return af - bf || targets.indexOf(a) - targets.indexOf(b);
      });
      for (const enemy of priority.slice(0, 4 + Math.ceil(level / 2))) {
        const flying = data.config.enemies[enemy.typeIdx]?.flying === true;
        dealDamage(state, cfg, enemy, flying ? pm(amount, 14000) : amount, 0);
        if (enemy.hp > 0) {
          enemy.progress = Math.max(0, enemy.progress - (240 + level * 45));
          enemy.blockedBy = 0;
        }
      }
      applied = true;
      break;
    }
    case 5: {
      const target = pickEnemyTarget(state, unit, cfg);
      if (!target) {
        return reject('没有可作用目标');
      }
      const center = enemyPosition(state, target);
      const radius = 1050 + (level - 1) * 80;
      const radiusSq = radius * radius;
      const amount = 300 + (level - 1) * 65;
      const shieldPm = Math.max(0, 10000 - (2500 + level * 300));
      const resCut = 160 + level * 45;
      for (const enemy of state.enemies) {
        if (enemy.hp === 0) {
          continue;
        }
        if (!unitCanHitEnemy(cfg, enemy)) {
          continue;
        }
        const pos = enemyPosition(state, enemy);
        const dx = pos.x - center.x;
        const dy = pos.y - center.y;
        if (dx * dx + dy * dy <= radiusSq) {
          enemy.shield = pm(enemy.shield, shieldPm);
          enemy.res = Math.max(0, enemy.res - resCut);
          dealDamage(state, cfg, enemy, amount, 1);
          applied = true;
        }
      }
      break;
    }
    case 6: {
      healAllies(state, 240 + (level - 1) * 50);
      cutActiveSkillCooldowns(state, (3 + Math.ceil(level / 2)) * 30);
      applied = true;
      break;
    }
    case 7: {
      state.costMilli = Math.min(eng.costMaxMilli, state.costMilli + (5000 + level * 700));
      healAllies(state, 90 + level * 35);
      cutActiveSkillCooldowns(state, (2 + Math.floor(level / 2)) * 30);
      const fortune = nextInt(state, level >= 6 ? 5 : 4);
      if (fortune === 0) {
        state.costMilli = Math.min(eng.costMaxMilli, state.costMilli + (3200 + level * 650));
      } else if (fortune === 1) {
        state.lives = Math.min(eng.livesCap, state.lives + (level >= 10 ? 2 : 1));
      } else if (fortune === 2) {
        state.nextWaveDebuffPm = Math.min(state.nextWaveDebuffPm, 9600 - level * 140);
        state.debuffWave = state.phase === 0 ? state.waveIndex : state.waveIndex + 1;
      } else if (fortune === 3) {
        for (const enemy of state.enemies) {
          if (enemy.hp <= 0) {
            continue;
          }
          enemy.shield = pm(enemy.shield, Math.max(5200, 8200 - level * 300));
          slowEnemy(enemy, Math.max(6800, 9400 - level * 260));
          if (isFlyingEnemy(enemy.typeIdx)) {
            enemy.progress = Math.max(0, enemy.progress - (220 + level * 80));
            enemy.blockedBy = 0;
          }
        }
      } else {
        state.scoreLucky += 6 + level * 3;
        state.costMilli = Math.min(eng.costMaxMilli, state.costMilli + (2400 + level * 500));
      }
      applied = true;
      break;
    }
    case 8: {
      const targets = enemiesInUnitRange(state, unit);
      if (targets.length === 0) {
        return reject('没有可作用目标');
      }
      let target = targets[0];
      for (const enemy of targets) {
        if (enemy.hp < target.hp || (enemy.hp === target.hp && enemy.id < target.id)) {
          target = enemy;
        }
      }
      const before = target.hp;
      dealDamage(state, cfg, target, 380 + (level - 1) * 90 + pm(target.maxHp, 500 + level * 70), 2);
      if (before > 0 && target.hp === 0) {
        state.costMilli = Math.min(eng.costMaxMilli, state.costMilli + (4000 + level * 600));
      }
      applied = true;
      break;
    }
    case 9: {
      const targets = enemiesInUnitRange(state, unit);
      if (targets.length === 0) {
        return reject('没有可作用目标');
      }
      const radius = 1200 + (level - 1) * 80;
      const radiusSq = radius * radius;
      let best = targets[0];
      let bestCount = -1;
      for (const candidate of targets) {
        const center = enemyPosition(state, candidate);
        let count = 0;
        for (const enemy of state.enemies) {
          if (enemy.hp === 0) {
            continue;
          }
          if (!unitCanHitEnemy(cfg, enemy)) {
            continue;
          }
          const pos = enemyPosition(state, enemy);
          const dx = pos.x - center.x;
          const dy = pos.y - center.y;
          if (dx * dx + dy * dy <= radiusSq) {
            count += 1;
          }
        }
        if (count > bestCount || (count === bestCount && candidate.id < best.id)) {
          best = candidate;
          bestCount = count;
        }
      }
      const center = enemyPosition(state, best);
      const amount = 280 + (level - 1) * 70;
      for (const enemy of state.enemies) {
        if (enemy.hp === 0) {
          continue;
        }
        if (!unitCanHitEnemy(cfg, enemy)) {
          continue;
        }
        const pos = enemyPosition(state, enemy);
        const dx = pos.x - center.x;
        const dy = pos.y - center.y;
        if (dx * dx + dy * dy <= radiusSq) {
          enemy.shield = pm(enemy.shield, 6500);
          dealDamage(state, cfg, enemy, amount, 2);
          applied = true;
        }
      }
      break;
    }
    case 10: {
      const targets = enemiesInUnitRange(state, unit);
      if (targets.length === 0) {
        return reject('没有可作用目标');
      }
      const amount = 180 + (level - 1) * 45;
      const push = 650 + (level - 1) * 100;
      const speedPm = Math.max(5500, 8500 - level * 300);
      for (const enemy of targets) {
        dealDamage(state, cfg, enemy, amount, 1);
        if (enemy.hp > 0) {
          slowEnemy(enemy, speedPm);
          enemy.progress = Math.max(0, enemy.progress - push);
          enemy.blockedBy = 0;
        }
      }
      applied = true;
      break;
    }
    case 11: {
      healAllies(state, 150 + (level - 1) * 35);
      state.costMilli = Math.min(eng.costMaxMilli, state.costMilli + (2500 + level * 700));
      cutActiveSkillCooldowns(state, (4 + Math.floor(level / 2)) * 30);
      applied = true;
      break;
    }
    case 12: {
      unit.skillActive = Math.max(unit.skillActive, 180 + (level - 1) * 15);
      healUnit(unit, 180 + (level - 1) * 40);
      unit.sp = 0;
      unit.spTimer = 0;
      const amount = 220 + (level - 1) * 45;
      for (const enemy of state.enemies) {
        if (enemy.hp > 0 && enemy.blockedBy === unit.id) {
          enemy.atk = Math.max(1, pm(enemy.atk, Math.max(7400, 9200 - (level - 1) * 200)));
          dealDamage(state, cfg, enemy, amount, 2);
        }
      }
      damageEnemiesAround(state, cfg, { x: unit.col * 1000 + 500, y: unit.row * 1000 + 500 }, 1150 + level * 120, Math.floor(amount / 2), 2);
      applied = true;
      break;
    }
    case 13: {
      const targets = enemiesInUnitRange(state, unit);
      if (targets.length === 0) {
        return reject('没有可作用目标');
      }
      const priority = [...targets].sort((a, b) => {
        const af = data.config.enemies[a.typeIdx]?.flying === true ? 0 : 1;
        const bf = data.config.enemies[b.typeIdx]?.flying === true ? 0 : 1;
        return af - bf || targets.indexOf(a) - targets.indexOf(b);
      });
      const amount = 450 + (level - 1) * 100;
      const limit = level >= 10 ? 3 : level >= 5 ? 2 : 1;
      for (const target of priority.slice(0, limit)) {
        const flying = data.config.enemies[target.typeIdx]?.flying === true;
        target.shield = pm(target.shield, 5000);
        dealDamage(state, cfg, target, flying ? pm(amount, 15500) : amount, 0);
        if (target.hp > 0) {
          target.progress = Math.max(0, target.progress - (420 + level * 90));
          target.blockedBy = 0;
        }
      }
      applied = true;
      break;
    }
    case 14: {
      const targets = enemiesInUnitRange(state, unit);
      if (targets.length === 0) {
        return reject('没有可作用目标');
      }
      const amount = 170 + (level - 1) * 40;
      const speedPm = Math.max(6100, 8800 - (level - 1) * 300);
      const armorCut = 20 + level * 5;
      const resCut = 140 + level * 40;
      for (const enemy of targets) {
        dealDamage(state, cfg, enemy, amount, 1);
        if (enemy.hp > 0) {
          slowEnemy(enemy, speedPm);
          enemy.def = Math.max(0, enemy.def - armorCut);
          enemy.res = Math.max(0, enemy.res - resCut);
        }
      }
      applied = true;
      break;
    }
    case 15: {
      healAllies(state, 220 + (level - 1) * 45);
      cutRedeployCooldowns(state, (5 + Math.floor(level / 2)) * 30);
      if (level >= 10) {
        state.lives = Math.min(eng.livesCap, state.lives + 1);
      }
      applied = true;
      break;
    }
    case 16: {
      state.costMilli = Math.min(eng.costMaxMilli, state.costMilli + (5000 + (level - 1) * 1200));
      let target: UnitState | null = null;
      for (const ally of state.units) {
        if (ally.hp <= 0 || ally.hp >= ally.maxHp) {
          continue;
        }
        if (!target || ally.hp * target.maxHp < target.hp * ally.maxHp || (ally.hp === target.hp && ally.id < target.id)) {
          target = ally;
        }
      }
      if (target) {
        healUnit(target, 180 + (level - 1) * 40);
      }
      cutRedeployCooldowns(state, (4 + Math.floor(level / 2)) * 30);
      cutActiveSkillCooldowns(state, (1 + Math.floor(level / 3)) * 30);
      applied = true;
      break;
    }
    case 17: {
      const targets = enemiesInUnitRange(state, unit);
      if (targets.length === 0) {
        return reject('没有可作用目标');
      }
      const flat = 140 + (level - 1) * 35;
      const percent = 600 + level * 90;
      const pull = 500 + (level - 1) * 100;
      for (const enemy of targets) {
        enemy.shield = pm(enemy.shield, 4500);
        dealDamage(state, cfg, enemy, pm(enemy.maxHp, percent) + flat, 2);
        if (enemy.hp > 0) {
        slowEnemy(enemy, Math.max(6400, 8200 - (level - 1) * 200));
          enemy.progress = Math.max(0, enemy.progress - pull);
          enemy.blockedBy = 0;
        }
      }
      applied = true;
      break;
    }
    default:
      return reject('未知技能');
  }

  if (applied) {
    state.activeSkillCooldown[typeIdx] = activeSkillCooldownFor(typeIdx, level);
  }
  return ok();
}

export function applyAction(state: GameState, action: GameAction): ActionResult {
  if (state.status !== STATUS_PLAYING) {
    return reject('对局已结束');
  }
  if (state.pendingBlessing) {
    if (action.type !== 'bless') {
      return reject('祝福待选中，仅可选择祝福');
    }
    return applyBless(state, action);
  }
  switch (action.type) {
    case 'deploy':
      return applyDeploy(state, action);
    case 'retreat':
      return applyRetreat(state, action);
    case 'bless':
      return reject('当前没有待选祝福');
    case 'skill':
      return applySkill(state, action);
    case 'skillUpgrade':
      return applySkillUpgrade(state, action);
    default:
      return reject('未知操作');
  }
}

function stepWave(state: GameState): void {
  const eng = data.config.engine;
  const map = data.maps[state.mapIdx];
  if (state.phase === 0) {
    state.intermissionRemaining -= 1;
    if (state.intermissionRemaining <= 0) {
      state.phase = 1;
      state.waveFrame = -1;
      state.spawnedInWave = 0;
      state.waveEvents = buildRandomWaveEvents(state);
      state.spawnCursor = state.waveEvents.map(() => 0);
      state.coinPlan = { active: 0, frame: 0, path: 0 };
      if (state.waveIndex >= 2 && state.waveIndex < map.cfg.waves.length && state.waveIndex !== LEGACY_WAVE_COUNT) {
        const roll = nextInt(state, 10000);
        if (roll < eng.coinChancePermyriad) {
          const frame = eng.coinDelayBaseFrames + nextInt(state, eng.coinDelaySpreadFrames);
          const path = nextInt(state, map.paths.length);
          state.coinPlan = { active: 1, frame, path };
        }
      }
    }
    return;
  }
  state.waveFrame += 1;
  const events = state.waveEvents;
  for (let ei = 0; ei < events.length; ei += 1) {
    const [delay, enemyIdx, pathIdx, count, interval] = events[ei];
    const spawned = state.spawnCursor[ei];
    if (spawned >= count) {
      continue;
    }
    if (state.waveFrame === delay + spawned * interval) {
      spawnEnemy(state, enemyIdx, pathIdx);
      state.spawnCursor[ei] = spawned + 1;
    }
  }
  if (state.coinPlan.active === 1 && state.waveFrame === state.coinPlan.frame) {
    spawnEnemy(state, data.coinEnemyIdx, state.coinPlan.path);
    state.coinPlan = { active: 0, frame: 0, path: 0 };
  }
}

function enemySkillBaseCooldown(id: string, tier: number): number {
  switch (id) {
    case 'grunt':
      return Math.max(150, 300 - tier * 12);
    case 'wolf':
      return Math.max(90, 190 - tier * 10);
    case 'golem':
      return Math.max(150, 270 - tier * 12);
    case 'puppet':
      return Math.max(130, 240 - tier * 10);
    case 'boss':
      return Math.max(120, 260 - tier * 14);
    case 'drone':
      return Math.max(105, 220 - tier * 10);
    default:
      return 0;
  }
}

function resetEnemySkillCooldown(enemy: EnemyState): void {
  enemy.skillCooldown = enemySkillBaseCooldown(enemyId(enemy.typeIdx), enemy.traitTier);
}

function spawnEnemy(state: GameState, typeIdx: number, pathIdx: number): void {
  const map = data.maps[state.mapIdx];
  const cfg = data.config.enemies[typeIdx];
  const routeCount = pathListForEnemyType(map, typeIdx).length;
  pathIdx = routeCount > 0 ? Math.max(0, pathIdx % routeCount) : 0;
  const tier = typeIdx === data.coinEnemyIdx ? 0 : waveTraitTier(state.waveIndex);
  let hp = pm(cfg.hp, map.cfg.waveHpPermyriad[state.waveIndex - 1]);
  hp = pm(hp, map.cfg.hpPermyriad);
  hp = pm(hp, enemyHpPermyriad(typeIdx, state.waveIndex, tier));
  for (const mechanic of map.cfg.mechanics ?? []) {
    if (typeIdx !== data.coinEnemyIdx && mechanic.enemyHpPermyriad && mechanic.enemyHpPermyriad > 0) {
      hp = pm(hp, mechanic.enemyHpPermyriad);
    }
  }
  if (state.waveIndex === state.debuffWave) {
    hp = pm(hp, state.nextWaveDebuffPm);
  }
  if (hp < 1) {
    hp = 1;
  }
  let atk = Math.max(1, pm(cfg.atk, enemyAtkPermyriad(typeIdx, state.waveIndex, tier)));
  for (const mechanic of map.cfg.mechanics ?? []) {
    if (typeIdx !== data.coinEnemyIdx && mechanic.enemyAtkPermyriad && mechanic.enemyAtkPermyriad > 0) {
      atk = Math.max(1, pm(atk, mechanic.enemyAtkPermyriad));
    }
    const classAtk = isFlyingEnemy(typeIdx) ? mechanic.flyingEnemyAtkPermyriad : mechanic.groundEnemyAtkPermyriad;
    if (classAtk && classAtk > 0) {
      atk = Math.max(1, pm(atk, classAtk));
    }
  }
  let interval = Math.max(18, Math.floor((cfg.interval * 10000) / enemyAttackSpeedPermyriad(typeIdx, state.waveIndex, tier)));
  for (const mechanic of map.cfg.mechanics ?? []) {
    if (isFlyingEnemy(typeIdx) && mechanic.flyingEnemyAttackSpeedPermyriad && mechanic.flyingEnemyAttackSpeedPermyriad > 0) {
      interval = Math.max(18, Math.floor((interval * 10000) / mechanic.flyingEnemyAttackSpeedPermyriad));
    }
  }
  let speed = Math.max(1, pm(cfg.speed, enemySpeedPermyriad(typeIdx, state.waveIndex, tier)));
  for (const mechanic of map.cfg.mechanics ?? []) {
    if (typeIdx !== data.coinEnemyIdx && mechanic.enemySpeedPermyriad && mechanic.enemySpeedPermyriad > 0) {
      speed = Math.max(1, pm(speed, mechanic.enemySpeedPermyriad));
    }
    if (mechanic.allEnemySpeedPermyriad && mechanic.allEnemySpeedPermyriad > 0) {
      speed = Math.max(1, pm(speed, mechanic.allEnemySpeedPermyriad));
    }
  }
  let shield =
    enemyId(typeIdx) === 'puppet'
      ? pm(hp, 720 + tier * 160 + Math.max(0, state.waveIndex - 8) * 30)
      : enemyId(typeIdx) === 'boss'
        ? pm(hp, 250 + tier * 75)
        : 0;
  for (const mechanic of map.cfg.mechanics ?? []) {
    if (typeIdx !== data.coinEnemyIdx && mechanic.enemyShieldPermyriad && mechanic.enemyShieldPermyriad > 0) {
      shield += pm(hp, mechanic.enemyShieldPermyriad);
    }
  }
  const skillCooldown = enemySkillBaseCooldown(enemyId(typeIdx), tier);
  let def = enemyDefValue(typeIdx, state.waveIndex, tier);
  let res = enemyResValue(typeIdx, state.waveIndex, tier);
  let dmgToBase = cfg.dmgToBase + (typeIdx !== data.coinEnemyIdx && state.waveIndex >= 16 ? 1 : 0) + (enemyId(typeIdx) === 'boss' && state.waveIndex >= 22 ? 1 : 0);
  for (const mechanic of map.cfg.mechanics ?? []) {
    if (typeIdx === data.coinEnemyIdx) {
      continue;
    }
    def += mechanic.enemyDefBonus ?? 0;
    if (!isFlyingEnemy(typeIdx) && mechanic.groundEnemyDefPermyriad && mechanic.groundEnemyDefPermyriad > 0) {
      def = pm(def, mechanic.groundEnemyDefPermyriad);
    }
    res = Math.min(9000, res + (mechanic.enemyResBonus ?? 0));
    dmgToBase += mechanic.leakDamageBonus ?? 0;
  }
  state.enemySeq += 1;
  state.enemies.push({
    id: state.enemySeq,
    typeIdx,
    pathIdx,
    progress: 0,
    hp,
    maxHp: hp,
    atk,
    interval,
    def,
    res,
    speed,
    dmgToBase,
    shield,
    skillCooldown,
    traitTier: tier,
    hazardAcc: 0,
    atkCooldown: 0,
    blockedBy: 0,
    leaked: false,
  });
  state.spawnedInWave += 1;
}

function killCredit(state: GameState, attackerCfg: UnitConfig, enemy: EnemyState): void {
  const eng = data.config.engine;
  state.scoreKills += eng.killScore;
  if (enemy.typeIdx === data.coinEnemyIdx) {
    state.scoreLucky += eng.coinScore;
    state.costMilli = Math.min(eng.costMaxMilli, state.costMilli + 4000);
  }
  if (attackerCfg.tags.includes('killCost')) {
    state.costMilli = Math.min(eng.costMaxMilli, state.costMilli + eng.vanguardKillCostMilli);
  }
}

function nearbySameEnemyCount(state: GameState, enemy: EnemyState, id: string, radius: number): number {
  const center = enemyPosition(state, enemy);
  const radiusSq = radius * radius;
  let count = 0;
  for (const other of state.enemies) {
    if (other.id === enemy.id || other.hp === 0 || enemyId(other.typeIdx) !== id) {
      continue;
    }
    const pos = enemyPosition(state, other);
    const dx = pos.x - center.x;
    const dy = pos.y - center.y;
    if (dx * dx + dy * dy <= radiusSq) {
      count += 1;
    }
  }
  return count;
}

/** 结算一次伤害并处理击杀；kind: 0=phys 1=magic 2=直伤（溅射二段）。返回实际造成的伤害。 */
function dealDamage(state: GameState, attackerCfg: UnitConfig, enemy: EnemyState, amount: number, kind: number): number {
  const cfg = data.config.enemies[enemy.typeIdx];
  if (!unitCanHitEnemy(attackerCfg, enemy)) {
    return 0;
  }
  let incoming = amount;
  if (cfg.id === 'grunt' && kind !== 2) {
    const pack = Math.min(4, nearbySameEnemyCount(state, enemy, 'grunt', 1400));
    if (pack > 0) {
      incoming = Math.max(1, pm(incoming, Math.max(7000, 9600 - pack * 400 - enemy.traitTier * 120)));
    }
  }
  if (cfg.id === 'drone' && kind === 0) {
    incoming = Math.max(1, pm(incoming, Math.max(7800, 9000 - enemy.traitTier * 180)));
  }
  if (cfg.id === 'boss' && enemy.shield > 0 && kind !== 2) {
    incoming = Math.max(1, pm(incoming, Math.max(8200, 9000 - enemy.traitTier * 180)));
  }
  if (cfg.id === 'golem' && kind === 0 && enemy.hp * 2 > enemy.maxHp) {
    incoming = Math.max(1, pm(incoming, Math.max(6800, 8200 - enemy.traitTier * 300)));
  }
  let dealt: number;
  if (kind === 0) {
    dealt = Math.max(1, incoming - effectiveEnemyDef(state, enemy));
  } else if (kind === 1) {
    dealt = Math.max(1, pm(incoming, 10000 - enemy.res));
  } else {
    dealt = Math.max(1, incoming);
  }
  if (enemy.shield > 0) {
    const absorbed = Math.min(enemy.shield, dealt);
    enemy.shield -= absorbed;
    dealt -= absorbed;
    if (dealt <= 0) {
      return 0;
    }
  }
  enemy.hp -= dealt;
  if (enemy.hp <= 0) {
    enemy.hp = 0;
    killCredit(state, attackerCfg, enemy);
  }
  return dealt;
}

function setCooldown(state: GameState, unit: UnitState, cfg: UnitConfig): void {
  const eng = data.config.engine;
  let interval = effectiveInterval(state, cfg, unit.typeIdx);
  for (const ally of state.units) {
    if (ally.hp === 0) {
      continue;
    }
    const auraSet = effectiveAuraSet(state, ally);
    if (auraSet.size === 0) {
      continue;
    }
    if (auraSet.has(offsetKey(unit.row - ally.row, unit.col - ally.col))) {
      interval = Math.floor((interval * 10000) / (10000 + eng.koiSpeedPermyriad));
      break;
    }
  }
  for (const mechanic of data.maps[state.mapIdx].cfg.mechanics ?? []) {
    if (!mechanic.unitIntervalPermyriad || mechanic.unitIntervalPermyriad <= 0) {
      continue;
    }
    if (mechanicAppliesToUnit(state, mechanic.id, unit)) {
      interval = Math.max(1, Math.floor((interval * mechanic.unitIntervalPermyriad) / 10000));
    }
  }
  for (const mechanic of data.maps[state.mapIdx].cfg.mechanics ?? []) {
    const speedMultiplier = cfg.block === 0 ? mechanic.highGroundUnitAttackSpeedPermyriad : undefined;
    if (speedMultiplier && speedMultiplier > 0) {
      interval = Math.max(1, Math.floor((interval * 10000) / speedMultiplier));
    }
    if (mechanic.unitAttackSpeedPermyriad && mechanic.unitAttackSpeedPermyriad > 0) {
      interval = Math.max(1, Math.floor((interval * 10000) / mechanic.unitAttackSpeedPermyriad));
    }
    if (mechanic.cellUnitAttackSpeedPermyriad && mechanic.cellUnitAttackSpeedPermyriad > 0 && mechanicAppliesToUnit(state, mechanic.id, unit)) {
      interval = Math.max(1, Math.floor((interval * 10000) / mechanic.cellUnitAttackSpeedPermyriad));
    }
  }
  unit.atkCooldown = interval;
}

function pickEnemyTarget(state: GameState, unit: UnitState, cfg: UnitConfig): EnemyState | null {
  if (cfg.block > 0) {
    let bestBlocked: EnemyState | null = null;
    for (const enemy of state.enemies) {
      if (enemy.hp === 0 || enemy.blockedBy !== unit.id) {
        continue;
      }
      if (
        !bestBlocked ||
        enemy.progress > bestBlocked.progress ||
        (enemy.progress === bestBlocked.progress && enemy.id < bestBlocked.id)
      ) {
        bestBlocked = enemy;
      }
    }
    if (bestBlocked) {
      return bestBlocked;
    }
  }
  const rangeSet = effectiveRangeSet(state, unit);
  let best: EnemyState | null = null;
  let bestRemaining = 0;
  for (const enemy of state.enemies) {
    if (enemy.hp === 0) {
      continue;
    }
    if (!unitCanHitEnemy(cfg, enemy)) {
      continue;
    }
    const path = enemyPath(state, enemy);
    const pos = positionOnPath(path, enemy.progress);
    const eRow = Math.floor(pos.y / 1000);
    const eCol = Math.floor(pos.x / 1000);
    if (!rangeSet.has(offsetKey(eRow - unit.row, eCol - unit.col))) {
      continue;
    }
    const remaining = path.lengthMilli - enemy.progress;
    if (!best || remaining < bestRemaining || (remaining === bestRemaining && enemy.id < best.id)) {
      best = enemy;
      bestRemaining = remaining;
    }
  }
  return best;
}

function unitAct(state: GameState, unit: UnitState): void {
  if (unit.hp === 0) {
    return;
  }
  const cfg = data.config.units[unit.typeIdx];
  if (cfg.skill && cfg.skill.kind === 'shield' && unit.sp >= cfg.skill.spCost) {
    unit.sp = 0;
    unit.skillActive = cfg.skill.duration;
  }
  if (unit.atkCooldown > 0) {
    return;
  }
  if (cfg.atkType === 'none') {
    return;
  }
  if (cfg.atkType === 'heal') {
    const rangeSet = effectiveRangeSet(state, unit);
    let target: UnitState | null = null;
    let bestRatio = 0;
    for (const ally of state.units) {
      if (ally.hp === 0 || ally.hp >= ally.maxHp) {
        continue;
      }
      if (!rangeSet.has(offsetKey(ally.row - unit.row, ally.col - unit.col))) {
        continue;
      }
      const ratio = Math.floor((ally.hp * 10000) / ally.maxHp);
      if (!target || ratio < bestRatio || (ratio === bestRatio && ally.id < target.id)) {
        target = ally;
        bestRatio = ratio;
      }
    }
    if (!target) {
      return;
    }
    target.hp = Math.min(target.maxHp, target.hp + effectiveAtk(state, cfg, unit.typeIdx));
    setCooldown(state, unit, cfg);
    return;
  }
  const target = pickEnemyTarget(state, unit, cfg);
  if (!target) {
    return;
  }
  let atkBase = effectiveAtk(state, cfg, unit.typeIdx);
  if (cfg.skill && cfg.skill.kind === 'triple') {
    unit.attackCount += 1;
    if (unit.attackCount % cfg.skill.every === 0) {
      atkBase = pm(atkBase, cfg.skill.permyriad);
    }
  }
  const kind = cfg.atkType === 'magic' ? 1 : 0;
  if (kind === 1 && cfg.aoeRadius > 0) {
    const center = enemyPosition(state, target);
    const radiusSq = cfg.aoeRadius * cfg.aoeRadius;
    for (const enemy of state.enemies) {
      if (enemy.hp === 0) {
        continue;
      }
      if (!unitCanHitEnemy(cfg, enemy)) {
        continue;
      }
      const pos = enemyPosition(state, enemy);
      const dx = pos.x - center.x;
      const dy = pos.y - center.y;
      if (dx * dx + dy * dy <= radiusSq) {
        dealDamage(state, cfg, enemy, atkBase, 1);
      }
    }
  } else {
    const dealt = dealDamage(state, cfg, target, atkBase, kind);
    if (cfg.splashRadius > 0) {
      const center = enemyPosition(state, target);
      const radiusSq = cfg.splashRadius * cfg.splashRadius;
      const splash = pm(dealt, cfg.splashPermyriad);
      for (const enemy of state.enemies) {
        if (enemy.hp === 0 || enemy.id === target.id) {
          continue;
        }
        if (!unitCanHitEnemy(cfg, enemy)) {
          continue;
        }
        const pos = enemyPosition(state, enemy);
        const dx = pos.x - center.x;
        const dy = pos.y - center.y;
        if (dx * dx + dy * dy <= radiusSq) {
          dealDamage(state, cfg, enemy, splash, 2);
        }
      }
    }
  }
  setCooldown(state, unit, cfg);
}

function findMeleeUnitAt(state: GameState, row: number, col: number): UnitState | null {
  for (const unit of state.units) {
    if (unit.hp === 0 || unit.row !== row || unit.col !== col) {
      continue;
    }
    if (data.config.units[unit.typeIdx].block > 0) {
      return unit;
    }
  }
  return null;
}

function damageUnitsAroundPoint(state: GameState, center: { x: number; y: number }, radius: number, amount: number): boolean {
  const radiusSq = radius * radius;
  let applied = false;
  for (const unit of state.units) {
    if (unit.hp <= 0) {
      continue;
    }
    const ux = unit.col * 1000 + 500;
    const uy = unit.row * 1000 + 500;
    const dx = ux - center.x;
    const dy = uy - center.y;
    if (dx * dx + dy * dy <= radiusSq) {
      unit.hp = Math.max(0, unit.hp - amount);
      applied = true;
    }
  }
  return applied;
}

function addEnemyShield(enemy: EnemyState, shieldPermyriad: number, capPermyriad: number): boolean {
  const cap = Math.max(0, pm(enemy.maxHp, capPermyriad));
  if (cap <= 0 || enemy.shield >= cap) {
    return false;
  }
  const next = Math.min(cap, enemy.shield + Math.max(1, pm(enemy.maxHp, shieldPermyriad)));
  const applied = next > enemy.shield;
  enemy.shield = next;
  return applied;
}

function shieldEnemiesAround(state: GameState, source: EnemyState, radius: number, shieldPermyriad: number, capPermyriad: number): boolean {
  const center = enemyPosition(state, source);
  const radiusSq = radius * radius;
  let applied = false;
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0 || enemy.typeIdx === data.coinEnemyIdx) {
      continue;
    }
    const pos = enemyPosition(state, enemy);
    const dx = pos.x - center.x;
    const dy = pos.y - center.y;
    if (dx * dx + dy * dy <= radiusSq) {
      applied = addEnemyShield(enemy, shieldPermyriad, capPermyriad) || applied;
    }
  }
  return applied;
}

function castEnemySkill(state: GameState, enemy: EnemyState): boolean {
  const id = enemyId(enemy.typeIdx);
  const tier = enemy.traitTier;
  switch (id) {
    case 'grunt': {
      addEnemyShield(enemy, 120 + tier * 40, 900 + tier * 160);
      shieldEnemiesAround(state, enemy, 1400, 50 + tier * 20, 700 + tier * 120);
      return true;
    }
    case 'wolf': {
      if (enemy.blockedBy !== 0) {
        const blocker = state.units.find((unit) => unit.id === enemy.blockedBy);
        if (blocker && blocker.hp > 0) {
          blocker.hp = Math.max(0, blocker.hp - (35 + tier * 20));
          addEnemyShield(enemy, 80 + tier * 25, 700 + tier * 120);
          return true;
        }
      }
      enemy.progress += 210 + tier * 55;
      return true;
    }
    case 'golem': {
      if (enemy.blockedBy === 0) {
        return false;
      }
      const blocker = state.units.find((unit) => unit.id === enemy.blockedBy);
      if (!blocker || blocker.hp <= 0) {
        return false;
      }
      addEnemyShield(enemy, 100 + tier * 35, 850 + tier * 150);
      damageUnitsAroundPoint(state, { x: blocker.col * 1000 + 500, y: blocker.row * 1000 + 500 }, 1100, 70 + tier * 25);
      return true;
    }
    case 'puppet': {
      const targetShield = pm(enemy.maxHp, 850 + tier * 160);
      if (enemy.shield >= targetShield) {
        return false;
      }
      addEnemyShield(enemy, 420 + tier * 100, 850 + tier * 160);
      enemy.res = Math.min(7600, enemy.res + 70 + tier * 30);
      return true;
    }
    case 'boss': {
      const heal = Math.max(1, pm(enemy.maxHp, 160 + tier * 45));
      enemy.hp = Math.min(enemy.maxHp, enemy.hp + heal);
      addEnemyShield(enemy, 180 + tier * 50, 700 + tier * 130);
      const pos = enemyPosition(state, enemy);
      damageUnitsAroundPoint(state, pos, 1700 + tier * 100, 60 + tier * 35);
      shieldEnemiesAround(state, enemy, 2200, 70 + tier * 25, 650 + tier * 110);
      return true;
    }
    case 'drone':
      enemy.progress += 170 + tier * 55;
      addEnemyShield(enemy, 90 + tier * 25, 600 + tier * 100);
      return true;
    default:
      return false;
  }
}

function enemyAct(state: GameState, enemy: EnemyState): void {
  if (enemy.hp === 0) {
    return;
  }
  const cfg = data.config.enemies[enemy.typeIdx];
  if (enemy.skillCooldown > 0) {
    enemy.skillCooldown -= 1;
  }
  if (enemy.skillCooldown <= 0 && enemySkillBaseCooldown(cfg.id, enemy.traitTier) > 0) {
    if (castEnemySkill(state, enemy)) {
      resetEnemySkillCooldown(enemy);
    } else {
      enemy.skillCooldown = 15;
    }
  }
  if (enemy.hp === 0) {
    return;
  }
  if (enemy.blockedBy !== 0) {
    const blocker = state.units.find((unit) => unit.id === enemy.blockedBy);
    if (blocker && blocker.hp > 0) {
      if (enemy.atkCooldown > 0) {
        enemy.atkCooldown -= 1;
        return;
      }
      const defEff = effectiveUnitDef(state, blocker);
      const dealt = Math.max(1, enemy.atk - defEff);
      blocker.hp -= dealt;
      if (blocker.hp <= 0) {
        blocker.hp = 0;
      }
      enemy.atkCooldown = enemy.interval;
      return;
    }
    enemy.blockedBy = 0;
  }
  const path = enemyPath(state, enemy);
  // 远程敌人（atkRange>0）：未被阻挡时边走边射，目标=射程内距离²最小者（同距取 id 小）
  if (cfg.atkRange !== undefined && cfg.atkRange > 0) {
    if (enemy.atkCooldown > 0) {
      enemy.atkCooldown -= 1;
    } else {
      const pos = positionOnPath(path, enemy.progress);
      const rangeSq = cfg.atkRange * cfg.atkRange;
      let target: UnitState | null = null;
      let bestDistSq = 0;
      for (const unit of state.units) {
        if (unit.hp === 0) {
          continue;
        }
        const dx = unit.col * 1000 + 500 - pos.x;
        const dy = unit.row * 1000 + 500 - pos.y;
        const distSq = dx * dx + dy * dy;
        if (distSq > rangeSq) {
          continue;
        }
        if (target === null || distSq < bestDistSq || (distSq === bestDistSq && unit.id < target.id)) {
          target = unit;
          bestDistSq = distSq;
        }
      }
      if (target !== null) {
        const defEff = effectiveUnitDef(state, target);
        const dealt = Math.max(1, enemy.atk - defEff);
        target.hp -= dealt;
        if (target.hp <= 0) {
          target.hp = 0;
        }
        enemy.atkCooldown = enemy.interval;
      }
    }
  }
  const from = enemy.progress;
  let effectiveSpeed = enemy.speed;
  for (const mechanic of data.maps[state.mapIdx].cfg.mechanics ?? []) {
    if (mechanic.cellEnemySpeedPermyriad && mechanic.cellEnemySpeedPermyriad > 0 && mechanicAppliesToEnemy(state, mechanic.id, enemy)) {
      effectiveSpeed = Math.max(1, pm(effectiveSpeed, mechanic.cellEnemySpeedPermyriad));
    }
  }
  const moveSpeed = cfg.id === 'wolf' ? effectiveSpeed + Math.max(1, pm(effectiveSpeed, 1200 + enemy.traitTier * 250)) : effectiveSpeed;
  let to = from + moveSpeed;
  if (cfg.blockable) {
    // 挤压碰撞：判定箱半格（500），不可越过同路径前方最近的地面敌人（同进度时 id 小者视为在前）
    let aheadProgress = -1;
    for (const other of state.enemies) {
      if (other.id === enemy.id || other.hp === 0 || other.pathIdx !== enemy.pathIdx) {
        continue;
      }
      if (!data.config.enemies[other.typeIdx].blockable) {
        continue;
      }
      if (other.progress > from || (other.progress === from && other.id < enemy.id)) {
        if (aheadProgress < 0 || other.progress < aheadProgress) {
          aheadProgress = other.progress;
        }
      }
    }
    if (aheadProgress >= 0 && to > aheadProgress - 500) {
      to = Math.max(from, aheadProgress - 500);
    }
    // 阻挡捕获：拦截点 = 近战单位所在格中心前一格（centerProgress - 1000，下限 0）。
    // 若敌人已处于拦截点与单位格中心之间（落位推退/贴脸出生），原地立即进入阻挡。
    for (const cell of path.cells) {
      if (cell.centerProgress <= from) {
        continue;
      }
      const stop = Math.max(0, cell.centerProgress - 1000);
      if (stop > to) {
        break;
      }
      const unit = findMeleeUnitAt(state, cell.row, cell.col);
      if (!unit) {
        continue;
      }
      const blockLimit = data.config.units[unit.typeIdx].block;
      let blockedCount = 0;
      for (const other of state.enemies) {
        if (other.hp > 0 && other.blockedBy === unit.id) {
          blockedCount += 1;
        }
      }
      if (blockedCount >= blockLimit) {
        continue;
      }
      enemy.progress = stop > from ? stop : from;
      enemy.blockedBy = unit.id;
      return;
    }
  }
  enemy.progress = to;
  if (enemy.progress >= path.lengthMilli) {
    state.lives -= enemy.dmgToBase;
    enemy.leaked = true;
    enemy.hp = 0;
  }
}

function applyMapUnitHazards(state: GameState): void {
  const fps = data.config.engine.fps;
  if (fps <= 0 || state.frame % fps !== 0) {
    return;
  }
  for (const unit of state.units) {
    if (unit.hp === 0) {
      continue;
    }
    const damage = unitHazardDamagePerSecond(state, unit);
    if (damage <= 0) {
      continue;
    }
    unit.hp = Math.max(0, unit.hp - damage);
  }
}

function applyMapEnemyHazards(state: GameState): void {
  const fps = data.config.engine.fps;
  if (fps <= 0) {
    return;
  }
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) {
      continue;
    }
    let damagePermyriad = 0;
    for (const mechanic of data.maps[state.mapIdx].cfg.mechanics ?? []) {
      if (
        mechanic.enemyMaxHpDamagePermyriadPerSecond
        && mechanic.enemyMaxHpDamagePermyriadPerSecond > 0
        && mechanicAppliesToEnemy(state, mechanic.id, enemy)
      ) {
        damagePermyriad += mechanic.enemyMaxHpDamagePermyriadPerSecond;
      }
    }
    if (damagePermyriad <= 0) {
      enemy.hazardAcc = 0;
      continue;
    }
    enemy.hazardAcc += enemy.maxHp * damagePermyriad;
    const divisor = fps * 10000;
    const damage = Math.floor(enemy.hazardAcc / divisor);
    enemy.hazardAcc %= divisor;
    if (damage > 0) {
      enemy.hp = Math.max(0, enemy.hp - damage);
    }
  }
}

function sweep(state: GameState): void {
  let hasDeadEnemy = false;
  for (const enemy of state.enemies) {
    if (enemy.hp === 0) {
      hasDeadEnemy = true;
      break;
    }
  }
  if (hasDeadEnemy) {
    state.enemies = state.enemies.filter((enemy) => enemy.hp > 0);
  }
  let hasDeadUnit = false;
  for (const unit of state.units) {
    if (unit.hp === 0) {
      hasDeadUnit = true;
      break;
    }
  }
  if (hasDeadUnit) {
    for (const unit of state.units) {
      if (unit.hp !== 0) {
        continue;
      }
      for (const enemy of state.enemies) {
        if (enemy.blockedBy === unit.id) {
          enemy.blockedBy = 0;
        }
      }
      state.redeployCooldown[unit.typeIdx] = data.config.units[unit.typeIdx].redeploy;
    }
    state.units = state.units.filter((unit) => unit.hp > 0);
  }
}

function checkWaveClear(state: GameState): void {
  if (state.status !== STATUS_PLAYING || state.phase !== 1) {
    return;
  }
  const eng = data.config.engine;
  const map = data.maps[state.mapIdx];
  const events = state.waveEvents;
  for (let ei = 0; ei < events.length; ei += 1) {
    if (state.spawnCursor[ei] < events[ei][3]) {
      return;
    }
  }
  if (state.coinPlan.active === 1 || state.enemies.length > 0) {
    return;
  }
  if (state.waveIndex === state.debuffWave) {
    state.nextWaveDebuffPm = 10000;
    state.debuffWave = 0;
  }
  state.costMilli = Math.min(eng.costMaxMilli, state.costMilli + eng.waveClearCostMilli);
  state.scoreWaves += eng.waveScoreBase + eng.waveScorePerWave * state.waveIndex;
  for (const unit of state.units) {
    if (unit.hp > 0 && data.config.units[unit.typeIdx].auraCells.length > 0) {
      state.scoreLucky += eng.koiWaveScore;
      break;
    }
  }
  state.waveHashes.push(hashState(state));
  if (state.waveIndex === map.cfg.waves.length) {
    state.status = STATUS_WON;
    return;
  }
  if (eng.blessingWaves.includes(state.waveIndex)) {
    const candidates: number[] = [];
    for (let b = 0; b < data.config.blessings.length; b += 1) {
      if ((state.blessingsOwned & (1 << b)) === 0) {
        candidates.push(b);
      }
    }
    if (candidates.length > 0) {
      const picks = Math.min(eng.blessingChoices, candidates.length);
      for (let i = 0; i < picks; i += 1) {
        const j = i + nextInt(state, candidates.length - i);
        const tmp = candidates[i];
        candidates[i] = candidates[j];
        candidates[j] = tmp;
      }
      state.pendingBlessing = { options: candidates.slice(0, picks) };
    }
  }
  state.waveIndex += 1;
  state.phase = 0;
  state.intermissionRemaining = eng.intermissionFrames;
}

export function tick(state: GameState): boolean {
  if (state.status !== STATUS_PLAYING || state.pendingBlessing) {
    return false;
  }
  const eng = data.config.engine;
  state.frame += 1;
  if (state.frame >= eng.maxFrames) {
    state.status = STATUS_LOST;
    return true;
  }
  for (let i = 0; i < state.redeployCooldown.length; i += 1) {
    if (state.redeployCooldown[i] > 0) {
      state.redeployCooldown[i] -= 1;
    }
  }
  for (let i = 0; i < state.activeSkillCooldown.length; i += 1) {
    if (state.activeSkillCooldown[i] > 0) {
      state.activeSkillCooldown[i] -= 1;
    }
  }
  for (const unit of state.units) {
    if (unit.skillActive > 0) {
      unit.skillActive -= 1;
    }
    if (unit.atkCooldown > 0) {
      unit.atkCooldown -= 1;
    }
    const skill = data.config.units[unit.typeIdx].skill;
    if (skill && skill.kind === 'shield') {
      unit.spTimer += 1;
      if (unit.spTimer >= 30) {
        unit.spTimer = 0;
        unit.sp += 1;
      }
    }
  }
  applyMapUnitHazards(state);
  state.costAcc += state.regenMilliPerSec;
  state.costMilli += Math.floor(state.costAcc / 30);
  state.costAcc %= 30;
  if (state.costMilli > eng.costMaxMilli) {
    state.costMilli = eng.costMaxMilli;
  }
  stepWave(state);
  applyMapEnemyHazards(state);
  for (const unit of state.units) {
    unitAct(state, unit);
  }
  for (const enemy of state.enemies) {
    enemyAct(state, enemy);
  }
  sweep(state);
  checkWaveClear(state);
  if (state.status === STATUS_PLAYING && state.lives <= 0) {
    state.status = STATUS_LOST;
  }
  return true;
}

export function hashState(state: GameState): number {
  let hash = hashInit();
  const mix = (value: number) => {
    hash = hashMixUint32(hash, value >>> 0);
  };
  mix(state.frame);
  mix(state.rngState);
  mix(state.status);
  mix(state.costMilli);
  mix(state.costAcc);
  mix(state.lives);
  mix(state.waveIndex);
  mix(state.phase);
  mix(state.intermissionRemaining);
  mix(state.waveFrame);
  mix(state.spawnedInWave);
  mix(state.coinPlan.active);
  mix(state.coinPlan.frame);
  mix(state.coinPlan.path);
  const pending = state.pendingBlessing;
  if (pending) {
    mix(1);
    for (let i = 0; i < 3; i += 1) {
      mix(i < pending.options.length ? pending.options[i] : 0xffffffff);
    }
  } else {
    mix(0);
    mix(0xffffffff);
    mix(0xffffffff);
    mix(0xffffffff);
  }
  mix(state.blessingsOwned);
  mix(state.regenMilliPerSec);
  mix(state.meleeHpBonusPm);
  mix(state.rangedAtkBonusPm);
  mix(state.nextWaveDebuffPm);
  mix(state.debuffWave);
  mix(state.scoreWaves);
  mix(state.scoreKills);
  mix(state.scoreLucky);
  mix(state.unitSeq);
  mix(state.enemySeq);
  for (let i = 0; i < state.redeployCooldown.length; i += 1) {
    mix(state.redeployCooldown[i]);
  }
  for (let i = 0; i < state.activeSkillLevels.length; i += 1) {
    mix(state.activeSkillLevels[i]);
  }
  for (let i = 0; i < state.activeSkillCooldown.length; i += 1) {
    mix(state.activeSkillCooldown[i]);
  }
  mix(state.units.length);
  for (const unit of state.units) {
    mix(unit.id);
    mix(unit.typeIdx);
    mix(unit.row);
    mix(unit.col);
    mix(unit.dir);
    mix(unit.hp);
    mix(unit.maxHp);
    mix(unit.atkCooldown);
    mix(unit.spTimer);
    mix(unit.sp);
    mix(unit.skillActive);
    mix(unit.attackCount);
  }
  mix(state.enemies.length);
  for (const enemy of state.enemies) {
    mix(enemy.id);
    mix(enemy.typeIdx);
    mix(enemy.pathIdx);
    mix(enemy.progress);
    mix(enemy.hp);
    mix(enemy.maxHp);
    mix(enemy.atk);
    mix(enemy.interval);
    mix(enemy.def);
    mix(enemy.res);
    mix(enemy.speed);
    mix(enemy.dmgToBase);
    mix(enemy.shield);
    mix(enemy.skillCooldown);
    mix(enemy.traitTier);
    mix(enemy.hazardAcc);
    mix(enemy.atkCooldown);
    mix(enemy.blockedBy);
    mix(enemy.leaked ? 1 : 0);
  }
  return hash >>> 0;
}

export function finalize(state: GameState): GameResult {
  const eng = data.config.engine;
  const map = data.maps[state.mapIdx];
  const livesScore = Math.max(0, state.lives) * eng.livesScorePerLife;
  const raw = state.scoreWaves + state.scoreKills + state.scoreLucky + livesScore;
  const total = Math.min(eng.scoreCap, pm(raw, map.cfg.scorePermyriad));
  const wavesCleared = state.status === STATUS_WON ? map.cfg.waves.length : state.waveIndex - 1;
  return {
    status: state.status,
    frames: state.frame,
    wavesCleared,
    score: total,
    breakdown: {
      waves: state.scoreWaves,
      kills: state.scoreKills,
      lucky: state.scoreLucky,
      lives: livesScore,
    },
  };
}

export function replay(input: ReplayInput): ReplayOutput {
  const eng = data.config.engine;
  const fail = (error: string): ReplayOutput => ({ ok: false, error, state: null, result: null });
  if (input.actions.length > eng.maxActions) {
    return fail('操作数超过上限');
  }
  for (let i = 0; i < input.actions.length; i += 1) {
    const action = input.actions[i];
    if (!Number.isInteger(action.frame) || action.frame < 0 || !Number.isInteger(action.seq)) {
      return fail('操作帧或序号非法');
    }
    if (i > 0) {
      const prev = input.actions[i - 1];
      if (action.frame < prev.frame || (action.frame === prev.frame && action.seq <= prev.seq)) {
        return fail('操作未按 (frame, seq) 严格递增排序');
      }
    }
  }
  let state: GameState;
  try {
    state = initState(input.seed, input.mapId, input.squad);
  } catch (error) {
    return fail(error instanceof Error ? error.message : '初始化失败');
  }
  let idx = 0;
  for (;;) {
    while (idx < input.actions.length && input.actions[idx].frame === state.frame && state.status === STATUS_PLAYING) {
      const result = applyAction(state, input.actions[idx]);
      if (!result.ok) {
        return fail(`第 ${idx + 1} 条操作被拒绝: ${result.message}`);
      }
      idx += 1;
    }
    if (state.status !== STATUS_PLAYING) {
      break;
    }
    if (state.pendingBlessing) {
      return fail('祝福未决且没有对应的 bless 操作');
    }
    tick(state);
  }
  if (idx < input.actions.length) {
    return fail('终局后仍有未应用的操作');
  }
  return { ok: true, error: '', state, result: finalize(state) };
}
