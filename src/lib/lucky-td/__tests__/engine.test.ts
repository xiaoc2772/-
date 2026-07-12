// 幸运塔防 引擎测试与黄金向量生成器。
// 生成/更新向量：GOLDEN_UPDATE=1 npx vitest run src/lib/lucky-td
// 向量文件同时被 Go 侧 backend/internal/luckytd/engine_golden_test.go 消费（双端一致性验收）。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTIVE_SKILLS, ACTIVE_SKILL_MAX_LEVEL, activeSkillCooldownFor } from '../engine/active-skills';
import { getEngineData, rotateOffset } from '../engine/data';
import { applyAction, finalize, hashState, initState, replay, tick } from '../engine/engine';
import { fnv1a32String, xorshift32 } from '../engine/rng';
import type { GameAction, GameState } from '../engine/types';
import {
  BROOK_PLAN,
  BROOK_SQUAD,
  FROSTFIRE_PLAN,
  FROSTFIRE_SQUAD,
  KOI_PLAN,
  KOI_SQUAD,
  STARLAMP_PLAN,
  STARLAMP_SQUAD,
  RUBBLEMIST_PLAN,
  RUBBLEMIST_SQUAD,
  THUNDERVOID_PLAN,
  THUNDERVOID_SQUAD,
  TRAINING_PLAN,
  TRAINING_SQUAD,
} from './anchor-plans';
import type { DeployStep } from './anchor-plans';

const DATA = getEngineData();
const FIXTURE_DIR = join(process.cwd(), 'src', 'lib', 'lucky-td', '__fixtures__', 'golden');
const UPDATE = process.env.GOLDEN_UPDATE === '1';

interface VectorExpect {
  status: number;
  frames: number;
  wavesCleared: number;
  score: number;
  finalHash: number;
  waveHashes: number[];
}

interface Vector {
  name: string;
  seed: string;
  mapId: string;
  squad: string[];
  actions: GameAction[];
  expect: VectorExpect;
}

type EmitFn = (action: Omit<GameAction, 'frame' | 'seq'>) => void;
type Policy = (state: GameState, emit: EmitFn) => void;
type BlessPick = (options: number[]) => number;

const blessFirst: BlessPick = (options) => options[0];
const blessSecond: BlessPick = (options) => options[Math.min(1, options.length - 1)];
const blessLast: BlessPick = (options) => options[options.length - 1];
/** 按固定偏好挑祝福：远程攻击 > 近战生命 > 回费 > 生命 > 立即费用 > 削弱。 */
const blessPrefer: BlessPick = (options) => {
  for (const pref of [2, 1, 0, 3, 5, 4]) {
    if (options.includes(pref)) {
      return pref;
    }
  }
  return options[0];
};

function runPolicy(
  name: string,
  seed: string,
  mapId: string,
  squad: string[],
  policy: Policy,
  blessPick: BlessPick = blessFirst,
): Vector {
  const state = initState(seed, mapId, squad);
  const actions: GameAction[] = [];
  let seq = 0;
  let guard = 0;
  while (state.status === 0) {
    guard += 1;
    if (guard > 200000) {
      throw new Error(`${name}: policy run exceeded safety guard`);
    }
    const emitted: Omit<GameAction, 'frame' | 'seq'>[] = [];
    policy(state, (action) => emitted.push(action));
    for (const partial of emitted) {
      const full: GameAction = { ...partial, frame: state.frame, seq };
      if (applyAction(state, full).ok) {
        actions.push(full);
        seq += 1;
      }
    }
    if (state.pendingBlessing) {
      const full: GameAction = {
        frame: state.frame,
        seq,
        type: 'bless',
        blessing: blessPick(state.pendingBlessing.options),
      };
      const result = applyAction(state, full);
      if (!result.ok) {
        throw new Error(`${name}: bless rejected: ${result.message}`);
      }
      actions.push(full);
      seq += 1;
      continue;
    }
    tick(state);
  }
  const result = finalize(state);
  return {
    name,
    seed,
    mapId,
    squad,
    actions,
    expect: {
      status: result.status,
      frames: result.frames,
      wavesCleared: result.wavesCleared,
      score: result.score,
      finalHash: hashState(state),
      waveHashes: [...state.waveHashes],
    },
  };
}

function planPolicy(plan: DeployStep[]): Policy {
  return (state, emit) => {
    for (const step of plan) {
      const typeIdx = DATA.unitIdToIdx[step.unit];
      if (!state.squad.includes(typeIdx)) {
        continue;
      }
      if (state.units.some((unit) => unit.typeIdx === typeIdx)) {
        continue;
      }
      if (state.redeployCooldown[typeIdx] > 0) {
        continue;
      }
      emit({ type: 'deploy', unit: typeIdx, row: step.row, col: step.col, dir: step.dir });
      break;
    }
  };
}

function withRetreat(base: Policy, unitId: string, atFrame: number): Policy {
  return (state, emit) => {
    if (state.frame === atFrame) {
      const typeIdx = DATA.unitIdToIdx[unitId];
      const unit = state.units.find((candidate) => candidate.typeIdx === typeIdx);
      if (unit) {
        emit({ type: 'retreat', unitId: unit.id });
      }
    }
    base(state, emit);
  };
}

const idlePolicy: Policy = () => {};

function buildGoldenVectors(): Vector[] {
  return [
    runPolicy('training-anchor', 'lucky-td-golden-016', 'training_field', TRAINING_SQUAD, planPolicy(TRAINING_PLAN), blessPrefer),
    runPolicy('brook-anchor', 'lucky-td-golden-017', 'brook_ford', BROOK_SQUAD, planPolicy(BROOK_PLAN), blessPrefer),
    runPolicy('starlamp-anchor', 'lucky-td-golden-018', 'starlamp_outpost', STARLAMP_SQUAD, planPolicy(STARLAMP_PLAN), blessPrefer),
    runPolicy('frostfire-anchor', 'lucky-td-golden-019', 'frostfire_fault', FROSTFIRE_SQUAD, planPolicy(FROSTFIRE_PLAN), blessPrefer),
    runPolicy('rubblemist-anchor', 'lucky-td-golden-020', 'rubblemist_plateau', RUBBLEMIST_SQUAD, planPolicy(RUBBLEMIST_PLAN), blessPrefer),
    runPolicy('thundervoid-anchor', 'lucky-td-golden-021', 'thundervoid_gate', THUNDERVOID_SQUAD, planPolicy(THUNDERVOID_PLAN), blessPrefer),
    runPolicy('training-idle', 'lucky-td-golden-001', 'training_field', ['vanguard'], idlePolicy),
    runPolicy(
      'training-retreat',
      'lucky-td-golden-003',
      'training_field',
      TRAINING_SQUAD,
      withRetreat(planPolicy(TRAINING_PLAN), 'vanguard', 3000),
    ),
    runPolicy('brook-idle', 'lucky-td-golden-004', 'brook_ford', ['defender'], idlePolicy),
    runPolicy('training-koi', 'lucky-td-golden-006', 'training_field', KOI_SQUAD, planPolicy(KOI_PLAN), blessLast),
    runPolicy(
      'training-solo',
      'lucky-td-golden-007',
      'training_field',
      ['vanguard'],
      planPolicy([{ unit: 'vanguard', row: 1, col: 5, dir: 0 }]),
    ),
    runPolicy(
      'brook-retreats',
      'lucky-td-golden-008',
      'brook_ford',
      BROOK_SQUAD,
      withRetreat(withRetreat(planPolicy(BROOK_PLAN), 'defender', 4000), 'caster', 8000),
      blessSecond,
    ),
  ];
}

const FUZZ_COUNT = 200;
const FUZZ_SQUADS = [TRAINING_SQUAD, KOI_SQUAD, ['defender', 'caster', 'medic'], ['vanguard', 'ranger', 'archer']];

function buildFuzzVectors(): Vector[] {
  const vectors: Vector[] = [];
  for (let i = 0; i < FUZZ_COUNT; i += 1) {
    const seed = `lucky-td-fuzz-${i}`;
    let botRng = fnv1a32String(seed) || 1;
    const nextBot = () => {
      botRng = xorshift32(botRng);
      return botRng;
    };
    const mapId = DATA.config.maps[i % DATA.config.maps.length].id;
    const squad = FUZZ_SQUADS[i % FUZZ_SQUADS.length];
    const policy: Policy = (state, emit) => {
      if (nextBot() % 89 >= 3) {
        return;
      }
      const mapCfg = DATA.maps[state.mapIdx].cfg;
      if (nextBot() % 10 < 7) {
        emit({
          type: 'deploy',
          unit: state.squad[nextBot() % state.squad.length],
          row: nextBot() % mapCfg.rows,
          col: nextBot() % mapCfg.cols,
          dir: nextBot() % 4,
        });
      } else if (state.units.length > 0) {
        emit({ type: 'retreat', unitId: state.units[nextBot() % state.units.length].id });
      }
    };
    const blessPick: BlessPick = (options) => options[nextBot() % options.length];
    vectors.push(runPolicy(`fuzz-${i}`, seed, mapId, squad, policy, blessPick));
  }
  return vectors;
}

function loadOrUpdate(fileName: string, build: () => Vector[]): { stored: Vector[]; fresh: Vector[] } {
  const fresh = build();
  const filePath = join(FIXTURE_DIR, fileName);
  if (UPDATE) {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(filePath, JSON.stringify(fresh));
  }
  const stored = JSON.parse(readFileSync(filePath, 'utf8')) as Vector[];
  return { stored, fresh };
}

describe('lucky-td rng primitives', () => {
  it('xorshift32 与 fnv1a32 输出与规格一致', () => {
    expect(xorshift32(1)).toBe(270369);
    expect(fnv1a32String('')).toBe(0x811c9dc5);
    expect(fnv1a32String('a')).toBe(0xe40c292c);
  });
});

describe('lucky-td map precompute', () => {
  it('路径长度与近战位数量正确', () => {
    const training = DATA.maps[DATA.mapIdToIdx.training_field];
    expect(training.paths.map((path) => path.lengthMilli)).toEqual([32000, 32000]);
    expect(training.meleeCellSet.size).toBe(62);
    expect(Object.keys(training.mechanicCellSets)).toEqual([]);
    const brook = DATA.maps[DATA.mapIdToIdx.brook_ford];
    expect(brook.paths.map((path) => path.lengthMilli)).toEqual([29000, 29000]);
    expect(brook.meleeCellSet.size).toBe(54);
    expect(Object.keys(brook.mechanicCellSets)).toEqual([]);
    const starlamp = DATA.maps[DATA.mapIdToIdx.starlamp_outpost];
    expect(starlamp.paths.map((path) => path.lengthMilli)).toEqual([26000, 26000, 17000]);
    expect(starlamp.meleeCellSet.size).toBe(60);
    expect(Object.keys(starlamp.mechanicCellSets)).toEqual([]);
    const frostfire = DATA.maps[DATA.mapIdToIdx.frostfire_fault];
    expect(frostfire.paths.map((path) => path.lengthMilli)).toEqual([26000, 25000, 26000]);
    expect(frostfire.meleeCellSet.size).toBe(68);
    expect(frostfire.mechanicCellSets.frostfire_fault.size).toBe(8);
    expect(frostfire.cfg.mechanics[0]).toMatchObject({
      unitAttackSpeedPermyriad: 9800,
      cellUnitAttackSpeedPermyriad: 10400,
      unitDamagePerSecond: 12,
      enemyMaxHpDamagePermyriadPerSecond: 50,
      allEnemySpeedPermyriad: 9800,
      cellEnemySpeedPermyriad: 10400,
    });
    const rubblemist = DATA.maps[DATA.mapIdToIdx.rubblemist_plateau];
    expect(rubblemist.paths.map((path) => path.lengthMilli)).toEqual([26000, 26000, 25000]);
    expect(rubblemist.meleeCellSet.size).toBe(67);
    expect(rubblemist.mechanicCellSets.rubblemist_resonance.size).toBe(8);
    expect(rubblemist.cfg.mechanics[0]).toMatchObject({
      highGroundUnitAttackSpeedPermyriad: 9600,
      highGroundUnitAtkPermyriad: 9600,
      flyingEnemyAttackSpeedPermyriad: 9600,
      flyingEnemyAtkPermyriad: 9600,
      groundUnitAtkPermyriad: 10400,
      groundUnitDefPermyriad: 10400,
      groundEnemyAtkPermyriad: 10400,
      groundEnemyDefPermyriad: 10400,
      cellUnitDefPermyriad: 10400,
      cellEnemyDefPermyriad: 10400,
    });
    const thundervoid = DATA.maps[DATA.mapIdToIdx.thundervoid_gate];
    expect(thundervoid.paths.map((path) => path.lengthMilli)).toEqual([26000, 27000, 18000, 18000]);
    expect(thundervoid.meleeCellSet.size).toBe(59);
    expect(thundervoid.mechanicCellSets.thundervoid_overload.size).toBe(9);
  });

  it('角色等级上限为 10，且仅在 5/10 级扩展范围', () => {
    expect(ACTIVE_SKILL_MAX_LEVEL).toBe(10);
    expect(ACTIVE_SKILLS.every((skill) => skill.upgradeCosts.length === 9)).toBe(true);
    const vanguardIdx = DATA.unitIdToIdx.vanguard;
    const levels = DATA.unitRangeLevelSets[vanguardIdx];
    for (let dir = 0; dir < 4; dir += 1) {
      expect(levels[1][dir]).toEqual(levels[0][dir]);
      expect(levels[2][dir]).toEqual(levels[0][dir]);
      expect(levels[3][dir]).toEqual(levels[0][dir]);
      expect(levels[4][dir].size).toBeGreaterThan(levels[3][dir].size);
      expect(levels[5][dir]).toEqual(levels[4][dir]);
      expect(levels[8][dir]).toEqual(levels[4][dir]);
      expect(levels[9][dir].size).toBeGreaterThan(levels[8][dir].size);
    }
  });

  it('普通角色四个朝向都不会向身后扩展，治疗与辅助保持对称范围', () => {
    const vanguard = DATA.unitRangeLevelSets[DATA.unitIdToIdx.vanguard];
    const isBehind = (key: number, dir: number): boolean => {
      const row = Math.round(key / 100);
      const col = key - row * 100;
      return dir === 0 ? col < 0 : dir === 1 ? row < 0 : dir === 2 ? col > 0 : row > 0;
    };
    for (let dir = 0; dir < 4; dir += 1) {
      expect([...vanguard[4][dir]].some((key) => isBehind(key, dir))).toBe(false);
      expect([...vanguard[9][dir]].some((key) => isBehind(key, dir))).toBe(false);
    }
    for (const id of ['medic', 'sunpriest']) {
      const level5 = DATA.unitRangeLevelSets[DATA.unitIdToIdx[id]][4][0];
      expect([...level5].some((key) => key - Math.round(key / 100) * 100 < 0)).toBe(true);
    }
    for (const id of ['koi', 'banner', 'engineer']) {
      const level5 = DATA.auraLevelSets[DATA.unitIdToIdx[id]][4];
      expect([...level5].some((key) => key - Math.round(key / 100) * 100 < 0)).toBe(true);
    }
  });
});

describe('lucky-td engine basics', () => {
  it('同 seed 同操作完全确定', () => {
    const a = initState('determinism-check', 'training_field', TRAINING_SQUAD);
    const b = initState('determinism-check', 'training_field', TRAINING_SQUAD);
    for (let i = 0; i < 600; i += 1) {
      tick(a);
      tick(b);
    }
    expect(hashState(a)).toBe(hashState(b));
  });

  it('波次刷怪由种子决定且不同种子会变化', () => {
    const a = initState('wave-random-a', 'training_field', TRAINING_SQUAD);
    const b = initState('wave-random-a', 'training_field', TRAINING_SQUAD);
    const c = initState('wave-random-c', 'training_field', TRAINING_SQUAD);
    for (const state of [a, b, c]) {
      while (state.phase === 0) {
        tick(state);
      }
    }
    expect(a.waveEvents.length).toBeGreaterThan(0);
    expect(a.waveEvents).toEqual(b.waveEvents);
    expect(a.waveEvents).not.toEqual(c.waveEvents);
  });

  it('部署校验：职业与格子类型必须匹配', () => {
    const state = initState('deploy-check', 'training_field', TRAINING_SQUAD);
    const vanguardIdx = DATA.unitIdToIdx.vanguard;
    const archerIdx = DATA.unitIdToIdx.archer;
    expect(applyAction(state, { frame: 0, seq: 0, type: 'deploy', unit: vanguardIdx, row: 0, col: 3, dir: 0 }).ok).toBe(false);
    expect(applyAction(state, { frame: 0, seq: 1, type: 'deploy', unit: archerIdx, row: 1, col: 5, dir: 0 }).ok).toBe(false);
    const okDeploy = applyAction(state, { frame: 0, seq: 2, type: 'deploy', unit: vanguardIdx, row: 1, col: 5, dir: 0 });
    expect(okDeploy.ok).toBe(true);
    expect(state.costMilli).toBe(DATA.config.engine.initialCostMilli - DATA.config.units[vanguardIdx].cost * 1000);
    expect(applyAction(state, { frame: 0, seq: 3, type: 'deploy', unit: vanguardIdx, row: 1, col: 5, dir: 0 }).ok).toBe(false);
  });

  it('部署校验：朝向必须为 0..3 整数', () => {
    const state = initState('dir-check', 'training_field', TRAINING_SQUAD);
    const vanguardIdx = DATA.unitIdToIdx.vanguard;
    expect(applyAction(state, { frame: 0, seq: 0, type: 'deploy', unit: vanguardIdx, row: 1, col: 5 }).ok).toBe(false);
    expect(applyAction(state, { frame: 0, seq: 1, type: 'deploy', unit: vanguardIdx, row: 1, col: 5, dir: 4 }).ok).toBe(false);
    expect(applyAction(state, { frame: 0, seq: 2, type: 'deploy', unit: vanguardIdx, row: 1, col: 5, dir: -1 }).ok).toBe(false);
    expect(applyAction(state, { frame: 0, seq: 3, type: 'deploy', unit: vanguardIdx, row: 1, col: 5, dir: 1.5 }).ok).toBe(false);
    const okDeploy = applyAction(state, { frame: 0, seq: 4, type: 'deploy', unit: vanguardIdx, row: 1, col: 5, dir: 3 });
    expect(okDeploy.ok).toBe(true);
    expect(state.units[0].dir).toBe(3);
  });

  it('模板顺时针旋转四向正确（非对称模板防符号反）', () => {
    expect(rotateOffset(0, 1, 0)).toEqual([0, 1]);
    expect(rotateOffset(0, 1, 1)).toEqual([1, 0]);
    expect(rotateOffset(0, 1, 2)).toEqual([0, -1]);
    expect(rotateOffset(0, 1, 3)).toEqual([-1, 0]);
    expect(rotateOffset(-1, 2, 0)).toEqual([-1, 2]);
    expect(rotateOffset(-1, 2, 1)).toEqual([2, 1]);
    expect(rotateOffset(-1, 2, 2)).toEqual([1, -2]);
    expect(rotateOffset(-1, 2, 3)).toEqual([-2, -1]);
  });

  it('replay 拒绝乱序操作', () => {
    const out = replay({
      seed: 'order-check',
      mapId: 'training_field',
      squad: ['vanguard'],
      actions: [
        { frame: 5, seq: 2, type: 'deploy', unit: 0, row: 1, col: 5, dir: 0 },
        { frame: 5, seq: 1, type: 'retreat', unitId: 1 },
      ],
    });
    expect(out.ok).toBe(false);
  });

  it('主动技能支持升级、释放与冷却递减', () => {
    const state = initState('active-skill-check', 'training_field', TRAINING_SQUAD);
    const vanguardIdx = DATA.unitIdToIdx.vanguard;
    expect(applyAction(state, { frame: 0, seq: 0, type: 'deploy', unit: vanguardIdx, row: 1, col: 5, dir: 0 }).ok).toBe(true);
    const unitId = state.units[0].id;
    const afterDeployCost = state.costMilli;

    expect(state.activeSkillCooldown[vanguardIdx]).toBe(720);
    expect(applyAction(state, { frame: 0, seq: 1, type: 'skill', unitId }).ok).toBe(false);
    expect(state.costMilli).toBe(afterDeployCost);

    tick(state);
    expect(state.activeSkillCooldown[vanguardIdx]).toBe(719);
    for (let i = 0; i < 719; i += 1) {
      tick(state);
    }
    expect(state.activeSkillCooldown[vanguardIdx]).toBe(0);

    const beforeFirstSkillCost = state.costMilli;
    expect(applyAction(state, { frame: state.frame, seq: 2, type: 'skill', unitId }).ok).toBe(true);
    expect(state.costMilli).toBe(beforeFirstSkillCost + 6000);
    expect(state.activeSkillCooldown[vanguardIdx]).toBe(720);
    expect(applyAction(state, { frame: state.frame, seq: 3, type: 'skill', unitId }).ok).toBe(false);
    const maxHpBeforeUpgrade = state.units[0].maxHp;
    const rangeSizeBeforeUpgrade = DATA.unitRangeLevelSets[vanguardIdx][0][0].size;
    const beforeUpgradeCost = state.costMilli;
    const hpBeforeUpgrade = state.units[0].hp;
    expect(applyAction(state, { frame: state.frame, seq: 4, type: 'skillUpgrade', unitId }).ok).toBe(true);
    expect(state.activeSkillLevels[vanguardIdx]).toBe(2);
    expect(state.costMilli).toBe(beforeUpgradeCost - 20000);
    expect(state.units[0].maxHp).toBeGreaterThan(maxHpBeforeUpgrade);
    expect(state.units[0].hp).toBe(hpBeforeUpgrade + state.units[0].maxHp - maxHpBeforeUpgrade);
    expect(DATA.unitRangeLevelSets[vanguardIdx][1][0].size).toBe(rangeSizeBeforeUpgrade);

    for (let i = 0; i < 720; i += 1) {
      tick(state);
    }
    expect(state.activeSkillCooldown[vanguardIdx]).toBe(0);
    const beforeSkillCost = state.costMilli;
    expect(applyAction(state, { frame: state.frame, seq: 5, type: 'skill', unitId }).ok).toBe(true);
    expect(state.costMilli).toBe(Math.min(DATA.config.engine.costMaxMilli, beforeSkillCost + 6800));
    expect(state.activeSkillCooldown[vanguardIdx]).toBe(activeSkillCooldownFor(vanguardIdx, state.activeSkillLevels[vanguardIdx]));
  });
});

describe('lucky-td golden vectors', () => {
  it('golden.json 与当前引擎输出一致', () => {
    const { stored, fresh } = loadOrUpdate('golden.json', buildGoldenVectors);
    expect(stored).toEqual(JSON.parse(JSON.stringify(fresh)));
  });

  it('replay 重放黄金对局得到相同终局', () => {
    for (const vector of buildGoldenVectors()) {
      const out = replay({ seed: vector.seed, mapId: vector.mapId, squad: vector.squad, actions: vector.actions });
      expect(out.ok, `${vector.name}: ${out.error}`).toBe(true);
      expect(hashState(out.state!), vector.name).toBe(vector.expect.finalHash);
      expect(out.result!.score, vector.name).toBe(vector.expect.score);
      expect(out.state!.waveHashes, vector.name).toEqual(vector.expect.waveHashes);
    }
  });
});

describe('lucky-td fuzz vectors', () => {
  it('fuzz.json 与当前引擎输出一致（200 局）', () => {
    const { stored, fresh } = loadOrUpdate('fuzz.json', buildFuzzVectors);
    expect(stored.length).toBe(FUZZ_COUNT);
    expect(stored).toEqual(JSON.parse(JSON.stringify(fresh)));
  });
});
