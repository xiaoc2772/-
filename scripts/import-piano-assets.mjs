#!/usr/bin/env node
/**
 * 钢琴块素材导入脚本。
 *
 * 从参考项目（钢琴块2 反编译资源）导入并编译游戏素材：
 * - 谱面：assets/res/song/*.json -> public/games/piano-tiles/charts/<id>.json
 * - 曲目元数据：assets/res/DB/music_json.csv
 * - 钢琴/伴奏采样：assets/res/music/{piano,bass,bass2,drum} -> samples/
 *   （文件名 `#a2.mp3` URL 不安全，重命名为 `s-a2.mp3`，映射写入 manifest）
 * - 精选 UI 音效 -> sfx/
 * - 生成 manifest.json（曲目索引 + 采样映射）
 *
 * 用法：
 *   node scripts/import-piano-assets.mjs --dry-run   # 只解析并输出报告，不写文件
 *   node scripts/import-piano-assets.mjs             # 实际写入 public/games/piano-tiles/
 *   node scripts/import-piano-assets.mjs --source <dir>  # 覆盖默认素材根目录
 *   node scripts/import-piano-assets.mjs --emit-go-summary backend/internal/pianotiles/charts_summary.json
 *
 * 依赖 Node >= 22.6（原生 TS type stripping，直接复用 src/lib/piano-tiles/chart-parser.ts）。
 */
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const sourceArgIndex = args.indexOf('--source');
const DEFAULT_SOURCE = 'E:/luckyproject/piano/version4.0/extracted_resources/assets/res';
const sourceRoot = sourceArgIndex >= 0 ? args[sourceArgIndex + 1] : DEFAULT_SOURCE;
const emitGoIndex = args.indexOf('--emit-go-summary');
const emitGoSummary = emitGoIndex >= 0 ? args[emitGoIndex + 1] : '';

const outRoot = path.join(repoRoot, 'public', 'games', 'piano-tiles');

/** 谱面质量门槛：坏记号占比超过 2% 或音块数过少的曲目跳过。 */
const MAX_BAD_TOKEN_RATIO = 0.02;
const MIN_NOTE_COUNT = 20;
const MIN_DURATION_MS = 15_000;

const SAMPLE_GROUPS = ['piano', 'bass', 'bass2', 'drum'];

/** 精选 UI 音效（源文件名 -> 目标 key）。 */
const SFX_PICKS = {
  'Pass1.mp3': 'result-pass',
  'FailPage.mp3': 'result-fail',
  'NewBest.mp3': 'new-best',
  'OneCrown.mp3': 'crown',
  'Musiclist.mp3': 'ui-select',
  'prop_miss.mp3': 'miss',
};

const { parseChart, estimateStars, pitchToSampleKey } = await import(
  '../src/lib/piano-tiles/chart-parser.ts'
);

function splitCsvLine(line) {
  const cols = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) {
      cols.push(cur);
      cur = '';
    } else cur += ch;
  }
  cols.push(cur);
  return cols;
}

function parseCsv(text) {
  // 首行为表头，第二行为中文说明行
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = splitCsvLine(lines[0]);
  return lines.slice(2).map((line) => {
    const cols = splitCsvLine(line);
    const row = {};
    header.forEach((h, i) => {
      row[h] = cols[i]?.trim() ?? '';
    });
    return row;
  });
}

async function main() {
  if (!existsSync(sourceRoot)) {
    console.error(`素材根目录不存在: ${sourceRoot}`);
    process.exit(1);
  }

  const csvText = await readFile(path.join(sourceRoot, 'DB', 'music_json.csv'), 'utf-8');
  const rows = parseCsv(csvText);
  const songDir = path.join(sourceRoot, 'song');

  const charts = [];
  const skipped = [];
  const seenSongs = new Set();

  for (const row of rows) {
    const file = row.MusicJson;
    const id = row.Id;
    if (!file || !id) continue;
    // 同一曲目在 CSV 中有多个变体行（不同模式入口），只导入一次
    if (seenSongs.has(file)) continue;
    seenSongs.add(file);
    const jsonPath = path.join(songDir, `${file}.json`);
    if (!existsSync(jsonPath)) {
      skipped.push({ id, file, reason: 'json-missing' });
      continue;
    }
    let raw;
    try {
      raw = JSON.parse(await readFile(jsonPath, 'utf-8'));
    } catch {
      skipped.push({ id, file, reason: 'json-parse-error' });
      continue;
    }
    if (!Array.isArray(raw.musics)) {
      skipped.push({ id, file, reason: 'no-musics' });
      continue;
    }

    const { chart, badTokens } = parseChart(raw, {
      id,
      title: file,
      artist: row.Musician || '',
    });
    const totalTokens = chart.notes.length + chart.accompaniment.length + badTokens;
    if (
      chart.notes.length < MIN_NOTE_COUNT ||
      chart.durationMs < MIN_DURATION_MS ||
      (totalTokens > 0 && badTokens / totalTokens > MAX_BAD_TOKEN_RATIO)
    ) {
      skipped.push({
        id,
        file,
        reason: `quality(notes=${chart.notes.length},dur=${Math.round(chart.durationMs / 1000)}s,bad=${badTokens})`,
      });
      continue;
    }
    charts.push(chart);
  }

  // 采样映射：扫描各采样组目录，生成 key -> 文件映射并校验谱面引用
  const sampleMap = {};
  const missingSamples = new Set();
  for (const group of SAMPLE_GROUPS) {
    const dir = path.join(sourceRoot, 'music', group);
    if (!existsSync(dir)) continue;
    for (const name of await readdir(dir)) {
      if (!name.endsWith('.mp3')) continue;
      const pitch = name.slice(0, -4);
      const key = `${group}/${pitchToSampleKey(pitch)}`;
      sampleMap[key] = { src: path.join(dir, name), out: `${group}/${pitchToSampleKey(pitch)}.mp3` };
    }
  }
  for (const chart of charts) {
    for (const n of chart.notes) {
      for (const p of n.pitches) if (!sampleMap[`piano/${p}`]) missingSamples.add(`piano/${p}`);
    }
    for (const a of chart.accompaniment) {
      for (const p of a.pitches) if (!sampleMap[`${a.instrument}/${p}`]) missingSamples.add(`${a.instrument}/${p}`);
    }
  }

  console.log(`曲目总数: ${rows.length}`);
  console.log(`编译成功: ${charts.length}`);
  console.log(`跳过: ${skipped.length}`);
  if (skipped.length) {
    for (const s of skipped.slice(0, 20)) console.log(`  - [${s.id}] ${s.file}: ${s.reason}`);
    if (skipped.length > 20) console.log(`  ... 另有 ${skipped.length - 20} 条`);
  }
  console.log(`采样文件: ${Object.keys(sampleMap).length}`);
  if (missingSamples.size) {
    console.warn(`谱面引用但缺失的采样 (${missingSamples.size}):`, [...missingSamples].slice(0, 20));
  }

  if (isDryRun) {
    console.log('[dry-run] 未写入任何文件。');
    return;
  }

  await mkdir(path.join(outRoot, 'charts'), { recursive: true });
  await mkdir(path.join(outRoot, 'sfx'), { recursive: true });
  for (const group of SAMPLE_GROUPS) {
    await mkdir(path.join(outRoot, 'samples', group), { recursive: true });
  }

  for (const chart of charts) {
    await writeFile(
      path.join(outRoot, 'charts', `${chart.id}.json`),
      JSON.stringify(chart),
      'utf-8',
    );
  }

  const manifestSamples = {};
  for (const [key, { src, out }] of Object.entries(sampleMap)) {
    await copyFile(src, path.join(outRoot, 'samples', out));
    manifestSamples[key] = out;
  }

  const manifestSfx = {};
  for (const [srcName, key] of Object.entries(SFX_PICKS)) {
    const src = path.join(sourceRoot, 'Audio', srcName);
    if (!existsSync(src)) continue;
    const out = `${key}.mp3`;
    await copyFile(src, path.join(outRoot, 'sfx', out));
    manifestSfx[key] = out;
  }

  const manifest = {
    version: 1,
    samples: manifestSamples,
    sfx: manifestSfx,
    charts: charts
      .map((chart) => ({
        id: chart.id,
        title: chart.title,
        artist: chart.artist,
        bpm: chart.baseBpm,
        durationMs: chart.durationMs,
        noteCount: chart.notes.length,
        stars: estimateStars(chart),
        checksum: chart.checksum,
      }))
      .sort((a, b) => a.stars - b.stars || a.title.localeCompare(b.title)),
  };
  await writeFile(path.join(outRoot, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  if (emitGoSummary) {
    const summary = Object.fromEntries(charts.map((chart) => [chart.id, {
      checksum: chart.checksum,
      durationMs: chart.durationMs,
      unitMs: chart.unitMs,
      notes: chart.notes.map((note) => [note.t, note.lane, note.d]),
    }]));
    await writeFile(path.resolve(repoRoot, emitGoSummary), JSON.stringify(summary), 'utf-8');
    console.log(`已生成 Go 谱面摘要 -> ${path.resolve(repoRoot, emitGoSummary)}`);
  }

  console.log(`已写入 ${charts.length} 份谱面、${Object.keys(manifestSamples).length} 个采样、${Object.keys(manifestSfx).length} 个音效 -> ${outRoot}`);
}

await main();
