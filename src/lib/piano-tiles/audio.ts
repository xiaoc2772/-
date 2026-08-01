import type { ChartManifest, CompiledChart } from './types';

/**
 * Web Audio 采样播放器：按需加载当前曲目用到的钢琴/伴奏采样，低延迟触发。
 * 旋律与伴奏均由调用方按游戏进度触发（钢琴块2 机制：音乐跟随玩家点击进度）。
 * 仅浏览器环境可用。
 */

const ASSET_BASE = '/games/piano-tiles';

export class PianoSampler {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private manifest: ChartManifest | null = null;

  async init(manifest: ChartManifest): Promise<void> {
    this.manifest = manifest;
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  /** 预加载谱面用到的全部采样与音效。 */
  async preload(chart: CompiledChart, onProgress?: (loaded: number, total: number) => void) {
    if (!this.manifest) throw new Error('sampler not initialized');
    const keys = new Set<string>();
    for (const n of chart.notes) for (const p of n.pitches) keys.add(`piano/${p}`);
    for (const a of chart.accompaniment) for (const p of a.pitches) keys.add(`${a.instrument}/${p}`);
    for (const key of Object.keys(this.manifest.sfx)) keys.add(`sfx:${key}`);

    const list = [...keys];
    let loaded = 0;
    await Promise.all(
      list.map(async (key) => {
        await this.load(key);
        loaded += 1;
        onProgress?.(loaded, list.length);
      }),
    );
  }

  private urlFor(key: string): string | null {
    if (!this.manifest) return null;
    if (key.startsWith('sfx:')) {
      const file = this.manifest.sfx[key.slice(4)];
      return file ? `${ASSET_BASE}/sfx/${file}` : null;
    }
    const file = this.manifest.samples[key];
    if (file) return `${ASSET_BASE}/samples/${file}`;
    // 缺失伴奏采样回退到 piano 组
    const pitch = key.split('/')[1];
    const fallback = this.manifest.samples[`piano/${pitch}`];
    return fallback ? `${ASSET_BASE}/samples/${fallback}` : null;
  }

  private async load(key: string): Promise<AudioBuffer | null> {
    if (this.buffers.has(key)) return this.buffers.get(key) ?? null;
    const url = this.urlFor(key);
    if (!url || !this.ctx) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
      this.buffers.set(key, buffer);
      return buffer;
    } catch {
      return null;
    }
  }

  /** whenSec 为 AudioContext 绝对时钟（currentTime 时间域）；0 表示立即播放。 */
  private play(key: string, whenSec = 0, gain = 1) {
    const ctx = this.ctx;
    const buffer = this.buffers.get(key);
    if (!ctx || !buffer) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const g = ctx.createGain();
    g.gain.value = gain;
    source.connect(g).connect(ctx.destination);
    source.start(whenSec > 0 ? whenSec : 0);
  }

  /** 立即演奏一组音（击中音块时调用）。 */
  playPitches(pitches: string[], instrument = 'piano', gain = 1) {
    for (const p of pitches) this.play(`${instrument}/${p}`, 0, gain);
  }

  /**
   * 按延迟精确调度一组音（伴奏前瞻调度用）：
   * 基于 AudioContext 硬件时钟，不受渲染帧率抖动影响。
   */
  playPitchesAt(pitches: string[], instrument: string, gain: number, delayMs: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const when = ctx.currentTime + Math.max(0, delayMs) / 1000;
    for (const p of pitches) this.play(`${instrument}/${p}`, when, gain);
  }

  playSfx(name: string) {
    this.play(`sfx:${name}`, 0, 0.8);
  }

  /** 暂停音频输出（挂起 AudioContext，正在鸣响的尾音一并冻结）。 */
  async suspend() {
    if (this.ctx && this.ctx.state === 'running') {
      await this.ctx.suspend().catch(() => undefined);
    }
  }

  /** 恢复被暂停的音频输出。 */
  async resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume().catch(() => undefined);
    }
  }

  async dispose() {
    this.buffers.clear();
    if (this.ctx) {
      await this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
  }
}

export async function fetchManifest(): Promise<ChartManifest> {
  const res = await fetch(`${ASSET_BASE}/manifest.json`);
  if (!res.ok) throw new Error(`加载曲目清单失败: ${res.status}`);
  return res.json();
}

export async function fetchChart(id: string): Promise<CompiledChart> {
  const res = await fetch(`${ASSET_BASE}/charts/${id}.json`);
  if (!res.ok) throw new Error(`加载谱面失败: ${res.status}`);
  return res.json();
}
