// M4 真实对账·阶段 2：读取 Go phase1 创建的会话（服务器随机 seed），用 TS 引擎按
// 锚点策略打到终局，产出 actions / 每波 checkpoint / 终局结果，交给 Go phase3 走
// HTTP checkpoint/submit 与后端重放对账。无 LUCKYTD_RECONCILE_DIR 时整体跳过。
// 用法见 backend/internal/httpserver/luckytd_reconcile_integration_test.go 头注释。

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getEngineData } from '../engine/data';
import { applyAction, finalize, hashState, initState, tick } from '../engine/engine';
import type { GameAction, GameState } from '../engine/types';
import { ANCHORS, KOI_PLAN } from './anchor-plans';
import type { DeployStep } from './anchor-plans';

const RECONCILE_DIR = process.env.LUCKYTD_RECONCILE_DIR ?? '';
const DATA = getEngineData();

interface SessionEntry {
  index: number;
  userId: number;
  sessionId: string;
  seed: string;
  mapId: string;
  squad: string[];
  planKey: string;
}

interface CheckpointEntry {
  waveIndex: number;
  frame: number;
  stateHash: number;
  actionCount: number;
}

interface GameEntry extends SessionEntry {
  actions: GameAction[];
  checkpoints: CheckpointEntry[];
  finalFrame: number;
  score: number;
  status: number;
  wavesCleared: number;
  finalHash: number;
}

/** 计划键 → 锚点站位（与 Go 侧 reconcilePlanFor 的 planKey 对应；单源见 anchor-plans.ts）。 */
const PLANS: Record<string, DeployStep[]> = {
  training: ANCHORS.training_field.plan,
  brook: ANCHORS.brook_ford.plan,
  starlamp: ANCHORS.starlamp_outpost.plan,
  frostfire: ANCHORS.frostfire_fault.plan,
  rubblemist: ANCHORS.rubblemist_plateau.plan,
  thundervoid: ANCHORS.thundervoid_gate.plan,
  koi: KOI_PLAN,
};

/** 与黄金向量 blessPrefer 一致：远程攻击 > 近战生命 > 回费 > 生命 > 立即费用 > 削弱。 */
function pickBlessing(options: number[]): number {
  for (const pref of [2, 1, 0, 3, 5, 4]) {
    if (options.includes(pref)) {
      return pref;
    }
  }
  return options[0];
}

function emitPlanDeploy(state: GameState, plan: DeployStep[]): Omit<GameAction, 'frame' | 'seq'> | null {
  for (const step of plan) {
    const typeIdx = DATA.unitIdToIdx[step.unit];
    if (typeIdx === undefined || !state.squad.includes(typeIdx)) {
      continue;
    }
    if (state.units.some((unit) => unit.typeIdx === typeIdx)) {
      continue;
    }
    if (state.redeployCooldown[typeIdx] > 0) {
      continue;
    }
    return { type: 'deploy', unit: typeIdx, row: step.row, col: step.col, dir: step.dir };
  }
  return null;
}

function playWithCheckpoints(entry: SessionEntry): GameEntry {
  const plan = PLANS[entry.planKey];
  if (!plan) {
    throw new Error(`unknown planKey: ${entry.planKey}`);
  }
  const state = initState(entry.seed, entry.mapId, entry.squad);
  const actions: GameAction[] = [];
  const checkpoints: CheckpointEntry[] = [];
  let seq = 0;
  let guard = 0;
  while (state.status === 0) {
    guard += 1;
    if (guard > 200000) {
      throw new Error(`game ${entry.index}: exceeded safety guard`);
    }
    const partial = emitPlanDeploy(state, plan);
    if (partial) {
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
        blessing: pickBlessing(state.pendingBlessing.options),
      };
      const result = applyAction(state, full);
      if (!result.ok) {
        throw new Error(`game ${entry.index}: bless rejected: ${result.message}`);
      }
      actions.push(full);
      seq += 1;
      continue;
    }
    const clearedBefore = state.waveHashes.length;
    tick(state);
    if (state.waveHashes.length > clearedBefore) {
      checkpoints.push({
        waveIndex: state.waveHashes.length,
        frame: state.frame,
        stateHash: state.waveHashes[state.waveHashes.length - 1],
        actionCount: actions.length,
      });
    }
  }
  const result = finalize(state);
  return {
    ...entry,
    actions,
    checkpoints,
    finalFrame: result.frames,
    score: result.score,
    status: result.status,
    wavesCleared: result.wavesCleared,
    finalHash: hashState(state),
  };
}

describe.skipIf(!RECONCILE_DIR)('lucky-td M4 reconcile phase2 (TS play)', () => {
  it('plays every phase1 session to terminal and writes games.json', () => {
    const sessions = JSON.parse(readFileSync(join(RECONCILE_DIR, 'sessions.json'), 'utf8')) as SessionEntry[];
    expect(sessions.length).toBeGreaterThan(0);
    const games = sessions.map(playWithCheckpoints);
    for (const game of games) {
      expect(game.finalFrame).toBeGreaterThan(0);
      expect(game.status === 1 || game.status === 2).toBe(true);
    }
    writeFileSync(join(RECONCILE_DIR, 'games.json'), JSON.stringify(games));
    const wins = games.filter((game) => game.status === 1);
    const scores = games.map((game) => game.score);
    console.log(
      `[reconcile-phase2] games=${games.length} wins=${wins.length} ` +
        `scoreMin=${Math.min(...scores)} scoreMax=${Math.max(...scores)} ` +
        `winScores=${wins.map((game) => game.score).join(',')}`,
    );
  });
});
