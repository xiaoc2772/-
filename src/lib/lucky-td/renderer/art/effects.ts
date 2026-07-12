// 幸运塔防 · 动态特效画家：技能特效 / 出生涟漪 / 部署花绽 / 攻击起手 / 死亡消散 / 环境粒子。
// 全部为渲染层视觉状态，不读写引擎逻辑、不消耗引擎 RNG（子粒子用 born+index 的确定性散列）。
// 性能约束：运行时禁用 ctx.filter / shadowBlur，光晕用多层 'lighter' 叠加圆环模拟。

import { STAGE_H, STAGE_W } from '../draw';
import type { Particle } from '../draw';
import { scenePalette } from './palette';

export type SkillEffectKind =
  | 'aura'
  | 'shield'
  | 'slash'
  | 'blast'
  | 'volley'
  | 'nova'
  | 'heal'
  | 'wish'
  | 'spawnRipple'
  | 'deployBloom'
  | 'windup'
  | 'dissolve'
  | 'slashArc'
  | 'thrust'
  | 'cleave'
  | 'clawSwipe'
  | 'biteSnap';

/** 消散主题：花瓣（我方单位）/ 余烬（火系）/ 碎晶（敌人）。 */
export type DissolveVariant = 'petal' | 'ember' | 'shard';

export interface SkillEffect {
  kind: SkillEffectKind;
  x: number;
  y: number;
  born: number;
  duration: number;
  color: string;
  radius: number;
  dir: number;
  targets: { x: number; y: number }[];
  /** 消散主题（kind === 'dissolve' 时使用）。 */
  variant?: DissolveVariant;
  /** 光晕层数（由 EffectBudget 决定，缺省 2）。 */
  glowLayers?: number;
}

// ── 确定性小随机：born + index 散列，重绘/降帧下画面稳定 ──

function hash01(seed: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function effRand(effect: SkillEffect, index: number, salt: number): number {
  return hash01((effect.born | 0) + index * 131 + salt * 7919);
}

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

// ── 通用绘制小件 ────────────────────────────

/** 多层柔光圆环：'lighter' 叠加代替 shadowBlur。 */
function glowRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number, layers: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < layers; i += 1) {
    ctx.globalAlpha = alpha / (i + 1.6);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3 + i * 5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPetal(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rot: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.quadraticCurveTo(size * 0.75, -size * 0.25, 0, size);
  ctx.quadraticCurveTo(-size * 0.75, -size * 0.25, 0, -size);
  ctx.fill();
  ctx.restore();
}

function drawShard(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rot: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.55, 0);
  ctx.lineTo(0, size);
  ctx.lineTo(-size * 0.55, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? radius : radius * 0.42;
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / 10;
    const px = x + Math.cos(angle) * r;
    const py = y + Math.sin(angle) * r;
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
  ctx.fill();
}

// ── 各 kind 画家 ────────────────────────────

function paintAura(ctx: CanvasRenderingContext2D, e: SkillEffect, t: number, ease: number, fade: number, glow: number): void {
  const r = e.radius * ease;
  glowRing(ctx, e.x, e.y, r, e.color, 0.55 * fade, glow);
  ctx.strokeStyle = e.color;
  ctx.lineWidth = 4 * fade + 1;
  ctx.beginPath();
  ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(253, 230, 138, 0.16)';
  ctx.beginPath();
  ctx.arc(e.x, e.y, r * 0.75, 0, Math.PI * 2);
  ctx.fill();
  // 环绕光点
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = e.color;
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI * 2 * i) / 6 + t * 2.4;
    ctx.globalAlpha = fade * 0.8;
    ctx.beginPath();
    ctx.arc(e.x + Math.cos(angle) * r * 0.88, e.y + Math.sin(angle) * r * 0.5, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function paintShield(ctx: CanvasRenderingContext2D, e: SkillEffect, t: number, ease: number, fade: number, glow: number): void {
  const r = e.radius * (0.82 + ease * 0.26);
  const gradient = ctx.createRadialGradient(e.x, e.y, r * 0.25, e.x, e.y, r);
  gradient.addColorStop(0, 'rgba(147, 197, 253, 0.1)');
  gradient.addColorStop(0.72, 'rgba(147, 197, 253, 0.28)');
  gradient.addColorStop(1, 'rgba(147, 197, 253, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
  ctx.fill();
  glowRing(ctx, e.x, e.y, r * 0.9, e.color, 0.4 * fade, glow);
  ctx.strokeStyle = e.color;
  ctx.lineWidth = 4;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.arc(e.x, e.y, r * 0.72, -Math.PI / 2 + t * Math.PI * 2, Math.PI * 1.5 + t * Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function paintSlash(ctx: CanvasRenderingContext2D, e: SkillEffect, t: number, ease: number, fade: number, glow: number): void {
  const angle = [0, Math.PI / 2, Math.PI, -Math.PI / 2][e.dir] ?? 0;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(angle);
  // 主弧光（lighter 双层）
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < glow; i += 1) {
    ctx.globalAlpha = fade / (i + 1);
    ctx.strokeStyle = e.color;
    ctx.lineWidth = (8 - i * 3) * fade + 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(18 + ease * 26, -5, e.radius * 0.55 + i * 4, -0.85, 0.85);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(254, 242, 242, 0.9)';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-12, -34 + ease * 12);
  ctx.lineTo(e.radius * 0.82, 22 - ease * 12);
  ctx.stroke();
  // 拖尾火花
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = '#fff7ed';
  for (let i = 0; i < 4; i += 1) {
    const st = Math.min(1, t + i * 0.08);
    ctx.globalAlpha = fade * (1 - i * 0.2);
    ctx.beginPath();
    ctx.arc(10 + st * e.radius * 0.7, -20 + st * 34, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.restore();
}

function paintBlastNova(ctx: CanvasRenderingContext2D, e: SkillEffect, t: number, ease: number, fade: number, glow: number): void {
  const r = e.radius * ease;
  ctx.fillStyle = e.kind === 'blast' ? 'rgba(251, 146, 60, 0.18)' : 'rgba(196, 181, 253, 0.18)';
  ctx.beginPath();
  ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
  ctx.fill();
  glowRing(ctx, e.x, e.y, r, e.color, 0.6 * fade, glow);
  ctx.strokeStyle = e.color;
  ctx.lineWidth = 5 * fade + 1;
  ctx.beginPath();
  ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
  ctx.stroke();
  // 内圈次生冲击环
  ctx.strokeStyle = e.kind === 'blast' ? 'rgba(255, 237, 213, 0.7)' : 'rgba(237, 233, 254, 0.7)';
  ctx.lineWidth = 2.5 * fade + 0.5;
  ctx.beginPath();
  ctx.arc(e.x, e.y, r * 0.6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = e.kind === 'blast' ? 'rgba(255, 247, 237, 0.65)' : 'rgba(245, 243, 255, 0.7)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 8; i += 1) {
    const angle = (Math.PI * 2 * i) / 8 + t * 1.4;
    ctx.beginPath();
    ctx.moveTo(e.x + Math.cos(angle) * r * 0.25, e.y + Math.sin(angle) * r * 0.25);
    ctx.lineTo(e.x + Math.cos(angle) * r * 0.85, e.y + Math.sin(angle) * r * 0.85);
    ctx.stroke();
  }
  // 飞散火花
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = e.color;
  for (let i = 0; i < 6; i += 1) {
    const angle = effRand(e, i, 1) * Math.PI * 2;
    ctx.globalAlpha = fade;
    ctx.beginPath();
    ctx.arc(e.x + Math.cos(angle) * r * (0.9 + 0.25 * ease), e.y + Math.sin(angle) * r * (0.9 + 0.25 * ease), 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function paintVolley(ctx: CanvasRenderingContext2D, e: SkillEffect, _t: number, ease: number, fade: number): void {
  ctx.strokeStyle = 'rgba(187, 247, 208, 0.9)';
  ctx.lineWidth = 3.5 * fade + 1;
  ctx.lineCap = 'round';
  for (const target of e.targets) {
    ctx.beginPath();
    ctx.moveTo(e.x, e.y - 32);
    ctx.lineTo(e.x + (target.x - e.x) * ease, e.y - 32 + (target.y - 8 - (e.y - 32)) * ease);
    ctx.stroke();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = fade;
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.arc(target.x, target.y - 8, 8 * fade + 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function paintHeal(ctx: CanvasRenderingContext2D, e: SkillEffect, t: number, _ease: number, fade: number, glow: number): void {
  for (let i = 0; i < 3; i += 1) {
    const ringT = Math.max(0, Math.min(1, t * 1.25 - i * 0.18));
    if (ringT <= 0) {
      continue;
    }
    glowRing(ctx, e.x, e.y, e.radius * ringT, e.color, 0.4 * (1 - ringT), glow);
    ctx.strokeStyle = `rgba(103, 232, 249, ${0.55 * (1 - ringT)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.radius * ringT, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const target of e.targets) {
    // 目标头顶升起的治愈花瓣
    const rise = Math.sin(t * Math.PI) * 12;
    drawPetal(ctx, target.x, target.y - 22 - rise, 6 * fade + 2, t * 2.2, 'rgba(45, 212, 191, 0.6)');
    ctx.fillStyle = 'rgba(45, 212, 191, 0.32)';
    ctx.beginPath();
    ctx.arc(target.x, target.y - 22 - rise, 10 * fade + 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintWish(ctx: CanvasRenderingContext2D, e: SkillEffect, t: number, ease: number, fade: number, glow: number): void {
  const r = e.radius * (0.35 + ease * 0.65);
  // 中心柔和辐辉
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const radiance = ctx.createRadialGradient(e.x, e.y, 2, e.x, e.y, r);
  radiance.addColorStop(0, `rgba(254, 226, 226, ${0.24 * fade})`);
  radiance.addColorStop(0.6, `rgba(252, 211, 77, ${0.12 * fade})`);
  radiance.addColorStop(1, 'rgba(252, 211, 77, 0)');
  ctx.fillStyle = radiance;
  ctx.beginPath();
  ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  glowRing(ctx, e.x, e.y, r, e.color, 0.5 * fade, glow);
  ctx.strokeStyle = e.color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
  ctx.stroke();
  // 旋转星辰
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(251, 207, 232, 0.82)';
  for (let i = 0; i < 7; i += 1) {
    const angle = (Math.PI * 2 * i) / 7 - t * 1.8;
    const px = e.x + Math.cos(angle) * r * 0.78;
    const py = e.y + Math.sin(angle) * r * 0.78;
    drawStar(ctx, px, py, 5 + 5 * fade);
  }
  // 锦鲤红 / 金 花瓣逆旋内环（lite/minimal 跳过子粒子）
  if (glow > 1) {
    for (let i = 0; i < 6; i += 1) {
      const angle = (Math.PI * 2 * i) / 6 + t * 1.3;
      const px = e.x + Math.cos(angle) * r * 0.5;
      const py = e.y + Math.sin(angle) * r * 0.5;
      ctx.globalAlpha = fade * 0.85;
      drawPetal(ctx, px, py, 5.5 * fade + 2, angle + t * 2.6, i % 2 === 0 ? '#fda4af' : '#fcd34d');
    }
  }
  ctx.restore();
}

/** 敌人出生：门口暖色扩散涟漪 + 渐隐的竖直光柱。 */
function paintSpawnRipple(ctx: CanvasRenderingContext2D, e: SkillEffect, t: number, ease: number, fade: number, glow: number): void {
  const r = e.radius * ease;
  glowRing(ctx, e.x, e.y, r, e.color, 0.55 * fade, glow);
  ctx.strokeStyle = e.color;
  ctx.lineWidth = 3 * fade + 1;
  ctx.beginPath();
  ctx.ellipse(e.x, e.y + 4, r, r * 0.42, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 244, 230, 0.7)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(e.x, e.y + 4, r * 0.62, r * 0.26, 0, 0, Math.PI * 2);
  ctx.stroke();
  // 竖直光柱（渐隐、随时间收窄）
  const shaftH = 74 * (1 - t * 0.4);
  const shaftW = 20 * fade + 4;
  const gradient = ctx.createLinearGradient(e.x, e.y - shaftH, e.x, e.y + 6);
  gradient.addColorStop(0, 'rgba(255, 214, 170, 0)');
  gradient.addColorStop(0.6, `rgba(255, 196, 150, ${0.34 * fade})`);
  gradient.addColorStop(1, `rgba(255, 236, 210, ${0.5 * fade})`);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = gradient;
  ctx.fillRect(e.x - shaftW / 2, e.y - shaftH, shaftW, shaftH + 6);
  ctx.restore();
}

/** 单位部署：花瓣迸发 + 柔光落地环。 */
function paintDeployBloom(ctx: CanvasRenderingContext2D, e: SkillEffect, t: number, ease: number, fade: number, glow: number): void {
  const r = e.radius * ease;
  glowRing(ctx, e.x, e.y + 6, r * 0.8, e.color, 0.5 * fade, glow);
  ctx.strokeStyle = `rgba(255, 251, 235, ${0.65 * fade})`;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(e.x, e.y + 8, r, r * 0.36, 0, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 8; i += 1) {
    const angle = (Math.PI * 2 * i) / 8 + effRand(e, i, 2) * 0.8;
    const dist = r * (0.5 + effRand(e, i, 3) * 0.6);
    const px = e.x + Math.cos(angle) * dist;
    const py = e.y + 4 + Math.sin(angle) * dist * 0.5 - ease * 24;
    drawPetal(ctx, px, py, 4.5 * fade + 1.5, angle + t * 3, e.color);
  }
}

/** 敌人攻击起手：朝向侧的小幅运动弧线。 */
function paintWindup(ctx: CanvasRenderingContext2D, e: SkillEffect, _t: number, ease: number, fade: number): void {
  const sign = e.dir >= 0 ? 1 : -1;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = e.color;
  ctx.lineCap = 'round';
  for (let i = 0; i < 2; i += 1) {
    ctx.globalAlpha = fade * (1 - i * 0.4);
    ctx.lineWidth = 3 - i;
    ctx.beginPath();
    ctx.arc(e.x - sign * (10 + i * 8), e.y - 10, e.radius * (0.5 + ease * 0.4), sign > 0 ? -0.6 : Math.PI - 0.6, sign > 0 ? 0.6 : Math.PI + 0.6);
    ctx.stroke();
  }
  ctx.restore();
}

/** 死亡消散：5-8 片主题化漂浮小形状（花瓣/余烬/碎晶）渐散渐隐。 */
function paintDissolve(ctx: CanvasRenderingContext2D, e: SkillEffect, t: number, ease: number, fade: number): void {
  const variant = e.variant ?? 'shard';
  const count = 5 + Math.floor(effRand(e, 0, 4) * 4);
  for (let i = 0; i < count; i += 1) {
    const angle = effRand(e, i, 5) * Math.PI * 2;
    const speed = 18 + effRand(e, i, 6) * 30;
    const px = e.x + Math.cos(angle) * speed * ease;
    const py = e.y - 12 + Math.sin(angle) * speed * ease * 0.6 - (variant === 'ember' ? ease * 34 : ease * 14) + (variant === 'petal' ? ease * ease * 22 : 0);
    const size = 3 + effRand(e, i, 7) * 3.5;
    const rot = angle + t * (variant === 'petal' ? 4 : 2.4);
    ctx.save();
    ctx.globalAlpha = fade * (0.55 + effRand(e, i, 8) * 0.45);
    if (variant === 'petal') {
      drawPetal(ctx, px, py, size, rot, e.color);
    } else if (variant === 'ember') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.arc(px, py, size * 0.7 * fade + 0.8, 0, Math.PI * 2);
      ctx.fill();
    } else {
      drawShard(ctx, px, py, size, rot, e.color);
    }
    ctx.restore();
  }
  // 底部残留柔光
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = fade * 0.3;
  ctx.fillStyle = e.color;
  ctx.beginPath();
  ctx.ellipse(e.x, e.y + 2, 16 * (1 - t * 0.5), 6 * (1 - t * 0.5), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ── 近战攻击特效画家（REQ8）：单位 dir 为 0右/1下/2左/3上，敌方 dir 为弧度角 ──

const DIR_ANGLES = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

/** 弧斩（剑士/幻影）：双弯月弧光扫过，白刃边 + 色光晕。 */
function paintSlashArc(ctx: CanvasRenderingContext2D, e: SkillEffect, _t: number, ease: number, fade: number, glow: number): void {
  const angle = DIR_ANGLES[e.dir] ?? 0;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(angle);
  ctx.lineCap = 'round';
  const sweep = -0.55 + ease * 1.1;
  for (let arc = 0; arc < 2; arc += 1) {
    const r = e.radius * (arc === 0 ? 0.52 : 0.36);
    const dirSign = arc === 0 ? 1 : -1;
    const a0 = dirSign * sweep - 0.75;
    const a1 = dirSign * sweep + 0.75;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < glow; i += 1) {
      ctx.globalAlpha = fade / (i + 1);
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 7 - i * 2.5;
      ctx.beginPath();
      ctx.arc(10, 0, r + i * 3, a0, a1);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = fade;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(10, 0, r, a0 + 0.12, a1 - 0.12);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** 突刺（先锋/荆棘卫）：主刺线（白芯+色晕）+ 两条速度线。 */
function paintThrust(ctx: CanvasRenderingContext2D, e: SkillEffect, _t: number, ease: number, fade: number, glow: number): void {
  const angle = DIR_ANGLES[e.dir] ?? 0;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(angle);
  ctx.lineCap = 'round';
  const len = e.radius * (0.4 + ease * 0.6);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < glow; i += 1) {
    ctx.globalAlpha = fade / (i + 1);
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 6 - i * 2;
    ctx.beginPath();
    ctx.moveTo(-6, 0);
    ctx.lineTo(len, 0);
    ctx.stroke();
  }
  // 刺尖闪点
  ctx.globalAlpha = fade;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(len, 0, 3 * fade + 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = fade;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(len * 0.2, 0);
  ctx.lineTo(len, 0);
  ctx.stroke();
  // 速度线（lite/minimal 跳过）
  if (glow > 1) {
    ctx.globalAlpha = fade * 0.55;
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 1.5;
    for (const off of [-8, 8]) {
      ctx.beginPath();
      ctx.moveTo(-14, off);
      ctx.lineTo(len * 0.5, off);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** 横扫（烈焰剑）：宽幅余烬弧 + 白热内缘 + 飞散余烬。 */
function paintCleave(ctx: CanvasRenderingContext2D, e: SkillEffect, _t: number, ease: number, fade: number, glow: number): void {
  const angle = DIR_ANGLES[e.dir] ?? 0;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(angle);
  ctx.lineCap = 'round';
  const r = e.radius * 0.6;
  const a0 = -1.0 + ease * 0.35;
  const a1 = 1.0 + ease * 0.35;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < glow; i += 1) {
    ctx.globalAlpha = fade / (i + 1);
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 13 - i * 4;
    ctx.beginPath();
    ctx.arc(6, 0, r + i * 4, a0, a1);
    ctx.stroke();
  }
  // 飞散余烬（lite/minimal 跳过）
  if (glow > 1) {
    ctx.fillStyle = e.color;
    for (let i = 0; i < 5; i += 1) {
      const ea = a0 + (a1 - a0) * effRand(e, i, 11);
      const dist = r + ease * 14 + effRand(e, i, 12) * 8;
      ctx.globalAlpha = fade;
      ctx.beginPath();
      ctx.arc(6 + Math.cos(ea) * dist, Math.sin(ea) * dist, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  ctx.globalAlpha = fade;
  ctx.strokeStyle = 'rgba(255, 241, 220, 0.9)';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.arc(6, 0, r - 4, a0 + 0.1, a1 - 0.1);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** 爪击（敌方近战）：3 条渐细爪痕 + 短暂暗闪；e.dir 为弧度角。 */
function paintClawSwipe(ctx: CanvasRenderingContext2D, e: SkillEffect, t: number, ease: number, fade: number, glow: number): void {
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(e.dir);
  // 暗闪（前 45% 快速衰减）
  ctx.globalAlpha = Math.max(0, 1 - t * 2.2) * 0.35;
  ctx.fillStyle = 'rgba(30, 20, 25, 1)';
  ctx.beginPath();
  ctx.arc(0, 0, e.radius * 0.55, 0, Math.PI * 2);
  ctx.fill();
  // 三条渐细爪痕（填充锥形）
  const x0 = -e.radius * 0.42;
  const x1 = x0 + e.radius * 0.9 * ease;
  for (let k = 0; k < 3; k += 1) {
    const off = (k - 1) * 9;
    ctx.globalAlpha = fade * 0.9;
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.moveTo(x0, off - 2.2);
    ctx.lineTo(x1, off + (k - 1) * 2);
    ctx.lineTo(x0, off + 2.2);
    ctx.closePath();
    ctx.fill();
  }
  // 亮芯细线（lite/minimal 跳过）
  if (glow > 1) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255, 235, 238, 0.85)';
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    for (let k = 0; k < 3; k += 1) {
      const off = (k - 1) * 9;
      ctx.globalAlpha = fade;
      ctx.beginPath();
      ctx.moveTo(x0 + 3, off);
      ctx.lineTo(x1 - 2, off + (k - 1) * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** 狼咬（wolf）：上下颌弧快速闭合 + 白牙点；e.dir 为弧度角。 */
function paintBiteSnap(ctx: CanvasRenderingContext2D, e: SkillEffect, _t: number, ease: number, fade: number, glow: number): void {
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(e.dir);
  ctx.lineCap = 'round';
  const gap = (1 - ease) * e.radius * 0.5 + 3;
  const r = e.radius * 0.5;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const s of [-1, 1]) {
    for (let i = 0; i < glow; i += 1) {
      ctx.globalAlpha = fade / (i + 1);
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 4.5 - i * 1.5;
      ctx.beginPath();
      if (s < 0) {
        ctx.arc(0, -gap, r, 0.35, Math.PI - 0.35);
      } else {
        ctx.arc(0, gap, r, Math.PI + 0.35, Math.PI * 2 - 0.35);
      }
      ctx.stroke();
    }
    // 牙尖白点（lite/minimal 跳过）
    if (glow > 1) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      for (let k = 0; k < 3; k += 1) {
        const a = s < 0 ? 0.7 + k * 0.55 : Math.PI + 0.7 + k * 0.55;
        ctx.globalAlpha = fade;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r, s * gap + Math.sin(a) * r, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
  ctx.restore();
}

/**
 * 绘制单个技能/事件特效；返回是否仍存活（false 表示可以从数组中移除）。
 */
export function drawSkillEffect(ctx: CanvasRenderingContext2D, effect: SkillEffect, now: number): boolean {
  const t = (now - effect.born) / effect.duration;
  if (t >= 1) {
    return false;
  }
  if (t < 0) {
    return true;
  }
  const ease = easeOutCubic(t);
  const fade = 1 - t;
  const glow = Math.max(1, effect.glowLayers ?? 2);
  ctx.save();
  ctx.globalAlpha = Math.max(0, fade);
  switch (effect.kind) {
    case 'shield':
      paintShield(ctx, effect, t, ease, fade, glow);
      break;
    case 'slash':
      paintSlash(ctx, effect, t, ease, fade, glow);
      break;
    case 'blast':
    case 'nova':
      paintBlastNova(ctx, effect, t, ease, fade, glow);
      break;
    case 'volley':
      paintVolley(ctx, effect, t, ease, fade);
      break;
    case 'heal':
      paintHeal(ctx, effect, t, ease, fade, glow);
      break;
    case 'wish':
      paintWish(ctx, effect, t, ease, fade, glow);
      break;
    case 'spawnRipple':
      paintSpawnRipple(ctx, effect, t, ease, fade, glow);
      break;
    case 'deployBloom':
      paintDeployBloom(ctx, effect, t, ease, fade, glow);
      break;
    case 'windup':
      paintWindup(ctx, effect, t, ease, fade);
      break;
    case 'dissolve':
      paintDissolve(ctx, effect, t, ease, fade);
      break;
    case 'slashArc':
      paintSlashArc(ctx, effect, t, ease, fade, glow);
      break;
    case 'thrust':
      paintThrust(ctx, effect, t, ease, fade, glow);
      break;
    case 'cleave':
      paintCleave(ctx, effect, t, ease, fade, glow);
      break;
    case 'clawSwipe':
      paintClawSwipe(ctx, effect, t, ease, fade, glow);
      break;
    case 'biteSnap':
      paintBiteSnap(ctx, effect, t, ease, fade, glow);
      break;
    default:
      paintAura(ctx, effect, t, ease, fade, glow);
      break;
  }
  ctx.restore();
  return true;
}

// ── 环境粒子发射器 ────────────────────────────

interface AmbientParticle extends Particle {
  ambient?: true;
}

const AMBIENT_LIFE_MS: Record<string, number> = {
  leaf: 5200,
  firefly: 4200,
  star: 4600,
  snow: 6000,
  mist: 6800,
  spark: 3000,
};

let ambientSeq = 0;

/**
 * 按地图主题补充环境粒子（飘叶/水萤/星火/雪粒/雾絮/电荧）。
 * 复用战斗 particles 数组绘制；接近粒子上限时跳过，绝不挤占战斗粒子。
 */
export function spawnAmbient(particles: Particle[], mapId: string, budget: EffectBudget, now: number): void {
  if (budget.ambientCount <= 0) {
    return;
  }
  if (particles.length >= budget.particleCap - 20) {
    return;
  }
  let alive = 0;
  for (const p of particles) {
    if ((p as AmbientParticle).ambient) {
      alive += 1;
    }
  }
  if (alive >= budget.ambientCount) {
    return;
  }
  const { ambient } = scenePalette(mapId);
  const life = AMBIENT_LIFE_MS[ambient.kind] ?? 5000;
  const missing = budget.ambientCount - alive;
  // 每帧最多补 2 个，避免开局瞬间齐刷刷出现
  for (let i = 0; i < Math.min(2, missing); i += 1) {
    ambientSeq += 1;
    const r1 = hash01(ambientSeq * 7 + 13);
    const r2 = hash01(ambientSeq * 11 + 29);
    const r3 = hash01(ambientSeq * 17 + 41);
    const p: AmbientParticle = {
      x: r1 * STAGE_W,
      y: ambient.kind === 'firefly' || ambient.kind === 'mist' ? STAGE_H * (0.35 + r2 * 0.6) : -10 - r2 * 30,
      vx: -8 - r3 * 22,
      vy: 10 + r2 * 18,
      born: now,
      life,
      size: 2 + r3 * 2.5,
      color: ambient.color,
      gravity: 0,
      ring: false,
      ambient: true,
    };
    if (ambient.kind === 'leaf') {
      p.vx = -14 - r3 * 26;
      p.vy = 16 + r2 * 16;
      p.size = 2.6 + r3 * 2.2;
    } else if (ambient.kind === 'firefly') {
      p.vx = (r3 - 0.5) * 16;
      p.vy = -6 - r2 * 8;
      p.size = 1.8 + r3 * 1.6;
    } else if (ambient.kind === 'star') {
      p.vx = (r3 - 0.5) * 10;
      p.vy = 8 + r2 * 10;
      p.size = 1.6 + r3 * 1.8;
    } else if (ambient.kind === 'snow') {
      p.vx = -6 - r3 * 14;
      p.vy = 14 + r2 * 14;
      p.size = 2 + r3 * 2;
    } else if (ambient.kind === 'mist') {
      p.vx = -10 - r3 * 12;
      p.vy = (r2 - 0.5) * 6;
      p.size = 8 + r3 * 10;
      p.color = ambient.color;
    } else {
      // spark：短命上飘电荧
      p.vx = (r3 - 0.5) * 30;
      p.vy = -12 - r2 * 20;
      p.size = 1.6 + r3 * 1.4;
    }
    particles.push(p);
  }
}

// ── 特效预算（自动降级） ────────────────────────────

export type EffectTier = 'full' | 'lite' | 'minimal';

const FPS_WINDOW = 60;
const DOWNGRADE_FPS = 45;

/**
 * 每场战斗一个实例：滚动统计近 60 帧均值 fps，<45fps 时 full→lite 自动降档；
 * 战斗内绝不升档。prefers-reduced-motion 直接锁 minimal。
 */
export class EffectBudget {
  tier: EffectTier;
  particleCap: number;
  ambientCount: number;
  glowLayers: number;

  private frameCount = 0;
  private frameMsSum = 0;

  constructor(reducedMotion: boolean) {
    this.tier = reducedMotion ? 'minimal' : 'full';
    this.particleCap = 150;
    this.ambientCount = 12;
    this.glowLayers = 2;
    this.applyTier();
  }

  noteFrame(dtMs: number): void {
    if (this.tier !== 'full' || !Number.isFinite(dtMs) || dtMs <= 0 || dtMs > 500) {
      return;
    }
    this.frameMsSum += dtMs;
    this.frameCount += 1;
    if (this.frameCount < FPS_WINDOW) {
      return;
    }
    const avgFps = 1000 / (this.frameMsSum / this.frameCount);
    this.frameCount = 0;
    this.frameMsSum = 0;
    if (avgFps < DOWNGRADE_FPS) {
      this.tier = 'lite';
      this.applyTier();
    }
  }

  private applyTier(): void {
    if (this.tier === 'full') {
      this.particleCap = 150;
      this.ambientCount = 12;
      this.glowLayers = 2;
    } else if (this.tier === 'lite') {
      this.particleCap = 80;
      this.ambientCount = 6;
      this.glowLayers = 1;
    } else {
      this.particleCap = 40;
      this.ambientCount = 0;
      this.glowLayers = 1;
    }
  }
}
