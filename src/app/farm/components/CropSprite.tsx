'use client';

import React from 'react';
import type { CropIdV2, CropStageV2 } from '@/lib/types/farm-v2';

interface Props {
  cropId: CropIdV2;
  stage: CropStageV2;
  size?: number;
  className?: string;
  variant?: 'normal' | 'withered';
}

const FARM_CROP_IMAGE_BASE = '/images-optimized/ui/farm/crops';

/** 作物 SVG，4 阶段动态展示 */
export default function CropSprite({ cropId, stage, size = 80, className, variant = 'normal' }: Props) {
  const skipBaseSoil = true;
  return (
    <svg
      className={className}
      width={size} height={size} viewBox="0 0 100 100"
      style={{ overflow: 'visible' }}
    >
      <defs>
        <radialGradient id={`shadow-${cropId}`} cx="50%" cy="100%" r="50%">
          <stop offset="0%" stopColor="rgba(0,0,0,0.25)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
      </defs>
      <ellipse cx="50" cy="92" rx="22" ry="4" fill={`url(#shadow-${cropId})`} />
      {!skipBaseSoil && (
        <>
          {/* 通用泥土 */}
          <ellipse cx="50" cy="88" rx="28" ry="6" fill="#8b5a2b" />
          <ellipse cx="50" cy="86" rx="28" ry="5" fill="#a0703a" />
        </>
      )}
      {renderCrop(cropId, stage, variant)}
    </svg>
  );
}

function renderCrop(id: CropIdV2, stage: CropStageV2, variant: NonNullable<Props['variant']>) {
  switch (id) {
    case 'wheat':      return <Wheat stage={stage} variant={variant} />;
    case 'carrot':     return <Carrot stage={stage} variant={variant} />;
    case 'lettuce':    return <Lettuce stage={stage} variant={variant} />;
    case 'tomato':     return <Tomato stage={stage} variant={variant} />;
    case 'potato':     return <Potato stage={stage} variant={variant} />;
    case 'strawberry': return <Strawberry stage={stage} variant={variant} />;
    case 'corn':       return <Corn stage={stage} variant={variant} />;
    case 'pumpkin':    return <Pumpkin stage={stage} variant={variant} />;
    default: return null;
  }
}


function cropImageFile(stage: CropStageV2, variant: NonNullable<Props['variant']>) {
  if (variant === 'withered') return 'display/withered.webp';
  if (stage === 'seed') return 'display/seed.webp';
  if (stage === 'mature') return 'display/mature.webp';
  return 'display/sprout.webp';
}

function cropAnimationClass(stage: CropStageV2, variant: NonNullable<Props['variant']>) {
  if (stage === 'seed' || variant === 'withered') return null;
  return 'farm-sprite-sway';
}

function cropImageFrame(stage: CropStageV2) {
  if (stage === 'seed') {
    return { x: -16, y: -16, size: 132 };
  }
  return { x: 0, y: 0, size: 100 };
}

// ===== 各种作物 =====
function Wheat({ stage, variant }: { stage: CropStageV2; variant: NonNullable<Props['variant']> }) {
  const base = `${FARM_CROP_IMAGE_BASE}/wheat`;
  // 四阶段统一铺满 100×100 viewBox，渲染容器尺寸一致
  const src = cropImageFile(stage, variant); // sprout / growing 共用「小麦苗」
  const wrap = cropAnimationClass(stage, variant);
  const frame = cropImageFrame(stage);
  const img = (
    <image
      href={`${base}/${src}`}
      x={frame.x} y={frame.y}
      width={frame.size} height={frame.size}
      preserveAspectRatio="xMidYMax meet"
    />
  );
  return wrap ? <g className={wrap}>{img}</g> : img;
}

function Carrot({ stage, variant }: { stage: CropStageV2; variant: NonNullable<Props['variant']> }) {
  const base = `${FARM_CROP_IMAGE_BASE}/carrot`;
  const src = cropImageFile(stage, variant);
  const wrap = cropAnimationClass(stage, variant);
  const frame = cropImageFrame(stage);
  const img = (
    <image
      href={`${base}/${src}`}
      x={frame.x} y={frame.y}
      width={frame.size} height={frame.size}
      preserveAspectRatio="xMidYMax meet"
    />
  );
  return wrap ? <g className={wrap}>{img}</g> : img;
}

function Lettuce({ stage, variant }: { stage: CropStageV2; variant: NonNullable<Props['variant']> }) {
  return <CropImage base={`${FARM_CROP_IMAGE_BASE}/lettuce`} stage={stage} variant={variant} />;
}

function Tomato({ stage, variant }: { stage: CropStageV2; variant: NonNullable<Props['variant']> }) {
  return <CropImage base={`${FARM_CROP_IMAGE_BASE}/tomato`} stage={stage} variant={variant} />;
}

function Potato({ stage, variant }: { stage: CropStageV2; variant: NonNullable<Props['variant']> }) {
  return <CropImage base={`${FARM_CROP_IMAGE_BASE}/potato`} stage={stage} variant={variant} />;
}

function Strawberry({ stage, variant }: { stage: CropStageV2; variant: NonNullable<Props['variant']> }) {
  return <CropImage base={`${FARM_CROP_IMAGE_BASE}/strawberry`} stage={stage} variant={variant} />;
}

function Corn({ stage, variant }: { stage: CropStageV2; variant: NonNullable<Props['variant']> }) {
  return <CropImage base={`${FARM_CROP_IMAGE_BASE}/corn`} stage={stage} variant={variant} />;
}

function Pumpkin({ stage, variant }: { stage: CropStageV2; variant: NonNullable<Props['variant']> }) {
  return <CropImage base={`${FARM_CROP_IMAGE_BASE}/pumpkin`} stage={stage} variant={variant} />;
}

function CropImage({ base, stage, variant }: { base: string; stage: CropStageV2; variant: NonNullable<Props['variant']> }) {
  const src = cropImageFile(stage, variant);
  const wrap = cropAnimationClass(stage, variant);
  const frame = cropImageFrame(stage);
  const img = (
    <image
      href={`${base}/${src}`}
      x={frame.x} y={frame.y}
      width={frame.size} height={frame.size}
      preserveAspectRatio="xMidYMax meet"
    />
  );
  return wrap ? <g className={wrap}>{img}</g> : img;
}
