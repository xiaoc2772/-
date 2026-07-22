'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BarChart3,
  BookOpen,
  Bomb,
  CalendarDays,
  Clock,
  Crown,
  Grid3X3,
  Home,
  Loader2,
  Music,
  Recycle,
  RefreshCw,
  Shield,
  Sparkles,
  Star,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import type { PublicAchievement } from '@/lib/profile-achievements';

type GamePeriod = 'daily' | 'weekly' | 'monthly';
type SimplePeriod = 'all' | 'monthly';
type LotteryPeriod = 'daily' | 'weekly' | 'monthly';
type EcoPeriod = 'daily' | 'weekly' | 'monthly';

type SupportedGame = 'linkgame' | 'match3' | 'memory' | 'whack_mole' | 'roguelite' | 'minesweeper' | 'game_2048' | 'lucky_td' | 'piano-tiles';

interface GameOverallEntry {
  rank: number;
  userId: number;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  equippedAchievement?: PublicAchievement | null;
  totalScore: number;
  totalPoints: number;
  gamesPlayed: number;
}

interface GameEntry {
  rank: number;
  userId: number;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  equippedAchievement?: PublicAchievement | null;
  totalScore: number;
  totalPoints: number;
  bestScore: number;
  /** 钢琴块标准表现，10000 基点 = 100.00%。 */
  bestPerformance?: number;
  gamesPlayed: number;
}

interface GameDifficultyOption {
  value: string;
  label: string;
}

interface GameRankingGroup {
  gameType: SupportedGame;
  leaderboard: GameEntry[];
  selectedDifficulty?: string | null;
  difficultyOptions?: GameDifficultyOption[];
  leaderboardsByDifficulty?: Record<string, GameEntry[]>;
}

interface GamesRankingData {
  period: GamePeriod;
  overall: GameOverallEntry[];
  games: GameRankingGroup[];
}

interface PointsEntry {
  rank: number;
  userId: number;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  equippedAchievement?: PublicAchievement | null;
  points: number;
}

interface PointsRankingData {
  period: SimplePeriod;
  leaderboard: PointsEntry[];
}

interface CheckinEntry {
  rank: number;
  userId: number;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  equippedAchievement?: PublicAchievement | null;
  streak: number;
}

interface CheckinRankingData {
  period: SimplePeriod;
  leaderboard: CheckinEntry[];
}

interface EcoRankingEntry {
  rank: number;
  userId: number;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  equippedAchievement?: PublicAchievement | null;
  trashCleared: number;
}

interface EcoRankingData {
  period: EcoPeriod;
  periodKey: string;
  totalParticipants: number;
  leaderboard: EcoRankingEntry[];
}

interface LotteryRankingEntry {
  rank: number;
  userId: string;
  username: string;
  equippedAchievement?: PublicAchievement | null;
  totalValue: number;
  bestPrize: string;
  count: number;
}

interface LotteryRankingData {
  period: LotteryPeriod;
  periodKey: string;
  totalParticipants: number;
  ranking: LotteryRankingEntry[];
}

interface MonthlyPeakEntry {
  rank: number;
  userId: number;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  equippedAchievement?: PublicAchievement | null;
  points: number;
}

interface MonthlyPeakItem {
  monthKey: string;
  monthLabel: string;
  startAt: number;
  endAt: number;
  leaderboard: MonthlyPeakEntry[];
}

interface MonthlyPeakHistoryData {
  generatedAt: number;
  months: MonthlyPeakItem[];
  topLimit: number;
}

interface AuthMeUser {
  id: number;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

interface NavProfile {
  displayName: string | null;
  avatarUrl: string | null;
  equippedAchievement: PublicAchievement | null;
}

interface ProfileUpdatedDetail {
  displayName?: string | null;
  avatarUrl?: string | null;
  equippedAchievement?: PublicAchievement | null;
}

const GAME_LABEL: Record<SupportedGame, string> = {
  linkgame: '连连看',
  match3: '消消乐',
  memory: '记忆翻牌',
  whack_mole: '打地鼠',
  roguelite: '星尘迷阵',
  minesweeper: '扫雷',
  game_2048: '2048',
  lucky_td: '幸运塔防',
  'piano-tiles': '钢琴块',
};

const GAME_CAPTION: Record<SupportedGame, string> = {
  linkgame: 'PAIR LINK',
  match3: 'MATCH 3',
  memory: 'MEMORY',
  whack_mole: 'WHACK MOLE',
  roguelite: 'STARDUST ROGUE',
  minesweeper: 'MINESWEEPER',
  game_2048: '2048',
  lucky_td: 'LUCKY TOWER DEFENSE',
  'piano-tiles': 'PIANO TILES',
};

const GAME_THEME: Record<SupportedGame, string> = {
  linkgame: 't-link',
  match3: 't-eliminate',
  memory: 't-memory',
  whack_mole: 't-whack',
  roguelite: 't-roguelite',
  minesweeper: 't-mines',
  game_2048: 't-2048',
  lucky_td: 't-lucky-td',
  'piano-tiles': 't-piano-tiles',
};

const GAME_METRIC_LABEL: Record<SupportedGame, string> = {
  linkgame: '最佳单局',
  match3: '最佳单局',
  memory: '最佳单局',
  whack_mole: '最佳单局',
  roguelite: '最佳单局',
  minesweeper: '最佳单局',
  game_2048: '最佳单局',
  lucky_td: '最佳单局',
  'piano-tiles': '标准表现',
};

const GAME_UNIT: Record<SupportedGame, string> = {
  linkgame: '分',
  match3: '分',
  memory: '分',
  whack_mole: '分',
  roguelite: '分',
  minesweeper: '分',
  game_2048: '分',
  lucky_td: '分',
  'piano-tiles': '分',
};

const AVATAR_VARIANT_COUNT = 5;
const MINI_AVATAR_VARIANT_COUNT = 6;

function getAvatarVariant(userId: number, total: number): number {
  if (total <= 0) return 1;
  return ((userId % total) + total) % total + 1;
}

function getInitial(name: string): string {
  return (name?.[0] ?? '?').toUpperCase();
}

interface DisplayableUser {
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  equippedAchievement?: PublicAchievement | null;
}

// 与个人主页保持一致：优先使用自定义昵称，缺省回退到账号名
function resolveDisplayName(user: DisplayableUser): string {
  return user.displayName && user.displayName.length > 0 ? user.displayName : user.username;
}

// 头像渲染：自定义头像优先以 <img> 呈现，未设置时回退到首字母
function renderAvatarContent(user: DisplayableUser): ReactNode {
  if (user.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={user.avatarUrl} alt={resolveDisplayName(user)} className="rk-avatar-img" />
    );
  }
  return getInitial(resolveDisplayName(user));
}

function AchievementPill({ achievement, compact = false }: { achievement?: PublicAchievement | null; compact?: boolean }) {
  if (!achievement) return null;
  return (
    <span className={`rk-achievement-pill ${compact ? 'compact' : ''}`} title={achievement.desc}>
      <span aria-hidden>{achievement.emoji}</span>
      {achievement.name}
    </span>
  );
}

function formatNumber(value: number): string {
  return value.toLocaleString('zh-CN');
}

function formatGameMetric(gameType: SupportedGame, entry: GameEntry): { value: string; unit: string; title?: string } {
  if (gameType === 'piano-tiles' && entry.bestPerformance !== undefined) {
    const percentage = entry.bestPerformance / 100;
    return {
      value: percentage.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      unit: '%',
      title: '标准表现：经典满分一圈为 100%；冲刺模式以基础速度下 60 秒参考满分为 100%。',
    };
  }
  return { value: formatNumber(entry.bestScore ?? entry.totalScore), unit: GAME_UNIT[gameType] };
}

function getNextMonthStart(now: Date): Date {
  const result = new Date(now);
  result.setMonth(result.getMonth() + 1, 1);
  result.setHours(0, 0, 0, 0);
  return result;
}

interface CountdownState {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function diffToCountdown(deadline: Date, now: Date): CountdownState {
  const ms = Math.max(0, deadline.getTime() - now.getTime());
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return { days, hours, minutes, seconds };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

const RANKING_RULES = [
  {
    title: '积分总榜',
    tag: '总积分 · 本月净增',
    tone: 'purple',
    summary:
      '衡量长期累积实力的核心榜单。「全部」榜直接读取当前积分余额；「本月」榜仅累加本月正向收入，消费与扣减完全不计入。',
    sections: [
      {
        label: '统计口径',
        items: [
          '【全部榜】直接使用账号当前的积分余额（含历史所有结余），实时反映你"能花的积分"。',
          '【本月榜】仅累加本月 1 日 00:00 至当前时刻的正向积分（amount > 0），消费、兑换、扣减不参与计算。',
          '管理员手动增加的积分不计入本月净增；其他实际入账来源如游戏奖励、签到奖励、抽奖奖励、福利发放、活动补偿等正常计入。',
        ],
      },
      {
        label: '排序与展示',
        items: [
          '按积分从高到低降序排列，每个榜单只展示前 10 名。',
          '同分时按用户 ID 升序作为稳定回退，避免名次跳动。',
          '昵称、头像、装备成就优先取「个人主页」中的展示设置，未设置时回退到登录名。',
        ],
      },
      {
        label: '上榜条件',
        items: [
          '全部榜：当前积分余额必须严格大于 0。',
          '本月榜：本月至少存在 1 笔正向积分入账记录。',
          '账号被封禁或处于异常状态时，对应记录不会被纳入榜单。',
        ],
      },
    ],
  },
  {
    title: '历史月榜巅峰',
    tag: '近 12 个已结算月份',
    tone: 'orange',
    summary:
      '回顾过去 12 个自然月的月度冠军们。每月独立结算并归档，可通过月份下拉框查看任意已完结月份的前 10 名。',
    sections: [
      {
        label: '统计窗口',
        items: [
          '展示当前月份之前最多 12 个已结束自然月的数据，超过 12 个月的更早记录不再保留。',
          '每个月份的统计窗口为「该月 1 日 00:00 」至「该月最后一刻 23:59:59」（服务器 UTC 时间）。',
          '当月数据不会出现在历史榜，请到积分总榜的「本月」标签查看。',
        ],
      },
      {
        label: '计算方式',
        items: [
          '排名依据为该自然月内累计的正向积分总和，与积分总榜「本月」榜的口径一致，管理员手动增加的积分不计入。',
          '不计算任何消费、兑换、退还或扣减；仅统计实际入账的正向积分。',
          '历史榜不展示游戏局数等附加信息，只显示该月净增积分与最终排名。',
        ],
      },
      {
        label: '上榜条件',
        items: [
          '所选月份内至少获得过 1 次正向积分入账。',
          '每月独立排名，同一玩家可在不同月份同时上榜。',
        ],
      },
    ],
  },
  {
    title: '签到榜',
    tag: '累计连续 · 本月连续',
    tone: 'blue',
    summary:
      '展示玩家的签到坚持度。「累计连续」记录当前仍生效的连续天数；「本月连续」只计算本月范围内的连续表现。',
    sections: [
      {
        label: '统计口径',
        items: [
          '【累计连续】从最近一次签到向前回溯，连续未中断的天数总和；中断后会从 0 重新开始。',
          '【本月连续】仅统计本月范围内的连续签到天数，跨月时本月榜重置。',
          '签到状态以签到系统的实际记录为准（包含补签是否生效、是否触发奖励等）。',
        ],
      },
      {
        label: '中断与补救',
        items: [
          '漏签会立即中断「累计连续」天数；次日恢复签到将从 1 重新计数。',
          '补签卡是否能恢复连续天数，以签到系统当时的规则与库存为准；未成功补签即视为中断。',
          '同一日重复签到不会增加天数，只会累计当日次数。',
        ],
      },
      {
        label: '排序与上榜',
        items: [
          '按连续天数从高到低排序，每个榜单展示前 10 名。',
          '同天数时按最近一次签到时间倒序（更晚签到的排前面）。',
          '上榜条件：至少存在 1 天有效签到记录。',
        ],
      },
    ],
  },
  {
    title: '环保排行榜',
    tag: '日榜 · 周榜 · 月榜',
    tone: 'green',
    summary:
      '记录玩家在环保行动中实际回收的普通垃圾数量，奖品拾取不计入该榜单。',
    sections: [
      {
        label: '周期定义',
        items: [
          '【日榜】按中国时间当天 00:00 起统计。',
          '【周榜】按中国时间当前自然周（周一 00:00 起）统计。',
          '【月榜】按中国时间当前自然月（1 日 00:00 起）统计。',
        ],
      },
      {
        label: '计算方式',
        items: [
          '只统计普通垃圾的实际回收数量，奖杯、项链、金币、钻石、照片不计入。',
          '手动拖入垃圾桶和自动回收机器人成功回收的普通垃圾都会计入。',
          '同数量时按用户 ID 升序稳定排序。',
        ],
      },
      {
        label: '上榜条件',
        items: [
          '所选周期内至少回收过 1 个普通垃圾。',
          '排行榜数据由环保行动服务端结算时写入，页面刷新不会凭空增加数量。',
        ],
      },
    ],
  },
  {
    title: '幸运抽奖榜',
    tag: '日榜 · 周榜 · 月榜',
    tone: 'amber',
    summary:
      '记录玩家在抽奖活动中的累计收益与高光时刻。按周期内抽中奖品的累计积分价值排序，同时展示抽奖次数与最佳奖品。',
    sections: [
      {
        label: '周期定义',
        items: [
          '【日榜】统计当天 00:00 至 23:59 的抽奖记录，每日凌晨自然切换。',
          '【周榜】统计当前自然周（周一 00:00 至周日 23:59）的抽奖记录。',
          '【月榜】统计当前自然月（1 日 00:00 至月末 23:59）的抽奖记录。',
        ],
      },
      {
        label: '计算方式',
        items: [
          '排序依据为周期内所有中奖奖品的「积分价值」累计之和，未中奖或安慰奖按其实际价值计入。',
          '同时记录该周期内的抽奖总次数，作为辅助参考。',
          '「最佳奖品」展示该玩家在周期内单次抽中的最高价值奖品，用于辅助识别高光时刻。',
        ],
      },
      {
        label: '上榜条件',
        items: [
          '所选周期内至少完成过 1 次有效抽奖且产生了榜单记录。',
          '被风控判定异常的抽奖记录（如刷奖、回滚）不会进入榜单。',
          '每个周期独立结算，跨周期不互通。',
        ],
      },
    ],
  },
  {
    title: '分游戏排行榜',
    tag: '各游戏独立排名',
    tone: 'pink',
    summary:
      '为每款游戏单独维护一份排行榜，按所选周期内的最好单局成绩排序；有难度或地图分类的游戏可在卡片右上角切换。',
    sections: [
      {
        label: '收录游戏',
        items: [
          '当前收录：连连看、消消乐、记忆翻牌、打地鼠、星尘迷阵（肉鸽）、扫雷、2048、幸运塔防、钢琴块。',
          '每款游戏独立结算与排名，互不影响。',
          '后续上线的新游戏会在评估稳定后接入。',
        ],
      },
      {
        label: '周期与计算',
        items: [
          '可在日榜 / 周榜 / 月榜之间切换，周期定义同抽奖榜。',
          '普通游戏按周期内最高单局得分排序；钢琴块按标准表现排序，避免不同歌曲长度和密度造成分数偏差。',
          '连连看、记忆翻牌、打地鼠、扫雷支持「全部难度 / 简单 / 普通 / 困难」切换；幸运塔防支持地图筛选；钢琴块支持经典/冲刺 × 1–5 星及全星级榜。',
          '钢琴块标准表现中，经典满分一圈为 100%；冲刺模式以基础速度下 60 秒参考满分为 100%，超过 100% 表示完成更多等效进度。',
          '最好单局同分时，优先比较本周期获得积分，再按局数较少者优先，仍相同时按用户 ID 升序。',
        ],
      },
      {
        label: '入榜规则',
        items: [
          '只统计「有效完成并写入战绩」的对局；中途异常退出、取消、未结算的记录不计入。',
          '由风控系统标记为异常的局（如外挂、刷分）将被剔除，并可能影响账号其他榜单。',
          '上榜条件：所选周期内至少有 1 条有效游戏战绩。',
        ],
      },
    ],
  },
] as const;

const RANKING_RULE_NOTES = [
  '所有榜单均需登录后才能查看完整数据，未登录用户只能看到匿名摘要。',
  '展示的昵称、头像与成就来源于「个人主页」的公开展示设置；如希望隐藏真实信息，可在主页中关闭对应字段。',
  '榜单数据存在最长 30 秒的服务端缓存，刷新或切换标签后可能有数秒延迟，属于正常现象。',
  '同分或同值时使用稳定排序（按用户 ID 升序回退），确保短时间内多次刷新不会出现名次抖动。',
  '若你的某条记录被风控系统判定为异常（如刷分、外挂、回滚）或未完成结算，对应积分、抽奖、游戏数据均不会计入排行榜。',
  '榜单只展示每个分类的前 10 名；未上榜不代表数据丢失，所有积分与战绩仍会完整保留在个人主页中。',
  '排行榜每月 1 日 00:00（服务器时间）进行月度归档与结算，结算期间可能出现短暂的数据切换。',
] as const;

export default function RankingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [me, setMe] = useState<AuthMeUser | null>(null);
  const [myProfile, setMyProfile] = useState<NavProfile | null>(null);

  const [gamePeriod, setGamePeriod] = useState<GamePeriod>('daily');
  const [pointsPeriod, setPointsPeriod] = useState<SimplePeriod>('all');
  const [checkinPeriod, setCheckinPeriod] = useState<SimplePeriod>('all');
  const [lotteryPeriod, setLotteryPeriod] = useState<LotteryPeriod>('daily');
  const [ecoPeriod, setEcoPeriod] = useState<EcoPeriod>('daily');
  const [peakMonthKey, setPeakMonthKey] = useState<string>('');

  const [gamesData, setGamesData] = useState<GamesRankingData | null>(null);
  const [pointsData, setPointsData] = useState<PointsRankingData | null>(null);
  const [checkinData, setCheckinData] = useState<CheckinRankingData | null>(null);
  const [historyData, setHistoryData] = useState<MonthlyPeakHistoryData | null>(null);
  const [lotteryData, setLotteryData] = useState<LotteryRankingData | null>(null);
  const [ecoData, setEcoData] = useState<EcoRankingData | null>(null);

  const [now, setNow] = useState<Date>(() => new Date());
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 倒计时秒级 ticker
  useEffect(() => {
    tickerRef.current = setInterval(() => setNow(new Date()), 1000);
    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!rulesOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setRulesOpen(false);
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [rulesOpen]);

  const fetchRankings = useCallback(
    async (silent = false) => {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const meRes = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!meRes.ok) {
          router.push('/login?redirect=/rankings');
          return;
        }
        const meData = await meRes.json();
        if (!meData.success) {
          router.push('/login?redirect=/rankings');
          return;
        }
        setMe(meData.user as AuthMeUser);

        const [gamesRes, pointsRes, checkinRes, historyRes, profileRes, lotteryRes, ecoRes] = await Promise.all([
          fetch(`/api/rankings/games?period=${gamePeriod}&limit=10`),
          fetch(`/api/rankings/points?period=${pointsPeriod}&limit=10`),
          fetch(`/api/rankings/checkin-streak?period=${checkinPeriod}&limit=10`),
          fetch('/api/rankings/history?mode=monthly-peaks&months=12&limit=10'),
          fetch('/api/profile/settings', { cache: 'no-store' }),
          fetch(`/api/rankings/lottery?period=${lotteryPeriod}&limit=10`),
          fetch(`/api/rankings/eco?period=${ecoPeriod}&limit=10`),
        ]);

        const [gamesJson, pointsJson, checkinJson, historyJson, profileJson, lotteryJson, ecoJson] = await Promise.all([
          gamesRes.json(),
          pointsRes.json(),
          checkinRes.json(),
          historyRes.json(),
          profileRes.json().catch(() => ({ success: false })),
          lotteryRes.json().catch(() => ({ success: false })),
          ecoRes.json().catch(() => ({ success: false })),
        ]);

        if (!gamesRes.ok || !gamesJson.success) {
          throw new Error(gamesJson.message || '获取游戏排行榜失败');
        }
        if (!pointsRes.ok || !pointsJson.success) {
          throw new Error(pointsJson.message || '获取积分排行榜失败');
        }
        if (!checkinRes.ok || !checkinJson.success) {
          throw new Error(checkinJson.message || '获取签到排行榜失败');
        }
        if (!historyRes.ok || !historyJson.success) {
          throw new Error(historyJson.message || '获取周期榜历史失败');
        }

        setGamesData(gamesJson.data as GamesRankingData);
        setPointsData(pointsJson.data as PointsRankingData);
        setCheckinData(checkinJson.data as CheckinRankingData);
        setHistoryData(historyJson.data as MonthlyPeakHistoryData);
        // 幸运抽奖榜：失败时置空，不阻断主榜
        if (lotteryRes.ok && lotteryJson?.success) {
          const lotteryPayload = lotteryJson.data ?? lotteryJson;
          setLotteryData(lotteryPayload as LotteryRankingData);
        } else {
          setLotteryData(null);
        }
        // 环保榜：失败时置空，不阻断其他排行榜
        if (ecoRes.ok && ecoJson?.success) {
          setEcoData(ecoJson.data as EcoRankingData);
        } else {
          setEcoData(null);
        }
        // profile/settings 失败时不阻断排行榜展示，仅退化为账号默认昵称/首字母
        if (profileRes.ok && profileJson?.success && profileJson.data) {
          setMyProfile({
            displayName: profileJson.data.displayName ?? null,
            avatarUrl: profileJson.data.avatarUrl ?? null,
            equippedAchievement: profileJson.data.equippedAchievement ?? null,
          });
        } else {
          setMyProfile(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '获取排行榜失败');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router, gamePeriod, pointsPeriod, checkinPeriod, lotteryPeriod, ecoPeriod]
  );

  useEffect(() => {
    void fetchRankings();
  }, [fetchRankings]);

  useEffect(() => {
    const handleProfileUpdated = (event: Event) => {
      const detail = (event as CustomEvent<ProfileUpdatedDetail>).detail;
      if (!detail) return;

      setMyProfile((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          displayName: Object.prototype.hasOwnProperty.call(detail, 'displayName')
            ? detail.displayName ?? null
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
    return () => window.removeEventListener('lucky:profile-updated', handleProfileUpdated);
  }, []);

  useEffect(() => {
    const months = historyData?.months ?? [];
    if (months.length === 0) {
      if (peakMonthKey) setPeakMonthKey('');
      return;
    }
    if (!peakMonthKey || !months.some((month) => month.monthKey === peakMonthKey)) {
      setPeakMonthKey(months[0].monthKey);
    }
  }, [historyData, peakMonthKey]);

  const triggerRefresh = () => {
    if (refreshing) return;
    setRefreshSpin(true);
    void fetchRankings(true).finally(() => {
      setTimeout(() => setRefreshSpin(false), 600);
    });
  };

  // 派生：领奖台 Top 3 用积分总榜数据
  const podium = useMemo(() => {
    return (pointsData?.leaderboard ?? []).slice(0, 3);
  }, [pointsData]);

  // 派生：当前用户在积分榜中的位置
  const myPointsEntry = useMemo(() => {
    if (!me || !pointsData) return null;
    return pointsData.leaderboard.find((entry) => entry.userId === me.id) ?? null;
  }, [me, pointsData]);

  // 派生：积分榜参与人数
  const totalPlayers = pointsData?.leaderboard.length ?? 0;

  // 派生：榜首积分
  const topPoints = pointsData?.leaderboard[0]?.points ?? 0;

  // 派生：连续签到榜首
  const topStreak = checkinData?.leaderboard[0]?.streak ?? 0;

  // 派生：当前用户与第二名差距 / 距下一名差距
  const myDelta = useMemo(() => {
    if (!myPointsEntry || !pointsData) return null;
    const myRank = myPointsEntry.rank;
    const list = pointsData.leaderboard;
    if (myRank === 1 && list.length >= 2) {
      const second = list[1];
      return { type: 'lead' as const, value: myPointsEntry.points - second.points };
    }
    const above = list.find((e) => e.rank === myRank - 1);
    if (above) {
      return { type: 'gap' as const, value: above.points - myPointsEntry.points };
    }
    return null;
  }, [myPointsEntry, pointsData]);

  // 派生：下个里程碑（下一个 1000 倍数；最低 1000）
  const nextMilestone = useMemo(() => {
    const points = myPointsEntry?.points ?? 0;
    const next = Math.max(1000, Math.ceil((points + 1) / 1000) * 1000);
    const progress = points <= 0 ? 0 : Math.min(100, (points / next) * 100);
    return { next, progress };
  }, [myPointsEntry]);

  const selectedPeakMonth = useMemo(() => {
    const months = historyData?.months ?? [];
    return months.find((month) => month.monthKey === peakMonthKey) ?? months[0] ?? null;
  }, [historyData, peakMonthKey]);

  // 倒计时到下个月 1 日 00:00，即本月榜单结算点
  const countdown = useMemo<CountdownState>(() => {
    const deadline = getNextMonthStart(now);
    return diffToCountdown(deadline, now);
  }, [now]);

  // 当前月份（页面显示用）
  const currentMonthLabel = useMemo(() => {
    const m = now.getMonth() + 1;
    return `${now.getFullYear()} 年 ${m} 月`;
  }, [now]);

  // 顶部胶囊优先使用个人主页设置的自定义昵称/头像；缺省回退到账号信息
  const username = myProfile?.displayName || me?.displayName || me?.username || '';
  const meAvatarUrl = myProfile?.avatarUrl ?? null;
  const meInitial = getInitial(username || 'U');
  const navAchievement = myProfile?.equippedAchievement ?? null;
  const navRoleLabel = me?.isAdmin ? '管理员' : '用户';

  if (loading) {
    return (
      <div className="rk-loading">
        <Loader2 className="rk-spin" />
        <style jsx>{`
          .rk-loading {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #f8fafc;
          }
          :global(.rk-loading .rk-spin) {
            width: 32px;
            height: 32px;
            color: #a855f7;
            animation: rk-load-spin 1s linear infinite;
          }
          @keyframes rk-load-spin {
            from { transform: rotate(0); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="rk-page">
      <div className="mesh-bg" />

      {/* 顶部导航栏：仅保留 品牌(排行榜) + 首页按钮 + 用户胶囊 */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">
            <Trophy />
          </div>
          排行榜
        </div>

        <div className="topbar-right">
          <button
            type="button"
            className="btn-icon rules-trigger"
            onClick={() => setRulesOpen(true)}
            aria-label="查看排行榜规则"
            title="排行榜规则"
          >
            <BookOpen />
          </button>
          <Link href="/" className="btn-icon" aria-label="返回首页" title="返回首页">
            <Home />
          </Link>
          <Link href="/profile" className="user-profile">
            <div className="avatar">
              {meAvatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={meAvatarUrl} alt={username || 'avatar'} className="rk-avatar-img" />
              ) : (
                meInitial
              )}
            </div>
            <div className="user-info">
              <h4>{username}</h4>
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

      {rulesOpen && (
        <div className="rules-overlay" onMouseDown={() => setRulesOpen(false)}>
          <section
            className="rules-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ranking-rules-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="rules-hero">
              <div className="rules-hero-copy">
                <div className="rules-kicker">
                  <BookOpen />
                  排行榜规则手册
                </div>
                <h2 id="ranking-rules-title">
                  上榜条件
                  <span>与结算口径详解</span>
                </h2>
                <p>
                  5 大榜单各自独立结算、互不影响；积分收入与消费支出分离统计，
                  数据存在最长 30 秒的服务端缓存。下方按章节列出每个榜单的「统计口径 · 排序方式 · 上榜条件」全部细节。
                </p>
                <div className="rules-hero-tags" aria-label="规则摘要">
                  <span>5 类榜单</span>
                  <span>每榜前 10</span>
                  <span>≤30s 缓存</span>
                  <span>12 个月历史</span>
                </div>
              </div>

              <div className="rules-hero-panel" aria-hidden>
                <div className="rules-panel-label">RULE BOOK · v2</div>
                <div className="rules-panel-number">TOP 10</div>
                <div className="rules-panel-line" />
                <div className="rules-panel-copy">
                  积分 · 历史 · 签到 · 抽奖 · 游戏 ——
                  每一份记录都经过风控判定后才会进入榜单。
                </div>
              </div>

              <button
                type="button"
                className="rules-close"
                onClick={() => setRulesOpen(false)}
                aria-label="关闭排行榜规则"
              >
                <X />
              </button>
            </div>

            <div className="rules-body">
              <aside className="rules-index" aria-label="排行榜规则目录">
                <div className="rules-index-label">快速目录</div>
                <nav>
                  {RANKING_RULES.map((rule, index) => (
                    <a key={rule.title} href={`#ranking-rule-${index}`}>
                      <span>{pad2(index + 1)}</span>
                      {rule.title}
                    </a>
                  ))}
                  <a href="#ranking-rule-notes" className="rules-index-notes-link">
                    <span>★</span>
                    通用说明
                  </a>
                </nav>
                <div className="rules-index-foot">
                  榜单数据存在最长 30 秒缓存，刷新或切换后可能有数秒延迟。
                </div>
              </aside>

              <div className="rules-stack">
                {RANKING_RULES.map((rule, index) => (
                  <article
                    id={`ranking-rule-${index}`}
                    key={rule.title}
                    className={`rules-card tone-${rule.tone}`}
                  >
                    <div className="rules-card-number">{pad2(index + 1)}</div>
                    <div className="rules-card-content">
                      <div className="rules-card-top">
                        <div>
                          <h3>{rule.title}</h3>
                          <span>{rule.tag}</span>
                        </div>
                      </div>
                      {rule.summary && (
                        <p className="rules-card-summary">{rule.summary}</p>
                      )}
                      <div className="rules-card-sections">
                        {rule.sections.map((section) => (
                          <section key={section.label} className="rules-card-section">
                            <div className="rules-section-label">
                              <span className="rules-section-dot" />
                              {section.label}
                            </div>
                            <ul>
                              {section.items.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </section>
                        ))}
                      </div>
                    </div>
                  </article>
                ))}

                <div id="ranking-rule-notes" className="rules-notes">
                  <div className="rules-notes-title">
                    <span className="rules-notes-icon">★</span>
                    通用说明
                  </div>
                  <ul>
                    {RANKING_RULE_NOTES.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      <main className="container">
        {error && <div className="rk-error">{error}</div>}

        {/* Hero 横幅 */}
        <section className="season-hero">
          <div className="stars">
            <span className="star" style={{ top: '15%', left: '12%', fontSize: 12 }}>✦</span>
            <span className="star" style={{ top: '35%', left: '88%', fontSize: 16, animationDelay: '0.5s' }}>✦</span>
            <span className="star" style={{ top: '65%', left: '30%', fontSize: 10, animationDelay: '1s' }}>✦</span>
            <span className="star" style={{ top: '80%', left: '75%', fontSize: 14, animationDelay: '1.5s' }}>✦</span>
            <span className="star" style={{ top: '25%', left: '55%', fontSize: 11, animationDelay: '2s' }}>✦</span>
          </div>

          <div className="hero-content">
            <div className="hero-text">
              <div className="hero-badge">
                <Star />
                {currentMonthLabel} · 排行榜中心
              </div>
              <h1 className="hero-title">
                争夺 <span className="glow">榜首</span> 荣耀
              </h1>
              <p className="hero-sub">
                本期共 <strong style={{ color: '#fde047' }}>{totalPlayers}</strong> 位玩家上榜，挑战榜首积分{' '}
                <strong style={{ color: '#fde047' }}>{formatNumber(topPoints)}</strong>。
              </p>

              <div className="hero-stats">
                <div className="hero-stat">
                  <div className="hero-stat-label">总参与</div>
                  <div className="hero-stat-val">
                    {formatNumber(totalPlayers)} <span className="accent">人</span>
                  </div>
                </div>
                <div className="hero-stat">
                  <div className="hero-stat-label">最高积分</div>
                  <div className="hero-stat-val accent">{formatNumber(topPoints)}</div>
                </div>
                <div className="hero-stat">
                  <div className="hero-stat-label">最长连签</div>
                  <div className="hero-stat-val">
                    {topStreak} <span className="accent">天</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="hero-countdown-wrap">
              <div className="hero-countdown-label">本月结算倒计时</div>
              <div className="countdown">
                <div className="cd-box">
                  <div className="cd-num">{pad2(countdown.days)}</div>
                  <div className="cd-unit">天</div>
                </div>
                <div className="cd-colon">:</div>
                <div className="cd-box">
                  <div className="cd-num">{pad2(countdown.hours)}</div>
                  <div className="cd-unit">时</div>
                </div>
                <div className="cd-colon">:</div>
                <div className="cd-box">
                  <div className="cd-num">{pad2(countdown.minutes)}</div>
                  <div className="cd-unit">分</div>
                </div>
                <div className="cd-colon">:</div>
                <div className="cd-box">
                  <div className="cd-num">{pad2(countdown.seconds)}</div>
                  <div className="cd-unit">秒</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 页头 */}
        <div className="page-header">
          <div className="header-left">
            <h2 className="section-title">
              <Trophy />
              排行榜中心
            </h2>
            <p className="header-subtitle">汇集积分、签到、游戏战绩排行，争夺荣耀王座。</p>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className={`btn-icon ${refreshSpin ? 'spinning' : ''}`}
              onClick={triggerRefresh}
              disabled={refreshing}
              aria-label="刷新"
            >
              <RefreshCw />
            </button>
          </div>
        </div>

        {/* 顶部双列：领奖台 + 我的排名 */}
        <section className="top-grid">
          <div className="podium-section">
            <div className="podium-header">
              <h3 className="podium-title">
                <span className="crown-icon">
                  <Crown />
                </span>
                风云榜 · Top 3
              </h3>
              <div className="podium-tabs">
                <button
                  type="button"
                  className={`pd-tab ${pointsPeriod === 'all' ? 'active' : ''}`}
                  onClick={() => setPointsPeriod('all')}
                >
                  累计
                </button>
                <button
                  type="button"
                  className={`pd-tab ${pointsPeriod === 'monthly' ? 'active' : ''}`}
                  onClick={() => setPointsPeriod('monthly')}
                >
                  本月
                </button>
              </div>
            </div>

            {/* 始终展示 Top 3 三个槽位，没有数据则显示"虚位以待"占位 */}
            <div className="podium">
              {/* 第二名 */}
              <PodiumPlace place={2} entry={podium[1] ?? null} />
              {/* 第一名 */}
              <PodiumPlace place={1} entry={podium[0] ?? null} />
              {/* 第三名 */}
              <PodiumPlace place={3} entry={podium[2] ?? null} />
            </div>
          </div>

          <div className="my-rank-card">
            <div className="mr-label">
              <Star />
              My Rank · 我的排名
            </div>
            <div className="mr-rank-row">
              {myPointsEntry ? (
                <>
                  <span className="mr-hash">#</span>
                  <span className="mr-rank">{myPointsEntry.rank}</span>
                  <span className="mr-of">/ {totalPlayers} 位玩家</span>
                </>
              ) : (
                <>
                  <span className="mr-rank mr-rank-empty">—</span>
                  <span className="mr-of">暂未上榜</span>
                </>
              )}
            </div>
            <div className="mr-stats">
              <div className="mr-stat">
                <div className="mr-stat-label">当前积分</div>
                <div className="mr-stat-value">{formatNumber(myPointsEntry?.points ?? 0)}</div>
              </div>
              <div className="mr-stat">
                <div className="mr-stat-label">{myDelta?.type === 'lead' ? '领先 #2' : '距上一名'}</div>
                <div className={`mr-stat-value ${myDelta?.type === 'lead' ? 'up' : 'down'}`}>
                  {myDelta ? `${myDelta.type === 'lead' ? '+' : '-'}${formatNumber(myDelta.value)}` : '—'}
                </div>
              </div>
              <div className="mr-stat">
                <div className="mr-stat-label">榜首积分</div>
                <div className="mr-stat-value">{formatNumber(topPoints)}</div>
              </div>
              <div className="mr-stat">
                <div className="mr-stat-label">总参与</div>
                <div className="mr-stat-value">{formatNumber(totalPlayers)}</div>
              </div>
            </div>
            <div className="mr-progress">
              <div className="mr-progress-text">
                <span>
                  距下个里程碑 <strong>{formatNumber(nextMilestone.next)} 分</strong>
                </span>
                <span>
                  <strong>{nextMilestone.progress.toFixed(1)}%</strong>
                </span>
              </div>
              <div className="mr-progress-track">
                <div className="mr-progress-bar" style={{ width: `${nextMilestone.progress}%` }} />
              </div>
            </div>
          </div>
        </section>

        {/* 积分总榜 */}
        <section className="panel-card">
          <div className="panel-card-header">
            <h3 className="panel-card-title t-purple">
              <span className="icon-box">
                <Star />
              </span>
              积分总榜
              <span className="badge">TOP {pointsData?.leaderboard.length ?? 0}</span>
            </h3>
            <div className="lb-select">
              <select
                value={pointsPeriod}
                onChange={(e) => setPointsPeriod(e.target.value as SimplePeriod)}
                aria-label="切换积分榜周期"
              >
                <option value="all">累计</option>
                <option value="monthly">本月净增</option>
              </select>
            </div>
          </div>

          {pointsData?.leaderboard.length ? (
            <div className="lb-list">
              {pointsData.leaderboard.map((entry) => {
                const isMe = me?.id === entry.userId;
                const rankClass = entry.rank <= 3 ? `r-${entry.rank}` : '';
                const rowClass = entry.rank <= 3 ? `r${entry.rank}` : '';
                const avatarVariant = `a-${getAvatarVariant(entry.userId, AVATAR_VARIANT_COUNT)}`;
                const medal = entry.rank === 1 ? '🏆' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : null;
                const name = resolveDisplayName(entry);
                return (
                  <div
                    key={`points-${entry.userId}`}
                    className={`lb-row ${rowClass} ${isMe ? 'me' : ''}`}
                  >
                    {isMe && <span className="me-tag">我</span>}
                    <div className={`lb-rank ${rankClass}`}>
                      {medal ? <span className="lb-rank-medal">{medal}</span> : <span className="lb-rank-num">{entry.rank}</span>}
                    </div>
                    <div className={`lb-avatar ${avatarVariant}`}>{renderAvatarContent(entry)}</div>
                      <div className="lb-info">
                        <div className="lb-name">{name}</div>
                        <div className="lb-meta">
                          <span>用户 ID #{entry.userId}</span>
                          <AchievementPill achievement={entry.equippedAchievement} compact />
                        </div>
                      </div>
                    <div className="lb-score-wrap">
                      <div className="lb-score">{formatNumber(entry.points)}</div>
                      <div className="lb-trend flat">积分</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rk-empty">暂无积分榜数据</div>
          )}
        </section>

        {/* 历史月榜巅峰 */}
        <section className="panel-card">
          <div className="panel-card-header">
            <h3 className="panel-card-title t-orange">
              <span className="icon-box">
                <Clock />
              </span>
              历史月榜巅峰
              <span className="badge">TOP {selectedPeakMonth?.leaderboard.length ?? 0}</span>
            </h3>
            <div className="lb-select">
              <select
                value={selectedPeakMonth?.monthKey ?? ''}
                onChange={(e) => setPeakMonthKey(e.target.value)}
                aria-label="选择历史月榜月份"
              >
                {(historyData?.months ?? []).map((month) => (
                  <option key={month.monthKey} value={month.monthKey}>
                    {month.monthLabel}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedPeakMonth?.leaderboard.length ? (
            <div className="peak-rank-list">
              {selectedPeakMonth.leaderboard.map((entry) => {
                const isMe = me?.id === entry.userId;
                const rankClass = entry.rank <= 3 ? `r-${entry.rank}` : 'r-default';
                const avatarVariant = `a-${getAvatarVariant(entry.userId, AVATAR_VARIANT_COUNT)}`;
                return (
                  <div key={`${selectedPeakMonth.monthKey}-${entry.userId}`} className={`peak-row ${isMe ? 'is-me' : ''}`}>
                    {isMe && <span className="me-tag">我</span>}
                    <div className={`peak-rank ${rankClass}`}>{entry.rank}</div>
                    <div className={`peak-avatar ${avatarVariant}`}>{renderAvatarContent(entry)}</div>
                    <div className="peak-info">
                      <div className="peak-name">
                        <span>{resolveDisplayName(entry)}</span>
                        <AchievementPill achievement={entry.equippedAchievement} compact />
                      </div>
                      <div className="peak-meta">用户 ID #{entry.userId}</div>
                    </div>
                    <div className="peak-score">
                      {formatNumber(entry.points)}
                      <span>净增积分</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rk-empty">暂无历史月榜数据</div>
          )}
        </section>

        {/* 签到连续天数榜 */}
        <section className="panel-card">
          <div className="panel-card-header">
            <h3 className="panel-card-title t-blue">
              <span className="icon-box">
                <CalendarDays />
              </span>
              签到连续天数榜
              <span className="badge">TOP {checkinData?.leaderboard.length ?? 0}</span>
            </h3>
            <div className="lb-select">
              <select
                value={checkinPeriod}
                onChange={(e) => setCheckinPeriod(e.target.value as SimplePeriod)}
                aria-label="切换签到榜周期"
              >
                <option value="all">累计连续</option>
                <option value="monthly">本月连续</option>
              </select>
            </div>
          </div>

          {checkinData?.leaderboard.length ? (
            <div className="lb-list">
              {checkinData.leaderboard.map((entry) => {
                const isMe = me?.id === entry.userId;
                const rankClass = entry.rank <= 3 ? `r-${entry.rank}` : '';
                const rowClass = entry.rank <= 3 ? `r${entry.rank}` : '';
                const avatarVariant = `a-${getAvatarVariant(entry.userId, AVATAR_VARIANT_COUNT)}`;
                const medal = entry.rank === 1 ? '🏆' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : null;
                const name = resolveDisplayName(entry);
                return (
                  <div
                    key={`checkin-${entry.userId}`}
                    className={`lb-row ${rowClass} ${isMe ? 'me' : ''}`}
                  >
                    {isMe && <span className="me-tag">我</span>}
                    <div className={`lb-rank ${rankClass}`}>
                      {medal ? <span className="lb-rank-medal">{medal}</span> : <span className="lb-rank-num">{entry.rank}</span>}
                    </div>
                    <div className={`lb-avatar ${avatarVariant}`}>{renderAvatarContent(entry)}</div>
                      <div className="lb-info">
                        <div className="lb-name">{name}</div>
                        <div className="lb-meta">
                          <span>用户 ID #{entry.userId}</span>
                          <AchievementPill achievement={entry.equippedAchievement} compact />
                        </div>
                      </div>
                    <div className="lb-score-wrap">
                      <div className="lb-score">{entry.streak}</div>
                      <div className="lb-trend flat">天</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rk-empty">暂无签到榜数据</div>
          )}
        </section>

        {/* 环保排行榜 */}
        <section className="panel-card">
          <div className="panel-card-header">
            <h3 className="panel-card-title t-green">
              <span className="icon-box">
                <Recycle />
              </span>
              环保排行榜
              <span className="badge">{ecoData?.totalParticipants ?? 0} 人参与</span>
            </h3>
            <div className="lb-select">
              <select
                value={ecoPeriod}
                onChange={(e) => setEcoPeriod(e.target.value as EcoPeriod)}
                aria-label="切换环保榜周期"
              >
                <option value="daily">日榜</option>
                <option value="weekly">周榜</option>
                <option value="monthly">月榜</option>
              </select>
            </div>
          </div>

          {ecoData?.leaderboard.length ? (
            <div className="lb-list">
              {ecoData.leaderboard.map((entry) => {
                const isMe = me?.id === entry.userId;
                const rankClass = entry.rank <= 3 ? `r-${entry.rank}` : '';
                const rowClass = entry.rank <= 3 ? `r${entry.rank}` : '';
                const avatarVariant = `a-${getAvatarVariant(entry.userId, AVATAR_VARIANT_COUNT)}`;
                const medal = entry.rank === 1 ? '🏆' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : null;
                const name = resolveDisplayName(entry);
                return (
                  <div
                    key={`eco-${entry.userId}`}
                    className={`lb-row ${rowClass} ${isMe ? 'me' : ''}`}
                  >
                    {isMe && <span className="me-tag">我</span>}
                    <div className={`lb-rank ${rankClass}`}>
                      {medal ? <span className="lb-rank-medal">{medal}</span> : <span className="lb-rank-num">{entry.rank}</span>}
                    </div>
                    <div className={`lb-avatar ${avatarVariant}`}>{renderAvatarContent(entry)}</div>
                    <div className="lb-info">
                      <div className="lb-name">{name}</div>
                      <div className="lb-meta">
                        <span>用户 ID #{entry.userId}</span>
                        <AchievementPill achievement={entry.equippedAchievement} compact />
                      </div>
                    </div>
                    <div className="lb-score-wrap">
                      <div className="lb-score">{formatNumber(entry.trashCleared)}</div>
                      <div className="lb-trend flat">垃圾</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rk-empty">暂无环保榜数据</div>
          )}
        </section>

        {/* 幸运抽奖榜（迁自抽奖页今日欧皇榜） */}
        <section className="panel-card">
          <div className="panel-card-header">
            <h3 className="panel-card-title t-amber">
              <span className="icon-box">
                <Sparkles />
              </span>
              幸运抽奖榜
              <span className="badge">{lotteryData?.totalParticipants ?? 0} 人参与</span>
            </h3>
            <div className="lb-select">
              <select
                value={lotteryPeriod}
                onChange={(e) => setLotteryPeriod(e.target.value as LotteryPeriod)}
                aria-label="切换幸运抽奖榜周期"
              >
                <option value="daily">日榜</option>
                <option value="weekly">周榜</option>
                <option value="monthly">月榜</option>
              </select>
            </div>
          </div>

          {lotteryData?.ranking.length ? (
            <div className="lottery-rank-list">
              {lotteryData.ranking.map((entry) => {
                const isMine = String(entry.userId) === String(me?.id ?? '');
                const rankClass =
                  entry.rank === 1 ? 'r-gold' : entry.rank === 2 ? 'r-silver' : entry.rank === 3 ? 'r-bronze' : 'r-default';
                return (
                  <div key={entry.userId} className={`lottery-row ${isMine ? 'is-me' : ''}`}>
                    <div className={`lottery-rank ${rankClass}`}>{entry.rank}</div>
                    <div className="lottery-info">
                      <div className="lottery-name">
                        {entry.username}
                        {isMine ? <span className="me-tag">我</span> : null}
                      </div>
                      <div className="lottery-meta">
                        抽奖 {entry.count} 次{entry.bestPrize ? ` · 最佳 ${entry.bestPrize}` : ''}
                        <AchievementPill achievement={entry.equippedAchievement} compact />
                      </div>
                    </div>
                    <div className="lottery-value">
                      <Star />
                      <span>{formatNumber(entry.totalValue)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rk-empty">暂无幸运抽奖榜数据</div>
          )}
        </section>

        {/* 分游戏排行榜 */}
        <section className="panel-card">
          <div className="panel-card-header">
            <h3 className="panel-card-title t-pink">
              <span className="icon-box">
                <BarChart3 />
              </span>
              分游戏排行榜
              <span className="badge">{gamesData?.games.length ?? 0} 个游戏</span>
            </h3>
            <div className="lb-select">
              <select
                value={gamePeriod}
                onChange={(e) => setGamePeriod(e.target.value as GamePeriod)}
                aria-label="切换游戏榜周期"
              >
                <option value="daily">日榜</option>
                <option value="weekly">周榜</option>
                <option value="monthly">月榜</option>
              </select>
            </div>
          </div>

          {gamesData?.games.length ? (
            <div className="games-grid">
              {gamesData.games.map((group) => (
                <GameCard
                  key={group.gameType}
                  group={group}
                  myUserId={me?.id ?? null}
                />
              ))}
            </div>
          ) : (
            <div className="rk-empty">暂无游戏榜数据</div>
          )}
        </section>

      </main>

      <style jsx global>{`
        .rk-page {
          --text-main: #0f172a;
          --text-light: #64748b;
          --card-bg: rgba(255, 255, 255, 0.7);
          --card-border: rgba(255, 255, 255, 1);
          --card-shadow: 0 24px 48px rgba(15, 23, 42, 0.06);
          --c-green: #10b981;
          --c-purple: #8b5cf6;
          --c-orange: #f97316;
          --c-red: #f43f5e;
          --c-blue: #3b82f6;
          --c-pink: #ec4899;
          --c-amber: #fbbf24;
          --grad-primary: linear-gradient(135deg, #a855f7, #6366f1);
          --grad-gold: linear-gradient(135deg, #fde047, #f59e0b 50%, #ea580c);
          --grad-silver: linear-gradient(135deg, #f1f5f9, #cbd5e1 50%, #64748b);
          --grad-bronze: linear-gradient(135deg, #fed7aa, #fb923c 50%, #c2410c);
          font-family: 'Outfit', 'Noto Sans SC', sans-serif;
          background-color: #f8fafc;
          color: var(--text-main);
          min-height: 100vh;
          position: relative;
          isolation: isolate;
          -webkit-font-smoothing: antialiased;
          -webkit-tap-highlight-color: transparent;
        }

        .rk-page * { box-sizing: border-box; }
        .rk-page a { color: inherit; text-decoration: none; }
        .rk-page button { font-family: inherit; }

        .rk-page .mesh-bg {
          position: fixed;
          inset: 0;
          z-index: -2;
          background-image:
            radial-gradient(circle at 15% 50%, rgba(255, 228, 230, 0.85) 0%, transparent 50%),
            radial-gradient(circle at 85% 30%, rgba(224, 231, 255, 0.85) 0%, transparent 50%),
            radial-gradient(circle at 50% 90%, rgba(254, 243, 199, 0.85) 0%, transparent 50%),
            radial-gradient(circle at 50% 10%, rgba(243, 232, 255, 0.85) 0%, transparent 50%);
          filter: blur(60px);
          animation: rk-fluid 15s infinite alternate ease-in-out;
        }

        @keyframes rk-fluid {
          0% { transform: scale(1) rotate(0deg); }
          50% { transform: scale(1.05) rotate(2deg); }
          100% { transform: scale(1.1) rotate(-2deg); }
        }

        /* === 顶部导航栏 === */
        .rk-page .topbar {
          position: sticky;
          top: 0;
          z-index: 100;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 24px;
          padding: 16px 48px;
          background: rgba(248, 250, 252, 0.65);
          backdrop-filter: blur(24px) saturate(1.6);
          -webkit-backdrop-filter: blur(24px) saturate(1.6);
          border-bottom: 1px solid rgba(255, 255, 255, 0.8);
          padding-top: max(16px, env(safe-area-inset-top));
        }

        .rk-page .brand {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 20px;
          font-weight: 800;
          letter-spacing: -0.5px;
          color: var(--text-main);
          flex-shrink: 0;
        }

        .rk-page .brand-icon {
          width: 36px;
          height: 36px;
          background: var(--grad-primary);
          border-radius: 11px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 8px 16px rgba(168, 85, 247, 0.3);
        }

        .rk-page .brand-icon svg {
          width: 20px;
          height: 20px;
          color: #fff;
          stroke-width: 2.5;
        }

        .rk-page .topbar-right {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-shrink: 0;
        }

        .rk-page .user-profile {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          padding: 5px 16px 5px 5px;
          background: #ffffff;
          border-radius: 999px;
          box-shadow: 0 8px 20px rgba(0, 0, 0, 0.04);
          cursor: pointer;
          transition: transform 0.2s;
        }

        .rk-page .user-profile:hover { transform: scale(1.02); }

        .rk-page .user-profile .avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);
          color: #475569;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          font-size: 14px;
          flex-shrink: 0;
          text-transform: uppercase;
        }

        .rk-page .user-info h4 {
          font-size: 13px;
          font-weight: 700;
          line-height: 1.2;
          margin: 0;
          max-width: 140px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .rk-page .user-info p {
          font-size: 11px;
          color: var(--text-light);
          margin: 1px 0 0;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          max-width: 150px;
        }

        .rk-page .user-info .nav-achievement-line {
          width: 100%;
          min-width: 0;
        }

        .rk-page .nav-achievement {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          min-width: 0;
          color: #92400e;
          font-weight: 800;
        }

        .rk-page .nav-achievement.empty {
          color: var(--text-light);
          font-weight: 700;
        }

        .rk-page .nav-achievement-emoji {
          flex: 0 0 auto;
          font-size: 11px;
          line-height: 1;
        }

        .rk-page .nav-achievement-name {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .rk-page .user-info p .rank-pill {
          background: var(--grad-gold);
          color: #fff;
          padding: 1px 7px;
          border-radius: 999px;
          font-weight: 800;
          font-size: 10px;
          letter-spacing: 0.3px;
        }

        /* === 主容器 === */
        .rk-page .container {
          max-width: 1600px;
          margin: 0 auto;
          padding: 32px 48px 64px;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .rk-page .rk-error {
          padding: 12px 16px;
          border-radius: 14px;
          background: rgba(244, 63, 94, 0.08);
          border: 1px solid rgba(244, 63, 94, 0.25);
          color: var(--c-red);
          font-size: 13px;
          font-weight: 600;
        }

        .rk-page .rk-empty {
          padding: 24px;
          text-align: center;
          color: var(--text-light);
          font-size: 13px;
        }

        /* === Hero 横幅 === */
        .rk-page .season-hero {
          position: relative;
          padding: 36px 40px;
          border-radius: 36px;
          background:
            /* 左侧暗化蒙层，保证标题可读性 */
            linear-gradient(
              90deg,
              rgba(15, 12, 40, 0.78) 0%,
              rgba(15, 12, 40, 0.55) 35%,
              rgba(15, 12, 40, 0.18) 62%,
              transparent 82%
            ),
            /* 主图 */
            url('/images-optimized/ui/rankings/hero.webp') center right / cover no-repeat,
            /* 兜底渐变，图片加载失败时呈现原配色 */
            linear-gradient(135deg, #1e1b4b 0%, #4c1d95 35%, #6d28d9 70%, #a855f7 100%);
          color: #fff;
          overflow: hidden;
          box-shadow: 0 30px 60px rgba(76, 29, 149, 0.35);
        }

        .rk-page .season-hero::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image:
            radial-gradient(circle at 12% 92%, rgba(168, 85, 247, 0.28), transparent 55%),
            radial-gradient(circle at 50% 100%, rgba(76, 29, 149, 0.35), transparent 70%);
          pointer-events: none;
        }

        .rk-page .season-hero::after {
          content: '';
          position: absolute;
          top: -50%;
          right: -10%;
          width: 500px;
          height: 500px;
          background: radial-gradient(circle, rgba(251, 191, 36, 0.2), transparent 60%);
          filter: blur(40px);
          pointer-events: none;
          animation: rk-glow-pulse 4s ease-in-out infinite;
        }

        @keyframes rk-glow-pulse {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.15); opacity: 1; }
        }

        .rk-page .stars {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
        }

        .rk-page .star {
          position: absolute;
          color: rgba(255, 255, 255, 0.7);
          animation: rk-twinkle 3s ease-in-out infinite;
        }

        @keyframes rk-twinkle {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.3); }
        }

        .rk-page .hero-content {
          position: relative;
          z-index: 2;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 32px;
          flex-wrap: wrap;
        }

        .rk-page .hero-text { flex: 1; min-width: 280px; }

        .rk-page .hero-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 14px;
          background: rgba(251, 191, 36, 0.2);
          border: 1px solid rgba(251, 191, 36, 0.35);
          border-radius: 999px;
          font-size: 12px;
          font-weight: 800;
          color: #fde047;
          margin-bottom: 14px;
          letter-spacing: 1px;
          backdrop-filter: blur(10px);
        }

        .rk-page .hero-badge svg { width: 12px; height: 12px; }

        .rk-page .hero-title {
          font-size: 44px;
          font-weight: 900;
          letter-spacing: -1.5px;
          line-height: 1.05;
          margin: 0 0 10px;
          text-shadow: 0 2px 18px rgba(0, 0, 0, 0.55);
        }

        .rk-page .hero-title .glow {
          background: linear-gradient(135deg, #fde047, #fb923c);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          text-shadow: 0 2px 14px rgba(0, 0, 0, 0.55), 0 0 40px rgba(251, 191, 36, 0.5);
          filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.45));
        }

        .rk-page .hero-sub {
          font-size: 14px;
          color: rgba(255, 255, 255, 0.88);
          line-height: 1.6;
          max-width: 480px;
          text-shadow: 0 1px 6px rgba(0, 0, 0, 0.45);
        }

        .rk-page .hero-stats {
          display: flex;
          gap: 24px;
          margin-top: 22px;
          flex-wrap: wrap;
        }

        .rk-page .hero-stat {
          background: rgba(15, 12, 40, 0.42);
          border: 1px solid rgba(255, 255, 255, 0.22);
          backdrop-filter: blur(14px);
          border-radius: 16px;
          padding: 12px 20px;
          min-width: 110px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
        }

        .rk-page .hero-stat-label {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.65);
          font-weight: 700;
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }

        .rk-page .hero-stat-val {
          font-size: 22px;
          font-weight: 900;
          margin-top: 2px;
          letter-spacing: -0.3px;
          color: #fff;
        }

        .rk-page .hero-stat-val .accent,
        .rk-page .hero-stat-val.accent { color: #fde047; }

        .rk-page .hero-countdown-wrap { flex-shrink: 0; }

        .rk-page .hero-countdown-label {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.6);
          font-weight: 700;
          letter-spacing: 1.5px;
          margin-bottom: 10px;
          text-transform: uppercase;
        }

        .rk-page .countdown {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .rk-page .cd-box {
          background: rgba(15, 12, 40, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.26);
          backdrop-filter: blur(14px);
          border-radius: 14px;
          padding: 14px 18px;
          text-align: center;
          min-width: 64px;
        }

        .rk-page .cd-num {
          font-size: 30px;
          font-weight: 900;
          line-height: 1;
          color: #fff;
          letter-spacing: -1px;
        }

        .rk-page .cd-unit {
          font-size: 10px;
          color: rgba(255, 255, 255, 0.7);
          font-weight: 700;
          margin-top: 4px;
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .rk-page .cd-colon {
          font-size: 26px;
          font-weight: 900;
          color: rgba(255, 255, 255, 0.5);
        }

        /* === 页头 === */
        .rk-page .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 16px;
          flex-wrap: wrap;
          margin-top: 4px;
        }

        .rk-page .header-left .section-title {
          font-size: 30px;
          font-weight: 800;
          display: flex;
          align-items: center;
          gap: 12px;
          color: var(--text-main);
          margin: 0 0 4px;
          letter-spacing: -0.8px;
        }

        .rk-page .header-left .section-title svg {
          width: 32px;
          height: 32px;
          color: var(--c-orange);
          stroke-width: 2.5;
        }

        .rk-page .header-subtitle {
          font-size: 14px;
          color: var(--text-light);
          margin: 0;
        }

        .rk-page .header-actions {
          display: flex;
          gap: 10px;
          align-items: center;
        }

        .rk-page .btn-icon {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.9);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: var(--text-light);
          transition: all 0.2s;
        }

        .rk-page .btn-icon svg { width: 16px; height: 16px; }

        .rk-page .btn-icon:hover:not(:disabled) {
          background: #fff;
          color: var(--text-main);
          transform: translateY(-1px);
        }

        .rk-page .btn-icon:disabled { opacity: 0.6; cursor: not-allowed; }

        .rk-page .btn-icon.spinning svg { animation: rk-rotate 0.6s ease; }

        @keyframes rk-rotate {
          from { transform: rotate(0); }
          to { transform: rotate(360deg); }
        }

        .rk-page .rules-trigger {
          color: #7c3aed;
          background:
            linear-gradient(#fff, #fff) padding-box,
            linear-gradient(135deg, rgba(168, 85, 247, 0.36), rgba(251, 191, 36, 0.5)) border-box;
          border: 1px solid transparent;
        }

        .rk-page .rules-trigger:hover {
          color: #6d28d9;
          box-shadow: 0 14px 26px rgba(124, 58, 237, 0.14);
        }

        /* ============================================== */
        /*  规则弹窗 v3 —— 深空主题，呼应 Hero 卡面         */
        /* ============================================== */

        .rk-page .rules-overlay {
          position: fixed;
          inset: 0;
          z-index: 100;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background:
            radial-gradient(circle at 18% 22%, rgba(168, 85, 247, 0.22), transparent 38%),
            radial-gradient(circle at 82% 18%, rgba(251, 191, 36, 0.18), transparent 36%),
            radial-gradient(circle at 50% 92%, rgba(99, 102, 241, 0.24), transparent 55%),
            rgba(8, 6, 28, 0.72);
          backdrop-filter: blur(20px) saturate(1.1);
          animation: rk-rules-fade 0.2s ease-out;
        }

        .rk-page .rules-modal {
          position: relative;
          width: min(1120px, 100%);
          max-height: min(90vh, 880px);
          padding: 0;
          border-radius: 28px;
          overflow: hidden;
          isolation: isolate;
          background:
            radial-gradient(circle at 12% 0%, rgba(168, 85, 247, 0.12), transparent 42%),
            radial-gradient(circle at 90% 100%, rgba(251, 191, 36, 0.08), transparent 50%),
            linear-gradient(180deg, #0c0a23 0%, #120e2e 40%, #0a0820 100%);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow:
            0 40px 100px rgba(2, 6, 23, 0.6),
            0 0 0 1px rgba(168, 85, 247, 0.12),
            inset 0 1px 0 rgba(255, 255, 255, 0.06);
          animation: rk-rules-rise 0.26s cubic-bezier(0.2, 0.9, 0.3, 1);
        }

        /* ---------- Hero 头部 ---------- */
        .rk-page .rules-hero {
          position: relative;
          display: grid;
          grid-template-columns: minmax(0, 1fr) 280px;
          gap: 28px;
          padding: 34px 36px 30px;
          color: #fff;
          background:
            radial-gradient(circle at 15% 0%, rgba(251, 191, 36, 0.18), transparent 45%),
            radial-gradient(circle at 88% 100%, rgba(168, 85, 247, 0.28), transparent 55%),
            linear-gradient(135deg, rgba(15, 12, 40, 0.6), rgba(30, 27, 75, 0.55)),
            repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.04) 0 1px, transparent 1px 18px);
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }

        .rk-page .rules-hero::after {
          content: '';
          position: absolute;
          left: 36px;
          right: 36px;
          bottom: -1px;
          height: 2px;
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(251, 191, 36, 0.8) 18%,
            rgba(168, 85, 247, 0.6) 50%,
            rgba(56, 189, 248, 0.5) 78%,
            transparent 100%
          );
          filter: blur(0.4px);
        }

        .rk-page .rules-hero-copy {
          position: relative;
          z-index: 1;
          min-width: 0;
        }

        .rk-page .rules-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 0;
          background: transparent;
          color: #fde047;
          font-size: 12px;
          font-weight: 950;
          letter-spacing: 2px;
          text-transform: uppercase;
        }

        .rk-page .rules-kicker svg {
          width: 15px;
          height: 15px;
          stroke-width: 2.6;
        }

        .rk-page .rules-hero h2 {
          margin: 18px 0 14px;
          color: #fff;
          font-size: clamp(30px, 4vw, 50px);
          line-height: 0.98;
          font-weight: 950;
          letter-spacing: -1px;
          text-shadow: 0 2px 18px rgba(0, 0, 0, 0.55);
        }

        .rk-page .rules-hero h2 span {
          display: block;
          margin-top: 6px;
          font-size: clamp(16px, 1.6vw, 22px);
          font-weight: 800;
          letter-spacing: 0.5px;
          background: linear-gradient(135deg, #fde047, #fb923c);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .rk-page .rules-hero p {
          max-width: 640px;
          margin: 0;
          color: rgba(226, 232, 240, 0.86);
          font-size: 14px;
          line-height: 1.85;
          font-weight: 600;
        }

        .rk-page .rules-hero-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 20px;
        }

        .rk-page .rules-hero-tags span {
          padding: 7px 12px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.16);
          color: rgba(255, 255, 255, 0.94);
          font-size: 11.5px;
          font-weight: 850;
          backdrop-filter: blur(6px);
        }

        /* 右上装饰面板（仿"密令书"） */
        .rk-page .rules-hero-panel {
          position: relative;
          z-index: 1;
          align-self: stretch;
          padding: 20px 22px;
          border-radius: 20px;
          background: linear-gradient(160deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.02));
          border: 1px solid rgba(255, 255, 255, 0.12);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          min-height: 180px;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
        }

        .rk-page .rules-panel-label {
          color: rgba(253, 224, 71, 0.85);
          font-size: 10.5px;
          font-weight: 950;
          letter-spacing: 2.4px;
        }

        .rk-page .rules-panel-number {
          font-size: 52px;
          font-weight: 950;
          line-height: 1;
          letter-spacing: -1.5px;
          background: linear-gradient(135deg, #fde047 0%, #fb923c 70%, #f472b6 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          filter: drop-shadow(0 2px 8px rgba(251, 191, 36, 0.35));
        }

        .rk-page .rules-panel-line {
          width: 100%;
          height: 3px;
          border-radius: 999px;
          background: linear-gradient(90deg, #fde047 0 30%, #a855f7 30% 65%, #38bdf8 65% 100%);
          box-shadow: 0 0 12px rgba(168, 85, 247, 0.4);
        }

        .rk-page .rules-panel-copy {
          color: rgba(226, 232, 240, 0.78);
          font-size: 12px;
          line-height: 1.7;
          font-weight: 650;
        }

        .rk-page .rules-close {
          position: absolute;
          top: 22px;
          right: 22px;
          z-index: 5;
          width: 42px;
          height: 42px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: rgba(255, 255, 255, 0.86);
          background: rgba(15, 12, 40, 0.55);
          backdrop-filter: blur(8px);
          cursor: pointer;
          box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35);
          transition: transform 0.2s ease, color 0.2s ease, background 0.2s ease, border-color 0.2s ease;
        }

        .rk-page .rules-close:hover {
          transform: translateY(-1px) rotate(90deg);
          color: #fff;
          background: rgba(251, 191, 36, 0.18);
          border-color: rgba(251, 191, 36, 0.5);
        }

        .rk-page .rules-close svg {
          width: 18px;
          height: 18px;
          stroke-width: 2.6;
        }

        /* ---------- 主体：左目录 + 右内容 ---------- */
        .rk-page .rules-body {
          display: grid;
          grid-template-columns: 240px minmax(0, 1fr);
          gap: 0;
          max-height: calc(min(90vh, 880px) - 260px);
          overflow: auto;
        }

        .rk-page .rules-index {
          position: sticky;
          top: 0;
          align-self: start;
          min-height: 100%;
          padding: 22px 18px;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.01));
          border-right: 1px solid rgba(255, 255, 255, 0.06);
        }

        .rk-page .rules-index-label {
          margin-bottom: 12px;
          padding: 0 4px;
          color: rgba(253, 224, 71, 0.78);
          font-size: 11px;
          font-weight: 950;
          letter-spacing: 1.8px;
          text-transform: uppercase;
        }

        .rk-page .rules-index nav {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .rk-page .rules-index a {
          display: flex;
          align-items: center;
          gap: 11px;
          padding: 11px 12px;
          border-radius: 12px;
          color: rgba(226, 232, 240, 0.82);
          font-size: 13px;
          font-weight: 800;
          text-decoration: none;
          transition: background 0.2s ease, color 0.2s ease, transform 0.2s ease, border-color 0.2s ease;
          border: 1px solid transparent;
        }

        .rk-page .rules-index a:hover {
          transform: translateX(3px);
          color: #fff;
          background: rgba(168, 85, 247, 0.14);
          border-color: rgba(168, 85, 247, 0.28);
        }

        .rk-page .rules-index a span {
          width: 26px;
          height: 26px;
          border-radius: 8px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: rgba(253, 224, 71, 0.9);
          background: rgba(251, 191, 36, 0.08);
          border: 1px solid rgba(251, 191, 36, 0.22);
          font-size: 11px;
          font-weight: 950;
          flex: 0 0 auto;
        }

        .rk-page .rules-index-notes-link span {
          color: #fff;
          background: linear-gradient(135deg, #fb923c, #ec4899);
          border-color: rgba(244, 114, 182, 0.4);
        }

        .rk-page .rules-index-foot {
          margin-top: 18px;
          padding: 12px 13px;
          border-radius: 14px;
          background: rgba(168, 85, 247, 0.08);
          border: 1px solid rgba(168, 85, 247, 0.22);
          color: rgba(226, 232, 240, 0.78);
          font-size: 11.5px;
          line-height: 1.65;
          font-weight: 600;
        }

        /* ---------- 内容栈 ---------- */
        .rk-page .rules-stack {
          min-width: 0;
          padding: 22px 24px 26px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .rk-page .rules-card {
          position: relative;
          display: grid;
          grid-template-columns: 70px minmax(0, 1fr);
          gap: 0;
          padding: 0;
          border-radius: 20px;
          overflow: hidden;
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.02));
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow:
            0 14px 30px rgba(0, 0, 0, 0.28),
            inset 0 1px 0 rgba(255, 255, 255, 0.05);
          transition: border-color 0.25s ease, transform 0.25s ease;
        }

        .rk-page .rules-card::before { display: none; }

        .rk-page .rules-card:hover {
          transform: translateY(-2px);
          border-color: rgba(168, 85, 247, 0.4);
        }

        .rk-page .rules-card.tone-purple { --rule-accent: linear-gradient(180deg, #c084fc, #6366f1); --rule-dot: #c084fc; }
        .rk-page .rules-card.tone-orange { --rule-accent: linear-gradient(180deg, #fb923c, #f59e0b); --rule-dot: #fb923c; }
        .rk-page .rules-card.tone-blue   { --rule-accent: linear-gradient(180deg, #38bdf8, #3b82f6); --rule-dot: #38bdf8; }
        .rk-page .rules-card.tone-green  { --rule-accent: linear-gradient(180deg, #34d399, #10b981); --rule-dot: #34d399; }
        .rk-page .rules-card.tone-amber  { --rule-accent: linear-gradient(180deg, #fde047, #f59e0b); --rule-dot: #fde047; }
        .rk-page .rules-card.tone-pink   { --rule-accent: linear-gradient(180deg, #f472b6, #ec4899); --rule-dot: #f472b6; }

        .rk-page .rules-card-number {
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding-top: 22px;
          color: #fff;
          font-size: 18px;
          font-weight: 950;
          letter-spacing: -0.5px;
          background: var(--rule-accent, linear-gradient(180deg, #64748b, #0f172a));
          box-shadow: inset -1px 0 0 rgba(0, 0, 0, 0.18);
          text-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
        }

        .rk-page .rules-card-content {
          min-width: 0;
          padding: 20px 22px 22px;
        }

        .rk-page .rules-card-top {
          display: flex;
          align-items: baseline;
          gap: 12px;
          flex-wrap: wrap;
          margin-bottom: 10px;
        }

        .rk-page .rules-card h3 {
          margin: 0;
          color: #fff;
          font-size: 19px;
          line-height: 1.2;
          font-weight: 950;
          letter-spacing: 0;
        }

        .rk-page .rules-card-top span:not(.rules-card-mark) {
          display: inline-flex;
          align-items: center;
          padding: 3px 9px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.12);
          color: rgba(226, 232, 240, 0.8);
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.3px;
        }

        .rk-page .rules-card-summary {
          margin: 0 0 16px;
          color: rgba(226, 232, 240, 0.86);
          font-size: 13.5px;
          line-height: 1.78;
          font-weight: 600;
          padding: 11px 14px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.035);
          border-left: 3px solid var(--rule-dot, #94a3b8);
        }

        .rk-page .rules-card-sections {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .rk-page .rules-card-section {
          padding: 0;
        }

        .rk-page .rules-section-label {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
          color: rgba(255, 255, 255, 0.92);
          font-size: 12px;
          font-weight: 950;
          letter-spacing: 1px;
          text-transform: uppercase;
        }

        .rk-page .rules-section-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: var(--rule-dot, #94a3b8);
          box-shadow: 0 0 10px var(--rule-dot, #94a3b8);
          flex: 0 0 auto;
        }

        .rk-page .rules-card ul,
        .rk-page .rules-notes ul {
          margin: 0;
          padding: 0;
          list-style: none;
        }

        .rk-page .rules-card li {
          position: relative;
          padding-left: 18px;
          color: rgba(226, 232, 240, 0.84);
          font-size: 13.5px;
          line-height: 1.85;
          font-weight: 550;
        }

        .rk-page .rules-card li + li { margin-top: 6px; }

        .rk-page .rules-card li::before {
          content: '';
          position: absolute;
          left: 4px;
          top: 0.92em;
          width: 5px;
          height: 5px;
          border-radius: 999px;
          background: var(--rule-dot, #94a3b8);
          opacity: 0.85;
        }

        /* ---------- 通用说明 ---------- */
        .rk-page .rules-notes {
          margin-top: 6px;
          padding: 22px 24px;
          border-radius: 20px;
          background:
            radial-gradient(circle at 0% 0%, rgba(251, 191, 36, 0.12), transparent 50%),
            linear-gradient(135deg, rgba(15, 12, 40, 0.85), rgba(30, 27, 75, 0.7));
          border: 1px solid rgba(251, 191, 36, 0.22);
          box-shadow: 0 14px 36px rgba(0, 0, 0, 0.32);
        }

        .rk-page .rules-notes-title {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 14px;
          color: #fde047;
          font-size: 13px;
          font-weight: 950;
          letter-spacing: 1.4px;
          text-transform: uppercase;
        }

        .rk-page .rules-notes-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          border-radius: 8px;
          background: linear-gradient(135deg, #fde047, #fb923c);
          color: #0c0a23;
          font-size: 13px;
          font-weight: 950;
        }

        .rk-page .rules-notes li {
          position: relative;
          padding-left: 18px;
          font-size: 12.8px;
          line-height: 1.85;
          color: rgba(226, 232, 240, 0.84);
          font-weight: 550;
        }

        .rk-page .rules-notes li + li { margin-top: 6px; }

        .rk-page .rules-notes li::before {
          content: '';
          position: absolute;
          left: 4px;
          top: 0.92em;
          width: 5px;
          height: 5px;
          border-radius: 999px;
          background: #fbbf24;
          box-shadow: 0 0 8px rgba(251, 191, 36, 0.6);
        }

        @keyframes rk-rules-fade {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes rk-rules-rise {
          from { opacity: 0; transform: translateY(18px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        /* === 顶部双列 === */
        .rk-page .top-grid {
          display: grid;
          grid-template-columns: 1.7fr 1fr;
          gap: 24px;
          align-items: stretch;
        }

        /* === 领奖台 === */
        .rk-page .podium-section {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0.55));
          backdrop-filter: blur(30px);
          -webkit-backdrop-filter: blur(30px);
          border: 1px solid rgba(255, 255, 255, 0.9);
          border-radius: 32px;
          padding: 36px 36px 32px;
          box-shadow: var(--card-shadow), inset 0 1px 0 rgba(255, 255, 255, 1);
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .rk-page .podium-section::before {
          content: '';
          position: absolute;
          top: -20%;
          left: 50%;
          transform: translateX(-50%);
          width: 700px;
          height: 700px;
          background:
            radial-gradient(circle, rgba(251, 191, 36, 0.18) 0%, transparent 50%),
            conic-gradient(from 0deg, transparent, rgba(251, 191, 36, 0.08), transparent, rgba(236, 72, 153, 0.08), transparent);
          pointer-events: none;
          animation: rk-rotate-light 20s linear infinite;
        }

        @keyframes rk-rotate-light {
          from { transform: translateX(-50%) rotate(0deg); }
          to { transform: translateX(-50%) rotate(360deg); }
        }

        .rk-page .podium-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 28px;
          position: relative;
          z-index: 2;
          flex-wrap: wrap;
          gap: 12px;
        }

        .rk-page .podium-title {
          font-size: 20px;
          font-weight: 800;
          display: flex;
          align-items: center;
          gap: 12px;
          letter-spacing: -0.3px;
          margin: 0;
        }

        .rk-page .podium-title .crown-icon {
          width: 42px;
          height: 42px;
          border-radius: 13px;
          background: var(--grad-gold);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          box-shadow: 0 12px 24px rgba(251, 191, 36, 0.4);
          position: relative;
        }

        .rk-page .podium-title .crown-icon svg {
          width: 22px;
          height: 22px;
          stroke-width: 2.5;
        }

        .rk-page .podium-tabs {
          display: flex;
          gap: 4px;
          background: rgba(15, 23, 42, 0.05);
          padding: 4px;
          border-radius: 999px;
        }

        .rk-page .pd-tab {
          padding: 8px 18px;
          border-radius: 999px;
          font-size: 13px;
          font-weight: 700;
          color: var(--text-light);
          cursor: pointer;
          transition: all 0.2s;
          border: none;
          background: transparent;
        }

        .rk-page .pd-tab.active {
          background: #fff;
          color: var(--text-main);
          box-shadow: 0 6px 12px rgba(15, 23, 42, 0.08);
        }

        .rk-page .podium {
          display: grid;
          grid-template-columns: 1fr 1.25fr 1fr;
          gap: 20px;
          align-items: end;
          position: relative;
          z-index: 1;
          padding-top: 40px;
          flex: 1;
        }

        .rk-page .podium-empty {
          padding: 60px 20px;
          text-align: center;
          color: var(--text-light);
          font-size: 13px;
          position: relative;
          z-index: 1;
        }

        .rk-page .podium-empty p { margin: 8px 0 0; }

        /* 虚位以待占位样式 */
        .rk-page .pod.pod-empty .pod-rank-badge {
          background: rgba(15, 23, 42, 0.08);
          color: var(--text-light);
          box-shadow: none;
        }

        .rk-page .pod-empty-text {
          height: 100px;
          margin-top: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 700;
          color: var(--text-light);
          font-style: italic;
          letter-spacing: 0.5px;
        }

        .rk-page .pod-1 .pod-empty-text {
          height: 130px;
          font-size: 16px;
        }

        /* 第一名占位时去除冠军装饰 ::after */
        .rk-page .pod-1.pod-empty::after { display: none; }

        .rk-page .pod {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          position: relative;
        }

        .rk-page .pod-rank-badge {
          width: 38px;
          height: 38px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 900;
          font-size: 16px;
          color: #fff;
          margin-bottom: -19px;
          position: relative;
          z-index: 4;
          border: 4px solid #fff;
        }

        .rk-page .pod-1 .pod-rank-badge { background: var(--grad-gold); box-shadow: 0 8px 20px rgba(251, 191, 36, 0.5); }
        .rk-page .pod-2 .pod-rank-badge { background: var(--grad-silver); box-shadow: 0 6px 16px rgba(148, 163, 184, 0.4); color: #1e293b; }
        .rk-page .pod-3 .pod-rank-badge { background: var(--grad-bronze); box-shadow: 0 6px 16px rgba(217, 119, 6, 0.4); }

        .rk-page .pod-avatar-wrap { position: relative; z-index: 2; }

        .rk-page .pod-1 .pod-avatar-wrap::before {
          content: '';
          position: absolute;
          inset: -12px;
          border-radius: 50%;
          background: conic-gradient(from 0deg, #fde047, #fb923c, #f43f5e, #fde047);
          opacity: 0.5;
          filter: blur(16px);
          animation: rk-rotate-light 8s linear infinite;
        }

        .rk-page .pod-avatar {
          width: 100px;
          height: 100px;
          border-radius: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 40px;
          font-weight: 900;
          color: #fff;
          text-transform: uppercase;
          border: 5px solid #fff;
          position: relative;
          box-shadow: 0 16px 32px rgba(15, 23, 42, 0.12);
        }

        .rk-page .pod-1 .pod-avatar {
          width: 130px;
          height: 130px;
          font-size: 50px;
          border-radius: 36px;
          background: var(--grad-gold);
          color: #92400e;
          box-shadow: 0 24px 48px rgba(251, 191, 36, 0.5), inset 0 2px 4px rgba(255, 255, 255, 0.6);
        }

        .rk-page .pod-2 .pod-avatar {
          background: var(--grad-silver);
          color: #1e293b;
        }

        .rk-page .pod-3 .pod-avatar {
          background: var(--grad-bronze);
          color: #7c2d12;
        }

        .rk-page .pod-1::after {
          content: '✨';
          position: absolute;
          top: -10px;
          right: 5%;
          font-size: 22px;
          animation: rk-twinkle 2s ease-in-out infinite;
          animation-delay: 0.5s;
        }

        .rk-page .pod-name {
          font-size: 17px;
          font-weight: 800;
          margin-top: 16px;
          margin-bottom: 4px;
          letter-spacing: -0.2px;
          max-width: 180px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .rk-page .pod-1 .pod-name { font-size: 21px; }

        .rk-page .pod-name-sub {
          font-size: 11px;
          color: var(--text-light);
          font-weight: 600;
          margin-bottom: 8px;
        }

        .rk-page .rk-achievement-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          max-width: 150px;
          padding: 3px 9px;
          border-radius: 999px;
          background: rgba(251, 191, 36, 0.16);
          border: 1px solid rgba(251, 191, 36, 0.28);
          color: #92400e;
          font-size: 11px;
          font-weight: 800;
          line-height: 1.1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          vertical-align: middle;
        }

        .rk-page .rk-achievement-pill.compact {
          max-width: 132px;
          padding: 2px 7px;
          font-size: 10.5px;
        }

        .rk-page .pod-score {
          font-size: 26px;
          font-weight: 900;
          letter-spacing: -0.6px;
          line-height: 1;
        }

        .rk-page .pod-1 .pod-score {
          font-size: 36px;
          background: linear-gradient(135deg, #f59e0b, #ea580c);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .rk-page .pod-2 .pod-score { color: #475569; }
        .rk-page .pod-3 .pod-score { color: #c2410c; }

        .rk-page .pod-unit {
          font-size: 11px;
          color: var(--text-light);
          font-weight: 700;
          margin-top: 4px;
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }

        .rk-page .pod-step {
          margin-top: 18px;
          border-radius: 18px 18px 0 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 50px;
          font-weight: 900;
          width: 100%;
          position: relative;
          overflow: hidden;
          box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.04);
        }

        .rk-page .pod-step::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.9), transparent);
        }

        .rk-page .pod-1 .pod-step {
          background: linear-gradient(180deg, #fde68a, rgba(251, 191, 36, 0.15));
          height: 130px;
          color: rgba(180, 83, 9, 0.8);
        }

        .rk-page .pod-2 .pod-step {
          background: linear-gradient(180deg, #e2e8f0, rgba(148, 163, 184, 0.12));
          height: 100px;
          color: rgba(71, 85, 105, 0.7);
        }

        .rk-page .pod-3 .pod-step {
          background: linear-gradient(180deg, #fed7aa, rgba(251, 146, 60, 0.12));
          height: 80px;
          color: rgba(154, 52, 18, 0.7);
        }

        /* === 我的排名卡 === */
        .rk-page .my-rank-card {
          background: linear-gradient(135deg, #1e1b4b 0%, #4c1d95 50%, #7c3aed 100%);
          border-radius: 32px;
          padding: 32px;
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          color: #fff;
          box-shadow: 0 30px 60px rgba(76, 29, 149, 0.3);
        }

        .rk-page .my-rank-card::before {
          content: '';
          position: absolute;
          top: -40%;
          right: -30%;
          width: 360px;
          height: 360px;
          background: radial-gradient(circle, rgba(251, 191, 36, 0.35), transparent 60%);
          filter: blur(20px);
          pointer-events: none;
          animation: rk-glow-pulse 5s ease-in-out infinite;
        }

        .rk-page .my-rank-card::after {
          content: '';
          position: absolute;
          bottom: -40%;
          left: -20%;
          width: 280px;
          height: 280px;
          background: radial-gradient(circle, rgba(168, 85, 247, 0.35), transparent 60%);
          filter: blur(20px);
          pointer-events: none;
        }

        .rk-page .mr-label {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: #fde047;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 1.5px;
          margin-bottom: 12px;
          position: relative;
          z-index: 1;
          padding: 4px 10px;
          background: rgba(251, 191, 36, 0.15);
          border: 1px solid rgba(251, 191, 36, 0.3);
          border-radius: 999px;
          backdrop-filter: blur(10px);
        }

        .rk-page .mr-label svg { width: 11px; height: 11px; }

        .rk-page .mr-rank-row {
          display: flex;
          align-items: baseline;
          gap: 6px;
          margin-bottom: 28px;
          position: relative;
          z-index: 1;
        }

        .rk-page .mr-hash {
          font-size: 36px;
          font-weight: 900;
          color: rgba(255, 255, 255, 0.5);
        }

        .rk-page .mr-rank {
          font-size: 96px;
          font-weight: 900;
          line-height: 0.9;
          background: linear-gradient(135deg, #fde047, #fb923c);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          letter-spacing: -4px;
          text-shadow: 0 0 60px rgba(251, 191, 36, 0.4);
        }

        .rk-page .mr-rank.mr-rank-empty {
          font-size: 64px;
          letter-spacing: -2px;
        }

        .rk-page .mr-of {
          font-size: 14px;
          color: rgba(255, 255, 255, 0.65);
          font-weight: 600;
          margin-left: 6px;
        }

        .rk-page .mr-stats {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
          position: relative;
          z-index: 1;
        }

        .rk-page .mr-stat {
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.18);
          backdrop-filter: blur(10px);
          border-radius: 14px;
          padding: 12px 14px;
        }

        .rk-page .mr-stat-label {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.65);
          font-weight: 700;
        }

        .rk-page .mr-stat-value {
          font-size: 20px;
          font-weight: 900;
          color: #fff;
          margin-top: 3px;
          letter-spacing: -0.4px;
        }

        .rk-page .mr-stat-value.up { color: #86efac; }
        .rk-page .mr-stat-value.down { color: #fda4af; }

        .rk-page .mr-progress {
          margin-top: 22px;
          position: relative;
          z-index: 1;
        }

        .rk-page .mr-progress-text {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.7);
          font-weight: 600;
          margin-bottom: 8px;
          display: flex;
          justify-content: space-between;
        }

        .rk-page .mr-progress-text strong {
          color: #fde047;
          font-weight: 800;
        }

        .rk-page .mr-progress-track {
          height: 8px;
          background: rgba(255, 255, 255, 0.15);
          border-radius: 999px;
          overflow: hidden;
        }

        .rk-page .mr-progress-bar {
          height: 100%;
          background: linear-gradient(90deg, #fde047, #fb923c, #ec4899);
          border-radius: 999px;
          position: relative;
          box-shadow: 0 0 16px rgba(251, 191, 36, 0.5);
          transition: width 0.8s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .rk-page .mr-progress-bar::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.6), transparent);
          animation: rk-shimmer 2s linear infinite;
        }

        @keyframes rk-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }

        /* === 通用面板卡片 === */
        .rk-page .panel-card {
          background: var(--card-bg);
          backdrop-filter: blur(30px);
          -webkit-backdrop-filter: blur(30px);
          border: 1px solid var(--card-border);
          border-radius: 32px;
          padding: 32px;
          box-shadow: var(--card-shadow), inset 0 1px 0 rgba(255, 255, 255, 1);
        }

        .rk-page .panel-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
          flex-wrap: wrap;
          gap: 12px;
        }

        .rk-page .panel-card-title {
          font-size: 19px;
          font-weight: 800;
          display: flex;
          align-items: center;
          gap: 12px;
          letter-spacing: -0.3px;
          margin: 0;
        }

        .rk-page .panel-card-title .icon-box {
          width: 38px;
          height: 38px;
          border-radius: 12px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: #fff;
          position: relative;
        }

        .rk-page .panel-card-title .icon-box svg { width: 20px; height: 20px; stroke-width: 2.5; }

        .rk-page .panel-card-title.t-purple .icon-box { color: var(--c-purple); box-shadow: 0 10px 18px rgba(139, 92, 246, 0.2); }
        .rk-page .panel-card-title.t-blue .icon-box { color: var(--c-blue); box-shadow: 0 10px 18px rgba(59, 130, 246, 0.2); }
        .rk-page .panel-card-title.t-green .icon-box { color: var(--c-green); box-shadow: 0 10px 18px rgba(16, 185, 129, 0.2); }
        .rk-page .panel-card-title.t-pink .icon-box { color: var(--c-pink); box-shadow: 0 10px 18px rgba(236, 72, 153, 0.2); }
        .rk-page .panel-card-title.t-orange .icon-box { color: var(--c-orange); box-shadow: 0 10px 18px rgba(249, 115, 22, 0.2); }
        .rk-page .panel-card-title.t-amber .icon-box { color: var(--c-amber); box-shadow: 0 10px 18px rgba(251, 191, 36, 0.25); }

        .rk-page .panel-card-title .badge {
          margin-left: 4px;
          padding: 3px 10px;
          background: rgba(15, 23, 42, 0.06);
          color: var(--text-light);
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
        }

        .rk-page .lb-select {
          position: relative;
          display: inline-flex;
        }

        .rk-page .lb-select select {
          appearance: none;
          -webkit-appearance: none;
          padding: 9px 38px 9px 18px;
          background: rgba(255, 255, 255, 0.85);
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 999px;
          font-family: inherit;
          font-size: 13px;
          font-weight: 700;
          color: var(--text-main);
          cursor: pointer;
          outline: none;
          transition: all 0.2s;
        }

        .rk-page .lb-select select:hover {
          background: #fff;
          border-color: rgba(15, 23, 42, 0.15);
        }

        .rk-page .lb-select::after {
          content: '';
          position: absolute;
          right: 14px;
          top: 50%;
          transform: translateY(-25%) rotate(45deg);
          width: 6px;
          height: 6px;
          border-right: 2px solid var(--text-light);
          border-bottom: 2px solid var(--text-light);
          pointer-events: none;
        }

        /* === 排行榜列表 === */
        .rk-page .lb-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .rk-page .lb-row {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px 20px;
          background: rgba(255, 255, 255, 0.55);
          border: 1px solid rgba(255, 255, 255, 0.85);
          border-radius: 18px;
          transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
          position: relative;
          overflow: hidden;
        }

        .rk-page .lb-row::before {
          content: '';
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 3px;
          background: transparent;
          transition: all 0.3s;
        }

        .rk-page .lb-row:hover {
          background: #fff;
          transform: translateX(4px);
          box-shadow: 0 14px 28px rgba(15, 23, 42, 0.06);
        }

        .rk-page .lb-row:hover::before { background: var(--grad-primary); }

        .rk-page .lb-row.r1 { background: linear-gradient(90deg, rgba(251, 191, 36, 0.08), rgba(255, 255, 255, 0.55)); border-color: rgba(251, 191, 36, 0.25); }
        .rk-page .lb-row.r2 { background: linear-gradient(90deg, rgba(148, 163, 184, 0.08), rgba(255, 255, 255, 0.55)); border-color: rgba(148, 163, 184, 0.25); }
        .rk-page .lb-row.r3 { background: linear-gradient(90deg, rgba(251, 146, 60, 0.08), rgba(255, 255, 255, 0.55)); border-color: rgba(251, 146, 60, 0.25); }

        .rk-page .lb-row.me {
          background: linear-gradient(90deg, rgba(168, 85, 247, 0.12), rgba(99, 102, 241, 0.06));
          border-color: rgba(168, 85, 247, 0.35);
          box-shadow: 0 12px 24px rgba(168, 85, 247, 0.1);
        }

        .rk-page .lb-row.me::before { background: var(--grad-primary); }

        .rk-page .lb-row.me .me-tag {
          position: absolute;
          top: 8px;
          right: 12px;
          background: var(--grad-primary);
          color: #fff;
          padding: 2px 10px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 800;
          box-shadow: 0 4px 8px rgba(168, 85, 247, 0.3);
        }

        .rk-page .lb-rank {
          width: 40px;
          height: 40px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 15px;
          font-weight: 900;
          color: var(--text-light);
          background: rgba(15, 23, 42, 0.04);
          flex-shrink: 0;
        }

        .rk-page .lb-rank.r-1 { background: var(--grad-gold); color: #fff; box-shadow: 0 6px 14px rgba(251, 191, 36, 0.4); }
        .rk-page .lb-rank.r-2 { background: var(--grad-silver); color: #1e293b; box-shadow: 0 6px 14px rgba(148, 163, 184, 0.3); }
        .rk-page .lb-rank.r-3 { background: var(--grad-bronze); color: #fff; box-shadow: 0 6px 14px rgba(217, 119, 6, 0.35); }

        .rk-page .lb-rank-medal { font-size: 18px; }

        .rk-page .lb-avatar {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          font-weight: 800;
          color: #fff;
          text-transform: uppercase;
          flex-shrink: 0;
          border: 2px solid #fff;
          box-shadow: 0 4px 10px rgba(15, 23, 42, 0.06);
        }

        .rk-page .lb-avatar.a-1 { background: linear-gradient(135deg, #a8edea, #fed6e3); color: #475569; }
        .rk-page .lb-avatar.a-2 { background: linear-gradient(135deg, #fbcfe8, #fda4af); color: #9f1239; }
        .rk-page .lb-avatar.a-3 { background: linear-gradient(135deg, #c7d2fe, #a5b4fc); color: #3730a3; }
        .rk-page .lb-avatar.a-4 { background: linear-gradient(135deg, #bbf7d0, #86efac); color: #166534; }
        .rk-page .lb-avatar.a-5 { background: linear-gradient(135deg, #fef3c7, #fde68a); color: #92400e; }

        /* 自定义头像图片（覆盖父容器渐变背景，撑满 lb-avatar / pod-avatar / gc-mini-avatar / topbar avatar） */
        .rk-page .rk-avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: inherit;
          display: block;
        }
        .rk-page .lb-avatar:has(.rk-avatar-img),
        .rk-page .pod-avatar:has(.rk-avatar-img),
        .rk-page .gc-mini-avatar:has(.rk-avatar-img),
        .rk-page .user-profile .avatar:has(.rk-avatar-img) {
          background: #fff;
          padding: 0;
          overflow: hidden;
        }

        .rk-page .lb-info { flex: 1; min-width: 0; }

        .rk-page .lb-name {
          font-size: 15px;
          font-weight: 800;
          color: var(--text-main);
          display: flex;
          align-items: center;
          gap: 6px;
          letter-spacing: -0.2px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .rk-page .lb-meta {
          font-size: 12px;
          color: var(--text-light);
          font-weight: 500;
          margin-top: 3px;
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .rk-page .lb-score-wrap {
          text-align: right;
          flex-shrink: 0;
        }

        .rk-page .lb-score {
          font-size: 22px;
          font-weight: 900;
          letter-spacing: -0.5px;
          min-width: 80px;
          line-height: 1;
        }

        .rk-page .lb-row.r1 .lb-score {
          background: linear-gradient(135deg, #f59e0b, #ea580c);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .rk-page .lb-trend {
          font-size: 11px;
          font-weight: 800;
          margin-top: 4px;
          color: var(--text-light);
        }

        /* === 分游戏排行榜 === */
        .rk-page .games-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 18px;
        }

        .rk-page .game-card {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.78), rgba(255, 255, 255, 0.55));
          border: 1px solid rgba(255, 255, 255, 0.9);
          border-radius: 24px;
          padding: 22px 20px 20px;
          transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .rk-page .game-card::before {
          content: '';
          position: absolute;
          top: -40%;
          right: -30%;
          width: 220px;
          height: 220px;
          border-radius: 50%;
          opacity: 0.35;
          transition: opacity 0.3s;
          filter: blur(40px);
          pointer-events: none;
        }

        .rk-page .game-card.t-link::before { background: rgba(59, 130, 246, 0.4); }
        .rk-page .game-card.t-eliminate::before { background: rgba(236, 72, 153, 0.4); }
        .rk-page .game-card.t-memory::before { background: rgba(139, 92, 246, 0.4); }
        .rk-page .game-card.t-whack::before { background: rgba(245, 158, 11, 0.4); }
        .rk-page .game-card.t-roguelite::before { background: rgba(14, 165, 233, 0.4); }
        .rk-page .game-card.t-mines::before { background: rgba(71, 85, 105, 0.4); }
        .rk-page .game-card.t-2048::before { background: rgba(16, 185, 129, 0.4); }
        .rk-page .game-card.t-lucky-td::before { background: rgba(249, 115, 22, 0.4); }
        .rk-page .game-card.t-piano-tiles::before { background: rgba(99, 102, 241, 0.4); }

        .rk-page .game-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 24px 48px rgba(15, 23, 42, 0.08);
          background: rgba(255, 255, 255, 0.95);
        }

        .rk-page .game-card:hover::before { opacity: 0.55; }

        .rk-page .gc-head {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 16px;
          position: relative;
          z-index: 1;
        }

        .rk-page .gc-icon {
          width: 46px;
          height: 46px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #fff;
          flex-shrink: 0;
          position: relative;
        }

        .rk-page .gc-icon svg { width: 22px; height: 22px; stroke-width: 2.5; }

        .rk-page .game-card.t-link .gc-icon { color: var(--c-blue); box-shadow: 0 10px 20px rgba(59, 130, 246, 0.22); }
        .rk-page .game-card.t-eliminate .gc-icon { color: var(--c-pink); box-shadow: 0 10px 20px rgba(236, 72, 153, 0.22); }
        .rk-page .game-card.t-memory .gc-icon { color: var(--c-purple); box-shadow: 0 10px 20px rgba(139, 92, 246, 0.22); }
        .rk-page .game-card.t-whack .gc-icon { color: var(--c-yellow); box-shadow: 0 10px 20px rgba(245, 158, 11, 0.22); }
        .rk-page .game-card.t-roguelite .gc-icon { color: #0284c7; box-shadow: 0 10px 20px rgba(14, 165, 233, 0.22); }
        .rk-page .game-card.t-mines .gc-icon { color: #475569; box-shadow: 0 10px 20px rgba(71, 85, 105, 0.22); }
        .rk-page .game-card.t-2048 .gc-icon { color: #059669; box-shadow: 0 10px 20px rgba(16, 185, 129, 0.22); }
        .rk-page .game-card.t-lucky-td .gc-icon { color: #ea580c; box-shadow: 0 10px 20px rgba(249, 115, 22, 0.22); }
        .rk-page .game-card.t-piano-tiles .gc-icon { color: #4f46e5; box-shadow: 0 10px 20px rgba(99, 102, 241, 0.22); }

        .rk-page .gc-title-wrap { flex: 1; min-width: 0; }

        .rk-page .gc-name {
          font-size: 16px;
          font-weight: 800;
          letter-spacing: -0.2px;
        }

        .rk-page .gc-cap {
          font-size: 10px;
          color: var(--text-light);
          font-weight: 700;
          margin-top: 2px;
          letter-spacing: 0.8px;
          text-transform: uppercase;
        }

        .rk-page .gc-actions {
          margin-left: auto;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 6px;
          flex-shrink: 0;
          min-width: 86px;
        }

        .rk-page .gc-difficulty-select {
          width: 96px;
          height: 28px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.82);
          color: var(--text-main);
          font-size: 11px;
          font-weight: 800;
          line-height: 1;
          padding: 0 24px 0 10px;
          outline: none;
          box-shadow: 0 8px 16px rgba(15, 23, 42, 0.05);
          cursor: pointer;
        }

        .rk-page .gc-difficulty-select:focus {
          border-color: rgba(168, 85, 247, 0.45);
          box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.12);
        }

        .rk-page .gc-metric-tag {
          font-size: 10px;
          font-weight: 800;
          padding: 3px 9px;
          border-radius: 999px;
          background: rgba(15, 23, 42, 0.05);
          color: var(--text-light);
          flex-shrink: 0;
          letter-spacing: 0.3px;
        }

        .rk-page .gc-performance-note {
          position: relative;
          z-index: 1;
          margin: -8px 0 10px;
          color: var(--text-light);
          font-size: 10px;
          line-height: 1.35;
          letter-spacing: 0.05px;
        }

        .rk-page .game-card.t-link .gc-metric-tag { background: rgba(59, 130, 246, 0.1); color: var(--c-blue); }
        .rk-page .game-card.t-eliminate .gc-metric-tag { background: rgba(236, 72, 153, 0.1); color: var(--c-pink); }
        .rk-page .game-card.t-memory .gc-metric-tag { background: rgba(139, 92, 246, 0.1); color: var(--c-purple); }
        .rk-page .game-card.t-whack .gc-metric-tag { background: rgba(245, 158, 11, 0.1); color: var(--c-yellow); }
        .rk-page .game-card.t-roguelite .gc-metric-tag { background: rgba(14, 165, 233, 0.1); color: #0284c7; }
        .rk-page .game-card.t-mines .gc-metric-tag { background: rgba(71, 85, 105, 0.1); color: #475569; }
        .rk-page .game-card.t-2048 .gc-metric-tag { background: rgba(16, 185, 129, 0.1); color: #059669; }
        .rk-page .game-card.t-lucky-td .gc-metric-tag { background: rgba(249, 115, 22, 0.1); color: #c2410c; }
        .rk-page .game-card.t-piano-tiles .gc-metric-tag { background: rgba(99, 102, 241, 0.1); color: #4f46e5; }

        .rk-page .gc-top5 {
          display: flex;
          flex-direction: column;
          gap: 4px;
          position: relative;
          z-index: 1;
        }

        .rk-page .gc-top5-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          border-radius: 11px;
          background: rgba(15, 23, 42, 0.025);
          transition: all 0.2s;
          position: relative;
        }

        .rk-page .gc-top5-row:hover {
          background: rgba(15, 23, 42, 0.06);
          transform: translateX(2px);
        }

        .rk-page .gc-top5-row.r-1 {
          background: linear-gradient(90deg, rgba(251, 191, 36, 0.18), rgba(251, 191, 36, 0.04));
          border: 1px solid rgba(251, 191, 36, 0.28);
          padding: 9px 11px;
        }

        .rk-page .gc-top5-row.r-2 {
          background: linear-gradient(90deg, rgba(148, 163, 184, 0.16), rgba(148, 163, 184, 0.03));
          border: 1px solid rgba(148, 163, 184, 0.22);
        }

        .rk-page .gc-top5-row.r-3 {
          background: linear-gradient(90deg, rgba(251, 146, 60, 0.14), rgba(251, 146, 60, 0.03));
          border: 1px solid rgba(251, 146, 60, 0.22);
        }

        .rk-page .gc-top5-row.is-me {
          background: linear-gradient(90deg, rgba(168, 85, 247, 0.16), rgba(168, 85, 247, 0.04));
          border: 1px solid rgba(168, 85, 247, 0.3);
        }

        .rk-page .gc-top5-row.is-me::after {
          content: '我';
          position: absolute;
          top: 4px;
          right: 6px;
          background: var(--grad-primary);
          color: #fff;
          font-size: 8.5px;
          font-weight: 900;
          padding: 1px 5px;
          border-radius: 999px;
          line-height: 1.4;
          box-shadow: 0 2px 4px rgba(168, 85, 247, 0.3);
        }

        .rk-page .gc-rank {
          width: 22px;
          height: 22px;
          border-radius: 7px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 900;
          color: var(--text-light);
          background: rgba(15, 23, 42, 0.05);
          flex-shrink: 0;
        }

        .rk-page .gc-rank.r-1 { background: var(--grad-gold); color: #fff; box-shadow: 0 3px 6px rgba(251, 191, 36, 0.4); }
        .rk-page .gc-rank.r-2 { background: var(--grad-silver); color: #1e293b; box-shadow: 0 3px 6px rgba(148, 163, 184, 0.3); }
        .rk-page .gc-rank.r-3 { background: var(--grad-bronze); color: #fff; box-shadow: 0 3px 6px rgba(217, 119, 6, 0.35); }

        .rk-page .gc-mini-avatar {
          width: 26px;
          height: 26px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 800;
          color: #fff;
          flex-shrink: 0;
          border: 2px solid #fff;
          box-shadow: 0 3px 6px rgba(15, 23, 42, 0.08);
          text-transform: uppercase;
        }

        .rk-page .gc-mini-avatar.av-1 { background: linear-gradient(135deg, #a8edea, #fed6e3); color: #475569; }
        .rk-page .gc-mini-avatar.av-2 { background: linear-gradient(135deg, #fbcfe8, #fda4af); color: #fff; }
        .rk-page .gc-mini-avatar.av-3 { background: linear-gradient(135deg, #c7d2fe, #a5b4fc); color: #fff; }
        .rk-page .gc-mini-avatar.av-4 { background: linear-gradient(135deg, #bbf7d0, #86efac); color: #166534; }
        .rk-page .gc-mini-avatar.av-5 { background: linear-gradient(135deg, #fef3c7, #fde68a); color: #92400e; }
        .rk-page .gc-mini-avatar.av-6 { background: linear-gradient(135deg, #ddd6fe, #c4b5fd); color: #fff; }

        .rk-page .gc-row-name {
          flex: 1;
          min-width: 0;
          font-size: 12.5px;
          font-weight: 700;
          color: var(--text-main);
          overflow: hidden;
          letter-spacing: -0.1px;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .rk-page .gc-row-name > span:first-child {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .rk-page .gc-top5-row.r-1 .gc-row-name { font-weight: 800; }

        .rk-page .gc-row-score {
          font-size: 13px;
          font-weight: 900;
          color: var(--text-main);
          flex-shrink: 0;
          letter-spacing: -0.3px;
        }

        .rk-page .gc-top5-row.r-1 .gc-row-score {
          color: #b45309;
          font-size: 14px;
        }

        .rk-page .gc-row-score .unit {
          font-size: 10.5px;
          font-weight: 600;
          color: var(--text-light);
          margin-left: 2px;
        }

        .rk-page .gc-top5-row.r-1 .gc-row-score .unit { color: rgba(180, 83, 9, 0.6); }

        .rk-page .gc-empty-full {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 28px 16px;
          background: rgba(15, 23, 42, 0.02);
          border: 1px dashed rgba(15, 23, 42, 0.1);
          border-radius: 14px;
          gap: 8px;
          position: relative;
          z-index: 1;
          flex: 1;
        }

        .rk-page .gc-empty-emoji { font-size: 32px; opacity: 0.5; }
        .rk-page .gc-empty-text { font-size: 12.5px; color: var(--text-light); font-weight: 600; }

        /* === 幸运抽奖榜 === */
        .rk-page .lottery-rank-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .rk-page .lottery-row {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 14px 18px;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0.65));
          border: 1px solid rgba(255, 255, 255, 0.95);
          border-radius: 18px;
          transition: transform 0.25s, box-shadow 0.25s;
        }
        .rk-page .lottery-row:hover {
          transform: translateY(-1px);
          box-shadow: 0 14px 28px rgba(15, 23, 42, 0.07);
        }
        .rk-page .lottery-row.is-me {
          border-color: rgba(168, 85, 247, 0.55);
          background: linear-gradient(180deg, rgba(168, 85, 247, 0.08), rgba(255, 255, 255, 0.7));
        }
        .rk-page .lottery-rank {
          width: 36px;
          height: 36px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          font-weight: 800;
          font-size: 15px;
          flex: 0 0 auto;
        }
        .rk-page .lottery-rank.r-gold { background: var(--grad-gold); box-shadow: 0 8px 16px rgba(245, 158, 11, 0.3); }
        .rk-page .lottery-rank.r-silver { background: var(--grad-silver); box-shadow: 0 8px 16px rgba(100, 116, 139, 0.25); }
        .rk-page .lottery-rank.r-bronze { background: var(--grad-bronze); box-shadow: 0 8px 16px rgba(194, 65, 12, 0.25); }
        .rk-page .lottery-rank.r-default {
          background: linear-gradient(135deg, #cbd5e1, #94a3b8);
          color: #fff;
        }
        .rk-page .lottery-info { flex: 1; min-width: 0; }
        .rk-page .lottery-name {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-main);
          display: flex;
          align-items: center;
          gap: 8px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .rk-page .lottery-name .me-tag {
          font-size: 10px;
          padding: 2px 8px;
          border-radius: 10px;
          color: #fff;
          background: linear-gradient(135deg, #a855f7, #6366f1);
        }
        .rk-page .lottery-meta {
          font-size: 12px;
          color: var(--text-light);
          margin-top: 4px;
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .rk-page .lottery-value {
          display: flex;
          align-items: center;
          gap: 6px;
          font-weight: 800;
          color: var(--c-orange);
          font-size: 15px;
        }
        .rk-page .lottery-value :global(svg) {
          width: 16px;
          height: 16px;
          color: var(--c-amber);
        }

        /* === 历史月榜巅峰 === */
        .rk-page .peak-rank-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .rk-page .peak-row {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
          padding: 10px 12px;
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.74);
          border: 1px solid rgba(255, 255, 255, 0.82);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .rk-page .peak-row:hover {
          transform: translateY(-1px);
          box-shadow: 0 10px 22px rgba(15, 23, 42, 0.06);
        }

        .rk-page .peak-row.is-me {
          border-color: rgba(249, 115, 22, 0.45);
          background: rgba(255, 247, 237, 0.9);
        }

        .rk-page .peak-rank {
          width: 30px;
          height: 30px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          font-size: 12px;
          font-weight: 900;
          flex: 0 0 auto;
        }

        .rk-page .peak-rank.r-1 { background: var(--grad-gold); }
        .rk-page .peak-rank.r-2 { background: var(--grad-silver); }
        .rk-page .peak-rank.r-3 { background: var(--grad-bronze); }
        .rk-page .peak-rank.r-default { background: linear-gradient(135deg, #cbd5e1, #94a3b8); }

        .rk-page .peak-avatar {
          width: 34px;
          height: 34px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          font-weight: 900;
          color: #fff;
          flex: 0 0 auto;
        }

        .rk-page .peak-info {
          min-width: 0;
          flex: 1;
        }

        .rk-page .peak-name {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
          color: var(--text-main);
          font-size: 13px;
          font-weight: 800;
        }

        .rk-page .peak-name > span:first-child {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .rk-page .peak-meta {
          margin-top: 2px;
          color: var(--text-light);
          font-size: 10.5px;
          font-weight: 650;
        }

        .rk-page .peak-score {
          flex: 0 0 auto;
          display: flex;
          min-width: 96px;
          align-items: baseline;
          justify-content: flex-end;
          gap: 2px;
          color: var(--c-orange);
          font-size: 14px;
          font-weight: 950;
          letter-spacing: 0;
        }

        .rk-page .peak-score span {
          color: var(--text-light);
          font-size: 10px;
          font-weight: 700;
        }

        .rk-page .peak-empty {
          padding: 18px 12px;
          border-radius: 14px;
        }

        /* === 历史结算 === */
        .rk-page .history-list {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 14px;
        }

        .rk-page .hist-row {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 18px 20px;
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.7), rgba(255, 255, 255, 0.5));
          border: 1px solid rgba(255, 255, 255, 0.85);
          border-radius: 20px;
          transition: all 0.25s ease;
          position: relative;
          overflow: hidden;
        }

        .rk-page .hist-row:hover {
          background: #fff;
          transform: translateX(4px);
          box-shadow: 0 14px 28px rgba(15, 23, 42, 0.06);
        }

        .rk-page .hist-week {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 64px;
          height: 64px;
          border-radius: 16px;
          background: linear-gradient(135deg, #ec4899, #f43f5e);
          color: #fff;
          flex-shrink: 0;
          box-shadow: 0 10px 20px rgba(236, 72, 153, 0.25);
          position: relative;
          z-index: 1;
        }

        .rk-page .hist-row.hist-partial .hist-week { background: linear-gradient(135deg, #fb923c, #c2410c); box-shadow: 0 10px 20px rgba(194, 65, 12, 0.25); }
        .rk-page .hist-row.hist-failed .hist-week { background: linear-gradient(135deg, #94a3b8, #64748b); box-shadow: 0 10px 20px rgba(100, 116, 139, 0.25); }

        .rk-page .hist-week .w-num {
          font-size: 20px;
          font-weight: 900;
          line-height: 1;
        }

        .rk-page .hist-week .w-num svg { width: 22px; height: 22px; }

        .rk-page .hist-week .w-label {
          font-size: 9px;
          font-weight: 800;
          margin-top: 3px;
          letter-spacing: 1px;
          opacity: 0.9;
        }

        .rk-page .hist-info {
          flex: 1;
          min-width: 0;
          position: relative;
          z-index: 1;
        }

        .rk-page .hist-title {
          font-size: 15px;
          font-weight: 800;
          margin-bottom: 5px;
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          letter-spacing: -0.2px;
        }

        .rk-page .hist-status {
          font-size: 10px;
          font-weight: 800;
          padding: 2px 9px;
          border-radius: 999px;
          letter-spacing: 0.3px;
          background: rgba(16, 185, 129, 0.12);
          color: var(--c-green);
        }

        .rk-page .hist-status-partial { background: rgba(249, 115, 22, 0.14); color: var(--c-orange); }
        .rk-page .hist-status-failed { background: rgba(244, 63, 94, 0.12); color: var(--c-red); }

        .rk-page .hist-meta {
          font-size: 11.5px;
          color: var(--text-light);
          font-weight: 500;
        }

        .rk-page .hist-prize {
          text-align: right;
          flex-shrink: 0;
          position: relative;
          z-index: 1;
        }

        .rk-page .hist-prize .p-num {
          font-size: 19px;
          font-weight: 900;
          color: var(--c-orange);
          letter-spacing: -0.4px;
          display: flex;
          align-items: center;
          gap: 4px;
          justify-content: flex-end;
        }

        .rk-page .hist-prize .p-num svg { width: 14px; height: 14px; }

        .rk-page .hist-prize .p-label {
          font-size: 10.5px;
          color: var(--text-light);
          font-weight: 700;
          margin-top: 3px;
          letter-spacing: 0.3px;
        }

        /* === 响应式 === */
        @media (max-width: 1280px) {
          .rk-page .topbar { padding: 14px 32px; }
          .rk-page .container { padding: 24px 32px 48px; }
          .rk-page .header-left .section-title { font-size: 28px; }
          .rk-page .games-grid { grid-template-columns: repeat(2, 1fr); }
          .rk-page .pod-1 .pod-avatar { width: 110px; height: 110px; font-size: 42px; }
          .rk-page .pod-avatar { width: 88px; height: 88px; font-size: 34px; }
          .rk-page .pod-empty-text { height: 88px; }
          .rk-page .pod-1 .pod-empty-text { height: 110px; }
          .rk-page .hero-title { font-size: 36px; }
        }

        @media (max-width: 992px) {
          .rk-page .topbar { padding: 12px 24px; }
          .rk-page .user-info { display: none; }
          .rk-page .user-profile { padding: 4px; }
          .rk-page .rules-hero { grid-template-columns: 1fr; padding: 28px; }
          .rk-page .rules-hero-panel { min-height: 130px; }
          .rk-page .rules-body { grid-template-columns: 1fr; max-height: calc(90vh - 260px); }
          .rk-page .rules-index {
            position: static;
            min-height: 0;
            padding: 16px 18px;
            border-right: 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          }
          .rk-page .rules-index nav { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .rk-page .rules-index-foot { display: none; }

          .rk-page .container { padding: 20px 24px 48px; gap: 18px; padding-bottom: max(48px, calc(24px + env(safe-area-inset-bottom))); }

          .rk-page .season-hero { padding: 28px 24px; border-radius: 28px; }
          .rk-page .hero-title { font-size: 30px; }
          .rk-page .hero-content { gap: 24px; }
          .rk-page .countdown { width: 100%; justify-content: center; }

          .rk-page .header-left .section-title { font-size: 24px; }
          .rk-page .header-subtitle { font-size: 13px; }

          .rk-page .top-grid { grid-template-columns: 1fr; gap: 18px; }

          .rk-page .podium-section { padding: 28px 24px; }
          .rk-page .panel-card { padding: 24px; border-radius: 28px; }
          .rk-page .my-rank-card { padding: 28px 24px; }
          .rk-page .mr-rank { font-size: 80px; }

          .rk-page .history-list { grid-template-columns: 1fr; }
        }

        @media (max-width: 640px) {
          .rk-page .topbar { padding: 10px 16px; gap: 12px; }
          .rk-page .brand { font-size: 18px; }
          .rk-page .brand-icon { width: 32px; height: 32px; border-radius: 10px; }
          .rk-page .brand-icon svg { width: 18px; height: 18px; }
          .rk-page .user-profile .avatar { width: 32px; height: 32px; font-size: 12px; }
          .rk-page .topbar-right { gap: 8px; }
          .rk-page .rules-overlay { padding: 10px; align-items: center; }
          .rk-page .rules-modal {
            max-height: 92vh;
            padding: 0;
            border-radius: 22px;
          }
          .rk-page .rules-hero { padding: 22px 22px 24px; }
          .rk-page .rules-hero-panel { display: none; }
          .rk-page .rules-hero h2 { font-size: 28px; }
          .rk-page .rules-hero h2 span { font-size: 14px; }
          .rk-page .rules-hero p { font-size: 12.5px; line-height: 1.7; }
          .rk-page .rules-hero-tags { margin-top: 14px; }
          .rk-page .rules-hero-tags span { font-size: 10.5px; padding: 6px 9px; }
          .rk-page .rules-body { max-height: calc(92vh - 220px); }
          .rk-page .rules-index { display: none; }
          .rk-page .rules-stack { padding: 14px; gap: 12px; }
          .rk-page .rules-card {
            grid-template-columns: 48px minmax(0, 1fr);
            padding: 0;
            border-radius: 16px;
          }
          .rk-page .rules-card-number { padding-top: 16px; font-size: 14px; }
          .rk-page .rules-card-content { padding: 16px 14px 16px 14px; }
          .rk-page .rules-card h3 { font-size: 16px; }
          .rk-page .rules-card-summary { font-size: 12.5px; padding: 9px 11px; }
          .rk-page .rules-card li { font-size: 12.5px; line-height: 1.8; }
          .rk-page .rules-notes { padding: 16px 18px; }
          .rk-page .rules-close {
            top: 14px;
            right: 14px;
            width: 38px;
            height: 38px;
            border-radius: 13px;
          }

          .rk-page .container { padding: 16px 16px 40px; gap: 16px; }

          .rk-page .season-hero { padding: 24px 18px; border-radius: 24px; }
          .rk-page .hero-badge { font-size: 11px; padding: 5px 12px; margin-bottom: 12px; }
          .rk-page .hero-title { font-size: 24px; letter-spacing: -1px; }
          .rk-page .hero-sub { font-size: 13px; }
          .rk-page .hero-stats { gap: 12px; margin-top: 16px; }
          .rk-page .hero-stat { padding: 10px 14px; min-width: 0; flex: 1; }
          .rk-page .hero-stat-val { font-size: 18px; }
          .rk-page .countdown { gap: 6px; }
          .rk-page .cd-box { padding: 10px 12px; min-width: 50px; }
          .rk-page .cd-num { font-size: 24px; }
          .rk-page .cd-unit { font-size: 9px; }

          .rk-page .page-header { gap: 12px; align-items: flex-start; }
          .rk-page .header-left .section-title { font-size: 20px; gap: 10px; }
          .rk-page .header-left .section-title svg { width: 24px; height: 24px; }
          .rk-page .btn-icon { width: 38px; height: 38px; }

          .rk-page .podium-section { padding: 22px 16px; border-radius: 24px; }
          .rk-page .podium-header { margin-bottom: 22px; }
          .rk-page .podium-title { font-size: 16px; }
          .rk-page .podium-title .crown-icon { width: 36px; height: 36px; }
          .rk-page .pd-tab { padding: 7px 14px; font-size: 12px; }

          .rk-page .podium { gap: 8px; padding-top: 28px; }
          .rk-page .pod-avatar { width: 64px; height: 64px; font-size: 26px; border-radius: 20px; border-width: 4px; }
          .rk-page .pod-1 .pod-avatar { width: 84px; height: 84px; font-size: 32px; border-radius: 24px; }
          .rk-page .pod-empty-text { height: 64px; font-size: 12px; }
          .rk-page .pod-1 .pod-empty-text { height: 84px; font-size: 14px; }
          .rk-page .pod-rank-badge { width: 30px; height: 30px; font-size: 13px; margin-bottom: -15px; }
          .rk-page .pod-name { font-size: 13px; margin-top: 12px; }
          .rk-page .pod-1 .pod-name { font-size: 16px; }
          .rk-page .pod-name-sub { font-size: 10px; }
          .rk-page .pod-score { font-size: 18px; }
          .rk-page .pod-1 .pod-score { font-size: 24px; }
          .rk-page .pod-unit { font-size: 10px; }
          .rk-page .pod-1 .pod-step { height: 80px; font-size: 36px; }
          .rk-page .pod-2 .pod-step { height: 64px; font-size: 28px; }
          .rk-page .pod-3 .pod-step { height: 52px; font-size: 24px; }

          .rk-page .my-rank-card { padding: 22px 18px; border-radius: 24px; }
          .rk-page .mr-rank { font-size: 64px; letter-spacing: -3px; }
          .rk-page .mr-hash { font-size: 28px; }
          .rk-page .mr-stat { padding: 10px 12px; }
          .rk-page .mr-stat-value { font-size: 16px; }

          .rk-page .panel-card { padding: 20px; border-radius: 24px; }
          .rk-page .panel-card-header { margin-bottom: 16px; }
          .rk-page .panel-card-title { font-size: 16px; }
          .rk-page .panel-card-title .icon-box { width: 34px; height: 34px; }

          .rk-page .lb-row { padding: 12px 14px; gap: 12px; border-radius: 14px; }
          .rk-page .lb-rank { width: 36px; height: 36px; font-size: 14px; border-radius: 10px; }
          .rk-page .lb-avatar { width: 38px; height: 38px; font-size: 14px; }
          .rk-page .lb-name { font-size: 13.5px; }
          .rk-page .lb-meta { font-size: 11px; gap: 6px; }
          .rk-page .lb-score { font-size: 18px; min-width: 60px; }

          .rk-page .games-grid { grid-template-columns: 1fr; gap: 10px; }
          .rk-page .game-card { padding: 18px; border-radius: 18px; }
          .rk-page .gc-icon { width: 38px; height: 38px; border-radius: 12px; }
          .rk-page .gc-name { font-size: 15px; }
          .rk-page .gc-actions { min-width: 78px; gap: 5px; }
          .rk-page .gc-difficulty-select {
            width: 86px;
            height: 26px;
            font-size: 10.5px;
            padding-left: 9px;
            padding-right: 20px;
          }

          .rk-page .hist-row { padding: 14px 16px; gap: 12px; border-radius: 16px; }
          .rk-page .hist-week { width: 56px; height: 56px; }
          .rk-page .hist-week .w-num { font-size: 17px; }
          .rk-page .hist-title { font-size: 14px; }
          .rk-page .hist-meta { font-size: 11px; }
          .rk-page .hist-prize .p-num { font-size: 16px; }
          .rk-page .peak-row { padding: 9px 10px; gap: 9px; }
          .rk-page .peak-score { min-width: 82px; font-size: 13px; }
        }

        @media (max-width: 480px) {
          .rk-page .hero-stats { flex-direction: column; }
          .rk-page .hero-stat { width: 100%; }
          .rk-page .pod-avatar { width: 56px; height: 56px; font-size: 22px; }
          .rk-page .pod-1 .pod-avatar { width: 72px; height: 72px; font-size: 28px; }
          .rk-page .pod-empty-text { height: 56px; font-size: 11px; }
          .rk-page .pod-1 .pod-empty-text { height: 72px; font-size: 13px; }
          .rk-page .mr-rank { font-size: 56px; }
        }

        /* === 手机端重排 v2：窄屏以阅读效率优先 === */
        @media (max-width: 640px) {
          .rk-page {
            overflow-x: clip;
            background-color: #f6f8fc;
          }

          .rk-page .mesh-bg {
            opacity: 0.72;
            filter: blur(42px);
          }

          .rk-page .topbar {
            position: sticky;
            top: max(8px, env(safe-area-inset-top));
            width: calc(100% - 24px);
            margin: 8px auto 0;
            padding: 8px 10px;
            border: 1px solid rgba(255, 255, 255, 0.9);
            border-radius: 22px;
            background: rgba(255, 255, 255, 0.86);
            box-shadow: 0 16px 36px rgba(15, 23, 42, 0.12);
          }

          .rk-page .brand {
            min-width: 0;
            gap: 8px;
            font-size: 16px;
            letter-spacing: 0;
          }

          .rk-page .brand-icon {
            width: 34px;
            height: 34px;
            border-radius: 13px;
          }

          .rk-page .topbar-right {
            min-width: 0;
            gap: 6px;
          }

          .rk-page .btn-icon {
            width: 36px;
            height: 36px;
            border-radius: 14px;
            flex: 0 0 auto;
            background: rgba(255, 255, 255, 0.92);
          }

          .rk-page .btn-icon svg {
            width: 17px;
            height: 17px;
          }

          .rk-page .user-profile {
            width: 36px;
            height: 36px;
            justify-content: center;
            padding: 0;
            border-radius: 14px;
            background: rgba(255, 255, 255, 0.92);
          }

          .rk-page .user-profile .avatar {
            width: 32px;
            height: 32px;
            border-radius: 12px;
          }

          .rk-page .container {
            width: 100%;
            padding: 14px 12px max(32px, calc(22px + env(safe-area-inset-bottom)));
            gap: 14px;
          }

          .rk-page .season-hero {
            padding: 18px 14px;
            border-radius: 22px;
            background:
              linear-gradient(
                180deg,
                rgba(15, 12, 40, 0.82) 0%,
                rgba(30, 27, 75, 0.72) 54%,
                rgba(76, 29, 149, 0.62) 100%
              ),
              url('/images-optimized/ui/rankings/hero.webp') center / cover no-repeat,
              linear-gradient(135deg, #1e1b4b, #7c3aed);
            box-shadow: 0 18px 34px rgba(76, 29, 149, 0.28);
          }

          .rk-page .season-hero::after,
          .rk-page .stars {
            display: none;
          }

          .rk-page .hero-content {
            display: grid;
            grid-template-columns: 1fr;
            gap: 16px;
          }

          .rk-page .hero-text {
            min-width: 0;
          }

          .rk-page .hero-badge {
            max-width: 100%;
            margin-bottom: 10px;
            padding: 5px 10px;
            font-size: 10.5px;
            letter-spacing: 0;
            white-space: normal;
          }

          .rk-page .hero-title {
            margin-bottom: 8px;
            font-size: 26px;
            line-height: 1.12;
            letter-spacing: 0;
          }

          .rk-page .hero-sub {
            max-width: none;
            margin: 0;
            font-size: 12.5px;
            line-height: 1.65;
          }

          .rk-page .hero-stats {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px;
            margin-top: 14px;
          }

          .rk-page .hero-stat {
            width: auto;
            min-width: 0;
            padding: 9px 8px;
            border-radius: 14px;
          }

          .rk-page .hero-stat-label {
            font-size: 10px;
            letter-spacing: 0;
            white-space: nowrap;
          }

          .rk-page .hero-stat-val {
            min-width: 0;
            font-size: 16px;
            letter-spacing: 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .rk-page .hero-countdown-wrap {
            width: 100%;
            min-width: 0;
          }

          .rk-page .hero-countdown-label {
            margin-bottom: 8px;
            font-size: 10px;
            letter-spacing: 0.5px;
            text-align: left;
          }

          .rk-page .countdown {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            width: 100%;
            gap: 7px;
          }

          .rk-page .cd-colon {
            display: none;
          }

          .rk-page .cd-box {
            min-width: 0;
            padding: 10px 4px;
            border-radius: 14px;
          }

          .rk-page .cd-num {
            font-size: 22px;
            letter-spacing: 0;
          }

          .rk-page .cd-unit {
            font-size: 9px;
            letter-spacing: 0;
          }

          .rk-page .page-header {
            align-items: center;
            padding: 0 2px;
          }

          .rk-page .header-left {
            min-width: 0;
          }

          .rk-page .header-left .section-title {
            font-size: 19px;
            line-height: 1.2;
            letter-spacing: 0;
          }

          .rk-page .header-subtitle {
            max-width: 260px;
            font-size: 12px;
            line-height: 1.5;
          }

          .rk-page .top-grid {
            gap: 14px;
          }

          .rk-page .podium-section,
          .rk-page .my-rank-card,
          .rk-page .panel-card {
            border-radius: 22px;
            box-shadow: 0 16px 34px rgba(15, 23, 42, 0.08);
          }

          .rk-page .podium-section {
            padding: 16px 12px 12px;
          }

          .rk-page .podium-header {
            margin-bottom: 12px;
            align-items: center;
            gap: 10px;
          }

          .rk-page .podium-title {
            min-width: 0;
            gap: 8px;
            font-size: 15px;
            letter-spacing: 0;
          }

          .rk-page .podium-title .crown-icon {
            width: 34px;
            height: 34px;
            border-radius: 12px;
            flex: 0 0 auto;
          }

          .rk-page .podium-tabs {
            margin-left: auto;
            padding: 3px;
          }

          .rk-page .pd-tab {
            min-height: 32px;
            padding: 6px 12px;
            font-size: 12px;
          }

          .rk-page .podium {
            display: grid;
            grid-template-columns: 1fr;
            gap: 8px;
            padding-top: 0;
            align-items: stretch;
          }

          .rk-page .pod {
            display: grid;
            grid-template-columns: 32px 44px minmax(0, 1fr) auto;
            grid-template-areas:
              "rank avatar name score"
              "rank avatar meta unit";
            align-items: center;
            gap: 4px 10px;
            min-width: 0;
            padding: 11px 12px;
            border: 1px solid rgba(255, 255, 255, 0.9);
            border-radius: 17px;
            background: rgba(255, 255, 255, 0.72);
            text-align: left;
          }

          .rk-page .pod-1 { order: 1; }
          .rk-page .pod-2 { order: 2; }
          .rk-page .pod-3 { order: 3; }

          .rk-page .pod-1::after,
          .rk-page .pod-1 .pod-avatar-wrap::before,
          .rk-page .pod-step {
            display: none;
          }

          .rk-page .pod-rank-badge {
            grid-area: rank;
            width: 30px;
            height: 30px;
            margin: 0;
            border-width: 3px;
            font-size: 13px;
          }

          .rk-page .pod-avatar-wrap {
            grid-area: avatar;
            width: 44px;
            height: 44px;
          }

          .rk-page .pod-avatar,
          .rk-page .pod-1 .pod-avatar {
            width: 44px;
            height: 44px;
            border-width: 3px;
            border-radius: 15px;
            font-size: 18px;
          }

          .rk-page .pod-name,
          .rk-page .pod-1 .pod-name {
            grid-area: name;
            max-width: none;
            margin: 0;
            font-size: 14px;
            letter-spacing: 0;
          }

          .rk-page .pod .rk-achievement-pill {
            grid-area: meta;
            justify-self: flex-start;
            max-width: 136px;
          }

          .rk-page .pod-name-sub {
            display: none;
          }

          .rk-page .pod-score,
          .rk-page .pod-1 .pod-score {
            grid-area: score;
            justify-self: end;
            max-width: 96px;
            font-size: 18px;
            letter-spacing: 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .rk-page .pod-unit {
            grid-area: unit;
            justify-self: end;
            margin: 0;
            font-size: 10px;
            letter-spacing: 0;
          }

          .rk-page .pod-empty {
            grid-template-areas: "rank avatar name score";
          }

          .rk-page .pod-empty-text,
          .rk-page .pod-1 .pod-empty-text {
            grid-area: name;
            height: auto;
            justify-content: flex-start;
            margin: 0;
            font-size: 13px;
            letter-spacing: 0;
          }

          .rk-page .my-rank-card {
            padding: 18px 14px;
          }

          .rk-page .mr-label {
            margin-bottom: 10px;
            letter-spacing: 0;
          }

          .rk-page .mr-rank-row {
            margin-bottom: 16px;
            align-items: flex-end;
            flex-wrap: wrap;
          }

          .rk-page .mr-hash {
            font-size: 24px;
          }

          .rk-page .mr-rank,
          .rk-page .mr-rank.mr-rank-empty {
            font-size: 52px;
            line-height: 0.95;
            letter-spacing: 0;
          }

          .rk-page .mr-of {
            width: 100%;
            margin-left: 0;
            font-size: 12px;
          }

          .rk-page .mr-stats {
            gap: 8px;
          }

          .rk-page .mr-stat {
            min-width: 0;
            padding: 10px;
            border-radius: 13px;
          }

          .rk-page .mr-stat-label {
            font-size: 10.5px;
          }

          .rk-page .mr-stat-value {
            font-size: 16px;
            letter-spacing: 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .rk-page .mr-progress-text {
            gap: 12px;
            font-size: 11px;
          }

          .rk-page .panel-card {
            padding: 16px 12px;
          }

          .rk-page .panel-card-header {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            align-items: center;
            gap: 10px;
            margin-bottom: 12px;
          }

          .rk-page .panel-card-title {
            min-width: 0;
            gap: 8px;
            font-size: 15px;
            line-height: 1.25;
            letter-spacing: 0;
          }

          .rk-page .panel-card-title .icon-box {
            width: 32px;
            height: 32px;
            border-radius: 11px;
            flex: 0 0 auto;
          }

          .rk-page .panel-card-title .icon-box svg {
            width: 17px;
            height: 17px;
          }

          .rk-page .panel-card-title .badge {
            max-width: 92px;
            margin-left: 0;
            padding: 3px 8px;
            font-size: 10px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .rk-page .lb-select {
            justify-self: end;
            max-width: 120px;
          }

          .rk-page .lb-select select {
            width: 100%;
            min-height: 34px;
            padding: 7px 30px 7px 12px;
            font-size: 12px;
          }

          .rk-page .lb-select::after {
            right: 12px;
          }

          .rk-page .lb-list,
          .rk-page .peak-rank-list,
          .rk-page .lottery-rank-list {
            gap: 7px;
          }

          .rk-page .lb-row {
            display: grid;
            grid-template-columns: 34px 38px minmax(0, 1fr) minmax(54px, auto);
            gap: 8px;
            align-items: center;
            min-width: 0;
            padding: 10px 10px 10px 12px;
            border-radius: 16px;
          }

          .rk-page .lb-row:hover,
          .rk-page .hist-row:hover {
            transform: none;
          }

          .rk-page .lb-rank {
            width: 34px;
            height: 34px;
            border-radius: 11px;
            font-size: 13px;
          }

          .rk-page .lb-rank-medal {
            font-size: 15px;
          }

          .rk-page .lb-avatar {
            width: 38px;
            height: 38px;
            font-size: 13px;
          }

          .rk-page .lb-info {
            min-width: 0;
          }

          .rk-page .lb-name {
            display: block;
            min-width: 0;
            font-size: 13px;
            letter-spacing: 0;
          }

          .rk-page .lb-meta {
            gap: 5px;
            margin-top: 3px;
            font-size: 10.5px;
            line-height: 1.35;
          }

          .rk-page .lb-meta > span:first-child {
            max-width: 92px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .rk-page .rk-achievement-pill,
          .rk-page .rk-achievement-pill.compact {
            max-width: 112px;
            font-size: 10px;
          }

          .rk-page .lb-score-wrap {
            min-width: 0;
            text-align: right;
          }

          .rk-page .lb-score {
            min-width: 0;
            max-width: 86px;
            font-size: 17px;
            letter-spacing: 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .rk-page .lb-trend {
            font-size: 10px;
          }

          .rk-page .lb-row.me .me-tag {
            top: 5px;
            right: 7px;
            padding: 1px 7px;
            font-size: 9px;
          }

          .rk-page .peak-row {
            display: grid;
            grid-template-columns: 32px 36px minmax(0, 1fr) 74px;
            gap: 8px;
            padding: 10px;
            border-radius: 16px;
          }

          .rk-page .peak-rank {
            width: 32px;
            height: 32px;
            border-radius: 11px;
          }

          .rk-page .peak-avatar {
            width: 36px;
            height: 36px;
            border-radius: 12px;
          }

          .rk-page .peak-name {
            display: block;
            font-size: 12.5px;
          }

          .rk-page .peak-name > span:first-child {
            display: block;
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .rk-page .peak-meta {
            max-width: 116px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .rk-page .peak-score {
            min-width: 0;
            max-width: 78px;
            flex-direction: column;
            align-items: flex-end;
            gap: 1px;
            font-size: 13px;
            line-height: 1.15;
            white-space: nowrap;
          }

          .rk-page .peak-score span {
            font-size: 9.5px;
          }

          .rk-page .lottery-row {
            display: grid;
            grid-template-columns: 34px minmax(0, 1fr) minmax(58px, auto);
            gap: 9px;
            padding: 11px 10px;
            border-radius: 16px;
          }

          .rk-page .lottery-rank {
            width: 34px;
            height: 34px;
            border-radius: 11px;
            font-size: 13px;
          }

          .rk-page .lottery-name {
            display: block;
            font-size: 13px;
          }

          .rk-page .lottery-meta {
            gap: 5px;
            font-size: 10.5px;
            line-height: 1.35;
          }

          .rk-page .lottery-value {
            justify-content: flex-end;
            min-width: 0;
            max-width: 82px;
            gap: 4px;
            font-size: 13px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .rk-page .lottery-value :global(svg) {
            width: 13px;
            height: 13px;
            flex: 0 0 auto;
          }

          .rk-page .games-grid {
            grid-template-columns: 1fr;
            gap: 10px;
          }

          .rk-page .game-card {
            padding: 14px 12px;
            border-radius: 18px;
          }

          .rk-page .gc-head {
            gap: 9px;
            margin-bottom: 12px;
          }

          .rk-page .gc-icon {
            width: 34px;
            height: 34px;
            border-radius: 12px;
          }

          .rk-page .gc-name {
            font-size: 14px;
          }

          .rk-page .gc-cap {
            font-size: 10.5px;
          }

          .rk-page .gc-actions {
            min-width: 74px;
            gap: 4px;
          }

          .rk-page .gc-difficulty-select {
            width: 82px;
            height: 25px;
            font-size: 10px;
            padding-left: 8px;
            padding-right: 18px;
          }

          .rk-page .gc-metric-tag {
            max-width: 70px;
            padding: 4px 7px;
            font-size: 9.5px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .rk-page .gc-top5-row {
            display: grid;
            grid-template-columns: 24px 28px minmax(0, 1fr) minmax(48px, auto);
            gap: 7px;
            padding: 8px;
            border-radius: 12px;
          }

          .rk-page .gc-top5-row.r-1 {
            padding: 8px;
          }

          .rk-page .gc-rank {
            width: 24px;
            height: 24px;
          }

          .rk-page .gc-mini-avatar {
            width: 28px;
            height: 28px;
            font-size: 10px;
          }

          .rk-page .gc-row-name {
            display: block;
            font-size: 12px;
            letter-spacing: 0;
          }

          .rk-page .gc-row-name > span:first-child {
            display: block;
          }

          .rk-page .gc-row-name .rk-achievement-pill {
            margin-top: 3px;
          }

          .rk-page .gc-row-score,
          .rk-page .gc-top5-row.r-1 .gc-row-score {
            min-width: 0;
            max-width: 70px;
            text-align: right;
            font-size: 12.5px;
            letter-spacing: 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .rk-page .gc-row-score .unit {
            display: block;
            margin-left: 0;
            font-size: 9.5px;
          }

          .rk-page .rk-empty {
            padding: 20px 10px;
            font-size: 12px;
          }

          .rk-page .rules-overlay {
            padding: 10px;
          }

          .rk-page .rules-modal {
            width: min(100%, 430px);
            border-radius: 24px;
          }

          .rk-page .rules-hero {
            padding: 22px 18px 20px;
          }

          .rk-page .rules-hero h2 {
            padding-right: 44px;
            font-size: 26px;
            letter-spacing: 0;
          }

          .rk-page .rules-close {
            top: 12px;
            right: 12px;
          }

          .rk-page .rules-body {
            max-height: calc(92vh - 208px);
          }
        }

        @media (max-width: 480px) {
          .rk-page .hero-stats {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .rk-page .panel-card-header {
            grid-template-columns: 1fr;
          }

          .rk-page .lb-select {
            justify-self: stretch;
            max-width: none;
          }

          .rk-page .panel-card-title .badge {
            max-width: 110px;
          }

          .rk-page .lb-row {
            grid-template-columns: 32px 34px minmax(0, 1fr) minmax(48px, auto);
            padding: 10px 9px;
          }

          .rk-page .lb-rank {
            width: 32px;
            height: 32px;
          }

          .rk-page .lb-avatar {
            width: 34px;
            height: 34px;
          }

          .rk-page .lb-score {
            max-width: 68px;
            font-size: 16px;
          }

          .rk-page .lb-meta > span:first-child,
          .rk-page .peak-meta {
            max-width: 88px;
          }

          .rk-page .rk-achievement-pill,
          .rk-page .rk-achievement-pill.compact {
            max-width: 96px;
          }

          .rk-page .pod {
            grid-template-columns: 30px 40px minmax(0, 1fr) minmax(54px, auto);
            padding: 10px;
          }

          .rk-page .pod-avatar-wrap,
          .rk-page .pod-avatar,
          .rk-page .pod-1 .pod-avatar {
            width: 40px;
            height: 40px;
          }

          .rk-page .pod-score,
          .rk-page .pod-1 .pod-score {
            max-width: 72px;
            font-size: 16px;
          }

          .rk-page .mr-stats {
            grid-template-columns: 1fr 1fr;
          }

          .rk-page .peak-row {
            grid-template-columns: 30px 34px minmax(0, 1fr) 62px;
            padding: 9px;
          }

          .rk-page .peak-rank {
            width: 30px;
            height: 30px;
          }

          .rk-page .peak-avatar {
            width: 34px;
            height: 34px;
          }

          .rk-page .peak-score {
            max-width: 62px;
          }

          .rk-page .gc-metric-tag {
            display: none;
          }

          .rk-page .rules-card {
            grid-template-columns: 40px minmax(0, 1fr);
          }
        }
      `}</style>
    </div>
  );
}

interface PodiumPlaceProps {
  place: 1 | 2 | 3;
  entry: PointsEntry | null;
}

function PodiumPlace({ place, entry }: PodiumPlaceProps) {
  const placeClass = `pod-${place}`;
  if (!entry) {
    // 虚位以待占位：仅保留排名徽章、"虚位以待"文字与台阶，不渲染头像
    return (
      <div className={`pod ${placeClass} pod-empty`}>
        <div className="pod-rank-badge">{place}</div>
        <div className="pod-empty-text">虚位以待</div>
        <div className="pod-step">{place}</div>
      </div>
    );
  }
  return (
    <div className={`pod ${placeClass}`}>
      <div className="pod-rank-badge">{place}</div>
      <div className="pod-avatar-wrap">
        <div className="pod-avatar">{renderAvatarContent(entry)}</div>
      </div>
      <div className="pod-name">{resolveDisplayName(entry)}</div>
      <AchievementPill achievement={entry.equippedAchievement} />
      <div className="pod-name-sub">用户 ID #{entry.userId}</div>
      <div className="pod-score">{formatNumber(entry.points)}</div>
      <div className="pod-unit">积分</div>
      <div className="pod-step">{place}</div>
    </div>
  );
}

interface GameCardProps {
  group: GameRankingGroup;
  myUserId: number | null;
}

function GameCard({ group, myUserId }: GameCardProps) {
  const themeClass = GAME_THEME[group.gameType] ?? '';
  const filterKind = group.gameType === 'lucky_td' ? '地图' : group.gameType === 'piano-tiles' ? '模式和星级' : '难度';
  const defaultDifficulty = group.selectedDifficulty
    ?? group.difficultyOptions?.[0]?.value
    ?? '';
  const [selectedDifficulty, setSelectedDifficulty] = useState(defaultDifficulty);
  const hasDifficultyOptions = Boolean(
    group.difficultyOptions?.length && group.leaderboardsByDifficulty,
  );
  const activeDifficulty = group.difficultyOptions?.some((option) => option.value === selectedDifficulty)
    ? selectedDifficulty
    : defaultDifficulty;
  const activeLeaderboard = hasDifficultyOptions && activeDifficulty
    ? group.leaderboardsByDifficulty?.[activeDifficulty] ?? group.leaderboard
    : group.leaderboard;
  const top5 = activeLeaderboard.slice(0, 5);

  return (
    <div className={`game-card ${themeClass}`}>
      <div className="gc-head">
        <div className="gc-icon">
          <GameIcon gameType={group.gameType} />
        </div>
        <div className="gc-title-wrap">
          <div className="gc-name">{GAME_LABEL[group.gameType]}</div>
          <div className="gc-cap">{GAME_CAPTION[group.gameType]}</div>
        </div>
        <div className="gc-actions">
          {hasDifficultyOptions && (
            <select
              className="gc-difficulty-select"
              value={activeDifficulty}
              onChange={(event) => setSelectedDifficulty(event.target.value)}
              aria-label={`切换${GAME_LABEL[group.gameType]}榜单${filterKind}`}
            >
              {group.difficultyOptions?.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
          <span className="gc-metric-tag">{GAME_METRIC_LABEL[group.gameType]}</span>
        </div>
      </div>
      {group.gameType === 'piano-tiles' && (
        <div className="gc-performance-note">
          标准表现：满分一圈 / 60 秒参考满分 = 100%
        </div>
      )}
      {top5.length > 0 ? (
        <div className="gc-top5">
          {top5.map((entry) => {
            const isMe = myUserId !== null && myUserId === entry.userId;
            const rankClass = entry.rank <= 3 ? `r-${entry.rank}` : '';
            const rowRankClass = entry.rank <= 3 ? `r-${entry.rank}` : '';
            const avatarVariant = `av-${getAvatarVariant(entry.userId, MINI_AVATAR_VARIANT_COUNT)}`;
            const metric = formatGameMetric(group.gameType, entry);
            return (
              <div
                key={`${group.gameType}-${entry.userId}`}
                className={`gc-top5-row ${rowRankClass} ${isMe ? 'is-me' : ''}`}
              >
                <div className={`gc-rank ${rankClass}`}>{entry.rank}</div>
                <div className={`gc-mini-avatar ${avatarVariant}`}>{renderAvatarContent(entry)}</div>
                <div className="gc-row-name">
                  <span>{resolveDisplayName(entry)}</span>
                  <AchievementPill achievement={entry.equippedAchievement} compact />
                </div>
                <div className="gc-row-score" title={metric.title}>
                  {metric.value}
                  {metric.unit && <span className="unit">{metric.unit}</span>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="gc-empty-full">
          <div className="gc-empty-emoji">🎮</div>
          <div className="gc-empty-text">暂无玩家上榜</div>
        </div>
      )}
    </div>
  );
}

function GameIcon({ gameType }: { gameType: SupportedGame }) {
  if (gameType === 'linkgame') return <Users />;
  if (gameType === 'match3') return <BarChart3 />;
  if (gameType === 'memory') return <Star />;
  if (gameType === 'whack_mole') return <Sparkles />;
  if (gameType === 'roguelite') return <Sparkles />;
  if (gameType === 'minesweeper') return <Bomb />;
  if (gameType === 'game_2048') return <Grid3X3 />;
  if (gameType === 'lucky_td') return <Shield />;
  if (gameType === 'piano-tiles') return <Music />;
  return <Sparkles />;
}
