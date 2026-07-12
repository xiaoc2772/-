'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, BookOpen, Bomb, Hammer, Loader2, Play, RotateCcw, Sparkles, Target, Timer, Trophy, X, Zap } from 'lucide-react';
import { CancelConfirmModal } from '../_components/CancelConfirmModal';
import { usePausedGameClock } from '../_hooks/usePausedGameClock';
import { fetchGameRequest, gameRequestErrorMessage } from '../_lib/request';
import {
  WHACK_MOLE_GAME_DURATION_MS,
  WHACK_MOLE_DIFFICULTIES,
  WHACK_MOLE_DIFFICULTY_CONFIG,
  calculateWhackMolePointReward,
  createEmptyWhackMoleBoard,
  getWhackMoleDifficultyConfig,
  getWhackMoleBoard,
  getWhackMoleBombCount,
  getWhackMoleRefreshMs,
  getWhackMoleScoreDelta,
  getWhackMoleTickIndex,
  normalizeWhackMoleDifficulty,
  scoreWhackMoleEvents,
  type WhackMoleDifficulty,
  type WhackMoleCell,
  type WhackMoleHitEvent,
  type WhackMoleHitResult,
} from '@/lib/whack-mole-engine';

type GamePhase = 'ready' | 'playing' | 'submitting' | 'finished';
type FeedbackState = 'hit' | 'goldenHit' | 'bombHit';
type DisplayHoleState = WhackMoleCell | FeedbackState;

interface WhackMoleSessionView {
  sessionId: string;
  seed: string;
  startedAt: number;
  expiresAt: number;
  durationMs: number;
  difficulty: WhackMoleDifficulty;
  board: WhackMoleCell[];
  boardTick: number;
  timeLeftMs: number;
  score: number;
  combo: number;
  eventsCount: number;
}

interface WhackMoleSession {
  sessionId: string;
  seed: string;
  startedAt: number;
  expiresAt: number;
  durationMs: number;
  difficulty: WhackMoleDifficulty;
}

interface WhackMoleRecord {
  id: string;
  difficulty?: WhackMoleDifficulty;
  score: number;
  pointsEarned: number;
  hits: number;
  goldenHits: number;
  misses: number;
  bombs: number;
  maxCombo: number;
  createdAt: number;
}

interface WhackMoleStatus {
  balance: number;
  dailyStats: { gamesPlayed: number; pointsEarned: number };
  inCooldown: boolean;
  cooldownRemaining: number;
  dailyLimit: number;
  pointsLimitReached: boolean;
  records: WhackMoleRecord[];
  activeSession: WhackMoleSessionView | null;
}

interface SubmitResult {
  record: WhackMoleRecord;
  pointsEarned: number;
}

interface PersistedEvents {
  sessionId: string;
  events: WhackMoleHitEvent[];
}

const BOARD_SIZE = 4;
const BEST_SCORE_KEY = 'lucky-whack-mole-best-score';
const EVENTS_PERSIST_KEY = 'lucky-whack-mole-events';
const FEEDBACK_DURATION_MS = 520;
const TIMER_TICK_MS = 80;
const WHACK_MOLE_ART_BASE = '/images-optimized/ui/games';
const MOLE_IMAGE_SRC = `${WHACK_MOLE_ART_BASE}/whack-mole.webp`;
const GOLDEN_MOLE_IMAGE_SRC = `${WHACK_MOLE_ART_BASE}/whack-mole-golden.webp`;
const HIT_MOLE_IMAGE_SRC = `${WHACK_MOLE_ART_BASE}/whack-mole-hit.webp`;
const GOLDEN_HIT_MOLE_IMAGE_SRC = `${WHACK_MOLE_ART_BASE}/whack-mole-golden-hit.webp`;
const HOLE_BACKGROUND_IMAGE_SRC = `${WHACK_MOLE_ART_BASE}/whack-mole-hole-bg.webp`;
const BOMB_IMAGE_SRC = `${WHACK_MOLE_ART_BASE}/whack-mole-bomb.webp`;

const WHACK_DIFFICULTY_META: Record<WhackMoleDifficulty, {
  icon: ReactNode;
  toneClass: string;
  accentClass: string;
  summary: string;
  borderClass: string;
}> = {
  easy: {
    icon: <Sparkles />,
    toneClass: 'easy',
    accentClass: 'text-sky-700',
    summary: '慢节奏，低风险',
    borderClass: 'border-sky-200',
  },
  normal: {
    icon: <Hammer />,
    toneClass: 'normal',
    accentClass: 'text-emerald-700',
    summary: '标准规则，均衡收益',
    borderClass: 'border-emerald-200',
  },
  hard: {
    icon: <Bomb />,
    toneClass: 'hard',
    accentClass: 'text-rose-700',
    summary: '高速度，高回报',
    borderClass: 'border-rose-200',
  },
};

async function parseJson<T>(res: Response): Promise<{ success?: boolean; data?: T; message?: string } | null> {
  try {
    return (await res.json()) as { success?: boolean; data?: T; message?: string };
  } catch {
    return null;
  }
}

function formatTime(ms: number) {
  return Math.max(0, Math.ceil(ms / 1000));
}

function getHoleLabel(state: DisplayHoleState) {
  if (state === 'mole') return '地鼠';
  if (state === 'golden') return '金色地鼠';
  if (state === 'hit') return '被打地鼠';
  if (state === 'goldenHit') return '被打金色地鼠';
  if (state === 'bomb' || state === 'bombHit') return '炸弹';
  return '空洞';
}

function getHitMessage(result: WhackMoleHitResult, delta: number, combo: number) {
  if (result === 'golden_hit') return `金色地鼠 +${delta}，连击 ${combo}`;
  if (result === 'hit') return `命中 +${delta}，连击 ${combo}`;
  if (result === 'bomb') return `踩到炸弹 ${delta}，连击清空`;
  if (result === 'duplicate') return '这一格已经敲过，连击中断';
  return '打空了，连击中断';
}

function getCellResult(cell: WhackMoleCell): WhackMoleHitResult {
  if (cell === 'mole') return 'hit';
  if (cell === 'golden') return 'golden_hit';
  if (cell === 'bomb') return 'bomb';
  return 'miss';
}

function projectHit(
  cell: WhackMoleCell,
  scoreBefore: number,
  comboBefore: number,
  difficulty: WhackMoleDifficulty,
) {
  const config = getWhackMoleDifficultyConfig(difficulty);
  const result = getCellResult(cell);
  if (cell === 'mole' || cell === 'golden') {
    const scoreDelta = getWhackMoleScoreDelta(cell, comboBefore, difficulty);
    return {
      result,
      scoreDelta,
      comboAfter: comboBefore + 1,
      feedbackState: result === 'golden_hit' ? 'goldenHit' as const : 'hit' as const,
    };
  }

  if (cell === 'bomb') {
    const nextScore = Math.max(0, scoreBefore - config.bombPenalty);
    return {
      result,
      scoreDelta: nextScore - scoreBefore,
      comboAfter: 0,
      feedbackState: 'bombHit' as const,
    };
  }

  return {
    result,
    scoreDelta: 0,
    comboAfter: 0,
    feedbackState: null,
  };
}

function loadPersistedEvents(sessionId: string, durationMs: number): WhackMoleHitEvent[] {
  try {
    const raw = window.localStorage.getItem(EVENTS_PERSIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<PersistedEvents> | null;
    if (!parsed || parsed.sessionId !== sessionId || !Array.isArray(parsed.events)) return [];
    return parsed.events
      .filter((event): event is WhackMoleHitEvent =>
        Boolean(event)
        && typeof event === 'object'
        && typeof (event as WhackMoleHitEvent).index === 'number'
        && typeof (event as WhackMoleHitEvent).elapsedMs === 'number',
      )
      .map((event) => ({
        index: Math.floor(event.index),
        elapsedMs: Math.floor(event.elapsedMs),
      }))
      .filter((event) =>
        Number.isInteger(event.index)
        && event.index >= 0
        && event.index < 16
        && Number.isInteger(event.elapsedMs)
        && event.elapsedMs >= 0
        && event.elapsedMs < durationMs,
      );
  } catch {
    return [];
  }
}

function savePersistedEvents(sessionId: string, events: WhackMoleHitEvent[]) {
  try {
    const payload: PersistedEvents = { sessionId, events };
    window.localStorage.setItem(EVENTS_PERSIST_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota / privacy errors — losing recovery is acceptable
  }
}

function clearPersistedEvents() {
  try {
    window.localStorage.removeItem(EVENTS_PERSIST_KEY);
  } catch {
    // ignore
  }
}

export default function WhackMolePage() {
  const [phase, setPhase] = useState<GamePhase>('ready');
  const [selectedDifficulty, setSelectedDifficulty] = useState<WhackMoleDifficulty>('normal');
  const [session, setSession] = useState<WhackMoleSession | null>(null);
  const [status, setStatus] = useState<WhackMoleStatus | null>(null);
  const [board, setBoard] = useState<WhackMoleCell[]>(() => createEmptyWhackMoleBoard());
  const [boardTick, setBoardTick] = useState(0);
  const [timeLeftMs, setTimeLeftMs] = useState(WHACK_MOLE_GAME_DURATION_MS);
  const [localScore, setLocalScore] = useState(0);
  const [localCombo, setLocalCombo] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [lastHit, setLastHit] = useState('准备开始');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WhackMoleRecord | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [hitFeedback, setHitFeedback] = useState<Partial<Record<number, FeedbackState>>>({});

  const submittedRef = useRef(false);
  const sessionRef = useRef<WhackMoleSession | null>(null);
  const phaseRef = useRef<GamePhase>('ready');
  const boardRef = useRef<WhackMoleCell[]>(createEmptyWhackMoleBoard());
  const boardTickRef = useRef(0);
  const hiddenTargetKeysRef = useRef<Set<string>>(new Set());
  const eventsRef = useRef<WhackMoleHitEvent[]>([]);
  const localScoreRef = useRef(0);
  const localComboRef = useRef(0);
  const feedbackTimersRef = useRef<Partial<Record<number, number>>>({});
  const gameNow = usePausedGameClock(showCancelConfirm, session?.sessionId);

  const setRoundPhase = useCallback((nextPhase: GamePhase) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  const clearHitFeedback = useCallback(() => {
    for (const timer of Object.values(feedbackTimersRef.current)) {
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    }
    feedbackTimersRef.current = {};
    setHitFeedback({});
  }, []);

  const showHoleFeedback = useCallback((index: number, state: FeedbackState, durationMs = FEEDBACK_DURATION_MS) => {
    const existingTimer = feedbackTimersRef.current[index];
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }

    setHitFeedback((current) => ({ ...current, [index]: state }));
    feedbackTimersRef.current[index] = window.setTimeout(() => {
      setHitFeedback((current) => {
        const next = { ...current };
        delete next[index];
        return next;
      });
      delete feedbackTimersRef.current[index];
    }, durationMs);
  }, []);

  const updateLocalProgress = useCallback((nextScore: number, nextCombo: number) => {
    localScoreRef.current = nextScore;
    localComboRef.current = nextCombo;
    setLocalScore(nextScore);
    setLocalCombo(nextCombo);
  }, []);

  const setBoardForElapsed = useCallback((seed: string, elapsedMs: number, difficulty: WhackMoleDifficulty) => {
    const config = getWhackMoleDifficultyConfig(difficulty);
    const boardElapsedMs = Math.min(Math.max(0, elapsedMs), config.durationMs - 1);
    const nextBoard = elapsedMs >= config.durationMs
      ? createEmptyWhackMoleBoard()
      : getWhackMoleBoard(seed, boardElapsedMs, difficulty);
    const nextTick = getWhackMoleTickIndex(boardElapsedMs, difficulty);
    boardRef.current = nextBoard;
    boardTickRef.current = nextTick;
    setBoard(nextBoard);
    setBoardTick(nextTick);
  }, []);

  const resetRoundView = useCallback((difficulty: WhackMoleDifficulty = selectedDifficulty) => {
    const config = getWhackMoleDifficultyConfig(difficulty);
    hiddenTargetKeysRef.current.clear();
    eventsRef.current = [];
    updateLocalProgress(0, 0);
    setBoard(createEmptyWhackMoleBoard());
    boardRef.current = createEmptyWhackMoleBoard();
    boardTickRef.current += 1;
    setBoardTick(boardTickRef.current);
    setTimeLeftMs(config.durationMs);
    clearHitFeedback();
  }, [clearHitFeedback, selectedDifficulty, updateLocalProgress]);

  const applySession = useCallback((view: WhackMoleSessionView) => {
    submittedRef.current = false;
    hiddenTargetKeysRef.current.clear();
    clearHitFeedback();

    const difficulty = normalizeWhackMoleDifficulty(view.difficulty);
    const config = getWhackMoleDifficultyConfig(difficulty);
    const restored = loadPersistedEvents(view.sessionId, config.durationMs);
    eventsRef.current = restored;
    const scored = scoreWhackMoleEvents(view.seed, restored, difficulty);
    updateLocalProgress(scored.score, scored.combo);

    const elapsedMs = Math.max(0, Math.floor(Date.now() - view.startedAt));
    setBoardForElapsed(view.seed, elapsedMs, difficulty);
    setTimeLeftMs(Math.max(0, config.durationMs - elapsedMs));

    const nextSession: WhackMoleSession = {
      sessionId: view.sessionId,
      seed: view.seed,
      startedAt: view.startedAt,
      expiresAt: view.expiresAt,
      durationMs: view.durationMs,
      difficulty,
    };
    setSelectedDifficulty(difficulty);
    setSession(nextSession);
    sessionRef.current = nextSession;
    setResult(null);
    setLastHit(restored.length > 0 ? '已恢复本局敲击记录' : '敲中地鼠可获得连击加成');
    setRoundPhase('playing');
  }, [clearHitFeedback, setBoardForElapsed, setRoundPhase, updateLocalProgress]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetchGameRequest('/api/games/whack-mole/status');
      const data = await parseJson<WhackMoleStatus>(res);
      if (!res.ok || !data?.success || !data.data) {
        throw new Error(data?.message ?? (res.status === 401 ? '请先登录后开始游戏' : '加载游戏状态失败'));
      }

      setStatus(data.data);
      setError(null);
      const serverBest = data.data.records.reduce((best, record) => Math.max(best, record.score), 0);
      setBestScore((current) => Math.max(current, serverBest));

      if (data.data.activeSession && phaseRef.current === 'ready') {
        applySession(data.data.activeSession);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误，请稍后重试');
    }
  }, [applySession]);

  const submitResult = useCallback(async (targetSession: WhackMoleSession) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setRoundPhase('submitting');
    setLoading(true);
    setError(null);

    try {
      const res = await fetchGameRequest('/api/games/whack-mole/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: targetSession.sessionId,
          events: eventsRef.current,
        }),
      });
      const data = await parseJson<SubmitResult>(res);

      if (!res.ok || !data?.success || !data.data) {
        throw new Error(data?.message ?? `结算失败（HTTP ${res.status}）`);
      }

      const record = data.data.record;
      setResult(record);
      setSelectedDifficulty(normalizeWhackMoleDifficulty(record.difficulty));
      clearPersistedEvents();
      eventsRef.current = [];
      setBestScore((current) => {
        const nextBest = Math.max(current, record.score);
        window.localStorage.setItem(BEST_SCORE_KEY, String(nextBest));
        return nextBest;
      });
      setSession(null);
      sessionRef.current = null;
      resetRoundView();
      updateLocalProgress(record.score, 0);
      setLastHit(`本局获得 ${record.pointsEarned} 积分`);
      setRoundPhase('finished');
      void fetchStatus();
    } catch (err) {
      submittedRef.current = false;
      setRoundPhase('finished');
      setLastHit('结算未完成，请重试本局结算');
      setError(gameRequestErrorMessage(err, '结算请求超时，请检查网络后重试', '结算失败，请稍后重试'));
    } finally {
      setLoading(false);
    }
  }, [fetchStatus, resetRoundView, setRoundPhase, updateLocalProgress]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    return () => {
      for (const timer of Object.values(feedbackTimersRef.current)) {
        if (timer !== undefined) {
          window.clearTimeout(timer);
        }
      }
    };
  }, []);

  useEffect(() => {
    const savedScore = window.localStorage.getItem(BEST_SCORE_KEY);
    setBestScore(Number(savedScore) || 0);
    void fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (phase === 'playing' || phase === 'submitting' || !status?.inCooldown) return;

    const timer = window.setInterval(() => {
      void fetchStatus();
    }, 1000);

    return () => window.clearInterval(timer);
  }, [fetchStatus, phase, status?.inCooldown]);

  useEffect(() => {
    if (phase !== 'playing' || !session) return;

    let previousTick = getWhackMoleTickIndex(
      Math.min(gameNow() - session.startedAt, session.durationMs - 1),
      session.difficulty,
    );

    const timer = window.setInterval(() => {
      const activeSession = sessionRef.current;
      if (!activeSession) return;

      const elapsedMs = gameNow() - activeSession.startedAt;
      const nextTimeLeft = Math.max(0, activeSession.durationMs - elapsedMs);
      setTimeLeftMs(nextTimeLeft);

      if (elapsedMs >= activeSession.durationMs) {
        window.clearInterval(timer);
        void submitResult(activeSession);
        return;
      }

      const nextTick = getWhackMoleTickIndex(elapsedMs, activeSession.difficulty);
      if (nextTick !== previousTick) {
        previousTick = nextTick;
        hiddenTargetKeysRef.current = new Set();
        clearHitFeedback();
        setBoardForElapsed(activeSession.seed, elapsedMs, activeSession.difficulty);
      }
    }, TIMER_TICK_MS);

    return () => window.clearInterval(timer);
  }, [clearHitFeedback, gameNow, phase, session, setBoardForElapsed, submitResult]);

  const startGame = useCallback(async (restart = false) => {
    setLoading(true);
    setError(null);
    setResult(null);
    clearPersistedEvents();
    resetRoundView(selectedDifficulty);

    try {
      const res = await fetchGameRequest('/api/games/whack-mole/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restart, difficulty: selectedDifficulty }),
      });
      const data = await parseJson<WhackMoleSessionView>(res);
      if (!res.ok || !data?.success || !data.data) {
        throw new Error(data?.message ?? `开始游戏失败（HTTP ${res.status}）`);
      }
      applySession(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '开始游戏失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [applySession, resetRoundView, selectedDifficulty]);

  const cancelGame = useCallback(async () => {
    if (!sessionRef.current) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetchGameRequest('/api/games/whack-mole/cancel', { method: 'POST' });
      const data = await parseJson<unknown>(res);
      if (!res.ok || !data?.success) {
        throw new Error(data?.message ?? '结束游戏失败');
      }

      submittedRef.current = false;
      clearPersistedEvents();
      setSession(null);
      sessionRef.current = null;
      setResult(null);
      resetRoundView();
      setLastHit('本局已结束，无奖励');
      setStatus((current) => current ? {
        ...current,
        inCooldown: true,
        cooldownRemaining: Math.max(current.cooldownRemaining, 5),
        activeSession: null,
      } : current);
      setRoundPhase('ready');
      void fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : '结束游戏失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [fetchStatus, resetRoundView, setRoundPhase]);

  const confirmCancelGame = useCallback(async () => {
    await cancelGame();
    setShowCancelConfirm(false);
  }, [cancelGame]);

  const handleHolePress = useCallback((index: number) => {
    const activeSession = sessionRef.current;
    if (phaseRef.current !== 'playing' || !activeSession) return;
    if (showCancelConfirm) return;

    const elapsedMs = Math.max(0, Math.floor(gameNow() - activeSession.startedAt));
    if (elapsedMs >= activeSession.durationMs) return;

    const currentTick = boardTickRef.current;
    const targetKey = `${currentTick}:${index}`;
    if (hiddenTargetKeysRef.current.has(targetKey)) return;

    const cell = boardRef.current[index] ?? 'empty';
    const projected = projectHit(cell, localScoreRef.current, localComboRef.current, activeSession.difficulty);

    if (projected.feedbackState) {
      hiddenTargetKeysRef.current.add(targetKey);
      showHoleFeedback(index, projected.feedbackState);
    }

    const nextScore = Math.max(0, localScoreRef.current + projected.scoreDelta);
    const nextCombo = projected.comboAfter;
    updateLocalProgress(nextScore, nextCombo);

    eventsRef.current = [...eventsRef.current, { index, elapsedMs }];
    savePersistedEvents(activeSession.sessionId, eventsRef.current);

    setLastHit(getHitMessage(projected.result, projected.scoreDelta, nextCombo));
  }, [gameNow, showCancelConfirm, showHoleFeedback, updateLocalProgress]);

  const activeDifficulty = session?.difficulty ?? selectedDifficulty;
  const activeConfig = getWhackMoleDifficultyConfig(activeDifficulty);
  const elapsedMs = activeConfig.durationMs - timeLeftMs;
  const refreshHint = getWhackMoleRefreshMs(elapsedMs, activeDifficulty);
  const bombHint = getWhackMoleBombCount(elapsedMs, activeDifficulty);
  const rewardPreview = calculateWhackMolePointReward(localScore, activeDifficulty);
  const canRetrySettlement = phase === 'finished' && !result && session !== null;
  const phaseText = phase === 'playing' ? '进行中' : phase === 'submitting' ? '结算中' : phase === 'finished' ? '已结算' : '待开始';
  const commandLine = phase === 'playing'
    ? '按规则敲击目标：普通加分，金色优先，炸弹会扣分并清空连击。'
    : phase === 'submitting'
      ? '本局正在由服务端复算分数。'
      : phase === 'finished'
        ? canRetrySettlement
          ? '本局还没有完成结算，可以重试提交。'
          : '结算完成，可以返回游戏中心或再来一局。'
        : `${activeConfig.label}难度：${Math.round(activeConfig.durationMs / 1000)} 秒挑战，每 ${activeConfig.rewardDivisor} 分换 1 积分。`;
  const primaryButtonLabel = phase === 'playing'
    ? '结束游戏'
    : phase === 'submitting'
      ? '结算中...'
      : phase === 'finished'
        ? canRetrySettlement
          ? '重试结算'
          : '再来一局'
        : '开始游戏';
  const isPrimaryDisabled = loading || phase === 'submitting' || (!canRetrySettlement && phase !== 'playing' && Boolean(status?.inCooldown));
  const actionLabel = status?.inCooldown && phase !== 'playing'
    ? `冷却中 ${status.cooldownRemaining}s`
    : primaryButtonLabel;

  return (
    <div className="whack-page">
      <div className="whack-mesh-bg" aria-hidden />
      <div className="whack-stardust" aria-hidden>
        <span style={{ top: '8%', left: '6%', fontSize: 14 }}>✦</span>
        <span style={{ top: '20%', left: '92%', fontSize: 11, animationDelay: '1s' }}>✦</span>
        <span style={{ top: '48%', left: '4%', fontSize: 16, animationDelay: '2s' }}>✧</span>
        <span style={{ top: '76%', left: '94%', fontSize: 12, animationDelay: '0.6s' }}>✧</span>
      </div>

      <header className="whack-topbar">
        <Link href="/games" className="whack-exit-btn">
          <span className="arrow">
            <ArrowLeft size={14} strokeWidth={2.4} />
          </span>
          EXIT
        </Link>
      </header>

      <main className="whack-container">
        {error && (
          <div className="whack-error-banner" role="alert">
            {error}
          </div>
        )}

        <section className="whack-command-bar" aria-live="polite">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-black text-emerald-700">
              <Hammer className="h-4 w-4" />
              <span>{phaseText}</span>
              <span className="text-slate-300">/</span>
              <span className="text-slate-500">{commandLine}</span>
            </div>
            <p className="text-lg font-black text-slate-950 sm:text-xl">{lastHit}</p>
          </div>
          <button
            onClick={() => setShowRules(true)}
            type="button"
            className="inline-flex flex-none items-center justify-center gap-1.5 rounded-full border border-emerald-200 bg-white px-4 py-2 text-sm font-bold text-emerald-700 transition-colors hover:bg-emerald-50"
          >
            <BookOpen className="h-4 w-4" />
            规则
          </button>
        </section>

        {phase !== 'playing' && phase !== 'submitting' && (
          <section className="glass-card stage-card whack-difficulty-stage" aria-label="选择难度">
            <div className="whack-difficulty-stage-head">
              <h2 className="whack-section-title">
                <span className="whack-st-icon">
                  <Hammer size={18} />
                </span>
                选择难度
              </h2>
              <span className="whack-cute-pill">
                <Sparkles className="h-4 w-4" />
                不同难度 = 不同节奏与奖励上限
              </span>
            </div>
            <div className="whack-difficulty-wrap">
              <h3 className="whack-difficulty-headline">选择你的挑战节奏</h3>
              <div className="whack-difficulty-grid">
                {WHACK_MOLE_DIFFICULTIES.map((difficulty, index) => {
                  const config = WHACK_MOLE_DIFFICULTY_CONFIG[difficulty];
                  const meta = WHACK_DIFFICULTY_META[difficulty];
                  const selected = selectedDifficulty === difficulty;
                  return (
                    <button
                      key={difficulty}
                      type="button"
                      aria-pressed={selected}
                      disabled={loading || Boolean(status?.inCooldown)}
                      onClick={() => {
                        if (selected) {
                          void startGame(phase === 'finished');
                          return;
                        }
                        setSelectedDifficulty(difficulty);
                        resetRoundView(difficulty);
                      }}
                      className={`whack-difficulty-card group ${meta.toneClass} ${meta.borderClass} ${selected ? 'is-selected' : ''}`}
                      style={{ animationDelay: `${index * 100}ms` }}
                    >
                      <span className={`whack-difficulty-glow ${meta.toneClass}`} />
                      <span className="difficulty-content">
                        <span className="difficulty-topline">
                          <span className={`difficulty-icon ${meta.toneClass} ${meta.accentClass}`}>
                            {meta.icon}
                          </span>
                          <span className={`difficulty-size-pill ${meta.toneClass}`}>
                            {Math.round(config.durationMs / 1000)} 秒
                          </span>
                        </span>

                        <span className="difficulty-copy">
                          <span className={`difficulty-label ${meta.toneClass}`}>{config.label}</span>
                          <span className="difficulty-summary">{config.description}</span>
                        </span>

                        <span className={`whack-selected-start ${selected ? 'is-visible' : ''}`}>
                          {loading && selected ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                          {selected ? (status?.inCooldown ? `冷却 ${status.cooldownRemaining}s` : '再点开始') : '轻触选择'}
                        </span>

                        <span className="difficulty-stats">
                          <span>
                            <span>速度</span>
                            <strong>{config.startRefreshMs}→{config.endRefreshMs}ms</strong>
                          </span>
                          <span>
                            <span>炸弹</span>
                            <strong>最多 {config.maxBombs}</strong>
                          </span>
                          <span>
                            <span>奖励</span>
                            <strong>每 {config.rewardDivisor} 分 1 积分</strong>
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {(phase === 'playing' || phase === 'submitting' || canRetrySettlement) && (
        <section className="glass-card stage-card whack-game-card">
          <section className="whack-status-dock">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-black text-white">{phaseText}</span>
                <span className="text-xs font-bold text-slate-400">{activeConfig.label} · {Math.round(activeConfig.durationMs / 1000)} 秒挑战</span>
              </div>
              <div className="whack-status-metrics">
                <StatusMetric icon={<Timer className="h-4 w-4" />} label="时间" value={`${formatTime(timeLeftMs)}s`} tone="text-emerald-700" />
                <StatusMetric icon={<Sparkles className="h-4 w-4" />} label="得分" value={localScore} tone="text-emerald-600" />
                <StatusMetric icon={<Zap className="h-4 w-4" />} label="连击" value={localCombo} tone="text-amber-600" />
                <StatusMetric icon={<Trophy className="h-4 w-4" />} label="最高" value={Math.max(bestScore, localScore)} tone="text-sky-600" />
              </div>
            </div>

            <button
              onClick={() => {
                if (phase === 'playing') {
                  setShowCancelConfirm(true);
                  return;
                }
                if (canRetrySettlement && sessionRef.current) {
                  void submitResult(sessionRef.current);
                  return;
                }
                void startGame();
              }}
              disabled={isPrimaryDisabled}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 text-sm font-bold text-white shadow-lg shadow-emerald-200 transition-all hover:-translate-y-0.5 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-700/40 disabled:shadow-none"
              type="button"
            >
              {phase === 'finished' ? <RotateCcw className="h-4 w-4" /> : <Hammer className="h-4 w-4" />}
              {actionLabel}
            </button>
          </section>

          <section className="whack-board-panel">
            <div className="whack-board-heading">
              <div className="whack-board-title">
                <div className="text-sm font-bold text-slate-400">规则挑战区</div>
                <h2 className="text-2xl font-black text-slate-900">
                  {phase === 'finished' ? '本局结束' : phase === 'submitting' ? '正在结算' : '洞口棋盘'}
                </h2>
              </div>
              <div className="whack-board-badges">
                <span className="whack-board-badge rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700">{BOARD_SIZE} × {BOARD_SIZE}</span>
                <span className="whack-board-badge rounded-full bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-600">炸弹 {bombHint}</span>
                <span className="whack-board-badge rounded-full bg-amber-50 px-3 py-1.5 text-xs font-black text-amber-700">{refreshHint}ms</span>
                <span className="whack-board-badge rounded-full bg-sky-50 px-3 py-1.5 text-xs font-black text-sky-700">预计奖励 {rewardPreview}</span>
              </div>
            </div>

            <div className="whack-rule-strip" aria-label="局内规则">
              <RuleChip icon={<Hammer />} text={`普通 +${activeConfig.normalPoints}`} />
              <RuleChip icon={<Sparkles />} text={`金色 +${activeConfig.goldenPoints}`} />
              <RuleChip icon={<Zap />} text={`连击 +${activeConfig.comboBonusStep} / 最高 +${activeConfig.maxComboBonus}`} />
              <RuleChip icon={<Bomb />} text={`炸弹 -${activeConfig.bombPenalty}`} />
              <RuleChip icon={<Timer />} text={`${activeConfig.startRefreshMs}→${activeConfig.endRefreshMs}ms`} />
            </div>

            {phase !== 'playing' && (
              <div className="whack-board-message">
                <div className="font-black text-slate-900">
                  {phase === 'finished'
                    ? `本局得分 ${localScore}`
                    : phase === 'submitting'
                      ? '正在提交结算'
                      : '准备好后开始挑战'}
                </div>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  {phase === 'finished'
                    ? '分数由服务端复算后写入福利积分记录。'
                    : '按上方规则敲击目标：连续命中叠加加成，后半段速度更快、炸弹更多。'}
                </p>
              </div>
            )}

            <div className="whack-board mx-auto grid aspect-square w-full max-w-[620px] grid-cols-4 gap-1.5 sm:gap-2">
              {board.map((state, index) => {
                const targetKey = `${boardTick}:${index}`;
                const baseState = hiddenTargetKeysRef.current.has(targetKey) ? 'empty' : state;
                const displayState: DisplayHoleState = hitFeedback[index] ?? baseState;
                const isVisibleTarget = displayState !== 'empty';
                const targetImageKey = `${index}-${boardTick}-${displayState}`;

                return (
                  <button
                    key={index}
                    type="button"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      handleHolePress(index);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleHolePress(index);
                      }
                    }}
                    disabled={showCancelConfirm || phase !== 'playing'}
                    aria-label={`${index + 1} 号洞 ${getHoleLabel(displayState)}`}
                    className="whack-hole group relative touch-none select-none overflow-hidden rounded-xl border border-emerald-200/70 bg-cover bg-center shadow-inner transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 sm:rounded-2xl"
                    style={{ backgroundImage: `url(${HOLE_BACKGROUND_IMAGE_SRC})` }}
                  >
                    <span className="absolute inset-x-2 bottom-2 h-4 rounded-[999px] bg-slate-900/25 blur-sm sm:inset-x-3 sm:bottom-3 sm:h-5" />
                    {isVisibleTarget && (
                      <span
                        key={targetImageKey}
                        className="whack-target absolute inset-x-1.5 bottom-2 h-[86%] sm:inset-x-2 sm:bottom-3"
                      >
                        {(displayState === 'mole' || displayState === 'golden' || displayState === 'hit' || displayState === 'goldenHit') && (
                          <Image
                            src={
                              displayState === 'hit'
                                ? HIT_MOLE_IMAGE_SRC
                                : displayState === 'goldenHit'
                                  ? GOLDEN_HIT_MOLE_IMAGE_SRC
                                  : displayState === 'golden'
                                    ? GOLDEN_MOLE_IMAGE_SRC
                                    : MOLE_IMAGE_SRC
                            }
                            alt=""
                            fill
                            sizes="(max-width: 640px) 18vw, 120px"
                            loading="eager"
                            decoding="async"
                            className="object-contain drop-shadow-lg"
                          />
                        )}
                        {(displayState === 'bomb' || displayState === 'bombHit') && (
                          <Image
                            src={BOMB_IMAGE_SRC}
                            alt=""
                            fill
                            sizes="(max-width: 640px) 18vw, 120px"
                            loading="eager"
                            decoding="async"
                            className="object-contain drop-shadow-lg"
                          />
                        )}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

        </section>
        )}

        {showRules && (
          <WhackMoleRulesModal
            difficulty={activeDifficulty}
            onClose={() => setShowRules(false)}
          />
        )}
        {phase === 'finished' && result && (
          <WhackMoleResultModal
            result={result}
            loading={loading}
            cooldownRemaining={status?.inCooldown ? status.cooldownRemaining : 0}
            onStart={() => void startGame()}
          />
        )}
        <CancelConfirmModal
          open={showCancelConfirm}
          loading={loading}
          title="确认放弃打地鼠？"
          description="当前挑战会被取消，本局不会进入结算。"
          detail="本局命中、连击、得分和临时事件都会丢失。"
          onConfirm={() => void confirmCancelGame()}
          onClose={() => setShowCancelConfirm(false)}
        />
      </main>

      <style jsx>{`
        @keyframes whack-pop {
          0% { transform: translateY(42%) scale(0.72); opacity: 0; }
          68% { transform: translateY(-3%) scale(1.05); opacity: 1; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
        .whack-target {
          animation: whack-pop 180ms cubic-bezier(0.18, 0.9, 0.25, 1.2);
        }
        @media (prefers-reduced-motion: reduce) {
          .whack-target { animation: none; }
        }
      `}</style>
      <style jsx global>{`
        .whack-page {
          min-height: 100vh;
          background: #eefcf8;
          color: #0f172a;
          position: relative;
          overflow-x: hidden;
        }
        .whack-page a {
          color: inherit;
          text-decoration: none;
        }
        .whack-page .whack-mesh-bg {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          background:
            radial-gradient(circle at 12% 18%, rgba(45, 212, 191, 0.42), transparent 38%),
            radial-gradient(circle at 88% 16%, rgba(251, 191, 36, 0.22), transparent 34%),
            radial-gradient(circle at 48% 96%, rgba(16, 185, 129, 0.34), transparent 42%),
            linear-gradient(180deg, #effdf8 0%, #e7f7ff 100%);
        }
        .whack-page .whack-stardust {
          position: fixed;
          inset: 0;
          z-index: 1;
          pointer-events: none;
          color: rgba(4, 120, 87, 0.42);
        }
        .whack-page .whack-stardust span {
          position: absolute;
          animation: whack-float 4s ease-in-out infinite;
        }
        @keyframes whack-float {
          0%, 100% { transform: translateY(0); opacity: 0.45; }
          50% { transform: translateY(-10px); opacity: 0.9; }
        }
        .whack-page .whack-topbar {
          position: sticky;
          top: 0;
          z-index: 40;
          display: flex;
          align-items: center;
          justify-content: flex-start;
          padding: 18px 48px;
          padding-top: max(18px, env(safe-area-inset-top));
          background: rgba(239, 253, 248, 0.68);
          border-bottom: 1px solid rgba(255, 255, 255, 0.74);
          backdrop-filter: blur(22px) saturate(1.45);
        }
        .whack-page .whack-exit-btn {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.82);
          background: rgba(255, 255, 255, 0.62);
          padding: 8px 18px 8px 8px;
          color: #065f46;
          font-size: 13px;
          font-weight: 900;
          letter-spacing: 1.5px;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.07);
          backdrop-filter: blur(16px);
        }
        .whack-page .whack-exit-btn .arrow {
          display: inline-flex;
          width: 30px;
          height: 30px;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          border-radius: 50%;
          color: #fff;
          background: linear-gradient(135deg, #34d399, #047857);
          box-shadow: 0 8px 14px rgba(4, 120, 87, 0.28);
        }
        .whack-page .whack-container {
          position: relative;
          z-index: 1;
          max-width: 1360px;
          margin: 0 auto;
          padding: 22px 48px 92px;
          display: flex;
          flex-direction: column;
          gap: 22px;
        }
        .whack-page .whack-error-banner {
          border-radius: 20px;
          border: 1px solid rgba(254, 202, 202, 0.9);
          background: rgba(254, 242, 242, 0.92);
          padding: 14px 16px;
          color: #be123c;
          font-size: 14px;
          font-weight: 800;
        }
        .whack-page .whack-command-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          border-radius: 28px;
          border: 1px solid rgba(167, 243, 208, 0.9);
          background: rgba(255, 255, 255, 0.78);
          padding: 16px 18px;
          box-shadow: 0 18px 46px rgba(15, 23, 42, 0.07);
          backdrop-filter: blur(16px);
        }
        .whack-page .glass-card {
          border: 1px solid rgba(255, 255, 255, 0.82);
          background: rgba(255, 255, 255, 0.82);
          box-shadow: 0 22px 60px rgba(15, 23, 42, 0.1);
          backdrop-filter: blur(18px);
        }
        .whack-page .stage-card {
          padding: 22px;
          border-radius: 30px;
        }
        .whack-page .whack-status-dock {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 18px;
          align-items: center;
          border-radius: 24px;
          border: 1px solid rgba(209, 250, 229, 0.86);
          background: linear-gradient(180deg, rgba(236, 253, 245, 0.96), rgba(255, 255, 255, 0.94));
          padding: 16px;
          margin-bottom: 22px;
        }
        .whack-page .whack-status-metrics {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
        }
        .whack-page .whack-metric {
          border-radius: 18px;
          border: 1px solid rgba(226, 232, 240, 0.8);
          background: rgba(255, 255, 255, 0.78);
          padding: 10px 12px;
        }
        .whack-page .whack-difficulty-stage {
          margin-bottom: 22px;
        }
        .whack-page .whack-difficulty-stage-head {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 20px;
        }
        .whack-page .whack-section-title {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 0;
          font-size: 20px;
          font-weight: 950;
          color: #0f172a;
        }
        .whack-page .whack-st-icon {
          display: inline-flex;
          width: 36px;
          height: 36px;
          align-items: center;
          justify-content: center;
          border-radius: 12px;
          color: #fff;
          background: linear-gradient(135deg, #34d399, #059669);
          box-shadow: 0 10px 18px rgba(5, 150, 105, 0.22);
        }
        .whack-page .whack-cute-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border-radius: 999px;
          border: 1px solid rgba(167, 243, 208, 0.9);
          background: rgba(236, 253, 245, 0.82);
          padding: 8px 13px;
          color: #047857;
          font-size: 12px;
          font-weight: 900;
        }
        .whack-page .whack-difficulty-wrap {
          width: 100%;
          max-width: 940px;
          margin: 0 auto;
        }
        .whack-page .whack-difficulty-headline {
          margin: 0;
          text-align: center;
          font-size: 30px;
          font-weight: 950;
          letter-spacing: -0.01em;
          color: #1e293b;
        }
        .whack-page .whack-difficulty-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 24px;
          margin-top: 34px;
        }
        .whack-page .whack-difficulty-card {
          position: relative;
          overflow: hidden;
          min-height: 254px;
          border-width: 4px;
          border-style: solid;
          border-radius: 32px;
          background: rgba(255, 255, 255, 0.8);
          padding: 24px;
          text-align: left;
          box-shadow: 0 18px 34px rgba(15, 23, 42, 0.06);
          backdrop-filter: blur(14px);
          transition: transform 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
          animation: whack-card-in 0.42s ease both;
        }
        .whack-page .whack-difficulty-card:hover:not(:disabled) {
          transform: translateY(-8px);
          border-color: #fff;
          box-shadow: 0 24px 44px rgba(15, 23, 42, 0.1);
        }
        .whack-page .whack-difficulty-card:active:not(:disabled) {
          transform: scale(0.98);
        }
        .whack-page .whack-difficulty-card.is-selected {
          border-color: #fff;
          box-shadow: 0 20px 42px rgba(16, 185, 129, 0.18), 0 0 0 3px rgba(16, 185, 129, 0.24);
        }
        .whack-page .whack-difficulty-card:disabled {
          cursor: not-allowed;
          opacity: 0.52;
          transform: none;
        }
        .whack-page .whack-difficulty-card.easy {
          border-color: #bae6fd;
        }
        .whack-page .whack-difficulty-card.normal {
          border-color: #a7f3d0;
        }
        .whack-page .whack-difficulty-card.hard {
          border-color: #fecdd3;
        }
        .whack-page .whack-difficulty-glow {
          position: absolute;
          inset: 0;
          opacity: 0;
          transition: opacity 0.5s ease;
        }
        .whack-page .whack-difficulty-glow.easy {
          background: linear-gradient(135deg, #38bdf8, #0ea5e9);
        }
        .whack-page .whack-difficulty-glow.normal {
          background: linear-gradient(135deg, #34d399, #059669);
        }
        .whack-page .whack-difficulty-glow.hard {
          background: linear-gradient(135deg, #fb7185, #be123c);
        }
        .whack-page .whack-difficulty-card:hover .whack-difficulty-glow,
        .whack-page .whack-difficulty-card.is-selected .whack-difficulty-glow {
          opacity: 1;
        }
        .whack-page .difficulty-content {
          position: relative;
          z-index: 1;
          display: flex;
          min-height: 206px;
          flex-direction: column;
        }
        .whack-page .difficulty-topline {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 18px;
        }
        .whack-page .difficulty-icon {
          display: inline-flex;
          width: 56px;
          height: 56px;
          align-items: center;
          justify-content: center;
          border-radius: 20px;
          background: rgba(255, 255, 255, 0.56);
          filter: drop-shadow(0 8px 12px rgba(15, 23, 42, 0.1));
          transform-origin: left center;
          transition: transform 0.3s ease, background 0.3s ease, color 0.3s ease;
        }
        .whack-page .difficulty-icon svg {
          width: 26px;
          height: 26px;
          stroke-width: 2.4;
        }
        .whack-page .whack-difficulty-card:hover .difficulty-icon {
          transform: scale(1.08) rotate(10deg);
          background: rgba(255, 255, 255, 0.22);
          color: #fff;
        }
        .whack-page .difficulty-size-pill {
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.54);
          padding: 5px 11px;
          font-size: 11px;
          font-weight: 950;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          backdrop-filter: blur(10px);
          transition: background 0.3s ease, color 0.3s ease;
        }
        .whack-page .difficulty-size-pill.easy {
          color: #0369a1;
        }
        .whack-page .difficulty-size-pill.normal {
          color: #047857;
        }
        .whack-page .difficulty-size-pill.hard {
          color: #be123c;
        }
        .whack-page .whack-difficulty-card:hover .difficulty-size-pill,
        .whack-page .whack-difficulty-card.is-selected .difficulty-size-pill {
          background: rgba(255, 255, 255, 0.22);
          color: #fff;
        }
        .whack-page .difficulty-copy {
          display: flex;
          min-width: 0;
          flex-direction: column;
          gap: 8px;
        }
        .whack-page .difficulty-label {
          font-size: 32px;
          font-weight: 950;
          line-height: 1;
          transition: color 0.3s ease;
        }
        .whack-page .difficulty-label.easy {
          color: #0369a1;
        }
        .whack-page .difficulty-label.normal {
          color: #047857;
        }
        .whack-page .difficulty-label.hard {
          color: #be123c;
        }
        .whack-page .difficulty-summary {
          color: #64748b;
          font-size: 14px;
          font-weight: 800;
          line-height: 1.55;
          transition: color 0.3s ease;
        }
        .whack-page .whack-difficulty-card:hover .difficulty-label,
        .whack-page .whack-difficulty-card.is-selected .difficulty-label {
          color: #fff;
        }
        .whack-page .whack-difficulty-card:hover .difficulty-summary,
        .whack-page .whack-difficulty-card.is-selected .difficulty-summary {
          color: rgba(255, 255, 255, 0.9);
        }
        .whack-page .whack-selected-start {
          display: inline-flex;
          width: fit-content;
          min-height: 34px;
          align-items: center;
          gap: 8px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.7);
          padding: 8px 12px;
          color: #334155;
          font-size: 12px;
          font-weight: 950;
          opacity: 0.72;
          transition: background 0.3s ease, color 0.3s ease, opacity 0.3s ease;
          margin-top: 18px;
        }
        .whack-page .whack-difficulty-card:hover .whack-selected-start,
        .whack-page .whack-selected-start.is-visible {
          background: rgba(255, 255, 255, 0.22);
          color: #fff;
          opacity: 1;
        }
        .whack-page .difficulty-stats {
          display: grid;
          gap: 8px;
          margin-top: auto;
          border-top: 1px solid rgba(226, 232, 240, 0.88);
          padding-top: 16px;
          transition: border-color 0.3s ease;
        }
        .whack-page .difficulty-stats > span {
          display: flex;
          min-width: 0;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          color: #64748b;
          font-size: 13px;
          font-weight: 850;
          transition: color 0.3s ease;
        }
        .whack-page .difficulty-stats strong {
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.46);
          padding: 3px 7px;
          color: #334155;
          font-size: 12px;
          font-weight: 950;
          transition: background 0.3s ease, color 0.3s ease;
        }
        .whack-page .whack-difficulty-card:hover .difficulty-stats,
        .whack-page .whack-difficulty-card.is-selected .difficulty-stats {
          border-color: rgba(255, 255, 255, 0.24);
        }
        .whack-page .whack-difficulty-card:hover .difficulty-stats > span,
        .whack-page .whack-difficulty-card.is-selected .difficulty-stats > span {
          color: rgba(255, 255, 255, 0.76);
        }
        .whack-page .whack-difficulty-card:hover .difficulty-stats strong,
        .whack-page .whack-difficulty-card.is-selected .difficulty-stats strong {
          background: rgba(255, 255, 255, 0.2);
          color: #fff;
        }
        @keyframes whack-card-in {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .whack-page .whack-board-panel {
          border-radius: 26px;
          border: 1px solid rgba(209, 250, 229, 0.86);
          background: rgba(255, 255, 255, 0.72);
          padding: 18px;
          box-shadow: 0 14px 36px rgba(15, 23, 42, 0.06);
        }
        .whack-page .whack-board-heading {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: start;
          gap: 12px;
          margin-bottom: 20px;
        }
        .whack-page .whack-board-title {
          min-width: 0;
        }
        .whack-page .whack-board-badges {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 8px;
          max-width: min(100%, 420px);
        }
        .whack-page .whack-board-badge {
          display: inline-flex;
          min-height: 28px;
          align-items: center;
          justify-content: center;
          line-height: 1.15;
          text-align: center;
          white-space: nowrap;
        }
        .whack-page .whack-rule-strip {
          margin: 0 auto 14px;
          display: flex;
          max-width: 720px;
          flex-wrap: wrap;
          justify-content: center;
          gap: 8px;
        }
        .whack-page .whack-rule-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border-radius: 999px;
          border: 1px solid rgba(226, 232, 240, 0.88);
          background: rgba(255, 255, 255, 0.78);
          padding: 8px 10px;
          color: #334155;
          font-size: 12px;
          font-weight: 900;
          line-height: 1.15;
          min-width: 0;
          text-align: center;
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.04);
        }
        .whack-page .whack-rule-chip svg {
          flex: 0 0 auto;
          width: 14px;
          height: 14px;
          color: #059669;
        }
        .whack-page .whack-board-message {
          margin: 0 auto 16px;
          max-width: 620px;
          border-radius: 22px;
          border: 1px solid rgba(167, 243, 208, 0.9);
          background: rgba(236, 253, 245, 0.86);
          padding: 14px 16px;
          text-align: center;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
        }
        .whack-page .whack-board {
          border-radius: 28px;
          border: 1px solid rgba(167, 243, 208, 0.9);
          background: linear-gradient(180deg, #ecfdf5 0%, #d1fae5 100%);
          padding: 8px;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.86);
        }
        .whack-page .whack-hole {
          min-width: 0;
          min-height: 0;
          background-color: #d1fae5;
        }
        .whack-page .whack-result-modal {
          width: min(560px, 100%);
          max-height: min(86vh, 680px);
          overflow-y: auto;
          border-radius: 28px;
          border: 1px solid rgba(167, 243, 208, 0.95);
          background: linear-gradient(180deg, #fff 0%, #ecfdf5 100%);
          padding: 24px;
          box-shadow: 0 30px 70px rgba(15, 23, 42, 0.3);
        }
        .whack-page .whack-result-modal.lost {
          border-color: rgba(254, 205, 211, 0.95);
          background: linear-gradient(180deg, #fff 0%, #fff1f2 100%);
        }
        .whack-page .whack-result-icon {
          display: flex;
          width: 72px;
          height: 72px;
          align-items: center;
          justify-content: center;
          border-radius: 24px;
          color: #fff;
          box-shadow: 0 18px 34px rgba(15, 23, 42, 0.16);
        }
        .whack-page .whack-result-icon.won {
          background: linear-gradient(135deg, #10b981, #047857);
        }
        .whack-page .whack-result-icon.lost {
          background: linear-gradient(135deg, #fb7185, #be123c);
        }
        .whack-page .whack-result-stats {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          margin-top: 20px;
        }
        .whack-page .whack-result-stat {
          border-radius: 18px;
          border: 1px solid rgba(226, 232, 240, 0.9);
          background: rgba(255, 255, 255, 0.86);
          padding: 12px;
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.05);
        }
        .whack-page .whack-modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 70;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(15, 23, 42, 0.58);
          padding: 18px;
          backdrop-filter: blur(10px);
        }
        .whack-page .whack-rules-modal {
          width: min(720px, 100%);
          max-height: min(86vh, 680px);
          overflow-y: auto;
          border-radius: 28px;
          border: 1px solid rgba(167, 243, 208, 0.95);
          background: linear-gradient(180deg, #fff 0%, #ecfdf5 100%);
          padding: 24px;
          box-shadow: 0 30px 70px rgba(15, 23, 42, 0.3);
        }
        @media (max-width: 1080px) {
          .whack-page .whack-container {
            padding: 22px 22px 82px;
          }
          .whack-page .whack-status-dock {
            grid-template-columns: 1fr;
          }
          .whack-page .whack-status-metrics {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
        @media (max-width: 768px) {
          .whack-page .whack-topbar {
            padding: 12px 14px;
          }
          .whack-page .whack-exit-btn {
            padding: 7px 14px 7px 7px;
            font-size: 12px;
          }
          .whack-page .whack-exit-btn .arrow {
            width: 26px;
            height: 26px;
          }
          .whack-page .whack-container {
            padding: 16px 14px 92px;
            gap: 18px;
          }
          .whack-page .stage-card {
            padding: 14px;
            border-radius: 24px;
          }
          .whack-page .whack-command-bar {
            align-items: stretch;
            flex-direction: column;
            padding: 14px;
          }
          .whack-page .whack-command-bar button,
          .whack-page .whack-status-dock button {
            width: 100%;
          }
          .whack-page .whack-status-metrics {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .whack-page .whack-difficulty-stage {
            margin-bottom: 16px;
          }
          .whack-page .whack-difficulty-stage-head {
            flex-direction: column;
            align-items: stretch;
            gap: 10px;
            margin-bottom: 14px;
          }
          .whack-page .whack-cute-pill {
            width: 100%;
            justify-content: center;
          }
          .whack-page .whack-difficulty-headline {
            font-size: 24px;
          }
          .whack-page .whack-difficulty-grid {
            grid-template-columns: 1fr;
            gap: 16px;
            margin-top: 22px;
          }
          .whack-page .whack-difficulty-card {
            min-height: 224px;
            border-radius: 26px;
            padding: 20px;
          }
          .whack-page .difficulty-content {
            min-height: 176px;
          }
          .whack-page .difficulty-topline {
            margin-bottom: 14px;
          }
          .whack-page .difficulty-icon {
            width: 48px;
            height: 48px;
            border-radius: 18px;
          }
          .whack-page .difficulty-icon svg {
            width: 23px;
            height: 23px;
          }
          .whack-page .difficulty-label {
            font-size: 28px;
          }
          .whack-page .difficulty-summary {
            font-size: 13px;
            line-height: 1.45;
          }
          .whack-page .whack-selected-start {
            margin-top: 14px;
          }
          .whack-page .difficulty-stats {
            gap: 7px;
            padding-top: 14px;
          }
          .whack-page .difficulty-stats > span {
            font-size: 12px;
          }
          .whack-page .difficulty-stats strong {
            max-width: 58%;
            overflow-wrap: anywhere;
            text-align: right;
          }
          .whack-page .whack-board-panel {
            border-radius: 22px;
            padding: 14px;
          }
          .whack-page .whack-board-heading {
            display: flex;
            flex-direction: column;
            align-items: stretch;
            gap: 10px;
            margin-bottom: 14px;
          }
          .whack-page .whack-board-badges {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            justify-content: stretch;
            gap: 8px;
            max-width: none;
          }
          .whack-page .whack-board-badge {
            width: 100%;
            min-width: 0;
            min-height: 30px;
            padding: 6px 8px;
            white-space: normal;
          }
          .whack-page .whack-board {
            max-width: min(100%, calc(100vw - 64px));
            border-radius: 22px;
            padding: 6px;
          }
          .whack-page .whack-rule-strip {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            justify-content: stretch;
            overflow: visible;
            gap: 8px;
            padding-bottom: 0;
          }
          .whack-page .whack-rule-chip {
            width: 100%;
            min-width: 0;
            justify-content: center;
            padding: 7px 8px;
            overflow-wrap: anywhere;
            white-space: normal;
          }
          .whack-page .whack-rule-chip:last-child {
            grid-column: 1 / -1;
          }
          .whack-page .whack-rules-modal,
          .whack-page .whack-result-modal {
            border-radius: 22px;
            padding: 18px;
          }
          .whack-page .whack-result-stats {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

function StatusMetric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: ReactNode; tone: string }) {
  return (
    <div className="whack-metric">
      <div className={`flex items-center gap-1.5 text-xs font-black ${tone}`}>
        {icon}
        {label}
      </div>
      <div className="mt-1 truncate text-lg font-black text-slate-900">{value}</div>
    </div>
  );
}

function RuleChip({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <span className="whack-rule-chip">
      {icon}
      {text}
    </span>
  );
}

function WhackMoleRulesModal({
  difficulty,
  onClose,
}: {
  difficulty: WhackMoleDifficulty;
  onClose: () => void;
}) {
  const config = getWhackMoleDifficultyConfig(difficulty);
  return (
    <div className="whack-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="whack-rules-title">
      <div className="whack-rules-modal">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
              <BookOpen className="h-4 w-4" />
              玩法说明
            </div>
            <h2 id="whack-rules-title" className="text-2xl font-black text-slate-950">打地鼠规则</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              当前为 {config.label} 难度，每局 {Math.round(config.durationMs / 1000)} 秒。服务端按实际敲击时间复算得分。
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:text-slate-900"
            type="button"
            aria-label="关闭规则"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <RuleCard icon={<Hammer />} title="普通地鼠" text={`命中 +${config.normalPoints} 分，连续命中会继续叠加连击。`} />
          <RuleCard icon={<Sparkles />} title="金色地鼠" text={`命中 +${config.goldenPoints} 分，是优先级最高的目标。`} />
          <RuleCard icon={<Zap />} title="连击加成" text={`每次连击额外 +${config.comboBonusStep} 分，最高额外 +${config.maxComboBonus} 分。`} />
          <RuleCard icon={<Bomb />} title="炸弹" text={`敲到炸弹扣 ${config.bombPenalty} 分，并清空当前连击，后期最多同时出现 ${config.maxBombs} 个。`} />
          <RuleCard icon={<Timer />} title="速度曲线" text={`刷新从 ${config.startRefreshMs}ms 加快到 ${config.endRefreshMs}ms。`} />
          <RuleCard icon={<Trophy />} title="奖励结算" text={`积分 = floor(得分 / ${config.rewardDivisor})，实际到账会受每日游戏积分上限影响。`} />
        </div>
      </div>
    </div>
  );
}

function WhackMoleResultModal({
  result,
  loading,
  cooldownRemaining,
  onStart,
}: {
  result: WhackMoleRecord;
  loading: boolean;
  cooldownRemaining: number;
  onStart: () => void;
}) {
  const difficulty = normalizeWhackMoleDifficulty(result.difficulty);
  const config = getWhackMoleDifficultyConfig(difficulty);
  const won = result.score >= config.winScore;
  const expectedReward = calculateWhackMolePointReward(result.score, difficulty);

  return (
    <div className="whack-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="whack-result-title">
      <div className={`whack-result-modal ${won ? 'won' : 'lost'}`}>
        <div className="flex flex-col items-center text-center">
          <div className={`whack-result-icon ${won ? 'won' : 'lost'}`}>
            {won ? <Trophy className="h-9 w-9" /> : <Target className="h-9 w-9" />}
          </div>
          <div className="mt-5 text-xs font-black uppercase tracking-wider text-emerald-700/80">
            {config.label}难度结算
          </div>
          <h2 id="whack-result-title" className="mt-1 text-2xl font-black text-slate-950">
            {won ? '挑战成功' : '挑战失败'}
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            本局得分 {result.score}，按 {config.label} 难度规则结算，获得 {result.pointsEarned} 福利积分。
          </p>
        </div>

        <div className="mt-5 rounded-2xl border border-emerald-100 bg-white px-5 py-3 text-center text-sm font-black text-emerald-700 shadow-sm">
          最终福利积分 = floor({result.score} / {config.rewardDivisor}) = {expectedReward}
        </div>

        <div className="whack-result-stats">
          <WhackResultStat label="命中" value={String(result.hits)} />
          <WhackResultStat label="金色" value={String(result.goldenHits)} />
          <WhackResultStat label="最高连击" value={String(result.maxCombo)} />
          <WhackResultStat label="打空" value={String(result.misses)} />
          <WhackResultStat label="炸弹" value={String(result.bombs)} />
          <WhackResultStat label="奖励" value={`${result.pointsEarned}`} />
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link
            href="/games"
            className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-white px-5 py-3 text-sm font-black text-emerald-700 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-emerald-50"
          >
            <ArrowLeft className="h-4 w-4" />
            返回游戏中心
          </Link>
          <button
            onClick={onStart}
            disabled={loading || cooldownRemaining > 0}
            className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-emerald-200 transition-all hover:-translate-y-0.5 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-700/40"
            type="button"
          >
            <RotateCcw className="h-4 w-4" />
            {cooldownRemaining > 0 ? `冷却中 ${cooldownRemaining}s` : loading ? '处理中' : '再来一局'}
          </button>
        </div>
      </div>
    </div>
  );
}

function WhackResultStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="whack-result-stat">
      <div className="text-xs font-black text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-black text-slate-950">{value}</div>
    </div>
  );
}

function RuleCard({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <article className="rounded-2xl border border-emerald-100 bg-white/80 p-4">
      <div className="mb-2 flex items-center gap-2 font-black text-slate-950">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 [&_svg]:h-4 [&_svg]:w-4">
          {icon}
        </span>
        {title}
      </div>
      <p className="text-sm leading-6 text-slate-600">{text}</p>
    </article>
  );
}
