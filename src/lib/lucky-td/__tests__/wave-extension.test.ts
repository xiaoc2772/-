// 幸运塔防 30 波扩展回归：锁定旧 15 波曲线，并验证后半程持续增压。

import { describe, expect, it } from 'vitest';
import { getEngineData } from '../engine/data';
import { applyAction, initState, tick } from '../engine/engine';
import type { GameState } from '../engine/types';

const DATA = getEngineData();

const LEGACY_HP_CURVES: Record<string, number[]> = {
  training_field: [5200, 5700, 6300, 7000, 7800, 8700, 9700, 10800, 12000, 13300, 14700, 16200, 17800, 19500, 21300],
  brook_ford: [6000, 6600, 7300, 8100, 9000, 10000, 11100, 12300, 13600, 15000, 16500, 18100, 19800, 21600, 23500],
  starlamp_outpost: [6800, 7500, 8300, 9200, 10200, 11300, 12500, 13800, 15200, 16700, 18300, 20000, 21800, 23700, 25700],
  frostfire_fault: [9750, 10750, 11900, 13200, 14600, 16100, 17700, 19400, 21200, 23100, 25100, 27200, 29400, 31700, 34100],
  rubblemist_plateau: [8000, 8800, 9700, 10700, 11800, 13000, 14300, 15700, 17200, 18800, 20500, 22300, 24200, 26200, 28300],
  thundervoid_gate: [9400, 10400, 11500, 12700, 14000, 15400, 16900, 18500, 20200, 22000, 23900, 25900, 28000, 30200, 32500],
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
  it('六张地图均为 30 波，且第 1~15 波 HP 曲线完全不变', () => {
    for (const map of DATA.config.maps) {
      expect(map.waves, map.id).toHaveLength(30);
      expect(map.waveHpPermyriad, map.id).toHaveLength(30);
      expect(map.waveHpPermyriad.slice(0, 15), map.id).toEqual(LEGACY_HP_CURVES[map.id]);
    }
  });

  it('第 16~30 波延续每波增量再增加 100 的原有末段曲线', () => {
    for (const map of DATA.config.maps) {
      for (let index = 15; index < 30; index += 1) {
        const currentIncrement = map.waveHpPermyriad[index] - map.waveHpPermyriad[index - 1];
        const previousIncrement = map.waveHpPermyriad[index - 1] - map.waveHpPermyriad[index - 2];
        expect(currentIncrement, `${map.id} wave ${index + 1}`).toBe(previousIncrement + 100);
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
