'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BookOpen,
  Bomb,
  Clock,
  Flag,
  Gauge,
  Gem,
  Grid3X3,
  HeartCrack,
  Loader2,
  MousePointer2,
  Play,
  Sparkles,
  Trophy,
  X,
} from 'lucide-react';
import {
  MINESWEEPER_DIFFICULTY_CONFIG,
  MINESWEEPER_MAX_BATCH_ACTIONS,
  MINESWEEPER_POINT_REWARD_PERCENT,
  calculateMinesweeperPointReward,
  type MinesweeperAction,
  type MinesweeperCellView,
  type MinesweeperDifficulty,
  type MinesweeperDifficultyConfig,
  type MinesweeperStateView,
} from '@/lib/minesweeper-engine';
import type { MinesweeperGameRecord, MinesweeperSessionView } from '@/lib/minesweeper-types';
import { CancelConfirmModal } from '../_components/CancelConfirmModal';
import { usePausedGameClock } from '../_hooks/usePausedGameClock';
import { fetchGameRequest, gameRequestErrorMessage } from '../_lib/request';

type Phase = 'ready' | 'playing' | 'finished';
type ToolMode = 'reveal' | 'flag';

interface MinesweeperStatus {
  balance: number;
  dailyStats: { gamesPlayed: number; pointsEarned: number } | null;
  inCooldown: boolean;
  cooldownRemaining: number;
  dailyLimit: number;
  pointsLimitReached: boolean;
  difficulties: MinesweeperDifficultyConfig[];
  records: MinesweeperGameRecord[];
  activeSession: MinesweeperSessionView | null;
}

interface StepOutcome {
  message: string;
  status: MinesweeperStateView['status'];
}

interface StepResponse {
  session: MinesweeperSessionView;
  outcome?: StepOutcome;
  outcomes?: StepOutcome[];
  skipped?: number;
}

interface SubmitResponse {
  record: MinesweeperGameRecord;
  pointsEarned: number;
}

interface ApiResponse<T> {
  success?: boolean;
  data?: T;
  message?: string;
}

const NUMBER_COLORS: Record<number, string> = {
  1: 'text-blue-600',
  2: 'text-emerald-600',
  3: 'text-rose-600',
  4: 'text-indigo-700',
  5: 'text-orange-700',
  6: 'text-cyan-700',
  7: 'text-slate-800',
  8: 'text-zinc-950',
};
const STEP_BATCH_FLUSH_DELAY_MS = 8;

async function parseJson<T>(res: Response): Promise<ApiResponse<T> | null> {
  try {
    return (await res.json()) as ApiResponse<T>;
  } catch {
    return null;
  }
}

function formatSeconds(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const min = Math.floor(safe / 60);
  const sec = safe % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function getSessionElapsedSeconds(session: MinesweeperSessionView, state: MinesweeperStateView | null, now = Date.now()): number {
  const endAt = state?.status !== 'playing' && typeof state?.endedAt === 'number'
    ? Math.min(state.endedAt, now)
    : now;
  const duration = Math.max(0, endAt - session.startedAt);
  return state?.status === 'playing' ? Math.floor(duration / 1000) : Math.ceil(duration / 1000);
}

function estimateWonReward(state: MinesweeperStateView, difficulty: MinesweeperDifficulty, elapsedSeconds: number): number {
  if (state.status !== 'won') return 0;
  const config = MINESWEEPER_DIFFICULTY_CONFIG[difficulty];
  const safeCells = state.rows * state.cols - state.mines;
  const revealRate = difficulty === 'hard' ? 8 : difficulty === 'normal' ? 6 : 4;
  const timeRate = difficulty === 'hard' ? 4 : difficulty === 'normal' ? 3 : 2;
  const difficultyBase = config.baseScore;
  const revealPoints = safeCells * revealRate;
  const flagPoints = state.mines * 6;
  const timeBonus = Math.max(0, config.timeLimitSeconds - elapsedSeconds) * timeRate;
  const winBonus = Math.round(config.baseScore * 0.35);
  const score = Math.max(0, Math.min(5000, difficultyBase + revealPoints + flagPoints + timeBonus + winBonus));
  return calculateMinesweeperPointReward(score);
}

function difficultyTone(difficulty: MinesweeperDifficulty): string {
  if (difficulty === 'hard') return 'border-rose-200 bg-rose-50 text-rose-800';
  if (difficulty === 'normal') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-emerald-200 bg-emerald-50 text-emerald-800';
}

function difficultyCardMeta(difficulty: MinesweeperDifficulty): {
  icon: string;
  description: string;
  gradient: string;
  textColor: string;
  borderColor: string;
} {
  if (difficulty === 'hard') {
    return {
      icon: '💣',
      description: '16x16 高密雷区，适合极限推理',
      gradient: 'from-rose-400 to-orange-500',
      textColor: 'text-rose-600',
      borderColor: 'border-rose-200',
    };
  }
  if (difficulty === 'normal') {
    return {
      icon: '🚩',
      description: '12x12 标准局面，节奏更紧',
      gradient: 'from-amber-300 to-orange-400',
      textColor: 'text-amber-600',
      borderColor: 'border-amber-200',
    };
  }
  return {
    icon: '💎',
    description: '9x9 轻量开局，适合热身',
    gradient: 'from-emerald-300 to-teal-400',
    textColor: 'text-emerald-600',
    borderColor: 'border-emerald-200',
  };
}

function cellText(cell: MinesweeperCellView): ReactNode {
  if (cell.display === 'flagged') return <Flag className="h-4 w-4 fill-rose-500 text-rose-500" />;
  if (cell.display === 'mine') return <Bomb className="h-4 w-4 text-slate-800" />;
  if (cell.display === 'exploded') return <Bomb className="h-4 w-4 text-white" />;
  if (cell.display === 'revealed' && cell.adjacent > 0) {
    return <span className={`text-sm font-black ${NUMBER_COLORS[cell.adjacent] ?? 'text-slate-800'}`}>{cell.adjacent}</span>;
  }
  return '';
}

function cellClass(cell: MinesweeperCellView): string {
  const base = 'flex aspect-square min-h-8 w-full items-center justify-center rounded-lg border text-center font-black transition';
  if (cell.display === 'exploded') return `${base} border-rose-500 bg-rose-600 shadow-lg shadow-rose-900/30`;
  if (cell.display === 'mine') return `${base} border-slate-300 bg-slate-200`;
  if (cell.display === 'flagged') return `${base} border-rose-200 bg-rose-50`;
  if (cell.display === 'revealed') return `${base} border-slate-200 bg-slate-100`;
  return `${base} border-slate-300 bg-white hover:border-cyan-300 hover:bg-cyan-50`;
}

function optimisticCellView(cell: MinesweeperCellView, pendingAction: MinesweeperAction | undefined): MinesweeperCellView {
  if (pendingAction?.type !== 'flag') return cell;
  if (cell.display === 'hidden') return { ...cell, display: 'flagged' };
  if (cell.display === 'flagged') return { ...cell, display: 'hidden' };
  return cell;
}

function pendingCellClass(cell: MinesweeperCellView, pendingAction: MinesweeperAction | undefined): string {
  const base = cellClass(cell);
  if (!pendingAction) return base;
  return `${base} mine-cell-pending-${pendingAction.type}`;
}

function pendingCellText(cell: MinesweeperCellView, pendingAction: MinesweeperAction | undefined): ReactNode {
  if (pendingAction?.type === 'reveal' || pendingAction?.type === 'chord') {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-600" />;
  }
  return cellText(cell);
}

function stepPositionKey(action: MinesweeperAction): string {
  return `${action.position.row}:${action.position.col}`;
}

function isQueuedStepUseful(state: MinesweeperStateView, action: MinesweeperAction): boolean {
  if (state.status !== 'playing') return false;
  const cell = state.cells.find((item) => item.row === action.position.row && item.col === action.position.col);
  if (!cell) return false;
  if (action.type === 'reveal') return cell.display === 'hidden';
  if (action.type === 'flag') return cell.display === 'hidden' || cell.display === 'flagged';
  return cell.display === 'revealed' && cell.adjacent > 0;
}

export default function MinesweeperPage() {
  const [phase, setPhase] = useState<Phase>('ready');
  const [status, setStatus] = useState<MinesweeperStatus | null>(null);
  const [session, setSession] = useState<MinesweeperSessionView | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<MinesweeperDifficulty>('easy');
  const [mode, setMode] = useState<ToolMode>('reveal');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pendingStepCount, setPendingStepCount] = useState(0);
  const [pendingCellActions, setPendingCellActions] = useState<Map<string, MinesweeperAction>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('选择难度开始扫雷');
  const [result, setResult] = useState<MinesweeperGameRecord | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const submittingRef = useRef(false);
  const sessionRef = useRef<MinesweeperSessionView | null>(null);
  const stepQueueRef = useRef<MinesweeperAction[]>([]);
  const pendingCellActionsRef = useRef<Map<string, MinesweeperAction>>(new Map());
  const processingStepRef = useRef(false);
  const stepFlushTimerRef = useRef<number | null>(null);
  const gameNow = usePausedGameClock(showCancelConfirm, session?.sessionId);

  const state = session?.state ?? null;
  const difficulties = status?.difficulties?.length
    ? status.difficulties
    : Object.values(MINESWEEPER_DIFFICULTY_CONFIG);

  const progress = useMemo(() => {
    if (!state) return 0;
    const safe = state.rows * state.cols - state.mines;
    return safe > 0 ? Math.round((state.revealedSafe / safe) * 100) : 0;
  }, [state]);

  const syncPendingStepState = useCallback(() => {
    setPendingStepCount(pendingCellActionsRef.current.size);
    setPendingCellActions(new Map(pendingCellActionsRef.current));
  }, []);

  const clearStepQueue = useCallback(() => {
    if (stepFlushTimerRef.current !== null) {
      window.clearTimeout(stepFlushTimerRef.current);
      stepFlushTimerRef.current = null;
    }
    stepQueueRef.current = [];
    pendingCellActionsRef.current.clear();
    syncPendingStepState();
  }, [syncPendingStepState]);

  useEffect(() => {
    sessionRef.current = session;
    if (!session || session.state.status !== 'playing') {
      clearStepQueue();
    }
  }, [clearStepQueue, session]);

  useEffect(() => () => {
    if (stepFlushTimerRef.current !== null) {
      window.clearTimeout(stepFlushTimerRef.current);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetchGameRequest('/api/games/minesweeper/status');
      const data = await parseJson<MinesweeperStatus>(res);
      if (!res.ok || !data?.success || !data.data) {
        throw new Error(data?.message ?? (res.status === 401 ? '请先登录后开始游戏' : '加载扫雷状态失败'));
      }
      setStatus(data.data);
      setError(null);
      if (data.data.activeSession && (!session || session.sessionId === data.data.activeSession.sessionId)) {
        sessionRef.current = data.data.activeSession;
        setSession(data.data.activeSession);
        setSelectedDifficulty(data.data.activeSession.difficulty);
        setPhase('playing');
        setMessage(session ? '已同步服务端雷区进度' : '已恢复正在进行的扫雷');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误，请稍后重试');
    }
  }, [session]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (!session || phase !== 'playing') {
      setElapsedSeconds(0);
      return;
    }
    const update = () => setElapsedSeconds(getSessionElapsedSeconds(session, state, gameNow()));
    if (state?.status !== 'playing') {
      update();
      return;
    }
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [gameNow, phase, session, state]);

  useEffect(() => {
    if (phase === 'playing' || !status?.inCooldown) return;
    const timer = window.setInterval(() => {
      void fetchStatus();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [fetchStatus, phase, status?.inCooldown]);

  const startGame = useCallback(async (difficulty = selectedDifficulty, restart = false) => {
    clearStepQueue();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetchGameRequest('/api/games/minesweeper/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ difficulty, restart }),
      });
      const data = await parseJson<MinesweeperSessionView>(res);
      if (!res.ok || !data?.success || !data.data) {
        throw new Error(data?.message ?? `开始游戏失败（HTTP ${res.status}）`);
      }
      sessionRef.current = data.data;
      setSession(data.data);
      setSelectedDifficulty(data.data.difficulty);
      setPhase('playing');
      setMode('reveal');
      setMessage('首点安全，先翻开一个区域');
      void fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : '开始游戏失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [clearStepQueue, fetchStatus, selectedDifficulty]);

  const cancelGame = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchGameRequest('/api/games/minesweeper/cancel', { method: 'POST' });
      const data = await parseJson<unknown>(res);
      if (!res.ok || !data?.success) {
        throw new Error(data?.message ?? '取消游戏失败');
      }
      clearStepQueue();
      sessionRef.current = null;
      setSession(null);
      setPhase('ready');
      setMessage('本局已取消');
      void fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : '取消游戏失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [clearStepQueue, fetchStatus]);

  const confirmCancelGame = useCallback(async () => {
    await cancelGame();
    setShowCancelConfirm(false);
  }, [cancelGame]);

  const submitResult = useCallback(async (targetSession: MinesweeperSessionView) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchGameRequest('/api/games/minesweeper/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: targetSession.sessionId }),
      });
      const data = await parseJson<SubmitResponse>(res);
      if (!res.ok || !data?.success || !data.data) {
        throw new Error(data?.message ?? `结算失败（HTTP ${res.status}）`);
      }
      clearStepQueue();
      setResult(data.data.record);
      sessionRef.current = null;
      setSession(null);
      setPhase('finished');
      setMessage(`本局获得 ${data.data.pointsEarned} 积分`);
      void fetchStatus();
    } catch (err) {
      setError(gameRequestErrorMessage(err, '结算请求超时，请检查网络后重试', '结算失败，请稍后重试'));
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  }, [clearStepQueue, fetchStatus]);

  const processStepQueue = useCallback(async () => {
    if (processingStepRef.current) return;
    if (stepFlushTimerRef.current !== null) {
      window.clearTimeout(stepFlushTimerRef.current);
      stepFlushTimerRef.current = null;
    }
    processingStepRef.current = true;
    try {
      while (stepQueueRef.current.length > 0) {
        const currentSession = sessionRef.current;
        if (!currentSession || currentSession.state.status !== 'playing') {
          clearStepQueue();
          break;
        }

        const actions: MinesweeperAction[] = [];
        while (actions.length < MINESWEEPER_MAX_BATCH_ACTIONS && stepQueueRef.current.length > 0) {
          const action = stepQueueRef.current.shift();
          if (!action) break;
          const actionKey = stepPositionKey(action);
          if (!isQueuedStepUseful(currentSession.state, action)) {
            pendingCellActionsRef.current.delete(actionKey);
            continue;
          }
          actions.push(action);
        }

        if (actions.length === 0) {
          syncPendingStepState();
          continue;
        }

        syncPendingStepState();
        setError(null);
        const res = await fetchGameRequest('/api/games/minesweeper/step', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: currentSession.sessionId, actions }),
        });
        const data = await parseJson<StepResponse>(res);
        if (!res.ok || !data?.success || !data.data) {
          throw new Error(data?.message ?? '操作失败');
        }
        if (sessionRef.current?.sessionId !== currentSession.sessionId) {
          clearStepQueue();
          break;
        }

        for (const action of actions) {
          pendingCellActionsRef.current.delete(stepPositionKey(action));
        }
        const outcomes = data.data.outcomes ?? (data.data.outcome ? [data.data.outcome] : []);
        const lastOutcome = outcomes.length > 0 ? outcomes[outcomes.length - 1] : undefined;
        sessionRef.current = data.data.session;
        setSession(data.data.session);
        setMessage(lastOutcome?.message ?? '棋盘已同步');
        if (data.data.session.state.status !== 'playing') {
          setMode('reveal');
          stepQueueRef.current = [];
          pendingCellActionsRef.current.clear();
          break;
        }
      }
    } catch (err) {
      stepQueueRef.current = [];
      pendingCellActionsRef.current.clear();
      setError(gameRequestErrorMessage(err, '操作同步超时，正在恢复服务端进度', '操作失败，请稍后重试'));
      await fetchStatus();
    } finally {
      processingStepRef.current = false;
      syncPendingStepState();
    }
  }, [clearStepQueue, fetchStatus, syncPendingStepState]);

  const enqueueStep = useCallback((action: MinesweeperAction) => {
    if (showCancelConfirm) return;
    const currentSession = sessionRef.current;
    if (!currentSession || !isQueuedStepUseful(currentSession.state, action)) return;
    const actionKey = stepPositionKey(action);
    if (pendingCellActionsRef.current.has(actionKey)) return;
    stepQueueRef.current.push(action);
    pendingCellActionsRef.current.set(actionKey, action);
    syncPendingStepState();
    if (!processingStepRef.current && stepFlushTimerRef.current === null) {
      stepFlushTimerRef.current = window.setTimeout(() => {
        stepFlushTimerRef.current = null;
        void processStepQueue();
      }, STEP_BATCH_FLUSH_DELAY_MS);
    }
  }, [processStepQueue, showCancelConfirm, syncPendingStepState]);

  const handleCellClick = useCallback((cell: MinesweeperCellView) => {
    if (showCancelConfirm) return;
    if (!state || state.status !== 'playing') return;
    if (mode === 'flag') {
      enqueueStep({ type: 'flag', position: { row: cell.row, col: cell.col } });
      return;
    }
    if (cell.display === 'revealed' && cell.adjacent > 0) {
      enqueueStep({ type: 'chord', position: { row: cell.row, col: cell.col } });
      return;
    }
    if (cell.display === 'hidden') {
      enqueueStep({ type: 'reveal', position: { row: cell.row, col: cell.col } });
    }
  }, [enqueueStep, mode, showCancelConfirm, state]);

  const handleCellContextMenu = useCallback((event: MouseEvent<HTMLButtonElement>, cell: MinesweeperCellView) => {
    event.preventDefault();
    if (showCancelConfirm) return;
    if (!state || state.status !== 'playing') return;
    if (cell.display === 'hidden' || cell.display === 'flagged') {
      enqueueStep({ type: 'flag', position: { row: cell.row, col: cell.col } });
    }
  }, [enqueueStep, showCancelConfirm, state]);

  const boardMinWidth = state ? Math.max(288, state.cols * 32) : 288;
  const phaseLabel = phase === 'playing' ? '扫雷指令' : phase === 'finished' ? '本局结算' : '出发准备';
  const tacticalLine = state?.status === 'won'
    ? '安全格已全部清除，可以结算成绩。'
    : state?.status === 'lost'
      ? '本局已触雷，可以结算成绩。'
      : phase === 'playing'
        ? '翻开安全格、标记疑似地雷，数字格可快速展开。'
        : '选择难度后开始，首点和周围一圈都会避雷。';

  return (
    <div className="mine-page">
      <div className="mine-mesh-bg" aria-hidden />
      <div className="mine-stars" aria-hidden>
        <span style={{ top: '8%', left: '5%', fontSize: 14 }}>✦</span>
        <span style={{ top: '20%', left: '92%', fontSize: 11, animationDelay: '1s' }}>✦</span>
        <span style={{ top: '42%', left: '4%', fontSize: 16, animationDelay: '2.5s' }}>✧</span>
        <span style={{ top: '72%', left: '94%', fontSize: 12, animationDelay: '0.7s' }}>✧</span>
      </div>

      <header className="mine-topbar">
        <Link href="/games" className="mine-exit-btn">
          <span className="arrow">
            <ArrowLeft size={14} strokeWidth={2.4} />
          </span>
          EXIT
        </Link>
      </header>

      <main className="mine-container">
        {error && (
          <div className="mine-error-banner" role="alert">
            {error}
          </div>
        )}

        <section className="mine-command-bar" aria-live="polite">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-black text-emerald-700">
              <Bomb className="h-4 w-4" />
              <span>{phaseLabel}</span>
              <span className="text-slate-300">/</span>
              <span className="text-slate-500">{tacticalLine}</span>
            </div>
            <p className="truncate text-lg font-black text-slate-950 sm:text-xl">{message}</p>
          </div>
          <div className="mine-command-actions">
            <button
              onClick={() => setShowRules(true)}
              type="button"
              className="inline-flex flex-none items-center justify-center gap-1.5 rounded-full border border-emerald-200 bg-white px-4 py-2 text-sm font-bold text-emerald-700 transition-colors hover:bg-emerald-50"
            >
              <BookOpen className="h-4 w-4" />
              规则
            </button>
            {session && (
              <button
                onClick={() => setShowCancelConfirm(true)}
                disabled={loading || pendingStepCount > 0}
                className="inline-flex flex-none items-center justify-center gap-1.5 rounded-full border border-rose-200 bg-white px-4 py-2 text-sm font-bold text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-50"
                type="button"
              >
                <X className="h-4 w-4" />
                取消
              </button>
            )}
          </div>
        </section>

        {phase !== 'playing' && (
          <div className="mine-ready-layout">
            <section className="glass-card stage-card">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <h2 className="section-title">
                  <span className="st-icon">
                    <Bomb size={18} />
                  </span>
                  选择难度
                </h2>
                <span className="mine-cute-pill">
                  <Bomb className="h-4 w-4" />
                  不同难度 = 不同雷区密度
                </span>
              </div>
              <div className="mine-difficulty-wrap">
                <h3 className="text-center text-3xl font-black tracking-tight text-slate-800">
                  选择你的挑战难度
                </h3>
                <div className="mine-difficulty-grid">
                  {difficulties.map((config) => {
                    const selected = selectedDifficulty === config.id;
                    const meta = difficultyCardMeta(config.id);
                    return (
                      <button
                        key={config.id}
                        onClick={() => {
                          if (selected) {
                            void startGame(config.id, phase === 'finished');
                            return;
                          }
                          setSelectedDifficulty(config.id);
                        }}
                        disabled={loading || Boolean(status?.inCooldown)}
                        className={`mine-difficulty-card group ${meta.borderColor} ${selected ? 'is-selected' : ''}`}
                        style={{ animationDelay: `${difficulties.indexOf(config) * 100}ms` }}
                        type="button"
                      >
                        <div className={`mine-difficulty-glow bg-gradient-to-br ${meta.gradient}`} />
                        <div className="relative z-10">
                          <div className="mb-4 flex items-start justify-between gap-3">
                            <div className="mine-difficulty-icon">{meta.icon}</div>
                            <div className={`mine-size-pill ${meta.textColor}`}>
                              {config.rows} × {config.cols}
                            </div>
                          </div>

                          <h3 className={`mb-2 text-3xl font-black transition-colors group-hover:text-white ${meta.textColor}`}>
                            {config.label}
                          </h3>

                          <p className="mb-6 text-sm font-bold leading-relaxed text-slate-500 transition-colors group-hover:text-white/90">
                            {meta.description}
                          </p>

                          <div className={`mine-selected-start ${selected ? 'is-visible' : ''}`}>
                            {loading && selected ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                            {selected ? (status?.inCooldown ? `冷却 ${status.cooldownRemaining}s` : '再点开始') : '轻触选择'}
                          </div>

                          <div className="space-y-2 border-t border-slate-100 pt-4 transition-colors group-hover:border-white/20">
                            <div className="flex justify-between text-sm">
                              <span className="font-bold text-slate-400 transition-colors group-hover:text-white/70">
                                雷数
                              </span>
                              <span className="rounded-lg bg-white/40 px-2 font-black text-slate-700 transition-colors group-hover:bg-white/20 group-hover:text-white">
                                {config.mines} 颗
                              </span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="font-bold text-slate-400 transition-colors group-hover:text-white/70">
                                参考时间
                              </span>
                              <span className="rounded-lg bg-white/40 px-2 font-black text-slate-700 transition-colors group-hover:bg-white/20 group-hover:text-white">
                                {formatSeconds(config.timeLimitSeconds)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          </div>
        )}

        {phase === 'playing' && state && session && (
          <div className="mine-game-layout">
            <section className="glass-card stage-card mine-board-card">
              <div className="mine-board-header">
                <div className="mine-board-meta">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-3 py-1 text-xs font-black ${difficultyTone(session.difficulty)}`}>
                      {MINESWEEPER_DIFFICULTY_CONFIG[session.difficulty].label}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                      {state.status === 'playing' ? '进行中' : state.status === 'won' ? '成功' : '触雷'}
                    </span>
                    {pendingStepCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-3 py-1 text-xs font-black text-cyan-700">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        同步中 {pendingStepCount}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm font-bold text-slate-600">{message}</p>
                </div>

                <div className="mine-tool-switch">
                  <button
                    onClick={() => setMode('reveal')}
                    disabled={showCancelConfirm}
                    className={`mine-tool-button inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black transition ${mode === 'reveal' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    <MousePointer2 className="h-4 w-4" />
                    翻开
                  </button>
                  <button
                    onClick={() => setMode('flag')}
                    disabled={showCancelConfirm}
                    className={`mine-tool-button inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black transition ${mode === 'flag' ? 'bg-white text-rose-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    <Flag className="h-4 w-4" />
                    插旗
                  </button>
                </div>
              </div>

              <div className="mine-board-scroll">
                <div
                  className="mine-board-grid"
                  aria-busy={pendingStepCount > 0}
                  style={{
                    gridTemplateColumns: `repeat(${state.cols}, minmax(28px, 1fr))`,
                    minWidth: boardMinWidth,
                  }}
                >
                  {state.cells.map((cell) => {
                    const cellKey = `${cell.row}:${cell.col}`;
                    const pendingAction = pendingCellActions.get(cellKey);
                    const visibleCell = optimisticCellView(cell, pendingAction);
                    return (
                      <button
                        key={`${cell.row}-${cell.col}`}
                        onClick={() => handleCellClick(cell)}
                        onContextMenu={(event) => handleCellContextMenu(event, cell)}
                        disabled={showCancelConfirm || state.status !== 'playing' || cell.display === 'mine' || cell.display === 'exploded'}
                        className={pendingCellClass(visibleCell, pendingAction)}
                        aria-label={`第 ${cell.row + 1} 行第 ${cell.col + 1} 列`}
                      >
                        {pendingCellText(visibleCell, pendingAction)}
                      </button>
                    );
                  })}
                </div>
              </div>

            </section>

            <aside className="mine-side-panel">
              <section className="glass-card stage-card">
                <h2 className="section-title">
                  <span className="st-icon">
                    <Gauge size={18} />
                  </span>
                  局内状态
                </h2>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <BattleStat icon={<Clock />} label="用时" value={formatSeconds(elapsedSeconds)} />
                  <BattleStat icon={<Bomb />} label="剩余雷" value={String(Math.max(0, state.mines - state.flagsUsed))} />
                  <BattleStat icon={<Flag />} label="旗帜" value={`${state.flagsUsed}/${state.mines}`} />
                  <BattleStat icon={<Gauge />} label="进度" value={`${progress}%`} />
                  <BattleStat icon={<Grid3X3 />} label="步数" value={String(state.moves)} />
                  <BattleStat icon={<Trophy />} label="安全格" value={String(state.revealedSafe)} />
                </div>
              </section>
            </aside>
          </div>
        )}

        {phase === 'playing' && state && session && state.status !== 'playing' && (
          <MinesweeperOutcomeModal
            state={state}
            session={session}
            loading={loading}
            elapsedSeconds={elapsedSeconds}
            onSubmit={() => void submitResult(session)}
          />
        )}

        {phase === 'finished' && result && (
          <MinesweeperSettlementModal
            result={result}
            onClose={() => setResult(null)}
          />
        )}

        {showRules && <RulesModal onClose={() => setShowRules(false)} />}
        <CancelConfirmModal
          open={showCancelConfirm}
          loading={loading || pendingStepCount > 0}
          title="确认放弃扫雷？"
          description="当前雷区进度会被取消，本局不会进入结算。"
          detail="已翻开的格子、旗帜标记和本局用时都会丢失。"
          onConfirm={() => void confirmCancelGame()}
          onClose={() => setShowCancelConfirm(false)}
        />
      </main>

      <style jsx global>{`
        .mine-page {
          min-height: 100vh;
          background: #eefcf8;
          color: #0f172a;
          position: relative;
          overflow-x: hidden;
        }
        .mine-page a {
          color: inherit;
          text-decoration: none;
        }
        .mine-page .mine-mesh-bg {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          background-image:
            radial-gradient(circle at 12% 18%, rgba(167, 243, 208, 0.7) 0%, transparent 48%),
            radial-gradient(circle at 88% 24%, rgba(191, 219, 254, 0.58) 0%, transparent 50%),
            radial-gradient(circle at 54% 100%, rgba(16, 185, 129, 0.28) 0%, transparent 56%);
        }
        .mine-page .mine-stars {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          overflow: hidden;
        }
        .mine-page .mine-stars span {
          position: absolute;
          color: rgba(255, 255, 255, 0.78);
          animation: mine-twinkle 3s ease-in-out infinite;
        }
        @keyframes mine-twinkle {
          0%, 100% { opacity: 0.28; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.32); }
        }
        .mine-page .mine-topbar {
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
        .mine-page .mine-exit-btn {
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
        .mine-page .mine-exit-btn .arrow {
          display: inline-flex;
          width: 30px;
          height: 30px;
          flex-shrink: 0;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          color: #fff;
          background: linear-gradient(135deg, #34d399, #047857);
          box-shadow: 0 8px 14px rgba(4, 120, 87, 0.28);
        }
        .mine-page .mine-container {
          position: relative;
          z-index: 1;
          max-width: 1360px;
          margin: 0 auto;
          padding: 22px 48px 92px;
          display: flex;
          flex-direction: column;
          gap: 22px;
        }
        .mine-page .mine-error-banner {
          padding: 13px 18px;
          border-radius: 18px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #b91c1c;
          font-size: 14px;
          font-weight: 800;
        }
        .mine-page .mine-command-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          border-radius: 24px;
          border: 1px solid rgba(255, 255, 255, 0.95);
          background: rgba(255, 255, 255, 0.86);
          padding: 16px 18px;
          box-shadow: 0 18px 36px rgba(15, 23, 42, 0.06);
          backdrop-filter: blur(22px);
        }
        .mine-page .mine-command-actions {
          display: flex;
          flex: none;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 8px;
        }
        .mine-page .glass-card {
          background: rgba(255, 255, 255, 0.88);
          border: 1px solid rgba(255, 255, 255, 0.95);
          border-radius: 30px;
          box-shadow: 0 24px 48px rgba(15, 23, 42, 0.07);
          backdrop-filter: blur(24px);
        }
        .mine-page .stage-card {
          padding: 24px;
        }
        .mine-page .section-title {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 0;
          font-size: 20px;
          font-weight: 950;
          color: #0f172a;
        }
        .mine-page .st-icon {
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
        .mine-page .mine-cute-pill {
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
        .mine-page .mine-ready-layout {
          display: block;
        }
        .mine-page .mine-difficulty-wrap {
          width: 100%;
          max-width: 940px;
          margin: 0 auto;
        }
        .mine-page .mine-difficulty-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 24px;
          margin-top: 34px;
        }
        .mine-page .mine-difficulty-card {
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
          animation: mine-card-in 0.42s ease both;
        }
        .mine-page .mine-difficulty-card:hover {
          transform: translateY(-8px);
          border-color: #fff;
          box-shadow: 0 24px 44px rgba(15, 23, 42, 0.1);
        }
        .mine-page .mine-difficulty-card:active {
          transform: scale(0.98);
        }
        .mine-page .mine-difficulty-card.is-selected {
          border-color: #fff;
          box-shadow: 0 20px 42px rgba(16, 185, 129, 0.18), 0 0 0 3px rgba(16, 185, 129, 0.24);
        }
        .mine-page .mine-difficulty-card:disabled {
          cursor: not-allowed;
          opacity: 0.5;
          transform: none;
        }
        .mine-page .mine-difficulty-glow {
          position: absolute;
          inset: 0;
          opacity: 0;
          transition: opacity 0.5s ease;
        }
        .mine-page .mine-difficulty-card:hover .mine-difficulty-glow,
        .mine-page .mine-difficulty-card.is-selected .mine-difficulty-glow {
          opacity: 1;
        }
        .mine-page .mine-difficulty-icon {
          font-size: 56px;
          line-height: 1;
          filter: drop-shadow(0 8px 12px rgba(15, 23, 42, 0.1));
          transform-origin: left center;
          transition: transform 0.3s ease;
        }
        .mine-page .mine-difficulty-card:hover .mine-difficulty-icon {
          transform: scale(1.1) rotate(10deg);
        }
        .mine-page .mine-size-pill {
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.52);
          padding: 5px 11px;
          font-size: 11px;
          font-weight: 950;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          backdrop-filter: blur(10px);
          transition: background 0.3s ease, color 0.3s ease;
        }
        .mine-page .mine-difficulty-card:hover .mine-size-pill,
        .mine-page .mine-difficulty-card.is-selected .mine-size-pill {
          background: rgba(255, 255, 255, 0.2);
          color: #fff;
        }
        .mine-page .mine-selected-start {
          display: inline-flex;
          min-height: 34px;
          align-items: center;
          gap: 8px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.68);
          padding: 8px 12px;
          color: #334155;
          font-size: 12px;
          font-weight: 950;
          opacity: 0.72;
          transition: background 0.3s ease, color 0.3s ease, opacity 0.3s ease;
        }
        .mine-page .mine-difficulty-card:hover .mine-selected-start,
        .mine-page .mine-selected-start.is-visible {
          background: rgba(255, 255, 255, 0.2);
          color: #fff;
          opacity: 1;
        }
        @keyframes mine-card-in {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .mine-page .mine-game-layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(280px, 330px);
          gap: 24px;
          align-items: start;
        }
        .mine-page .mine-board-card {
          min-width: 0;
        }
        .mine-page .mine-board-header {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 12px;
          align-items: start;
          margin-bottom: 16px;
        }
        .mine-page .mine-board-meta {
          min-width: 0;
        }
        .mine-page .mine-board-meta p {
          overflow-wrap: anywhere;
        }
        .mine-page .mine-tool-switch {
          display: inline-grid;
          grid-template-columns: repeat(2, minmax(72px, 1fr));
          width: auto;
          min-width: 168px;
          min-height: 42px;
          flex: none;
          align-self: start;
          border-radius: 16px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          padding: 4px;
        }
        .mine-page .mine-tool-button {
          min-height: 34px;
          justify-content: center;
          white-space: nowrap;
        }
        .mine-page .mine-board-scroll {
          max-width: 100%;
          overflow-x: auto;
          border-radius: 24px;
          border: 1px solid #d1fae5;
          background: #d1fae5;
          padding: 8px;
          scrollbar-color: #10b981 #ecfdf5;
          -webkit-overflow-scrolling: touch;
        }
        .mine-page .mine-board-grid {
          display: grid;
          gap: 4px;
        }
        .mine-page .mine-cell-pending-reveal,
        .mine-page .mine-cell-pending-chord {
          border-color: #22d3ee;
          box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.28);
          transform: scale(0.96);
        }
        .mine-page .mine-cell-pending-flag {
          box-shadow: 0 0 0 2px rgba(244, 63, 94, 0.22);
          transform: scale(0.96);
        }
        .mine-page .mine-side-panel {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .mine-page .mine-modal-overlay {
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
        .mine-page .mine-result-modal {
          width: min(540px, 100%);
          max-height: min(86vh, 680px);
          overflow-y: auto;
          border-radius: 28px;
          border: 1px solid rgba(167, 243, 208, 0.95);
          background: linear-gradient(180deg, #fff 0%, #ecfdf5 100%);
          padding: 24px;
          box-shadow: 0 30px 70px rgba(15, 23, 42, 0.3);
        }
        .mine-page .mine-result-modal.lost {
          border-color: rgba(254, 205, 211, 0.95);
          background: linear-gradient(180deg, #fff 0%, #fff1f2 100%);
        }
        .mine-page .mine-result-icon {
          display: flex;
          width: 72px;
          height: 72px;
          align-items: center;
          justify-content: center;
          border-radius: 24px;
          color: #fff;
          box-shadow: 0 18px 34px rgba(15, 23, 42, 0.16);
        }
        .mine-page .mine-result-icon.won {
          background: linear-gradient(135deg, #10b981, #047857);
        }
        .mine-page .mine-result-icon.lost {
          background: linear-gradient(135deg, #fb7185, #be123c);
        }
        .mine-page .mine-result-stats {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          margin-top: 20px;
        }
        .mine-page .mine-result-stat {
          border-radius: 18px;
          border: 1px solid rgba(226, 232, 240, 0.9);
          background: rgba(255, 255, 255, 0.86);
          padding: 12px;
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.05);
        }
        @media (max-width: 1080px) {
          .mine-page .mine-topbar {
            padding: 14px 22px;
          }
          .mine-page .mine-container {
            padding: 22px 22px 82px;
          }
          .mine-page .mine-ready-layout,
          .mine-page .mine-game-layout {
            grid-template-columns: 1fr;
          }
          .mine-page .mine-difficulty-grid {
            grid-template-columns: 1fr;
            gap: 16px;
          }
        }
        @media (max-width: 768px) {
          .mine-page .mine-topbar {
            padding: 12px 14px;
          }
          .mine-page .mine-exit-btn {
            padding: 7px 14px 7px 7px;
            font-size: 12px;
          }
          .mine-page .mine-exit-btn .arrow {
            width: 26px;
            height: 26px;
          }
          .mine-page .mine-container {
            padding: 16px 14px 92px;
            gap: 18px;
          }
          .mine-page .stage-card {
            padding: 14px;
            border-radius: 24px;
          }
          .mine-page .mine-command-bar {
            align-items: stretch;
            flex-direction: column;
            padding: 14px;
          }
          .mine-page .mine-command-bar p {
            white-space: normal;
          }
          .mine-page .mine-command-actions,
          .mine-page .mine-command-actions button {
            width: 100%;
          }
          .mine-page .mine-board-header {
            display: flex;
            flex-direction: column;
            align-items: stretch;
            gap: 10px;
            margin-bottom: 12px;
          }
          .mine-page .mine-board-meta {
            width: 100%;
          }
          .mine-page .mine-tool-switch {
            width: 100%;
            min-width: 0;
            min-height: 44px;
            position: static;
            flex-shrink: 0;
          }
          .mine-page .mine-tool-button {
            min-height: 36px;
            padding: 8px 12px;
          }
          .mine-page .mine-board-scroll {
            border-radius: 18px;
            margin-top: 0;
            overscroll-behavior-inline: contain;
            padding: 6px;
          }
          .mine-page .mine-cute-pill {
            width: 100%;
            justify-content: center;
          }
          .mine-page .mine-difficulty-wrap h3 {
            font-size: 24px;
          }
          .mine-page .mine-difficulty-grid {
            margin-top: 22px;
          }
          .mine-page .mine-difficulty-card {
            min-height: 218px;
            border-radius: 26px;
            padding: 20px;
          }
          .mine-page .mine-result-modal {
            border-radius: 22px;
            padding: 18px;
          }
          .mine-page .mine-result-stats {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

function MinesweeperOutcomeModal({
  state,
  session,
  loading,
  elapsedSeconds,
  onSubmit,
}: {
  state: MinesweeperStateView;
  session: MinesweeperSessionView;
  loading: boolean;
  elapsedSeconds: number;
  onSubmit: () => void;
}) {
  const won = state.status === 'won';
  const config = MINESWEEPER_DIFFICULTY_CONFIG[session.difficulty];
  const safeCells = state.rows * state.cols - state.mines;
  const rewardPreview = session.pointRewardPreview
    ?? (session.scorePreview ? calculateMinesweeperPointReward(session.scorePreview.total) : estimateWonReward(state, session.difficulty, elapsedSeconds));

  return (
    <div className="mine-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="minesweeper-outcome-title">
      <div className={`mine-result-modal ${won ? 'won' : 'lost'}`}>
        <div className="flex flex-col items-center text-center">
          <div className={`mine-result-icon ${won ? 'won' : 'lost'}`}>
            {won ? <Trophy className="h-9 w-9" /> : <Bomb className="h-9 w-9" />}
          </div>
          <div className="mt-5 text-xs font-black uppercase tracking-wider text-emerald-700/80">
            胜负结果
          </div>
          <h2 id="minesweeper-outcome-title" className="mt-1 text-2xl font-black text-slate-950">
            {won ? '扫雷成功' : '本局触雷'}
          </h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-slate-600">
            {won ? '安全格已经全部清除，可以结算本局成绩。' : '雷区已经揭示，可以结算本局成绩。'}
          </p>
        </div>

        <div className="mine-result-stats">
          <MineResultStat label="难度" value={config.label} />
          <MineResultStat label="用时" value={formatSeconds(elapsedSeconds)} />
          <MineResultStat label="安全格" value={`${state.revealedSafe}/${safeCells}`} />
          <MineResultStat label="预计奖励" value={`${rewardPreview} 积分`} />
        </div>

        <button
          onClick={onSubmit}
          disabled={loading}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-emerald-200 transition-all hover:-translate-y-0.5 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {loading ? '结算中' : '结算成绩'}
        </button>
      </div>
    </div>
  );
}

function MinesweeperSettlementModal({
  result,
  onClose,
}: {
  result: MinesweeperGameRecord;
  onClose: () => void;
}) {
  const config = MINESWEEPER_DIFFICULTY_CONFIG[result.difficulty];
  const expectedReward = calculateMinesweeperPointReward(result.score);

  return (
    <div className="mine-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="minesweeper-settlement-title">
      <div className={`mine-result-modal ${result.won ? 'won' : 'lost'}`}>
        <div className="flex flex-col items-center text-center">
          <div className={`mine-result-icon ${result.won ? 'won' : 'lost'}`}>
            {result.won ? <Trophy className="h-9 w-9" /> : <Bomb className="h-9 w-9" />}
          </div>
          <div className="mt-5 text-xs font-black uppercase tracking-wider text-emerald-700/80">
            本局结算
          </div>
          <h2 id="minesweeper-settlement-title" className="mt-1 text-2xl font-black text-slate-950">
            {result.won ? '胜利结算完成' : '触雷结算完成'}
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            本局得分 {result.score}，按得分的 {MINESWEEPER_POINT_REWARD_PERCENT}% 结算，获得 {result.pointsEarned} 福利积分。
          </p>
        </div>

        <div className="mt-5 rounded-2xl border border-emerald-100 bg-white px-5 py-3 text-center text-sm font-black text-emerald-700 shadow-sm">
          最终福利积分 = floor({result.score} × {MINESWEEPER_POINT_REWARD_PERCENT}%) = {expectedReward}
          {result.pointsEarned !== expectedReward ? `，实际到账 ${result.pointsEarned}` : ''}
        </div>

        <div className="mine-result-stats">
          <MineResultStat label="难度" value={config.label} />
          <MineResultStat label="用时" value={formatSeconds(Math.ceil(result.duration / 1000))} />
          <MineResultStat label="步数" value={String(result.moves)} />
          <MineResultStat label="旗帜" value={`${result.flagsUsed}/${result.mines}`} />
          <MineResultStat label="安全格" value={String(result.revealedSafe)} />
          <MineResultStat label="得分" value={String(result.score)} />
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
            onClick={onClose}
            className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-emerald-200 transition-all hover:-translate-y-0.5 hover:bg-emerald-500"
            type="button"
          >
            <Play className="h-4 w-4" />
            继续选择难度
          </button>
        </div>
      </div>
    </div>
  );
}

function MineResultStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="mine-result-stat">
      <div className="text-xs font-black text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-black text-slate-950">{value}</div>
    </div>
  );
}

function BattleStat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
      <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
        <span className="text-cyan-700 [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
        {label}
      </div>
      <div className="mt-2 text-xl font-black text-slate-950">{value}</div>
    </div>
  );
}

function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="max-h-[88vh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black text-slate-950">扫雷规则</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              目标是找出所有地雷，并翻开全部安全格。第一下翻开永远不会踩雷，且会保护周围一圈。
            </p>
          </div>
          <button onClick={onClose} className="rounded-full border border-slate-200 bg-slate-50 p-2 text-slate-600 transition hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <RuleBlock title="难度">
            {Object.values(MINESWEEPER_DIFFICULTY_CONFIG).map((config) => (
              <RuleLine
                key={config.id}
                icon={<Bomb />}
                text={`${config.label}：${config.rows}×${config.cols}，${config.mines} 颗雷，参考时间 ${formatSeconds(config.timeLimitSeconds)}。`}
              />
            ))}
          </RuleBlock>

          <RuleBlock title="操作">
            <RuleLine icon={<MousePointer2 />} text="翻开模式：点击隐藏格翻开；点击已翻开的数字格会尝试快速展开周围格。" />
            <RuleLine icon={<Flag />} text="插旗模式：点击隐藏格插旗，再点一次移除旗帜；桌面端也支持右键插旗。" />
            <RuleLine icon={<HeartCrack />} text="踩到地雷会失败并揭示雷区；清空所有安全格会胜利。" />
          </RuleBlock>
        </div>

        <RuleBlock title="数字含义">
          <RuleLine icon={<Grid3X3 />} text="数字表示这个格子周围 8 个方向里有多少颗雷。" />
          <RuleLine icon={<Flag />} text="当某个数字周围旗帜数量等于数字时，可以点击数字格快速展开其余周围格。" />
          <RuleLine icon={<Gem />} text="分数由服务端根据难度、翻开安全格、插旗、耗时和是否胜利计算，客户端不能提交自定义分数。" />
          <RuleLine icon={<Gem />} text={`福利积分按最终得分的 ${MINESWEEPER_POINT_REWARD_PERCENT}% 结算，结果向下取整。`} />
        </RuleBlock>
      </div>
    </div>
  );
}

function RuleBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
      <h3 className="mb-3 text-base font-black text-slate-950">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function RuleLine({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex gap-3 text-sm leading-6 text-slate-600">
      <span className="mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-white text-cyan-700 [&_svg]:h-4 [&_svg]:w-4">
        {icon}
      </span>
      <span>{text}</span>
    </div>
  );
}
