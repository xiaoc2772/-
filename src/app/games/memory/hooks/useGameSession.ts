// src/app/games/memory/hooks/useGameSession.ts

'use client';

import { useState, useCallback, useRef } from 'react';
import type {
  MemoryDifficulty,
  MemoryDifficultyConfig,
  MemoryFlipResult,
  MemoryMove,
} from '@/lib/types/game';
import { fetchGameRequest, gameRequestErrorMessage } from '../../_lib/request';

interface GameSession {
  sessionId: string;
  difficulty: MemoryDifficulty;
  cardLayout: string[];
  matchedCards: number[];
  firstFlippedCard: number | null;
  moveCount: number;
  startedAt: number;
  expiresAt: number;
  config: MemoryDifficultyConfig;
}

interface GameStatus {
  balance: number;
  dailyStats: {
    gamesPlayed: number;
    pointsEarned: number;
  } | null;
  inCooldown: boolean;
  cooldownRemaining: number;
  dailyLimit: number;
  pointsLimitReached: boolean;
  activeSession: GameSession | null;
}

interface GameResult {
  record: {
    id: string;
    moves: number;
    completed: boolean;
    score: number;
    pointsEarned: number;
    duration: number;
  };
  pointsEarned: number;
}

interface FlipResponse {
  success: boolean;
  message?: string;
  data?: MemoryFlipResult;
}

export function useGameSession() {
  const [session, setSession] = useState<GameSession | null>(null);
  const [status, setStatus] = useState<GameStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRestored, setIsRestored] = useState(false);
  
  const hasSubmittedRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetchGameRequest('/api/games/memory/status');
      const data = await res.json();
      
      if (data.success) {
        setStatus(data.data);
        
        // 自动恢复未完成的游戏
        if (data.data.activeSession) {
          setSession(data.data.activeSession);
          setIsRestored(true);
        }
      }
    } catch (err) {
      console.error('Fetch status error:', err);
    }
  }, []);

  const startGame = useCallback(async (difficulty: MemoryDifficulty) => {
    setLoading(true);
    setError(null);
    hasSubmittedRef.current = false;
    setIsRestored(false);
    
    try {
      const res = await fetchGameRequest('/api/games/memory/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ difficulty }),
      });
      
      const data = await res.json();
      
      if (!data.success) {
        setError(data.message || '开始游戏失败');
        return false;
      }
      
      setSession(data.data);
      return true;
    } catch {
      setError('网络错误');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const cancelGame = useCallback(async () => {
    if (!session) return false;
    
    setLoading(true);
    try {
      const res = await fetchGameRequest('/api/games/memory/cancel', {
        method: 'POST',
      });
      
      const data = await res.json();
      
      if (data.success) {
        setSession(null);
        setIsRestored(false);
        // [Perf] 后台非阻塞刷新
        fetchStatus();
        return true;
      }
      
      setError(data.message || '取消游戏失败');
      return false;
    } catch {
      setError('网络错误');
      return false;
    } finally {
      setLoading(false);
    }
  }, [session, fetchStatus]);

  const submitResult = useCallback(async (
    moves: MemoryMove[],
    completed: boolean,
    duration: number
  ): Promise<GameResult | null> => {
    if (!session || hasSubmittedRef.current) return null;
    
    hasSubmittedRef.current = true;
    setLoading(true);
    
    try {
      const res = await fetchGameRequest('/api/games/memory/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.sessionId,
          moves: isRestored ? [] : moves,
          completed,
          duration,
        }),
      });
      
      const data = await res.json();
      
      if (!data.success) {
        hasSubmittedRef.current = false;
        setError(data.message || '提交结果失败');
        return null;
      }
      
      setSession(null);
      // [Perf] 后台非阻塞刷新
      fetchStatus();

      return data.data;
    } catch (err) {
      hasSubmittedRef.current = false;
      setError(gameRequestErrorMessage(err, '结算请求超时，请检查网络后重试', '网络错误，请稍后重试'));
      return null;
    } finally {
      setLoading(false);
    }
  }, [session, isRestored, fetchStatus]);

  const resetSubmitFlag = useCallback(() => {
    hasSubmittedRef.current = false;
  }, []);

  const flipCard = useCallback(async (
    sessionId: string,
    cardIndex: number
  ): Promise<MemoryFlipResult | null> => {
    try {
      const res = await fetchGameRequest('/api/games/memory/flip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, cardIndex }),
      });

      const data: FlipResponse = await res.json();
      if (!data.success || !data.data) {
        setError(data.message || '翻牌失败');
        return null;
      }

      const flipResult = data.data;

      setSession((prev) => {
        if (!prev || prev.sessionId !== sessionId) {
          return prev;
        }

        const nextLayout = [...prev.cardLayout];
        nextLayout[flipResult.cardIndex] = flipResult.iconId;

        if (
          flipResult.firstCardIndex !== undefined &&
          flipResult.firstCardIconId !== undefined
        ) {
          nextLayout[flipResult.firstCardIndex] = flipResult.firstCardIconId;
        }

        const matchedSet = new Set(prev.matchedCards);
        if (flipResult.matched && flipResult.firstCardIndex !== undefined) {
          matchedSet.add(flipResult.firstCardIndex);
          matchedSet.add(flipResult.cardIndex);
        }

        return {
          ...prev,
          cardLayout: nextLayout,
          matchedCards: Array.from(matchedSet),
          firstFlippedCard:
            flipResult.matched || flipResult.firstCardIndex !== undefined
              ? null
              : flipResult.cardIndex,
          moveCount: flipResult.moveCount,
        };
      });

      return flipResult;
    } catch (err) {
      setError(gameRequestErrorMessage(err, '翻牌同步超时，正在恢复服务端进度', '网络错误，请稍后重试'));
      await fetchStatus();
      return null;
    }
  }, [fetchStatus, setError]);

  const syncSessionLayout = useCallback((sessionId: string, cardLayout: string[]) => {
    setSession((prev) => {
      if (!prev || prev.sessionId !== sessionId) {
        return prev;
      }
      return {
        ...prev,
        cardLayout,
      };
    });
  }, []);

  return {
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
  };
}
