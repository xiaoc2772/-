'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Apple,
  ArrowLeft,
  BookOpen,
  Clock3,
  Loader2,
  MousePointer2,
  Sparkles,
  Trophy,
  X,
} from 'lucide-react';
import { useGameSession } from './hooks/useGameSession';
import { DifficultySelect } from './components/DifficultySelect';
import { GameBoard } from './components/GameBoard';
import { GameHeader } from './components/GameHeader';
import { ResultModal } from './components/ResultModal';
import { CancelConfirmModal } from '../_components/CancelConfirmModal';
import { LINKGAME_DIFFICULTY_CONFIG } from './lib/constants';
import {
  canMatchByConfig,
  removeMatchByConfig,
  findMatchPath,
  findHintByConfig,
  checkGameComplete,
  calculateScore,
  isStack3DConfig,
  isStackTileSelectable,
  positionOfIndex,
} from '@/lib/linkgame';
import type {
  LinkGameDifficulty,
  LinkGameMove,
  LinkGamePosition,
  LinkGameSettlementOutcome,
} from '@/lib/types/game';

type GamePhase = 'select' | 'playing' | 'outcome' | 'result';

interface GameResult {
  moves: number;
  completed: boolean;
  outcome: LinkGameSettlementOutcome;
  score: number;
  pointsEarned: number;
  duration: number;
  matchedPairs: number;
}

interface GameOutcome {
  moves: LinkGameMove[];
  timeRemaining: number;
  completed: boolean;
  outcome: LinkGameSettlementOutcome;
  scorePreview: number;
  matchedPairs: number;
  totalPairs: number;
  difficulty: LinkGameDifficulty;
}

const DIFFICULTY_LABEL: Record<LinkGameDifficulty, string> = {
  easy: '简单',
  normal: '普通',
  hard: '困难',
};

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function getRestoredRemainingSeconds(activeSession: {
  config: { timeLimit: number };
  remainingSeconds?: number;
  playableUntil?: number;
  startedAt?: number;
}) {
  const fallbackPlayableUntil =
    typeof activeSession.startedAt === 'number'
      ? activeSession.startedAt + activeSession.config.timeLimit * 1000
      : 0;
  const playableUntil = activeSession.playableUntil ?? fallbackPlayableUntil;
  const rawRemaining =
    typeof activeSession.remainingSeconds === 'number'
      ? activeSession.remainingSeconds
      : Math.ceil((playableUntil - Date.now()) / 1000);
  return Math.max(0, Math.min(activeSession.config.timeLimit, rawRemaining));
}

export default function LinkGamePage() {
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
  } = useGameSession();

  const [phase, setPhase] = useState<GamePhase>('select');
  const [selectedDifficulty, setSelectedDifficulty] = useState<LinkGameDifficulty>('easy');
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [pendingOutcome, setPendingOutcome] = useState<GameOutcome | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const [board, setBoard] = useState<(string | null)[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [matchedPairs, setMatchedPairs] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [shakingIndices, setShakingIndices] = useState<number[]>([]);
  const [matchingIndices, setMatchingIndices] = useState<number[]>([]);
  const [matchPaths, setMatchPaths] = useState<LinkGamePosition[][] | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const matchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const sessionRef = useRef(session);
  const movesRef = useRef<LinkGameMove[]>([]);
  const matchedPairsRef = useRef(0);
  const timeRemainingRef = useRef(0);
  const autoSubmittedOutcomeRef = useRef(false);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (matchTimerRef.current) clearTimeout(matchTimerRef.current);
    };
  }, []);

  const clearBoardFeedback = useCallback((clearPath = false) => {
    if (clearPath) {
      setMatchPaths(null);
    }
  }, []);

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

  const applyRestoredSession = useCallback((activeSession: NonNullable<typeof session>) => {
    setBoard(activeSession.tileLayout);
    setSelectedDifficulty(activeSession.difficulty);
    const next = getRestoredRemainingSeconds(activeSession);
    setTimeRemaining(next);
    timeRemainingRef.current = next;
    setPhase('playing');
  }, []);

  const applyFreshSession = useCallback((activeSession: NonNullable<typeof session>) => {
    setBoard(activeSession.tileLayout);
    setTimeRemaining(activeSession.config.timeLimit);
    timeRemainingRef.current = activeSession.config.timeLimit;
    setPhase('playing');
    setSelectedDifficulty(activeSession.difficulty);
  }, []);

  useEffect(() => {
    if (session && phase !== 'outcome' && phase !== 'result' && isRestored) {
      const frame = requestAnimationFrame(() => {
        applyRestoredSession(session);
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [session, isRestored, phase, applyRestoredSession]);

  const handleGameOver = useCallback((
    completed: boolean,
    outcome: LinkGameSettlementOutcome = completed ? 'completed' : 'timeout',
    scoreOverride?: number
  ) => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (matchTimerRef.current) {
      clearTimeout(matchTimerRef.current);
      matchTimerRef.current = null;
    }

    if (!sessionRef.current) return;

    clearBoardFeedback(true);
    setSelected([]);
    setShakingIndices([]);
    setMatchingIndices([]);
    setIsProcessing(false);
    const activeSession = sessionRef.current;
    const finalScore = outcome === 'timeout' && activeSession.difficulty !== 'hard'
      ? 0
      : (scoreOverride ?? score);
    setPendingOutcome({
      moves: movesRef.current,
      timeRemaining: timeRemainingRef.current,
      completed,
      outcome,
      scorePreview: finalScore,
      matchedPairs: matchedPairsRef.current,
      totalPairs: sessionRef.current.config.pairs,
      difficulty: sessionRef.current.difficulty,
    });
    setSelectedDifficulty(sessionRef.current.difficulty);
    setPhase('outcome');
  }, [clearBoardFeedback, score]);

  const handleSettleOutcome = useCallback(async () => {
    if (!pendingOutcome) return;

    const result = await submitResult(
      pendingOutcome.moves,
      pendingOutcome.completed,
      pendingOutcome.outcome
    );

    if (result) {
      setGameResult({
        moves: result.record.moves,
        completed: result.record.completed,
        outcome: result.record.outcome ?? pendingOutcome.outcome,
        score: result.record.score,
        pointsEarned: result.pointsEarned,
        duration: result.record.duration,
        matchedPairs: pendingOutcome.matchedPairs,
      });
      setSelectedDifficulty(pendingOutcome.difficulty);
      setPendingOutcome(null);
      setPhase('result');
    } else {
      autoSubmittedOutcomeRef.current = false;
    }
  }, [pendingOutcome, submitResult]);

  useEffect(() => {
    if (phase !== 'outcome' || !pendingOutcome) return;
    if (autoSubmittedOutcomeRef.current) return;
    autoSubmittedOutcomeRef.current = true;

    const timer = window.setTimeout(() => {
      void handleSettleOutcome();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [phase, pendingOutcome, handleSettleOutcome]);

  useEffect(() => {
    if (phase !== 'playing' || showCancelConfirm) return;
    if (timerRef.current) return;

    timerRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          timeRemainingRef.current = 0;
          void handleGameOver(false, 'timeout');
          return 0;
        }

        const next = prev - 1;
        timeRemainingRef.current = next;
        return next;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [phase, handleGameOver, showCancelConfirm]);

  useEffect(() => {
    if (phase !== 'playing' || !session || isProcessing || board.length === 0) return;
    if (!isStack3DConfig(session.config) || checkGameComplete(board)) return;
    if (findHintByConfig(board, session.config) !== null) return;

    const frame = requestAnimationFrame(() => {
      void handleGameOver(false, 'deadlock');
    });
    return () => cancelAnimationFrame(frame);
  }, [board, handleGameOver, isProcessing, phase, session]);

  const startNewGame = async (difficulty: LinkGameDifficulty) => {
    const success = await startGame(difficulty);
    if (success) {
      setGameResult(null);
      setPendingOutcome(null);
      setScore(0);
      setCombo(0);
      setMatchedPairs(0);
      matchedPairsRef.current = 0;
      movesRef.current = [];
      setSelected([]);
      setShakingIndices([]);
      setMatchingIndices([]);
      clearBoardFeedback(true);
      setMatchPaths(null);
      setIsProcessing(false);
      autoSubmittedOutcomeRef.current = false;
    }
  };

  const handleSelectDifficulty = async (difficulty: LinkGameDifficulty) => {
    if (loading || status?.inCooldown) return;
    if (selectedDifficulty !== difficulty) {
      setSelectedDifficulty(difficulty);
      return;
    }
    await startNewGame(difficulty);
  };

  useEffect(() => {
    if (session && phase === 'select' && !isRestored) {
      const frame = requestAnimationFrame(() => {
        applyFreshSession(session);
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [session, phase, isRestored, applyFreshSession]);

  const handleTileClick = (index: number) => {
    if (showCancelConfirm) return;
    if (!session || isProcessing) return;

    const tile = board[index];
    if (tile === null) return;

    const config = session.config;
    const isStackMode = isStack3DConfig(config);
    const isHardStackMode = isStackMode && session.difficulty === 'hard';
    const pos = positionOfIndex(index, config);

    if (isStackMode && !isStackTileSelectable(board, pos, config)) {
      return;
    }

    clearBoardFeedback(true);

    if (selected.includes(index)) {
      setSelected(selected.filter((i) => i !== index));
      return;
    }

    if (selected.length === 0) {
      setSelected([index]);
      return;
    }

    const firstIndex = selected[0];
    const firstTile = board[firstIndex];
    if (firstTile !== tile) {
      setSelected([index]);
      return;
    }

    const pos1 = positionOfIndex(firstIndex, config);
    const pos2 = pos;
    const matched = canMatchByConfig(board, pos1, pos2, config);

    const move: LinkGameMove = {
      type: 'match',
      pos1,
      pos2,
      matched,
      timestamp: Date.now(),
    };
    movesRef.current = [...movesRef.current, move];

    setIsProcessing(true);
    if (matched) {
      setMatchingIndices([firstIndex, index]);
      const path = isStackMode ? null : findMatchPath(board, pos1, pos2, config.cols);
      setMatchPaths(path ? [path] : null);

      const newMatchedPairs = matchedPairsRef.current + 1;
      const newCombo = isHardStackMode ? 0 : combo + 1;

      matchTimerRef.current = setTimeout(() => {
        matchTimerRef.current = null;
        const newBoard = removeMatchByConfig(board, pos1, pos2, config);
        setBoard(newBoard);
        setSelected([]);
        setMatchingIndices([]);
        setMatchPaths(null);
        setIsProcessing(false);

        setMatchedPairs(newMatchedPairs);
        matchedPairsRef.current = newMatchedPairs;
        setCombo(newCombo);

        const scoreParams = {
          matchedPairs: newMatchedPairs,
          baseScore: session.config.baseScore,
          combo: isHardStackMode ? 0 : Math.max(0, newCombo - 1),
          timeRemainingSeconds: timeRemainingRef.current,
          difficulty: session.difficulty,
          totalPairs: session.config.pairs,
        };
        const currentScore = calculateScore({
          ...scoreParams,
          outcome: 'timeout',
        });
        setScore(currentScore);

        if (checkGameComplete(newBoard)) {
          const finalScore = calculateScore({
            ...scoreParams,
            outcome: 'completed',
          });
          setScore(finalScore);
          void handleGameOver(true, 'completed', finalScore);
        } else if (isStackMode && findHintByConfig(newBoard, config) === null) {
          const finalScore = calculateScore({
            ...scoreParams,
            outcome: 'deadlock',
          });
          setScore(finalScore);
          void handleGameOver(false, 'deadlock', finalScore);
        }
      }, 500);
    } else {
      setMatchPaths(null);
      setShakingIndices([firstIndex, index]);
      matchTimerRef.current = setTimeout(() => {
        matchTimerRef.current = null;
        setSelected([]);
        setCombo(0);
        setShakingIndices([]);
        setIsProcessing(false);
      }, 400);
    }
  };

  const handleCancel = async () => {
    if (matchTimerRef.current) {
      clearTimeout(matchTimerRef.current);
      matchTimerRef.current = null;
    }
    const cancelled = await cancelGame();
    if (cancelled) {
      setSelected([]);
      clearBoardFeedback(true);
      setMatchPaths(null);
      setPhase('select');
    }
  };

  const confirmCancelGame = async () => {
    await handleCancel();
    setShowCancelConfirm(false);
  };

  const handlePlayAgain = async () => {
    setGameResult(null);
    setPendingOutcome(null);
    setPhase('select');
    resetSubmitFlag();
    autoSubmittedOutcomeRef.current = false;
    await fetchStatus();
  };

  const handleBackToGames = () => {
    router.push('/games');
  };

  const selectedConfig = LINKGAME_DIFFICULTY_CONFIG[selectedDifficulty];
  const currentConfig = session?.config ?? selectedConfig;
  const currentIsStackMode = isStack3DConfig(currentConfig);
  const phaseLabel = phase === 'playing' ? '连线指令' : phase === 'outcome' ? '胜负结果' : phase === 'result' ? '本局结算' : '出发准备';
  const tacticalLine = phase === 'playing'
    ? (currentIsStackMode ? '选择图案相同且完全露出的卡片。' : '选择两个相同图案，连线不超过两次转弯即可消除。')
    : phase === 'outcome'
      ? '本局已结束，确认后提交服务端结算。'
    : phase === 'result'
      ? '本局成绩已经生成，可以继续挑战。'
      : '点选难度，再次点击已选难度开始。';
  const message = status?.inCooldown
    ? `冷却中，还需 ${status.cooldownRemaining}s`
    : phase === 'playing'
      ? `剩余 ${formatTime(timeRemaining)}，已消除 ${matchedPairs}/${currentConfig.pairs} 对`
      : phase === 'outcome'
        ? (pendingOutcome?.outcome === 'deadlock' ? '牌面无可消除，自动结算中' : pendingOutcome?.completed ? '连线清空，准备结算' : '时间耗尽，准备结算')
      : phase === 'result'
        ? (gameResult?.outcome === 'deadlock' ? '死局结算完成' : gameResult?.completed ? '恭喜通关' : '本局结束')
        : `${DIFFICULTY_LABEL[selectedDifficulty]}难度已选中`;

  return (
    <div className="link-page">
      <div className="link-mesh-bg" aria-hidden />
      <div className="link-stars" aria-hidden>
        <span style={{ top: '9%', left: '6%', fontSize: 14 }}>✦</span>
        <span style={{ top: '22%', left: '91%', fontSize: 11, animationDelay: '1s' }}>✦</span>
        <span style={{ top: '46%', left: '4%', fontSize: 16, animationDelay: '2.5s' }}>✧</span>
        <span style={{ top: '76%', left: '94%', fontSize: 12, animationDelay: '0.7s' }}>✧</span>
      </div>

      <header className="link-topbar">
        <Link href="/games" className="link-exit-btn">
          <span className="arrow">
            <ArrowLeft size={14} strokeWidth={2.4} />
          </span>
          EXIT
        </Link>
      </header>

      <main className="link-container">
        {error && (
          <div className="link-error-banner" role="alert">
            {error}
          </div>
        )}

        <section className="link-command-bar" aria-live="polite">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-black text-emerald-700">
              <Apple className="h-4 w-4" />
              <span>{phaseLabel}</span>
              <span className="text-slate-300">/</span>
              <span className="text-slate-500">{tacticalLine}</span>
            </div>
            <p className="truncate text-lg font-black text-slate-950 sm:text-xl">{message}</p>
          </div>
          <div className="link-command-actions">
            <button
              onClick={() => setShowRules(true)}
              type="button"
              className="inline-flex flex-none items-center justify-center gap-1.5 rounded-full border border-emerald-200 bg-white px-4 py-2 text-sm font-bold text-emerald-700 transition-colors hover:bg-emerald-50"
            >
              <BookOpen className="h-4 w-4" />
              规则
            </button>
            {phase === 'playing' && (
              <button
                onClick={() => setShowCancelConfirm(true)}
                disabled={loading || isProcessing}
                className="inline-flex flex-none items-center justify-center gap-1.5 rounded-full border border-rose-200 bg-white px-4 py-2 text-sm font-bold text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-50"
                type="button"
              >
                <X className="h-4 w-4" />
                取消
              </button>
            )}
          </div>
        </section>

        {phase === 'select' && (
          <div className="link-ready-layout">
            <section className="glass-card stage-card">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <h2 className="section-title">
                  <span className="st-icon">
                    <Apple size={18} />
                  </span>
                  选择难度
                </h2>
                <span className="link-cute-pill">
                  <Apple className="h-4 w-4" />
                  不同难度 = 不同棋盘大小
                </span>
              </div>
              <DifficultySelect
                onSelect={handleSelectDifficulty}
                selectedDifficulty={selectedDifficulty}
                disabled={loading || Boolean(status?.inCooldown)}
                loading={loading}
                cooldownRemaining={status?.inCooldown ? status.cooldownRemaining : 0}
              />
            </section>
          </div>
        )}

        {phase === 'playing' && session && (
          <div className="link-game-layout">
            <section className="glass-card stage-card link-board-card">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
                      {DIFFICULTY_LABEL[session.difficulty]}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                      进行中
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-bold text-slate-600">{message}</p>
                </div>

                <div className="link-tool-switch" aria-label="当前操作">
                  <span className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-black text-emerald-700 shadow-sm">
                    <MousePointer2 className="h-4 w-4" />
                    配对
                  </span>
                </div>
              </div>

              <GameBoard
                tileLayout={board}
                config={session.config}
                selected={selected}
                onSelect={handleTileClick}
                shakingIndices={shakingIndices}
                matchingIndices={matchingIndices}
                matchPaths={matchPaths ?? undefined}
              />
            </section>

            <aside className="link-side-panel">
              <section className="glass-card stage-card">
                <h2 className="section-title">
                  <span className="st-icon">
                    <Clock3 size={18} />
                  </span>
                  局内状态
                </h2>
                <GameHeader
                  timeRemaining={timeRemaining}
                  score={score}
                  combo={combo}
                  bonusLabel={isStack3DConfig(session.config) ? '层压' : '连击'}
                  bonusValue={
                    isStack3DConfig(session.config)
                      ? `${Math.round((matchedPairs / session.config.pairs) * 100)}%`
                      : `${combo}x`
                  }
                  matchedPairs={matchedPairs}
                  totalPairs={session.config.pairs}
                />
              </section>
            </aside>
          </div>
        )}

        {phase === 'outcome' && pendingOutcome && (
          <LinkGameOutcomeModal
            outcome={pendingOutcome}
            loading={loading}
            error={error}
            onSubmit={() => void handleSettleOutcome()}
          />
        )}

        {phase === 'result' && gameResult && (
          <ResultModal
            isOpen={true}
            difficulty={selectedDifficulty}
            completed={gameResult.completed}
            outcome={gameResult.outcome}
            score={gameResult.score}
            pointsEarned={gameResult.pointsEarned}
            matchedPairs={gameResult.matchedPairs}
            moves={gameResult.moves}
            duration={gameResult.duration}
            onPlayAgain={handlePlayAgain}
            onBackToGames={handleBackToGames}
          />
        )}
      </main>

      <CancelConfirmModal
        open={showCancelConfirm}
        loading={loading || isProcessing}
        title="确认放弃连连看？"
        description="当前连线进度会被取消，本局不会进入结算。"
        detail="已消除的卡牌、连线步数和剩余时间都会丢失。"
        onConfirm={() => void confirmCancelGame()}
        onClose={() => setShowCancelConfirm(false)}
      />

      {showRules && (
        <div className="link-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="linkgame-rules-title">
          <div className="link-rules-modal">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-black uppercase tracking-wider text-emerald-700/80">
                  规则
                </div>
                <h2 id="linkgame-rules-title" className="mt-1 text-2xl font-black text-slate-950">
                  连连看
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowRules(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
                aria-label="关闭规则"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-5 grid gap-3">
              <RuleRow icon={<MousePointer2 className="h-5 w-5" />} title="配对" text="选择两个相同图案。" />
              <RuleRow icon={<Sparkles className="h-5 w-5" />} title="连线" text="简单和普通为二维连线，直线、一折、两折且路径无阻挡即可消除。" />
              <RuleRow icon={<MousePointer2 className="h-5 w-5" />} title="困难" text="困难为 8×8×5 五层栈式牌桌，任意两张图案相同且都未被上层遮挡的卡片即可消除。" />
              <RuleRow icon={<Sparkles className="h-5 w-5" />} title="随机" text="困难卡牌种类减少，前期更容易开局；越到底层可消除选择越少，死局概率由 0% 逐层升高，最高约 10%。" />
              <RuleRow icon={<Trophy className="h-5 w-5" />} title="胜败" text="困难只有清空 66 对卡牌算胜利；死局和时间截止都算失败，用通关局数除以困难结算局数即可计算胜率。" />
              <RuleRow icon={<Trophy className="h-5 w-5" />} title="结算" text="简单和普通仍按得分 1% 结算；困难通关按 20%，死局按 10%，时间截止按 1%，均向下取整。" />
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .link-page {
          position: relative;
          min-height: 100vh;
          overflow-x: hidden;
          background:
            radial-gradient(circle at 14% 10%, rgba(16, 185, 129, 0.2), transparent 30%),
            radial-gradient(circle at 86% 8%, rgba(251, 191, 36, 0.18), transparent 28%),
            linear-gradient(135deg, #f0fdf4 0%, #fff7ed 48%, #eef2ff 100%);
          color: #0f172a;
        }
        .link-page .link-mesh-bg {
          position: fixed;
          inset: 0;
          pointer-events: none;
          background-image:
            linear-gradient(rgba(16, 185, 129, 0.08) 1px, transparent 1px),
            linear-gradient(90deg, rgba(16, 185, 129, 0.08) 1px, transparent 1px);
          background-size: 42px 42px;
          mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.76), transparent 78%);
        }
        .link-page .link-stars {
          position: fixed;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
        }
        .link-page .link-stars span {
          position: absolute;
          color: rgba(255, 255, 255, 0.82);
          animation: link-twinkle 3s ease-in-out infinite;
        }
        @keyframes link-twinkle {
          0%, 100% { opacity: 0.28; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.32); }
        }
        .link-page .link-topbar {
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
        .link-page .link-exit-btn {
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
        .link-page .link-exit-btn .arrow {
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
        .link-page .link-container {
          position: relative;
          z-index: 1;
          max-width: 1360px;
          margin: 0 auto;
          padding: 22px 48px 92px;
          display: flex;
          flex-direction: column;
          gap: 22px;
        }
        .link-page .link-error-banner {
          padding: 13px 18px;
          border-radius: 18px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #b91c1c;
          font-size: 14px;
          font-weight: 800;
        }
        .link-page .link-command-bar {
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
        .link-page .link-command-actions {
          display: flex;
          flex: none;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 8px;
        }
        .link-page .glass-card {
          background: rgba(255, 255, 255, 0.88);
          border: 1px solid rgba(255, 255, 255, 0.95);
          border-radius: 30px;
          box-shadow: 0 24px 48px rgba(15, 23, 42, 0.07);
          backdrop-filter: blur(24px);
        }
        .link-page .stage-card {
          padding: 24px;
        }
        .link-page .section-title {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 0;
          font-size: 20px;
          font-weight: 950;
          color: #0f172a;
        }
        .link-page .st-icon {
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
        .link-page .link-cute-pill {
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
        .link-page .link-ready-layout {
          display: block;
        }
        .link-page .link-game-layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(280px, 330px);
          gap: 24px;
          align-items: start;
        }
        .link-page .link-board-card {
          min-width: 0;
        }
        .link-page .link-tool-switch {
          display: flex;
          border-radius: 16px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          padding: 4px;
        }
        .link-page .link-side-panel {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .link-page .link-difficulty-wrap {
          width: 100%;
          max-width: 940px;
          margin: 0 auto;
        }
        .link-page .link-difficulty-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 24px;
          margin-top: 34px;
        }
        .link-page .link-difficulty-card {
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
          animation: link-card-in 0.42s ease both;
        }
        .link-page .link-difficulty-card:hover {
          transform: translateY(-8px);
          border-color: #fff;
          box-shadow: 0 24px 44px rgba(15, 23, 42, 0.1);
        }
        .link-page .link-difficulty-card:active {
          transform: scale(0.98);
        }
        .link-page .link-difficulty-card.is-selected {
          border-color: #fff;
          box-shadow: 0 20px 42px rgba(16, 185, 129, 0.18), 0 0 0 3px rgba(16, 185, 129, 0.24);
        }
        .link-page .link-difficulty-card:disabled {
          cursor: not-allowed;
          opacity: 0.5;
          transform: none;
        }
        .link-page .link-difficulty-glow {
          position: absolute;
          inset: 0;
          opacity: 0;
          transition: opacity 0.5s ease;
        }
        .link-page .link-difficulty-card:hover .link-difficulty-glow,
        .link-page .link-difficulty-card.is-selected .link-difficulty-glow {
          opacity: 1;
        }
        .link-page .link-difficulty-icon {
          font-size: 56px;
          line-height: 1;
          filter: drop-shadow(0 8px 12px rgba(15, 23, 42, 0.1));
          transform-origin: left center;
          transition: transform 0.3s ease;
        }
        .link-page .link-difficulty-card:hover .link-difficulty-icon {
          transform: scale(1.1) rotate(10deg);
        }
        .link-page .link-size-pill {
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
        .link-page .link-difficulty-card:hover .link-size-pill,
        .link-page .link-difficulty-card.is-selected .link-size-pill {
          background: rgba(255, 255, 255, 0.2);
          color: #fff;
        }
        .link-page .link-selected-start {
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
        .link-page .link-difficulty-card:hover .link-selected-start,
        .link-page .link-selected-start.is-visible {
          background: rgba(255, 255, 255, 0.2);
          color: #fff;
          opacity: 1;
        }
        @keyframes link-card-in {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .link-page .link-board-surface {
          position: relative;
          overflow: hidden;
          width: 100%;
          max-width: 720px;
          margin: 0 auto;
          padding: 10px;
          border-radius: 24px;
          border: 1px solid #d1fae5;
          background: #d1fae5;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.72);
        }
        .link-page .link-board-surface.is-stack {
          overflow: visible;
          padding: 54px 34px 24px 14px;
          background:
            linear-gradient(135deg, rgba(255, 255, 255, 0.38), transparent 42%),
            repeating-linear-gradient(135deg, rgba(15, 118, 110, 0.13) 0 1px, transparent 1px 14px),
            linear-gradient(145deg, #a7f3d0 0%, #bfdbfe 54%, #fde68a 100%);
        }
        .link-page .link-board-grid {
          display: grid;
          gap: 6px;
          position: relative;
          z-index: 1;
          margin: 0 auto;
        }
        .link-page .link-stack-board {
          position: relative;
          z-index: 1;
          width: min(100%, 720px);
          margin: 0 auto;
          isolation: isolate;
        }
        .link-page .link-stack-layer {
          position: absolute;
          inset: 0;
          display: grid;
          gap: 6px;
          pointer-events: none;
          filter: drop-shadow(0 16px 18px rgba(15, 23, 42, 0.08));
        }
        .link-page .link-stack-layer.layer-0 {
          filter: drop-shadow(0 18px 18px rgba(20, 83, 45, 0.1));
        }
        .link-page .link-stack-layer.layer-1 {
          filter: drop-shadow(0 20px 20px rgba(14, 116, 144, 0.12));
        }
        .link-page .link-stack-layer.layer-2 {
          filter: drop-shadow(0 22px 22px rgba(194, 65, 12, 0.12));
        }
        .link-page .link-stack-layer.layer-3 {
          filter: drop-shadow(0 24px 22px rgba(190, 24, 93, 0.13));
        }
        .link-page .link-stack-layer.layer-4 {
          filter: drop-shadow(0 26px 24px rgba(88, 28, 135, 0.16));
        }
        .link-page .link-stack-cell {
          min-width: 0;
          min-height: 0;
          pointer-events: auto;
        }
        .link-page .link-stack-cell.is-empty {
          pointer-events: none;
        }
        .link-page .link-stack-tile {
          transform-origin: center;
          overflow: hidden;
          box-shadow: 0 4px 0 rgba(15, 23, 42, 0.08), 0 12px 18px rgba(15, 23, 42, 0.08);
        }
        .link-page .link-stack-tile::after {
          content: "";
          position: absolute;
          inset: 2px 4px auto 4px;
          height: 34%;
          border-radius: 999px;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.88), rgba(255, 255, 255, 0));
          pointer-events: none;
        }
        .link-page .link-stack-layer.layer-0 .link-stack-tile {
          background: linear-gradient(160deg, #bbf7d0 0%, #34d399 56%, #047857 100%);
          border-color: rgba(5, 150, 105, 0.96);
        }
        .link-page .link-stack-layer.layer-1 .link-stack-tile {
          background: linear-gradient(160deg, #bae6fd 0%, #38bdf8 56%, #1d4ed8 100%);
          border-color: rgba(14, 116, 144, 0.98);
        }
        .link-page .link-stack-layer.layer-2 .link-stack-tile {
          background: linear-gradient(160deg, #fed7aa 0%, #fb923c 56%, #c2410c 100%);
          border-color: rgba(194, 65, 12, 0.98);
        }
        .link-page .link-stack-layer.layer-3 .link-stack-tile {
          background: linear-gradient(160deg, #fbcfe8 0%, #f472b6 56%, #be185d 100%);
          border-color: rgba(190, 24, 93, 0.98);
        }
        .link-page .link-stack-layer.layer-4 .link-stack-tile {
          background: linear-gradient(160deg, #ddd6fe 0%, #a78bfa 56%, #6d28d9 100%);
          border-color: rgba(109, 40, 217, 0.98);
        }
        .link-page .link-stack-tile.is-covered {
          cursor: not-allowed;
          opacity: 0.42;
          filter: grayscale(0.2) saturate(0.58);
          transform: scale(0.9);
        }
        .link-page .link-status-grid {
          margin-top: 16px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .link-page .link-stat-card {
          border-radius: 18px;
          border: 1px solid rgba(226, 232, 240, 0.95);
          background: rgba(248, 250, 252, 0.9);
          padding: 12px;
        }
        .link-page .link-action-grid {
          margin-top: 12px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .link-page .link-action-btn {
          display: inline-flex;
          min-height: 44px;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border-radius: 16px;
          border: 1px solid transparent;
          padding: 10px 12px;
          font-size: 13px;
          font-weight: 950;
          transition: transform 0.2s ease, opacity 0.2s ease, background 0.2s ease;
        }
        .link-page .link-action-btn:hover:not(:disabled) {
          transform: translateY(-2px);
        }
        .link-page .link-action-btn:disabled {
          cursor: not-allowed;
          opacity: 0.45;
        }
        .link-page .link-modal-overlay {
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
        .link-page .link-rules-modal {
          width: min(540px, 100%);
          max-height: min(86vh, 680px);
          overflow-y: auto;
          border-radius: 28px;
          border: 1px solid rgba(167, 243, 208, 0.95);
          background: linear-gradient(180deg, #fff 0%, #ecfdf5 100%);
          padding: 24px;
          box-shadow: 0 30px 70px rgba(15, 23, 42, 0.3);
        }
        .link-page .link-result-modal {
          width: min(520px, 100%);
          max-height: min(86vh, 760px);
          overflow: auto;
          border-radius: 30px;
          border: 1px solid rgba(255, 255, 255, 0.92);
          background: rgba(255, 255, 255, 0.96);
          padding: 24px;
          box-shadow: 0 28px 90px rgba(15, 23, 42, 0.24);
        }
        .link-page .link-result-modal.won {
          box-shadow: 0 28px 90px rgba(5, 150, 105, 0.24);
        }
        .link-page .link-result-modal.lost {
          box-shadow: 0 28px 90px rgba(225, 29, 72, 0.2);
        }
        .link-page .link-result-icon {
          display: flex;
          height: 82px;
          width: 82px;
          align-items: center;
          justify-content: center;
          border-radius: 28px;
          color: #fff;
        }
        .link-page .link-result-icon.won {
          background: linear-gradient(135deg, #34d399, #059669);
          box-shadow: 0 18px 34px rgba(5, 150, 105, 0.25);
        }
        .link-page .link-result-icon.lost {
          background: linear-gradient(135deg, #fb7185, #be123c);
          box-shadow: 0 18px 34px rgba(190, 18, 60, 0.22);
        }
        .link-page .link-result-stats {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-top: 20px;
        }
        .link-page .link-result-stat {
          border-radius: 18px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          padding: 12px;
          text-align: center;
        }
        .link-page .link-rule-row {
          display: grid;
          grid-template-columns: 40px minmax(0, 1fr);
          gap: 12px;
          align-items: start;
          border-radius: 18px;
          border: 1px solid rgba(226, 232, 240, 0.9);
          background: rgba(255, 255, 255, 0.82);
          padding: 12px;
        }
        .link-page .link-rule-icon {
          display: inline-flex;
          height: 40px;
          width: 40px;
          align-items: center;
          justify-content: center;
          border-radius: 14px;
          background: #d1fae5;
          color: #047857;
        }
        @media (max-width: 1080px) {
          .link-page .link-topbar {
            padding: 14px 22px;
          }
          .link-page .link-container {
            padding: 22px 22px 82px;
          }
          .link-page .link-game-layout {
            grid-template-columns: 1fr;
          }
          .link-page .link-difficulty-grid {
            grid-template-columns: 1fr;
            gap: 16px;
          }
        }
        @media (max-width: 768px) {
          .link-page .link-topbar {
            padding: 12px 14px;
          }
          .link-page .link-exit-btn {
            padding: 7px 14px 7px 7px;
            font-size: 12px;
          }
          .link-page .link-exit-btn .arrow {
            width: 26px;
            height: 26px;
          }
          .link-page .link-container {
            padding: 16px 14px 92px;
            gap: 18px;
          }
          .link-page .stage-card {
            padding: 14px;
            border-radius: 24px;
          }
          .link-page .link-command-bar {
            align-items: stretch;
            flex-direction: column;
            padding: 14px;
          }
          .link-page .link-command-bar p {
            white-space: normal;
          }
          .link-page .link-command-actions,
          .link-page .link-command-actions button,
          .link-page .link-tool-switch {
            width: 100%;
          }
          .link-page .link-cute-pill {
            width: 100%;
            justify-content: center;
          }
          .link-page .link-difficulty-wrap h3 {
            font-size: 24px;
          }
          .link-page .link-difficulty-grid {
            margin-top: 22px;
          }
          .link-page .link-difficulty-card {
            min-height: 218px;
            border-radius: 26px;
            padding: 20px;
          }
          .link-page .link-board-surface {
            padding: 6px;
            border-radius: 18px;
          }
          .link-page .link-board-surface.is-stack {
            padding: 34px 18px 14px 4px;
          }
          .link-page .link-board-grid {
            gap: 4px;
          }
          .link-page .link-stack-layer {
            gap: 4px;
          }
          .link-page .link-stack-tile {
            border-radius: 12px;
            font-size: 18px;
          }
          .link-page .link-status-grid,
          .link-page .link-action-grid {
            grid-template-columns: 1fr 1fr;
          }
          .link-page .link-rules-modal {
            border-radius: 22px;
            padding: 18px;
          }
          .link-page .link-result-modal {
            border-radius: 22px;
            padding: 18px;
          }
          .link-page .link-result-stats {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

function LinkGameOutcomeModal({
  outcome,
  loading,
  error,
  onSubmit,
}: {
  outcome: GameOutcome;
  loading: boolean;
  error?: string | null;
  onSubmit: () => void;
}) {
  const won = outcome.completed;
  const isDeadlock = outcome.outcome === 'deadlock';

  return (
    <div className="link-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="linkgame-outcome-title">
      <div className={`link-result-modal ${won ? 'won' : 'lost'}`}>
        <div className="flex flex-col items-center text-center">
          <div className={`link-result-icon ${won ? 'won' : 'lost'}`}>
            {won ? <Trophy className="h-9 w-9" /> : <Clock3 className="h-9 w-9" />}
          </div>
          <div className="mt-5 text-xs font-black uppercase tracking-wider text-emerald-700/80">
            胜负结果
          </div>
          <h2 id="linkgame-outcome-title" className="mt-1 text-2xl font-black text-slate-950">
            {won ? '连线清空' : isDeadlock ? '牌面死局' : '挑战失败'}
          </h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-slate-600">
            {won
              ? '整张棋盘已经清空，可以结算本局成绩。'
              : isDeadlock
                ? '当前牌面已经没有可消除的卡牌，系统会自动结算本局成绩。'
                : '时间已经耗尽，可以结算本局成绩。'}
          </p>
        </div>

        <div className="link-result-stats">
          <LinkResultStat label="难度" value={DIFFICULTY_LABEL[outcome.difficulty]} />
          <LinkResultStat label="剩余时间" value={formatTime(outcome.timeRemaining)} />
          <LinkResultStat label="完成对数" value={`${outcome.matchedPairs}/${outcome.totalPairs}`} />
          <LinkResultStat label="预计得分" value={String(outcome.scorePreview)} />
        </div>

        {error && (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-center text-sm font-black text-rose-700" role="alert">
            {error}
          </div>
        )}

        <button
          onClick={onSubmit}
          disabled={loading}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-emerald-200 transition-all hover:-translate-y-0.5 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {loading ? '结算中' : error ? '重新结算' : isDeadlock ? '立即结算' : '结算成绩'}
        </button>
      </div>
    </div>
  );
}

function LinkResultStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="link-result-stat">
      <div className="text-xs font-black text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-black text-slate-950">{value}</div>
    </div>
  );
}

function RuleRow({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="link-rule-row">
      <div className="link-rule-icon">{icon}</div>
      <div>
        <div className="font-black text-slate-900">{title}</div>
        <p className="mt-1 text-sm leading-6 text-slate-600">{text}</p>
      </div>
    </div>
  );
}
