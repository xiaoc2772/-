import type { ChartManifestEntry, PianoTilesMode } from './types';
import { HOLD_BONUS_MAX, type EngineResult } from './engine';

/** 钢琴块事件。长按松手（r）的 b 为进度奖励 0..HOLD_BONUS_MAX；其余判定 b 恒为 0。 */
export interface PianoTilesEvent {
  t: number;
  lane: number;
  j: 'h' | 'm' | 'w' | 'r';
  b: number;
}

export interface PianoTilesSubmitResult {
  status: EngineResult['status'];
  score: number;
  tilesHit: number;
  crowns: number;
  laps: number;
  playedMs: number;
}

export interface PianoTilesSubmitPayload {
  sessionId: string;
  eventOffset: number;
  result: PianoTilesSubmitResult;
  events: PianoTilesEvent[];
}

/**
 * 终局提交包只放在 sessionStorage 中，避免刷新页面时丢失已经结束但尚未
 * 被服务端确认的成绩。selected 一并保存，保证曲目清单尚未加载完成时也能
 * 直接渲染恢复后的结算卡片。
 */
export interface PersistedPianoTilesSubmission {
  version: 1;
  createdAt: number;
  mode: PianoTilesMode;
  selected: ChartManifestEntry;
  result: EngineResult;
  payload: PianoTilesSubmitPayload;
}

export const PIANO_TILES_PENDING_SUBMISSION_KEY = 'piano-tiles:pending-submission:v1';
/** 当前浏览器标签页自己创建的活动会话，避免另一标签页误取消对局。 */
export const PIANO_TILES_ACTIVE_SESSION_KEY = 'piano-tiles:active-session:v1';

function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

export function shouldCancelOwnedPianoTilesSession(
  ownedSessionId: string | null | undefined,
  activeSessionId: unknown,
): boolean {
  return isSessionId(ownedSessionId) && activeSessionId === ownedSessionId;
}

export function readActivePianoTilesSession(
  storage: Pick<Storage, 'getItem'> | null | undefined,
): string | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(PIANO_TILES_ACTIVE_SESSION_KEY);
    return isSessionId(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveActivePianoTilesSession(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  sessionId: string,
): boolean {
  if (!storage || !isSessionId(sessionId)) return false;
  try {
    storage.setItem(PIANO_TILES_ACTIVE_SESSION_KEY, sessionId);
    return true;
  } catch {
    return false;
  }
}

export function clearActivePianoTilesSession(
  storage: Pick<Storage, 'removeItem'> | null | undefined,
): void {
  try {
    storage?.removeItem(PIANO_TILES_ACTIVE_SESSION_KEY);
  } catch {
    // 忽略存储清理异常，不影响服务端会话状态。
  }
}

/**
 * 判断上一批 checkpoint 是否仍是当前待同步队列的非空前缀。
 * 空 heartbeat 不包含需要幂等保护的事件；若把它保留为 retry，后续真实事件
 * 会一直被这个空批次挡住，造成同步死锁。
 */
export function isPianoCheckpointRetryPrefix(
  retryEvents: readonly PianoTilesEvent[],
  pendingEvents: readonly PianoTilesEvent[],
): boolean {
  return (
    retryEvents.length > 0 &&
    retryEvents.length <= pendingEvents.length &&
    retryEvents.every((event, index) => pendingEvents[index] === event)
  );
}

/** 服务端相邻命中事件的最小间隔毫秒（backend MinHitIntervalMS）。 */
export const PIANO_MIN_HIT_INTERVAL_MS = 25;

/**
 * 事件时间钳制：保证事件时间单调不减，且相邻命中至少间隔 PIANO_MIN_HIT_INTERVAL_MS。
 * 多指快速点击可能在同一毫秒（取整后）产生两个命中，不钳制会被服务端
 * 以 hit_interval_too_short / event_time_not_monotonic 拒绝。
 * @param lastHitT 上一条命中事件的钳制后时间；尚无命中时为 -1。
 */
export function clampPianoEventTime(
  rawT: number,
  isHit: boolean,
  lastEventT: number,
  lastHitT: number,
): number {
  let t = Math.max(rawT, lastEventT);
  if (isHit && lastHitT >= 0) t = Math.max(t, lastHitT + PIANO_MIN_HIT_INTERVAL_MS);
  return t;
}

function isFiniteInt(value: unknown, min = 0): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= min;
}

function isEvent(value: unknown): value is PianoTilesEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<PianoTilesEvent>;
  if (!isFiniteInt(event.t) || !isFiniteInt(event.lane) || event.lane > 3) return false;
  if (event.j !== 'h' && event.j !== 'm' && event.j !== 'w' && event.j !== 'r') return false;
  if (!isFiniteInt(event.b)) return false;
  return event.j === 'r' ? event.b <= HOLD_BONUS_MAX : event.b === 0;
}

function isChartEntry(value: unknown): value is ChartManifestEntry {
  if (!value || typeof value !== 'object') return false;
  const chart = value as Partial<ChartManifestEntry>;
  return (
    typeof chart.id === 'string' && chart.id.length > 0 &&
    typeof chart.title === 'string' &&
    typeof chart.artist === 'string' &&
    isFiniteInt(chart.bpm, 1) &&
    isFiniteInt(chart.durationMs) &&
    isFiniteInt(chart.noteCount) &&
    isFiniteInt(chart.stars, 1) && chart.stars <= 5 &&
    typeof chart.checksum === 'string'
  );
}

function isEngineResult(value: unknown): value is EngineResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<EngineResult>;
  return (
    (result.mode === 'classic' || result.mode === 'rush') &&
    (result.status === 'failed' || result.status === 'timeup') &&
    isFiniteInt(result.score) &&
    isFiniteInt(result.tilesHit) &&
    isFiniteInt(result.crowns) &&
    isFiniteInt(result.laps) &&
    isFiniteInt(result.playedMs) &&
    isFiniteInt(result.totalNotes)
  );
}

function parsePersisted(value: unknown): PersistedPianoTilesSubmission | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<PersistedPianoTilesSubmission>;
  if (candidate.version !== 1 || !isFiniteInt(candidate.createdAt)) return null;
  if (candidate.mode !== 'classic' && candidate.mode !== 'rush') return null;
  if (!isChartEntry(candidate.selected) || !isEngineResult(candidate.result)) return null;
  if (!candidate.payload || typeof candidate.payload !== 'object') return null;

  const payload = candidate.payload as Partial<PianoTilesSubmitPayload>;
  if (typeof payload.sessionId !== 'string' || payload.sessionId.length === 0) return null;
  if (!isFiniteInt(payload.eventOffset)) return null;
  if (!payload.result || typeof payload.result !== 'object') return null;
  const result = payload.result as Partial<PianoTilesSubmitResult>;
  if (
    (result.status !== 'failed' && result.status !== 'timeup') ||
    !isFiniteInt(result.score) ||
    !isFiniteInt(result.tilesHit) ||
    !isFiniteInt(result.crowns) ||
    !isFiniteInt(result.laps) ||
    !isFiniteInt(result.playedMs)
  ) return null;
  if (!Array.isArray(payload.events) || !payload.events.every(isEvent)) return null;

  return {
    version: 1,
    createdAt: candidate.createdAt,
    mode: candidate.mode,
    selected: candidate.selected,
    result: candidate.result,
    payload: {
      sessionId: payload.sessionId,
      eventOffset: payload.eventOffset,
      result: {
        status: result.status,
        score: result.score,
        tilesHit: result.tilesHit,
        crowns: result.crowns,
        laps: result.laps,
        playedMs: result.playedMs,
      },
      events: payload.events.map((event) => ({ ...event })),
    },
  };
}

export function readPendingPianoTilesSubmission(
  storage: Pick<Storage, 'getItem'> | null | undefined,
): PersistedPianoTilesSubmission | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PIANO_TILES_PENDING_SUBMISSION_KEY);
    if (!raw) return null;
    return parsePersisted(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function savePendingPianoTilesSubmission(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  value: PersistedPianoTilesSubmission,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PIANO_TILES_PENDING_SUBMISSION_KEY, JSON.stringify(value));
    return true;
  } catch {
    // 隐私模式或存储配额不足时仍保留内存中的提交包。
    return false;
  }
}

export function clearPendingPianoTilesSubmission(
  storage: Pick<Storage, 'removeItem'> | null | undefined,
): void {
  try {
    storage?.removeItem(PIANO_TILES_PENDING_SUBMISSION_KEY);
  } catch {
    // 忽略存储清理异常，不影响已经成功的结算。
  }
}
