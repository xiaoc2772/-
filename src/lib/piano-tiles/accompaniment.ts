import type { AccompanimentNote } from './types';

/**
 * 弹性伴奏跟随器：伴奏播放头不再严格贴合相机时钟，而是像伴奏乐手跟随独奏者——
 * 玩家点得快时伴奏加速追上（最高 ACC_MAX_CHASE_RATE 倍速），点得慢时伴奏在
 * 下一个待击音块前沿减速等待，保证伴奏进度始终与玩家的点击进度一致，
 * 一圈结束时伴奏与音块同起同收，也不会抢先进入下一圈。
 */

/** 追赶软区间（谱面毫秒）：落后该值时速率约为 2 倍，误差越大追得越快。 */
export const ACC_CHASE_SOFT_MS = 600;
/** 追赶速率上限（相对滚动速度的倍数），防止积压音符机关枪式连发。 */
export const ACC_MAX_CHASE_RATE = 2.5;
/** 落后超过该值直接跳段重同步（静默丢弃被跳过的伴奏音符），仅极端连点触发。 */
export const ACC_HARD_RESYNC_MS = 2500;
/** 点击领先量的 EMA 平滑系数：避免单次早点/晚点造成伴奏速度突变。 */
export const ACC_LEAD_SMOOTHING = 0.35;
/** 已明显过期音符的静默丢弃阈值（谱面毫秒，按滚动速度缩放）。 */
const STALE_SKIP_MS = 50;
/** 单帧最多消费的伴奏音符数（与原相机驱动实现一致的防失控上限）。 */
const MAX_NOTES_PER_FRAME = 64;
/** 播放头与下一待击块前沿的最小间隙：恰在块上的伴奏音符等点击后再发声。 */
const CEILING_EPS_MS = 0.001;
/** 有效速率低于该值视为伴奏暂停，本帧不再调度（避免除零）。 */
const MIN_EFFECTIVE_RATE = 1e-6;

export interface AccompanimentFollowerState {
  /** 伴奏播放头（谱面毫秒域，跨圈累计）。 */
  posMs: number;
  /** 下一个待调度伴奏音符下标。 */
  index: number;
  /** 伴奏已循环圈数。 */
  lap: number;
  /** 玩家点击相对相机的平滑领先量（谱面毫秒，点得晚为负）。 */
  leadMs: number;
}

export interface AccompanimentFrameInput {
  /** 本帧真实毫秒（已做卡顿钳制）。 */
  dtMs: number;
  /** 当前滚动速度倍率（谱面毫秒 / 真实毫秒）。 */
  speed: number;
  /** 当前相机时间（谱面毫秒域）。 */
  cameraMs: number;
  /** 下一个待击音块的 t（跨圈绝对值）；伴奏播放头不越过它。 */
  nextTileMs: number;
  /** 单圈谱面时长。 */
  lapMs: number;
  /** 前瞻调度窗口（真实毫秒）。 */
  lookaheadMs: number;
}

export interface ScheduledAccompaniment {
  note: AccompanimentNote;
  /** 交给 AudioContext 硬件时钟的真实毫秒延迟。 */
  delayMs: number;
}

export function createAccompanimentFollower(posMs: number): AccompanimentFollowerState {
  return { posMs, index: 0, lap: 0, leadMs: 0 };
}

/**
 * 命中音块时更新领先量：tileT 为被点中块的 t（跨圈绝对值）。
 * 提前点击 tileT > cameraMs（领先为正），压线点击则接近 0 或为负。
 */
export function noteAccompanimentHit(
  state: AccompanimentFollowerState,
  tileT: number,
  cameraMs: number,
): AccompanimentFollowerState {
  const leadMs = state.leadMs + (tileT - cameraMs - state.leadMs) * ACC_LEAD_SMOOTHING;
  return { ...state, leadMs };
}

/**
 * 推进伴奏播放头一帧，返回新状态与本帧需交给采样器调度的音符。
 * 追赶目标 = 相机进度 + 点击领先量；播放头以误差比例调速逼近目标，
 * 且永不越过下一待击块前沿（点得慢时伴奏在此等待玩家）。
 */
export function advanceAccompanimentFollower(
  state: AccompanimentFollowerState,
  notes: readonly AccompanimentNote[],
  input: AccompanimentFrameInput,
): { state: AccompanimentFollowerState; schedule: ScheduledAccompaniment[] } {
  if (notes.length === 0) return { state, schedule: [] };
  const { dtMs, speed, cameraMs, nextTileMs, lapMs, lookaheadMs } = input;

  const chaseTarget = cameraMs + state.leadMs;
  const ceiling = nextTileMs - CEILING_EPS_MS;

  // 极端落后（如开局瞬间连点一整屏）：跳段重同步，跳过的音符由下方静默丢弃。
  let posMs = state.posMs;
  if (chaseTarget - posMs > ACC_HARD_RESYNC_MS) {
    posMs = Math.max(posMs, Math.min(chaseTarget - ACC_CHASE_SOFT_MS, ceiling));
  }

  const err = chaseTarget - posMs;
  const rate = Math.min(ACC_MAX_CHASE_RATE, Math.max(0, 1 + err / ACC_CHASE_SOFT_MS));
  // 大跳帧（卡顿恢复）下防止按比例追赶冲过目标后停顿：单帧推进不超过
  // 误差本身（且不低于随相机的正常速率），避免伴奏先狂奔再冻结的顿挫。
  const uncappedRate = speed * rate;
  const effRate =
    err > 0 && dtMs > 0 ? Math.min(uncappedRate, Math.max(err / dtMs, speed)) : uncappedRate;
  const nextPosMs = Math.min(posMs + dtMs * effRate, Math.max(posMs, ceiling));

  // 调度窗口：播放头前方 lookahead 真实毫秒内、且不越过下一待击块的音符。
  const horizonMs = Math.min(nextPosMs + lookaheadMs * effRate, ceiling);
  const schedule: ScheduledAccompaniment[] = [];
  let index = state.index;
  let lap = state.lap;
  let consumed = 0;
  while (consumed < MAX_NOTES_PER_FRAME) {
    const note = notes[index];
    const noteTime = note.t + lap * lapMs;
    if (noteTime > horizonMs) break;
    if (noteTime >= posMs - STALE_SKIP_MS * speed) {
      // 伴奏暂停（速率≈0）时不调度也不消费，待速率恢复后原样补发。
      if (effRate < MIN_EFFECTIVE_RATE) break;
      schedule.push({ note, delayMs: Math.max(0, (noteTime - posMs) / effRate) });
    }
    // 更早的音符为初始定位/跳段重同步产生的过期音符，静默消费。
    index += 1;
    if (index >= notes.length) {
      index = 0;
      lap += 1;
    }
    consumed += 1;
  }

  return { state: { posMs: nextPosMs, index, lap, leadMs: state.leadMs }, schedule };
}
