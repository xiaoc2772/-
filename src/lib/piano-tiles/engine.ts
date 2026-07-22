import type { ChartNote, CompiledChart, PianoTilesMode } from './types';

/**
 * 钢琴块引擎——复刻钢琴块2原版机制：
 * - 音块高度 = 音符时值，相邻音块首尾相接（休止处留空档）；一屏纵向约 4 个单位块
 * - 画面自动下滚（速度随圈数递增），滚动进度即"相机时间"（谱面毫秒域）
 * - 开局有一个独立的「开始」块，点击它才启动滚动，不计分
 * - 玩家按序点击黑块：可提前点（块已进屏即可），点错列（白块）即失败
 * - 黑块底边越过屏幕底部仍未点击 → 失败；无判定窗口，命中 +1 分
 * - 时值 >= 1.75 单位拍的音符为长按块，按住可得 0-3 额外分
 * - 曲目无限循环，每完成一圈提速；前三圈各得一枚皇冠
 * - rush 模式：同样机制，60 秒定时结束
 */

/** 每圈提速比例。 */
export const LAP_SPEED_STEP = 0.12;
/** 服务端事件密度上限为 30 条/秒；当前内置谱面最小间隔为 120ms，3 倍约 25 条/秒。 */
export const MAX_SPEED_MULTIPLIER = 3;
export const MAX_CROWNS = 3;
/** 黑块底边越过屏幕底部后的容差毫秒（谱面时间域）。 */
export const MISS_GRACE_MS = 120;
/** 一屏纵向可见的单位块数（原作为 4）。 */
export const VIEW_UNITS = 4;
/** 长按块阈值：时值 >= 1.75 × 单位拍。 */
export const HOLD_UNITS_THRESHOLD = 1.75;
export const HOLD_BONUS_MAX = 3;
export const RUSH_DURATION_MS = 60_000;

export type EngineStatus = 'ready' | 'running' | 'failed' | 'timeup';

export interface Tile {
  /** 全局序号（跨圈递增）；开始块为 -1。 */
  index: number;
  /** 音块底边到达屏幕底部的相机时刻（= 音符起始时刻）。 */
  t: number;
  lane: 0 | 1 | 2 | 3;
  /** 时值毫秒 = 块高。 */
  d: number;
  pitches: string[];
  lap: number;
}

export type TapOutcome =
  | { kind: 'start'; tile: Tile }
  | { kind: 'hit'; tile: Tile; scoreDelta: number }
  | { kind: 'wrong'; lane: number }
  | { kind: 'ignored' };

export interface EngineResult {
  mode: PianoTilesMode;
  status: EngineStatus;
  score: number;
  tilesHit: number;
  crowns: number;
  laps: number;
  /** 结束时相机时间（谱面毫秒域，含跨圈累计）。 */
  playedMs: number;
  totalNotes: number;
}

export interface PianoTilesEngine {
  readonly status: EngineStatus;
  readonly lap: number;
  readonly score: number;
  /** 当前圈速倍率。 */
  speedMultiplier(): number;
  /** 一屏对应的谱面时间跨度 = VIEW_UNITS × unitMs。 */
  viewWindowMs(): number;
  /** 是否为长按块。 */
  isHold(tile: Tile): boolean;
  /** 玩家点击某列；cameraMs 为当前相机时间。 */
  tap(lane: number, cameraMs: number): TapOutcome;
  /**
   * 松开长按：按当前相机进度结算加分并结束长按。
   * 返回本次长按累计获得的加分。
   */
  release(cameraMs: number): number;
  /**
   * 活跃长按状态（渲染进度动画用）：
   * progress 0-1 为相机划过长按块的比例，granted 为已累计加分。
   */
  holdState(cameraMs: number): { tile: Tile; progress: number; granted: number } | null;
  /** 推进相机，检查漏块并累计长按加分；返回是否本帧发生失败。 */
  tick(cameraMs: number): boolean;
  /** 强制结束（rush 到时）。 */
  timeUp(): void;
  /** 下一个待点击音块（未开始时为「开始」块）。 */
  nextTile(): Tile | null;
  /** 供渲染：从下一块起的连续音块（含未消费的「开始」块）。 */
  upcomingTiles(count: number): Tile[];
  /** 单圈谱面时长（相机时间域）。 */
  lapDurationMs(): number;
  result(): EngineResult;
}

function tileFor(note: ChartNote, lap: number, lapMs: number, index: number): Tile {
  return {
    index,
    t: note.t + lap * lapMs,
    lane: note.lane,
    d: note.d,
    pitches: note.pitches,
    lap,
  };
}

export function createEngine(chart: CompiledChart, mode: PianoTilesMode): PianoTilesEngine {
  const notes = chart.notes;
  const unitMs = chart.unitMs > 0 ? chart.unitMs : 250;
  // 圈长必须与服务端 LapDurationMS 完全一致，否则长局跨圈误差会累积并导致结算拒绝。
  const lastNote = notes[notes.length - 1];
  const lapRawMs = Math.max(
    chart.durationMs,
    lastNote ? lastNote.t + Math.max(lastNote.d, 400) : 0,
  );
  const lapMs = lapRawMs;

  // 「开始」块：位于第一块正下方一个单位处，错开轨道避免视觉粘连
  const startTile: Tile | null =
    notes.length > 0
      ? {
          index: -1,
          t: notes[0].t - unitMs,
          lane: ((notes[0].lane + 2) % 4) as Tile['lane'],
          d: unitMs,
          pitches: [],
          lap: 0,
        }
      : null;

  let status: EngineStatus = 'ready';
  let startConsumed = startTile === null;
  let nextIndex = 0;
  let score = 0;
  let tilesHit = 0;
  let lap = 0;
  let lastCamera = 0;
  /** 活跃长按：从按下时刻起算进度，随相机推进逐步计分。 */
  let hold: { tile: Tile; granted: number; startCam: number } | null = null;

  const tileAt = (index: number): Tile | null => {
    if (notes.length === 0) return null;
    const l = Math.floor(index / notes.length);
    return tileFor(notes[index % notes.length], l, lapMs, index);
  };

  const speedMultiplier = () => Math.min(MAX_SPEED_MULTIPLIER, 1 + lap * LAP_SPEED_STEP);
  const viewWindowMs = () => VIEW_UNITS * unitMs;
  const isHold = (tile: Tile) => tile.index >= 0 && tile.d >= HOLD_UNITS_THRESHOLD * unitMs;

  /** 长按进度：从按下时刻起算，相机到达块尾时恰好填满。 */
  const holdProgress = (cameraMs: number): number => {
    if (!hold) return 0;
    const total = Math.max(1, hold.tile.t + hold.tile.d - hold.startCam);
    return Math.max(0, Math.min(1, (cameraMs - hold.startCam) / total));
  };

  /** 按进度补发长按加分（逐步入账，HUD 分数随按住时间增长）。 */
  const accrueHold = (cameraMs: number) => {
    if (!hold) return;
    const due = Math.floor(holdProgress(cameraMs) * HOLD_BONUS_MAX);
    if (due > hold.granted) {
      score += due - hold.granted;
      hold.granted = due;
    }
    // 划完整块自动结束长按
    if (cameraMs >= hold.tile.t + hold.tile.d) hold = null;
  };

  const engine: PianoTilesEngine = {
    get status() {
      return status;
    },
    get lap() {
      return lap;
    },
    get score() {
      return score;
    },

    speedMultiplier,
    viewWindowMs,
    isHold,

    tap(lane, cameraMs) {
      lastCamera = cameraMs;
      if (status === 'failed' || status === 'timeup') return { kind: 'ignored' };

      // 「开始」块：点中才启动，点别处忽略（原作开局点空白不判负）
      if (!startConsumed && startTile) {
        if (lane !== startTile.lane) return { kind: 'ignored' };
        startConsumed = true;
        status = 'running';
        return { kind: 'start', tile: startTile };
      }
      if (status !== 'running') return { kind: 'ignored' };

      const tile = tileAt(nextIndex);
      if (!tile) return { kind: 'ignored' };
      const visible = tile.t <= cameraMs + viewWindowMs();
      if (!visible || tile.lane !== lane) {
        status = 'failed';
        return { kind: 'wrong', lane };
      }
      nextIndex += 1;
      tilesHit += 1;
      score += 1;
      if (isHold(tile)) hold = { tile, granted: 0, startCam: cameraMs };
      const newLap = Math.floor(nextIndex / notes.length);
      if (newLap > lap) lap = newLap;
      return { kind: 'hit', tile, scoreDelta: 1 };
    },

    release(cameraMs) {
      if (!hold) return 0;
      accrueHold(cameraMs);
      const granted = hold?.granted ?? HOLD_BONUS_MAX; // accrue 可能已自动完成
      hold = null;
      return granted;
    },

    holdState(cameraMs) {
      if (!hold) return null;
      return { tile: hold.tile, progress: holdProgress(cameraMs), granted: hold.granted };
    },

    tick(cameraMs) {
      lastCamera = cameraMs;
      if (status !== 'running') return false;
      accrueHold(cameraMs);
      const tile = tileAt(nextIndex);
      if (tile && cameraMs > tile.t + MISS_GRACE_MS) {
        status = 'failed';
        return true;
      }
      return false;
    },

    timeUp() {
      if (status === 'running') status = 'timeup';
    },

    nextTile() {
      if (!startConsumed) return startTile;
      return tileAt(nextIndex);
    },

    upcomingTiles(count) {
      const out: Tile[] = [];
      if (!startConsumed && startTile) out.push(startTile);
      for (let i = nextIndex; out.length < count; i += 1) {
        const tile = tileAt(i);
        if (!tile) break;
        out.push(tile);
      }
      return out;
    },

    lapDurationMs() {
      return lapMs;
    },

    result() {
      return {
        mode,
        status,
        score,
        tilesHit,
        crowns: Math.min(lap, MAX_CROWNS),
        laps: lap,
        playedMs: Math.round(lastCamera),
        totalNotes: notes.length,
      };
    },
  };

  return engine;
}
