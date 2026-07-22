import { describe, expect, it } from 'vitest';
import {
  clearPendingPianoTilesSubmission,
  isPianoCheckpointRetryPrefix,
  PIANO_TILES_PENDING_SUBMISSION_KEY,
  readPendingPianoTilesSubmission,
  resolvePianoHoldBonus,
  savePendingPianoTilesSubmission,
  type PersistedPianoTilesSubmission,
} from '@/lib/piano-tiles/session';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

const sample: PersistedPianoTilesSubmission = {
  version: 1,
  createdAt: 1_700_000_000_000,
  mode: 'classic',
  selected: {
    id: 'song-1',
    title: '测试曲目',
    artist: '测试作者',
    bpm: 120,
    durationMs: 120_000,
    noteCount: 80,
    stars: 3,
    checksum: 'abc123',
  },
  result: {
    mode: 'classic',
    status: 'failed',
    score: 4,
    tilesHit: 3,
    crowns: 0,
    laps: 0,
    playedMs: 2_000,
    totalNotes: 80,
  },
  payload: {
    sessionId: 'session-1',
    eventOffset: 2,
    result: {
      status: 'failed',
      score: 4,
      tilesHit: 3,
      crowns: 0,
      laps: 0,
      playedMs: 2_000,
    },
    events: [
      { t: 100, lane: 0, j: 'h', b: 0 },
      { t: 500, lane: 1, j: 'h', b: 3 },
      { t: 2_000, lane: 2, j: 'm', b: 0 },
    ],
  },
};

describe('钢琴块终局提交包', () => {
  it('空 heartbeat 重试不会阻塞后来产生的真实事件', () => {
    const first = { t: 100, lane: 0, j: 'h', b: 0 } as const;
    const second = { t: 200, lane: 1, j: 'h', b: 0 } as const;
    const pending = [first, second];

    expect(isPianoCheckpointRetryPrefix([], pending)).toBe(false);
    expect(isPianoCheckpointRetryPrefix([first], pending)).toBe(true);
    expect(isPianoCheckpointRetryPrefix([{ ...first }], pending)).toBe(false);
  });

  it('长按自动划满后 release 返回 0 时保留引擎实际奖励', () => {
    expect(resolvePianoHoldBonus(0, 3)).toBe(3);
    expect(resolvePianoHoldBonus(2, 2)).toBe(2);
    expect(resolvePianoHoldBonus(undefined, -1)).toBe(0);
    expect(resolvePianoHoldBonus(9, 9)).toBe(3);
  });

  it('可以保存并恢复增量提交包', () => {
    const storage = createStorage();
    expect(savePendingPianoTilesSubmission(storage, sample)).toBe(true);
    expect(readPendingPianoTilesSubmission(storage)).toEqual(sample);
  });

  it('拒绝普通块伪造长按奖励或损坏事件', () => {
    const storage = createStorage();
    storage.setItem(
      PIANO_TILES_PENDING_SUBMISSION_KEY,
      JSON.stringify({
        ...sample,
        payload: {
          ...sample.payload,
          events: [{ t: 100, lane: 0, j: 'm', b: 3 }],
        },
      }),
    );
    expect(readPendingPianoTilesSubmission(storage)).toBeNull();
  });

  it('清理成功结算后的提交包', () => {
    const storage = createStorage();
    savePendingPianoTilesSubmission(storage, sample);
    clearPendingPianoTilesSubmission(storage);
    expect(readPendingPianoTilesSubmission(storage)).toBeNull();
  });
});
