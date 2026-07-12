// 幸运塔防 程序化美术 · 离屏精灵缓存。
// 角色/装饰 stamp 在首次使用时绘制到离屏 canvas（2x 超采样），运行时只 drawImage；
// 白闪剪影与灰度变体在 cache 时生成（运行时禁用 ctx.filter / 重复矢量重绘）。

export const SPRITE_SUPERSAMPLE = 2;

export class SpriteCache {
  private cache = new Map<string, HTMLCanvasElement>();

  /**
   * 取（或创建）一张 w×h 逻辑尺寸的缓存画布；paint 在超采样坐标系下按逻辑尺寸绘制。
   * key 相同即命中，paint 只会执行一次。
   */
  get(key: string, w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
    const hit = this.cache.get(key);
    if (hit) {
      return hit;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(w * SPRITE_SUPERSAMPLE));
    canvas.height = Math.max(1, Math.ceil(h * SPRITE_SUPERSAMPLE));
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(SPRITE_SUPERSAMPLE, SPRITE_SUPERSAMPLE);
      paint(ctx);
    }
    this.cache.set(key, canvas);
    return canvas;
  }

  /** 白闪剪影变体：基图 alpha 形状填白，受击时叠加绘制。 */
  whiteVariant(key: string, base: HTMLCanvasElement): HTMLCanvasElement {
    return this.derive(`${key}::white`, base, (ctx) => {
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, base.width, base.height);
    });
  }

  /** 灰度变体：阵亡余像用；filter 只在 cache 时用一次。 */
  grayVariant(key: string, base: HTMLCanvasElement): HTMLCanvasElement {
    const grayKey = `${key}::gray`;
    const hit = this.cache.get(grayKey);
    if (hit) {
      return hit;
    }
    const canvas = document.createElement('canvas');
    canvas.width = base.width;
    canvas.height = base.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.filter = 'grayscale(1) brightness(1.08)';
      ctx.drawImage(base, 0, 0);
    }
    this.cache.set(grayKey, canvas);
    return canvas;
  }

  clear(): void {
    this.cache.clear();
  }

  private derive(key: string, base: HTMLCanvasElement, post: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
    const hit = this.cache.get(key);
    if (hit) {
      return hit;
    }
    const canvas = document.createElement('canvas');
    canvas.width = base.width;
    canvas.height = base.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(base, 0, 0);
      post(ctx);
    }
    this.cache.set(key, canvas);
    return canvas;
  }
}

/** 模块级共享缓存：精灵与装饰 stamp 与具体对局无关，可跨局复用（绘制只发生在浏览器，SSR 不触达）。 */
export const sharedSpriteCache = new SpriteCache();
