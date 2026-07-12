// src/app/games/memory/components/GameBoard.tsx

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card } from './Card';
import { usePausedGameClock } from '../../_hooks/usePausedGameClock';
import type {
  MemoryDifficulty,
  MemoryDifficultyConfig,
  MemoryFlipResult,
  MemoryMove,
} from '@/lib/types/game';
import { DIFFICULTY_META } from '../lib/constants';

function getRemainingSeconds(startedAt: number, timeLimit: number, now = Date.now()) {
  const elapsedSeconds = Math.floor(Math.max(0, now - startedAt) / 1000);
  return Math.max(0, timeLimit - elapsedSeconds);
}

interface GameBoardProps {
  sessionId: string;
  difficulty: MemoryDifficulty;
  cardLayout: string[];
  moveCount: number;
  matchedCards: number[];
  firstFlippedCard: number | null;
  startedAt: number;
  config: MemoryDifficultyConfig;
  onFlipCard: (sessionId: string, index: number) => Promise<MemoryFlipResult | null>;
  onSyncCardLayout: (sessionId: string, cardLayout: string[]) => void;
  onGameEnd: (moves: MemoryMove[], completed: boolean, duration: number) => void;
  onStatusChange?: (status: {
    difficultyName: string;
    moves: number;
    estimatedScore: number;
    timeLeft: number;
    matchedPairs: number;
    totalPairs: number;
    progress: number;
  }) => void;
  isRestored?: boolean;
  paused?: boolean;
}

export function GameBoard({
  sessionId,
  difficulty,
  cardLayout,
  moveCount,
  matchedCards,
  firstFlippedCard,
  startedAt,
  config,
  onFlipCard,
  onSyncCardLayout,
  onGameEnd,
  onStatusChange,
  isRestored = false,
  paused = false,
}: GameBoardProps) {
  const [flippedCards, setFlippedCards] = useState<number[]>(
    firstFlippedCard !== null ? [firstFlippedCard] : []
  );
  const [matchedSet, setMatchedSet] = useState<Set<number>>(new Set(matchedCards));
  const [moves, setMoves] = useState<MemoryMove[]>([]);
  const [serverMoveCount, setServerMoveCount] = useState(moveCount);
  const [timeLeft, setTimeLeft] = useState(() => getRemainingSeconds(startedAt, config.timeLimit));
  const [isChecking, setIsChecking] = useState(false);
  const [hasEnded, setHasEnded] = useState(false);
  const [pendingCards, setPendingCards] = useState<Set<number>>(new Set());
  
  const startTimeRef = useRef<number>(startedAt);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const flipTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const endCalledRef = useRef(false);  // P2: 防止 onGameEnd 调用两次
  const movesRef = useRef<MemoryMove[]>([]);  // 用于 timer 回调中访问最新 moves

  const difficultyMeta = DIFFICULTY_META[difficulty];
  const gameNow = usePausedGameClock(paused, sessionId);

  // 同步 movesRef
  useEffect(() => {
    movesRef.current = moves;
  }, [moves]);

  useEffect(() => {
    setMatchedSet(new Set(matchedCards));
  }, [matchedCards]);

  useEffect(() => {
    if (firstFlippedCard === null) {
      setFlippedCards([]);
      return;
    }

    if (matchedSet.has(firstFlippedCard)) {
      setFlippedCards([]);
      return;
    }

    setFlippedCards([firstFlippedCard]);
  }, [firstFlippedCard, matchedSet]);

  useEffect(() => {
    setServerMoveCount(moveCount);
  }, [moveCount]);

  useEffect(() => {
    startTimeRef.current = startedAt;
    if (flipTimeoutRef.current) {
      clearTimeout(flipTimeoutRef.current);
      flipTimeoutRef.current = null;
    }
    setTimeLeft(getRemainingSeconds(startedAt, config.timeLimit));
    endCalledRef.current = false;
    setHasEnded(false);
    setIsChecking(false);
    setPendingCards(new Set());
    setMoves([]);
    movesRef.current = [];
  }, [sessionId, startedAt, config.timeLimit]);

  // 计算预估得分
  const estimatedScore = useCallback(() => {
    const optimalMoves = config.pairs;
    const extraMoves = Math.max(0, serverMoveCount - optimalMoves);
    return Math.max(config.minScore, config.baseScore - extraMoves * config.penaltyPerMove);
  }, [serverMoveCount, config]);

  useEffect(() => {
    const matchedPairs = matchedSet.size / 2;
    onStatusChange?.({
      difficultyName: difficultyMeta.name,
      moves: serverMoveCount,
      estimatedScore: estimatedScore(),
      timeLeft,
      matchedPairs,
      totalPairs: config.pairs,
      progress: config.pairs > 0 ? Math.round((matchedPairs / config.pairs) * 100) : 0,
    });
  }, [config.pairs, difficultyMeta.name, estimatedScore, matchedSet.size, onStatusChange, serverMoveCount, timeLeft]);

  // 游戏结束处理（只调用一次）
  const handleGameEnd = useCallback((completed: boolean) => {
    if (endCalledRef.current) return;
    endCalledRef.current = true;
    setHasEnded(true);
    
    // 清理定时器
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (flipTimeoutRef.current) {
      clearTimeout(flipTimeoutRef.current);
      flipTimeoutRef.current = null;
    }
    
    const duration = Math.max(0, gameNow() - startTimeRef.current);
    onGameEnd(movesRef.current, completed, duration);
  }, [gameNow, onGameEnd]);

  // 倒计时
  useEffect(() => {
    const updateTimer = () => {
      const nextTimeLeft = getRemainingSeconds(startTimeRef.current, config.timeLimit, gameNow());
      setTimeLeft(nextTimeLeft);
      if (nextTimeLeft <= 0) {
        handleGameEnd(false);
      }
      return nextTimeLeft;
    };

    if (updateTimer() > 0) {
      timerRef.current = setInterval(updateTimer, 1000);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [config.timeLimit, gameNow, handleGameEnd]);

  useEffect(() => {
    return () => {
      if (flipTimeoutRef.current) {
        clearTimeout(flipTimeoutRef.current);
        flipTimeoutRef.current = null;
      }
    };
  }, []);

  // 检查是否完成
  useEffect(() => {
    if (matchedSet.size === cardLayout.length && !endCalledRef.current) {
      Promise.resolve().then(() => handleGameEnd(true));
    }
  }, [matchedSet.size, cardLayout.length, handleGameEnd]);

  // 翻牌逻辑
  const handleCardClick = useCallback(async (index: number) => {
    if (
      isChecking ||
      paused ||
      endCalledRef.current ||
      flippedCards.includes(index) ||
      matchedSet.has(index) ||
      pendingCards.has(index)
    ) {
      return;
    }

    setPendingCards((prev) => new Set([...prev, index]));

    const response = await onFlipCard(sessionId, index);
    setPendingCards((prev) => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });

    if (!response) {
      return;
    }

    const nextLayout = [...cardLayout];
    nextLayout[response.cardIndex] = response.iconId;

    if (response.firstCardIndex !== undefined && response.firstCardIconId !== undefined) {
      nextLayout[response.firstCardIndex] = response.firstCardIconId;
    }

    onSyncCardLayout(sessionId, nextLayout);

    if (!response.move) {
      setFlippedCards([response.cardIndex]);
      setServerMoveCount(response.moveCount);
      if (response.completed && !endCalledRef.current) {
        Promise.resolve().then(() => handleGameEnd(true));
      }
      return;
    }

    const firstIndex = response.firstCardIndex;
    if (firstIndex === undefined) {
      return;
    }

    setFlippedCards([firstIndex, response.cardIndex]);
    setIsChecking(true);
    setServerMoveCount(response.moveCount);
    setMoves((prev) => [...prev, response.move!]);

    if (response.matched) {
      setMatchedSet((prev) => new Set([...prev, firstIndex, response.cardIndex]));
    }

    flipTimeoutRef.current = setTimeout(() => {
      if (!response.matched) {
        const revertedLayout = [...nextLayout];
        revertedLayout[firstIndex] = '__hidden__';
        revertedLayout[response.cardIndex] = '__hidden__';
        onSyncCardLayout(sessionId, revertedLayout);
      }
      setFlippedCards([]);
      setIsChecking(false);

      if (response.completed && !endCalledRef.current) {
        Promise.resolve().then(() => handleGameEnd(true));
      }
    }, response.matched ? 300 : 800);
  }, [
    isChecking,
    paused,
    endCalledRef,
    flippedCards,
    matchedSet,
    pendingCards,
    onFlipCard,
    sessionId,
    onSyncCardLayout,
    cardLayout,
    handleGameEnd,
  ]);

  return (
    <div className="memory-board-shell">
      {isRestored && (
        <div className="memory-restore-banner">
          已恢复未完成的游戏，计时按真实开局时间继续
        </div>
      )}

      <div
        className="memory-card-grid"
        style={{
          gridTemplateColumns: `repeat(${config.cols}, minmax(0, 1fr))`,
        }}
      >
        {cardLayout.map((iconId, index) => (
          <Card
            key={index}
            index={index}
            iconId={iconId}
            isFlipped={flippedCards.includes(index)}
            isMatched={matchedSet.has(index)}
            isLoading={pendingCards.has(index)}
            onClick={handleCardClick}
            disabled={paused || isChecking || hasEnded || pendingCards.size > 0}
          />
        ))}
      </div>
    </div>
  );
}
