// 幸运塔防 程序化美术 · 我方单位立绘（A 组：0-8 号）。
// 精密动漫线稿风：三级线宽体系（INK 主轮廓 / STRUCT 结构线 / DETAIL 细节线）+
// 收锋贝塞尔笔触 + 轻赛璐璐底色 + 右上白色边缘光。每个画家在 72×80 逻辑框内
// 绘制一名动态姿势角色，脚底锚点 (36,72)，面朝右。发丝逐根勾勒、衣褶/甲缝/
// 武器结构线齐全。不含阴影 / 血条 / 文字，完全确定性绘制。
// 调用方：art/characters.ts（离屏缓存后由 draw.ts 渲染）。

import { mixColor, withAlpha } from './palette';

export const UNIT_CANVAS_W = 72;
export const UNIT_CANVAS_H = 80;

export type CharacterPainter = (ctx: CanvasRenderingContext2D) => void;

// ── 三级线宽体系与共享笔具 ──────────────────────────────

/** 主轮廓墨线：暖褐重墨。 */
const INK = 'rgba(45,32,28,0.88)';
const INK_W = 2.0;
/** 结构线：同色相深调、中等透明度。 */
const STRUCT_W = 1.1;
const STRUCT_A = 0.55;
/** 细节线：最细最淡，画布纹/发丝尾/刻痕。 */
const DETAIL_W = 0.6;
const DETAIL_A = 0.38;
/** 右上边缘光。 */
const RIM = 'rgba(255,255,255,0.8)';
const RIM_W = 0.8;
const SKIN = '#f7dcbd';
const SKIN_SHADE = '#e2b691';

/** 对当前路径描 INK 级主轮廓。 */
function inkPath(ctx: CanvasRenderingContext2D, w = INK_W): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** 结构线笔：hue 深调 55% 透明。设置后由调用方 beginPath/stroke。 */
function structPen(ctx: CanvasRenderingContext2D, hue: string): void {
  ctx.strokeStyle = withAlpha(mixColor(hue, '#241612', 0.62), STRUCT_A);
  ctx.lineWidth = STRUCT_W;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

/** 细节线笔：hue 深调 38% 透明、0.6px。 */
function detailPen(ctx: CanvasRenderingContext2D, hue: string): void {
  ctx.strokeStyle = withAlpha(mixColor(hue, '#241612', 0.7), DETAIL_A);
  ctx.lineWidth = DETAIL_W;
  ctx.lineCap = 'round';
}

/** 边缘光笔。 */
function rimPen(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = RIM;
  ctx.lineWidth = RIM_W;
  ctx.lineCap = 'round';
}

/** 二次贝塞尔 de Casteljau 前段裁剪：返回 [新控制点x,y, 新终点x,y]。 */
function quadHead(x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, t: number): [number, number, number, number] {
  const ax = x0 + (cx - x0) * t;
  const ay = y0 + (cy - y0) * t;
  const bx = cx + (x1 - cx) * t;
  const by = cy + (y1 - cy) * t;
  return [ax, ay, ax + (bx - ax) * t, ay + (by - ay) * t];
}

/** 收锋笔触：整段细描 + 前 62% 加粗覆盖，模拟起笔重、收笔轻的动漫笔锋。 */
function taperedStroke(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, cx: number, cy: number, x1: number, y1: number,
  color: string, w: number,
): void {
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = w * 0.5;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(cx, cy, x1, y1);
  ctx.stroke();
  const [hx, hy, ex, ey] = quadHead(x0, y0, cx, cy, x1, y1, 0.62);
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(hx, hy, ex, ey);
  ctx.stroke();
}

/** 发丝：从发根向发梢的收锋曲线。 */
function hairStrand(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, cx: number, cy: number, x1: number, y1: number,
  color: string, w = 1.1,
): void {
  taperedStroke(ctx, x0, y0, cx, cy, x1, y1, color, w);
}

/** 当前路径赛璐璐填色 + 主轮廓墨线。 */
function cel(ctx: CanvasRenderingContext2D, color: string, w = INK_W): void {
  ctx.fillStyle = color;
  ctx.fill();
  inkPath(ctx, w);
}

/** 右上边缘光弧。 */
function rimArc(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, a0 = -1.35, a1 = -0.3): void {
  rimPen(ctx);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx - 1, ry - 1, 0, a0, a1);
  ctx.stroke();
}

/** 杏仁眼：重墨上睑 + 虹膜 + 瞳孔 + 高光点 + 淡下睑线。 */
function almondEye(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, iris: string): void {
  ctx.fillStyle = iris;
  ctx.beginPath();
  ctx.ellipse(x + 0.2, y + 0.5, w * 0.55, w * 0.78, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(28,18,16,0.9)';
  ctx.beginPath();
  ctx.ellipse(x + 0.2, y + 0.6, w * 0.26, w * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.arc(x + w * 0.28, y - 0.15, w * 0.2, 0, Math.PI * 2);
  ctx.fill();
  taperedStroke(ctx, x - w, y - 0.4, x, y - w * 0.95, x + w, y - 0.25, INK, 1.35);
  ctx.strokeStyle = 'rgba(45,32,28,0.38)';
  ctx.lineWidth = DETAIL_W;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.6, y + w * 0.75);
  ctx.quadraticCurveTo(x + 0.2, y + w * 1.05, x + w * 0.65, y + w * 0.65);
  ctx.stroke();
}

/** 精修动漫脸：杏仁双眼 + 细眉 + 鼻点 + 小嘴 + 可选腮红。面朝右。 */
function animeFace(ctx: CanvasRenderingContext2D, cx: number, cy: number, opt?: { iris?: string; blush?: boolean; eyeDx?: number }): void {
  const dx = opt?.eyeDx ?? 4;
  const iris = opt?.iris ?? '#6a4634';
  almondEye(ctx, cx + dx - 5.4, cy, 2.6, iris);
  almondEye(ctx, cx + dx + 2.9, cy, 2.6, iris);
  taperedStroke(ctx, cx + dx - 7.4, cy - 3.8, cx + dx - 5.2, cy - 4.7, cx + dx - 3.2, cy - 4.1, 'rgba(45,32,28,0.7)', 0.9);
  taperedStroke(ctx, cx + dx + 0.8, cy - 4.1, cx + dx + 3, cy - 4.8, cx + dx + 5, cy - 3.9, 'rgba(45,32,28,0.7)', 0.9);
  ctx.strokeStyle = 'rgba(140,90,70,0.55)';
  ctx.lineWidth = DETAIL_W;
  ctx.beginPath();
  ctx.moveTo(cx + dx - 0.4, cy + 2.2);
  ctx.lineTo(cx + dx + 0.4, cy + 3);
  ctx.stroke();
  taperedStroke(ctx, cx + dx - 2.4, cy + 4.9, cx + dx - 0.6, cy + 5.9, cx + dx + 1.4, cy + 4.9, 'rgba(120,66,50,0.8)', 1);
  if (opt?.blush !== false) {
    ctx.fillStyle = 'rgba(240,140,130,0.28)';
    ctx.beginPath();
    ctx.ellipse(cx + dx - 8.6, cy + 3.4, 2.1, 1.1, 0.1, 0, Math.PI * 2);
    ctx.ellipse(cx + dx + 6.2, cy + 3.4, 2.1, 1.1, -0.1, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 圆头底：肤色 + 左下暗部 + 墨线 + 边缘光。发型由各角色自绘。 */
function headBase(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, r * 0.94, 0, 0, Math.PI * 2);
  ctx.fillStyle = SKIN;
  ctx.fill();
  ctx.fillStyle = withAlpha(SKIN_SHADE, 0.6);
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.32, cy + r * 0.44, r * 0.6, r * 0.38, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, r * 0.94, 0, 0, Math.PI * 2);
  inkPath(ctx);
  rimArc(ctx, cx, cy, r, r * 0.94);
}

// ── 0 疾风哨卫 vanguard（青绿 #0d9488）短矛斥候 · 疾冲步 ─────────

function paintVanguard(ctx: CanvasRenderingContext2D): void {
  const C = '#0d9488';
  const dark = mixColor(C, '#022e28', 0.4);
  const lite = mixColor(C, '#d9fff5', 0.45);
  const wood = '#96703f';
  // 身后风迹（细节线三道，疾冲残风）
  detailPen(ctx, C);
  ctx.beginPath();
  ctx.moveTo(4, 40);
  ctx.quadraticCurveTo(16, 37, 26, 41);
  ctx.moveTo(6, 48);
  ctx.quadraticCurveTo(17, 46, 25, 49);
  ctx.moveTo(9, 56);
  ctx.quadraticCurveTo(18, 54, 26, 56);
  ctx.stroke();
  // 飘巾（向左后拉长，四道褶线）
  ctx.beginPath();
  ctx.moveTo(31, 37);
  ctx.bezierCurveTo(22, 33, 12, 35, 6, 43);
  ctx.quadraticCurveTo(11, 43, 13, 47);
  ctx.bezierCurveTo(19, 44, 27, 43, 33, 42);
  ctx.closePath();
  cel(ctx, withAlpha(lite, 0.9), 1.6);
  structPen(ctx, C);
  ctx.beginPath();
  ctx.moveTo(29, 38);
  ctx.quadraticCurveTo(19, 37, 11, 41);
  ctx.moveTo(30, 40);
  ctx.quadraticCurveTo(22, 40, 14, 44);
  ctx.moveTo(27, 42);
  ctx.quadraticCurveTo(21, 42, 16, 45);
  ctx.moveTo(24, 39);
  ctx.quadraticCurveTo(18, 39, 12, 42);
  ctx.stroke();
  // 后腿：向后蹬直
  ctx.beginPath();
  ctx.moveTo(30, 56);
  ctx.bezierCurveTo(27, 61, 24.5, 66, 23, 70.5);
  ctx.lineTo(28.5, 71.5);
  ctx.bezierCurveTo(30.5, 66, 32.5, 61, 34, 57);
  ctx.closePath();
  cel(ctx, dark);
  // 前腿：屈膝前迈
  ctx.beginPath();
  ctx.moveTo(37, 57);
  ctx.bezierCurveTo(41, 60, 44, 65, 45.5, 70.5);
  ctx.lineTo(39.5, 71.5);
  ctx.bezierCurveTo(37.5, 65.5, 36, 61, 35, 58);
  ctx.closePath();
  cel(ctx, C);
  structPen(ctx, C);
  ctx.beginPath();
  ctx.moveTo(40, 62);
  ctx.quadraticCurveTo(41.5, 63, 43, 62.5);
  ctx.moveTo(26.5, 64);
  ctx.quadraticCurveTo(28, 65, 30, 64.5);
  ctx.stroke();
  // 躯干：前倾轻甲
  ctx.beginPath();
  ctx.moveTo(28, 39);
  ctx.bezierCurveTo(26, 47, 27, 55, 30.5, 59.5);
  ctx.lineTo(41, 59.5);
  ctx.bezierCurveTo(44.5, 53, 45, 45, 42, 38);
  ctx.closePath();
  ctx.fillStyle = C;
  ctx.fill();
  ctx.fillStyle = withAlpha(dark, 0.7);
  ctx.beginPath();
  ctx.moveTo(28, 47);
  ctx.bezierCurveTo(27.5, 54, 28.5, 58, 30.5, 59.5);
  ctx.lineTo(35.5, 59.5);
  ctx.lineTo(33.5, 46);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = withAlpha(lite, 0.5);
  ctx.beginPath();
  ctx.ellipse(40, 42.5, 3, 4.8, 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(28, 39);
  ctx.bezierCurveTo(26, 47, 27, 55, 30.5, 59.5);
  ctx.lineTo(41, 59.5);
  ctx.bezierCurveTo(44.5, 53, 45, 45, 42, 38);
  ctx.closePath();
  inkPath(ctx);
  // 胸甲板缝 + 铆钉
  structPen(ctx, C);
  ctx.beginPath();
  ctx.moveTo(29, 44);
  ctx.quadraticCurveTo(36, 46.5, 43, 43.5);
  ctx.moveTo(30, 50);
  ctx.quadraticCurveTo(36, 52.5, 42.5, 49.5);
  ctx.stroke();
  ctx.fillStyle = withAlpha(mixColor(C, '#241612', 0.5), 0.8);
  ctx.beginPath();
  ctx.arc(31, 45.4, 0.7, 0, Math.PI * 2);
  ctx.arc(36.5, 46.4, 0.7, 0, Math.PI * 2);
  ctx.arc(41.5, 44.4, 0.7, 0, Math.PI * 2);
  ctx.fill();
  // 腰带 + 扣
  ctx.strokeStyle = mixColor(wood, '#402a12', 0.4);
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(28.5, 53.5);
  ctx.quadraticCurveTo(36, 56.5, 43.5, 52.5);
  ctx.stroke();
  detailPen(ctx, wood);
  ctx.beginPath();
  ctx.moveTo(29, 54.6);
  ctx.quadraticCurveTo(36, 57.5, 43, 53.6);
  ctx.stroke();
  // 短矛：直线杆（木纹细节线）+ 菱形矛头（脊线 + 刃光）
  ctx.strokeStyle = wood;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(22, 49);
  ctx.lineTo(62, 40.5);
  ctx.stroke();
  detailPen(ctx, wood);
  ctx.beginPath();
  ctx.moveTo(24, 48.2);
  ctx.lineTo(58, 41);
  ctx.stroke();
  // 缠柄绳
  structPen(ctx, wood);
  ctx.beginPath();
  ctx.moveTo(45, 44.4);
  ctx.lineTo(46, 45.6);
  ctx.moveTo(47, 44);
  ctx.lineTo(48, 45.2);
  ctx.moveTo(49, 43.6);
  ctx.lineTo(50, 44.8);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(61.5, 38);
  ctx.lineTo(70, 39.8);
  ctx.lineTo(61.8, 43.4);
  ctx.closePath();
  cel(ctx, '#dde8ec', 1.5);
  structPen(ctx, '#8a9aa4');
  ctx.beginPath();
  ctx.moveTo(62, 40.6);
  ctx.lineTo(69, 39.9);
  ctx.stroke();
  rimPen(ctx);
  ctx.beginPath();
  ctx.moveTo(62.5, 38.7);
  ctx.lineTo(68.5, 39.4);
  ctx.stroke();
  // 后臂（持杆尾）+ 前臂（握杆）
  ctx.beginPath();
  ctx.moveTo(30, 42);
  ctx.quadraticCurveTo(26, 44.5, 24.5, 47.5);
  ctx.quadraticCurveTo(27.5, 49.5, 29.5, 47);
  ctx.quadraticCurveTo(31, 44.5, 32.5, 43);
  ctx.closePath();
  cel(ctx, dark, 1.6);
  ctx.beginPath();
  ctx.moveTo(40, 42.5);
  ctx.quadraticCurveTo(45, 42, 48.5, 43);
  ctx.quadraticCurveTo(49, 46.8, 44.5, 47.4);
  ctx.quadraticCurveTo(41.5, 47.4, 39.8, 46);
  ctx.closePath();
  cel(ctx, lite, 1.6);
  ctx.beginPath();
  ctx.arc(50, 44.6, 2.5, 0, Math.PI * 2);
  cel(ctx, SKIN, 1.4);
  // 头 + 后掠短发（7 根发丝）+ 额带
  headBase(ctx, 37, 26, 11.5);
  const hairC = mixColor('#2f4a44', C, 0.35);
  ctx.beginPath();
  ctx.moveTo(25.6, 25.5);
  ctx.bezierCurveTo(26, 15, 47, 14, 48.4, 24.5);
  ctx.quadraticCurveTo(44, 19.5, 37, 19.5);
  ctx.quadraticCurveTo(30, 19.8, 25.6, 25.5);
  ctx.closePath();
  cel(ctx, hairC, 1.7);
  hairStrand(ctx, 46, 20, 41, 15.5, 33, 15.6, hairC, 1.3);
  hairStrand(ctx, 45.5, 22.5, 39, 17.5, 30.5, 18, hairC, 1.2);
  hairStrand(ctx, 43, 18.6, 37, 15, 29, 17, hairC, 1.1);
  hairStrand(ctx, 40, 17.4, 34, 15.2, 27.5, 19.5, hairC, 1.1);
  hairStrand(ctx, 36, 17, 30.5, 16.8, 26, 21.5, hairC, 1);
  hairStrand(ctx, 47.5, 24.5, 44, 20, 38.5, 18.4, mixColor(hairC, '#e6fff8', 0.4), 0.9);
  hairStrand(ctx, 31, 18.4, 27.6, 19.6, 25.8, 24, mixColor(hairC, '#0a1a16', 0.4), 0.9);
  // 额带 + 飘尾
  ctx.strokeStyle = lite;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(26.2, 22.6);
  ctx.quadraticCurveTo(37, 18, 48, 22.2);
  ctx.stroke();
  taperedStroke(ctx, 26.5, 23, 21, 24.5, 17.5, 29, lite, 2);
  taperedStroke(ctx, 26.5, 23.6, 22, 26.5, 19.5, 31.5, lite, 1.6);
  detailPen(ctx, C);
  ctx.beginPath();
  ctx.moveTo(28, 22.2);
  ctx.quadraticCurveTo(37, 18.8, 46, 21.8);
  ctx.stroke();
  animeFace(ctx, 37, 28, { iris: '#1f7a6e' });
  rimArc(ctx, 37, 47, 8, 12, -1, -0.2);
}
// ── 1 磐石重盾 defender（青灰 #64748b）塔盾骑士 · 蹲踞抵盾 ─────────

function paintDefender(ctx: CanvasRenderingContext2D): void {
  const C = '#64748b';
  const dark = mixColor(C, '#161e2c', 0.42);
  const lite = mixColor(C, '#e9eff7', 0.45);
  const gold = '#d2a94c';
  // 后腿：向后撑地蹬紧（甲叶两段）
  ctx.beginPath();
  ctx.moveTo(27, 55);
  ctx.bezierCurveTo(23.5, 59, 21, 65, 20.5, 70.5);
  ctx.lineTo(27, 71);
  ctx.bezierCurveTo(28.5, 65, 30.5, 60, 32, 56.5);
  ctx.closePath();
  cel(ctx, dark);
  // 前腿：屈膝顶住盾后
  ctx.beginPath();
  ctx.moveTo(36, 56);
  ctx.bezierCurveTo(40, 58.5, 43, 63.5, 44, 70.5);
  ctx.lineTo(37.5, 71);
  ctx.bezierCurveTo(36, 64.5, 34.5, 60, 34, 57);
  ctx.closePath();
  cel(ctx, C);
  // 胫甲缝 + 铆钉
  structPen(ctx, C);
  ctx.beginPath();
  ctx.moveTo(22.5, 64);
  ctx.quadraticCurveTo(25, 65.5, 27.5, 64.5);
  ctx.moveTo(38.5, 63);
  ctx.quadraticCurveTo(40.5, 64.5, 42.5, 63.5);
  ctx.stroke();
  ctx.fillStyle = withAlpha(mixColor(C, '#241612', 0.5), 0.8);
  ctx.beginPath();
  ctx.arc(25, 67.5, 0.6, 0, Math.PI * 2);
  ctx.arc(41, 66.5, 0.6, 0, Math.PI * 2);
  ctx.fill();
  // 躯干：低伏宽厚重甲（压向盾）
  ctx.beginPath();
  ctx.moveTo(23, 38);
  ctx.bezierCurveTo(19.5, 47, 20.5, 55, 25, 59.5);
  ctx.lineTo(41, 59.5);
  ctx.bezierCurveTo(46, 54, 47, 45, 43.5, 36.5);
  ctx.closePath();
  ctx.fillStyle = C;
  ctx.fill();
  ctx.fillStyle = withAlpha(dark, 0.72);
  ctx.beginPath();
  ctx.moveTo(23, 46);
  ctx.bezierCurveTo(21.5, 53.5, 23, 57.5, 25.5, 59.5);
  ctx.lineTo(33, 59.5);
  ctx.lineTo(30.5, 45);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = withAlpha(lite, 0.5);
  ctx.beginPath();
  ctx.ellipse(41, 40.5, 3.2, 5.4, 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(23, 38);
  ctx.bezierCurveTo(19.5, 47, 20.5, 55, 25, 59.5);
  ctx.lineTo(41, 59.5);
  ctx.bezierCurveTo(46, 54, 47, 45, 43.5, 36.5);
  ctx.closePath();
  inkPath(ctx);
  // 胸腹三段甲缝 + 铆钉排 + 金饰线
  structPen(ctx, C);
  ctx.beginPath();
  ctx.moveTo(23.5, 44);
  ctx.quadraticCurveTo(33, 47.5, 43.5, 43);
  ctx.moveTo(23.5, 50);
  ctx.quadraticCurveTo(33, 53.5, 43, 49);
  ctx.moveTo(25, 55.5);
  ctx.quadraticCurveTo(33, 58.5, 41.5, 54.5);
  ctx.stroke();
  ctx.fillStyle = withAlpha(mixColor(C, '#241612', 0.5), 0.85);
  ctx.beginPath();
  ctx.arc(26, 45.5, 0.7, 0, Math.PI * 2);
  ctx.arc(33, 47.2, 0.7, 0, Math.PI * 2);
  ctx.arc(40, 45, 0.7, 0, Math.PI * 2);
  ctx.arc(27, 51.4, 0.7, 0, Math.PI * 2);
  ctx.arc(38.5, 50.8, 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = gold;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(24, 41.5);
  ctx.quadraticCurveTo(33, 44.5, 43.5, 40.5);
  ctx.stroke();
  // 左肩巨型肩甲（两片叠层 + 缝线）
  ctx.beginPath();
  ctx.ellipse(24, 37, 7.5, 6, -0.35, 0, Math.PI * 2);
  cel(ctx, lite, 1.8);
  structPen(ctx, C);
  ctx.beginPath();
  ctx.ellipse(24, 37.5, 5.2, 4, -0.35, -2.6, 0.5);
  ctx.stroke();
  ctx.fillStyle = withAlpha(mixColor(C, '#241612', 0.5), 0.85);
  ctx.beginPath();
  ctx.arc(21, 34.5, 0.7, 0, Math.PI * 2);
  ctx.arc(26.5, 33.6, 0.7, 0, Math.PI * 2);
  ctx.fill();
  rimArc(ctx, 24, 37, 7.5, 6, -1.5, -0.4);
  // 头盔（护鼻盔 + 露脸下半）+ 盔下发丝
  headBase(ctx, 35, 27, 11);
  const hairC = '#7a5a3c';
  hairStrand(ctx, 27, 33, 25.5, 36.5, 26.5, 40, hairC, 1.2);
  hairStrand(ctx, 28.5, 34, 27.5, 37.5, 28.6, 40.5, hairC, 1.1);
  hairStrand(ctx, 43.5, 33, 45, 36, 44.4, 39, hairC, 1.2);
  hairStrand(ctx, 42, 34, 43, 37, 42.4, 39.6, hairC, 1);
  hairStrand(ctx, 26, 32, 24.4, 34.5, 24.8, 37.5, mixColor(hairC, '#3a2814', 0.4), 0.9);
  // 盔体
  ctx.beginPath();
  ctx.moveTo(23.8, 25.5);
  ctx.bezierCurveTo(24, 13.5, 46, 12.5, 46.4, 24.5);
  ctx.quadraticCurveTo(46.8, 27, 45.5, 28.5);
  ctx.lineTo(42.5, 27);
  ctx.quadraticCurveTo(35, 24, 27.8, 27);
  ctx.lineTo(24.8, 28.5);
  ctx.quadraticCurveTo(23.6, 27, 23.8, 25.5);
  ctx.closePath();
  cel(ctx, mixColor(C, '#ccd6e4', 0.3), 1.8);
  // 盔脊 + 铆钉 + 护鼻条
  structPen(ctx, C);
  ctx.beginPath();
  ctx.moveTo(26, 21);
  ctx.quadraticCurveTo(35, 15.5, 45, 20.5);
  ctx.stroke();
  ctx.fillStyle = withAlpha(mixColor(C, '#241612', 0.55), 0.85);
  ctx.beginPath();
  ctx.arc(28.5, 22.5, 0.65, 0, Math.PI * 2);
  ctx.arc(35, 20.4, 0.65, 0, Math.PI * 2);
  ctx.arc(41.5, 22, 0.65, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = mixColor(C, '#ccd6e4', 0.15);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(39.5, 26.5);
  ctx.lineTo(39.5, 31.5);
  ctx.stroke();
  // 盔顶金冠脊
  ctx.beginPath();
  ctx.moveTo(29, 15.6);
  ctx.quadraticCurveTo(35, 10.5, 41, 15.4);
  ctx.quadraticCurveTo(35, 13.2, 29, 15.6);
  ctx.closePath();
  cel(ctx, gold, 1.4);
  rimPen(ctx);
  ctx.beginPath();
  ctx.moveTo(36.5, 12.6);
  ctx.quadraticCurveTo(39.5, 13.2, 41, 15);
  ctx.stroke();
  animeFace(ctx, 35, 30.5, { iris: '#4a6a92', blush: false });
  // 前置巨型塔盾（直边 + 圆肩顶，落地抵前）
  ctx.beginPath();
  ctx.moveTo(48, 32);
  ctx.lineTo(62, 30.5);
  ctx.quadraticCurveTo(66.5, 30.5, 66.5, 35);
  ctx.lineTo(66.5, 64);
  ctx.quadraticCurveTo(60, 73.5, 48, 68.5);
  ctx.closePath();
  ctx.fillStyle = mixColor(C, '#dfe7f2', 0.28);
  ctx.fill();
  ctx.fillStyle = withAlpha(dark, 0.5);
  ctx.beginPath();
  ctx.moveTo(48, 47);
  ctx.lineTo(57, 48.5);
  ctx.lineTo(55.5, 70.5);
  ctx.quadraticCurveTo(51, 70.8, 48, 68.5);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(48, 32);
  ctx.lineTo(62, 30.5);
  ctx.quadraticCurveTo(66.5, 30.5, 66.5, 35);
  ctx.lineTo(66.5, 64);
  ctx.quadraticCurveTo(60, 73.5, 48, 68.5);
  ctx.closePath();
  inkPath(ctx, 2.2);
  // 盾面结构：中脊直线 + 横梁 + 六铆钉 + 金框 + 刻痕
  ctx.strokeStyle = gold;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(50, 33.6);
  ctx.lineTo(64.5, 32.6);
  ctx.moveTo(57.2, 32.8);
  ctx.lineTo(57.2, 71);
  ctx.stroke();
  structPen(ctx, C);
  ctx.beginPath();
  ctx.moveTo(48.5, 44);
  ctx.lineTo(66, 44);
  ctx.moveTo(48.5, 57);
  ctx.lineTo(66, 56);
  ctx.stroke();
  ctx.fillStyle = withAlpha(gold, 0.95);
  ctx.beginPath();
  ctx.arc(52, 38.5, 1.1, 0, Math.PI * 2);
  ctx.arc(62.5, 37.8, 1.1, 0, Math.PI * 2);
  ctx.arc(51.5, 50.5, 1.1, 0, Math.PI * 2);
  ctx.arc(63, 50, 1.1, 0, Math.PI * 2);
  ctx.arc(52, 62.5, 1.1, 0, Math.PI * 2);
  ctx.arc(62, 62.5, 1.1, 0, Math.PI * 2);
  ctx.fill();
  detailPen(ctx, C);
  ctx.beginPath();
  ctx.moveTo(53, 41);
  ctx.lineTo(55.5, 43.5);
  ctx.moveTo(60, 59);
  ctx.lineTo(62.5, 61.8);
  ctx.moveTo(50, 53);
  ctx.lineTo(52, 55);
  ctx.stroke();
  rimPen(ctx);
  ctx.beginPath();
  ctx.moveTo(65.3, 33.5);
  ctx.lineTo(65.3, 62);
  ctx.stroke();
  // 持盾拳（甲手套）
  ctx.beginPath();
  ctx.arc(47, 46.5, 3.2, 0, Math.PI * 2);
  cel(ctx, lite, 1.5);
  structPen(ctx, C);
  ctx.beginPath();
  ctx.moveTo(45.4, 45.5);
  ctx.quadraticCurveTo(47, 44.6, 48.8, 45.4);
  ctx.stroke();
}

// ── 2 双刃游侠 ranger（绯红 #dc2626）双弯刃 · 交叉架式 ─────────

function paintRanger(ctx: CanvasRenderingContext2D): void {
  const C = '#dc2626';
  const dark = mixColor(C, '#420808', 0.42);
  const lite = mixColor(C, '#ffd9c8', 0.45);
  const blade = '#e9eff3';
  const leather = '#6a4632';
  // 破口围巾（左后飘，四道褶线）
  ctx.beginPath();
  ctx.moveTo(30, 36);
  ctx.bezierCurveTo(21, 35, 12, 40, 7, 50);
  ctx.lineTo(11.5, 48.5);
  ctx.lineTo(10.5, 53.5);
  ctx.lineTo(16, 50.5);
  ctx.bezierCurveTo(21, 45, 27, 42.5, 32.5, 40.5);
  ctx.closePath();
  cel(ctx, mixColor(C, '#7a1616', 0.25), 1.7);
  structPen(ctx, C);
  ctx.beginPath();
  ctx.moveTo(28, 37.5);
  ctx.quadraticCurveTo(19, 38.5, 12, 44.5);
  ctx.moveTo(29, 39.5);
  ctx.quadraticCurveTo(22, 41, 16, 46.5);
  ctx.moveTo(25, 38);
  ctx.quadraticCurveTo(18, 40, 13, 46);
  ctx.moveTo(21, 41);
  ctx.quadraticCurveTo(16, 43.5, 12.5, 48);
  ctx.stroke();
  // 交叉步双腿（后腿别至前腿后）
  ctx.beginPath();
  ctx.moveTo(31, 56.5);
  ctx.bezierCurveTo(28, 61, 26, 66, 25.5, 70.5);
  ctx.lineTo(31.5, 71);
  ctx.bezierCurveTo(33, 65.5, 34.5, 60.5, 35.5, 57);
  ctx.closePath();
  cel(ctx, dark);
  ctx.beginPath();
  ctx.moveTo(36, 57);
  ctx.bezierCurveTo(39.5, 60.5, 42.5, 65.5, 44, 70.2);
  ctx.lineTo(38, 71);
  ctx.bezierCurveTo(36, 65, 34.5, 61, 33.8, 58);
  ctx.closePath();
  cel(ctx, mixColor(dark, '#000000', 0.15));
  structPen(ctx, C);
  ctx.beginPath();
  ctx.moveTo(28, 63);
  ctx.quadraticCurveTo(29.5, 64.5, 31.5, 63.8);
  ctx.moveTo(39, 63);
  ctx.quadraticCurveTo(40.8, 64.5, 42.5, 63.6);
  ctx.stroke();
  // 紧身皮甲躯干（压低）
  ctx.beginPath();
  ctx.moveTo(28, 41);
  ctx.bezierCurveTo(26, 49, 28, 55.5, 32, 58.5);
  ctx.lineTo(40.5, 58.5);
  ctx.bezierCurveTo(44, 52.5, 44, 45.5, 41, 40);
  ctx.closePath();
  ctx.fillStyle = C;
  ctx.fill();
  ctx.fillStyle = withAlpha(dark, 0.7);
  ctx.beginPath();
  ctx.moveTo(28, 48);
  ctx.quadraticCurveTo(28, 55.5, 32, 58.5);
  ctx.lineTo(36, 58.5);
  ctx.lineTo(33, 47);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = withAlpha(lite, 0.5);
  ctx.beginPath();
  ctx.ellipse(39, 43.5, 2.5, 4.2, 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(28, 41);
  ctx.bezierCurveTo(26, 49, 28, 55.5, 32, 58.5);
  ctx.lineTo(40.5, 58.5);
  ctx.bezierCurveTo(44, 52.5, 44, 45.5, 41, 40);
  ctx.closePath();
  inkPath(ctx);
  // 皮甲绑带（斜带 + 扣针 + 缝线细节）
  ctx.strokeStyle = leather;
  ctx.lineWidth = 1.9;
  ctx.beginPath();
  ctx.moveTo(29, 43.5);
  ctx.lineTo(41.5, 49.5);
  ctx.moveTo(29.5, 52.5);
  ctx.quadraticCurveTo(35, 55, 41, 52);
  ctx.stroke();
  ctx.fillStyle = mixColor(leather, '#e8d8a8', 0.5);
  ctx.beginPath();
  ctx.arc(35.5, 46.6, 1, 0, Math.PI * 2);
  ctx.fill();
  detailPen(ctx, C);
  ctx.beginPath();
  ctx.moveTo(30, 45);
  ctx.lineTo(31.2, 44.2);
  ctx.moveTo(33, 46.4);
  ctx.lineTo(34.2, 45.6);
  ctx.moveTo(38, 48.7);
  ctx.lineTo(39.2, 47.9);
  ctx.stroke();
  // 双弯刃：胸前交叉（每刃脊线 + 刃口白光）
  // 上刃（左手，自左下向右上）
  ctx.beginPath();
  ctx.moveTo(31, 51);
  ctx.quadraticCurveTo(44, 42, 58, 26);
  ctx.quadraticCurveTo(50, 30, 40, 39);
  ctx.quadraticCurveTo(35, 44, 29.5, 48.5);
  ctx.closePath();
  cel(ctx, blade, 1.6);
  structPen(ctx, '#8a9aa4');
  ctx.beginPath();
  ctx.moveTo(33, 48.5);
  ctx.quadraticCurveTo(45, 40, 55.5, 28.5);
  ctx.stroke();
  rimPen(ctx);
  ctx.beginPath();
  ctx.moveTo(36, 47.5);
  ctx.quadraticCurveTo(47, 40, 56.5, 27.5);
  ctx.stroke();
  // 下刃（右手，自左上向右下）
  ctx.beginPath();
  ctx.moveTo(33, 39);
  ctx.quadraticCurveTo(46, 46, 61, 54);
  ctx.quadraticCurveTo(52, 52.5, 41, 46.5);
  ctx.quadraticCurveTo(36.5, 44, 31.8, 41.5);
  ctx.closePath();
  cel(ctx, blade, 1.6);
  structPen(ctx, '#8a9aa4');
  ctx.beginPath();
  ctx.moveTo(35.5, 41.5);
  ctx.quadraticCurveTo(47, 47.5, 58.5, 52.8);
  ctx.stroke();
  rimPen(ctx);
  ctx.beginPath();
  ctx.moveTo(37, 40.6);
  ctx.quadraticCurveTo(48, 46, 59.5, 51.8);
  ctx.stroke();
  // 双持柄手（皮护腕 + 缠绳细节）
  ctx.beginPath();
  ctx.moveTo(27, 46);
  ctx.quadraticCurveTo(29, 44.5, 31.5, 45);
  ctx.quadraticCurveTo(32.5, 48.5, 30, 50);
  ctx.quadraticCurveTo(27.5, 49.5, 26.5, 48);
  ctx.closePath();
  cel(ctx, dark, 1.5);
  ctx.beginPath();
  ctx.arc(31, 47.6, 2.4, 0, Math.PI * 2);
  cel(ctx, SKIN, 1.4);
  ctx.beginPath();
  ctx.moveTo(38.5, 40);
  ctx.quadraticCurveTo(41, 38.6, 43.5, 39.4);
  ctx.quadraticCurveTo(44, 43, 41.5, 44);
  ctx.quadraticCurveTo(39, 43.5, 38, 42);
  ctx.closePath();
  cel(ctx, C, 1.5);
  ctx.beginPath();
  ctx.arc(42.5, 41.4, 2.4, 0, Math.PI * 2);
  cel(ctx, SKIN, 1.4);
  detailPen(ctx, leather);
  ctx.beginPath();
  ctx.moveTo(28, 47);
  ctx.lineTo(30.5, 46);
  ctx.moveTo(39.5, 41);
  ctx.lineTo(42, 40);
  ctx.stroke();
  // 头 + 乱翘短发（8 根发丝）
  headBase(ctx, 36, 27.5, 11.2);
  const hairC = '#5a2e22';
  ctx.beginPath();
  ctx.moveTo(25, 26.5);
  ctx.bezierCurveTo(24.5, 15.5, 46.5, 14, 47.4, 25.5);
  ctx.quadraticCurveTo(43, 19.8, 36, 19.8);
  ctx.quadraticCurveTo(29.5, 20, 25, 26.5);
  ctx.closePath();
  cel(ctx, hairC, 1.7);
  hairStrand(ctx, 44.5, 21, 46, 16.5, 49.5, 15, hairC, 1.3);
  hairStrand(ctx, 41, 18.6, 42.5, 14.5, 45.5, 12.6, hairC, 1.2);
  hairStrand(ctx, 37, 17.6, 37.5, 13.5, 35.5, 11, hairC, 1.2);
  hairStrand(ctx, 32.5, 18, 31, 14.5, 27.5, 13.4, hairC, 1.1);
  hairStrand(ctx, 28.5, 20, 26, 17.5, 22.8, 17.5, hairC, 1.1);
  hairStrand(ctx, 46, 23.5, 48.5, 21, 51, 20.5, hairC, 1);
  hairStrand(ctx, 43, 20, 44.6, 17, 47, 15.6, mixColor(hairC, '#ffd9c8', 0.35), 0.9);
  hairStrand(ctx, 30, 19, 28, 16.4, 25.4, 15.6, mixColor(hairC, '#2a1008', 0.4), 0.9);
  // 颈部围巾结（褶线）
  ctx.beginPath();
  ctx.ellipse(34, 38, 6.2, 3.2, 0.1, 0, Math.PI * 2);
  cel(ctx, mixColor(C, '#7a1616', 0.25), 1.5);
  structPen(ctx, C);
  ctx.beginPath();
  ctx.moveTo(30, 37);
  ctx.quadraticCurveTo(34, 39.5, 38.5, 37.5);
  ctx.moveTo(31.5, 39.5);
  ctx.quadraticCurveTo(34.5, 41, 37.5, 39.8);
  ctx.stroke();
  animeFace(ctx, 36, 29.5, { iris: '#a03026' });
  rimArc(ctx, 36, 27.5, 11.2, 10.5, -1.15, -0.35);
}
// ── 3 烈焰剑士 flameblade（焰橙 #ea580c）大剑扛肩 · 松弛而立 ───────

function paintFlameblade(ctx: CanvasRenderingContext2D): void {
  const C = '#ea580c';
  const armor = '#4a3b38';
  const armorD = mixColor(armor, '#140c0a', 0.45);
  const armorL = mixColor(armor, '#c9b4a8', 0.35);
  const ember = '#ffb03a';
  const steel = '#d2d9dd';
  // 扛肩大剑（先画，压在身后）：直边剑身 + 脊线 + 刃口光 + 余烬纹
  ctx.save();
  ctx.translate(41, 39);
  ctx.rotate(-0.6);
  ctx.beginPath();
  ctx.moveTo(-3.4, -2);
  ctx.lineTo(-3.4, -35);
  ctx.lineTo(0, -41.5);
  ctx.lineTo(3.4, -35);
  ctx.lineTo(3.4, -2);
  ctx.closePath();
  cel(ctx, steel, 1.8);
  structPen(ctx, '#8a9aa4');
  ctx.beginPath();
  ctx.moveTo(0, -3);
  ctx.lineTo(0, -39.5);
  ctx.stroke();
  rimPen(ctx);
  ctx.beginPath();
  ctx.moveTo(2.5, -4);
  ctx.lineTo(2.5, -34.5);
  ctx.stroke();
  // 剑身余烬裂纹（焰橙 + 芯亮）
  ctx.strokeStyle = C;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(-1.4, -8);
  ctx.lineTo(0.8, -13);
  ctx.lineTo(-1, -19);
  ctx.lineTo(1.2, -25);
  ctx.stroke();
  ctx.strokeStyle = withAlpha(ember, 0.9);
  ctx.lineWidth = DETAIL_W;
  ctx.beginPath();
  ctx.moveTo(-1.4, -8);
  ctx.lineTo(0.8, -13);
  ctx.lineTo(-1, -19);
  ctx.stroke();
  // 护手（直线）+ 缠柄 + 圆首
  ctx.beginPath();
  ctx.rect(-7, -2, 14, 3.4);
  cel(ctx, '#8a6a34', 1.5);
  detailPen(ctx, '#8a6a34');
  ctx.beginPath();
  ctx.moveTo(-6, -0.3);
  ctx.lineTo(6, -0.3);
  ctx.stroke();
  ctx.strokeStyle = '#6a4a24';
  ctx.lineWidth = 2.8;
  ctx.beginPath();
  ctx.moveTo(0, 1.6);
  ctx.lineTo(0, 12);
  ctx.stroke();
  structPen(ctx, '#6a4a24');
  ctx.beginPath();
  ctx.moveTo(-1.4, 3.5);
  ctx.lineTo(1.4, 4.5);
  ctx.moveTo(-1.4, 6);
  ctx.lineTo(1.4, 7);
  ctx.moveTo(-1.4, 8.5);
  ctx.lineTo(1.4, 9.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 13.5, 2, 0, Math.PI * 2);
  cel(ctx, '#8a6a34', 1.3);
  ctx.restore();
  // 双腿：右腿承重、左腿松开半步
  ctx.beginPath();
  ctx.moveTo(28, 56.5);
  ctx.bezierCurveTo(26, 61, 25, 66, 25, 70.5);
  ctx.lineTo(31.5, 71);
  ctx.bezierCurveTo(32.5, 65.5, 33.5, 60.5, 34, 57);
  ctx.closePath();
  cel(ctx, armorD);
  ctx.beginPath();
  ctx.moveTo(36.5, 57);
  ctx.bezierCurveTo(39, 61, 41, 66, 41.5, 70.5);
  ctx.lineTo(35, 71);
  ctx.bezierCurveTo(34.5, 65.5, 34.5, 61, 34.8, 58);
  ctx.closePath();
  cel(ctx, armor);
  structPen(ctx, armor);
  ctx.beginPath();
  ctx.moveTo(27, 63.5);
  ctx.quadraticCurveTo(29, 65, 31.5, 64.2);
  ctx.moveTo(36.5, 63.5);
  ctx.quadraticCurveTo(38.5, 65, 40.5, 64.2);
  ctx.stroke();
  // 暗甲躯干
  ctx.beginPath();
  ctx.moveTo(25, 38);
  ctx.bezierCurveTo(22, 47.5, 23.5, 55.5, 27.5, 59.5);
  ctx.lineTo(41, 59.5);
  ctx.bezierCurveTo(45, 53.5, 46, 44.5, 42.5, 36.5);
  ctx.closePath();
  ctx.fillStyle = armor;
  ctx.fill();
  ctx.fillStyle = withAlpha(armorD, 0.8);
  ctx.beginPath();
  ctx.moveTo(25, 46.5);
  ctx.quadraticCurveTo(24, 55.5, 27.5, 59.5);
  ctx.lineTo(33.5, 59.5);
  ctx.lineTo(31, 45.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = withAlpha(armorL, 0.5);
  ctx.beginPath();
  ctx.ellipse(39.5, 40.5, 2.8, 4.6, 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(25, 38);
  ctx.bezierCurveTo(22, 47.5, 23.5, 55.5, 27.5, 59.5);
  ctx.lineTo(41, 59.5);
  ctx.bezierCurveTo(45, 53.5, 46, 44.5, 42.5, 36.5);
  ctx.closePath();
  inkPath(ctx);
  // 甲缝两道 + 铆钉 + 发光余烬裂纹
  structPen(ctx, armor);
  ctx.beginPath();
  ctx.moveTo(25.5, 44.5);
  ctx.quadraticCurveTo(34, 47.5, 43, 43.5);
  ctx.moveTo(26.5, 51);
  ctx.quadraticCurveTo(34, 54, 42.5, 50);
  ctx.stroke();
  ctx.fillStyle = withAlpha(mixColor(armor, '#000000', 0.3), 0.9);
  ctx.beginPath();
  ctx.arc(28, 45.8, 0.7, 0, Math.PI * 2);
  ctx.arc(34.5, 47.4, 0.7, 0, Math.PI * 2);
  ctx.arc(40.5, 45.2, 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(29.5, 42);
  ctx.lineTo(32.5, 46);
  ctx.lineTo(30.5, 51);
  ctx.moveTo(38, 46);
  ctx.lineTo(36.5, 50.5);
  ctx.lineTo(39, 55);
  ctx.stroke();
  ctx.strokeStyle = withAlpha(ember, 0.9);
  ctx.lineWidth = DETAIL_W;
  ctx.beginPath();
  ctx.moveTo(29.5, 42);
  ctx.lineTo(32.5, 46);
  ctx.moveTo(38, 46);
  ctx.lineTo(36.5, 50.5);
  ctx.stroke();
  // 左手叉腰
  ctx.beginPath();
  ctx.moveTo(26.5, 42);
  ctx.quadraticCurveTo(22, 44.5, 23, 48.5);
  ctx.quadraticCurveTo(25, 51, 28, 49.5);
  ctx.quadraticCurveTo(26.5, 46, 28.5, 43.5);
  ctx.closePath();
  cel(ctx, armorD, 1.6);
  // 扛剑肩甲（叠板 + 铆钉）+ 握柄手
  ctx.beginPath();
  ctx.ellipse(43, 36.5, 6.5, 5.4, 0.3, 0, Math.PI * 2);
  cel(ctx, armorL, 1.7);
  structPen(ctx, armor);
  ctx.beginPath();
  ctx.ellipse(43.5, 37, 4.4, 3.5, 0.3, -2.8, 0.4);
  ctx.stroke();
  ctx.fillStyle = withAlpha(mixColor(armor, '#000000', 0.3), 0.9);
  ctx.beginPath();
  ctx.arc(41, 33.8, 0.65, 0, Math.PI * 2);
  ctx.arc(45.8, 34.6, 0.65, 0, Math.PI * 2);
  ctx.fill();
  rimArc(ctx, 43, 36.5, 6.5, 5.4, -1.4, -0.3);
  ctx.beginPath();
  ctx.arc(46.5, 46.5, 2.8, 0, Math.PI * 2);
  cel(ctx, SKIN, 1.4);
  // 头 + 逆立焰发（8 根发丝）
  headBase(ctx, 34, 26, 11.3);
  const hairC = mixColor(C, '#7a2a08', 0.35);
  ctx.beginPath();
  ctx.moveTo(23, 25);
  ctx.bezierCurveTo(23.5, 15.5, 45, 14.5, 45.2, 24.5);
  ctx.quadraticCurveTo(40.5, 19.5, 34, 19.5);
  ctx.quadraticCurveTo(27.5, 19.8, 23, 25);
  ctx.closePath();
  cel(ctx, hairC, 1.7);
  hairStrand(ctx, 28, 18.5, 26.5, 13.5, 28.5, 9.5, hairC, 1.4);
  hairStrand(ctx, 32, 17, 31.5, 12, 34, 8, hairC, 1.4);
  hairStrand(ctx, 36.5, 16.6, 37.5, 12, 40.5, 9, hairC, 1.3);
  hairStrand(ctx, 40.5, 18, 42.5, 14, 45.5, 12, hairC, 1.3);
  hairStrand(ctx, 43.5, 20.5, 46, 17.5, 48.5, 16.5, hairC, 1.1);
  hairStrand(ctx, 25.5, 21, 23.5, 18, 21.5, 17, hairC, 1.1);
  hairStrand(ctx, 33.5, 15, 34, 11, 36, 8.6, withAlpha(ember, 0.85), 0.9);
  hairStrand(ctx, 38.5, 15.5, 40.5, 12, 43, 10.4, withAlpha(ember, 0.75), 0.8);
  animeFace(ctx, 34, 28, { iris: '#c05010', blush: false });
  rimArc(ctx, 34, 26, 11.3, 10.6, -1.1, -0.3);
}

// ── 4 鹰眼射手 archer（草绿 #16a34a）长弓满引 · 侧身箭步 ─────────

function paintArcher(ctx: CanvasRenderingContext2D): void {
  const C = '#16a34a';
  const dark = mixColor(C, '#04321a', 0.42);
  const lite = mixColor(C, '#dcffe8', 0.42);
  const wood = '#8a6234';
  const goldArrow = '#e2b040';
  // 背后箭袋（斜挂）+ 两支箭羽
  ctx.save();
  ctx.translate(24, 43);
  ctx.rotate(0.35);
  ctx.beginPath();
  ctx.rect(-3.6, -2, 7.2, 15);
  cel(ctx, mixColor(wood, '#4a3218', 0.4), 1.6);
  structPen(ctx, wood);
  ctx.beginPath();
  ctx.moveTo(-3.2, 2);
  ctx.lineTo(3.2, 2);
  ctx.moveTo(-3.2, 10.5);
  ctx.lineTo(3.2, 10.5);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = goldArrow;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(21.5, 41);
  ctx.lineTo(17.5, 32.5);
  ctx.moveTo(25, 40);
  ctx.lineTo(23, 31);
  ctx.stroke();
  detailPen(ctx, '#a03830');
  ctx.beginPath();
  ctx.moveTo(17.5, 32.5);
  ctx.lineTo(15, 30);
  ctx.moveTo(17.5, 32.5);
  ctx.lineTo(19.5, 30.5);
  ctx.moveTo(23, 31);
  ctx.lineTo(21, 28.4);
  ctx.moveTo(23, 31);
  ctx.lineTo(25.4, 29);
  ctx.stroke();
  // 弓步双腿（前弓后蹬）
  ctx.beginPath();
  ctx.moveTo(29.5, 56.5);
  ctx.bezierCurveTo(26.5, 61, 24.5, 66, 24, 70.5);
  ctx.lineTo(30, 71);
  ctx.bezierCurveTo(31.5, 65, 33, 60.5, 33.5, 57);
  ctx.closePath();
  cel(ctx, dark);
  ctx.beginPath();
  ctx.moveTo(35.5, 57);
  ctx.bezierCurveTo(38.5, 60.5, 41, 65.5, 42, 70.2);
  ctx.lineTo(35.8, 71);
  ctx.bezierCurveTo(34.5, 65, 33.8, 61, 33.6, 58);
  ctx.closePath();
  cel(ctx, C);
  structPen(ctx, C);
  ctx.beginPath();
  ctx.moveTo(26.5, 63.5);
  ctx.quadraticCurveTo(28.5, 65, 30.5, 64.2);
  ctx.moveTo(37, 63);
  ctx.quadraticCurveTo(39, 64.5, 41, 63.6);
  ctx.stroke();
  // 束腰猎装躯干
  ctx.beginPath();
  ctx.moveTo(27.5, 39.5);
  ctx.bezierCurveTo(25.5, 47.5, 26.5, 54.5, 29.5, 58.5);
  ctx.lineTo(39.5, 58.5);
  ctx.bezierCurveTo(42.5, 52.5, 42.5, 45, 39.8, 38.5);
  ctx.closePath();
  ctx.fillStyle = C;
  ctx.fill();
  ctx.fillStyle = withAlpha(dark, 0.7);
  ctx.beginPath();
  ctx.moveTo(27.5, 47.5);
  ctx.quadraticCurveTo(26.5, 54.5, 29.5, 58.5);
  ctx.lineTo(34, 58.5);
  ctx.lineTo(32, 46.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = withAlpha(lite, 0.5);
  ctx.beginPath();
  ctx.ellipse(37.5, 42.5, 2.5, 4.2, 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(27.5, 39.5);
  ctx.bezierCurveTo(25.5, 47.5, 26.5, 54.5, 29.5, 58.5);
  ctx.lineTo(39.5, 58.5);
  ctx.bezierCurveTo(42.5, 52.5, 42.5, 45, 39.8, 38.5);
  ctx.closePath();
  inkPath(ctx);
  // 猎装衣褶四道 + 腰带扣
  structPen(ctx, C);
  ctx.beginPath();
  ctx.moveTo(29, 43.5);
  ctx.quadraticCurveTo(34, 45.5, 40, 43);
  ctx.moveTo(30, 48);
  ctx.quadraticCurveTo(33.5, 49.5, 37, 48.4);
  ctx.moveTo(31, 54.5);
  ctx.quadraticCurveTo(34, 56, 38, 54.6);
  ctx.moveTo(33.5, 44.5);
  ctx.quadraticCurveTo(33.8, 50, 33, 55);
  ctx.stroke();
  ctx.strokeStyle = mixColor(wood, '#503418', 0.3);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(27.5, 51);
  ctx.quadraticCurveTo(34, 53.5, 41, 50);
  ctx.stroke();
  ctx.fillStyle = mixColor(wood, '#e8d8a8', 0.5);
  ctx.beginPath();
  ctx.arc(34, 52.2, 1.1, 0, Math.PI * 2);
  ctx.fill();
  // 长弓（弓臂两端反曲 + 木纹 + 满引弦）
  ctx.strokeStyle = wood;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(55, 15);
  ctx.quadraticCurveTo(66.5, 40, 55, 65);
  ctx.stroke();
  taperedStroke(ctx, 55, 15, 56.5, 12.5, 59, 12, wood, 2.2);
  taperedStroke(ctx, 55, 65, 56.5, 67.5, 59, 68, wood, 2.2);
  detailPen(ctx, wood);
  ctx.beginPath();
  ctx.moveTo(55.8, 18);
  ctx.quadraticCurveTo(64.5, 40, 55.8, 62);
  ctx.stroke();
  // 握把缠皮
  structPen(ctx, wood);
  ctx.beginPath();
  ctx.moveTo(60.3, 37);
  ctx.lineTo(62.7, 38);
  ctx.moveTo(60.4, 39.5);
  ctx.lineTo(62.8, 40.5);
  ctx.moveTo(60.3, 42);
  ctx.lineTo(62.6, 43);
  ctx.stroke();
  // 弦（拉满至颊）
  ctx.strokeStyle = withAlpha('#f4ead0', 0.95);
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(56.5, 14);
  ctx.lineTo(41, 41);
  ctx.lineTo(56.5, 66);
  ctx.stroke();
  // 金箭（杆 + 三线羽 + 镞脊）
  ctx.strokeStyle = goldArrow;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(41, 41);
  ctx.lineTo(65, 39.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(64.5, 37);
  ctx.lineTo(70.5, 38.9);
  ctx.lineTo(64.5, 41.4);
  ctx.closePath();
  cel(ctx, '#f4d878', 1.3);
  detailPen(ctx, '#8a6a20');
  ctx.beginPath();
  ctx.moveTo(65, 39.2);
  ctx.lineTo(69.5, 38.9);
  ctx.stroke();
  ctx.strokeStyle = '#c8443a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(42, 40.9);
  ctx.lineTo(39, 38.4);
  ctx.moveTo(43.5, 40.8);
  ctx.lineTo(40.5, 38.2);
  ctx.moveTo(42, 41.3);
  ctx.lineTo(39, 43.8);
  ctx.stroke();
  // 前推弓臂 + 满拉后手
  ctx.beginPath();
  ctx.moveTo(38, 43.5);
  ctx.quadraticCurveTo(48, 41.5, 56, 40);
  ctx.quadraticCurveTo(56.5, 43.8, 49, 45.4);
  ctx.quadraticCurveTo(42.5, 46.5, 38, 47);
  ctx.closePath();
  cel(ctx, lite, 1.7);
  structPen(ctx, C);
  ctx.beginPath();
  ctx.moveTo(40, 45.2);
  ctx.quadraticCurveTo(47, 43.8, 53, 42.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(57, 41.6, 2.5, 0, Math.PI * 2);
  cel(ctx, SKIN, 1.4);
  ctx.beginPath();
  ctx.arc(42, 41, 2.5, 0, Math.PI * 2);
  cel(ctx, SKIN, 1.4);
  detailPen(ctx, SKIN_SHADE);
  ctx.beginPath();
  ctx.moveTo(41, 40);
  ctx.lineTo(43, 40.4);
  ctx.moveTo(41, 41.6);
  ctx.lineTo(43, 42);
  ctx.stroke();
  // 兜帽后翻 + 露出短发（7 根发丝）
  headBase(ctx, 35, 26.5, 11);
  const hairC = '#7a5230';
  ctx.beginPath();
  ctx.moveTo(24.4, 25.5);
  ctx.bezierCurveTo(25, 15.5, 45.5, 14.5, 45.8, 24.8);
  ctx.quadraticCurveTo(41, 19.6, 35, 19.6);
  ctx.quadraticCurveTo(28.8, 19.8, 24.4, 25.5);
  ctx.closePath();
  cel(ctx, hairC, 1.7);
  hairStrand(ctx, 44, 20.5, 45.5, 16.5, 48, 15, hairC, 1.2);
  hairStrand(ctx, 40.5, 18.4, 41.5, 14.5, 44, 12.6, hairC, 1.2);
  hairStrand(ctx, 36, 17.5, 36, 13.5, 37.5, 11, hairC, 1.2);
  hairStrand(ctx, 31.5, 18.2, 30, 14.8, 27.5, 13.6, hairC, 1.1);
  hairStrand(ctx, 27.5, 20.5, 25.5, 18, 23, 17.6, hairC, 1);
  hairStrand(ctx, 42.5, 19.4, 43.8, 16.4, 46, 14.8, mixColor(hairC, '#f0e0b8', 0.35), 0.9);
  hairStrand(ctx, 29.5, 19.2, 27.6, 16.6, 25.2, 15.8, mixColor(hairC, '#2a1c08', 0.4), 0.9);
  // 后翻兜帽（领口 + 三道褶线）
  ctx.beginPath();
  ctx.moveTo(25, 32);
  ctx.bezierCurveTo(20, 34, 18, 39, 20, 43);
  ctx.bezierCurveTo(24, 43.5, 28, 41, 30, 37.5);
  ctx.quadraticCurveTo(27, 34.5, 25, 32);
  ctx.closePath();
  cel(ctx, mixColor(C, '#0b5c2e', 0.3), 1.6);
  structPen(ctx, C);
  ctx.beginPath();
  ctx.moveTo(24, 34.5);
  ctx.quadraticCurveTo(21.5, 37.5, 22, 41);
  ctx.moveTo(26.5, 35.5);
  ctx.quadraticCurveTo(24.5, 38, 24.5, 41.5);
  ctx.moveTo(28.5, 37);
  ctx.quadraticCurveTo(27, 39, 27, 41.5);
  ctx.stroke();
  animeFace(ctx, 35, 28.5, { iris: '#2a7a3c' });
  rimArc(ctx, 35, 26.5, 11, 10.3, -1.1, -0.3);
}
// ── 5 星辉法师 caster（星紫 #7c3aed）星杖引咒 · 前手施法 ─────────

/** 四芒星路径（凹菱形）。 */
function star4Path(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const inner = r * 0.34;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx + inner * 0.3, cy - inner, cx + r, cy);
  ctx.quadraticCurveTo(cx + inner * 0.3, cy + inner, cx, cy + r);
  ctx.quadraticCurveTo(cx - inner * 0.3, cy + inner, cx - r, cy);
  ctx.quadraticCurveTo(cx - inner * 0.3, cy - inner, cx, cy - r);
  ctx.closePath();
}

function paintCaster(ctx: CanvasRenderingContext2D): void {
  const C = '#7c3aed';
  const dark = mixColor(C, '#1e0a52', 0.42);
  const lite = mixColor(C, '#e8dcff', 0.45);
  const star = '#ffe27a';
  const wood = '#6a5238';
  // 星杖（身后斜持）：杆 + 木纹曲线
  ctx.strokeStyle = wood;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(26, 20);
  ctx.quadraticCurveTo(24.5, 44, 26, 68);
  ctx.stroke();
  detailPen(ctx, wood);
  ctx.beginPath();
  ctx.moveTo(26.8, 24);
  ctx.quadraticCurveTo(25.4, 44, 26.6, 64);
  ctx.stroke();
  // 杖顶星晶（晶面直线分割 + 辉光圈）
  ctx.fillStyle = withAlpha(star, 0.28);
  ctx.beginPath();
  ctx.arc(26.5, 14, 8, 0, Math.PI * 2);
  ctx.fill();
  star4Path(ctx, 26.5, 14, 6.4);
  cel(ctx, star, 1.3);
  structPen(ctx, '#a8842a');
  ctx.beginPath();
  ctx.moveTo(26.5, 8.4);
  ctx.lineTo(26.5, 19.6);
  ctx.moveTo(21, 14);
  ctx.lineTo(32, 14);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.arc(28, 11.8, 1, 0, Math.PI * 2);
  ctx.fill();
  // 长袍（钟形盖脚，五道褶线 + 星纹）
  ctx.beginPath();
  ctx.moveTo(29, 38);
  ctx.bezierCurveTo(23.5, 48, 21, 62, 23, 70);
  ctx.quadraticCurveTo(35.5, 73.5, 47.5, 70);
  ctx.bezierCurveTo(49.5, 60, 46.5, 47, 41.5, 37);
  ctx.closePath();
  ctx.fillStyle = C;
  ctx.fill();
  ctx.fillStyle = withAlpha(dark, 0.75);
  ctx.beginPath();
  ctx.moveTo(29, 46);
  ctx.bezierCurveTo(24.5, 55, 22, 64, 23, 70);
  ctx.quadraticCurveTo(28.5, 71.8, 34, 71.5);
  ctx.bezierCurveTo(32, 62, 31.5, 52, 33, 45);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = withAlpha(lite, 0.5);
  ctx.beginPath();
  ctx.ellipse(42, 47, 3.4, 8, 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(29, 38);
  ctx.bezierCurveTo(23.5, 48, 21, 62, 23, 70);
  ctx.quadraticCurveTo(35.5, 73.5, 47.5, 70);
  ctx.bezierCurveTo(49.5, 60, 46.5, 47, 41.5, 37);
  ctx.closePath();
  inkPath(ctx);
  structPen(ctx, C);
  ctx.beginPath();
  ctx.moveTo(31, 44);
  ctx.quadraticCurveTo(30, 57, 29, 69.5);
  ctx.moveTo(35.5, 46);
  ctx.quadraticCurveTo(35.8, 58, 35.5, 71);
  ctx.moveTo(40, 45);
  ctx.quadraticCurveTo(41.5, 57, 42, 70);
  ctx.moveTo(44, 49);
  ctx.quadraticCurveTo(45.8, 59, 46, 68.5);
  ctx.moveTo(27, 50);
  ctx.quadraticCurveTo(25.5, 60, 25.2, 68);
  ctx.stroke();
  ctx.fillStyle = withAlpha(star, 0.9);
  star4Path(ctx, 31, 59, 2.2);
  ctx.fill();
  star4Path(ctx, 42.5, 63.5, 1.8);
  ctx.fill();
  // 袍摆金边
  detailPen(ctx, '#a8842a');
  ctx.beginPath();
  ctx.moveTo(24, 68.6);
  ctx.quadraticCurveTo(35.5, 71.8, 46.5, 68.6);
  ctx.stroke();
  // 施法前臂：袖口喇叭 + 掌心引星
  ctx.beginPath();
  ctx.moveTo(40, 42);
  ctx.bezierCurveTo(46, 40, 51, 39.5, 55, 40.5);
  ctx.quadraticCurveTo(55.5, 45, 49.5, 46.5);
  ctx.bezierCurveTo(45, 47, 41.5, 46.5, 39.5, 45.5);
  ctx.closePath();
  cel(ctx, lite, 1.7);
  structPen(ctx, C);
  ctx.beginPath();
  ctx.moveTo(42, 43.5);
  ctx.quadraticCurveTo(47, 42.4, 52, 42.5);
  ctx.moveTo(52.5, 40.6);
  ctx.quadraticCurveTo(53.5, 43, 52, 45.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(56.8, 42.6, 2.6, 0, Math.PI * 2);
  cel(ctx, SKIN, 1.4);
  // 掌前星辉（三粒星 + 引线）
  ctx.fillStyle = star;
  star4Path(ctx, 63, 36, 3.2);
  ctx.fill();
  star4Path(ctx, 66.5, 44, 2.2);
  ctx.fill();
  star4Path(ctx, 61, 49.5, 1.7);
  ctx.fill();
  detailPen(ctx, '#c8a030');
  ctx.beginPath();
  ctx.moveTo(59, 41);
  ctx.quadraticCurveTo(61.5, 38.5, 62.5, 37.5);
  ctx.moveTo(59.5, 43.5);
  ctx.quadraticCurveTo(63, 44, 65, 44);
  ctx.moveTo(59, 45.5);
  ctx.quadraticCurveTo(60, 47.5, 60.6, 48.6);
  ctx.stroke();
  // 头 + 垂发（7 根发丝）
  headBase(ctx, 34, 29, 11);
  const hairC = '#7a5ab8';
  ctx.beginPath();
  ctx.moveTo(23.4, 28);
  ctx.bezierCurveTo(24, 18.5, 44.5, 17.5, 44.8, 27.5);
  ctx.quadraticCurveTo(40, 22.6, 34, 22.6);
  ctx.quadraticCurveTo(27.8, 22.8, 23.4, 28);
  ctx.closePath();
  cel(ctx, hairC, 1.6);
  hairStrand(ctx, 23.8, 27.5, 22, 33, 23.5, 39, hairC, 1.3);
  hairStrand(ctx, 25.5, 26.5, 24.5, 32, 26, 37.5, hairC, 1.2);
  hairStrand(ctx, 44.4, 27, 46, 32, 45, 37, hairC, 1.3);
  hairStrand(ctx, 42.6, 26, 43.8, 31, 43, 35.5, hairC, 1.1);
  hairStrand(ctx, 28, 24.5, 27, 28.5, 28, 32.5, mixColor(hairC, '#2a1460', 0.35), 0.9);
  hairStrand(ctx, 40.5, 24.4, 41.5, 28, 41, 31.5, mixColor(hairC, '#f0e8ff', 0.4), 0.9);
  hairStrand(ctx, 34, 22.8, 33.5, 25.5, 34.5, 28, mixColor(hairC, '#2a1460', 0.3), 0.8);
  // 宽檐尖帽（弯折帽尖 + 星饰 + 帽褶）
  ctx.beginPath();
  ctx.ellipse(34, 22, 18.5, 5.4, -0.12, 0, Math.PI * 2);
  cel(ctx, mixColor(C, '#3b1690', 0.3), 1.8);
  structPen(ctx, C);
  ctx.beginPath();
  ctx.ellipse(34, 22.6, 14.5, 3.6, -0.12, 3.5, 6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(24.5, 21);
  ctx.bezierCurveTo(25.5, 11.5, 31, 5.5, 38, 4.5);
  ctx.quadraticCurveTo(37, 8.5, 40, 9.5);
  ctx.quadraticCurveTo(43.5, 15, 43.5, 21.4);
  ctx.quadraticCurveTo(34, 25.4, 24.5, 21);
  ctx.closePath();
  ctx.fillStyle = C;
  ctx.fill();
  ctx.fillStyle = withAlpha(dark, 0.65);
  ctx.beginPath();
  ctx.moveTo(24.5, 21);
  ctx.quadraticCurveTo(26, 13, 30.5, 8.5);
  ctx.quadraticCurveTo(28, 15.5, 28.5, 22.2);
  ctx.quadraticCurveTo(26.2, 22, 24.5, 21);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(24.5, 21);
  ctx.bezierCurveTo(25.5, 11.5, 31, 5.5, 38, 4.5);
  ctx.quadraticCurveTo(37, 8.5, 40, 9.5);
  ctx.quadraticCurveTo(43.5, 15, 43.5, 21.4);
  ctx.quadraticCurveTo(34, 25.4, 24.5, 21);
  ctx.closePath();
  inkPath(ctx);
  // 弯折小帽尖
  ctx.beginPath();
  ctx.moveTo(38, 4.5);
  ctx.quadraticCurveTo(43, 3.5, 44.5, 6.5);
  ctx.quadraticCurveTo(41.5, 7, 40, 9.5);
  ctx.quadraticCurveTo(37.5, 8, 38, 4.5);
  ctx.closePath();
  cel(ctx, mixColor(C, '#3b1690', 0.25), 1.5);
  structPen(ctx, C);
  ctx.beginPath();
  ctx.moveTo(31.5, 10);
  ctx.quadraticCurveTo(30, 15.5, 30.5, 21.5);
  ctx.moveTo(36.5, 8.5);
  ctx.quadraticCurveTo(35.5, 14.5, 36, 22);
  ctx.stroke();
  ctx.fillStyle = star;
  star4Path(ctx, 39.5, 14, 2.8);
  ctx.fill();
  star4Path(ctx, 31, 16.5, 1.8);
  ctx.fill();
  rimPen(ctx);
  ctx.beginPath();
  ctx.moveTo(38.5, 5.5);
  ctx.quadraticCurveTo(42, 10, 43, 15.5);
  ctx.stroke();
  animeFace(ctx, 34, 31, { iris: '#5a3ab8' });
}

// ── 6 月光医师 medic（青碧 #0891b2）提灯高举 · 月光普照 ─────────

function paintMedic(ctx: CanvasRenderingContext2D): void {
  const C = '#0891b2';
  const robe = '#eef8f4';
  const robeShade = '#c2ddd6';
  const moon = '#ffe9a0';
  const wood = '#b8926a';
  // 高举灯杖（斜向右上）+ 木纹
  ctx.strokeStyle = wood;
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(45, 46);
  ctx.lineTo(58, 14);
  ctx.stroke();
  detailPen(ctx, wood);
  ctx.beginPath();
  ctx.moveTo(46.2, 44);
  ctx.lineTo(58.2, 16.5);
  ctx.stroke();
  // 杖首弯钩 + 挂链
  ctx.strokeStyle = wood;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(58, 14);
  ctx.quadraticCurveTo(62.5, 11.5, 64, 15.5);
  ctx.stroke();
  ctx.strokeStyle = '#8a7452';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(64, 15.5);
  ctx.lineTo(64.3, 19.5);
  ctx.stroke();
  // 新月提灯（辉光 + 月牙 + 灯框细线）
  ctx.fillStyle = withAlpha(moon, 0.3);
  ctx.beginPath();
  ctx.arc(64.5, 26, 8.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(64.5, 26, 5.6, -1.9, 1.55, false);
  ctx.arc(62.3, 25.4, 4.3, 1.35, -1.7, true);
  ctx.closePath();
  cel(ctx, moon, 1.4);
  detailPen(ctx, '#b89040');
  ctx.beginPath();
  ctx.arc(64.5, 26, 6.8, -1.6, 1.4);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(66.8, 22.8, 1, 0, Math.PI * 2);
  ctx.fill();
  // 长袍（柔和铃形，五道褶线）
  ctx.beginPath();
  ctx.moveTo(29, 37);
  ctx.bezierCurveTo(24, 47, 21.5, 61, 24, 70);
  ctx.quadraticCurveTo(35.5, 73.5, 46.5, 70);
  ctx.bezierCurveTo(48.5, 60, 45.5, 46, 40.5, 36);
  ctx.closePath();
  ctx.fillStyle = robe;
  ctx.fill();
  ctx.fillStyle = withAlpha(robeShade, 0.85);
  ctx.beginPath();
  ctx.moveTo(29, 45);
  ctx.bezierCurveTo(25.5, 55, 23.5, 64, 24, 70);
  ctx.quadraticCurveTo(29.5, 71.8, 34.5, 71.5);
  ctx.bezierCurveTo(33, 62, 32.5, 52, 33.5, 44);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(29, 37);
  ctx.bezierCurveTo(24, 47, 21.5, 61, 24, 70);
  ctx.quadraticCurveTo(35.5, 73.5, 46.5, 70);
  ctx.bezierCurveTo(48.5, 60, 45.5, 46, 40.5, 36);
  ctx.closePath();
  inkPath(ctx);
  structPen(ctx, '#4a8a94');
  ctx.beginPath();
  ctx.moveTo(31, 44);
  ctx.quadraticCurveTo(30, 57, 28.5, 69);
  ctx.moveTo(36, 46);
  ctx.quadraticCurveTo(36.5, 58, 36, 71);
  ctx.moveTo(40.5, 44);
  ctx.quadraticCurveTo(42, 56, 42.5, 70);
  ctx.moveTo(27, 51);
  ctx.quadraticCurveTo(25.5, 60, 25.5, 68);
  ctx.moveTo(44, 49);
  ctx.quadraticCurveTo(45.5, 58, 45.8, 67.5);
  ctx.stroke();
  // 袍缘青碧滚边（双线）+ 胸前月徽
  ctx.strokeStyle = C;
  ctx.lineWidth = 1.9;
  ctx.beginPath();
  ctx.moveTo(25, 67);
  ctx.quadraticCurveTo(35.5, 70.5, 45.5, 67);
  ctx.stroke();
  detailPen(ctx, C);
  ctx.beginPath();
  ctx.moveTo(25.5, 65.2);
  ctx.quadraticCurveTo(35.5, 68.6, 45, 65.2);
  ctx.stroke();
  ctx.fillStyle = C;
  ctx.beginPath();
  ctx.arc(35.5, 44, 3.2, 0.6, Math.PI * 2 - 0.6 + Math.PI, false);
  ctx.arc(36.9, 43.3, 2.4, Math.PI * 2 - 0.9 + Math.PI, 0.9, true);
  ctx.closePath();
  ctx.fill();
  detailPen(ctx, C);
  ctx.beginPath();
  ctx.arc(35.5, 44, 4.2, -0.6, 1.2);
  ctx.stroke();
  // 举灯臂（袖内收紧向上）+ 手
  ctx.beginPath();
  ctx.moveTo(39, 40);
  ctx.bezierCurveTo(42, 37, 44.5, 33, 46, 29.5);
  ctx.quadraticCurveTo(49.5, 30.5, 49, 34);
  ctx.bezierCurveTo(47.5, 38, 45, 41.5, 42, 44);
  ctx.closePath();
  cel(ctx, robe, 1.7);
  structPen(ctx, '#4a8a94');
  ctx.beginPath();
  ctx.moveTo(41.5, 40.5);
  ctx.quadraticCurveTo(44, 37, 46, 33);
  ctx.moveTo(45.6, 30.5);
  ctx.quadraticCurveTo(47.5, 31.5, 47.8, 33.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(48.3, 28.4, 2.5, 0, Math.PI * 2);
  cel(ctx, SKIN, 1.4);
  // 头 + 中分长发（7 根发丝）+ 侧发束与发饰
  headBase(ctx, 34, 26.5, 11);
  const hairC = '#5f8a94';
  ctx.beginPath();
  ctx.moveTo(23.4, 25.5);
  ctx.bezierCurveTo(24, 15.5, 44.5, 14.5, 44.8, 25);
  ctx.quadraticCurveTo(40, 19.6, 34.5, 19.6);
  ctx.quadraticCurveTo(28.2, 19.8, 23.4, 25.5);
  ctx.closePath();
  cel(ctx, hairC, 1.6);
  hairStrand(ctx, 34.5, 16.5, 30, 17, 26.5, 20, hairC, 1.2);
  hairStrand(ctx, 34.5, 16.5, 39, 17, 42.5, 20, hairC, 1.2);
  hairStrand(ctx, 23.6, 25, 21.8, 31.5, 23.5, 39, hairC, 1.4);
  hairStrand(ctx, 25.6, 25, 24.2, 31, 25.8, 37.5, hairC, 1.2);
  hairStrand(ctx, 44.6, 25, 46.4, 30.5, 45.4, 36, hairC, 1.3);
  hairStrand(ctx, 30, 18, 27.6, 19.6, 25.4, 22.6, mixColor(hairC, '#e8f6f2', 0.4), 0.9);
  hairStrand(ctx, 39.5, 18.2, 41.8, 20, 43.4, 23, mixColor(hairC, '#243c44', 0.4), 0.9);
  ctx.fillStyle = moon;
  ctx.beginPath();
  ctx.arc(27, 19, 1.8, 0, Math.PI * 2);
  ctx.fill();
  detailPen(ctx, '#b89040');
  ctx.beginPath();
  ctx.arc(27, 19, 1.8, 0, Math.PI * 2);
  ctx.stroke();
  animeFace(ctx, 34, 28.5, { iris: '#2a7a8c' });
  rimArc(ctx, 34, 26.5, 11, 10.3, -1.1, -0.3);
}
// ── 7 幸运锦鲤 koi（赤金）鲤鱼精灵 · 跃弧越金珠 · 缎带长鳍 ────────

function paintKoi(ctx: CanvasRenderingContext2D): void {
  const red = '#e11d48';
  const gold = '#f0b429';
  const body = '#fdf6ee';
  const bodyShade = '#e8d3c2';
  const fin = '#ffd9e2';
  // 金色水珠（锚点上方）：辉光 + 珠体 + 晶面高光
  ctx.fillStyle = withAlpha(gold, 0.25);
  ctx.beginPath();
  ctx.ellipse(36, 63, 13, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(36, 63, 9, 7.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = mixColor(gold, '#ffe9b0', 0.45);
  ctx.fill();
  ctx.fillStyle = withAlpha(mixColor(gold, '#8a5a10', 0.45), 0.65);
  ctx.beginPath();
  ctx.ellipse(33.5, 65.8, 5, 3.2, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(36, 63, 9, 7.5, 0, 0, Math.PI * 2);
  inkPath(ctx, 1.7);
  structPen(ctx, gold);
  ctx.beginPath();
  ctx.ellipse(36, 63, 6.4, 5.2, 0, -2.4, 0.6);
  ctx.stroke();
  rimPen(ctx);
  ctx.beginPath();
  ctx.ellipse(38.5, 60.5, 3.4, 2.4, -0.5, -2.4, 0.4);
  ctx.stroke();
  // 溅起水滴 + 细水线
  ctx.fillStyle = withAlpha(gold, 0.7);
  ctx.beginPath();
  ctx.arc(25, 56.5, 1.5, 0, Math.PI * 2);
  ctx.arc(48, 58, 1.2, 0, Math.PI * 2);
  ctx.arc(43, 53, 0.9, 0, Math.PI * 2);
  ctx.fill();
  detailPen(ctx, gold);
  ctx.beginPath();
  ctx.moveTo(27, 59);
  ctx.quadraticCurveTo(25.5, 57.5, 25.6, 55.5);
  ctx.moveTo(45.5, 60);
  ctx.quadraticCurveTo(47.5, 58.5, 47.6, 56.5);
  ctx.stroke();
  // 缎带尾鳍（左后长飘，三条收锋长缎带）
  ctx.beginPath();
  ctx.moveTo(21, 36);
  ctx.bezierCurveTo(13, 28, 6.5, 33, 6, 43);
  ctx.bezierCurveTo(10.5, 39.5, 13.5, 44, 11.5, 50);
  ctx.bezierCurveTo(18, 47.5, 22.5, 42, 23.5, 38.5);
  ctx.closePath();
  cel(ctx, withAlpha(fin, 0.88), 1.5);
  taperedStroke(ctx, 21, 37.5, 13, 33, 7.5, 36, withAlpha(red, 0.5), 1.4);
  taperedStroke(ctx, 21.5, 40, 15, 40, 9, 44.5, withAlpha(red, 0.45), 1.3);
  taperedStroke(ctx, 21, 42.5, 16.5, 44.5, 12.5, 48.5, withAlpha(red, 0.4), 1.2);
  detailPen(ctx, red);
  ctx.beginPath();
  ctx.moveTo(19, 36);
  ctx.quadraticCurveTo(12.5, 33.5, 8.5, 37);
  ctx.moveTo(19.5, 44);
  ctx.quadraticCurveTo(15, 46.5, 12.5, 49);
  ctx.stroke();
  // 鱼身：跃弧（头右下、尾左上的胖弓形）
  ctx.beginPath();
  ctx.moveTo(21, 38);
  ctx.bezierCurveTo(23, 25, 39, 18.5, 50, 26);
  ctx.bezierCurveTo(58.5, 32.5, 57.5, 45, 47, 50);
  ctx.bezierCurveTo(36.5, 54.5, 24.5, 48.5, 21, 38);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();
  ctx.fillStyle = withAlpha(bodyShade, 0.8);
  ctx.beginPath();
  ctx.moveTo(23.5, 43);
  ctx.bezierCurveTo(30, 51.5, 41.5, 52.5, 47.5, 48.5);
  ctx.bezierCurveTo(40.5, 51, 30, 49.5, 23.5, 43);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(33, 45.5, 9.5, 3.8, 0.15, 0, Math.PI * 2);
  ctx.fill();
  // 红斑 + 金斑
  ctx.fillStyle = red;
  ctx.beginPath();
  ctx.ellipse(34.5, 27.5, 6.6, 4.6, -0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(26, 37.5, 4, 3, 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = gold;
  ctx.beginPath();
  ctx.ellipse(45, 33.5, 4, 3, 0.4, 0, Math.PI * 2);
  ctx.fill();
  // 轮廓 + 鳞排（三列细弧）+ 边缘光
  ctx.beginPath();
  ctx.moveTo(21, 38);
  ctx.bezierCurveTo(23, 25, 39, 18.5, 50, 26);
  ctx.bezierCurveTo(58.5, 32.5, 57.5, 45, 47, 50);
  ctx.bezierCurveTo(36.5, 54.5, 24.5, 48.5, 21, 38);
  ctx.closePath();
  inkPath(ctx);
  detailPen(ctx, '#b08a6a');
  ctx.beginPath();
  ctx.arc(30, 36, 3.4, -0.7, 1.1);
  ctx.arc(35.5, 38, 3.4, -0.7, 1.1);
  ctx.arc(41, 39, 3.4, -0.6, 1.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(32.5, 31.5, 3.2, -0.6, 1);
  ctx.arc(38.5, 33, 3.2, -0.6, 1);
  ctx.stroke();
  structPen(ctx, '#b08a6a');
  ctx.beginPath();
  ctx.moveTo(24, 34);
  ctx.quadraticCurveTo(33, 43, 46, 44.5);
  ctx.stroke();
  rimPen(ctx);
  ctx.beginPath();
  ctx.moveTo(38, 20.6);
  ctx.quadraticCurveTo(48, 21.6, 53, 29);
  ctx.stroke();
  // 背鳍（纱质 + 鳍条三线）
  ctx.beginPath();
  ctx.moveTo(29, 23);
  ctx.quadraticCurveTo(30, 13.5, 38, 12);
  ctx.quadraticCurveTo(36.5, 17.5, 39.5, 20.5);
  ctx.quadraticCurveTo(33.5, 20.5, 29, 23);
  ctx.closePath();
  cel(ctx, withAlpha(fin, 0.9), 1.5);
  detailPen(ctx, red);
  ctx.beginPath();
  ctx.moveTo(31, 21.5);
  ctx.quadraticCurveTo(31.8, 16.5, 35, 13.6);
  ctx.moveTo(33.5, 21);
  ctx.quadraticCurveTo(34.5, 17.5, 36.8, 15);
  ctx.moveTo(36.5, 20.6);
  ctx.quadraticCurveTo(36.8, 18, 37.6, 15.8);
  ctx.stroke();
  // 胸鳍缎带（右前长飘两条）
  taperedStroke(ctx, 44, 44, 52, 48, 54, 57, withAlpha(fin, 0.95), 3.2);
  taperedStroke(ctx, 42, 46.5, 48, 51, 48.5, 58.5, withAlpha(fin, 0.8), 2.4);
  detailPen(ctx, red);
  ctx.beginPath();
  ctx.moveTo(45, 45.5);
  ctx.quadraticCurveTo(51, 49.5, 52.8, 55.5);
  ctx.stroke();
  // 侧脸大眼（虹膜 + 高光）+ 腮红 + 触须
  ctx.fillStyle = '#7a3020';
  ctx.beginPath();
  ctx.ellipse(46.5, 34.5, 2.3, 2.9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(28,18,16,0.9)';
  ctx.beginPath();
  ctx.ellipse(46.7, 34.8, 1.1, 1.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.arc(47.3, 33.5, 0.7, 0, Math.PI * 2);
  ctx.fill();
  taperedStroke(ctx, 44, 32.5, 46.5, 30.8, 49, 32.2, INK, 1.3);
  ctx.fillStyle = 'rgba(240,140,130,0.3)';
  ctx.beginPath();
  ctx.ellipse(49.5, 39.5, 2.2, 1.2, 0.3, 0, Math.PI * 2);
  ctx.fill();
  taperedStroke(ctx, 53.5, 39.5, 58.5, 41.5, 58, 46.5, withAlpha('#c98a2a', 0.9), 1.3);
  taperedStroke(ctx, 52, 42.5, 55.5, 45, 54, 49.5, withAlpha('#c98a2a', 0.8), 1.1);
  // 小嘴 + 头顶幸运金珠
  taperedStroke(ctx, 52.5, 36.5, 54, 37.6, 55.2, 36.8, 'rgba(120,66,50,0.85)', 1);
  ctx.beginPath();
  ctx.arc(49, 19.5, 2, 0, Math.PI * 2);
  cel(ctx, gold, 1.2);
  rimPen(ctx);
  ctx.beginPath();
  ctx.arc(49, 19.5, 1.2, -2.2, -0.6);
  ctx.stroke();
}

// ── 8 影袭刺客 phantom（墨黑 #111827）反手匕首 · 低伏蓄势 ────────

function paintPhantom(ctx: CanvasRenderingContext2D): void {
  const C = '#111827';
  const cloak = mixColor(C, '#3b4258', 0.45);
  const cloakD = mixColor(C, '#05070d', 0.5);
  const cloakL = mixColor(C, '#8b93ab', 0.5);
  const wisp = '#8a7ff0';
  // 身后魂雾残影（雾带 + 两缕螺旋细线 + 光点）
  ctx.fillStyle = withAlpha(wisp, 0.2);
  ctx.beginPath();
  ctx.moveTo(26, 36);
  ctx.bezierCurveTo(15, 35, 7, 44, 5.5, 56);
  ctx.bezierCurveTo(10, 51.5, 13.5, 55, 12, 61);
  ctx.bezierCurveTo(18, 56.5, 22, 48, 27, 43);
  ctx.closePath();
  ctx.fill();
  taperedStroke(ctx, 25, 40, 15, 40, 9, 49, withAlpha(wisp, 0.5), 1.3);
  taperedStroke(ctx, 24, 45, 17, 48, 13, 56, withAlpha(wisp, 0.4), 1.1);
  detailPen(ctx, wisp);
  ctx.beginPath();
  ctx.moveTo(22, 42);
  ctx.quadraticCurveTo(14, 44.5, 10.5, 52);
  ctx.stroke();
  ctx.fillStyle = withAlpha(wisp, 0.4);
  ctx.beginPath();
  ctx.arc(11, 47, 1.5, 0, Math.PI * 2);
  ctx.arc(17, 55, 1.1, 0, Math.PI * 2);
  ctx.arc(8, 55, 0.8, 0, Math.PI * 2);
  ctx.fill();
  // 低伏双腿：后腿深蹲、前腿探出
  ctx.beginPath();
  ctx.moveTo(29, 55);
  ctx.bezierCurveTo(25, 59, 23.5, 64.5, 23.5, 70);
  ctx.lineTo(29.5, 71);
  ctx.bezierCurveTo(31, 64.5, 32.5, 59.5, 34, 56);
  ctx.closePath();
  cel(ctx, cloakD);
  ctx.beginPath();
  ctx.moveTo(36, 56.5);
  ctx.bezierCurveTo(40.5, 59.5, 44, 64.5, 45.5, 70);
  ctx.lineTo(39, 71);
  ctx.bezierCurveTo(37, 64.5, 35.5, 60, 34.8, 57.5);
  ctx.closePath();
  cel(ctx, cloak);
  structPen(ctx, cloakL);
  ctx.beginPath();
  ctx.moveTo(25.5, 62.5);
  ctx.quadraticCurveTo(27.5, 64, 29.8, 63.4);
  ctx.moveTo(40, 62.5);
  ctx.quadraticCurveTo(42, 64.2, 44, 63.4);
  ctx.stroke();
  // 斗篷躯干（低伏前探，下摆破口）
  ctx.beginPath();
  ctx.moveTo(28, 39);
  ctx.bezierCurveTo(25, 46.5, 25, 53.5, 28, 58.5);
  ctx.lineTo(31, 56);
  ctx.lineTo(34, 59.5);
  ctx.lineTo(37, 56);
  ctx.lineTo(40, 59);
  ctx.bezierCurveTo(44, 52.5, 44, 45, 41, 37.5);
  ctx.closePath();
  ctx.fillStyle = cloak;
  ctx.fill();
  ctx.fillStyle = withAlpha(cloakD, 0.85);
  ctx.beginPath();
  ctx.moveTo(28, 46);
  ctx.quadraticCurveTo(26, 53.5, 28, 58.5);
  ctx.lineTo(31, 56);
  ctx.lineTo(34, 59.5);
  ctx.lineTo(33, 45);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = withAlpha(cloakL, 0.4);
  ctx.beginPath();
  ctx.ellipse(39, 41.5, 2.4, 4.4, 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(28, 39);
  ctx.bezierCurveTo(25, 46.5, 25, 53.5, 28, 58.5);
  ctx.lineTo(31, 56);
  ctx.lineTo(34, 59.5);
  ctx.lineTo(37, 56);
  ctx.lineTo(40, 59);
  ctx.bezierCurveTo(44, 52.5, 44, 45, 41, 37.5);
  ctx.closePath();
  inkPath(ctx);
  // 斗篷褶线四道 + 腰间紫束带（双线）
  structPen(ctx, cloakL);
  ctx.beginPath();
  ctx.moveTo(30, 42);
  ctx.quadraticCurveTo(29.5, 49, 30, 55);
  ctx.moveTo(34, 43);
  ctx.quadraticCurveTo(34.2, 50, 34, 57);
  ctx.moveTo(38, 42);
  ctx.quadraticCurveTo(39, 49, 38.6, 55.5);
  ctx.moveTo(41.5, 44);
  ctx.quadraticCurveTo(42.4, 50, 41.6, 55);
  ctx.stroke();
  ctx.strokeStyle = withAlpha(wisp, 0.75);
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  ctx.moveTo(27, 48);
  ctx.quadraticCurveTo(34, 51, 42, 47.5);
  ctx.stroke();
  detailPen(ctx, wisp);
  ctx.beginPath();
  ctx.moveTo(27.5, 49.6);
  ctx.quadraticCurveTo(34, 52.4, 41.5, 49.2);
  ctx.stroke();
  // 反手匕首（刃朝下：脊线 + 刃口光 + 护指 + 缠柄）
  ctx.save();
  ctx.translate(47.5, 46);
  ctx.rotate(0.5);
  ctx.beginPath();
  ctx.moveTo(-1.7, 2);
  ctx.lineTo(-1.7, 15);
  ctx.lineTo(0, 19.5);
  ctx.lineTo(1.7, 15);
  ctx.lineTo(1.7, 2);
  ctx.closePath();
  cel(ctx, '#c8d2dc', 1.5);
  structPen(ctx, '#8a9aa4');
  ctx.beginPath();
  ctx.moveTo(0, 2.5);
  ctx.lineTo(0, 18);
  ctx.stroke();
  rimPen(ctx);
  ctx.beginPath();
  ctx.moveTo(1, 3);
  ctx.lineTo(1, 15);
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(-3.8, -0.6, 7.6, 2.4);
  cel(ctx, cloakD, 1.3);
  detailPen(ctx, cloakL);
  ctx.beginPath();
  ctx.moveTo(-1.2, -2.6);
  ctx.lineTo(1.2, -2);
  ctx.moveTo(-1.2, -4.4);
  ctx.lineTo(1.2, -3.8);
  ctx.stroke();
  ctx.restore();
  // 持匕小臂 + 拳（护腕绑带）
  ctx.beginPath();
  ctx.moveTo(40, 42);
  ctx.quadraticCurveTo(44, 42.4, 46.8, 44);
  ctx.quadraticCurveTo(46.4, 47.8, 42.5, 47.4);
  ctx.quadraticCurveTo(40.2, 46.5, 39.5, 45);
  ctx.closePath();
  cel(ctx, cloak, 1.5);
  detailPen(ctx, cloakL);
  ctx.beginPath();
  ctx.moveTo(41.5, 43);
  ctx.lineTo(42.5, 46.2);
  ctx.moveTo(43.5, 43.2);
  ctx.lineTo(44.4, 46.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(47.5, 45.4, 2.4, 0, Math.PI * 2);
  cel(ctx, SKIN, 1.3);
  // 深兜帽头（帽尖后垂 + 褶线）
  ctx.beginPath();
  ctx.moveTo(23.5, 30);
  ctx.bezierCurveTo(22, 16.5, 44, 12, 47, 25);
  ctx.quadraticCurveTo(49.5, 30, 45.5, 35.5);
  ctx.quadraticCurveTo(40, 40, 30, 38.5);
  ctx.quadraticCurveTo(24.5, 35.5, 23.5, 30);
  ctx.closePath();
  ctx.fillStyle = cloak;
  ctx.fill();
  ctx.fillStyle = withAlpha(cloakD, 0.8);
  ctx.beginPath();
  ctx.moveTo(23.5, 30);
  ctx.quadraticCurveTo(24, 22, 28, 18);
  ctx.quadraticCurveTo(26, 26, 28, 34.5);
  ctx.quadraticCurveTo(25, 33, 23.5, 30);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(23.5, 30);
  ctx.bezierCurveTo(22, 16.5, 44, 12, 47, 25);
  ctx.quadraticCurveTo(49.5, 30, 45.5, 35.5);
  ctx.quadraticCurveTo(40, 40, 30, 38.5);
  ctx.quadraticCurveTo(24.5, 35.5, 23.5, 30);
  ctx.closePath();
  inkPath(ctx);
  // 帽尖后垂小角 + 兜帽褶线三道
  ctx.beginPath();
  ctx.moveTo(26, 17.5);
  ctx.quadraticCurveTo(21.5, 15, 19.5, 18.5);
  ctx.quadraticCurveTo(22.5, 18.5, 24.4, 21);
  ctx.quadraticCurveTo(24.8, 19, 26, 17.5);
  ctx.closePath();
  cel(ctx, cloak, 1.4);
  structPen(ctx, cloakL);
  ctx.beginPath();
  ctx.moveTo(29, 16.5);
  ctx.quadraticCurveTo(27.5, 24, 29, 33);
  ctx.moveTo(35, 14.5);
  ctx.quadraticCurveTo(34.5, 20, 35.5, 25);
  ctx.moveTo(42, 15.5);
  ctx.quadraticCurveTo(43.5, 20, 43.5, 25);
  ctx.stroke();
  rimArc(ctx, 35, 25, 12, 12, -1.35, -0.4);
  // 帽内暗面 + 下半脸 + 面巾
  ctx.fillStyle = '#0a0e18';
  ctx.beginPath();
  ctx.ellipse(37, 27.5, 8.4, 7.4, 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = SKIN_SHADE;
  ctx.beginPath();
  ctx.ellipse(38.5, 31.5, 5.8, 3.4, 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = mixColor(cloak, '#0a0e18', 0.3);
  ctx.beginPath();
  ctx.moveTo(32.8, 31.5);
  ctx.quadraticCurveTo(38.5, 29.6, 44.2, 31);
  ctx.quadraticCurveTo(44, 34.8, 38.5, 35.4);
  ctx.quadraticCurveTo(33.5, 35, 32.8, 31.5);
  ctx.closePath();
  ctx.fill();
  detailPen(ctx, cloakL);
  ctx.beginPath();
  ctx.moveTo(34, 32.6);
  ctx.quadraticCurveTo(38.5, 34.2, 43, 32.4);
  ctx.stroke();
  // 紫色发光眼（上睑收锋 + 高光）
  ctx.fillStyle = withAlpha(wisp, 0.3);
  ctx.beginPath();
  ctx.ellipse(34.5, 26, 2.8, 3.2, 0, 0, Math.PI * 2);
  ctx.ellipse(41.5, 25.5, 2.8, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = wisp;
  ctx.beginPath();
  ctx.ellipse(34.5, 26, 1.5, 2, 0, 0, Math.PI * 2);
  ctx.ellipse(41.5, 25.5, 1.5, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = withAlpha('#d8d4ff', 0.95);
  ctx.beginPath();
  ctx.arc(35, 25.2, 0.5, 0, Math.PI * 2);
  ctx.arc(42, 24.7, 0.5, 0, Math.PI * 2);
  ctx.fill();
  taperedStroke(ctx, 32.4, 24.4, 34.5, 23.2, 36.6, 24.2, 'rgba(20,14,30,0.9)', 1.2);
  taperedStroke(ctx, 39.4, 23.9, 41.5, 22.7, 43.6, 23.7, 'rgba(20,14,30,0.9)', 1.2);
}

// ── 导出：顺序与 config.units 0-8 严格一致 ──────────────────

export const UNIT_PAINTERS_A: CharacterPainter[] = [
  paintVanguard, // 0 vanguard 疾风哨卫
  paintDefender, // 1 defender 磐石重盾
  paintRanger, // 2 ranger 双刃游侠
  paintFlameblade, // 3 flameblade 烈焰剑士
  paintArcher, // 4 archer 鹰眼射手
  paintCaster, // 5 caster 星辉法师
  paintMedic, // 6 medic 月光医师
  paintKoi, // 7 koi 幸运锦鲤
  paintPhantom, // 8 phantom 影袭刺客
];
