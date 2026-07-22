export type PianoTilesMode = 'classic' | 'rush';

export type TileJudgement = 'perfect' | 'good' | 'miss' | 'wrong';

/** 编译后谱面中的一个音块（来自主旋律声部的一个音符/和弦）。 */
export interface ChartNote {
  /** 音块底边到达判定位置的时间，毫秒，相对曲目开始（= 音符起始时刻）。 */
  t: number;
  /** 轨道 0-3，编译期固化（种子随机 + 相邻不重轨）。 */
  lane: 0 | 1 | 2 | 3;
  /** 音符时值毫秒——决定块的高度；相邻音符无休止时块与块首尾相接。 */
  d: number;
  /** 击中时播放的采样 key（和弦为多个），如 "s-a2"、"d1"。 */
  pitches: string[];
}

/** 自动播放的伴奏音符（非交互）。 */
export interface AccompanimentNote {
  t: number;
  pitches: string[];
  /** 采样组：piano / bass / bass2 / drum。 */
  instrument: string;
}

export interface CompiledChartSegment {
  bpm: number;
  baseBeats: number;
  /** 段落起始时间，毫秒。 */
  startMs: number;
}

export interface CompiledChart {
  id: string;
  title: string;
  artist: string;
  baseBpm: number;
  durationMs: number;
  /** 单位块时长（首段 baseBeats × 每拍毫秒）——原作一屏纵向约 4 个单位块。 */
  unitMs: number;
  segments: CompiledChartSegment[];
  notes: ChartNote[];
  accompaniment: AccompanimentNote[];
  /** 谱面内容 FNV-1a hash，服务端防篡改校验用。 */
  checksum: string;
}

export interface ChartManifestEntry {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  durationMs: number;
  noteCount: number;
  /** 难度星级 1-5（按音块密度估算）。 */
  stars: number;
  checksum: string;
}

export interface ChartManifest {
  version: number;
  /** 采样文件名映射：pitch key -> 相对 samples/ 的路径。 */
  samples: Record<string, string>;
  sfx: Record<string, string>;
  charts: ChartManifestEntry[];
}

/** 原始谱面 JSON（参考项目 assets/res/song/*.json）。 */
export interface RawSongSegment {
  bpm: number;
  baseBeats: number;
  id?: number;
  scores: string[];
  instruments?: string[];
  alternatives?: string[];
}

export interface RawSongChart {
  baseBpm: number;
  musics: RawSongSegment[];
  audition?: unknown;
}
