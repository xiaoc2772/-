// 幸运塔防 程序化美术 · 全景场景绘制（静态背景层）。
// 每张地图一幅完整场景：天空/远山/云 → 水彩地面 → 逐格主题装饰 →
// 道路彩带 → 高台 → 机制符文 → 主题门。全部确定性绘制（cellRand），
// 仅在 resize/换图时重绘一次，动态元素一律在主 canvas。

import type { PrecomputedMap } from '../../engine/data';
import type { StageGeom } from '../draw';
import { STAGE_W, STAGE_H, TILE, cellCenter, milliToStage } from '../draw';
import type { ScenePalette } from './palette';
import { scenePalette, cellRand, mulberry32, mixColor, withAlpha, blobPath, leafPath, roundRectPath } from './palette';

export function drawScene(ctx: CanvasRenderingContext2D, map: PrecomputedMap, geom: StageGeom): void {
  const pal = scenePalette(map.cfg.id);
  ctx.clearRect(0, 0, STAGE_W, STAGE_H);
  drawSky(ctx, pal, map.cfg.id);
  drawGroundWash(ctx, pal, map, geom);
  drawCellDecor(ctx, pal, map, geom);
  drawPathRibbons(ctx, pal, map, geom);
  drawPlatforms(ctx, pal, map, geom);
  drawMechanicCells(ctx, map, geom);
  drawGates(ctx, pal, map, geom);
  drawVignette(ctx, pal);
}

// ── 天空 / 远山 / 云 ────────────────────────────

function drawSky(ctx: CanvasRenderingContext2D, pal: ScenePalette, mapId: string): void {
  const sky = ctx.createLinearGradient(0, 0, 0, STAGE_H);
  sky.addColorStop(0, pal.sky[0]);
  sky.addColorStop(0.45, pal.sky[1]);
  sky.addColorStop(1, pal.sky[2]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);

  const rand = mulberry32(hash32(mapId) ^ 0x5eed);
  const night = pal.theme === 'starlit' || pal.theme === 'thunder';
  // 远山三层：越远越亮越接近天色（大气透视），层间垫薄雾带
  for (let layer = 0; layer < 3; layer += 1) {
    const baseY = STAGE_H * (0.26 + layer * 0.09);
    const far = (2 - layer) / 2; // 1=最远
    ctx.fillStyle = mixColor(pal.hills[Math.min(layer, 1)], pal.sky[1], far * 0.55);
    ctx.beginPath();
    ctx.moveTo(0, STAGE_H);
    ctx.lineTo(0, baseY + rand() * 26);
    const bumps = 4 + layer * 2;
    for (let i = 1; i <= bumps; i += 1) {
      const x = (STAGE_W * i) / bumps;
      const peak = baseY - (22 + rand() * 62) * (1 - layer * 0.22);
      ctx.quadraticCurveTo(x - STAGE_W / bumps / 2, peak, x, baseY + rand() * 24);
    }
    ctx.lineTo(STAGE_W, STAGE_H);
    ctx.closePath();
    ctx.fill();
    // 山脚薄雾带
    const mist = ctx.createLinearGradient(0, baseY - 6, 0, baseY + 34);
    mist.addColorStop(0, 'rgba(255, 255, 255, 0)');
    mist.addColorStop(0.6, night ? 'rgba(190, 200, 235, 0.10)' : 'rgba(255, 255, 255, 0.16)');
    mist.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = mist;
    ctx.fillRect(0, baseY - 6, STAGE_W, 40);
  }
  // 动漫式积云：平底 + 堆叠瓣 + 顶部高光 + 底部冷灰阴影
  const cloudCount = night ? 4 : 6;
  for (let i = 0; i < cloudCount; i += 1) {
    const cx = rand() * STAGE_W;
    const cy = STAGE_H * (0.05 + rand() * 0.15);
    const w = 42 + rand() * 58;
    drawAnimeCloud(ctx, cx, cy, w, w * 0.42, pal.cloud, night, rand);
  }
  // 光源：暖阳（夜图为月晕）
  const lx = STAGE_W * 0.78;
  const ly = STAGE_H * 0.1;
  const glow = ctx.createRadialGradient(lx, ly, 6, lx, ly, 180);
  glow.addColorStop(0, night ? 'rgba(240, 244, 255, 0.85)' : 'rgba(255, 246, 214, 0.9)');
  glow.addColorStop(0.25, night ? 'rgba(210, 220, 255, 0.28)' : 'rgba(255, 236, 180, 0.35)');
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(lx - 180, ly - 180, 360, 360);
  ctx.fillStyle = night ? '#f2f5ff' : '#fff6cf';
  ctx.beginPath();
  ctx.arc(lx, ly, night ? 14 : 18, 0, Math.PI * 2);
  ctx.fill();
  if (!night) {
    // 斜射光束（极淡，电影感）
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = '#fff6cf';
    for (let i = 0; i < 3; i += 1) {
      const spread = 90 + i * 120;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx - spread - 130, STAGE_H);
      ctx.lineTo(lx - spread, STAGE_H);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  } else {
    // 星星
    for (let i = 0; i < 40; i += 1) {
      const sx = rand() * STAGE_W;
      const sy = rand() * STAGE_H * 0.3;
      ctx.globalAlpha = 0.35 + rand() * 0.6;
      ctx.fillStyle = '#e8ecff';
      ctx.fillRect(sx, sy, 1.6, 1.6);
    }
    ctx.globalAlpha = 1;
  }
}

/** 动漫式积云：平底堆叠瓣 + 顶部高光 + 底部阴影。 */
function drawAnimeCloud(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  color: string,
  night: boolean,
  rand: () => number,
): void {
  const lobes = [
    { dx: 0, dy: 0, r: h },
    { dx: -w * 0.42, dy: h * 0.22, r: h * 0.68 },
    { dx: w * 0.4, dy: h * 0.18, r: h * 0.74 },
    { dx: -w * 0.12, dy: -h * 0.3, r: h * 0.8 },
  ];
  // 主体（平底：矩形裁剪把瓣的下缘裁齐）
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - w, cy - h * 2.2, w * 2, h * 2.2 + h * 0.55);
  ctx.clip();
  ctx.fillStyle = color;
  for (const l of lobes) {
    ctx.beginPath();
    ctx.arc(cx + l.dx, cy + l.dy, l.r * (0.92 + rand() * 0.16), 0, Math.PI * 2);
    ctx.fill();
  }
  // 顶部高光
  ctx.fillStyle = night ? 'rgba(235, 240, 255, 0.25)' : 'rgba(255, 255, 255, 0.55)';
  ctx.beginPath();
  ctx.arc(cx - w * 0.08, cy - h * 0.42, h * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // 底部冷灰底影（贴平底）
  ctx.fillStyle = night ? 'rgba(120, 130, 180, 0.16)' : 'rgba(150, 175, 200, 0.22)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + h * 0.5, w * 0.8, h * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ── 地面水彩 ────────────────────────────────

function drawGroundWash(ctx: CanvasRenderingContext2D, pal: ScenePalette, map: PrecomputedMap, geom: StageGeom): void {
  const bx = geom.ox;
  const by = geom.oy;
  const bw = geom.cols * TILE;
  const bh = geom.rows * TILE;
  const rand = mulberry32(hash32(map.cfg.id) ^ 0x6b0d);
  // 地台底：比棋盘各多出 10px 的圆角草台 + 底边阴影，让棋盘像浮在场景上
  ctx.fillStyle = 'rgba(30, 45, 30, 0.18)';
  roundRectPath(ctx, bx - 10, by - 6, bw + 20, bh + 20, 18);
  ctx.fill();
  // 底色：纵向渐变（远端偏亮偏冷 → 近端偏暖偏深）
  const baseGrad = ctx.createLinearGradient(0, by, 0, by + bh);
  baseGrad.addColorStop(0, mixColor(pal.groundBase, '#eaf4ff', 0.08));
  baseGrad.addColorStop(1, mixColor(pal.groundBase, '#3a3212', 0.08));
  ctx.fillStyle = baseGrad;
  roundRectPath(ctx, bx - 10, by - 10, bw + 20, bh + 20, 18);
  ctx.fill();
  // 后续水彩层都裁进地台圆角内
  ctx.save();
  roundRectPath(ctx, bx - 10, by - 10, bw + 20, bh + 20, 18);
  ctx.clip();
  // 大笔触色块：1.5~3 格半径的柔和亮/暗斑，画面呼吸感
  for (let i = 0; i < 13; i += 1) {
    const px = bx + rand() * bw;
    const py = by + rand() * bh;
    const r = TILE * (1.5 + rand() * 1.5);
    const lighter = rand() < 0.5;
    ctx.globalAlpha = 0.1 + rand() * 0.06;
    ctx.fillStyle = lighter
      ? mixColor(pal.groundWash[0], '#ffffff', 0.25)
      : mixColor(pal.groundWash[1] ?? pal.groundWash[0], '#26331e', 0.25);
    blobPath(ctx, px, py, r, rand, 8);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // 主题地面质感
  if (pal.theme === 'frostfire') {
    // 雪斑 + 淡蓝反光
    for (let i = 0; i < 26; i += 1) {
      ctx.globalAlpha = 0.2 + rand() * 0.25;
      ctx.fillStyle = i % 3 === 0 ? 'rgba(180, 210, 240, 0.5)' : '#f6fafd';
      blobPath(ctx, bx + rand() * bw, by + rand() * bh, 8 + rand() * 22, rand, 6);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (pal.theme === 'starlit' || pal.theme === 'thunder') {
    // 石板拼缝（极淡大板块）
    ctx.strokeStyle = 'rgba(20, 22, 45, 0.08)';
    ctx.lineWidth = 1.5;
    for (let gy = by; gy < by + bh; gy += TILE * 2) {
      ctx.beginPath();
      ctx.moveTo(bx, gy + (rand() - 0.5) * 8);
      ctx.lineTo(bx + bw, gy + (rand() - 0.5) * 8);
      ctx.stroke();
    }
    for (let gxx = bx; gxx < bx + bw; gxx += TILE * 2.6) {
      ctx.beginPath();
      ctx.moveTo(gxx + (rand() - 0.5) * 10, by);
      ctx.lineTo(gxx + (rand() - 0.5) * 10, by + bh);
      ctx.stroke();
    }
  } else if (pal.theme === 'ruins') {
    for (let i = 0; i < 10; i += 1) {
      ctx.globalAlpha = 0.1 + rand() * 0.08;
      ctx.fillStyle = mixColor(pal.decor.accent, '#3f5a3a', 0.3);
      blobPath(ctx, bx + rand() * bw, by + rand() * bh, TILE * (0.8 + rand()), rand, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // 细草纹理：每格 4~6 条 1px 短弧线（亮暗交替），只在草系主题画
  if (pal.theme === 'meadow' || pal.theme === 'brook' || pal.theme === 'ruins') {
    ctx.lineWidth = 1;
    for (let row = 0; row < geom.rows; row += 1) {
      for (let col = 0; col < geom.cols; col += 1) {
        const cr = cellRand(map.cfg.id, row, col);
        const n = 4 + Math.floor(cr() * 3);
        for (let i = 0; i < n; i += 1) {
          const gx = bx + col * TILE + cr() * TILE;
          const gy = by + row * TILE + cr() * TILE;
          const len = 3 + cr() * 4;
          const sway = (cr() - 0.5) * 3;
          ctx.strokeStyle = cr() < 0.5
            ? withAlpha(mixColor(pal.groundBase, '#1e3312', 0.4), 0.35)
            : withAlpha(mixColor(pal.groundBase, '#ffffff', 0.4), 0.4);
          ctx.beginPath();
          ctx.moveTo(gx, gy);
          ctx.quadraticCurveTo(gx + sway, gy - len * 0.6, gx + sway * 1.6, gy - len);
          ctx.stroke();
        }
      }
    }
  }
  // 云影：2~4 个超大椭圆暗斑（极淡）
  for (let i = 0; i < 3; i += 1) {
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = '#1c2438';
    ctx.beginPath();
    ctx.ellipse(bx + rand() * bw, by + rand() * bh, TILE * (2.2 + rand() * 1.6), TILE * (1.2 + rand()), rand() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // 地台边缘内收暗一圈（体积感）
  ctx.strokeStyle = 'rgba(25, 35, 22, 0.14)';
  ctx.lineWidth = 10;
  roundRectPath(ctx, bx - 6, by - 6, bw + 12, bh + 12, 15);
  ctx.stroke();
  ctx.restore();
  // 大笔触明暗（光从右上来）
  const light = ctx.createLinearGradient(bx + bw, by, bx, by + bh);
  light.addColorStop(0, 'rgba(255, 250, 220, 0.16)');
  light.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
  light.addColorStop(1, 'rgba(40, 50, 80, 0.12)');
  ctx.fillStyle = light;
  roundRectPath(ctx, bx - 10, by - 10, bw + 20, bh + 20, 18);
  ctx.fill();
}

// ── 逐格主题装饰（不可部署格才有大装饰） ────────────────
// 赛璐璐三调子（阴影/固有色/受光）+ 暖色勾线 + 接地柔影，光源统一右上；
// 全部随机来自 cellRand（确定性），resize 重绘像素级一致。

const OUTLINE_DAY = 'rgba(60, 45, 35, 0.5)';
const OUTLINE_NIGHT = 'rgba(30, 28, 50, 0.55)';
const OUTLINE_W = 1.2;

/** 接地柔影：一切立着的元素脚下都要有。 */
function contactShadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, alpha = 0.18): void {
  ctx.fillStyle = `rgba(25, 32, 25, ${alpha})`;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** 星芒十字闪光。 */
function sparkleCross(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color = 'rgba(255, 255, 255, 0.85)'): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - r, y);
  ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r);
  ctx.lineTo(x, y + r);
  ctx.stroke();
}

/** 从 rand 派生可重放种子：同一轮廓可反复重建（先填色、再裁剪、最后勾线）。 */
function forkSeed(rand: () => number): number {
  return Math.floor(rand() * 4294967296);
}

/**
 * 手绘感圆角四边形：角点微抖（按尺寸收缩，最大 ±1.5px 上下）+ 边线微弓（±1.6px 内），
 * 全场替代机械的标准圆角矩形（石板/台身/灯箱/门基座等）。路径留在 ctx 上，
 * fill 后可直接 stroke 同一轮廓。
 */
function organicQuad(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, rand: () => number): void {
  const jit = Math.min(2.2, Math.max(0.7, Math.min(w, h) * 0.16));
  const rr = Math.max(1, Math.min(r, w / 2 - 0.5, h / 2 - 0.5));
  const pts = [
    { x: x + (rand() - 0.5) * jit * 1.4, y: y + (rand() - 0.5) * jit * 1.4 },
    { x: x + w + (rand() - 0.5) * jit * 1.4, y: y + (rand() - 0.5) * jit * 1.4 },
    { x: x + w + (rand() - 0.5) * jit * 1.4, y: y + h + (rand() - 0.5) * jit * 1.4 },
    { x: x + (rand() - 0.5) * jit * 1.4, y: y + h + (rand() - 0.5) * jit * 1.4 },
  ];
  ctx.beginPath();
  let start: { x: number; y: number } | null = null;
  for (let i = 0; i < 4; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const t = Math.min(rr / len, 0.42);
    const p0 = { x: a.x + dx * t, y: a.y + dy * t };
    const p1 = { x: b.x - dx * t, y: b.y - dy * t };
    const bow = (rand() - 0.5) * Math.min(3.2, len * 0.1);
    const mx = (p0.x + p1.x) / 2 - (dy / len) * bow;
    const my = (p0.y + p1.y) / 2 + (dx / len) * bow;
    if (i === 0) {
      ctx.moveTo(p0.x, p0.y);
      start = p0;
    } else {
      ctx.quadraticCurveTo(a.x, a.y, p0.x, p0.y);
    }
    ctx.quadraticCurveTo(mx, my, p1.x, p1.y);
  }
  if (start) {
    ctx.quadraticCurveTo(pts[0].x, pts[0].y, start.x, start.y);
  }
  ctx.closePath();
}

/** 轻弯短线：单段二次曲线（控制点法向偏 bow px），替代机械直线的缝/裂/框线。 */
function curvedSeam(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, bow: number): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo((x0 + x1) / 2 - (dy / len) * bow, (y0 + y1) / 2 + (dx / len) * bow, x1, y1);
  ctx.stroke();
}

/** 顺滑折线：经过折点的中点二次曲线串（不自带 beginPath，便于拼接闭合带状轮廓）。 */
function traceSmooth(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], move: boolean): void {
  if (move) {
    ctx.moveTo(pts[0].x, pts[0].y);
  } else {
    ctx.lineTo(pts[0].x, pts[0].y);
  }
  for (let i = 1; i < pts.length - 1; i += 1) {
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
}

/** 树木禁区：路面/高台一格邻域内不种树，避免树冠盖住玩法格。 */
function nearGameplayCell(map: PrecomputedMap, row: number, col: number): boolean {
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      const key = (row + dr) * 1000 + (col + dc);
      if (map.meleeCellSet.has(key) || map.rangedCellSet.has(key)) {
        return true;
      }
    }
  }
  return false;
}

function drawCellDecor(ctx: CanvasRenderingContext2D, pal: ScenePalette, map: PrecomputedMap, geom: StageGeom): void {
  const mechanicKeys = new Set<number>();
  for (const set of Object.values(map.mechanicCellSets)) {
    for (const key of set) {
      mechanicKeys.add(key);
    }
  }
  const night = pal.theme === 'starlit' || pal.theme === 'thunder';
  const outline = night ? OUTLINE_NIGHT : OUTLINE_DAY;
  for (let row = 0; row < geom.rows; row += 1) {
    for (let col = 0; col < geom.cols; col += 1) {
      const key = row * 1000 + col;
      if (map.meleeCellSet.has(key) || map.rangedCellSet.has(key) || mechanicKeys.has(key)) {
        continue;
      }
      // 出怪/基地格也跳过（门自己画）
      if (isGateCell(map, key)) {
        continue;
      }
      const rand = cellRand(map.cfg.id, row, col);
      if (rand() < 0.42) {
        continue; // 留白，画面不闷
      }
      const gx = geom.ox + col * TILE;
      const gy = geom.oy + row * TILE;
      const treeSafe = !nearGameplayCell(map, row, col);
      // 主景（远离玩法格时低概率出地标树）
      drawThemeDecor(ctx, pal, gx + TILE * (0.25 + rand() * 0.5), gy + TILE * (0.25 + rand() * 0.5), rand, treeSafe);
      // 次景（0.35）：主景旁的小景
      if (rand() < 0.35) {
        drawThemeDecor(ctx, pal, gx + TILE * (0.2 + rand() * 0.6), gy + TILE * (0.2 + rand() * 0.6), rand, false);
      }
      // 第三层小碎件（0.15）：草叶 / 卵石填缝
      if (rand() < 0.15) {
        const tx = gx + TILE * (0.15 + rand() * 0.7);
        const ty = gy + TILE * (0.15 + rand() * 0.7);
        if (rand() < 0.55) {
          drawGrassTuft(ctx, tx, ty, pal.decor.primary, rand, outline);
        } else {
          drawPebbles(ctx, tx, ty, night ? '#7d829c' : '#a8a394', rand, outline);
        }
      }
    }
  }
}

function drawThemeDecor(ctx: CanvasRenderingContext2D, pal: ScenePalette, x: number, y: number, rand: () => number, allowTree = false): void {
  const night = pal.theme === 'starlit' || pal.theme === 'thunder';
  const o = night ? OUTLINE_NIGHT : OUTLINE_DAY;
  const pick = rand();
  const treeTheme = pal.theme === 'meadow' || pal.theme === 'brook' || pal.theme === 'ruins';
  if (allowTree && treeTheme && pick < 0.08) {
    // 地标树：锚点压向格子下缘，树冠留在 1.5 格以内
    drawTree(ctx, x, y + TILE * 0.18, pal.decor.primary, pal.decor.accent, rand, o);
    return;
  }
  switch (pal.theme) {
    case 'meadow':
      if (pick < 0.45) drawGrassTuft(ctx, x, y, pal.decor.primary, rand, o);
      else if (pick < 0.7) drawFlower(ctx, x, y, pal.decor.accent, pal.decor.secondary, rand, o);
      else if (pick < 0.88) drawBush(ctx, x, y, pal.decor.primary, pal.decor.accent, rand, o);
      else drawRock(ctx, x, y, '#b7ab90', rand, o);
      break;
    case 'brook':
      if (pick < 0.4) drawReeds(ctx, x, y, pal.decor.primary, rand, o);
      else if (pick < 0.68) drawPond(ctx, x, y, pal.decor.secondary, rand, o);
      else if (pick < 0.86) drawGrassTuft(ctx, x, y, pal.decor.primary, rand, o);
      else drawPebbles(ctx, x, y, '#a8a394', rand, o);
      break;
    case 'starlit':
      if (pick < 0.3) drawLantern(ctx, x, y, pal.decor.secondary, rand, o);
      else if (pick < 0.62) drawStarFlower(ctx, x, y, pal.decor.accent, rand, o);
      else if (pick < 0.85) drawGrassTuft(ctx, x, y, pal.decor.primary, rand, o);
      else drawRock(ctx, x, y, '#7d829c', rand, o);
      break;
    case 'frostfire':
      if (pick < 0.38) drawIceShard(ctx, x, y, pal.decor.secondary, rand, o);
      else if (pick < 0.66) drawEmberCrack(ctx, x, y, pal.decor.accent, rand);
      else if (pick < 0.88) drawSnowPatch(ctx, x, y, rand);
      else drawRock(ctx, x, y, '#9aa6b6', rand, o);
      break;
    case 'ruins':
      if (pick < 0.36) drawBrokenColumn(ctx, x, y, pal.decor.secondary, rand, o);
      else if (pick < 0.66) drawMossStone(ctx, x, y, pal.decor.primary, pal.decor.accent, rand, o);
      else if (pick < 0.88) drawGrassTuft(ctx, x, y, pal.decor.primary, rand, o);
      else drawPebbles(ctx, x, y, '#a09a84', rand, o);
      break;
    case 'thunder':
      if (pick < 0.38) drawCrystalSpire(ctx, x, y, pal.decor.secondary, rand, o);
      else if (pick < 0.66) drawRuneStone(ctx, x, y, pal.decor.primary, pal.decor.accent, rand, o);
      else if (pick < 0.86) drawVoidCrack(ctx, x, y, pal.decor.accent, rand);
      else drawRock(ctx, x, y, '#6f7390', rand, o);
      break;
  }
}

// —— 装饰 stamp 画家（赛璐璐质感，锚点=中心/基部）——

function drawGrassTuft(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, rand: () => number, outline = OUTLINE_DAY): void {
  const baseY = y + 5;
  contactShadow(ctx, x, baseY, 9 + rand() * 3, 2.6);
  const blades = 5 + Math.floor(rand() * 4);
  const dark = mixColor(color, '#1d3a16', 0.38);
  for (let i = 0; i < blades; i += 1) {
    const bx = x + (rand() - 0.5) * 15;
    const angle = -Math.PI / 2 + (rand() - 0.5) * 1.15;
    const len = 10 + rand() * 10;
    // 底层：整叶暗调 + 勾线
    ctx.fillStyle = dark;
    leafPath(ctx, bx, baseY, angle, len, 1.9);
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1;
    ctx.stroke();
    // 上层：上 60% 受光段
    const sx = bx + Math.cos(angle) * len * 0.4;
    const sy = baseY + Math.sin(angle) * len * 0.4;
    ctx.fillStyle = mixColor(color, '#f2ffca', 0.3 + rand() * 0.2);
    leafPath(ctx, sx, sy, angle, len * 0.6, 1.25);
    ctx.fill();
  }
  // 草籽小点
  const seeds = 1 + Math.floor(rand() * 2);
  for (let i = 0; i < seeds; i += 1) {
    ctx.fillStyle = mixColor(color, '#fff8d8', 0.55);
    ctx.beginPath();
    ctx.arc(x + (rand() - 0.5) * 14, baseY - 12 - rand() * 6, 0.9 + rand() * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFlower(ctx: CanvasRenderingContext2D, x: number, y: number, petal: string, center: string, rand: () => number, outline = OUTLINE_DAY): void {
  contactShadow(ctx, x, y + 8, 5.5, 1.8);
  // 茎 + 基部双叶
  ctx.strokeStyle = mixColor('#4e7a38', '#2c4a1e', 0.3);
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(x + 0.5, y + 8);
  ctx.quadraticCurveTo(x - 0.8, y + 4, x, y + 1);
  ctx.stroke();
  for (const side of [-1, 1] as const) {
    ctx.fillStyle = side < 0 ? '#3f6a2c' : '#5c8a40';
    leafPath(ctx, x + side * 0.5, y + 7, -Math.PI / 2 + side * 1.15 + (rand() - 0.5) * 0.2, 4.5 + rand() * 2, 1.7);
    ctx.fill();
  }
  // 花瓣两层：外层深瓣勾线，内层受光小瓣
  const petals = 5 + Math.floor(rand() * 2);
  const size = 4 + rand() * 3;
  const spin = rand() * Math.PI;
  const deep = mixColor(petal, '#8a4050', 0.3);
  const lit = mixColor(petal, '#ffffff', 0.42);
  for (let i = 0; i < petals; i += 1) {
    const a = spin + (Math.PI * 2 * i) / petals;
    ctx.fillStyle = deep;
    leafPath(ctx, x, y, a, size * 2.2, size * 0.72);
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 0.9;
    ctx.stroke();
  }
  for (let i = 0; i < petals; i += 1) {
    const a = spin + (Math.PI * 2 * i) / petals;
    ctx.fillStyle = lit;
    leafPath(ctx, x, y, a, size * 1.55, size * 0.5);
    ctx.fill();
  }
  // 花心：暗环 + 固有色（手绘小团块，不用正圆）+ 右上亮点
  ctx.fillStyle = mixColor(center, '#7a5210', 0.45);
  blobPath(ctx, x, y, size * 0.72, rand, 5);
  ctx.fill();
  ctx.fillStyle = center;
  blobPath(ctx, x, y, size * 0.5, rand, 5);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 253, 235, 0.9)';
  ctx.beginPath();
  ctx.arc(x + size * 0.18, y - size * 0.2, size * 0.18, 0, Math.PI * 2);
  ctx.fill();
}

function drawBush(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, accent: string, rand: () => number, outline = OUTLINE_DAY): void {
  const r = 12 + rand() * 5;
  contactShadow(ctx, x, y + r * 0.72, r * 1.35, r * 0.34, 0.2);
  // 左下深影瓣
  ctx.fillStyle = mixColor(color, '#16300f', 0.45);
  blobPath(ctx, x - r * 0.22, y + r * 0.3, r * 0.95, rand, 7);
  ctx.fill();
  // 固有色主瓣 + 勾线
  blobPath(ctx, x, y, r, rand, 7);
  ctx.fillStyle = mixColor(color, '#2f4f2f', 0.1);
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = OUTLINE_W;
  ctx.stroke();
  // 右上受光瓣
  ctx.fillStyle = mixColor(color, '#f6ffc4', 0.32);
  blobPath(ctx, x + r * 0.32, y - r * 0.34, r * 0.58, rand, 6);
  ctx.fill();
  // 浆果 / 小花（带小白高光）
  const dots = 3 + Math.floor(rand() * 2);
  for (let i = 0; i < dots; i += 1) {
    const a = rand() * Math.PI * 2;
    const rr = rand() * r * 0.7;
    const bx = x + Math.cos(a) * rr;
    const by = y + Math.sin(a) * rr * 0.8 - r * 0.1;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(bx, by, 1.5 + rand() * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.beginPath();
    ctx.arc(bx + 0.6, by - 0.6, 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 地标树：双色树干 + 三层树冠，只在草系主题低概率出现。锚点=树干基部。 */
function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, canopy: string, accent: string, rand: () => number, outline = OUTLINE_DAY): void {
  const h = 40 + rand() * 15;
  const cR = h * 0.42;
  const cy = y - h * 0.66;
  contactShadow(ctx, x + 2, y + 2, cR * 1.05, 6, 0.24);
  // 树干：暗底 + 根部外扩 + 勾线
  ctx.fillStyle = '#5d4028';
  ctx.beginPath();
  ctx.moveTo(x - 8, y + 2);
  ctx.quadraticCurveTo(x - 3.5, y - 6, x - 3, y - h * 0.5);
  ctx.lineTo(x + 3, y - h * 0.5);
  ctx.quadraticCurveTo(x + 3.5, y - 6, x + 8, y + 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = OUTLINE_W;
  ctx.stroke();
  // 干右侧受光条
  ctx.fillStyle = '#8a6742';
  ctx.beginPath();
  ctx.moveTo(x + 0.6, y);
  ctx.quadraticCurveTo(x + 2.2, y - 8, x + 2, y - h * 0.5);
  ctx.lineTo(x + 3, y - h * 0.5);
  ctx.quadraticCurveTo(x + 3.5, y - 6, x + 6.5, y + 1.4);
  ctx.closePath();
  ctx.fill();
  // 侧枝暗示
  ctx.strokeStyle = '#5d4028';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 1, y - h * 0.42);
  ctx.quadraticCurveTo(x + 7, y - h * 0.52, x + cR * 0.5, y - h * 0.58);
  ctx.stroke();
  // 树冠三层：深影 → 固有色（勾线）→ 右上受光冠
  ctx.fillStyle = mixColor(canopy, '#12300e', 0.5);
  blobPath(ctx, x - cR * 0.16, cy + cR * 0.28, cR, rand, 8);
  ctx.fill();
  blobPath(ctx, x, cy, cR * 0.96, rand, 8);
  ctx.fillStyle = mixColor(canopy, '#2c4a24', 0.12);
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = OUTLINE_W;
  ctx.stroke();
  ctx.fillStyle = mixColor(canopy, '#f6ffc0', 0.36);
  blobPath(ctx, x + cR * 0.34, cy - cR * 0.32, cR * 0.55, rand, 7);
  ctx.fill();
  // 花果点
  const dots = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < dots; i += 1) {
    const a = rand() * Math.PI * 2;
    const rr = rand() * cR * 0.75;
    ctx.fillStyle = mixColor(accent, '#ffffff', rand() * 0.3);
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.85, 1.4 + rand() * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRock(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, rand: () => number, outline = OUTLINE_DAY): void {
  const r = 8 + rand() * 4.5;
  contactShadow(ctx, x + 1, y + r * 0.66, r * 1.45, r * 0.46);
  const seed = forkSeed(rand);
  // 固有色剪影
  blobPath(ctx, x, y, r, mulberry32(seed), 6);
  ctx.fillStyle = color;
  ctx.fill();
  // 裁进剪影：左下暗棱面 + 右上受光棱面
  ctx.save();
  blobPath(ctx, x, y, r, mulberry32(seed), 6);
  ctx.clip();
  ctx.fillStyle = mixColor(color, '#2e2a22', 0.4);
  blobPath(ctx, x - r * 0.3, y + r * 0.45, r * 0.9, rand, 5);
  ctx.fill();
  ctx.fillStyle = mixColor(color, '#fff6e0', 0.42);
  blobPath(ctx, x + r * 0.34, y - r * 0.4, r * 0.62, rand, 5);
  ctx.fill();
  ctx.restore();
  // 勾线
  blobPath(ctx, x, y, r, mulberry32(seed), 6);
  ctx.strokeStyle = outline;
  ctx.lineWidth = OUTLINE_W;
  ctx.stroke();
  // 石根草叶
  const blades = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < blades; i += 1) {
    ctx.fillStyle = withAlpha(mixColor(color, '#5d8a3f', 0.55), 0.85);
    leafPath(ctx, x + (rand() - 0.5) * r * 1.7, y + r * 0.5, -Math.PI / 2 + (rand() - 0.5) * 1.3, 4.5 + rand() * 3.5, 1.3);
    ctx.fill();
  }
}

function drawReeds(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, rand: () => number, outline = OUTLINE_DAY): void {
  contactShadow(ctx, x, y + 7, 8, 2.4);
  // 基部水纹
  ctx.strokeStyle = 'rgba(235, 250, 255, 0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y + 7, 7 + rand() * 3, 0.15, Math.PI - 0.4);
  ctx.stroke();
  const stems = 3 + Math.floor(rand() * 2);
  for (let i = 0; i < stems; i += 1) {
    const bx = x + (i - (stems - 1) / 2) * 4.4 + (rand() - 0.5) * 3;
    const sway = (rand() - 0.5) * 8;
    const top = y - 18 - rand() * 8;
    // 茎：暗基 → 亮梢渐变
    const grad = ctx.createLinearGradient(bx, y + 7, bx + sway * 1.4, top);
    grad.addColorStop(0, mixColor(color, '#14301c', 0.42));
    grad.addColorStop(1, mixColor(color, '#e4f4b8', 0.4));
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.9;
    ctx.beginPath();
    ctx.moveTo(bx, y + 7);
    ctx.quadraticCurveTo(bx + sway * 0.5, y - 7, bx + sway * 1.4, top);
    ctx.stroke();
    // 蒲棒头：暗底 + 勾线 + 右侧受光
    if (rand() < 0.75) {
      const hx = bx + sway * 1.4;
      const hy = top + 2;
      ctx.fillStyle = '#6e4f30';
      ctx.beginPath();
      ctx.ellipse(hx, hy, 2.2, 5, sway * 0.04, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.lineWidth = 0.9;
      ctx.stroke();
      ctx.fillStyle = '#a67c4e';
      ctx.beginPath();
      ctx.ellipse(hx + 0.8, hy - 0.6, 0.9, 3.6, sway * 0.04, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawPond(ctx: CanvasRenderingContext2D, x: number, y: number, water: string, rand: () => number, outline = OUTLINE_DAY): void {
  const r = 15 + rand() * 7;
  const seed = forkSeed(rand);
  // 水面：中心深蓝 → 边缘浅青
  const depth = ctx.createRadialGradient(x, y, r * 0.15, x, y, r);
  depth.addColorStop(0, mixColor(water, '#1d4a68', 0.5));
  depth.addColorStop(1, mixColor(water, '#a8e4e8', 0.35));
  blobPath(ctx, x, y, r, mulberry32(seed), 8);
  ctx.fillStyle = depth;
  ctx.fill();
  // 暗色岸线 + 左上内侧亮沿
  blobPath(ctx, x, y, r, mulberry32(seed), 8);
  ctx.strokeStyle = mixColor(water, '#173a48', 0.55);
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.74, Math.PI * 0.85, Math.PI * 1.55);
  ctx.stroke();
  // 睡莲叶：缺口圆盘 + 受光半边
  const pads = 1 + Math.floor(rand() * 2);
  for (let i = 0; i < pads; i += 1) {
    const px = x + (rand() - 0.5) * r * 0.9;
    const py = y + (rand() - 0.5) * r * 0.7;
    const pr = 3.4 + rand() * 1.8;
    const notch = rand() * Math.PI * 2;
    ctx.fillStyle = '#4e8a48';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, pr, notch + 0.55, notch + Math.PI * 2 - 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = 'rgba(198, 232, 150, 0.65)';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, pr * 0.78, notch + 0.6, notch + 0.6 + Math.PI * 0.85);
    ctx.closePath();
    ctx.fill();
  }
  // 波光
  sparkleCross(ctx, x - r * 0.3, y - r * 0.26, 2.4);
  sparkleCross(ctx, x + r * 0.34, y + r * 0.18, 1.7, 'rgba(255, 255, 255, 0.7)');
  // 岸边小芦苇
  const ea = Math.PI * (1.55 + rand() * 0.6);
  const ex = x + Math.cos(ea) * r * 0.95;
  const ey = y + Math.sin(ea) * r * 0.95;
  ctx.strokeStyle = mixColor('#4e7a38', '#1c3a16', 0.3);
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 2; i += 1) {
    ctx.beginPath();
    ctx.moveTo(ex + i * 2, ey + 2);
    ctx.quadraticCurveTo(ex + i * 2 + 2, ey - 4, ex + i * 2 + 3.5, ey - 8 - rand() * 3);
    ctx.stroke();
  }
}

function drawPebbles(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, rand: () => number, outline = OUTLINE_DAY): void {
  contactShadow(ctx, x, y + 2.5, 9, 3, 0.14);
  const n = 4 + Math.floor(rand() * 2);
  for (let i = 0; i < n; i += 1) {
    const px = x + (rand() - 0.5) * 16;
    const py = y + (rand() - 0.5) * 11;
    const rw = 2.2 + rand() * 2.2;
    const rh = rw * (0.62 + rand() * 0.25);
    const rot = rand() * Math.PI;
    const base = mixColor(color, '#57503f', 0.18 + rand() * 0.2);
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.ellipse(px, py, rw, rh, rot, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = mixColor(base, '#fff6e2', 0.42);
    ctx.beginPath();
    ctx.ellipse(px + rw * 0.24, py - rh * 0.3, rw * 0.55, rh * 0.5, rot, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawLantern(ctx: CanvasRenderingContext2D, x: number, y: number, glow: string, rand: () => number, outline = OUTLINE_NIGHT): void {
  const sway = (rand() - 0.5) * 1.5;
  contactShadow(ctx, x, y + 9, 8, 2.8, 0.22);
  // 木柱：手绘四边形 + 勾线 + 右缘弓形受光条
  ctx.fillStyle = '#3e3226';
  organicQuad(ctx, x - 2, y - 15, 4, 24, 1.2, rand);
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#6b5540';
  ctx.beginPath();
  ctx.moveTo(x + 0.4, y - 14.4);
  ctx.quadraticCurveTo(x + 1.8, y - 3, x + 0.6, y + 8.4);
  ctx.lineTo(x + 1.7, y + 8.4);
  ctx.quadraticCurveTo(x + 2.7, y - 3, x + 1.9, y - 14.4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#4e4030';
  organicQuad(ctx, x - 3.6, y - 18, 7.2, 3.4, 1.2, rand);
  ctx.fill();
  // 挂臂小钩
  ctx.strokeStyle = '#4e4030';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x, y - 16.4);
  ctx.quadraticCurveTo(x + 4 + sway, y - 21, x + 6 + sway, y - 24);
  ctx.stroke();
  const lx = x + 6 + sway;
  const ly = y - 18.5;
  // 光晕两层
  const haloOut = ctx.createRadialGradient(lx, ly, 2, lx, ly, 26);
  haloOut.addColorStop(0, withAlpha(glow, 0.35));
  haloOut.addColorStop(1, withAlpha(glow, 0));
  ctx.fillStyle = haloOut;
  ctx.fillRect(lx - 26, ly - 26, 52, 52);
  const haloIn = ctx.createRadialGradient(lx, ly, 1, lx, ly, 11);
  haloIn.addColorStop(0, withAlpha(glow, 0.85));
  haloIn.addColorStop(1, withAlpha(glow, 0));
  ctx.fillStyle = haloIn;
  ctx.fillRect(lx - 11, ly - 11, 22, 22);
  // 玻璃灯箱：暖色纵向渐变（手绘四边形，填完直接勾同一轮廓）
  const glass = ctx.createLinearGradient(lx, ly - 5.5, lx, ly + 5.5);
  glass.addColorStop(0, mixColor(glow, '#fff8dc', 0.6));
  glass.addColorStop(1, mixColor(glow, '#c87c2e', 0.35));
  ctx.fillStyle = glass;
  organicQuad(ctx, lx - 4, ly - 5.5, 8, 11, 2.4, rand);
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = OUTLINE_W;
  ctx.stroke();
  // 框条（微弯）+ 焰心
  ctx.strokeStyle = withAlpha('#4e4030', 0.7);
  ctx.lineWidth = 0.9;
  curvedSeam(ctx, lx - 4, ly, lx + 4, ly, 0.7);
  ctx.fillStyle = '#fff6c4';
  ctx.beginPath();
  ctx.arc(lx, ly + 1, 1.7, 0, Math.PI * 2);
  ctx.fill();
}

function drawStarFlower(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, rand: () => number, outline = OUTLINE_NIGHT): void {
  const size = 3.4 + rand() * 2.2;
  // 柔光晕
  const halo = ctx.createRadialGradient(x, y, 1, x, y, size * 4.2);
  halo.addColorStop(0, withAlpha(color, 0.4));
  halo.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(x - size * 4.2, y - size * 4.2, size * 8.4, size * 8.4);
  const spin = rand() * 0.5;
  // 外层深瓣（勾线）
  for (let i = 0; i < 4; i += 1) {
    const a = spin + (Math.PI / 2) * i;
    ctx.fillStyle = mixColor(color, '#5a5a92', 0.3);
    leafPath(ctx, x, y, a, size * 2.6, size * 0.66);
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 0.9;
    ctx.stroke();
  }
  // 内层受光瓣
  for (let i = 0; i < 4; i += 1) {
    const a = spin + (Math.PI / 2) * i;
    ctx.fillStyle = mixColor(color, '#ffffff', 0.55);
    leafPath(ctx, x, y, a, size * 1.8, size * 0.44);
    ctx.fill();
  }
  // 亮心 + 四道细芒
  ctx.fillStyle = '#fff9da';
  ctx.beginPath();
  ctx.arc(x, y, size * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 250, 220, 0.8)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) {
    const a = spin + Math.PI / 4 + (Math.PI / 2) * i;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * size * 1.1, y + Math.sin(a) * size * 1.1);
    ctx.lineTo(x + Math.cos(a) * size * 2.1, y + Math.sin(a) * size * 2.1);
    ctx.stroke();
  }
}

function drawIceShard(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, rand: () => number, outline = OUTLINE_DAY): void {
  const h = 14 + rand() * 10;
  const w = 6 + rand() * 3;
  contactShadow(ctx, x, y + 4.5, w * 1.9, 3, 0.16);
  // 基部雪堆
  ctx.fillStyle = 'rgba(250, 253, 255, 0.85)';
  blobPath(ctx, x + 1, y + 3, w * 1.5, rand, 6);
  ctx.fill();
  const tipX = x + (rand() - 0.5) * 2;
  // 左棱面（中蓝）
  ctx.fillStyle = mixColor(color, '#5b8cc0', 0.42);
  ctx.beginPath();
  ctx.moveTo(tipX, y - h);
  ctx.lineTo(x - w * 0.8, y + 3);
  ctx.lineTo(x + w * 0.1, y + 4);
  ctx.closePath();
  ctx.fill();
  // 右棱面（苍白受光）
  ctx.fillStyle = mixColor(color, '#f4fbff', 0.55);
  ctx.beginPath();
  ctx.moveTo(tipX, y - h);
  ctx.lineTo(x + w, y + 2);
  ctx.lineTo(x + w * 0.1, y + 4);
  ctx.closePath();
  ctx.fill();
  // 剪影勾线 + 左缘蓝色轮廓光
  ctx.beginPath();
  ctx.moveTo(tipX, y - h);
  ctx.lineTo(x + w, y + 2);
  ctx.lineTo(x + w * 0.1, y + 4);
  ctx.lineTo(x - w * 0.8, y + 3);
  ctx.closePath();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(160, 216, 255, 0.85)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(tipX, y - h);
  ctx.lineTo(x - w * 0.8, y + 3);
  ctx.stroke();
  // 伴生小冰锥
  ctx.fillStyle = mixColor(color, '#cfe8fa', 0.45);
  ctx.beginPath();
  ctx.moveTo(x + w * 0.95, y - h * 0.42);
  ctx.lineTo(x + w * 1.5, y + 3);
  ctx.lineTo(x + w * 0.55, y + 3.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  sparkleCross(ctx, x - w * 0.35, y - h * 0.55, 2.4);
  sparkleCross(ctx, x + w * 0.6, y - h * 0.2, 1.8, 'rgba(220, 240, 255, 0.8)');
}

/** 裂隙折线点列（两端 y 摆动收小）。 */
function crackPoints(x: number, y: number, rand: () => number, span = 13): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const n = 6;
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    const edge = i === 0 || i === n - 1;
    pts.push({ x: x - span + t * span * 2, y: y + (rand() - 0.5) * (edge ? 3 : 9) });
  }
  return pts;
}

/** 沿折线描出中间宽两端尖的裂隙带轮廓。 */
function traceCrackBand(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], w: number): void {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 1) {
    const hw = Math.max(0.3, Math.sin((i / (pts.length - 1)) * Math.PI) * w);
    if (i === 0) {
      ctx.moveTo(pts[i].x, pts[i].y - hw);
    } else {
      ctx.lineTo(pts[i].x, pts[i].y - hw);
    }
  }
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const hw = Math.max(0.3, Math.sin((i / (pts.length - 1)) * Math.PI) * w);
    ctx.lineTo(pts[i].x, pts[i].y + hw);
  }
  ctx.closePath();
}

function drawEmberCrack(ctx: CanvasRenderingContext2D, x: number, y: number, ember: string, rand: () => number): void {
  const pts = crackPoints(x, y, rand);
  // 熔隙：暗红缘 → 亮橙芯
  const grad = ctx.createLinearGradient(x, y - 4, x, y + 4);
  grad.addColorStop(0, '#611a0c');
  grad.addColorStop(0.5, mixColor(ember, '#ffcf6e', 0.35));
  grad.addColorStop(1, '#571507');
  traceCrackBand(ctx, pts, 2.8);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(45, 22, 14, 0.65)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 亮芯线
  ctx.strokeStyle = mixColor(ember, '#ffe9a8', 0.55);
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 1) {
    if (i === 0) {
      ctx.moveTo(pts[i].x, pts[i].y);
    } else {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
  }
  ctx.stroke();
  // 热浪光 + 飘浮火星
  const glow = ctx.createRadialGradient(x, y, 1, x, y, 13);
  glow.addColorStop(0, withAlpha(ember, 0.4));
  glow.addColorStop(1, withAlpha(ember, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(x - 13, y - 13, 26, 26);
  const embers = 3 + Math.floor(rand() * 2);
  for (let i = 0; i < embers; i += 1) {
    ctx.fillStyle = withAlpha(mixColor(ember, '#ffe08a', rand() * 0.55), 0.45 + rand() * 0.45);
    ctx.beginPath();
    ctx.arc(x + (rand() - 0.5) * 20, y - 3 - rand() * 11, 0.8 + rand(), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSnowPatch(ctx: CanvasRenderingContext2D, x: number, y: number, rand: () => number): void {
  const r = 10 + rand() * 6;
  // 底层阴影蓝 + 右上白亮层
  ctx.fillStyle = 'rgba(148, 176, 212, 0.4)';
  blobPath(ctx, x - 1.5, y + 1.8, r, rand, 6);
  ctx.fill();
  ctx.fillStyle = 'rgba(252, 254, 255, 0.92)';
  blobPath(ctx, x + 1.6, y - 1.6, r * 0.88, rand, 6);
  ctx.fill();
  sparkleCross(ctx, x + r * 0.3, y - r * 0.32, 2);
}

function drawBrokenColumn(ctx: CanvasRenderingContext2D, x: number, y: number, stone: string, rand: () => number, outline = OUTLINE_DAY): void {
  const h = 16 + rand() * 10;
  const hw = 6;
  contactShadow(ctx, x + 1, y + 6, hw * 1.9, 3.6, 0.22);
  const seed = forkSeed(rand);
  // 柱身剪影：手绘四边形 → 填暗调，再裁进剪影铺固有色/受光竖带
  organicQuad(ctx, x - hw, y - h, hw * 2, h + 5, 2, mulberry32(seed));
  ctx.fillStyle = mixColor(stone, '#4a4436', 0.35);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = stone;
  ctx.fillRect(x - hw * 0.4, y - h - 4, hw * 1.4, h + 10);
  ctx.fillStyle = mixColor(stone, '#fff8e2', 0.32);
  ctx.fillRect(x + hw * 0.35, y - h - 4, hw * 0.65, h + 10);
  ctx.restore();
  // 两道凹槽线（微弯）
  ctx.strokeStyle = withAlpha(mixColor(stone, '#3c3628', 0.5), 0.5);
  ctx.lineWidth = 1;
  for (const fx of [x - hw * 0.35, x + hw * 0.18]) {
    curvedSeam(ctx, fx, y - h + 2, fx + 0.6, y + 3.4, 1.1);
  }
  // 柱身勾线（重放同一手绘轮廓，断口盖在其上）
  organicQuad(ctx, x - hw, y - h, hw * 2, h + 5, 2, mulberry32(seed));
  ctx.strokeStyle = outline;
  ctx.lineWidth = OUTLINE_W;
  ctx.stroke();
  // 断口：锯齿亮顶面 + 暗内芯
  ctx.fillStyle = mixColor(stone, '#fffbe8', 0.42);
  ctx.beginPath();
  ctx.moveTo(x - hw, y - h + 1);
  ctx.lineTo(x - hw * 0.5, y - h - 3.4);
  ctx.lineTo(x - 0.4, y - h + 1.2);
  ctx.lineTo(x + hw * 0.32, y - h - 2.6);
  ctx.lineTo(x + hw, y - h - 0.4);
  ctx.lineTo(x + hw, y - h + 2.6);
  ctx.lineTo(x - hw, y - h + 2.6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.fillStyle = mixColor(stone, '#57503c', 0.5);
  ctx.beginPath();
  ctx.moveTo(x - hw * 0.5, y - h + 2.4);
  ctx.lineTo(x + hw * 0.32, y - h + 0.4);
  ctx.lineTo(x + hw * 0.8, y - h + 2.6);
  ctx.lineTo(x - hw * 0.4, y - h + 3.2);
  ctx.closePath();
  ctx.fill();
  // 苔藓
  ctx.fillStyle = withAlpha('#7aa45c', 0.75);
  blobPath(ctx, x - hw * 0.5, y - h * 0.4, 3.4 + rand() * 2, rand, 5);
  ctx.fill();
  // 基座碎石两块
  for (const side of [-1, 1] as const) {
    const rx = x + side * (hw + 3 + rand() * 3);
    const ry = y + 3.4;
    ctx.fillStyle = mixColor(stone, side < 0 ? '#4a4436' : '#efe6cc', 0.3);
    ctx.beginPath();
    ctx.moveTo(rx - 3, ry + 2);
    ctx.lineTo(rx - 1 + rand(), ry - 2.6);
    ctx.lineTo(rx + 3, ry - 0.6);
    ctx.lineTo(rx + 2.4, ry + 2.2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
}

function drawMossStone(ctx: CanvasRenderingContext2D, x: number, y: number, stone: string, moss: string, rand: () => number, outline = OUTLINE_DAY): void {
  drawRock(ctx, x, y, stone, rand, outline);
  // 苔衣披在左上：暗底 + 亮顶两层
  ctx.fillStyle = withAlpha(mixColor(moss, '#1e3a1c', 0.4), 0.85);
  blobPath(ctx, x - 2.4, y - 3.4, 4.6 + rand() * 2, rand, 6);
  ctx.fill();
  ctx.fillStyle = withAlpha(mixColor(moss, '#e2f4b8', 0.35), 0.9);
  blobPath(ctx, x - 1.2, y - 4.4, 3 + rand() * 1.4, rand, 5);
  ctx.fill();
}

function drawCrystalSpire(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, rand: () => number, outline = OUTLINE_NIGHT): void {
  const h = 18 + rand() * 12;
  contactShadow(ctx, x, y + 5.5, 11, 3.6, 0.2);
  // 暗岩基座
  ctx.fillStyle = '#383c52';
  blobPath(ctx, x - 4, y + 3.4, 4.6 + rand() * 1.6, rand, 5);
  ctx.fill();
  ctx.fillStyle = '#2e3146';
  blobPath(ctx, x + 4.4, y + 4, 3.8 + rand() * 1.6, rand, 5);
  ctx.fill();
  // 双层辉光
  const glowOut = ctx.createRadialGradient(x, y - h * 0.45, 2, x, y - h * 0.45, 24);
  glowOut.addColorStop(0, withAlpha(color, 0.3));
  glowOut.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = glowOut;
  ctx.fillRect(x - 24, y - h * 0.45 - 24, 48, 48);
  const glowIn = ctx.createRadialGradient(x, y - h * 0.5, 1, x, y - h * 0.5, 10);
  glowIn.addColorStop(0, withAlpha(color, 0.55));
  glowIn.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = glowIn;
  ctx.fillRect(x - 10, y - h * 0.5 - 10, 20, 20);
  // 主晶三棱面（左暗/右亮/中央高光棱）
  const apexX = x + (rand() - 0.5) * 1.5;
  ctx.fillStyle = mixColor(color, '#31355e', 0.45);
  ctx.beginPath();
  ctx.moveTo(apexX, y - h);
  ctx.lineTo(x - 5, y - h * 0.36);
  ctx.lineTo(x - 3.4, y + 4);
  ctx.lineTo(x - 0.4, y + 4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = mixColor(color, '#f2f6ff', 0.4);
  ctx.beginPath();
  ctx.moveTo(apexX, y - h);
  ctx.lineTo(x + 5, y - h * 0.36);
  ctx.lineTo(x + 3.4, y + 4);
  ctx.lineTo(x - 0.4, y + 4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = withAlpha('#ffffff', 0.65);
  ctx.beginPath();
  ctx.moveTo(apexX, y - h);
  ctx.lineTo(x + 1.4, y - h * 0.4);
  ctx.lineTo(x - 0.4, y + 4);
  ctx.lineTo(x - 1.2, y - h * 0.42);
  ctx.closePath();
  ctx.fill();
  // 剪影勾线
  ctx.beginPath();
  ctx.moveTo(apexX, y - h);
  ctx.lineTo(x + 5, y - h * 0.36);
  ctx.lineTo(x + 3.4, y + 4);
  ctx.lineTo(x - 3.4, y + 4);
  ctx.lineTo(x - 5, y - h * 0.36);
  ctx.closePath();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 1;
  ctx.stroke();
  // 伴生小晶
  ctx.fillStyle = mixColor(color, '#cdd8ff', 0.35);
  ctx.beginPath();
  ctx.moveTo(x + 7, y - h * 0.4);
  ctx.lineTo(x + 9.6, y + 4);
  ctx.lineTo(x + 4.6, y + 4.4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  sparkleCross(ctx, x + 2.4, y - h * 0.78, 2.6);
  sparkleCross(ctx, x - 3, y - h * 0.3, 1.8, 'rgba(230, 238, 255, 0.8)');
  if (rand() < 0.6) {
    sparkleCross(ctx, x + 6.4, y - h * 0.28, 1.5, 'rgba(230, 238, 255, 0.7)');
  }
}

function drawRuneStone(ctx: CanvasRenderingContext2D, x: number, y: number, stone: string, rune: string, rand: () => number, outline = OUTLINE_NIGHT): void {
  drawRock(ctx, x, y, stone, rand, outline);
  // 符文辉光 + 亮刻痕
  const halo = ctx.createRadialGradient(x, y - 1, 1, x, y - 1, 9);
  halo.addColorStop(0, withAlpha(rune, 0.5));
  halo.addColorStop(1, withAlpha(rune, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(x - 9, y - 10, 18, 18);
  ctx.strokeStyle = mixColor(rune, '#ffffff', 0.35);
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(x, y - 5);
  ctx.lineTo(x, y + 3);
  ctx.moveTo(x, y - 2.4);
  ctx.lineTo(x - 2.8, y - 4.6);
  ctx.moveTo(x, y - 2.4);
  ctx.lineTo(x + 2.8, y - 4.6);
  ctx.stroke();
}

function drawVoidCrack(ctx: CanvasRenderingContext2D, x: number, y: number, spark: string, rand: () => number): void {
  const pts = crackPoints(x, y, rand, 12);
  // 虚空裂隙：紫黑渐变填充
  const grad = ctx.createLinearGradient(x, y - 4, x, y + 4);
  grad.addColorStop(0, '#080614');
  grad.addColorStop(0.55, '#3c2a6e');
  grad.addColorStop(1, '#0c0920');
  traceCrackBand(ctx, pts, 3.1);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(18, 14, 38, 0.8)';
  ctx.lineWidth = 1.1;
  ctx.stroke();
  // 上缘一线紫色轮廓光
  ctx.strokeStyle = 'rgba(178, 138, 255, 0.75)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 1) {
    const hw = Math.max(0.3, Math.sin((i / (pts.length - 1)) * Math.PI) * 3.1);
    if (i === 0) {
      ctx.moveTo(pts[i].x, pts[i].y - hw);
    } else {
      ctx.lineTo(pts[i].x, pts[i].y - hw);
    }
  }
  ctx.stroke();
  // 漂浮碎星（小方块 + 微光）
  const sparks = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < sparks; i += 1) {
    const sx = x + (rand() - 0.5) * 20;
    const sy = y - 3 - rand() * 10;
    const s = 1.4 + rand() * 1.2;
    const g = ctx.createRadialGradient(sx, sy, 0.4, sx, sy, s * 3);
    g.addColorStop(0, withAlpha(spark, 0.5));
    g.addColorStop(1, withAlpha(spark, 0));
    ctx.fillStyle = g;
    ctx.fillRect(sx - s * 3, sy - s * 3, s * 6, s * 6);
    ctx.fillStyle = withAlpha(spark, 0.9);
    ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
  }
}

// ── 道路彩带 ────────────────────────────────

function drawPathRibbons(ctx: CanvasRenderingContext2D, pal: ScenePalette, map: PrecomputedMap, geom: StageGeom): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 分层画法：每一层先画完【所有】路径再进下一层——交叉/汇合处才不会被后画路径的暗边切开
  // L1 底影（整体向下偏 3px）
  ctx.strokeStyle = 'rgba(40, 34, 22, 0.15)';
  ctx.lineWidth = TILE * 0.95;
  for (const path of map.paths) {
    tracePathPolyline(ctx, geom, path.waypoints, 0, 3);
    ctx.stroke();
  }
  // L2 暗色路缘
  ctx.strokeStyle = pal.path.edge;
  ctx.lineWidth = TILE * 0.86;
  for (const path of map.paths) {
    tracePathPolyline(ctx, geom, path.waypoints);
    ctx.stroke();
  }
  // L3 主路面
  ctx.strokeStyle = pal.path.fill;
  ctx.lineWidth = TILE * 0.72;
  for (const path of map.paths) {
    tracePathPolyline(ctx, geom, path.waypoints);
    ctx.stroke();
  }
  // L4 内侧亮带（受光）
  ctx.strokeStyle = mixColor(pal.path.fill, '#ffffff', 0.18);
  ctx.lineWidth = TILE * 0.58;
  for (const path of map.paths) {
    tracePathPolyline(ctx, geom, path.waypoints);
    ctx.stroke();
  }
  // L5 中央磨损辙痕
  ctx.strokeStyle = withAlpha(pal.path.wear, 0.45);
  ctx.lineWidth = TILE * 0.3;
  for (const path of map.paths) {
    tracePathPolyline(ctx, geom, path.waypoints);
    ctx.stroke();
  }
  // L6 装饰：石板 / 碎石 / 路缘草（全部路径统一在路面之上）
  for (const path of map.paths) {
    const rand = mulberry32(hash32(map.cfg.id) ^ path.spawnKey ^ 0x9a7e);
    for (let ci = 0; ci < path.cells.length; ci += 1) {
      const cell = path.cells[ci];
      const c = cellCenter(geom, cell.row, cell.col);
      // 石板：交替偏路两侧的手绘不规则四边形（填完直接勾同一轮廓）
      {
        const side = ci % 2 === 0 ? -1 : 1;
        const sx = c.x + side * (4 + rand() * 6) + (rand() - 0.5) * 8;
        const sy = c.y + (rand() - 0.5) * 14;
        const sw = 11 + rand() * 7;
        const sh = 8 + rand() * 5;
        const slab = mixColor(pal.path.fill, pal.path.edge, 0.28 + rand() * 0.15);
        ctx.fillStyle = slab;
        organicQuad(ctx, sx - sw / 2, sy - sh / 2, sw, sh, 3, rand);
        ctx.fill();
        ctx.strokeStyle = withAlpha(pal.path.edge, 0.4);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        curvedSeam(ctx, sx - sw / 2 + 2, sy - sh / 2 + 1.2, sx + sw / 2 - 2, sy - sh / 2 + 1.2, 0.9);
      }
      // 碎石点
      for (let i = 0; i < 2; i += 1) {
        ctx.fillStyle = withAlpha(pal.path.wear, 0.5 + rand() * 0.3);
        ctx.beginPath();
        ctx.ellipse(c.x + (rand() - 0.5) * TILE * 0.55, c.y + (rand() - 0.5) * TILE * 0.55, 1.6 + rand() * 1.6, 1.2 + rand() * 1.2, rand() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // 路缘草叶（草系主题，约每 2 格一簇，探进路面边缘）
      if ((pal.theme === 'meadow' || pal.theme === 'brook' || pal.theme === 'ruins') && ci % 2 === 1) {
        const side = rand() < 0.5 ? -1 : 1;
        const gx = c.x + (rand() - 0.5) * TILE * 0.4;
        const gy = c.y + side * TILE * 0.36;
        for (let i = 0; i < 3; i += 1) {
          ctx.fillStyle = withAlpha(mixColor(pal.decor.primary, '#ffffff', rand() * 0.2), 0.85);
          leafPath(ctx, gx + (rand() - 0.5) * 8, gy, -Math.PI / 2 + (rand() - 0.5) * 1.2 + (side < 0 ? 0.6 : -0.6), 5 + rand() * 5, 1.4);
          ctx.fill();
        }
      }
    }
  }
  // 近战部署角标（柔化的四角小蓝点）
  ctx.fillStyle = 'rgba(59, 130, 246, 0.45)';
  for (const key of map.meleeCellSet) {
    const row = Math.floor(key / 1000);
    const col = key % 1000;
    const x = geom.ox + col * TILE;
    const y = geom.oy + row * TILE;
    for (const [dx, dy] of [[9, 9], [TILE - 9, 9], [9, TILE - 9], [TILE - 9, TILE - 9]] as const) {
      ctx.beginPath();
      ctx.arc(x + dx, y + dy, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function tracePathPolyline(
  ctx: CanvasRenderingContext2D,
  geom: StageGeom,
  waypoints: { x: number; y: number }[],
  normalOffset = 0,
  yOffset = 0,
): void {
  ctx.beginPath();
  for (let i = 0; i < waypoints.length; i += 1) {
    const at = milliToStage(geom, waypoints[i].x, waypoints[i].y);
    let ox = 0;
    let oy = 0;
    if (normalOffset !== 0 && i + 1 < waypoints.length) {
      const next = milliToStage(geom, waypoints[i + 1].x, waypoints[i + 1].y);
      const dx = next.x - at.x;
      const dy = next.y - at.y;
      const len = Math.hypot(dx, dy) || 1;
      ox = (-dy / len) * normalOffset;
      oy = (dx / len) * normalOffset;
    }
    if (i === 0) {
      ctx.moveTo(at.x + ox, at.y + oy + yOffset);
    } else {
      ctx.lineTo(at.x + ox, at.y + oy + yOffset);
    }
  }
}

// ── 高台 ────────────────────────────────

function drawPlatforms(ctx: CanvasRenderingContext2D, pal: ScenePalette, map: PrecomputedMap, geom: StageGeom): void {
  for (const key of map.rangedCellSet) {
    const row = Math.floor(key / 1000);
    const col = key % 1000;
    const x = geom.ox + col * TILE;
    const y = geom.oy + row * TILE;
    const rand = cellRand(map.cfg.id, row, col);
    // 落影（柔和团块）
    ctx.fillStyle = 'rgba(25, 32, 45, 0.26)';
    blobPath(ctx, x + TILE / 2 + 4, y + TILE / 2 + 8, TILE * 0.44, rand, 7);
    ctx.fill();
    // 立面：纵向渐变（上亮下暗，手绘轮廓）
    const sideGrad = ctx.createLinearGradient(0, y + 8, 0, y + TILE - 3);
    sideGrad.addColorStop(0, mixColor(pal.platform.side, '#ffffff', 0.12));
    sideGrad.addColorStop(1, mixColor(pal.platform.side, '#1d1a12', 0.28));
    ctx.fillStyle = sideGrad;
    organicQuad(ctx, x + 4, y + 8, TILE - 8, TILE - 11, 8, rand);
    ctx.fill();
    // 台面：斜向渐变（光从右上，手绘轮廓）
    const topGrad = ctx.createLinearGradient(x + TILE - 6, y + 4, x + 6, y + TILE - 12);
    topGrad.addColorStop(0, mixColor(pal.platform.top, '#fffbe8', 0.16));
    topGrad.addColorStop(1, mixColor(pal.platform.top, '#4a4436', 0.12));
    ctx.fillStyle = topGrad;
    organicQuad(ctx, x + 4, y + 4, TILE - 8, TILE - 13, 8, rand);
    ctx.fill();
    // 砖缝：1 条横缝 + 2~3 条错位竖缝（全部微弯）
    ctx.strokeStyle = withAlpha(pal.platform.side, 0.35);
    ctx.lineWidth = 1;
    const seamY = y + 4 + (TILE - 13) * (0.4 + rand() * 0.25);
    curvedSeam(ctx, x + 7, seamY, x + TILE - 7, seamY + (rand() - 0.5) * 2, 1.4);
    const ticks = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < ticks; i += 1) {
      const tx = x + 10 + rand() * (TILE - 20);
      const upper = rand() < 0.5;
      curvedSeam(ctx, tx, upper ? y + 6 : seamY, tx + (rand() - 0.5) * 2.4, upper ? seamY : y + TILE - 11, 1.1);
    }
    // 缺角碎屑（小亮三角）
    for (let i = 0; i < 1 + Math.floor(rand() * 2); i += 1) {
      const chipX = x + 8 + rand() * (TILE - 16);
      const chipY = y + 6 + rand() * (TILE - 20);
      ctx.fillStyle = withAlpha(mixColor(pal.platform.top, '#ffffff', 0.4), 0.7);
      ctx.beginPath();
      ctx.moveTo(chipX, chipY);
      ctx.lineTo(chipX + 3 + rand() * 2, chipY + 1);
      ctx.lineTo(chipX + 1, chipY + 3);
      ctx.closePath();
      ctx.fill();
    }
    // 主题角饰
    const ax = x + 9;
    const ay = y + TILE - 16;
    if (pal.theme === 'meadow' || pal.theme === 'brook') {
      ctx.fillStyle = withAlpha(pal.decor.primary, 0.8);
      blobPath(ctx, ax, ay, 4 + rand() * 2, rand, 5);
      ctx.fill();
      ctx.fillStyle = pal.decor.accent;
      ctx.beginPath();
      ctx.arc(ax + 3, ay - 3, 1.6, 0, Math.PI * 2);
      ctx.fill();
    } else if (pal.theme === 'frostfire') {
      ctx.fillStyle = 'rgba(250, 253, 255, 0.85)';
      blobPath(ctx, x + TILE / 2, y + 7, 6 + rand() * 3, rand, 6);
      ctx.fill();
    } else if (pal.theme === 'starlit') {
      const lampGlow = ctx.createRadialGradient(ax, ay, 1, ax, ay, 8);
      lampGlow.addColorStop(0, withAlpha(pal.decor.secondary, 0.8));
      lampGlow.addColorStop(1, withAlpha(pal.decor.secondary, 0));
      ctx.fillStyle = lampGlow;
      ctx.fillRect(ax - 8, ay - 8, 16, 16);
      ctx.fillStyle = mixColor(pal.decor.secondary, '#ffffff', 0.4);
      ctx.beginPath();
      ctx.arc(ax, ay, 2.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (pal.theme === 'ruins') {
      ctx.fillStyle = withAlpha(pal.decor.accent, 0.6);
      blobPath(ctx, ax, ay, 3.6 + rand() * 2, rand, 5);
      ctx.fill();
      ctx.strokeStyle = withAlpha(pal.platform.side, 0.5);
      curvedSeam(ctx, ax + 6, ay - 8, ax + 10 + rand() * 4, ay - 2, 1.3);
    } else if (pal.theme === 'thunder') {
      ctx.fillStyle = withAlpha(pal.decor.secondary, 0.9);
      ctx.beginPath();
      ctx.moveTo(ax, ay - 7);
      ctx.lineTo(ax + 2.6, ay + 1);
      ctx.lineTo(ax - 2.6, ay + 1);
      ctx.closePath();
      ctx.fill();
    }
    // 受光棱边：只描顶边与右边（长段微弓，去直尺感）
    ctx.strokeStyle = withAlpha(pal.platform.rim, 0.8);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 5.8);
    ctx.quadraticCurveTo(x + TILE / 2, y + 4.8, x + TILE - 10, y + 5.5);
    ctx.quadraticCurveTo(x + TILE - 5.5, y + 5.5, x + TILE - 5.5, y + 10);
    ctx.quadraticCurveTo(x + TILE - 4.8, y + TILE / 2, x + TILE - 5.5, y + TILE - 14);
    ctx.stroke();
  }
}

// ── 机制格（4~6 图逐机制独立精绘） ────────────────────────

interface MechanicStyle {
  fill: string;
  stroke: string;
  label: string;
}

const MECHANIC_SCENE_STYLE: Record<string, MechanicStyle> = {
  frostfire_fault: { fill: 'rgba(248, 113, 113, 0.2)', stroke: 'rgba(14, 165, 233, 0.7)', label: 'F' },
  rubblemist_resonance: { fill: 'rgba(148, 163, 184, 0.2)', stroke: 'rgba(74, 222, 128, 0.6)', label: 'R' },
  thundervoid_overload: { fill: 'rgba(250, 204, 21, 0.2)', stroke: 'rgba(96, 165, 250, 0.7)', label: 'V' },
};

function drawMechanicCells(ctx: CanvasRenderingContext2D, map: PrecomputedMap, geom: StageGeom): void {
  for (const mechanic of map.cfg.mechanics ?? []) {
    const style = MECHANIC_SCENE_STYLE[mechanic.id] ?? { fill: 'rgba(255,255,255,0.14)', stroke: 'rgba(255,255,255,0.4)', label: '!' };
    for (const key of map.mechanicCellSets[mechanic.id] ?? []) {
      const row = Math.floor(key / 1000);
      const col = key % 1000;
      const x = geom.ox + col * TILE;
      const y = geom.oy + row * TILE;
      const rand = cellRand(map.cfg.id, row, col);
      // 机制元素全部限制在格内（±4px 裁剪保险）
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - 2, y - 2, TILE + 4, TILE + 4);
      ctx.clip();
      if (mechanic.id === 'frostfire_fault') {
        drawFrostfireFaultCell(ctx, x, y, style, rand);
      } else if (mechanic.id === 'rubblemist_resonance') {
        drawRubblemistResonanceCell(ctx, x, y, style, rand);
      } else if (mechanic.id === 'thundervoid_overload') {
        drawThundervoidOverloadCell(ctx, x, y, style, rand);
      } else {
        // 未知机制兜底：淡色团块 + 描边
        ctx.fillStyle = style.fill;
        blobPath(ctx, x + TILE / 2, y + TILE / 2, TILE * 0.32, rand, 7);
        ctx.fill();
        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

/** 寒火断层格（重设计）：融雪温泉熔眼——雪缘环抱的有机泉池，池心暖光、冰晶点缀、蒸汽缭绕，与雪原色调统一。 */
function drawFrostfireFaultCell(ctx: CanvasRenderingContext2D, x: number, y: number, style: MechanicStyle, rand: () => number): void {
  const cx = x + TILE / 2 + (rand() - 0.5) * 4;
  const cy = y + TILE / 2 + (rand() - 0.5) * 4;
  // 暖光轻染地面（很淡，融进雪地）
  const spill = ctx.createRadialGradient(cx, cy, 4, cx, cy, 26);
  spill.addColorStop(0, 'rgba(255, 178, 120, 0.16)');
  spill.addColorStop(1, 'rgba(255, 178, 120, 0)');
  ctx.fillStyle = spill;
  ctx.fillRect(x, y, TILE, TILE);
  // 外圈融雪缘：白雪软环（两瓣错位团块）
  ctx.fillStyle = 'rgba(250, 253, 255, 0.85)';
  blobPath(ctx, cx, cy, 17.5, rand, 8);
  ctx.fill();
  ctx.fillStyle = 'rgba(196, 216, 236, 0.5)';
  blobPath(ctx, cx + 2, cy + 2.5, 16, rand, 7);
  ctx.fill();
  // 泉池：有机轮廓 + 径向渐变（冰蓝池缘 → 暖琥珀池心）
  const poolSeed = mulberry32(Math.floor(cx * 31 + cy * 57));
  const pool = ctx.createRadialGradient(cx, cy, 1.5, cx, cy, 13);
  pool.addColorStop(0, '#ffbf7d');
  pool.addColorStop(0.42, mixColor('#e8925c', '#7ba8c4', 0.35));
  pool.addColorStop(1, mixColor('#9cc4dc', '#5c86a8', 0.4));
  ctx.fillStyle = pool;
  blobPath(ctx, cx, cy, 12.5, poolSeed, 8);
  ctx.fill();
  // 岸线墨描 + 冰侧受光弧
  ctx.strokeStyle = 'rgba(70, 92, 116, 0.55)';
  ctx.lineWidth = 1.2;
  blobPath(ctx, cx, cy, 12.5, mulberry32(Math.floor(cx * 31 + cy * 57)), 8);
  ctx.stroke();
  ctx.strokeStyle = withAlpha(style.stroke, 0.75);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx - 2, cy - 2.5, 9.5, Math.PI * 0.85, Math.PI * 1.55);
  ctx.stroke();
  // 池心暖芯亮点
  ctx.fillStyle = 'rgba(255, 226, 170, 0.9)';
  ctx.beginPath();
  ctx.ellipse(cx + 1, cy + 0.5, 3.2, 2.2, rand() * 0.8, 0, Math.PI * 2);
  ctx.fill();
  // 池缘冰晶（两簇小双面棱晶）
  for (let i = 0; i < 2; i += 1) {
    const a = rand() * Math.PI * 2;
    const bxp = cx + Math.cos(a) * 13;
    const byp = cy + Math.sin(a) * 11;
    const h = 5.5 + rand() * 3.5;
    ctx.fillStyle = mixColor('#cfe6f6', '#8fb8d4', 0.4);
    ctx.beginPath();
    ctx.moveTo(bxp, byp - h);
    ctx.lineTo(bxp + 2.4, byp + 1);
    ctx.lineTo(bxp - 1.8, byp + 1.4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.beginPath();
    ctx.moveTo(bxp, byp - h);
    ctx.lineTo(bxp + 1, byp);
    ctx.lineTo(bxp, byp + 0.6);
    ctx.closePath();
    ctx.fill();
  }
  // 蒸汽缭绕：两缕上升卷须（宽淡 + 细亮双层）
  for (let i = 0; i < 2; i += 1) {
    const sxp = cx + (i === 0 ? -3.5 : 4) + (rand() - 0.5) * 3;
    const sway = (rand() - 0.5) * 8;
    const top = cy - 15 - rand() * 6;
    for (const [w, a] of [[2.6, 0.22], [1.1, 0.4]] as const) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${a})`;
      ctx.lineWidth = w;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sxp, cy - 3);
      ctx.bezierCurveTo(sxp + sway, cy - 9, sxp - sway * 0.7, top + 6, sxp + sway * 0.5, top);
      ctx.stroke();
    }
  }
  // 池上浮动火星（1~2 颗，微光）
  const motes = 1 + Math.floor(rand() * 2);
  for (let i = 0; i < motes; i += 1) {
    const mxp = cx + (rand() - 0.5) * 12;
    const myp = cy - 4 - rand() * 8;
    const g = ctx.createRadialGradient(mxp, myp, 0.3, mxp, myp, 3.4);
    g.addColorStop(0, 'rgba(255, 205, 130, 0.75)');
    g.addColorStop(1, 'rgba(255, 205, 130, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(mxp - 3.4, myp - 3.4, 6.8, 6.8);
    ctx.fillStyle = '#ffd89a';
    ctx.beginPath();
    ctx.arc(mxp, myp, 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  // 冷侧碎钻星芒
  sparkleCross(ctx, cx - 10, cy - 9, 1.8, 'rgba(225, 242, 255, 0.85)');
}

/** 碎雾共鸣格：迷你巨石阵——苔石碑环列 + 绿色共鸣雾丝 + 手绘涟漪 + 底部雾池。 */
function drawRubblemistResonanceCell(ctx: CanvasRenderingContext2D, x: number, y: number, style: MechanicStyle, rand: () => number): void {
  const cx = x + TILE / 2;
  const cy = y + TILE / 2 + 2;
  // 石阵脚下雾池（两层淡团块）
  ctx.fillStyle = style.fill;
  blobPath(ctx, cx, cy + 4, 21, rand, 8);
  ctx.fill();
  ctx.fillStyle = 'rgba(232, 240, 224, 0.22)';
  blobPath(ctx, cx - 4, cy + 7, 13, rand, 6);
  ctx.fill();
  // 两道不完整涟漪弧：半径逐段摆动的手绘感
  for (let ring = 0; ring < 2; ring += 1) {
    const r0 = 13.5 + ring * 7;
    const a0 = rand() * Math.PI * 2;
    const span = Math.PI * (1.15 + rand() * 0.5);
    const segs = 7;
    const rpts: { x: number; y: number }[] = [];
    for (let i = 0; i <= segs; i += 1) {
      const a = a0 + (span * i) / segs;
      const rr = r0 + (rand() - 0.5) * 3;
      rpts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr * 0.86 });
    }
    ctx.strokeStyle = withAlpha('#7ec898', 0.36 - ring * 0.1);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    traceSmooth(ctx, rpts, true);
    ctx.stroke();
  }
  // 巨石环：3~4 座双色苔石碑，后排先画
  const stones = 3 + Math.floor(rand() * 2);
  const spin = rand() * Math.PI * 2;
  const slots: { sx: number; sy: number; h: number; seed: number }[] = [];
  for (let i = 0; i < stones; i += 1) {
    const a = spin + (Math.PI * 2 * i) / stones + (rand() - 0.5) * 0.5;
    slots.push({ sx: cx + Math.cos(a) * 15, sy: cy + Math.sin(a) * 11, h: 10.5 + rand() * 5, seed: forkSeed(rand) });
  }
  slots.sort((p, q) => p.sy - q.sy);
  for (const s of slots) {
    drawMiniMonolith(ctx, s.sx, s.sy, s.h, mulberry32(s.seed));
  }
  // 共鸣雾丝：石间盘旋上升的绿色卷须（宽淡底 + 细亮芯两层 alpha）
  ctx.lineCap = 'round';
  for (let i = 0; i < 2; i += 1) {
    const a = spin + Math.PI * (0.4 + i * 1.05);
    const wxc = cx + Math.cos(a) * 8;
    const wyc = cy + Math.sin(a) * 6;
    const dir = i === 0 ? 1 : -1;
    const segs = 9;
    const wpts: { x: number; y: number }[] = [];
    for (let k = 0; k <= segs; k += 1) {
      const wa = a + dir * (k / segs) * Math.PI * 2.1;
      const wr = 7.5 - (k / segs) * 5.5 + (rand() - 0.5) * 1.2;
      wpts.push({ x: wxc + Math.cos(wa) * wr, y: wyc + Math.sin(wa) * wr * 0.8 - k * 0.5 });
    }
    ctx.strokeStyle = withAlpha('#8fd0a8', 0.18);
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    traceSmooth(ctx, wpts, true);
    ctx.stroke();
    ctx.strokeStyle = withAlpha('#b8e8c4', 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    traceSmooth(ctx, wpts, true);
    ctx.stroke();
  }
}

/** 迷你苔石碑：手绘双色轮廓 + 勾线 + 苔顶（碎雾共鸣格构件）。 */
function drawMiniMonolith(ctx: CanvasRenderingContext2D, sx: number, sy: number, h: number, rand: () => number): void {
  const w = 4.2 + rand() * 1.8;
  const lean = (rand() - 0.5) * 2.6;
  contactShadow(ctx, sx, sy + 1.6, w * 1.6, 2, 0.18);
  ctx.beginPath();
  ctx.moveTo(sx - w, sy + 1.6);
  ctx.quadraticCurveTo(sx - w - 0.8, sy - h * 0.55, sx - w * 0.55 + lean, sy - h);
  ctx.quadraticCurveTo(sx + lean, sy - h - 1.5, sx + w * 0.6 + lean, sy - h + 0.9);
  ctx.quadraticCurveTo(sx + w + 0.7, sy - h * 0.5, sx + w * 0.9, sy + 1.6);
  ctx.closePath();
  ctx.fillStyle = mixColor('#8f947a', '#4c5140', 0.4);
  ctx.fill();
  ctx.strokeStyle = OUTLINE_DAY;
  ctx.lineWidth = 1;
  ctx.stroke();
  // 右缘受光面
  ctx.fillStyle = mixColor('#8f947a', '#f2f0da', 0.42);
  ctx.beginPath();
  ctx.moveTo(sx + w * 0.55 + lean, sy - h + 1);
  ctx.quadraticCurveTo(sx + w * 0.8, sy - h * 0.45, sx + w * 0.65, sy + 1.2);
  ctx.lineTo(sx + w * 0.9, sy + 1.4);
  ctx.quadraticCurveTo(sx + w + 0.4, sy - h * 0.5, sx + w * 0.6 + lean, sy - h + 0.9);
  ctx.closePath();
  ctx.fill();
  // 苔顶
  ctx.fillStyle = withAlpha('#7aa45c', 0.8);
  blobPath(ctx, sx - w * 0.25 + lean * 0.5, sy - h + 1.6, 2 + rand() * 1.2, rand, 5);
  ctx.fill();
}

/** 雷空过载格：虚空紫底光 + 手书摆动符环（暗紫底描 + 亮描 + 刻记）+ 双层雷纹章 + 环游电火花。 */
function drawThundervoidOverloadCell(ctx: CanvasRenderingContext2D, x: number, y: number, style: MechanicStyle, rand: () => number): void {
  const cx = x + TILE / 2;
  const cy = y + TILE / 2;
  // 虚空紫底光
  const voidGlow = ctx.createRadialGradient(cx, cy, 2, cx, cy, 26);
  voidGlow.addColorStop(0, 'rgba(90, 62, 152, 0.32)');
  voidGlow.addColorStop(0.7, 'rgba(58, 40, 108, 0.14)');
  voidGlow.addColorStop(1, 'rgba(58, 40, 108, 0)');
  ctx.fillStyle = voidGlow;
  ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
  // 手书符环：半径 ±1.5px 摆动的贝塞尔闭环，先暗紫粗底再亮描
  const segs = 11;
  const spin = rand() * Math.PI * 2;
  const ringPts: { x: number; y: number }[] = [];
  for (let i = 0; i < segs; i += 1) {
    const a = spin + (Math.PI * 2 * i) / segs;
    const rr = 19 + (rand() - 0.5) * 3;
    ringPts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
  }
  ctx.beginPath();
  ctx.moveTo((ringPts[segs - 1].x + ringPts[0].x) / 2, (ringPts[segs - 1].y + ringPts[0].y) / 2);
  for (let i = 0; i < segs; i += 1) {
    const p = ringPts[i];
    const q = ringPts[(i + 1) % segs];
    ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
  }
  ctx.closePath();
  ctx.strokeStyle = 'rgba(46, 32, 80, 0.9)';
  ctx.lineWidth = 2.6;
  ctx.stroke();
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = 1.1;
  ctx.stroke();
  // 符环刻记：3~4 个微弯短刻 + 顶点小金点
  const ticks = 3 + Math.floor(rand() * 2);
  ctx.lineWidth = 1.2;
  for (let i = 0; i < ticks; i += 1) {
    const a = spin + (Math.PI * 2 * i) / ticks + (rand() - 0.5) * 0.6;
    ctx.strokeStyle = '#f2d24e';
    curvedSeam(
      ctx,
      cx + Math.cos(a) * 16.5,
      cy + Math.sin(a) * 16.5,
      cx + Math.cos(a) * 21.8,
      cy + Math.sin(a) * 21.8,
      (rand() - 0.5) * 2.4,
    );
    ctx.fillStyle = withAlpha('#f2d24e', 0.85);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * 23.2, cy + Math.sin(a) * 23.2, 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  // 中央雷纹章：金色微光垫底 + 暗紫底纹章 + 亮金锋芯（棱角收锋分层）
  const boltGlow = ctx.createRadialGradient(cx, cy, 1, cx, cy, 13);
  boltGlow.addColorStop(0, 'rgba(255, 226, 120, 0.4)');
  boltGlow.addColorStop(1, 'rgba(255, 226, 120, 0)');
  ctx.fillStyle = boltGlow;
  ctx.fillRect(cx - 13, cy - 13, 26, 26);
  const bolt = (s: number, ox: number, oy: number) => {
    ctx.beginPath();
    ctx.moveTo(cx + 4 * s + ox, cy - 13.5 * s + oy);
    ctx.lineTo(cx - 4.6 * s + ox, cy + 0.6 * s + oy);
    ctx.lineTo(cx - 0.7 * s + ox, cy + 0.9 * s + oy);
    ctx.lineTo(cx - 4.1 * s + ox, cy + 13.5 * s + oy);
    ctx.lineTo(cx + 4.8 * s + ox, cy - 0.7 * s + oy);
    ctx.lineTo(cx + 0.5 * s + ox, cy - 1 * s + oy);
    ctx.closePath();
  };
  bolt(1.24, 0.6, 0.9);
  ctx.fillStyle = '#2e2050';
  ctx.fill();
  bolt(1, 0, 0);
  const boltGrad = ctx.createLinearGradient(cx, cy - 13.5, cx, cy + 13.5);
  boltGrad.addColorStop(0, '#fff3b0');
  boltGrad.addColorStop(1, '#f0b83c');
  ctx.fillStyle = boltGrad;
  ctx.fill();
  // 环游电火花：2~3 颗（微光 + 亮心）
  const sparks = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < sparks; i += 1) {
    const a = spin + rand() * Math.PI * 2;
    const rr = 19 + (rand() - 0.5) * 5;
    const sx = cx + Math.cos(a) * rr;
    const sy = cy + Math.sin(a) * rr;
    const g = ctx.createRadialGradient(sx, sy, 0.3, sx, sy, 4.5);
    g.addColorStop(0, withAlpha('#ffe86e', 0.75));
    g.addColorStop(1, withAlpha('#ffe86e', 0));
    ctx.fillStyle = g;
    ctx.fillRect(sx - 4.5, sy - 4.5, 9, 9);
    ctx.fillStyle = '#fff6c4';
    ctx.beginPath();
    ctx.arc(sx, sy, 1.1 + rand() * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── 主题门 ────────────────────────────────

function isGateCell(map: PrecomputedMap, key: number): boolean {
  for (const path of map.paths) {
    if (path.spawnKey === key || path.exitKey === key) {
      return true;
    }
  }
  return false;
}

function drawGates(ctx: CanvasRenderingContext2D, pal: ScenePalette, map: PrecomputedMap, geom: StageGeom): void {
  for (const path of map.paths) {
    const spawn = path.cells[0];
    const exit = path.cells[path.cells.length - 1];
    drawSpawnGate(ctx, pal, cellCenter(geom, spawn.row, spawn.col), mulberry32(hash32(map.cfg.id) ^ path.spawnKey ^ 0x517a));
    drawExitGate(ctx, pal, cellCenter(geom, exit.row, exit.col), mulberry32(hash32(map.cfg.id) ^ path.exitKey ^ 0x3e9b));
  }
}

/** 出怪门：暗色裂隙拱门 + 暖红涌光（拱弧手绘微不对称）。 */
function drawSpawnGate(ctx: CanvasRenderingContext2D, pal: ScenePalette, at: { x: number; y: number }, rand: () => number): void {
  const glow = ctx.createRadialGradient(at.x, at.y, 4, at.x, at.y, 36);
  glow.addColorStop(0, withAlpha(pal.gate.spawnGlow, 0.85));
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(at.x - 36, at.y - 36, 72, 72);
  // 石拱：侧边微弓 + 双段贝塞尔拱弧（左右不对称，去正圆感）
  const wob = (rand() - 0.5) * 1.6;
  ctx.fillStyle = pal.gate.spawnDark;
  ctx.beginPath();
  ctx.moveTo(at.x - 17, at.y + 23);
  ctx.quadraticCurveTo(at.x - 17.9 + rand() * 0.8, at.y + 9, at.x - 17.2, at.y - 5);
  ctx.bezierCurveTo(at.x - 17.5, at.y - 15.4, at.x - 9.6, at.y - 22.4, at.x + wob, at.y - 22.1);
  ctx.bezierCurveTo(at.x + 10, at.y - 22.6, at.x + 17.4, at.y - 15, at.x + 17, at.y - 5);
  ctx.quadraticCurveTo(at.x + 17.9 - rand() * 0.8, at.y + 9, at.x + 17, at.y + 23);
  ctx.closePath();
  ctx.fill();
  // 拱面砖缝（微弯）
  ctx.strokeStyle = withAlpha('#000000', 0.25);
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i += 1) {
    const a = Math.PI + (Math.PI * (i + 1)) / 4;
    curvedSeam(
      ctx,
      at.x + Math.cos(a) * 11,
      at.y - 5 + Math.sin(a) * 11,
      at.x + Math.cos(a) * 17,
      at.y - 5 + Math.sin(a) * 17,
      0.8 + rand() * 0.8,
    );
  }
  // 门洞（发光的裂隙，洞缘同样手绘）
  const inner = ctx.createLinearGradient(at.x, at.y - 14, at.x, at.y + 22);
  inner.addColorStop(0, mixColor(pal.gate.spawnGlow, '#ffffff', 0.35));
  inner.addColorStop(1, pal.gate.spawnGlow);
  ctx.fillStyle = inner;
  ctx.beginPath();
  ctx.moveTo(at.x - 9, at.y + 22);
  ctx.quadraticCurveTo(at.x - 9.8, at.y + 9, at.x - 9, at.y - 3);
  ctx.bezierCurveTo(at.x - 9.2, at.y - 8.8, at.x - 5.2, at.y - 12.3, at.x + wob * 0.5, at.y - 12);
  ctx.bezierCurveTo(at.x + 5.2, at.y - 12.4, at.x + 9.2, at.y - 8.6, at.x + 9, at.y - 3);
  ctx.quadraticCurveTo(at.x + 9.7, at.y + 9, at.x + 9, at.y + 22);
  ctx.closePath();
  ctx.fill();
  // 顶部小尖饰 + 拱心石
  ctx.fillStyle = pal.gate.spawnDark;
  ctx.beginPath();
  ctx.moveTo(at.x - 5, at.y - 21);
  ctx.lineTo(at.x, at.y - 28);
  ctx.lineTo(at.x + 5, at.y - 21);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = mixColor(pal.gate.spawnDark, '#ffffff', 0.18);
  ctx.beginPath();
  ctx.moveTo(at.x - 4, at.y - 21.5);
  ctx.lineTo(at.x + 4, at.y - 21.5);
  ctx.lineTo(at.x + 2.6, at.y - 14);
  ctx.lineTo(at.x - 2.6, at.y - 14);
  ctx.closePath();
  ctx.fill();
  // 两侧柱基石（手绘四边形）
  ctx.fillStyle = mixColor(pal.gate.spawnDark, '#000000', 0.15);
  organicQuad(ctx, at.x - 21, at.y + 16, 9, 8, 2, rand);
  ctx.fill();
  organicQuad(ctx, at.x + 12, at.y + 16, 9, 8, 2, rand);
  ctx.fill();
}

/** 基地门：水晶神社 + 冷色光晕（基座与碎岩手绘化）。 */
function drawExitGate(ctx: CanvasRenderingContext2D, pal: ScenePalette, at: { x: number; y: number }, rand: () => number): void {
  const glow = ctx.createRadialGradient(at.x, at.y, 4, at.x, at.y, 34);
  glow.addColorStop(0, withAlpha(pal.gate.exitGlow, 0.8));
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(at.x - 34, at.y - 34, 68, 68);
  // 基座（手绘四边形）
  ctx.fillStyle = pal.gate.exitDark;
  organicQuad(ctx, at.x - 16, at.y + 12, 32, 10, 3, rand);
  ctx.fill();
  // 大水晶
  const crystal = ctx.createLinearGradient(at.x - 8, at.y - 24, at.x + 8, at.y + 12);
  crystal.addColorStop(0, mixColor(pal.gate.exitGlow, '#ffffff', 0.55));
  crystal.addColorStop(1, pal.gate.exitGlow);
  ctx.fillStyle = crystal;
  ctx.beginPath();
  ctx.moveTo(at.x, at.y - 26);
  ctx.lineTo(at.x + 9, at.y - 6);
  ctx.lineTo(at.x + 6, at.y + 14);
  ctx.lineTo(at.x - 6, at.y + 14);
  ctx.lineTo(at.x - 9, at.y - 6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = withAlpha(pal.gate.exitDark, 0.6);
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // 高光棱面
  ctx.fillStyle = withAlpha('#ffffff', 0.55);
  ctx.beginPath();
  ctx.moveTo(at.x, at.y - 26);
  ctx.lineTo(at.x + 3.4, at.y - 6);
  ctx.lineTo(at.x - 1, at.y + 6);
  ctx.closePath();
  ctx.fill();
  // 侧伴晶
  ctx.fillStyle = withAlpha(mixColor(pal.gate.exitGlow, '#ffffff', 0.25), 0.9);
  ctx.beginPath();
  ctx.moveTo(at.x - 12, at.y + 14);
  ctx.lineTo(at.x - 15, at.y - 1);
  ctx.lineTo(at.x - 8, at.y + 6);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(at.x + 12, at.y + 14);
  ctx.lineTo(at.x + 15, at.y + 1);
  ctx.lineTo(at.x + 9, at.y + 8);
  ctx.closePath();
  ctx.fill();
  // 基座碎岩（有机小团块，替代标准椭圆）
  ctx.fillStyle = mixColor(pal.gate.exitDark, '#ffffff', 0.2);
  blobPath(ctx, at.x - 14, at.y + 20, 3.8, rand, 5);
  ctx.fill();
  blobPath(ctx, at.x + 15, at.y + 21, 3, rand, 5);
  ctx.fill();
  // 星芒十字
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 1.2;
  for (const [sx, sy, sr] of [
    [at.x + 7, at.y - 18, 3.4],
    [at.x - 10, at.y - 8, 2.4],
    [at.x + 12, at.y + 2, 2],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(sx - sr, sy);
    ctx.lineTo(sx + sr, sy);
    ctx.moveTo(sx, sy - sr);
    ctx.lineTo(sx, sy + sr);
    ctx.stroke();
  }
}

// ── 电影感暗角 ────────────────────────────────

function drawVignette(ctx: CanvasRenderingContext2D, pal: ScenePalette): void {
  const night = pal.theme === 'starlit' || pal.theme === 'thunder';
  const v = ctx.createRadialGradient(STAGE_W / 2, STAGE_H / 2, STAGE_H * 0.45, STAGE_W / 2, STAGE_H / 2, STAGE_H * 0.95);
  v.addColorStop(0, 'rgba(0, 0, 0, 0)');
  v.addColorStop(1, night ? 'rgba(8, 10, 28, 0.34)' : 'rgba(30, 34, 24, 0.22)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  if (!night) {
    // 顶部暖光洒落（极淡，日景）
    const warm = ctx.createLinearGradient(0, 0, 0, STAGE_H * 0.5);
    warm.addColorStop(0, 'rgba(255, 240, 200, 0.05)');
    warm.addColorStop(1, 'rgba(255, 240, 200, 0)');
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, STAGE_W, STAGE_H * 0.5);
  }
}

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
