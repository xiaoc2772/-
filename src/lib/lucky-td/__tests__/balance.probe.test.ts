// 幸运塔防 平衡探针（非 CI 断言门）：LUCKYTD_PROBE=1 npx vitest run src/lib/lucky-td/__tests__/balance.probe.test.ts
// 输出逐波 lives/费用曲线与四类局验收：锚点全胜剩1-2命 / 各图 idle 败局≥630帧 / 随意站位胜率≈0 / 去medic应败。
// 调参只动 config 与 anchor-plans；定稿后 GOLDEN_UPDATE=1 重生成向量并同步 Go embed。

import { describe, expect, it } from 'vitest';
import { activeSkillUpgradeCost, ACTIVE_SKILL_MAX_LEVEL } from '../engine/active-skills';
import { getEngineData } from '../engine/data';
import { applyAction, finalize, initState, tick } from '../engine/engine';
import { fnv1a32String, xorshift32 } from '../engine/rng';
import type { GameAction, GameState } from '../engine/types';
import { ANCHORS } from './anchor-plans';
import type { DeployStep } from './anchor-plans';

const DATA = getEngineData();
const PROBE = process.env.LUCKYTD_PROBE === '1';
const DIAG = process.env.LUCKYTD_DIAG === '1';

const ANCHOR_TARGETS: Record<string, { minWins: number; maxWins: number }> = {
  training_field: { minWins: 9, maxWins: 10 },
  brook_ford: { minWins: 8, maxWins: 10 },
  starlamp_outpost: { minWins: 5, maxWins: 8 },
  frostfire_fault: { minWins: 3, maxWins: 5 },
  rubblemist_plateau: { minWins: 2, maxWins: 4 },
  thundervoid_gate: { minWins: 1, maxWins: 3 },
};

type EmitFn = (action: Omit<GameAction, 'frame' | 'seq'>) => void;
type Policy = (state: GameState, emit: EmitFn) => void;

interface WavePoint {
  wave: number;
  frame: number;
  lives: number;
  cost: number;
}

interface ProbeRun {
  status: number;
  lives: number;
  frames: number;
  wavesCleared: number;
  waveLog: WavePoint[];
  enemySummary?: string;
}

function summarizeEnemies(state: GameState): string {
  if (!DIAG || state.enemies.length === 0) {
    return '';
  }
  const map = DATA.maps[state.mapIdx];
  const byType = new Map<string, { count: number; hp: number; shield: number; progress: number; blocked: number }>();
  for (const enemy of state.enemies) {
    const id = DATA.config.enemies[enemy.typeIdx]?.id ?? `#${enemy.typeIdx}`;
    const path = map.paths[enemy.pathIdx];
    const remain = Math.max(0, path.lengthMilli - enemy.progress);
    const item = byType.get(id) ?? { count: 0, hp: 0, shield: 0, progress: 0, blocked: 0 };
    item.count += 1;
    item.hp += enemy.hp;
    item.shield += enemy.shield;
    item.progress += remain;
    if (enemy.blockedBy !== 0) {
      item.blocked += 1;
    }
    byType.set(id, item);
  }
  return [...byType.entries()]
    .sort((a, b) => b[1].hp + b[1].shield - (a[1].hp + a[1].shield))
    .map(([id, item]) => {
      const avgRemain = Math.floor(item.progress / Math.max(1, item.count));
      return `${id}×${item.count}(hp=${item.hp},shield=${item.shield},remain=${avgRemain},blocked=${item.blocked})`;
    })
    .join(' ');
}

function blessPrefer(options: number[]): number {
  for (const pref of [2, 1, 0, 3, 5, 4]) {
    if (options.includes(pref)) {
      return pref;
    }
  }
  return options[0];
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

const SKILL_PRIORITY = [
  'vanguard',
  'engineer',
  'koi',
  'banner',
  'sunpriest',
  'medic',
  'frostbinder',
  'venomwitch',
  'voidseer',
  'stormsniper',
  'archer',
  'caster',
  'artillery',
  'flameblade',
  'ranger',
  'phantom',
  'thornwarden',
  'defender',
];

const UPGRADE_PRIORITY = [
  'stormsniper',
  'venomwitch',
  'sunpriest',
  'ranger',
  'caster',
  'archer',
  'thornwarden',
  'defender',
  'vanguard',
  'flameblade',
  'voidseer',
  'frostbinder',
  'artillery',
  'engineer',
  'medic',
  'banner',
  'koi',
  'phantom',
];

function priorityOf(list: string[], typeIdx: number): number {
  const id = DATA.config.units[typeIdx]?.id ?? '';
  const idx = list.indexOf(id);
  return idx >= 0 ? idx : list.length;
}

function shouldUseSkill(state: GameState, unitId: number): boolean {
  const unit = state.units.find((candidate) => candidate.id === unitId);
  if (!unit || state.activeSkillCooldown[unit.typeIdx] > 0) {
    return false;
  }
  const id = DATA.config.units[unit.typeIdx]?.id ?? '';
  if (id === 'vanguard' || id === 'koi' || id === 'engineer' || id === 'banner') {
    return state.costMilli < 50000 || state.phase === 0;
  }
  if (id === 'medic' || id === 'sunpriest') {
    const level = state.activeSkillLevels[unit.typeIdx] ?? 1;
    return (id === 'sunpriest' && level >= 10 && state.lives <= 10) || state.lives <= 7 || state.units.some((ally) => ally.hp > 0 && ally.hp < ally.maxHp);
  }
  if (id === 'defender' || id === 'thornwarden') {
    return state.enemies.some((enemy) => enemy.hp > 0 && enemy.blockedBy === unit.id);
  }
  return state.phase === 1 && state.enemies.length > 0;
}

function combatPolicy(plan: DeployStep[]): Policy {
  return (state, emit) => {
    const orderedUnits = [...state.units]
      .filter((unit) => unit.hp > 0)
      .sort((a, b) => priorityOf(SKILL_PRIORITY, a.typeIdx) - priorityOf(SKILL_PRIORITY, b.typeIdx) || a.id - b.id);
    for (const unit of orderedUnits) {
      if (shouldUseSkill(state, unit.id)) {
        emit({ type: 'skill', unitId: unit.id });
      }
    }

    let allDeployed = true;
    for (const step of plan) {
      const typeIdx = DATA.unitIdToIdx[step.unit];
      if (!state.squad.includes(typeIdx) || state.units.some((unit) => unit.typeIdx === typeIdx)) {
        continue;
      }
      allDeployed = false;
      const cost = DATA.config.units[typeIdx].cost * 1000;
      if (state.redeployCooldown[typeIdx] === 0 && state.costMilli >= cost) {
        emit({ type: 'deploy', unit: typeIdx, row: step.row, col: step.col, dir: step.dir });
        break;
      }
    }

    if (!allDeployed) {
      return;
    }
    const upgradeUnits = [...state.units]
      .filter((unit) => unit.hp > 0)
      .sort((a, b) => priorityOf(UPGRADE_PRIORITY, a.typeIdx) - priorityOf(UPGRADE_PRIORITY, b.typeIdx) || a.id - b.id);
    for (const unit of upgradeUnits) {
      const level = state.activeSkillLevels[unit.typeIdx] ?? 1;
      if (level >= ACTIVE_SKILL_MAX_LEVEL) {
        continue;
      }
      const cost = activeSkillUpgradeCost(unit.typeIdx, level) * 1000;
      if (cost > 0 && state.costMilli >= cost + 6000) {
        emit({ type: 'skillUpgrade', unitId: unit.id });
        break;
      }
    }
  };
}

function runProbe(
  seed: string,
  mapId: string,
  squad: string[],
  policy: Policy,
  blessPick: (options: number[]) => number = blessPrefer,
): ProbeRun {
  const state = initState(seed, mapId, squad);
  let seq = 0;
  let guard = 0;
  let clearedSeen = 0;
  const waveLog: WavePoint[] = [];
  while (state.status === 0) {
    guard += 1;
    if (guard > 200000) {
      throw new Error(`probe ${seed} exceeded safety guard`);
    }
    const emitted: Omit<GameAction, 'frame' | 'seq'>[] = [];
    policy(state, (action) => emitted.push(action));
    for (const partial of emitted) {
      if (applyAction(state, { ...partial, frame: state.frame, seq }).ok) {
        seq += 1;
      }
    }
    if (state.pendingBlessing) {
      applyAction(state, { frame: state.frame, seq, type: 'bless', blessing: blessPick(state.pendingBlessing.options) });
      seq += 1;
      continue;
    }
    tick(state);
    if (state.waveHashes.length > clearedSeen) {
      clearedSeen = state.waveHashes.length;
      waveLog.push({ wave: clearedSeen, frame: state.frame, lives: state.lives, cost: Math.floor(state.costMilli / 1000) });
    }
  }
  const result = finalize(state);
  return {
    status: state.status,
    lives: state.lives,
    frames: state.frame,
    wavesCleared: result.wavesCleared,
    waveLog,
    enemySummary: summarizeEnemies(state),
  };
}

function fmtRun(run: ProbeRun): string {
  const tail = run.waveLog.map((w) => `w${w.wave}:${w.lives}命`).join(' ');
  const enemies = run.enemySummary ? ` | enemies ${run.enemySummary}` : '';
  return `status=${run.status} waves=${run.wavesCleared} lives=${run.lives} frames=${run.frames} | ${tail}${enemies}`;
}

describe.skipIf(process.env.LUCKYTD_SEEDSCAN !== '1')('lucky-td anchor seed scan', () => {
  it('扫描锚点胜局 seed（黄金向量选种用，胜局才覆盖 w12-15 深波内容）', () => {
    for (const mapId of ['frostfire_fault', 'rubblemist_plateau', 'thundervoid_gate']) {
      const anchor = ANCHORS[mapId];
      const wins: string[] = [];
      for (let n = 10; n < 40; n += 1) {
        const seed = `lucky-td-golden-${String(n).padStart(3, '0')}`;
        const run = runProbe(seed, mapId, anchor.squad, combatPolicy(anchor.plan));
        if (run.status === 1 && run.lives >= 1) {
          wins.push(`${seed}(lives=${run.lives})`);
        }
      }
      console.log(`[seedscan] ${mapId}: ${wins.join(' ')}`);
    }
  });
});

describe.skipIf(!PROBE)('lucky-td balance probe', () => {
  it('锚点局：每图 ×10 seed 有效胜率随难度递减', () => {
    const failures: string[] = [];
    for (const [mapId, anchor] of Object.entries(ANCHORS)) {
      const winLives: number[] = [];
      const target = ANCHOR_TARGETS[mapId];
      for (let s = 0; s < 10; s += 1) {
        const run = runProbe(`probe-anchor-${mapId}-${s}`, mapId, anchor.squad, combatPolicy(anchor.plan));
        const line = `[anchor] ${mapId} seed${s}: ${fmtRun(run)}`;
        console.log(line);
        if (run.status === 1 && run.lives >= 1) {
          winLives.push(run.lives);
        }
      }
      winLives.sort((a, b) => a - b);
      const median = winLives.length > 0 ? winLives[Math.floor(winLives.length / 2)] : 0;
      if (!target) {
        failures.push(`${mapId} 缺少锚点胜率目标`);
      } else if (winLives.length < target.minWins || winLives.length > target.maxWins) {
        failures.push(`${mapId} 有效胜局 ${winLives.length}/10 不在目标区间 ${target.minWins}-${target.maxWins}`);
      }
      console.log(`[anchor-sum] ${mapId}: 胜 ${winLives.length}/10, 中位剩命 ${median}, 分布 [${winLives.join(',')}]`);
    }
    expect(failures, `\n${failures.join('\n')}`).toEqual([]);
  }, 30000);

  it('空操作局：每图最快败局帧数 ≥ 630（服务端 minFinishDuration 下限依据）', () => {
    for (const map of DATA.config.maps) {
      const run = runProbe(`probe-idle-${map.id}`, map.id, ['vanguard'], () => {});
      console.log(`[idle] ${map.id}: frames=${run.frames} wavesCleared=${run.wavesCleared}`);
      expect(run.frames, map.id).toBeGreaterThanOrEqual(630);
    }
  });

  it('随意站位局：每图 ×20 seed 胜局 ≤1', () => {
    for (const map of DATA.config.maps) {
      const squad = ANCHORS[map.id].squad;
      let wins = 0;
      for (let s = 0; s < 20; s += 1) {
        const seed = `probe-random-${map.id}-${s}`;
        let bot = fnv1a32String(seed) || 1;
        const nextBot = () => {
          bot = xorshift32(bot);
          return bot;
        };
        const policy: Policy = (state, emit) => {
          if (nextBot() % 31 >= 2) {
            return;
          }
          emit({
            type: 'deploy',
            unit: state.squad[nextBot() % state.squad.length],
            row: nextBot() % map.rows,
            col: nextBot() % map.cols,
            dir: nextBot() % 4,
          });
        };
        const run = runProbe(seed, map.id, squad, policy, (options) => options[nextBot() % options.length]);
        if (run.status === 1) {
          wins += 1;
        }
      }
      console.log(`[random] ${map.id}: wins=${wins}/20`);
      expect(wins, map.id).toBeLessThanOrEqual(1);
    }
  });

  it('单变量削弱局：去掉 medic 应败北', () => {
    for (const [mapId, anchor] of Object.entries(ANCHORS)) {
      const plan = anchor.plan.filter((step) => step.unit !== 'medic' && step.unit !== 'sunpriest');
      const run = runProbe(`probe-weak-${mapId}`, mapId, anchor.squad, planPolicy(plan));
      console.log(`[weak] ${mapId}: ${fmtRun(run)}`);
      expect(run.status, `${mapId} 去掉治疗位仍能通关，难度不足`).toBe(2);
    }
  });
});
