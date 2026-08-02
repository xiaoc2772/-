import { describe, expect, test } from 'vitest';
import {
  ACC_CHASE_SOFT_MS,
  ACC_HARD_RESYNC_MS,
  ACC_LEAD_SMOOTHING,
  ACC_MAX_CHASE_RATE,
  advanceAccompanimentFollower,
  createAccompanimentFollower,
  noteAccompanimentHit,
  type AccompanimentFollowerState,
  type AccompanimentFrameInput,
} from '../piano-tiles/accompaniment';
import type { AccompanimentNote } from '../piano-tiles/types';

const LAP_MS = 4000;
const DT = 16;

function makeNotes(ts: number[]): AccompanimentNote[] {
  return ts.map((t) => ({ t, pitches: ['c1'], instrument: 'piano' }));
}

function frame(over: Partial<AccompanimentFrameInput> = {}): AccompanimentFrameInput {
  return {
    dtMs: DT,
    speed: 1,
    cameraMs: 0,
    nextTileMs: Number.POSITIVE_INFINITY,
    lapMs: LAP_MS,
    lookaheadMs: 150,
    ...over,
  };
}

describe('createAccompanimentFollower / noteAccompanimentHit', () => {
  test('创建时播放头定位到给定位置，领先量为 0', () => {
    expect(createAccompanimentFollower(1234)).toEqual({ posMs: 1234, index: 0, lap: 0, leadMs: 0 });
  });

  test('命中更新领先量为 EMA 平滑值，且不修改原状态', () => {
    const s0 = createAccompanimentFollower(0);
    const s1 = noteAccompanimentHit(s0, 1000, 0);
    expect(s1.leadMs).toBeCloseTo(1000 * ACC_LEAD_SMOOTHING);
    const s2 = noteAccompanimentHit(s1, 1000, 0);
    expect(s2.leadMs).toBeCloseTo(350 + (1000 - 350) * ACC_LEAD_SMOOTHING);
    expect(s0.leadMs).toBe(0);
    expect(s1.leadMs).toBeCloseTo(350);
  });

  test('压线晚点产生负领先量', () => {
    const s = noteAccompanimentHit(createAccompanimentFollower(0), 880, 1000);
    expect(s.leadMs).toBeCloseTo(-120 * ACC_LEAD_SMOOTHING);
  });
});

describe('advanceAccompanimentFollower', () => {
  test('空伴奏直接返回原状态且不调度', () => {
    const s = createAccompanimentFollower(0);
    const out = advanceAccompanimentFollower(s, [], frame());
    expect(out.state).toBe(s);
    expect(out.schedule).toEqual([]);
  });

  test('同步演奏时播放头贴合相机，每个音符只调度一次且落点准确', () => {
    const notes = makeNotes([100, 300, 700, 1200]);
    let state = createAccompanimentFollower(0);
    let camera = 0;
    const fired: Array<{ t: number; fireAt: number }> = [];
    for (let k = 0; k < 100; k += 1) {
      camera += DT;
      const elapsed = camera - DT; // 本帧起点的真实毫秒（speed=1 时与谱面毫秒同域）
      const out = advanceAccompanimentFollower(state, notes, frame({ cameraMs: camera }));
      for (const item of out.schedule) fired.push({ t: item.note.t, fireAt: elapsed + item.delayMs });
      state = out.state;
    }
    expect(fired.map((f) => f.t)).toEqual([100, 300, 700, 1200]);
    for (const f of fired) expect(Math.abs(f.fireAt - f.t)).toBeLessThan(20);
    // 播放头始终跟住相机（锁定后误差收敛）
    expect(Math.abs(state.posMs - camera)).toBeLessThan(20);
  });

  test('玩家提前点击后伴奏加速追赶并收敛到领先进度', () => {
    const notes = makeNotes([100000]);
    let state = noteAccompanimentHit(createAccompanimentFollower(0), 800, 0);
    const lead = state.leadMs;
    expect(lead).toBeCloseTo(280);
    let camera = 0;
    const firstAdvance = advanceAccompanimentFollower(state, notes, frame({ cameraMs: camera + DT }));
    // 追赶期速率高于相机速度
    expect(firstAdvance.state.posMs - state.posMs).toBeGreaterThan(DT);
    for (let k = 0; k < 150; k += 1) {
      camera += DT;
      state = advanceAccompanimentFollower(state, notes, frame({ cameraMs: camera })).state;
    }
    expect(Math.abs(camera + lead - state.posMs)).toBeLessThan(20);
  });

  test('追赶速率封顶，不会机关枪式狂奔', () => {
    const state: AccompanimentFollowerState = { posMs: 0, index: 0, lap: 0, leadMs: 2000 };
    const out = advanceAccompanimentFollower(state, makeNotes([100000]), frame());
    expect(out.state.posMs).toBeCloseTo(DT * ACC_MAX_CHASE_RATE);
  });

  test('落后超过阈值时跳段重同步，被跳过的音符静默丢弃', () => {
    const state: AccompanimentFollowerState = { posMs: 0, index: 0, lap: 0, leadMs: 3000 };
    expect(state.leadMs).toBeGreaterThan(ACC_HARD_RESYNC_MS);
    const notes = makeNotes([0, 1000, 2360, 2500]);
    const out = advanceAccompanimentFollower(state, notes, frame());
    // 播放头跳到目标前 ACC_CHASE_SOFT_MS 处再弹性追赶
    const jumpedTo = 3000 - ACC_CHASE_SOFT_MS;
    expect(out.state.posMs).toBeCloseTo(jumpedTo + DT * 2); // err=600 → 2 倍速
    expect(out.schedule.map((i) => i.note.t)).toEqual([2360, 2500]);
    expect(out.schedule[0].delayMs).toBe(0); // 轻微过期的音符立即补发
    expect(out.schedule[1].delayMs).toBeCloseTo((2500 - jumpedTo) / 2);
  });

  test('播放头永不越过下一待击块，点得慢时在块前沿等待', () => {
    const notes = makeNotes([400, 500]);
    let state = createAccompanimentFollower(0);
    let camera = 0;
    const scheduled: number[] = [];
    for (let k = 0; k < 60; k += 1) {
      camera += DT;
      const out = advanceAccompanimentFollower(state, notes, frame({ cameraMs: camera, nextTileMs: 500 }));
      scheduled.push(...out.schedule.map((i) => i.note.t));
      state = out.state;
    }
    expect(scheduled).toEqual([400]); // 恰在待击块上的伴奏音符不提前发声
    expect(state.posMs).toBeLessThan(500);
    expect(state.posMs).toBeGreaterThan(499.9); // 已贴到块前沿等待

    // 玩家终于点击该块：领先量重锚，块上的伴奏音符随点击立即补发
    state = noteAccompanimentHit(state, 500, camera);
    const out = advanceAccompanimentFollower(state, notes, frame({ cameraMs: camera, nextTileMs: 900 }));
    expect(out.schedule.map((i) => i.note.t)).toEqual([500]);
    expect(out.schedule[0].delayMs).toBeLessThan(1);
  });

  test('负领先量（点得偏晚）时伴奏放慢但不倒退', () => {
    const state: AccompanimentFollowerState = { posMs: 100, index: 0, lap: 0, leadMs: -120 };
    const out = advanceAccompanimentFollower(state, makeNotes([100000]), frame({ cameraMs: 100 }));
    expect(out.state.posMs).toBeCloseTo(100 + DT * (1 - 120 / ACC_CHASE_SOFT_MS));
  });

  test('大跳帧不冲过追赶目标（避免伴奏先狂奔后停顿）', () => {
    // 卡顿 800ms 后的一帧：相机已前进 810，播放头单帧恰好追平目标而非按追赶倍速冲过
    const state: AccompanimentFollowerState = { posMs: 0, index: 0, lap: 0, leadMs: 0 };
    const out = advanceAccompanimentFollower(
      state,
      makeNotes([100000]),
      frame({ dtMs: 800, cameraMs: 810 }),
    );
    expect(out.state.posMs).toBeCloseTo(810);
  });

  test('目标远落后于播放头时速率降为 0：不推进、不调度、音符原地保留', () => {
    const state: AccompanimentFollowerState = { posMs: 0, index: 0, lap: 0, leadMs: -1000 };
    const out = advanceAccompanimentFollower(state, makeNotes([0]), frame());
    expect(out.state.posMs).toBe(0);
    expect(out.state.index).toBe(0);
    expect(out.schedule).toEqual([]);
    expect(Number.isNaN(out.state.posMs)).toBe(false);
  });

  test('跨圈循环：下标回绕并按圈数偏移音符时间', () => {
    const notes = makeNotes([0, 2000]);
    const atLapEnd: AccompanimentFollowerState = { posMs: 3900, index: 0, lap: 1, leadMs: 0 };
    const out = advanceAccompanimentFollower(atLapEnd, notes, frame({ cameraMs: 3900 }));
    expect(out.schedule.map((i) => i.note.t)).toEqual([0]); // 第 2 圈的 t=0 音符
    expect(out.schedule[0].delayMs).toBeCloseTo((0 + 1 * LAP_MS - 3900) / 1);
    expect(out.state).toMatchObject({ index: 1, lap: 1 });

    const wrapping: AccompanimentFollowerState = { posMs: 5900, index: 1, lap: 1, leadMs: 0 };
    const wrapped = advanceAccompanimentFollower(wrapping, notes, frame({ cameraMs: 5900 }));
    expect(wrapped.schedule.map((i) => i.note.t)).toEqual([2000]);
    expect(wrapped.state).toMatchObject({ index: 0, lap: 2 });
  });

  test('初始定位跳过更早的伴奏音符且不发声', () => {
    const state = createAccompanimentFollower(1000);
    const out = advanceAccompanimentFollower(state, makeNotes([0, 500, 1100]), frame({ cameraMs: 1000 }));
    expect(out.schedule.map((i) => i.note.t)).toEqual([1100]);
    expect(out.state).toMatchObject({ index: 0, lap: 1 });
  });

  test('单帧消费音符数受上限保护', () => {
    const notes = makeNotes(Array.from({ length: 100 }, (_, i) => i * 10));
    const out = advanceAccompanimentFollower(
      createAccompanimentFollower(0),
      notes,
      frame({ lookaheadMs: 100000 }),
    );
    expect(out.schedule.length).toBe(64);
    expect(out.state.index).toBe(64);
  });
});
