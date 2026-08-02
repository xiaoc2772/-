import { describe, expect, it } from 'vitest';
import { HOLD_BONUS_MAX } from '@/lib/piano-tiles/engine';
import {
  clampPianoEventTime,
  clearActivePianoTilesSession,
  clearPendingPianoTilesSubmission,
  isPianoCheckpointRetryPrefix,
  PIANO_MIN_HIT_INTERVAL_MS,
  PIANO_TILES_ACTIVE_SESSION_KEY,
  PIANO_TILES_PENDING_SUBMISSION_KEY,
  readActivePianoTilesSession,
  readPendingPianoTilesSubmission,
  saveActivePianoTilesSession,
  savePendingPianoTilesSubmission,
  shouldCancelOwnedPianoTilesSession,
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
    score: 3,
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
      score: 3,
      tilesHit: 3,
      crowns: 0,
      laps: 0,
      playedMs: 2_000,
    },
    events: [
      { t: 100, lane: 0, j: 'h', b: 0 },
      { t: 500, lane: 1, j: 'h', b: 0 },
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

  it('事件时间钳制为单调不减（允许相等）', () => {
    expect(clampPianoEventTime(90, false, 100, -1)).toBe(100);
    expect(clampPianoEventTime(100, false, 100, -1)).toBe(100);
    expect(clampPianoEventTime(130, false, 100, -1)).toBe(130);
  });

  it('相邻命中至少间隔 PIANO_MIN_HIT_INTERVAL_MS，首个命中不受约束', () => {
    expect(clampPianoEventTime(101, true, 100, 100)).toBe(100 + PIANO_MIN_HIT_INTERVAL_MS);
    expect(clampPianoEventTime(200, true, 100, 100)).toBe(200);
    expect(clampPianoEventTime(3, true, 0, -1)).toBe(3);
  });

  it('非命中事件不受命中间隔约束，仅保持单调', () => {
    expect(clampPianoEventTime(101, false, 100, 100)).toBe(101);
    expect(clampPianoEventTime(50, false, 100, 100)).toBe(100);
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

  it('长按松手事件（r）随提交包恢复，非法奖励被拒绝', () => {
    const storage = createStorage();
    const withRelease: PersistedPianoTilesSubmission = {
      ...sample,
      payload: {
        ...sample.payload,
        events: [
          { t: 100, lane: 0, j: 'h', b: 0 },
          { t: 900, lane: 0, j: 'r', b: HOLD_BONUS_MAX },
          { t: 2_000, lane: 2, j: 'm', b: 0 },
        ],
      },
    };
    expect(savePendingPianoTilesSubmission(storage, withRelease)).toBe(true);
    expect(readPendingPianoTilesSubmission(storage)).toEqual(withRelease);

    // 松手奖励超出上限
    storage.setItem(
      PIANO_TILES_PENDING_SUBMISSION_KEY,
      JSON.stringify({
        ...sample,
        payload: {
          ...sample.payload,
          events: [{ t: 900, lane: 0, j: 'r', b: HOLD_BONUS_MAX + 1 }],
        },
      }),
    );
    expect(readPendingPianoTilesSubmission(storage)).toBeNull();

    // 命中事件不得携带奖励（奖励只能由松手事件上报）
    storage.setItem(
      PIANO_TILES_PENDING_SUBMISSION_KEY,
      JSON.stringify({
        ...sample,
        payload: {
          ...sample.payload,
          events: [{ t: 100, lane: 0, j: 'h', b: 1 }],
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

  it('只恢复当前标签页自己记录的活动会话', () => {
    const storage = createStorage();
    expect(saveActivePianoTilesSession(storage, 'session-1')).toBe(true);
    expect(readActivePianoTilesSession(storage)).toBe('session-1');
    storage.setItem(PIANO_TILES_ACTIVE_SESSION_KEY, '');
    expect(readActivePianoTilesSession(storage)).toBeNull();
    expect(saveActivePianoTilesSession(storage, 'x'.repeat(129))).toBe(false);
    saveActivePianoTilesSession(storage, 'session-2');
    clearActivePianoTilesSession(storage);
    expect(readActivePianoTilesSession(storage)).toBeNull();
  });

  it('不会把其他标签页的活动会话识别为自己的残留会话', () => {
    expect(shouldCancelOwnedPianoTilesSession('session-1', 'session-1')).toBe(true);
    expect(shouldCancelOwnedPianoTilesSession('session-1', 'session-2')).toBe(false);
    expect(shouldCancelOwnedPianoTilesSession(null, 'session-1')).toBe(false);
  });
});
