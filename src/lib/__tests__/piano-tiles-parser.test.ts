import { describe, expect, test } from 'vitest';
import { estimateStars, fnv1a, parseChart, pitchToSampleKey } from '../piano-tiles/chart-parser';
import type { RawSongChart } from '../piano-tiles/types';

describe('pitchToSampleKey', () => {
  test('converts sharp prefix to URL-safe key', () => {
    expect(pitchToSampleKey('#a2')).toBe('s-a2');
    expect(pitchToSampleKey('d1')).toBe('d1');
    expect(pitchToSampleKey('#A-1')).toBe('s-A-1');
  });
});

describe('parseChart', () => {
  const makeRaw = (scores: string[], bpm = 120): RawSongChart => ({
    baseBpm: bpm,
    musics: [{ bpm, baseBeats: 0.5, scores, instruments: scores.map(() => 'piano') }],
  });

  test('parses melody notes with duration letters (K=1 beat at 120bpm = 500ms)', () => {
    // K=1拍, L=1/2拍; T=1拍休止
    const { chart, badTokens } = parseChart(makeRaw(['c1[K],d1[K],T,e1[L]']), {
      id: '1',
      title: 't',
      artist: 'a',
    });
    expect(badTokens).toBe(0);
    expect(chart.notes).toHaveLength(3);
    expect(chart.notes.map((n) => n.t)).toEqual([0, 500, 1500]);
    expect(chart.notes[0].pitches).toEqual(['c1']);
  });

  test('bracketless note inherits previous duration', () => {
    const { chart } = parseChart(makeRaw(['c1[K],d1,e1']), { id: '1', title: 't', artist: 'a' });
    expect(chart.notes.map((n) => n.t)).toEqual([0, 500, 1000]);
  });

  test('parses chords and arpeggio separators', () => {
    const { chart, badTokens } = parseChart(makeRaw(['(c1.e1)[K],(c2~e2)[K]']), {
      id: '1',
      title: 't',
      artist: 'a',
    });
    expect(badTokens).toBe(0);
    expect(chart.notes[0].pitches).toEqual(['c1', 'e1']);
    expect(chart.notes[1].pitches).toEqual(['c2', 'e2']);
  });

  test('handles tuplets: 3<...> scales durations then snaps to unit grid', () => {
    const { chart, badTokens } = parseChart(makeRaw(['3<c1[K],d1[K],e1[K]>,f1[K]']), {
      id: '1',
      title: 't',
      artist: 'a',
    });
    expect(badTokens).toBe(0);
    // 三连音每个 = 1拍 * 2/3 ≈ 333ms，网格化后吸附到 250ms 单位网格（f1 锚回原始 1000ms）
    expect(chart.notes.map((n) => n.t)).toEqual([0, 250, 750, 1000]);
  });

  test('mute and velocity markers are handled', () => {
    const { chart, badTokens } = parseChart(makeRaw(['c1[K]{2},mute[K],d1[K]']), {
      id: '1',
      title: 't',
      artist: 'a',
    });
    expect(badTokens).toBe(0);
    expect(chart.notes).toHaveLength(2);
    expect(chart.notes[1].t).toBe(1000);
  });

  test('every note carries its real duration (d = tile height) and chart has unitMs', () => {
    const { chart } = parseChart(makeRaw(['c1[J],d1[L]']), { id: '1', title: 't', artist: 'a' });
    expect(chart.notes[0].d).toBe(1000); // J=2拍 @120bpm
    expect(chart.notes[1].d).toBe(250); // L=1/2拍
    expect(chart.unitMs).toBe(250); // 音块过少回退首段基础拍
  });

  test('tiles are contiguous: rests are absorbed into the previous tile', () => {
    // c1[K] 之后隔 1 拍休止（T）再来 d1[K]：c1 的块高应延伸覆盖休止
    const { chart } = parseChart(makeRaw(['c1[K],T,d1[K]']), { id: '1', title: 't', artist: 'a' });
    expect(chart.notes[0].t).toBe(0);
    expect(chart.notes[1].t).toBe(1000);
    expect(chart.notes[0].d).toBe(1000); // 500ms 音符 + 500ms 休止
    expect(chart.notes[0].t + chart.notes[0].d).toBe(chart.notes[1].t); // 无缝衔接
  });

  test('grid layout: non-hold tiles share one unit height, holds are integer multiples, no overlap', () => {
    // L=1/2拍(250ms) 主导 → unit=250；K=1拍、J=2拍 的音符成为长按块
    const scores = ['c1[L],d1[L],e1[L],f1[L],g1[K],a1[L],b1[L],c2[J],d2[L],e2[L]'];
    const { chart } = parseChart(makeRaw(scores), { id: '1', title: 't', artist: 'a' });
    const unit = chart.unitMs;
    expect(unit).toBe(250);
    for (let i = 0; i < chart.notes.length; i += 1) {
      const n = chart.notes[i];
      expect(n.t % unit).toBe(0);
      expect(n.d % unit).toBe(0);
      if (n.d !== unit) expect(n.d).toBeGreaterThanOrEqual(2 * unit);
      if (i + 1 < chart.notes.length) {
        expect(n.t + n.d).toBeLessThanOrEqual(chart.notes[i + 1].t);
      }
    }
    expect(chart.notes.filter((n) => n.d === unit).length).toBeGreaterThan(0);
    expect(chart.notes.some((n) => n.d >= 2 * unit)).toBe(true);
  });

  test('unitMs is the mode of tile heights for songs with enough notes', () => {
    // 9 个 1 拍音符 → 众数块高 500ms
    const { chart } = parseChart(
      makeRaw(['c1[K],d1[K],e1[K],f1[K],g1[K],a1[K],b1[K],c2[K],d2[K]']),
      { id: '1', title: 't', artist: 'a' },
    );
    expect(chart.unitMs).toBe(500);
  });

  test('uppercase pitches (low octaves) are notes, not rests', () => {
    const { chart, badTokens } = parseChart(makeRaw(['B-1[K],#A-2[K]']), {
      id: '1',
      title: 't',
      artist: 'a',
    });
    expect(badTokens).toBe(0);
    expect(chart.notes).toHaveLength(2);
    expect(chart.notes[1].pitches).toEqual(['s-A-2']);
  });

  test('voice 1+ goes to accompaniment; melody falls back when voice 0 is silent', () => {
    const { chart } = parseChart(makeRaw(['c1[K],d1[K]', 'e2[K],f2[K]']), {
      id: '1',
      title: 't',
      artist: 'a',
    });
    expect(chart.notes).toHaveLength(2);
    expect(chart.accompaniment).toHaveLength(2);

    const fallback = parseChart(makeRaw(['T,T,T', 'e2[K],f2[K]']), {
      id: '2',
      title: 't',
      artist: 'a',
    });
    expect(fallback.chart.notes).toHaveLength(2);
    expect(fallback.chart.notes[0].pitches).toEqual(['e2']);
  });

  test('lane assignment is deterministic and never repeats adjacent lanes', () => {
    const scores = ['c1[L],d1[L],e1[L],f1[L],g1[L],a1[L],b1[L],c2[L]'];
    const a = parseChart(makeRaw(scores), { id: '9', title: 't', artist: 'a' });
    const b = parseChart(makeRaw(scores), { id: '9', title: 't', artist: 'a' });
    expect(a.chart.notes.map((n) => n.lane)).toEqual(b.chart.notes.map((n) => n.lane));
    for (let i = 1; i < a.chart.notes.length; i += 1) {
      expect(a.chart.notes[i].lane).not.toBe(a.chart.notes[i - 1].lane);
    }
  });

  test('checksum is stable', () => {
    const raw = makeRaw(['c1[K],d1[K]']);
    const a = parseChart(raw, { id: '1', title: 't', artist: 'a' });
    const b = parseChart(raw, { id: '1', title: 't', artist: 'a' });
    expect(a.chart.checksum).toBe(b.chart.checksum);
    expect(a.chart.checksum).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('estimateStars', () => {
  test('returns 1-5 by density', () => {
    const mk = (count: number, durationMs: number) =>
      ({
        durationMs,
        notes: Array.from({ length: count }, (_, i) => ({ t: i, lane: 0, d: 0, pitches: ['c1'] })),
      }) as never;
    expect(estimateStars(mk(10, 10000))).toBe(1);
    expect(estimateStars(mk(60, 10000))).toBe(5);
  });
});

describe('fnv1a', () => {
  test('produces stable 8-char hex', () => {
    expect(fnv1a('hello')).toBe(fnv1a('hello'));
    expect(fnv1a('hello')).not.toBe(fnv1a('hellp'));
  });
});
