import { describe, expect, test } from 'vitest';
import {
  createEngine,
  HOLD_UNITS_THRESHOLD,
  LAP_SPEED_STEP,
  MAX_CROWNS,
  MAX_SPEED_MULTIPLIER,
  MISS_GRACE_MS,
  VIEW_UNITS,
} from '../piano-tiles/engine';
import type { ChartNote, CompiledChart } from '../piano-tiles/types';

const UNIT = 250;

function makeChart(notes: Array<Partial<ChartNote> & { t: number }>): CompiledChart {
  return {
    id: '1',
    title: 't',
    artist: 'a',
    baseBpm: 120,
    durationMs: Math.max(...notes.map((n) => n.t)) + 1000,
    unitMs: UNIT,
    segments: [{ bpm: 120, baseBeats: 0.5, startMs: 0 }],
    notes: notes.map((n, i) => ({
      t: n.t,
      lane: (n.lane ?? (i % 4)) as ChartNote['lane'],
      d: n.d ?? UNIT,
      pitches: n.pitches ?? ['c1'],
    })),
    accompaniment: [],
    checksum: 'deadbeef',
  };
}

/** 点掉「开始」块，让引擎进入 running。 */
function begin(engine: ReturnType<typeof createEngine>) {
  const start = engine.nextTile()!;
  expect(start.index).toBe(-1);
  const outcome = engine.tap(start.lane, 0);
  expect(outcome.kind).toBe('start');
  return engine;
}

describe('「开始」块', () => {
  test('位于第一块下方一个单位、错开轨道，点中才启动且不计分', () => {
    const engine = createEngine(makeChart([{ t: 500, lane: 0 }]), 'classic');
    const start = engine.nextTile()!;
    expect(start.index).toBe(-1);
    expect(start.t).toBe(500 - UNIT);
    expect(start.d).toBe(UNIT);
    expect(start.lane).toBe(2);

    // 点空白轨道被忽略，不判负（原作开局行为）
    expect(engine.tap(0, 0).kind).toBe('ignored');
    expect(engine.status).toBe('ready');

    expect(engine.tap(start.lane, 0).kind).toBe('start');
    expect(engine.status).toBe('running');
    expect(engine.score).toBe(0);
  });

  test('upcomingTiles 首位为「开始」块，消费后为第一音块', () => {
    const engine = createEngine(makeChart([{ t: 500, lane: 0 }]), 'classic');
    expect(engine.upcomingTiles(3)[0].index).toBe(-1);
    begin(engine);
    expect(engine.upcomingTiles(3)[0].index).toBe(0);
  });
});

describe('钢琴块2 原版机制（无缝衔接模型）', () => {
  test('块高 = 时值：相邻音块首尾相接', () => {
    const engine = createEngine(
      makeChart([
        { t: 500, lane: 0, d: UNIT },
        { t: 750, lane: 1, d: UNIT * 2 },
        { t: 1250, lane: 2, d: UNIT },
      ]),
      'classic',
    );
    begin(engine);
    const [a, b, c] = engine.upcomingTiles(3);
    expect(a.t + a.d).toBe(b.t); // 无缝衔接
    expect(b.t + b.d).toBe(c.t);
  });

  test('按序命中可见块得分 +1；打完一圈不结束', () => {
    const engine = begin(
      createEngine(
        makeChart([
          { t: 500, lane: 0 },
          { t: 750, lane: 1 },
        ]),
        'classic',
      ),
    );
    expect(engine.tap(0, 0).kind).toBe('hit');
    expect(engine.tap(1, 0).kind).toBe('hit');
    expect(engine.score).toBe(2);
    expect(engine.status).toBe('running');
  });

  test('点错列（白块）立即失败', () => {
    const engine = begin(createEngine(makeChart([{ t: 500, lane: 0 }]), 'classic'));
    expect(engine.tap(2, 0).kind).toBe('wrong');
    expect(engine.status).toBe('failed');
  });

  test('点击尚未进屏的块视为点白块', () => {
    const engine = begin(
      createEngine(makeChart([{ t: VIEW_UNITS * UNIT + 5000, lane: 0 }]), 'classic'),
    );
    expect(engine.tap(0, 0).kind).toBe('wrong');
    expect(engine.status).toBe('failed');
  });

  test('黑块底边越过屏幕底部（含容差）未点击失败', () => {
    const engine = begin(createEngine(makeChart([{ t: 500, lane: 0 }]), 'classic'));
    expect(engine.tick(500 + MISS_GRACE_MS - 1)).toBe(false);
    expect(engine.tick(500 + MISS_GRACE_MS + 1)).toBe(true);
    expect(engine.status).toBe('failed');
  });

  test('曲目循环：跨圈提速并累计皇冠（上限 3）', () => {
    const notes = [
      { t: 500, lane: 0 as const },
      { t: 750, lane: 1 as const },
    ];
    const engine = begin(createEngine(makeChart(notes), 'classic'));
    expect(engine.speedMultiplier()).toBe(1);
    for (let lapIndex = 0; lapIndex < 5; lapIndex += 1) {
      for (const n of notes) {
        const tile = engine.nextTile()!;
        expect(engine.tap(n.lane, tile.t - 100).kind).toBe('hit');
      }
    }
    expect(engine.lap).toBe(5);
    expect(engine.speedMultiplier()).toBeCloseTo(1 + 5 * LAP_SPEED_STEP);
    const res = engine.result();
    expect(res.crowns).toBe(MAX_CROWNS);
    expect(res.score).toBe(10);
  });

  test('跨圈后的块时间按圈长平移', () => {
    const engine = begin(createEngine(makeChart([{ t: 500, lane: 0 }]), 'classic'));
    const lapMs = engine.lapDurationMs();
    engine.tap(0, 400);
    const second = engine.nextTile()!;
    expect(second.t).toBe(500 + lapMs);
    expect(second.lap).toBe(1);
  });

  test('圈长与服务端算法一致，尾部至少保留 400ms', () => {
    const chart = makeChart([{ t: 500, lane: 0, d: 250 }]);
    chart.durationMs = 600;
    const engine = createEngine(chart, 'classic');
    expect(engine.lapDurationMs()).toBe(900);
  });

  test('经典模式速度封顶，避免超过服务端每秒事件密度限制', () => {
    const engine = begin(createEngine(makeChart([{ t: 500, lane: 0 }]), 'classic'));
    for (let index = 0; index < 100; index += 1) {
      const tile = engine.nextTile()!;
      expect(engine.tap(tile.lane, tile.t - 100).kind).toBe('hit');
    }
    expect(engine.speedMultiplier()).toBe(MAX_SPEED_MULTIPLIER);
  });

  test.each([10, 50, 100, 500, 1000])('达到 %i 分仍可移动并生成可结算结果', (targetScore) => {
    const engine = begin(createEngine(makeChart([{ t: 500, lane: 0 }]), 'classic'));
    for (let index = 0; index < targetScore; index += 1) {
      const tile = engine.nextTile()!;
      expect(engine.tap(tile.lane, tile.t - 100).kind).toBe('hit');
    }
    const result = engine.result();
    expect(result.score).toBe(targetScore);
    expect(result.tilesHit).toBe(targetScore);
    expect(engine.status).toBe('running');
    expect(engine.nextTile()).not.toBeNull();
  });

  test.each([1, 2, 10, 24])('连续推进 %i 小时后数值仍稳定且可继续移动', (hours) => {
    const engine = begin(createEngine(makeChart([{ t: 500, lane: 0 }]), 'classic'));
    const targetMs = hours * 60 * 60 * 1000;
    while (engine.nextTile()!.t <= targetMs) {
      const tile = engine.nextTile()!;
      expect(engine.tap(tile.lane, tile.t - 100).kind).toBe('hit');
    }
    const result = engine.result();
    expect(Number.isSafeInteger(result.score)).toBe(true);
    expect(Number.isSafeInteger(result.laps)).toBe(true);
    expect(engine.speedMultiplier()).toBeLessThanOrEqual(MAX_SPEED_MULTIPLIER);
    expect(engine.status).toBe('running');
    expect(engine.nextTile()!.t).toBeGreaterThan(targetMs);
  });
});

describe('长按块', () => {
  test('时值 >= 1.75 单位为长按块', () => {
    const engine = createEngine(
      makeChart([
        { t: 500, lane: 0, d: UNIT },
        { t: 750, lane: 1, d: Math.ceil(UNIT * HOLD_UNITS_THRESHOLD) },
      ]),
      'classic',
    );
    const [, short, hold] = engine.upcomingTiles(3); // [0]=开始块
    expect(engine.isHold(short)).toBe(false);
    expect(engine.isHold(hold)).toBe(true);
  });

  test('长按从按下瞬间起算进度，划到块尾自动结束且不增加竞争分', () => {
    const chart = makeChart([{ t: 500, lane: 0, d: UNIT * 4 }]);
    const engine = begin(createEngine(chart, 'classic'));
    engine.tap(0, 300); // 按下时刻 camera=300，块尾在 1500
    expect(engine.holdState(300)!.progress).toBe(0);
    expect(engine.score).toBe(1);

    // total = 1500-300 = 1200；camera=900 → progress = 600/1200 = 0.5
    engine.tick(900);
    const mid = engine.holdState(900)!;
    expect(mid.progress).toBeCloseTo(0.5);
    expect(engine.score).toBe(1);

    engine.tick(1500); // 到块尾：自动结束
    expect(engine.holdState(1500)).toBeNull();
    expect(engine.score).toBe(1);
  });

  test('提前松手结束长按且不额外计分', () => {
    const chart = makeChart([{ t: 500, lane: 0, d: UNIT * 4 }]);
    const engine = begin(createEngine(chart, 'classic'));
    engine.tap(0, 300);
    const granted = engine.release(600); // progress = 300/1200 = 0.25
    expect(granted).toBe(0);
    expect(engine.holdState(600)).toBeNull();
    expect(engine.status).toBe('running');
    expect(engine.score).toBe(1 + granted);
  });
});

describe('rush 模式', () => {
  test('timeUp 结束并保留得分', () => {
    const engine = begin(createEngine(makeChart([{ t: 500, lane: 0 }]), 'rush'));
    engine.tap(0, 0);
    engine.timeUp();
    expect(engine.status).toBe('timeup');
    expect(engine.result().score).toBe(1);
  });
});
