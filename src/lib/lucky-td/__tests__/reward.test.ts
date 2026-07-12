import { describe, expect, it } from 'vitest';
import { pointRewardForScore, squadBonusPermyriad } from '../constants';

describe('lucky-td squad reward bonus', () => {
  it('编队人数越少，积分倍率越高并带边界钳制', () => {
    expect(squadBonusPermyriad(9)).toBe(10000);
    expect(squadBonusPermyriad(6)).toBe(12400);
    expect(squadBonusPermyriad(1)).toBe(16400);
    expect(squadBonusPermyriad(0)).toBe(16400);
    expect(squadBonusPermyriad(12)).toBe(10000);

    expect(pointRewardForScore(100, 9)).toBe(100);
    expect(pointRewardForScore(100, 6)).toBe(124);
    expect(pointRewardForScore(100, 1)).toBe(164);
    expect(pointRewardForScore(-1, 1)).toBe(0);
  });
});
