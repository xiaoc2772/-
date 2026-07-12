'use client';

// 幸运塔防美术画廊（开发验收用，不入正式导航）：
// 直接调用 art 模块渲染 6 张地图全景与 25 个角色精灵，供视觉验收。

import { useEffect, useRef } from 'react';
import { getEngineData } from '@/lib/lucky-td/engine/data';
import { STAGE_W, STAGE_H, makeGeom, drawBoard, drawUnitSprite, drawEnemySprite } from '@/lib/lucky-td/renderer/draw';

const { config } = getEngineData();
const UNIT_COUNT = config.units.length;
const ENEMY_COUNT = config.enemies.length;

function SceneCanvas({ mapIdx }: { mapIdx: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      return;
    }
    const map = getEngineData().maps[mapIdx];
    drawBoard(ctx, map, makeGeom(map.cfg.cols, map.cfg.rows));
  }, [mapIdx]);
  return <canvas ref={ref} width={STAGE_W} height={STAGE_H} style={{ width: '100%', height: 'auto', display: 'block' }} />;
}

function SpriteRow({ kind }: { kind: 'unit' | 'enemy' }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      return;
    }
    ctx.fillStyle = kind === 'unit' ? '#bfe3b0' : '#8d92c0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const count = kind === 'unit' ? UNIT_COUNT : ENEMY_COUNT;
    for (let i = 0; i < count; i += 1) {
      const x = 60 + i * 100;
      if (kind === 'unit') {
        drawUnitSprite(ctx, x, 80, i, {
          hpRatio: 1,
          flash: 0,
          alpha: 1,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          gray: false,
          skillActive: false,
          selected: false,
          dir: 0,
        });
      } else {
        drawEnemySprite(ctx, x, 90, i, { hpRatio: 1, flash: 0, rot: 0, bob: 0, alpha: 1, scaleY: 1, frame: 0 });
        drawEnemySprite(ctx, x, 200, i, { hpRatio: 1, flash: 0, rot: 0, bob: 0, alpha: 1, scaleY: 1, frame: 1 });
      }
    }
  }, [kind]);
  const w = 60 + (kind === 'unit' ? UNIT_COUNT : ENEMY_COUNT) * 100 + 40;
  return <canvas ref={ref} width={w} height={kind === 'unit' ? 160 : 280} style={{ display: 'block', maxWidth: '100%' }} />;
}

export default function LuckyTdArtGalleryPage() {
  const maps = getEngineData().maps;
  return (
    <main style={{ padding: 16, background: '#1c1f2b', color: '#eee', minHeight: '100vh' }}>
      <h1>幸运塔防 · 程序化美术画廊（开发验收）</h1>
      <h2>我方单位 ×{UNIT_COUNT}</h2>
      <SpriteRow kind="unit" />
      <h2>敌人 ×{ENEMY_COUNT}（上：帧0 / 下：帧1）</h2>
      <SpriteRow kind="enemy" />
      {maps.map((map, idx) => (
        <section key={map.cfg.id}>
          <h2>
            {idx + 1}. {map.cfg.name}（{map.cfg.id}）
          </h2>
          <SceneCanvas mapIdx={idx} />
        </section>
      ))}
    </main>
  );
}
