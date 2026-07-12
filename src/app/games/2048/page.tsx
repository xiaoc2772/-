'use client';

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BookOpen,
  Coins,
  Hash,
  Loader2,
  Move,
  RotateCcw,
  Sparkles,
  Trophy,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { CancelConfirmModal } from '../_components/CancelConfirmModal';
import {
  GAME2048_BOARD_SIZE,
  GAME2048_MAX_MOVES,
  GAME2048_REWARD_DIVISOR,
  GAME2048_WIN_SCORE,
  GAME2048_WIN_TILE,
  calculateGame2048PointReward,
  createInitialGame2048Grid,
  getGame2048HighestTile,
  isGame2048Over,
  moveGame2048Grid,
  spawnGame2048Tile,
  type Game2048Direction,
  type Game2048Grid,
} from '@/lib/game-2048-engine';

type Phase = 'ready' | 'playing' | 'submitting' | 'finished';

interface Game2048SessionView {
  sessionId: string;
  seed: string;
  startedAt: number;
  expiresAt: number;
  initialGrid: Game2048Grid;
  baseScore?: number;
  baseMoves?: number;
  baseMovesSubmitted?: number;
}

interface Game2048Record {
  id: string;
  sessionId: string;
  score: number;
  pointsEarned: number;
  highestTile: number;
  moves: number;
  movesSubmitted: number;
  won: boolean;
  gameOver: boolean;
  grid: Game2048Grid;
  duration: number;
  createdAt: number;
}

interface Game2048Status {
  balance: number;
  dailyStats: { gamesPlayed: number; pointsEarned: number };
  inCooldown: boolean;
  cooldownRemaining: number;
  dailyLimit: number;
  pointsLimitReached: boolean;
  records: Game2048Record[];
  activeSession: Game2048SessionView | null;
}

interface SubmitResponse {
  record: Game2048Record;
  pointsEarned: number;
}

type CheckpointResponse = Game2048SessionView;

const SUBMIT_TIMEOUT_MS = 15_000;
const TILE_SLIDE_MS = 135;
const TILE_SETTLE_MS = TILE_SLIDE_MS + 24;
const TILE_POP_MS = 185;
const TILE_POP_CLEANUP_MS = TILE_POP_MS + 32;
const CHECKPOINT_REALTIME_SYNC_INTERVAL = 8;
const CHECKPOINT_SYNC_THRESHOLD = GAME2048_MAX_MOVES - 200;
const GAME2048_SETTLEMENT_COOLDOWN_SECONDS = 5;
const TILE_IMAGE_BASE = '/images-optimized/ui/games/2048/tiles';
const GAME2048_TILE_IMAGE_MAX = 65536;
const GAME2048_TILE_IMAGE_VALUES = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536] as const;
const TILE_OFFSET_PERCENT = ['33.606%', '134.423%', '235.241%', '336.058%', '436.876%'] as const;
const EMPTY_GRID: Game2048Grid = Array.from({ length: GAME2048_BOARD_SIZE }, () =>
  Array.from({ length: GAME2048_BOARD_SIZE }, () => 0),
);

function getGridCellIndex(row: number, col: number): number {
  return row * GAME2048_BOARD_SIZE + col;
}

type VisualTileState = 'new' | 'merged' | 'sliding';

interface VisualTile {
  id: string;
  value: number;
  row: number;
  col: number;
  fromRow?: number;
  fromCol?: number;
  state?: VisualTileState;
}

interface VisualTileFrames {
  movingTiles: VisualTile[];
  settledTiles: VisualTile[];
}

function getRowColFromIndex(index: number): { row: number; col: number } {
  return {
    row: Math.floor(index / GAME2048_BOARD_SIZE),
    col: index % GAME2048_BOARD_SIZE,
  };
}

function findSpawnedTiles(beforeSpawn: Game2048Grid, afterSpawn: Game2048Grid): Array<{ row: number; col: number; value: number }> {
  const spawned: Array<{ row: number; col: number; value: number }> = [];
  for (let row = 0; row < GAME2048_BOARD_SIZE; row += 1) {
    for (let col = 0; col < GAME2048_BOARD_SIZE; col += 1) {
      if (beforeSpawn[row]?.[col] === 0 && (afterSpawn[row]?.[col] ?? 0) > 0) {
        spawned.push({ row, col, value: afterSpawn[row][col] });
      }
    }
  }
  return spawned;
}

function createVisualTilesFromGrid(
  sourceGrid: Game2048Grid,
  createTileId: () => string,
): VisualTile[] {
  const tiles: VisualTile[] = [];
  for (let row = 0; row < GAME2048_BOARD_SIZE; row += 1) {
    for (let col = 0; col < GAME2048_BOARD_SIZE; col += 1) {
      const value = sourceGrid[row]?.[col] ?? 0;
      if (value > 0) {
        tiles.push({ id: createTileId(), value, row, col });
      }
    }
  }
  return tiles;
}

function getLineCellIndexes(index: number, direction: Game2048Direction): number[] {
  if (direction === 'left') {
    return Array.from({ length: GAME2048_BOARD_SIZE }, (_, col) => getGridCellIndex(index, col));
  }
  if (direction === 'right') {
    return Array.from({ length: GAME2048_BOARD_SIZE }, (_, col) => getGridCellIndex(index, GAME2048_BOARD_SIZE - 1 - col));
  }
  if (direction === 'up') {
    return Array.from({ length: GAME2048_BOARD_SIZE }, (_, row) => getGridCellIndex(row, index));
  }
  return Array.from({ length: GAME2048_BOARD_SIZE }, (_, row) => getGridCellIndex(GAME2048_BOARD_SIZE - 1 - row, index));
}

function buildAnimatedVisualTileFrames(
  previousTiles: VisualTile[],
  previousGrid: Game2048Grid,
  movedGrid: Game2048Grid,
  finalGrid: Game2048Grid,
  direction: Game2048Direction,
  createTileId: () => string,
): VisualTileFrames {
  const tileByCell = new Map<number, VisualTile>();
  for (const tile of previousTiles) {
    tileByCell.set(getGridCellIndex(tile.row, tile.col), tile);
  }

  const movingTiles: VisualTile[] = [];
  const settledTiles: VisualTile[] = [];

  for (let lineIndex = 0; lineIndex < GAME2048_BOARD_SIZE; lineIndex += 1) {
    const indexes = getLineCellIndexes(lineIndex, direction);
    const source = indexes
      .map((cellIndex) => {
        const { row, col } = getRowColFromIndex(cellIndex);
        const value = previousGrid[row]?.[col] ?? 0;
        if (value <= 0) return null;
        return {
          tile: tileByCell.get(cellIndex) ?? { id: createTileId(), value, row, col },
          value,
        };
      })
      .filter((item): item is { tile: VisualTile; value: number } => item !== null);

    let targetOffset = 0;
    for (let sourceIndex = 0; sourceIndex < source.length; sourceIndex += 1) {
      const targetCellIndex = indexes[targetOffset];
      const { row, col } = getRowColFromIndex(targetCellIndex);
      const current = source[sourceIndex];
      const next = source[sourceIndex + 1];

      if (next && current.value === next.value) {
        movingTiles.push({
          id: current.tile.id,
          value: current.value,
          row,
          col,
          fromRow: current.tile.row,
          fromCol: current.tile.col,
          state: current.tile.row === row && current.tile.col === col ? undefined : 'sliding',
        });
        movingTiles.push({
          id: next.tile.id,
          value: next.value,
          row,
          col,
          fromRow: next.tile.row,
          fromCol: next.tile.col,
          state: next.tile.row === row && next.tile.col === col ? undefined : 'sliding',
        });
        settledTiles.push({
          id: current.tile.id,
          value: current.value * 2,
          row,
          col,
          state: 'merged',
        });
        sourceIndex += 1;
      } else {
        const tile: VisualTile = {
          id: current.tile.id,
          value: current.value,
          row,
          col,
          fromRow: current.tile.row,
          fromCol: current.tile.col,
          state: current.tile.row === row && current.tile.col === col ? undefined : 'sliding',
        };
        movingTiles.push(tile);
        settledTiles.push(tile);
      }

      targetOffset += 1;
    }
  }

  for (const spawned of findSpawnedTiles(movedGrid, finalGrid)) {
    settledTiles.push({
      id: createTileId(),
      value: spawned.value,
      row: spawned.row,
      col: spawned.col,
      state: 'new',
    });
  }

  return { movingTiles, settledTiles };
}

function movesStorageKey(sessionId: string): string {
  return `game2048:moves:${sessionId}`;
}

function loadStoredMoves(sessionId: string, baseMoves = 0): Game2048Direction[] {
  try {
    const raw = window.localStorage.getItem(movesStorageKey(sessionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      if (baseMoves > 0) return [];
      return parsed.filter((item): item is Game2048Direction =>
        item === 'up' || item === 'down' || item === 'left' || item === 'right',
      );
    }
    if (!parsed || typeof parsed !== 'object') return [];
    const stored = parsed as { baseMoves?: unknown; moves?: unknown };
    if (stored.baseMoves !== baseMoves || !Array.isArray(stored.moves)) return [];
    return stored.moves.filter((item): item is Game2048Direction =>
      item === 'up' || item === 'down' || item === 'left' || item === 'right',
    );
  } catch {
    return [];
  }
}

function saveStoredMoves(sessionId: string, moves: Game2048Direction[], baseMoves = 0) {
  try {
    window.localStorage.setItem(movesStorageKey(sessionId), JSON.stringify({ baseMoves, moves }));
  } catch {
    // 本地存储不可用时，当前内存中的 moves 仍可用于本次兜底结算。
  }
}

function clearStoredMoves(sessionId: string) {
  try {
    window.localStorage.removeItem(movesStorageKey(sessionId));
  } catch {
    // ignore
  }
}

async function parseJson<T>(res: Response): Promise<{ success?: boolean; data?: T; message?: string } | null> {
  try {
    return (await res.json()) as { success?: boolean; data?: T; message?: string };
  } catch {
    return null;
  }
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function formatDuration(ms: number): string {
  const safe = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getDirectionFromKey(key: string): Game2048Direction | null {
  if (key === 'ArrowUp' || key.toLowerCase() === 'w') return 'up';
  if (key === 'ArrowDown' || key.toLowerCase() === 's') return 'down';
  if (key === 'ArrowLeft' || key.toLowerCase() === 'a') return 'left';
  if (key === 'ArrowRight' || key.toLowerCase() === 'd') return 'right';
  return null;
}

function getTileClass(value: number): string {
  if (value <= 0) return 'empty';
  if (value <= 131072) return `v-${value}`;
  return 'v-super';
}

function getDigitsClass(value: number): string {
  const digits = formatTileValue(value).length;
  if (digits >= 6) return 'digits-6';
  if (digits >= 5) return 'digits-5';
  if (digits >= 4) return 'digits-4';
  return 'digits-short';
}

function trimShortNumber(value: number): string {
  return value.toFixed(value >= 10 ? 1 : 2).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

function formatTileValue(value: number): string {
  if (value >= 100_000_000) return `${trimShortNumber(value / 100_000_000)}亿`;
  if (value >= 10_000) return `${trimShortNumber(value / 10_000)}万`;
  return String(value);
}

function replayGame2048Segment(
  view: Game2048SessionView,
  moves: Game2048Direction[],
): { ok: true; grid: Game2048Grid; score: number; movesApplied: number; highestTile: number; gameOver: boolean } | { ok: false; message: string } {
  let grid = view.initialGrid;
  let score = view.baseScore ?? 0;
  let movesApplied = view.baseMoves ?? 0;

  for (const direction of moves) {
    const moved = moveGame2048Grid(grid, direction);
    if (!moved.moved) {
      continue;
    }

    score += moved.scoreDelta;
    grid = spawnGame2048Tile(moved.grid, view.seed, movesApplied + 2);
    movesApplied += 1;
  }

  const highestTile = getGame2048HighestTile(grid);
  return {
    ok: true,
    grid,
    score,
    movesApplied,
    highestTile,
    gameOver: isGame2048Over(grid),
  };
}

export default function Game2048Page() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('ready');
  const [session, setSession] = useState<Game2048SessionView | null>(null);
  const [status, setStatus] = useState<Game2048Status | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [grid, setGrid] = useState<Game2048Grid>(EMPTY_GRID);
  const [score, setScore] = useState(0);
  const [highestTile, setHighestTile] = useState(0);
  const [movesCount, setMovesCount] = useState(0);
  const [result, setResult] = useState<Game2048Record | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkpointing, setCheckpointing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('准备开始 2048');
  const [isRestored, setIsRestored] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [visualTiles, setVisualTiles] = useState<VisualTile[]>([]);

  const sessionRef = useRef<Game2048SessionView | null>(null);
  const phaseRef = useRef<Phase>('ready');
  const gridRef = useRef<Game2048Grid>(EMPTY_GRID);
  const scoreRef = useRef(0);
  const highestTileRef = useRef(0);
  const visualTilesRef = useRef<VisualTile[]>([]);
  const movesRef = useRef<Game2048Direction[]>([]);
  const submittingRef = useRef(false);
  const checkpointingRef = useRef(false);
  const pointerStartRef = useRef<{ x: number; y: number; pointerId: number | null } | null>(null);
  const lastPointerEventAtRef = useRef(0);
  const visualTileIdRef = useRef(0);
  const visualSettleTimerRef = useRef<number | null>(null);
  const visualCleanupTimerRef = useRef<number | null>(null);
  const visualUnlockTimerRef = useRef<number | null>(null);
  const visualSettleFrameRef = useRef<number | null>(null);
  const visualCleanupFrameRef = useRef<number | null>(null);
  const checkpointTimerRef = useRef<number | null>(null);
  const moveAnimationLockedRef = useRef(false);
  const pendingMoveRef = useRef<Game2048Direction | null>(null);
  const handleMoveRef = useRef<(direction: Game2048Direction) => void>(() => {});
  const loginRequiredRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (loginRequiredRef.current) return;
    loginRequiredRef.current = true;
    setError(null);
    router.replace('/login?redirect=/games/2048');
  }, [router]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    gridRef.current = grid;
  }, [grid]);

  const createVisualTileId = useCallback(() => {
    visualTileIdRef.current += 1;
    return `g2048-vtile-${visualTileIdRef.current}`;
  }, []);

  const setVisualTilesSynced = useCallback((tiles: VisualTile[]) => {
    visualTilesRef.current = tiles;
    setVisualTiles(tiles);
  }, []);

  const clearVisualTimers = useCallback(() => {
    if (visualSettleTimerRef.current !== null) {
      window.clearTimeout(visualSettleTimerRef.current);
      visualSettleTimerRef.current = null;
    }
    if (visualCleanupTimerRef.current !== null) {
      window.clearTimeout(visualCleanupTimerRef.current);
      visualCleanupTimerRef.current = null;
    }
    if (visualUnlockTimerRef.current !== null) {
      window.clearTimeout(visualUnlockTimerRef.current);
      visualUnlockTimerRef.current = null;
    }
    if (visualSettleFrameRef.current !== null) {
      window.cancelAnimationFrame(visualSettleFrameRef.current);
      visualSettleFrameRef.current = null;
    }
    if (visualCleanupFrameRef.current !== null) {
      window.cancelAnimationFrame(visualCleanupFrameRef.current);
      visualCleanupFrameRef.current = null;
    }
    moveAnimationLockedRef.current = false;
    pendingMoveRef.current = null;
  }, []);

  const syncVisualTilesFromGrid = useCallback((nextGrid: Game2048Grid) => {
    clearVisualTimers();
    setVisualTilesSynced(createVisualTilesFromGrid(nextGrid, createVisualTileId));
  }, [clearVisualTimers, createVisualTileId, setVisualTilesSynced]);

  const clearVisualTileStates = useCallback(() => {
    setVisualTiles((current) => {
      const cleaned = current.map((tile) => (tile.state ? { ...tile, state: undefined } : tile));
      visualTilesRef.current = cleaned;
      return cleaned;
    });
  }, []);

  const unlockVisualMove = useCallback(() => {
    moveAnimationLockedRef.current = false;
    visualUnlockTimerRef.current = null;
    const queued = pendingMoveRef.current;
    if (queued) {
      pendingMoveRef.current = null;
      handleMoveRef.current(queued);
    }
  }, []);

  const scheduleVisualTileSettling = useCallback((settledTiles: VisualTile[]) => {
    clearVisualTimers();
    moveAnimationLockedRef.current = true;

    visualSettleFrameRef.current = window.requestAnimationFrame(() => {
      visualSettleFrameRef.current = null;
      visualSettleTimerRef.current = window.setTimeout(() => {
        visualSettleTimerRef.current = null;
        visualCleanupFrameRef.current = window.requestAnimationFrame(() => {
          visualCleanupFrameRef.current = null;
          setVisualTilesSynced(settledTiles);

          visualCleanupTimerRef.current = window.setTimeout(() => {
            clearVisualTileStates();
            visualCleanupTimerRef.current = null;
          }, TILE_POP_CLEANUP_MS);

          visualUnlockTimerRef.current = window.setTimeout(unlockVisualMove, 24);
        });
      }, TILE_SETTLE_MS);
    });
  }, [clearVisualTimers, clearVisualTileStates, setVisualTilesSynced, unlockVisualMove]);

  useEffect(() => () => {
    clearVisualTimers();
    if (checkpointTimerRef.current !== null) {
      window.clearTimeout(checkpointTimerRef.current);
      checkpointTimerRef.current = null;
    }
  }, [clearVisualTimers]);

  const rewardPreview = useMemo(
    () => calculateGame2048PointReward(score, highestTile),
    [highestTile, score],
  );

  const applySimulation = useCallback((nextGrid: Game2048Grid, nextScore: number, nextMoves: number) => {
    setGrid(nextGrid);
    gridRef.current = nextGrid;
    scoreRef.current = nextScore;
    setScore(nextScore);
    const nextHighestTile = getGame2048HighestTile(nextGrid);
    highestTileRef.current = nextHighestTile;
    setHighestTile(nextHighestTile);
    setMovesCount(nextMoves);
  }, []);

  const applySession = useCallback((view: Game2048SessionView, restoredMoves?: Game2048Direction[]) => {
    const moves = restoredMoves ?? loadStoredMoves(view.sessionId, view.baseMoves ?? 0);
    const simulation = replayGame2048Segment(view, moves);
    let nextGrid = view.initialGrid;

    if (!simulation.ok) {
      clearStoredMoves(view.sessionId);
      movesRef.current = [];
      applySimulation(view.initialGrid, view.baseScore ?? 0, view.baseMoves ?? 0);
      setMessage('本地进度异常，已重置当前局');
    } else {
      movesRef.current = moves;
      nextGrid = simulation.grid;
      applySimulation(simulation.grid, simulation.score, simulation.movesApplied);
      setMessage(moves.length > 0 ? '已恢复当前局进度' : '合成相同数字方块');
    }
    syncVisualTilesFromGrid(nextGrid);

    setSession(view);
    sessionRef.current = view;
    submittingRef.current = false;
    setPhase('playing');
    setResult(null);
  }, [applySimulation, syncVisualTilesFromGrid]);

  const fetchStatus = useCallback(async () => {
    if (loginRequiredRef.current) return;
    try {
      const res = await fetch('/api/games/2048/status', { cache: 'no-store' });
      if (res.status === 401) {
        redirectToLogin();
        return;
      }
      const data = await parseJson<Game2048Status>(res);
      if (!res.ok || !data?.success || !data.data) {
        throw new Error(data?.message ?? (res.status === 401 ? '请先登录后开始游戏' : '加载游戏状态失败'));
      }

      setStatus(data.data);
      setCooldownRemaining(Math.max(0, data.data.cooldownRemaining));
      setError(null);

      if (data.data.activeSession && !sessionRef.current && phaseRef.current === 'ready') {
        setIsRestored(true);
        applySession(data.data.activeSession);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误，请稍后重试');
    }
  }, [applySession, redirectToLogin]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    GAME2048_TILE_IMAGE_VALUES.forEach((value) => {
      const img = new window.Image();
      img.src = `${TILE_IMAGE_BASE}/${value}.webp`;
    });
  }, []);

  useEffect(() => {
    if (cooldownRemaining <= 0) return;
    const timer = window.setInterval(() => {
      setCooldownRemaining((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownRemaining]);

  const startGame = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setIsRestored(false);
    submittingRef.current = false;

    try {
      const res = await fetch('/api/games/2048/start', { method: 'POST' });
      if (res.status === 401) {
        redirectToLogin();
        return;
      }
      const data = await parseJson<Game2048SessionView>(res);
      if (!res.ok || !data?.success || !data.data) {
        if (data?.message?.includes('正在进行')) {
          await fetchStatus();
        }
        throw new Error(data?.message ?? '开始游戏失败');
      }

      clearStoredMoves(data.data.sessionId);
      movesRef.current = [];
      applySession(data.data, []);
      setMessage('新局已开始');
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setLoading(false);
    }
  }, [applySession, fetchStatus, redirectToLogin]);

  const cancelGame = useCallback(async () => {
    if (!sessionRef.current) return;
    const currentSession = sessionRef.current;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/games/2048/cancel', { method: 'POST' });
      const data = await parseJson<unknown>(res);
      if (!res.ok || !data?.success) {
        throw new Error(data?.message ?? '取消游戏失败');
      }

      clearStoredMoves(currentSession.sessionId);
      movesRef.current = [];
      setSession(null);
      sessionRef.current = null;
      setPhase('ready');
      applySimulation(createInitialGame2048Grid('preview'), 0, 0);
      setVisualTilesSynced([]);
      setMessage('当前局已放弃');
      void fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setLoading(false);
    }
  }, [applySimulation, fetchStatus, setVisualTilesSynced]);

  const confirmCancelGame = useCallback(async () => {
    await cancelGame();
    setShowCancelConfirm(false);
  }, [cancelGame]);

  const handleSettlementSuccess = useCallback((submitData: SubmitResponse) => {
    const record = submitData.record;
    clearStoredMoves(record.sessionId);
    movesRef.current = [];
    setSession(null);
    sessionRef.current = null;
    setResult(record);
    setCooldownRemaining((current) => Math.max(current, GAME2048_SETTLEMENT_COOLDOWN_SECONDS));
    applySimulation(record.grid, record.score, record.moves);
    syncVisualTilesFromGrid(record.grid);
    setHighestTile(record.highestTile);
    setPhase('finished');
    setMessage(`本局获得 ${record.pointsEarned} 积分`);
    void fetchStatus();
  }, [applySimulation, fetchStatus, syncVisualTilesFromGrid]);

  const settleGame = useCallback(async () => {
    const activeSession = sessionRef.current;
    if (!activeSession || submittingRef.current) return;
    if (checkpointingRef.current) {
      setError('正在同步长局进度，请稍后再结算');
      return;
    }

    submittingRef.current = true;
    setLoading(true);
    setError(null);
    setPhase('submitting');

    const payload = {
      sessionId: activeSession.sessionId,
      moves: movesRef.current,
    };

    try {
      const res = await fetchWithTimeout(
        '/api/games/2048/submit',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        SUBMIT_TIMEOUT_MS,
      );
      const data = await parseJson<SubmitResponse>(res);

      if (!res.ok || !data?.success || !data.data) {
        throw new Error(data?.message ?? `结算失败（HTTP ${res.status}）`);
      }

      handleSettlementSuccess(data.data);
    } catch (err) {
      submittingRef.current = false;
      setPhase('playing');
      setError(isAbortError(err) ? '结算请求超时，请重试结算' : err instanceof Error ? err.message : '结算失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [handleSettlementSuccess]);

  const startCheckpointSync = useCallback((delayMs = 0, quiet = false) => {
    const activeSession = sessionRef.current;
    if (!activeSession || checkpointingRef.current || movesRef.current.length === 0) return;

    checkpointingRef.current = true;
    setCheckpointing(true);
    if (!quiet) {
      setMessage('正在同步长局进度');
    }
    setError(null);

    if (checkpointTimerRef.current !== null) {
      window.clearTimeout(checkpointTimerRef.current);
      checkpointTimerRef.current = null;
    }

    checkpointTimerRef.current = window.setTimeout(() => {
      checkpointTimerRef.current = null;
      const sessionSnapshot = sessionRef.current;
      const movesSnapshot = [...movesRef.current];
      if (!sessionSnapshot || movesSnapshot.length === 0) {
        checkpointingRef.current = false;
        setCheckpointing(false);
        return;
      }

      void (async () => {
        try {
          const res = await fetchWithTimeout(
            '/api/games/2048/checkpoint',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sessionId: sessionSnapshot.sessionId,
                moves: movesSnapshot,
              }),
            },
            SUBMIT_TIMEOUT_MS,
          );
          const data = await parseJson<CheckpointResponse>(res);
          if (!res.ok || !data?.success || !data.data) {
            throw new Error(data?.message ?? `同步长局进度失败（HTTP ${res.status}）`);
          }

          clearStoredMoves(sessionSnapshot.sessionId);
          movesRef.current = [];
          setSession(data.data);
          sessionRef.current = data.data;
          applySimulation(data.data.initialGrid, data.data.baseScore ?? 0, data.data.baseMoves ?? 0);
          syncVisualTilesFromGrid(data.data.initialGrid);
          if (!quiet) {
            setMessage('长局进度已同步，可以继续游戏');
          }
        } catch (err) {
          setError(isAbortError(err) ? '同步长局进度超时，请稍后重试' : err instanceof Error ? err.message : '同步长局进度失败');
          if (!quiet) {
            setMessage('长局进度同步失败，请重试');
          }
        } finally {
          checkpointingRef.current = false;
          setCheckpointing(false);
        }
      })();
    }, delayMs);
  }, [applySimulation, syncVisualTilesFromGrid]);

  const handleMove = useCallback((direction: Game2048Direction) => {
    const activeSession = sessionRef.current;
    if (showCancelConfirm) return;
    if (!activeSession || phaseRef.current !== 'playing' || loading || checkpointingRef.current) return;
    if (movesRef.current.length >= CHECKPOINT_SYNC_THRESHOLD) {
      startCheckpointSync();
      return;
    }
    if (moveAnimationLockedRef.current) {
      // 动画进行中：记下最新一次方向，解锁后自动补播，避免操作被吞。
      pendingMoveRef.current = direction;
      return;
    }
    if (isGame2048Over(gridRef.current)) {
      setMessage('棋盘已无可移动方块，请结算成绩');
      return;
    }

    const previousGrid = gridRef.current;
    const movement = moveGame2048Grid(previousGrid, direction);
    if (!movement.moved) {
      setMessage('这个方向没有可合成的方块');
      return;
    }

    const nextMoves = [...movesRef.current, direction];
    const baseMoves = activeSession.baseMoves ?? 0;
    const nextGrid = spawnGame2048Tile(movement.grid, activeSession.seed, baseMoves + nextMoves.length + 1);
    const previousScore = scoreRef.current;
    const nextScore = previousScore + movement.scoreDelta;
    const nextHighest = getGame2048HighestTile(nextGrid);
    const nextGameOver = isGame2048Over(nextGrid);
    const previousHighest = highestTileRef.current;
    movesRef.current = nextMoves;
    saveStoredMoves(activeSession.sessionId, nextMoves, activeSession.baseMoves ?? 0);
    const nextVisualFrames = buildAnimatedVisualTileFrames(
      visualTilesRef.current.length
        ? visualTilesRef.current
        : createVisualTilesFromGrid(previousGrid, createVisualTileId),
      previousGrid,
      movement.grid,
      nextGrid,
      direction,
      createVisualTileId,
    );
    setVisualTilesSynced(nextVisualFrames.movingTiles);
    scheduleVisualTileSettling(nextVisualFrames.settledTiles);
    applySimulation(nextGrid, nextScore, nextMoves.length);
    setError(null);

    if (nextMoves.length >= CHECKPOINT_SYNC_THRESHOLD) {
      setMessage('正在同步长局进度');
      startCheckpointSync(TILE_SETTLE_MS + TILE_POP_CLEANUP_MS);
    } else if (nextGameOver) {
      setMessage('棋盘已满，本局可以结算');
    } else if (previousScore < GAME2048_WIN_SCORE && nextScore >= GAME2048_WIN_SCORE) {
      setMessage(`已达到 ${GAME2048_WIN_SCORE.toLocaleString()} 分胜利线，可以继续冲更高分`);
    } else if (previousHighest < GAME2048_WIN_TILE && nextHighest >= GAME2048_WIN_TILE) {
      setMessage('已合成 2048 里程碑，可以继续冲更高分');
    } else {
      setMessage(`本步合成 +${movement.scoreDelta}`);
    }

    if (nextMoves.length > 0 && nextMoves.length % CHECKPOINT_REALTIME_SYNC_INTERVAL === 0) {
      startCheckpointSync(TILE_SETTLE_MS + TILE_POP_CLEANUP_MS, true);
    }
  }, [applySimulation, createVisualTileId, loading, scheduleVisualTileSettling, setVisualTilesSynced, showCancelConfirm, startCheckpointSync]);

  useEffect(() => {
    handleMoveRef.current = handleMove;
  }, [handleMove]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = getDirectionFromKey(event.key);
      if (!direction || phaseRef.current !== 'playing' || showCancelConfirm) return;
      event.preventDefault();
      handleMove(direction);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleMove, showCancelConfirm]);

  const finishBoardSwipe = useCallback((clientX: number, clientY: number) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start) return;

    const dx = clientX - start.x;
    const dy = clientY - start.y;
    const distance = Math.max(Math.abs(dx), Math.abs(dy));
    if (distance < 28) return;

    if (Math.abs(dx) > Math.abs(dy)) {
      handleMove(dx > 0 ? 'right' : 'left');
      return;
    }
    handleMove(dy > 0 ? 'down' : 'up');
  }, [handleMove]);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (showCancelConfirm || phaseRef.current !== 'playing' || loading) return;
    lastPointerEventAtRef.current = Date.now();
    event.preventDefault();
    pointerStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 部分浏览器释放过快时可能无法捕获，后续 pointerup 仍可按坐标处理。
    }
  }, [loading, showCancelConfirm]);

  const handlePointerEnd = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;

    lastPointerEventAtRef.current = Date.now();
    event.preventDefault();
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    finishBoardSwipe(event.clientX, event.clientY);
  }, [finishBoardSwipe]);

  const handlePointerCancel = useCallback(() => {
    pointerStartRef.current = null;
  }, []);

  const handleMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (Date.now() - lastPointerEventAtRef.current < 500) return;
    if (showCancelConfirm || phaseRef.current !== 'playing' || loading) return;
    event.preventDefault();
    pointerStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      pointerId: null,
    };
  }, [loading, showCancelConfirm]);

  const handleMouseUp = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (Date.now() - lastPointerEventAtRef.current < 500) return;
    event.preventDefault();
    finishBoardSwipe(event.clientX, event.clientY);
  }, [finishBoardSwipe]);

  const canPlay = phase === 'playing' && !!session && !showCancelConfirm && !loading && !checkpointing;
  const canSettle = (phase === 'playing' || phase === 'submitting') && !!session && !showCancelConfirm && !checkpointing;
  const gameOver = isGame2048Over(grid);
  const inCooldown = cooldownRemaining > 0;

  return (
    <div className="g2048-screen">
      <div className="g2048-mesh-bg" aria-hidden />
      <div className="g2048-stars" aria-hidden>
        <span style={{ top: '10%', left: '6%', fontSize: 13 }}>✦</span>
        <span style={{ top: '21%', left: '91%', fontSize: 11, animationDelay: '1.2s' }}>✦</span>
        <span style={{ top: '48%', left: '4%', fontSize: 16, animationDelay: '2.2s' }}>✧</span>
        <span style={{ top: '72%', left: '94%', fontSize: 12, animationDelay: '0.6s' }}>✧</span>
      </div>

      <header className="g2048-topbar">
        <Link href="/games" className="g2048-exit-btn">
          <span className="arrow">
            <ArrowLeft size={14} strokeWidth={2.4} />
          </span>
          EXIT
        </Link>
      </header>

      <main className="g2048-container">
        {error && (
          <div className="g2048-error-banner" role="alert">
            {error}
          </div>
        )}

      <div className="g2048-page">
        <section className="g2048-command-bar" aria-live="polite">
          <div className="min-w-0">
            <div className="g2048-command-kicker">
              <Hash className="h-4 w-4" />
              <span>{phase === 'ready' ? '出发准备' : phase === 'finished' ? '结算完成' : '局内状态'}</span>
              <span className="g2048-separator">/</span>
              <span>{message}</span>
            </div>
            <p>{phase === 'ready' ? '准备开始数字合成' : checkpointing ? '正在同步长局进度' : gameOver ? '棋盘已无可移动方块' : '合成更大的数字方块'}</p>
          </div>
          <div className="g2048-command-actions">
            <button type="button" className="g2048-action-btn" onClick={() => setShowRules(true)}>
              <BookOpen className="h-4 w-4" />
              规则
            </button>
            {session && (
              <button
                type="button"
                className="g2048-action-btn danger"
                onClick={() => setShowCancelConfirm(true)}
                disabled={loading || checkpointing}
              >
                <X className="h-4 w-4" />
                放弃
              </button>
            )}
          </div>
        </section>

        {phase === 'ready' && (
          <section className="glass-card g2048-ready-card">
            <div className="g2048-ready-icon">
              <Hash className="h-10 w-10" />
            </div>
            <h2>开始 2048</h2>
            <p>
              每次有效移动都会生成新方块。达到 2048 有额外里程碑积分，也可以继续冲更高分。
            </p>
            {inCooldown && (
              <div className="g2048-cooldown-note">
                冷却中，请等待 {cooldownRemaining} 秒
              </div>
            )}
            <button
              type="button"
              className="g2048-primary-btn"
              onClick={() => void startGame()}
              disabled={loading || inCooldown}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {loading ? '处理中' : inCooldown ? '冷却中' : '开始游戏'}
            </button>
          </section>
        )}

        {(phase === 'playing' || phase === 'submitting' || phase === 'finished') && (
          <div className="g2048-layout">
            <section className="glass-card g2048-board-panel">
              {isRestored && phase === 'playing' && (
                <div className="g2048-restore-note">已恢复中断的游戏进度</div>
              )}
              <Game2048Board
                tiles={visualTiles}
                disabled={!canPlay}
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerEnd}
                onPointerCancel={handlePointerCancel}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
              />
            </section>

            <aside className="g2048-side">
              <section className="glass-card g2048-stats-card">
                <h2 className="section-title">
                  <span className="st-icon">
                    <Trophy size={18} />
                  </span>
                  本局数据
                </h2>
                <div className="g2048-stat-grid">
                  <Game2048Stat icon={<Hash />} label="得分" value={score.toLocaleString()} />
                  <Game2048Stat icon={<Trophy />} label="最高方块" value={highestTile ? String(highestTile) : '—'} />
                  <Game2048Stat icon={<Move />} label="有效步数" value={String(movesCount)} />
                  <Game2048Stat icon={<Coins />} label="预估积分" value={`+${rewardPreview}`} />
                </div>
                <button
                  type="button"
                  className="g2048-primary-btn settle"
                  onClick={() => void settleGame()}
                  disabled={!canSettle || loading}
                >
                  {phase === 'submitting' || loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {phase === 'submitting' || loading ? '结算中' : '结算当前成绩'}
                </button>
              </section>

              <section className="glass-card g2048-records-card">
                <h2 className="section-title">
                  <span className="st-icon">
                    <RotateCcw size={18} />
                  </span>
                  最近记录
                </h2>
                <div className="g2048-record-list">
                  {(status?.records ?? []).slice(0, 5).map((record) => (
                    <div key={record.id} className="g2048-record-row">
                      <div>
                        <strong>{record.score.toLocaleString()} 分</strong>
                        <span>最高 {record.highestTile} · {record.moves} 步</span>
                      </div>
                      <em>+{record.pointsEarned}</em>
                    </div>
                  ))}
                  {!(status?.records ?? []).length && (
                    <div className="g2048-empty-record">暂无记录</div>
                  )}
                </div>
              </section>
            </aside>
          </div>
        )}

        {phase === 'finished' && result && (
          <Game2048ResultModal
            result={result}
            loading={loading}
            cooldownRemaining={cooldownRemaining}
            onStart={() => void startGame()}
          />
        )}

        {showRules && <Game2048RulesModal onClose={() => setShowRules(false)} />}
        <CancelConfirmModal
          open={showCancelConfirm}
          loading={loading || checkpointing}
          title="确认放弃 2048？"
          description="当前棋盘进度会被取消，本局不会进入结算。"
          detail="当前得分、最高方块和有效步数都会丢失。"
          onConfirm={() => void confirmCancelGame()}
          onClose={() => setShowCancelConfirm(false)}
        />
      </div>
      </main>

      <style jsx global>{`
        .g2048-screen {
          min-height: 100vh;
          position: relative;
          overflow-x: hidden;
          background: #eefcf8;
          color: #0f172a;
        }
        .g2048-screen .g2048-mesh-bg {
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
        .g2048-screen .g2048-stars {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          overflow: hidden;
        }
        .g2048-screen .g2048-stars span {
          position: absolute;
          color: rgba(255, 255, 255, 0.78);
          animation: g2048-twinkle 3s ease-in-out infinite;
        }
        @keyframes g2048-twinkle {
          0%, 100% { opacity: 0.28; transform: scale(1); }
          50% { opacity: 0.86; transform: scale(1.32); }
        }
        .g2048-screen .g2048-topbar {
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
        .g2048-screen .g2048-exit-btn {
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
          text-decoration: none;
        }
        .g2048-screen .g2048-exit-btn .arrow {
          display: inline-flex;
          height: 30px;
          width: 30px;
          flex-shrink: 0;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          background: linear-gradient(135deg, #34d399, #047857);
          color: white;
          box-shadow: 0 8px 14px rgba(4, 120, 87, 0.28);
        }
        .g2048-screen .g2048-container {
          position: relative;
          z-index: 1;
          width: min(1360px, calc(100vw - 96px));
          margin: 0 auto;
          padding: 12px 0 88px;
        }
        .g2048-error-banner {
          margin-bottom: 22px;
          border-radius: 20px;
          border: 1px solid #fecdd3;
          background: rgba(255, 241, 242, 0.88);
          padding: 14px 18px;
          color: #be123c;
          font-size: 14px;
          font-weight: 800;
        }
        .g2048-page {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .g2048-screen .glass-card {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0.68));
          border: 1px solid rgba(255, 255, 255, 0.95);
          border-radius: 32px;
          box-shadow: 0 24px 48px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255, 255, 255, 1);
          backdrop-filter: blur(30px);
        }
        .g2048-screen .section-title {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          margin: 0;
          color: #0f172a;
          font-size: 22px;
          font-weight: 900;
          letter-spacing: -0.5px;
        }
        .g2048-screen .section-title .st-icon {
          display: flex;
          height: 36px;
          width: 36px;
          align-items: center;
          justify-content: center;
          border-radius: 12px;
          background: linear-gradient(135deg, #10b981, #047857);
          color: #fff;
          box-shadow: 0 10px 20px rgba(16, 185, 129, 0.35);
        }
        .g2048-command-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          border: 1px solid rgba(255, 255, 255, 0.9);
          border-radius: 28px;
          background: rgba(255, 255, 255, 0.84);
          padding: 18px 20px;
          box-shadow: 0 18px 44px rgba(15, 23, 42, 0.08);
          backdrop-filter: blur(18px);
        }
        .g2048-command-kicker {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          color: #047857;
          font-size: 12px;
          font-weight: 950;
        }
        .g2048-command-kicker svg {
          width: 16px;
          height: 16px;
        }
        .g2048-separator {
          color: #cbd5e1;
        }
        .g2048-command-bar p {
          margin: 5px 0 0;
          color: #0f172a;
          font-size: 20px;
          font-weight: 1000;
          line-height: 1.25;
        }
        .g2048-command-actions {
          display: flex;
          flex: none;
          gap: 10px;
        }
        .g2048-action-btn {
          display: inline-flex;
          min-height: 40px;
          align-items: center;
          justify-content: center;
          gap: 7px;
          border-radius: 999px;
          border: 1px solid #a7f3d0;
          background: #fff;
          padding: 9px 15px;
          color: #047857;
          font-size: 13px;
          font-weight: 900;
          transition: background 0.2s ease, transform 0.2s ease;
        }
        .g2048-action-btn:hover:not(:disabled) {
          background: #ecfdf5;
          transform: translateY(-1px);
        }
        .g2048-action-btn.danger {
          border-color: #fecdd3;
          color: #be123c;
        }
        .g2048-action-btn:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }
        .g2048-ready-card {
          min-height: 430px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 28px;
          text-align: center;
        }
        .g2048-ready-icon {
          display: inline-flex;
          height: 86px;
          width: 86px;
          align-items: center;
          justify-content: center;
          border-radius: 28px;
          background: linear-gradient(135deg, #f59e0b, #10b981);
          color: #fff;
          box-shadow: 0 20px 42px rgba(5, 150, 105, 0.28);
        }
        .g2048-ready-card h2 {
          margin: 22px 0 0;
          color: #0f172a;
          font-size: 30px;
          font-weight: 1000;
        }
        .g2048-ready-card p {
          margin: 12px auto 0;
          max-width: 560px;
          color: #64748b;
          font-size: 14px;
          font-weight: 750;
          line-height: 1.7;
        }
        .g2048-cooldown-note {
          margin-top: 18px;
          border-radius: 18px;
          border: 1px solid #fde68a;
          background: #fffbeb;
          padding: 10px 14px;
          color: #b45309;
          font-size: 13px;
          font-weight: 900;
        }
        .g2048-primary-btn {
          display: inline-flex;
          min-height: 46px;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-top: 24px;
          border: 0;
          border-radius: 18px;
          background: #059669;
          padding: 13px 22px;
          color: #fff;
          font-size: 14px;
          font-weight: 1000;
          box-shadow: 0 18px 34px rgba(5, 150, 105, 0.24);
          transition: background 0.2s ease, transform 0.2s ease;
        }
        .g2048-primary-btn:hover:not(:disabled) {
          background: #10b981;
          transform: translateY(-2px);
        }
        .g2048-primary-btn:disabled {
          cursor: not-allowed;
          opacity: 0.58;
        }
        .g2048-primary-btn.settle {
          width: 100%;
        }
        .g2048-layout {
          display: grid;
          grid-template-columns: minmax(0, 640px) minmax(280px, 360px);
          gap: 20px;
          align-items: start;
          justify-content: center;
        }
        .g2048-board-panel,
        .g2048-stats-card,
        .g2048-records-card {
          padding: 20px;
          border-radius: 30px;
        }
        .g2048-board {
          --tile-slide-duration: 135ms;
          --tile-size: 17.56%;
          position: relative;
          width: min(100%, 580px);
          aspect-ratio: 1;
          margin: 0 auto;
          border-radius: 28px;
          border: 0;
          background: url('/images-optimized/ui/games/2048/board.webp?v=2') center / 100% 100% no-repeat;
          cursor: grab;
          overflow: hidden;
          touch-action: none;
          user-select: none;
          contain: layout paint style;
          isolation: isolate;
          transform: translateZ(0);
          box-shadow: 0 20px 44px rgba(2, 44, 34, 0.18);
        }
        .g2048-board.is-disabled {
          cursor: not-allowed;
          opacity: 0.82;
        }
        .g2048-board:not(.is-disabled):active {
          cursor: grabbing;
        }
        .g2048-tile-layer {
          position: absolute;
          inset: 0;
          pointer-events: none;
          contain: layout paint style;
          transform: translateZ(0);
        }
        .g2048-tile {
          position: absolute;
          top: 0;
          left: 0;
          display: flex;
          width: var(--tile-size);
          height: var(--tile-size);
          min-width: 0;
          min-height: 0;
          align-items: center;
          justify-content: center;
          border-radius: 16px;
          background: var(--tile-img, none) center / contain no-repeat;
          color: #0f172a;
          font-size: 20px;
          font-weight: 1000;
          line-height: 1;
          text-align: center;
          contain: strict;
          font-variant-numeric: tabular-nums;
          opacity: 1;
          transform: translate3d(var(--tile-x, 0px), var(--tile-y, 0px), 0);
          transition: opacity 90ms linear;
          will-change: transform, opacity;
          backface-visibility: hidden;
          z-index: 2;
        }
        .g2048-tile.is-img .g2048-tile-value {
          display: none;
        }
        .g2048-tile::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: rgba(255, 255, 255, 0.34);
          opacity: 0;
          pointer-events: none;
          transform: scale(0.9);
          will-change: transform, opacity;
        }
        .g2048-tile.r-0 { --tile-y: 33.606%; }
        .g2048-tile.r-1 { --tile-y: 134.423%; }
        .g2048-tile.r-2 { --tile-y: 235.241%; }
        .g2048-tile.r-3 { --tile-y: 336.058%; }
        .g2048-tile.r-4 { --tile-y: 436.876%; }
        .g2048-tile.c-0 { --tile-x: 33.606%; }
        .g2048-tile.c-1 { --tile-x: 134.423%; }
        .g2048-tile.c-2 { --tile-x: 235.241%; }
        .g2048-tile.c-3 { --tile-x: 336.058%; }
        .g2048-tile.c-4 { --tile-x: 436.876%; }
        .g2048-tile-value {
          display: flex;
          width: 100%;
          height: 100%;
          align-items: center;
          justify-content: center;
          line-height: 1;
          pointer-events: none;
          transform: translateZ(0) scale(1);
          will-change: transform;
        }
        .g2048-tile.digits-4 { font-size: 17px; }
        .g2048-tile.digits-5 { font-size: 15px; }
        .g2048-tile.digits-6 { font-size: 13px; }
        .g2048-tile.v-131072 { background: linear-gradient(135deg, #020617, #e879f9); color: #fff; border-color: #d946ef; }
        .g2048-tile.v-super { background: linear-gradient(135deg, #020617, #22d3ee); color: #fff; border-color: #06b6d4; }
        .g2048-tile.is-sliding {
          z-index: 3;
          animation: g2048-tile-slide var(--tile-slide-duration) cubic-bezier(0.18, 0.86, 0.2, 1) both;
        }
        .g2048-tile.is-new {
          z-index: 3;
          animation: g2048-tile-spawn-card 170ms cubic-bezier(0.18, 0.9, 0.28, 1.16) both;
        }
        .g2048-tile.is-merged {
          z-index: 4;
          animation: g2048-tile-merge-pop 185ms cubic-bezier(0.18, 0.9, 0.28, 1.12) both;
        }
        .g2048-tile.is-merged::after {
          animation: g2048-tile-merge-flash 185ms ease-out both;
        }
        @keyframes g2048-tile-slide {
          0% {
            transform: translate3d(var(--tile-from-x, var(--tile-x, 0px)), var(--tile-from-y, var(--tile-y, 0px)), 0) scale(1);
          }
          100% {
            transform: translate3d(var(--tile-x, 0px), var(--tile-y, 0px), 0) scale(1);
          }
        }
        @keyframes g2048-tile-spawn-card {
          0% {
            opacity: 0;
            transform: translate3d(var(--tile-x, 0px), var(--tile-y, 0px), 0) scale(0.52);
          }
          70% {
            opacity: 1;
            transform: translate3d(var(--tile-x, 0px), var(--tile-y, 0px), 0) scale(1.06);
          }
          100% {
            opacity: 1;
            transform: translate3d(var(--tile-x, 0px), var(--tile-y, 0px), 0) scale(1);
          }
        }
        @keyframes g2048-tile-merge-pop {
          0% {
            transform: translate3d(var(--tile-x, 0px), var(--tile-y, 0px), 0) scale(1);
          }
          48% {
            transform: translate3d(var(--tile-x, 0px), var(--tile-y, 0px), 0) scale(1.18);
          }
          100% {
            transform: translate3d(var(--tile-x, 0px), var(--tile-y, 0px), 0) scale(1);
          }
        }
        @keyframes g2048-tile-merge-flash {
          0% { opacity: 0; transform: scale(0.9); }
          42% { opacity: 0.82; transform: scale(1.08); }
          100% { opacity: 0; transform: scale(1.18); }
        }
        .g2048-restore-note {
          margin-bottom: 14px;
          border-radius: 18px;
          border: 1px solid #fde68a;
          background: #fffbeb;
          padding: 11px 14px;
          color: #b45309;
          text-align: center;
          font-size: 13px;
          font-weight: 900;
        }
        .g2048-side {
          display: flex;
          position: sticky;
          top: 96px;
          flex-direction: column;
          gap: 16px;
        }
        .g2048-stat-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-top: 16px;
        }
        .g2048-stat {
          border-radius: 18px;
          border: 1px solid #d1fae5;
          background: #f8fafc;
          padding: 12px;
        }
        .g2048-stat span {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: #64748b;
          font-size: 12px;
          font-weight: 900;
        }
        .g2048-stat span svg {
          width: 14px;
          height: 14px;
          color: #059669;
        }
        .g2048-stat strong {
          display: block;
          margin-top: 7px;
          color: #0f172a;
          font-size: 20px;
          font-weight: 1000;
          font-variant-numeric: tabular-nums;
        }
        .g2048-record-list {
          display: flex;
          flex-direction: column;
          gap: 9px;
          margin-top: 16px;
        }
        .g2048-record-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          border-radius: 16px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          padding: 11px 12px;
        }
        .g2048-record-row strong {
          display: block;
          color: #0f172a;
          font-size: 13px;
          font-weight: 950;
        }
        .g2048-record-row span {
          display: block;
          margin-top: 2px;
          color: #64748b;
          font-size: 11px;
          font-weight: 750;
        }
        .g2048-record-row em {
          color: #059669;
          font-size: 14px;
          font-style: normal;
          font-weight: 1000;
        }
        .g2048-empty-record {
          border-radius: 16px;
          background: #f8fafc;
          padding: 14px;
          color: #94a3b8;
          text-align: center;
          font-size: 13px;
          font-weight: 850;
        }
        .g2048-modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 70;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(15, 23, 42, 0.48);
          padding: 18px;
          backdrop-filter: blur(10px);
        }
        .g2048-result-modal,
        .g2048-rules-modal {
          width: min(560px, 100%);
          max-height: min(86vh, 760px);
          overflow: auto;
          border-radius: 30px;
          border: 1px solid rgba(255, 255, 255, 0.92);
          background: rgba(255, 255, 255, 0.97);
          padding: 24px;
          box-shadow: 0 28px 90px rgba(15, 23, 42, 0.24);
        }
        .g2048-rules-modal {
          width: min(760px, 100%);
        }
        .g2048-result-icon {
          display: flex;
          height: 82px;
          width: 82px;
          align-items: center;
          justify-content: center;
          border-radius: 28px;
          background: linear-gradient(135deg, #f59e0b, #10b981);
          color: #fff;
          box-shadow: 0 18px 34px rgba(5, 150, 105, 0.25);
        }
        .g2048-result-stats,
        .g2048-rule-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-top: 20px;
        }
        .g2048-result-stat,
        .g2048-rule-item {
          border-radius: 18px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          padding: 12px;
        }
        .g2048-rule-item h3 {
          margin: 8px 0 4px;
          color: #0f172a;
          font-size: 15px;
          font-weight: 1000;
        }
        .g2048-rule-item p {
          margin: 0;
          color: #64748b;
          font-size: 13px;
          font-weight: 750;
          line-height: 1.7;
        }
        @media (max-width: 980px) {
          .g2048-layout {
            grid-template-columns: 1fr;
          }
          .g2048-side {
            position: static;
          }
        }
        @media (max-width: 768px) {
          .g2048-screen .g2048-topbar {
            padding: 12px 16px;
            padding-top: max(12px, env(safe-area-inset-top));
          }
          .g2048-screen .g2048-container {
            width: min(100% - 28px, 1360px);
            padding: 10px 0 88px;
          }
          .g2048-command-bar {
            align-items: stretch;
            flex-direction: column;
            border-radius: 24px;
            padding: 14px;
          }
          .g2048-command-actions,
          .g2048-command-actions button {
            width: 100%;
          }
          .g2048-board-panel,
          .g2048-stats-card,
          .g2048-records-card {
            border-radius: 24px;
            padding: 14px;
          }
          .g2048-board {
            border-radius: 22px;
          }
          .g2048-tile {
            border-radius: 12px;
          }
          .g2048-tile {
            font-size: 16px;
          }
          .g2048-tile.digits-4 { font-size: 14px; }
          .g2048-tile.digits-5 { font-size: 12px; }
          .g2048-tile.digits-6 { font-size: 11px; }
          .g2048-result-stats,
          .g2048-rule-grid {
            grid-template-columns: 1fr;
          }
          .g2048-result-modal,
          .g2048-rules-modal {
            border-radius: 22px;
            padding: 18px;
          }
        }
        @media (max-width: 480px) {
          .g2048-stat-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

const Game2048Board = memo(function Game2048Board({
  tiles,
  disabled,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onMouseDown,
  onMouseUp,
}: {
  tiles: VisualTile[];
  disabled: boolean;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: () => void;
  onMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onMouseUp: (event: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className={`g2048-board ${disabled ? 'is-disabled' : ''}`}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      aria-label="2048 棋盘"
    >
      <div className="g2048-tile-layer" aria-hidden>
        {tiles.map((tile) => <Game2048Tile key={tile.id} tile={tile} />)}
      </div>
    </div>
  );
});

const Game2048Tile = memo(function Game2048Tile({ tile }: { tile: VisualTile }) {
  const hasImg = tile.value <= GAME2048_TILE_IMAGE_MAX;
  const displayValue = formatTileValue(tile.value);
  const tileStyle = {
    ...(hasImg ? { ['--tile-img']: `url('${TILE_IMAGE_BASE}/${tile.value}.webp')` } : {}),
    ...(typeof tile.fromCol === 'number' ? { ['--tile-from-x']: TILE_OFFSET_PERCENT[tile.fromCol] } : {}),
    ...(typeof tile.fromRow === 'number' ? { ['--tile-from-y']: TILE_OFFSET_PERCENT[tile.fromRow] } : {}),
  } as CSSProperties;

  return (
    <div
      className={[
        'g2048-tile',
        `r-${tile.row}`,
        `c-${tile.col}`,
        hasImg ? 'is-img' : getTileClass(tile.value),
        getDigitsClass(tile.value),
        tile.state ? `is-${tile.state}` : '',
      ].filter(Boolean).join(' ')}
      style={tileStyle}
      title={String(tile.value)}
      aria-label={`方块 ${tile.value}`}
    >
      <span className="g2048-tile-value">{displayValue}</span>
    </div>
  );
});

function Game2048Stat({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="g2048-stat">
      <span>{icon}{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Game2048ResultModal({
  result,
  loading,
  cooldownRemaining,
  onStart,
}: {
  result: Game2048Record;
  loading: boolean;
  cooldownRemaining: number;
  onStart: () => void;
}) {
  return (
    <div className="g2048-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="g2048-result-title">
      <div className="g2048-result-modal">
        <div className="flex flex-col items-center text-center">
          <div className="g2048-result-icon">
            <Trophy className="h-9 w-9" />
          </div>
          <div className="mt-5 text-xs font-black uppercase tracking-wider text-emerald-700/80">
            结算完成
          </div>
          <h2 id="g2048-result-title" className="mt-1 text-2xl font-black text-slate-950">
            {result.won ? '挑战胜利' : '挑战失败'}
          </h2>
          <p className="mt-3 text-sm font-bold leading-6 text-slate-500">
            本局得分 {result.score.toLocaleString()}，最高方块 {result.highestTile}，获得 {result.pointsEarned} 福利积分。
          </p>
        </div>

        <div className="g2048-result-stats">
          <Game2048ResultStat label="得分" value={result.score.toLocaleString()} />
          <Game2048ResultStat label="最高方块" value={String(result.highestTile)} />
          <Game2048ResultStat label="有效步数" value={String(result.moves)} />
          <Game2048ResultStat label="用时" value={formatDuration(result.duration)} />
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Link
            href="/games"
            className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-600 transition-colors hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            返回游戏中心
          </Link>
          <button
            type="button"
            onClick={onStart}
            disabled={loading || cooldownRemaining > 0}
            className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white shadow-lg shadow-emerald-200 transition-all hover:-translate-y-0.5 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RotateCcw className="h-4 w-4" />
            {cooldownRemaining > 0 ? `冷却中 ${cooldownRemaining}s` : '再来一局'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Game2048ResultStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="g2048-result-stat text-center">
      <div className="text-xs font-black text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-black text-slate-950 tabular-nums">{value}</div>
    </div>
  );
}

function Game2048RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="g2048-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="g2048-rules-title">
      <div className="g2048-rules-modal">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 text-xs font-black text-emerald-600">RULE BOOK</div>
            <h2 id="g2048-rules-title" className="text-2xl font-black text-slate-950">
              2048 规则
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

        <div className="g2048-rule-grid">
          <Game2048RuleItem icon={<Move />} title="合成规则" text="5x5 棋盘内同一方向滑动，所有方块向该方向靠拢，相邻且数字相同的方块会合并一次。" />
          <Game2048RuleItem icon={<Hash />} title="胜利目标" text={`本局得分达到 ${GAME2048_WIN_SCORE.toLocaleString()} 分即判定胜利，达成后仍可继续冲击更高分。`} />
          <Game2048RuleItem icon={<Trophy />} title="得分规则" text="每次合并后的新方块数值会计入得分，服务端按开局种子和操作序列复算。" />
          <Game2048RuleItem icon={<Coins />} title="积分规则" text={`积分 = floor(得分 / ${GAME2048_REWARD_DIVISOR}) + 最高方块里程碑奖励；4096 之后每突破一档，新增奖励会继续递增。`} />
        </div>
      </div>
    </div>
  );
}

function Game2048RuleItem({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <article className="g2048-rule-item">
      <div className="text-emerald-700 [&_svg]:h-5 [&_svg]:w-5">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}
