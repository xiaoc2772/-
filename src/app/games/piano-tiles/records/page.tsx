'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Award, Loader2, Music, Play, Search, Trophy, Zap } from 'lucide-react';
import { fetchGameRequest, gameRequestErrorMessage } from '../../_lib/request';
import { fetchManifest } from '@/lib/piano-tiles/audio';
import type { ChartManifest, ChartManifestEntry, PianoTilesMode } from '@/lib/piano-tiles/types';

const API_BASE = '/api/games/piano-tiles';
const PAGE_SIZE = 6;

interface PersonalBest {
  score: number;
  tilesHit: number;
  crowns: number;
  laps: number;
  playedMs: number;
  status: string;
  createdAt: number;
}

interface PersonalBestSong {
  chartId: string;
  classic: PersonalBest | null;
  rush: PersonalBest | null;
}

interface SongView extends PersonalBestSong {
  chart: ChartManifestEntry | null;
}

function asNumber(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeBest(value: unknown): PersonalBest | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  return {
    score: asNumber(row.score),
    tilesHit: asNumber(row.tilesHit),
    crowns: asNumber(row.crowns),
    laps: asNumber(row.laps),
    playedMs: asNumber(row.playedMs),
    status: typeof row.status === 'string' ? row.status : '',
    createdAt: asNumber(row.createdAt),
  };
}

function normalizeSongs(value: unknown): PersonalBestSong[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    if (typeof row.chartId !== 'string' || !row.chartId) return [];
    return [{
      chartId: row.chartId,
      classic: normalizeBest(row.classic),
      rush: normalizeBest(row.rush),
    }];
  });
}

function formatDuration(value: number): string {
  if (!value) return '—';
  const seconds = value / 1000;
  return seconds >= 60 ? `${Math.floor(seconds / 60)}分${Math.round(seconds % 60)}秒` : `${seconds.toFixed(1)} 秒`;
}

function formatDate(value: number): string {
  if (!value) return '暂无记录时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '暂无记录时间';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function getBestScore(song: SongView): number {
  return Math.max(song.classic?.score ?? 0, song.rush?.score ?? 0);
}

export default function PianoTilesRecordsPage() {
  const [manifest, setManifest] = useState<ChartManifest | null>(null);
  const [songs, setSongs] = useState<PersonalBestSong[]>([]);
  const [query, setQuery] = useState('');
  const [starFilter, setStarFilter] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [manifestResult, recordsResult] = await Promise.all([
          fetchManifest(),
          fetchGameRequest(`${API_BASE}/personal-bests`),
        ]);
        const payload = await recordsResult.json().catch(() => null);
        if (!recordsResult.ok) throw new Error(payload?.message ?? (recordsResult.status === 401 ? '请先登录后查看个人战绩' : '加载个人战绩失败'));
        if (!cancelled) {
          setManifest(manifestResult);
          setSongs(normalizeSongs(payload?.data?.songs));
        }
      } catch (err) {
        if (!cancelled) setError(gameRequestErrorMessage(err, '加载个人战绩超时', '加载个人战绩失败'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const views = useMemo<SongView[]>(() => {
    const records = new Map(songs.map((song) => [song.chartId, song]));
    const charts = manifest?.charts ?? [];
    const merged: SongView[] = charts.map((chart) => {
      const record = records.get(chart.id);
      return {
        chart,
        chartId: chart.id,
        classic: record?.classic ?? null,
        rush: record?.rush ?? null,
      };
    });
    for (const song of songs) {
      if (!charts.some((chart) => chart.id === song.chartId)) merged.push({ chart: null, ...song });
    }
    const q = query.trim().toLowerCase();
    return merged
      .filter((song) => {
        if (starFilter !== 0 && song.chart?.stars !== starFilter) return false;
        if (!q) return true;
        const title = song.chart?.title ?? `曲目 ${song.chartId}`;
        const artist = song.chart?.artist ?? '';
        return `${title} ${artist}`.toLowerCase().includes(q);
      })
      .sort((a, b) => getBestScore(b) - getBestScore(a));
  }, [manifest, query, songs, starFilter]);

  useEffect(() => {
    setPage(1);
  }, [query, starFilter]);

  const totalPages = Math.max(1, Math.ceil(views.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedViews = useMemo(
    () => views.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [views, safePage],
  );

  const stats = useMemo(() => {
    const classic = songs.filter((song) => song.classic).length;
    const rush = songs.filter((song) => song.rush).length;
    const bestScore = songs.reduce((best, song) => Math.max(best, song.classic?.score ?? 0, song.rush?.score ?? 0), 0);
    return { classic, rush, bestScore };
  }, [songs]);

  return (
    <div className="records-page">
      <div className="records-mesh-bg" aria-hidden />
      <div className="records-stars" aria-hidden>
        <span style={{ top: '9%', left: '5%', fontSize: 15 }}>♪</span>
        <span style={{ top: '19%', left: '92%', fontSize: 13, animationDelay: '1s' }}>♫</span>
        <span style={{ top: '46%', left: '4%', fontSize: 12, animationDelay: '2.1s' }}>✦</span>
        <span style={{ top: '70%', left: '94%', fontSize: 15, animationDelay: '0.6s' }}>♪</span>
        <span style={{ top: '87%', left: '13%', fontSize: 12, animationDelay: '1.6s' }}>✧</span>
      </div>

      <header className="records-topbar">
        <Link href="/games/piano-tiles" className="records-exit-btn" aria-label="返回钢琴块">
          <span className="arrow">
            <ArrowLeft size={14} strokeWidth={2.4} />
          </span>
          EXIT
        </Link>
      </header>

      <main className="records-container">
        {error && (
          <div className="records-error-banner" role="alert">
            {error}
            <Link href="/login">去登录</Link>
          </div>
        )}

        <section className="records-command-bar" aria-live="polite">
          <div className="records-command-copy">
            <div className="records-command-topline">
              <Trophy className="h-4 w-4" />
              <span>个人战绩</span>
              <span className="records-command-slash">/</span>
              <span className="records-command-tactical">经典 / 限时双模式 · 每首歌最佳成绩</span>
            </div>
            <p className="records-command-message">每首歌曲分别记录两种模式的最佳成绩，持续刷新自己的节奏极限</p>
          </div>
          <div className="records-summary">
            <div>
              <span>经典记录</span>
              <strong>{stats.classic}</strong>
              <small>首</small>
            </div>
            <div>
              <span>冲刺记录</span>
              <strong>{stats.rush}</strong>
              <small>首</small>
            </div>
            <div>
              <span>最高分</span>
              <strong>{stats.bestScore}</strong>
              <small>分</small>
            </div>
          </div>
        </section>

        <section className="glass-card stage-card records-stage" aria-label="个人歌曲最佳成绩">
          <div className="records-stage-head">
            <h2 className="records-section-title">
              <span className="records-st-icon">
                <Trophy size={18} />
              </span>
              我的演奏档案
            </h2>
            <span className="records-cute-pill">
              <Award className="h-4 w-4" />
              两种模式 · 同一套判定
            </span>
          </div>

          <div className="records-keys-strip" aria-hidden />

          <div className="records-toolbar">
            <div className="records-search-wrap">
              <Search className="records-search-icon" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索曲名或音乐家…"
                aria-label="搜索歌曲或作者"
              />
            </div>
            <div className="records-filter-chips" role="group" aria-label="按难度筛选">
              {[0, 1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={starFilter === v}
                  onClick={() => setStarFilter(v)}
                  className={`records-filter-chip ${starFilter === v ? 'is-active' : ''}`}
                >
                  {v === 0 ? '全部难度' : '★'.repeat(v)}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="records-loading">
              <Loader2 className="spin" size={24} />
              正在加载个人战绩…
            </div>
          ) : views.length === 0 ? (
            <div className="records-empty">
              <Music size={32} />
              <h3>还没有找到曲目</h3>
              <p>先回到选曲台，完成一局演奏吧。</p>
              <Link href="/games/piano-tiles">
                <Play className="h-4 w-4" />
                开始演奏
              </Link>
            </div>
          ) : (
            <>
              <div className="records-grid">
                {pagedViews.map((song, index) => <SongRecordCard key={song.chartId} song={song} index={index} />)}
              </div>
              {totalPages > 1 && (
                <nav className="records-pager" aria-label="战绩分页">
                  <button
                    type="button"
                    className="records-filter-chip"
                    disabled={safePage <= 1}
                    onClick={() => setPage(safePage - 1)}
                  >
                    上一页
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 2)
                    .map((p, i, arr) => (
                      <span key={p} className="records-pager-item">
                        {i > 0 && arr[i - 1] !== p - 1 && <span className="records-pager-ellipsis">…</span>}
                        <button
                          type="button"
                          aria-current={p === safePage ? 'page' : undefined}
                          className={`records-filter-chip ${p === safePage ? 'is-active' : ''}`}
                          onClick={() => setPage(p)}
                        >
                          {p}
                        </button>
                      </span>
                    ))}
                  <button
                    type="button"
                    className="records-filter-chip"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage(safePage + 1)}
                  >
                    下一页
                  </button>
                </nav>
              )}
            </>
          )}
        </section>
      </main>
      <style jsx global>{styles}</style>
    </div>
  );
}

function SongRecordCard({ song, index }: { song: SongView; index: number }) {
  const title = song.chart?.title ?? `曲目 ${song.chartId}`;
  const artist = song.chart?.artist ?? '未知音乐家';
  return (
    <article className="record-song-card" style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}>
      <div className="record-song-head">
        <span className="record-song-tilemini" aria-hidden>
          {[0, 1, 2, 3].map((l) => (
            <i key={l} className={l === index % 4 ? 'on' : ''} />
          ))}
        </span>
        <div className="record-song-info">
          <h3>{title}</h3>
          <p>
            {artist}
            {song.chart ? ` · ${'★'.repeat(song.chart.stars)}` : ''}
          </p>
        </div>
        {song.chart && <span className="record-bpm">{song.chart.bpm} BPM</span>}
      </div>
      <div className="record-mode-grid">
        <ModeBest mode="classic" best={song.classic} />
        <ModeBest mode="rush" best={song.rush} />
      </div>
    </article>
  );
}

function ModeBest({ mode, best }: { mode: PianoTilesMode; best: PersonalBest | null }) {
  const classic = mode === 'classic';
  return (
    <div className={`record-mode ${classic ? 'classic' : 'rush'} ${best ? 'has-score' : 'empty'}`}>
      <div className="record-mode-title">
        <span className="record-mode-icon">{classic ? <Music size={15} /> : <Zap size={15} />}</span>
        <span>{classic ? '经典模式' : '限时冲刺'}</span>
        {best && <span className="record-best-label">最佳</span>}
      </div>
      {best ? (
        <>
          <div className="record-score"><strong>{best.score}</strong><span>分</span></div>
          <div className="record-metrics">
            <span>命中 <b>{best.tilesHit}</b></span>
            <span>{classic ? '皇冠' : '用时'} <b>{classic ? best.crowns : formatDuration(best.playedMs)}</b></span>
            {classic && <span>圈数 <b>{best.laps}</b></span>}
          </div>
          <p className="record-date">{formatDate(best.createdAt)}</p>
        </>
      ) : <div className="record-no-score">尚未挑战</div>}
    </div>
  );
}

const styles = `
.records-page {
  min-height: 100vh;
  background: #eefcf8;
  color: #0f172a;
  position: relative;
  overflow-x: hidden;
}
.records-page a {
  color: inherit;
  text-decoration: none;
}
.records-page .records-mesh-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 12% 18%, rgba(45, 212, 191, 0.34), transparent 38%),
    radial-gradient(circle at 88% 14%, rgba(148, 163, 184, 0.16), transparent 34%),
    radial-gradient(circle at 48% 96%, rgba(16, 185, 129, 0.28), transparent 42%),
    linear-gradient(180deg, #f4fefb 0%, #e9f8f3 60%, #e6f4ef 100%);
}
.records-page .records-stars {
  position: fixed;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  color: rgba(4, 120, 87, 0.4);
}
.records-page .records-stars span {
  position: absolute;
  animation: records-float 4s ease-in-out infinite;
}
@keyframes records-float {
  0%, 100% { transform: translateY(0); opacity: 0.45; }
  50% { transform: translateY(-10px); opacity: 0.9; }
}

/* ───────── 顶栏（与游戏页一致） ───────── */
.records-page .records-topbar {
  position: sticky;
  top: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 48px;
  padding-top: max(14px, env(safe-area-inset-top));
  background: rgba(239, 253, 248, 0.68);
  border-bottom: 1px solid rgba(255, 255, 255, 0.74);
  backdrop-filter: blur(22px) saturate(1.45);
  -webkit-backdrop-filter: blur(22px) saturate(1.45);
}
.records-page .records-exit-btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.82);
  background: rgba(255, 255, 255, 0.62);
  padding: 8px 18px 8px 8px;
  color: #065f46;
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 1.5px;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.07);
  backdrop-filter: blur(16px);
  flex-shrink: 0;
}
.records-page .records-exit-btn .arrow {
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 50%;
  color: #fff;
  background: linear-gradient(135deg, #34d399, #047857);
  box-shadow: 0 8px 14px rgba(4, 120, 87, 0.28);
}

/* ───────── 主容器 ───────── */
.records-page .records-container {
  position: relative;
  z-index: 1;
  max-width: 1360px;
  margin: 0 auto;
  padding: 22px 48px 92px;
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.records-page .records-error-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-radius: 20px;
  border: 1px solid rgba(254, 202, 202, 0.9);
  background: rgba(254, 242, 242, 0.92);
  padding: 14px 16px;
  color: #be123c;
  font-size: 14px;
  font-weight: 800;
}
.records-page .records-error-banner a {
  flex-shrink: 0;
  color: #9f1239;
  text-decoration: underline;
}

/* ───────── 指挥栏（与游戏页 command-bar 一致） ───────── */
.records-page .records-command-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  border-radius: 28px;
  border: 1px solid rgba(167, 243, 208, 0.9);
  background: rgba(255, 255, 255, 0.78);
  padding: 16px 18px;
  box-shadow: 0 18px 46px rgba(15, 23, 42, 0.07);
  backdrop-filter: blur(16px);
}
.records-page .records-command-copy {
  min-width: 0;
}
.records-page .records-command-topline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  color: #047857;
  font-size: 12px;
  font-weight: 900;
}
.records-page .records-command-slash {
  color: #cbd5e1;
}
.records-page .records-command-tactical {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #64748b;
}
.records-page .records-command-message {
  overflow: hidden;
  margin: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #020617;
  font-size: 18px;
  font-weight: 900;
}
.records-page .records-summary {
  display: flex;
  flex-shrink: 0;
  gap: 10px;
}
.records-page .records-summary div {
  min-width: 96px;
  border-radius: 18px;
  border: 1px solid rgba(167, 243, 208, 0.9);
  background: rgba(236, 253, 245, 0.72);
  padding: 11px 14px;
}
.records-page .records-summary span {
  display: block;
  color: #047857;
  font-size: 11px;
  font-weight: 900;
}
.records-page .records-summary strong {
  display: inline-block;
  margin-top: 4px;
  color: #0f172a;
  font-size: 24px;
  font-weight: 950;
  letter-spacing: -0.03em;
}
.records-page .records-summary small {
  margin-left: 3px;
  color: #94a3b8;
  font-size: 11px;
  font-weight: 900;
}

/* ───────── 舞台卡片（与游戏页 stage-card 一致） ───────── */
.records-page .glass-card {
  border: 1px solid rgba(255, 255, 255, 0.82);
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 22px 60px rgba(15, 23, 42, 0.1);
  backdrop-filter: blur(18px);
}
.records-page .stage-card {
  padding: 22px;
  border-radius: 30px;
}
.records-page .records-stage-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}
.records-page .records-section-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 20px;
  font-weight: 950;
  color: #0f172a;
}
.records-page .records-st-icon {
  display: inline-flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  color: #fff;
  background: linear-gradient(135deg, #34d399, #059669);
  box-shadow: 0 10px 18px rgba(5, 150, 105, 0.22);
}
.records-page .records-cute-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: 999px;
  border: 1px solid rgba(167, 243, 208, 0.9);
  background: rgba(236, 253, 245, 0.82);
  padding: 8px 13px;
  color: #047857;
  font-size: 12px;
  font-weight: 900;
}

/* ───────── 琴键装饰条 ───────── */
.records-page .records-keys-strip {
  position: relative;
  height: 16px;
  margin-bottom: 16px;
  border-radius: 999px;
  overflow: hidden;
  background: repeating-linear-gradient(90deg, #ffffff 0px, #ffffff 26px, #e2e8f0 26px, #e2e8f0 27px);
  border: 1px solid #e2e8f0;
  box-shadow: inset 0 -3px 6px rgba(15, 23, 42, 0.06);
}
.records-page .records-keys-strip::after {
  content: '';
  position: absolute;
  top: 0;
  left: 18px;
  right: 0;
  height: 62%;
  background: repeating-linear-gradient(
    90deg,
    #15181f 0px,
    #15181f 14px,
    transparent 14px,
    transparent 54px
  );
  border-radius: 0 0 3px 3px;
  opacity: 0.92;
}

/* ───────── 工具栏（搜索 + 难度筛选，与选曲台一致） ───────── */
.records-page .records-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.records-page .records-search-wrap {
  position: relative;
  flex: 1 1 260px;
  min-width: 0;
}
.records-page .records-search-icon {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  color: #94a3b8;
  pointer-events: none;
}
.records-page .records-search-wrap input {
  width: 100%;
  border-radius: 999px;
  border: 1px solid rgba(203, 213, 225, 0.9);
  background: rgba(255, 255, 255, 0.9);
  padding: 10px 16px 10px 38px;
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.records-page .records-search-wrap input::placeholder {
  color: #94a3b8;
  font-weight: 600;
}
.records-page .records-search-wrap input:focus {
  border-color: #34d399;
  box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.18);
}
.records-page .records-filter-chips {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  overflow-x: auto;
  max-width: 100%;
  padding-bottom: 2px;
  scrollbar-width: none;
}
.records-page .records-filter-chips::-webkit-scrollbar {
  display: none;
}
.records-page .records-filter-chip {
  flex: 0 0 auto;
  border-radius: 999px;
  border: 1px solid rgba(203, 213, 225, 0.9);
  background: rgba(255, 255, 255, 0.88);
  padding: 8px 13px;
  color: #475569;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.5px;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}
.records-page .records-filter-chip:hover {
  border-color: #6ee7b7;
  color: #047857;
}
.records-page .records-filter-chip.is-active {
  border-color: #059669;
  background: linear-gradient(135deg, #34d399, #059669);
  color: #fff;
  box-shadow: 0 8px 16px rgba(5, 150, 105, 0.25);
}
.records-page .records-filter-chip:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

/* ───────── 分页器 ───────── */
.records-page .records-pager {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 16px;
}
.records-page .records-pager-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.records-page .records-pager-ellipsis {
  color: #94a3b8;
  font-size: 12px;
  font-weight: 900;
}

/* ───────── 加载 / 空状态 ───────── */
.records-page .records-loading,
.records-page .records-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 270px;
  border: 1px dashed #bbf7d0;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.6);
  color: #64748b;
  font-size: 14px;
  font-weight: 800;
}
.records-page .records-loading {
  flex-direction: row;
  color: #047857;
}
.records-page .records-empty > svg {
  color: #34d399;
}
.records-page .records-empty h3 {
  margin: 3px 0 0;
  color: #0f172a;
  font-size: 20px;
  font-weight: 950;
}
.records-page .records-empty p {
  margin: 0 0 8px;
}
.records-page .records-empty a {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  background: linear-gradient(135deg, #34d399, #059669);
  padding: 10px 18px;
  color: #fff;
  font-size: 13px;
  font-weight: 900;
  box-shadow: 0 10px 20px rgba(5, 150, 105, 0.25);
  transition: transform 0.2s ease;
}
.records-page .records-empty a:hover {
  transform: translateY(-2px);
}

/* ───────── 歌曲战绩卡片 ───────── */
.records-page .records-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.records-page .record-song-card {
  border-radius: 22px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  background: rgba(255, 255, 255, 0.88);
  padding: 16px;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
  animation: records-card-in 0.42s ease both;
}
@keyframes records-card-in {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
.records-page .record-song-card:hover {
  transform: translateY(-2px);
  border-color: #6ee7b7;
  box-shadow: 0 14px 26px rgba(5, 150, 105, 0.12);
}
.records-page .record-song-head {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  margin-bottom: 14px;
}
.records-page .record-song-tilemini {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 2px;
  width: 34px;
  height: 44px;
  flex-shrink: 0;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #fbfbfd;
  padding: 3px;
}
.records-page .record-song-tilemini i {
  border-radius: 3px;
  background: #eef2f7;
}
.records-page .record-song-tilemini i.on {
  background: #15181f;
}
.records-page .record-song-info {
  min-width: 0;
  flex: 1;
}
.records-page .record-song-info h3 {
  overflow: hidden;
  margin: 0;
  color: #0f172a;
  font-size: 16px;
  font-weight: 950;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.records-page .record-song-info p {
  overflow: hidden;
  margin: 4px 0 0;
  color: #94a3b8;
  font-size: 11px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.records-page .record-bpm {
  flex-shrink: 0;
  border-radius: 999px;
  border: 1px solid rgba(167, 243, 208, 0.9);
  background: rgba(236, 253, 245, 0.82);
  padding: 5px 9px;
  color: #047857;
  font-size: 10px;
  font-weight: 950;
}
.records-page .record-mode-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.records-page .record-mode {
  min-width: 0;
  min-height: 148px;
  border-radius: 18px;
  padding: 13px;
}
.records-page .record-mode.classic {
  border: 2px solid #a7f3d0;
  background: linear-gradient(145deg, #f0fdf4, #ecfdf5);
}
.records-page .record-mode.rush {
  border: 2px solid #fde68a;
  background: linear-gradient(145deg, #fff7ed, #fffbeb);
}
.records-page .record-mode.empty {
  border-style: dashed;
  opacity: 0.78;
}
.records-page .record-mode-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 950;
}
.records-page .record-mode.classic .record-mode-title {
  color: #047857;
}
.records-page .record-mode.rush .record-mode-title {
  color: #b45309;
}
.records-page .record-mode-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 23px;
  height: 23px;
  border-radius: 8px;
}
.records-page .record-mode.classic .record-mode-icon {
  background: #d1fae5;
  color: #047857;
}
.records-page .record-mode.rush .record-mode-icon {
  background: #fef3c7;
  color: #b45309;
}
.records-page .record-best-label {
  margin-left: auto;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.75);
  padding: 3px 7px;
  font-size: 9px;
}
.records-page .record-score {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin: 12px 0 7px;
}
.records-page .record-score strong {
  color: #0f172a;
  font-size: 30px;
  line-height: 1;
  font-weight: 950;
  letter-spacing: -0.04em;
}
.records-page .record-score span {
  color: #64748b;
  font-size: 11px;
  font-weight: 900;
}
.records-page .record-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 9px;
  color: #64748b;
  font-size: 10px;
  font-weight: 800;
}
.records-page .record-metrics b {
  color: #334155;
  font-weight: 950;
}
.records-page .record-date {
  margin: 10px 0 0;
  color: #94a3b8;
  font-size: 10px;
  font-weight: 800;
}
.records-page .record-no-score {
  display: flex;
  min-height: 94px;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  font-size: 12px;
  font-weight: 850;
}
.records-page .spin {
  animation: records-spin 0.9s linear infinite;
}
@keyframes records-spin {
  to { transform: rotate(360deg); }
}

/* ───────── 响应式 ───────── */
@media (max-width: 860px) {
  .records-page .records-topbar {
    padding-inline: 20px;
  }
  .records-page .records-container {
    padding: 18px 20px 68px;
    gap: 16px;
  }
  .records-page .records-command-bar {
    align-items: stretch;
    flex-direction: column;
    gap: 14px;
  }
  .records-page .records-summary {
    width: 100%;
  }
  .records-page .records-summary div {
    flex: 1;
    min-width: 0;
  }
  .records-page .records-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 560px) {
  .records-page .records-topbar {
    padding-inline: 14px;
  }
  .records-page .records-container {
    padding: 14px 12px 48px;
    gap: 12px;
  }
  .records-page .records-command-bar {
    border-radius: 22px;
    padding: 13px 14px;
  }
  .records-page .records-command-message {
    white-space: normal;
    font-size: 15px;
    line-height: 1.5;
  }
  .records-page .records-summary {
    gap: 7px;
  }
  .records-page .records-summary div {
    border-radius: 15px;
    padding: 10px 9px;
  }
  .records-page .records-summary span {
    font-size: 10px;
    white-space: nowrap;
  }
  .records-page .records-summary strong {
    font-size: 20px;
  }
  .records-page .records-summary small {
    font-size: 10px;
  }
  .records-page .stage-card {
    border-radius: 24px;
    padding: 15px 13px;
  }
  .records-page .records-section-title {
    font-size: 17px;
  }
  .records-page .records-st-icon {
    width: 32px;
    height: 32px;
    border-radius: 10px;
  }
  .records-page .records-cute-pill {
    font-size: 11px;
    padding: 7px 11px;
  }
  .records-page .records-keys-strip {
    height: 13px;
    margin-bottom: 13px;
  }
  .records-page .records-grid {
    gap: 10px;
  }
  .records-page .record-song-card {
    border-radius: 18px;
    padding: 13px;
  }
  .records-page .record-song-head {
    gap: 10px;
    margin-bottom: 12px;
  }
  .records-page .record-song-info h3 {
    font-size: 15px;
  }
  .records-page .record-song-info p {
    margin-top: 3px;
    font-size: 10px;
  }
  .records-page .record-bpm {
    padding: 4px 7px;
    font-size: 9px;
  }
  .records-page .record-mode-grid {
    gap: 8px;
  }
  .records-page .record-mode {
    min-height: 138px;
    border-radius: 15px;
    padding: 10px;
  }
  .records-page .record-mode-title {
    gap: 4px;
    font-size: 10px;
  }
  .records-page .record-mode-icon {
    width: 21px;
    height: 21px;
    border-radius: 7px;
  }
  .records-page .record-best-label {
    padding: 2px 5px;
    font-size: 8px;
  }
  .records-page .record-score {
    gap: 3px;
    margin: 10px 0 6px;
  }
  .records-page .record-score strong {
    font-size: 25px;
  }
  .records-page .record-score span {
    font-size: 10px;
  }
  .records-page .record-metrics {
    gap: 4px 6px;
    font-size: 9px;
    line-height: 1.35;
  }
  .records-page .record-date {
    margin-top: 8px;
    font-size: 9px;
    white-space: nowrap;
  }
  .records-page .record-no-score {
    min-height: 86px;
    font-size: 11px;
  }
}
@media (max-width: 350px) {
  .records-page .records-container {
    padding-inline: 10px;
  }
  .records-page .records-summary {
    gap: 5px;
  }
  .records-page .records-summary div {
    padding-inline: 7px;
  }
  .records-page .records-summary strong {
    font-size: 18px;
  }
  .records-page .record-mode-grid {
    grid-template-columns: 1fr;
  }
  .records-page .record-mode {
    min-height: 124px;
  }
}
`;
