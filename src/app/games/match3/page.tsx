// src/app/games/match3/page.tsx

'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, BookOpen, Clock3, Gem, Grid3x3, HeartCrack, Layers, Loader2, MousePointer2, RotateCcw, Sparkles, Trophy, X, Zap } from 'lucide-react';
import { Board } from './components/Board';
import { useGameSession } from './hooks/useGameSession';
import { CancelConfirmModal } from '../_components/CancelConfirmModal';
import { usePausedGameClock } from '../_hooks/usePausedGameClock';
import { createInitialBoard, MATCH3_WIN_SCORE, simulateMatch3Game } from '@/lib/match3-engine';
import type { Match3Move } from '@/lib/match3-engine';
import { cn } from '@/lib/utils';

type Phase = 'ready' | 'playing' | 'outcome' | 'result';

interface Match3Outcome {
  score: number;
  moves: number;
  cascades: number;
  tilesCleared: number;
}

function movesStorageKey(sessionId: string) {
  return `match3:moves:${sessionId}`;
}

function areAdjacent(a: number, b: number, cols: number): boolean {
  if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(cols) || cols < 1) return false;
  const ar = Math.floor(a / cols);
  const br = Math.floor(b / cols);
  const diff = Math.abs(a - b);
  if (diff === 1) return ar === br;
  return diff === cols;
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.ceil(seconds));
  const min = Math.floor(safe / 60);
  const sec = safe % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function loadMoves(sessionId: string): Match3Move[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(movesStorageKey(sessionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m) =>
        m &&
        typeof m === 'object' &&
        Number.isInteger(m.from) &&
        Number.isInteger(m.to)
    );
  } catch {
    return [];
  }
}

function saveMoves(sessionId: string, moves: Match3Move[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(movesStorageKey(sessionId), JSON.stringify(moves));
  } catch {
    // ignore quota errors
  }
}

function clearMoves(sessionId: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(movesStorageKey(sessionId));
  } catch {
    // ignore
  }
}

// Score counting hook
function useAnimatedNumber(value: number, duration: number = 500) {
  const [displayValue, setDisplayValue] = useState(value);
  const displayValueRef = useRef(displayValue);

  useEffect(() => {
    displayValueRef.current = displayValue;
  }, [displayValue]);

  useEffect(() => {
    let startTimestamp: number | null = null;
    const startValue = displayValueRef.current;
    const endValue = value;

    if (startValue === endValue) return;

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);

      // Ease out cubic
      const ease = 1 - Math.pow(1 - progress, 3);

      const current = Math.floor(startValue + (endValue - startValue) * ease);
      displayValueRef.current = current;
      setDisplayValue(current);

      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };

    window.requestAnimationFrame(step);
  }, [value, duration]);

  return displayValue;
}

export default function Match3Page() {
  const router = useRouter();
  const {
    session,
    status,
    loading,
    error,
    isRestored,
    fetchStatus,
    startGame,
    cancelGame,
    submitResult,
    resetSubmitFlag,
    setError,
  } = useGameSession();

  const [phase, setPhase] = useState<Phase>('ready');
  const [board, setBoard] = useState<number[]>([]);
  const [moves, setMoves] = useState<Match3Move[]>([]);
  const [score, setScore] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [timeLeftMs, setTimeLeftMs] = useState<number>(0);
  const [result, setResult] = useState<{
    score: number;
    pointsEarned: number;
    moves: number;
    cascades: number;
    tilesCleared: number;
  } | null>(null);
  const [pendingOutcome, setPendingOutcome] = useState<Match3Outcome | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Animation states
  const displayScore = useAnimatedNumber(score);
  const [lastScoreIncrease, setLastScoreIncrease] = useState<{ val: number, id: number } | null>(null);
  const prevScoreRef = useRef(0);

  const movesRef = useRef<Match3Move[]>([]);
  const finishedRef = useRef(false);
  const gameNow = usePausedGameClock(showCancelConfirm, session?.sessionId);

  useEffect(() => {
    movesRef.current = moves;
  }, [moves]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (phase !== 'ready' || !status?.inCooldown) return;

    const timer = window.setInterval(() => {
      void fetchStatus();
    }, 1000);

    return () => window.clearInterval(timer);
  }, [phase, status?.inCooldown, fetchStatus]);

  // Score feedback effect
  useEffect(() => {
    if (score > prevScoreRef.current) {
      const diff = score - prevScoreRef.current;
      setLastScoreIncrease({ val: diff, id: Date.now() });
    }
    prevScoreRef.current = score;
  }, [score]);

  // [Perf] 动态导入彩带特效，减少首屏 JS 体积
  useEffect(() => {
    if (phase === 'result' && result && result.score >= MATCH3_WIN_SCORE) {
      import('canvas-confetti').then(({ default: confetti }) => {
        const duration = 3000;
        const end = Date.now() + duration;

        const frame = () => {
          confetti({
            particleCount: 2,
            angle: 60,
            spread: 55,
            origin: { x: 0 },
            colors: ['#ef4444', '#3b82f6', '#10b981', '#f59e0b']
          });
          confetti({
            particleCount: 2,
            angle: 120,
            spread: 55,
            origin: { x: 1 },
            colors: ['#ef4444', '#3b82f6', '#10b981', '#f59e0b']
          });

          if (Date.now() < end) {
            requestAnimationFrame(frame);
          }
        };
        frame();
      });
    }
  }, [phase, result]);

  const computeStateFromMoves = useCallback(
    (nextMoves: Match3Move[]) => {
      if (!session) return { ok: false as const, message: '缺少会话' };
      const sim = simulateMatch3Game(session.seed, session.config, nextMoves, { maxMoves: 250 });
      if (!sim.ok) return sim;
      return {
        ok: true as const,
        score: sim.score,
        board: sim.finalBoard,
        stats: sim.stats,
      };
    },
    [session]
  );

  // 初始化/恢复局面
  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    Promise.resolve().then(() => {
      if (cancelled) return;

      finishedRef.current = false;
      setSelectedIndex(null);

      const restoredMoves = loadMoves(session.sessionId);
      movesRef.current = restoredMoves;
      const sim = simulateMatch3Game(session.seed, session.config, restoredMoves, { maxMoves: 250 });
      if (sim.ok) {
        setMoves(restoredMoves);
        setBoard(sim.finalBoard);
        setScore(sim.score);
        prevScoreRef.current = sim.score; // Init prevScore
      } else {
        clearMoves(session.sessionId);
        const init = createInitialBoard(session.seed, session.config);
        if (init.ok) {
          movesRef.current = [];
          setMoves([]);
          setBoard(init.finalBoard);
          setScore(0);
          prevScoreRef.current = 0;
        }
        setError('本地进度异常，已重置该局');
      }

      setPhase('playing');
    });

    return () => {
      cancelled = true;
    };
  }, [session, setError]);

  // 计时器
  useEffect(() => {
    if (phase !== 'playing' || !session) return;

    const tick = () => {
      const left = Math.max(0, session.timeLimitMs - (gameNow() - session.startedAt));
      setTimeLeftMs(left);
      if (left <= 0 && !finishedRef.current) {
        finishedRef.current = true;
        const sim = simulateMatch3Game(session.seed, session.config, movesRef.current, { maxMoves: 250 });
        if (sim.ok) {
          setPendingOutcome({
            score: sim.score,
            moves: sim.stats.movesApplied,
            cascades: sim.stats.cascades,
            tilesCleared: sim.stats.tilesCleared,
          });
          setSelectedIndex(null);
          setPhase('outcome');
        } else {
          setError(sim.message);
          finishedRef.current = false;
        }
      }
    };

    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [gameNow, phase, session, setError]);

  const timeLeftSec = useMemo(() => Math.ceil(timeLeftMs / 1000), [timeLeftMs]);

  const handleStart = useCallback(async () => {
    setError(null);
    const ok = await startGame();
    if (ok) {
      setResult(null);
      setPendingOutcome(null);
      setMoves([]);
      setScore(0);
      prevScoreRef.current = 0;
      setBoard([]);
    }
  }, [startGame, setError]);

  const handleTileClick = useCallback(
    (index: number) => {
      if (phase !== 'playing' || !session) return;
      if (loading) return;
      if (showCancelConfirm) return;
      if (timeLeftMs <= 0) return;

      if (selectedIndex === null) {
        setSelectedIndex(index);
        return;
      }

      if (selectedIndex === index) {
        setSelectedIndex(null);
        return;
      }

      if (!areAdjacent(selectedIndex, index, session.config.cols)) {
        setSelectedIndex(index);
        return;
      }

      const move: Match3Move = { from: selectedIndex, to: index };
      const nextMoves = [...movesRef.current, move];
      const next = computeStateFromMoves(nextMoves);
      if (!next.ok) {
        setSelectedIndex(null);
        setError(next.message || '无效交换');

        // Shake animation feedback?
        const boardEl = document.getElementById('game-board');
        if(boardEl) {
          boardEl.animate([
            { transform: 'translateX(0)' },
            { transform: 'translateX(-5px)' },
            { transform: 'translateX(5px)' },
            { transform: 'translateX(0)' }
          ], { duration: 300 });
        }
        return;
      }

      setError(null);
      movesRef.current = nextMoves;
      setMoves(nextMoves);
      setBoard(next.board);
      setScore(next.score);
      saveMoves(session.sessionId, nextMoves);
      setSelectedIndex(null);
    },
    [computeStateFromMoves, loading, phase, selectedIndex, session, setError, showCancelConfirm, timeLeftMs]
  );

  const handleCancel = useCallback(async () => {
    if (!session) return;
    await cancelGame();
    clearMoves(session.sessionId);
    setMoves([]);
    setBoard([]);
    setScore(0);
    setSelectedIndex(null);
    setResult(null);
    setPendingOutcome(null);
    setPhase('ready');
  }, [cancelGame, session]);

  const confirmCancelGame = useCallback(async () => {
    await handleCancel();
    setShowCancelConfirm(false);
  }, [handleCancel]);

  const handleSettleOutcome = useCallback(async () => {
    if (!session || !pendingOutcome) return;
    const sessionId = session.sessionId;
    const res = await submitResult(movesRef.current);
    if (res) {
      clearMoves(sessionId);
      setResult({
        score: res.record.score,
        pointsEarned: res.pointsEarned,
        moves: res.record.moves,
        cascades: res.record.cascades,
        tilesCleared: res.record.tilesCleared,
      });
      setPendingOutcome(null);
      setPhase('result');
    } else {
      finishedRef.current = false;
    }
  }, [pendingOutcome, session, submitResult]);

  const handlePlayAgain = useCallback(async () => {
    setResult(null);
    setPendingOutcome(null);
    setSelectedIndex(null);
    setMoves([]);
    setBoard([]);
    setScore(0);
    resetSubmitFlag();
    setPhase('ready');
    void fetchStatus();
  }, [fetchStatus, resetSubmitFlag]);

  const handleBackToGames = useCallback(() => {
    router.push('/games');
  }, [router]);

  const phaseLabel = phase === 'playing' ? '消除指令' : phase === 'outcome' || phase === 'result' ? '本局结算' : '出发准备';
  const tacticalLine = useMemo(() => {
    if (phase === 'playing') return '交换相邻宝石，只有产生消除的交换才会记录。';
    if (phase === 'outcome') return '时间到，请确认本局结果并结算成绩。';
    if (phase === 'result') return '本局已完成结算，可以返回游戏中心或等待冷却后继续。';
    if (status?.inCooldown) return `冷却剩余 ${status.cooldownRemaining} 秒。`;
    return '限时 60 秒，连锁越多，得分越高。';
  }, [phase, status?.cooldownRemaining, status?.inCooldown]);
  const commandMessage = phase === 'playing'
    ? '凑三消除，冲高连锁'
    : phase === 'outcome'
      ? (pendingOutcome?.score ?? 0) >= MATCH3_WIN_SCORE ? '挑战成功' : '挑战失败'
      : phase === 'result'
      ? `本局获得 ${result?.pointsEarned ?? 0} 积分`
      : '准备开始消消乐';

  return (
    <div className="match3-page">
      <div className="match3-mesh-bg" aria-hidden />
      <div className="match3-stars" aria-hidden>
        <span style={{ top: '10%', left: '6%', fontSize: 13 }}>✦</span>
        <span style={{ top: '21%', left: '91%', fontSize: 11, animationDelay: '1.2s' }}>✦</span>
        <span style={{ top: '48%', left: '4%', fontSize: 16, animationDelay: '2.2s' }}>✧</span>
        <span style={{ top: '72%', left: '94%', fontSize: 12, animationDelay: '0.6s' }}>✧</span>
      </div>

      <header className="match3-topbar">
        <Link href="/games" className="match3-exit-btn">
          <span className="arrow">
            <ArrowLeft size={14} strokeWidth={2.4} />
          </span>
          EXIT
        </Link>
      </header>

      <main className="match3-container">
        {error && (
          <div className="match3-error-banner" role="alert">
            {error}
          </div>
        )}

        <section className="match3-command-bar" aria-live="polite">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-black text-emerald-700">
              <Grid3x3 className="h-4 w-4" />
              <span>{phaseLabel}</span>
              <span className="text-slate-300">/</span>
              <span className="text-slate-500">{tacticalLine}</span>
            </div>
            <p className="truncate text-lg font-black text-slate-950 sm:text-xl">{commandMessage}</p>
          </div>
          <div className="match3-command-actions">
            <button
              onClick={() => setShowRules(true)}
              type="button"
              className="match3-action-btn"
            >
              <BookOpen className="h-4 w-4" />
              规则
            </button>
            {session && phase === 'playing' && (
              <button
                onClick={() => setShowCancelConfirm(true)}
                disabled={loading}
                className="match3-action-btn danger"
                type="button"
              >
                <X className="h-4 w-4" />
                放弃
              </button>
            )}
          </div>
        </section>

      <style jsx global>{`
        .match3-page {
          min-height: 100vh;
          background: #eefcf8;
          color: #0f172a;
          position: relative;
          overflow-x: hidden;
        }
        .match3-page a {
          color: inherit;
          text-decoration: none;
        }
        .match3-page .match3-mesh-bg {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          background:
            radial-gradient(circle at 12% 18%, rgba(16, 185, 129, 0.2), transparent 34%),
            radial-gradient(circle at 85% 10%, rgba(45, 212, 191, 0.18), transparent 32%),
            linear-gradient(180deg, #f7fffc 0%, #e7fbf4 54%, #dcfce7 100%);
        }
        .match3-page .match3-stars {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          color: rgba(5, 150, 105, 0.22);
        }
        .match3-page .match3-stars span {
          position: absolute;
          animation: match3-twinkle 3s ease-in-out infinite;
        }
        @keyframes match3-twinkle {
          0%, 100% { opacity: 0.35; transform: scale(0.9); }
          50% { opacity: 0.8; transform: scale(1.08); }
        }
        .match3-page .match3-topbar {
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
        .match3-page .match3-exit-btn {
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
        .match3-page .match3-exit-btn .arrow {
          display: inline-flex;
          height: 30px;
          width: 30px;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          flex-shrink: 0;
          background: linear-gradient(135deg, #34d399, #047857);
          color: white;
          box-shadow: 0 8px 14px rgba(4, 120, 87, 0.28);
        }
        .match3-page .match3-container {
          position: relative;
          z-index: 1;
          width: min(100% - 64px, 1180px);
          margin: 0 auto;
          padding: 12px 0 72px;
        }
        .match3-page .match3-error-banner {
          margin-bottom: 14px;
          border-radius: 18px;
          border: 1px solid #fecdd3;
          background: #fff1f2;
          padding: 12px 14px;
          color: #be123c;
          font-size: 14px;
          font-weight: 900;
        }
        .match3-page .match3-command-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 18px;
          border: 1px solid rgba(255, 255, 255, 0.9);
          border-radius: 28px;
          background: rgba(255, 255, 255, 0.84);
          padding: 18px 20px;
          box-shadow: 0 18px 44px rgba(15, 23, 42, 0.08);
          backdrop-filter: blur(18px);
        }
        .match3-page .match3-command-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }
        .match3-page .match3-action-btn {
          display: inline-flex;
          flex: none;
          align-items: center;
          justify-content: center;
          gap: 6px;
          border-radius: 999px;
          border: 1px solid #a7f3d0;
          background: #fff;
          padding: 10px 14px;
          color: #047857;
          font-size: 13px;
          font-weight: 900;
          transition: background 0.2s ease, transform 0.2s ease;
        }
        .match3-page .match3-action-btn:hover:not(:disabled) {
          background: #ecfdf5;
          transform: translateY(-1px);
        }
        .match3-page .match3-action-btn.danger {
          border-color: #fecdd3;
          color: #be123c;
        }
        .match3-page .match3-action-btn.danger:hover:not(:disabled) {
          background: #fff1f2;
        }
        .match3-page .match3-action-btn:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }
        .match3-page .glass-card {
          border: 1px solid rgba(255, 255, 255, 0.86);
          background: rgba(255, 255, 255, 0.88);
          box-shadow: 0 20px 52px rgba(15, 23, 42, 0.08);
          backdrop-filter: blur(18px);
        }
        .match3-page .stage-card {
          border-radius: 30px;
          padding: 24px;
        }
        .match3-page .section-title {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          font-size: 22px;
          font-weight: 1000;
          color: #0f172a;
        }
        .match3-page .section-title .st-icon {
          display: inline-flex;
          height: 36px;
          width: 36px;
          align-items: center;
          justify-content: center;
          border-radius: 14px;
          background: #059669;
          color: white;
          box-shadow: 0 12px 26px rgba(5, 150, 105, 0.26);
        }
        .match3-page .match3-ready-card {
          min-height: 430px;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          text-align: center;
        }
        .match3-page .match3-ready-icon {
          display: inline-flex;
          height: 82px;
          width: 82px;
          align-items: center;
          justify-content: center;
          border-radius: 28px;
          background: linear-gradient(135deg, #10b981, #047857);
          color: #fff;
          box-shadow: 0 20px 40px rgba(5, 150, 105, 0.28);
        }
        .match3-page .match3-start-btn {
          display: inline-flex;
          min-width: 210px;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border-radius: 20px;
          background: #059669;
          padding: 14px 24px;
          color: #fff;
          font-size: 16px;
          font-weight: 1000;
          box-shadow: 0 18px 34px rgba(5, 150, 105, 0.24);
          transition: transform 0.2s ease, background 0.2s ease;
        }
        .match3-page .match3-start-btn:hover:not(:disabled) {
          background: #10b981;
          transform: translateY(-2px);
        }
        .match3-page .match3-start-btn:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }
        .match3-page .match3-cooldown-note {
          margin: 18px auto 0;
          width: fit-content;
          max-width: 100%;
          border-radius: 18px;
          border: 1px solid #fde68a;
          background: #fffbeb;
          padding: 10px 14px;
          color: #b45309;
          font-size: 13px;
          font-weight: 900;
        }
        .match3-page .match3-battle-stat {
          border-radius: 18px;
          border: 1px solid #d1fae5;
          background: #f8fafc;
          padding: 12px;
          text-align: left;
        }
        .match3-page .match3-battle-stat strong {
          display: block;
          margin-top: 5px;
          color: #0f172a;
          font-size: 20px;
          font-weight: 1000;
          font-variant-numeric: tabular-nums;
        }
        .match3-page .match3-battle-stat span {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: #64748b;
          font-size: 12px;
          font-weight: 900;
        }
        .match3-page .match3-game-layout {
          display: grid;
          grid-template-columns: minmax(0, 640px) minmax(260px, 340px);
          gap: 18px;
          justify-content: center;
          align-items: start;
        }
        .match3-page .match3-board-card {
          position: relative;
          border-radius: 30px;
          padding: 18px;
        }
        .match3-page .match3-side-panel {
          position: sticky;
          top: 96px;
        }
        .match3-page .match3-stat-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-top: 16px;
        }
        .match3-page .match3-restore-note {
          margin-top: 14px;
          border-radius: 18px;
          border: 1px solid #fde68a;
          background: #fffbeb;
          padding: 11px 14px;
          color: #b45309;
          text-align: center;
          font-size: 13px;
          font-weight: 900;
        }
        @keyframes floatUp {
          0% { transform: translateY(0) scale(0.8); opacity: 0; }
          20% { transform: translateY(-10px) scale(1.1); opacity: 1; }
          100% { transform: translateY(-30px) scale(1); opacity: 0; }
        }
        .match3-page .animate-float-up { animation: floatUp 1s ease-out forwards; }
        .match3-page .match3-modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 60;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(15, 23, 42, 0.42);
          padding: 18px;
          backdrop-filter: blur(10px);
        }
        .match3-page .match3-result-modal,
        .match3-page .match3-rules-modal {
          width: min(520px, 100%);
          max-height: min(86vh, 760px);
          overflow: auto;
          border-radius: 30px;
          border: 1px solid rgba(255, 255, 255, 0.92);
          background: rgba(255, 255, 255, 0.96);
          padding: 24px;
          box-shadow: 0 28px 90px rgba(15, 23, 42, 0.24);
        }
        .match3-page .match3-rules-modal {
          width: min(720px, 100%);
        }
        .match3-page .match3-result-modal.won {
          box-shadow: 0 28px 90px rgba(5, 150, 105, 0.24);
        }
        .match3-page .match3-result-modal.lost {
          box-shadow: 0 28px 90px rgba(225, 29, 72, 0.2);
        }
        .match3-page .match3-result-icon {
          display: flex;
          height: 82px;
          width: 82px;
          align-items: center;
          justify-content: center;
          border-radius: 28px;
          color: #fff;
        }
        .match3-page .match3-result-icon.won {
          background: linear-gradient(135deg, #34d399, #059669);
          box-shadow: 0 18px 34px rgba(5, 150, 105, 0.25);
        }
        .match3-page .match3-result-icon.lost {
          background: linear-gradient(135deg, #fb7185, #be123c);
          box-shadow: 0 18px 34px rgba(190, 18, 60, 0.22);
        }
        .match3-page .match3-result-stats,
        .match3-page .match3-rule-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-top: 20px;
        }
        .match3-page .match3-result-stat,
        .match3-page .match3-rule-item {
          border-radius: 18px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          padding: 12px;
        }
        .match3-page .match3-rule-item h3 {
          margin: 8px 0 4px;
          font-size: 15px;
          font-weight: 1000;
        }
        .match3-page .match3-rule-item p {
          margin: 0;
          color: #64748b;
          font-size: 13px;
          font-weight: 700;
          line-height: 1.7;
        }
        @media (max-width: 980px) {
          .match3-page .match3-game-layout {
            grid-template-columns: 1fr;
          }
          .match3-page .match3-side-panel {
            position: static;
          }
        }
        @media (max-width: 768px) {
          .match3-page .match3-topbar {
            padding: 14px 16px;
            padding-top: max(14px, env(safe-area-inset-top));
          }
          .match3-page .match3-container {
            width: calc(100% - 24px);
            padding-bottom: 72px;
          }
          .match3-page .match3-command-bar {
            align-items: stretch;
            flex-direction: column;
            border-radius: 24px;
            padding: 14px;
          }
          .match3-page .match3-command-bar p {
            white-space: normal;
          }
          .match3-page .match3-command-actions,
          .match3-page .match3-command-actions button {
            width: 100%;
          }
          .match3-page .stage-card,
          .match3-page .match3-board-card {
            border-radius: 24px;
            padding: 14px;
          }
          .match3-page .match3-ready-card {
            min-height: 420px;
          }
          .match3-page .match3-result-stats,
          .match3-page .match3-rule-grid {
            grid-template-columns: 1fr;
          }
          .match3-page .match3-stat-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .match3-page .match3-result-modal,
          .match3-page .match3-rules-modal {
            border-radius: 22px;
            padding: 18px;
          }
        }
        @media (max-width: 420px) {
          .match3-page .match3-container {
            width: calc(100% - 16px);
          }
          .match3-page .match3-stat-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      {phase === 'ready' && (
        <section className="glass-card stage-card match3-ready-card">
          <div className="relative z-10 w-full max-w-2xl">
            <div className="match3-ready-icon">
              <Gem className="h-10 w-10" />
            </div>
            <h1 className="mt-6 text-3xl font-black text-slate-950">60 秒消除挑战</h1>
            <p className="mx-auto mt-3 max-w-xl text-sm font-bold leading-7 text-slate-500">
              点击一个宝石，再点击上下左右相邻宝石。只有能立刻产生三连消除的交换才会生效。
            </p>
            {status?.inCooldown && (
              <div className="match3-cooldown-note">
                冷却中，请等待 {status.cooldownRemaining} 秒
              </div>
            )}
            <button
              onClick={handleStart}
              disabled={loading || status?.inCooldown}
              className="match3-start-btn mt-8"
              type="button"
            >
              {loading ? '处理中...' : status?.inCooldown ? '冷却中' : '开始游戏'}
            </button>
          </div>
        </section>
      )}

      {phase === 'playing' && session && (
        <div className="match3-game-layout">
          <section className="glass-card match3-board-card" id="game-board">
            {lastScoreIncrease && (
              <div
                key={lastScoreIncrease.id}
                className="absolute top-7 left-1/2 z-20 -translate-x-1/2 text-2xl font-black text-emerald-500 pointer-events-none animate-float-up"
              >
                +{lastScoreIncrease.val}
              </div>
            )}
            <Board
              board={board}
              config={session.config}
              selectedIndex={selectedIndex}
              onTileClick={handleTileClick}
              disabled={showCancelConfirm || loading || timeLeftMs <= 0}
            />

            {isRestored && (
              <div className="match3-restore-note">
                已恢复中断的游戏进度
              </div>
            )}
          </section>

          <aside className="match3-side-panel">
            <section className="glass-card stage-card">
            <h2 className="section-title">
              <span className="st-icon">
                <Layers size={18} />
              </span>
              局内状态
            </h2>
            <div className="match3-stat-grid">
              <Match3BattleStat icon={<Clock3 />} label="剩余时间" value={formatClock(timeLeftSec)} danger={timeLeftSec <= 10} />
              <Match3BattleStat icon={<Sparkles />} label="得分" value={String(displayScore)} />
              <Match3BattleStat icon={<MousePointer2 />} label="步数" value={String(moves.length)} />
              <Match3BattleStat icon={<Zap />} label="奖励预估" value={`+${Math.floor(score / 10)}`} />
            </div>
          </section>
          </aside>
        </div>
      )}

      {phase === 'outcome' && pendingOutcome && (
        <Match3OutcomeModal
          outcome={pendingOutcome}
          loading={loading}
          onSubmit={() => void handleSettleOutcome()}
        />
      )}

      {phase === 'result' && result && (
        <div className="match3-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="match3-result-title">
          <div className={`match3-result-modal ${result.score >= MATCH3_WIN_SCORE ? 'won' : 'lost'}`}>
            <div className="text-center relative">
              <div className={`mx-auto match3-result-icon ${result.score >= MATCH3_WIN_SCORE ? 'won' : 'lost'}`}>
                {result.score >= MATCH3_WIN_SCORE ? <Trophy className="h-9 w-9" /> : <HeartCrack className="h-9 w-9" />}
              </div>
              <div className="mt-5 text-xs font-black uppercase tracking-wider text-emerald-700/80">
                结算完成
              </div>
              <h3 id="match3-result-title" className="mt-1 text-2xl font-black text-slate-950">
                {result.score >= MATCH3_WIN_SCORE ? '成功结算完成' : '失败结算完成'}
              </h3>
              <p className="mt-3 text-sm font-bold leading-6 text-slate-500">
                本局得分 {result.score}，获得 {result.pointsEarned} 福利积分。
              </p>

              <div className="match3-result-stats">
                <Match3ResultStat label="目标" value={`${MATCH3_WIN_SCORE} 分`} />
                <Match3ResultStat label="得分" value={String(result.score)} />
                <Match3ResultStat label="福利积分" value={`+${result.pointsEarned}`} />
                <Match3ResultStat label="步数" value={String(result.moves)} />
              </div>

              <div className="mt-5 flex gap-3">
                <button
                  onClick={handleBackToGames}
                  className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-600 transition-colors hover:bg-slate-50"
                  type="button"
                >
                  返回游戏中心
                </button>
                <button
                  onClick={handlePlayAgain}
                  className="flex-1 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white shadow-lg shadow-emerald-200 transition-all hover:-translate-y-0.5 hover:bg-emerald-500"
                  type="button"
                >
                  再来一局
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showRules && <Match3RulesModal onClose={() => setShowRules(false)} />}
      <CancelConfirmModal
        open={showCancelConfirm}
        loading={loading}
        title="确认放弃消消乐？"
        description="当前消除进度会被取消，本局不会进入结算。"
        detail="已产生的连锁、得分和剩余时间都会丢失。"
        onConfirm={() => void confirmCancelGame()}
        onClose={() => setShowCancelConfirm(false)}
      />
      </main>
    </div>
  );
}

function Match3OutcomeModal({
  outcome,
  loading,
  onSubmit,
}: {
  outcome: Match3Outcome;
  loading: boolean;
  onSubmit: () => void;
}) {
  const won = outcome.score >= MATCH3_WIN_SCORE;
  const previewReward = Math.floor(outcome.score / 10);

  return (
    <div className="match3-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="match3-outcome-title">
      <div className={`match3-result-modal ${won ? 'won' : 'lost'}`}>
        <div className="text-center">
          <div className={`mx-auto match3-result-icon ${won ? 'won' : 'lost'}`}>
            {won ? <Trophy className="h-9 w-9" /> : <HeartCrack className="h-9 w-9" />}
          </div>
          <div className="mt-5 text-xs font-black uppercase tracking-wider text-emerald-700/80">
            胜负结果
          </div>
          <h2 id="match3-outcome-title" className="mt-1 text-2xl font-black text-slate-950">
            {won ? '挑战成功' : '挑战失败'}
          </h2>
          <p className="mt-3 text-sm font-bold leading-6 text-slate-500">
            {won ? '得分已达到成功线，可以结算本局成绩。' : '本局未达到成功线，可以结算本局成绩。'}
          </p>
        </div>

        <div className="match3-result-stats">
          <Match3ResultStat label="目标" value={`${MATCH3_WIN_SCORE} 分`} />
          <Match3ResultStat label="得分" value={String(outcome.score)} />
          <Match3ResultStat label="步数" value={String(outcome.moves)} />
          <Match3ResultStat label="预计奖励" value={`+${previewReward}`} />
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

function Match3BattleStat({
  icon,
  label,
  value,
  danger = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="match3-battle-stat">
      <span className="[&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-emerald-700">{icon}{label}</span>
      <strong className={cn(danger ? 'text-rose-500 animate-pulse' : 'text-slate-950')}>{value}</strong>
    </div>
  );
}

function Match3ResultStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="match3-result-stat text-center">
      <div className="text-xs font-black text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-black text-slate-950 tabular-nums">{value}</div>
    </div>
  );
}

function Match3RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="match3-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="match3-rules-title">
      <div className="match3-rules-modal">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 text-xs font-black text-emerald-600">RULE BOOK</div>
            <h2 id="match3-rules-title" className="text-2xl font-black text-slate-950">
              消消乐规则
            </h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:text-slate-900"
            type="button"
            aria-label="关闭规则"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="match3-rule-grid">
          <Match3RuleItem icon={<MousePointer2 />} title="交换方式" text="先点一个宝石，再点上下左右相邻宝石。非相邻方块只会切换选中目标。" />
          <Match3RuleItem icon={<Grid3x3 />} title="有效交换" text="交换后必须立刻形成 3 个或更多相同宝石连线，否则本次交换不记录。" />
          <Match3RuleItem icon={<RotateCcw />} title="连锁得分" text="消除后会自动下落补位，新形成的连锁会继续加分，连锁越深每个宝石分值越高。" />
          <Match3RuleItem icon={<Clock3 />} title="结算规则" text="对局限时 60 秒，时间结束后由服务端按真实操作序列复算得分并发放福利积分。" />
        </div>
      </div>
    </div>
  );
}

function Match3RuleItem({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <article className="match3-rule-item">
      <div className="text-emerald-700 [&_svg]:h-5 [&_svg]:w-5">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}
