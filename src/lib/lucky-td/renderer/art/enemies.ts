// 幸运塔防 程序化美术 · 敌人绘制（精密动漫线稿 · 暗紫反派）。
// 三级线宽体系：INK 2.0 剪影墨线 / STRUCT 1.1 结构线 / DETAIL 0.6 细节线，
// 配合锥形贝塞尔笔触、赛璐璐平涂底色与冷色轮廓光，追求电影级动漫质感。
// 顺序与 config.enemies 对齐：grunt / wolf / golem / puppet / boss / coin / drone / shooter。
// 面朝左、两帧行走循环（肢体/翅膀/披风有实义差异）、透明底、无阴影无血条、完全确定性（禁 Math.random）。

import { mixColor, withAlpha } from './palette';

export type EnemyPainter = (ctx: CanvasRenderingContext2D, frame: 0 | 1) => void;

/** 每敌人画布逻辑尺寸（正方形边长），索引对齐 config.enemies */
export const ENEMY_CANVAS: number[] = [56, 52, 72, 60, 110, 52, 56, 56];

// ── 三级线宽体系 ────────────────────────
const INK = 'rgba(28,22,42,0.9)';
const STRUCT = 'rgba(28,22,42,0.6)';
const DETAIL = 'rgba(28,22,42,0.4)';
/** 冷色轮廓光（受光侧细亮线）。 */
const RIM = 'rgba(173,196,255,0.55)';

function inkStroke(ctx: CanvasRenderingContext2D): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function structStroke(ctx: CanvasRenderingContext2D): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = STRUCT;
  ctx.lineWidth = 1.1;
  ctx.stroke();
}

function detailStroke(ctx: CanvasRenderingContext2D): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = DETAIL;
  ctx.lineWidth = 0.6;
  ctx.stroke();
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
}

function poly(ctx: CanvasRenderingContext2D, pts: number[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
}

/** 锥形笔触：沿二次贝塞尔曲线绘制由粗渐细的墨线（填充多边形实现）。 */
function taper(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, cx: number, cy: number, x1: number, y1: number,
  w0: number, w1: number, color: string,
): void {
  const steps = 8;
  const up: Array<[number, number]> = [];
  const dn: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const mt = 1 - t;
    const px = mt * mt * x0 + 2 * mt * t * cx + t * t * x1;
    const py = mt * mt * y0 + 2 * mt * t * cy + t * t * y1;
    const dx = 2 * (mt * (cx - x0) + t * (x1 - cx));
    const dy = 2 * (mt * (cy - y0) + t * (y1 - cy));
    const len = Math.hypot(dx, dy) || 1;
    const w = (w0 + (w1 - w0) * t) / 2;
    up.push([px - (dy / len) * w, py + (dx / len) * w]);
    dn.push([px + (dy / len) * w, py - (dx / len) * w]);
  }
  ctx.beginPath();
  up.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
  [...dn].reverse().forEach(([px, py]) => ctx.lineTo(px, py));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** 反派眼：眼白 + 虹膜环 + 竖裂瞳 + 高光 + 斜怒眉（锥形墨眉）。 */
function fierceEye(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, tilt: number): void {
  ellipse(ctx, x, y, r, r * 0.86);
  ctx.fillStyle = '#f5ecdd';
  ctx.fill();
  structStroke(ctx);
  ellipse(ctx, x - r * 0.2, y + r * 0.03, r * 0.52, r * 0.64);
  detailStroke(ctx);
  ellipse(ctx, x - r * 0.2, y + r * 0.08, r * 0.24, r * 0.5);
  ctx.fillStyle = '#231a30';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x - r * 0.38, y - r * 0.28, r * 0.13, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();
  taper(ctx, x - r * 1.2, y - r * 0.72 + tilt, x - r * 0.1, y - r * 1.3 - tilt * 0.4, x + r * 1.0, y - r * 1.05 - tilt, 1.9, 0.4, INK);
}

// ── 0 grunt 碎星杂兵（56）— 破碎星晶 · 晶面结构线 · 裂纹网 · 短粗关节腿 ──
function paintGrunt(ctx: CanvasRenderingContext2D, frame: 0 | 1): void {
  const c = 28;
  const legFwd = frame === 0 ? 4.5 : -4.5;
  const base = '#4c3568';
  const lit = mixColor(base, '#a78bfa', 0.4);
  const deep = mixColor(base, '#1c1230', 0.45);
  // 短粗关节腿：锥形大腿 + 关节销圆 + 足垫（前后帧交换迈步）
  for (const [hx, off, col] of [[c + 6, -legFwd, deep], [c - 6, legFwd, base]] as const) {
    const kx = hx + off * 0.7;
    const ky = c + 15;
    taper(ctx, hx, c + 9, hx + off * 0.4, c + 12.5, kx, ky, 5.2, 3.4, col);
    ellipse(ctx, kx, ky, 3.4, 3.2);
    ctx.fillStyle = col;
    ctx.fill();
    inkStroke(ctx);
    ellipse(ctx, kx, ky, 1.1, 1.1);
    detailStroke(ctx);
    ellipse(ctx, hx + off, c + 19.5, 3.8, 2.4);
    ctx.fillStyle = col;
    ctx.fill();
    inkStroke(ctx);
  }
  // 星晶本体（五角星，帧间微旋）
  ctx.save();
  ctx.translate(c + (frame === 0 ? -1.2 : 1.2), c - 1);
  ctx.rotate(frame === 0 ? -0.07 : 0.07);
  const star: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    const a = -Math.PI / 2 + (Math.PI * i) / 5;
    const r = i % 2 === 0 ? 15 : 9;
    star.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  poly(ctx, star);
  ctx.fillStyle = base;
  ctx.fill();
  // 赛璐璐晶面：左上受光面 / 右下背光面
  poly(ctx, [0, 0, 0, -15, -5.3, -7.3]);
  ctx.fillStyle = withAlpha(lit, 0.55);
  ctx.fill();
  poly(ctx, [0, 0, -5.3, -7.3, -14.3, -4.6]);
  ctx.fillStyle = withAlpha(lit, 0.35);
  ctx.fill();
  poly(ctx, [0, 0, 8.8, 12.1, 0, 9]);
  ctx.fillStyle = withAlpha(deep, 0.6);
  ctx.fill();
  poly(ctx, star);
  inkStroke(ctx);
  // 晶面结构线（中心放射向五个星尖）
  ctx.beginPath();
  for (let i = 0; i < 5; i += 1) {
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / 5;
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * 15, Math.sin(a) * 15);
  }
  structStroke(ctx);
  // 裂纹网（分叉细线）+ 一道发光主裂缝
  ctx.beginPath();
  ctx.moveTo(-3, -13); ctx.lineTo(-1, -7.5); ctx.lineTo(-4, -2.5);
  ctx.moveTo(-1, -7.5); ctx.lineTo(2.2, -4.5);
  ctx.moveTo(7.5, 1.5); ctx.lineTo(4, 5.5); ctx.lineTo(6.8, 9.5);
  ctx.moveTo(4, 5.5); ctx.lineTo(0.8, 7.8);
  ctx.moveTo(-9.5, 4); ctx.lineTo(-6.2, 6.2);
  detailStroke(ctx);
  taper(ctx, 5.3, -7.2, 7, 0, 5.5, 6.5, 1.6, 0.3, withAlpha('#c4b5fd', 0.9));
  // 冷色轮廓光（左上两条星边）
  taper(ctx, -0.8, -13.8, -3.6, -10.2, -4.9, -7.8, 1.5, 0.3, RIM);
  taper(ctx, -6, -7.1, -10, -5.5, -13.4, -4.7, 1.3, 0.3, RIM);
  // 气鼓鼓反派脸（朝左）
  fierceEye(ctx, -6.5, -1.5, 3, 1.3);
  fierceEye(ctx, 1.5, -1.5, 3, -1.3);
  ctx.beginPath();
  ctx.moveTo(-8, 4.6); ctx.lineTo(-5.6, 6.6); ctx.lineTo(-3.2, 4.8); ctx.lineTo(-0.8, 6.6); ctx.lineTo(1.6, 5);
  structStroke(ctx);
  ctx.fillStyle = withAlpha('#f2a5b8', 0.5);
  ellipse(ctx, -10.5, 2.5, 2.1, 1.3);
  ctx.fill();
  ctx.restore();
}

// ── 1 wolf 疾影狼（52）— 流线肌理 · 背脊鬃毛簇 · 青色疾风纹 ──
function paintWolf(ctx: CanvasRenderingContext2D, frame: 0 | 1): void {
  const c = 26;
  const bob = frame === 0 ? 0 : 1.6;
  const body = '#33325e';
  const lit = mixColor(body, '#818cf8', 0.4);
  const deep = mixColor(body, '#12102a', 0.45);
  // 远侧双腿（后置层，帧间伸展/收拢交换）
  if (frame === 0) {
    taper(ctx, c - 7, c + 3 + bob, c - 3, c + 9, c - 4.5, c + 15, 4.2, 2, deep);
    taper(ctx, c + 8, c + 3 + bob, c + 6, c + 9, c + 8, c + 15, 4.6, 2, deep);
  } else {
    taper(ctx, c - 7, c + 3 + bob, c - 11, c + 8, c - 14, c + 13, 4.2, 2, deep);
    taper(ctx, c + 8, c + 3 + bob, c + 13, c + 8, c + 16, c + 13, 4.6, 2, deep);
  }
  // 尾巴（锥形甩尾 + 尾毛簇）
  const tipY = frame === 0 ? c - 11 : c - 3;
  taper(ctx, c + 12, c - 1 + bob, c + 20, c - 5, c + 24, tipY, 5.5, 0.6, body);
  taper(ctx, c + 18, c - 3.5, c + 21.5, c - 5.5, c + 23.5, tipY + 1, 1, 0.1, withAlpha('#12102a', 0.6));
  taper(ctx, c + 16, c - 2, c + 19, c - 3.6, c + 21.5, tipY + 3.5, 0.9, 0.1, withAlpha('#12102a', 0.55));
  // 流线身体（低伏，朝左）
  ctx.beginPath();
  ctx.moveTo(c - 17, c + 1 + bob);
  ctx.quadraticCurveTo(c - 16, c - 7 + bob, c - 8, c - 8.5 + bob);
  ctx.quadraticCurveTo(c + 2, c - 11 + bob, c + 9, c - 7 + bob);
  ctx.quadraticCurveTo(c + 15, c - 4 + bob, c + 14, c + 1 + bob);
  ctx.quadraticCurveTo(c + 12, c + 6 + bob, c + 4, c + 7 + bob);
  ctx.quadraticCurveTo(c - 6, c + 8 + bob, c - 12, c + 5 + bob);
  ctx.quadraticCurveTo(c - 17, c + 4 + bob, c - 17, c + 1 + bob);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();
  // 赛璐璐背光带（背脊受光）
  ctx.beginPath();
  ctx.moveTo(c - 10, c - 7.5 + bob);
  ctx.quadraticCurveTo(c + 2, c - 10.5 + bob, c + 10, c - 6 + bob);
  ctx.quadraticCurveTo(c + 3, c - 6.5 + bob, c - 4, c - 5 + bob);
  ctx.quadraticCurveTo(c - 8, c - 4.5 + bob, c - 10, c - 7.5 + bob);
  ctx.closePath();
  ctx.fillStyle = withAlpha(lit, 0.5);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(c - 17, c + 1 + bob);
  ctx.quadraticCurveTo(c - 16, c - 7 + bob, c - 8, c - 8.5 + bob);
  ctx.quadraticCurveTo(c + 2, c - 11 + bob, c + 9, c - 7 + bob);
  ctx.quadraticCurveTo(c + 15, c - 4 + bob, c + 14, c + 1 + bob);
  ctx.quadraticCurveTo(c + 12, c + 6 + bob, c + 4, c + 7 + bob);
  ctx.quadraticCurveTo(c - 6, c + 8 + bob, c - 12, c + 5 + bob);
  ctx.quadraticCurveTo(c - 17, c + 4 + bob, c - 17, c + 1 + bob);
  ctx.closePath();
  inkStroke(ctx);
  // 肌肉结构线（肩胛弧 + 后臀弧 + 肋线）
  ctx.beginPath();
  ctx.moveTo(c - 12, c - 4 + bob); ctx.quadraticCurveTo(c - 8, c + 1 + bob, c - 11, c + 4 + bob);
  ctx.moveTo(c + 7, c - 5 + bob); ctx.quadraticCurveTo(c + 12, c - 1 + bob, c + 9, c + 4 + bob);
  structStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(c - 4, c + 1 + bob); ctx.quadraticCurveTo(c - 1, c + 3 + bob, c - 4, c + 5 + bob);
  ctx.moveTo(c, c + bob); ctx.quadraticCurveTo(c + 3, c + 2.5 + bob, c + 1, c + 5.5 + bob);
  detailStroke(ctx);
  // 背脊鬃毛簇（10 束流动锥形曲线，沿颈—背—臀）
  const furAnchors: Array<[number, number, number]> = [
    [c - 9, c - 8, -0.5], [c - 6, c - 9, -0.3], [c - 3, c - 9.8, -0.2], [c, c - 10, 0],
    [c + 3, c - 9.6, 0.15], [c + 6, c - 8.6, 0.3], [c + 9, c - 7, 0.45],
    [c - 13, c - 5.5, -0.7], [c + 12, c - 4.5, 0.6], [c + 13.5, c - 1.5, 0.8],
  ];
  for (const [fx, fy, k] of furAnchors) {
    taper(ctx, fx, fy + bob, fx + 2.4 + k, fy - 2.6 + bob, fx + 4.6 + k * 3, fy - 3.4 + bob, 1.1, 0.1, withAlpha('#12102a', 0.6));
  }
  // 青色疾风纹（锥形拖尾亮痕）
  taper(ctx, c - 6, c - 4.5 + bob, c + 2, c - 6 + bob, c + 10, c - 3.5 + bob, 1.5, 0.2, withAlpha('#67e8f9', 0.85));
  taper(ctx, c - 4, c + bob, c + 3, c - 1 + bob, c + 10, c + 1 + bob, 1.2, 0.15, withAlpha('#67e8f9', 0.65));
  taper(ctx, c - 8, c + 3 + bob, c - 2, c + 3.5 + bob, c + 4, c + 4.5 + bob, 1, 0.15, withAlpha('#22d3ee', 0.5));
  // 头部（楔形吻，朝左）+ 双耳（帧间一耳后掠）
  ctx.beginPath();
  ctx.moveTo(c - 10, c - 8.5 + bob);
  ctx.quadraticCurveTo(c - 17, c - 11 + bob, c - 20, c - 8 + bob);
  ctx.quadraticCurveTo(c - 24.5, c - 5.5 + bob, c - 24.5, c - 3 + bob);
  ctx.quadraticCurveTo(c - 21, c - 0.5 + bob, c - 16.5, c + bob);
  ctx.quadraticCurveTo(c - 12, c + 0.5 + bob, c - 10, c - 2 + bob);
  ctx.closePath();
  ctx.fillStyle = lit;
  ctx.fill();
  inkStroke(ctx);
  const earBack = frame === 0 ? 0 : 2.2;
  poly(ctx, [c - 17, c - 9 + bob, c - 15 + earBack, c - 16 + bob, c - 12, c - 9.5 + bob]);
  ctx.fillStyle = body;
  ctx.fill();
  inkStroke(ctx);
  poly(ctx, [c - 12, c - 9.5 + bob, c - 9 + earBack * 0.5, c - 15 + bob, c - 7.5, c - 9 + bob]);
  ctx.fillStyle = deep;
  ctx.fill();
  inkStroke(ctx);
  // 面部：鼻尖 + 怒目 + 獠牙 + 颊毛
  ctx.fillStyle = '#231a30';
  ellipse(ctx, c - 24, c - 3.5 + bob, 1.3, 1.1);
  ctx.fill();
  fierceEye(ctx, c - 17.5, c - 5.5 + bob, 2.3, 1.1);
  ctx.beginPath();
  ctx.moveTo(c - 22.5, c - 1.2 + bob); ctx.quadraticCurveTo(c - 19, c + 0.8 + bob, c - 15, c + bob);
  structStroke(ctx);
  poly(ctx, [c - 20.5, c - 0.4 + bob, c - 19.7, c + 1.8 + bob, c - 19, c - 0.2 + bob]);
  ctx.fillStyle = '#f5ecdd';
  ctx.fill();
  taper(ctx, c - 11, c - 1 + bob, c - 9, c + 0.5 + bob, c - 7.5, c + 2.5 + bob, 0.9, 0.1, withAlpha('#12102a', 0.55));
  // 冷色轮廓光（额头—背脊）
  taper(ctx, c - 20, c - 8.5 + bob, c - 12, c - 10.5 + bob, c - 4, c - 10.4 + bob, 1.2, 0.2, RIM);
  // 近侧双腿（帧间与远侧相反相位）
  if (frame === 0) {
    taper(ctx, c - 10, c + 4 + bob, c - 15, c + 9, c - 19, c + 14, 4.6, 2.2, body);
    taper(ctx, c + 10, c + 3 + bob, c + 13, c + 9, c + 18, c + 14, 5, 2.2, body);
  } else {
    taper(ctx, c - 10, c + 4 + bob, c - 8, c + 10, c - 10.5, c + 15.5, 4.6, 2.2, body);
    taper(ctx, c + 10, c + 3 + bob, c + 9, c + 10, c + 7, c + 15.5, 5, 2.2, body);
  }
}

// ── 2 golem 重甲卫（72）— 板甲缝线铆钉 · 苔藓裂纹 · 甲隙炉心辉光 ──
function paintGolem(ctx: CanvasRenderingContext2D, frame: 0 | 1): void {
  const c = 36;
  const sway = frame === 0 ? -2 : 2;
  const plate = '#585271';
  const lit = mixColor(plate, '#b0aacb', 0.45);
  const deep = mixColor(plate, '#17142a', 0.4);
  // 远侧手臂（巨大，后置层，帧间摆动）
  const farSwing = frame === 0 ? -2.5 : 2.5;
  taper(ctx, c + 14, c - 8 - sway * 0.4, c + 19, c - 1, c + 18, c + 8 + farSwing, 10, 7, deep);
  ellipse(ctx, c + 18, c + 13 + farSwing, 7.5, 6);
  ctx.fillStyle = deep;
  ctx.fill();
  inkStroke(ctx);
  // 双腿石柱（帧间交换前后）+ 膝甲缝线
  const legOff = frame === 0 ? 3.5 : -3.5;
  for (const [lx, off, col] of [[c + 7, -legOff, deep], [c - 7, legOff, plate]] as const) {
    taper(ctx, lx, c + 8, lx + off * 0.5, c + 14, lx + off, c + 21, 11, 8.5, col);
    ctx.beginPath();
    ctx.moveTo(lx + off - 5, c + 23.5); ctx.lineTo(lx + off + 5, c + 23.5);
    ctx.lineTo(lx + off + 4, c + 19); ctx.lineTo(lx + off - 4, c + 19);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
    inkStroke(ctx);
    ctx.beginPath();
    ctx.moveTo(lx + off - 3.5, c + 14.5); ctx.quadraticCurveTo(lx + off, c + 16, lx + off + 3.5, c + 14.5);
    structStroke(ctx);
  }
  // 躯干主甲（微倾）
  ctx.save();
  ctx.translate(c, c - 2);
  ctx.rotate(sway * 0.018);
  ctx.beginPath();
  ctx.moveTo(-14, -13); ctx.quadraticCurveTo(0, -18, 14, -13);
  ctx.quadraticCurveTo(18, 0, 13, 12); ctx.quadraticCurveTo(0, 16, -13, 12);
  ctx.quadraticCurveTo(-18, 0, -14, -13);
  ctx.closePath();
  ctx.fillStyle = plate;
  ctx.fill();
  // 赛璐璐受光胸甲面
  ctx.beginPath();
  ctx.moveTo(-13, -12); ctx.quadraticCurveTo(-2, -16.5, 8, -13.5);
  ctx.quadraticCurveTo(2, -9, -6, -6); ctx.quadraticCurveTo(-13, -4, -14.5, -8);
  ctx.closePath();
  ctx.fillStyle = withAlpha(lit, 0.5);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-14, -13); ctx.quadraticCurveTo(0, -18, 14, -13);
  ctx.quadraticCurveTo(18, 0, 13, 12); ctx.quadraticCurveTo(0, 16, -13, 12);
  ctx.quadraticCurveTo(-18, 0, -14, -13);
  ctx.closePath();
  inkStroke(ctx);
  // 板甲缝线（胸/腹两道）+ 中央纵缝
  ctx.beginPath();
  ctx.moveTo(-14.5, -3); ctx.quadraticCurveTo(0, 0.5, 14.5, -3);
  ctx.moveTo(-12.5, 7); ctx.quadraticCurveTo(0, 10.5, 12.5, 7);
  structStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(4, -16); ctx.quadraticCurveTo(5.5, -6, 4.5, 14);
  detailStroke(ctx);
  // 铆钉（沿缝线双排）
  for (const [rx, ry] of [[-11, -5], [-5.5, -3.2], [6, -3.4], [11, -5.2], [-9.5, 8.4], [-3, 9.8], [4, 9.6], [9.5, 8.2]] as const) {
    ellipse(ctx, rx, ry, 1, 1);
    detailStroke(ctx);
    ctx.beginPath();
    ctx.arc(rx - 0.3, ry - 0.3, 0.35, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(lit, 0.8);
    ctx.fill();
  }
  // 苔藓裂纹（青苔色细裂线）
  ctx.beginPath();
  ctx.moveTo(9, -11); ctx.lineTo(11, -7.5); ctx.lineTo(9.5, -5);
  ctx.moveTo(11, -7.5); ctx.lineTo(13.5, -6.5);
  ctx.moveTo(-11, 9); ctx.lineTo(-8.5, 11.5); ctx.moveTo(-10, 10.5); ctx.lineTo(-12.5, 12);
  ctx.strokeStyle = withAlpha('#84cc16', 0.55);
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.fillStyle = withAlpha('#84cc16', 0.4);
  ellipse(ctx, 10.5, -9, 2.6, 1.5, 0.5);
  ctx.fill();
  ellipse(ctx, -10, 10.5, 2.2, 1.3, -0.4);
  ctx.fill();
  // 甲隙炉心（缝隙间橙红辉光，三层叠加 + 十字光丝）
  ctx.fillStyle = withAlpha('#f87171', 0.25);
  ellipse(ctx, -1, 2.5, 6.5, 5.2);
  ctx.fill();
  ctx.fillStyle = withAlpha('#fb923c', 0.6);
  ellipse(ctx, -1, 2.5, 3.8, 3);
  ctx.fill();
  ctx.fillStyle = withAlpha('#fde047', 0.9);
  ellipse(ctx, -1.2, 2.3, 1.7, 1.4);
  ctx.fill();
  taper(ctx, -6.5, 2.5, -1, 2, 4.5, 2.5, 1, 0.1, withAlpha('#fca5a5', 0.7));
  taper(ctx, -1, -1.5, -1.2, 2.5, -1, 6.5, 0.9, 0.1, withAlpha('#fca5a5', 0.6));
  ctx.restore();
  // 巨型肩甲（近侧受光 / 远侧背光）+ 边缘结构线
  for (const [sx, sy, col, flip] of [[c + 15, c - 12 - sway * 0.4, deep, 1], [c - 15, c - 12 + sway * 0.4, lit, -1]] as const) {
    ctx.beginPath();
    ctx.moveTo(sx - 9 * flip, sy + 5); ctx.quadraticCurveTo(sx - 10 * flip, sy - 6, sx, sy - 8);
    ctx.quadraticCurveTo(sx + 9 * flip, sy - 6, sx + 8 * flip, sy + 5);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
    inkStroke(ctx);
    ctx.beginPath();
    ctx.moveTo(sx - 7 * flip, sy + 2.5); ctx.quadraticCurveTo(sx, sy + 0.5, sx + 6.5 * flip, sy + 2.5);
    structStroke(ctx);
    ellipse(ctx, sx, sy - 3.5, 1, 1);
    detailStroke(ctx);
  }
  // 凹陷头盔（朝左）：穹顶 + 独目赤光缝 + 眉压线
  const hy = c - 16 + sway * 0.3;
  ctx.beginPath();
  ctx.moveTo(c - 10, hy + 3); ctx.quadraticCurveTo(c - 9, hy - 5.5, c - 2, hy - 6);
  ctx.quadraticCurveTo(c + 6, hy - 5.5, c + 7, hy + 3);
  ctx.closePath();
  ctx.fillStyle = deep;
  ctx.fill();
  inkStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(c - 8.5, hy - 1.5); ctx.quadraticCurveTo(c - 1.5, hy - 3.5, c + 5.5, hy - 1.5);
  structStroke(ctx);
  taper(ctx, c - 8, hy + 0.5, c - 5, hy - 0.5, c - 1.5, hy + 0.3, 2.4, 1, withAlpha('#f87171', 0.95));
  ctx.fillStyle = withAlpha('#fca5a5', 0.35);
  ellipse(ctx, c - 4.8, hy + 0.2, 4.2, 2);
  ctx.fill();
  // 冷色轮廓光（头盔与近肩受光缘）
  taper(ctx, c - 9.5, hy + 1, c - 8, hy - 4.5, c - 2.5, hy - 5.8, 1.2, 0.2, RIM);
  taper(ctx, c - 23, c - 9 + sway * 0.4, c - 21, c - 17 + sway * 0.4, c - 14, c - 19 + sway * 0.4, 1.3, 0.2, RIM);
  // 近侧手臂（拖地巨拳，帧间与远侧反相）+ 指缝线
  taper(ctx, c - 14, c - 8 + sway * 0.4, c - 19, c - 1, c - 18, c + 9 - farSwing, 10, 7.5, plate);
  ellipse(ctx, c - 19, c + 15 - farSwing, 8, 6.5);
  ctx.fillStyle = lit;
  ctx.fill();
  inkStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(c - 23, c + 13 - farSwing); ctx.lineTo(c - 24.5, c + 18 - farSwing);
  ctx.moveTo(c - 19, c + 14.5 - farSwing); ctx.lineTo(c - 20, c + 19.5 - farSwing);
  structStroke(ctx);
}

// ── 3 puppet 咒盾傀儡（60）— 木纹关节销 · 提线十字架 · 摇曳符文环 ──
function paintPuppet(ctx: CanvasRenderingContext2D, frame: 0 | 1): void {
  const c = 30;
  const float = frame === 0 ? -1.6 : 1.6;
  const wood = '#7c5a48';
  const woodLit = mixColor(wood, '#d6b08c', 0.42);
  const woodDeep = mixColor(wood, '#2e1d14', 0.4);
  // 符文护盾环（手绘颤笔圆 + 12 处符纹刻度，帧间旋转）
  const spin = frame === 0 ? 0 : 0.26;
  ctx.beginPath();
  for (let i = 0; i <= 44; i += 1) {
    const a = (Math.PI * 2 * i) / 44 + spin;
    const r = 22.5 + Math.sin(a * 7 + 1.3) * 1.1;
    const px = c + Math.cos(a) * r;
    const py = c + 1 + float * 0.4 + Math.sin(a) * (r * 1.04);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.strokeStyle = withAlpha('#d946ef', 0.5);
  ctx.lineWidth = 1.1;
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 12; i += 1) {
    const a = (Math.PI * 2 * i) / 12 + spin;
    const len = i % 3 === 0 ? 3.4 : 1.8;
    const px = c + Math.cos(a) * 22.5;
    const py = c + 1 + float * 0.4 + Math.sin(a) * 23.4;
    ctx.moveTo(px - Math.cos(a) * len, py - Math.sin(a) * len);
    ctx.lineTo(px + Math.cos(a) * len * 0.4, py + Math.sin(a) * len * 0.4);
  }
  ctx.strokeStyle = withAlpha('#f0abfc', 0.7);
  ctx.lineWidth = 0.7;
  ctx.stroke();
  // 提线十字架（上方横木 + 中销）与 4 根细提线
  ctx.beginPath();
  ctx.moveTo(c - 12, 4 - float * 0.5); ctx.lineTo(c + 12, 4 + float * 0.5);
  ctx.moveTo(c, 1); ctx.lineTo(c, 7);
  inkStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(c - 12, 4 - float * 0.5); ctx.quadraticCurveTo(c - 13 + float, 11, c - 9, c - 14 + float);
  ctx.moveTo(c + 12, 4 + float * 0.5); ctx.quadraticCurveTo(c + 13 - float, 11, c + 9, c - 14 + float);
  ctx.moveTo(c - 4, 4); ctx.quadraticCurveTo(c - 5 + float * 1.5, 10, c - 12, c + 6 + float);
  ctx.moveTo(c + 4, 4); ctx.quadraticCurveTo(c + 5 - float * 1.5, 10, c + 12, c + 6 - float);
  ctx.strokeStyle = withAlpha('#e9d5ff', 0.75);
  ctx.lineWidth = 0.6;
  ctx.stroke();
  // 悬垂细腿（球关节 + 木段，随浮动摆）
  for (const [lx, kick] of [[c - 5, -float], [c + 5, float]] as const) {
    taper(ctx, lx, c + 10 + float, lx + kick, c + 15 + float, lx + kick * 1.6, c + 19 + float, 3, 2, woodDeep);
    ellipse(ctx, lx + kick * 1.6, c + 20.5 + float, 1.6, 1.6);
    ctx.fillStyle = woodDeep;
    ctx.fill();
    structStroke(ctx);
    ctx.beginPath();
    ctx.moveTo(lx + kick * 1.6 - 2.2, c + 23 + float); ctx.lineTo(lx + kick * 1.6 + 2.2, c + 23 + float);
    inkStroke(ctx);
  }
  ctx.save();
  ctx.translate(c, c + float);
  ctx.rotate(float * 0.025);
  // 木质躯干 + 纵向木纹 + 中央咒钉
  ctx.beginPath();
  ctx.moveTo(-8, -3); ctx.quadraticCurveTo(-10, 4, -7, 10);
  ctx.quadraticCurveTo(0, 13, 7, 10); ctx.quadraticCurveTo(10, 4, 8, -3);
  ctx.closePath();
  ctx.fillStyle = wood;
  ctx.fill();
  inkStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(-4, -2); ctx.quadraticCurveTo(-5, 4, -3.5, 10.5);
  ctx.moveTo(3.5, -2); ctx.quadraticCurveTo(4.5, 4, 3, 10.5);
  detailStroke(ctx);
  ellipse(ctx, 0, 4, 1.3, 1.3);
  ctx.fillStyle = withAlpha('#d946ef', 0.85);
  ctx.fill();
  detailStroke(ctx);
  // 细臂（球肘关节 + 手板，随浮动反摆）
  for (const [dir, swing] of [[-1, float], [1, -float]] as const) {
    taper(ctx, dir * 8, 0, dir * 12, 4 + swing, dir * 12.5, 8 + swing, 2.8, 1.8, woodDeep);
    ellipse(ctx, dir * 12.5, 9.5 + swing, 1.5, 1.5);
    ctx.fillStyle = woodDeep;
    ctx.fill();
    structStroke(ctx);
    ellipse(ctx, dir * 12.8, 12.5 + swing, 2, 2.6);
    ctx.fillStyle = wood;
    ctx.fill();
    inkStroke(ctx);
  }
  // 肩/髋关节销（圆销 + 中心点）
  for (const [jx, jy] of [[-7.5, -1.5], [7.5, -1.5], [-5, 10], [5, 10]] as const) {
    ellipse(ctx, jx, jy, 1.9, 1.9);
    ctx.fillStyle = woodLit;
    ctx.fill();
    structStroke(ctx);
    ctx.beginPath();
    ctx.arc(jx, jy, 0.4, 0, Math.PI * 2);
    ctx.fillStyle = '#231a30';
    ctx.fill();
  }
  // 大木头（朝左）：球头 + 年轮木纹 + 额裂
  ellipse(ctx, -1, -11, 10.5, 9.5);
  ctx.fillStyle = wood;
  ctx.fill();
  ellipse(ctx, -4, -13.5, 5.5, 4);
  ctx.fillStyle = withAlpha(woodLit, 0.55);
  ctx.fill();
  ellipse(ctx, -1, -11, 10.5, 9.5);
  inkStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(-9, -16); ctx.quadraticCurveTo(-1, -18.5, 7, -15.5);
  ctx.moveTo(-10.5, -12.5); ctx.quadraticCurveTo(-9, -10, -10.2, -7.5);
  structStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(5.5, -17.5); ctx.quadraticCurveTo(8.5, -12, 7, -6.5);
  ctx.moveTo(1, -19.4); ctx.lineTo(0.4, -16.6); ctx.lineTo(2, -14.8);
  detailStroke(ctx);
  // 诡异钮扣眼 + 缝线笑
  for (const ex of [-6, 1.5] as const) {
    ellipse(ctx, ex, -12, 2.3, 2.3);
    ctx.fillStyle = '#231a30';
    ctx.fill();
    structStroke(ctx);
    ctx.beginPath();
    ctx.arc(ex - 0.7, -12.7, 0.7, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha('#f0abfc', 0.95);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(ex - 1, -12); ctx.lineTo(ex + 1, -12);
    ctx.moveTo(ex, -13); ctx.lineTo(ex, -11);
    detailStroke(ctx);
  }
  ctx.beginPath();
  ctx.moveTo(-8.5, -6); ctx.quadraticCurveTo(-2.5, -3, 3.5, -6);
  structStroke(ctx);
  ctx.beginPath();
  for (let i = 0; i < 4; i += 1) {
    const sx = -7 + i * 3.3;
    const sy = -5 + Math.sin((i + 0.5) * 1.1) * 0.5;
    ctx.moveTo(sx, sy - 1.7);
    ctx.lineTo(sx + 0.9, sy + 1.5);
  }
  detailStroke(ctx);
  // 冷色轮廓光（头顶左缘）
  taper(ctx, -9.5, -15.5, -5, -19.3, 1, -19.8, 1.2, 0.2, RIM);
  ctx.restore();
}

// ── 4 boss 深渊魔王（110）— 岩浆脉络 · 棱脊巨角 · 七裂披风 · 晶面王冠 ──
/** 岩浆脉络：宽淡光晕 + 亮芯锥线，双层叠加。 */
function magmaVein(ctx: CanvasRenderingContext2D, x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, w: number): void {
  taper(ctx, x0, y0, cx, cy, x1, y1, w * 2.8, 0.6, withAlpha('#fb923c', 0.28));
  taper(ctx, x0, y0, cx, cy, x1, y1, w, 0.25, withAlpha('#f87171', 0.9));
}

function paintBoss(ctx: CanvasRenderingContext2D, frame: 0 | 1): void {
  const c = 55;
  const sway = frame === 0 ? -2 : 2;
  const body = '#4c1d95';
  const lit = mixColor(body, '#a78bfa', 0.42);
  const deep = mixColor(body, '#150a28', 0.45);
  const cape = '#2a1245';
  // 七裂破烂披风（背后，随步伐摆；撕裂缘 7 个尖齿帧间起伏）
  ctx.beginPath();
  ctx.moveTo(c + 4, c - 28 + sway * 0.4);
  ctx.quadraticCurveTo(c + 34 - sway, c - 14, c + 39 - sway, c + 20);
  ctx.lineTo(c + 33, c + 14 + sway); ctx.lineTo(c + 30, c + 26 - sway);
  ctx.lineTo(c + 25, c + 17 + sway); ctx.lineTo(c + 21, c + 28 - sway);
  ctx.lineTo(c + 17, c + 18 + sway); ctx.lineTo(c + 13, c + 26 - sway);
  ctx.quadraticCurveTo(c + 10, c + 2, c + 4, c - 28 + sway * 0.4);
  ctx.closePath();
  ctx.fillStyle = cape;
  ctx.fill();
  inkStroke(ctx);
  // 披风褶皱结构线 + 撕裂缘细纹
  ctx.beginPath();
  ctx.moveTo(c + 12, c - 22 + sway * 0.4); ctx.quadraticCurveTo(c + 20 - sway, c - 4, c + 20, c + 16 + sway);
  ctx.moveTo(c + 20, c - 18 + sway * 0.4); ctx.quadraticCurveTo(c + 28 - sway, c - 2, c + 29, c + 14 + sway);
  structStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(c + 31, c + 18 + sway); ctx.lineTo(c + 28, c + 21);
  ctx.moveTo(c + 23, c + 20 + sway); ctx.lineTo(c + 20, c + 23);
  detailStroke(ctx);
  // 粗壮双腿（帧间交换前后）+ 趾爪
  const legOff = frame === 0 ? 5 : -5;
  for (const [lx, off, col] of [[c + 11, -legOff, deep], [c - 11, legOff, body]] as const) {
    taper(ctx, lx, c + 16, lx + off * 0.5, c + 26, lx + off, c + 37, 15, 11, col);
    ellipse(ctx, lx + off - 2, c + 41, 8.5, 4.5);
    ctx.fillStyle = col;
    ctx.fill();
    inkStroke(ctx);
    for (const t of [-5.5, -1, 3.5] as const) {
      poly(ctx, [lx + off + t - 1.6, c + 40.5, lx + off + t, c + 44.5, lx + off + t + 1.6, c + 40.5]);
      ctx.fillStyle = '#e8d9c0';
      ctx.fill();
      structStroke(ctx);
    }
    ctx.beginPath();
    ctx.moveTo(lx + off - 6, c + 30); ctx.quadraticCurveTo(lx + off, c + 32, lx + off + 6, c + 30);
    structStroke(ctx);
  }
  // 远侧手臂（高举利爪）
  taper(ctx, c + 20, c - 12 - sway, c + 29, c - 4, c + 28, c + 10 - sway, 13, 9, deep);
  ellipse(ctx, c + 28, c + 15 - sway, 8, 6.5);
  ctx.fillStyle = deep;
  ctx.fill();
  inkStroke(ctx);
  // 魁梧躯干（微倾）
  ctx.save();
  ctx.translate(c, c + 2);
  ctx.rotate(sway * 0.012);
  ctx.beginPath();
  ctx.moveTo(-22, -24); ctx.quadraticCurveTo(0, -32, 22, -24);
  ctx.quadraticCurveTo(28, -2, 20, 20); ctx.quadraticCurveTo(0, 27, -20, 20);
  ctx.quadraticCurveTo(-28, -2, -22, -24);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();
  // 赛璐璐受光胸面
  ctx.beginPath();
  ctx.moveTo(-20, -22); ctx.quadraticCurveTo(-4, -28, 10, -24);
  ctx.quadraticCurveTo(0, -16, -10, -12); ctx.quadraticCurveTo(-19, -9, -22.5, -14);
  ctx.closePath();
  ctx.fillStyle = withAlpha(lit, 0.45);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-22, -24); ctx.quadraticCurveTo(0, -32, 22, -24);
  ctx.quadraticCurveTo(28, -2, 20, 20); ctx.quadraticCurveTo(0, 27, -20, 20);
  ctx.quadraticCurveTo(-28, -2, -22, -24);
  ctx.closePath();
  inkStroke(ctx);
  // 胸肌/腹肌结构线
  ctx.beginPath();
  ctx.moveTo(-16, -12); ctx.quadraticCurveTo(-6, -8, -1, -12);
  ctx.moveTo(1, -12); ctx.quadraticCurveTo(8, -8, 16, -12);
  ctx.moveTo(-8, 2); ctx.quadraticCurveTo(0, 5, 8, 2);
  ctx.moveTo(-7, 10); ctx.quadraticCurveTo(0, 13, 7, 10);
  structStroke(ctx);
  // 岩浆脉络网（主干 + 四条分叉）与炉心辉光
  ctx.fillStyle = withAlpha('#fb923c', 0.22);
  ellipse(ctx, -2, -3, 13, 15);
  ctx.fill();
  magmaVein(ctx, -3, -23, -8, -10, -2, 0, 2);
  magmaVein(ctx, -2, 0, 2, 8, -2, 18, 1.7);
  magmaVein(ctx, -2, -8, 5, -6, 11, -2, 1.3);
  magmaVein(ctx, -2, -2, -9, 1, -14, 8, 1.2);
  magmaVein(ctx, -1, 5, 5, 9, 9, 14, 1);
  ctx.fillStyle = withAlpha('#fde047', 0.85);
  ellipse(ctx, -2.5, -2, 3.4, 4.2);
  ctx.fill();
  ctx.restore();
  // 头部（朝左）+ 双侧棱脊巨角
  const hy = c - 30 + sway * 0.3;
  ctx.beginPath();
  ctx.moveTo(c - 9, hy - 5);
  ctx.quadraticCurveTo(c - 24, hy - 16, c - 31, hy - 31);
  ctx.quadraticCurveTo(c - 19, hy - 25, c - 3, hy - 12);
  ctx.closePath();
  ctx.fillStyle = '#e8d9c0';
  ctx.fill();
  inkStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(c - 13, hy - 10); ctx.quadraticCurveTo(c - 17, hy - 15, c - 19, hy - 20);
  ctx.moveTo(c - 17, hy - 11); ctx.quadraticCurveTo(c - 21, hy - 16, c - 24, hy - 22);
  ctx.moveTo(c - 21, hy - 13); ctx.quadraticCurveTo(c - 25, hy - 19, c - 28, hy - 26);
  structStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(c + 7, hy - 6);
  ctx.quadraticCurveTo(c + 21, hy - 17, c + 26, hy - 30);
  ctx.quadraticCurveTo(c + 15, hy - 22, c + 2, hy - 12);
  ctx.closePath();
  ctx.fillStyle = mixColor('#e8d9c0', '#8a7a5c', 0.35);
  ctx.fill();
  inkStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(c + 12, hy - 11); ctx.quadraticCurveTo(c + 16, hy - 16, c + 19, hy - 22);
  ctx.moveTo(c + 16, hy - 13); ctx.quadraticCurveTo(c + 20, hy - 19, c + 23, hy - 26);
  structStroke(ctx);
  // 脸面
  ellipse(ctx, c - 2, hy, 15.5, 13.5);
  ctx.fillStyle = lit;
  ctx.fill();
  ellipse(ctx, c - 7, hy - 5, 8, 5.5, -0.3);
  ctx.fillStyle = withAlpha(mixColor(lit, '#e9d5ff', 0.5), 0.5);
  ctx.fill();
  ellipse(ctx, c - 2, hy, 15.5, 13.5);
  inkStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(c - 13, hy + 4); ctx.quadraticCurveTo(c - 10, hy + 2.5, c - 8, hy + 4.5);
  ctx.moveTo(c + 4, hy + 4.5); ctx.quadraticCurveTo(c + 7, hy + 3, c + 9, hy + 5);
  detailStroke(ctx);
  // 狰狞面孔：怒目 ×2 + 咧嘴獠牙
  fierceEye(ctx, c - 9, hy - 2, 3.7, 2.1);
  fierceEye(ctx, c + 3, hy - 2, 3.7, -2.1);
  ctx.beginPath();
  ctx.moveTo(c - 13, hy + 6);
  ctx.quadraticCurveTo(c - 4, hy + 12, c + 6, hy + 5.5);
  inkStroke(ctx);
  for (const [tx, dir] of [[c - 10.5, 1], [c - 6, 1], [c - 1, 1], [c + 3.5, 1], [c - 8.5, -1], [c - 3.5, -1]] as const) {
    const ty = hy + 7.2 + (dir === 1 ? 0 : 2.6) - Math.abs(tx - (c - 4)) * 0.22;
    poly(ctx, [tx - 1.4, ty, tx + 1.4, ty, tx, ty + dir * 3]);
    ctx.fillStyle = '#f5ecdd';
    ctx.fill();
    detailStroke(ctx);
  }
  // 晶面王冠（悬浮，帧间上下）：五尖 + 晶面线 + 宝石
  const cy2 = hy - 24 + (frame === 0 ? 0 : -2.4);
  poly(ctx, [c - 10, cy2, c - 10, cy2 - 8, c - 5.5, cy2 - 3, c - 2, cy2 - 9.5, c + 1.5, cy2 - 3, c + 6, cy2 - 8, c + 6, cy2]);
  ctx.fillStyle = '#fbbf24';
  ctx.fill();
  ctx.strokeStyle = withAlpha('#92400e', 0.85);
  ctx.lineWidth = 1.1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(c - 10, cy2 - 2); ctx.lineTo(c + 6, cy2 - 2);
  ctx.moveTo(c - 5.5, cy2 - 3); ctx.lineTo(c - 5.5, cy2);
  ctx.moveTo(c + 1.5, cy2 - 3); ctx.lineTo(c + 1.5, cy2);
  detailStroke(ctx);
  ellipse(ctx, c - 2, cy2 - 0.8, 1.4, 1.4);
  ctx.fillStyle = '#f87171';
  ctx.fill();
  detailStroke(ctx);
  // 冷色轮廓光（近侧角脊 + 头顶）
  taper(ctx, c - 12, hy - 8, c - 22, hy - 17, c - 30, hy - 30, 1.6, 0.2, RIM);
  taper(ctx, c - 15, hy - 3, c - 10, hy - 12, c - 1, hy - 13.2, 1.4, 0.2, RIM);
  // 近侧手臂（巨爪拖行，帧间前后）+ 三趾利爪
  const armSwing = frame === 0 ? 3.5 : -3.5;
  taper(ctx, c - 19, c - 12 + sway * 0.4, c - 28, c - 2, c - 27, c + 14 + armSwing, 14, 10, body);
  ctx.beginPath();
  ctx.moveTo(c - 24, c - 4 + sway * 0.4); ctx.quadraticCurveTo(c - 27, c + 4, c - 26, c + 10 + armSwing);
  structStroke(ctx);
  ellipse(ctx, c - 29, c + 20 + armSwing, 9, 7);
  ctx.fillStyle = deep;
  ctx.fill();
  inkStroke(ctx);
  for (const [nx, ny] of [[c - 36, c + 20], [c - 33, c + 25], [c - 27, c + 27]] as const) {
    taper(ctx, nx + 3, ny + armSwing - 2, nx + 1, ny + armSwing, nx - 2, ny + armSwing + 3, 3, 0.3, '#e8d9c0');
  }
}

// ── 5 coin 幸运金币怪（52）— 币缘滚花 · 星芒闪光 · 羽线小翼 ──
function paintCoin(ctx: CanvasRenderingContext2D, frame: 0 | 1): void {
  const c = 26;
  const squish = frame === 0 ? 0 : 1.2;
  const gold = '#f59e0b';
  const goldLit = mixColor(gold, '#fef3c7', 0.55);
  const goldDeep = mixColor(gold, '#92400e', 0.4);
  // 小天使翼（帧间上下扑，羽线 4 根/翼）
  const flap = frame === 0 ? -4 : 2.5;
  for (const side of [1, -1] as const) {
    ctx.beginPath();
    ctx.moveTo(c + side * 11, c - 2);
    ctx.quadraticCurveTo(c + side * 21, c - 11 + flap, c + side * 24.5, c - 3 + flap);
    ctx.quadraticCurveTo(c + side * 20, c + flap * 0.4, c + side * 15, c + 1.5);
    ctx.quadraticCurveTo(c + side * 13, c + 2.5, c + side * 11, c + 1.5);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fill();
    inkStroke(ctx);
    ctx.beginPath();
    for (let i = 0; i < 4; i += 1) {
      const t = 0.25 + i * 0.2;
      ctx.moveTo(c + side * (11 + t * 3), c - 1 + t * 1.5);
      ctx.quadraticCurveTo(
        c + side * (13 + t * 8), c - 5 + flap * t,
        c + side * (14 + t * 10.5), c - 3.5 + flap * (t + 0.15),
      );
    }
    detailStroke(ctx);
  }
  // 金币本体（微压扁弹跳）：平涂 + 受光月牙
  ellipse(ctx, c, c + squish, 14, 13 - squish);
  ctx.fillStyle = gold;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(c - 11, c - 6 + squish);
  ctx.quadraticCurveTo(c - 2, c - 13 + squish, c + 8, c - 8.5 + squish);
  ctx.quadraticCurveTo(c - 1, c - 9.5 + squish, c - 9, c - 3.5 + squish);
  ctx.closePath();
  ctx.fillStyle = withAlpha(goldLit, 0.65);
  ctx.fill();
  ctx.fillStyle = withAlpha(goldDeep, 0.35);
  ellipse(ctx, c, c + 8.5 + squish * 0.5, 8.5, 3);
  ctx.fill();
  ellipse(ctx, c, c + squish, 14, 13 - squish);
  inkStroke(ctx);
  // 币缘滚花（24 齿放射刻线）+ 内圈压印环
  ctx.beginPath();
  for (let i = 0; i < 24; i += 1) {
    const a = (Math.PI * 2 * i) / 24 + (frame === 0 ? 0 : 0.13);
    const ry = (13 - squish) / 14;
    ctx.moveTo(c + Math.cos(a) * 13.4, c + squish + Math.sin(a) * 13.4 * ry);
    ctx.lineTo(c + Math.cos(a) * 11.6, c + squish + Math.sin(a) * 11.6 * ry);
  }
  detailStroke(ctx);
  ellipse(ctx, c, c + squish, 10.2, 9.4 - squish * 0.7);
  structStroke(ctx);
  // 右上星形压印（晶面小星）
  ctx.save();
  ctx.translate(c + 6, c - 5 + squish);
  const stamp: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    const a = -Math.PI / 2 + (Math.PI * i) / 5;
    const r = i % 2 === 0 ? 3.6 : 1.6;
    stamp.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  poly(ctx, stamp);
  ctx.fillStyle = withAlpha(goldDeep, 0.8);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, -3.6); ctx.lineTo(0, 3);
  detailStroke(ctx);
  ctx.restore();
  // 幸福眯眯眼 + 张口小笑 + 腮红（朝左）
  ctx.beginPath();
  ctx.moveTo(c - 9.5, c - 1 + squish); ctx.quadraticCurveTo(c - 7.2, c - 4.2 + squish, c - 5, c - 1 + squish);
  ctx.moveTo(c - 2.5, c - 1 + squish); ctx.quadraticCurveTo(c - 0.2, c - 4.2 + squish, c + 2, c - 1 + squish);
  inkStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(c - 6.5, c + 2.5 + squish);
  ctx.quadraticCurveTo(c - 3.8, c + 6 + squish, c - 1, c + 2.5 + squish);
  ctx.closePath();
  ctx.fillStyle = '#7c2d12';
  ctx.fill();
  structStroke(ctx);
  ctx.fillStyle = withAlpha('#fb7185', 0.45);
  ellipse(ctx, c - 11.5, c + 2.5 + squish, 2.2, 1.3);
  ctx.fill();
  ellipse(ctx, c + 4.5, c + 2.5 + squish, 2.2, 1.3);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(c - 12.5, c + 1.9 + squish); ctx.lineTo(c - 10.5, c + 1.9 + squish);
  ctx.moveTo(c + 3.5, c + 1.9 + squish); ctx.lineTo(c + 5.5, c + 1.9 + squish);
  detailStroke(ctx);
  // 星芒闪光十字（帧间换位；长十字 + 45° 短叉）
  const glints = frame === 0 ? [[c - 7, c - 8.5], [c + 10, c + 4]] : [[c + 8, c - 8], [c - 10, c + 5]];
  for (const [gx, gy] of glints) {
    taper(ctx, gx, gy - 3.2, gx, gy - 1, gx, gy + 3.2, 0.4, 1.6, 'rgba(255,255,255,0.95)');
    taper(ctx, gx - 3.2, gy, gx - 1, gy, gx + 3.2, gy, 0.4, 1.6, 'rgba(255,255,255,0.95)');
    ctx.beginPath();
    ctx.moveTo(gx - 1.3, gy - 1.3); ctx.lineTo(gx + 1.3, gy + 1.3);
    ctx.moveTo(gx + 1.3, gy - 1.3); ctx.lineTo(gx - 1.3, gy + 1.3);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }
  // 冷色轮廓光（币顶左缘）
  taper(ctx, c - 12.5, c - 5 + squish, c - 8, c - 11 + squish, c - 1, c - 12.6 + squish, 1.2, 0.2, RIM);
}

// ── 6 drone 飞翼哨兵（56）— 翼膜肋线 · 蒙皮拼缝 · 虹膜环独眼 ──
function paintDrone(ctx: CanvasRenderingContext2D, frame: 0 | 1): void {
  const c = 28;
  const bob = frame === 0 ? -1.2 : 1.2;
  const sky = '#155e75';
  const skyLit = mixColor(sky, '#7dd3fc', 0.5);
  const skyDeep = mixColor(sky, '#082031', 0.45);
  // 双翼（远/近两层，两帧强烈上/下拍差；翼膜 5 根肋线扇形展开）
  const wingA = frame === 0 ? -0.72 : 0.5;
  for (const depth of [1, 0] as const) {
    const side = depth === 1 ? 1 : -1;
    ctx.save();
    ctx.translate(c + side * 5, c - 3 + bob);
    ctx.rotate(side * wingA * (depth === 1 ? 0.78 : 1));
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(side * 10, -13, side * 23, -13.5);
    ctx.quadraticCurveTo(side * 21, -6, side * 14, 0);
    ctx.quadraticCurveTo(side * 7, 3.5, 0, 0);
    ctx.closePath();
    ctx.fillStyle = withAlpha('#bae6fd', depth === 1 ? 0.4 : 0.6);
    ctx.fill();
    inkStroke(ctx);
    // 翼膜肋线（自翼根扇形放射 5 根）
    ctx.beginPath();
    for (let i = 0; i < 5; i += 1) {
      const t = 0.15 + i * 0.18;
      ctx.moveTo(side * 2, -0.5);
      ctx.quadraticCurveTo(
        side * (6 + t * 10), -3 - t * 7,
        side * (10 + t * 13), -2.5 - t * 11.5,
      );
    }
    structStroke(ctx);
    // 翼缘细毛羽
    ctx.beginPath();
    ctx.moveTo(side * 17, -2.5); ctx.lineTo(side * 19.5, -1);
    ctx.moveTo(side * 12, 0.5); ctx.lineTo(side * 13.5, 2.2);
    detailStroke(ctx);
    ctx.restore();
  }
  // 尾鳍（帧间上下压舵）
  const finY = frame === 0 ? -2.5 : 1.5;
  ctx.beginPath();
  ctx.moveTo(c + 9, c + bob);
  ctx.quadraticCurveTo(c + 17, c - 2 + bob + finY, c + 21, c + 2 + bob + finY);
  ctx.quadraticCurveTo(c + 15, c + 5 + bob, c + 9, c + 4 + bob);
  ctx.closePath();
  ctx.fillStyle = skyDeep;
  ctx.fill();
  inkStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(c + 11, c + 1.5 + bob); ctx.lineTo(c + 18, c + 1.5 + bob + finY * 0.6);
  detailStroke(ctx);
  // 流线机身（朝左）：平涂 + 顶部受光带
  ctx.beginPath();
  ctx.moveTo(c - 15, c + 1 + bob);
  ctx.quadraticCurveTo(c - 11, c - 7.5 + bob, c + 2, c - 6.5 + bob);
  ctx.quadraticCurveTo(c + 11, c - 5.5 + bob, c + 11.5, c + 1 + bob);
  ctx.quadraticCurveTo(c + 10, c + 7.5 + bob, c - 2, c + 7.5 + bob);
  ctx.quadraticCurveTo(c - 12.5, c + 7.5 + bob, c - 15, c + 1 + bob);
  ctx.closePath();
  ctx.fillStyle = sky;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(c - 13, c - 2.5 + bob);
  ctx.quadraticCurveTo(c - 6, c - 7.5 + bob, c + 4, c - 5.8 + bob);
  ctx.quadraticCurveTo(c - 3, c - 4 + bob, c - 11, c - 0.5 + bob);
  ctx.closePath();
  ctx.fillStyle = withAlpha(skyLit, 0.55);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(c - 15, c + 1 + bob);
  ctx.quadraticCurveTo(c - 11, c - 7.5 + bob, c + 2, c - 6.5 + bob);
  ctx.quadraticCurveTo(c + 11, c - 5.5 + bob, c + 11.5, c + 1 + bob);
  ctx.quadraticCurveTo(c + 10, c + 7.5 + bob, c - 2, c + 7.5 + bob);
  ctx.quadraticCurveTo(c - 12.5, c + 7.5 + bob, c - 15, c + 1 + bob);
  ctx.closePath();
  inkStroke(ctx);
  // 蒙皮拼缝（座舱缝 + 腹缝）+ 检修口铆点
  ctx.beginPath();
  ctx.moveTo(c - 2, c - 6.6 + bob); ctx.quadraticCurveTo(c - 1, c + bob, c - 2.5, c + 7.4 + bob);
  ctx.moveTo(c + 5, c - 6 + bob); ctx.quadraticCurveTo(c + 6.5, c + bob, c + 5, c + 7 + bob);
  structStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(c - 1, c + 4.5 + bob); ctx.lineTo(c + 4, c + 4.8 + bob);
  detailStroke(ctx);
  for (const [px, py] of [[c + 1.5, c - 5 + bob], [c + 1.5, c + 6 + bob], [c + 8.5, c - 2 + bob]] as const) {
    ctx.beginPath();
    ctx.arc(px, py, 0.5, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha('#082031', 0.55);
    ctx.fill();
  }
  // 传感独眼（朝左）：外环 + 虹膜环刻度 + 裂瞳 + 高光 + 怒眉
  ellipse(ctx, c - 8, c + bob, 5, 5);
  ctx.fillStyle = '#0b2f40';
  ctx.fill();
  inkStroke(ctx);
  ellipse(ctx, c - 8.4, c + bob, 3.4, 3.4);
  ctx.strokeStyle = withAlpha('#7dd3fc', 0.6);
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const a = (Math.PI * 2 * i) / 8 + (frame === 0 ? 0 : 0.2);
    ctx.moveTo(c - 8.4 + Math.cos(a) * 3.4, c + bob + Math.sin(a) * 3.4);
    ctx.lineTo(c - 8.4 + Math.cos(a) * 2.5, c + bob + Math.sin(a) * 2.5);
  }
  detailStroke(ctx);
  ellipse(ctx, c - 8.4, c + bob, 2.4, 2.4);
  ctx.fillStyle = '#fde047';
  ctx.fill();
  ellipse(ctx, c - 8.6, c + 0.2 + bob, 0.9, 1.9);
  ctx.fillStyle = '#231a30';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(c - 9.6, c - 1.2 + bob, 0.8, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fill();
  taper(ctx, c - 13.5, c - 4.5 + bob, c - 9, c - 6.8 + bob, c - 3.5, c - 6.2 + bob, 1.9, 0.4, INK);
  // 腹部信号灯（帧间换色闪烁）
  ctx.fillStyle = frame === 0 ? withAlpha('#fbbf24', 0.95) : withAlpha('#f87171', 0.95);
  ctx.beginPath();
  ctx.arc(c + 2, c + 5.5 + bob, 1.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = frame === 0 ? withAlpha('#fbbf24', 0.3) : withAlpha('#f87171', 0.3);
  ctx.beginPath();
  ctx.arc(c + 2, c + 5.5 + bob, 3, 0, Math.PI * 2);
  ctx.fill();
  // 悬停小爪（帧间前后错动）
  const clawKick = frame === 0 ? 0 : 1.4;
  taper(ctx, c - 5, c + 7 + bob, c - 6, c + 10 + bob, c - 6.5 - clawKick, c + 13 + bob, 2.2, 0.8, skyDeep);
  taper(ctx, c + 4, c + 7 + bob, c + 5, c + 10 + bob, c + 5.5 + clawKick, c + 13 + bob, 2.2, 0.8, skyDeep);
  // 冷色轮廓光（机背受光缘）
  taper(ctx, c - 13.5, c - 2 + bob, c - 7, c - 7.6 + bob, c + 2, c - 7 + bob, 1.2, 0.2, RIM);
}

// ── 7 shooter 荆棘射手（56）— 苔绿兜帽 · 玫瑰瞳光 · 荆棘藤蔓木弩 · 棘刺箭袋 ──
function paintShooter(ctx: CanvasRenderingContext2D, frame: 0 | 1): void {
  const c = 28;
  const bob = frame === 0 ? 0 : 1.2;
  const sway = frame === 0 ? -1.6 : 1.6;
  const cloak = '#4e6141';
  const lit = mixColor(cloak, '#aacb8b', 0.42);
  const deep = mixColor(cloak, '#17210f', 0.45);
  const wood = '#6e4c33';
  const woodDeep = mixColor(wood, '#241203', 0.4);
  const rose = '#d6336c';
  // 棘刺箭袋（背后，随步伐微沉）：三支玫瑰棘刺箭 + 皮革袋身 + 袋口缝线
  const qx = c + 10;
  const qy = c + 2 + bob * 0.6;
  for (const [dx, dy, lean] of [[-2.2, -10.5, -1.4], [1, -12, -0.3], [3.8, -10, 1.2]] as const) {
    ctx.beginPath();
    ctx.moveTo(qx + dx * 0.35, qy - 1);
    ctx.lineTo(qx + dx, qy + dy + 2.4);
    structStroke(ctx);
    poly(ctx, [qx + dx - 1.2, qy + dy + 2.4, qx + dx + 1.2, qy + dy + 2.4, qx + dx + lean, qy + dy - 1.2]);
    ctx.fillStyle = mixColor(rose, '#5c0f2e', 0.35);
    ctx.fill();
    detailStroke(ctx);
  }
  ctx.beginPath();
  ctx.moveTo(qx - 4, qy - 2);
  ctx.quadraticCurveTo(qx - 5, qy + 4, qx - 3, qy + 8.5);
  ctx.quadraticCurveTo(qx + 0.5, qy + 10, qx + 3.5, qy + 8.5);
  ctx.quadraticCurveTo(qx + 6, qy + 3.5, qx + 5, qy - 2.5);
  ctx.quadraticCurveTo(qx + 0.5, qy - 4, qx - 4, qy - 2);
  ctx.closePath();
  ctx.fillStyle = woodDeep;
  ctx.fill();
  inkStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(qx - 3.6, qy - 0.6); ctx.quadraticCurveTo(qx + 0.5, qy - 2.2, qx + 4.6, qy - 1);
  ctx.moveTo(qx - 3.4, qy + 5.5); ctx.quadraticCurveTo(qx + 0.5, qy + 7, qx + 4.2, qy + 5.2);
  structStroke(ctx);
  // 残破飘带（袍摆撕条向右后飘，两帧卷向互换）
  const flutter = frame === 0 ? -2 : 1.6;
  taper(ctx, c + 7, c + 8.5 + bob * 0.4, c + 12, c + 10 + flutter, c + 16.5, c + 8.5 + flutter * 1.8, 2.4, 0.2, withAlpha(deep, 0.9));
  taper(ctx, c + 6, c + 11.5 + bob * 0.4, c + 10.5, c + 13.5 - flutter, c + 14.5, c + 13 - flutter * 1.5, 1.8, 0.15, withAlpha(cloak, 0.75));
  // 步行双靴（袍下露出，前后帧交换迈步）
  const stride = frame === 0 ? 3.4 : -3.4;
  for (const [bx, off, col] of [[c + 3.5, -stride, woodDeep], [c - 3.5, stride, mixColor(wood, '#3a2312', 0.25)]] as const) {
    taper(ctx, bx, c + 12.5, bx + off * 0.5, c + 15.5, bx + off, c + 18, 3.2, 2.1, col);
    ellipse(ctx, bx + off - 1, c + 18.8, 2.7, 1.7);
    ctx.fillStyle = col;
    ctx.fill();
    inkStroke(ctx);
  }
  // 苔绿斗篷袍身（残破下摆尖齿，两帧深浅互换 + 左右摆）
  const tA = frame === 0 ? 3.2 : 1.8;
  const tB = frame === 0 ? 1.8 : 3.2;
  ctx.beginPath();
  ctx.moveTo(c - 9, c - 6 + bob);
  ctx.quadraticCurveTo(c - 13.5, c + 2 + bob, c - 11.5 + sway, c + 13);
  ctx.lineTo(c - 8.5 + sway, c + 13 + tA);
  ctx.lineTo(c - 5.5 + sway * 0.7, c + 12.2);
  ctx.lineTo(c - 2 + sway * 0.4, c + 13.5 + tB);
  ctx.lineTo(c + 1.5, c + 12.4);
  ctx.lineTo(c + 4.5, c + 13 + tA);
  ctx.lineTo(c + 7.5, c + 12);
  ctx.quadraticCurveTo(c + 10.5, c + 4 + bob, c + 8, c - 5 + bob);
  ctx.quadraticCurveTo(c - 0.5, c - 9.5 + bob, c - 9, c - 6 + bob);
  ctx.closePath();
  ctx.fillStyle = cloak;
  ctx.fill();
  // 赛璐璐受光（左肩—左襟）
  ctx.beginPath();
  ctx.moveTo(c - 8.5, c - 5.5 + bob);
  ctx.quadraticCurveTo(c - 12, c + 1 + bob, c - 10.5, c + 8);
  ctx.quadraticCurveTo(c - 7, c + 2.5, c - 5.5, c - 3 + bob);
  ctx.closePath();
  ctx.fillStyle = withAlpha(lit, 0.5);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(c - 9, c - 6 + bob);
  ctx.quadraticCurveTo(c - 13.5, c + 2 + bob, c - 11.5 + sway, c + 13);
  ctx.lineTo(c - 8.5 + sway, c + 13 + tA);
  ctx.lineTo(c - 5.5 + sway * 0.7, c + 12.2);
  ctx.lineTo(c - 2 + sway * 0.4, c + 13.5 + tB);
  ctx.lineTo(c + 1.5, c + 12.4);
  ctx.lineTo(c + 4.5, c + 13 + tA);
  ctx.lineTo(c + 7.5, c + 12);
  ctx.quadraticCurveTo(c + 10.5, c + 4 + bob, c + 8, c - 5 + bob);
  ctx.quadraticCurveTo(c - 0.5, c - 9.5 + bob, c - 9, c - 6 + bob);
  ctx.closePath();
  inkStroke(ctx);
  // 袍褶结构线（随摆向弯）+ 下摆磨损细纹
  ctx.beginPath();
  ctx.moveTo(c - 3.5, c - 6.5 + bob); ctx.quadraticCurveTo(c - 5 + sway * 0.5, c + 3, c - 4 + sway * 0.8, c + 12);
  ctx.moveTo(c + 2.5, c - 6 + bob); ctx.quadraticCurveTo(c + 1.5 - sway * 0.4, c + 3, c + 2.5 - sway * 0.5, c + 12);
  structStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(c - 7.5 + sway, c + 10.8); ctx.lineTo(c - 6.3 + sway, c + 9);
  ctx.moveTo(c + 3.2, c + 11); ctx.lineTo(c + 4.2, c + 9.2);
  detailStroke(ctx);
  // 箭袋背带（左肩斜挎至右髋）+ 木扣
  ctx.beginPath();
  ctx.moveTo(c - 7.8, c - 3 + bob);
  ctx.quadraticCurveTo(c - 1, c + 1.5 + bob * 0.5, c + 7.2, c + 4.5);
  structStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(c - 7.5, c - 1.8 + bob);
  ctx.quadraticCurveTo(c - 1, c + 2.8 + bob * 0.5, c + 7, c + 5.8);
  detailStroke(ctx);
  ellipse(ctx, c - 1.2, c + 0.8 + bob * 0.5, 1.5, 1.2, 0.5);
  ctx.fillStyle = woodDeep;
  ctx.fill();
  detailStroke(ctx);
  // 近侧持弩臂袖（垂向握把）
  taper(ctx, c + 3.5, c - 3 + bob, c + 1.5, c + 0.5, c - 0.5, c + 3 + bob * 0.5, 4.6, 2.6, deep);
  // 兜帽帽尖（后垂小卷，两帧摆动）
  const hy = c - 10 + bob;
  const tipDip = frame === 0 ? 1.4 : -1;
  ctx.beginPath();
  ctx.moveTo(c + 9.5, hy - 1);
  ctx.quadraticCurveTo(c + 15.5, hy + tipDip, c + 14, hy + 5 + tipDip);
  ctx.quadraticCurveTo(c + 11.5, hy + 3, c + 8.5, hy + 2.5);
  ctx.closePath();
  ctx.fillStyle = deep;
  ctx.fill();
  inkStroke(ctx);
  // 兜帽主体（压得很低，帽缘盖到眉线）
  ctx.beginPath();
  ctx.moveTo(c - 11.5, hy + 3.5);
  ctx.quadraticCurveTo(c - 13, hy - 2.5, c - 7.5, hy - 6);
  ctx.quadraticCurveTo(c - 1, hy - 9, c + 5, hy - 6.5);
  ctx.quadraticCurveTo(c + 11, hy - 4, c + 11.5, hy + 0.5);
  ctx.quadraticCurveTo(c + 10, hy + 4.5, c + 5.5, hy + 5.5);
  ctx.quadraticCurveTo(c - 3, hy + 7.5, c - 11.5, hy + 3.5);
  ctx.closePath();
  ctx.fillStyle = cloak;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(c - 10.5, hy - 1);
  ctx.quadraticCurveTo(c - 6, hy - 6.5, c + 1, hy - 7.2);
  ctx.quadraticCurveTo(c - 4, hy - 4.5, c - 8, hy - 1);
  ctx.closePath();
  ctx.fillStyle = withAlpha(lit, 0.55);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(c - 11.5, hy + 3.5);
  ctx.quadraticCurveTo(c - 13, hy - 2.5, c - 7.5, hy - 6);
  ctx.quadraticCurveTo(c - 1, hy - 9, c + 5, hy - 6.5);
  ctx.quadraticCurveTo(c + 11, hy - 4, c + 11.5, hy + 0.5);
  ctx.quadraticCurveTo(c + 10, hy + 4.5, c + 5.5, hy + 5.5);
  ctx.quadraticCurveTo(c - 3, hy + 7.5, c - 11.5, hy + 3.5);
  ctx.closePath();
  inkStroke(ctx);
  // 帽褶结构线 + 帽缘缝补细线
  ctx.beginPath();
  ctx.moveTo(c + 3, hy - 6.2); ctx.quadraticCurveTo(c + 6.5, hy - 2, c + 5.5, hy + 4.5);
  structStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(c - 5, hy + 6.3); ctx.lineTo(c - 4.2, hy + 4.8);
  ctx.moveTo(c - 0.5, hy + 6.6); ctx.lineTo(c + 0.3, hy + 5.1);
  detailStroke(ctx);
  // 面门阴影（帽内漆黑）
  ctx.beginPath();
  ctx.moveTo(c - 10.8, hy + 3.2);
  ctx.quadraticCurveTo(c - 11, hy - 1.5, c - 6.5, hy - 2.8);
  ctx.quadraticCurveTo(c - 2, hy - 3.4, c - 1.2, hy + 1.2);
  ctx.quadraticCurveTo(c - 3.5, hy + 5.8, c - 10.8, hy + 3.2);
  ctx.closePath();
  ctx.fillStyle = '#1c1428';
  ctx.fill();
  structStroke(ctx);
  // 阴影中的深玫瑰瞳光（光晕 + 瞳芯 + 竖裂 + 高光 + 压低眼帘）
  for (const [ex, ey, r, lidK] of [[c - 8.2, hy + 0.8, 1.5, 1], [c - 3.9, hy + 0.4, 1.3, -1]] as const) {
    ctx.fillStyle = withAlpha('#ec4899', 0.3);
    ellipse(ctx, ex, ey, r * 2.1, r * 1.6);
    ctx.fill();
    ctx.fillStyle = rose;
    ellipse(ctx, ex, ey, r, r * 0.85);
    ctx.fill();
    ctx.fillStyle = '#47091f';
    ellipse(ctx, ex, ey + 0.1, r * 0.32, r * 0.7);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex - r * 0.35, ey - r * 0.35, r * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha('#ffd9ec', 0.95);
    ctx.fill();
    taper(ctx, ex - r * 1.5, ey - r * 0.9 + lidK * 0.4, ex, ey - r * 1.5 - lidK * 0.3, ex + r * 1.4, ey - r * 0.8 - lidK * 0.5, 1.4, 0.3, INK);
  }
  // 荆棘藤蔓木弩（斜持胸前，两帧弩身倾角互换）
  const tiltA = frame === 0 ? -0.13 : 0.06;
  ctx.save();
  ctx.translate(c - 2, c + 4.5 + bob * 0.5);
  ctx.rotate(tiltA);
  taper(ctx, 7, 2, -4, 0, -14.5, -2, 4.4, 2.4, wood);
  ellipse(ctx, 7.2, 2, 2, 2.4, -0.3);
  ctx.fillStyle = woodDeep;
  ctx.fill();
  structStroke(ctx);
  ctx.beginPath();
  ctx.moveTo(4, 1.2); ctx.quadraticCurveTo(-4.5, -0.6, -12, -1.6);
  detailStroke(ctx);
  // 双弓臂（上/下有机弯枝）+ 拉满弓弦
  taper(ctx, -12.8, -2.6, -17.5, -7.5, -14, -12, 2.8, 0.7, woodDeep);
  taper(ctx, -12.8, -1.2, -17.5, 3.8, -13.2, 8.2, 2.8, 0.7, woodDeep);
  ctx.beginPath();
  ctx.moveTo(-14, -11.4); ctx.lineTo(3, 0); ctx.lineTo(-13.2, 7.6);
  ctx.strokeStyle = withAlpha('#f5ecdd', 0.8);
  ctx.lineWidth = 0.7;
  ctx.stroke();
  // 上膛荆棘箭（杆 + 玫瑰棘刺头）
  ctx.beginPath();
  ctx.moveTo(3, -2); ctx.lineTo(-13, -3.6);
  structStroke(ctx);
  poly(ctx, [-12.8, -5, -13.4, -2.2, -16.8, -4]);
  ctx.fillStyle = mixColor(rose, '#5c0f2e', 0.25);
  ctx.fill();
  detailStroke(ctx);
  // 缠绕藤蔓（两匝细藤越过弩托）+ 藤上棘刺 + 藤梢小叶
  ctx.beginPath();
  ctx.moveTo(-10.2, -4); ctx.quadraticCurveTo(-8.2, -1, -6.8, 1.6);
  ctx.moveTo(-5.2, -3.4); ctx.quadraticCurveTo(-3.2, -0.6, -1.8, 2);
  ctx.strokeStyle = withAlpha('#4d7c0f', 0.9);
  ctx.lineWidth = 0.9;
  ctx.stroke();
  for (const [px, py, k] of [[-9.4, -2.4, -0.7], [-7.6, 0.4, 0.6], [-4.3, -1.8, -0.6], [-2.6, 0.8, 0.7]] as const) {
    poly(ctx, [px - 0.8, py + 0.5, px + 0.8, py + 0.5, px + k, py - 1.5]);
    ctx.fillStyle = '#3f6212';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(-6.6, 1.8);
  ctx.quadraticCurveTo(-5.2, 3.4, -3.8, 2.6);
  ctx.quadraticCurveTo(-5.2, 1.4, -6.6, 1.8);
  ctx.closePath();
  ctx.fillStyle = withAlpha('#65a30d', 0.9);
  ctx.fill();
  detailStroke(ctx);
  // 扣弦手 + 前托手（苔绿护手）
  ellipse(ctx, 3.4, 0.6, 2.3, 1.9, 0.3);
  ctx.fillStyle = deep;
  ctx.fill();
  inkStroke(ctx);
  ellipse(ctx, -6.2, -0.4, 1.9, 1.6, -0.2);
  ctx.fillStyle = deep;
  ctx.fill();
  inkStroke(ctx);
  ctx.restore();
  // 冷色轮廓光（帽顶左缘 + 左襟）
  taper(ctx, c - 12, hy + 1.5, c - 10, hy - 4.5, c - 3, hy - 7.8, 1.3, 0.2, RIM);
  taper(ctx, c - 11, c + 1 + bob, c - 12.5, c + 6, c - 11.5 + sway, c + 11, 1.1, 0.2, RIM);
}

export const ENEMY_PAINTERS: EnemyPainter[] = [
  paintGrunt,
  paintWolf,
  paintGolem,
  paintPuppet,
  paintBoss,
  paintCoin,
  paintDrone,
  paintShooter,
];
