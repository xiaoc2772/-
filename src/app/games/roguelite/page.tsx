'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowLeft,
  BookOpen,
  DoorOpen,
  Gem,
  Heart,
  Key,
  Map,
  PackageOpen,
  Shield,
  ShoppingBag,
  Sparkles,
  Star,
  Sword,
  Target,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import {
  ROGUELITE_RELIC_DESCRIPTIONS,
  ROGUELITE_RELIC_ICONS,
  ROGUELITE_RELIC_LABELS,
  calculateRoguelitePointReward,
  type RogueliteAction,
  type RogueliteCellView,
  type RogueliteRelicType,
  type RogueliteStateView,
} from '@/lib/roguelite-engine';
import type { RogueliteGameRecord, RogueliteSessionView } from '@/lib/roguelite-types';
import { CancelConfirmModal } from '../_components/CancelConfirmModal';

interface RogueliteStatus {
  balance: number;
  dailyStats: { gamesPlayed: number; pointsEarned: number } | null;
  inCooldown: boolean;
  cooldownRemaining: number;
  dailyLimit: number;
  pointsLimitReached: boolean;
  records: RogueliteGameRecord[];
  activeSession: RogueliteSessionView | null;
}

interface StepResponse {
  session: RogueliteSessionView;
  outcome: {
    message: string;
    status: 'playing' | 'escaped' | 'defeated';
    damageTaken: number;
    shieldBlocked: number;
    stardustDelta: number;
    keyDelta: number;
    hpDelta: number;
    relicGained?: RogueliteRelicType;
    floorChanged: boolean;
    combatEnded: boolean;
  };
}

type RogueliteOutcomeView = StepResponse['outcome'];

interface StepApiData {
  session?: RogueliteSessionView;
  outcome?: RogueliteOutcomeView;
}

interface SubmitResponse {
  record: RogueliteGameRecord;
  pointsEarned: number;
}

interface ApiResponse<T> {
  success?: boolean;
  data?: T;
  message?: string;
}

type Phase = 'ready' | 'playing' | 'finished';
type RoguelitePendingView = NonNullable<RogueliteStateView['pending']>;

const ROGUELITE_ART_BASE = '/images-optimized/ui/games/roguelite';
const ROGUELITE_BOARD_ART = `${ROGUELITE_ART_BASE}/board-background-premium-clean.webp`;
const ROGUELITE_REQUEST_TIMEOUT_MS = 15_000;

const ROGUELITE_CELL_ART: Record<RogueliteCellView['type'], string> = {
  hidden: `${ROGUELITE_ART_BASE}/fog.webp`,
  start: `${ROGUELITE_ART_BASE}/start.webp`,
  empty: `${ROGUELITE_ART_BASE}/empty.webp`,
  monster: `${ROGUELITE_ART_BASE}/monster.webp`,
  boss: `${ROGUELITE_ART_BASE}/boss.webp`,
  stardust: `${ROGUELITE_ART_BASE}/stardust.webp`,
  relic: `${ROGUELITE_ART_BASE}/relic.webp`,
  event: `${ROGUELITE_ART_BASE}/event.webp`,
  shop: `${ROGUELITE_ART_BASE}/shop.webp`,
  rift: `${ROGUELITE_ART_BASE}/rift.webp`,
  chest: `${ROGUELITE_ART_BASE}/chest.webp`,
  exit: `${ROGUELITE_ART_BASE}/exit.webp`,
};

const DEFAULT_ROGUELITE_SCORE: RogueliteStateView['scorePreview'] = {
  floorPoints: 0,
  explorationPoints: 0,
  monsterPoints: 0,
  stardustPoints: 0,
  lifePoints: 0,
  relicPoints: 0,
  chestPoints: 0,
  winBonus: 0,
  total: 0,
};

async function parseJson<T>(res: Response): Promise<ApiResponse<T> | null> {
  try {
    return (await res.json()) as ApiResponse<T>;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = ROGUELITE_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timer);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function getRequestErrorMessage(error: unknown, timeoutMessage: string, fallbackMessage: string): string {
  if (isAbortError(error)) {
    return timeoutMessage;
  }
  return error instanceof Error ? error.message : fallbackMessage;
}

function shouldRefreshRogueliteStatusAfterStepError(message: string): boolean {
  return (
    message.includes('HTTP 503')
    || message.includes('服务器错误')
    || message.includes('网络错误')
    || message.includes('当前事件尚未处理完成')
    || message.includes('操作过于频繁')
    || message.includes('行动次数过多')
    || message.includes('游戏会话')
  );
}

function riskLabel(risk: RogueliteCellView['risk']): string {
  if (risk === 'high') return '高危';
  if (risk === 'medium') return '未知';
  if (risk === 'low') return '微光';
  return '安全';
}

function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function safeInteger(value: unknown, fallback = 0): number {
  return Math.floor(safeNumber(value, fallback));
}

function isSafePosition(value: unknown): value is { row: number; col: number } {
  if (!value || typeof value !== 'object') return false;
  const position = value as { row?: unknown; col?: unknown };
  return Number.isFinite(position.row) && Number.isFinite(position.col);
}

function safePositionLabel(position: unknown): string {
  return isSafePosition(position)
    ? `${safeInteger(position.row)},${safeInteger(position.col)}`
    : '未知';
}

function safeRelicLabel(relic: unknown): string {
  return typeof relic === 'string' && relic in ROGUELITE_RELIC_LABELS
    ? ROGUELITE_RELIC_LABELS[relic as RogueliteRelicType]
    : '未知遗物';
}

function safeRelicIcon(relic: unknown): string {
  return typeof relic === 'string' && relic in ROGUELITE_RELIC_ICONS
    ? ROGUELITE_RELIC_ICONS[relic as RogueliteRelicType]
    : '◇';
}

function safeRelicDescription(relic: unknown): string {
  return typeof relic === 'string' && relic in ROGUELITE_RELIC_DESCRIPTIONS
    ? ROGUELITE_RELIC_DESCRIPTIONS[relic as RogueliteRelicType]
    : '旧会话遗物数据不完整，效果以服务端结算为准。';
}

function getSafeScorePreview(state: Pick<RogueliteStateView, 'scorePreview'>): RogueliteStateView['scorePreview'] {
  const score = state.scorePreview ?? DEFAULT_ROGUELITE_SCORE;
  return {
    floorPoints: safeInteger(score.floorPoints),
    explorationPoints: safeInteger(score.explorationPoints),
    monsterPoints: safeInteger(score.monsterPoints),
    stardustPoints: safeInteger(score.stardustPoints),
    lifePoints: safeInteger(score.lifePoints),
    relicPoints: safeInteger(score.relicPoints),
    chestPoints: safeInteger(score.chestPoints),
    winBonus: safeInteger(score.winBonus),
    total: safeInteger(score.total),
  };
}

function getSafeBoardSize(value: unknown): number {
  const size = safeInteger(value, 7);
  return size > 0 && size <= 15 ? size : 7;
}

function getSafeCellArt(cell: RogueliteCellView): string {
  return ROGUELITE_CELL_ART[cell.type] ?? ROGUELITE_CELL_ART.hidden;
}

function isRenderableCell(cell: RogueliteCellView): boolean {
  return isSafePosition(cell.position) && isSafePosition(cell.viewPosition);
}

function cellTone(cell: RogueliteCellView): string {
  if (cell.state === 'current') {
    return 'text-sky-100';
  }
  if (cell.state === 'hidden') {
    return 'text-slate-100';
  }
  if (cell.exhausted) {
    return 'text-slate-300 opacity-80';
  }
  if (cell.type === 'exit') {
    return 'text-cyan-100';
  }
  if (cell.type === 'boss' || cell.risk === 'high') {
    return 'text-rose-100';
  }
  if (cell.type === 'relic' || cell.type === 'chest') {
    return 'text-amber-100';
  }
  if (cell.type === 'shop' || cell.type === 'stardust') {
    return 'text-emerald-100';
  }
  return 'text-slate-100';
}

export default function RoguelitePage() {
  const [phase, setPhase] = useState<Phase>('ready');
  const [status, setStatus] = useState<RogueliteStatus | null>(null);
  const [session, setSession] = useState<RogueliteSessionView | null>(null);
  const [result, setResult] = useState<RogueliteGameRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('准备进入星尘迷阵');
  const [showRules, setShowRules] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<RogueliteOutcomeView | null>(null);
  const submittingRef = useRef(false);
  const steppingRef = useRef(false);

  const state = session?.state ?? null;
  const player = state?.player ?? null;
  const pending = state?.pending ?? null;
  const starGate = state?.starGate ?? null;
  const boardSize = getSafeBoardSize(state?.boardSize);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetchWithTimeout('/api/games/roguelite/status');
      const data = await parseJson<RogueliteStatus>(res);
      if (!res.ok || !data?.success || !data.data) {
        throw new Error(data?.message ?? (res.status === 401 ? '请先登录后开始游戏' : '加载游戏状态失败'));
      }
      setStatus(data.data);
      setError(null);
      if (data.data.activeSession) {
        setSession(data.data.activeSession);
        setPhase('playing');
        setMessage('已恢复正在进行的迷阵');
      }
    } catch (err) {
      setError(getRequestErrorMessage(err, '加载状态超时，请检查网络后重试', '网络错误，请稍后重试'));
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (phase === 'playing' || !status?.inCooldown) return;
    const timer = window.setInterval(() => {
      void fetchStatus();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [fetchStatus, phase, status?.inCooldown]);

  const submitResult = useCallback(async (targetSession: RogueliteSessionView) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithTimeout('/api/games/roguelite/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: targetSession.sessionId }),
      });
      const data = await parseJson<SubmitResponse>(res);
      if (!res.ok || !data?.success || !data.data) {
        throw new Error(data?.message ?? `结算失败（HTTP ${res.status}）`);
      }

      setResult(data.data.record);
      setSession(null);
      setPhase('finished');
      setLastOutcome(null);
      setMessage(`本局获得 ${data.data.pointsEarned} 福利积分`);
      void fetchStatus();
    } catch (err) {
      setError(getRequestErrorMessage(err, '结算请求超时，请检查网络后重试', '结算失败，请稍后重试'));
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  }, [fetchStatus]);

  const startGame = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetchWithTimeout('/api/games/roguelite/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await parseJson<RogueliteSessionView>(res);
      if (!res.ok || !data?.success || !data.data) {
        throw new Error(data?.message ?? `开始游戏失败（HTTP ${res.status}）`);
      }
      setSession(data.data);
      setPhase('playing');
      setLastOutcome(null);
      setMessage('选择相邻格子，点亮第一片星砂');
    } catch (err) {
      setError(getRequestErrorMessage(err, '开始游戏超时，请检查网络后重试', '开始游戏失败，请稍后重试'));
    } finally {
      setLoading(false);
    }
  }, []);

  const cancelGame = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithTimeout('/api/games/roguelite/cancel', { method: 'POST' });
      const data = await parseJson<null>(res);
      if (!res.ok || !data?.success) {
        throw new Error(data?.message ?? '取消游戏失败');
      }
      setSession(null);
      setPhase('ready');
      setLastOutcome(null);
      setMessage('本局已放弃');
      void fetchStatus();
    } catch (err) {
      setError(getRequestErrorMessage(err, '取消游戏超时，请检查网络后重试', '取消游戏失败，请稍后重试'));
    } finally {
      setLoading(false);
    }
  }, [fetchStatus]);

  const confirmCancelGame = useCallback(async () => {
    await cancelGame();
    setShowCancelConfirm(false);
  }, [cancelGame]);

  const stepGame = useCallback(async (action: RogueliteAction) => {
    if (showCancelConfirm) return;
    if (!session || steppingRef.current) return;
    steppingRef.current = true;
    setLoading(true);
    setError(null);
    let syncedSessionFromError = false;
    try {
      const res = await fetchWithTimeout('/api/games/roguelite/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, action }),
      });
      const data = await parseJson<StepApiData>(res);
      if (!res.ok || !data?.success || !data.data?.session || !data.data.outcome) {
        if (data?.data?.session) {
          syncedSessionFromError = true;
          setSession(data.data.session);
          setPhase('playing');
          setLastOutcome(null);
          setMessage(
            data.data.session.state.pending
              ? '已同步迷阵状态，请先处理当前事件'
              : '已同步迷阵状态，请重试操作',
          );
        }
        throw new Error(data?.message ?? `行动失败（HTTP ${res.status}）`);
      }

      setSession(data.data.session);
      setLastOutcome(data.data.outcome);
      setMessage(data.data.outcome.message);
    } catch (err) {
      const errorMessage = getRequestErrorMessage(err, '行动请求超时，请检查网络后重试', '行动失败，请稍后重试');
      setError(errorMessage);
      if (!syncedSessionFromError && shouldRefreshRogueliteStatusAfterStepError(errorMessage)) {
        void fetchStatus();
      }
    } finally {
      steppingRef.current = false;
      setLoading(false);
    }
  }, [fetchStatus, session, showCancelConfirm]);

  const canMove = state?.status === 'playing' && !pending && !showCancelConfirm && !loading;

  const sortedBoard = useMemo(() => {
    return [...(state?.board ?? [])]
      .filter(isRenderableCell)
      .sort((a, b) => (a.viewPosition.row - b.viewPosition.row) || (a.viewPosition.col - b.viewPosition.col));
  }, [state?.board]);

  const tacticalLine = useMemo(() => {
    if (!state) return '先进入迷阵，路线会在这里展开。';
    if (state.pending?.type === 'combat') return '当前被怪物拦住，优先判断是否需要防御攒护盾。';
    if (state.pending?.type === 'event') return '事件会改变资源结构，低生命时优先保命。';
    if (state.pending?.type === 'shop') return '商店是稳定补强点，星尘不足时可以先离开。';
    if (state.pending?.type === 'chest') return '宝箱收益高，但钥匙也可能用于后续回复事件。';
    if (state.starGate?.endlessUnlocked) return '已进入无尽阶段，可以继续贪收益，也可以撤离锁定积分。';
    if (safeNumber(state.starGate?.distance, Infinity) <= 2) return '星门很近，准备穿门前先看生命和护盾是否稳。';
    if (player && safeNumber(player.hp) <= Math.max(6, Math.floor(safeNumber(player.maxHp, 30) * 0.25))) return '生命偏低，优先选择安全格、回复、护盾或商店。';
    return '优先点亮收益格，同时保留星尘给商店和星爆。';
  }, [player, state]);

  return (
    <>
    <div className="rogue-page">
      <div className="rogue-mesh-bg" aria-hidden />
      <div className="rogue-stardust" aria-hidden>
        <span style={{ top: '8%', left: '5%', fontSize: 14 }}>✦</span>
        <span style={{ top: '18%', left: '92%', fontSize: 11, animationDelay: '1s' }}>✦</span>
        <span style={{ top: '38%', left: '3%', fontSize: 16, animationDelay: '2.5s' }}>✧</span>
        <span style={{ top: '60%', left: '96%', fontSize: 12, animationDelay: '0.7s' }}>✧</span>
        <span style={{ top: '78%', left: '8%', fontSize: 13, animationDelay: '1.8s' }}>✦</span>
        <span style={{ top: '88%', left: '88%', fontSize: 15, animationDelay: '3s' }}>✧</span>
      </div>

      <header className="rogue-topbar">
        <Link href="/games" className="rogue-exit-btn">
          <span className="arrow">
            <ArrowLeft size={14} strokeWidth={2.4} />
          </span>
          EXIT
        </Link>
      </header>

      <main className="rogue-container">
        {error && (
          <div className="rogue-error-banner" role="alert">
            {error}
          </div>
        )}
      <section className="rogue-command-bar" aria-live="polite">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-black text-emerald-700">
            <Map className="h-4 w-4" />
            <span>{phase === 'playing' ? '迷阵指令' : phase === 'finished' ? '本局结算' : '出发准备'}</span>
            <span className="text-slate-300">/</span>
            <span className="text-slate-500">{tacticalLine}</span>
          </div>
          <p className="truncate text-lg font-black text-slate-950 sm:text-xl">{message}</p>
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

      <OutcomePulse outcome={lastOutcome} />

      <main className="glass-card stage-card rogue-game-card">
        <StatusDock
          player={player}
          phase={phase}
          loading={loading || showCancelConfirm}
          status={status}
          canEscape={Boolean(state?.status === 'playing' && state.starGate?.endlessUnlocked && !state.pending)}
          onStart={() => void startGame()}
          onCancel={() => setShowCancelConfirm(true)}
          onEscape={() => void stepGame({ type: 'escape' })}
        />

        {phase === 'ready' && !session && (
          <div className="flex min-h-[440px] flex-col items-center justify-center rounded-3xl bg-emerald-50/60 p-8 text-center">
              <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-emerald-600 to-emerald-800 text-white shadow-xl shadow-emerald-300">
                <Sparkles className="h-10 w-10" />
              </div>
              <h2 className="text-2xl font-black text-slate-900">准备点亮迷阵</h2>
              <p className="mt-3 max-w-md text-sm leading-7 text-slate-500">
                每一格都可能改变路线。高危格奖励更厚，但裂隙和精英怪也更容易出现。
              </p>
              <button
                onClick={() => void startGame()}
                disabled={loading || status?.inCooldown}
                className="mt-8 rounded-2xl bg-emerald-600 px-8 py-4 font-bold text-white shadow-lg shadow-emerald-300 transition-all hover:-translate-y-0.5 hover:bg-emerald-500 active:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-700/40"
                type="button"
              >
                {status?.inCooldown ? `冷却中 ${status.cooldownRemaining}s` : '开始冒险'}
              </button>
            </div>
        )}

        {phase === 'playing' && state && session && (
          <div className="rogue-game-layout">
            <section className="rogue-board-panel">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-slate-400">
                    {state.floor > 3 ? `无尽星域 · 第 ${state.floor - 3} 段` : `第 ${state.floor} 层`}
                  </div>
                  <h2 className="text-2xl font-black text-slate-900">星尘棋盘</h2>
                  <div className="mt-1 text-xs font-bold text-slate-400">
                    {state.sightRadius > 1 ? '星辉透镜：当前视野扩大一圈' : '基础视野：周围 8 格，走过不会消失'}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(['safe', 'low', 'medium', 'high'] as const).map((risk) => (
                    <span key={risk} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">
                      {riskLabel(risk)}
                    </span>
                  ))}
                </div>
              </div>

              <div className="rogue-board-hint">
                <div className="flex items-center gap-2 font-black text-emerald-800">
                  <Map className="h-4 w-4" />
                  星门在{starGate?.direction ?? '未知方向'}，距离 {safeInteger(starGate?.distance)} 步
                </div>
                <div className="font-bold text-emerald-700">
                  {starGate?.exact && starGate.position
                    ? `坐标 ${safePositionLabel(starGate.position)}`
                    : starGate?.endlessUnlocked
                      ? '无尽阶段可撤离'
                      : '取得星门罗盘可显示精确坐标'}
                </div>
              </div>

              <div
                className="rogue-board relative mx-auto aspect-square w-full max-w-[680px] overflow-hidden rounded-[2rem] bg-emerald-950 shadow-inner"
                data-testid="roguelite-board"
              >
                <div className="absolute inset-0">
                  <Image
                    src={ROGUELITE_BOARD_ART}
                    alt=""
                    fill
                    sizes="(max-width: 768px) 100vw, 680px"
                    priority
                    decoding="async"
                    className="object-cover opacity-95"
                    aria-hidden
                  />
                  <div
                    className="absolute grid"
                    style={{
                      left: '12.143%',
                      top: '12.143%',
                      width: '75.714%',
                      height: '75.714%',
                      gridTemplateColumns: `repeat(${boardSize}, minmax(0, 1fr))`,
                      gridTemplateRows: `repeat(${boardSize}, minmax(0, 1fr))`,
                    }}
                  >
                    {sortedBoard.map((cell) => {
                      const movable = canMove && cell.adjacent && cell.state !== 'current';
                      const artSrc = getSafeCellArt(cell);
                      const ariaLabel = cell.state === 'hidden'
                        ? `世界坐标 ${safePositionLabel(cell.position)}，迷雾，尚未照亮`
                        : cell.state === 'current'
                          ? `世界坐标 ${safePositionLabel(cell.position)}，当前位置，${cell.label}，${riskLabel(cell.risk)}`
                          : `世界坐标 ${safePositionLabel(cell.position)}，${cell.label}，${riskLabel(cell.risk)}`;
                      return (
                        <button
                          key={cell.id}
                          type="button"
                          onClick={() => {
                            void stepGame({ type: 'move', to: cell.position });
                          }}
                          disabled={!movable}
                          aria-label={ariaLabel}
                          className={`relative min-h-0 overflow-hidden bg-transparent text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-0 ${cellTone(cell)} ${movable ? 'hover:bg-emerald-300/15 hover:shadow-[0_0_18px_rgba(52,211,153,0.45)]' : 'disabled:cursor-default'}`}
                        >
                          {artSrc && (
                            <Image
                              src={artSrc}
                              alt=""
                              width={112}
                              height={112}
                              sizes="112px"
                              decoding="async"
                              className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 object-contain drop-shadow-md ${cell.state === 'hidden' ? 'h-full w-full opacity-90 saturate-75' : 'h-[82%] w-[82%] opacity-100'}`}
                              aria-hidden
                            />
                          )}
                          {!artSrc && <span className="relative text-2xl font-black sm:text-3xl">{cell.icon}</span>}
                          <span className="sr-only">{cell.label}，{cell.hint}</span>
                          {cell.state === 'current' && (
                            <span
                              className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-red-500 shadow-[0_0_12px_rgba(248,113,113,0.95)]"
                              aria-hidden
                            />
                          )}
                          {movable && (
                            <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.9)]" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>

            <aside className="rogue-side-panel">
              <ScorePreviewPanel state={state} />
            </aside>
          </div>
        )}
      </main>

      {state?.pending && player && (
        <PendingActionModal
          pending={state.pending}
          player={player}
          outcome={lastOutcome}
          loading={loading || showCancelConfirm}
          onAction={(action) => void stepGame(action)}
          onRecover={() => void fetchStatus()}
        />
      )}

      {phase === 'playing' && state && session && state.status !== 'playing' && !state.pending && (
        <RogueliteOutcomeModal
          state={state}
          loading={loading || showCancelConfirm}
          onSubmit={() => void submitResult(session)}
        />
      )}

      {phase === 'finished' && result && !session && (
        <RogueliteSettlementModal
          result={result}
          loading={loading || showCancelConfirm}
          status={status}
          onStart={() => void startGame()}
        />
      )}

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}

      <style jsx global>{`
        .rogue-page {
          min-height: 100vh;
          background: #eefcf8;
          color: #0f172a;
          position: relative;
          overflow-x: hidden;
        }
        .rogue-page a {
          color: inherit;
          text-decoration: none;
        }
        .rogue-page .rogue-mesh-bg {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          background:
            radial-gradient(circle at 12% 18%, rgba(45, 212, 191, 0.42), transparent 38%),
            radial-gradient(circle at 86% 14%, rgba(59, 130, 246, 0.22), transparent 34%),
            radial-gradient(circle at 50% 94%, rgba(16, 185, 129, 0.34), transparent 42%),
            linear-gradient(180deg, #effdf8 0%, #e7f7ff 100%);
          filter: blur(22px);
        }
        .rogue-page .rogue-stardust {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          overflow: hidden;
        }
        .rogue-page .rogue-stardust span {
          position: absolute;
          color: rgba(255, 255, 255, 0.78);
          animation: rogue-twinkle 3s ease-in-out infinite;
        }
        @keyframes rogue-twinkle {
          0%, 100% { opacity: 0.28; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.32); }
        }
        .rogue-page .rogue-topbar {
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
        .rogue-page .rogue-exit-btn {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          font-weight: 900;
          border: 1px solid rgba(255, 255, 255, 0.82);
          background: rgba(255, 255, 255, 0.62);
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.07);
          backdrop-filter: blur(16px);
        }
        .rogue-page .rogue-exit-btn {
          gap: 10px;
          padding: 8px 18px 8px 8px;
          color: #065f46;
          letter-spacing: 1.5px;
          font-size: 13px;
        }
        .rogue-page .rogue-exit-btn .arrow {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .rogue-page .rogue-exit-btn .arrow {
          width: 30px;
          height: 30px;
          color: #fff;
          background: linear-gradient(135deg, #34d399, #047857);
          box-shadow: 0 8px 14px rgba(4, 120, 87, 0.28);
        }
        .rogue-page .rogue-container {
          position: relative;
          z-index: 1;
          max-width: 1360px;
          margin: 0 auto;
          padding: 22px 48px 92px;
          display: flex;
          flex-direction: column;
          gap: 22px;
        }
        .rogue-page .rogue-error-banner {
          padding: 13px 18px;
          border-radius: 18px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #b91c1c;
          font-size: 14px;
          font-weight: 800;
        }
        .rogue-page .glass-card {
          background: rgba(255, 255, 255, 0.88);
          border: 1px solid rgba(255, 255, 255, 0.95);
          border-radius: 30px;
          box-shadow: 0 24px 48px rgba(15, 23, 42, 0.07);
          backdrop-filter: blur(24px);
        }
        .rogue-page .stage-card { padding: 24px; }
        .rogue-page .rogue-command-bar {
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
        .rogue-page .rogue-game-card {
          display: flex;
          flex-direction: column;
          gap: 22px;
        }
        .rogue-page .rogue-status-dock {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 16px;
          align-items: center;
          border-radius: 24px;
          background: linear-gradient(135deg, rgba(236, 253, 245, 0.95), rgba(255, 255, 255, 0.86));
          border: 1px solid rgba(167, 243, 208, 0.8);
          padding: 14px;
        }
        .rogue-page .rogue-status-metrics {
          display: grid;
          grid-template-columns: repeat(6, minmax(86px, 1fr));
          gap: 8px;
        }
        .rogue-page .rogue-metric {
          min-width: 0;
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.78);
          padding: 10px 12px;
        }
        .rogue-page .rogue-game-layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(280px, 320px);
          gap: 24px;
          align-items: start;
        }
        .rogue-page .rogue-side-panel {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .rogue-page .rogue-board-hint {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 16px;
          border-radius: 18px;
          border: 1px solid #d1fae5;
          background: #ecfdf5;
          padding: 12px 14px;
          font-size: 14px;
        }
        .rogue-page .rogue-panel {
          border-radius: 24px;
          border: 1px solid rgba(226, 232, 240, 0.95);
          background: #fff;
          padding: 18px;
          box-shadow: 0 12px 26px rgba(15, 23, 42, 0.05);
        }
        .rogue-page .rogue-score-panel {
          background:
            linear-gradient(180deg, rgba(236, 253, 245, 0.96), rgba(255, 255, 255, 0.94));
          border-color: rgba(167, 243, 208, 0.95);
        }
        .rogue-page .rogue-score-conversion {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          border-radius: 20px;
          border: 1px solid rgba(167, 243, 208, 0.9);
          background: rgba(255, 255, 255, 0.86);
          padding: 14px;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
        }
        .rogue-page .rogue-outcome-strip {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          border-radius: 20px;
          border: 1px solid rgba(209, 250, 229, 0.9);
          background: rgba(236, 253, 245, 0.82);
          padding: 12px 14px;
          box-shadow: 0 12px 24px rgba(15, 23, 42, 0.05);
        }
        .rogue-page .rogue-applied-card {
          display: flex;
          width: 100%;
          align-items: center;
          gap: 12px;
          border-radius: 20px;
          border: 1px solid rgba(221, 214, 254, 0.9);
          background: rgba(255, 255, 255, 0.9);
          padding: 12px;
          box-shadow: 0 12px 26px rgba(88, 28, 135, 0.08);
        }
        .rogue-page .rogue-applied-card.in-modal {
          margin-top: 14px;
          background: rgba(255, 255, 255, 0.78);
        }
        .rogue-page .rogue-applied-icon {
          display: flex;
          width: 46px;
          height: 46px;
          flex: none;
          align-items: center;
          justify-content: center;
          border-radius: 16px;
          background: linear-gradient(135deg, #f5f3ff, #ede9fe);
          color: #7c3aed;
          font-size: 24px;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.82);
        }
        .rogue-page .rogue-applied-tag {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          border-radius: 999px;
          background: #dcfce7;
          padding: 4px 8px;
          color: #15803d;
          font-size: 11px;
          font-weight: 900;
        }
        .rogue-page .rogue-modal-overlay {
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
        .rogue-page .rogue-event-modal {
          width: min(560px, 100%);
          max-height: min(86vh, 680px);
          overflow-y: auto;
          border-radius: 28px;
          background: #fff;
          padding: 24px;
          box-shadow: 0 30px 70px rgba(15, 23, 42, 0.3);
        }
        .rogue-page .rogue-event-modal.combat {
          border: 1px solid rgba(254, 205, 211, 0.9);
          background: linear-gradient(180deg, #fff 0%, #fff1f2 100%);
        }
        .rogue-page .rogue-event-modal.shop {
          border: 1px solid rgba(167, 243, 208, 0.9);
          background: linear-gradient(180deg, #fff 0%, #ecfdf5 100%);
        }
        .rogue-page .rogue-event-modal.chest {
          border: 1px solid rgba(253, 230, 138, 0.95);
          background: linear-gradient(180deg, #fff 0%, #fffbeb 100%);
        }
        .rogue-page .rogue-event-modal.event {
          border: 1px solid rgba(199, 210, 254, 0.95);
          background: linear-gradient(180deg, #fff 0%, #eef2ff 100%);
        }
        .rogue-page .rogue-event-modal.result {
          border: 1px solid rgba(167, 243, 208, 0.95);
          background: linear-gradient(180deg, #ffffff 0%, #ecfdf5 100%);
        }
        .rogue-page .rogue-event-modal.result.lost {
          border-color: rgba(254, 205, 211, 0.95);
          background: linear-gradient(180deg, #ffffff 0%, #fff1f2 100%);
        }
        .rogue-page .rogue-modal-snapshot {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
          margin-top: 16px;
        }
        .rogue-page .rogue-modal-stat {
          min-width: 0;
          border-radius: 16px;
          border: 1px solid rgba(226, 232, 240, 0.95);
          background: rgba(255, 255, 255, 0.76);
          padding: 10px;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.74);
        }
        .rogue-page .rogue-modal-stat.hp {
          border-color: rgba(254, 205, 211, 0.95);
          background: rgba(255, 241, 242, 0.72);
        }
        .rogue-page .rogue-modal-stat.shield {
          border-color: rgba(186, 230, 253, 0.95);
          background: rgba(240, 249, 255, 0.72);
        }
        .rogue-page .rogue-modal-stat.attack {
          border-color: rgba(254, 215, 170, 0.95);
          background: rgba(255, 247, 237, 0.72);
        }
        .rogue-page .rogue-modal-stat.stardust {
          border-color: rgba(167, 243, 208, 0.95);
          background: rgba(236, 253, 245, 0.72);
        }
        .rogue-page .rogue-modal-stat-label {
          display: flex;
          align-items: center;
          gap: 5px;
          color: #64748b;
          font-size: 11px;
          font-weight: 900;
        }
        .rogue-page .rogue-modal-stat-value {
          margin-top: 4px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #0f172a;
          font-size: 18px;
          font-weight: 900;
        }
        .rogue-page .rogue-result-icon {
          display: flex;
          width: 72px;
          height: 72px;
          align-items: center;
          justify-content: center;
          border-radius: 24px;
          color: #fff;
          box-shadow: 0 18px 34px rgba(15, 23, 42, 0.16);
        }
        .rogue-page .rogue-result-icon.won {
          background: linear-gradient(135deg, #10b981, #047857);
        }
        .rogue-page .rogue-result-icon.lost {
          background: linear-gradient(135deg, #fb7185, #be123c);
        }
        .rogue-page .rogue-result-stats {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }
        .rogue-page .modal-option-grid {
          display: grid;
          gap: 12px;
          margin-top: 20px;
        }
        @media (max-width: 1080px) {
          .rogue-page .rogue-topbar {
            padding: 14px 22px;
            flex-wrap: wrap;
          }
          .rogue-page .rogue-container {
            padding: 22px 22px 82px;
          }
        }
        @media (max-width: 768px) {
          .rogue-page .rogue-topbar {
            padding: 12px 14px;
            gap: 10px;
          }
          .rogue-page .rogue-exit-btn {
            padding: 7px 14px 7px 7px;
            font-size: 12px;
          }
          .rogue-page .rogue-exit-btn .arrow {
            width: 26px;
            height: 26px;
          }
          .rogue-page .rogue-container {
            padding: 16px 14px 92px;
            gap: 18px;
          }
          .rogue-page .stage-card { padding: 14px; border-radius: 24px; }
          .rogue-page .rogue-command-bar {
            align-items: stretch;
            flex-direction: column;
            padding: 14px;
          }
          .rogue-page .rogue-command-bar p { white-space: normal; }
          .rogue-page .rogue-command-bar button { width: 100%; }
          .rogue-page .rogue-status-dock {
            grid-template-columns: 1fr;
          }
          .rogue-page .rogue-status-metrics {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
          .rogue-page .rogue-game-layout {
            grid-template-columns: 1fr;
            gap: 18px;
          }
          .rogue-page .rogue-board {
            max-width: min(100%, calc(100vw - 56px));
            border-radius: 20px;
          }
          .rogue-page .rogue-side-panel {
            gap: 12px;
          }
          .rogue-page .rogue-score-conversion {
            align-items: flex-start;
            flex-direction: column;
          }
          .rogue-page .rogue-score-conversion .text-right {
            text-align: left;
          }
          .rogue-page .rogue-event-modal {
            border-radius: 22px;
            padding: 18px;
          }
          .rogue-page .rogue-modal-snapshot {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .rogue-page .rogue-applied-card {
            align-items: flex-start;
          }
          .rogue-page .rogue-result-stats {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 420px) {
          .rogue-page .rogue-board {
            max-width: min(100%, calc(100vw - 40px));
          }
        }
      `}</style>
      </main>
    </div>
    <CancelConfirmModal
      open={showCancelConfirm}
      loading={loading}
      title="确认放弃星尘迷阵？"
      description="当前探索进度会被取消，本局不会进入结算。"
      detail="已获得的星尘、钥匙、遗物和地图进度都会丢失。"
      onConfirm={() => void confirmCancelGame()}
      onClose={() => setShowCancelConfirm(false)}
    />
    </>
  );
}

function ResultStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="text-xs font-bold text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-black text-slate-900">{value}</div>
    </div>
  );
}

function StatusDock({
  player,
  phase,
  loading,
  status,
  canEscape,
  onStart,
  onCancel,
  onEscape,
}: {
  player: RogueliteStateView['player'] | null;
  phase: Phase;
  loading: boolean;
  status: RogueliteStatus | null;
  canEscape: boolean;
  onStart: () => void;
  onCancel: () => void;
  onEscape: () => void;
}) {
  const phaseText = phase === 'playing' ? '进行中' : phase === 'finished' ? '已结算' : '待开始';

  return (
    <section className="rogue-status-dock">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-black text-white">{phaseText}</span>
          <RelicRibbon player={player} />
        </div>
        <div className="rogue-status-metrics">
          <StatusMetric icon={<Heart className="h-4 w-4" />} label="生命" value={player ? `${safeInteger(player.hp)}/${safeInteger(player.maxHp, 30)}` : '-'} tone="text-rose-600" />
          <StatusMetric icon={<Shield className="h-4 w-4" />} label="护盾" value={safeInteger(player?.shield)} tone="text-sky-600" />
          <StatusMetric icon={<Gem className="h-4 w-4" />} label="星尘" value={safeInteger(player?.stardust)} tone="text-emerald-600" />
          <StatusMetric icon={<Key className="h-4 w-4" />} label="钥匙" value={safeInteger(player?.keys)} tone="text-amber-600" />
          <StatusMetric icon={<Sword className="h-4 w-4" />} label="攻击" value={safeInteger(player?.attack)} tone="text-slate-800" />
          <StatusMetric icon={<DoorOpen className="h-4 w-4" />} label="步数" value={safeInteger(player?.stepsRemaining)} tone="text-emerald-700" />
        </div>
      </div>

      {phase === 'ready' || phase === 'finished' ? (
        <button
          onClick={onStart}
          disabled={loading || status?.inCooldown}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 text-sm font-bold text-white shadow-lg shadow-emerald-200 transition-all hover:-translate-y-0.5 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-700/40 disabled:shadow-none"
          type="button"
        >
          <Sparkles className="h-4 w-4" />
          {status?.inCooldown ? `冷却 ${status.cooldownRemaining}s` : loading ? '处理中' : '开始'}
        </button>
      ) : (
        <div className="flex flex-wrap justify-end gap-2">
          {canEscape && (
            <button
              onClick={onEscape}
              disabled={loading}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 text-sm font-bold text-white shadow-lg shadow-emerald-200 transition-all hover:-translate-y-0.5 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
              type="button"
            >
              <DoorOpen className="h-4 w-4" />
              撤离迷阵
            </button>
          )}
          <button
            onClick={onCancel}
            disabled={loading}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 text-sm font-bold text-slate-500 transition-colors hover:text-slate-900 disabled:opacity-50"
            type="button"
          >
            <X className="h-4 w-4" />
            放弃
          </button>
        </div>
      )}
    </section>
  );
}

function StatusMetric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: ReactNode; tone: string }) {
  return (
    <div className="rogue-metric">
      <div className={`flex items-center gap-1.5 text-xs font-black ${tone}`}>
        {icon}
        {label}
      </div>
      <div className="mt-1 truncate text-lg font-black text-slate-900">{value}</div>
    </div>
  );
}

function RelicRibbon({ player }: { player: RogueliteStateView['player'] | null }) {
  const relics = Array.isArray(player?.relics) ? player.relics : [];
  if (relics.length === 0) {
    return <span className="text-xs font-bold text-slate-400">暂无遗物</span>;
  }

  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {relics.slice(0, 4).map((relic) => (
        <span
          key={relic}
          className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-black text-violet-700 shadow-sm"
          title={safeRelicDescription(relic)}
        >
          <span className="text-amber-500">{safeRelicIcon(relic)}</span>
          {safeRelicLabel(relic)}
        </span>
      ))}
      {relics.length > 4 && (
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-slate-500 shadow-sm">
          +{relics.length - 4}
        </span>
      )}
    </div>
  );
}

function AppliedItemCard({ relic, inModal = false }: { relic?: RogueliteRelicType; inModal?: boolean }) {
  if (!relic) return null;

  return (
    <div className={`rogue-applied-card${inModal ? ' in-modal' : ''}`} aria-live="polite">
      <div className="rogue-applied-icon" aria-hidden>
        {ROGUELITE_RELIC_ICONS[relic]}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-black text-violet-600">获得道具</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <div className="font-black text-slate-950">{ROGUELITE_RELIC_LABELS[relic]}</div>
          <span className="rogue-applied-tag">
            <Sparkles className="h-3 w-3" />
            已生效
          </span>
        </div>
        <div className="mt-1 text-sm font-semibold leading-5 text-slate-500">
          {ROGUELITE_RELIC_DESCRIPTIONS[relic]}
        </div>
      </div>
    </div>
  );
}

function OutcomePulse({ outcome }: { outcome: RogueliteOutcomeView | null }) {
  if (!outcome) return null;

  const deltas = [
    { label: '生命', value: outcome.hpDelta, icon: <Heart className="h-4 w-4" />, tone: outcome.hpDelta >= 0 ? 'text-emerald-600' : 'text-rose-600' },
    { label: '星尘', value: outcome.stardustDelta, icon: <Gem className="h-4 w-4" />, tone: outcome.stardustDelta >= 0 ? 'text-emerald-600' : 'text-amber-600' },
    { label: '钥匙', value: outcome.keyDelta, icon: <Key className="h-4 w-4" />, tone: outcome.keyDelta >= 0 ? 'text-amber-600' : 'text-slate-500' },
    { label: '受伤', value: -outcome.damageTaken, icon: <Zap className="h-4 w-4" />, tone: outcome.damageTaken > 0 ? 'text-rose-600' : 'text-slate-400' },
    { label: '格挡', value: outcome.shieldBlocked, icon: <Shield className="h-4 w-4" />, tone: 'text-sky-600' },
  ].filter((item) => item.value !== 0);

  return (
    <div className="rogue-outcome-strip">
      <div className="mr-1 flex items-center gap-2 text-sm font-bold text-emerald-800">
        <TrendingUp className="h-4 w-4" />
        本步结算
      </div>
      {deltas.length ? (
        deltas.map((delta) => (
          <span key={delta.label} className={`inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-black ${delta.tone}`}>
            {delta.icon}
            {delta.label} {delta.value > 0 ? `+${delta.value}` : delta.value}
          </span>
        ))
      ) : (
        <span className="text-sm font-semibold text-slate-500">没有资源变化，局势保持稳定。</span>
      )}
      <AppliedItemCard relic={outcome.relicGained} />
    </div>
  );
}

function ModalPlayerSnapshot({ player }: { player: RogueliteStateView['player'] }) {
  return (
    <div className="rogue-modal-snapshot" aria-label="当前角色状态">
      <ModalSnapshotMetric
        tone="hp"
        icon={<Heart className="h-3.5 w-3.5 text-rose-500" />}
        label="生命"
        value={`${safeInteger(player.hp)}/${safeInteger(player.maxHp, 30)}`}
      />
      <ModalSnapshotMetric
        tone="shield"
        icon={<Shield className="h-3.5 w-3.5 text-sky-500" />}
        label="护盾"
        value={safeInteger(player.shield)}
      />
      <ModalSnapshotMetric
        tone="attack"
        icon={<Sword className="h-3.5 w-3.5 text-orange-500" />}
        label="攻击"
        value={safeInteger(player.attack)}
      />
      <ModalSnapshotMetric
        tone="stardust"
        icon={<Gem className="h-3.5 w-3.5 text-emerald-500" />}
        label="星尘"
        value={safeInteger(player.stardust)}
      />
    </div>
  );
}

function ModalSnapshotMetric({
  tone,
  icon,
  label,
  value,
}: {
  tone: 'hp' | 'shield' | 'attack' | 'stardust';
  icon: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className={`rogue-modal-stat ${tone}`}>
      <div className="rogue-modal-stat-label">
        {icon}
        {label}
      </div>
      <div className="rogue-modal-stat-value">{value}</div>
    </div>
  );
}

function ScorePreviewPanel({ state }: { state: RogueliteStateView }) {
  const score = getSafeScorePreview(state);
  const finalPoints = calculateRoguelitePointReward(score.total);

  return (
    <div className="rogue-panel rogue-score-panel">
      <div className="mb-4">
        <div className="text-xs font-black uppercase tracking-wider text-emerald-700/80">积分结算</div>
        <div className="mt-1 flex items-end justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-slate-500">当前得分</div>
            <div className="text-3xl font-black text-slate-950">{score.total}</div>
          </div>
          <div className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-black text-white">
            无硬上限
          </div>
        </div>
      </div>

      <div className="rogue-score-conversion">
        <div>
          <div className="text-xs font-black text-emerald-700">最终福利积分</div>
          <div className="mt-1 text-2xl font-black text-slate-950">{finalPoints}</div>
        </div>
        <div className="text-right">
          <div className="text-xs font-bold text-slate-500">换算规则</div>
          <div className="mt-1 text-sm font-black text-emerald-700">{score.total} × 10% = {finalPoints}</div>
        </div>
      </div>

      <p className="mt-3 text-xs font-semibold leading-5 text-slate-500">
        结算时按当前得分的 10% 向下取整计入福利积分，实际到账会受每日游戏积分上限影响。
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <ScoreLine label="层数" value={score.floorPoints} />
        <ScoreLine label="探索" value={score.explorationPoints} />
        <ScoreLine label="战斗" value={score.monsterPoints} />
        <ScoreLine label="星尘" value={score.stardustPoints} />
        <ScoreLine label="生命" value={score.lifePoints} />
        <ScoreLine label="遗物" value={score.relicPoints} />
        <ScoreLine label="宝箱" value={score.chestPoints} />
        <ScoreLine label="撤离" value={score.winBonus} />
      </div>
    </div>
  );
}

function PendingActionModal({
  pending,
  player,
  outcome,
  loading,
  onAction,
  onRecover,
}: {
  pending: RoguelitePendingView;
  player: RogueliteStateView['player'];
  outcome: RogueliteOutcomeView | null;
  loading: boolean;
  onAction: (action: RogueliteAction) => void;
  onRecover: () => void;
}) {
  const appliedItemCard = <AppliedItemCard relic={outcome?.relicGained} inModal />;

  if (pending.type === 'combat') {
    const monster = pending.monster;
    if (!monster) {
      return (
        <PendingSyncFallback
          title="战斗状态同步中"
          message="当前战斗数据不完整，请同步最新迷阵状态后继续。"
          loading={loading}
          onRecover={onRecover}
        />
      );
    }
    return (
      <div className="rogue-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="roguelite-combat-title">
        <div className="rogue-event-modal combat">
          <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-rose-500">
            <Sword className="h-4 w-4" />
            战斗遭遇
          </div>
          <h2 id="roguelite-combat-title" className="text-2xl font-black text-slate-900">{monster.name}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            怪物挡住了路线。选择攻击、防御，或消耗星尘释放星爆。
          </p>
          <ModalPlayerSnapshot player={player} />
          {appliedItemCard}
          <div className="mt-5 grid grid-cols-3 gap-2 text-sm">
            <ScoreLine label="生命" value={safeInteger(monster.hp)} />
            <ScoreLine label="攻击" value={safeInteger(monster.attack)} />
            <ScoreLine label="奖励" value={safeInteger(monster.rewardStardust)} />
          </div>
          <div className="modal-option-grid">
            <ActionButton icon={<Sword className="h-4 w-4" />} label="攻击" disabled={loading} onClick={() => onAction({ type: 'combat', style: 'attack' })} />
            <ActionButton icon={<Shield className="h-4 w-4" />} label="防御" disabled={loading} onClick={() => onAction({ type: 'combat', style: 'guard' })} />
            <ActionButton icon={<Sparkles className="h-4 w-4" />} label="星爆（8 星尘）" disabled={loading || safeNumber(player.stardust) < 8} onClick={() => onAction({ type: 'combat', style: 'skill' })} />
          </div>
        </div>
      </div>
    );
  }

  if (pending.type === 'event') {
    const options = Array.isArray(pending.options) ? pending.options : [];
    if (options.length === 0) {
      return (
        <PendingSyncFallback
          title="事件状态同步中"
          message="当前事件选项缺失，请同步最新迷阵状态后继续。"
          loading={loading}
          onRecover={onRecover}
        />
      );
    }
    return (
      <div className="rogue-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="roguelite-event-title">
        <div className="rogue-event-modal event">
          <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-500">
            <Target className="h-4 w-4" />
            事件
          </div>
          <h2 id="roguelite-event-title" className="text-2xl font-black text-slate-900">星尘抉择</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            选择一个事件效果后继续探索。当前行动会由服务端结算。
          </p>
          <ModalPlayerSnapshot player={player} />
          {appliedItemCard}
          <div className="modal-option-grid">
            {options.map((option) => (
              <button
                key={option.id}
                onClick={() => onAction({ type: 'event', optionId: option.id })}
                disabled={loading}
                className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4 text-left transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-lg hover:shadow-indigo-100 disabled:opacity-50"
                type="button"
              >
                <div className="font-black text-slate-900">{option.label}</div>
                <div className="mt-1 text-sm leading-6 text-slate-500">{option.description}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (pending.type === 'shop') {
    const items = Array.isArray(pending.items) ? pending.items : [];
    return (
      <div className="rogue-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="roguelite-shop-title">
        <div className="rogue-event-modal shop">
          <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-600">
            <ShoppingBag className="h-4 w-4" />
            商店
          </div>
          <h2 id="roguelite-shop-title" className="text-2xl font-black text-slate-900">星灯小铺</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            使用星尘购买补给。买完物品可继续购买，也可以直接离开商店。
          </p>
          <ModalPlayerSnapshot player={player} />
          {appliedItemCard}
          <div className="modal-option-grid">
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => onAction({ type: 'shop', itemId: item.id })}
                disabled={loading || safeNumber(player.stardust) < safeNumber(item.cost)}
                className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 text-left transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-lg hover:shadow-emerald-100 disabled:opacity-50"
                type="button"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-black text-slate-900">{item.label}</span>
                  <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-black text-emerald-700">{item.cost} 星尘</span>
                </div>
                <div className="mt-1 text-sm leading-6 text-slate-500">{item.description}</div>
              </button>
            ))}
            <ActionButton icon={<DoorOpen className="h-4 w-4" />} label="离开商店" disabled={loading} onClick={() => onAction({ type: 'shop', itemId: 'leave' })} />
          </div>
        </div>
      </div>
    );
  }

  const reward = pending.type === 'chest' ? pending.reward : null;
  if (!reward) {
    return (
      <PendingSyncFallback
        title="宝箱状态同步中"
        message="当前宝箱奖励数据缺失，请同步最新迷阵状态后继续。"
        loading={loading}
        onRecover={onRecover}
      />
    );
  }

  return (
    <div className="rogue-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="roguelite-chest-title">
      <div className="rogue-event-modal chest">
        <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-600">
          <PackageOpen className="h-4 w-4" />
          宝箱
        </div>
        <h2 id="roguelite-chest-title" className="text-2xl font-black text-slate-900">星纹宝箱</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          消耗 1 把钥匙，获得 {safeInteger(reward.stardust)} 星尘
          {reward.relic ? ` 与 ${safeRelicLabel(reward.relic)}` : ''}。
        </p>
        <div className="modal-option-grid grid-cols-2">
          <ActionButton icon={<Key className="h-4 w-4" />} label="打开" disabled={loading || safeNumber(player.keys) <= 0} onClick={() => onAction({ type: 'chest', open: true })} />
          <ActionButton icon={<DoorOpen className="h-4 w-4" />} label="跳过" disabled={loading} onClick={() => onAction({ type: 'chest', open: false })} />
        </div>
      </div>
    </div>
  );
}

function PendingSyncFallback({
  title,
  message,
  loading,
  onRecover,
}: {
  title: string;
  message: string;
  loading: boolean;
  onRecover: () => void;
}) {
  return (
    <div className="rogue-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="roguelite-sync-title">
      <div className="rogue-event-modal event">
        <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-600">
          <Sparkles className="h-4 w-4" />
          状态同步
        </div>
        <h2 id="roguelite-sync-title" className="text-2xl font-black text-slate-900">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">{message}</p>
        <button
          onClick={onRecover}
          disabled={loading}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-emerald-200 transition-all hover:-translate-y-0.5 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
        >
          {loading ? '同步中...' : '同步状态'}
        </button>
      </div>
    </div>
  );
}

function RogueliteOutcomeModal({
  state,
  loading,
  onSubmit,
}: {
  state: RogueliteStateView;
  loading: boolean;
  onSubmit: () => void;
}) {
  const won = state.status === 'escaped';
  const scorePreview = getSafeScorePreview(state);
  const score = safeInteger(scorePreview.total);
  const finalPoints = calculateRoguelitePointReward(score);
  const title = won ? '成功撤离星尘迷阵' : '迷阵挑战失败';
  const description = won
    ? '路线已锁定，可以结算本局得分并写入排行榜。'
    : state.defeatedReason ?? '探索记录已经保存，可以结算本局得分。';

  return (
    <div className="rogue-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="roguelite-outcome-title">
      <div className={`rogue-event-modal result ${won ? 'won' : 'lost'}`}>
        <div className="flex flex-col items-center text-center">
          <div className={`rogue-result-icon ${won ? 'won' : 'lost'}`}>
            {won ? <Star className="h-9 w-9 fill-current" /> : <Sword className="h-9 w-9" />}
          </div>
          <div className="mt-5 text-xs font-black uppercase tracking-wider text-emerald-700/80">
            胜负结果
          </div>
          <h2 id="roguelite-outcome-title" className="mt-1 text-2xl font-black text-slate-950">
            {title}
          </h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-slate-600">{description}</p>
        </div>

        <div className="mt-6 rounded-3xl border border-white/70 bg-white/82 p-4 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-black text-slate-400">当前得分</div>
              <div className="mt-1 text-3xl font-black text-slate-950">{score}</div>
            </div>
            <div className="text-right">
              <div className="text-xs font-black text-emerald-700">预计福利积分</div>
              <div className="mt-1 text-2xl font-black text-emerald-700">{finalPoints}</div>
              <div className="text-xs font-bold text-slate-500">{score} × 10%</div>
            </div>
          </div>
        </div>

        <button
          onClick={onSubmit}
          disabled={loading}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-emerald-200 transition-all hover:-translate-y-0.5 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
        >
          <Star className="h-4 w-4 fill-current" />
          {loading ? '结算中' : '结算本局'}
        </button>
      </div>
    </div>
  );
}

function RogueliteSettlementModal({
  result,
  loading,
  status,
  onStart,
}: {
  result: RogueliteGameRecord;
  loading: boolean;
  status: RogueliteStatus | null;
  onStart: () => void;
}) {
  const won = result.won;

  return (
    <div className="rogue-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="roguelite-settlement-title">
      <div className={`rogue-event-modal result ${won ? 'won' : 'lost'}`}>
        <div className="flex flex-col items-center text-center">
          <div className={`rogue-result-icon ${won ? 'won' : 'lost'}`}>
            {won ? <Star className="h-9 w-9 fill-current" /> : <Sword className="h-9 w-9" />}
          </div>
          <div className="mt-5 text-xs font-black uppercase tracking-wider text-emerald-700/80">
            本局结算
          </div>
          <h2 id="roguelite-settlement-title" className="mt-1 text-2xl font-black text-slate-950">
            {won ? '胜利结算完成' : '失败结算完成'}
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            本局得分 {result.score}，按得分 10% 结算，获得 {result.pointsEarned} 福利积分。
          </p>
        </div>

        <div className="mt-5 rounded-2xl border border-emerald-100 bg-white px-5 py-3 text-center text-sm font-black text-emerald-700 shadow-sm">
          最终福利积分 = {result.score} × 10% = {result.pointsEarned}
        </div>

        <div className="rogue-result-stats mt-5">
          <ResultStat label="击败" value={result.monstersDefeated} />
          <ResultStat label="遗物" value={result.relics} />
          <ResultStat label="宝箱" value={result.chestsOpened} />
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
            disabled={loading || Boolean(status?.inCooldown)}
            className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-emerald-200 transition-all hover:-translate-y-0.5 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-700/40"
            type="button"
          >
            <Sparkles className="h-4 w-4" />
            {status?.inCooldown ? `冷却中 ${status.cooldownRemaining}s` : loading ? '处理中' : '再来一局'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ScoreLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2">
      <span className="font-semibold text-slate-500">{label}</span>
      <span className="font-black text-slate-900">{value}</span>
    </div>
  );
}

type RuleTone = 'safe' | 'gain' | 'risk' | 'choice' | 'shop' | 'goal' | 'relic';

function ruleToneClass(tone: RuleTone): string {
  switch (tone) {
    case 'safe':
      return 'border-slate-200 bg-slate-50 text-slate-700';
    case 'gain':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'risk':
      return 'border-rose-200 bg-rose-50 text-rose-700';
    case 'choice':
      return 'border-indigo-200 bg-indigo-50 text-indigo-700';
    case 'shop':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'goal':
      return 'border-cyan-200 bg-cyan-50 text-cyan-700';
    case 'relic':
      return 'border-violet-200 bg-violet-50 text-violet-700';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-700';
  }
}

function RuleBadge({ tone, children }: { tone: RuleTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-black ${ruleToneClass(tone)}`}>
      {children}
    </span>
  );
}

function RulesModal({ onClose }: { onClose: () => void }) {
  const riskRules: Array<{ label: string; tone: RuleTone; description: string }> = [
    { label: '灰色：安全', tone: 'safe', description: '起点、空格、已触发格。通常不会产生新风险，也不会重复发奖励。' },
    { label: '绿色：收益', tone: 'gain', description: '星尘、回复、钥匙等稳定收益，适合在生命不足或需要补资源时优先考虑。' },
    { label: '紫色：构筑', tone: 'relic', description: '遗物和成长类选择，会改变本局规则，是肉鸽构筑的主要来源。' },
    { label: '蓝色：目标', tone: 'goal', description: '星门和路线提示。前三层找星门推进，无尽阶段用撤离结束本局。' },
    { label: '黄色：交易', tone: 'shop', description: '商店和宝箱，需要星尘或钥匙换取更强奖励。' },
    { label: '靛色：抉择', tone: 'choice', description: '事件格会给二选一选择，通常是用生命、星尘或风险换收益。' },
    { label: '红色：危险', tone: 'risk', description: '怪物、Boss、裂隙。奖励更高，但会消耗生命、护盾或战斗资源。' },
  ];

  const cellRules: Array<{ type: RogueliteCellView['type']; name: string; tone: RuleTone; trigger: string; detail: string; tip: string }> = [
    {
      type: 'hidden',
      name: '迷雾',
      tone: 'safe',
      trigger: '尚未进入视野',
      detail: '未照亮区域会用迷雾遮挡，只显示风险未知的占位信息，不暴露真实格子类型。',
      tip: '靠近后才会揭示；走过路线照亮过的视野会永久保留。',
    },
    {
      type: 'start',
      name: '起点',
      tone: 'safe',
      trigger: '每层出生点',
      detail: '每层从世界坐标 0,0 出发。棋盘保持 7×7，玩家始终显示在中心。',
      tip: '默认只照亮中心和周围 8 格，走过路线照亮过的视野不会消失。',
    },
    {
      type: 'empty',
      name: '空格',
      tone: 'safe',
      trigger: '进入后立即结算',
      detail: '没有额外奖励或伤害，只消耗 1 行动步数。已触发过的格子也会变成安全旧格。',
      tip: '空格适合绕开高危区，但步数仍然会减少。',
    },
    {
      type: 'stardust',
      name: '星尘',
      tone: 'gain',
      trigger: '首次进入获得星尘',
      detail: '获得随机数量星尘。星尘可用于商店购买、战斗星爆，也会进入最终得分。',
      tip: '星尘是最通用资源，前期看到低风险微光格通常值得拿。',
    },
    {
      type: 'relic',
      name: '遗物',
      tone: 'relic',
      trigger: '首次进入获得遗物',
      detail: '获得一个本局被动效果。重复获得已有遗物时会转化为星尘补偿。',
      tip: '遗物决定本局打法，例如减伤、加攻击、宝箱增益和星门罗盘。',
    },
    {
      type: 'event',
      name: '事件',
      tone: 'choice',
      trigger: '进入后出现二选一',
      detail: '事件不会自动结算，需要在底部面板选择一个选项。不同事件会交换生命、星尘、钥匙、护盾或成长。',
      tip: '生命充足时可选择高收益代价；濒危时优先保命。',
    },
    {
      type: 'shop',
      name: '商店',
      tone: 'shop',
      trigger: '进入后打开商店',
      detail: '可花星尘购买回复、钥匙、遗物或星图碎片。买完物品会从当前商店移除，也可以直接离开。',
      tip: '商店是稳定补强点，保留一些星尘能显著提高容错。',
    },
    {
      type: 'chest',
      name: '宝箱',
      tone: 'shop',
      trigger: '需要钥匙选择打开',
      detail: '打开消耗 1 把钥匙，获得大量星尘，可能额外获得遗物。没有钥匙时不能打开。',
      tip: '宝箱收益高，钥匙不足时事件和商店都可能补钥匙。',
    },
    {
      type: 'monster',
      name: '怪物',
      tone: 'risk',
      trigger: '进入后进入战斗',
      detail: '怪物会阻挡路线。玩家可攻击、防御，或消耗 8 星尘释放星爆。击败后获得星尘并计入战斗分。',
      tip: '防御能加护盾但输出降低；星爆适合快速处理高血量敌人。',
    },
    {
      type: 'boss',
      name: '守门者',
      tone: 'risk',
      trigger: '通常靠近高层星门',
      detail: 'Boss 型怪物，生命和攻击更高，击败奖励更好。第 3 层及无尽阶段更容易遇到。',
      tip: '遇到守门者前尽量准备护盾、星尘和足够生命。',
    },
    {
      type: 'rift',
      name: '裂隙',
      tone: 'risk',
      trigger: '首次进入立即受伤',
      detail: '造成随机伤害，可能直接导致失败。拥有“裂隙滤镜”遗物时裂隙伤害降低。',
      tip: '高危未知格有概率是裂隙，生命较低时要谨慎踩。',
    },
    {
      type: 'exit',
      name: '星门',
      tone: 'goal',
      trigger: '进入后前往下一层',
      detail: '前三层的核心目标。穿过第 1、2 层星门进入下一层；穿过第 3 层星门后进入无尽星域。',
      tip: '棋盘上方会显示星门方向和距离，星门罗盘可显示精确坐标。',
    },
  ];

  const eventRules: Array<{ name: string; tone: RuleTone; cost: string; reward: string; advice: string }> = [
    {
      name: '折下一枚星钥',
      tone: 'choice',
      cost: '失去 4 生命',
      reward: '获得 1 把钥匙与 8 星尘',
      advice: '适合准备开宝箱，生命紧张时不要硬拿。',
    },
    {
      name: '接受静默祝福',
      tone: 'gain',
      cost: '无直接代价',
      reward: '回复 3 生命，并获得 5 护盾',
      advice: '最稳的保命选项，适合战斗前或裂隙后恢复节奏。',
    },
    {
      name: '解读残破星图',
      tone: 'goal',
      cost: '消耗最多 6 星尘',
      reward: '揭示周围 8 格',
      advice: '适合找星门、避裂隙、规划路线；星尘很少时也能使用。',
    },
    {
      name: '立下晶片誓约',
      tone: 'relic',
      cost: '当前生命 -3',
      reward: '最大生命 +3，攻击 +1',
      advice: '长期收益很强，越早拿越赚；低血量时风险较大。',
    },
    {
      name: '投入星尘赌局',
      tone: 'risk',
      cost: '失去最多 5 星尘',
      reward: '成功获得 16 星尘，失败受到 4 伤害',
      advice: '资源翻盘用，生命和护盾足够时更适合尝试。',
    },
    {
      name: '开启护盾匣',
      tone: 'gain',
      cost: '消耗最多 4 星尘',
      reward: '获得 8 护盾',
      advice: '战斗前很实用，星尘少时也能拿到完整护盾。',
    },
    {
      name: '采摘星尘花',
      tone: 'risk',
      cost: '失去 3 生命',
      reward: '获得 18 星尘',
      advice: '用生命换经济，适合有回复或生命较高时选择。',
    },
    {
      name: '与钥灵交易',
      tone: 'shop',
      cost: '消耗 10 星尘，不足部分失去生命',
      reward: '获得 2 把钥匙',
      advice: '宝箱路线的关键补给，星尘不足时会变成生命换钥匙。',
    },
    {
      name: '淬炼星刃',
      tone: 'relic',
      cost: '消耗 8 星尘，不足部分失去生命',
      reward: '攻击 +2',
      advice: '越早选择越强，适合准备多打怪或进无尽。',
    },
    {
      name: '进入静息星茧',
      tone: 'gain',
      cost: '有钥匙时消耗 1 把钥匙',
      reward: '有钥匙回复 12 生命；没有钥匙回复 4 生命',
      advice: '保命能力很强，但会影响后续开宝箱。',
    },
    {
      name: '点燃时光火花',
      tone: 'choice',
      cost: '失去 2 生命',
      reward: '获得 10 行动步数',
      advice: '适合星门很远或想继续探索时选择。',
    },
    {
      name: '凝视遗物镜',
      tone: 'relic',
      cost: '消耗 10 星尘，不足部分失去生命',
      reward: '获得 1 个随机遗物；重复遗物会转化为星尘',
      advice: '构筑型事件，星尘富余时优先级很高。',
    },
    {
      name: '校准裂隙测仪',
      tone: 'choice',
      cost: '受到 2 伤害',
      reward: '获得 4 护盾，并揭示周围格子',
      advice: '侦察和防御兼顾，低血量时要小心。',
    },
    {
      name: '献出星核余温',
      tone: 'risk',
      cost: '最大生命 -2',
      reward: '获得 1 钥匙、6 护盾与 10 星尘',
      advice: '短期收益很高，但会永久降低本局生命上限。',
    },
    {
      name: '释放罗盘脉冲',
      tone: 'goal',
      cost: '消耗最多 4 星尘',
      reward: '揭示周围格子，并获得 6 行动步数',
      advice: '找星门和绕危险格都很好用。',
    },
  ];

  const relicRules = (Object.keys(ROGUELITE_RELIC_LABELS) as RogueliteRelicType[]).map((relic) => ({
    id: relic,
    icon: ROGUELITE_RELIC_ICONS[relic],
    name: ROGUELITE_RELIC_LABELS[relic],
    effect: ROGUELITE_RELIC_DESCRIPTIONS[relic],
  }));

  const flowRules: Array<{ title: string; tone: RuleTone; items: string[] }> = [
    {
      title: '移动与揭示',
      tone: 'safe',
      items: [
        '只能走上下左右相邻格，不能斜走。',
        '每次移动消耗 1 行动步数。',
        '棋盘大小固定为 7×7，未照亮区域会被迷雾遮挡。',
        '默认视野只有玩家中心格与周围 8 格。',
        '走过路线照亮过的视野会保留，不会因为离开而重新变暗。',
        '拥有“星辉透镜”后，当前视野扩大一圈，可照亮外圈 16 格。',
        '同一个世界坐标只触发一次奖励或事件。',
      ],
    },
    {
      title: '战斗操作',
      tone: 'risk',
      items: [
        '攻击：造成基础伤害，怪物未死会反击。',
        '防御：获得 5 护盾，本回合伤害降低。',
        '星爆：消耗 8 星尘，造成高额伤害。',
      ],
    },
    {
      title: '无尽与撤离',
      tone: 'goal',
      items: [
        '穿过第 3 层星门后不会立刻结束。',
        '无尽阶段可以继续探索、战斗、收集星尘。',
        '点击“撤离迷阵”后，本局结束并允许结算。',
      ],
    },
    {
      title: '失败与得分',
      tone: 'shop',
      items: [
        '生命归零或步数耗尽会失败。',
        '得分来自层数、探索、怪物、星尘、生命、遗物、宝箱和撤离奖励。',
        '最终福利积分按本局得分 10% 向下取整发放，实际到账会受每日游戏积分上限影响。',
      ],
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="roguelite-rules-title"
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-5xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl shadow-slate-900/20 sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-cyan-50 px-3 py-1 text-xs font-black text-cyan-700">
              <BookOpen className="h-4 w-4" />
              玩法说明
            </div>
            <h2 id="roguelite-rules-title" className="text-2xl font-black text-slate-900">
              星尘迷阵规则
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              用颜色先判断风险，再决定路线。绿色和紫色偏收益，红色偏危险，蓝色代表目标推进。
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-slate-200 text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-900"
            type="button"
            aria-label="关闭规则"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <section className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
          <h3 className="mb-3 text-base font-black text-slate-900">颜色标准</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {riskRules.map((rule) => (
              <div key={rule.label} className={`rounded-2xl border p-3 ${ruleToneClass(rule.tone)}`}>
                <div className="text-sm font-black">{rule.label}</div>
                <p className="mt-1 text-xs leading-5 opacity-80">{rule.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-4">
          <h3 className="mb-3 text-base font-black text-slate-900">格子详解</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {cellRules.map((cell) => (
              <article key={cell.name} className={`rounded-2xl border p-4 ${ruleToneClass(cell.tone)}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="h-12 w-12 flex-none rounded-2xl bg-white/70 bg-contain bg-center bg-no-repeat shadow-sm"
                      style={{ backgroundImage: `url(${ROGUELITE_CELL_ART[cell.type]})` }}
                      aria-hidden
                    >
                      <span className="sr-only">{cell.name}</span>
                    </span>
                    <div>
                      <h4 className="font-black">{cell.name}</h4>
                      <p className="text-xs font-bold opacity-75">{cell.trigger}</p>
                    </div>
                  </div>
                  <RuleBadge tone={cell.tone}>{cell.tone === 'risk' ? '危险' : cell.tone === 'goal' ? '目标' : cell.tone === 'shop' ? '交易' : cell.tone === 'relic' ? '构筑' : cell.tone === 'gain' ? '收益' : '安全'}</RuleBadge>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-700">{cell.detail}</p>
                <p className="mt-2 rounded-xl bg-white/70 px-3 py-2 text-xs leading-5 text-slate-500">{cell.tip}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-violet-100 bg-violet-50/40 p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-black text-slate-900">遗物图鉴</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                遗物会在本局持续生效，可通过遗物格、商店、宝箱或遗物镜获得；重复遗物会转化为星尘。
              </p>
            </div>
            <RuleBadge tone="relic">共 {relicRules.length} 件</RuleBadge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {relicRules.map((relic) => (
              <article key={relic.id} className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-2xl bg-violet-50 text-xl font-black text-violet-700">
                    {relic.icon}
                  </span>
                  <div>
                    <h4 className="font-black text-slate-900">{relic.name}</h4>
                    <p className="mt-1 text-xs font-bold text-violet-500">遗物功能</p>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">{relic.effect}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-4">
          <h3 className="mb-3 text-base font-black text-slate-900">事件详解</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {eventRules.map((event) => (
              <article key={event.name} className={`rounded-2xl border p-4 ${ruleToneClass(event.tone)}`}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h4 className="font-black">{event.name}</h4>
                  <RuleBadge tone={event.tone}>{event.tone === 'risk' ? '高风险' : event.tone === 'gain' ? '稳收益' : event.tone === 'goal' ? '侦察' : event.tone === 'relic' ? '成长' : '抉择'}</RuleBadge>
                </div>
                <div className="grid gap-2 text-sm">
                  <div className="rounded-xl bg-white/70 px-3 py-2">
                    <span className="font-black">代价：</span>{event.cost}
                  </div>
                  <div className="rounded-xl bg-white/70 px-3 py-2">
                    <span className="font-black">收益：</span>{event.reward}
                  </div>
                  <div className="rounded-xl bg-white/70 px-3 py-2 text-slate-600">
                    <span className="font-black">建议：</span>{event.advice}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-4">
          <h3 className="mb-3 text-base font-black text-slate-900">流程规则</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {flowRules.map((flow) => (
              <article key={flow.title} className={`rounded-2xl border p-4 ${ruleToneClass(flow.tone)}`}>
                <h4 className="mb-3 font-black">{flow.title}</h4>
                <ul className="space-y-2 text-sm leading-6 text-slate-700">
                  {flow.items.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-current opacity-70" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <button
          onClick={onClose}
          className="mt-5 flex w-full items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-slate-800"
          type="button"
        >
          明白了
        </button>
      </div>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}
