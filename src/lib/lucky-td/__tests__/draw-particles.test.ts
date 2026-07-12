// 回归测试:法术 AOE 冲击环粒子出生时间在未来(renderer spawnAttackVisual born: now+200),
// 未出生时 t<0 使 ring 半径 p.size*t 为负,浏览器 ctx.arc 对负半径抛 IndexSizeError,
// 曾把无异常保护的 rAF 主循环整条打断,战局画面永久冻结。
import { describe, expect, it } from 'vitest';
import { getEngineData } from '../engine/data';
import { ENEMY_RADII } from '../renderer/art/characters';
import { ENEMY_CANVAS, ENEMY_PAINTERS } from '../renderer/art/enemies';
import { drawParticles, type Particle } from '../renderer/draw';

function mockCtx(): { ctx: CanvasRenderingContext2D; arcRadii: number[] } {
  const arcRadii: number[] = [];
  const ctx = {
    globalAlpha: 1,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    beginPath() {},
    stroke() {},
    fill() {},
    arc(_x: number, _y: number, radius: number) {
      if (radius < 0) {
        // 模拟浏览器行为:负半径必须抛 IndexSizeError
        throw new DOMException(`The radius provided (${radius}) is negative.`, 'IndexSizeError');
      }
      arcRadii.push(radius);
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, arcRadii };
}

function ringParticle(born: number): Particle {
  return { x: 100, y: 100, vx: 0, vy: 0, born, life: 240, size: 50, color: '#fff', gravity: 0, ring: true };
}

describe('drawParticles', () => {
  it('每类敌人都有对应的绘制器、画布尺寸和体格半径', () => {
    const enemyCount = getEngineData().config.enemies.length;
    expect(ENEMY_PAINTERS).toHaveLength(enemyCount);
    expect(ENEMY_CANVAS).toHaveLength(enemyCount);
    expect(ENEMY_RADII).toHaveLength(enemyCount);
    expect(ENEMY_RADII.every((radius) => Number.isFinite(radius) && radius > 0)).toBe(true);
  });

  it('未出生的 ring 粒子不抛负半径异常,保留存活且不绘制', () => {
    const { ctx, arcRadii } = mockCtx();
    const now = 1000;
    let alive: Particle[] = [];

    expect(() => {
      alive = drawParticles(ctx, [ringParticle(now + 200)], now);
    }).not.toThrow();

    expect(alive).toHaveLength(1);
    expect(arcRadii).toHaveLength(0);
  });

  it('盾击场景:tick 中途出生的 ring 粒子比帧时钟晚亚毫秒也不抛异常', () => {
    // 复现「只放两个盾也卡住」:spawnMeleeAttackFx 曾用 performance.now() 作 born,
    // 比 loop 帧起点的 ts 晚 0.1~3ms,同帧渲染时 t 为微小负数 → 负半径
    const { ctx, arcRadii } = mockCtx();
    const now = 1000;
    let alive: Particle[] = [];

    expect(() => {
      alive = drawParticles(ctx, [ringParticle(now + 0.6)], now);
    }).not.toThrow();

    expect(alive).toHaveLength(1);
    expect(arcRadii).toHaveLength(0);
  });

  it('存活期内的 ring 粒子以非负半径正常绘制', () => {
    const { ctx, arcRadii } = mockCtx();
    const now = 1000;

    const alive = drawParticles(ctx, [ringParticle(now - 120)], now);

    expect(alive).toHaveLength(1);
    expect(arcRadii).toEqual([25]);
  });

  it('过期粒子被移除', () => {
    const { ctx, arcRadii } = mockCtx();
    const now = 1000;

    const alive = drawParticles(ctx, [ringParticle(now - 240)], now);

    expect(alive).toHaveLength(0);
    expect(arcRadii).toHaveLength(0);
  });
});
