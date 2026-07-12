// 环保行动（挂机放置式回收）类型定义

/** 5 种垃圾（仅用于前端视觉多样性，MVP 单一回收桶） */
export type EcoTrashKind = 'bottle' | 'can' | 'glass' | 'paper' | 'banana';

/** 可拾取奖品（只能点击收入背包，不能丢进垃圾桶） */
export type EcoPrizeKey = 'diamond' | 'coin' | 'necklace' | 'trophy' | 'photo';

/** 可升级项（持久、按等级累积） */
export type EcoUpgradeKey =
  | 'spawn'    // 刷新速度：垃圾产出更快
  | 'storage'  // 回收袋容量：挂机能囤更多
  | 'value'    // 积分价格：每袋垃圾兑换更多积分
  | 'auto';    // 自动回收机器人：在线/离线自动清理

/** 限时消耗道具 */
export type EcoItemKey =
  | 'clear_truck'       // 清运车：立即补充普通垃圾，不生成奖品
  | 'lucky_flashlight'  // 幸运手电：提升后续在线生成奖品概率
  | 'recycle_glove';    // 回收手套：后续拖拽额外回收垃圾

export type EcoPrizeInventory = Record<EcoPrizeKey, number>;

export type EcoUpgradeState = Record<EcoUpgradeKey, number>;

export type EcoItemPurchaseState = Partial<Record<EcoItemKey, {
  date: string;
  count: number;
}>>;

export interface EcoDailyTrashPoints {
  /** 中国时区日期 YYYY-MM-DD */
  date: string;
  /** 当天普通垃圾回收获得的积分，不包含奖品出售 */
  points: number;
}

export interface EcoVisiblePrize {
  id: string;
  key: EcoPrizeKey;
  createdAt: number;
  /** 是否占用新规则下的全服奖品库存 */
  limited?: boolean;
}

export interface EcoPrizeLot {
  id: string;
  key: EcoPrizeKey;
  acquiredAt: number;
  availableAt: number;
  limited?: boolean;
  source: 'claim' | 'stolen' | 'restored';
  publicEntryId?: string | null;
  publiclyListedAt?: number | null;
  merchantAvailableAt?: number | null;
  stolenFromUserId?: number | null;
  stolenAt?: number | null;
  theftId?: string | null;
  blackMarketAvailableAt?: number | null;
}

export interface EcoPublicPrizeEntry {
  id: string;
  key: EcoPrizeKey;
  ownerUserId: number;
  ownerName: string;
  ownerAvatarUrl?: string | null;
  ownerLotId: string;
  publicAt: number;
  merchantAvailableAt: number;
  status: 'listed' | 'stolen';
  thiefUserId?: number | null;
  thiefName?: string | null;
  theftMessage?: string | null;
  stolenAt?: number | null;
}

/** 用户持久状态（存于 eco:state:{userId}，单 JSON blob） */
export interface EcoState {
  userId: number;
  /** 已累计、尚未回收的垃圾（挂机增长，封顶=容量） */
  pending: number;
  /** 刷新进位余数（毫秒），保证产出不丢精度 */
  spawnLeftoverMs: number;
  /** 自动回收进位余数（毫秒），保证在线/离线自动回收不丢精度 */
  autoLeftoverMs: number;
  /** 距离下一积分的垃圾零头缓冲 */
  pointBuffer: number;
  /** 各升级项等级 */
  upgrades: EcoUpgradeState;
  /** 背包内奖品库存 */
  inventory: EcoPrizeInventory;
  /** 新规则后按件追踪的奖品；旧版本聚合库存没有明细，按已解锁处理 */
  prizeLots: EcoPrizeLot[];
  /** 新规则后领取且仍未出售的受限奖品库存；旧版本库存不计入 */
  limitedPrizeInventory: EcoPrizeInventory;
  /** 生涯累计拾取奖品数（出售不扣减） */
  lifetimePrizeClaims: number;
  /** 生涯累计拾取各类奖品数（出售不扣减） */
  lifetimePrizeClaimCounts: EcoPrizeInventory;
  /** 当前场景中可点击拾取的奖品 */
  visiblePrizes: EcoVisiblePrize[];
  /** 幸运手电剩余影响的在线生成次数 */
  luckyGenerationsRemaining: number;
  /** 回收手套剩余强化拖拽次数 */
  gloveUsesRemaining: number;
  /** 每日道具购买次数 */
  itemPurchases: EcoItemPurchaseState;
  /** 今日捡垃圾获得积分，按中国时区 0 点切日 */
  dailyTrashPoints: EcoDailyTrashPoints;
  /** 环保经验（= 生涯有效回收数） */
  exp: number;
  /** 生涯累计回收数 */
  lifetimeCleared: number;
  /** 生涯累计获得积分 */
  lifetimePoints: number;
  /** 福利积分余额镜像（以积分账本为准） */
  points: number;
  /** 上次结算时间（用于产出/自动回收的增量计算） */
  lastTickAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface EcoUpgradeView {
  key: EcoUpgradeKey;
  name: string;
  emoji: string;
  desc: string;
  level: number;
  maxLevel: number;
  /** 升到下一级花费（已满级为 null） */
  nextCost: number | null;
  /** 当前档效果文案 */
  currentEffectLabel: string;
  /** 下一档效果文案（已满级为 null） */
  nextEffectLabel: string | null;
  maxed: boolean;
}

export interface EcoItemView {
  key: EcoItemKey;
  name: string;
  emoji: string;
  desc: string;
  cost: number;
  dailyLimit: number;
  purchasedToday: number;
  remainingToday: number;
}

export interface EcoPrizeView {
  key: EcoPrizeKey;
  name: string;
  emoji: string;
  imageSrc: string;
  inventory: number;
  sellableInventory: number;
  lockedInventory: number;
  publicInventory: number;
  stolenInventory: number;
  merchantAvailableCount: number;
  merchantPrice: number;
  blackMarketAvailableCount: number;
  todayPrice: number;
  yesterdayPrice: number;
  change: number;
  weekChange: number;
  priceHistory: Array<{
    date: string;
    price: number;
    /** 该日价格参考的前一天，该奖品全服领取数量 */
    previousDayClaimCount: number;
    /** 该日价格参考的前一天，全部奖品全服领取总量 */
    previousDayTotalClaims: number;
  }>;
  minPrice: number;
  maxPrice: number;
  spawnRate: number;
}

export interface EcoPublicBoardView {
  remaining: EcoPrizeInventory;
  entries: Array<{
    id: string;
    key: EcoPrizeKey;
    name: string;
    emoji: string;
    imageSrc: string;
    ownerUserId: number;
    ownerName: string;
    ownerUsername?: string | null;
    ownerDisplayName?: string | null;
    ownerAvatarUrl?: string | null;
    merchantAvailableAt: number;
    status: EcoPublicPrizeEntry['status'];
    canSteal?: boolean;
    stealDisabledReason?: string | null;
    protectedUntil?: number | null;
    thiefUserId?: number | null;
    thiefName?: string | null;
    thiefAvatarUrl?: string | null;
    theftMessage?: string | null;
    stolenAt?: number | null;
  }>;
}

export interface EcoVisiblePrizeView {
  id: string;
  key: EcoPrizeKey;
  name: string;
  emoji: string;
  imageSrc: string;
  expiresAt: number;
}

export interface EcoOfflineSummary {
  cleared: number;
  points: number;
  elapsedMs: number;
}

export interface EcoStatusResponse {
  serverNow: number;
  points: number;
  /** 普通垃圾数量 */
  pending: number;
  /** 待处理总数：普通垃圾 + 场景中奖品 */
  pendingTotal: number;
  storageCap: number;
  pointBuffer: number;
  pointDivisor: number;
  pointMultiplier: number;
  spawnPerMin: number;
  autoPerMin: number;
  grabSize: number;
  exp: number;
  lifetimeCleared: number;
  lifetimePoints: number;
  /** 今日普通垃圾回收积分，不包含奖品出售积分 */
  todayTrashPoints: number;
  /** 今日积分统计日期，使用中国时区 YYYY-MM-DD */
  todayTrashPointsDate: string;
  upgrades: EcoUpgradeView[];
  items: EcoItemView[];
  prizes: EcoPrizeView[];
  publicBoard: EcoPublicBoardView;
  visiblePrizes: EcoVisiblePrizeView[];
  luckyGenerationsRemaining: number;
  gloveUsesRemaining: number;
  /** 本次进入时离线自动回收结算（无则为 null） */
  offline: EcoOfflineSummary | null;
}
