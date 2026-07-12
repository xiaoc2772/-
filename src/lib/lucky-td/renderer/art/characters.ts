// 幸运塔防 程序化美术 · 运行时角色绘制。
// 角色矢量画家（units-a/units-b/enemies）首次使用时渲染进离屏缓存，
// 每帧只做 drawImage + 变换（呼吸/bob/挤压/翻转）+ 白闪/灰度变体叠加。

import type { SpriteOpts } from '../draw';
import { TILE, DIR_VECTORS } from '../draw';
import { sharedSpriteCache } from './sprite-cache';
import { UNIT_PAINTERS_A, UNIT_CANVAS_W, UNIT_CANVAS_H } from './units-a';
import { UNIT_PAINTERS_B } from './units-b';
import { ENEMY_PAINTERS, ENEMY_CANVAS } from './enemies';

/** 敌人体格半径（阴影/HP 条宽度用），索引对齐 config.enemies。 */
export const ENEMY_RADII = [15, 13, 19, 16, 30, 14, 15, 15];

/** 单位脚底锚点相对 (x, y) 的纵向偏移：与旧几何皮肤一致（身体底=y+16+12 阴影带）。 */
const UNIT_FOOT_Y = 26;

function unitBitmap(typeIdx: number): HTMLCanvasElement {
  const idx = Math.max(0, Math.min(UNIT_PAINTERS_A.length + UNIT_PAINTERS_B.length - 1, typeIdx));
  return sharedSpriteCache.get(`unit:${idx}`, UNIT_CANVAS_W, UNIT_CANVAS_H, (c) => {
    const painter = idx < UNIT_PAINTERS_A.length ? UNIT_PAINTERS_A[idx] : UNIT_PAINTERS_B[idx - UNIT_PAINTERS_A.length];
    painter(c);
  });
}

/** 选择/编队界面头像用：返回单位基础位图（2x 超采样离屏缓存，物理 144×160）。 */
export function getUnitSpriteCanvas(typeIdx: number): HTMLCanvasElement {
  return unitBitmap(typeIdx);
}

function enemyBitmap(typeIdx: number, frame: 0 | 1): HTMLCanvasElement {
  const idx = Math.max(0, Math.min(ENEMY_PAINTERS.length - 1, typeIdx));
  const size = ENEMY_CANVAS[idx];
  return sharedSpriteCache.get(`enemy:${idx}:f${frame}`, size, size, (c) => {
    ENEMY_PAINTERS[idx](c, frame);
  });
}

/** 规则/图鉴界面头像用：返回敌人基础位图，不包含血条、阴影和战斗态变换。 */
export function getEnemySpriteCanvas(typeIdx: number, frame: 0 | 1 = 0): HTMLCanvasElement {
  return enemyBitmap(typeIdx, frame);
}

export function drawUnitCharacter(ctx: CanvasRenderingContext2D, x: number, y: number, typeIdx: number, opts: SpriteOpts): void {
  const base = unitBitmap(typeIdx);
  const bitmap = opts.gray ? sharedSpriteCache.grayVariant(`unit:${typeIdx}`, base) : base;
  ctx.save();
  ctx.globalAlpha = opts.alpha;
  ctx.translate(x + opts.offsetX, y + UNIT_FOOT_Y + opts.offsetY);
  // 脚底阴影（跟随挤压）
  ctx.fillStyle = 'rgba(30, 38, 30, 0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 19 * opts.scaleX, 5.6, 0, 0, Math.PI * 2);
  ctx.fill();
  // 朝左翻转（dir=2）；其余朝向保持右向底图 + 楔形指示
  const flip = opts.dir === 2 ? -1 : 1;
  ctx.scale(opts.scaleX * flip, opts.scaleY);
  if (opts.skillActive) {
    const glow = ctx.createRadialGradient(0, -28, 6, 0, -28, 42);
    glow.addColorStop(0, 'rgba(250, 210, 90, 0.42)');
    glow.addColorStop(1, 'rgba(250, 210, 90, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(-42, -70, 84, 84);
  }
  const dw = UNIT_CANVAS_W;
  const dh = UNIT_CANVAS_H;
  ctx.drawImage(bitmap, -dw / 2, -dh + 8, dw, dh);
  if (opts.flash > 0) {
    ctx.globalAlpha = opts.alpha * opts.flash;
    ctx.drawImage(sharedSpriteCache.whiteVariant(`unit:${typeIdx}`, base), -dw / 2, -dh + 8, dw, dh);
  }
  ctx.restore();
  if (opts.dir >= 0) {
    drawDirWedge(ctx, x + opts.offsetX, y + opts.offsetY, opts.dir, opts.alpha);
  }
  if (opts.selected) {
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.95)';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x - TILE / 2 + 3, y - TILE / 2 + 3, TILE - 6, TILE - 6);
  }
  drawHpBar(ctx, x, y - 48, 44, opts.hpRatio, '#22c55e');
}

/** 朝向楔形：贴着单位头顶侧缘的小白箭头（玩法信息，不随翻转变形）。 */
function drawDirWedge(ctx: CanvasRenderingContext2D, x: number, y: number, dir: number, alpha: number): void {
  const [ux, uy] = DIR_VECTORS[dir & 3];
  const cx = x + ux * 24;
  const cy = y - 18 + uy * 22;
  const px = -uy;
  const py = ux;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(250, 250, 249, 0.95)';
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx + ux * 8, cy + uy * 8);
  ctx.lineTo(cx + px * 7 - ux * 2, cy + py * 7 - uy * 2);
  ctx.lineTo(cx - px * 7 - ux * 2, cy - py * 7 - uy * 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export interface EnemyCharacterOpts {
  hpRatio: number;
  flash: number;
  rot: number;
  bob: number;
  alpha: number;
  scaleY: number;
  /** 行走两帧循环；缺省 0（阻挡/静止态）。 */
  frame?: 0 | 1;
}

export function drawEnemyCharacter(ctx: CanvasRenderingContext2D, x: number, y: number, typeIdx: number, opts: EnemyCharacterOpts): void {
  const idx = Math.max(0, Math.min(ENEMY_PAINTERS.length - 1, typeIdx));
  const frame: 0 | 1 = opts.frame ?? 0;
  const base = enemyBitmap(idx, frame);
  const size = ENEMY_CANVAS[idx];
  const r = ENEMY_RADII[idx];
  ctx.save();
  ctx.globalAlpha = opts.alpha;
  ctx.translate(x, y + opts.bob);
  ctx.fillStyle = 'rgba(20, 26, 40, 0.25)';
  ctx.beginPath();
  ctx.ellipse(0, r * 0.85, r * 0.8, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(opts.rot);
  ctx.scale(1, opts.scaleY);
  ctx.drawImage(base, -size / 2, -size / 2, size, size);
  if (opts.flash > 0) {
    ctx.globalAlpha = opts.alpha * opts.flash;
    ctx.drawImage(sharedSpriteCache.whiteVariant(`enemy:${idx}:f${frame}`, base), -size / 2, -size / 2, size, size);
  }
  ctx.restore();
  drawHpBar(ctx, x, y - r - 14 + opts.bob, Math.max(26, r * 2), opts.hpRatio, '#f43f5e');
}

function drawHpBar(ctx: CanvasRenderingContext2D, cx: number, y: number, width: number, ratio: number, color: string): void {
  if (ratio >= 1 || ratio < 0) {
    return;
  }
  ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
  ctx.fillRect(cx - width / 2, y, width, 5);
  ctx.fillStyle = color;
  ctx.fillRect(cx - width / 2, y, width * Math.max(0, ratio), 5);
}
