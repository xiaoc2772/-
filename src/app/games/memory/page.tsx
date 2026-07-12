// src/app/games/memory/page.tsx

'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, BookOpen, Brain, Clock3, Layers, Loader2, MousePointer2, RotateCcw, Sparkles, Target, Trophy, X } from 'lucide-react';
import { useGameSession } from './hooks/useGameSession';
import { DifficultySelect } from './components/DifficultySelect';
import { GameBoard } from './components/GameBoard';
import { ResultModal } from './components/ResultModal';
import { CancelConfirmModal } from '../_components/CancelConfirmModal';
import { DIFFICULTY_META } from './lib/constants';
import type { MemoryDifficulty, MemoryMove } from '@/lib/types/game';

type GamePhase = 'select' | 'playing' | 'outcome' | 'result';

interface GameResult {
  moves: number;
  completed: boolean;
  score: number;
  pointsEarned: number;
  duration: number;
}

interface GameOutcome {
  moves: MemoryMove[];
  completed: boolean;
  duration: number;
}

interface BoardStats {
  difficultyName: string;
  moves: number;
  estimatedScore: number;
  timeLeft: number;
  matchedPairs: number;
  totalPairs: number;
  progress: number;
}

function formatSeconds(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const min = Math.floor(safe / 60);
  const sec = safe % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatDurationMs(duration: number): string {
  return formatSeconds(Math.ceil(Math.max(0, duration) / 1000));
}

export default function MemoryGamePage(): React.JSX.Element {
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
    flipCard,
    syncSessionLayout,
    resetSubmitFlag,
    setError,
  } = useGameSession();

  const [phase, setPhase] = useState<GamePhase>('select');
  const [selectedDifficulty, setSelectedDifficulty] = useState<MemoryDifficulty>('easy');
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [pendingOutcome, setPendingOutcome] = useState<GameOutcome | null>(null);
  const [boardStats, setBoardStats] = useState<BoardStats | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (phase !== 'select' || !status?.inCooldown) return;
    const timer = window.setInterval(() => {
      void fetchStatus();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, status?.inCooldown, fetchStatus]);

  useEffect(() => {
    if (session && phase === 'select') {
      Promise.resolve().then(() => {
        setSelectedDifficulty(session.difficulty);
        setPhase('playing');
      });
    }
  }, [session, phase]);

  const handleSelectDifficulty = useCallback(
    async (difficulty: MemoryDifficulty) => {
      setSelectedDifficulty(difficulty);
      setError(null);
      if (selectedDifficulty !== difficulty) {
        return;
      }
      const success = await startGame(difficulty);
      if (success) {
        setPhase('playing');
      }
    },
    [selectedDifficulty, startGame, setError],
  );

  const handleGameEnd = useCallback(
    (moves: MemoryMove[], completed: boolean, duration: number) => {
      setPendingOutcome({ moves, completed, duration });
      setPhase('outcome');
    },
    [],
  );

  const handleSettleOutcome = useCallback(
    async () => {
      if (!pendingOutcome) return;
      const result = await submitResult(pendingOutcome.moves, pendingOutcome.completed, pendingOutcome.duration);
      if (result) {
        setGameResult({
          moves: result.record.moves,
          completed: result.record.completed,
          score: result.record.score,
          pointsEarned: result.pointsEarned,
          duration: result.record.duration,
        });
        setPendingOutcome(null);
        setPhase('result');
      }
    },
    [pendingOutcome, submitResult],
  );

  const handlePlayAgain = useCallback(async () => {
    setGameResult(null);
    setPendingOutcome(null);
    setBoardStats(null);
    setPhase('select');
    resetSubmitFlag();
    await fetchStatus();
  }, [resetSubmitFlag, fetchStatus]);

  const handleBackToGames = useCallback(() => {
    router.push('/games');
  }, [router]);

  const handleCancelGame = useCallback(async () => {
    await cancelGame();
    setPendingOutcome(null);
    setBoardStats(null);
    setPhase('select');
  }, [cancelGame]);

  const confirmCancelGame = useCallback(async () => {
    await handleCancelGame();
    setShowCancelConfirm(false);
  }, [handleCancelGame]);

  const phaseLabel = phase === 'playing' ? '记忆指令' : phase === 'outcome' || phase === 'result' ? '本局结算' : '出发准备';
  const tacticalLine = useMemo(() => {
    if (phase === 'playing') return '记住已翻开的符号，用最少步数完成全部配对。';
    if (phase === 'outcome') return '本局已结束，请确认胜负并结算成绩。';
    if (phase === 'result') return '结算已完成，可以返回游戏中心或等待冷却后再开一局。';
    if (status?.inCooldown) return `冷却剩余 ${status.cooldownRemaining} 秒。`;
    return '选择难度后立即开局，分数由服务端按真实步数复算。';
  }, [phase, status?.cooldownRemaining, status?.inCooldown]);
  const message = phase === 'playing'
    ? '翻开两张卡，找到相同图案'
    : phase === 'outcome'
      ? pendingOutcome?.completed ? '全部配对完成' : '时间到，挑战失败'
      : phase === 'result'
      ? `本局获得 ${gameResult?.pointsEarned ?? 0} 积分`
      : '选择你的记忆挑战';

  return (
    <div className="memory-page">
      <div className="memory-mesh-bg" aria-hidden />
      <div className="memory-stars" aria-hidden>
        <span style={{ top: '8%', left: '5%', fontSize: 14 }}>✦</span>
        <span style={{ top: '18%', left: '92%', fontSize: 11, animationDelay: '1s' }}>✦</span>
        <span style={{ top: '42%', left: '4%', fontSize: 16, animationDelay: '2.5s' }}>✧</span>
        <span style={{ top: '68%', left: '95%', fontSize: 12, animationDelay: '0.7s' }}>✧</span>
        <span style={{ top: '86%', left: '12%', fontSize: 13, animationDelay: '1.8s' }}>✦</span>
      </div>

      <header className="memory-topbar">
        <Link href="/games" className="memory-exit-btn">
          <span className="arrow">
            <ArrowLeft size={14} strokeWidth={2.4} />
          </span>
          EXIT
        </Link>
      </header>

      <main className="memory-container">
        {error && (
          <div className="memory-error-banner" role="alert">
            {error}
          </div>
        )}

        <section className="memory-command-bar" aria-live="polite">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-black text-emerald-700">
              <Brain className="h-4 w-4" />
              <span>{phaseLabel}</span>
              <span className="text-slate-300">/</span>
              <span className="text-slate-500">{tacticalLine}</span>
            </div>
            <p className="truncate text-lg font-black text-slate-950 sm:text-xl">{message}</p>
          </div>
          <div className="memory-command-actions">
            <button
              onClick={() => setShowRules(true)}
              type="button"
              className="memory-action-btn"
            >
              <BookOpen className="h-4 w-4" />
              规则
            </button>
            {session && (
              <button
                onClick={() => setShowCancelConfirm(true)}
                disabled={loading}
                className="memory-action-btn danger"
                type="button"
              >
                <X className="h-4 w-4" />
                放弃
              </button>
            )}
          </div>
        </section>

        {phase === 'select' && (
          <section className="glass-card stage-card memory-game-card">
            <div className="memory-select-panel">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <h2 className="section-title">
                  <span className="st-icon">
                    <Target size={18} />
                  </span>
                  选择难度
                </h2>
                <span className="memory-cute-pill">
                  <MousePointer2 className="h-4 w-4" />
                  步数越少，得分越高
                </span>
              </div>
              <h3 className="memory-difficulty-title">
                选择你的挑战难度
              </h3>
              {status?.inCooldown && (
                <div className="memory-cooldown-note">
                  冷却中，请等待 {status.cooldownRemaining} 秒
                </div>
              )}
              <DifficultySelect
                selectedDifficulty={selectedDifficulty}
                onSelect={handleSelectDifficulty}
                disabled={loading || status?.inCooldown}
                loading={loading}
                cooldownRemaining={status?.inCooldown ? status.cooldownRemaining : 0}
              />
            </div>
          </section>
        )}

        {phase === 'playing' && session && (
          <div className="memory-game-layout">
            <section className="glass-card stage-card memory-board-card">
              <GameBoard
                sessionId={session.sessionId}
                difficulty={session.difficulty}
                cardLayout={session.cardLayout}
                moveCount={session.moveCount}
                matchedCards={session.matchedCards}
                firstFlippedCard={session.firstFlippedCard}
                startedAt={session.startedAt}
                config={session.config}
                onFlipCard={flipCard}
                onSyncCardLayout={syncSessionLayout}
                onGameEnd={handleGameEnd}
                onStatusChange={setBoardStats}
                isRestored={isRestored}
                paused={showCancelConfirm}
              />
            </section>
            <aside className="memory-side-panel">
              <MemoryStatusPanel stats={boardStats} />
            </aside>
          </div>
        )}

        {phase === 'outcome' && pendingOutcome && (
          <MemoryOutcomeModal
            outcome={pendingOutcome}
            difficulty={session?.difficulty ?? selectedDifficulty}
            stats={boardStats}
            loading={loading}
            onSubmit={() => void handleSettleOutcome()}
          />
        )}

        {phase === 'result' && gameResult && (
          <ResultModal
            isOpen={true}
            difficulty={selectedDifficulty}
            moves={gameResult.moves}
            completed={gameResult.completed}
            score={gameResult.score}
            pointsEarned={gameResult.pointsEarned}
            duration={gameResult.duration}
            onPlayAgain={handlePlayAgain}
            onBackToGames={handleBackToGames}
          />
        )}

        {showRules && <MemoryRulesModal onClose={() => setShowRules(false)} />}
        <CancelConfirmModal
          open={showCancelConfirm}
          loading={loading}
          title="确认放弃记忆翻牌？"
          description="当前翻牌进度会被取消，本局不会进入结算。"
          detail="已翻开的卡片、步数和剩余时间都会丢失。"
          onConfirm={() => void confirmCancelGame()}
          onClose={() => setShowCancelConfirm(false)}
        />
      </main>

      <style jsx global>{`
        .memory-page {
          min-height: 100vh;
          background: #eefcf8;
          color: #0f172a;
          position: relative;
          overflow-x: hidden;
        }
        .memory-page a {
          color: inherit;
          text-decoration: none;
        }
        .memory-page .memory-mesh-bg {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          background:
            radial-gradient(circle at 14% 16%, rgba(45, 212, 191, 0.38), transparent 36%),
            radial-gradient(circle at 88% 12%, rgba(59, 130, 246, 0.18), transparent 32%),
            radial-gradient(circle at 48% 95%, rgba(16, 185, 129, 0.32), transparent 42%),
            linear-gradient(180deg, #effdf8 0%, #e7f7ff 100%);
          filter: blur(22px);
        }
        .memory-page .memory-stars {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          overflow: hidden;
        }
        .memory-page .memory-stars span {
          position: absolute;
          color: rgba(255, 255, 255, 0.78);
          animation: memory-twinkle 3s ease-in-out infinite;
        }
        @keyframes memory-twinkle {
          0%, 100% { opacity: 0.28; transform: scale(1); }
          50% { opacity: 0.86; transform: scale(1.45); }
        }
        .memory-page .memory-topbar {
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
        .memory-page .memory-exit-btn {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.82);
          background: rgba(255, 255, 255, 0.62);
          padding: 8px 18px 8px 8px;
          font-size: 13px;
          font-weight: 900;
          color: #065f46;
          letter-spacing: 1.5px;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.07);
          backdrop-filter: blur(16px);
        }
        .memory-page .memory-exit-btn .arrow {
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
        .memory-page .memory-container {
          position: relative;
          z-index: 1;
          width: min(1360px, calc(100vw - 96px));
          margin: 0 auto;
          padding: 12px 0 88px;
        }
        .memory-page .memory-error-banner {
          margin-bottom: 22px;
          border-radius: 20px;
          border: 1px solid #fecdd3;
          background: rgba(255, 241, 242, 0.88);
          padding: 14px 18px;
          font-size: 14px;
          font-weight: 800;
          color: #be123c;
        }
        .memory-page .memory-command-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          margin-bottom: 22px;
          border: 1px solid rgba(255, 255, 255, 0.86);
          border-radius: 28px;
          background: rgba(255, 255, 255, 0.74);
          padding: 18px 20px;
          box-shadow: 0 22px 48px rgba(15, 23, 42, 0.08);
          backdrop-filter: blur(20px);
        }
        .memory-page .memory-command-actions {
          display: flex;
          flex: none;
          align-items: center;
          gap: 10px;
        }
        .memory-page .memory-action-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          border-radius: 999px;
          border: 1px solid #a7f3d0;
          background: #fff;
          padding: 10px 16px;
          font-size: 14px;
          font-weight: 900;
          color: #047857;
          transition: background 0.2s, transform 0.2s;
        }
        .memory-page .memory-action-btn:hover:not(:disabled) {
          background: #ecfdf5;
          transform: translateY(-1px);
        }
        .memory-page .memory-action-btn.danger {
          border-color: #fecdd3;
          color: #be123c;
        }
        .memory-page .memory-action-btn.danger:hover:not(:disabled) {
          background: #fff1f2;
        }
        .memory-page .memory-action-btn:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }
        .memory-page .glass-card {
          border: 1px solid rgba(255, 255, 255, 0.86);
          background: rgba(255, 255, 255, 0.78);
          box-shadow: 0 28px 80px rgba(15, 23, 42, 0.1);
          backdrop-filter: blur(22px);
        }
        .memory-page .stage-card {
          border-radius: 32px;
          padding: 24px;
        }
        .memory-page .memory-game-card {
          min-height: 560px;
        }
        .memory-page .memory-game-layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(280px, 330px);
          gap: 22px;
          align-items: start;
        }
        .memory-page .memory-board-card {
          min-height: 520px;
        }
        .memory-page .memory-side-panel {
          position: sticky;
          top: 104px;
        }
        .memory-page .memory-battle-stat {
          border-radius: 18px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          padding: 12px;
        }
        .memory-page .memory-status-dock {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          margin-bottom: 22px;
          border-bottom: 1px solid rgba(15, 23, 42, 0.06);
          padding-bottom: 18px;
        }
        .memory-page .memory-status-dock h1 {
          margin: 8px 0 0;
          font-size: clamp(28px, 4vw, 44px);
          font-weight: 1000;
          letter-spacing: 0;
          color: #0f172a;
          line-height: 1;
        }
        .memory-page .memory-phase-pill {
          display: inline-flex;
          border-radius: 999px;
          background: #059669;
          padding: 5px 12px;
          font-size: 12px;
          font-weight: 1000;
          color: white;
        }
        .memory-page .memory-status-metrics {
          display: grid;
          grid-template-columns: repeat(3, minmax(92px, 1fr));
          gap: 10px;
          min-width: min(520px, 100%);
        }
        .memory-page .memory-status-metric {
          display: flex;
          align-items: center;
          gap: 10px;
          border-radius: 20px;
          background: rgba(236, 253, 245, 0.72);
          padding: 12px;
        }
        .memory-page .memory-status-metric svg {
          color: #059669;
        }
        .memory-page .memory-status-metric span {
          display: block;
          font-size: 11px;
          font-weight: 900;
          color: #64748b;
        }
        .memory-page .memory-status-metric strong {
          display: block;
          margin-top: 2px;
          font-size: 17px;
          font-weight: 1000;
          color: #0f172a;
          font-variant-numeric: tabular-nums;
        }
        .memory-page .memory-status-metric strong.text-emerald-600,
        .memory-page .memory-live-metrics strong.text-emerald-600 {
          color: #059669;
        }
        .memory-page .memory-status-metric strong.text-amber-600 {
          color: #d97706;
        }
        .memory-page .memory-live-metrics strong.text-rose-500 {
          color: #f43f5e;
        }
        .memory-page .section-title {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          font-size: 22px;
          font-weight: 1000;
          color: #0f172a;
        }
        .memory-page .section-title .st-icon {
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
        .memory-page .memory-cute-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border-radius: 999px;
          background: #ecfdf5;
          padding: 8px 12px;
          font-size: 12px;
          font-weight: 900;
          color: #047857;
        }
        .memory-page .memory-difficulty-wrap {
          width: 100%;
          max-width: 940px;
          margin: 0 auto;
        }
        .memory-page .memory-difficulty-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 24px;
          margin-top: 34px;
        }
        .memory-page .memory-difficulty-title {
          margin: 0;
          text-align: center;
          font-size: 30px;
          font-weight: 1000;
          letter-spacing: 0;
          color: #1e293b;
        }
        .memory-page .memory-difficulty-card {
          position: relative;
          min-height: 254px;
          overflow: hidden;
          border-width: 4px;
          border-style: solid;
          border-radius: 32px;
          border-color: #a7f3d0;
          background: rgba(255, 255, 255, 0.8);
          padding: 24px;
          text-align: left;
          box-shadow: 0 18px 34px rgba(15, 23, 42, 0.06);
          backdrop-filter: blur(14px);
          transition: transform 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
          animation: memory-card-in 0.42s ease both;
        }
        .memory-page .memory-difficulty-card[data-difficulty="normal"] {
          border-color: #bfdbfe;
        }
        .memory-page .memory-difficulty-card[data-difficulty="hard"] {
          border-color: #fecaca;
        }
        .memory-page .memory-difficulty-card:hover:not(:disabled) {
          border-color: #fff;
          box-shadow: 0 24px 44px rgba(15, 23, 42, 0.1);
          transform: translateY(-8px);
        }
        .memory-page .memory-difficulty-card:active:not(:disabled) {
          transform: scale(0.98);
        }
        .memory-page .memory-difficulty-card.is-selected {
          border-color: #fff;
          box-shadow: 0 20px 42px rgba(16, 185, 129, 0.18), 0 0 0 3px rgba(16, 185, 129, 0.24);
        }
        .memory-page .memory-difficulty-card:disabled {
          cursor: not-allowed;
          opacity: 0.5;
          transform: none;
        }
        .memory-page .memory-difficulty-glow {
          position: absolute;
          inset: 0;
          opacity: 0;
          transition: opacity 0.5s ease;
        }
        .memory-page .memory-difficulty-card:hover:not(:disabled) .memory-difficulty-glow,
        .memory-page .memory-difficulty-card.is-selected .memory-difficulty-glow {
          opacity: 1;
        }
        .memory-page .memory-difficulty-icon {
          font-size: 56px;
          line-height: 1;
          filter: drop-shadow(0 8px 12px rgba(15, 23, 42, 0.1));
          transform-origin: left center;
          transition: transform 0.3s ease;
        }
        .memory-page .memory-difficulty-card:hover:not(:disabled) .memory-difficulty-icon {
          transform: scale(1.1) rotate(10deg);
        }
        .memory-page .memory-size-pill {
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.52);
          padding: 5px 11px;
          font-size: 11px;
          font-weight: 950;
          color: #475569;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          backdrop-filter: blur(10px);
          transition: background 0.3s ease, color 0.3s ease;
        }
        .memory-page .memory-difficulty-card:hover:not(:disabled) .memory-size-pill,
        .memory-page .memory-difficulty-card.is-selected .memory-size-pill {
          background: rgba(255, 255, 255, 0.22);
          color: white;
        }
        .memory-page .memory-selected-start {
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
        .memory-page .memory-difficulty-card:hover:not(:disabled) .memory-selected-start,
        .memory-page .memory-selected-start.is-visible {
          background: rgba(255, 255, 255, 0.2);
          color: #fff;
          opacity: 1;
        }
        @keyframes memory-card-in {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .memory-page .memory-cooldown-note {
          margin-top: 16px;
          border-radius: 18px;
          border: 1px solid #fde68a;
          background: #fffbeb;
          padding: 12px 14px;
          text-align: center;
          font-size: 14px;
          font-weight: 900;
          color: #b45309;
        }
        .memory-page .memory-board-shell {
          width: min(720px, 100%);
          margin: 0 auto;
        }
        .memory-page .memory-restore-banner {
          margin-bottom: 14px;
          border-radius: 18px;
          border: 1px solid #fde68a;
          background: #fffbeb;
          padding: 11px 14px;
          text-align: center;
          font-size: 13px;
          font-weight: 900;
          color: #b45309;
        }
        .memory-page .memory-board-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 14px;
        }
        .memory-page .memory-difficulty-label {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          font-size: 16px;
          color: #334155;
        }
        .memory-page .memory-difficulty-label span {
          font-size: 30px;
        }
        .memory-page .memory-difficulty-label strong {
          font-size: 18px;
          font-weight: 1000;
        }
        .memory-page .memory-live-metrics {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 10px;
        }
        .memory-page .memory-live-metrics div {
          min-width: 72px;
          border-radius: 16px;
          background: #f8fafc;
          padding: 9px 10px;
          text-align: center;
        }
        .memory-page .memory-live-metrics span {
          display: block;
          font-size: 10px;
          font-weight: 900;
          color: #94a3b8;
        }
        .memory-page .memory-live-metrics strong {
          display: block;
          font-size: 18px;
          font-weight: 1000;
          color: #0f172a;
          font-variant-numeric: tabular-nums;
        }
        .memory-page .memory-progress-row {
          display: flex;
          justify-content: space-between;
          margin-bottom: 7px;
          font-size: 12px;
          font-weight: 900;
          color: #64748b;
        }
        .memory-page .memory-progress-track {
          height: 8px;
          overflow: hidden;
          border-radius: 999px;
          background: #e2e8f0;
          margin-bottom: 18px;
        }
        .memory-page .memory-progress-fill {
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(90deg, #10b981, #22d3ee);
          transition: width 0.28s ease;
        }
        .memory-page .memory-card-grid {
          display: grid;
          gap: clamp(5px, 1.2vw, 10px);
        }
        .memory-page .memory-card {
          position: relative;
          aspect-ratio: 1;
          width: 100%;
          border: 0;
          background: transparent;
          padding: 0;
          perspective: 900px;
          cursor: pointer;
          touch-action: manipulation;
        }
        .memory-page .memory-card:disabled {
          cursor: default;
        }
        .memory-page .memory-card-inner {
          position: relative;
          height: 100%;
          width: 100%;
          transition: transform 0.3s ease;
        }
        .memory-page .memory-card-back,
        .memory-page .memory-card-front {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 18px;
          box-shadow: 0 12px 26px rgba(15, 23, 42, 0.1);
        }
        .memory-page .memory-card-back {
          border: 2px solid rgba(255, 255, 255, 0.34);
          background:
            linear-gradient(135deg, rgba(16, 185, 129, 0.95), rgba(8, 145, 178, 0.92)),
            radial-gradient(circle at 25% 20%, rgba(255, 255, 255, 0.42), transparent 34%);
          color: white;
          transition: transform 0.2s, filter 0.2s;
        }
        .memory-page .memory-card:hover:not(:disabled) .memory-card-back {
          filter: brightness(1.06);
          transform: translateY(-2px);
        }
        .memory-page .memory-card-back span {
          font-size: clamp(1.4rem, 5vw, 2.6rem);
        }
        .memory-page .memory-card-front {
          border: 2px solid #e2e8f0;
          background: #fff;
        }
        .memory-page .memory-card-front.is-matched {
          border-color: #34d399;
          background: #ecfdf5;
        }
        .memory-page .memory-card-front.is-loading {
          border-color: #67e8f9;
          background:
            radial-gradient(circle at 50% 42%, rgba(34, 211, 238, 0.18), transparent 36%),
            #ecfeff;
        }
        .memory-page .memory-card-front span {
          font-size: clamp(1.5rem, 5.8vw, 3rem);
          line-height: 1;
          transition: transform 0.25s;
        }
        .memory-page .memory-card-front span.is-pop {
          transform: scale(1.1);
        }
        .memory-page .memory-card-front.is-loading span {
          animation: memory-card-loading 0.7s ease-in-out infinite alternate;
        }
        @keyframes memory-card-loading {
          from { opacity: 0.45; transform: scale(0.92); }
          to { opacity: 1; transform: scale(1.08); }
        }
        .memory-page .memory-result-modal {
          width: min(520px, 100%);
          max-height: min(86vh, 760px);
          overflow: auto;
          border-radius: 30px;
          border: 1px solid rgba(255, 255, 255, 0.92);
          background: rgba(255, 255, 255, 0.96);
          padding: 24px;
          box-shadow: 0 28px 90px rgba(15, 23, 42, 0.24);
        }
        .memory-page .memory-result-modal.won {
          box-shadow: 0 28px 90px rgba(5, 150, 105, 0.24);
        }
        .memory-page .memory-result-modal.lost {
          box-shadow: 0 28px 90px rgba(225, 29, 72, 0.2);
        }
        .memory-page .memory-result-icon {
          display: flex;
          height: 82px;
          width: 82px;
          align-items: center;
          justify-content: center;
          border-radius: 28px;
          color: #fff;
        }
        .memory-page .memory-result-icon.won {
          background: linear-gradient(135deg, #34d399, #059669);
          box-shadow: 0 18px 34px rgba(5, 150, 105, 0.25);
        }
        .memory-page .memory-result-icon.lost {
          background: linear-gradient(135deg, #fb7185, #be123c);
          box-shadow: 0 18px 34px rgba(190, 18, 60, 0.22);
        }
        .memory-page .memory-result-stats {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-top: 20px;
        }
        .memory-page .memory-result-stat {
          border-radius: 18px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          padding: 12px;
          text-align: center;
        }
        .memory-page .memory-modal-overlay {
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
        .memory-page .memory-rules-modal {
          width: min(760px, 100%);
          max-height: min(82vh, 760px);
          overflow: auto;
          border-radius: 28px;
          background: #fff;
          padding: 24px;
          box-shadow: 0 28px 90px rgba(15, 23, 42, 0.22);
        }
        .memory-page .memory-rule-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          margin-top: 18px;
        }
        .memory-page .memory-rule-item {
          border-radius: 20px;
          background: #f8fafc;
          padding: 14px;
        }
        .memory-page .memory-rule-item svg {
          color: #059669;
        }
        .memory-page .memory-rule-item h3 {
          margin: 8px 0 4px;
          font-size: 15px;
          font-weight: 1000;
        }
        .memory-page .memory-rule-item p {
          margin: 0;
          font-size: 13px;
          font-weight: 700;
          line-height: 1.7;
          color: #64748b;
        }
        @media (max-width: 1080px) {
          .memory-page .memory-topbar {
            padding-inline: 32px;
          }
          .memory-page .memory-container {
            width: min(100% - 48px, 1180px);
          }
          .memory-page .memory-status-dock {
            align-items: flex-start;
            flex-direction: column;
          }
          .memory-page .memory-status-metrics {
            width: 100%;
          }
          .memory-page .memory-game-layout {
            grid-template-columns: 1fr;
          }
          .memory-page .memory-side-panel {
            position: static;
          }
        }
        @media (max-width: 768px) {
          .memory-page .memory-topbar {
            padding: 14px 16px;
            padding-top: max(14px, env(safe-area-inset-top));
          }
          .memory-page .memory-container {
            width: calc(100% - 24px);
            padding-bottom: 72px;
          }
          .memory-page .stage-card {
            border-radius: 24px;
            padding: 14px;
          }
          .memory-page .memory-command-bar {
            align-items: stretch;
            flex-direction: column;
            border-radius: 24px;
            padding: 14px;
          }
          .memory-page .memory-command-bar p {
            white-space: normal;
          }
          .memory-page .memory-command-actions {
            width: 100%;
          }
          .memory-page .memory-command-actions button {
            flex: 1;
          }
          .memory-page .memory-status-metrics {
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 6px;
          }
          .memory-page .memory-status-metric {
            align-items: flex-start;
            flex-direction: column;
            gap: 6px;
            padding: 10px;
          }
          .memory-page .memory-status-metric strong {
            font-size: 15px;
          }
          .memory-page .memory-difficulty-grid {
            grid-template-columns: 1fr;
          }
          .memory-page .memory-board-head {
            align-items: stretch;
            flex-direction: column;
          }
          .memory-page .memory-live-metrics {
            justify-content: stretch;
          }
          .memory-page .memory-live-metrics div {
            flex: 1;
            min-width: 0;
          }
          .memory-page .memory-card-back,
          .memory-page .memory-card-front {
            border-radius: 12px;
          }
          .memory-page .memory-result-modal {
            border-radius: 22px;
            padding: 18px;
          }
          .memory-page .memory-result-stats {
            grid-template-columns: 1fr;
          }
          .memory-page .memory-rule-grid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 420px) {
          .memory-page .memory-container {
            width: calc(100% - 16px);
          }
          .memory-page .memory-status-metrics {
            grid-template-columns: 1fr;
          }
          .memory-page .memory-game-card {
            min-height: 500px;
          }
          .memory-page .memory-card-grid {
            gap: 4px;
          }
        }
      `}</style>
    </div>
  );
}

function MemoryStatusPanel({ stats }: { stats: BoardStats | null }) {
  const matchedText = stats ? `${stats.matchedPairs}/${stats.totalPairs}` : '0/0';

  return (
    <section className="glass-card stage-card">
      <h2 className="section-title">
        <span className="st-icon">
          <Layers size={18} />
        </span>
        局内状态
      </h2>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <MemoryBattleStat icon={<Clock3 />} label="剩余时间" value={stats ? formatSeconds(stats.timeLeft) : '03:00'} />
        <MemoryBattleStat icon={<MousePointer2 />} label="步数" value={String(stats?.moves ?? 0)} />
        <MemoryBattleStat icon={<Target />} label="配对" value={matchedText} />
        <MemoryBattleStat icon={<Sparkles />} label="预估" value={String(stats?.estimatedScore ?? 0)} />
        <MemoryBattleStat icon={<Trophy />} label="进度" value={`${stats?.progress ?? 0}%`} />
        <MemoryBattleStat icon={<Brain />} label="难度" value={stats?.difficultyName ?? '简单'} />
      </div>
    </section>
  );
}

function MemoryBattleStat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="memory-battle-stat">
      <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
        <span className="text-emerald-700 [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
        {label}
      </div>
      <div className="mt-2 text-xl font-black text-slate-950">{value}</div>
    </div>
  );
}

function MemoryOutcomeModal({
  outcome,
  difficulty,
  stats,
  loading,
  onSubmit,
}: {
  outcome: GameOutcome;
  difficulty: MemoryDifficulty;
  stats: BoardStats | null;
  loading: boolean;
  onSubmit: () => void;
}) {
  const won = outcome.completed;
  const meta = DIFFICULTY_META[difficulty];
  const moves = stats?.moves ?? outcome.moves.length;
  const expectedScore = won ? stats?.estimatedScore ?? 0 : 0;

  return (
    <div className="memory-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="memory-outcome-title">
      <div className={`memory-result-modal ${won ? 'won' : 'lost'}`}>
        <div className="flex flex-col items-center text-center">
          <div className={`memory-result-icon ${won ? 'won' : 'lost'}`}>
            {won ? <Trophy className="h-9 w-9" /> : <Clock3 className="h-9 w-9" />}
          </div>
          <div className="mt-5 text-xs font-black uppercase tracking-wider text-emerald-700/80">
            胜负结果
          </div>
          <h2 id="memory-outcome-title" className="mt-1 text-2xl font-black text-slate-950">
            {won ? '配对成功' : '挑战失败'}
          </h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-slate-600">
            {won ? '全部卡片已经完成配对，可以结算本局成绩。' : '时间已经耗尽，可以结算本局成绩。'}
          </p>
        </div>

        <div className="memory-result-stats">
          <MemoryResultStat label="难度" value={meta.name} />
          <MemoryResultStat label="用时" value={formatDurationMs(outcome.duration)} />
          <MemoryResultStat label="步数" value={`${moves} 步`} />
          <MemoryResultStat label="预计得分" value={String(expectedScore)} />
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

function MemoryResultStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="memory-result-stat">
      <div className="text-xs font-black text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-black text-slate-950">{value}</div>
    </div>
  );
}

function MemoryRulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="memory-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="memory-rules-title">
      <div className="memory-rules-modal">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 text-xs font-black text-emerald-600">RULE BOOK</div>
            <h2 id="memory-rules-title" className="text-2xl font-black text-slate-950">
              记忆卡片规则
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

        <div className="memory-rule-grid">
          <RuleItem icon={<MousePointer2 className="h-5 w-5" />} title="翻牌方式" text="每次翻开两张卡。图案相同则保留，不同则短暂展示后盖回。" />
          <RuleItem icon={<Target className="h-5 w-5" />} title="胜利条件" text="在 3 分钟内找出全部配对即为完成，超时会按失败结算。" />
          <RuleItem icon={<Trophy className="h-5 w-5" />} title="得分规则" text="服务端按真实步数复算。步数越接近最优配对步数，最终得分越高。" />
          <RuleItem icon={<RotateCcw className="h-5 w-5" />} title="断线恢复" text="未完成局会自动恢复，倒计时按真实开局时间继续，不会重新获得完整时间。" />
        </div>
      </div>
    </div>
  );
}

function RuleItem({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <article className="memory-rule-item">
      {icon}
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}
