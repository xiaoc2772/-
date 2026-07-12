// 幸运塔防 Canvas 绘制模块：纯函数画家 + 舞台几何换算。
// 棋盘/弹道/特效全程序化绘制（docs/lucky-td-art-guide.md §2.4~§2.6）；
// 实体当前使用「几何占位皮肤」，美术 webp 到位后在此替换为 drawImage。

import type { PrecomputedMap } from '../engine/data';
import { positionOnPath } from '../engine/data';
import { drawScene } from './art/scenes';
import { drawUnitCharacter, drawEnemyCharacter } from './art/characters';
import { scenePalette, withAlpha } from './art/palette';

export const STAGE_W = 1440;
export const STAGE_H = 660;
export const TILE = 60;
const MILLI_TO_PX = TILE / 1000;

export interface StageGeom {
  ox: number;
  oy: number;
  cols: number;
  rows: number;
}

export function makeGeom(cols: number, rows: number): StageGeom {
  return { ox: Math.floor((STAGE_W - cols * TILE) / 2), oy: Math.floor((STAGE_H - rows * TILE) / 2), cols, rows };
}

function pathPointToStage(map: PrecomputedMap, geom: StageGeom, pathIdx: number, progress: number, flight = false): { x: number; y: number } {
  const paths = flight ? map.flightPaths : map.paths;
  const pos = positionOnPath(paths[Math.max(0, pathIdx % paths.length)], progress);
  return milliToStage(geom, pos.x, pos.y);
}

export function milliToStage(geom: StageGeom, x: number, y: number): { x: number; y: number } {
  return { x: geom.ox + x * MILLI_TO_PX, y: geom.oy + y * MILLI_TO_PX };
}

export function cellCenter(geom: StageGeom, row: number, col: number): { x: number; y: number } {
  return { x: geom.ox + col * TILE + TILE / 2, y: geom.oy + row * TILE + TILE / 2 };
}

export function pointerToCell(geom: StageGeom, x: number, y: number): { row: number; col: number } | null {
  const col = Math.floor((x - geom.ox) / TILE);
  const row = Math.floor((y - geom.oy) / TILE);
  if (row < 0 || row >= geom.rows || col < 0 || col >= geom.cols) {
    return null;
  }
  return { row, col };
}

// ── 主题与占位皮肤 ────────────────────────────────

export const UNIT_STYLE: { color: string; emoji: string }[] = [
  { color: '#0d9488', emoji: '⚡' },
  { color: '#64748b', emoji: '🛡️' },
  { color: '#dc2626', emoji: '⚔️' },
  { color: '#ea580c', emoji: '🔥' },
  { color: '#16a34a', emoji: '🏹' },
  { color: '#7c3aed', emoji: '✨' },
  { color: '#0891b2', emoji: '🌙' },
  { color: '#e11d48', emoji: '🐟' },
  { color: '#111827', emoji: '🗡️' },
  { color: '#b45309', emoji: '💥' },
  { color: '#0284c7', emoji: '❄️' },
  { color: '#ca8a04', emoji: '🎺' },
  { color: '#4b5563', emoji: '🧱' },
  { color: '#2563eb', emoji: '🪶' },
  { color: '#65a30d', emoji: '☠️' },
  { color: '#f97316', emoji: '☀️' },
  { color: '#a16207', emoji: '🛠️' },
  { color: '#9333ea', emoji: '🌀' },
];

// ── 棋盘（静态层，仅地图变更时重绘） ────────────────────

export function drawBoard(ctx: CanvasRenderingContext2D, map: PrecomputedMap, geom: StageGeom): void {
  drawScene(ctx, map, geom);
}

// ── 动态层元素 ────────────────────────────────

export interface PathPreviewVis {
  pathIdxs: number[];
  flightPathIdxs: number[];
  born: number;
  duration: number;
  waveIndex: number;
}

function easeOutCubic(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

function drawPathRange(
  ctx: CanvasRenderingContext2D,
  map: PrecomputedMap,
  geom: StageGeom,
  pathIdx: number,
  fromProgress: number,
  toProgress: number,
  flight = false,
): void {
  const paths = flight ? map.flightPaths : map.paths;
  const path = paths[Math.max(0, pathIdx % paths.length)];
  const from = Math.max(0, Math.min(path.lengthMilli, fromProgress));
  const to = Math.max(from, Math.min(path.lengthMilli, toProgress));
  const step = 450;
  const start = pathPointToStage(map, geom, pathIdx, from, flight);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  for (let p = from + step; p < to; p += step) {
    const at = pathPointToStage(map, geom, pathIdx, p, flight);
    ctx.lineTo(at.x, at.y);
  }
  const end = pathPointToStage(map, geom, pathIdx, to, flight);
  ctx.lineTo(end.x, end.y);
}

/**
 * 每波出怪前的路线预告（只在波次开始时播放一次，不常驻道路）。
 * 设计：整条路径的柔光呼吸底辉 + 2~3 颗沿路飞行的彗星头（渐细光尾）+ 出怪门警示脉冲环。
 * 地面路径取 gate.spawnGlow 暖色、飞行路径取 gate.exitGlow 冷色，随地图调色板变化；
 * 全程 'lighter' 叠加，无 filter / shadowBlur。
 */
export function drawPathPreview(ctx: CanvasRenderingContext2D, map: PrecomputedMap, geom: StageGeom, preview: PathPreviewVis, now: number): boolean {
  const t = (now - preview.born) / preview.duration;
  if (t >= 1) {
    return false;
  }
  const env = Math.min(1, t / 0.12) * (t > 0.72 ? Math.max(0, (1 - t) / 0.28) : 1);
  const breath = 0.72 + 0.28 * Math.sin(now / 170);
  const gate = scenePalette(map.cfg.id).gate;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const drawPreviewList = (pathIdxs: number[], flight: boolean) => {
    const paths = flight ? map.flightPaths : map.paths;
    const glowHex = flight ? gate.exitGlow : gate.spawnGlow;
    const cometCount = flight ? 2 : 3;
    for (const pathIdx of pathIdxs) {
      const path = paths[Math.max(0, pathIdx % paths.length)];
      // (a) 全路径柔光底辉：宽圆头描边双层，透明度随呼吸脉动
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      drawPathRange(ctx, map, geom, pathIdx, 0, path.lengthMilli, flight);
      ctx.strokeStyle = withAlpha(glowHex, 0.13 * env * breath);
      ctx.lineWidth = flight ? 18 : 30;
      ctx.stroke();
      ctx.strokeStyle = withAlpha(glowHex, 0.1 * env * breath);
      ctx.lineWidth = flight ? 8 : 12;
      ctx.stroke();
      ctx.restore();
      // (b) 彗星头：错峰从出怪口流向基地口，渐细光尾
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < cometCount; k += 1) {
        const ct = Math.max(0, Math.min(1, t * 1.35 - k * 0.12));
        if (ct <= 0) {
          continue;
        }
        const headM = easeOutCubic(ct) * path.lengthMilli;
        const samples = flight ? 7 : 9;
        const spacing = 380;
        for (let i = samples; i >= 1; i -= 1) {
          const pM = headM - i * spacing;
          if (pM < 0) {
            continue;
          }
          const at = pathPointToStage(map, geom, pathIdx, pM, flight);
          const f = 1 - i / (samples + 1);
          ctx.globalAlpha = env * f * 0.42;
          ctx.fillStyle = glowHex;
          ctx.beginPath();
          ctx.arc(at.x, at.y, 1.5 + f * 5, 0, Math.PI * 2);
          ctx.fill();
        }
        const head = pathPointToStage(map, geom, pathIdx, headM, flight);
        ctx.globalAlpha = 1;
        const halo = ctx.createRadialGradient(head.x, head.y, 1, head.x, head.y, 18);
        halo.addColorStop(0, `rgba(255, 252, 240, ${0.85 * env})`);
        halo.addColorStop(0.4, withAlpha(glowHex, 0.5 * env));
        halo.addColorStop(1, withAlpha(glowHex, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(head.x, head.y, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255, 255, 255, ${0.95 * env})`;
        ctx.beginPath();
        ctx.arc(head.x, head.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      // (c) 出怪门：柔光晕 + 双相位扩散警示环
      const spawn = pathPointToStage(map, geom, pathIdx, 0, flight);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const gateGlow = ctx.createRadialGradient(spawn.x, spawn.y, 2, spawn.x, spawn.y, 34);
      gateGlow.addColorStop(0, withAlpha(glowHex, 0.42 * env * breath));
      gateGlow.addColorStop(1, withAlpha(glowHex, 0));
      ctx.fillStyle = gateGlow;
      ctx.beginPath();
      ctx.arc(spawn.x, spawn.y, 34, 0, Math.PI * 2);
      ctx.fill();
      for (let ring = 0; ring < 2; ring += 1) {
        const rt = (now / 640 + ring * 0.5 + pathIdx * 0.23) % 1;
        ctx.globalAlpha = env * (1 - rt) * 0.85;
        ctx.strokeStyle = glowHex;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(spawn.x, spawn.y, 10 + rt * 22, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  };
  drawPreviewList(preview.pathIdxs, false);
  drawPreviewList(preview.flightPathIdxs, true);
  ctx.restore();
  return true;
}

export function drawCellHighlight(
  ctx: CanvasRenderingContext2D,
  geom: StageGeom,
  row: number,
  col: number,
  color: string,
  alpha: number,
): void {
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.fillRect(geom.ox + col * TILE + 4, geom.oy + row * TILE + 4, TILE - 8, TILE - 8);
  ctx.globalAlpha = 1;
}

export interface SpriteOpts {
  hpRatio: number;
  flash: number;
  alpha: number;
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
  gray: boolean;
  skillActive: boolean;
  selected: boolean;
  /** 朝向 0右 1下 2左 3上；-1 = 不画朝向楔形（阵亡余像/拖拽幽灵） */
  dir: number;
}

/** dir → 舞台方向单位向量 (dx, dy)；dir 语义见规格 §7.2。 */
export const DIR_VECTORS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

export function drawUnitSprite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  typeIdx: number,
  opts: SpriteOpts,
): void {
  drawUnitCharacter(ctx, x, y, typeIdx, opts);
}

const PAD_DIST = TILE * 0.95;
const PAD_RADIUS = 24;

/** 方向选择盘：四向圆钮 + 箭头；hoverDir 高亮当前悬停/拖出方向。 */
export function drawDirectionPad(
  ctx: CanvasRenderingContext2D,
  geom: StageGeom,
  row: number,
  col: number,
  hoverDir: number | null,
): void {
  const c = cellCenter(geom, row, col);
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 3;
  ctx.strokeRect(geom.ox + col * TILE + 2, geom.oy + row * TILE + 2, TILE - 4, TILE - 4);
  for (let dir = 0; dir < 4; dir += 1) {
    const [ux, uy] = DIR_VECTORS[dir];
    const bx = c.x + ux * PAD_DIST;
    const by = c.y + uy * PAD_DIST;
    const active = hoverDir === dir;
    ctx.beginPath();
    ctx.arc(bx, by, active ? PAD_RADIUS + 3 : PAD_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = active ? 'rgba(56, 189, 248, 0.95)' : 'rgba(15, 23, 42, 0.8)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
    const px = -uy;
    const py = ux;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(bx + ux * 11, by + uy * 11);
    ctx.lineTo(bx - ux * 6 + px * 9, by - uy * 6 + py * 9);
    ctx.lineTo(bx - ux * 6 - px * 9, by - uy * 6 - py * 9);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** 命中检测：点 (x,y) 落在哪个方向钮上；null = 未命中。 */
export function directionPadHit(geom: StageGeom, row: number, col: number, x: number, y: number): number | null {
  const c = cellCenter(geom, row, col);
  const hitR = (PAD_RADIUS + 6) * (PAD_RADIUS + 6);
  for (let dir = 0; dir < 4; dir += 1) {
    const [ux, uy] = DIR_VECTORS[dir];
    const bx = c.x + ux * PAD_DIST;
    const by = c.y + uy * PAD_DIST;
    const dx = x - bx;
    const dy = y - by;
    if (dx * dx + dy * dy <= hitR) {
      return dir;
    }
  }
  return null;
}

export function drawEnemySprite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  typeIdx: number,
  opts: { hpRatio: number; flash: number; rot: number; bob: number; alpha: number; scaleY: number; frame?: 0 | 1 },
): void {
  drawEnemyCharacter(ctx, x, y, typeIdx, opts);
}

// ── 弹道 / 粒子 / 飘字 ────────────────────────────

export interface ProjectileVis {
  kind: 'arrow' | 'bolt' | 'heal';
  /** 攻击变体着色：frost 寒霜 / venom 剧毒 / cannon 炮弹烟尘 / storm 风暴电痕 / thorn 敌方荆棘（缺省按 kind 默认色）。 */
  variant?: 'frost' | 'venom' | 'cannon' | 'storm' | 'thorn';
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  born: number;
  duration: number;
}

interface ProjectileTint {
  core: string;
  glow: string;
  trail: string;
}

const PROJECTILE_TINTS: Record<NonNullable<ProjectileVis['variant']> | 'default', ProjectileTint> = {
  default: { core: '#f5f3ff', glow: '#8b5cf6', trail: '#c4b5fd' },
  frost: { core: '#f0f9ff', glow: '#38bdf8', trail: '#7dd3fc' },
  venom: { core: '#f7fee7', glow: '#84cc16', trail: '#a3e635' },
  cannon: { core: '#ffedd5', glow: '#fb923c', trail: '#a8a29e' },
  storm: { core: '#fefce8', glow: '#facc15', trail: '#fde047' },
  thorn: { core: '#ffe4e6', glow: '#e11d48', trail: '#fb7185' },
};

/** 弹道专用确定性散列（born+index），避免逐帧闪烁；不消耗引擎 RNG。 */
function projRand(seed: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 弓箭：带羽尾细节的箭矢 + 三段渐隐运动拖尾；cannon 变体画铁球 + 烟尘团。 */
function drawArrowProjectile(ctx: CanvasRenderingContext2D, p: ProjectileVis, t: number, tint: ProjectileTint): void {
  if (p.variant === 'cannon') {
    // 烟尘团（身后三团，渐大渐淡）
    for (let i = 1; i <= 3; i += 1) {
      const jitter = (projRand((p.born | 0) + i * 131) - 0.5) * 6;
      ctx.globalAlpha = Math.max(0, 0.32 - i * 0.08) * (1 - t);
      ctx.fillStyle = tint.trail;
      ctx.beginPath();
      ctx.arc(-8 - i * 9, jitter, 3 + i * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // 铁球本体 + 火口余焰高光
    const ball = ctx.createRadialGradient(-1.5, -1.5, 0.5, 0, 0, 5.5);
    ball.addColorStop(0, '#78716c');
    ball.addColorStop(0.6, '#44403c');
    ball.addColorStop(1, '#292524');
    ctx.fillStyle = ball;
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.7 * (1 - t * 0.5);
    ctx.strokeStyle = tint.glow;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }
  // 三段渐隐运动拖尾
  ctx.lineCap = 'round';
  for (let i = 1; i <= 3; i += 1) {
    ctx.globalAlpha = Math.max(0, 0.34 - i * 0.09);
    ctx.strokeStyle = p.variant ? tint.trail : '#fef3c7';
    ctx.lineWidth = 2.4 - i * 0.5;
    ctx.beginPath();
    ctx.moveTo(-10 - i * 8, 0);
    ctx.lineTo(-4 - i * 8, 0);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // 箭杆
  ctx.strokeStyle = '#854d0e';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(-9, 0);
  ctx.lineTo(6, 0);
  ctx.stroke();
  // 尾羽（两对斜羽）
  ctx.strokeStyle = p.variant ? tint.trail : '#f1f5f9';
  ctx.lineWidth = 1.8;
  for (const off of [0, 3.5]) {
    ctx.beginPath();
    ctx.moveTo(-9 + off, 0);
    ctx.lineTo(-12.5 + off, -3.6);
    ctx.moveTo(-9 + off, 0);
    ctx.lineTo(-12.5 + off, 3.6);
    ctx.stroke();
  }
  // 箭头
  ctx.fillStyle = p.variant ? tint.glow : '#fbbf24';
  ctx.beginPath();
  ctx.moveTo(11, 0);
  ctx.lineTo(4, -3.6);
  ctx.lineTo(4, 3.6);
  ctx.closePath();
  ctx.fill();
  // storm 变体：箭身电痕小折线
  if (p.variant === 'storm') {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = tint.core;
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 2; i += 1) {
      const sx = -4 + i * 7;
      const sy = (projRand((p.born | 0) + ((t * 6) | 0) * 17 + i * 53) - 0.5) * 9;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx + 2.5, sy);
      ctx.lineTo(sx + 5, 0);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** 法术：旋转星核弹 + 柔光晕 + 身后星屑拖尾。 */
function drawBoltProjectile(ctx: CanvasRenderingContext2D, p: ProjectileVis, t: number, tint: ProjectileTint): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // 星屑拖尾（三粒，确定性抖动）
  for (let i = 1; i <= 3; i += 1) {
    const jitter = (projRand((p.born | 0) + i * 977) - 0.5) * 8;
    ctx.globalAlpha = Math.max(0, 0.55 - i * 0.15) * (1 - t * 0.4);
    ctx.fillStyle = tint.trail;
    ctx.beginPath();
    ctx.arc(-6 - i * 7, jitter, 2.6 - i * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // 柔光晕
  ctx.globalAlpha = 1;
  const halo = ctx.createRadialGradient(0, 0, 1, 0, 0, 11);
  halo.addColorStop(0, tint.core);
  halo.addColorStop(0.45, withAlpha(tint.glow, 0.55));
  halo.addColorStop(1, withAlpha(tint.glow, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, 11, 0, Math.PI * 2);
  ctx.fill();
  // 旋转四芒星核
  ctx.rotate(t * 7);
  ctx.fillStyle = tint.core;
  ctx.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const r = i % 2 === 0 ? 5 : 1.9;
    const a = (Math.PI * 2 * i) / 8;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** 治疗：沿贝塞尔弧线流动的三粒光尘（首粒带柔光）。 */
function drawHealProjectile(ctx: CanvasRenderingContext2D, p: ProjectileVis, t: number): void {
  const cx = (p.fromX + p.toX) / 2;
  const cy = Math.min(p.fromY, p.toY) - 36;
  const at = (tt: number): { x: number; y: number } => {
    const u = 1 - tt;
    return {
      x: u * u * p.fromX + 2 * u * tt * cx + tt * tt * p.toX,
      y: u * u * p.fromY + 2 * u * tt * cy + tt * tt * p.toY,
    };
  };
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i += 1) {
    const tt = t - i * 0.14;
    if (tt <= 0) {
      continue;
    }
    const pos = at(tt);
    if (i === 0) {
      const halo = ctx.createRadialGradient(pos.x, pos.y, 1, pos.x, pos.y, 10);
      halo.addColorStop(0, 'rgba(204, 251, 241, 0.9)');
      halo.addColorStop(1, 'rgba(45, 212, 191, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 10, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 0.9 - i * 0.25;
    ctx.fillStyle = i === 0 ? '#ccfbf1' : 'rgba(45, 212, 191, 0.85)';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 4.2 - i * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawProjectile(ctx: CanvasRenderingContext2D, p: ProjectileVis, now: number): boolean {
  const t = (now - p.born) / p.duration;
  if (t >= 1) {
    return false;
  }
  if (p.kind === 'heal') {
    drawHealProjectile(ctx, p, t);
    return true;
  }
  const tint = PROJECTILE_TINTS[p.variant ?? 'default'];
  const x = p.fromX + (p.toX - p.fromX) * t;
  const y = p.fromY + (p.toY - p.fromY) * t;
  const angle = Math.atan2(p.toY - p.fromY, p.toX - p.fromX);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  if (p.kind === 'arrow') {
    drawArrowProjectile(ctx, p, t, tint);
  } else {
    drawBoltProjectile(ctx, p, t, tint);
  }
  ctx.restore();
  return true;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  size: number;
  color: string;
  gravity: number;
  ring: boolean;
}

export function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[], now: number): Particle[] {
  const alive: Particle[] = [];
  for (const p of particles) {
    const t = (now - p.born) / p.life;
    if (t >= 1) {
      continue;
    }
    alive.push(p);
    if (t < 0) {
      // 尚未出生（如法术弹道落点的延迟冲击环 born: now+200）：保留但不绘制，
      // 否则 ring 半径 size*t 为负，ctx.arc 抛 IndexSizeError 打断 rAF 主循环
      continue;
    }
    const dt = (now - p.born) / 1000;
    const x = p.x + p.vx * dt;
    const y = p.y + p.vy * dt + p.gravity * dt * dt * 0.5;
    ctx.globalAlpha = 1 - t;
    if (p.ring) {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2.5 * (1 - t);
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0, p.size * t), 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(x, y, p.size * (1 - t * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  return alive;
}

export interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  born: number;
}

const FLOATER_MS = 600;

export function drawFloaters(ctx: CanvasRenderingContext2D, floaters: Floater[], now: number): Floater[] {
  const alive: Floater[] = [];
  ctx.font = '900 15px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const f of floaters) {
    const t = (now - f.born) / FLOATER_MS;
    if (t >= 1) {
      continue;
    }
    alive.push(f);
    const ease = 1 - (1 - t) * (1 - t);
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.lineWidth = 3;
    ctx.strokeText(f.text, f.x, f.y - ease * 24);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y - ease * 24);
  }
  ctx.globalAlpha = 1;
  return alive;
}
