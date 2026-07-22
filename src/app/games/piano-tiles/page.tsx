'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Crown,
  Gauge,
  ListMusic,
  Loader2,
  Music,
  Pause,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  Star,
  Timer,
  Trophy,
  X,
  Zap,
} from 'lucide-react';
import { ResultCard } from '../_components';
import { CancelConfirmModal } from '../_components/CancelConfirmModal';
import { fetchGameRequest, gameRequestErrorMessage } from '../_lib/request';
import { fetchChart, fetchManifest, PianoSampler } from '@/lib/piano-tiles/audio';
import {
  createEngine,
  HOLD_BONUS_MAX,
  LAP_SPEED_STEP,
  MAX_SPEED_MULTIPLIER,
  MAX_CROWNS,
  RUSH_DURATION_MS,
  VIEW_UNITS,
  type EngineResult,
  type PianoTilesEngine,
  type Tile,
} from '@/lib/piano-tiles/engine';
import type {
  AccompanimentNote,
  ChartManifest,
  ChartManifestEntry,
  CompiledChart,
  PianoTilesMode,
} from '@/lib/piano-tiles/types';
import {
  clearPendingPianoTilesSubmission,
  isPianoCheckpointRetryPrefix,
  readPendingPianoTilesSubmission,
  resolvePianoHoldBonus,
  savePendingPianoTilesSubmission,
  type PersistedPianoTilesSubmission,
  type PianoTilesEvent,
  type PianoTilesSubmitPayload,
} from '@/lib/piano-tiles/session';

// ──────────────────────────────────────────────────
// 常量（视觉尺寸对齐钢琴块2：720×1280 竖屏设计分辨率）
// ──────────────────────────────────────────────────

const LANE_COUNT = 4;
/** 设计分辨率（钢琴块2 为 9:16 竖屏）。 */
const DESIGN_W = 720;
const DESIGN_H = 1280;
/** 玩家点快时相机加速追块的阈值：下一块高于屏幕 60% 即追。 */
const CATCH_UP_RATIO = 0.6;
/** 已击中音块的灰色残影停留时长。 */
const HIT_FADE_MS = 600;
const CHECKPOINT_INTERVAL_MS = 5000;
/** 可见页面主线程长时间无帧时，冻结本局并交给玩家主动恢复。 */
const FRAME_STALL_PAUSE_MS = 1500;
const FAIL_FLASH_MS = 900;
/** 单次请求上限，避免断网长局恢复时生成超大 JSON。 */
const MAX_CHECKPOINT_EVENTS = 2048;

const API_BASE = '/api/games/piano-tiles';

/** 长按块星光闪烁用的确定性 hash（按粒子序号+时间片取样，避免逐帧乱闪）。 */
function hash32(n: number): number {
  let v = n | 0;
  v = Math.imul(v ^ (v >>> 15), 2246822519);
  v = Math.imul(v ^ (v >>> 13), 3266489917);
  return (v ^ (v >>> 16)) >>> 0;
}

function getPianoSessionStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

type Phase = 'mode-select' | 'song-select' | 'loading' | 'playing' | 'submitting' | 'finished';

type HitEvent = PianoTilesEvent;

interface SessionInfo {
  sessionId: string;
}

const CHECKPOINT_HEARTBEAT_MS = 5 * 60 * 1000;

interface RunState {
  started: boolean;
  cameraMs: number;
  lastFrame: number;
  wallStart: number;
  wallElapsed: number;
  holding: boolean;
  /** 正在长按的块（用于结束后生成灰色残影）。 */
  activeHold: Tile | null;
  accIndex: number;
  accLap: number;
  failFlash: null | { lane: number; tileTop: number; tileH: number; at: number };
  /** 已击中的音块：变灰并随画面继续滚出（原作手感）。 */
  hitFades: Array<{ tile: Tile; at: number }>;
}

function freshRunState(): RunState {
  return {
    started: false,
    cameraMs: 0, // 加载谱面后定位到「开始」块
    lastFrame: 0,
    wallStart: 0,
    wallElapsed: 0,
    holding: false,
    activeHold: null,
    accIndex: 0,
    accLap: 0,
    failFlash: null,
    hitFades: [],
  };
}

/** 状态坞展示的局内数据（得分等 HUD 已移出游戏区域）。 */
interface HudState {
  started: boolean;
  score: number;
  crowns: number;
  laps: number;
  /** 限时模式剩余秒数；经典模式为 null。 */
  rushLeftSec: number | null;
}

const HUD_IDLE: HudState = { started: false, score: 0, crowns: 0, laps: 0, rushLeftSec: null };

const MODE_META: Record<
  PianoTilesMode,
  {
    label: string;
    icon: ReactNode;
    toneClass: string;
    durationPill: string;
    summary: string;
    stats: Array<{ name: string; value: string }>;
  }
> = {
  classic: {
    label: '经典模式',
    icon: <Music />,
    toneClass: 'classic',
    durationPill: '无限循环',
    summary: '跟随旋律无限演奏，点错或漏块即结束本局。',
    stats: [
      { name: '计分', value: '每块 +1 · 长按至多 +3' },
      { name: '皇冠', value: `每圈 1 顶 · 最多 ${MAX_CROWNS} 顶` },
      { name: '节奏', value: `每圈提速 ${Math.round(LAP_SPEED_STEP * 100)}%` },
    ],
  },
  rush: {
    label: '限时冲刺',
    icon: <Zap />,
    toneClass: 'rush',
    durationPill: `${Math.round(RUSH_DURATION_MS / 1000)} 秒`,
    summary: '60 秒极限冲分，时间到自动结算成绩。',
    stats: [
      { name: '时限', value: `${Math.round(RUSH_DURATION_MS / 1000)} 秒到时自动结算` },
      { name: '判定', value: '与经典一致 · 失误即结束' },
      { name: '计分', value: '每块 +1 · 长按至多 +3' },
    ],
  },
};

export default function PianoTilesPage() {
  const [phase, setPhase] = useState<Phase>('mode-select');
  const [manifest, setManifest] = useState<ChartManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [starFilter, setStarFilter] = useState(0);
  const [mode, setMode] = useState<PianoTilesMode>('classic');
  const [selected, setSelected] = useState<ChartManifestEntry | null>(null);
  const [loadProgress, setLoadProgress] = useState(0);
  const [result, setResult] = useState<EngineResult | null>(null);
  const [awardedPoints, setAwardedPoints] = useState<number | null>(null);
  const [submitNotice, setSubmitNotice] = useState<string | null>(null);
  const [checkpointNotice, setCheckpointNotice] = useState<string | null>(null);
  const [hasPendingSubmission, setHasPendingSubmission] = useState(false);
  const [networkOffline, setNetworkOffline] = useState(
    () => typeof navigator !== 'undefined' && navigator.onLine === false,
  );
  const [hud, setHud] = useState<HudState>(HUD_IDLE);
  const [paused, setPaused] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<PianoTilesEngine | null>(null);
  const chartRef = useRef<CompiledChart | null>(null);
  const samplerRef = useRef<PianoSampler | null>(null);
  const sessionRef = useRef<SessionInfo | null>(null);
  const rafRef = useRef<number>(0);
  const pendingEventsRef = useRef<HitEvent[]>([]);
  const confirmedEventCountRef = useRef(0);
  const activeHoldEventRef = useRef<{ event: HitEvent; scoreAfterHit: number } | null>(null);
  /** 当前长按所属的指针；多指场景下不能由其他指针的 pointerup 结束长按。 */
  const activeHoldPointerIdRef = useRef<number | null>(null);
  const checkpointTimerRef = useRef<number | null>(null);
  const checkpointChainRef = useRef<Promise<void>>(Promise.resolve());
  const checkpointBlockedRef = useRef(false);
  const lastCheckpointAtRef = useRef(0);
  const checkpointTaskIdRef = useRef(0);
  const lastHeartbeatAttemptAtRef = useRef(0);
  const checkpointRetryRef = useRef<{
    sessionId: string;
    eventOffset: number;
    events: HitEvent[];
  } | null>(null);
  const submittedRef = useRef(false);
  const submitInFlightRef = useRef(false);
  const startInFlightRef = useRef(false);
  const pendingSubmissionRef = useRef<PersistedPianoTilesSubmission | null>(null);
  const modeRef = useRef<PianoTilesMode>('classic');
  const runRef = useRef<RunState>(freshRunState());
  const hudRef = useRef<HudState>(HUD_IDLE);
  const pausedRef = useRef(false);
  const rulesHadPauseRef = useRef(false);
  const cancelHadPauseRef = useRef(false);

  // ── 初始化 ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let restored: PersistedPianoTilesSubmission | null = null;
      try {
        restored = readPendingPianoTilesSubmission(getPianoSessionStorage());
      } catch {
        // 某些隐私模式会禁止 sessionStorage，继续使用内存恢复流程。
      }
      if (restored) {
        pendingSubmissionRef.current = restored;
        sessionRef.current = { sessionId: restored.payload.sessionId };
        pendingEventsRef.current = restored.payload.events.map((event) => ({ ...event }));
        confirmedEventCountRef.current = restored.payload.eventOffset;
        submittedRef.current = true;
        modeRef.current = restored.mode;
        setMode(restored.mode);
        setSelected(restored.selected);
        setResult(restored.result);
        setHud({
          started: true,
          score: restored.result.score,
          crowns: restored.result.crowns,
          laps: restored.result.laps,
          rushLeftSec: restored.result.status === 'timeup' ? 0 : null,
        });
        hudRef.current = {
          started: true,
          score: restored.result.score,
          crowns: restored.result.crowns,
          laps: restored.result.laps,
          rushLeftSec: restored.result.status === 'timeup' ? 0 : null,
        };
        setHasPendingSubmission(true);
        setSubmitNotice('检测到上次尚未完成的结算，请点击“重试结算”');
        setPhase('finished');
      } else {
        try {
          clearPendingPianoTilesSubmission(getPianoSessionStorage());
        } catch {
          // 忽略存储不可用。
        }
      }

      try {
        const m = await fetchManifest();
        if (!cancelled) setManifest(m);
      } catch (err) {
        if (!cancelled) setError(gameRequestErrorMessage(err, '加载曲目清单超时', '加载曲目清单失败'));
      }
      // 清理残留会话：演奏中刷新/关闭页面会留下未结束的对局，后端会拒绝新开局。
      // 已有终局提交包时必须保留会话供幂等重试；只有无法恢复的中途对局才取消。
      if (restored) return;
      try {
        const res = await fetchGameRequest(`${API_BASE}/status`);
        const data = await res.json().catch(() => null);
        const staleSessionId = data?.data?.activeSession?.sessionId;
        if (
          !cancelled &&
          !sessionRef.current &&
          res.ok &&
          typeof staleSessionId === 'string' &&
          staleSessionId
        ) {
          await fetchGameRequest(`${API_BASE}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: staleSessionId }),
          });
        }
      } catch {
        // 未登录或网络异常时忽略；若仍有残留会话，开局时会收到明确错误
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (checkpointTimerRef.current !== null) window.clearInterval(checkpointTimerRef.current);
      void samplerRef.current?.dispose();
    };
  }, []);

  const filteredCharts = useMemo(() => {
    if (!manifest) return [];
    const q = search.trim().toLowerCase();
    return manifest.charts.filter(
      (c) =>
        (starFilter === 0 || c.stars === starFilter) &&
        (!q || c.title.toLowerCase().includes(q) || c.artist.toLowerCase().includes(q)),
    );
  }, [manifest, search, starFilter]);

  const syncHud = useCallback(
    (score: number, crowns: number, laps: number, rushLeftSec: number | null, started: boolean) => {
      const prev = hudRef.current;
      if (
        prev.score === score &&
        prev.crowns === crowns &&
        prev.laps === laps &&
        prev.rushLeftSec === rushLeftSec &&
        prev.started === started
      ) {
        return;
      }
      const next: HudState = { score, crowns, laps, rushLeftSec, started };
      hudRef.current = next;
      setHud(next);
    },
    [],
  );

  // ── checkpoint / 结算 ───────────────────────────
  const finalizeActiveHold = useCallback((engine: PianoTilesEngine, explicitBonus?: number) => {
    const active = activeHoldEventRef.current;
    if (!active) return;
    const inferredBonus = engine.score - active.scoreAfterHit;
    // 长按可能在 tick 内刚好自动划满，此时 engine.release() 因内部
    // hold 已清空会返回 0；必须以引擎实际增加的分数兜底。
    const bonus = resolvePianoHoldBonus(explicitBonus, inferredBonus);
    active.event.b = bonus;
    pendingEventsRef.current.push(active.event);
    activeHoldEventRef.current = null;
    activeHoldPointerIdRef.current = null;
  }, []);

  const checkpointScheduledRef = useRef(false);
  const flushCheckpoint = useCallback((force = false) => {
    const session = sessionRef.current;
    if (!session || checkpointBlockedRef.current) return Promise.resolve();
    if (checkpointScheduledRef.current) return checkpointChainRef.current;

    const sessionId = session.sessionId;
    const retry = checkpointRetryRef.current;
    const retryIsPrefix = Boolean(
      retry &&
      retry.sessionId === sessionId &&
      retry.eventOffset === confirmedEventCountRef.current &&
      isPianoCheckpointRetryPrefix(retry.events, pendingEventsRef.current),
    );
    if (retry && !retryIsPrefix) checkpointRetryRef.current = null;
    const eventOffset = retryIsPrefix ? retry!.eventOffset : confirmedEventCountRef.current;
    // 网络响应丢失后优先重发完全相同的上一批，触发服务端幂等 receipt；
    // 不能把新事件拼进旧批次，否则服务端无法判断哪些事件已经落库。
    const batch = retryIsPrefix
      ? retry!.events.slice()
      : pendingEventsRef.current.slice(0, MAX_CHECKPOINT_EVENTS);
    if (batch.length === 0 && !force) return Promise.resolve();
    if (batch.length === 0) lastHeartbeatAttemptAtRef.current = Date.now();
    checkpointScheduledRef.current = true;
    const taskId = ++checkpointTaskIdRef.current;

    checkpointChainRef.current = checkpointChainRef.current
      .catch(() => undefined)
      .then(async () => {
        // 任务入队后如果用户取消/重开了另一局，旧请求不得触碰新会话的队列。
        if (sessionRef.current?.sessionId !== sessionId) return;
        try {
          const response = await fetchGameRequest(`${API_BASE}/checkpoint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, eventOffset, events: batch }),
          });
          const data = await response.json().catch(() => null);
          if (sessionRef.current?.sessionId !== sessionId) return;
          if (response.ok) {
            const hasEventCount = Number.isInteger(data?.data?.eventCount);
            const hasAcceptedEvents = Number.isInteger(data?.data?.acceptedEvents);
            if (!data?.success || (!hasEventCount && !hasAcceptedEvents)) {
              checkpointRetryRef.current = batch.length > 0
                ? { sessionId, eventOffset, events: batch.slice() }
                : null;
              setCheckpointNotice('服务端未确认本批进度，事件已保留并会重试');
              return;
            }
            const reportedCount = hasEventCount
              ? data.data.eventCount
              : eventOffset + data.data.acceptedEvents;
            const accepted = reportedCount - eventOffset;
            if (
              reportedCount < eventOffset ||
              accepted < 0 ||
              accepted > batch.length ||
              confirmedEventCountRef.current !== eventOffset
            ) {
              checkpointBlockedRef.current = true;
              setCheckpointNotice('进度同步发生冲突，本局事件将保留到最终结算时再次校验');
              return;
            }
            confirmedEventCountRef.current = reportedCount;
            // pending 队列始终保留在途事件；成功后仅释放本批前缀，
            // 因此在网络响应丢失或页面刷新时不会丢掉任何尾部事件。
            pendingEventsRef.current = pendingEventsRef.current.slice(accepted);
            checkpointRetryRef.current = null;
            lastCheckpointAtRef.current = Date.now();
            setCheckpointNotice(null);
          } else if (response.status >= 500 || response.status === 408 || response.status === 429) {
            checkpointRetryRef.current = batch.length > 0
              ? { sessionId, eventOffset, events: batch.slice() }
              : null;
            setCheckpointNotice('网络暂时不可用，已保留未同步事件，联网后会自动重试');
          } else {
            // 4xx（尤其 409）是确定性历史冲突，不在定时器中无限重试；
            // 未确认事件仍留在队列，submit 会携带 offset 进行最终对账。
            checkpointBlockedRef.current = true;
            setCheckpointNotice(data?.message ?? '进度同步被服务端拒绝，本局事件已保留');
          }
        } catch {
          if (sessionRef.current?.sessionId !== sessionId) return;
          checkpointRetryRef.current = batch.length > 0
            ? { sessionId, eventOffset, events: batch.slice() }
            : null;
          setCheckpointNotice('网络暂时不可用，已保留未同步事件，联网后会自动重试');
        }
      })
      .finally(() => {
        if (checkpointTaskIdRef.current === taskId) {
          checkpointScheduledRef.current = false;
          // 已完成的 Promise 不再串到下一批，避免超长局累积 Promise 链。
          checkpointChainRef.current = Promise.resolve();
        }
      });
    return checkpointChainRef.current;
  }, []);

  const persistLatestSubmission = useCallback(() => {
    const pending = pendingSubmissionRef.current;
    if (!pending) return null;
    pending.payload.eventOffset = confirmedEventCountRef.current;
    pending.payload.events = pendingEventsRef.current.slice();
    savePendingPianoTilesSubmission(getPianoSessionStorage(), pending);
    return pending;
  }, []);

  const submitPendingResult = useCallback(async () => {
    let pending = pendingSubmissionRef.current;
    if (!pending || submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setPhase('submitting');
    setSubmitNotice(null);
    try {
      // 断网长局可能积累大量尾事件。先按 checkpoint 上限分批排空，
      // 只把最后不超过上限的一批交给 submit，避免超大请求和服务端内存尖峰。
      let remainingDrainAttempts = Math.ceil(pendingEventsRef.current.length / MAX_CHECKPOINT_EVENTS) + 2;
      while (pendingEventsRef.current.length > MAX_CHECKPOINT_EVENTS && remainingDrainAttempts > 0) {
        remainingDrainAttempts -= 1;
        const beforeLength = pendingEventsRef.current.length;
        const retryBefore = checkpointRetryRef.current;
        await flushCheckpoint();
        pending = persistLatestSubmission() ?? pending;
        if (pendingEventsRef.current.length < beforeLength) continue;
        if (retryBefore?.events.length === 0 && checkpointRetryRef.current === null) continue;
        setSubmitNotice('仍有较多事件等待同步，提交包已保留；请检查网络后重试结算');
        setPhase('finished');
        return;
      }
      pending = persistLatestSubmission() ?? pending;
      if (pending.payload.events.length > MAX_CHECKPOINT_EVENTS) {
        setSubmitNotice('事件同步尚未完成，提交包已保留；请稍后重试结算');
        setPhase('finished');
        return;
      }
      const res = await fetchGameRequest(`${API_BASE}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending.payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        if (res.status === 409) {
          setSubmitNotice('结算校验发生冲突，提交包已保留；请联网后再次点击“重试结算”');
        } else {
          setSubmitNotice(data?.message ?? `结算失败（HTTP ${res.status}），提交包已保留`);
        }
        setPhase('finished');
        return;
      }
      setAwardedPoints(data?.data?.pointsAwarded ?? null);
      setSubmitNotice(null);
      clearPendingPianoTilesSubmission(getPianoSessionStorage());
      pendingSubmissionRef.current = null;
      pendingEventsRef.current = [];
      sessionRef.current = null;
      setHasPendingSubmission(false);
      setPhase('finished');
    } catch (err) {
      setSubmitNotice(gameRequestErrorMessage(err, '结算请求超时，提交包已保留，请检查网络后重试', '结算失败，提交包已保留，请稍后重试'));
      setPhase('finished');
    } finally {
      submitInFlightRef.current = false;
    }
  }, [flushCheckpoint, persistLatestSubmission]);

  const finishGame = useCallback(
    async (engine: PianoTilesEngine) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      cancelAnimationFrame(rafRef.current);
      if (checkpointTimerRef.current !== null) {
        window.clearInterval(checkpointTimerRef.current);
        checkpointTimerRef.current = null;
      }
      // timeup / 漏块可能在长按自动结束的同一帧发生，先把最终奖励写入事件流。
      if (activeHoldEventRef.current) {
        const bonus = engine.release(runRef.current.cameraMs);
        finalizeActiveHold(engine, bonus);
      }
      activeHoldPointerIdRef.current = null;
      const finalResult = engine.result();
      const playedMs =
        finalResult.mode === 'rush' && finalResult.status === 'timeup'
          ? RUSH_DURATION_MS
          : Math.round(runRef.current.wallElapsed);
      const session = sessionRef.current;
      setResult(finalResult);
      syncHud(finalResult.score, finalResult.crowns, finalResult.laps, hudRef.current.rushLeftSec, true);
      const sampler = samplerRef.current;
      if (finalResult.status === 'failed') sampler?.playSfx('result-fail');
      else sampler?.playSfx('result-pass');

      if (!session || !selected) {
        setPhase('finished');
        return;
      }
      const payload: PianoTilesSubmitPayload = {
        sessionId: session.sessionId,
        eventOffset: confirmedEventCountRef.current,
        result: {
          status: finalResult.status,
          score: finalResult.score,
          tilesHit: finalResult.tilesHit,
          crowns: finalResult.crowns,
          laps: finalResult.laps,
          playedMs,
        },
        // 仅提交尚未被 checkpoint 确认的尾部；服务端允许在途批次重叠对账。
        events: pendingEventsRef.current.slice(),
      };
      const persisted: PersistedPianoTilesSubmission = {
        version: 1,
        createdAt: Date.now(),
        mode: finalResult.mode,
        selected,
        result: finalResult,
        payload,
      };
      pendingSubmissionRef.current = persisted;
      setHasPendingSubmission(true);
      // 先落盘，再等待可能在途的 checkpoint，避免页面在等待期间刷新导致终局包丢失。
      savePendingPianoTilesSubmission(getPianoSessionStorage(), persisted);
      setPhase('submitting');
      await checkpointChainRef.current.catch(() => undefined);
      // 在途 checkpoint 成功后释放已确认前缀，更新最终提交包；若网络失败，
      // offset 与尾事件保持原样，服务端会按幂等规则处理重叠批次。
      persistLatestSubmission();
      await submitPendingResult();
    },
    [finalizeActiveHold, persistLatestSubmission, selected, submitPendingResult, syncHud],
  );

  /** 冻结一局正在进行的演奏；返回是否确实从运行态进入了暂停态。 */
  const pauseActiveRun = useCallback(() => {
    const run = runRef.current;
    const engine = engineRef.current;
    if (pausedRef.current || !engine) return false;
    if (engine.status !== 'running' || !run.started || run.failFlash) return false;
    pausedRef.current = true;
    setPaused(true);
    cancelAnimationFrame(rafRef.current);
    // 暂停覆盖层会拦截 pointerup，先按当前进度结算长按，避免恢复后悬空按住。
    if (run.holding) {
      const bonus = engine.release(run.cameraMs);
      finalizeActiveHold(engine, bonus);
      run.holding = false;
    }
    activeHoldPointerIdRef.current = null;
    void samplerRef.current?.suspend();
    return true;
  }, [finalizeActiveHold]);

  const pauseForFrameStall = useCallback(() => {
    if (!pauseActiveRun()) return false;
    setCheckpointNotice('检测到设备长时间卡顿，游戏已自动暂停；继续后不会计入卡顿时间');
    void flushCheckpoint(true);
    return true;
  }, [flushCheckpoint, pauseActiveRun]);

  // ── 渲染（钢琴块2 风格：白底、灰分隔线、黑块；分数等 HUD 移至游戏区域外） ──
  const renderFrame = useCallback(
    (frameTime: number) => {
      if (pausedRef.current) return;
      const canvas = canvasRef.current;
      const engine = engineRef.current;
      const chart = chartRef.current;
      if (!canvas || !engine || !chart) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const run = runRef.current;
      const { width: W, height: H } = canvas;
      const s = W / DESIGN_W;
      const laneW = W / LANE_COUNT;
      const viewMs = engine.viewWindowMs();
      const pxPerMs = H / viewMs;

      // ── 相机推进 ──
      const frameGap = run.lastFrame > 0 ? frameTime - run.lastFrame : 0;
      if (
        frameGap > FRAME_STALL_PAUSE_MS &&
        run.started &&
        engine.status === 'running' &&
        pauseForFrameStall()
      ) {
        return;
      }
      const dt = Math.min(50, frameGap);
      run.lastFrame = frameTime;
      if (run.started && engine.status === 'running') {
        run.wallElapsed = frameTime - run.wallStart;
        // rush 到点优先级高于本帧的相机推进和漏块判定，避免 60 秒边界
        // 因同帧漏块被错误结算为 failed。
        if (modeRef.current === 'rush' && run.wallElapsed >= RUSH_DURATION_MS) {
          engine.timeUp();
          const timedOut = engine.result();
          syncHud(timedOut.score, timedOut.crowns, timedOut.laps, 0, true);
          void finishGame(engine);
          return;
        }
        run.cameraMs += dt * engine.speedMultiplier();
        // 玩家点快时相机加速追块；长按期间禁用（否则会瞬间划过长按块体），
        // 且追赶速度封顶为常速 3 倍，避免"跳过"式突进
        const next = engine.nextTile();
        if (next && !engine.holdState(run.cameraMs)) {
          const ahead = next.t - run.cameraMs;
          const threshold = viewMs * CATCH_UP_RATIO;
          if (ahead > threshold) {
            const step = (ahead - threshold) * Math.min(1, dt / 110);
            run.cameraMs += Math.min(step, dt * engine.speedMultiplier() * 3);
          }
        }
        // 伴奏跟随相机进度播放（跨圈循环）
        const lapMs = engine.lapDurationMs();
        const acc: AccompanimentNote[] = chart.accompaniment;
        let guard = 0;
        while (acc.length > 0 && guard < 64) {
          const note = acc[run.accIndex];
          const noteTime = note.t + run.accLap * lapMs;
          if (noteTime > run.cameraMs) break;
          samplerRef.current?.playPitches(note.pitches, note.instrument, 0.45);
          run.accIndex += 1;
          if (run.accIndex >= acc.length) {
            run.accIndex = 0;
            run.accLap += 1;
          }
          guard += 1;
        }
        // 漏块检查
        if (engine.tick(run.cameraMs)) {
          // tick 可能在同一帧结束长按并判定下一块漏掉，先落盘长按奖励，
          // 再追加 terminal 漏块事件，保证事件时间与分数顺序一致。
          if (activeHoldEventRef.current) {
            const bonus = engine.release(run.cameraMs);
            finalizeActiveHold(engine, bonus);
            run.holding = false;
          }
          const missed = engine.nextTile();
          if (missed) {
            const event = {
              t: Math.round(run.wallElapsed),
              lane: missed.lane,
              j: 'm' as const,
              b: 0,
            };
            pendingEventsRef.current.push(event);
            const tileH = missed.d * pxPerMs;
            run.failFlash = {
              lane: missed.lane,
              tileTop: H - (missed.t - run.cameraMs) * pxPerMs - tileH,
              tileH,
              at: frameTime,
            };
          }
        }
      }
      const camera = run.cameraMs;

      // ── 背景与轨道线 ──
      ctx.fillStyle = '#fbfbfd';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#dcdfe8';
      ctx.lineWidth = Math.max(1, 2 * s);
      for (let i = 1; i < LANE_COUNT; i += 1) {
        ctx.beginPath();
        ctx.moveTo(i * laneW, 0);
        ctx.lineTo(i * laneW, H);
        ctx.stroke();
      }

      // ── 已击中音块的灰色残影（变灰后随画面滚出） ──
      run.hitFades = run.hitFades.filter((f) => frameTime - f.at < HIT_FADE_MS);
      for (const fade of run.hitFades) {
        const alpha = 0.35 * (1 - (frameTime - fade.at) / HIT_FADE_MS);
        const bottomY = H - (fade.tile.t - camera) * pxPerMs;
        const tileH = fade.tile.d * pxPerMs;
        if (bottomY < 0 || bottomY - tileH > H) continue;
        ctx.fillStyle = `rgba(110,120,140,${alpha})`;
        ctx.fillRect(fade.tile.lane * laneW + 1.5 * s, bottomY - tileH, laneW - 3 * s, tileH);
      }

      // ── 音块：块高 = 时值，相邻块首尾相接（原作模型） ──
      const drawTile = (tile: Tile) => {
        const bottomY = H - (tile.t - camera) * pxPerMs;
        const tileH = Math.max(2, tile.d * pxPerMs);
        const topY = bottomY - tileH;
        if (bottomY < 0 || topY > H) return;
        const x = tile.lane * laneW;
        const isStartTile = tile.index === -1;
        const isHold = engine.isHold(tile);

        ctx.fillStyle = isStartTile ? '#1f2430' : '#15181f';
        ctx.fillRect(x + 1.5 * s, topY, laneW - 3 * s, tileH - 1.5 * s);

        ctx.textAlign = 'center';
        if (isHold) {
          // 长按块：中央渐变滑轨 + 底部圆点（对齐原作 slide_tile_base 粉→橙渐变）
          const pad = Math.min(20 * s, tileH * 0.12);
          const cx = x + laneW / 2;
          const trackTop = topY + pad;
          const trackBottom = bottomY - pad - 1.5 * s;
          const track = ctx.createLinearGradient(0, trackTop, 0, trackBottom);
          track.addColorStop(0, '#ff5f9e');
          track.addColorStop(1, '#ffc247');
          ctx.strokeStyle = track;
          ctx.lineWidth = 5 * s;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(cx, trackTop);
          ctx.lineTo(cx, trackBottom);
          ctx.stroke();
          ctx.lineCap = 'butt';
          // 底部圆点：白色圆芯 + 柔光环
          ctx.fillStyle = 'rgba(255,255,255,0.22)';
          ctx.beginPath();
          ctx.arc(cx, trackBottom, 14 * s, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.95)';
          ctx.beginPath();
          ctx.arc(cx, trackBottom, 8 * s, 0, Math.PI * 2);
          ctx.fill();
        }
        if (isStartTile) {
          ctx.fillStyle = '#ffffff';
          ctx.font = `bold ${52 * s}px sans-serif`;
          ctx.fillText('开始', x + laneW / 2, bottomY - tileH / 2 + 18 * s);
        }
      };
      const upcoming = engine.upcomingTiles(64);
      for (let i = upcoming.length - 1; i >= 0; i -= 1) {
        drawTile(upcoming[i]);
      }

      // ── 活跃长按块：保持显示并绘制进度动画 ──
      const holdView = engine.holdState(camera);
      if (run.activeHold && !holdView) {
        // 长按已自动划满：先确定奖励再生成灰色残影。
        finalizeActiveHold(engine);
        // 长按已结束（松手或划完）→ 生成灰色残影
        run.hitFades.push({ tile: run.activeHold, at: frameTime });
        run.activeHold = null;
        run.holding = false;
      }
      if (holdView) {
        const tile = holdView.tile;
        drawTile(tile);
        const holdBottomY = H - (tile.t - camera) * pxPerMs;
        const holdH = tile.d * pxPerMs;
        const holdTopY = holdBottomY - holdH;
        const x = tile.lane * laneW;
        const cx = x + laneW / 2;
        // 进度条锚定块体自身：底边随块滚动，顶边全程恒定速度爬升；
        // 若以屏幕底为基准，块底滑出屏幕时基准切换会造成先慢中快后慢的变速观感
        const fillBottom = holdBottomY - 1.5 * s;
        const fillTop = Math.max(holdTopY, fillBottom - holdView.progress * holdH);
        if (fillBottom > fillTop) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x + 1.5 * s, holdTopY, laneW - 3 * s, holdH - 1.5 * s);
          ctx.clip();
          // 水色渐变填充：推进头处最亮（对齐原作 image_slow_long_back）
          const fill = ctx.createLinearGradient(0, fillTop, 0, fillBottom);
          fill.addColorStop(0, 'rgba(234,252,255,0.97)');
          fill.addColorStop(0.35, 'rgba(151,233,251,0.95)');
          fill.addColorStop(1, 'rgba(86,205,238,0.93)');
          ctx.fillStyle = fill;
          ctx.fillRect(x + 1.5 * s, fillTop, laneW - 3 * s, fillBottom - fillTop);
          // 星光闪烁颗粒（确定性取样，随时间片轻微变换）
          const sparklePhase = Math.floor(frameTime / 140);
          for (let k = 0; k < 14; k += 1) {
            const hsh = hash32(k * 7919 + sparklePhase * 104729 + tile.index * 31);
            const sy = fillBottom - (((hsh >>> 10) % 997) / 997) * (fillBottom - fillTop);
            if (sy < fillTop + 8 * s) continue;
            const sx = x + 5 * s + ((hsh % 997) / 997) * (laneW - 10 * s);
            const sr = (1 + ((hsh >>> 20) % 14) / 10) * s;
            ctx.fillStyle = `rgba(255,255,255,${(35 + ((hsh >>> 24) % 55)) / 100})`;
            ctx.beginPath();
            ctx.arc(sx, sy, sr, 0, Math.PI * 2);
            ctx.fill();
          }
          // 填充区内保留中线
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          ctx.fillRect(cx - 1.5 * s, fillTop, 3 * s, fillBottom - fillTop);
          // 金色圆顶推进头（对齐原作 slide_light）
          const dome = ctx.createLinearGradient(0, fillTop - 11 * s, 0, fillTop);
          dome.addColorStop(0, '#ffe27a');
          dome.addColorStop(1, '#f5a201');
          ctx.fillStyle = dome;
          ctx.beginPath();
          ctx.ellipse(cx, fillTop, (laneW - 3 * s) / 2, 11 * s, 0, Math.PI, Math.PI * 2);
          ctx.fill();
          // 推进头顶边高光
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.fillRect(x + 1.5 * s, fillTop - 1 * s, laneW - 3 * s, 2 * s);
          // 底部圆点按住时金色脉冲
          const pad = Math.min(20 * s, holdH * 0.12);
          const ballY = holdBottomY - pad - 1.5 * s;
          const pulse = 1 + 0.18 * Math.sin(frameTime / 110);
          ctx.fillStyle = 'rgba(255,213,94,0.35)';
          ctx.beginPath();
          ctx.arc(cx, ballY, 15 * s * pulse, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffd95e';
          ctx.beginPath();
          ctx.arc(cx, ballY, 8 * s * pulse, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        // 已获加分：金色数字跟随推进头上方
        if (holdView.granted > 0) {
          const labelY = Math.max(holdTopY + 34 * s, Math.max(26 * s, fillTop - 18 * s));
          ctx.fillStyle = '#f5b301';
          ctx.font = `bold ${40 * s}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(`+${holdView.granted}`, cx, labelY);
        }
      }

      // ── 失败闪烁 ──
      if (run.failFlash) {
        const elapsed = frameTime - run.failFlash.at;
        if (elapsed < FAIL_FLASH_MS) {
          if (Math.floor(elapsed / 150) % 2 === 0) {
            ctx.fillStyle = 'rgba(229,57,53,0.85)';
            ctx.fillRect(
              run.failFlash.lane * laneW + 3 * s,
              run.failFlash.tileTop,
              laneW - 6 * s,
              run.failFlash.tileH,
            );
          }
        } else {
          run.failFlash = null;
          void finishGame(engine);
          return;
        }
      }

      // ── HUD 同步：得分/皇冠/圈数/倒计时移出画布，由外部状态坞展示 ──
      const res = engine.result();
      let rushLeftSec: number | null = null;
      if (modeRef.current === 'rush' && run.started) {
        const left = Math.max(0, RUSH_DURATION_MS - run.wallElapsed);
        rushLeftSec = Math.ceil(left / 1000);
        if (left <= 0 && engine.status === 'running') {
          engine.timeUp();
          syncHud(res.score, res.crowns, res.laps, 0, run.started);
          void finishGame(engine);
          return;
        }
      }
      syncHud(res.score, res.crowns, res.laps, rushLeftSec, run.started);

      // ── 起手提示（游戏区域内既有引导，保持原样） ──
      if (!run.started) {
        ctx.fillStyle = '#8a90a3';
        ctx.font = `${36 * s}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('点击「开始」音块开始演奏', W / 2, H - 40 * s);
      }

      if (engine.status === 'running' || !run.started || run.failFlash) {
        rafRef.current = requestAnimationFrame(renderFrame);
      } else if (engine.status !== 'ready') {
        void finishGame(engine);
      }
    },
    [finalizeActiveHold, finishGame, pauseForFrameStall, syncHud],
  );

  // ── 输入 ────────────────────────────────────────
  const pointerDown = useCallback((pointerId: number, clientX: number, clientY: number) => {
    if (pausedRef.current) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setNetworkOffline(true);
      pauseActiveRun();
      setCheckpointNotice('当前处于离线状态，联网后才能继续演奏；未同步事件已安全保留');
      return;
    }
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!canvas || !engine) return;
    const run = runRef.current;
    if (run.failFlash) return;
    const inputTime = performance.now();
    if (run.started && engine.status === 'running') {
      const frameGap = run.lastFrame > 0 ? inputTime - run.lastFrame : 0;
      // 主线程卡顿后 pointer 可能先于下一帧到达，必须在输入路径同样先冻结本局。
      if (frameGap > FRAME_STALL_PAUSE_MS && pauseForFrameStall()) return;
      // 输入事件使用真实按下时刻，不能复用上一帧缓存，否则低帧率下两个合法点击
      // 可能得到相同时间戳，并被服务端误判为命中间隔过短。
      run.wallElapsed = Math.max(run.wallElapsed, inputTime - run.wallStart);
      // 60 秒边界上输入事件可能先于 RAF 到达，时间到后不得再多计一次命中。
      if (modeRef.current === 'rush' && run.wallElapsed >= RUSH_DURATION_MS) {
        engine.timeUp();
        const timedOut = engine.result();
        syncHud(timedOut.score, timedOut.crowns, timedOut.laps, 0, true);
        void finishGame(engine);
        return;
      }
    }
    // 长按期间禁止第二个指针抢占下一块，避免奖励事件尚未确定就改变事件顺序。
    if (run.holding || activeHoldEventRef.current) return;
    if (engine.status !== 'running' && engine.status !== 'ready') return;
    const rect = canvas.getBoundingClientRect();
    const lane = Math.min(
      LANE_COUNT - 1,
      Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * LANE_COUNT)),
    );

    const outcome = engine.tap(lane, run.cameraMs);
    const now = Math.round(run.wallElapsed);
    if (outcome.kind === 'start') {
      // 点中「开始」块：启动滚动，不计分、不上报事件
      run.started = true;
      run.wallStart = inputTime;
      run.hitFades.push({ tile: outcome.tile, at: inputTime });
    } else if (outcome.kind === 'hit') {
      samplerRef.current?.playPitches(outcome.tile.pitches);
      if (engine.isHold(outcome.tile)) {
        // 长按块的 b 必须等松手/划满后才能确定，期间只保留延迟事件。
        activeHoldEventRef.current = {
          event: { t: now, lane, j: 'h', b: 0 },
          scoreAfterHit: engine.score,
        };
        activeHoldPointerIdRef.current = pointerId;
        // 长按块：进入按住状态，块保持显示并随进度填充，结束后再生成残影
        run.holding = true;
        run.activeHold = outcome.tile;
      } else {
        pendingEventsRef.current.push({ t: now, lane, j: 'h', b: 0 });
        run.hitFades.push({ tile: outcome.tile, at: inputTime });
      }
    } else if (outcome.kind === 'wrong') {
      pendingEventsRef.current.push({ t: now, lane, j: 'w', b: 0 });
      samplerRef.current?.playSfx('miss');
      // 红块与黑块同尺寸（1 个单位块），并吸附到与黑块一致的行网格：
      // 以下一个待击块的 t 为网格锚点，红块正好占据点击命中的那一格
      const viewMs = engine.viewWindowMs();
      const pxPerMs = canvas.height / viewMs;
      const unitMs = viewMs / VIEW_UNITS;
      const unitH = canvas.height / VIEW_UNITS;
      const tapY = ((clientY - rect.top) / rect.height) * canvas.height;
      const tapTimeMs = run.cameraMs + (canvas.height - tapY) / pxPerMs;
      const anchorMs = engine.nextTile()?.t ?? 0;
      const cellBottomMs = anchorMs + Math.floor((tapTimeMs - anchorMs) / unitMs) * unitMs;
      const cellBottomY = canvas.height - (cellBottomMs - run.cameraMs) * pxPerMs;
      run.failFlash = {
        lane,
        tileTop: cellBottomY - unitH,
        tileH: unitH,
        at: inputTime,
      };
    }
  }, [finishGame, pauseActiveRun, pauseForFrameStall, syncHud]);

  const pointerUp = useCallback((pointerId: number) => {
    const run = runRef.current;
    const engine = engineRef.current;
    // 其他手指抬起/取消时不得结束当前长按。
    if (activeHoldPointerIdRef.current !== pointerId) return;
    if (!run.holding || !engine) {
      activeHoldPointerIdRef.current = null;
      return;
    }
    run.holding = false;
    const bonus = engine.release(run.cameraMs);
    finalizeActiveHold(engine, bonus);
    // 残影由渲染循环在检测到长按结束时统一生成
  }, [finalizeActiveHold]);

  // ── 暂停 / 继续（冻结音乐、计时与判定） ──────────
  const pauseGame = useCallback(() => {
    pauseActiveRun();
  }, [pauseActiveRun]);

  const resumeGame = useCallback(() => {
    if (!pausedRef.current) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setCheckpointNotice('当前处于离线状态，联网后才能继续演奏；未同步事件已安全保留');
      return;
    }
    pausedRef.current = false;
    setPaused(false);
    const run = runRef.current;
    // 墙钟前移暂停时长：wallElapsed 保持连续，首帧 dt 归零避免相机跳变
    run.lastFrame = 0;
    run.wallStart = performance.now() - run.wallElapsed;
    void samplerRef.current?.resume();
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(renderFrame);
  }, [renderFrame]);

  // 浏览器切后台/锁屏时必须等价于显式暂停，否则 RAF 停止而墙钟仍会跳变，
  // 恢复后的事件时间会被服务端判定为过晚，最终无法结算。
  useEffect(() => {
    const pauseWhenHidden = () => {
      if (document.hidden) {
        pauseGame();
        void flushCheckpoint(true);
      } else {
        // 从锁屏/后台回来先续租，再由用户决定是否继续演奏。
        void flushCheckpoint(true);
      }
    };
    const pauseBeforePageHide = () => {
      pauseGame();
      void flushCheckpoint(true);
    };
    const markOffline = () => {
      setNetworkOffline(true);
      pauseGame();
      setCheckpointNotice('网络已断开，游戏已自动暂停；未同步事件会在联网后重试');
      void flushCheckpoint();
    };
    const markOnline = () => {
      setNetworkOffline(false);
      if (!checkpointBlockedRef.current) setCheckpointNotice(null);
      void flushCheckpoint(true);
    };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    window.addEventListener('pagehide', pauseBeforePageHide);
    window.addEventListener('offline', markOffline);
    window.addEventListener('online', markOnline);
    return () => {
      document.removeEventListener('visibilitychange', pauseWhenHidden);
      window.removeEventListener('pagehide', pauseBeforePageHide);
      window.removeEventListener('offline', markOffline);
      window.removeEventListener('online', markOnline);
    };
  }, [flushCheckpoint, pauseGame]);

  const togglePause = useCallback(() => {
    if (pausedRef.current) resumeGame();
    else pauseGame();
  }, [pauseGame, resumeGame]);

  const openRules = useCallback(() => {
    rulesHadPauseRef.current = pausedRef.current;
    pauseGame();
    setShowRules(true);
  }, [pauseGame]);

  const closeRules = useCallback(() => {
    setShowRules(false);
    if (!rulesHadPauseRef.current) resumeGame();
  }, [resumeGame]);

  // ── 开始游戏 ────────────────────────────────────
  const startGame = useCallback(
    async (entry: ChartManifestEntry) => {
      if (!manifest) return;
      if (startInFlightRef.current) return;
      if (pendingSubmissionRef.current) {
        setSubmitNotice('请先完成上一局结算，再开始新的演奏');
        setPhase('finished');
        return;
      }
      // React 状态提交前仍可能收到第二次点击；用同步 ref 避免两个开局请求
      // 互相覆盖 sessionRef，并由失败请求误取消已经成功的另一局。
      startInFlightRef.current = true;
      setError(null);
      setSubmitNotice(null);
      setCheckpointNotice(null);
      setHasPendingSubmission(false);
      setSelected(entry);
      setPhase('loading');
      setLoadProgress(0);
      setResult(null);
      setAwardedPoints(null);
      submittedRef.current = false;
      pendingEventsRef.current = [];
      confirmedEventCountRef.current = 0;
      activeHoldEventRef.current = null;
      activeHoldPointerIdRef.current = null;
      checkpointBlockedRef.current = false;
      checkpointRetryRef.current = null;
      lastCheckpointAtRef.current = 0;
      lastHeartbeatAttemptAtRef.current = 0;
      sessionRef.current = null;
      modeRef.current = mode;
      runRef.current = freshRunState();
      pausedRef.current = false;
      setPaused(false);
      hudRef.current = HUD_IDLE;
      setHud(HUD_IDLE);

      try {
        const chart = await fetchChart(entry.id);
        chartRef.current = chart;
        if (!samplerRef.current) samplerRef.current = new PianoSampler();
        const sampler = samplerRef.current;
        await sampler.init(manifest);
        await sampler.preload(chart, (loaded, total) =>
          setLoadProgress(total > 0 ? loaded / total : 1),
        );

        const res = await fetchGameRequest(`${API_BASE}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chartId: entry.id, mode, checksum: chart.checksum }),
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.data?.sessionId) {
          sessionRef.current = { sessionId: data.data.sessionId };
          lastCheckpointAtRef.current = Date.now();
        } else if (res.status === 401) {
          throw new Error('请先登录后开始游戏');
        } else {
          throw new Error(data?.message ?? `开局失败（HTTP ${res.status}），请稍后重试`);
        }

        engineRef.current = createEngine(chart, mode);
        // 相机定位：「开始」块底边停在屏幕 70% 高度处等待点击
        const firstTile = engineRef.current.nextTile();
        if (firstTile) {
          runRef.current.cameraMs = firstTile.t - engineRef.current.viewWindowMs() * 0.3;
        }
        if (sessionRef.current) {
          checkpointTimerRef.current = window.setInterval(
            () => {
              const heartbeatDue =
                pendingEventsRef.current.length === 0 &&
                Date.now() - lastCheckpointAtRef.current >= CHECKPOINT_HEARTBEAT_MS &&
                Date.now() - lastHeartbeatAttemptAtRef.current >= CHECKPOINT_HEARTBEAT_MS;
              void flushCheckpoint(heartbeatDue);
            },
            CHECKPOINT_INTERVAL_MS,
          );
        }
        setPhase('playing');
      } catch (err) {
        const failedSession = sessionRef.current;
        sessionRef.current = null;
        if (failedSession) {
          void fetchGameRequest(`${API_BASE}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: failedSession.sessionId }),
          }).catch(() => undefined);
        }
        setError(gameRequestErrorMessage(err, '加载超时，请重试', '加载谱面失败'));
        setPhase('song-select');
      } finally {
        startInFlightRef.current = false;
      }
    },
    [manifest, mode, flushCheckpoint],
  );

  const cancelGame = useCallback(async () => {
    cancelAnimationFrame(rafRef.current);
    if (checkpointTimerRef.current !== null) {
      window.clearInterval(checkpointTimerRef.current);
      checkpointTimerRef.current = null;
    }
    pausedRef.current = false;
    setPaused(false);
    void samplerRef.current?.resume();
    const session = sessionRef.current;
    sessionRef.current = null;
    pendingEventsRef.current = [];
    activeHoldEventRef.current = null;
    activeHoldPointerIdRef.current = null;
    confirmedEventCountRef.current = 0;
    checkpointBlockedRef.current = false;
    checkpointRetryRef.current = null;
    lastHeartbeatAttemptAtRef.current = 0;
    pendingSubmissionRef.current = null;
    setHasPendingSubmission(false);
    clearPendingPianoTilesSubmission(getPianoSessionStorage());
    if (session) {
      try {
        await fetchGameRequest(`${API_BASE}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: session.sessionId }),
        });
      } catch {
        // 取消失败不阻断返回
      }
    }
    hudRef.current = HUD_IDLE;
    setHud(HUD_IDLE);
    setPhase('song-select');
  }, []);

  const openCancelConfirm = useCallback(() => {
    cancelHadPauseRef.current = pausedRef.current;
    pauseGame();
    setShowCancelConfirm(true);
  }, [pauseGame]);

  const closeCancelConfirm = useCallback(() => {
    setShowCancelConfirm(false);
    if (!cancelHadPauseRef.current) resumeGame();
  }, [resumeGame]);

  const confirmCancel = useCallback(async () => {
    setShowCancelConfirm(false);
    await cancelGame();
  }, [cancelGame]);

  // canvas 尺寸：固定 9:16 竖屏，桌面与手机一致
  useEffect(() => {
    if (phase !== 'playing') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [phase]);

  // 渲染循环随 phase 启动（canvas 挂载并完成尺寸设置后）
  useEffect(() => {
    if (phase !== 'playing') return;
    rafRef.current = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase, renderFrame]);

  // ── UI ──────────────────────────────────────────
  const modeMeta = MODE_META[mode];
  const speedText = `×${Math.min(MAX_SPEED_MULTIPLIER, 1 + hud.laps * LAP_SPEED_STEP).toFixed(2)}`;
  const inRound = phase === 'playing' || phase === 'submitting';
  const resultTitle =
    result?.status === 'timeup' ? '时间到！' : (result?.crowns ?? 0) > 0 ? '演奏结束' : '演奏失败';

  const phaseLabel =
    phase === 'mode-select'
      ? '选择模式'
      : phase === 'song-select'
        ? '选曲台'
        : phase === 'loading'
            ? '采样加载'
          : phase === 'submitting'
            ? '结算中'
            : phase === 'finished'
              ? hasPendingSubmission ? '待重试' : '已结算'
              : paused
                ? '已暂停'
                : '演奏中';
  const tacticalLine =
    phase === 'mode-select'
      ? '经典 / 限时双模式 · 先选玩法'
      : phase === 'song-select'
        ? `${manifest ? filteredCharts.length : '…'} 首可选 · ${modeMeta.label}`
        : `${selected?.title ?? ''} · ${modeMeta.label}`;
  const commandMessage =
    phase === 'mode-select'
      ? '先选择一种演奏模式，再去挑选曲目'
      : phase === 'song-select'
        ? '挑一首喜欢的曲子，随时开始演奏'
        : phase === 'loading'
        ? `正在准备《${selected?.title ?? ''}》，加载钢琴采样中…`
          : phase === 'submitting'
            ? '本局成绩正在由服务端复核结算'
            : phase === 'finished'
            ? hasPendingSubmission
              ? (submitNotice ?? '结算未完成，提交包已保留')
              : awardedPoints != null
              ? `本局获得 ${awardedPoints} 福利积分`
              : (submitNotice ?? '本局已结算')
            : paused
              ? '音乐与计时已冻结，点击「继续」恢复演奏'
              : networkOffline
                ? '网络已断开，游戏已暂停；联网后可继续演奏'
                : checkpointNotice
                  ? checkpointNotice
              : hud.started
                ? '跟随节奏点击黑块，点错或漏块即失败'
                : '点击琴道中的「开始」音块起手';

  return (
    <div className={`piano-page ${inRound ? 'is-inround' : ''}`}>
      <div className="piano-mesh-bg" aria-hidden />
      <div className="piano-stars" aria-hidden>
        <span style={{ top: '9%', left: '5%', fontSize: 15 }}>♪</span>
        <span style={{ top: '19%', left: '92%', fontSize: 13, animationDelay: '1s' }}>♫</span>
        <span style={{ top: '46%', left: '4%', fontSize: 12, animationDelay: '2.1s' }}>✦</span>
        <span style={{ top: '70%', left: '94%', fontSize: 15, animationDelay: '0.6s' }}>♪</span>
        <span style={{ top: '87%', left: '13%', fontSize: 12, animationDelay: '1.6s' }}>✧</span>
      </div>

      <header className="piano-topbar">
        <Link href="/games" className="piano-exit-btn" aria-label="返回游戏中心">
          <span className="arrow">
            <ArrowLeft size={14} strokeWidth={2.4} />
          </span>
          EXIT
        </Link>
      </header>

      <main className="piano-container">
        {error && (
          <div className="piano-error-banner" role="alert">
            {error}
          </div>
        )}

        <section className="piano-command-bar" aria-live="polite">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-black text-emerald-700">
              <Music className="h-4 w-4" />
              <span>{phaseLabel}</span>
              <span className="text-slate-300">/</span>
              <span className="min-w-0 truncate text-slate-500">{tacticalLine}</span>
            </div>
            <div className="piano-command-message-row">
              {phase === 'song-select' && (
                <button
                  type="button"
                  onClick={() => setPhase('mode-select')}
                  className="piano-exit-btn piano-reselect-btn"
                  aria-label="重选模式"
                >
                  <span className="arrow">
                    <ArrowLeft size={14} strokeWidth={2.4} />
                  </span>
                  重选模式
                </button>
              )}
              <p className="truncate text-lg font-black text-slate-950 sm:text-xl">{commandMessage}</p>
            </div>
          </div>
          <div className="piano-command-actions">
            {(phase === 'mode-select' || phase === 'song-select') && (
              <Link href="/games/piano-tiles/records" className="piano-action-btn">
                <Trophy className="h-4 w-4" />
                个人战绩
              </Link>
            )}
            <button onClick={openRules} type="button" className="piano-action-btn">
              <BookOpen className="h-4 w-4" />
              规则
            </button>
          </div>
        </section>

        {phase === 'mode-select' && (
          <section className="glass-card stage-card piano-mode-stage" aria-label="选择演奏模式">
            <div className="piano-stage-head">
              <h2 className="piano-section-title">
                <span className="piano-st-icon">
                  <Music size={18} />
                </span>
                演奏模式
              </h2>
              <span className="piano-cute-pill">
                <Sparkles className="h-4 w-4" />
                两种玩法 · 同一套判定
              </span>
            </div>
            <div className="piano-mode-grid">
              {(['classic', 'rush'] as const).map((key, index) => {
                const meta = MODE_META[key];
                const isActive = mode === key;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => {
                      setMode(key);
                      setPhase('song-select');
                    }}
                    className={`piano-mode-card ${meta.toneClass} ${isActive ? 'is-selected' : ''}`}
                    style={{ animationDelay: `${index * 90}ms` }}
                  >
                    <span className={`piano-mode-glow ${meta.toneClass}`} />
                    <span className="mode-content">
                      <span className="mode-topline">
                        <span className={`mode-icon ${meta.toneClass}`}>{meta.icon}</span>
                        <span className={`mode-duration-pill ${meta.toneClass}`}>{meta.durationPill}</span>
                      </span>
                      <span className="mode-copy">
                        <span className={`mode-label ${meta.toneClass}`}>{meta.label}</span>
                        <span className="mode-summary">{meta.summary}</span>
                      </span>
                      <span className={`mode-selected-pill ${isActive ? 'is-visible' : ''}`}>
                        <Play className="h-4 w-4" />
                        {isActive ? '当前模式 · 点击进入选曲' : '点击选择此模式'}
                      </span>
                      <span className="mode-stats">
                        {meta.stats.map((row) => (
                          <span key={row.name}>
                            <span>{row.name}</span>
                            <strong>{row.value}</strong>
                          </span>
                        ))}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {phase === 'song-select' && (
          <section className="glass-card stage-card piano-library-stage" aria-label="挑选曲目">
            <div className="piano-stage-head">
              <h2 className="piano-section-title">
                <span className="piano-st-icon">
                  <ListMusic size={18} />
                </span>
                挑选曲目
              </h2>
              <div className="piano-library-head-side">
                <span className="piano-cute-pill">
                  <Music className="h-4 w-4" />
                  {manifest
                    ? `${modeMeta.label} · 已筛选 ${filteredCharts.length} 首`
                    : '曲目清单加载中…'}
                </span>
              </div>
            </div>

            <div className="piano-keys-strip" aria-hidden />

            <div className="piano-library-toolbar">
              <div className="piano-search-wrap">
                <Search className="piano-search-icon" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索曲名或音乐家…"
                  aria-label="搜索曲目"
                />
              </div>
              <div className="piano-filter-chips" role="group" aria-label="按难度筛选">
                {[0, 1, 2, 3, 4, 5].map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={starFilter === v}
                    onClick={() => setStarFilter(v)}
                    className={`piano-filter-chip ${starFilter === v ? 'is-active' : ''}`}
                  >
                    {v === 0 ? '全部难度' : '★'.repeat(v)}
                  </button>
                ))}
              </div>
            </div>

            {!manifest ? (
              <div className="piano-library-empty">曲目清单加载中…</div>
            ) : (
              <div className="piano-song-list" role="list">
                {filteredCharts.slice(0, 200).map((c, idx) => (
                  <button
                    key={c.id}
                    type="button"
                    role="listitem"
                    onClick={() => void startGame(c)}
                    className="piano-song-row"
                  >
                    <span className="piano-song-tilemini" aria-hidden>
                      {[0, 1, 2, 3].map((l) => (
                        <i key={l} className={l === idx % 4 ? 'on' : ''} />
                      ))}
                    </span>
                    <span className="piano-song-info">
                      <span className="piano-song-title">{c.title}</span>
                      <span className="piano-song-meta">
                        {c.artist || '未知音乐家'} · {Math.round(c.durationMs / 1000)} 秒 · {c.bpm} BPM
                      </span>
                    </span>
                    <span className="piano-song-side">
                      <span className="piano-song-stars" aria-label={`难度 ${c.stars} 星`}>
                        {Array.from({ length: c.stars }).map((_, i) => (
                          <Star key={i} className="h-3.5 w-3.5 fill-current" />
                        ))}
                      </span>
                      <span className="piano-song-play">
                        <Play className="h-3.5 w-3.5" />
                        开始演奏
                      </span>
                    </span>
                  </button>
                ))}
                {filteredCharts.length === 0 && (
                  <div className="piano-library-empty">没有找到匹配的曲目，换个关键词或难度试试。</div>
                )}
                {filteredCharts.length > 200 && (
                  <div className="piano-library-note">仅展示前 200 首，可通过搜索继续缩小范围。</div>
                )}
              </div>
            )}
          </section>
        )}

        {phase === 'loading' && (
          <section className="glass-card stage-card piano-loading-stage" aria-label="加载曲目">
            <span className="piano-loading-icon">
              <Loader2 className="h-9 w-9 animate-spin" />
            </span>
            <h2>正在准备《{selected?.title}》</h2>
            <p>{selected?.artist || '未知音乐家'} · {modeMeta.label}</p>
            <div className="piano-loading-bar">
              <div style={{ width: `${Math.round(loadProgress * 100)}%` }} />
            </div>
            <span className="piano-loading-tip">加载钢琴采样与音效 {Math.round(loadProgress * 100)}%</span>
          </section>
        )}

        {inRound && (
          <section className="glass-card stage-card piano-game-card" aria-label="演奏舞台">
            <div className="piano-game-body">
              <div className="piano-status-dock">
              <div className="min-w-0">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className={`piano-phase-pill ${paused ? 'is-paused' : ''}`}>
                    {phase === 'submitting'
                      ? '结算中'
                      : paused
                        ? networkOffline
                          ? '离线暂停'
                          : '已暂停'
                        : hud.started
                          ? '演奏中'
                          : '待起手'}
                  </span>
                  <span className="min-w-0 truncate text-xs font-bold text-slate-400">
                    {selected?.title} · {modeMeta.label} · {'★'.repeat(selected?.stars ?? 0)}
                  </span>
                </div>
                <div className="piano-status-metrics">
                  <DockMetric
                    icon={<Sparkles className="h-4 w-4" />}
                    label="得分"
                    value={hud.score}
                    tone="text-emerald-600"
                  />
                  {modeRef.current === 'rush' ? (
                    <DockMetric
                      icon={<Timer className="h-4 w-4" />}
                      label="剩余时间"
                      value={hud.rushLeftSec != null ? `${hud.rushLeftSec}s` : `${Math.round(RUSH_DURATION_MS / 1000)}s`}
                      tone={hud.rushLeftSec != null && hud.rushLeftSec <= 10 ? 'text-rose-600' : 'text-sky-600'}
                    />
                  ) : (
                    <DockMetric
                      icon={<Gauge className="h-4 w-4" />}
                      label="当前速度"
                      value={speedText}
                      tone="text-sky-600"
                    />
                  )}
                  <DockMetric
                    icon={<Crown className="h-4 w-4" />}
                    label="皇冠"
                    value={hud.crowns > 0 ? '♛'.repeat(hud.crowns) : '—'}
                    tone="text-amber-600"
                  />
                  <DockMetric
                    icon={<RotateCcw className="h-4 w-4" />}
                    label="完成圈数"
                    value={hud.laps}
                    tone="text-slate-600"
                  />
                </div>
              </div>
              {phase === 'playing' && <div className="piano-dock-actions">
                <button
                  type="button"
                  onClick={togglePause}
                  disabled={phase !== 'playing' || !hud.started}
                  className="piano-pause-btn"
                >
                  {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  {paused ? '继续' : '暂停'}
                </button>
                <button type="button" onClick={openCancelConfirm} className="piano-giveup-btn">
                  <X className="h-4 w-4" />
                  放弃
                </button>
              </div>}
            </div>

              <div className="piano-stage-col">
                <div className="piano-stage-wrap">
                  <div
                    className="piano-canvas-frame"
                    style={{ maxWidth: `min(100%, calc(70vh * ${DESIGN_W / DESIGN_H}))` }}
                  >
                <canvas
                   ref={canvasRef}
                   className="piano-canvas"
                   style={{ aspectRatio: `${DESIGN_W} / ${DESIGN_H}` }}
                   onPointerDown={(e) => {
                     e.currentTarget.setPointerCapture(e.pointerId);
                     pointerDown(e.pointerId, e.clientX, e.clientY);
                   }}
                   onPointerUp={(e) => pointerUp(e.pointerId)}
                   onPointerCancel={(e) => pointerUp(e.pointerId)}
                   onLostPointerCapture={(e) => pointerUp(e.pointerId)}
                 />
                {paused && !showCancelConfirm && !showRules && (
                  <div className="piano-pause-overlay" role="dialog" aria-modal="true" aria-label="游戏已暂停">
                    <span className="piano-pause-icon">
                      <Pause className="h-8 w-8" />
                    </span>
                    <h3>{networkOffline ? '网络已断开' : '已暂停'}</h3>
                    <p>
                      {networkOffline
                        ? '本局进度已保留，联网后才能继续演奏'
                        : '音乐、计时与判定已全部冻结'}
                    </p>
                    <div className="piano-pause-actions">
                      <button
                        type="button"
                        onClick={resumeGame}
                        disabled={networkOffline}
                        className="piano-pause-btn"
                      >
                        <Play className="h-4 w-4" />
                        {networkOffline ? '等待联网' : '继续演奏'}
                      </button>
                      <button type="button" onClick={openCancelConfirm} className="piano-giveup-btn">
                        <X className="h-4 w-4" />
                        放弃本局
                      </button>
                    </div>
                  </div>
                )}
              </div>
                </div>
                <p className="piano-stage-hint">
                  长按滑轨音块蓄力最多 +{HOLD_BONUS_MAX} 分 · 点错白键或漏块会立即结束本局
                </p>
              </div>
            </div>
          </section>
        )}

        {showRules && <PianoRulesModal onClose={closeRules} />}

        <ResultCard
          open={phase === 'finished' && result !== null}
          title={hasPendingSubmission ? '结算待重试' : resultTitle}
          subtitle={
            selected
              ? `${selected.title} · ${mode === 'classic' ? '经典' : '限时'}${
                  result && result.laps > 0 ? ` · ${result.laps} 圈` : ''
                }`
              : undefined
          }
          primaryScore={result?.score ?? 0}
          primaryLabel={
            awardedPoints != null ? `获得积分 +${awardedPoints}` : (submitNotice ?? undefined)
          }
          status={(result?.crowns ?? 0) > 0 ? 'win' : result?.status === 'timeup' ? 'neutral' : 'lose'}
          stats={
            result
              ? [
                  { label: '皇冠', value: '♛'.repeat(result.crowns) || '—', tone: 'amber' },
                  { label: '完成圈数', value: result.laps, tone: 'emerald' },
                  { label: '击中音块', value: result.tilesHit, tone: 'slate' },
                ]
              : []
          }
          primaryAction={
            hasPendingSubmission
              ? { label: '重试结算', onClick: () => void submitPendingResult() }
              : { label: '再来一局', onClick: () => selected && void startGame(selected) }
          }
          secondaryAction={
            hasPendingSubmission
              ? undefined
              : { label: '选择其他曲目', onClick: () => setPhase('song-select') }
          }
        />

        <CancelConfirmModal
          open={showCancelConfirm}
          title="确认放弃本次演奏？"
          description="当前对局会被取消，本局不会进入积分结算。"
          detail="已演奏的得分、皇冠与圈数进度将不会保留。"
          onConfirm={() => void confirmCancel()}
          onClose={closeCancelConfirm}
        />
      </main>

      <style jsx global>{`
        .piano-page {
          min-height: 100vh;
          background: #eefcf8;
          color: #0f172a;
          position: relative;
          overflow-x: hidden;
        }
        .piano-page a {
          color: inherit;
          text-decoration: none;
        }
        .piano-page .piano-mesh-bg {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          background:
            radial-gradient(circle at 12% 18%, rgba(45, 212, 191, 0.34), transparent 38%),
            radial-gradient(circle at 88% 14%, rgba(148, 163, 184, 0.16), transparent 34%),
            radial-gradient(circle at 48% 96%, rgba(16, 185, 129, 0.28), transparent 42%),
            linear-gradient(180deg, #f4fefb 0%, #e9f8f3 60%, #e6f4ef 100%);
        }
        .piano-page .piano-stars {
          position: fixed;
          inset: 0;
          z-index: 1;
          pointer-events: none;
          color: rgba(4, 120, 87, 0.4);
        }
        .piano-page .piano-stars span {
          position: absolute;
          animation: piano-float 4s ease-in-out infinite;
        }
        @keyframes piano-float {
          0%, 100% { transform: translateY(0); opacity: 0.45; }
          50% { transform: translateY(-10px); opacity: 0.9; }
        }

        /* ───────── 顶栏：EXIT 胶囊 + 用户头像（与游戏中心一致） ───────── */
        .piano-page .piano-topbar {
          position: sticky;
          top: 0;
          z-index: 40;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 14px 48px;
          padding-top: max(14px, env(safe-area-inset-top));
          background: rgba(239, 253, 248, 0.68);
          border-bottom: 1px solid rgba(255, 255, 255, 0.74);
          backdrop-filter: blur(22px) saturate(1.45);
          -webkit-backdrop-filter: blur(22px) saturate(1.45);
        }
        .piano-page .piano-exit-btn {
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
          flex-shrink: 0;
        }
        .piano-page .piano-exit-btn .arrow {
          display: inline-flex;
          width: 30px;
          height: 30px;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          border-radius: 50%;
          color: #fff;
          background: linear-gradient(135deg, #34d399, #047857);
          box-shadow: 0 8px 14px rgba(4, 120, 87, 0.28);
        }
        .piano-page .piano-command-message-row {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }
        .piano-page .piano-reselect-btn {
          cursor: pointer;
          letter-spacing: 0.5px;
          white-space: nowrap;
          transition: transform 0.2s ease, background 0.2s ease;
        }
        .piano-page .piano-reselect-btn:hover {
          background: rgba(255, 255, 255, 0.9);
          transform: translateY(-1px);
        }

        /* ───────── 主容器 ───────── */
        .piano-page .piano-container {
          position: relative;
          z-index: 1;
          max-width: 1360px;
          margin: 0 auto;
          padding: 22px 48px 92px;
          display: flex;
          flex-direction: column;
          gap: 22px;
        }
        .piano-page .piano-error-banner {
          border-radius: 20px;
          border: 1px solid rgba(254, 202, 202, 0.9);
          background: rgba(254, 242, 242, 0.92);
          padding: 14px 16px;
          color: #be123c;
          font-size: 14px;
          font-weight: 800;
        }
        .piano-page .piano-command-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          border-radius: 28px;
          border: 1px solid rgba(167, 243, 208, 0.9);
          background: rgba(255, 255, 255, 0.78);
          padding: 16px 18px;
          box-shadow: 0 18px 46px rgba(15, 23, 42, 0.07);
          backdrop-filter: blur(16px);
        }
        .piano-page .piano-command-actions {
          display: flex;
          flex-shrink: 0;
          gap: 10px;
        }
        .piano-page .piano-action-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          border-radius: 999px;
          border: 1px solid #a7f3d0;
          background: #fff;
          padding: 9px 16px;
          color: #047857;
          font-size: 14px;
          font-weight: 800;
          cursor: pointer;
          transition: background 0.2s ease, transform 0.2s ease;
        }
        .piano-page .piano-action-btn:hover {
          background: #ecfdf5;
          transform: translateY(-1px);
        }
        .piano-page .piano-action-btn.danger {
          border-color: #fecdd3;
          color: #be123c;
        }
        .piano-page .piano-action-btn.danger:hover {
          background: #fff1f2;
        }

        /* ───────── 通用卡片 ───────── */
        .piano-page .glass-card {
          border: 1px solid rgba(255, 255, 255, 0.82);
          background: rgba(255, 255, 255, 0.82);
          box-shadow: 0 22px 60px rgba(15, 23, 42, 0.1);
          backdrop-filter: blur(18px);
        }
        .piano-page .stage-card {
          padding: 22px;
          border-radius: 30px;
        }
        .piano-page .piano-stage-head {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 18px;
        }
        .piano-page .piano-section-title {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 0;
          font-size: 20px;
          font-weight: 950;
          color: #0f172a;
        }
        .piano-page .piano-st-icon {
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
        .piano-page .piano-cute-pill {
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
        .piano-page .piano-library-head-side {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 10px;
        }

        /* ───────── 琴键装饰条（钢琴块专属） ───────── */
        .piano-page .piano-keys-strip {
          position: relative;
          height: 16px;
          margin-bottom: 16px;
          border-radius: 999px;
          overflow: hidden;
          background: repeating-linear-gradient(90deg, #ffffff 0px, #ffffff 26px, #e2e8f0 26px, #e2e8f0 27px);
          border: 1px solid #e2e8f0;
          box-shadow: inset 0 -3px 6px rgba(15, 23, 42, 0.06);
        }
        .piano-page .piano-keys-strip::after {
          content: '';
          position: absolute;
          top: 0;
          left: 18px;
          right: 0;
          height: 62%;
          background: repeating-linear-gradient(
            90deg,
            #15181f 0px,
            #15181f 14px,
            transparent 14px,
            transparent 54px
          );
          border-radius: 0 0 3px 3px;
          opacity: 0.92;
        }

        /* ───────── 模式选择卡片 ───────── */
        .piano-page .piano-mode-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 20px;
          max-width: 940px;
          margin: 0 auto;
        }
        .piano-page .piano-mode-card {
          position: relative;
          overflow: hidden;
          min-height: 236px;
          border-width: 4px;
          border-style: solid;
          border-radius: 32px;
          background: rgba(255, 255, 255, 0.8);
          padding: 22px;
          text-align: left;
          box-shadow: 0 18px 34px rgba(15, 23, 42, 0.06);
          backdrop-filter: blur(14px);
          cursor: pointer;
          transition: transform 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
          animation: piano-card-in 0.42s ease both;
        }
        @keyframes piano-card-in {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .piano-page .piano-mode-card:hover {
          transform: translateY(-6px);
          border-color: #fff;
          box-shadow: 0 24px 44px rgba(15, 23, 42, 0.1);
        }
        .piano-page .piano-mode-card:active {
          transform: scale(0.98);
        }
        .piano-page .piano-mode-card.classic {
          border-color: #a7f3d0;
        }
        .piano-page .piano-mode-card.rush {
          border-color: #fde68a;
        }
        .piano-page .piano-mode-card.is-selected {
          border-color: #fff;
          box-shadow: 0 20px 42px rgba(16, 185, 129, 0.18), 0 0 0 3px rgba(16, 185, 129, 0.24);
        }
        .piano-page .piano-mode-card.rush.is-selected {
          box-shadow: 0 20px 42px rgba(245, 158, 11, 0.2), 0 0 0 3px rgba(245, 158, 11, 0.26);
        }
        .piano-page .piano-mode-glow {
          position: absolute;
          inset: 0;
          opacity: 0;
          transition: opacity 0.5s ease;
        }
        .piano-page .piano-mode-glow.classic {
          background: linear-gradient(135deg, #34d399, #059669);
        }
        .piano-page .piano-mode-glow.rush {
          background: linear-gradient(135deg, #fbbf24, #d97706);
        }
        .piano-page .piano-mode-card:hover .piano-mode-glow,
        .piano-page .piano-mode-card.is-selected .piano-mode-glow {
          opacity: 1;
        }
        .piano-page .mode-content {
          position: relative;
          z-index: 1;
          display: flex;
          min-height: 192px;
          flex-direction: column;
        }
        .piano-page .mode-topline {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 14px;
        }
        .piano-page .mode-icon {
          display: inline-flex;
          width: 52px;
          height: 52px;
          align-items: center;
          justify-content: center;
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.56);
          filter: drop-shadow(0 8px 12px rgba(15, 23, 42, 0.1));
          transition: transform 0.3s ease, background 0.3s ease, color 0.3s ease;
        }
        .piano-page .mode-icon svg {
          width: 25px;
          height: 25px;
          stroke-width: 2.4;
        }
        .piano-page .mode-icon.classic {
          color: #047857;
        }
        .piano-page .mode-icon.rush {
          color: #b45309;
        }
        .piano-page .piano-mode-card:hover .mode-icon,
        .piano-page .piano-mode-card.is-selected .mode-icon {
          transform: scale(1.08) rotate(8deg);
          background: rgba(255, 255, 255, 0.22);
          color: #fff;
        }
        .piano-page .mode-duration-pill {
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.54);
          padding: 5px 11px;
          font-size: 11px;
          font-weight: 950;
          letter-spacing: 0.8px;
          backdrop-filter: blur(10px);
          transition: background 0.3s ease, color 0.3s ease;
        }
        .piano-page .mode-duration-pill.classic {
          color: #047857;
        }
        .piano-page .mode-duration-pill.rush {
          color: #b45309;
        }
        .piano-page .piano-mode-card:hover .mode-duration-pill,
        .piano-page .piano-mode-card.is-selected .mode-duration-pill {
          background: rgba(255, 255, 255, 0.22);
          color: #fff;
        }
        .piano-page .mode-copy {
          display: flex;
          min-width: 0;
          flex-direction: column;
          gap: 7px;
        }
        .piano-page .mode-label {
          font-size: 28px;
          font-weight: 950;
          line-height: 1;
          transition: color 0.3s ease;
        }
        .piano-page .mode-label.classic {
          color: #047857;
        }
        .piano-page .mode-label.rush {
          color: #b45309;
        }
        .piano-page .mode-summary {
          color: #64748b;
          font-size: 13px;
          font-weight: 800;
          line-height: 1.55;
          transition: color 0.3s ease;
        }
        .piano-page .piano-mode-card:hover .mode-label,
        .piano-page .piano-mode-card.is-selected .mode-label {
          color: #fff;
        }
        .piano-page .piano-mode-card:hover .mode-summary,
        .piano-page .piano-mode-card.is-selected .mode-summary {
          color: rgba(255, 255, 255, 0.9);
        }
        .piano-page .mode-selected-pill {
          display: inline-flex;
          width: fit-content;
          min-height: 32px;
          align-items: center;
          gap: 8px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.7);
          padding: 7px 12px;
          color: #334155;
          font-size: 12px;
          font-weight: 950;
          opacity: 0.72;
          transition: background 0.3s ease, color 0.3s ease, opacity 0.3s ease;
          margin-top: 14px;
        }
        .piano-page .piano-mode-card:hover .mode-selected-pill,
        .piano-page .mode-selected-pill.is-visible {
          background: rgba(255, 255, 255, 0.22);
          color: #fff;
          opacity: 1;
        }
        .piano-page .mode-stats {
          display: grid;
          gap: 7px;
          margin-top: auto;
          border-top: 1px solid rgba(226, 232, 240, 0.88);
          padding-top: 13px;
          transition: border-color 0.3s ease;
        }
        .piano-page .mode-stats > span {
          display: flex;
          min-width: 0;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          color: #64748b;
          font-size: 13px;
          font-weight: 850;
          transition: color 0.3s ease;
        }
        .piano-page .mode-stats strong {
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.46);
          padding: 3px 7px;
          color: #334155;
          font-size: 12px;
          font-weight: 950;
          transition: background 0.3s ease, color 0.3s ease;
        }
        .piano-page .piano-mode-card:hover .mode-stats,
        .piano-page .piano-mode-card.is-selected .mode-stats {
          border-color: rgba(255, 255, 255, 0.24);
        }
        .piano-page .piano-mode-card:hover .mode-stats > span,
        .piano-page .piano-mode-card.is-selected .mode-stats > span {
          color: rgba(255, 255, 255, 0.76);
        }
        .piano-page .piano-mode-card:hover .mode-stats strong,
        .piano-page .piano-mode-card.is-selected .mode-stats strong {
          background: rgba(255, 255, 255, 0.2);
          color: #fff;
        }

        /* ───────── 曲库 ───────── */
        .piano-page .piano-library-toolbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 10px;
          margin-bottom: 14px;
        }
        .piano-page .piano-search-wrap {
          position: relative;
          flex: 1 1 260px;
          min-width: 0;
        }
        .piano-page .piano-search-icon {
          position: absolute;
          left: 14px;
          top: 50%;
          transform: translateY(-50%);
          width: 16px;
          height: 16px;
          color: #94a3b8;
          pointer-events: none;
        }
        .piano-page .piano-search-wrap input {
          width: 100%;
          border-radius: 999px;
          border: 1px solid rgba(203, 213, 225, 0.9);
          background: rgba(255, 255, 255, 0.9);
          padding: 10px 16px 10px 38px;
          font-size: 14px;
          font-weight: 700;
          color: #0f172a;
          outline: none;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .piano-page .piano-search-wrap input::placeholder {
          color: #94a3b8;
          font-weight: 600;
        }
        .piano-page .piano-search-wrap input:focus {
          border-color: #34d399;
          box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.18);
        }
        .piano-page .piano-filter-chips {
          display: flex;
          flex-wrap: nowrap;
          gap: 6px;
          overflow-x: auto;
          max-width: 100%;
          padding-bottom: 2px;
          scrollbar-width: none;
        }
        .piano-page .piano-filter-chips::-webkit-scrollbar {
          display: none;
        }
        .piano-page .piano-filter-chip {
          flex: 0 0 auto;
          border-radius: 999px;
          border: 1px solid rgba(203, 213, 225, 0.9);
          background: rgba(255, 255, 255, 0.88);
          padding: 8px 13px;
          color: #475569;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.5px;
          cursor: pointer;
          transition: all 0.2s ease;
          white-space: nowrap;
        }
        .piano-page .piano-filter-chip:hover {
          border-color: #6ee7b7;
          color: #047857;
        }
        .piano-page .piano-filter-chip.is-active {
          border-color: #059669;
          background: linear-gradient(135deg, #34d399, #059669);
          color: #fff;
          box-shadow: 0 8px 16px rgba(5, 150, 105, 0.25);
        }
        .piano-page .piano-song-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 56vh;
          overflow-y: auto;
          padding-right: 4px;
          overscroll-behavior: contain;
        }
        .piano-page .piano-song-row {
          display: flex;
          align-items: center;
          gap: 14px;
          width: 100%;
          border-radius: 18px;
          border: 1px solid rgba(226, 232, 240, 0.9);
          background: rgba(255, 255, 255, 0.88);
          padding: 10px 14px;
          text-align: left;
          cursor: pointer;
          transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .piano-page .piano-song-row:hover {
          transform: translateY(-2px);
          border-color: #6ee7b7;
          box-shadow: 0 14px 26px rgba(5, 150, 105, 0.12);
        }
        .piano-page .piano-song-tilemini {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 2px;
          width: 34px;
          height: 44px;
          flex-shrink: 0;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          background: #fbfbfd;
          padding: 3px;
        }
        .piano-page .piano-song-tilemini i {
          border-radius: 3px;
          background: #eef2f7;
        }
        .piano-page .piano-song-tilemini i.on {
          background: #15181f;
        }
        .piano-page .piano-song-info {
          display: flex;
          min-width: 0;
          flex: 1;
          flex-direction: column;
          gap: 3px;
        }
        .piano-page .piano-song-title {
          font-size: 15px;
          font-weight: 900;
          color: #0f172a;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .piano-page .piano-song-meta {
          font-size: 12px;
          font-weight: 700;
          color: #64748b;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .piano-page .piano-song-side {
          display: flex;
          flex-shrink: 0;
          align-items: center;
          gap: 12px;
        }
        .piano-page .piano-song-stars {
          display: inline-flex;
          gap: 2px;
          color: #f59e0b;
        }
        .piano-page .piano-song-play {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border-radius: 999px;
          background: linear-gradient(135deg, #34d399, #059669);
          padding: 7px 13px;
          color: #fff;
          font-size: 12px;
          font-weight: 900;
          opacity: 0;
          transform: translateX(4px);
          transition: opacity 0.2s ease, transform 0.2s ease;
          white-space: nowrap;
        }
        .piano-page .piano-song-row:hover .piano-song-play,
        .piano-page .piano-song-row:focus-visible .piano-song-play {
          opacity: 1;
          transform: translateX(0);
        }
        .piano-page .piano-library-empty {
          padding: 42px 16px;
          text-align: center;
          color: #64748b;
          font-size: 14px;
          font-weight: 800;
        }
        .piano-page .piano-library-note {
          padding: 12px;
          text-align: center;
          color: #94a3b8;
          font-size: 12px;
          font-weight: 700;
        }

        /* ───────── 加载 ───────── */
        .piano-page .piano-loading-stage {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          padding: 48px 22px;
          text-align: center;
        }
        .piano-page .piano-loading-icon {
          display: inline-flex;
          width: 68px;
          height: 68px;
          align-items: center;
          justify-content: center;
          border-radius: 22px;
          color: #fff;
          background: linear-gradient(135deg, #34d399, #047857);
          box-shadow: 0 18px 34px rgba(5, 150, 105, 0.28);
        }
        .piano-page .piano-loading-stage h2 {
          margin: 6px 0 0;
          font-size: 22px;
          font-weight: 950;
          color: #0f172a;
        }
        .piano-page .piano-loading-stage p {
          margin: 0;
          color: #64748b;
          font-size: 14px;
          font-weight: 800;
        }
        .piano-page .piano-loading-bar {
          width: min(320px, 80%);
          height: 10px;
          margin-top: 8px;
          border-radius: 999px;
          background: #e2e8f0;
          overflow: hidden;
        }
        .piano-page .piano-loading-bar > div {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #34d399, #059669);
          transition: width 0.25s ease;
        }
        .piano-page .piano-loading-tip {
          color: #94a3b8;
          font-size: 12px;
          font-weight: 800;
        }

        /* ───────── 演奏舞台 ───────── */
        .piano-page .piano-game-body {
          display: flex;
          flex-direction: column;
        }
        .piano-page .piano-stage-col {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .piano-page .piano-status-dock {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 18px;
          align-items: center;
          border-radius: 24px;
          border: 1px solid rgba(209, 250, 229, 0.86);
          background: linear-gradient(180deg, rgba(236, 253, 245, 0.96), rgba(255, 255, 255, 0.94));
          padding: 16px;
          margin-bottom: 18px;
        }
        .piano-page .piano-phase-pill {
          border-radius: 999px;
          background: #059669;
          padding: 4px 12px;
          color: #fff;
          font-size: 12px;
          font-weight: 900;
        }
        .piano-page .piano-phase-pill.is-paused {
          background: #f59e0b;
        }
        .piano-page .piano-status-metrics {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
        }
        .piano-page .piano-metric {
          border-radius: 18px;
          border: 1px solid rgba(226, 232, 240, 0.8);
          background: rgba(255, 255, 255, 0.78);
          padding: 10px 12px;
        }
        .piano-page .piano-dock-actions {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .piano-page .piano-pause-btn {
          display: inline-flex;
          height: 44px;
          min-width: 116px;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border-radius: 16px;
          background: #059669;
          padding: 0 18px;
          color: #fff;
          font-size: 14px;
          font-weight: 900;
          cursor: pointer;
          box-shadow: 0 12px 24px rgba(5, 150, 105, 0.28);
          transition: transform 0.2s ease, background 0.2s ease;
        }
        .piano-page .piano-pause-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          background: #10b981;
        }
        .piano-page .piano-pause-btn:disabled {
          cursor: not-allowed;
          background: rgba(5, 150, 105, 0.35);
          box-shadow: none;
        }
        .piano-page .piano-giveup-btn {
          display: inline-flex;
          height: 44px;
          min-width: 116px;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border-radius: 16px;
          border: 1px solid #fecdd3;
          background: #fff;
          padding: 0 18px;
          color: #be123c;
          font-size: 14px;
          font-weight: 900;
          cursor: pointer;
          transition: transform 0.2s ease, background 0.2s ease;
        }
        .piano-page .piano-giveup-btn:hover {
          transform: translateY(-1px);
          background: #fff1f2;
        }
        .piano-page .piano-stage-wrap {
          display: flex;
          justify-content: center;
        }
        .piano-page .piano-canvas-frame {
          position: relative;
          width: 100%;
        }
        .piano-page .piano-canvas {
          display: block;
          width: 100%;
          border-radius: 16px;
          border: 1px solid #e2e8f0;
          background: #fff;
          box-shadow: 0 22px 44px rgba(15, 23, 42, 0.12);
          touch-action: none;
          user-select: none;
          -webkit-user-select: none;
        }
        .piano-page .piano-pause-overlay {
          position: absolute;
          inset: 0;
          z-index: 5;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 6px;
          border-radius: 16px;
          background: rgba(15, 23, 42, 0.55);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          padding: 20px;
          text-align: center;
        }
        .piano-page .piano-pause-icon {
          display: inline-flex;
          width: 64px;
          height: 64px;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          color: #fff;
          background: rgba(255, 255, 255, 0.16);
          border: 1px solid rgba(255, 255, 255, 0.35);
          margin-bottom: 6px;
        }
        .piano-page .piano-pause-overlay h3 {
          margin: 0;
          color: #fff;
          font-size: 24px;
          font-weight: 950;
        }
        .piano-page .piano-pause-overlay p {
          margin: 0 0 12px;
          color: rgba(255, 255, 255, 0.82);
          font-size: 13px;
          font-weight: 800;
        }
        .piano-page .piano-pause-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 10px;
        }
        .piano-page .piano-stage-hint {
          margin: 14px auto 0;
          max-width: 620px;
          text-align: center;
          color: #94a3b8;
          font-size: 12px;
          font-weight: 800;
        }

        /* ───────── 规则弹窗 ───────── */
        .piano-page .piano-modal-overlay {
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
        .piano-page .piano-rules-modal {
          width: min(720px, 100%);
          max-height: min(86vh, 680px);
          overflow-y: auto;
          border-radius: 28px;
          border: 1px solid rgba(167, 243, 208, 0.95);
          background: linear-gradient(180deg, #fff 0%, #ecfdf5 100%);
          padding: 24px;
          box-shadow: 0 30px 70px rgba(15, 23, 42, 0.3);
        }

        /* ───────── 响应式 ───────── */
        @media (min-width: 1081px) {
          .piano-page .piano-game-body {
            display: grid;
            grid-template-columns: 340px minmax(0, 1fr);
            gap: 20px;
            align-items: start;
          }
          .piano-page .piano-status-dock {
            grid-template-columns: 1fr;
            gap: 14px;
            margin-bottom: 0;
          }
          .piano-page .piano-status-metrics {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .piano-page .piano-dock-actions {
            flex-direction: column;
          }
          .piano-page .piano-dock-actions button {
            width: 100%;
          }
        }
        @media (max-width: 1080px) {
          .piano-page .piano-container {
            padding: 22px 22px 82px;
          }
          .piano-page .piano-status-dock {
            grid-template-columns: 1fr;
          }
          .piano-page .piano-dock-actions {
            flex-direction: row;
          }
          .piano-page .piano-dock-actions button {
            flex: 1;
          }
        }
        @media (max-width: 768px) {
          .piano-page .piano-topbar {
            padding: 12px 14px;
            padding-top: max(12px, env(safe-area-inset-top));
          }
          .piano-page .piano-exit-btn {
            padding: 7px 14px 7px 7px;
            font-size: 12px;
          }
          .piano-page .piano-exit-btn .arrow {
            width: 26px;
            height: 26px;
          }
          .piano-page .piano-container {
            padding: 16px 14px 92px;
            gap: 18px;
          }
          .piano-page .stage-card {
            padding: 14px;
            border-radius: 24px;
          }
          .piano-page .piano-command-bar {
            align-items: stretch;
            flex-direction: column;
            padding: 14px;
          }
          .piano-page .piano-command-actions {
            display: grid;
            grid-template-columns: 1fr;
            gap: 8px;
          }
          .piano-page .piano-command-actions button,
          .piano-page .piano-command-actions a {
            width: 100%;
          }
          .piano-page .piano-stage-head {
            flex-direction: column;
            align-items: stretch;
            gap: 10px;
            margin-bottom: 14px;
          }
          .piano-page .piano-cute-pill {
            width: 100%;
            justify-content: center;
          }
          .piano-page .piano-library-head-side {
            flex-direction: column;
            align-items: stretch;
          }
          .piano-page .piano-mode-grid {
            grid-template-columns: 1fr;
            gap: 14px;
          }
          .piano-page .piano-mode-card {
            min-height: 0;
            border-radius: 26px;
            padding: 18px;
          }
          .piano-page .mode-content {
            min-height: 0;
          }
          .piano-page .mode-label {
            font-size: 24px;
          }
          .piano-page .mode-stats {
            margin-top: 14px;
          }
          .piano-page .piano-song-list {
            max-height: 52vh;
          }
          .piano-page .piano-song-row {
            flex-wrap: wrap;
            gap: 10px;
            padding: 10px 12px;
          }
          .piano-page .piano-song-info {
            flex: 1 1 60%;
          }
          .piano-page .piano-song-side {
            width: 100%;
            justify-content: space-between;
            padding-left: 44px;
          }
          .piano-page .piano-song-play {
            opacity: 1;
            transform: none;
          }
          .piano-page .piano-status-metrics {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .piano-page .piano-dock-actions {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .piano-page .piano-dock-actions button {
            width: 100%;
            min-width: 0;
          }
          .piano-page .piano-rules-modal {
            border-radius: 22px;
            padding: 18px;
          }
          /* 手机端演奏全屏：游戏卡片覆盖整个视口，画布铺满剩余空间 */
          .piano-page.is-inround .piano-topbar {
            display: none;
          }
          .piano-page .piano-game-card {
            position: fixed;
            inset: 0;
            z-index: 60;
            border: none;
            border-radius: 0;
            padding: 0;
            overflow: hidden;
          }
          .piano-page .piano-game-body {
            display: flex;
            flex-direction: column;
            height: 100vh;
            height: 100dvh;
          }
          .piano-page .piano-status-dock {
            margin: 0;
            gap: 10px;
            border: none;
            border-bottom: 1px solid rgba(209, 250, 229, 0.86);
            border-radius: 0;
            padding: 10px 12px;
            padding-top: max(10px, env(safe-area-inset-top));
          }
          .piano-page .piano-status-metrics {
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 6px;
          }
          .piano-page .piano-metric {
            border-radius: 12px;
            padding: 6px 8px;
          }
          .piano-page .piano-stage-col {
            flex: 1;
            min-height: 0;
          }
          .piano-page .piano-stage-wrap {
            height: 100%;
          }
          .piano-page .piano-canvas-frame {
            max-width: none !important;
            width: 100%;
            height: 100%;
          }
          .piano-page .piano-canvas {
            height: 100%;
            aspect-ratio: auto !important;
            border: none;
            border-radius: 0;
            box-shadow: none;
          }
          .piano-page .piano-pause-overlay {
            border-radius: 0;
          }
          .piano-page .piano-stage-hint {
            display: none;
          }
        }
        @media (max-width: 480px) {
          .piano-page .piano-section-title {
            font-size: 18px;
          }
          .piano-page .piano-song-meta {
            white-space: normal;
          }
          .piano-page .piano-song-side {
            padding-left: 0;
          }
          .piano-page .piano-pause-actions button {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}

function DockMetric({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  tone: string;
}) {
  return (
    <div className="piano-metric">
      <div className={`flex items-center gap-1.5 text-xs font-black ${tone}`}>
        {icon}
        {label}
      </div>
      <div className="mt-1 truncate text-lg font-black tabular-nums text-slate-900">{value}</div>
    </div>
  );
}

function PianoRulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="piano-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="piano-rules-title">
      <div className="piano-rules-modal">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
              <BookOpen className="h-4 w-4" />
              玩法说明
            </div>
            <h2 id="piano-rules-title" className="text-2xl font-black text-slate-950">
              钢琴块规则
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              点击下落的黑色音块演奏旋律，音乐会跟随你的指尖推进。成绩由服务端按事件流复算后发放福利积分。
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:text-slate-900"
            type="button"
            aria-label="关闭规则"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="piano-keys-strip" aria-hidden />

        <div className="grid gap-3 sm:grid-cols-2">
          <PianoRuleCard
            icon={<Music />}
            title="基本玩法"
            text="黑色音块沿四条琴道滚落，在其滑出屏幕前点击即可奏响音符，每击中 1 块 +1 分；音块进入屏幕后就可以提前点击。"
          />
          <PianoRuleCard
            icon={<Sparkles />}
            title="长按音块"
            text={`带粉橙色滑轨的长音块点中后需按住不放：滑轨划满可额外获得 +${HOLD_BONUS_MAX} 分，中途松手按已划进度计分。`}
          />
          <PianoRuleCard
            icon={<X />}
            title="失败判定"
            text="点到白色琴道（点错列）或让黑块滑出屏幕底部（漏块），本局立即失败并进入结算，两种模式判定一致。"
          />
          <PianoRuleCard
            icon={<Crown />}
            title="皇冠与提速"
            text={`每完整演奏一圈曲目获得 1 顶皇冠（最多 ${MAX_CROWNS} 顶），每圈滚动速度提升 ${Math.round(LAP_SPEED_STEP * 100)}%，越弹越快。`}
          />
          <PianoRuleCard
            icon={<Timer />}
            title="双模式"
            text={`经典模式无限循环直到失误；限时冲刺 ${Math.round(RUSH_DURATION_MS / 1000)} 秒到时自动结算，用同样的判定冲击更高分。`}
          />
          <PianoRuleCard
            icon={<Trophy />}
            title="积分结算"
            text="福利积分 = 得分 ÷ 8（四舍五入）+ 皇冠 × 15，单局最多 200 分；实际到账受每日积分上限影响，结算后有 5 秒冷却。"
          />
        </div>

        <p className="mt-4 rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-xs font-bold leading-5 text-slate-500">
          小提示：演奏中可随时暂停，音乐、计时与判定会一并冻结；开始游戏需要先登录，成绩由服务端复核后发放积分。
        </p>
      </div>
    </div>
  );
}

function PianoRuleCard({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <article className="rounded-2xl border border-emerald-100 bg-white/80 p-4">
      <div className="mb-2 flex items-center gap-2 font-black text-slate-950">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 [&_svg]:h-4 [&_svg]:w-4">
          {icon}
        </span>
        {title}
      </div>
      <p className="text-sm leading-6 text-slate-600">{text}</p>
    </article>
  );
}
