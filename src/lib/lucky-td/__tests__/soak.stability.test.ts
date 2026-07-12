import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashState, replay } from '../engine/engine';
import type { GameAction } from '../engine/types';

interface GoldenVector {
  seed: string;
  mapId: string;
  squad: string[];
  actions: GameAction[];
  expect: { frames: number; finalHash: number };
}

const enabled = process.env.LUCKYTD_SOAK === '1';
const goldenPath = join(process.cwd(), 'src', 'lib', 'lucky-td', '__fixtures__', 'golden', 'golden.json');
const vectors = JSON.parse(readFileSync(goldenPath, 'utf8')) as GoldenVector[];
const FPS = 30;

function runEquivalentMinutes(minutes: number) {
  const targetFrames = minutes * 60 * FPS;
  let replayedFrames = 0;
  let runs = 0;
  const started = performance.now();
  while (replayedFrames < targetFrames) {
    const vector = vectors[runs % vectors.length];
    const output = replay({ seed: vector.seed, mapId: vector.mapId, squad: vector.squad, actions: vector.actions });
    expect(output.ok).toBe(true);
    expect(output.result?.frames).toBe(vector.expect.frames);
    expect(output.state ? hashState(output.state) : 0).toBe(vector.expect.finalHash);
    expect(output.state?.enemies.length ?? 0).toBeLessThanOrEqual(256);
    expect(output.state?.units.length ?? 0).toBeLessThanOrEqual(9);
    expect(output.state?.waveHashes.length ?? 0).toBeLessThanOrEqual(30);
    replayedFrames += output.result?.frames ?? 0;
    runs += 1;
  }
  return { minutes, targetFrames, replayedFrames, runs, elapsedMs: Math.round(performance.now() - started) };
}

describe.skipIf(!enabled)('幸运塔防长时等价压测', () => {
  it('30 分钟、1 小时、2 小时、5 小时累计重放均可稳定结算', () => {
    const reports = [30, 60, 120, 300].map(runEquivalentMinutes);
    console.log('[lucky-td-soak]', JSON.stringify(reports));
    for (const report of reports) {
      expect(report.replayedFrames).toBeGreaterThanOrEqual(report.targetFrames);
    }
  }, 60_000);
});
