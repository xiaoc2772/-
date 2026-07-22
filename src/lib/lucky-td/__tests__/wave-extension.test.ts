// 幸运塔防 30 波平衡回归：锁定舒缓后的完整生命曲线，并验证成长连续性。

import { describe, expect, it } from 'vitest';
import { getEngineData } from '../engine/data';
import { applyAction, initState, tick } from '../engine/engine';
import type { GameState } from '../engine/types';

const DATA = getEngineData();

const BALANCED_HP_CURVES: Record<string, number[]> = {
  training_field: [4500, 4900, 5340, 5820, 6340, 6900, 7500, 8140, 8820, 9540, 10300, 11100, 11940, 12820, 13740, 14700, 15700, 16740, 17820, 18940, 20100, 21300, 22540, 23820, 25140, 26500, 27900, 29340, 30820, 32340],
  brook_ford: [5200, 5650, 6140, 6670, 7240, 7850, 8500, 9190, 9920, 10690, 11500, 12350, 13240, 14170, 15140, 16150, 17200, 18290, 19420, 20590, 21800, 23050, 24340, 25670, 27040, 28450, 29900, 31390, 32920, 34490],
  starlamp_outpost: [5800, 6300, 6840, 7420, 8040, 8700, 9400, 10140, 10920, 11740, 12600, 13500, 14440, 15420, 16440, 17500, 18600, 19740, 20920, 22140, 23400, 24700, 26040, 27420, 28840, 30300, 31800, 33340, 34920, 36540],
  frostfire_fault: [7500, 8150, 8840, 9570, 10340, 11150, 12000, 12890, 13820, 14790, 15800, 16850, 17940, 19070, 20240, 21450, 22700, 23990, 25320, 26690, 28100, 29550, 31040, 32570, 34140, 35750, 37400, 39090, 40820, 42590],
  rubblemist_plateau: [6800, 7350, 7940, 8570, 9240, 9950, 10700, 11490, 12320, 13190, 14100, 15050, 16040, 17070, 18140, 19250, 20400, 21590, 22820, 24090, 25400, 26750, 28140, 29570, 31040, 32550, 34100, 35690, 37320, 38990],
  thundervoid_gate: [7600, 8250, 8940, 9670, 10440, 11250, 12100, 12990, 13920, 14890, 15900, 16950, 18040, 19170, 20340, 21550, 22800, 24090, 25420, 26790, 28200, 29650, 31140, 32670, 34240, 35850, 37500, 39190, 40920, 42690],
};

function enterWave(state: GameState, waveIndex: number): void {
  state.waveIndex = waveIndex;
  state.phase = 0;
  state.intermissionRemaining = 1;
  tick(state);
}

function eventThreat(state: GameState): number {
  const costs: Record<string, number> = { boss: 18, golem: 6, puppet: 5, shooter: 5, drone: 4, wolf: 2 };
  return state.waveEvents.reduce((total, event) => {
    const enemy = DATA.config.enemies[event[1]];
    return total + (costs[enemy.id] ?? 1) * event[3];
  }, 0);
}

describe('lucky-td 30 波扩展', () => {
  it('六张地图均为 30 波，且使用平衡后的完整 HP 曲线', () => {
    for (const map of DATA.config.maps) {
      expect(map.waves, map.id).toHaveLength(30);
      expect(map.waveHpPermyriad, map.id).toHaveLength(30);
      expect(map.waveHpPermyriad, map.id).toEqual(BALANCED_HP_CURVES[map.id]);
    }
  });

  it('每波 HP 增量仅增加 40，避免后半程指数式膨胀', () => {
    for (const map of DATA.config.maps) {
      for (let index = 2; index < 30; index += 1) {
        const currentIncrement = map.waveHpPermyriad[index] - map.waveHpPermyriad[index - 1];
        const previousIncrement = map.waveHpPermyriad[index - 1] - map.waveHpPermyriad[index - 2];
        expect(currentIncrement, `${map.id} wave ${index + 1}`).toBe(previousIncrement + 40);
      }
    }
  });

  it('第 16 波平均出怪威胁高于第 15 波，不出现扩容后的预算断崖', () => {
    let wave15Threat = 0;
    let wave16Threat = 0;
    for (let seedIndex = 0; seedIndex < 64; seedIndex += 1) {
      const seed = `wave-extension-threat-${seedIndex}`;
      const wave15 = initState(seed, 'training_field', ['vanguard']);
      const wave16 = initState(seed, 'training_field', ['vanguard']);
      enterWave(wave15, 15);
      enterWave(wave16, 16);
      wave15Threat += eventThreat(wave15);
      wave16Threat += eventThreat(wave16);
    }
    expect(wave16Threat).toBeGreaterThan(wave15Threat);
  });

  it('清除场上敌人后可以推进至第 30 波并正常判定胜利', () => {
    const state = initState('wave-extension-terminal', 'training_field', ['vanguard']);
    let seq = 0;
    let guard = 0;
    while (state.status === 0) {
      guard += 1;
      expect(guard).toBeLessThan(DATA.config.engine.maxFrames + 1000);
      if (state.pendingBlessing) {
        const result = applyAction(state, {
          frame: state.frame,
          seq,
          type: 'bless',
          blessing: state.pendingBlessing.options[0],
        });
        expect(result.ok).toBe(true);
        seq += 1;
        continue;
      }
      tick(state);
      for (const enemy of state.enemies) {
        enemy.hp = 0;
      }
    }
    expect(state.status).toBe(1);
    expect(state.waveHashes).toHaveLength(30);
    expect(state.waveIndex).toBe(30);
  });
});
