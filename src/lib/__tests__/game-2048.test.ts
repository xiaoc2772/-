import { describe, expect, it } from 'vitest';
import {
  calculateGame2048PointReward,
  GAME2048_WIN_SCORE,
  isGame2048WinningScore,
  isValidGame2048Tile,
  moveGame2048Grid,
  simulateGame2048,
  type Game2048Direction,
} from '../game-2048-engine';

describe('game-2048-engine', () => {
  it('按传统 2048 规则向左合并，且同一方块不会连续合并两次', () => {
    const result = moveGame2048Grid([
      [2, 2, 2, 2, 2],
      [2, 2, 4, 0, 4],
      [4, 0, 4, 4, 4],
      [0, 0, 0, 0, 0],
      [8, 8, 8, 0, 8],
    ], 'left');

    expect(result.moved).toBe(true);
    expect(result.grid[0]).toEqual([4, 4, 2, 0, 0]);
    expect(result.grid[1]).toEqual([4, 8, 0, 0, 0]);
    expect(result.grid[2]).toEqual([8, 8, 0, 0, 0]);
    expect(result.grid[4]).toEqual([16, 16, 0, 0, 0]);
    expect(result.scoreDelta).toBe(68);
  });

  it('使用种子和操作序列得到稳定结算结果', () => {
    const moves: Game2048Direction[] = ['left', 'up', 'right', 'down', 'left'];
    const first = simulateGame2048('fixed-seed', moves);
    const second = simulateGame2048('fixed-seed', moves);

    expect(first).toEqual(second);
    expect(first.ok && first.movesSubmitted).toBe(moves.length);
  });

  it('按得分和最高方块计算积分', () => {
    expect(calculateGame2048PointReward(0, 2)).toBe(0);
    expect(calculateGame2048PointReward(127, 128)).toBe(0);
    expect(calculateGame2048PointReward(128, 128)).toBe(1);
    expect(calculateGame2048PointReward(2048, 2048)).toBe(96);
    expect(calculateGame2048PointReward(8192, 8192)).toBe(324);
    expect(calculateGame2048PointReward(999999, 4096)).toBe(7952);
  });

  it('统一使用 20000 分胜利线', () => {
    expect(GAME2048_WIN_SCORE).toBe(20_000);
    expect(isGame2048WinningScore(19_999)).toBe(false);
    expect(isGame2048WinningScore(20_000)).toBe(true);
    expect(isGame2048WinningScore(20_001)).toBe(true);
  });

  it('允许长局中出现百万级高方块', () => {
    expect(isValidGame2048Tile(1_048_576)).toBe(true);
    expect(isValidGame2048Tile(1_073_741_824)).toBe(true);
    expect(isValidGame2048Tile(1_073_741_825)).toBe(false);
    expect(isValidGame2048Tile(3)).toBe(false);
  });
});
