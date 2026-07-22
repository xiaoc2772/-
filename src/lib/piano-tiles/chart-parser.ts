import type {
  AccompanimentNote,
  ChartNote,
  CompiledChart,
  CompiledChartSegment,
  RawSongChart,
} from './types';

/**
 * 钢琴块谱面解析器。
 *
 * 原始记谱格式（逆向自参考项目 assets/res/song/*.json，经 848 首语料统计验证）：
 * - musics[] 为顺序播放的段落，各自带 bpm 与 baseBeats（基础音符拍值）
 * - 每段 scores[] 为多声部字符串：声部 0 = 主旋律（生成音块），其余 = 自动伴奏
 * - `;` 分小节/拍组，`,` 分音符事件
 * - 音符：`d2[LM]`（音名+八度+时值标记）；时值字母 H..O 为 8 拍到 1/16 拍的等比序列，
 *   括号内多字母为时值相加（附点）；无括号音符继承前一音符时值（首个默认 baseBeats）
 * - 休止：裸大写字母 Q..W 为 8 拍到 1/8 拍等比序列，可组合（如 ST = 2+1 拍）
 * - 和弦：`(d.c1)[L]` 圆点分隔多音名
 * - 音名直接对应采样文件名（`#a2` -> `#a2.mp3`，导入时重命名为 URL 安全的 `s-a2`）
 */

const NOTE_DURATION_LETTERS = 'HIJKLMNO'; // H=8拍 ... O=1/16拍
const REST_DURATION_LETTERS = 'QRSTUVW'; // Q=8拍 ... W=1/8拍

const LANE_COUNT = 4;

/** 支持的伴奏采样组；谱面引用其他乐器时回退为 piano。 */
const KNOWN_INSTRUMENTS = new Set(['piano', 'bass', 'bass2', 'drum']);

function letterBeats(letter: string, alphabet: string): number | null {
  const idx = alphabet.indexOf(letter);
  if (idx < 0) return null;
  // 序列首字母 = 8 拍，每后退一位减半
  return 8 / 2 ** idx;
}

interface ParsedToken {
  /** 音名列表；空数组表示休止。 */
  pitches: string[];
  /** 时值（拍）。 */
  beats: number;
}

/** 将 `#` 前缀音名转为 URL 安全的采样 key：`#a2` -> `s-a2`。 */
export function pitchToSampleKey(pitch: string): string {
  return pitch.startsWith('#') ? `s-${pitch.slice(1)}` : pitch;
}

function inner_isMute(body: string): boolean {
  return body === 'mute';
}

function splitTokens(group: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of group) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      if (current.trim()) tokens.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

function parseToken(raw: string, lastBeats: number): ParsedToken | null {
  // 去掉力度/指法注记后缀 {n}
  raw = raw.replace(/\{\d+\}$/, '');

  // 纯休止字母（Q..W；大写 A-G 是低八度音名，不在此列）
  if (/^[Q-W]+$/.test(raw)) {
    let beats = 0;
    for (const ch of raw) {
      const b = letterBeats(ch, REST_DURATION_LETTERS);
      if (b === null) return null;
      beats += b;
    }
    return { pitches: [], beats };
  }

  // 音符（可带 [时值]）
  const match = raw.match(/^(.+?)(?:\[([A-Z]+)\])?$/);
  if (!match) return null;
  const [, body, durationLetters] = match;

  let beats = lastBeats;
  if (durationLetters) {
    beats = 0;
    for (const ch of durationLetters) {
      const b = letterBeats(ch, NOTE_DURATION_LETTERS);
      if (b === null) return null;
      beats += b;
    }
  }

  // 哑音：占时值但不发声
  if (inner_isMute(body)) return { pitches: [], beats };

  // 和弦 (d.c1) 或 (c4~#a3~#g3)（~ 为琶音记法，按和弦处理）
  const inner = body.startsWith('(') && body.endsWith(')') ? body.slice(1, -1) : body;
  const pitches = inner
    .split(/[.~]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (pitches.length === 0) return null;
  for (const p of pitches) {
    if (!/^#?[a-gA-G][-\d]*$/.test(p)) return null;
  }
  return { pitches, beats };
}

interface VoiceEvent {
  /** 事件起始（拍，相对段落开始）。 */
  beat: number;
  beats: number;
  pitches: string[];
}

/** 解析单个声部字符串为时间轴事件；解析失败的记号会被跳过并计数。 */
function parseVoice(
  score: string,
  baseBeats: number,
): { events: VoiceEvent[]; totalBeats: number; badTokens: number } {
  const events: VoiceEvent[] = [];
  let cursor = 0;
  let lastBeats = baseBeats;
  let badTokens = 0;
  // 连音组：`5<tok,...,tok>` 表示 n 连音，组内时值缩放为 2^floor(log2(n))/n
  let tupletFactor = 1;

  for (const group of score.split(';')) {
    if (!group.trim()) continue;
    for (let raw of splitTokens(group)) {
      const tupletOpen = raw.match(/^(\d+)<(.*)$/);
      if (tupletOpen) {
        const n = parseInt(tupletOpen[1], 10);
        tupletFactor = n > 0 ? 2 ** Math.floor(Math.log2(n)) / n : 1;
        raw = tupletOpen[2];
      }
      let tupletClose = false;
      if (raw.endsWith('>')) {
        tupletClose = true;
        raw = raw.slice(0, -1);
      }
      const token = parseToken(raw, lastBeats);
      if (!token) {
        badTokens += 1;
      } else {
        const beats = token.beats * tupletFactor;
        if (token.pitches.length > 0) {
          events.push({ beat: cursor, beats, pitches: token.pitches });
          lastBeats = token.beats;
        }
        cursor += beats;
      }
      if (tupletClose) tupletFactor = 1;
    }
  }
  return { events, totalBeats: cursor, badTokens };
}

/** mulberry32 种子随机，与后端可复现约定一致（种子 = checksum 前 8 位十六进制）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export interface ParseChartResult {
  chart: CompiledChart;
  /** 解析失败被跳过的记号数（质量指标，导入脚本用于过滤劣质谱面）。 */
  badTokens: number;
}

export function parseChart(
  raw: RawSongChart,
  meta: { id: string; title: string; artist: string },
): ParseChartResult {
  const segments: CompiledChartSegment[] = [];
  const notes: ChartNote[] = [];
  const accompaniment: AccompanimentNote[] = [];
  let clockMs = 0;
  let badTokens = 0;

  for (const segment of raw.musics ?? []) {
    const bpm = segment.bpm > 0 ? segment.bpm : raw.baseBpm > 0 ? raw.baseBpm : 120;
    const msPerBeat = 60000 / bpm;
    const baseBeats = segment.baseBeats > 0 ? segment.baseBeats : 0.5;
    segments.push({ bpm, baseBeats, startMs: clockMs });

    let segmentBeats = 0;
    const parsedVoices = (segment.scores ?? []).map((score) => {
      const parsed = parseVoice(score, baseBeats);
      badTokens += parsed.badTokens;
      segmentBeats = Math.max(segmentBeats, parsed.totalBeats);
      return parsed;
    });

    // 主旋律默认声部 0；个别谱面声部 0 为纯节奏/休止，回退到事件最多的声部
    let melodyIndex = 0;
    if (parsedVoices.length > 0 && parsedVoices[0].events.length === 0) {
      melodyIndex = parsedVoices.reduce(
        (best, v, i) => (v.events.length > parsedVoices[best].events.length ? i : best),
        0,
      );
    }

    parsedVoices.forEach((parsed, voiceIndex) => {
      if (voiceIndex === melodyIndex) {
        for (const event of parsed.events) {
          notes.push({
            t: Math.round(clockMs + event.beat * msPerBeat),
            lane: 0, // 稍后统一分配
            d: Math.max(1, Math.round(event.beats * msPerBeat)),
            pitches: event.pitches.map(pitchToSampleKey),
          });
        }
      } else {
        const instrumentRaw = segment.instruments?.[voiceIndex] ?? 'piano';
        const instrument = KNOWN_INSTRUMENTS.has(instrumentRaw) ? instrumentRaw : 'piano';
        for (const event of parsed.events) {
          accompaniment.push({
            t: Math.round(clockMs + event.beat * msPerBeat),
            pitches: event.pitches.map(pitchToSampleKey),
            instrument,
          });
        }
      }
    });

    clockMs += segmentBeats * msPerBeat;
  }

  notes.sort((a, b) => a.t - b.t);
  accompaniment.sort((a, b) => a.t - b.t);

  // 音块间隔（到下一块起点的时间，末块用自身时值）
  const gaps = notes.map((n, i) =>
    i + 1 < notes.length ? Math.max(1, notes[i + 1].t - n.t) : Math.max(1, n.d),
  );

  // 单位块 = 间隔众数（音块过少时回退首段基础拍），一屏纵向恰好 4 个单位块
  const firstSegment = segments[0];
  let unitMs = firstSegment
    ? Math.max(1, Math.round(firstSegment.baseBeats * (60000 / firstSegment.bpm)))
    : 250;
  if (notes.length >= 8) {
    const counts = new Map<number, number>();
    for (let i = 0; i + 1 < notes.length; i += 1) {
      counts.set(gaps[i], (counts.get(gaps[i]) ?? 0) + 1);
    }
    let bestCount = 0;
    for (const [gap, count] of counts) {
      if (count > bestCount || (count === bestCount && gap < unitMs)) {
        bestCount = count;
        unitMs = gap;
      }
    }
  }
  unitMs = Math.min(1000, Math.max(120, unitMs));

  // 网格化布局（原作模型）：音块吸附到单位块网格，任意两块不重叠。
  // - 普通点击块恒为 1 个单位高（所有普通黑块大小完全一致）
  // - 间隔 >= 1.75 单位的音符为长按块：块体为整数个单位块拼接，恰好铺满至下一块起点（吸收休止）
  // - 行距对原始时间就近取整；参照点取原始绝对时间而非上一间隔，避免长曲累计漂移
  let gridT = notes.length > 0 ? Math.round(notes[0].t / unitMs) * unitMs : 0;
  for (let i = 0; i < notes.length; i += 1) {
    const isHoldNote = gaps[i] >= 1.75 * unitMs;
    const nextStart = i + 1 < notes.length ? notes[i + 1].t : notes[i].t + gaps[i];
    const rowSpan = Math.max(1, Math.round((nextStart - gridT) / unitMs));
    notes[i].t = gridT;
    notes[i].d = isHoldNote ? rowSpan * unitMs : unitMs;
    gridT += rowSpan * unitMs;
  }

  // 轨道分配：内容 hash 作种子，保证同一谱面前后端可复现；相邻音块不重轨
  const contentHash = fnv1a(
    JSON.stringify(notes.map((n) => [n.t, n.d, n.pitches])) + meta.id,
  );
  const rand = mulberry32(parseInt(contentHash, 16));
  let prevLane = -1;
  for (const note of notes) {
    let lane = Math.floor(rand() * LANE_COUNT);
    if (lane === prevLane) lane = (lane + 1 + Math.floor(rand() * (LANE_COUNT - 1))) % LANE_COUNT;
    note.lane = lane as ChartNote['lane'];
    prevLane = lane;
  }

  const durationMs = Math.round(clockMs);
  const chart: CompiledChart = {
    id: meta.id,
    title: meta.title,
    artist: meta.artist,
    baseBpm: raw.baseBpm > 0 ? raw.baseBpm : segments[0]?.bpm ?? 120,
    durationMs,
    unitMs,
    segments,
    notes,
    accompaniment,
    checksum: fnv1a(JSON.stringify({ notes, durationMs })),
  };
  return { chart, badTokens };
}

/** 难度星级：按每秒音块密度估算（1-5 星）。 */
export function estimateStars(chart: CompiledChart): number {
  if (chart.durationMs <= 0 || chart.notes.length === 0) return 1;
  const density = chart.notes.length / (chart.durationMs / 1000);
  if (density < 1.5) return 1;
  if (density < 2.5) return 2;
  if (density < 3.5) return 3;
  if (density < 5) return 4;
  return 5;
}
