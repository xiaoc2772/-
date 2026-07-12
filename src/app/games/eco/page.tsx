'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Recycle,
  Home,
  BookOpen,
  Bot,
  Gauge,
  Sparkles,
  Package,
  ShoppingBag,
  ArrowUp,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import type {
  EcoItemKey,
  EcoPrizeKey,
  EcoStatusResponse,
  EcoUpgradeKey,
  EcoVisiblePrizeView,
} from '@/lib/types/eco';
import type { PublicAchievement } from '@/lib/profile-achievements';
import {
  LUCKY_FLASHLIGHT_GENERATIONS,
  RECYCLE_GLOVE_USES,
} from '@/lib/eco-engine';

// 5 种垃圾外观
const TRASH_KINDS = ['bottle', 'can', 'glass', 'paper', 'banana'] as const;
type TrashKind = (typeof TRASH_KINDS)[number];
const TRASH_SRC: Record<TrashKind, string> = {
  bottle: '/images-optimized/ui/games/eco/trash-bottle.webp?v=3',
  can: '/images-optimized/ui/games/eco/trash-can.webp?v=3',
  glass: '/images-optimized/ui/games/eco/trash-glass.webp?v=3',
  paper: '/images-optimized/ui/games/eco/trash-paper.webp?v=3',
  banana: '/images-optimized/ui/games/eco/trash-banana.webp?v=3',
};
const BIN_CLOSED = '/images-optimized/ui/games/eco/bin-closed.webp?v=3';
const BIN_OPEN = '/images-optimized/ui/games/eco/bin-open.webp?v=3';

const VISUAL_MAX = 10;
const SYNC_INTERVAL_MS = 12_000;
const GROW_INTERVAL_MS = 1_000;
const FLUSH_DEBOUNCE_MS = 650;
const FLUSH_THRESHOLD = 8;
const CHINA_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

interface TrashBoardItem {
  id: string;
  type: 'trash';
  kind: TrashKind;
  x: number;
  y: number;
  rot: number;
}

interface PrizeBoardItem {
  id: string;
  type: 'prize';
  prizeId: string;
  prizeKey: EcoPrizeKey;
  emoji: string;
  imageSrc: string;
  name: string;
  x: number;
  y: number;
  rot: number;
}

type BoardItem = TrashBoardItem | PrizeBoardItem;
type EcoPublicBoardEntry = EcoStatusResponse['publicBoard']['entries'][number];

interface FloatPop {
  id: number;
  x: number;
  y: number;
  text: string;
}

interface TopUser {
  id: number;
  name: string;
  fallbackName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  equippedAchievement: PublicAchievement | null;
}

interface AuthMeUser {
  id: number;
  username: string;
  displayName?: string;
  isAdmin?: boolean;
}

interface ProfileUpdatedDetail {
  displayName?: string | null;
  avatarUrl?: string | null;
  equippedAchievement?: PublicAchievement | null;
}

let itemSeq = 1;
let popSeq = 1;

function makeTrashItem(): TrashBoardItem {
  // 偏向落在草地/山丘区域（中下部），像散落的垃圾
  const seq = itemSeq++;
  const x = 8 + Math.floor(Math.random() * 74);
  const y = 30 + Math.floor(Math.random() * 44);
  const rot = -18 + Math.floor(Math.random() * 36);
  return { id: `trash-${Date.now().toString(36)}-${seq}`, type: 'trash', kind: TRASH_KINDS[seq % TRASH_KINDS.length], x, y, rot };
}

function makePrizeItem(prize: EcoVisiblePrizeView): PrizeBoardItem {
  const x = 12 + Math.floor(Math.random() * 68);
  const y = 26 + Math.floor(Math.random() * 48);
  const rot = -10 + Math.floor(Math.random() * 20);
  return {
    id: `prize-${prize.id}`,
    type: 'prize',
    prizeId: prize.id,
    prizeKey: prize.key,
    emoji: prize.emoji,
    imageSrc: prize.imageSrc,
    name: prize.name,
    x,
    y,
    rot,
  };
}

type PrizeHistory = EcoStatusResponse['prizes'][number]['priceHistory'];

/** Catmull-Rom → 三次贝塞尔，把折线平滑成曲线路径 */
function buildSmoothLine(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  const d = [`M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d.push(
      `C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
    );
  }
  return d.join(' ');
}

function getMsUntilNextChinaMidnight(serverNow: number): number {
  const chinaNow = new Date(serverNow + CHINA_TZ_OFFSET_MS);
  const nextChinaMidnight = new Date(chinaNow);
  nextChinaMidnight.setUTCDate(chinaNow.getUTCDate() + 1);
  nextChinaMidnight.setUTCHours(0, 0, 0, 0);
  const nextMidnightUtc = nextChinaMidnight.getTime() - CHINA_TZ_OFFSET_MS;
  return Math.max(1000, nextMidnightUtc - serverNow);
}

function getEffectProgressPercent(remaining: number, baseTotal: number): number {
  if (remaining <= 0 || baseTotal <= 0) return 0;
  return Math.min(100, Math.round((remaining / baseTotal) * 100));
}

function PriceSparkline({
  history,
  selectedDate,
  onSelectDate,
}: {
  history: PrizeHistory;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}) {
  const prices = history.map((point) => point.price);
  if (prices.length === 0) {
    return <div className="sparkline-empty">暂无行情数据</div>;
  }

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const axisMin = Math.floor(min);
  const axisMax = Math.max(axisMin + 1, Math.ceil(max));
  const axisSpan = Math.max(1, axisMax - axisMin);
  const tickCount = Math.min(4, axisSpan + 1);
  const yTicks = Array.from({ length: tickCount }, (_, index) => {
    const value = Math.round(axisMax - (axisSpan * index) / Math.max(1, tickCount - 1));
    return { value, ratio: (axisMax - value) / axisSpan };
  });

  const chartInset = 4;
  const chartWidth = 100 - chartInset * 2;
  const plotted = history.map((point, index) => {
    const x = history.length <= 1 ? 50 : chartInset + (index / (history.length - 1)) * chartWidth;
    const y = 100 - ((point.price - axisMin) / axisSpan) * 100;
    return { point, x, y };
  });
  const linePath = buildSmoothLine(plotted);
  const first = plotted[0];
  const last = plotted[plotted.length - 1];
  const areaPath = `${linePath} L ${last.x.toFixed(2)} 100 L ${first.x.toFixed(2)} 100 Z`;
  const fallbackDate = plotted[plotted.length - 1]?.point.date ?? null;
  const activeDate = selectedDate && plotted.some(({ point }) => point.date === selectedDate)
    ? selectedDate
    : fallbackDate;

  return (
    <div className="sparkline">
      <div className="sparkline-chart">
        <div className="sparkline-y-labels" aria-hidden>
          {yTicks.map(({ ratio, value }) => (
            <span
              key={ratio}
              style={{
                top: `${ratio * 100}%`,
                transform: ratio === 0 ? 'translateY(0)' : ratio === 1 ? 'translateY(-100%)' : 'translateY(-50%)',
              }}
            >
              {value}
            </span>
          ))}
        </div>
        <div className="sparkline-plot">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            <defs>
              <linearGradient id="eco-spark-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.32} />
                <stop offset="55%" stopColor="#2dd4bf" stopOpacity={0.12} />
                <stop offset="100%" stopColor="#5eead4" stopOpacity={0} />
              </linearGradient>
            </defs>
            {yTicks.map(({ ratio }) => (
              <line
                key={ratio}
                className="sparkline-grid"
                x1={chartInset}
                y1={ratio * 100}
                x2={100 - chartInset}
                y2={ratio * 100}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <path className="sparkline-area" d={areaPath} fill="url(#eco-spark-fill)" />
            <path className="sparkline-line" d={linePath} vectorEffect="non-scaling-stroke" />
          </svg>
          {plotted.map(({ point, x, y }) => (
            <button
              key={point.date}
              type="button"
              className={point.date === activeDate ? 'sparkline-node selected' : 'sparkline-node'}
              title={`${point.date} · ${point.price} 积分 · 前一天收集 ${point.previousDayClaimCount}`}
              style={{ left: `${x}%`, top: `${y}%` }}
              onClick={() => onSelectDate(point.date)}
              aria-label={`${point.date} 价格 ${point.price} 积分，前一天全服收集 ${point.previousDayClaimCount}`}
            />
          ))}
        </div>
      </div>
      <div className="sparkline-date-row">
        <span aria-hidden />
        <div className="sparkline-date-labels">
          {plotted.map(({ point, x }) => (
            <span key={point.date} style={{ left: `${x}%` }}>
              {point.date.slice(5).replace('-', '/')}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function EcoPage() {
  const router = useRouter();
  const [status, setStatus] = useState<EcoStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [board, setBoard] = useState<BoardItem[]>([]);
  const [pops, setPops] = useState<FloatPop[]>([]);
  const [drag, setDrag] = useState<{ id: string; kind: TrashKind; x: number; y: number } | null>(null);
  const [binActive, setBinActive] = useState(false);
  const [binEat, setBinEat] = useState(0);
  const [shopTab, setShopTab] = useState<'upgrade' | 'item'>('upgrade');
  const [activeModal, setActiveModal] = useState<'shop' | 'bag' | 'rules' | 'claim' | 'steal' | null>(null);
  const [selectedPricePrizeKey, setSelectedPricePrizeKey] = useState<EcoPrizeKey>('diamond');
  const [selectedPriceDate, setSelectedPriceDate] = useState<string | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [selling, setSelling] = useState<string | null>(null);
  const [offline, setOffline] = useState<EcoStatusResponse['offline']>(null);
  const [topUser, setTopUser] = useState<TopUser | null>(null);
  const [pendingClaimItem, setPendingClaimItem] = useState<PrizeBoardItem | null>(null);
  const [pendingStealEntry, setPendingStealEntry] = useState<EcoPublicBoardEntry | null>(null);
  const [theftMessage, setTheftMessage] = useState('');

  const displayPendingRef = useRef(0);
  const [displayPending, setDisplayPending] = useState(0);
  const growCarryRef = useRef(0);
  const pendingDragsRef = useRef(0);
  const inFlightDragsRef = useRef(0);
  const [, setOptimisticRevision] = useState(0);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushingRef = useRef(false);
  const yardRef = useRef<HTMLDivElement>(null);
  const binRef = useRef<HTMLDivElement>(null);
  const loginRequiredRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (loginRequiredRef.current) return;
    loginRequiredRef.current = true;
    setError(null);
    router.replace('/login?redirect=/games/eco');
  }, [router]);

  const refreshOptimisticCounters = useCallback(() => {
    setOptimisticRevision((value) => (value + 1) % 1_000_000);
  }, []);

  const setPending = useCallback((next: number) => {
    const cap = status?.storageCap ?? 9999;
    const clamped = Math.max(0, Math.min(cap, Math.floor(next)));
    displayPendingRef.current = clamped;
    setDisplayPending(clamped);
  }, [status?.storageCap]);

  const syncBoard = useCallback((target: number, visiblePrizes: EcoVisiblePrizeView[] = []) => {
    const want = Math.max(0, Math.min(VISUAL_MAX, target));
    setBoard((prev) => {
      const trash = prev.filter((item): item is TrashBoardItem => item.type === 'trash');
      let nextTrash = trash;
      if (trash.length < want) {
        nextTrash = [...trash, ...Array.from({ length: want - trash.length }, makeTrashItem)];
      } else if (trash.length > want) {
        nextTrash = trash.slice(0, want);
      }

      const prizeById = new Map(
        prev
          .filter((item): item is PrizeBoardItem => item.type === 'prize')
          .map((item) => [item.prizeId, item]),
      );
      const nextPrizes = visiblePrizes.map((prize) => prizeById.get(prize.id) ?? makePrizeItem(prize));
      return [...nextTrash, ...nextPrizes];
    });
  }, []);

  const applyStatus = useCallback((data: EcoStatusResponse, syncPending: boolean) => {
    setStatus(data);
    if (syncPending) {
      displayPendingRef.current = data.pending;
      setDisplayPending(data.pending);
      syncBoard(data.pending, data.visiblePrizes);
    }
  }, [syncBoard]);

  const loadStatus = useCallback(async (syncPending: boolean, allowPrizeSpawn = false) => {
    if (loginRequiredRef.current) return;
    try {
      const url = allowPrizeSpawn ? '/api/games/eco/status?online=1' : '/api/games/eco/status';
      const res = await fetch(url, { cache: 'no-store' });
      if (res.status === 401) {
        redirectToLogin();
        return;
      }
      const json = (await res.json().catch(() => null)) as
        | { success?: boolean; data?: EcoStatusResponse; message?: string }
        | null;
      if (!res.ok || !json?.success || !json.data) {
        throw new Error(json?.message ?? '加载失败');
      }
      applyStatus(json.data, syncPending);
      if (json.data.offline && json.data.offline.cleared > 0) {
        setOffline(json.data.offline);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误');
    }
  }, [applyStatus, redirectToLogin]);

  // 顶栏用户信息
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [meRes, settingsRes] = await Promise.all([
          fetch('/api/auth/me', { cache: 'no-store' }),
          fetch('/api/profile/settings', { cache: 'no-store' }),
        ]);
        if (meRes.status === 401) {
          redirectToLogin();
          return;
        }
        const me = (await meRes.json().catch(() => null)) as
          | { success?: boolean; user?: AuthMeUser }
          | null;
        const settings = (await settingsRes.json().catch(() => null)) as
          | {
              success?: boolean;
              data?: {
                displayName?: string | null;
                avatarUrl?: string | null;
                equippedAchievement?: PublicAchievement | null;
              };
            }
          | null;
        if (cancelled) return;
        if (me?.success && me.user) {
          const profileData = settings?.success ? settings.data : null;
          const fallbackName = me.user.displayName || me.user.username;
          setTopUser({
            id: me.user.id,
            name: profileData?.displayName || fallbackName,
            fallbackName,
            avatarUrl: profileData?.avatarUrl ?? null,
            isAdmin: Boolean(me.user.isAdmin),
            equippedAchievement: profileData?.equippedAchievement ?? null,
          });
          void loadStatus(false, false);
        }
      } catch {
        /* 顶栏降级 */
      }
    };
    void load();
    const handleProfileUpdated = (event: Event) => {
      const detail = (event as CustomEvent<ProfileUpdatedDetail>).detail;
      if (!detail) return;

      setTopUser((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          name: Object.prototype.hasOwnProperty.call(detail, 'displayName')
            ? detail.displayName || prev.fallbackName
            : prev.name,
          avatarUrl: Object.prototype.hasOwnProperty.call(detail, 'avatarUrl')
            ? detail.avatarUrl ?? null
            : prev.avatarUrl,
          equippedAchievement: Object.prototype.hasOwnProperty.call(detail, 'equippedAchievement')
            ? detail.equippedAchievement ?? null
            : prev.equippedAchievement,
        };
      });
    };

    window.addEventListener('lucky:profile-updated', handleProfileUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener('lucky:profile-updated', handleProfileUpdated);
    };
  }, [loadStatus, redirectToLogin]);

  useEffect(() => {
    void loadStatus(true);
  }, [loadStatus]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!loginRequiredRef.current && pendingDragsRef.current === 0 && !flushingRef.current && !drag) {
        void loadStatus(true, true);
      }
    }, SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadStatus, drag]);

  useEffect(() => {
    if (!status) return;
    const timer = setInterval(() => {
      const perMin = status.spawnPerMin;
      if (perMin <= 0) return;
      growCarryRef.current += (perMin / 60) * (GROW_INTERVAL_MS / 1000);
      if (growCarryRef.current >= 1) {
        const whole = Math.floor(growCarryRef.current);
        growCarryRef.current -= whole;
        const prizeSlots = status.visiblePrizes.length;
        const trashCap = Math.max(0, status.storageCap - prizeSlots);
        const next = Math.min(trashCap, displayPendingRef.current + whole);
        if (next !== displayPendingRef.current) {
          displayPendingRef.current = next;
          setDisplayPending(next);
          syncBoard(next, status.visiblePrizes);
        }
      }
    }, GROW_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [status, syncBoard]);

  const spawnPop = useCallback((text: string) => {
    const bin = binRef.current;
    const yard = yardRef.current;
    let x = 80;
    let y = 70;
    if (bin && yard) {
      const b = bin.getBoundingClientRect();
      const r = yard.getBoundingClientRect();
      x = ((b.left + b.width / 2 - r.left) / r.width) * 100;
      y = ((b.top - r.top) / r.height) * 100;
    }
    const id = popSeq++;
    setPops((prev) => [...prev, { id, x, y, text }]);
    setTimeout(() => setPops((prev) => prev.filter((p) => p.id !== id)), 950);
  }, []);

  const flushCollect = useCallback(async () => {
    if (flushingRef.current) return;
    const drags = pendingDragsRef.current;
    if (drags <= 0) return;
    pendingDragsRef.current = 0;
    inFlightDragsRef.current += drags;
    refreshOptimisticCounters();
    flushingRef.current = true;
    let completed = false;
    try {
      const res = await fetch('/api/games/eco/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drags }),
      });
      const json = (await res.json().catch(() => null)) as
        | { success?: boolean; data?: { cleared: number; pointsEarned: number; status: EcoStatusResponse }; message?: string }
        | null;
      if (res.ok && json?.success && json.data) {
        completed = true;
        inFlightDragsRef.current = Math.max(0, inFlightDragsRef.current - drags);
        refreshOptimisticCounters();
        applyStatus(json.data.status, true);
        if (json.data.pointsEarned > 0) {
          spawnPop(`+${json.data.pointsEarned} 积分`);
        }
      } else if (json?.message) {
        setError(json.message);
      }
    } catch {
      /* 失败下次同步纠正 */
    } finally {
      if (!completed) {
        inFlightDragsRef.current = Math.max(0, inFlightDragsRef.current - drags);
        pendingDragsRef.current += drags;
        refreshOptimisticCounters();
      }
      flushingRef.current = false;
      if (completed && pendingDragsRef.current > 0) {
        void flushCollect();
      }
    }
  }, [applyStatus, refreshOptimisticCounters, spawnPop]);

  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => {
      void (async () => {
        if (pendingDragsRef.current > 0) {
          await flushCollect();
        }
        await loadStatus(true, true);
      })();
    }, getMsUntilNextChinaMidnight(status.serverNow) + 250);

    return () => clearTimeout(timer);
  }, [flushCollect, loadStatus, status]);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    if (pendingDragsRef.current >= FLUSH_THRESHOLD) {
      void flushCollect();
      return;
    }
    flushTimerRef.current = setTimeout(() => {
      void flushCollect();
    }, FLUSH_DEBOUNCE_MS);
  }, [flushCollect]);

  const recycleOne = useCallback((itemId: string) => {
    setBoard((prev) => prev.filter((it) => it.id !== itemId));
    setPending(displayPendingRef.current - 1);
    setBinEat((n) => n + 1);
    pendingDragsRef.current += 1;
    refreshOptimisticCounters();
    scheduleFlush();
  }, [refreshOptimisticCounters, setPending, scheduleFlush]);

  const onPointerDown = (e: React.PointerEvent, item: TrashBoardItem) => {
    const yard = yardRef.current;
    if (!yard) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const rect = yard.getBoundingClientRect();
    setDrag({ id: item.id, kind: item.kind, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const yard = yardRef.current;
    if (!yard) return;
    const rect = yard.getBoundingClientRect();
    setDrag((d) => (d ? { ...d, x: e.clientX - rect.left, y: e.clientY - rect.top } : d));
    const bin = binRef.current;
    if (bin) {
      const b = bin.getBoundingClientRect();
      const over = e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
      setBinActive(over);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag) return;
    const bin = binRef.current;
    let recycled = false;
    if (bin) {
      const b = bin.getBoundingClientRect();
      const pad = 16;
      recycled =
        e.clientX >= b.left - pad &&
        e.clientX <= b.right + pad &&
        e.clientY >= b.top - pad &&
        e.clientY <= b.bottom + pad;
    }
    if (recycled) recycleOne(drag.id);
    setDrag(null);
    setBinActive(false);
  };

  const buy = useCallback(async (type: 'upgrade' | 'item', key: EcoUpgradeKey | EcoItemKey) => {
    setBuying(`${type}:${key}`);
    try {
      const res = await fetch('/api/games/eco/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, key }),
      });
      const json = (await res.json().catch(() => null)) as
        | { success?: boolean; data?: { status: EcoStatusResponse }; message?: string }
        | null;
      if (res.ok && json?.success && json.data) {
        applyStatus(json.data.status, true);
        setError(null);
      } else {
        setError(json?.message ?? '购买失败');
      }
    } catch {
      setError('网络错误');
    } finally {
      setBuying(null);
    }
  }, [applyStatus]);

  const openClaimPrizeModal = useCallback((item: PrizeBoardItem) => {
    setPendingClaimItem(item);
    setActiveModal('claim');
  }, []);

  const claimPrize = useCallback(async (item: PrizeBoardItem, makePublic: boolean) => {
    if (claiming) return;
    setClaiming(item.prizeId);
    try {
      const res = await fetch('/api/games/eco/claim-prize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prizeId: item.prizeId, makePublic }),
      });
      const json = (await res.json().catch(() => null)) as
        | { success?: boolean; data?: { status: EcoStatusResponse }; message?: string }
        | null;
      if (res.ok && json?.success && json.data) {
        setBoard((prev) => prev.filter((entry) => entry.id !== item.id));
        applyStatus(json.data.status, false);
        spawnPop(`${item.name} +1`);
        setPendingClaimItem(null);
        setActiveModal(null);
        setError(null);
      } else {
        setError(json?.message ?? '拾取失败');
      }
    } catch {
      setError('网络错误');
    } finally {
      setClaiming(null);
    }
  }, [applyStatus, claiming, spawnPop]);

  const sellPrize = useCallback(async (
    key: EcoPrizeKey,
    mode: 'normal' | 'merchant' | 'blackMarket' = 'normal',
  ) => {
    setSelling(key);
    try {
      const endpoint = mode === 'merchant'
        ? '/api/games/eco/merchant-sell'
        : mode === 'blackMarket'
          ? '/api/games/eco/black-market-sell'
          : '/api/games/eco/sell';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'normal' ? { key, quantity: 1 } : { key }),
      });
      const json = (await res.json().catch(() => null)) as
        | { success?: boolean; data?: { pointsEarned?: number; status: EcoStatusResponse }; message?: string }
        | null;
      if (res.ok && json?.success && json.data) {
        applyStatus(json.data.status, false);
        if ((json.data.pointsEarned ?? 0) > 0) {
          spawnPop(`+${json.data.pointsEarned} 积分`);
        }
        setError(null);
      } else {
        setError(json?.message ?? '出售失败');
      }
    } catch {
      setError('网络错误');
    } finally {
      setSelling(null);
    }
  }, [applyStatus, spawnPop]);

  const openStealModal = useCallback((entry: EcoPublicBoardEntry) => {
    if (entry.canSteal === false) {
      setError(entry.stealDisabledReason || '当前无法偷盗');
      return;
    }
    if (topUser?.id === entry.ownerUserId) {
      setError('不能偷自己的奖品');
      return;
    }
    setPendingStealEntry(entry);
    setTheftMessage('');
    setActiveModal('steal');
  }, [topUser?.id]);

  const stealPublicPrize = useCallback(async (entry: EcoPublicBoardEntry, message: string) => {
    const cleanMessage = message.trim();
    if (!cleanMessage) {
      setError('请输入偷盗留言');
      return;
    }
    try {
      const res = await fetch('/api/games/eco/steal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId: entry.id, message: cleanMessage }),
      });
      const json = (await res.json().catch(() => null)) as
        | { success?: boolean; data?: { status: EcoStatusResponse }; message?: string }
        | null;
      if (res.ok && json?.success && json.data) {
        applyStatus(json.data.status, true);
        setPendingStealEntry(null);
        setTheftMessage('');
        setActiveModal(null);
        setError(null);
      } else {
        setError(json?.message ?? '偷盗失败');
      }
    } catch {
      setError('网络错误');
    }
  }, [applyStatus]);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      if (pendingDragsRef.current > 0) void flushCollect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cap = status?.storageCap ?? 0;
  const balance = status?.points;
  const initial = (topUser?.name?.[0] ?? '?').toUpperCase();
  const navAchievement = topUser?.equippedAchievement ?? null;
  const navRoleLabel = topUser?.isAdmin ? '管理员' : '用户';
  const visiblePrizeCount = board.reduce((sum, item) => sum + (item.type === 'prize' ? 1 : 0), 0);
  const displayPendingTotal = displayPending + visiblePrizeCount;
  const bagPct = cap > 0 ? Math.min(100, Math.round((displayPendingTotal / cap) * 100)) : 0;
  const pointDivisor = Math.max(1, status?.pointDivisor ?? 10);
  const pointMultiplier = Math.max(1, status?.pointMultiplier ?? 1);
  const optimisticDragCount = pendingDragsRef.current + inFlightDragsRef.current;
  const optimisticTrash = optimisticDragCount * Math.max(1, status?.grabSize ?? 1);
  const pointRawProgress = Math.max(0, (status?.pointBuffer ?? 0) + optimisticTrash);
  const pointReadyBatches = Math.floor(pointRawProgress / pointDivisor);
  const optimisticPointsEarned = pointReadyBatches * pointMultiplier;
  const pointProgressValue = pointRawProgress % pointDivisor;
  const pointProgressPct = Math.min(100, Math.round((pointProgressValue / pointDivisor) * 100));
  const pointProgressHint = optimisticPointsEarned > 0
    ? `本次已预估 +${optimisticPointsEarned} 积分`
    : `满 ${pointDivisor} 个 +${pointMultiplier} 积分`;
  const todayTrashPoints = (status?.todayTrashPoints ?? 0) + optimisticPointsEarned;
  const activeItemEffects = [
    {
      key: 'lucky-flashlight',
      emoji: '🔦',
      name: '幸运手电',
      remaining: status?.luckyGenerationsRemaining ?? 0,
      total: LUCKY_FLASHLIGHT_GENERATIONS,
      unit: '次生成',
      tone: 'gold',
    },
    {
      key: 'recycle-glove',
      emoji: '🧤',
      name: '回收手套',
      remaining: status?.gloveUsesRemaining ?? 0,
      total: RECYCLE_GLOVE_USES,
      unit: '次拖拽',
      tone: 'teal',
    },
  ].filter((effect) => effect.remaining > 0);
  const prizeCount = status?.prizes.reduce((sum, prize) => sum + prize.inventory, 0) ?? 0;
  const selectedPricePrize = status?.prizes.find((prize) => prize.key === selectedPricePrizeKey) ?? status?.prizes[0] ?? null;
  const selectedPricePoint = selectedPricePrize
    ? selectedPricePrize.priceHistory.find((point) => point.date === selectedPriceDate)
      ?? selectedPricePrize.priceHistory[selectedPricePrize.priceHistory.length - 1]
      ?? null
    : null;
  const SelectedPriceTrendIcon = selectedPricePrize && selectedPricePrize.weekChange >= 0 ? TrendingUp : TrendingDown;

  const specs = status
    ? [
        { Icon: Gauge, label: '刷新速度', value: `${status.spawnPerMin}/分` },
        { Icon: Bot, label: '自动回收', value: status.autoPerMin > 0 ? `${status.autoPerMin}/分` : '未启用' },
        { Icon: Sparkles, label: '积分价格', value: `${status.pointDivisor}个=${status.pointMultiplier}分` },
        { Icon: Package, label: '背包宝物', value: `${prizeCount}件` },
      ]
    : [];

  return (
    <div className="eco">
      <div className="eco-bg" aria-hidden>
        <span className="leaf lf-1">🍃</span>
        <span className="leaf lf-2">🍃</span>
        <span className="leaf lf-3">♻️</span>
        <span className="leaf lf-4">🌿</span>
      </div>

      {/* TOPBAR */}
      <header className="eco-top">
        <div className="eco-brand">
          <span className="eco-brand-icon"><Recycle size={19} strokeWidth={2.6} /></span>
          <span className="eco-brand-text">环保行动</span>
        </div>
        <div className="eco-top-right">
          <button
            type="button"
            className="eco-icon-btn rules-trigger"
            onClick={() => setActiveModal('rules')}
            aria-label="查看环保行动规则"
            title="环保行动规则"
          >
            <BookOpen size={16} strokeWidth={2.2} />
          </button>
          <Link href="/" className="eco-icon-btn" aria-label="返回首页" title="返回首页"><Home size={16} strokeWidth={2.2} /></Link>
          <Link href="/profile" className="eco-user" aria-label="个人主页">
            <span className="eco-user-av">
              {topUser?.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={topUser.avatarUrl} alt={topUser.name} decoding="async" />
              ) : initial}
            </span>
            <span className="eco-user-meta">
              <b>{topUser?.name ?? '未登录'}</b>
              <span className="eco-achievement-line" title={navAchievement?.desc ?? navRoleLabel}>
                {navAchievement ? (
                  <span className="eco-achievement">
                    <span className="eco-achievement-emoji" aria-hidden>{navAchievement.emoji}</span>
                    <span className="eco-achievement-name">{navAchievement.name}</span>
                  </span>
                ) : (
                  <span className="eco-achievement empty">{navRoleLabel}</span>
                )}
              </span>
            </span>
          </Link>
        </div>
      </header>

      <main className="eco-wrap">
        {error && <div className="eco-alert" role="alert">{error}</div>}

        {offline && (
          <div className="eco-offline" role="status">
            <span className="eco-offline-emoji">🤖</span>
            <span>离开期间自动回收了 <b>{offline.cleared}</b> 个垃圾{offline.points > 0 ? <>，获得 <b>+{offline.points}</b> 积分</> : null}</span>
            <button type="button" onClick={() => setOffline(null)} aria-label="关闭">✕</button>
          </div>
        )}

        {/* ───────── 舞台：城市回收站 diorama ───────── */}
        <section className="stage">
          <div
            ref={yardRef}
            className="scene"
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {/* 背景由 scene-bg.webp 提供（天空/云/山/草地都在图里） */}

            <div className="scene-today-points" aria-label={`今日捡垃圾获得 ${todayTrashPoints} 积分`}>
              <span className="scene-today-points-emoji" aria-hidden>🪙</span>
              <span className="scene-today-points-copy">
                <b>{todayTrashPoints}</b>
                <i>今日捡垃圾</i>
              </span>
            </div>

            {displayPending <= 0 && board.length === 0 && !drag && (
              <div className="scene-empty">
                <span className="scene-empty-emoji">🌱</span>
                <p>街区很干净！垃圾正在慢慢刷新…</p>
              </div>
            )}

            {board.map((item) => {
              if (drag?.id === item.id) return null;
              if (item.type === 'prize') {
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`prize ${claiming === item.prizeId ? 'is-claiming' : ''}`}
                    style={{ left: `${item.x}%`, top: `${item.y}%`, ['--rot' as string]: `${item.rot}deg` }}
                    onClick={() => openClaimPrizeModal(item)}
                    disabled={claiming === item.prizeId}
                    aria-label={`拾取${item.name}`}
                    title={`拾取${item.name}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.imageSrc} alt={item.name} draggable={false} decoding="async" />
                  </button>
                );
              }
              return (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={item.id}
                  src={TRASH_SRC[item.kind]}
                  alt="垃圾"
                  className="trash"
                  style={{ left: `${item.x}%`, top: `${item.y}%`, ['--rot' as string]: `${item.rot}deg` }}
                  draggable={false}
                  decoding="async"
                  onPointerDown={(e) => onPointerDown(e, item)}
                />
              );
            })}

            {drag && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={TRASH_SRC[drag.kind]}
                alt="垃圾"
                className="trash is-dragging"
                style={{ left: drag.x, top: drag.y }}
                draggable={false}
                decoding="async"
              />
            )}

            {pops.map((p) => (
              <span key={p.id} className="pop" style={{ left: `${p.x}%`, top: `${p.y}%` }}>{p.text}</span>
            ))}

            <div ref={binRef} className={`bin ${binActive ? 'is-active' : ''}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={binActive ? BIN_OPEN : BIN_CLOSED} alt="回收桶" draggable={false} className={binEat ? 'eat' : ''} key={binEat} decoding="async" />
              <span className="bin-base" />
              <span className="bin-hint">投放点</span>
            </div>

            <span className="scene-tag">🏙️ 城市回收站</span>
          </div>

          {/* 操作条 */}
          <div className="point-progress" aria-label={`积分进度 ${pointProgressValue} / ${pointDivisor}`}>
            <div className="point-progress-top">
              <span>积分进度</span>
              <b>{pointProgressValue}<i>/{pointDivisor}</i></b>
            </div>
            <div className="point-progress-track">
              <i style={{ width: `${pointProgressPct}%` }} />
            </div>
            <em>{pointProgressHint}</em>
          </div>

          <div className="stage-bar">
            <div className="bag">
              <span className="bag-emoji">🛍️</span>
              <div className="bag-body">
                <div className="bag-top"><span className="bag-label">待回收</span><span className="bag-num">{displayPendingTotal}<i> / {cap}</i></span></div>
                <div className="bag-bar"><i style={{ width: `${bagPct}%` }} /></div>
              </div>
            </div>
          </div>

          {activeItemEffects.length > 0 && (
            <div className="effect-progress-list" aria-label="道具剩余进度">
              {activeItemEffects.map((effect) => {
                const progressPct = getEffectProgressPercent(effect.remaining, effect.total);
                const stacked = effect.remaining > effect.total;
                return (
                  <div key={effect.key} className={`effect-progress ${effect.tone}`}>
                    <div className="effect-progress-head">
                      <span className="effect-progress-name">
                        <span aria-hidden>{effect.emoji}</span>
                        {effect.name}
                      </span>
                      <b>剩余 {effect.remaining} {effect.unit}</b>
                    </div>
                    <div
                      className="effect-progress-track"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={effect.total}
                      aria-valuenow={Math.min(effect.remaining, effect.total)}
                      aria-label={`${effect.name}剩余${effect.remaining}${effect.unit}`}
                    >
                      <i style={{ width: `${progressPct}%` }} />
                    </div>
                    <em>{stacked ? `已叠加，单份进度 ${effect.total}/${effect.total}` : `${effect.remaining}/${effect.total}`}</em>
                  </div>
                );
              })}
            </div>
          )}

          <p className="stage-tip">
            {activeItemEffects.length > 0
              ? '道具生效中，剩余进度见上方。奖品只能点击拾取。'
              : '把垃圾拖进回收桶即可回收，奖品只能点击拾取，10 分钟后会消失。'}
          </p>
        </section>

        <section className="public-board">
          <div className="public-board-head">
            <div>
              <h2>公开栏</h2>
              <span>全服剩余与公开展示</span>
            </div>
          </div>
          <div className="public-remaining">
            {status?.prizes.map((prize) => (
              <span key={prize.key}>
                {prize.emoji}{prize.name} <b>{status.publicBoard.remaining[prize.key]}</b>
              </span>
            ))}
          </div>
          <div className="public-list">
            {status?.publicBoard.entries.length ? status.publicBoard.entries.map((entry) => {
              const isOwnPrize = topUser?.id === entry.ownerUserId;
              const rankLikeOwnerName = entry.ownerDisplayName || entry.ownerUsername || entry.ownerName;
              const ownerDisplayName = isOwnPrize ? (topUser?.name ?? rankLikeOwnerName) : rankLikeOwnerName;
              const ownerAvatarUrl = isOwnPrize ? (topUser?.avatarUrl ?? entry.ownerAvatarUrl) : entry.ownerAvatarUrl;
              const ownerInitial = (ownerDisplayName?.[0] ?? '?').toUpperCase();
              const canSteal = entry.canSteal !== false && entry.status === 'listed';
              const stealButtonLabel = entry.stealDisabledReason || (isOwnPrize ? '自己的奖品' : '偷盗');
              return (
                <article key={entry.id} className={`public-entry ${entry.status}`}>
                  <div className="public-entry-main">
                    <span className="public-entry-emoji">{entry.emoji}</span>
                    <span className="public-entry-avatar public-entry-avatar-nav eco-user-av" aria-hidden>
                      {ownerAvatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={ownerAvatarUrl} alt="" decoding="async" />
                      ) : ownerInitial}
                    </span>
                    <div>
                      <b>{entry.name}</b>
                      <span>{ownerDisplayName} 持有</span>
                      {entry.status === 'stolen' && (
                        <span className="public-entry-thief">已被偷走，警察追查中</span>
                      )}
                      {entry.theftMessage && <i>“{entry.theftMessage}”</i>}
                    </div>
                  </div>
                  {entry.status === 'listed' ? (
                    <button
                      type="button"
                      className="eco-btn soft"
                      disabled={!canSteal}
                      onClick={() => openStealModal(entry)}
                    >
                      {canSteal ? '偷盗' : stealButtonLabel}
                    </button>
                  ) : (
                    <span className="public-entry-tag">追查中</span>
                  )}
                </article>
              );
            }) : (
              <div className="public-empty">暂无公开展示的奖品</div>
            )}
          </div>
        </section>

        {/* ───────── 生产参数 ───────── */}
        <section className="specs">
          {specs.length === 0
            ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="spec is-skeleton" />)
            : specs.map((s) => (
                <div key={s.label} className="spec">
                  <span className="spec-icon"><s.Icon size={17} /></span>
                  <div className="spec-body">
                    <span className="spec-label">{s.label}</span>
                    <span className="spec-value">{s.value}</span>
                  </div>
                </div>
              ))}
        </section>

        <section className="eco-actions" aria-label="环保行动面板">
          <button type="button" className="action-tile" onClick={() => setActiveModal('shop')}>
            <span className="action-icon"><ShoppingBag size={20} /></span>
            <span>
              <b>环保商店</b>
              <i>升级 · 道具 · 七日行情</i>
            </span>
          </button>
          <button type="button" className="action-tile" onClick={() => setActiveModal('bag')}>
            <span className="action-icon gold"><Package size={20} /></span>
            <span>
              <b>背包</b>
              <i>{prizeCount} 件宝物</i>
            </span>
          </button>
        </section>
      </main>

      {activeModal === 'rules' && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => {
          if (e.target === e.currentTarget) setActiveModal(null);
        }}>
          <section className="eco-modal rules-modal" role="dialog" aria-modal="true" aria-labelledby="eco-rules-title">
            <div className="modal-head">
              <h2 id="eco-rules-title" className="shop-title"><span className="shop-title-icon"><BookOpen size={18} /></span>环保行动规则</h2>
              <button type="button" className="modal-close" onClick={() => setActiveModal(null)} aria-label="关闭规则">
                <X size={18} />
              </button>
            </div>

            <div className="rules-summary" aria-label="规则摘要">
              <span><b>10</b> 个垃圾 = 基础 <b>1</b> 积分</span>
              <span>奖品次日早上 <b>6</b> 点后可售</span>
              <span>行情每日 <b>0</b> 点刷新</span>
              <span>警察后台自动追查偷盗</span>
            </div>

            <div className="rules-grid">
              <article className="rule-card">
                <span className="rule-icon">♻️</span>
                <div>
                  <h3>垃圾刷新</h3>
                  <p>垃圾按服务端真实经过时间刷新，基础速度为 10 个/分钟，升级“刷新速度”后会提高。容量满时不会继续累积普通垃圾。</p>
                </div>
              </article>
              <article className="rule-card">
                <span className="rule-icon">🎁</span>
                <div>
                  <h3>奖品生成</h3>
                  <p>每次生成会先判定普通垃圾或奖品。奖品与垃圾共用待回收容量，不会在容量满时额外刷出。</p>
                </div>
              </article>
              <article className="rule-card">
                <span className="rule-icon">📦</span>
                <div>
                  <h3>全服限量</h3>
                  <p>全服同时持有上限：照片 10、钻石 10、金币 15、项链 15、奖杯 20。达到上限后，不会再刷出对应奖品。</p>
                </div>
              </article>
              <article className="rule-card">
                <span className="rule-icon">🖱️</span>
                <div>
                  <h3>回收与拾取</h3>
                  <p>普通垃圾需要拖进回收桶；奖品不能丢进垃圾桶，只能点击拾取。场景内奖品超过 10 分钟未领取会自动消失。</p>
                </div>
              </article>
              <article className="rule-card">
                <span className="rule-icon">⭐</span>
                <div>
                  <h3>积分结算</h3>
                  <p>每回收 10 个普通垃圾兑换积分。初始为 1 积分，升级“积分价格”后，每 10 个垃圾可获得更多积分。</p>
                </div>
              </article>
              <article className="rule-card">
                <span className="rule-icon">💎</span>
                <div>
                  <h3>奖品概率</h3>
                  <p>奖杯 0.05%，项链 0.03%，金币 0.01%，钻石 0.005%，照片 0.001%。幸运手电会让这些奖品的出现概率变为 5 倍，最高不超过 100%。</p>
                </div>
              </article>
              <article className="rule-card">
                <span className="rule-icon">🏪</span>
                <div>
                  <h3>商店与行情</h3>
                  <p>奖品价格每天凌晨 0 点刷新。七日行情的每个节点都可点击，查看当天价格和前一天全服收集数量。</p>
                </div>
              </article>
              <article className="rule-card">
                <span className="rule-icon">🔒</span>
                <div>
                  <h3>出售时间</h3>
                  <p>玩家拾取奖品后不能立刻出售，需要等到第二天早上 6 点。旧版本已获得的奖品不会被回收。</p>
                </div>
              </article>
              <article className="rule-card">
                <span className="rule-icon">📣</span>
                <div>
                  <h3>公开展示</h3>
                  <p>是否公开只能在拾取奖品时选择。选择公开后不能手动取消，奖品会持续展示在公开栏，全服玩家都能看见持有人。</p>
                </div>
              </article>
              <article className="rule-card">
                <span className="rule-icon">🧑‍💼</span>
                <div>
                  <h3>商人收购</h3>
                  <p>公开展示的奖品会在第二天早上 6 点吸引商人。到时可选择普通出售，也可按当天市场价 1.2 倍卖给商人；未出售前仍可能被偷。</p>
                </div>
              </article>
              <article className="rule-card">
                <span className="rule-icon">🕵️</span>
                <div>
                  <h3>偷盗条件</h3>
                  <p>只有当前一个奖品都没有的玩家，才能偷走公开栏中的奖品。偷盗时必须留下一句话。</p>
                </div>
              </article>
              <article className="rule-card">
                <span className="rule-icon">🚓</span>
                <div>
                  <h3>警察追查</h3>
                  <p>偷盗后警察会由系统后台自动追查，不需要玩家挂机。偷走后 20 分钟开始第一次追查，之后每 20 分钟追查一次，直到 24 小时时间到为止。</p>
                </div>
              </article>
              <article className="rule-card">
                <span className="rule-icon">⚖️</span>
                <div>
                  <h3>抓捕结果</h3>
                  <p>第一次被偷的初始抓捕概率为 22%，每过 1 小时增加 2%。如果同一奖品再次被偷，每次初始概率再降低 5%。</p>
                  <p>被抓后奖品物归原主并回到公开栏展示，同时获得 10 小时保护期；保护期内不能再次被偷。小偷扣除当天售价 10% 的积分并强制佩戴“小偷”成就 10 小时，原主获得扣分的一半。</p>
                </div>
              </article>
              <article className="rule-card">
                <span className="rule-icon">🌑</span>
                <div>
                  <h3>黑市出售</h3>
                  <p>偷来的奖品不能普通出售，只能等 24 小时内未被抓后在黑市出售，售价为该奖品的最高价格。</p>
                </div>
              </article>
              <article className="rule-card">
                <span className="rule-icon">🤖</span>
                <div>
                  <h3>自动回收</h3>
                  <p>自动回收机器人只会处理普通垃圾，不会拾取奖品。离线自动回收最多累计 60 分钟产能。</p>
                </div>
              </article>
              <article className="rule-card">
                <span className="rule-icon">🧤</span>
                <div>
                  <h3>一次性道具</h3>
                  <p>清运车补充普通垃圾但不生成奖品；回收手套让后续拖拽额外回收；幸运手电让后续在线生成上述奖品的概率变为 5 倍。</p>
                </div>
              </article>
            </div>
          </section>
        </div>
      )}

      {activeModal === 'claim' && pendingClaimItem && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            setPendingClaimItem(null);
            setActiveModal(null);
          }
        }}>
          <section className="eco-modal choice-modal" role="dialog" aria-modal="true" aria-labelledby="eco-claim-title">
            <div className="modal-head">
              <h2 id="eco-claim-title" className="shop-title">
                <span className="shop-title-icon"><Package size={18} /></span>拾取奖品
              </h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => {
                  setPendingClaimItem(null);
                  setActiveModal(null);
                }}
                aria-label="关闭拾取弹窗"
              >
                <X size={18} />
              </button>
            </div>
            <div className="choice-prize">
              <span className="sc-prize-img">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pendingClaimItem.imageSrc} alt={pendingClaimItem.name} draggable={false} decoding="async" />
              </span>
              <div>
                <h3>{pendingClaimItem.name}</h3>
                <p>选择公开后会展示在公开栏，全服玩家能看见你持有该奖品；次日早上 6 点会吸引商人，但未出售前仍可能被偷。</p>
              </div>
            </div>
            <div className="choice-actions">
              <button
                type="button"
                className="eco-btn full soft"
                disabled={claiming === pendingClaimItem.prizeId}
                onClick={() => void claimPrize(pendingClaimItem, false)}
              >
                不公开，收入背包
              </button>
              <button
                type="button"
                className="eco-btn full"
                disabled={claiming === pendingClaimItem.prizeId}
                onClick={() => void claimPrize(pendingClaimItem, true)}
              >
                公开展示
              </button>
            </div>
          </section>
        </div>
      )}

      {activeModal === 'steal' && pendingStealEntry && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            setPendingStealEntry(null);
            setTheftMessage('');
            setActiveModal(null);
          }
        }}>
          <section className="eco-modal choice-modal" role="dialog" aria-modal="true" aria-labelledby="eco-steal-title">
            <div className="modal-head">
              <h2 id="eco-steal-title" className="shop-title">
                <span className="shop-title-icon"><BookOpen size={18} /></span>偷盗留言
              </h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => {
                  setPendingStealEntry(null);
                  setTheftMessage('');
                  setActiveModal(null);
                }}
                aria-label="关闭偷盗弹窗"
              >
                <X size={18} />
              </button>
            </div>
            <div className="choice-prize">
              <span className="sc-prize-img">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pendingStealEntry.imageSrc} alt={pendingStealEntry.name} draggable={false} decoding="async" />
              </span>
              <div>
                <h3>{pendingStealEntry.name}</h3>
                <p>你将尝试偷走 {pendingStealEntry.ownerName} 公开展示的奖品。警察会后台追查，若被抓会归还奖品并扣除处罚积分。</p>
              </div>
            </div>
            <label className="choice-field">
              <span>留下的话</span>
              <textarea
                value={theftMessage}
                maxLength={40}
                rows={3}
                placeholder="最多 40 字"
                onChange={(event) => setTheftMessage(event.target.value)}
              />
              <i>{theftMessage.trim().length}/40</i>
            </label>
            <div className="choice-actions">
              <button
                type="button"
                className="eco-btn full soft"
                onClick={() => {
                  setPendingStealEntry(null);
                  setTheftMessage('');
                  setActiveModal(null);
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="eco-btn full danger"
                disabled={!theftMessage.trim()}
                onClick={() => void stealPublicPrize(pendingStealEntry, theftMessage)}
              >
                确认偷盗
              </button>
            </div>
          </section>
        </div>
      )}

      {activeModal === 'shop' && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => {
          if (e.target === e.currentTarget) setActiveModal(null);
        }}>
          <section className="eco-modal shop-modal" role="dialog" aria-modal="true" aria-labelledby="eco-shop-title">
            <div className="modal-head">
              <h2 id="eco-shop-title" className="shop-title"><span className="shop-title-icon"><ShoppingBag size={18} /></span>环保商店</h2>
              <button type="button" className="modal-close" onClick={() => setActiveModal(null)} aria-label="关闭商店">
                <X size={18} />
              </button>
            </div>

            <div className="shop-tabs">
              <button type="button" className={shopTab === 'upgrade' ? 'on' : ''} onClick={() => setShopTab('upgrade')}>升级</button>
              <button type="button" className={shopTab === 'item' ? 'on' : ''} onClick={() => setShopTab('item')}>道具</button>
            </div>

            {shopTab === 'upgrade' && (
              <div className="shop-grid">
                {status?.upgrades.map((u) => {
                  const affordable = (balance ?? 0) >= (u.nextCost ?? Infinity);
                  const busy = buying === `upgrade:${u.key}`;
                  return (
                    <article key={u.key} className={`sc ${u.maxed ? 'is-maxed' : ''}`}>
                      <div className="sc-top">
                        <span className="sc-emoji">{u.emoji}</span>
                        <div className="sc-meta">
                          <h3>{u.name}</h3>
                          <div className="sc-dots">
                            {Array.from({ length: u.maxLevel }).map((_, i) => (
                              <span key={i} className={i < u.level ? 'on' : ''} />
                            ))}
                          </div>
                        </div>
                      </div>
                      <p className="sc-desc">{u.desc}</p>
                      <div className="sc-effect">
                        <span className="sc-pill muted">现 {u.currentEffectLabel}</span>
                        {u.nextEffectLabel && <span className="sc-pill"><ArrowUp size={11} />{u.nextEffectLabel}</span>}
                      </div>
                      <button
                        type="button"
                        className="eco-btn full"
                        disabled={u.maxed || busy || !affordable}
                        onClick={() => buy('upgrade', u.key)}
                      >
                        {u.maxed ? '已满级' : busy ? '处理中…' : `升级 · ${u.nextCost} 积分`}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}

            {shopTab === 'item' && (
              <div className="shop-grid">
                {status?.items.map((it) => {
                  const affordable = (balance ?? 0) >= it.cost;
                  const busy = buying === `item:${it.key}`;
                  const soldOut = it.remainingToday <= 0;
                  return (
                    <article key={it.key} className="sc">
                      <div className="sc-top">
                        <span className="sc-emoji">{it.emoji}</span>
                        <div className="sc-meta">
                          <h3>{it.name}</h3>
                          <span className="sc-active">今日剩余 {it.remainingToday}/{it.dailyLimit}</span>
                        </div>
                      </div>
                      <p className="sc-desc">{it.desc}</p>
                      <button
                        type="button"
                        className="eco-btn full soft"
                        disabled={busy || !affordable || soldOut}
                        onClick={() => buy('item', it.key)}
                      >
                        {soldOut ? '今日已售罄' : busy ? '处理中…' : `购买 · ${it.cost} 积分`}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}

            <div className="price-board">
              <div className="price-board-head">
                <div>
                  <h3>七日行情</h3>
                  <span>近 7 天价格涨幅</span>
                </div>
                <label className="price-selector">
                  <span>查看奖品</span>
                  <select
                    value={selectedPricePrize?.key ?? selectedPricePrizeKey}
                    disabled={!status?.prizes.length}
                    onChange={(e) => setSelectedPricePrizeKey(e.target.value as EcoPrizeKey)}
                  >
                    {status?.prizes.map((prize) => (
                      <option key={prize.key} value={prize.key}>{prize.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              {selectedPricePrize ? (
                <article className="price-focus-card">
                  <div className="price-focus-top">
                    <span className="sc-prize-img">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={selectedPricePrize.imageSrc} alt={selectedPricePrize.name} draggable={false} decoding="async" />
                    </span>
                    <div className="price-focus-main">
                      <h4>{selectedPricePrize.name}</h4>
                      <span className={`price-trend ${selectedPricePrize.weekChange >= 0 ? 'up' : 'down'}`}>
                        <SelectedPriceTrendIcon size={13} />
                        {selectedPricePrize.weekChange === 0 ? '持平' : `${selectedPricePrize.weekChange > 0 ? '+' : ''}${selectedPricePrize.weekChange}`}
                      </span>
                    </div>
                    <div className="price-focus-stats">
                      <span>今日价格</span>
                      <b>{selectedPricePrize.todayPrice}</b>
                    </div>
                    <div className="price-focus-stats">
                      <span>价格区间</span>
                      <b>{selectedPricePrize.minPrice}-{selectedPricePrize.maxPrice}</b>
                    </div>
                  </div>
                  <PriceSparkline
                    history={selectedPricePrize.priceHistory}
                    selectedDate={selectedPricePoint?.date ?? null}
                    onSelectDate={setSelectedPriceDate}
                  />
                  {selectedPricePoint && (
                    <div className="price-point-detail">
                      <div>
                        <span>日期</span>
                        <b>{selectedPricePoint.date}</b>
                      </div>
                      <div>
                        <span>当天价格</span>
                        <b>{selectedPricePoint.price}</b>
                      </div>
                      <div>
                        <span>前日该奖品收集</span>
                        <b>{selectedPricePoint.previousDayClaimCount}</b>
                      </div>
                      <div>
                        <span>前日全部奖品收集</span>
                        <b>{selectedPricePoint.previousDayTotalClaims}</b>
                      </div>
                    </div>
                  )}
                </article>
              ) : (
                <div className="price-empty">暂无行情数据</div>
              )}
            </div>
          </section>
        </div>
      )}

      {activeModal === 'bag' && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => {
          if (e.target === e.currentTarget) setActiveModal(null);
        }}>
          <section className="eco-modal bag-modal" role="dialog" aria-modal="true" aria-labelledby="eco-bag-title">
            <div className="modal-head">
              <h2 id="eco-bag-title" className="shop-title"><span className="shop-title-icon"><Package size={18} /></span>背包</h2>
              <button type="button" className="modal-close" onClick={() => setActiveModal(null)} aria-label="关闭背包">
                <X size={18} />
              </button>
            </div>

            <div className="bag-market">
              <div className="shop-grid">
                {status?.prizes.map((prize) => {
                  const owned = prize.inventory;
                  const busy = selling === prize.key;
                  const canSell = prize.sellableInventory > 0 && !busy;
                  const canMerchantSell = prize.merchantAvailableCount > 0 && !busy;
                  const canBlackMarketSell = prize.blackMarketAvailableCount > 0 && !busy;
                  const privateInventory = Math.max(0, prize.inventory - prize.publicInventory - prize.stolenInventory);
                  const showNormalSell = prize.sellableInventory > 0 || privateInventory > 0;
                  const TrendIcon = prize.change >= 0 ? TrendingUp : TrendingDown;
                  return (
                    <article key={prize.key} className="sc prize-card">
                      <div className="sc-top">
                        <span className="sc-prize-img">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={prize.imageSrc} alt={prize.name} draggable={false} decoding="async" />
                        </span>
                        <div className="sc-meta">
                          <h3>{prize.name}</h3>
                          <span className={`price-trend ${prize.change >= 0 ? 'up' : 'down'}`}>
                            <TrendIcon size={12} />
                            {prize.change === 0 ? '持平' : `${prize.change > 0 ? '+' : ''}${prize.change}`}
                          </span>
                        </div>
                      </div>
                      <div className="market-row">
                        <span>库存 <b>{owned}</b></span>
                        <span>今日 <b>{prize.todayPrice}</b> 分</span>
                      </div>
                      <p className="sc-desc">
                        可售 {prize.sellableInventory}，锁定 {prize.lockedInventory}，公开 {prize.publicInventory}，偷来 {prize.stolenInventory}。
                      </p>
                      {showNormalSell && (
                        <button
                          type="button"
                          className="eco-btn full soft"
                          disabled={!canSell}
                          onClick={() => void sellPrize(prize.key, 'normal')}
                        >
                          {busy ? '出售中…' : prize.sellableInventory <= 0 ? '次日 6 点后可售' : `出售 1 个 · +${prize.todayPrice} 积分`}
                        </button>
                      )}
                      {prize.publicInventory > 0 && (
                        <button
                          type="button"
                          className="eco-btn full"
                          disabled={!canMerchantSell}
                          onClick={() => void sellPrize(prize.key, 'merchant')}
                        >
                          {prize.merchantAvailableCount > 0 ? `商人收购 · +${prize.merchantPrice} 积分` : '商人次日 6 点到达'}
                        </button>
                      )}
                      {prize.stolenInventory > 0 && (
                        <button
                          type="button"
                          className="eco-btn full danger"
                          disabled={!canBlackMarketSell}
                          onClick={() => void sellPrize(prize.key, 'blackMarket')}
                        >
                          {prize.blackMarketAvailableCount > 0 ? `黑市出售 · +${prize.maxPrice} 积分` : '黑市 24 小时后接货'}
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          </section>
        </div>
      )}

      <style jsx global>{`
        .eco {
          --c: #14b8a6;
          --c-600: #0d9488;
          --c-700: #0f766e;
          --c-800: #115e59;
          --c-900: #134e4a;
          --c-300: #5eead4;
          --c-200: #99f6e4;
          --c-100: #ccfbf1;
          --c-50: #f0fdfa;
          --gold: #f59e0b;
          --ink: #0f172a;
          --soft: #64748b;
          --line: rgba(15, 118, 110, 0.12);
          min-height: 100vh;
          background:
            radial-gradient(circle at 12% 8%, #d7fbf2 0%, transparent 45%),
            radial-gradient(circle at 90% 0%, #cffafe 0%, transparent 40%),
            #f3fbf9;
          color: var(--ink);
          position: relative;
          overflow-x: hidden;
          font-family: 'Outfit', 'Noto Sans SC', sans-serif;
          -webkit-font-smoothing: antialiased;
        }
        .eco * { box-sizing: border-box; }
        .eco a { text-decoration: none; color: inherit; }
        .eco button { font-family: inherit; }

        /* drifting bg leaves */
        .eco-bg { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
        .eco-bg .leaf { position: absolute; font-size: 26px; opacity: 0.16; filter: blur(0.3px); animation: eco-drift 26s linear infinite; }
        .eco-bg .lf-1 { left: 8%; top: -5%; animation-duration: 30s; }
        .eco-bg .lf-2 { left: 64%; top: -8%; font-size: 34px; animation-duration: 38s; animation-delay: -6s; }
        .eco-bg .lf-3 { left: 32%; top: -10%; font-size: 22px; animation-duration: 34s; animation-delay: -16s; }
        .eco-bg .lf-4 { left: 86%; top: -6%; font-size: 30px; animation-duration: 42s; animation-delay: -22s; }
        @keyframes eco-drift {
          0% { transform: translateY(-10vh) translateX(0) rotate(0deg); }
          100% { transform: translateY(115vh) translateX(40px) rotate(220deg); }
        }

        /* TOPBAR */
        .eco-top {
          position: sticky; top: 0; z-index: 100;
          display: flex; align-items: center; justify-content: space-between; gap: 24px;
          padding: 16px 48px; padding-top: max(16px, env(safe-area-inset-top));
          background: rgba(248, 250, 252, 0.65);
          backdrop-filter: blur(24px) saturate(1.6);
          -webkit-backdrop-filter: blur(24px) saturate(1.6);
          border-bottom: 1px solid rgba(255, 255, 255, 0.8);
        }
        .eco-brand { display: flex; align-items: center; gap: 12px; font-size: 20px; font-weight: 800; letter-spacing: -0.5px; color: var(--ink); flex-shrink: 0; }
        .eco-brand-icon { width: 36px; height: 36px; border-radius: 11px; background: linear-gradient(140deg, #5eead4, #14b8a6 60%, #0d9488); color: #fff; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 18px rgba(20, 184, 166, 0.34), inset 0 1px 0 rgba(255,255,255,0.5); }
        .eco-brand-icon svg { width: 20px; height: 20px; color: #fff; stroke-width: 2.5; }
        .eco-top-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
        .eco-icon-btn { width: 40px; height: 40px; border-radius: 50%; background: rgba(255,255,255,0.7); border: 1px solid rgba(255,255,255,0.9); color: var(--soft); display: inline-flex; align-items: center; justify-content: center; transition: all 0.2s; cursor: pointer; }
        .eco-icon-btn:hover { background: #fff; color: var(--c-600); transform: translateY(-1px); box-shadow: 0 8px 18px rgba(20,184,166,0.18); }
        .eco-icon-btn.rules-trigger {
          color: var(--c-700);
          background:
            linear-gradient(#fff, #fff) padding-box,
            linear-gradient(135deg, rgba(45,212,191,0.5), rgba(13,148,136,0.5)) border-box;
          border: 1px solid transparent;
        }
        .eco-icon-btn.rules-trigger:hover { color: var(--c-800); box-shadow: 0 14px 26px rgba(13,148,136,0.15); }
        .eco-user { display: inline-flex; align-items: center; gap: 12px; min-width: 0; padding: 5px 16px 5px 5px; background: #fff; border-radius: 999px; box-shadow: 0 8px 20px rgba(4,47,46,0.05); transition: transform 0.2s; color: var(--ink); }
        .eco-user:hover { transform: scale(1.02); }
        .eco-user-av { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%); color: #475569; font-weight: 800; font-size: 14px; display: inline-flex; align-items: center; justify-content: center; overflow: hidden; text-transform: uppercase; flex-shrink: 0; }
        .eco-user-av img { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; display: block; }
        .eco-user-meta { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; }
        .eco-user-meta b { font-size: 13px; font-weight: 700; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .eco-achievement-line { display: inline-flex; align-items: center; gap: 4px; min-width: 0; width: 100%; max-width: 130px; margin-top: 1px; font-size: 11px; color: var(--soft); }
        .eco-achievement { display: inline-flex; align-items: center; gap: 4px; min-width: 0; color: var(--c-700); font-weight: 800; }
        .eco-achievement.empty { color: var(--soft); font-weight: 700; }
        .eco-achievement-emoji { flex: 0 0 auto; font-size: 11px; line-height: 1; }
        .eco-achievement-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        /* WRAP */
        .eco-wrap { position: relative; z-index: 1; max-width: 1080px; margin: 0 auto; padding: 26px 40px 100px; display: flex; flex-direction: column; gap: 20px; }
        @media (max-width: 1100px) { .eco-wrap { padding: 22px 24px 90px; } }
        @media (max-width: 720px) {
          .eco-top {
            gap: 10px;
            padding: 9px 12px;
            padding-top: max(9px, env(safe-area-inset-top));
          }
          .eco-brand { gap: 8px; }
          .eco-brand-icon { width: 32px; height: 32px; border-radius: 10px; }
          .eco-brand-text { display: none; }
          .eco-top-right { gap: 7px; }
          .eco-icon-btn { width: 36px; height: 36px; }
          .eco-user { gap: 8px; padding: 4px 10px 4px 4px; max-width: min(162px, calc(100vw - 126px)); }
          .eco-user-av { width: 32px; height: 32px; font-size: 12px; }
          .eco-user-meta b { max-width: 92px; font-size: 12px; }
          .eco-achievement-line { max-width: 92px; font-size: 10px; }
          .eco-achievement-emoji { font-size: 10px; }
          .eco-wrap {
            padding: 10px 10px max(78px, calc(env(safe-area-inset-bottom) + 64px));
            gap: 10px;
          }
          .eco-alert,
          .eco-offline {
            padding: 10px 12px;
            border-radius: 14px;
            font-size: 12.5px;
          }
        }

        .eco-alert { padding: 12px 18px; border-radius: 16px; background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; font-size: 14px; font-weight: 600; }

        .eco-offline { display: flex; align-items: center; gap: 10px; padding: 13px 16px; border-radius: 18px; background: linear-gradient(180deg, #ecfdf5, #d1fae5); border: 1px solid #6ee7b7; color: var(--c-800); font-size: 14px; font-weight: 600; }
        .eco-offline-emoji { font-size: 20px; }
        .eco-offline b { color: var(--c-700); font-weight: 800; }
        .eco-offline button { margin-left: auto; border: none; background: rgba(15,118,110,0.1); color: var(--c-800); width: 24px; height: 24px; border-radius: 50%; cursor: pointer; font-weight: 800; flex-shrink: 0; }

        /* STAGE */
        .stage { display: flex; flex-direction: column; gap: 0; }
        .scene {
          position: relative; width: 100%; height: 480px; border-radius: 30px; overflow: hidden;
          background: url('/images-optimized/ui/games/eco/scene-bg.webp?v=1') center / cover no-repeat, linear-gradient(180deg, #b8f5e6, #54dcc2);
          box-shadow: 0 30px 60px rgba(4, 47, 46, 0.22), inset 0 1px 0 rgba(255,255,255,0.7);
          border: 1px solid rgba(255,255,255,0.7);
          touch-action: none; user-select: none;
          cursor: default;
        }
        @media (max-width: 720px) {
          .scene {
            height: clamp(280px, 46vh, 350px);
            height: clamp(280px, 46dvh, 350px);
            border-radius: 20px;
            background-position: center bottom;
          }
        }

        .scene::after { content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 1; background: linear-gradient(180deg, rgba(4,47,46,0.16) 0%, transparent 20%, transparent 74%, rgba(4,47,46,0.14) 100%); }

        .scene-today-points {
          position: absolute;
          top: 16px;
          right: 16px;
          z-index: 26;
          display: inline-flex;
          align-items: center;
          gap: 10px;
          min-width: 128px;
          min-height: 48px;
          padding: 8px 13px 8px 10px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.82);
          border: 1px solid rgba(255, 255, 255, 0.92);
          box-shadow: 0 14px 28px rgba(4, 47, 46, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(14px) saturate(1.2);
          -webkit-backdrop-filter: blur(14px) saturate(1.2);
          color: var(--c-900);
          pointer-events: none;
        }
        .scene-today-points-emoji {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          background: linear-gradient(135deg, #fef3c7, #f59e0b);
          box-shadow: 0 8px 15px rgba(245, 158, 11, 0.28);
          font-size: 18px;
          line-height: 1;
        }
        .scene-today-points-copy {
          display: flex;
          flex-direction: column;
          min-width: 0;
          line-height: 1.05;
        }
        .scene-today-points-copy b {
          font-size: 19px;
          font-weight: 950;
          font-variant-numeric: tabular-nums;
          color: var(--c-900);
        }
        .scene-today-points-copy i {
          margin-top: 3px;
          font-size: 11px;
          font-style: normal;
          font-weight: 850;
          color: var(--c-700);
          white-space: nowrap;
        }

        .scene-empty { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--c-800); font-weight: 700; font-size: 14px; pointer-events: none; text-shadow: 0 1px 0 rgba(255,255,255,0.5); z-index: 5; }
        .scene-empty-emoji { font-size: 46px; animation: eco-bob 3s ease-in-out infinite; }
        @keyframes eco-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }

        .scene .trash {
          position: absolute; width: 60px; height: 60px; object-fit: contain;
          transform: translate(-50%, -50%) rotate(var(--rot, 0deg));
          cursor: grab; touch-action: none; filter: drop-shadow(0 10px 12px rgba(4,47,46,0.28));
          animation: eco-trash-in 0.45s cubic-bezier(0.34,1.56,0.64,1) backwards;
          z-index: 8;
        }
        @keyframes eco-trash-in { 0% { transform: translate(-50%,-50%) scale(0.4) rotate(var(--rot,0deg)); opacity: 0; } 100% { opacity: 1; } }
        .scene .trash:active { cursor: grabbing; }
        .scene .trash.is-dragging { z-index: 30; width: 66px; height: 66px; transform: translate(-50%, -50%) rotate(-4deg); filter: drop-shadow(0 18px 22px rgba(4,47,46,0.4)); animation: none; cursor: grabbing; }
        @media (max-width: 720px) {
          .scene-today-points {
            top: 10px;
            right: 10px;
            min-width: 104px;
            min-height: 40px;
            gap: 7px;
            padding: 6px 10px 6px 7px;
          }
          .scene-today-points-emoji { width: 27px; height: 27px; font-size: 15px; }
          .scene-today-points-copy b { font-size: 16px; }
          .scene-today-points-copy i { margin-top: 2px; font-size: 10px; }
          .scene .trash { width: 44px; height: 44px; }
          .scene .trash.is-dragging { width: 52px; height: 52px; }
        }

        .scene .prize {
          position: absolute; width: 72px; height: 72px; border: none; border-radius: 18px;
          display: inline-flex; align-items: center; justify-content: center;
          background: transparent;
          appearance: none;
          -webkit-appearance: none;
          box-shadow: none;
          transform: translate(-50%, -50%) rotate(var(--rot, 0deg));
          cursor: pointer; z-index: 12; animation: eco-prize-in 0.5s cubic-bezier(0.34,1.56,0.64,1) backwards, eco-prize-glow 2.2s ease-in-out infinite;
          padding: 0;
        }
        .scene .prize img { width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 12px 14px rgba(120,53,15,0.28)); pointer-events: none; }
        .scene .prize:hover:not(:disabled) { transform: translate(-50%, -50%) scale(1.1) rotate(var(--rot, 0deg)); }
        .scene .prize:disabled { cursor: wait; opacity: 0.7; }
        @keyframes eco-prize-in { 0% { transform: translate(-50%,-50%) scale(0.35) rotate(var(--rot,0deg)); opacity: 0; } 100% { opacity: 1; } }
        @keyframes eco-prize-glow { 0%,100% { filter: drop-shadow(0 0 0 rgba(245,158,11,0)); } 50% { filter: drop-shadow(0 0 10px rgba(245,158,11,0.55)); } }
        @media (max-width: 720px) { .scene .prize { width: 50px; height: 50px; } }

        .scene .bin { position: absolute; right: 26px; bottom: 30px; width: 122px; height: 138px; display: flex; align-items: flex-end; justify-content: center; pointer-events: none; z-index: 20; transition: transform 0.18s cubic-bezier(0.34,1.56,0.64,1); }
        .scene .bin.is-active { transform: scale(1.14) translateY(-6px); }
        .scene .bin img { width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 14px 16px rgba(4,47,46,0.34)); }
        .scene .bin img.eat { animation: eco-eat 0.4s ease; }
        @keyframes eco-eat { 0% { transform: scale(1, 1); } 35% { transform: scale(1.12, 0.9); } 70% { transform: scale(0.96, 1.06); } 100% { transform: scale(1, 1); } }
        .scene .bin-base { position: absolute; bottom: 6px; left: 50%; transform: translateX(-50%); width: 96px; height: 14px; border-radius: 50%; background: rgba(4,47,46,0.18); filter: blur(4px); z-index: -1; }
        .scene .bin-hint { position: absolute; top: -8px; background: var(--c-800); color: #fff; font-size: 11px; font-weight: 800; padding: 3px 11px; border-radius: 999px; white-space: nowrap; box-shadow: 0 6px 14px rgba(17,94,89,0.45); }
        @media (max-width: 720px) {
          .scene .bin { width: 82px; height: 92px; right: 10px; bottom: 14px; }
          .scene .bin-base { width: 70px; height: 10px; bottom: 3px; }
          .scene .bin-hint { top: -5px; padding: 2px 8px; font-size: 10px; }
        }

        .scene .pop { position: absolute; transform: translate(-50%, 0); font-size: 22px; font-weight: 900; color: #fff; pointer-events: none; animation: eco-pop 0.95s ease-out forwards; text-shadow: 0 2px 8px rgba(13,148,136,0.7), 0 0 2px rgba(13,148,136,0.9); z-index: 40; }
        @keyframes eco-pop { 0% { transform: translate(-50%, 0) scale(0.7); opacity: 0; } 25% { transform: translate(-50%, -8px) scale(1.1); opacity: 1; } 100% { transform: translate(-50%, -46px) scale(1); opacity: 0; } }

        .scene-tag { position: absolute; left: 16px; bottom: 14px; z-index: 25; font-size: 12px; font-weight: 800; color: rgba(17,94,89,0.7); background: rgba(255,255,255,0.6); padding: 4px 11px; border-radius: 999px; backdrop-filter: blur(8px); pointer-events: none; }
        @media (max-width: 720px) { .scene-tag { display: none; } }

        /* STAGE BAR */
        .point-progress {
          display: grid; grid-template-columns: 118px minmax(0, 1fr) auto; align-items: center; gap: 12px;
          margin-top: 12px; padding: 11px 14px; border-radius: 20px;
          background: rgba(255,255,255,0.92); border: 1px solid rgba(204,251,241,0.95);
          box-shadow: 0 14px 28px rgba(4,47,46,0.08), inset 0 1px 0 rgba(255,255,255,0.95);
          color: var(--c-900);
        }
        .point-progress-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; }
        .point-progress-top span { font-size: 11px; font-weight: 900; color: var(--c-700); white-space: nowrap; }
        .point-progress-top b { font-size: 16px; line-height: 1; font-weight: 950; color: var(--c-900); font-variant-numeric: tabular-nums; }
        .point-progress-top i { font-style: normal; font-size: 11px; font-weight: 800; color: var(--soft); }
        .point-progress-track { height: 8px; border-radius: 999px; background: rgba(15,118,110,0.13); overflow: hidden; }
        .point-progress-track i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #f59e0b, #14b8a6); transition: width 0.24s ease; }
        .point-progress em { font-size: 11px; font-style: normal; font-weight: 800; color: var(--soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .stage-bar { display: flex; align-items: center; gap: 14px; margin-top: 14px; padding: 12px 16px; border-radius: 22px; background: rgba(255,255,255,0.92); border: 1px solid rgba(255,255,255,0.9); box-shadow: 0 16px 32px rgba(4,47,46,0.08); }
        .bag { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
        .bag-emoji { font-size: 28px; flex-shrink: 0; }
        .bag-body { flex: 1; min-width: 0; }
        .bag-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 5px; }
        .bag-label { font-size: 12px; font-weight: 800; color: var(--soft); letter-spacing: 0.5px; }
        .bag-num { font-size: 17px; font-weight: 900; color: var(--c-800); font-variant-numeric: tabular-nums; }
        .bag-num i { font-style: normal; font-size: 12px; font-weight: 700; color: var(--soft); }
        .bag-bar { height: 9px; border-radius: 999px; background: rgba(15,118,110,0.12); overflow: hidden; }
        .bag-bar i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #5eead4, #14b8a6); transition: width 0.4s ease; }
        .effect-progress-list {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          margin-top: 12px;
        }
        .effect-progress {
          min-width: 0;
          padding: 12px 14px;
          border-radius: 18px;
          background: rgba(255,255,255,0.9);
          border: 1px solid rgba(255,255,255,0.9);
          box-shadow: 0 14px 28px rgba(4,47,46,0.07), inset 0 1px 0 rgba(255,255,255,0.96);
        }
        .effect-progress.gold {
          background: linear-gradient(180deg, rgba(255,251,235,0.94), rgba(254,243,199,0.78));
          border-color: rgba(253,230,138,0.9);
        }
        .effect-progress.teal {
          background: linear-gradient(180deg, rgba(240,253,250,0.95), rgba(204,251,241,0.76));
          border-color: rgba(153,246,228,0.9);
        }
        .effect-progress-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 10px;
          min-width: 0;
        }
        .effect-progress-name {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
          color: var(--c-900);
          font-size: 13px;
          font-weight: 900;
          white-space: nowrap;
        }
        .effect-progress-head b {
          color: var(--c-800);
          font-size: 12px;
          font-weight: 900;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .effect-progress-track {
          height: 8px;
          margin-top: 9px;
          border-radius: 999px;
          background: rgba(15,118,110,0.12);
          overflow: hidden;
        }
        .effect-progress-track i {
          display: block;
          height: 100%;
          border-radius: inherit;
          transition: width 0.24s ease;
        }
        .effect-progress.gold .effect-progress-track i {
          background: linear-gradient(90deg, #f59e0b, #fbbf24);
        }
        .effect-progress.teal .effect-progress-track i {
          background: linear-gradient(90deg, #14b8a6, #2dd4bf);
        }
        .effect-progress em {
          display: block;
          margin-top: 6px;
          color: var(--soft);
          font-size: 11px;
          font-style: normal;
          font-weight: 800;
          font-variant-numeric: tabular-nums;
        }
        .stage-tip { margin: 12px 4px 0; font-size: 13px; font-weight: 600; color: var(--soft); }

        /* BUTTON */
        .eco-btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 11px 20px; border-radius: 999px; font-size: 14px; font-weight: 800; letter-spacing: 0.3px; border: none; color: #fff; cursor: pointer; background: linear-gradient(180deg, #2dd4bf 0%, #14b8a6 50%, #0d9488 100%); box-shadow: 0 7px 0 rgba(13,148,136,0.65), 0 11px 18px rgba(20,184,166,0.32); transition: transform 0.14s ease, box-shadow 0.14s ease; flex-shrink: 0; }
        .eco-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 9px 0 rgba(13,148,136,0.65), 0 15px 22px rgba(20,184,166,0.42); }
        .eco-btn:active:not(:disabled) { transform: translateY(4px); box-shadow: 0 3px 0 rgba(13,148,136,0.65); }
        .eco-btn:disabled { background: linear-gradient(180deg, #cbd5e1, #94a3b8); box-shadow: 0 3px 0 rgba(100,116,139,0.5); cursor: not-allowed; opacity: 0.7; }
        .eco-btn.lg { padding: 13px 26px; font-size: 15px; }
        .eco-btn.full { width: 100%; }
        .eco-btn.soft { background: linear-gradient(180deg, #fff, #f0fdfa); color: var(--c-700); border: 2px solid var(--c-100); box-shadow: 0 5px 0 rgba(20,184,166,0.14), 0 9px 14px rgba(20,184,166,0.16); }
        .eco-btn.soft:hover:not(:disabled) { background: linear-gradient(180deg, #fff, #ccfbf1); }
        .eco-btn.danger { background: linear-gradient(180deg, #fb7185, #e11d48); box-shadow: 0 7px 0 rgba(159,18,57,0.6), 0 11px 18px rgba(225,29,72,0.25); }

        .public-board {
          display: flex; flex-direction: column; gap: 12px;
          padding: 16px; border-radius: 22px;
          background: rgba(255,255,255,0.88); border: 1px solid rgba(255,255,255,0.9);
          box-shadow: 0 16px 32px rgba(4,47,46,0.08);
        }
        .public-board-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .public-board-head h2 { margin: 0; font-size: 18px; font-weight: 950; color: var(--c-900); }
        .public-board-head span { display: block; margin-top: 2px; font-size: 12px; font-weight: 800; color: var(--soft); }
        .public-remaining { display: flex; flex-wrap: wrap; gap: 8px; }
        .public-remaining span {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 6px 9px; border-radius: 999px;
          background: rgba(240,253,250,0.9); border: 1px solid var(--c-100);
          font-size: 12px; font-weight: 850; color: var(--c-800);
        }
        .public-remaining b { font-variant-numeric: tabular-nums; }
        .public-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
        .public-entry {
          min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 10px;
          padding: 12px; border-radius: 16px; background: #fff; border: 1px solid var(--c-100);
        }
        .public-entry.stolen { background: #fff1f2; border-color: #fecdd3; }
        .public-entry-main { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .public-entry-emoji { font-size: 24px; flex-shrink: 0; }
        .public-entry-avatar,
        .public-entry-mini-avatar {
          flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
          overflow: hidden; border-radius: 999px; background: linear-gradient(135deg, var(--c-100), #fff);
          border: 1px solid rgba(153,246,228,0.9); color: var(--c-800); font-weight: 950;
        }
        .public-entry-avatar { width: 34px; height: 34px; font-size: 12px; }
        .public-entry-avatar.public-entry-avatar-nav {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);
          border: 0;
          color: #475569;
          font-weight: 800;
          font-size: 14px;
          text-transform: uppercase;
        }
        .public-entry-mini-avatar { width: 18px; height: 18px; margin: 0 4px; font-size: 9px; vertical-align: middle; }
        .public-entry-avatar img,
        .public-entry-mini-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .public-entry-main div { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .public-entry-main b { font-size: 14px; font-weight: 950; color: var(--c-900); }
        .public-entry-main span, .public-entry-main i {
          min-width: 0; font-size: 12px; font-style: normal; font-weight: 750; color: var(--soft);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .public-entry-thief { display: inline-flex; align-items: center; }
        .public-entry-tag { flex-shrink: 0; padding: 5px 8px; border-radius: 999px; background: #ffe4e6; color: #be123c; font-size: 12px; font-weight: 900; }
        .public-empty { grid-column: 1 / -1; padding: 16px; border-radius: 14px; background: rgba(240,253,250,0.75); color: var(--c-700); font-size: 13px; font-weight: 850; text-align: center; }

        /* SPECS */
        .specs { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
        @media (min-width: 720px) { .specs { grid-template-columns: repeat(4, 1fr); } }
        .spec { display: flex; align-items: center; gap: 11px; padding: 14px 16px; border-radius: 18px; background: rgba(255,255,255,0.85); border: 1px solid var(--line); box-shadow: 0 10px 22px rgba(4,47,46,0.05); }
        .spec.is-skeleton { height: 60px; background: rgba(255,255,255,0.55); }
        .spec-icon { width: 38px; height: 38px; border-radius: 12px; background: linear-gradient(135deg, var(--c-100), var(--c-200)); color: var(--c-700); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .spec-body { display: flex; flex-direction: column; min-width: 0; }
        .spec-label { font-size: 11px; font-weight: 700; color: var(--soft); letter-spacing: 0.4px; }
        .spec-value { font-size: 15px; font-weight: 900; color: var(--c-800); margin-top: 1px; }

        /* ACTIONS */
        .eco-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
        .action-tile {
          min-width: 0; min-height: 82px; display: flex; align-items: center; gap: 13px; text-align: left;
          padding: 16px; border: 1px solid rgba(255,255,255,0.92); border-radius: 22px;
          background: linear-gradient(180deg, rgba(255,255,255,0.94), rgba(240,253,250,0.88));
          box-shadow: 0 14px 30px rgba(4,47,46,0.07), inset 0 1px 0 rgba(255,255,255,1);
          color: var(--c-800); cursor: pointer; transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
        }
        .action-tile:hover { transform: translateY(-2px); border-color: var(--c-200); box-shadow: 0 18px 34px rgba(20,184,166,0.14), inset 0 1px 0 rgba(255,255,255,1); }
        .action-tile:active { transform: translateY(1px); }
        .action-tile > span:last-child { display: flex; flex-direction: column; min-width: 0; gap: 3px; }
        .action-tile b { font-size: 17px; font-weight: 900; color: var(--c-900); }
        .action-tile i { font-style: normal; font-size: 12px; font-weight: 800; color: var(--soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .action-icon { width: 44px; height: 44px; border-radius: 15px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; color: #fff; background: linear-gradient(135deg, #14b8a6, #0f766e); box-shadow: 0 10px 20px rgba(20,184,166,0.28); }
        .action-icon.gold { background: linear-gradient(135deg, #f59e0b, #b45309); box-shadow: 0 10px 20px rgba(245,158,11,0.24); }

        /* MODALS */
        .modal-backdrop {
          position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center;
          padding: 24px; background: rgba(15,23,42,0.38); backdrop-filter: blur(10px);
        }
        .eco-modal {
          width: min(1040px, 100%); max-height: min(760px, calc(100vh - 48px)); overflow: auto;
          padding: 22px; border-radius: 26px; border: 1px solid rgba(255,255,255,0.92);
          background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(240,253,250,0.96));
          box-shadow: 0 30px 80px rgba(15,23,42,0.24), inset 0 1px 0 rgba(255,255,255,1);
        }
        .shop-modal { display: flex; flex-direction: column; gap: 16px; }
        .bag-modal { width: min(880px, 100%); display: flex; flex-direction: column; gap: 16px; }
        .rules-modal { width: min(900px, 100%); display: flex; flex-direction: column; gap: 16px; }
        .choice-modal { width: min(520px, 100%); display: flex; flex-direction: column; gap: 16px; }
        .modal-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
        .modal-close {
          width: 38px; height: 38px; border: 1px solid var(--c-100); border-radius: 13px;
          display: inline-flex; align-items: center; justify-content: center;
          color: var(--c-700); background: rgba(255,255,255,0.88); cursor: pointer;
          box-shadow: 0 8px 18px rgba(4,47,46,0.08); transition: transform 0.16s ease, background 0.16s ease;
        }
        .modal-close:hover { transform: translateY(-1px); background: #fff; }
        .modal-close:active { transform: translateY(1px); }

        /* SHOP */
        .shop-title { display: inline-flex; align-items: center; gap: 10px; font-size: 20px; font-weight: 900; letter-spacing: -0.5px; margin: 0; }
        .shop-title-icon { width: 34px; height: 34px; border-radius: 11px; background: linear-gradient(135deg, #14b8a6, #0f766e); color: #fff; display: flex; align-items: center; justify-content: center; box-shadow: 0 10px 20px rgba(20,184,166,0.35); }
        .choice-prize {
          display: grid; grid-template-columns: 62px minmax(0, 1fr); gap: 14px; align-items: center;
          padding: 14px; border-radius: 18px; background: linear-gradient(180deg, #fff, #f0fdfa);
          border: 1px solid var(--c-100);
        }
        .choice-prize h3 { margin: 0 0 5px; font-size: 17px; font-weight: 950; color: var(--c-900); }
        .choice-prize p { margin: 0; font-size: 12.5px; line-height: 1.55; color: var(--soft); font-weight: 700; }
        .choice-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
        .choice-field { display: flex; flex-direction: column; gap: 8px; }
        .choice-field span { font-size: 12px; font-weight: 950; color: var(--c-800); }
        .choice-field textarea {
          width: 100%; resize: vertical; min-height: 86px; border-radius: 16px; border: 1px solid var(--c-100);
          padding: 11px 12px; outline: none; background: rgba(255,255,255,0.92);
          color: var(--ink); font: inherit; font-size: 13px; font-weight: 700;
          box-shadow: inset 0 1px 0 rgba(255,255,255,1);
        }
        .choice-field textarea:focus { border-color: var(--c-300); box-shadow: 0 0 0 3px rgba(20,184,166,0.16); }
        .choice-field i { align-self: flex-end; font-size: 11px; font-style: normal; font-weight: 800; color: var(--soft); }
        .rules-summary {
          display: flex; flex-wrap: wrap; gap: 8px;
          padding: 12px; border-radius: 18px;
          background: linear-gradient(180deg, rgba(240,253,250,0.95), rgba(204,251,241,0.55));
          border: 1px solid var(--c-100);
        }
        .rules-summary span {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 6px 10px; border-radius: 999px;
          background: rgba(255,255,255,0.82); color: var(--c-800);
          font-size: 12px; font-weight: 850; box-shadow: 0 6px 14px rgba(13,148,136,0.07);
        }
        .rules-summary b { color: var(--c-900); font-weight: 950; font-variant-numeric: tabular-nums; }
        .rules-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        .rule-card {
          display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 12px;
          padding: 14px; border-radius: 18px;
          background: linear-gradient(180deg, #fff, #f5fdfb);
          border: 1px solid var(--c-100);
          box-shadow: 0 10px 22px rgba(4,47,46,0.05), inset 0 1px 0 rgba(255,255,255,1);
        }
        .rule-icon {
          width: 40px; height: 40px; border-radius: 14px;
          display: inline-flex; align-items: center; justify-content: center;
          background: linear-gradient(135deg, var(--c-50), var(--c-100));
          border: 1px solid rgba(153,246,228,0.75);
          font-size: 20px; line-height: 1; flex-shrink: 0;
        }
        .rule-card h3 { margin: 0 0 5px; font-size: 15px; font-weight: 950; color: var(--c-900); }
        .rule-card p { margin: 0; font-size: 12.5px; line-height: 1.58; color: var(--soft); font-weight: 650; }
        .shop-tabs { display: inline-flex; background: var(--c-50); border: 1px solid var(--c-100); border-radius: 999px; padding: 4px; }
        .shop-tabs button { border: none; background: transparent; cursor: pointer; padding: 7px 22px; border-radius: 999px; font-weight: 800; font-size: 14px; color: var(--c-700); transition: all 0.2s; }
        .shop-tabs button.on { background: #fff; box-shadow: 0 4px 10px rgba(20,184,166,0.2); }

        .shop-grid { display: grid; grid-template-columns: repeat(1, 1fr); gap: 14px; }
        @media (min-width: 620px) { .shop-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (min-width: 980px) { .shop-grid { grid-template-columns: repeat(3, 1fr); } }
        .sc { display: flex; flex-direction: column; gap: 10px; padding: 18px; border-radius: 20px; background: linear-gradient(180deg, #fff, #f5fdfb); border: 1.5px solid var(--c-100); box-shadow: 0 10px 22px rgba(4,47,46,0.06), inset 0 1px 0 rgba(255,255,255,1); transition: transform 0.2s, box-shadow 0.2s; }
        .sc:hover { transform: translateY(-3px); box-shadow: 0 18px 34px rgba(20,184,166,0.16); }
        .sc.is-maxed { opacity: 0.82; }
        .sc-top { display: flex; align-items: center; gap: 12px; }
        .sc-emoji { font-size: 32px; line-height: 1; flex-shrink: 0; filter: drop-shadow(0 4px 8px rgba(4,47,46,0.12)); }
        .sc-prize-img { width: 52px; height: 52px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; }
        .sc-prize-img img { width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 6px 8px rgba(120,53,15,0.18)); }
        .sc-meta { min-width: 0; }
        .sc-meta h3 { font-size: 16px; font-weight: 900; margin: 0 0 4px; }
        .sc-dots { display: flex; gap: 3px; }
        .sc-dots span { width: 14px; height: 6px; border-radius: 999px; background: rgba(15,118,110,0.15); }
        .sc-dots span.on { background: linear-gradient(90deg, #2dd4bf, #0d9488); }
        .sc-active { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 800; color: var(--c-700); }
        .sc-desc { font-size: 13px; color: var(--soft); line-height: 1.5; margin: 0; flex: 1; }
        .sc-effect { display: flex; flex-wrap: wrap; gap: 6px; }
        .sc-pill { display: inline-flex; align-items: center; gap: 3px; padding: 4px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 800; background: var(--c-50); border: 1px solid var(--c-100); color: var(--c-700); }
        .sc-pill.muted { background: #f1f5f9; border-color: #e2e8f0; color: #64748b; }
        .sc .eco-btn { padding: 10px 16px; font-size: 13.5px; }
        .bag-market { display: flex; flex-direction: column; gap: 14px; }
        .prize-card { background: linear-gradient(180deg, #fff, #fffbeb); border-color: #fde68a; }
        .price-trend { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 900; }
        .price-trend.up { color: #dc2626; }
        .price-trend.down { color: #0284c7; }
        .market-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 11px; border-radius: 14px; background: rgba(255,255,255,0.8); border: 1px solid rgba(253,230,138,0.85); font-size: 13px; color: #92400e; }
        .market-row b { font-size: 17px; color: #78350f; font-weight: 900; font-variant-numeric: tabular-nums; }

        .price-board { display: flex; flex-direction: column; gap: 12px; padding-top: 2px; }
        .price-board-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .price-board-head h3 { margin: 0; font-size: 17px; font-weight: 900; color: var(--c-900); }
        .price-board-head > div > span { display: block; margin-top: 2px; font-size: 12px; font-weight: 800; color: var(--soft); }
        .price-selector { display: inline-flex; align-items: center; gap: 9px; font-size: 12px; font-weight: 900; color: var(--c-700); }
        .price-selector select {
          min-width: 128px; height: 36px; border-radius: 12px; border: 1px solid var(--c-100);
          background: #fff; color: var(--c-800); font-size: 13px; font-weight: 900; padding: 0 34px 0 12px;
          outline: none; cursor: pointer; box-shadow: 0 8px 16px rgba(13,148,136,0.08);
        }
        .price-selector select:focus { border-color: var(--c-300); box-shadow: 0 0 0 3px rgba(20,184,166,0.18); }
        .price-focus-card {
          width: 100%; min-width: 0; display: flex; flex-direction: column; gap: 16px; padding: 16px;
          border-radius: 20px; background: linear-gradient(180deg, #ffffff, #f0fdfa);
          border: 1px solid var(--c-100); box-shadow: 0 10px 22px rgba(13,148,136,0.08);
        }
        .price-focus-top { display: grid; grid-template-columns: 58px minmax(0, 1fr) auto auto; align-items: center; gap: 14px; }
        .price-focus-top .sc-prize-img { width: 58px; height: 58px; }
        .price-focus-main { min-width: 0; }
        .price-focus-main h4 { margin: 0 0 5px; font-size: 18px; font-weight: 900; color: var(--c-900); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .price-focus-stats {
          min-width: 92px; padding: 9px 12px; border-radius: 15px; background: rgba(240,253,250,0.85);
          border: 1px solid var(--c-100); text-align: right;
        }
        .price-focus-stats span { display: block; font-size: 11px; font-weight: 900; color: var(--c-700); }
        .price-focus-stats b { display: block; margin-top: 2px; font-size: 18px; font-weight: 950; color: var(--c-900); font-variant-numeric: tabular-nums; }
        .price-empty, .sparkline-empty { padding: 24px; border-radius: 18px; border: 1px dashed var(--c-200); background: rgba(240,253,250,0.7); color: var(--c-700); font-size: 13px; font-weight: 900; text-align: center; }
        .sparkline { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
        .sparkline-chart { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 10px; align-items: stretch; }
        .sparkline-y-labels { position: relative; height: 124px; color: var(--c-700); font-size: 11px; font-weight: 800; font-variant-numeric: tabular-nums; }
        .sparkline-y-labels span { position: absolute; right: 0; line-height: 1; opacity: 0.85; }
        .sparkline-plot { position: relative; height: 124px; }
        .sparkline svg { display: block; width: 100%; height: 100%; overflow: visible; }
        .sparkline-grid { fill: none; stroke: var(--c-700); stroke-opacity: 0.13; stroke-width: 1; stroke-dasharray: 2.5 4; stroke-linecap: round; }
        .sparkline-area { stroke: none; }
        .sparkline-line { fill: none; stroke: var(--c-600); stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; filter: drop-shadow(0 4px 7px rgba(13,148,136,0.28)); }
        .sparkline-node {
          position: absolute; width: 16px; height: 16px; padding: 0; border-radius: 999px;
          background: #fff; border: 2px solid var(--c-600);
          box-shadow: 0 2px 6px rgba(13,148,136,0.25);
          transform: translate(-50%, -50%); cursor: pointer;
        }
        .sparkline-node::after {
          content: ""; position: absolute; inset: 3px; border-radius: inherit; background: var(--c-600);
        }
        .sparkline-node:hover,
        .sparkline-node:focus-visible {
          outline: none;
          box-shadow: 0 0 0 4px rgba(20,184,166,0.18), 0 4px 11px rgba(13,148,136,0.38);
        }
        .sparkline-node.selected {
          width: 18px; height: 18px; border-color: var(--c);
          box-shadow: 0 0 0 4px rgba(20,184,166,0.18), 0 4px 11px rgba(13,148,136,0.38);
        }
        .sparkline-date-row { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 10px; }
        .sparkline-date-labels { position: relative; height: 16px; color: var(--c-700); font-size: 11px; font-weight: 800; }
        .sparkline-date-labels span { position: absolute; top: 0; line-height: 1; transform: translateX(-50%); white-space: nowrap; opacity: 0.82; }
        .price-point-detail { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
        .price-point-detail div {
          min-width: 0; padding: 9px 10px; border-radius: 14px;
          background: rgba(255,255,255,0.82); border: 1px solid var(--c-100);
        }
        .price-point-detail span { display: block; font-size: 11px; font-weight: 900; color: var(--c-700); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .price-point-detail b { display: block; margin-top: 3px; font-size: 15px; font-weight: 950; color: var(--c-900); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        @media (max-width: 720px) {
          .scene-empty { gap: 7px; font-size: 12.5px; text-align: center; padding: 0 18px; }
          .scene-empty p { margin: 0; }
          .scene-empty-emoji { font-size: 36px; }
          .point-progress {
            grid-template-columns: 84px minmax(0, 1fr);
            gap: 7px 9px;
            margin-top: 8px;
            padding: 9px 11px;
            border-radius: 16px;
          }
          .point-progress-top span { font-size: 10px; }
          .point-progress-top b { font-size: 14px; }
          .point-progress-top i { font-size: 10px; }
          .point-progress-track { height: 7px; }
          .point-progress em { grid-column: 1 / -1; font-size: 10.5px; }
          .stage-bar { margin-top: 8px; padding: 9px 11px; border-radius: 16px; }
          .bag { gap: 9px; }
          .bag-emoji { font-size: 22px; }
          .bag-top { margin-bottom: 4px; }
          .bag-label { font-size: 10.5px; letter-spacing: 0.2px; }
          .bag-num { font-size: 15px; }
          .bag-num i { font-size: 10.5px; }
          .bag-bar { height: 7px; }
          .effect-progress-list {
            grid-template-columns: 1fr;
            gap: 8px;
            margin-top: 8px;
          }
          .effect-progress {
            padding: 10px 11px;
            border-radius: 15px;
          }
          .effect-progress-head { gap: 8px; }
          .effect-progress-name { font-size: 12px; }
          .effect-progress-head b { font-size: 11px; }
          .effect-progress-track { height: 7px; margin-top: 7px; }
          .effect-progress em { margin-top: 5px; font-size: 10.5px; }
          .stage-tip { margin: 7px 2px 0; font-size: 12px; line-height: 1.4; }
          .specs { gap: 8px; }
          .spec { min-height: 54px; gap: 8px; padding: 10px 9px; border-radius: 14px; }
          .spec.is-skeleton { height: 54px; }
          .spec-icon { width: 30px; height: 30px; border-radius: 10px; }
          .spec-icon svg { width: 15px; height: 15px; }
          .spec-label { font-size: 10px; letter-spacing: 0.2px; }
          .spec-value { font-size: 13px; }
          .eco-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
          .public-board { padding: 11px; border-radius: 16px; gap: 9px; }
          .public-list { grid-template-columns: 1fr; gap: 8px; }
          .public-entry { padding: 10px; border-radius: 14px; }
          .public-entry-avatar { width: 30px; height: 30px; }
          .public-entry-avatar.public-entry-avatar-nav { width: 32px; height: 32px; font-size: 12px; }
          .public-entry .eco-btn { min-height: 34px; padding: 7px 10px; font-size: 12px; }
          .action-tile { min-height: 58px; gap: 9px; padding: 10px; border-radius: 16px; }
          .action-icon { width: 34px; height: 34px; border-radius: 11px; }
          .action-icon svg { width: 18px; height: 18px; }
          .action-tile b { font-size: 15px; }
          .action-tile i { font-size: 10.5px; }
          .modal-backdrop {
            align-items: flex-end;
            padding: 8px;
            padding-bottom: max(8px, env(safe-area-inset-bottom));
          }
          .eco-modal {
            max-height: min(92vh, calc(100vh - 16px));
            max-height: min(92dvh, calc(100dvh - 16px));
            padding: 14px 12px;
            border-radius: 20px 20px 16px 16px;
            overscroll-behavior: contain;
            -webkit-overflow-scrolling: touch;
          }
          .shop-modal,
          .bag-modal,
          .rules-modal,
          .choice-modal { gap: 10px; }
          .modal-head { gap: 10px; }
          .modal-close { width: 34px; height: 34px; border-radius: 11px; }
          .shop-title { gap: 8px; font-size: 17px; }
          .shop-title-icon { width: 30px; height: 30px; border-radius: 10px; }
          .rules-summary { gap: 6px; padding: 9px; border-radius: 15px; }
          .rules-summary span { padding: 5px 8px; font-size: 11px; }
          .rules-grid { grid-template-columns: 1fr; gap: 8px; }
          .rule-card { grid-template-columns: 34px minmax(0, 1fr); gap: 9px; padding: 11px; border-radius: 15px; }
          .rule-icon { width: 34px; height: 34px; border-radius: 12px; font-size: 18px; }
          .rule-card h3 { margin-bottom: 3px; font-size: 13.5px; }
          .rule-card p { font-size: 11.5px; line-height: 1.5; }
          .choice-prize { grid-template-columns: 46px minmax(0, 1fr); gap: 10px; padding: 11px; border-radius: 15px; }
          .choice-prize .sc-prize-img { width: 44px; height: 44px; }
          .choice-prize h3 { font-size: 14.5px; }
          .choice-prize p { font-size: 11.5px; line-height: 1.48; }
          .choice-actions { grid-template-columns: 1fr; gap: 8px; }
          .choice-field textarea { min-height: 78px; border-radius: 14px; font-size: 12.5px; }
          .shop-tabs { width: 100%; }
          .shop-tabs button { flex: 1; padding: 7px 10px; font-size: 13px; }
          .shop-grid { gap: 9px; }
          .sc { gap: 8px; padding: 12px; border-radius: 16px; }
          .sc-top { gap: 9px; }
          .sc-emoji { font-size: 26px; }
          .sc-prize-img { width: 44px; height: 44px; }
          .sc-meta h3 { margin-bottom: 2px; font-size: 14.5px; }
          .sc-dots span { width: 11px; height: 5px; }
          .sc-desc { font-size: 12px; line-height: 1.42; }
          .sc-effect { gap: 4px; }
          .sc-pill { padding: 3px 7px; font-size: 10.5px; }
          .sc-active,
          .price-trend { font-size: 11px; }
          .sc .eco-btn { min-height: 38px; padding: 8px 12px; font-size: 12.5px; }
          .bag-market { gap: 9px; }
          .market-row { gap: 6px; padding: 7px 8px; border-radius: 12px; font-size: 12px; }
          .market-row span { white-space: nowrap; }
          .market-row b { font-size: 15px; }
          .price-board { gap: 10px; }
          .price-board-head { flex-direction: column; align-items: stretch; gap: 10px; }
          .price-board-head h3 { font-size: 16px; }
          .price-board-head > div > span { font-size: 11px; }
          .price-selector { justify-content: space-between; }
          .price-selector select { flex: 1; min-width: 0; height: 34px; font-size: 12px; }
          .price-focus-card { padding: 12px; border-radius: 16px; gap: 10px; }
          .price-focus-top { grid-template-columns: 44px minmax(0, 1fr); gap: 8px; }
          .price-focus-top .sc-prize-img { width: 44px; height: 44px; }
          .price-focus-main h4 { margin-bottom: 3px; font-size: 15px; }
          .price-focus-stats {
            grid-column: 1 / -1;
            min-width: 0;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 7px 9px;
            border-radius: 12px;
            text-align: left;
          }
          .price-focus-stats b { margin-top: 0; font-size: 15px; }
          .sparkline-chart, .sparkline-date-row { grid-template-columns: 28px minmax(0, 1fr); gap: 6px; }
          .sparkline-y-labels, .sparkline-plot { height: 104px; }
          .sparkline-y-labels, .sparkline-date-labels { font-size: 10px; }
          .price-point-detail { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
          .price-point-detail div { padding: 7px 8px; border-radius: 12px; }
          .price-point-detail span { font-size: 10px; }
          .price-point-detail b { font-size: 13px; }
        }
      `}</style>
    </div>
  );
}
