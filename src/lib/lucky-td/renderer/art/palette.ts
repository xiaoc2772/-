// 幸运塔防 程序化美术 · 调色板与确定性随机。
// 每张地图一套 ScenePalette（吉卜力式：柔和天空、远山、水彩地面、主题装饰）；
// 背景层所有随机装饰用 cellRand（mulberry32，种子=地图+格坐标），保证 resize 重绘像素级一致。

export interface ScenePalette {
  /** 天空渐变（上→下） */
  sky: [string, string, string];
  /** 远山剪影（远→近，画在 letterbox 上缘） */
  hills: [string, string];
  cloud: string;
  /** 地面水彩底色（主色） */
  groundBase: string;
  /** 逐格微差色斑（2~3 档） */
  groundWash: string[];
  /** 不可部署格装饰主题色（草丛/花/石/晶…按 decor painter 解释） */
  decor: { primary: string; secondary: string; accent: string };
  path: { fill: string; edge: string; wear: string };
  platform: { top: string; side: string; rim: string };
  /** 环境粒子：种类 + 颜色 */
  ambient: { kind: 'leaf' | 'firefly' | 'star' | 'snow' | 'mist' | 'spark'; color: string };
  /** 出怪门 / 基地门主题光色 */
  gate: { spawnGlow: string; spawnDark: string; exitGlow: string; exitDark: string };
  /** 场景装饰画家 id（scenes.ts 按此分发逐格装饰） */
  theme: 'meadow' | 'brook' | 'starlit' | 'frostfire' | 'ruins' | 'thunder';
}

export const SCENE_PALETTES: Record<string, ScenePalette> = {
  training_field: {
    sky: ['#aee3f5', '#cdeef7', '#f4f9e8'],
    hills: ['#9ecfb8', '#7fbf9d'],
    cloud: 'rgba(255, 255, 255, 0.85)',
    groundBase: '#a8d98a',
    groundWash: ['#b5e096', '#9ed07e', '#c2e6a4'],
    decor: { primary: '#7cb85c', secondary: '#f6e8b8', accent: '#f2a5b8' },
    path: { fill: '#e8d9b0', edge: '#b39b6e', wear: '#d4c193' },
    platform: { top: '#d9c9a3', side: '#a08a63', rim: '#f0e4c4' },
    ambient: { kind: 'leaf', color: '#d9edb0' },
    gate: { spawnGlow: '#f08c7a', spawnDark: '#8a3d33', exitGlow: '#7cc4f0', exitDark: '#2d5a8a' },
    theme: 'meadow',
  },
  brook_ford: {
    sky: ['#9fd4e8', '#c3e8ec', '#eaf6e4'],
    hills: ['#8cc4b4', '#6cb098'],
    cloud: 'rgba(255, 255, 255, 0.82)',
    groundBase: '#95cf9a',
    groundWash: ['#a3d8a6', '#88c48d', '#b0dfb2'],
    decor: { primary: '#68b088', secondary: '#8fd4d8', accent: '#f4f0c8' },
    path: { fill: '#ded3ae', edge: '#a3987a', wear: '#c9bc95' },
    platform: { top: '#c9bd97', side: '#8f8261', rim: '#e6dbba' },
    ambient: { kind: 'firefly', color: '#c8f0e0' },
    gate: { spawnGlow: '#ef8f76', spawnDark: '#84413a', exitGlow: '#6fc8dd', exitDark: '#28617a' },
    theme: 'brook',
  },
  starlamp_outpost: {
    sky: ['#3a4a7a', '#5a6a9e', '#8d92c0'],
    hills: ['#4a5588', '#3d4670'],
    cloud: 'rgba(200, 210, 245, 0.35)',
    groundBase: '#7d86ad',
    groundWash: ['#878fb5', '#727ba3', '#939bbf'],
    decor: { primary: '#5d6690', secondary: '#f5d98a', accent: '#b8c4f0' },
    path: { fill: '#c3bba0', edge: '#847c66', wear: '#aaa287' },
    platform: { top: '#a9a998', side: '#6f6f60', rim: '#cacab6' },
    ambient: { kind: 'star', color: '#ffe9a8' },
    gate: { spawnGlow: '#f2836e', spawnDark: '#77352e', exitGlow: '#8fc7ff', exitDark: '#2c4a78' },
    theme: 'starlit',
  },
  frostfire_fault: {
    sky: ['#9db4cc', '#c2d2e2', '#ecf0f2'],
    hills: ['#8ba4bf', '#7591ad'],
    cloud: 'rgba(255, 255, 255, 0.75)',
    groundBase: '#c3ccd8',
    groundWash: ['#ccd5e0', '#b8c2d0', '#d6dee8'],
    decor: { primary: '#9db3c8', secondary: '#eef4f8', accent: '#f0866a' },
    path: { fill: '#ddd2c0', edge: '#9c8d79', wear: '#c5b8a4' },
    platform: { top: '#c2c8d2', side: '#828c9c', rim: '#e0e5ec' },
    ambient: { kind: 'snow', color: '#f2f7fc' },
    gate: { spawnGlow: '#f07a5e', spawnDark: '#7d322a', exitGlow: '#84c8ea', exitDark: '#2a5578' },
    theme: 'frostfire',
  },
  rubblemist_plateau: {
    sky: ['#b3b8a8', '#ccd0be', '#e8e9da'],
    hills: ['#9aa088', '#848c72'],
    cloud: 'rgba(240, 240, 230, 0.6)',
    groundBase: '#adb392',
    groundWash: ['#b8bd9d', '#a0a686', '#c2c7a8'],
    decor: { primary: '#8b9070', secondary: '#d8d3bc', accent: '#8fd0a8' },
    path: { fill: '#d3c8ac', edge: '#948a70', wear: '#bcb092' },
    platform: { top: '#bcb59a', side: '#7d7660', rim: '#d8d2b8' },
    ambient: { kind: 'mist', color: '#e4e6d8' },
    gate: { spawnGlow: '#e8876d', spawnDark: '#79392f', exitGlow: '#7ec0c8', exitDark: '#2c5c62' },
    theme: 'ruins',
  },
  thundervoid_gate: {
    sky: ['#2e3252', '#454a74', '#6a6e9a'],
    hills: ['#3a3e63', '#2f3352'],
    cloud: 'rgba(160, 170, 220, 0.3)',
    groundBase: '#6f7396',
    groundWash: ['#797da0', '#65698c', '#8488ab'],
    decor: { primary: '#565a80', secondary: '#a8b4e8', accent: '#f5e26a' },
    path: { fill: '#b6ad96', edge: '#7a7260', wear: '#9d9480' },
    platform: { top: '#9a9cae', side: '#5f6172', rim: '#bcbecd' },
    ambient: { kind: 'spark', color: '#ffe86e' },
    gate: { spawnGlow: '#f2705e', spawnDark: '#6e2a24', exitGlow: '#9ab8ff', exitDark: '#2a3d78' },
    theme: 'thunder',
  },
};

export function scenePalette(mapId: string): ScenePalette {
  return SCENE_PALETTES[mapId] ?? SCENE_PALETTES.training_field;
}

// ── 确定性随机（背景层专用） ────────────────────────

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32：同种子序列恒定，供背景装饰摆放使用（禁止用 Math.random / 引擎 RNG）。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 单格种子随机：resize 重绘时逐格结果不变。 */
export function cellRand(mapId: string, row: number, col: number): () => number {
  return mulberry32(hashString(mapId) ^ (row * 73856093) ^ (col * 19349663));
}

// ── 颜色与路径小工具 ────────────────────────────

/** 十六进制颜色按比例混合（t∈[0,1]，t=1 全取 b）。 */
export function mixColor(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const mix = (sa: number, sb: number) => Math.round(sa + (sb - sa) * t);
  const r = mix((pa >> 16) & 255, (pb >> 16) & 255);
  const g = mix((pa >> 8) & 255, (pb >> 8) & 255);
  const bl = mix(pa & 255, pb & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

export function withAlpha(hex: string, alpha: number): string {
  const p = parseInt(hex.slice(1), 16);
  return `rgba(${(p >> 16) & 255}, ${(p >> 8) & 255}, ${p & 255}, ${alpha})`;
}

/** 有机团块（云/树冠/雾）：围绕 (x,y) 半径 r 的圆滑随机 blob 路径。 */
export function blobPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rand: () => number, lobes = 7): void {
  ctx.beginPath();
  const radii: number[] = [];
  for (let i = 0; i < lobes; i += 1) {
    radii.push(r * (0.78 + rand() * 0.42));
  }
  for (let i = 0; i <= lobes; i += 1) {
    const a0 = (Math.PI * 2 * i) / lobes;
    const rr = radii[i % lobes];
    const px = x + Math.cos(a0) * rr;
    const py = y + Math.sin(a0) * rr;
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      const aPrev = (Math.PI * 2 * (i - 0.5)) / lobes;
      const rc = (radii[(i - 1) % lobes] + rr) * 0.62;
      ctx.quadraticCurveTo(x + Math.cos(aPrev) * rc, y + Math.sin(aPrev) * rc, px, py);
    }
  }
  ctx.closePath();
}

/** 叶片/花瓣：以 (x,y) 为基点、朝 angle、长 len 的双弧叶形路径。 */
export function leafPath(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, len: number, width: number): void {
  const tx = x + Math.cos(angle) * len;
  const ty = y + Math.sin(angle) * len;
  const px = Math.cos(angle + Math.PI / 2) * width;
  const py = Math.sin(angle + Math.PI / 2) * width;
  const mx = (x + tx) / 2;
  const my = (y + ty) / 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(mx + px, my + py, tx, ty);
  ctx.quadraticCurveTo(mx - px, my - py, x, y);
  ctx.closePath();
}

export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
