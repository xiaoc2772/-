// 幸运塔防 API 客户端。契约见 plans/幸运塔防_20260704.md §4.3（M2 后端按此实现）。
// M2 未接入时（网关落回 Next 返回 404/非 JSON），自动降级为「本地试玩模式」：
// 本地生成 seed、不上报、不发积分；接口形状保持一致，M2 上线后无需改动调用方。

import type { GameAction, GameResult } from './engine/types';
import { LUCKY_TD_WIN_SCORE, MAX_SQUAD_SIZE, pointRewardForScore, squadBonusPermyriad } from './constants';

export type LuckyTdApiMode = 'server' | 'local';

export interface LuckyTdDailyStats {
  gamesPlayed: number;
  pointsEarned: number;
}

export interface LuckyTdRecordView {
  id: string;
  mapId: string;
  status: number;
  won: boolean;
  wavesCleared: number;
  score: number;
  basePoints?: number;
  rewardPoints?: number;
  squadSize?: number;
  squadBonusPermyriad?: number;
  pointsEarned: number;
  durationMs: number;
  createdAt: number;
}

export interface LuckyTdActiveSession {
  sessionId: string;
  seed: string;
  mapId: string;
  squad: string[];
  actions: GameAction[];
  frame: number;
  expiresAt: number;
}

export interface LuckyTdStatusData {
  balance: number;
  dailyStats: LuckyTdDailyStats;
  inCooldown: boolean;
  cooldownRemaining: number;
  dailyLimit: number;
  pointsLimitReached: boolean;
  records: LuckyTdRecordView[];
  activeSession: LuckyTdActiveSession | null;
}

export interface LuckyTdStartData {
  sessionId: string;
  seed: string;
  expiresAt: number;
}

export interface LuckyTdSubmitData {
  score: number;
  basePoints?: number;
  rewardPoints?: number;
  squadSize?: number;
  squadBonusPermyriad?: number;
  pointsEarned: number;
  wavesCleared: number;
  status: number;
  won: boolean;
  dailyStats: LuckyTdDailyStats | null;
  pointsLimitReached: boolean;
}

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  message?: string;
}

export interface ApiOutcome<T> {
  ok: boolean;
  data: T | null;
  message: string;
  /** 后端尚未部署（404/非 JSON）时为 true，调用方据此进入本地试玩模式 */
  unavailable: boolean;
}

const BASE = '/api/games/lucky-td';

async function request<T>(path: string, init?: RequestInit): Promise<ApiOutcome<T>> {
  try {
    const response = await fetch(`${BASE}${path}`, {
      cache: 'no-store',
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      ...init,
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (response.status === 404 || !contentType.includes('application/json')) {
      return { ok: false, data: null, message: '幸运塔防后端尚未接入', unavailable: true };
    }
    const json = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
    if (!response.ok || !json?.success) {
      return { ok: false, data: null, message: json?.message ?? `请求失败（${response.status}）`, unavailable: false };
    }
    return { ok: true, data: json.data ?? null, message: '', unavailable: false };
  } catch {
    return { ok: false, data: null, message: '网络错误，请稍后重试', unavailable: false };
  }
}

export function fetchLuckyTdStatus(): Promise<ApiOutcome<LuckyTdStatusData>> {
  return request<LuckyTdStatusData>('/status');
}

export function startLuckyTdGame(mapId: string, squad: string[]): Promise<ApiOutcome<LuckyTdStartData>> {
  return request<LuckyTdStartData>('/start', { method: 'POST', body: JSON.stringify({ mapId, squad }) });
}

export interface LuckyTdCheckpointPayload {
  sessionId: string;
  waveIndex: number;
  frame: number;
  stateHash: number;
  actionsDelta: GameAction[];
}

export function checkpointLuckyTdGame(payload: LuckyTdCheckpointPayload): Promise<ApiOutcome<{ expiresAt: number }>> {
  return request<{ expiresAt: number }>('/checkpoint', { method: 'POST', body: JSON.stringify(payload) });
}

export interface LuckyTdSubmitPayload {
  sessionId: string;
  finalFrame: number;
  claimedScore: number;
  actionsDelta: GameAction[];
}

export function submitLuckyTdGame(payload: LuckyTdSubmitPayload): Promise<ApiOutcome<LuckyTdSubmitData>> {
  return request<LuckyTdSubmitData>('/submit', { method: 'POST', body: JSON.stringify(payload) });
}

export function cancelLuckyTdGame(sessionId: string): Promise<ApiOutcome<{ cancelled: boolean }>> {
  return request<{ cancelled: boolean }>('/cancel', { method: 'POST', body: JSON.stringify({ sessionId }) });
}

/** 本地试玩会话（不经服务器、不发积分）。 */
export function createLocalSession(): LuckyTdStartData {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const seed = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return { sessionId: `local-${seed.slice(0, 8)}`, seed, expiresAt: Date.now() + 2 * 60 * 60 * 1000 };
}

export function buildLocalSubmitData(result: GameResult, squadSize = MAX_SQUAD_SIZE): LuckyTdSubmitData {
  const rewardPoints = pointRewardForScore(result.score, squadSize);
  return {
    score: result.score,
    basePoints: result.score,
    rewardPoints,
    squadSize,
    squadBonusPermyriad: squadBonusPermyriad(squadSize),
    pointsEarned: 0,
    wavesCleared: result.wavesCleared,
    status: result.status,
    won: result.status === 1 && result.wavesCleared >= 30 && result.score >= LUCKY_TD_WIN_SCORE,
    dailyStats: null,
    pointsLimitReached: false,
  };
}
