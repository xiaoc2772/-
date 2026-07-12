// 幸运塔防 程序化美术 · 单位立绘 B 组（config units 9..17）。
// 精密动漫线稿风：三档线宽（INK 剪影 2.0 / STRUCT 结构 1.1 / DETAIL 细节 0.6）
// + 锥形笔锋曲线（主笔+细覆笔）+ 赛璐璐软色打底 + 右上 0.8px 白色边缘光。
// 每个 painter 在 72×80 逻辑框内绘制一名角色：脚底锚点 (36,72)，面朝右，
// 完全确定性绘制（禁止 Math.random / filter / shadowBlur），透明背景，无阴影/血条/文字。
// 调用方：art/characters.ts（离屏缓存后由 draw.ts 渲染）。

import { mixColor, withAlpha, roundRectPath } from './palette';

type CharacterPainter = (ctx: CanvasRenderingContext2D) => void;
type PathFn = (c: CanvasRenderingContext2D) => void;
/** 锥形曲线控制点：[x0, y0, qx, qy, x1, y1]。 */
type Curve = [number, number, number, number, number, number];

const TAU = Math.PI * 2;
const INK = 'rgba(45,32,28,0.88)';
const STRUCT = 'rgba(45,32,28,0.55)';
const DETAIL = 'rgba(45,32,28,0.38)';
const RIM = 'rgba(255,255,255,0.8)';
const SKIN = '#f7dcbc';
const MOUTH = 'rgba(150,80,64,0.85)';

/** 三档笔：0=INK 剪影 2.0px / 1=STRUCT 结构 1.1px / 2=DETAIL 细节 0.6px，描当前路径。 */
function pen(ctx: CanvasRenderingContext2D, tier: 0 | 1 | 2): void {
  ctx.lineWidth = tier === 0 ? 2 : tier === 1 ? 1.1 : 0.6;
  ctx.strokeStyle = tier === 0 ? INK : tier === 1 ? STRUCT : DETAIL;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** 椭圆路径（beginPath）。 */
function ell(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
  ctx.closePath();
}

/** 实心小点。 */
function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ell(ctx, x, y, r, r);
  ctx.fill();
}

/** 锥形笔锋：细笔全程 + 粗笔只走中段，模拟动画起收笔变细。 */
function taper(ctx: CanvasRenderingContext2D, x0: number, y0: number, qx: number, qy: number, x1: number, y1: number, w: number, color: string): void {
  const q = (t: number, a: number, m: number, b: number): number => {
    const u = 1 - t;
    return u * u * a + 2 * u * t * m + t * t * b;
  };
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(qx, qy, x1, y1);
  ctx.lineWidth = Math.max(0.4, w * 0.45);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(q(0.16, x0, qx, x1), q(0.16, y0, qy, y1));
  for (let i = 1; i <= 6; i += 1) {
    const t = 0.16 + (0.68 * i) / 6;
    ctx.lineTo(q(t, x0, qx, x1), q(t, y0, qy, y1));
  }
  ctx.lineWidth = w;
  ctx.stroke();
}

/** 锥形曲线组：发丝 / 衣褶 / 细节纹通用。 */
function curves(ctx: CanvasRenderingContext2D, lines: Curve[], color: string = STRUCT, w = 1): void {
  for (const [x0, y0, qx, qy, x1, y1] of lines) {
    taper(ctx, x0, y0, qx, qy, x1, y1, w, color);
  }
}

/** 铆钉：深色小圆 + 右上受光点。 */
function rivet(ctx: CanvasRenderingContext2D, x: number, y: number, r = 0.9): void {
  dot(ctx, x, y, r, 'rgba(45,32,28,0.72)');
  dot(ctx, x + r * 0.32, y - r * 0.32, r * 0.32, 'rgba(255,255,255,0.8)');
}

/** 右上 0.8px 白色边缘光弧。 */
function rimLight(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, a0 = -1.9, a1 = -0.35): void {
  ctx.strokeStyle = RIM;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, a0, a1);
  ctx.stroke();
}

/** 赛璐璐软填色：填充 path，clip 内叠左下暗部 + 右上受光，再以 INK 勾勒轮廓。 */
function cel(ctx: CanvasRenderingContext2D, path: PathFn, base: string, sx: number, sy: number, sw: number, sh: number): void {
  path(ctx);
  ctx.fillStyle = base;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = withAlpha(mixColor(base, '#241612', 0.5), 0.36);
  ctx.beginPath();
  ctx.ellipse(sx + sw * 0.3, sy + sh * 0.82, sw * 0.6, sh * 0.5, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.beginPath();
  ctx.ellipse(sx + sw * 0.72, sy + sh * 0.16, sw * 0.38, sh * 0.28, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
  path(ctx);
  pen(ctx, 0);
}

/** 手：肤色圆 + INK 勾边 + 边缘光。 */
function hand(ctx: CanvasRenderingContext2D, x: number, y: number, r = 2.7): void {
  ell(ctx, x, y, r, r);
  ctx.fillStyle = SKIN;
  ctx.fill();
  pen(ctx, 0);
  rimLight(ctx, x, y, r - 0.6, r - 0.6, -1.8, -0.5);
}

/** 圆头靴：本体 + 鞋底缝线。 */
function boot(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, color: string): void {
  cel(ctx, (c) => ell(c, x, y, rx, rx * 0.5), color, x - rx, y - rx * 0.5, rx * 2, rx);
  taper(ctx, x - rx * 0.8, y + rx * 0.34, x, y + rx * 0.55, x + rx * 0.85, y + rx * 0.3, 0.6, DETAIL);
}

/** 动漫头部：略尖下巴的脸型 + 赛璐璐颊影 + 右上边缘光。 */
function head(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const p: PathFn = (c) => {
    c.beginPath();
    c.moveTo(cx - r, cy - r * 0.12);
    c.bezierCurveTo(cx - r * 1.04, cy - r * 1.2, cx + r * 1.04, cy - r * 1.2, cx + r, cy - r * 0.12);
    c.bezierCurveTo(cx + r * 0.98, cy + r * 0.58, cx + r * 0.5, cy + r, cx + r * 0.08, cy + r * 1.02);
    c.bezierCurveTo(cx - r * 0.52, cy + r, cx - r * 0.98, cy + r * 0.55, cx - r, cy - r * 0.12);
    c.closePath();
  };
  cel(ctx, p, SKIN, cx - r, cy - r, r * 2, r * 2);
  rimLight(ctx, cx, cy - r * 0.06, r * 0.9, r * 0.92);
}

/** 精描动漫脸（朝右）：杏眼（眼白+虹膜+瞳孔+高光点）、上睑重线、细眉、鼻点、小嘴、腮红。 */
function animeFace(ctx: CanvasRenderingContext2D, cx: number, cy: number, iris: string, browTilt = 0): void {
  for (const ex of [cx + 2.2, cx + 8.2]) {
    ctx.beginPath();
    ctx.moveTo(ex - 2.2, cy + 0.6);
    ctx.quadraticCurveTo(ex - 0.2, cy - 2.4, ex + 2.2, cy + 0.3);
    ctx.quadraticCurveTo(ex + 0.2, cy + 2.6, ex - 2.2, cy + 0.6);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    pen(ctx, 2);
    dot(ctx, ex + 0.5, cy + 0.2, 1.28, iris);
    ell(ctx, ex + 0.5, cy + 0.35, 0.55, 0.85);
    ctx.fillStyle = 'rgba(24,16,14,0.92)';
    ctx.fill();
    dot(ctx, ex + 1.1, cy - 0.5, 0.45, 'rgba(255,255,255,0.95)');
    taper(ctx, ex - 2.3, cy + 0.4, ex - 0.2, cy - 2.6, ex + 2.3, cy + 0.1, 1.3, INK);
    taper(ctx, ex - 2.2, cy - 3.4 + browTilt, ex, cy - 4.5, ex + 2.3, cy - 3.2 - browTilt, 0.9, STRUCT);
  }
  dot(ctx, cx + 5.9, cy + 3.1, 0.45, 'rgba(150,90,70,0.5)');
  taper(ctx, cx + 4, cy + 5, cx + 5.4, cy + 6, cx + 6.9, cy + 4.9, 1, MOUTH);
  dot(ctx, cx - 1.2, cy + 4.2, 1.9, 'rgba(240,140,120,0.3)');
  dot(ctx, cx + 10.5, cy + 4.2, 1.7, 'rgba(240,140,120,0.3)');
}

// ── 9. artillery 轰鸣炮手（#b45309 💥）弓步扛炮的老练炮兵 ──────
function paintArtillery(ctx: CanvasRenderingContext2D): void {
  const base = '#b45309';
  const leather = '#6b4423';
  const brass = '#c9a85c';
  // 后腿蹬地 + 前腿弓步
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(25, 55);
    c.quadraticCurveTo(19, 61, 18.5, 69);
    c.lineTo(26, 69);
    c.quadraticCurveTo(28, 61, 30, 55);
    c.closePath();
  }, mixColor(leather, '#241612', 0.25), 18, 54, 12, 16);
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(36, 55);
    c.quadraticCurveTo(42, 61, 44.5, 69);
    c.lineTo(37, 69);
    c.quadraticCurveTo(34.5, 61, 32, 55);
    c.closePath();
  }, leather, 32, 54, 13, 16);
  boot(ctx, 22, 69.3, 5.4, '#4a3020');
  boot(ctx, 42, 69.3, 5.6, '#54371f');
  // 帆布炮兵短褂：宽壮躯干 + 4 根衣褶 + 下摆缝线
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(23, 38);
    c.bezierCurveTo(19.5, 46, 20, 54, 24, 57.5);
    c.lineTo(41, 57.5);
    c.bezierCurveTo(46, 53, 46.5, 44, 42.5, 37);
    c.closePath();
  }, base, 20, 37, 27, 21);
  curves(ctx, [
    [26, 42, 24.5, 48, 25.5, 55],
    [31, 44, 30.5, 50, 31.5, 56.5],
    [39, 41, 40.5, 47, 39.5, 54],
    [27, 56.4, 32, 54.8, 38, 56.4],
  ]);
  curves(ctx, [[24.5, 52.5, 32, 54.6, 42.5, 51.5]], DETAIL, 0.6);
  // 斜挎弹药带：三发铜弹 + 两端铆钉
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(24, 40.5);
    c.lineTo(43.5, 49);
    c.lineTo(43.5, 53.2);
    c.lineTo(24, 44.5);
    c.closePath();
  }, '#54371f', 24, 40.5, 19.5, 13);
  for (let i = 0; i < 3; i += 1) {
    const bx = 28.5 + i * 5.4;
    const by = 44.2 + i * 2.3;
    ell(ctx, bx, by, 1.5, 2.3, 0.42);
    ctx.fillStyle = '#f2c14e';
    ctx.fill();
    pen(ctx, 1);
    dot(ctx, bx + 0.4, by - 0.8, 0.4, 'rgba(255,255,255,0.85)');
  }
  rivet(ctx, 25.6, 42.4);
  rivet(ctx, 42.2, 51.6);
  // 后臂叉腰
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(23.5, 40);
    c.quadraticCurveTo(17, 44, 19.5, 50);
    c.quadraticCurveTo(22, 52, 24.5, 50);
    c.quadraticCurveTo(22.5, 46, 26, 42);
    c.closePath();
  }, base, 17, 39, 10, 13);
  // 肩扛铜炮：炮身结构线 + 双炮箍铆钉 + 炮口膛线 + 尾栓球
  ctx.save();
  ctx.translate(40, 34);
  ctx.rotate(-0.3);
  cel(ctx, (c) => roundRectPath(c, -14, -5.2, 30, 10.4, 5), '#8a6d3b', -14, -5.2, 30, 10.4);
  curves(ctx, [[-12, -2.6, 1, -3.5, 13, -2.6]], STRUCT, 1);
  curves(ctx, [[-11, 2.8, 1, 3.7, 12, 2.8]], DETAIL, 0.6);
  for (const bxx of [-4, 6]) {
    cel(ctx, (c) => roundRectPath(c, bxx, -5.8, 3.6, 11.6, 1.6), brass, bxx, -5.8, 3.6, 11.6);
    rivet(ctx, bxx + 1.8, -3.6, 0.7);
    rivet(ctx, bxx + 1.8, 3.6, 0.7);
  }
  cel(ctx, (c) => ell(c, 16, 0, 4.4, 5.4), '#5c4632', 11.6, -5.4, 8.8, 10.8);
  ell(ctx, 16.8, 0, 2.3, 3.1);
  ctx.fillStyle = '#241612';
  ctx.fill();
  pen(ctx, 1);
  rimLight(ctx, 16, -0.6, 3.8, 4.6, -1.7, -0.5);
  cel(ctx, (c) => ell(c, -15.5, 0, 2.6, 2.6), brass, -18.1, -2.6, 5.2, 5.2);
  ctx.restore();
  // 尾栓引信 + 八角星火花
  curves(ctx, [[25.5, 36.5, 24, 33, 26.4, 30.6]], STRUCT, 1);
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const a = (TAU * i) / 8;
    const rr = i % 2 === 0 ? 3.2 : 1.3;
    const px = 26.6 + Math.cos(a) * rr;
    const py = 28.6 + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  dot(ctx, 26.6, 28.6, 1.1, '#fff7d6');
  head(ctx, 33, 22, 11);
  // 皮质炮兵帽：帽体缝线 + 帽檐 + 铜徽 + 帽下 5 根发丝
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(21.8, 20.5);
    c.bezierCurveTo(22.5, 8.5, 43.5, 8.5, 44.2, 20.5);
    c.quadraticCurveTo(33, 15.5, 21.8, 20.5);
    c.closePath();
  }, '#7c4a12', 21.8, 9, 22.4, 12);
  cel(ctx, (c) => roundRectPath(c, 20.6, 18.6, 25.4, 4, 2), '#5b3a1e', 20.6, 18.6, 25.4, 4);
  curves(ctx, [
    [24, 13.6, 33, 10.6, 42, 13.6],
    [23, 17, 33, 13.8, 43, 17],
  ], DETAIL, 0.6);
  dot(ctx, 39.5, 16.4, 1.9, brass);
  ell(ctx, 39.5, 16.4, 1.9, 1.9);
  pen(ctx, 1);
  curves(ctx, [
    [22.5, 21.8, 20.6, 25, 21.6, 28.5],
    [24.6, 22.6, 23.2, 26, 24.4, 29.5],
    [43.4, 21.8, 45.4, 24.5, 44.4, 27.5],
    [41.4, 22.6, 42.8, 25.5, 42, 28.4],
    [26.8, 22.8, 26, 25.4, 26.8, 27.6],
  ], '#5a3a1e', 1.1);
  animeFace(ctx, 30, 25, '#5b3a1e');
  // 前臂上举托炮
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(41, 38.5);
    c.quadraticCurveTo(47, 37.5, 48.5, 33.5);
    c.quadraticCurveTo(45.5, 31, 43.5, 33);
    c.quadraticCurveTo(42.5, 35.5, 39.5, 36.8);
    c.closePath();
  }, base, 39.5, 31, 9.5, 8);
  hand(ctx, 47.8, 32.2);
}

// ── 10. frostbinder 霜语术士（#0284c7 ❄️）持晶杖的静谧冰法 ─────
function paintFrostbinder(ctx: CanvasRenderingContext2D): void {
  const base = '#0284c7';
  const hair = '#a8d8ee';
  // 背侧冰晶法杖：杖身高光 + 六棱冰晶切面 + 霜之卷曲
  curves(ctx, [[50.5, 68, 52.5, 44, 53.5, 22]], '#3d6a86', 2.6);
  curves(ctx, [[50.9, 66, 52.7, 44, 53.3, 24]], 'rgba(255,255,255,0.55)', 0.8);
  ctx.fillStyle = withAlpha('#7dd3fc', 0.32);
  ell(ctx, 53.8, 12.8, 9.5, 9.5);
  ctx.fill();
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(53.8, 5.5);
    c.lineTo(59, 9.5);
    c.lineTo(58.4, 16.5);
    c.lineTo(53.8, 20);
    c.lineTo(49.2, 16.5);
    c.lineTo(48.6, 9.5);
    c.closePath();
  }, '#9adcf8', 48.6, 5.5, 10.4, 14.5);
  curves(ctx, [
    [53.8, 6.5, 53.6, 12.5, 53.8, 19],
    [49.6, 10, 53.6, 12.6, 58, 10],
    [50, 16, 53.6, 12.8, 58, 16],
  ], 'rgba(255,255,255,0.75)', 0.7);
  curves(ctx, [
    [47.5, 20.5, 44, 18, 45.5, 15],
    [45.5, 15, 47.6, 14, 47, 16.4],
    [60.2, 19.5, 63.4, 17.2, 62, 14.2],
    [62, 14.2, 60, 13.4, 60.6, 15.6],
  ], 'rgba(224,242,254,0.92)', 0.8);
  // 垂坠长袍：A 字 + 5 根衣褶 + 下摆冰纹与雪点
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(30, 36);
    c.bezierCurveTo(22, 44, 19.5, 58, 21, 70);
    c.lineTo(48, 70);
    c.bezierCurveTo(50, 56, 46.5, 43, 39.5, 36);
    c.closePath();
  }, base, 19.5, 36, 30, 34);
  curves(ctx, [
    [27, 45, 25, 56, 26, 68.5],
    [33, 47, 32, 57, 32.5, 69],
    [40, 46, 42, 56, 41, 68.5],
    [45, 49, 46.5, 58, 45.5, 67],
    [23.5, 52, 22.6, 60, 23.2, 68],
  ]);
  curves(ctx, [[22, 65.5, 35, 62.8, 47.5, 65.5]], 'rgba(224,242,254,0.85)', 1);
  for (let i = 0; i < 4; i += 1) {
    dot(ctx, 25.5 + i * 6.2, 67.8, 1.05, '#e0f2fe');
  }
  // 白毛披肩 + 5 组绒毛细线
  cel(ctx, (c) => ell(c, 35, 37.5, 10.5, 5), '#f0f9ff', 24.5, 32.5, 21, 10);
  curves(ctx, [
    [27, 35.5, 26, 33.6, 27.6, 32.2],
    [31, 34.2, 30.4, 32, 32, 31],
    [35.5, 33.8, 35.5, 31.4, 37, 30.8],
    [40, 34.4, 40.6, 32.2, 42.2, 31.6],
    [44, 36, 45.4, 34.4, 46.6, 34.6],
  ], DETAIL, 0.6);
  head(ctx, 35, 24, 10.8);
  // 淡蓝长发：底色块 + 8 根发丝 + 冰晶发饰
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(24.5, 24);
    c.bezierCurveTo(23.5, 12.5, 46.5, 12.5, 45.5, 24);
    c.quadraticCurveTo(47.5, 32, 45, 40);
    c.quadraticCurveTo(43.5, 32.5, 42, 28.5);
    c.quadraticCurveTo(41, 21.5, 35, 20.5);
    c.quadraticCurveTo(28.5, 21, 27.5, 28);
    c.quadraticCurveTo(26.5, 33, 24.8, 40);
    c.quadraticCurveTo(23, 31, 24.5, 24);
    c.closePath();
  }, hair, 23, 13, 24, 27);
  curves(ctx, [
    [27, 16.5, 25.6, 22, 25.4, 30],
    [29.5, 15, 28.4, 21, 28, 27],
    [33, 14.2, 32.4, 18, 32.6, 21],
    [37.5, 14.2, 38.4, 17.5, 38.6, 20.6],
    [41.5, 15.2, 42.8, 21, 43.2, 27],
    [44.4, 17.5, 45.6, 23, 45.2, 31],
    [25.2, 30, 24.2, 35, 24.8, 39.5],
    [45.2, 31, 46, 35.5, 45.2, 39.5],
  ], mixColor(hair, '#241612', 0.35), 0.9);
  ctx.fillStyle = '#e0f2fe';
  ctx.beginPath();
  ctx.moveTo(27.2, 14.6);
  ctx.lineTo(29.2, 16.6);
  ctx.lineTo(27.2, 18.8);
  ctx.lineTo(25.2, 16.6);
  ctx.closePath();
  ctx.fill();
  pen(ctx, 1);
  animeFace(ctx, 32, 27, '#1f5e80');
  // 前手扶杖 + 指尖冷雾
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(40, 39);
    c.quadraticCurveTo(47, 40.5, 49.5, 44);
    c.quadraticCurveTo(48, 47.5, 44.5, 46.5);
    c.quadraticCurveTo(41.5, 43.5, 38.5, 42.5);
    c.closePath();
  }, base, 38.5, 38.5, 11.5, 9);
  hand(ctx, 51, 45.6, 2.6);
  dot(ctx, 52.5, 38, 2.4, withAlpha('#e0f2fe', 0.5));
  dot(ctx, 54.5, 33, 1.3, withAlpha('#e0f2fe', 0.4));
}

// ── 11. banner 战鼓旗手（#ca8a04 🎺）举旗吹号的行军号手 ────────
function paintBanner(ctx: CanvasRenderingContext2D): void {
  const base = '#ca8a04';
  const red = '#dc4b38';
  const brass = '#f2c14e';
  // 背侧战旗：旗杆 + 铜顶球 + 燕尾旗（3 根波浪褶）+ 太阳纹章
  curves(ctx, [[19, 70, 17.5, 38, 16.5, 6.5]], '#7a5c34', 2.6);
  curves(ctx, [[18.7, 66, 17.4, 38, 16.7, 9]], 'rgba(255,255,255,0.4)', 0.7);
  dot(ctx, 16.4, 5.6, 2.3, brass);
  ell(ctx, 16.4, 5.6, 2.3, 2.3);
  pen(ctx, 1);
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(17.2, 7.6);
    c.bezierCurveTo(27, 4.4, 37, 5.2, 45.5, 8.4);
    c.lineTo(38.5, 13.4);
    c.lineTo(45.5, 19.4);
    c.bezierCurveTo(36, 22.8, 26, 22.4, 17.6, 20.6);
    c.closePath();
  }, red, 17.2, 4.4, 28.3, 18.4);
  curves(ctx, [
    [22, 9, 26.5, 13, 23.5, 19.6],
    [28.5, 7.8, 33, 12.6, 30.5, 20.4],
    [35, 7.6, 39.2, 12.4, 37.5, 19.8],
  ]);
  dot(ctx, 26.5, 13.8, 3.4, '#f8e3a0');
  for (let i = 0; i < 8; i += 1) {
    const a = (TAU * i) / 8;
    taper(ctx, 26.5 + Math.cos(a) * 4, 13.8 + Math.sin(a) * 4, 26.5 + Math.cos(a) * 4.8, 13.8 + Math.sin(a) * 4.8, 26.5 + Math.cos(a) * 5.6, 13.8 + Math.sin(a) * 5.6, 0.6, 'rgba(248,227,160,0.9)');
  }
  // 行军双腿：后腿撑地 / 前腿迈步
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(28, 56);
    c.quadraticCurveTo(24, 62, 24, 69);
    c.lineTo(30.5, 69);
    c.quadraticCurveTo(31.5, 62, 32.5, 56);
    c.closePath();
  }, '#8a6d3b', 23, 55, 10, 15);
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(36, 56);
    c.quadraticCurveTo(41, 61, 43.5, 68.5);
    c.lineTo(36.5, 69);
    c.quadraticCurveTo(35, 62, 33.5, 56);
    c.closePath();
  }, '#9a7a42', 33, 55, 11, 15);
  boot(ctx, 27, 69.4, 5, '#5b3a1e');
  boot(ctx, 41, 68.8, 5.2, '#6b4527');
  // 号手短褂：双排铜扣 + 斜绶带 + 肩章流苏 + 3 根衣褶
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(26, 38.5);
    c.bezierCurveTo(23, 46, 23.5, 53.5, 27, 57);
    c.lineTo(41, 57);
    c.bezierCurveTo(45.5, 52.5, 45.5, 44, 42, 37.5);
    c.closePath();
  }, base, 23, 37.5, 22.5, 20);
  curves(ctx, [
    [27.5, 43, 26.5, 49, 27.5, 55.5],
    [34, 44, 33.6, 50, 34.2, 56.4],
    [40.5, 42, 41.6, 48, 40.6, 54.5],
  ]);
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(27, 40);
    c.lineTo(43, 48);
    c.lineTo(43, 52);
    c.lineTo(27, 44);
    c.closePath();
  }, red, 27, 40, 16, 12);
  rivet(ctx, 30.5, 45.5);
  rivet(ctx, 30.5, 50);
  rivet(ctx, 36.5, 47.5);
  rivet(ctx, 36.5, 52);
  cel(ctx, (c) => roundRectPath(c, 24.4, 37.6, 8, 3.6, 1.6), brass, 24.4, 37.6, 8, 3.6);
  curves(ctx, [
    [25.4, 41.4, 25.2, 43, 25.6, 44.6],
    [27.4, 41.6, 27.2, 43.2, 27.6, 44.8],
    [29.4, 41.6, 29.4, 43, 29.8, 44.4],
    [31.2, 41.2, 31.2, 42.6, 31.6, 44],
  ], '#a87e2a', 0.8);
  head(ctx, 36, 23, 10.8);
  // 高筒军帽：帽体缝线 + 白羽（羽轴+羽枝）+ 颌带 + 帽下发丝
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(26.6, 17.5);
    c.lineTo(28, 4.5);
    c.bezierCurveTo(33, 2.6, 40, 2.6, 44.6, 4.5);
    c.lineTo(45.4, 17.5);
    c.quadraticCurveTo(36, 13.5, 26.6, 17.5);
    c.closePath();
  }, red, 26.6, 2.6, 18.8, 15);
  curves(ctx, [
    [28.4, 7.2, 36, 5, 44.2, 7.2],
    [27.6, 12.4, 36, 9.8, 44.8, 12.4],
  ], DETAIL, 0.6);
  cel(ctx, (c) => roundRectPath(c, 25.6, 15.4, 20.8, 3.6, 1.8), '#a83a28', 25.6, 15.4, 20.8, 3.6);
  dot(ctx, 36.5, 9.8, 2.1, brass);
  ell(ctx, 36.5, 9.8, 2.1, 2.1);
  pen(ctx, 1);
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(28.6, 6);
    c.bezierCurveTo(24.5, 1.5, 24, -0.5, 27.5, 0.6);
    c.bezierCurveTo(30.6, 1.8, 31.6, 4, 31.4, 6.4);
    c.closePath();
  }, '#f8f4e8', 24, -0.5, 8, 7.5);
  taper(ctx, 27, 0.8, 28.4, 3, 29.8, 5.6, 0.7, DETAIL);
  curves(ctx, [
    [27.2, 1.8, 26.4, 2.2, 25.8, 2],
    [28, 3.2, 27, 3.8, 26.4, 3.6],
    [28.8, 4.6, 27.8, 5.2, 27.2, 5.2],
  ], DETAIL, 0.55);
  taper(ctx, 27.2, 20, 33, 25.4, 44.6, 20, 0.8, STRUCT);
  curves(ctx, [
    [27.4, 19.4, 26.2, 22.4, 27, 25.2],
    [29.4, 20.4, 28.4, 23, 29.2, 25.8],
    [44.4, 19.4, 45.8, 22, 45, 24.8],
    [42.4, 20.2, 43.4, 22.6, 42.8, 25.2],
    [32, 20.8, 31.4, 22.6, 32, 24.4],
  ], '#6b4527', 1);
  animeFace(ctx, 33, 26, '#5b4020');
  // 前手举小号：号管 + 喇叭口 + 3 个活塞阀
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(41.5, 39);
    c.quadraticCurveTo(47.5, 39.5, 49.5, 43);
    c.quadraticCurveTo(48, 46.5, 44.5, 45.5);
    c.quadraticCurveTo(42, 42.5, 40, 41.5);
    c.closePath();
  }, base, 40, 38.5, 10, 8);
  ctx.save();
  ctx.translate(50, 42);
  ctx.rotate(-0.85);
  cel(ctx, (c) => roundRectPath(c, -2, -1.6, 13, 3.2, 1.6), brass, -2, -1.6, 13, 3.2);
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(10.5, -1.6);
    c.lineTo(15.5, -5.2);
    c.lineTo(15.5, 5.2);
    c.lineTo(10.5, 1.6);
    c.closePath();
  }, '#f8d878', 10.5, -5.2, 5, 10.4);
  ell(ctx, 15.7, 0, 1.4, 5.2);
  ctx.fillStyle = '#c9962e';
  ctx.fill();
  pen(ctx, 1);
  for (let i = 0; i < 3; i += 1) {
    const vx = 1.6 + i * 2.7;
    cel(ctx, (c) => roundRectPath(c, vx, -5, 1.5, 3.6, 0.7), '#c9962e', vx, -5, 1.5, 3.6);
    rivet(ctx, vx + 0.75, -5.4, 0.6);
  }
  curves(ctx, [[-1, -0.6, 5, -1, 10, -0.6]], 'rgba(255,255,255,0.6)', 0.6);
  ctx.restore();
  hand(ctx, 50.2, 43.4, 2.6);
}

// ── 12. thornwarden 棘盾卫士（#4b5563 🧱）荆棘塔盾后的重装骑士 ──
function paintThornwarden(ctx: CanvasRenderingContext2D): void {
  const base = '#4b5563';
  const steel = '#6b7686';
  const vine = '#7fbf5c';
  // 铁甲双腿：护膝板
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(23, 55);
    c.lineTo(22, 69);
    c.lineTo(29, 69);
    c.lineTo(29.5, 55);
    c.closePath();
  }, mixColor(base, '#241612', 0.25), 22, 55, 8, 14);
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(33, 55);
    c.lineTo(33.5, 69);
    c.lineTo(40.5, 69);
    c.lineTo(39.5, 55);
    c.closePath();
  }, base, 33, 55, 8, 14);
  cel(ctx, (c) => ell(c, 25.6, 58.5, 3.4, 2.6), steel, 22.2, 55.9, 6.8, 5.2);
  cel(ctx, (c) => ell(c, 36.6, 58.5, 3.4, 2.6), steel, 33.2, 55.9, 6.8, 5.2);
  boot(ctx, 25, 69.4, 5.2, '#2b3440');
  boot(ctx, 38, 69.4, 5.4, '#333d4c');
  // 厚重胸甲：板甲接缝 + 4 颗铆钉 + 藤芽徽记
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(20, 37.5);
    c.bezierCurveTo(17, 45, 17.5, 53, 22, 57);
    c.lineTo(40, 57);
    c.bezierCurveTo(45, 52.5, 45.5, 43.5, 42, 36.5);
    c.closePath();
  }, base, 17.5, 36.5, 28, 21);
  curves(ctx, [
    [20, 44, 30, 46.4, 43, 43.2],
    [20.6, 50, 30, 52, 42.6, 49.4],
    [31.4, 38, 31.2, 46, 31.6, 56],
  ], STRUCT, 1.1);
  rivet(ctx, 22.4, 41.6);
  rivet(ctx, 39.8, 40.8);
  rivet(ctx, 23, 53.4);
  rivet(ctx, 39.4, 52.4);
  curves(ctx, [[24, 47.6, 27, 49, 29, 47.8]], DETAIL, 0.6);
  dot(ctx, 27, 42.4, 1.9, vine);
  taper(ctx, 27, 43.8, 26.2, 41.4, 27.4, 40, 0.8, mixColor(vine, '#241612', 0.4));
  // 左巨肩甲：双板缝 + 3 铆钉
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(14.5, 40);
    c.bezierCurveTo(13.5, 33.5, 20, 30.5, 25.5, 33);
    c.quadraticCurveTo(27.5, 37.5, 25, 42);
    c.quadraticCurveTo(19, 44, 14.5, 40);
    c.closePath();
  }, steel, 13.5, 30.5, 14, 13.5);
  curves(ctx, [
    [15.4, 36.4, 20, 34.6, 25.4, 36.2],
    [16, 39.2, 20, 38, 24.6, 39.4],
  ], STRUCT, 1);
  rivet(ctx, 17.4, 33.8, 0.8);
  rivet(ctx, 21, 33, 0.8);
  rivet(ctx, 24.2, 34.4, 0.8);
  head(ctx, 30, 22, 10.5);
  // 头盔：盔体接缝铆钉 + 护颊板 + 盔顶藤蔓 + 颈后发丝
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(19.6, 20.5);
    c.bezierCurveTo(20, 8.5, 40, 8.5, 40.4, 20.5);
    c.quadraticCurveTo(30, 16, 19.6, 20.5);
    c.closePath();
  }, steel, 19.6, 8.5, 20.8, 12);
  cel(ctx, (c) => roundRectPath(c, 18.6, 18.4, 23.2, 3.8, 1.9), '#3f4756', 18.6, 18.4, 23.2, 3.8);
  curves(ctx, [[22, 13, 30, 10.4, 38, 13]], STRUCT, 1);
  rivet(ctx, 21.4, 20.2, 0.8);
  rivet(ctx, 30, 21, 0.8);
  rivet(ctx, 38.8, 20.2, 0.8);
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(19.8, 21.6);
    c.quadraticCurveTo(18.6, 27, 21, 30.5);
    c.quadraticCurveTo(23.6, 29.5, 23.8, 25.5);
    c.quadraticCurveTo(23, 22.6, 21.8, 21.6);
    c.closePath();
  }, steel, 18.6, 21.6, 5.2, 9);
  taper(ctx, 23, 14.5, 30, 9, 37.5, 13.5, 1.3, mixColor(vine, '#241612', 0.3));
  dot(ctx, 37.8, 13.2, 1.6, vine);
  taper(ctx, 26.4, 11.8, 25.6, 10, 26.8, 8.6, 0.8, vine);
  curves(ctx, [
    [40.2, 21.6, 42, 24.4, 41.2, 27.4],
    [38.4, 22.2, 39.6, 24.8, 39, 27.2],
    [41.6, 22.8, 43.2, 25, 42.6, 27],
    [37, 23, 37.8, 25, 37.4, 26.8],
    [40.6, 24.2, 41.8, 26, 41.2, 27.8],
  ], '#4e3826', 1);
  animeFace(ctx, 27, 25, '#3a4454', 1.1);
  // 荆棘塔盾：木框铆钉 + 石芯砖缝 + 缠绕棘藤与尖刺
  cel(ctx, (c) => roundRectPath(c, 46, 25, 16, 44, 5), '#6e5a3a', 46, 25, 16, 44);
  rivet(ctx, 48.4, 27.6);
  rivet(ctx, 59.6, 27.6);
  rivet(ctx, 48.4, 66.4);
  rivet(ctx, 59.6, 66.4);
  cel(ctx, (c) => roundRectPath(c, 49, 29, 10, 36, 3), '#8a94a4', 49, 29, 10, 36);
  ctx.beginPath();
  ctx.moveTo(49, 38);
  ctx.lineTo(59, 38);
  ctx.moveTo(49, 47);
  ctx.lineTo(59, 47);
  ctx.moveTo(49, 56);
  ctx.lineTo(59, 56);
  ctx.moveTo(54, 29);
  ctx.lineTo(54, 38);
  ctx.moveTo(51.5, 38);
  ctx.lineTo(51.5, 47);
  ctx.moveTo(56.5, 38);
  ctx.lineTo(56.5, 47);
  ctx.moveTo(54, 47);
  ctx.lineTo(54, 56);
  ctx.moveTo(51.5, 56);
  ctx.lineTo(51.5, 65);
  pen(ctx, 1);
  curves(ctx, [
    [50, 34.4, 52.4, 33.6, 54.4, 34.6],
    [52, 52.4, 54.6, 51.6, 56.6, 52.6],
  ], DETAIL, 0.6);
  taper(ctx, 47.5, 66, 44, 50, 52, 40, 1.5, mixColor(vine, '#241612', 0.35));
  taper(ctx, 52, 40, 58, 34, 61, 27.5, 1.5, mixColor(vine, '#241612', 0.35));
  for (const [tx, ty, ta] of [[47.8, 58, -2.4], [49, 47.5, -2.9], [54.6, 37.5, -0.6], [59.4, 30.5, -0.9]]) {
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(ta);
    ctx.beginPath();
    ctx.moveTo(-1.6, 0);
    ctx.lineTo(0, -3.6);
    ctx.lineTo(1.6, 0);
    ctx.closePath();
    ctx.fillStyle = vine;
    ctx.fill();
    pen(ctx, 1);
    ctx.restore();
  }
  rimLight(ctx, 54, 33, 5.6, 5, -1.6, -0.3);
  // 前臂铁手套扶盾
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(39.5, 40);
    c.quadraticCurveTo(44.5, 41, 46.5, 44);
    c.quadraticCurveTo(45.5, 47.5, 42, 46.5);
    c.quadraticCurveTo(40, 43.5, 38, 42.5);
    c.closePath();
  }, base, 38, 40, 9, 8);
  cel(ctx, (c) => ell(c, 46.4, 45, 3, 3), steel, 43.4, 42, 6, 6);
  curves(ctx, [[44.4, 44, 46.4, 43.2, 48.2, 44.2]], DETAIL, 0.6);
}

// ── 13. stormsniper 雷羽狙击手（#2563eb 🪶）持长铳瞄准的疾风射手 ─
function paintStormsniper(ctx: CanvasRenderingContext2D): void {
  const base = '#2563eb';
  const navy = '#1e3a8a';
  // 疾风斗篷（向左后方扬起，3 根褶线）
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(26, 38);
    c.bezierCurveTo(16, 42, 9, 52, 10, 62);
    c.bezierCurveTo(16, 59, 22, 53, 25, 47);
    c.closePath();
  }, navy, 9, 38, 17, 24);
  curves(ctx, [
    [22, 42, 16.5, 48, 13, 58],
    [24, 44.5, 19.5, 50, 17.5, 57],
    [25.5, 41, 21.5, 45, 19, 50],
  ]);
  // 弓步双腿
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(27, 54);
    c.quadraticCurveTo(22, 60, 21.5, 68.5);
    c.lineTo(28, 68.5);
    c.quadraticCurveTo(29.5, 61, 31.5, 54.5);
    c.closePath();
  }, mixColor(navy, '#241612', 0.2), 21, 54, 11, 15);
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(35.5, 55);
    c.quadraticCurveTo(41.5, 60, 44, 68.5);
    c.lineTo(37, 68.5);
    c.quadraticCurveTo(34.5, 61, 32.5, 55);
    c.closePath();
  }, navy, 32, 54, 13, 15);
  boot(ctx, 25, 68.8, 5, '#2b3440');
  boot(ctx, 41.5, 68.8, 5.2, '#333d4c');
  // 紧身猎装：胸带 + 腰带扣 + 3 根衣褶
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(26.5, 37.5);
    c.bezierCurveTo(24, 44.5, 24.5, 51.5, 28, 55.5);
    c.lineTo(40, 55.5);
    c.bezierCurveTo(44, 51, 44.5, 43.5, 41, 36.5);
    c.closePath();
  }, base, 24.5, 36.5, 20.5, 19);
  curves(ctx, [
    [28.5, 42, 27.5, 48, 28.5, 54],
    [34, 43.5, 33.6, 49, 34.2, 55],
    [39.5, 41, 40.6, 46.5, 39.6, 52.5],
  ]);
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(27.5, 39);
    c.lineTo(41.5, 46.5);
    c.lineTo(41.5, 50);
    c.lineTo(27.5, 42.5);
    c.closePath();
  }, '#54371f', 27.5, 39, 14, 11);
  rivet(ctx, 34.5, 44.4, 0.8);
  taper(ctx, 26.5, 51, 34, 52.6, 42, 50.6, 2.2, '#54371f');
  cel(ctx, (c) => roundRectPath(c, 32.4, 49.6, 4, 3.4, 1), '#f2c14e', 32.4, 49.6, 4, 3.4);
  // 长管羽铳：枪托 + 枪身 + 蓝钢枪管 + 瞄准镜 + 扳机护圈 + 羽饰吊坠
  ctx.save();
  ctx.translate(35, 42);
  ctx.rotate(-0.3);
  cel(ctx, (c) => roundRectPath(c, -21, -1.4, 8, 6.2, 2), '#6e5a3a', -21, -1.4, 8, 6.2);
  curves(ctx, [[-19.5, 0.6, -17, 1.4, -14.5, 1]], DETAIL, 0.6);
  cel(ctx, (c) => roundRectPath(c, -15, -2.5, 38, 5, 2.2), '#3f4756', -15, -2.5, 38, 5);
  curves(ctx, [[-13, -0.6, 3, -1.3, 20, -0.6]], STRUCT, 1);
  curves(ctx, [[-12, 1.4, 3, 2, 19, 1.4]], DETAIL, 0.6);
  cel(ctx, (c) => roundRectPath(c, 23, -1.8, 9, 3.6, 1.7), '#7ea8f0', 23, -1.8, 9, 3.6);
  ell(ctx, 32.2, 0, 1, 1.5);
  ctx.fillStyle = '#241612';
  ctx.fill();
  pen(ctx, 1);
  cel(ctx, (c) => roundRectPath(c, -1, -8.4, 12, 4.2, 2), '#4a5568', -1, -8.4, 12, 4.2);
  ell(ctx, 10.6, -6.3, 1.5, 1.9);
  ctx.fillStyle = '#a8d8f0';
  ctx.fill();
  pen(ctx, 1);
  dot(ctx, 11, -6.8, 0.5, 'rgba(255,255,255,0.9)');
  ctx.beginPath();
  ctx.moveTo(1.5, -4.2);
  ctx.lineTo(1.5, -2.5);
  ctx.moveTo(8.5, -4.2);
  ctx.lineTo(8.5, -2.5);
  pen(ctx, 1);
  ctx.beginPath();
  ctx.arc(-7, 3.6, 2.6, -0.4, 3.3);
  pen(ctx, 1);
  // 羽饰吊坠：吊绳 + 双羽（羽轴 + 羽枝细线）
  taper(ctx, 16, 2.4, 15.4, 5, 16, 7.6, 0.7, STRUCT);
  for (const [fx, fy, fa] of [[15, 9.5, 0.5], [18.2, 8.8, 0.9]]) {
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(fa);
    cel(ctx, (c) => {
      c.beginPath();
      c.moveTo(0, -3.4);
      c.quadraticCurveTo(2.6, 0, 0, 4);
      c.quadraticCurveTo(-2.6, 0, 0, -3.4);
      c.closePath();
    }, '#7ea8f0', -2.6, -3.4, 5.2, 7.4);
    taper(ctx, 0, -3, 0, 0.4, 0, 3.6, 0.6, DETAIL);
    curves(ctx, [
      [-1.4, -0.8, -0.5, -1.3, 0.3, -2],
      [-1.5, 1, -0.4, 0.4, 0.5, -0.4],
      [-1.2, 2.6, -0.2, 2, 0.7, 1.2],
      [0.3, -2, 1, -1.2, 1.4, -0.4],
    ], DETAIL, 0.55);
    ctx.restore();
  }
  ctx.restore();
  // 枪口静电闪光
  ctx.fillStyle = '#fde047';
  ctx.beginPath();
  ctx.moveTo(69, 27.5);
  ctx.lineTo(65, 31);
  ctx.lineTo(67.2, 31.6);
  ctx.lineTo(63.6, 35.4);
  ctx.lineTo(66.2, 31.4);
  ctx.lineTo(64.4, 30.8);
  ctx.closePath();
  ctx.fill();
  head(ctx, 33, 23, 10.5);
  // 疾风乱发：底色块 + 7 根被风撩起的发丝 + 雷电黄挑染
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(22.8, 23);
    c.bezierCurveTo(22, 11.5, 43, 11, 43.2, 22);
    c.quadraticCurveTo(40, 18.6, 37.4, 19.4);
    c.quadraticCurveTo(38.8, 15.6, 35, 16.8);
    c.quadraticCurveTo(29, 18.4, 27, 21.4);
    c.quadraticCurveTo(24.6, 21.4, 22.8, 23);
    c.closePath();
  }, '#3b5bd6', 22, 11, 22, 12.5);
  curves(ctx, [
    [23.4, 20.4, 18, 17.6, 14.6, 18.8],
    [23.8, 17.4, 19.4, 14.4, 16.4, 15],
    [26, 14.8, 22.6, 11.6, 19.8, 11.6],
    [30, 13.2, 28, 10, 25.4, 9.4],
    [35.6, 12.6, 35, 9.4, 33, 8.2],
    [40, 14, 41.4, 11, 40.6, 8.8],
    [42.8, 17.2, 44.8, 15, 44.6, 12.4],
  ], '#2b45a8', 1.1);
  taper(ctx, 27.6, 15.8, 24.8, 12.8, 22.4, 11.4, 1, '#fde047');
  animeFace(ctx, 30, 26, '#1f2e6e', 1.2);
  // 前手托枪管
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(40, 38.5);
    c.quadraticCurveTo(45.5, 37.5, 47.5, 34.5);
    c.quadraticCurveTo(45, 32, 42.8, 33.6);
    c.quadraticCurveTo(41.6, 36, 38.6, 36.8);
    c.closePath();
  }, base, 38.6, 32, 9, 7);
  hand(ctx, 47, 34.2, 2.6);
}

// ── 14. venomwitch 毒雾巫女（#65a30d ☠️）举瓶窃笑的碎步小巫 ─────
function paintVenomwitch(ctx: CanvasRenderingContext2D): void {
  const base = '#65a30d';
  const dark = '#3f6212';
  const hairC = '#8a5cb8';
  // 背侧毒雾旋涡与气泡
  curves(ctx, [
    [17, 36, 13, 32.5, 15.5, 29],
    [15.5, 29, 18.5, 28, 17.5, 31],
  ], withAlpha('#a3e635', 0.6), 0.9);
  dot(ctx, 13.5, 24, 2.2, withAlpha('#a3e635', 0.3));
  dot(ctx, 17, 19.5, 1.3, withAlpha('#a3e635', 0.35));
  // 破边长裙：锯齿下摆 + 4 根衣褶 + 补丁 + 缝线
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(31, 38);
    c.bezierCurveTo(23.5, 44, 20.5, 55, 21, 66);
    c.lineTo(25.5, 69.5);
    c.lineTo(29, 65.5);
    c.lineTo(33.5, 70);
    c.lineTo(38, 65.5);
    c.lineTo(42.5, 69.5);
    c.lineTo(47.5, 66);
    c.bezierCurveTo(48.5, 53.5, 45, 43.5, 38.5, 38);
    c.closePath();
  }, dark, 20.5, 38, 28, 32);
  curves(ctx, [
    [27, 45, 25, 54, 25.5, 64],
    [33, 47, 32.2, 55, 32.8, 66],
    [40, 45.5, 42, 54, 41, 64],
    [45, 50, 46.4, 57, 45.8, 64],
  ], 'rgba(217,249,157,0.45)', 0.9);
  cel(ctx, (c) => roundRectPath(c, 36.5, 55, 6.5, 6, 1), '#54741e', 36.5, 55, 6.5, 6);
  ctx.beginPath();
  ctx.moveTo(37, 55.8);
  ctx.lineTo(38.2, 57);
  ctx.moveTo(41.6, 55.6);
  ctx.lineTo(42.6, 56.8);
  ctx.moveTo(37.2, 60);
  ctx.lineTo(38.4, 58.8);
  pen(ctx, 2);
  curves(ctx, [
    [26, 42.5, 27.5, 44, 29, 42.5],
    [29, 42.5, 30.5, 44, 32, 42.5],
  ], DETAIL, 0.6);
  // 束腰上衫 + 皮腰带小药囊
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(29, 37.5);
    c.bezierCurveTo(26.5, 41, 26.5, 45.5, 29, 48.5);
    c.lineTo(40.5, 48.5);
    c.bezierCurveTo(43.5, 45, 43.5, 40.5, 41, 37);
    c.closePath();
  }, base, 26.5, 37, 17, 12);
  curves(ctx, [
    [31, 40, 30.4, 43.5, 31, 47],
    [38.5, 39.5, 39.4, 43, 38.6, 46.6],
  ]);
  taper(ctx, 27.5, 46.4, 34.5, 48.2, 42.4, 46, 2, '#54371f');
  cel(ctx, (c) => roundRectPath(c, 30.6, 47, 4, 4.6, 1.4), '#8a6d3b', 30.6, 47, 4, 4.6);
  rivet(ctx, 32.6, 47.8, 0.7);
  head(ctx, 35, 24, 10.8);
  // 弯尖巫帽：帽檐 + 弯折帽尖 + 帽带扣 + 帽面补丁
  cel(ctx, (c) => ell(c, 35, 17.8, 14.5, 3.5), dark, 20.5, 14.3, 29, 7);
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(25, 16.6);
    c.bezierCurveTo(27, 6.5, 36, 1.5, 44, 3.5);
    c.bezierCurveTo(50.5, 5.2, 54.5, 2.5, 56.5, 6.5);
    c.bezierCurveTo(52.5, 6.8, 50, 9, 46.5, 8.6);
    c.quadraticCurveTo(46.8, 12.4, 45.6, 16.4);
    c.quadraticCurveTo(35, 12.5, 25, 16.6);
    c.closePath();
  }, '#4d7c0f', 25, 1.5, 31.5, 15.5);
  taper(ctx, 26, 14.6, 35.5, 10.6, 45, 14.4, 2.4, '#365314');
  cel(ctx, (c) => roundRectPath(c, 37.6, 10.8, 3.4, 3.4, 0.6), '#f2c14e', 37.6, 10.8, 3.4, 3.4);
  curves(ctx, [
    [30, 6.8, 32.4, 5.4, 35, 5.2],
    [48, 5.4, 50.4, 4.6, 52.4, 4.2],
  ], DETAIL, 0.6);
  cel(ctx, (c) => roundRectPath(c, 29, 8.2, 4.6, 3.6, 0.8), '#54741e', 29, 8.2, 4.6, 3.6);
  ctx.beginPath();
  ctx.moveTo(29.6, 8.8);
  ctx.lineTo(30.6, 9.8);
  ctx.moveTo(32.2, 10.6);
  ctx.lineTo(33, 11.4);
  pen(ctx, 2);
  // 紫罗兰长发：底色块 + 8 根发丝（含两侧长发绺）
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(25, 20);
    c.quadraticCurveTo(23, 30, 25.5, 39);
    c.quadraticCurveTo(28, 32, 28.5, 24);
    c.closePath();
  }, hairC, 23, 20, 6, 19);
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(45, 20);
    c.quadraticCurveTo(47.5, 28.5, 45.5, 36.5);
    c.quadraticCurveTo(43, 30, 42.4, 23.5);
    c.closePath();
  }, hairC, 42, 20, 6, 17);
  curves(ctx, [
    [25.6, 22, 24.6, 29, 25.8, 36.5],
    [27.2, 22.6, 26.4, 28, 27.2, 33.5],
    [44.4, 22, 45.8, 28, 45, 34.5],
    [43.2, 22.6, 44, 27, 43.6, 31],
    [27, 19.4, 26, 20.8, 26.4, 22.6],
    [44.2, 19.6, 45.2, 21, 44.8, 22.8],
    [31, 18.8, 30, 20, 30.4, 21.6],
    [40, 18.8, 41, 20, 40.6, 21.6],
  ], mixColor(hairC, '#241612', 0.35), 0.9);
  animeFace(ctx, 32, 27, '#5b21b6');
  // 前手高举冒泡毒药瓶：圆底烧瓶 + 玻璃高光 + 瓶内外气泡 + 木塞
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(40.5, 39.5);
    c.quadraticCurveTo(46, 40.5, 48, 44);
    c.quadraticCurveTo(46.5, 47, 43.5, 46);
    c.quadraticCurveTo(41.5, 43, 39, 42);
    c.closePath();
  }, base, 39, 39, 9, 8);
  hand(ctx, 48.6, 44.6, 2.5);
  const flask: PathFn = (c) => {
    c.beginPath();
    c.moveTo(49.5, 31);
    c.lineTo(49.5, 34.6);
    c.bezierCurveTo(45, 36.6, 44, 42.5, 47.5, 45.4);
    c.bezierCurveTo(51, 48, 56, 46.6, 57.5, 42.6);
    c.bezierCurveTo(58.6, 38.6, 56.5, 35.6, 53.5, 34.6);
    c.lineTo(53.5, 31);
    c.closePath();
  };
  flask(ctx);
  ctx.fillStyle = withAlpha('#d9f99d', 0.55);
  ctx.fill();
  ctx.save();
  flask(ctx);
  ctx.clip();
  ctx.fillStyle = '#a3e635';
  ctx.beginPath();
  ctx.moveTo(44.5, 40.5);
  ctx.quadraticCurveTo(51, 38, 58.5, 40.5);
  ctx.lineTo(58.5, 48);
  ctx.lineTo(44.5, 48);
  ctx.closePath();
  ctx.fill();
  taper(ctx, 45.5, 40.4, 51, 38.6, 57.5, 40.4, 0.8, 'rgba(255,255,255,0.7)');
  dot(ctx, 49, 43, 1, '#d9f99d');
  dot(ctx, 53, 44.6, 0.8, '#d9f99d');
  dot(ctx, 51.5, 41.6, 0.6, '#ecfccb');
  ctx.restore();
  flask(ctx);
  pen(ctx, 0);
  taper(ctx, 47, 37.5, 45.8, 40, 46.6, 42.8, 0.8, 'rgba(255,255,255,0.85)');
  rimLight(ctx, 51.4, 40.4, 5.6, 5, -1.5, -0.3);
  cel(ctx, (c) => roundRectPath(c, 48.6, 28.6, 5.8, 3, 1.2), '#8a6d3b', 48.6, 28.6, 5.8, 3);
  ctx.beginPath();
  ctx.moveTo(50, 29.2);
  ctx.lineTo(50, 31.2);
  ctx.moveTo(52, 29.2);
  ctx.lineTo(52, 31.2);
  pen(ctx, 2);
  dot(ctx, 55.5, 25.5, 2, withAlpha('#a3e635', 0.5));
  dot(ctx, 58.5, 21, 1.2, withAlpha('#a3e635', 0.4));
  curves(ctx, [[55, 24.4, 56.4, 23, 56, 21.4]], 'rgba(217,249,157,0.7)', 0.6);
}

// ── 15. sunpriest 日冕祭司（#f97316 ☀️）冕环日杖的肃穆祭司 ─────
function paintSunpriest(ctx: CanvasRenderingContext2D): void {
  const base = '#f97316';
  const robe = '#fbf3e2';
  const gold = '#fbbf24';
  // 背侧日轮法杖：杖身 + 日盘 + 8 根日冕光针 + 外环
  curves(ctx, [[51, 68, 52.8, 44, 53.8, 22]], '#a85a1a', 2.6);
  curves(ctx, [[51.4, 66, 53, 44, 53.6, 24]], 'rgba(255,244,214,0.6)', 0.8);
  dot(ctx, 54.2, 12.8, 10.2, withAlpha('#fde68a', 0.35));
  ctx.beginPath();
  ctx.arc(54.2, 12.8, 8.4, 0, TAU);
  ctx.strokeStyle = gold;
  ctx.lineWidth = 1.1;
  ctx.stroke();
  for (let i = 0; i < 8; i += 1) {
    const a = (TAU * i) / 8 + 0.2;
    taper(ctx, 54.2 + Math.cos(a) * 5.8, 12.8 + Math.sin(a) * 5.8, 54.2 + Math.cos(a) * 7.6, 12.8 + Math.sin(a) * 7.6, 54.2 + Math.cos(a) * 9.6, 12.8 + Math.sin(a) * 9.6, 1, gold);
  }
  cel(ctx, (c) => ell(c, 54.2, 12.8, 4.8, 4.8), gold, 49.4, 8, 9.6, 9.6);
  ctx.beginPath();
  ctx.arc(54.2, 12.8, 2.9, 0, TAU);
  pen(ctx, 1);
  dot(ctx, 55.3, 11.6, 1.3, '#fff7d6');
  // 圣白长袍：A 字 + 5 根衣褶 + 双层橙饰边刺绣
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(30, 35.5);
    c.bezierCurveTo(22.5, 43.5, 20, 57, 21.5, 70);
    c.lineTo(48.5, 70);
    c.bezierCurveTo(50.5, 56, 47, 43, 39.5, 35.5);
    c.closePath();
  }, robe, 20, 35.5, 30, 34.5);
  curves(ctx, [
    [27, 44, 25.2, 55, 26, 68],
    [32.5, 46.5, 31.6, 56, 32.2, 68.5],
    [39.5, 45.5, 41.2, 55, 40.4, 68],
    [44.5, 48.5, 46, 57, 45.2, 66.5],
    [23.8, 51, 22.8, 59, 23.4, 67],
  ]);
  taper(ctx, 22.5, 65.8, 35, 62.6, 48, 65.8, 1.6, base);
  taper(ctx, 22.2, 68, 35, 65.4, 48.2, 68, 0.8, mixColor(base, '#241612', 0.2));
  curves(ctx, [
    [27, 64.6, 28.4, 63.4, 29.8, 64.4],
    [34, 63.6, 35.4, 62.4, 36.8, 63.4],
    [41, 64.2, 42.4, 63, 43.8, 64],
  ], DETAIL, 0.6);
  // 圣带（stole）：日纹 + 底端流苏
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(30.5, 36.5);
    c.quadraticCurveTo(31, 48, 32.2, 59);
    c.lineTo(37, 59);
    c.quadraticCurveTo(37.6, 48, 38, 36.5);
    c.closePath();
  }, base, 30.5, 36.5, 7.5, 22.5);
  dot(ctx, 34.3, 43.5, 1.6, '#fde68a');
  dot(ctx, 34.7, 51.5, 1.6, '#fde68a');
  curves(ctx, [
    [33, 59.4, 32.8, 61, 33.2, 62.6],
    [34.8, 59.6, 34.8, 61.2, 35, 62.8],
    [36.4, 59.4, 36.6, 61, 36.4, 62.6],
  ], mixColor(base, '#241612', 0.25), 0.9);
  head(ctx, 35, 23, 10.8);
  // 暖棕短发：底色块 + 6 根发丝 + 头顶金色光环
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(24.6, 22.5);
    c.bezierCurveTo(24, 11.5, 46, 11, 45.4, 22.5);
    c.quadraticCurveTo(42.6, 18.4, 39.8, 19.2);
    c.quadraticCurveTo(40.8, 15.8, 37, 17);
    c.quadraticCurveTo(30.4, 18.6, 28.6, 21.2);
    c.quadraticCurveTo(26.2, 21, 24.6, 22.5);
    c.closePath();
  }, '#a86a3c', 24, 11, 22, 12);
  curves(ctx, [
    [26.6, 15.4, 25.4, 18.4, 25.4, 21.4],
    [29.6, 13.6, 28.6, 16.4, 28.8, 19.2],
    [33.6, 12.8, 33.2, 15.2, 33.6, 17],
    [38, 13, 38.8, 15.4, 38.8, 17.6],
    [42, 14.4, 43.2, 17, 43.2, 20],
    [44.6, 17, 45.6, 19.4, 45.2, 21.8],
  ], '#6e4020', 0.9);
  ctx.beginPath();
  ctx.ellipse(35, 7.6, 7.6, 2.3, 0, 0, TAU);
  ctx.strokeStyle = gold;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(35, 7.6, 7.6, 2.3, 0, -2.6, -0.6);
  ctx.strokeStyle = 'rgba(255,247,214,0.9)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  animeFace(ctx, 32, 26, '#7c4a12');
  // 前手掌心托暖光
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(39.5, 38);
    c.quadraticCurveTo(45.5, 38, 48.5, 35.5);
    c.quadraticCurveTo(47, 32.5, 44, 33.5);
    c.quadraticCurveTo(42, 35.5, 38.5, 36);
    c.closePath();
  }, robe, 38.5, 32.5, 10, 6);
  hand(ctx, 48.8, 34.6, 2.7);
  dot(ctx, 49, 30, 3.6, withAlpha('#fde68a', 0.45));
  dot(ctx, 49, 30, 1.4, '#fff7d6');
  for (let i = 0; i < 4; i += 1) {
    const a = (TAU * i) / 4 + 0.78;
    taper(ctx, 49 + Math.cos(a) * 2.4, 30 + Math.sin(a) * 2.4, 49 + Math.cos(a) * 3.4, 30 + Math.sin(a) * 3.4, 49 + Math.cos(a) * 4.6, 30 + Math.sin(a) * 4.6, 0.7, 'rgba(253,230,138,0.9)');
  }
}

// ── 16. engineer 机关工匠（#a16207 🛠️）高举扳手的齿轮技师 ──────
function paintEngineer(ctx: CanvasRenderingContext2D): void {
  const base = '#a16207';
  const denim = '#4a5568';
  const brass = '#c9a85c';
  // 背侧机关背包：铜壳缝线铆钉 + 烟囱蒸汽卷 + 大小齿轮
  cel(ctx, (c) => roundRectPath(c, 11, 32, 14, 22, 4), '#8a6d3b', 11, 32, 14, 22);
  curves(ctx, [[12.5, 39, 18, 40, 23.5, 39]], STRUCT, 1);
  rivet(ctx, 13.4, 34.4, 0.8);
  rivet(ctx, 22.6, 34.4, 0.8);
  rivet(ctx, 13.4, 51.4, 0.8);
  cel(ctx, (c) => roundRectPath(c, 13.5, 24.5, 4.2, 8.5, 1.6), '#6e5a3a', 13.5, 24.5, 4.2, 8.5);
  cel(ctx, (c) => roundRectPath(c, 12.7, 23.2, 5.8, 2.4, 1.1), '#5c4a2e', 12.7, 23.2, 5.8, 2.4);
  curves(ctx, [
    [15.6, 21.6, 12.8, 19.2, 15, 16.8],
    [15, 16.8, 17.6, 15.8, 16.2, 18.4],
    [17, 14.4, 19.8, 12.8, 18.8, 10.6],
  ], 'rgba(232,226,212,0.75)', 0.9);
  ctx.save();
  ctx.translate(18, 44);
  for (let i = 0; i < 8; i += 1) {
    ctx.save();
    ctx.rotate((TAU * i) / 8);
    roundRectPath(ctx, -1.5, -9, 3, 3.2, 1);
    ctx.fillStyle = brass;
    ctx.fill();
    pen(ctx, 1);
    ctx.restore();
  }
  cel(ctx, (c) => ell(c, 0, 0, 6.4, 6.4), brass, -6.4, -6.4, 12.8, 12.8);
  ctx.beginPath();
  ctx.moveTo(-4.6, 0);
  ctx.lineTo(4.6, 0);
  ctx.moveTo(-2.3, -4);
  ctx.lineTo(2.3, 4);
  ctx.moveTo(2.3, -4);
  ctx.lineTo(-2.3, 4);
  pen(ctx, 1);
  dot(ctx, 0, 0, 2, '#6e5a3a');
  ell(ctx, 0, 0, 2, 2);
  pen(ctx, 1);
  ctx.restore();
  for (let i = 0; i < 6; i += 1) {
    const a = (TAU * i) / 6 + 0.3;
    taper(ctx, 24.5 + Math.cos(a) * 3, 33.5 + Math.sin(a) * 3, 24.5 + Math.cos(a) * 4, 33.5 + Math.sin(a) * 4, 24.5 + Math.cos(a) * 5, 33.5 + Math.sin(a) * 5, 1.2, brass);
  }
  cel(ctx, (c) => ell(c, 24.5, 33.5, 3.2, 3.2), '#b89a52', 21.3, 30.3, 6.4, 6.4);
  dot(ctx, 24.5, 33.5, 1.1, '#6e5a3a');
  // 结实双腿工装裤
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(28, 55);
    c.lineTo(26.5, 69);
    c.lineTo(33.5, 69);
    c.lineTo(33.8, 55);
    c.closePath();
  }, mixColor(denim, '#241612', 0.2), 26.5, 55, 8, 14);
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(36.5, 55);
    c.lineTo(37, 69);
    c.lineTo(44, 69);
    c.lineTo(42.5, 55);
    c.closePath();
  }, denim, 36.5, 55, 8, 14);
  boot(ctx, 29.5, 69.4, 5.2, '#4a3a2c');
  boot(ctx, 41.5, 69.4, 5.4, '#54432f');
  // 卷袖衬衫 + 背带裤兜：缝线 + 铜扣 + 兜里螺丝刀
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(27, 38);
    c.bezierCurveTo(24.5, 45, 25, 52.5, 28.5, 56);
    c.lineTo(42, 56);
    c.bezierCurveTo(45.5, 51.5, 46, 43.5, 42.5, 37);
    c.closePath();
  }, base, 25, 37, 21, 19);
  curves(ctx, [
    [29.5, 42, 28.5, 47, 29.5, 52],
    [41, 41, 42, 46, 41.2, 51],
    [35, 40, 34.8, 43, 35.2, 45.6],
  ]);
  cel(ctx, (c) => roundRectPath(c, 29, 45.5, 13.5, 10.5, 2.5), denim, 29, 45.5, 13.5, 10.5);
  cel(ctx, (c) => roundRectPath(c, 31.8, 48.5, 8, 6, 1.5), mixColor(denim, '#f0e8d8', 0.12), 31.8, 48.5, 8, 6);
  ctx.beginPath();
  ctx.moveTo(32.6, 49.6);
  ctx.lineTo(33.8, 49.6);
  ctx.moveTo(35, 49.6);
  ctx.lineTo(36.2, 49.6);
  ctx.moveTo(37.4, 49.6);
  ctx.lineTo(38.6, 49.6);
  pen(ctx, 2);
  taper(ctx, 30.5, 39, 30.8, 42.4, 30.6, 46, 2.2, denim);
  taper(ctx, 40.5, 38.5, 40.4, 42, 40.6, 45.8, 2.2, denim);
  rivet(ctx, 30.6, 45.8, 1);
  rivet(ctx, 40.6, 45.6, 1);
  cel(ctx, (c) => roundRectPath(c, 34.2, 50.2, 1.8, 5.4, 0.9), '#f2c14e', 34.2, 50.2, 1.8, 5.4);
  head(ctx, 36, 23, 11);
  // 乱翘短发（7 根尖发丝）+ 额顶护目镜：镜带 + 双镜片 + 侧铆钉
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(25.2, 22);
    c.bezierCurveTo(24.5, 10.5, 47, 10, 46.8, 22);
    c.quadraticCurveTo(44, 18, 41, 18.8);
    c.quadraticCurveTo(42, 15.4, 38.2, 16.6);
    c.quadraticCurveTo(31.4, 18.2, 29.4, 21);
    c.quadraticCurveTo(27, 20.8, 25.2, 22);
    c.closePath();
  }, '#5b3a1e', 24.5, 10, 22.5, 12);
  curves(ctx, [
    [26.6, 13.6, 24.8, 11, 25.6, 8.6],
    [30, 11.8, 28.8, 9, 30, 6.8],
    [34.4, 10.8, 34, 8, 35.4, 6],
    [39, 11, 40, 8.4, 41.4, 7.2],
    [43.4, 12.6, 45, 10.4, 46.4, 10],
    [45.8, 15.4, 47.6, 14, 48.6, 14.2],
    [27.8, 12.4, 26.8, 10.2, 27.8, 8.2],
  ], '#4a2e14', 1.1);
  taper(ctx, 25, 18.4, 36, 14, 47, 18.4, 2.6, '#4a3a2c');
  for (const gx of [31.5, 40.5]) {
    cel(ctx, (c) => ell(c, gx, 16, 3.5, 3.1), '#9aa4b2', gx - 3.5, 12.9, 7, 6.2);
    ell(ctx, gx, 16, 2.4, 2.1);
    ctx.fillStyle = '#a8d8e8';
    ctx.fill();
    pen(ctx, 2);
    dot(ctx, gx + 0.9, 15.2, 0.7, 'rgba(255,255,255,0.9)');
    rivet(ctx, gx - 3.6, 16, 0.6);
  }
  animeFace(ctx, 33, 26, '#5b3a1e');
  taper(ctx, 28.4, 30.6, 29.6, 31.4, 30.8, 30.8, 0.8, 'rgba(90,70,55,0.5)');
  // 高举大扳手：手柄结构线 + 开口扳头 + 尾孔
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(42, 38);
    c.quadraticCurveTo(47.5, 36.5, 49.5, 32.5);
    c.quadraticCurveTo(47, 30, 44.5, 31.8);
    c.quadraticCurveTo(43.5, 34.5, 40.5, 36);
    c.closePath();
  }, base, 40.5, 30, 9, 8);
  ctx.save();
  ctx.translate(51.5, 28.5);
  ctx.rotate(-0.35);
  cel(ctx, (c) => roundRectPath(c, -1.7, -4, 3.4, 15.5, 1.7), '#9aa4b2', -1.7, -4, 3.4, 15.5);
  curves(ctx, [[0, -2.5, -0.2, 3, 0, 9]], DETAIL, 0.6);
  ell(ctx, 0, 9.4, 0.9, 0.9);
  ctx.fillStyle = '#4a5568';
  ctx.fill();
  pen(ctx, 2);
  ctx.beginPath();
  ctx.arc(0, -8, 4.8, 0.9, 5.6);
  ctx.arc(0, -8, 2.1, 5.6, 0.9, true);
  ctx.closePath();
  ctx.fillStyle = '#b8c2ce';
  ctx.fill();
  pen(ctx, 0);
  rimLight(ctx, 0, -8, 4, 4, -2.4, -1.2);
  ctx.restore();
  hand(ctx, 50.6, 31, 2.7);
}

// ── 17. voidseer 虚空观测者（#9333ea 🌀）捧旋涡法球的兜帽先知 ───
function paintVoidseer(ctx: CanvasRenderingContext2D): void {
  const base = '#9333ea';
  const robe = '#581c87';
  // 背侧星屑：十字星 + 光点
  for (const [sx, sy, sr] of [[15, 28, 1.9], [20, 17, 1.4], [60, 60, 1.6]]) {
    ctx.beginPath();
    ctx.moveTo(sx - sr, sy);
    ctx.lineTo(sx + sr, sy);
    ctx.moveTo(sx, sy - sr);
    ctx.lineTo(sx, sy + sr);
    ctx.strokeStyle = 'rgba(216,180,254,0.85)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
    dot(ctx, sx, sy, 0.6, '#e9d5ff');
  }
  // 曳地斗篷长袍：雾散下摆卷须 + 5 根衣褶 + 胸口星徽
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(27, 33);
    c.bezierCurveTo(19, 41, 16.5, 55, 18.5, 65.5);
    c.quadraticCurveTo(22.5, 70.5, 27.5, 67);
    c.quadraticCurveTo(32.5, 71.5, 38.5, 67.5);
    c.quadraticCurveTo(44.5, 71, 49.5, 66.5);
    c.bezierCurveTo(53.5, 55.5, 50.5, 41.5, 43.5, 33);
    c.closePath();
  }, robe, 16.5, 33, 37, 38.5);
  curves(ctx, [
    [25, 42, 23, 53, 24, 64.5],
    [31, 45, 30, 55, 30.8, 66],
    [38, 44.5, 40, 54, 39, 65],
    [44, 42.5, 46.5, 52, 45.5, 62.5],
    [21.5, 49, 20, 57, 20.8, 63.5],
  ], 'rgba(216,180,254,0.4)', 0.9);
  curves(ctx, [
    [19, 66.5, 15.5, 68, 14.5, 71],
    [50, 65.5, 53.5, 67, 54.5, 70],
    [33, 69.5, 34.5, 71.5, 33, 73],
  ], withAlpha('#7c3aed', 0.6), 1);
  ctx.fillStyle = '#c084fc';
  ctx.beginPath();
  for (let i = 0; i < 5; i += 1) {
    const a = -Math.PI / 2 + (Math.PI * 4 * i) / 5;
    const px = 34 + Math.cos(a) * 3.2;
    const py = 43 + Math.sin(a) * 3.2;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  pen(ctx, 2);
  dot(ctx, 28, 51, 0.7, 'rgba(216,180,254,0.8)');
  dot(ctx, 42.5, 56, 0.7, 'rgba(216,180,254,0.8)');
  head(ctx, 34, 24, 9.6);
  // 深兜帽：帽尖后折 + 帽口重线 + 2 根帽缝 + 帽内发丝 6 根
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(22.5, 29);
    c.bezierCurveTo(18.5, 16.5, 24, 5.5, 30, 4.5);
    c.bezierCurveTo(27, 8.5, 27.5, 11, 30.5, 8);
    c.bezierCurveTo(40, 3.5, 49.5, 12.5, 47.5, 27);
    c.bezierCurveTo(45, 33.5, 40, 35.5, 35, 35.5);
    c.bezierCurveTo(29.5, 35.5, 25, 33, 22.5, 29);
    c.closePath();
  }, base, 18.5, 4.5, 30.5, 31);
  curves(ctx, [
    [24.5, 12, 30.5, 8.5, 38.5, 9.5],
    [23, 20, 24.5, 26.5, 27.5, 31],
    [45.5, 14.5, 47, 20.5, 45.8, 26.5],
  ], 'rgba(233,213,255,0.45)', 0.9);
  ctx.beginPath();
  ctx.ellipse(35.5, 24.5, 9.8, 10.2, 0.08, 0, TAU);
  ctx.fillStyle = 'rgba(36,16,64,0.35)';
  ctx.fill();
  pen(ctx, 0);
  curves(ctx, [
    [27.6, 18, 26.8, 21.5, 27.6, 25],
    [29.4, 16.6, 28.8, 19.5, 29.4, 22],
    [31.6, 15.8, 31.2, 18, 31.8, 20],
    [40.4, 16, 41.2, 18.5, 40.8, 21],
    [42.6, 17.2, 43.6, 20.5, 43, 24],
    [37, 15.4, 37.4, 17, 37.2, 18.8],
  ], '#3b1d5e', 1);
  animeFace(ctx, 31, 26, '#7c3aed');
  // 兜帽额心第三眼：杏形眼白 + 金瞳 + 5 根睫毛 + 下睑线
  ctx.beginPath();
  ctx.moveTo(33.4, 12.6);
  ctx.quadraticCurveTo(36.6, 9.8, 40, 12.4);
  ctx.quadraticCurveTo(36.8, 15.2, 33.4, 12.6);
  ctx.closePath();
  ctx.fillStyle = '#f5ecff';
  ctx.fill();
  pen(ctx, 1);
  dot(ctx, 36.7, 12.5, 1.5, '#fde047');
  dot(ctx, 36.7, 12.5, 0.65, '#78350f');
  dot(ctx, 37.3, 11.8, 0.35, '#ffffff');
  for (let i = 0; i < 5; i += 1) {
    const a = -Math.PI / 2 + (i - 2) * 0.42;
    taper(ctx, 36.7 + Math.cos(a) * 2.8, 12.4 + Math.sin(a) * 2.4, 36.7 + Math.cos(a) * 3.8, 12.4 + Math.sin(a) * 3.4, 36.7 + Math.cos(a) * 5, 12.4 + Math.sin(a) * 4.6, 0.7, INK);
  }
  taper(ctx, 34.2, 13.8, 36.7, 15, 39.2, 13.7, 0.6, DETAIL);
  // 双袖捧球
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(41, 37);
    c.quadraticCurveTo(46.5, 38.5, 47.5, 42.5);
    c.quadraticCurveTo(45.5, 45.5, 42.5, 44);
    c.quadraticCurveTo(41, 41, 39, 39.5);
    c.closePath();
  }, base, 39, 37, 9, 8.5);
  hand(ctx, 45.8, 44.4, 2.4);
  // 旋涡虚空法球：球体 + 螺旋旋臂 + 星核 + 玻璃高光 + 外辉环 + 环绕微星
  dot(ctx, 52, 50, 9.4, withAlpha('#a855f7', 0.22));
  cel(ctx, (c) => ell(c, 52, 50, 7, 7), '#2e1065', 45, 43, 14, 14);
  ctx.save();
  ell(ctx, 52, 50, 7, 7);
  ctx.clip();
  ctx.strokeStyle = '#c084fc';
  ctx.lineWidth = 1.15;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i <= 26; i += 1) {
    const a = 0.52 * i;
    const rr = 0.5 + 0.235 * i;
    const px = 52 + Math.cos(a) * rr;
    const py = 50 + Math.sin(a) * rr * 0.92;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  dot(ctx, 52, 50, 1.4, '#f3e8ff');
  dot(ctx, 48.6, 52.4, 0.6, '#e9d5ff');
  dot(ctx, 55, 46.8, 0.5, '#e9d5ff');
  ctx.restore();
  ell(ctx, 52, 50, 7, 7);
  pen(ctx, 0);
  rimLight(ctx, 52, 50, 6, 6, -1.7, -0.4);
  taper(ctx, 47.6, 46.4, 46.8, 48.4, 47.2, 50.6, 0.7, 'rgba(255,255,255,0.6)');
  dot(ctx, 59.5, 43.5, 0.8, '#e9d5ff');
  dot(ctx, 44.5, 56.5, 0.7, '#d8b4fe');
  dot(ctx, 60.5, 55, 0.6, '#c084fc');
  // 前侧袖手托球
  cel(ctx, (c) => {
    c.beginPath();
    c.moveTo(40, 45);
    c.quadraticCurveTo(43.5, 49.5, 46, 54.5);
    c.quadraticCurveTo(43.5, 57, 40.5, 55.5);
    c.quadraticCurveTo(38.5, 50.5, 37.5, 47);
    c.closePath();
  }, mixColor(base, '#241612', 0.15), 37.5, 45, 9, 12);
  hand(ctx, 46.8, 55.6, 2.4);
}

/** B 组立绘：顺序对应 config units 索引 9..17。 */
export const UNIT_PAINTERS_B: CharacterPainter[] = [
  paintArtillery,
  paintFrostbinder,
  paintBanner,
  paintThornwarden,
  paintStormsniper,
  paintVenomwitch,
  paintSunpriest,
  paintEngineer,
  paintVoidseer,
];
