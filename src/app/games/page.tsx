'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Sparkles,
  Bomb,
  Castle,
  Hammer,
  Layers,
  Grid3x3,
  Apple,
  Trophy,
  TrendingUp,
  Crown,
  Award,
  ChevronRight,
  Star,
  Gamepad2,
  Heart,
  Target,
  Home,
  Hash,
  type LucideIcon,
} from 'lucide-react';
import type { PublicAchievement } from '@/lib/profile-achievements';

// ──────────────────────────────────────────────────
// Game metadata
// ──────────────────────────────────────────────────

type GameKey = 'roguelite' | 'minesweeper' | 'whack-mole' | 'memory' | 'match3' | 'linkgame' | '2048' | 'lucky-td';

interface GameMeta {
  key: GameKey;
  name: string;
  description: string;
  Icon: LucideIcon;
  /** 封面图片路径（public 下绝对路径） */
  image: string;
  /** 卡面中央叠加的物品图（PNG 透明背景） */
  mascot: string;
  href: string;
}

const GAME_CARD_IMAGE_BASE = '/images-optimized/ui/games';

const GAMES: readonly GameMeta[] = [
  {
    key: 'roguelite',
    name: '星尘迷阵',
    description: '无限肉鸽探险，星门、遗物与无尽星域。',
    Icon: Sparkles,
    image: `${GAME_CARD_IMAGE_BASE}/covers/roguelite.webp`,
    mascot: `${GAME_CARD_IMAGE_BASE}/mascots/roguelite.webp`,
    href: '/games/roguelite',
  },
  {
    key: 'minesweeper',
    name: '扫雷',
    description: '三难度经典扫雷，推理与运气。',
    Icon: Bomb,
    image: `${GAME_CARD_IMAGE_BASE}/covers/minesweeper.webp`,
    mascot: `${GAME_CARD_IMAGE_BASE}/mascots/minesweeper.webp`,
    href: '/games/minesweeper',
  },
  {
    key: 'whack-mole',
    name: '打地鼠',
    description: '60 秒反应挑战，连击叠加奖励。',
    Icon: Hammer,
    image: `${GAME_CARD_IMAGE_BASE}/covers/whack-mole.webp`,
    mascot: `${GAME_CARD_IMAGE_BASE}/mascots/whack-mole.webp`,
    href: '/games/whack-mole',
  },
  {
    key: 'memory',
    name: '记忆卡片',
    description: '翻牌配对，少步数高分。',
    Icon: Layers,
    image: `${GAME_CARD_IMAGE_BASE}/covers/memory.webp`,
    mascot: `${GAME_CARD_IMAGE_BASE}/mascots/memory.webp`,
    href: '/games/memory',
  },
  {
    key: 'match3',
    name: '消消乐',
    description: '交换相邻方块凑三消除。',
    Icon: Grid3x3,
    image: `${GAME_CARD_IMAGE_BASE}/covers/match3.webp`,
    mascot: `${GAME_CARD_IMAGE_BASE}/mascots/match3.webp`,
    href: '/games/match3',
  },
  {
    key: 'linkgame',
    name: '连连看',
    description: '消除相同水果，眼力反应。',
    Icon: Apple,
    image: `${GAME_CARD_IMAGE_BASE}/covers/linkgame.webp`,
    mascot: `${GAME_CARD_IMAGE_BASE}/mascots/linkgame.webp`,
    href: '/games/linkgame',
  },
  {
    key: '2048',
    name: '2048',
    description: '5x5 数字合成棋盘，冲击 2048 里程碑。',
    Icon: Hash,
    image: `${GAME_CARD_IMAGE_BASE}/covers/2048.webp`,
    mascot: `${GAME_CARD_IMAGE_BASE}/mascots/2048.webp`,
    href: '/games/2048',
  },
  {
    key: 'lucky-td',
    name: '幸运塔防',
    description: '横屏塔防：部署干员阻挡敌潮，守住 30 波。',
    Icon: Castle,
    image: `${GAME_CARD_IMAGE_BASE}/covers/lucky-td.webp`,
    mascot: `${GAME_CARD_IMAGE_BASE}/mascots/lucky-td.webp`,
    href: '/games/lucky-td',
  },
] as const;

const GAME_NAME_BY_KEY: Record<GameKey, string> = GAMES.reduce(
  (acc, g) => ({ ...acc, [g.key]: g.name }),
  {} as Record<GameKey, string>
);

// ──────────────────────────────────────────────────
// API contracts
// ──────────────────────────────────────────────────

interface GameProgress {
  totalPlays: number;
  bestScore: number;
  totalPointsEarned: number;
  hasWinFlag: boolean;
  wins: number;
  bestWinStreak: number;
}

interface ProfileData {
  balance: number;
  dailyStats: { gamesPlayed: number; pointsEarned: number };
  totalGamesPlayed: number;
  peakScore: number;
  peakGame: GameKey | null;
  favoriteGame: GameKey | null;
  mostWinsGame: GameKey | null;
  mostWinsCount: number;
  bestStreakGame: GameKey | null;
  bestStreak: number;
  winRate: number;
  perGame: Record<GameKey, GameProgress>;
}

interface ProfileUpdatedDetail {
  displayName?: string | null;
  avatarUrl?: string | null;
  equippedAchievement?: PublicAchievement | null;
}

// ──────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────

export default function GamesPage() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [user, setUser] = useState<{
    username: string;
    displayName: string;
    avatarUrl: string | null;
    equippedAchievement: PublicAchievement | null;
    isAdmin: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [profileRes, meRes, settingsRes] = await Promise.all([
          fetch('/api/games/profile', { cache: 'no-store' }),
          fetch('/api/auth/me', { cache: 'no-store' }),
          fetch('/api/profile/settings', { cache: 'no-store' }),
        ]);

        // user
        const meJson = (await meRes.json().catch(() => null)) as {
          success?: boolean;
          user?: { id: number; username: string; displayName: string; isAdmin: boolean };
        } | null;
        const settingsJson = (await settingsRes.json().catch(() => null)) as {
          success?: boolean;
          data?: {
            displayName: string | null;
            avatarUrl: string | null;
            equippedAchievement?: PublicAchievement | null;
          };
        } | null;

        if (!cancelled && meJson?.success && meJson.user) {
          setUser({
            username: meJson.user.username,
            displayName: settingsJson?.data?.displayName || meJson.user.displayName,
            avatarUrl: settingsJson?.data?.avatarUrl ?? null,
            equippedAchievement: settingsJson?.data?.equippedAchievement ?? null,
            isAdmin: meJson.user.isAdmin,
          });
        }

        const profileJson = (await profileRes.json().catch(() => null)) as {
          success?: boolean;
          data?: ProfileData;
          message?: string;
        } | null;
        if (!profileRes.ok || !profileJson?.success || !profileJson.data) {
          throw new Error(profileJson?.message ?? '加载个人战绩失败');
        }

        if (!cancelled) {
          setProfile(profileJson.data);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '网络错误');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    const handleProfileUpdated = (event: Event) => {
      const detail = (event as CustomEvent<ProfileUpdatedDetail>).detail;
      if (!detail) return;

      setUser((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          displayName: Object.prototype.hasOwnProperty.call(detail, 'displayName')
            ? detail.displayName || prev.username
            : prev.displayName,
          avatarUrl: Object.prototype.hasOwnProperty.call(detail, 'avatarUrl')
            ? detail.avatarUrl ?? null
            : prev.avatarUrl,
          equippedAchievement: Object.prototype.hasOwnProperty.call(detail, 'equippedAchievement')
            ? detail.equippedAchievement ?? null
            : prev.equippedAchievement,
        };
      });
    };

    window.addEventListener('lucky:profile-updated', handleProfileUpdated);

    return () => {
      cancelled = true;
      window.removeEventListener('lucky:profile-updated', handleProfileUpdated);
    };
  }, []);

  const balance = profile?.balance ?? 0;
  const favoriteName = profile?.favoriteGame ? GAME_NAME_BY_KEY[profile.favoriteGame] : '—';
  const mostWinsName = profile?.mostWinsGame ? GAME_NAME_BY_KEY[profile.mostWinsGame] : '—';
  const bestStreakName = profile?.bestStreakGame ? GAME_NAME_BY_KEY[profile.bestStreakGame] : '—';
  const peakGameName = profile?.peakGame ? GAME_NAME_BY_KEY[profile.peakGame] : '—';
  const navAchievement = user?.equippedAchievement ?? null;
  const navRoleLabel = user?.isAdmin ? '管理员' : '用户';

  return (
    <div className="games-page">
      {/* mesh background */}
      <div className="mesh-bg" aria-hidden />

      {/* topbar */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">
            <Gamepad2 size={22} strokeWidth={2.4} />
          </div>
          游戏中心
        </div>
        <div className="topbar-right">
          <Link href="/" className="btn-icon" aria-label="返回首页" title="返回首页">
            <Home size={16} strokeWidth={2} />
          </Link>
          <Link href="/profile" className="user-profile" aria-label="查看个人主页">
            <div className="avatar">
              {user?.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.avatarUrl} alt={user.displayName} className="avatar-img" decoding="async" />
              ) : (
                (user?.displayName?.[0] ?? user?.username?.[0] ?? '?').toUpperCase()
              )}
            </div>
            <div className="user-info">
              <h4>{user?.displayName || user?.username || '未登录'}</h4>
              <p className="nav-achievement-line" title={navAchievement?.desc ?? '未佩戴成就'}>
                {navAchievement ? (
                  <span className="nav-achievement">
                    <span className="nav-achievement-emoji" aria-hidden>{navAchievement.emoji}</span>
                    <span className="nav-achievement-name">{navAchievement.name}</span>
                  </span>
                ) : (
                  <span className="nav-achievement empty">{navRoleLabel}</span>
                )}
              </p>
            </div>
          </Link>
        </div>
      </header>

      <main className="games-main">
        {/* ═══════════════════════ HERO ═══════════════════════ */}
        <section className="lucky-hero">
          <div className="stars" aria-hidden>
            <span className="star" style={{ top: '14%', left: '10%', fontSize: 13 }}>✦</span>
            <span className="star" style={{ top: '34%', left: '40%', fontSize: 11, animationDelay: '0.8s' }}>✦</span>
            <span className="star" style={{ top: '68%', left: '20%', fontSize: 14, animationDelay: '1.4s' }}>✦</span>
            <span className="star" style={{ top: '78%', left: '52%', fontSize: 10, animationDelay: '0.4s' }}>✦</span>
            <span className="star" style={{ top: '22%', left: '60%', fontSize: 12, animationDelay: '2s' }}>✦</span>
          </div>

          <div className="float-cards" aria-hidden>
            <div className="fc-card fc-1">
              <div className="fc-glow" />
              ✦
            </div>
            <div className="fc-card fc-2">
              <div className="fc-glow" />
              🎮
            </div>
            <div className="fc-card fc-3">
              <div className="fc-glow" />
              🏆
            </div>
          </div>

          <div className="hero-content">
            <div className="hero-text">
              <div className="hero-badge">
                <Star size={12} fill="currentColor" strokeWidth={0} />
                LUCKY 游戏中心 · {GAMES.length} 款挑战
              </div>
              <h1 className="hero-title">
                挑战小游戏<br />
                赢取<span className="glow">海量积分</span>
              </h1>

              <div className="hero-meta">
                <div className="hero-meta-chip">
                  <Gamepad2 size={14} />
                  今日 {loading ? '…' : profile?.dailyStats.gamesPlayed ?? 0} 局
                </div>
                <div className="hero-meta-chip">
                  <TrendingUp size={14} />
                  今日积分 +{loading ? '…' : profile?.dailyStats.pointsEarned ?? 0}
                </div>
                <div className="hero-meta-chip">
                  <Crown size={14} />
                  胜率 {loading ? '…' : `${Math.round((profile?.winRate ?? 0) * 100)}%`}
                </div>
              </div>
            </div>

            <div className="hero-points-wrap">
              <div className="hero-points-card">
                <div className="hpc-star">
                  <Star fill="currentColor" strokeWidth={0} />
                </div>
                <div className="hpc-info">
                  <div className="hpc-label">当前可用积分余额</div>
                  <div className="hpc-value">
                    {loading ? '…' : balance.toLocaleString()}
                    <span className="unit">积分</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}

        {/* ═══════════════════════ STAT STRIP ═══════════════════════ */}
        <StatStrip profile={profile} loading={loading} mostWinsName={mostWinsName} />

        {/* ═══════════════════════ 我的进度 ═══════════════════════ */}
        <ProgressPanel
          profile={profile}
          loading={loading}
          favoriteName={favoriteName}
          bestStreakName={bestStreakName}
          peakGameName={peakGameName}
        />

        {/* ═══════════════════════ GAME LIBRARY ═══════════════════════ */}
        <GameLibrary games={GAMES} profile={profile} />
      </main>

        {/* ═══════════════════════ STYLES ═══════════════════════ */}
        <style jsx global>{`
          /* ───────── PAGE WRAPPER ───────── */
          .games-page {
            --c-green: #10b981;
            --c-green-600: #059669;
            --c-green-700: #047857;
            --c-green-800: #065f46;
            --c-green-900: #064e3b;
            --c-green-50: #ecfdf5;
            --c-green-100: #d1fae5;
            --text-main: #0f172a;
            --text-soft: #64748b;
            --text-light: #94a3b8;
            min-height: 100vh;
            background: #f8fafc;
            color: var(--text-main);
            position: relative;
            overflow-x: hidden;
          }
          .games-page .mesh-bg {
            position: fixed; inset: 0; z-index: 0;
            pointer-events: none;
            background-image:
              radial-gradient(circle at 15% 20%, rgba(167, 243, 208, 0.65) 0%, transparent 50%),
              radial-gradient(circle at 85% 30%, rgba(110, 231, 183, 0.45) 0%, transparent 50%),
              radial-gradient(circle at 50% 100%, rgba(16, 185, 129, 0.35) 0%, transparent 60%),
              radial-gradient(circle at 50% 50%, rgba(220, 252, 231, 0.85) 0%, transparent 50%);
            filter: blur(60px);
            animation: gamesFluid 18s infinite alternate ease-in-out;
          }
          @keyframes gamesFluid {
            0% { transform: scale(1) rotate(0deg); }
            50% { transform: scale(1.05) rotate(2deg); }
            100% { transform: scale(1.1) rotate(-2deg); }
          }

          /* ───────── TOPBAR ───────── */
          .games-page .topbar {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 100;
            display: flex; align-items: center; justify-content: space-between;
            width: 100%;
            margin: 0;
            gap: 24px;
            padding: 16px 48px;
            padding-top: max(16px, env(safe-area-inset-top));
            background: rgba(248, 250, 252, 0.65);
            backdrop-filter: blur(24px) saturate(1.6);
            -webkit-backdrop-filter: blur(24px) saturate(1.6);
            border-bottom: 1px solid rgba(255, 255, 255, 0.8);
          }
          .games-page .brand {
            display: flex; align-items: center; gap: 12px;
            font-size: 20px; font-weight: 800; letter-spacing: -0.5px;
            color: var(--text-main); flex-shrink: 0;
          }
          .games-page .brand-icon {
            width: 36px; height: 36px;
            background: linear-gradient(135deg, #34d399, #10b981);
            border-radius: 11px;
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 8px 16px rgba(16, 185, 129, 0.3);
          }
          .games-page .brand-icon svg { width: 20px; height: 20px; color: #fff; stroke-width: 2.5; }

          .games-page .topbar-right {
            display: flex; align-items: center; gap: 12px; flex-shrink: 0;
          }
          .games-page .topbar .btn-icon {
            width: 40px; height: 40px; border-radius: 50%;
            background: rgba(255, 255, 255, 0.7);
            border: 1px solid rgba(255, 255, 255, 0.9);
            display: inline-flex; align-items: center; justify-content: center;
            color: var(--text-light); transition: all 0.2s; cursor: pointer;
          }
          .games-page .topbar .btn-icon svg { width: 16px; height: 16px; }
          .games-page .topbar .btn-icon:hover {
            background: #fff; color: var(--c-green); transform: translateY(-1px);
          }

          .games-page .user-profile {
            display: inline-flex; align-items: center; gap: 12px;
            padding: 5px 16px 5px 5px;
            background: #fff; border-radius: 999px;
            box-shadow: 0 8px 20px rgba(0, 0, 0, 0.04);
            cursor: pointer; transition: transform 0.2s;
            text-decoration: none;
            color: var(--text-main);
          }
          .games-page .user-profile:hover { transform: scale(1.02); }
          .games-page .user-profile .avatar {
            width: 36px; height: 36px; border-radius: 50%;
            background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);
            color: #475569; display: inline-flex; align-items: center; justify-content: center;
            font-weight: 800; font-size: 14px; flex-shrink: 0;
            overflow: hidden; text-transform: uppercase;
          }
          .games-page .user-profile .avatar-img {
            width: 100%; height: 100%; object-fit: cover;
            border-radius: inherit; display: block;
          }
          .games-page .user-info h4 {
            font-size: 13px; font-weight: 700; line-height: 1.2; margin: 0;
            max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          }
          .games-page .user-info p {
            font-size: 11px; color: var(--text-light); margin: 1px 0 0;
            display: inline-flex; align-items: center; gap: 4px;
            max-width: 150px;
          }
          .games-page .user-info .nav-achievement-line {
            width: 100%;
            min-width: 0;
          }
          .games-page .nav-achievement {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            min-width: 0;
            color: #92400e;
            font-weight: 800;
          }
          .games-page .nav-achievement.empty {
            color: var(--text-light);
            font-weight: 700;
          }
          .games-page .nav-achievement-emoji {
            flex: 0 0 auto;
            font-size: 11px;
            line-height: 1;
          }
          .games-page .nav-achievement-name {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .games-page .user-info p .rank-pill {
            background: linear-gradient(135deg, #34d399, #10b981);
            color: #fff;
            padding: 1px 7px; border-radius: 999px;
            font-weight: 800; font-size: 10px; letter-spacing: 0.3px;
            font-variant-numeric: tabular-nums;
          }

          /* ───────── MAIN ───────── */
          .games-page .games-main {
            position: relative; z-index: 1;
            max-width: 1500px;
            margin: 0 auto;
            padding: 100px 48px 96px;
            display: flex;
            flex-direction: column;
            gap: 26px;
          }
          @media (max-width: 1280px) {
            .games-page .games-main { padding: 96px 32px 80px; }
          }
          @media (max-width: 992px) {
            .games-page .games-main { padding: 92px 24px 80px; gap: 22px; }
          }
          @media (max-width: 768px) {
            .games-page .games-main { padding: 78px 14px 100px; gap: 18px; }
            .games-page .topbar {
              padding: 12px 16px;
              padding-top: max(12px, env(safe-area-inset-top));
              gap: 8px;
            }
          }

          .games-page .error-banner {
            margin-top: 20px;
            padding: 12px 18px;
            border-radius: 16px;
            background: #fef2f2;
            border: 1px solid #fecaca;
            color: #b91c1c;
            font-size: 14px;
            font-weight: 600;
          }

          /* ───────── HERO ───────── */
          .games-page .lucky-hero {
            position: relative;
            padding: 44px 48px;
            border-radius: 36px;
            background:
              /* 左上角暗化蒙层（保证标题可读） */
              linear-gradient(
                to bottom right,
                rgba(2, 28, 22, 0.72) 0%,
                rgba(2, 28, 22, 0.32) 32%,
                transparent 55%
              ),
              /* 右上角暗化蒙层（保证浮动卡片与积分卡可读） */
              linear-gradient(
                to bottom left,
                rgba(2, 28, 22, 0.58) 0%,
                rgba(2, 28, 22, 0.22) 30%,
                transparent 55%
              ),
              /* 主图 */
              url('/images-optimized/ui/games/hero.webp') center 40% / cover no-repeat,
              /* 兜底渐变（图片未加载时呈现原配色） */
              linear-gradient(135deg, #022c22 0%, #064e3b 35%, #065f46 70%, #047857 100%);
            color: #fff;
            overflow: hidden;
            box-shadow: 0 30px 60px rgba(2, 44, 34, 0.35);
          }

          .games-page .lucky-hero::before {
            content: '';
            position: absolute;
            inset: 0;
            background-image:
              radial-gradient(circle at 50% 100%, rgba(16, 185, 129, 0.32), transparent 60%);
            pointer-events: none;
          }

          .games-page .lucky-hero::after {
            content: '';
            position: absolute;
            top: -40%;
            right: -10%;
            width: 480px;
            height: 480px;
            background: radial-gradient(circle, rgba(110, 231, 183, 0.18), transparent 60%);
            filter: blur(60px);
            pointer-events: none;
            animation: lucky-glow-pulse 4.5s ease-in-out infinite;
            mix-blend-mode: screen;
          }

          @keyframes lucky-glow-pulse {
            0%, 100% { transform: scale(1); opacity: 0.65; }
            50% { transform: scale(1.18); opacity: 1; }
          }

          .games-page .stars {
            position: absolute;
            inset: 0;
            pointer-events: none;
            overflow: hidden;
          }
          .games-page .star {
            position: absolute;
            color: rgba(255, 255, 255, 0.75);
            animation: lucky-twinkle 3s ease-in-out infinite;
          }
          @keyframes lucky-twinkle {
            0%, 100% { opacity: 0.3; transform: scale(1); }
            50% { opacity: 1; transform: scale(1.3); }
          }

          .games-page .float-cards {
            position: absolute;
            top: 50%;
            right: 5%;
            transform: translateY(-50%);
            width: 220px;
            height: 200px;
            z-index: 1;
          }
          .games-page .fc-card {
            position: absolute;
            width: 92px;
            height: 130px;
            border-radius: 14px;
            border: 2.5px solid rgba(255, 255, 255, 0.9);
            box-shadow:
              0 20px 40px rgba(0, 0, 0, 0.45),
              0 0 0 1px rgba(0, 0, 0, 0.15);
            backdrop-filter: blur(12px);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 38px;
          }
          .games-page .fc-card.fc-1 {
            top: 30px;
            left: 10px;
            background: linear-gradient(135deg, rgba(52, 211, 153, 0.85), rgba(16, 185, 129, 0.7));
            transform: rotate(-12deg);
            animation: lucky-float-1 5s ease-in-out infinite;
          }
          .games-page .fc-card.fc-2 {
            top: 10px;
            left: 70px;
            background: linear-gradient(135deg, rgba(110, 231, 183, 0.85), rgba(52, 211, 153, 0.7));
            transform: rotate(0deg);
            animation: lucky-float-2 5s ease-in-out infinite 0.4s;
            z-index: 2;
          }
          .games-page .fc-card.fc-3 {
            top: 30px;
            left: 130px;
            background: linear-gradient(135deg, rgba(167, 243, 208, 0.85), rgba(110, 231, 183, 0.7));
            transform: rotate(12deg);
            animation: lucky-float-3 5s ease-in-out infinite 0.8s;
          }
          @keyframes lucky-float-1 {
            0%, 100% { transform: rotate(-12deg) translateY(0); }
            50% { transform: rotate(-15deg) translateY(-8px); }
          }
          @keyframes lucky-float-2 {
            0%, 100% { transform: rotate(0deg) translateY(0); }
            50% { transform: rotate(2deg) translateY(-12px); }
          }
          @keyframes lucky-float-3 {
            0%, 100% { transform: rotate(12deg) translateY(0); }
            50% { transform: rotate(15deg) translateY(-8px); }
          }
          .games-page .fc-card .fc-glow {
            position: absolute;
            inset: 6px;
            border-radius: 10px;
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.2), transparent);
          }

          .games-page .hero-content {
            position: relative;
            z-index: 2;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 32px;
            flex-wrap: wrap;
          }

          .games-page .hero-text {
            display: flex;
            flex-direction: column;
            gap: 14px;
            max-width: 540px;
          }

          .games-page .hero-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 14px;
            background: rgba(110, 231, 183, 0.22);
            border: 1px solid rgba(110, 231, 183, 0.45);
            border-radius: 999px;
            font-size: 12px;
            font-weight: 800;
            color: #a7f3d0;
            letter-spacing: 1px;
            backdrop-filter: blur(10px);
            width: fit-content;
          }
          .games-page .hero-badge svg { width: 12px; height: 12px; }

          .games-page .hero-title {
            font-size: 48px;
            font-weight: 900;
            letter-spacing: -1.5px;
            line-height: 1.05;
            margin: 0;
            color: #fff;
            text-shadow: 0 2px 18px rgba(0, 0, 0, 0.6);
          }
          .games-page .hero-title .glow {
            background: linear-gradient(135deg, #6ee7b7, #34d399);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            text-shadow: 0 2px 14px rgba(0, 0, 0, 0.6), 0 0 40px rgba(52, 211, 153, 0.4);
            filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.5));
          }

          .games-page .hero-sub {
            font-size: 15px;
            color: rgba(255, 255, 255, 0.82);
            line-height: 1.65;
            max-width: 540px;
            margin: 0;
          }

          .games-page .hero-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 4px;
          }
          .games-page .hero-meta-chip {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 12px;
            background: rgba(2, 28, 22, 0.42);
            border: 1px solid rgba(255, 255, 255, 0.22);
            border-radius: 999px;
            font-size: 12px;
            font-weight: 700;
            color: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(12px);
            box-shadow: 0 6px 16px rgba(0, 0, 0, 0.18);
          }
          .games-page .hero-meta-chip svg { color: #6ee7b7; }

          .games-page .hero-points-wrap {
            position: relative;
            z-index: 3;
          }
          .games-page .hero-points-card {
            display: inline-flex;
            align-items: center;
            gap: 16px;
            padding: 18px 26px;
            background: rgba(2, 28, 22, 0.55);
            border: 1px solid rgba(255, 255, 255, 0.32);
            border-radius: 22px;
            backdrop-filter: blur(22px);
            box-shadow: 0 18px 36px rgba(0, 0, 0, 0.42);
          }
          .games-page .hpc-star {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: linear-gradient(135deg, #fbbf24, #f59e0b);
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
            box-shadow: 0 8px 18px rgba(245, 158, 11, 0.45);
            flex-shrink: 0;
          }
          .games-page .hpc-star svg { width: 22px; height: 22px; }
          .games-page .hpc-info {
            display: flex;
            flex-direction: column;
            gap: 2px;
          }
          .games-page .hpc-label {
            font-size: 11px;
            color: rgba(255, 255, 255, 0.72);
            font-weight: 700;
            letter-spacing: 1px;
            text-transform: uppercase;
          }
          .games-page .hpc-value {
            font-size: 28px;
            font-weight: 900;
            line-height: 1;
            background: linear-gradient(135deg, #ecfdf5, #a7f3d0);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: -0.5px;
          }
          .games-page .hpc-value .unit {
            font-size: 13px;
            color: rgba(255, 255, 255, 0.72);
            font-weight: 700;
            margin-left: 6px;
            -webkit-text-fill-color: rgba(255, 255, 255, 0.72);
            background: none;
          }

          /* ───────── STAT STRIP ───────── */
          .games-page .stat-strip {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
          }
          @media (min-width: 768px) {
            .games-page .stat-strip { grid-template-columns: repeat(4, 1fr); gap: 16px; }
          }
          .games-page .stat-card {
            position: relative;
            padding: 16px 18px;
            border-radius: 20px;
            background: rgba(255, 255, 255, 0.95);
            border: 1px solid rgba(255, 255, 255, 0.6);
            box-shadow: 0 14px 28px rgba(2, 44, 34, 0.18);
            backdrop-filter: blur(10px);
            display: flex;
            align-items: center;
            gap: 12px;
          }
          .games-page .stat-card .sc-icon {
            width: 44px;
            height: 44px;
            border-radius: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
            flex-shrink: 0;
          }
          .games-page .stat-card .sc-info { min-width: 0; }
          .games-page .stat-card .sc-label {
            font-size: 11px;
            color: #64748b;
            font-weight: 700;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            white-space: nowrap;
          }
          .games-page .stat-card .sc-value {
            font-size: 22px;
            font-weight: 900;
            letter-spacing: -0.5px;
            margin-top: 1px;
            font-variant-numeric: tabular-nums;
          }
          .games-page .stat-card.t-amber .sc-icon { background: linear-gradient(135deg, #fbbf24, #f59e0b); box-shadow: 0 8px 16px rgba(245, 158, 11, 0.4); }
          .games-page .stat-card.t-amber .sc-value { color: #b45309; }
          .games-page .stat-card.t-emerald .sc-icon { background: linear-gradient(135deg, #34d399, #10b981); box-shadow: 0 8px 16px rgba(16, 185, 129, 0.4); }
          .games-page .stat-card.t-emerald .sc-value { color: #047857; }
          .games-page .stat-card.t-teal .sc-icon { background: linear-gradient(135deg, #2dd4bf, #14b8a6); box-shadow: 0 8px 16px rgba(20, 184, 166, 0.4); }
          .games-page .stat-card.t-teal .sc-value { color: #0f766e; }
          .games-page .stat-card.t-violet .sc-icon { background: linear-gradient(135deg, #a78bfa, #8b5cf6); box-shadow: 0 8px 16px rgba(139, 92, 246, 0.4); }
          .games-page .stat-card.t-violet .sc-value { color: #6d28d9; }

          /* ───────── PROGRESS PANEL ───────── */
          .games-page .progress-panel {
            padding: 22px 24px;
            border-radius: 24px;
            background: #fff;
            border: 1px solid rgba(16, 185, 129, 0.15);
            box-shadow: 0 14px 28px rgba(2, 44, 34, 0.06);
          }
          .games-page .progress-panel .pp-title {
            font-size: 12px;
            font-weight: 800;
            letter-spacing: 1.5px;
            color: var(--c-green-700);
            text-transform: uppercase;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 14px;
          }
          .games-page .pp-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
          }
          @media (min-width: 1024px) {
            .games-page .pp-grid { grid-template-columns: repeat(4, 1fr); }
          }
          .games-page .pp-tile {
            padding: 14px 16px;
            border-radius: 16px;
            background: var(--c-green-50);
            border: 1px solid rgba(16, 185, 129, 0.12);
          }
          .games-page .pp-tile .pp-label {
            font-size: 10px;
            font-weight: 800;
            letter-spacing: 1.2px;
            text-transform: uppercase;
            color: var(--c-green-700);
            display: inline-flex;
            align-items: center;
            gap: 6px;
          }
          .games-page .pp-tile .pp-value {
            font-size: 20px;
            font-weight: 900;
            color: var(--text-main);
            margin-top: 4px;
            letter-spacing: -0.3px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .games-page .pp-tile .pp-sub {
            font-size: 11px;
            color: var(--text-soft);
            margin-top: 2px;
          }

          /* ───────── GAME LIBRARY ───────── */
          .games-page .library-header {
            margin-top: 14px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            flex-wrap: wrap;
            margin-bottom: 18px;
          }
          .games-page .library-title {
            font-size: 22px;
            font-weight: 900;
            color: var(--text-main);
            display: inline-flex;
            align-items: center;
            gap: 10px;
            letter-spacing: -0.5px;
          }
          .games-page .library-title .lt-icon {
            width: 36px;
            height: 36px;
            border-radius: 12px;
            background: linear-gradient(135deg, #10b981, #047857);
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
            box-shadow: 0 10px 20px rgba(16, 185, 129, 0.35);
          }
          .games-page .library-count {
            font-size: 14px;
            font-weight: 700;
            color: var(--text-light);
          }


          .games-page .game-grid {
            display: grid;
            grid-template-columns: repeat(1, 1fr);
            gap: 24px;
          }
          @media (min-width: 768px) {
            .games-page .game-grid { grid-template-columns: repeat(2, 1fr); }
          }
          @media (min-width: 1100px) {
            .games-page .game-grid { grid-template-columns: repeat(3, 1fr); }
          }

          /* 卡册卡（对齐 album-card） */
          .games-page .game-card {
            position: relative;
            display: flex;
            flex-direction: column;
            border-radius: 32px;
            overflow: hidden;
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0.68));
            backdrop-filter: blur(30px);
            border: 1px solid rgba(255, 255, 255, 0.95);
            box-shadow: 0 24px 48px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255, 255, 255, 1);
            text-decoration: none;
            color: inherit;
            transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.35s cubic-bezier(0.16, 1, 0.3, 1);
            cursor: pointer;
          }
          .games-page .game-card:hover {
            transform: translateY(-8px);
            box-shadow: 0 36px 72px rgba(15, 23, 42, 0.12);
          }
          .games-page .game-card .gc-cover {
            position: relative;
            aspect-ratio: 16 / 11;
            overflow: hidden;
            background: var(--c-green-50);
          }
          .games-page .game-card .gc-image {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
            transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
          }
          .games-page .game-card:hover .gc-image {
            transform: scale(1.06);
          }
          .games-page .game-card .gc-cover::after {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(180deg, rgba(0, 0, 0, 0) 60%, rgba(0, 0, 0, 0.18));
            pointer-events: none;
          }

          .games-page .game-card .gc-mascot {
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            width: 52%;
            height: 68%;
            object-fit: contain;
            pointer-events: none;
            filter: drop-shadow(0 14px 22px rgba(0, 0, 0, 0.28));
            transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
            z-index: 1;
          }
          .games-page .game-card:hover .gc-mascot {
            transform: translate(-50%, -52%) scale(1.06);
          }
          @media (max-width: 768px) {
            .games-page .game-card .gc-mascot { width: 48%; height: 62%; }
          }

          .games-page .game-card .gc-body {
            padding: 22px 24px 24px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            flex: 1;
          }
          .games-page .game-card .gc-row {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
          }
          .games-page .game-card .gc-name {
            font-size: 20px;
            font-weight: 900;
            color: #0f172a;
            letter-spacing: -0.4px;
            margin: 0;
            transition: color 0.2s;
          }
          .games-page .game-card:hover .gc-name { color: var(--c-green-700); }
          .games-page .game-card .gc-best {
            text-align: right;
            flex-shrink: 0;
          }
          .games-page .game-card .gc-best-label {
            font-size: 9px;
            font-weight: 800;
            color: var(--text-light);
            letter-spacing: 0.8px;
            text-transform: uppercase;
          }
          .games-page .game-card .gc-best-value {
            font-size: 18px;
            font-weight: 900;
            color: var(--c-green-700);
            font-variant-numeric: tabular-nums;
            letter-spacing: -0.3px;
          }
          .games-page .game-card .gc-desc {
            font-size: 13.5px;
            color: var(--text-soft);
            line-height: 1.55;
            margin: 0;
            overflow: hidden;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            min-height: 42px;
          }

          .games-page .game-card .gc-reward {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding-top: 14px;
            border-top: 1px dashed var(--c-green-100);
            margin-top: auto;
          }
          .games-page .game-card .gc-reward-text {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            font-weight: 700;
            color: var(--c-green-700);
          }
          .games-page .game-card .gc-reward-text .gc-star {
            width: 18px;
            height: 18px;
            border-radius: 50%;
            background: linear-gradient(135deg, #fbbf24, #f59e0b);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: #fff;
            font-size: 10px;
            box-shadow: 0 4px 8px rgba(245, 158, 11, 0.4);
          }
          .games-page .game-card .gc-cta {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-size: 13px;
            font-weight: 800;
            color: var(--c-green);
          }

          /* ───────── RESPONSIVE ───────── */
          @media (max-width: 1024px) {
            .games-page .lucky-hero { padding: 36px 32px; border-radius: 28px; }
            .games-page .hero-title { font-size: 40px; }
            .games-page .float-cards { width: 180px; }
          }
          @media (max-width: 768px) {
            .games-page .lucky-hero { padding: 28px 22px; border-radius: 24px; }
            .games-page .hero-title { font-size: 32px; letter-spacing: -1px; }
            .games-page .float-cards { display: none; }
            .games-page .hero-points-card { padding: 14px 18px; }
            .games-page .hpc-value { font-size: 24px; }
          }
          @media (max-width: 480px) {
            .games-page .lucky-hero { padding: 22px 16px; border-radius: 20px; }
            .games-page .hero-badge { font-size: 11px; padding: 5px 11px; }
            .games-page .hero-title { font-size: 26px; }
            .games-page .stat-card .sc-value { font-size: 18px; }
          }
        `}</style>
    </div>
  );
}

// ══════════════════════════════════════════════════
// StatStrip (4 colored themes)
// ══════════════════════════════════════════════════

function StatStrip({
  profile,
  loading,
  mostWinsName,
}: {
  profile: ProfileData | null;
  loading: boolean;
  mostWinsName: string;
}) {
  const mostWinsValue = loading
    ? '…'
    : profile?.mostWinsGame
      ? mostWinsName
      : '—';

  const stats: Array<{
    label: string;
    value: string;
    Icon: LucideIcon;
    tone: 'amber' | 'emerald' | 'teal' | 'violet';
  }> = [
    {
      label: '总游戏数',
      value: loading ? '…' : `${(profile?.totalGamesPlayed ?? 0).toLocaleString()} 局`,
      Icon: Layers,
      tone: 'amber',
    },
    {
      label: '今日游戏',
      value: loading ? '…' : `${profile?.dailyStats.gamesPlayed ?? 0} 局`,
      Icon: Gamepad2,
      tone: 'emerald',
    },
    {
      label: '今日积分',
      value: loading ? '…' : `+${profile?.dailyStats.pointsEarned ?? 0}`,
      Icon: TrendingUp,
      tone: 'teal',
    },
    {
      label: '胜利最多',
      value: mostWinsValue,
      Icon: Trophy,
      tone: 'violet',
    },
  ];

  return (
    <section className="stat-strip">
      {stats.map((s) => (
        <div key={s.label} className={`stat-card t-${s.tone}`}>
          <div className="sc-icon">
            <s.Icon size={20} />
          </div>
          <div className="sc-info">
            <div className="sc-label">{s.label}</div>
            <div className="sc-value">{s.value}</div>
          </div>
        </div>
      ))}
    </section>
  );
}

// ══════════════════════════════════════════════════
// ProgressPanel
// ══════════════════════════════════════════════════

function ProgressPanel({
  profile,
  loading,
  favoriteName,
  bestStreakName,
  peakGameName,
}: {
  profile: ProfileData | null;
  loading: boolean;
  favoriteName: string;
  bestStreakName: string;
  peakGameName: string;
}) {
  const winRatePct = profile ? Math.round(profile.winRate * 100) : 0;
  const bestStreak = profile?.bestStreak ?? 0;
  const peakScore = profile?.peakScore ?? 0;

  const tiles: Array<{ label: string; value: string; sub: string; Icon: LucideIcon }> = [
    { label: '胜率', value: loading ? '…' : `${winRatePct}%`, sub: '可计胜负的游戏', Icon: Crown },
    {
      label: '最高分',
      value: loading ? '…' : peakScore.toLocaleString(),
      sub: loading ? '' : peakScore > 0 ? peakGameName : '暂无记录',
      Icon: Star,
    },
    { label: '最爱游戏', value: loading ? '…' : favoriteName, sub: '玩得最多', Icon: Heart },
    {
      label: '连胜最多',
      value: loading ? '…' : bestStreakName,
      sub: loading ? '' : bestStreak > 0 ? `${bestStreak} 连胜` : '暂无连胜',
      Icon: Award,
    },
  ];

  return (
    <section className="progress-panel">
      <div className="pp-title">
        <Target size={12} />
        我的进度
      </div>
      <div className="pp-grid">
        {tiles.map((t) => (
          <div key={t.label} className="pp-tile">
            <div className="pp-label">
              <t.Icon size={11} />
              {t.label}
            </div>
            <div className="pp-value" title={t.value}>{t.value}</div>
            {t.sub && <div className="pp-sub">{t.sub}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════════
// GameLibrary
// ══════════════════════════════════════════════════

function GameLibrary({
  games,
  profile,
}: {
  games: readonly GameMeta[];
  profile: ProfileData | null;
}) {
  return (
    <>
      <div className="library-header">
        <h2 className="library-title">
          <span className="lt-icon">
            <Gamepad2 size={20} />
          </span>
          全部游戏
          <span className="library-count">· {games.length}</span>
        </h2>
      </div>

      <div className="game-grid">
        {games.map((g, index) => (
          <GameCard
            key={g.key}
            game={g}
            progress={profile?.perGame[g.key]}
            eager={index < 2}
          />
        ))}
      </div>
    </>
  );
}

function GameCard({
  game,
  progress,
  eager,
}: {
  game: GameMeta;
  progress: GameProgress | undefined;
  eager: boolean;
}) {
  const bestScore = progress?.bestScore ?? 0;
  const totalPoints = progress?.totalPointsEarned ?? 0;

  return (
    <Link href={game.href} className="game-card">
      {/* 封面 */}
      <div className="gc-cover">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={game.image}
          alt={`${game.name} 封面`}
          className="gc-image"
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={eager ? "high" : "auto"}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={game.mascot}
          alt=""
          aria-hidden
          className="gc-mascot"
          loading="lazy"
          decoding="async"
        />
      </div>

      {/* 信息体 */}
      <div className="gc-body">
        <div className="gc-row">
          <h3 className="gc-name">{game.name}</h3>
          <div className="gc-best">
            <div className="gc-best-label">你的最高</div>
            <div className="gc-best-value">{bestScore.toLocaleString()}</div>
          </div>
        </div>
        <p className="gc-desc">{game.description}</p>

        {/* 完成奖励 + CTA */}
        <div className="gc-reward">
          <div className="gc-reward-text">
            <span className="gc-star">
              <Star size={10} fill="currentColor" strokeWidth={0} />
            </span>
            已获 {totalPoints.toLocaleString()} 积分
          </div>
          <div className="gc-cta">
            开始游戏
            <ChevronRight size={14} />
          </div>
        </div>
      </div>
    </Link>
  );
}

// ══════════════════════════════════════════════════
