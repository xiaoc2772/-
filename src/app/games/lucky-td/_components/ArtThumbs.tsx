'use client';

// 选择界面美术缩略图：地图全景与角色立绘的小型 canvas 组件。
// 复用 renderer/art 的程序化绘制与离屏缓存，全部绘制发生在 useEffect（SSR 安全）。

import { useEffect, useRef } from 'react';
import { getEngineData } from '@/lib/lucky-td/engine/data';
import { STAGE_W, STAGE_H, makeGeom, drawBoard } from '@/lib/lucky-td/renderer/draw';
import { getEnemySpriteCanvas, getUnitSpriteCanvas } from '@/lib/lucky-td/renderer/art/characters';

interface MapScenePreviewProps {
  mapIdx: number;
  className?: string;
}

/** 地图全景缩略图：直接用 drawBoard 绘制整张新场景。 */
export function MapScenePreview({ mapIdx, className }: MapScenePreviewProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    const map = getEngineData().maps[mapIdx];
    if (!ctx || !map) {
      return;
    }
    drawBoard(ctx, map, makeGeom(map.cfg.cols, map.cfg.rows));
  }, [mapIdx]);
  return (
    <canvas
      ref={ref}
      width={STAGE_W}
      height={STAGE_H}
      className={className}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      aria-hidden
    />
  );
}

/** 内部 2x 分辨率，配合 2x 超采样源位图保持清晰。 */
const PORTRAIT_RES = 2;
/** 立绘占画布高度比例：留出边距避免脚部/头部贴边。 */
const PORTRAIT_FILL = 0.92;

interface UnitPortraitProps {
  typeIdx: number;
  size?: number;
  className?: string;
}

/** 角色头像：绘制缓存的角色底图（透明背景，底色由父级色块提供）。 */
export function UnitPortrait({ typeIdx, size = 48, className }: UnitPortraitProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) {
      return;
    }
    const px = size * PORTRAIT_RES;
    ctx.clearRect(0, 0, px, px);
    const sprite = getUnitSpriteCanvas(typeIdx);
    if (sprite.width === 0 || sprite.height === 0) {
      return;
    }
    const scale = (px * PORTRAIT_FILL) / sprite.height;
    const dw = sprite.width * scale;
    const dh = sprite.height * scale;
    // 轻微上移，保证脚部不被裁切
    ctx.drawImage(sprite, (px - dw) / 2, (px - dh) / 2 - px * 0.02, dw, dh);
  }, [typeIdx, size]);
  // 保留高分辨率画布，战斗部署栏仅通过 CSS 变量缩小视觉尺寸。
  return (
    <canvas
      ref={ref}
      width={size * PORTRAIT_RES}
      height={size * PORTRAIT_RES}
      className={className}
      style={{
        width: `var(--ltd-unit-portrait-size, ${size}px)`,
        height: `var(--ltd-unit-portrait-size, ${size}px)`,
        display: 'block',
      }}
      aria-hidden
    />
  );
}

interface EnemyPortraitProps {
  typeIdx: number;
  size?: number;
  className?: string;
}

/** 怪物头像：复用战斗中的透明敌人底图，固定使用静止帧。 */
export function EnemyPortrait({ typeIdx, size = 48, className }: EnemyPortraitProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) {
      return;
    }
    const px = size * PORTRAIT_RES;
    ctx.clearRect(0, 0, px, px);
    const sprite = getEnemySpriteCanvas(typeIdx);
    if (sprite.width === 0 || sprite.height === 0) {
      return;
    }
    const scale = (px * 0.9) / Math.max(sprite.width, sprite.height);
    const dw = sprite.width * scale;
    const dh = sprite.height * scale;
    ctx.drawImage(sprite, (px - dw) / 2, (px - dh) / 2, dw, dh);
  }, [typeIdx, size]);
  return (
    <canvas
      ref={ref}
      width={size * PORTRAIT_RES}
      height={size * PORTRAIT_RES}
      className={className}
      style={{ width: `${size}px`, height: `${size}px`, display: 'block' }}
      aria-hidden
    />
  );
}
