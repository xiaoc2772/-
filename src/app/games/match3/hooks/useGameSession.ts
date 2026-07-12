'use client';

import { useCallback, useRef, useState } from 'react';
import type { Match3Config, Match3Move } from '@/lib/match3-engine';
import { fetchGameRequest, gameRequestErrorMessage } from '../../_lib/request';

interface Match3Session {
  sessionId: string;
  seed: string;
  config: Match3Config;
  timeLimitMs: number;
  startedAt: number;
  expiresAt: number;
}

interface Match3Record {
  id: string;
  score: number;
  pointsEarned: number;
  moves: number;
  cascades: number;
  tilesCleared: number;
  duration: number;
  createdAt: number;
}

interface Match3Status {
  balance: number;
  dailyStats: { gamesPlayed: number; pointsEarned: number } | null;
  inCooldown: boolean;
  cooldownRemaining: number;
  dailyLimit: number;
  pointsLimitReached: boolean;
  records: Match3Record[];
  activeSession: Match3Session | null;
}

interface SubmitResponse {
  record: Match3Record;
  pointsEarned: number;
}

export function useGameSession() {
  const [session, setSession] = useState<Match3Session | null>(null);
  const [status, setStatus] = useState<Match3Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRestored, setIsRestored] = useState(false);

  const hasSubmittedRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetchGameRequest('/api/games/match3/status');
      const data = await res.json();
      if (data.success) {
        setStatus(data.data);

        if (data.data.activeSession) {
          setSession(data.data.activeSession);
          setIsRestored(true);
        }
      }
    } catch (err) {
      console.error('Fetch match3 status error:', err);
    }
  }, []);

  const startGame = useCallback(async () => {
    setLoading(true);
    setError(null);
    hasSubmittedRef.current = false;
    setIsRestored(false);

    try {
      const res = await fetchGameRequest('/api/games/match3/start', { method: 'POST' });
      const data = await res.json();
      if (!data.success) {
        setError(data.message || '开始游戏失败');
        return false;
      }

      setSession({
        sessionId: data.data.sessionId,
        seed: data.data.seed,
        config: data.data.config,
        timeLimitMs: data.data.timeLimitMs,
        startedAt: data.data.startedAt,
        expiresAt: data.data.expiresAt,
      });

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
      const res = await fetchGameRequest('/api/games/match3/cancel', { method: 'POST' });
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

  const submitResult = useCallback(
    async (moves: Match3Move[]): Promise<SubmitResponse | null> => {
      if (!session || hasSubmittedRef.current) return null;
      hasSubmittedRef.current = true;
      setLoading(true);

      try {
        const res = await fetchGameRequest('/api/games/match3/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: session.sessionId, moves }),
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
    },
    [session, fetchStatus]
  );

  const resetSubmitFlag = useCallback(() => {
    hasSubmittedRef.current = false;
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
    resetSubmitFlag,
    setError,
    setSession,
    setIsRestored,
  };
}
