'use client';

import { useCallback, useEffect, useRef } from 'react';

export function usePausedGameClock(paused: boolean, resetKey: string | number | null | undefined) {
  const pausedStartedAtRef = useRef<number | null>(null);
  const pausedDurationRef = useRef(0);
  const pausedRef = useRef(paused);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    pausedDurationRef.current = 0;
    pausedStartedAtRef.current = pausedRef.current ? Date.now() : null;
  }, [resetKey]);

  useEffect(() => {
    if (paused) {
      if (pausedStartedAtRef.current === null) {
        pausedStartedAtRef.current = Date.now();
      }
      return;
    }

    if (pausedStartedAtRef.current !== null) {
      pausedDurationRef.current += Date.now() - pausedStartedAtRef.current;
      pausedStartedAtRef.current = null;
    }
  }, [paused]);

  return useCallback(() => {
    const now = Date.now();
    const activePausedDuration = pausedStartedAtRef.current === null
      ? 0
      : now - pausedStartedAtRef.current;
    return now - pausedDurationRef.current - activePausedDuration;
  }, []);
}
