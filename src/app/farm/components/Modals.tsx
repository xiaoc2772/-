'use client';

import React, { useState, useEffect } from 'react';
import { X, HelpCircle, ShoppingBag, Sparkles, Coins, Sprout, PawPrint, Swords, Backpack, ScrollText, Package, Minus, Plus, Tv } from 'lucide-react';
import CropSprite from './CropSprite';
import PetSprite from './PetSprite';
import type {
  CropIdV2, FertilizerType, PetType, PetSkill, PetSkillBookKey, HarvestResult, ShopItemKey,
  StealCandidate, Inventory, FarmEvent, ComputedLand, Season, WeatherForecastV2, WeatherV2,
} from '@/lib/types/farm-v2';
import {
  CROPS_V2, FERTILIZERS, SHOP_ITEMS_V2, SEASON_LABEL, WEATHERS_V2,
  PET_ADOPT_COST, PET_TYPE_LABEL,
  PET_ITEM_EFFECTS, PET_FREE_FALLBACK, PET_SKILL_BOOK_KEYS, PET_SKILL_BOOK_TO_SKILL,
  ONE_TIME_SHOP_ITEM_KEYS, type PetActionCategory,
} from '@/lib/farm-v2/config';

const DEFAULT_PET_NAMES: Record<PetType, string> = {
  cat: '小白',
  dog: '小黑',
  rabbit: '小粉',
  red_panda: '小红',
};

interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  footer?: React.ReactNode;
}

function ModalShell({ open, onClose, title, size = 'md', children, footer }: ModalShellProps) {
  if (!open) return null;
  return (
    <div className="lwf-modal-mask" role="dialog" aria-modal="true">
      <div className="lwf-modal-backdrop" onClick={onClose} />
      <div className={`lwf-modal lwf-modal-${size}`}>
        <div className="lwf-modal-header">
          <h3>{title}</h3>
          <button type="button" className="lwf-modal-close" onClick={onClose} aria-label="关闭">
            <X />
          </button>
        </div>
        <div className="lwf-modal-body">{children}</div>
        {footer && <div className="lwf-modal-footer">{footer}</div>}
      </div>
      <ModalStyles />
    </div>
  );
}

// ===================== PetItemPickerModal =====================
interface PetItemPickerProps {
  category: PetActionCategory | null;
  inventory: Inventory;
  onClose: () => void;
  onPick: (category: PetActionCategory, itemKey: ShopItemKey) => void;
  onGoShop: () => void;
}

const PET_CATEGORY_TITLE: Record<PetActionCategory, string> = {
  feed: '选择宠粮',
  drink: '选择喂水物品',
  care: '选择保养物品',
  rest: '选择休息物品',
  play: '选择陪玩物品',
};

const PET_CATEGORY_HINT: Record<PetActionCategory, string> = {
  feed: '不同宠粮提供不同的饱食和情绪加成。',
  drink: '不同饮品会提高口渴值，数值越高代表越不渴，部分还能附带其它加成。',
  care: '健康类物品可以快速恢复宠物状态，部分还可补充饱食或情绪。',
  rest: '休息物品能补充体力，让宠物准备好下一次活动。',
  play: '陪玩物品会大幅提升情绪和健康，但也会消耗饱食、体力并降低口渴值。',
};

export function PetItemPickerModal({ category, inventory, onClose, onPick, onGoShop }: PetItemPickerProps) {
  if (!category) return null;
  const fallbackKey = PET_FREE_FALLBACK[category];
  const items = Object.entries(PET_ITEM_EFFECTS)
    .filter(([, entry]) => entry?.category === category)
    .map(([k]) => k as ShopItemKey);
  // 排序：免费 fallback 排前，其它按价格升序
  items.sort((a, b) => {
    if (a === fallbackKey) return -1;
    if (b === fallbackKey) return 1;
    return (SHOP_ITEMS_V2[a]?.cost ?? 0) - (SHOP_ITEMS_V2[b]?.cost ?? 0);
  });

  return (
    <ModalShell
      open={!!category} onClose={onClose} size="md"
      title={<><Package /> {PET_CATEGORY_TITLE[category]}</>}
      footer={
        <>
          <button className="lwf-btn-ghost" onClick={onClose}>取消</button>
          <button className="lwf-btn-ghost" onClick={onGoShop}>
            <ShoppingBag size={14} /> 去商店购买
          </button>
        </>
      }
    >
      <p className="lwf-modal-sub">{PET_CATEGORY_HINT[category]}</p>
      <div className="pet-item-list">
        {items.map((key) => {
          const def = SHOP_ITEMS_V2[key];
          const entry = PET_ITEM_EFFECTS[key];
          if (!def || !entry) return null;
          const isFree = def.cost <= 0;
          const count = inventory[key]?.count ?? 0;
          const usable = isFree || count > 0;
          const effectText = describePetEffect(entry.effect);
          return (
            <button
              key={key}
              className="pet-item-row"
              disabled={!usable}
              onClick={() => usable && onPick(category, key)}
            >
              <span className="pet-item-emoji">{def.emoji}</span>
              <span className="pet-item-copy">
                <strong>{def.name}{isFree && <em className="pet-item-free">免费</em>}</strong>
                <span>{def.description}</span>
                <span className="pet-item-effect">{effectText}</span>
              </span>
              <span className="pet-item-count">
                {isFree ? '随时可用' : count > 0 ? `背包 ×${count}` : '库存 0'}
              </span>
            </button>
          );
        })}
      </div>
    </ModalShell>
  );
}

function describePetEffect(effect: { hunger?: number; cleanliness?: number; mood?: number; thirst?: number; health?: number; growth?: number }): string {
  const parts: string[] = [];
  if (effect.hunger) parts.push(`饱食 ${signed(effect.hunger)}`);
  if (effect.cleanliness) parts.push(`体力 ${signed(effect.cleanliness)}`);
  if (effect.thirst) parts.push(`口渴值 ${signed(effect.thirst)}`);
  if (effect.health) parts.push(`健康 ${signed(effect.health)}`);
  if (effect.mood) parts.push(`情绪 ${signed(effect.mood)}`);
  if (effect.growth) parts.push(`成长 ${signed(effect.growth)}`);
  return parts.join(' · ');
}

function signed(n: number): string { return n >= 0 ? `+${n}` : `${n}`; }

// ===================== AdoptModal =====================
interface AdoptModalProps {
  open: boolean;
  balance: number;
  firstAdopted: boolean;
  onSelect: (type: PetType, name: string) => void;
  onClose: () => void;
}

const ADOPT_OPTIONS: Array<{
  type: PetType;
  desc: string;
  tag: string;
  tone: string;
}> = [
  { type: 'cat', desc: '偷菜成功率 75%，适合主动偷菜', tag: '敏捷型', tone: 't-orange' },
  { type: 'dog', desc: '守护最稳，赶乌鸦成功率更高', tag: '守护型', tone: 't-amber' },
  { type: 'rabbit', desc: '浇水勤快，状态稳定又省心', tag: '勤快型', tone: 't-pink' },
  { type: 'red_panda', desc: '偷菜与守护都很均衡', tag: '均衡型', tone: 't-russet' },
];

export function AdoptModal({ open, balance, firstAdopted, onSelect, onClose }: AdoptModalProps) {
  const [selected, setSelected] = useState<PetType>('cat');
  const [namingFor, setNamingFor] = useState<PetType | null>(null);
  const [petName, setPetName] = useState('');
  const canAdopt = !firstAdopted || balance >= PET_ADOPT_COST;
  const selectedLabel = PET_TYPE_LABEL[selected];

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setSelected('cat');
    setNamingFor(null);
    setPetName('');
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleConfirmName = () => {
    if (!namingFor) return;
    onSelect(namingFor, petName.trim());
    setNamingFor(null);
    setPetName('');
  };

  return (
    <>
      <ModalShell
        open={open && namingFor === null} onClose={onClose} size="md"
        title={<><PawPrint /> 领养你的庄园伙伴</>}
        footer={
          <>
            <button className="lwf-btn-ghost" onClick={onClose}>取消</button>
            <button
              className="lwf-btn-primary"
              disabled={!canAdopt}
              onClick={() => setNamingFor(selected)}
            >
              <PawPrint size={14} /> 领养 {selectedLabel}
            </button>
          </>
        }
      >
        <div className="adopt-summary">
          <span>{firstAdopted ? `本次领养 ${PET_ADOPT_COST} 积分` : '首次领养免费'}</span>
          <strong>余额 {balance}</strong>
          {!canAdopt && <em>积分不足</em>}
        </div>
        <p className="lwf-modal-sub">选择一个喜欢的伙伴，点击领养后可以为它取名（也可以留空使用默认名字）。</p>
        <div className="adopt-grid">
          {ADOPT_OPTIONS.map((option) => (
            <button
              key={option.type}
              type="button"
              className={`adopt-card ${selected === option.type ? 'selected' : ''}`}
              onClick={() => setSelected(option.type)}
            >
              <PetSprite type={option.type} stage="child" size={118} emotion="happy" />
              <h4>{PET_TYPE_LABEL[option.type]}</h4>
              <p>{option.desc}</p>
              <span className={`adopt-tag ${option.tone}`}>{option.tag}</span>
            </button>
          ))}
        </div>
      </ModalShell>
      <ModalShell
        open={open && namingFor !== null}
        onClose={() => setNamingFor(null)}
        size="sm"
        title={<><PawPrint /> 给宠物取个名字</>}
        footer={
          <>
            <button className="lwf-btn-ghost" onClick={() => setNamingFor(null)}>返回</button>
            <button
              className="lwf-btn-primary"
              onClick={handleConfirmName}
            >
              <PawPrint size={14} /> 确认领养 {petName.trim() || (namingFor ? DEFAULT_PET_NAMES[namingFor] : '')}
            </button>
          </>
        }
      >
        {namingFor && (
          <div className="adopt-naming">
            <div className="adopt-naming-visual">
              <PetSprite type={namingFor} stage="child" size={96} emotion="happy" />
            </div>
            <p className="lwf-modal-sub">
              为这只{PET_TYPE_LABEL[namingFor]}取个名字吧。最多 12 个字，留空将使用默认名字「{DEFAULT_PET_NAMES[namingFor]}」。
            </p>
            <label className="adopt-name-field">
              <span>宠物名字</span>
              <input
                autoFocus
                value={petName}
                maxLength={12}
                placeholder={DEFAULT_PET_NAMES[namingFor]}
                onChange={(event) => setPetName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleConfirmName();
                }}
              />
            </label>
          </div>
        )}
      </ModalShell>
    </>
  );
}

// ===================== PlantModal =====================
interface PlantModalProps {
  open: boolean;
  plantableCrops: CropIdV2[];
  unlockedLandCount: number;
  balance: number;
  seedInventory: Partial<Record<CropIdV2, number>>;
  onClose: () => void;
  onPlant: (cropId: CropIdV2) => Promise<boolean>;
  onGoShop: () => void;
}

export function PlantModal({ open, plantableCrops, unlockedLandCount, balance, seedInventory, onClose, onPlant, onGoShop }: PlantModalProps) {
  const [selected, setSelected] = useState<CropIdV2 | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => { if (open) setSelected(null); }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const seedCount = selected ? (seedInventory[selected] ?? 0) : 0;
  const canPlant = selected && seedCount > 0;

  return (
    <ModalShell
      open={open} onClose={onClose} size="lg"
      title={<><Sprout /> 选择要种植的作物</>}
      footer={
        selected ? (
          <div style={{ display: 'flex', gap: 8, width: '100%', justifyContent: 'flex-end' }}>
            <button className="lwf-btn-ghost" onClick={onGoShop}>
              <ShoppingBag size={14} /> 去商店买种子
            </button>
            <button
              className="lwf-btn-primary"
              disabled={!canPlant}
              onClick={async () => {
                const ok = await onPlant(selected);
                if (ok) onClose();
              }}
            >
              <Sprout size={14} /> 种下 {CROPS_V2[selected].name}
            </button>
          </div>
        ) : (
          <button className="lwf-btn-ghost" onClick={onGoShop}>
            <ShoppingBag size={14} /> 去商店买种子
          </button>
        )
      }
    >
      <div className="plant-balance">
        <Coins size={14} /> 余额 <strong>{balance}</strong>
        <Backpack size={14} style={{ marginLeft: 8 }} /> 种子总数{' '}
        <strong>{Object.values(seedInventory).reduce((a, b) => a + (b ?? 0), 0)}</strong>
      </div>
      <p className="lwf-modal-sub">仅可种植背包中已有的种子。肥料会作为背包道具，种下作物后再单独使用。</p>
      <div className="plant-crops">
        {Object.values(CROPS_V2).map((c) => {
          const inSeason = plantableCrops.includes(c.id);
          const isUnlocked = c.unlockLandCount <= unlockedLandCount;
          const have = seedInventory[c.id] ?? 0;
          const disabled = !isUnlocked || !inSeason || have <= 0;
          return (
            <button
              key={c.id}
              className={`plant-crop-card ${selected === c.id ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
              disabled={disabled}
              onClick={() => setSelected(c.id)}
            >
              <div className="plant-crop-sprite">
                <CropSprite cropId={c.id} stage="mature" size={72} />
              </div>
              <div className="plant-crop-name">{c.name}</div>
              <div className="plant-crop-meta">{c.growthMinutes}分钟 · 收 {c.baseYield}</div>
              <div className="plant-crop-have">背包 ×{have}</div>
              {!isUnlocked && <span className="plant-crop-lock">🔒 {c.unlockLandCount}块地</span>}
              {isUnlocked && !inSeason && <span className="plant-crop-lock">非本季</span>}
              {isUnlocked && inSeason && have <= 0 && <span className="plant-crop-lock empty">无种子</span>}
            </button>
          );
        })}
      </div>

    </ModalShell>
  );
}

// ===================== FarmSuccessModal =====================
interface FarmSuccessModalProps {
  open: boolean;
  icon: string;
  title: string;
  message: string;
  detail?: string;
  onClose: () => void;
}

export function FarmSuccessModal({ open, icon, title, message, detail, onClose }: FarmSuccessModalProps) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      size="sm"
      title={<><Sparkles /> {title}</>}
      footer={<button className="lwf-btn-primary" onClick={onClose}>知道了</button>}
    >
      <div className="farm-success-card">
        <div className="farm-success-icon" aria-hidden>{icon}</div>
        <div className="farm-success-copy">
          <strong>{message}</strong>
          {detail && <span>{detail}</span>}
        </div>
      </div>
    </ModalShell>
  );
}

// ===================== HarvestModal =====================
interface HarvestModalProps {
  open: boolean;
  results: HarvestResult[];
  total: number;
  onClose: () => void;
}

export function HarvestModal({ open, results, total, onClose }: HarvestModalProps) {
  if (!open || results.length === 0) return null;
  const isMulti = results.length > 1;
  const hasGold = results.some(r => r.quality === 'gold');
  const hasPerfect = results.some(r => r.perfect);

  return (
    <ModalShell
      open={open} onClose={onClose} size="md"
      title={<><Sparkles /> {isMulti ? `一键收获 ${results.length} 块` : '收获成功'}</>}
      footer={
        <button className="lwf-btn-primary" onClick={onClose}>
          <Coins size={14} /> 知道了 · 共获得 {total} 积分
        </button>
      }
    >
      {hasPerfect && (
        <div className="harvest-perfect-badge">✨ 完美照顾奖励生效！银星 +10%、金星 +5%</div>
      )}
      <div className="harvest-list">
        {results.map((r, i) => (
          <div key={i} className={`harvest-row q-${r.quality}`}>
            <div className="harvest-sprite">
              <CropSprite cropId={r.cropId} stage="mature" size={48} />
            </div>
            <div className="harvest-info">
              <div className="harvest-name">
                {r.cropName}
                <span className={`harvest-badge q-${r.quality}`}>
                  {r.quality === 'gold' ? '✨ 金星' : r.quality === 'silver' ? '⭐ 银星' : '普通'}
                </span>
              </div>
              <div className="harvest-formula">
                基础 {r.baseYield} × 品质 {r.qualityMultiplier} × 缺水 {r.waterMultiplier} × 季节 {r.seasonMultiplier} × 过熟 {r.overripeMultiplier.toFixed(1)}
                {r.stolenDeduct > 0 && <> − 被偷 {r.stolenDeduct}</>}
              </div>
            </div>
            <div className="harvest-yield">+{r.finalYield}</div>
          </div>
        ))}
      </div>
      <div className={`harvest-total ${hasGold ? 'has-gold' : ''}`}>
        本次共获得 <strong>{total}</strong> 积分
      </div>
    </ModalShell>
  );
}

// ===================== ShopModal =====================
interface ShopModalProps {
  open: boolean;
  inventory: Inventory;
  learnedSkills?: PetSkill[];
  shopDailyPurchases?: Partial<Record<ShopItemKey, number>>;
  seedInventory: Partial<Record<CropIdV2, number>>;
  balance: number;
  unlockedLandCount: number;
  scarecrowUntil: number | null;
  bellUntil: number | null;
  onClose: () => void;
  onBuy: (key: ShopItemKey, qty?: number) => void;
  onBuySeed: (cropId: CropIdV2, qty: number) => void;
  onUse: (key: ShopItemKey, plotIndex?: number) => void;
}

const SHOP_TABS: Array<{ id: 'seeds' | 'fertilizer' | 'protection' | 'speed' | 'special' | 'pet'; label: string; icon: string }> = [
  { id: 'seeds',      label: '种子', icon: '🌾' },
  { id: 'fertilizer', label: '肥料', icon: '🌱' },
  { id: 'protection', label: '防护', icon: '🛡️' },
  { id: 'speed',      label: '加速', icon: '⚡' },
  { id: 'special',    label: '设备', icon: '📺' },
  { id: 'pet',        label: '宠物', icon: '🐾' },
];

type ShopPurchaseTarget =
  | {
      kind: 'seed';
      cropId: CropIdV2;
      name: string;
      description: string;
      unitCost: number;
      stock: number;
    }
  | {
      kind: 'item';
      itemKey: ShopItemKey;
      name: string;
      description: string;
      unitCost: number;
      stock: number;
      emoji: string;
      dailyLimit?: number;
      dailyPurchased?: number;
      dailyRemaining?: number;
    };

function clampPurchaseQty(value: number, maxQty: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(maxQty, Math.floor(value)));
}

export function ShopModal({
  open, inventory, learnedSkills, shopDailyPurchases, seedInventory, balance,
  unlockedLandCount, scarecrowUntil, bellUntil, onClose, onBuy, onBuySeed,
}: ShopModalProps) {
  const [tab, setTab] = useState<typeof SHOP_TABS[number]['id']>('seeds');
  const [purchaseTarget, setPurchaseTarget] = useState<ShopPurchaseTarget | null>(null);
  const [purchaseQty, setPurchaseQty] = useState(1);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open]);
  if (!open) return null;
  const items = tab === 'seeds' ? [] : Object.values(SHOP_ITEMS_V2).filter(i => i.category === tab && i.cost > 0);
  const targetIsOneTime = purchaseTarget?.kind === 'item' && ONE_TIME_SHOP_ITEM_KEYS.includes(purchaseTarget.itemKey as (typeof ONE_TIME_SHOP_ITEM_KEYS)[number]);
  const targetDailyRemaining = purchaseTarget?.kind === 'item' && purchaseTarget.dailyLimit
    ? purchaseTarget.dailyRemaining ?? 0
    : 99;
  const maxPurchaseQty = purchaseTarget
    ? Math.min(targetIsOneTime ? 1 : 99, Math.floor(balance / purchaseTarget.unitCost), targetDailyRemaining)
    : 1;
  const purchaseTotal = purchaseTarget ? purchaseTarget.unitCost * purchaseQty : 0;
  const canConfirmPurchase = !!purchaseTarget && maxPurchaseQty >= 1 && purchaseQty >= 1 && purchaseTotal <= balance;
  const openPurchase = (target: ShopPurchaseTarget) => {
    setPurchaseTarget(target);
    setPurchaseQty(1);
  };
  const closePurchase = () => setPurchaseTarget(null);
  const updatePurchaseQty = (value: number) => {
    setPurchaseQty(clampPurchaseQty(value, Math.max(1, maxPurchaseQty)));
  };
  const confirmPurchase = () => {
    if (!purchaseTarget || !canConfirmPurchase) return;
    if (purchaseTarget.kind === 'seed') {
      onBuySeed(purchaseTarget.cropId, purchaseQty);
    } else {
      onBuy(purchaseTarget.itemKey, purchaseQty);
    }
    closePurchase();
  };

  return (
    <ModalShell
      open={open} onClose={onClose} size="lg"
      title={<><ShoppingBag /> 农场商店</>}
    >
      <div className="shop-balance">
        <Coins size={14} /> 当前余额 <strong>{balance}</strong> 积分
        {scarecrowUntil && scarecrowUntil > now && (
          <span className="shop-buff">🧙 稻草人 {fmtMs(scarecrowUntil - now)}</span>
        )}
        {bellUntil && bellUntil > now && (
          <span className="shop-buff">🔔 看守铃铛 {fmtMs(bellUntil - now)}</span>
        )}
      </div>
      <p className="lwf-modal-sub">购买的种子与道具都会进入「背包」。要使用道具，请打开背包点击对应道具。</p>
      <div className="shop-tabs">
        {SHOP_TABS.map(t => (
          <button
            key={t.id}
            className={`shop-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => {
              setTab(t.id);
              closePurchase();
            }}
          >
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>
      {tab === 'seeds' ? (
        <SeedShopList
          balance={balance}
          unlockedLandCount={unlockedLandCount}
          seedInventory={seedInventory}
          onOpenPurchase={openPurchase}
        />
      ) : (
        <div className="shop-items">
          {items.map((it) => {
            const cnt = inventory[it.key]?.count ?? 0;
            const skillBookKey = PET_SKILL_BOOK_KEYS.includes(it.key as PetSkillBookKey)
              ? it.key as PetSkillBookKey
              : null;
            const learnedSkill = skillBookKey ? PET_SKILL_BOOK_TO_SKILL[skillBookKey] : null;
            const skillAlreadyLearned = !!learnedSkill && (learnedSkills ?? []).includes(learnedSkill);
            const oneTimePurchased = ONE_TIME_SHOP_ITEM_KEYS.includes(it.key as (typeof ONE_TIME_SHOP_ITEM_KEYS)[number]) && cnt > 0;
            const dailyLimit = Number(it.dailyLimit ?? 0);
            const hasDailyLimit = !skillBookKey && Number.isSafeInteger(dailyLimit) && dailyLimit > 0;
            const purchasedToday = hasDailyLimit ? shopDailyPurchases?.[it.key] ?? 0 : 0;
            const dailyRemaining = hasDailyLimit ? Math.max(0, dailyLimit - purchasedToday) : 99;
            const dailyLimitedOut = hasDailyLimit && dailyRemaining <= 0;
            return (
              <div key={it.key} className="shop-row">
                <div className="shop-emoji">{it.emoji}</div>
                <div className="shop-info">
                  <div className="shop-name">
                    {it.name}
                    <span className="shop-stock">背包 {cnt}</span>
                    {skillBookKey && <span className="shop-stock">可重复购买</span>}
                    {skillAlreadyLearned && <span className="shop-stock">已学</span>}
                    {hasDailyLimit && !skillBookKey && (
                      <span className="shop-stock">今日 {Math.min(purchasedToday, dailyLimit)}/{dailyLimit}</span>
                    )}
                  </div>
                  <div className="shop-desc">{it.description}</div>
                </div>
                <div className="shop-actions">
                  <button
                    className="shop-btn buy"
                    disabled={balance < it.cost || oneTimePurchased || dailyLimitedOut}
                    onClick={() => openPurchase({
                      kind: 'item',
                      itemKey: it.key,
                      name: it.name,
                      description: it.description,
                      unitCost: it.cost,
                      stock: cnt,
                      emoji: it.emoji,
                      dailyLimit: hasDailyLimit ? dailyLimit : undefined,
                      dailyPurchased: hasDailyLimit ? purchasedToday : undefined,
                      dailyRemaining: hasDailyLimit ? dailyRemaining : undefined,
                    })}
                  >
                    {oneTimePurchased ? '已购' : dailyLimitedOut ? '今日已达上限' : `${it.cost} 积分`}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <PurchaseQuantityModal
        target={purchaseTarget}
        qty={purchaseQty}
        maxQty={maxPurchaseQty}
        total={purchaseTotal}
        balance={balance}
        canConfirm={canConfirmPurchase}
        onClose={closePurchase}
        onQtyChange={updatePurchaseQty}
        onConfirm={confirmPurchase}
      />
    </ModalShell>
  );
}

function SeedShopList({
  balance, unlockedLandCount, seedInventory, onOpenPurchase,
}: {
  balance: number;
  unlockedLandCount: number;
  seedInventory: Partial<Record<CropIdV2, number>>;
  onOpenPurchase: (target: ShopPurchaseTarget) => void;
}) {
  return (
    <div className="shop-items">
      {Object.values(CROPS_V2).map((c) => {
        const isUnlocked = c.unlockLandCount <= unlockedLandCount;
        const have = seedInventory[c.id] ?? 0;
        return (
          <div key={c.id} className={`shop-row ${!isUnlocked ? 'shop-row-locked' : ''}`}>
            <div className="shop-sprite-wrap"><CropSprite cropId={c.id} stage="mature" size={58} /></div>
            <div className="shop-info">
              <div className="shop-name">
                {c.name}种子
                <span className="shop-stock">背包 {have}</span>
              </div>
              <div className="shop-desc">
                成长 {c.growthMinutes} 分钟 · 基础收益 {c.baseYield} · 季节{' '}
                {c.seasons.map((s) => SEASON_LABEL[s]).join('/')}
                {!isUnlocked && ` · 需 ${c.unlockLandCount} 块地`}
              </div>
            </div>
            <div className="shop-actions">
              <button
                className="shop-btn buy"
                disabled={!isUnlocked || balance < c.seedCost}
                onClick={() => onOpenPurchase({
                  kind: 'seed',
                  cropId: c.id,
                  name: `${c.name}种子`,
                  description: `成长 ${c.growthMinutes} 分钟 · 基础收益 ${c.baseYield}`,
                  unitCost: c.seedCost,
                  stock: have,
                })}
              >
                {c.seedCost} 积分
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PurchaseQuantityModal({
  target, qty, maxQty, total, balance, canConfirm, onClose, onQtyChange, onConfirm,
}: {
  target: ShopPurchaseTarget | null;
  qty: number;
  maxQty: number;
  total: number;
  balance: number;
  canConfirm: boolean;
  onClose: () => void;
  onQtyChange: (qty: number) => void;
  onConfirm: () => void;
}) {
  if (!target) return null;
  const isSeed = target.kind === 'seed';
  const dailyLimit = !isSeed ? target.dailyLimit : undefined;
  const dailyPurchased = !isSeed ? target.dailyPurchased ?? 0 : 0;
  const dailyRemaining = !isSeed ? target.dailyRemaining : undefined;
  const blockedReason = !canConfirm
    ? dailyLimit && dailyRemaining !== undefined && dailyRemaining <= 0
      ? `今日限购 ${dailyLimit} 个，已经买满了`
      : '积分不足，暂时不能购买'
    : null;

  return (
    <ModalShell
      open={!!target}
      onClose={onClose}
      size="sm"
      title={<><ShoppingBag /> 选择购买数量</>}
      footer={
        <>
          <button className="lwf-btn-ghost" onClick={onClose}>取消</button>
          <button className="lwf-btn-primary" disabled={!canConfirm} onClick={onConfirm}>
            <Coins size={14} /> 确认购买
          </button>
        </>
      }
    >
      <div className="purchase-card">
        <div className="purchase-visual">
          {isSeed ? (
            <CropSprite cropId={target.cropId} stage="mature" size={72} />
          ) : (
            <span>{target.emoji}</span>
          )}
        </div>
        <div className="purchase-info">
          <strong>{target.name}</strong>
          <span>{target.description}</span>
          <em>背包已有 {target.stock}</em>
        </div>
      </div>

      <div className="purchase-summary">
        <span>单价 <strong>{target.unitCost}</strong> 积分</span>
        <span>余额 <strong>{balance}</strong> 积分</span>
        {dailyLimit && (
          <span>今日 <strong>{Math.min(dailyPurchased, dailyLimit)}/{dailyLimit}</strong></span>
        )}
        <span>最多可买 <strong>{Math.max(0, maxQty)}</strong></span>
      </div>

      <div className="purchase-qty-row">
        <button
          type="button"
          className="purchase-step"
          disabled={qty <= 1}
          onClick={() => onQtyChange(qty - 1)}
          aria-label="减少购买数量"
        >
          <Minus />
        </button>
        <label className="purchase-input-wrap">
          <span>数量</span>
          <input
            type="number"
            min={1}
            max={Math.max(1, maxQty)}
            value={qty}
            onChange={(event) => onQtyChange(Number(event.target.value))}
          />
        </label>
        <button
          type="button"
          className="purchase-step"
          disabled={qty >= maxQty}
          onClick={() => onQtyChange(qty + 1)}
          aria-label="增加购买数量"
        >
          <Plus />
        </button>
      </div>

      <div className={`purchase-total ${canConfirm ? '' : 'disabled'}`}>
        合计 <strong>{total}</strong> 积分
        {blockedReason && <span>{blockedReason}</span>}
      </div>
    </ModalShell>
  );
}

function fmtMs(ms: number): string {
  if (ms <= 0) return '已结束';
  const min = Math.floor(ms / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0) return `${h}时${m}分`;
  return `${m}分`;
}

// ===================== StealModal =====================
interface StealModalProps {
  open: boolean;
  loadList: () => Promise<StealCandidate[]>;
  onClose: () => void;
  onSteal: (targetUserId: number) => Promise<{ success: boolean; amount?: number; cropName?: string } | null>;
}

function StealTargetAvatar({ candidate }: { candidate: StealCandidate }) {
  if (candidate.avatarUrl) {
    return (
      <div className="steal-avatar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={candidate.avatarUrl} alt={candidate.nickname} />
      </div>
    );
  }
  return <div className="steal-avatar fallback">{candidate.nickname.slice(0, 1).toUpperCase()}</div>;
}

export function StealModal({ open, loadList, onClose, onSteal }: StealModalProps) {
  const [list, setList] = useState<StealCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setResult(null);
    setLoading(true);
    loadList().then((l) => { if (!cancelled) { setList(l); setLoading(false); } });
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => { cancelled = true; };
  }, [open, loadList]);

  return (
    <ModalShell
      open={open} onClose={onClose} size="md"
      title={<><Swords /> 派宠偷菜</>}
    >
      <p className="lwf-modal-sub">
        仅成年宠物可执行 · 每个目标每天只能偷 1 次 · 成功后随机偷走一整棵成熟作物
      </p>
      {loading ? (
        <div className="steal-empty">正在搜索附近可偷的玩家…</div>
      ) : list.length === 0 ? (
        <div className="steal-empty">附近没有可偷的玩家，过会儿再来吧。</div>
      ) : (
        <div className="steal-list">
          {list.map((c) => (
            <div key={c.userId} className="steal-row">
              <div className="steal-person">
                <StealTargetAvatar candidate={c} />
                <div className="steal-copy">
                  <div className="steal-name">{c.nickname}</div>
                  <div className="steal-hint">作物保密，成功后随机偷取</div>
                </div>
              </div>
              <button
                className="steal-crop"
                onClick={async () => {
                  const r = await onSteal(c.userId);
                  if (r) setResult(r.success ? `偷菜成功，获得 ${r.amount} 积分${r.cropName ? `（随机偷到 ${r.cropName}）` : ''}` : '偷菜失败被守住了');
                }}
              >
                随机偷菜
              </button>
            </div>
          ))}
        </div>
      )}
      {result && <div className="steal-result">{result}</div>}
    </ModalShell>
  );
}

// ===================== RulesModal （完整规则）=====================
interface RulesModalProps {
  open: boolean;
  onClose: () => void;
}

type RuleLevel = 'critical' | 'important' | 'advanced' | 'basic';

const LEVEL_META: Record<RuleLevel, { label: string; icon: string; tone: string }> = {
  critical:  { label: '关键', icon: '🚨', tone: 'lvl-critical' },
  important: { label: '重要', icon: '⚠️', tone: 'lvl-important' },
  advanced:  { label: '进阶', icon: '💡', tone: 'lvl-advanced' },
  basic:     { label: '基础', icon: '📋', tone: 'lvl-basic' },
};

const RULES_FULL: Array<{ level: RuleLevel; title: string; items: string[] }> = [
  {
    level: 'basic', title: '初始与刷新', items: [
      '初始积分 100，初始拥有 4 块土地（共 8 块上限）。',
      '首次领养宠物免费，可选小白猫、边牧、兔子、红熊猫；第二次起每次领养 50 积分。',
      '每日北京时间 0 点刷新天气与宠物每日次数；每周日 0 点切换季节。',
      '农场按服务器时间结算，离线时作物也会继续成长、缺水、成熟或过熟。',
    ],
  },
  {
    level: 'basic', title: '土地操作', items: [
      '点按土地会打开土地操作菜单；空地可种植，生长中可浇水、用肥料、用道具或看详情。',
      '成熟作物点按土地后收获；枯萎作物点按土地后铲除；被乌鸦破坏的土地点按后清理。',
      '土地按编号顺序购买，价格依次为 50 / 100 / 150 / 200 积分。',
      '解锁更多土地会同步解锁更高级作物（番茄、土豆、草莓、玉米、南瓜）。',
    ],
  },
  {
    level: 'basic', title: '作物数值', items: [
      '小麦：种子 5 / 成长 30 分钟 / 收益 12（春、秋）',
      '胡萝卜：种子 8 / 成长 60 分钟 / 收益 20（春、秋）',
      '生菜：种子 10 / 成长 90 分钟 / 收益 28（春）',
      '番茄：种子 18 / 成长 120 分钟 / 收益 48（夏，需 5 块地）',
      '土豆：种子 20 / 成长 150 分钟 / 收益 55（冬、春，需 5 块地）',
      '草莓：种子 25 / 成长 180 分钟 / 收益 75（春、夏，需 6 块地）',
      '玉米：种子 35 / 成长 240 分钟 / 收益 105（夏、秋，需 7 块地）',
      '南瓜：种子 45 / 成长 360 分钟 / 收益 150（秋，需 8 块地）',
    ],
  },
  {
    level: 'critical', title: '浇水与缺水', items: [
      '种植时自动算一次浇水。每错过浇水间隔产生 1 次缺水。',
      '距离下次缺水还有 10 分钟时，土地操作中的浇水按钮会提前可用。',
      '设置农场提醒 QQ 邮箱且拥有成年宠物时，系统会在可浇水窗口发送邮件提醒。',
      '作物缺水后仍然可以点按土地补水；补水会恢复生长状态，但已产生的缺水次数会保留。',
      '缺水 1 次 ×0.80 收益、缺水 2 次 ×0.50 收益、缺水 3 次直接枯萎。',
      '小雨每 30 分钟自动浇水一次，暴雨每 15 分钟一次。',
      '云朵瓶、宠物自动浇水和雨天自动浇水都能让未成熟作物恢复为生长中。',
      '宠物自动浇水工作期间，只要有未成熟土地缺水或进入可浇水提前窗口，就会自动补水；工作结束后按宠物类型进入不同休息时间。',
    ],
  },
  {
    level: 'advanced', title: '商店与道具', items: [
      '肥料、保护、加速、宠物用品和设备都在农场商店购买；背包用于查看库存和使用道具。',
      '天气电视机属于设备，花费 120 积分购买后永久解锁土地一览旁边的电视机按钮，可查看明日天气；每个账号限购 1 台。',
      '普通加速券让指定作物剩余成长 -10 分钟，高级加速券 -30 分钟；每轮作物最多加速到基础成长时间的 50%。',
      '防鸟网保护指定土地 6 小时，期间该土地不会被乌鸦破坏；稻草人保护全场 12 小时，把乌鸦出现概率降到原来的 40%；看守铃铛 6 小时内降低别人偷菜成功率。',
    ],
  },
  {
    level: 'advanced', title: '肥料与品质', items: [
      '肥料需先在商店购买，种植后可通过背包或点按土地单独使用。',
      '普通肥料 20 积分（成长 -10%、金星 +5%）',
      '中级肥料 45 积分（成长 -20%、银星 +10%、金星 +10%）',
      '高级肥料 80 积分（成长 -35%、银星 +15%、金星 +20%）',
      '品质倍率：普通 ×1.0 / 银星 ×1.3 / 金星 ×1.8',
      '完美照顾（零缺水、未被偷、未被乌鸦、12h 内收）：银星 +10%、金星 +5% 概率',
    ],
  },
  {
    level: 'important', title: '季节与天气', items: [
      '春季：成长 ×0.95；夏季：成长 ×0.90、浇水间隔 ×0.85、乌鸦 ×1.2',
      '秋季：收益 ×1.10；冬季：成长 ×1.15、浇水间隔 ×1.20、乌鸦 ×0.7',
      '换季时上一季未收获的作物全部枯萎，不返还种子与肥料。',
      '晴天、多云、小雨、暴雨、炎热、大风、小雪、雾天会影响浇水间隔、雨天自动浇水节奏和乌鸦概率。',
      '购买天气电视机后，可以提前查看明日天气，方便决定是否种植、收获或准备防护。',
      '每周五会自动触发 1 次随机事件，可能获得补给，也可能遇到作物或仓库损失。',
    ],
  },
  {
    level: 'critical', title: '过熟与收获', items: [
      '成熟后 12 小时内最佳（×1.0），12-24h ×0.8，24-48h ×0.5，超 48h 腐烂枯萎。',
      '收获时每块土地独立计算品质、缺水、季节、过熟和被偷收益扣除。',
      '宠物学会收菜技能后，成熟作物会自动收获。',
    ],
  },
  {
    level: 'important', title: '乌鸦与防护', items: [
      '种植 10 分钟后开始进入乌鸦风险窗口，每 10 分钟判定 1 次。',
      '每次判定的基础概率为 8%，再受天气、季节和防护影响。',
      '稻草人生效时，全场乌鸦概率变为原来的 40%；宠物守护时变为原来的 50%；两者同时生效时变为原来的 25%。',
      '防鸟网是单块土地免疫：被保护的土地不会被乌鸦选中，但其他土地仍按当前概率判定。',
      '驱鸟烟花可立即驱散当前乌鸦；暴雨天气不会出现乌鸦。',
    ],
  },
  {
    level: 'advanced', title: '宠物养成', items: [
      '阶段：幼年（0-159）、成年（160+），成年后可学习并使用技能书。',
      '口渴值 0 表示非常口渴，100 表示不渴；每日 0 点饱食、清洁、口渴值都会下降。',
      '情绪用文字展示，例如平静、有点害羞、很开心、超黏人、星星眼、没精神、闹脾气、焦躁口渴、很难过。',
      '普通粮会明显提升饱食并略微改善情绪，每日 3 次；高级粮会大幅提升饱食，并改善情绪和健康，每日 1 次。',
      '喂水会提高口渴值并改善情绪；洗澡会提升清洁，并改善情绪和健康。',
      '陪玩和玩具最适合改善情绪，但会消耗饱食并降低口渴值。',
      '点按宠物可查看已学习技能；技能书需在农场商店购买，并在背包中由成年宠物学习。',
      '技能书可重复购买；同一只宠物同一技能只能学习一次。',
      '收菜和种菜属于被动技能，学习后会自动触发；自动浇水、守护庄园、赶乌鸦和偷菜属于主动技能。',
      '宠物情绪太低会罢工；主动派遣技能需要满足情绪要求，并受技能冷却限制。',
    ],
  },
  {
    level: 'advanced', title: '偷菜规则', items: [
      '偷菜需要宠物学会偷菜技能；只能选择有成熟作物的其他玩家，不能指定偷哪块菜。',
      '偷菜成功后，系统会随机偷走目标的一整棵成熟作物，被偷者不会获得这棵作物收益。',
      '单玩家每日被偷上限 5 次，单玩家每日只能偷同一目标 1 次；失败也会计入今日已偷过该目标。',
      '小白猫基础成功率 75%、红熊猫 70%、兔子 65%、边牧 55%；情绪越好越容易成功，低落时会明显变差。',
      '目标若有宠物守护会降低偷菜成功率，边牧最擅长守护；铃铛额外 ×0.5。',
      '偷菜成功获得这棵作物当前完整收获值，品质、缺水、季节、过熟等正常生效。',
    ],
  },
];

export function RulesModal({ open, onClose }: RulesModalProps) {
  return (
    <ModalShell
      open={open} onClose={onClose} size="lg"
      title={<><HelpCircle /> 开心农场 完整规则</>}
      footer={<button className="lwf-btn-primary" onClick={onClose}>知道了</button>}
    >
      <p className="lwf-modal-sub">基于服务器时间运行，离线作物也会成长。所有数值均可在管理后台调整。</p>
      <div className="rules-legend">
        {(Object.keys(LEVEL_META) as RuleLevel[]).map((lv) => (
          <span key={lv} className={`rules-legend-item ${LEVEL_META[lv].tone}`}>
            <span className="rl-dot" aria-hidden>{LEVEL_META[lv].icon}</span>
            {LEVEL_META[lv].label}
          </span>
        ))}
      </div>
      <div className="rules-detail">
        {RULES_FULL.map((sec, i) => {
          const meta = LEVEL_META[sec.level];
          return (
            <div key={i} className={`rules-section ${meta.tone}`}>
              <div className="rules-section-title">
                <span className="rules-num">{String(i + 1).padStart(2, '0')}</span>
                <span className="rules-icon" aria-hidden>{meta.icon}</span>
                <span className="rules-section-name">{sec.title}</span>
                <span className="rules-level-badge">{meta.label}</span>
              </div>
              <ul className="rules-detail-list">
                {sec.items.map((it, j) => <li key={j}>{it}</li>)}
              </ul>
            </div>
          );
        })}
      </div>
    </ModalShell>
  );
}

// ===================== BackpackModal （背包）=====================
interface BackpackModalProps {
  open: boolean;
  inventory: Inventory;
  seedInventory: Partial<Record<CropIdV2, number>>;
  scarecrowUntil: number | null;
  bellUntil: number | null;
  onClose: () => void;
  onItemClick: (key: ShopItemKey) => void;
  onSeedClick: (cropId: CropIdV2) => void;
}

export function BackpackModal({ open, inventory, seedInventory, scarecrowUntil, bellUntil, onClose, onItemClick, onSeedClick }: BackpackModalProps) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open]);

  const seedEntries = Object.entries(seedInventory).filter(([, n]) => (n ?? 0) > 0) as Array<[CropIdV2, number]>;
  const itemsByCat = Object.values(SHOP_ITEMS_V2).reduce<Record<string, Array<{ key: ShopItemKey; count: number }>>>((acc, def) => {
    const cnt = inventory[def.key]?.count ?? 0;
    if (cnt > 0) {
      (acc[def.category] = acc[def.category] || []).push({ key: def.key, count: cnt });
    }
    return acc;
  }, {});
  const categoryLabel: Record<string, string> = {
    fertilizer: '🌱 肥料', protection: '🛡️ 防护', speed: '⚡ 加速', pet: '🐾 宠物', special: '✨ 特殊',
  };
  const totalItems = Object.values(itemsByCat).reduce((a, list) => a + list.reduce((s, x) => s + x.count, 0), 0);
  const totalSeeds = seedEntries.reduce((a, [, n]) => a + n, 0);

  return (
    <ModalShell
      open={open} onClose={onClose} size="lg"
      title={<><Backpack /> 我的背包</>}
    >
      <div className="bp-summary">
        <span><Sprout size={13} /> 种子 <strong>{totalSeeds}</strong> 颗</span>
        <span><Package size={13} /> 道具 <strong>{totalItems}</strong> 件</span>
        {scarecrowUntil && scarecrowUntil > now && <span>🧙 稻草人 {fmtMs(scarecrowUntil - now)}</span>}
        {bellUntil && bellUntil > now && <span>🔔 铃铛 {fmtMs(bellUntil - now)}</span>}
      </div>

      <div className="bp-section-title"><Sprout size={14} /> 种子库存</div>
      {seedEntries.length === 0 ? (
        <div className="bp-empty">背包里还没有种子。前往商店购买你的第一颗种子吧。</div>
      ) : (
        <div className="bp-grid">
          {seedEntries.map(([cropId, count]) => {
            const c = CROPS_V2[cropId];
            return (
              <button key={cropId} className="bp-card seed" onClick={() => onSeedClick(cropId)}>
                <div className="bp-sprite"><CropSprite cropId={cropId} stage="mature" size={64} /></div>
                <div className="bp-name">{c.name}种子</div>
                <div className="bp-count">×{count}</div>
              </button>
            );
          })}
        </div>
      )}

      <div className="bp-section-title"><Package size={14} /> 道具库存</div>
      {totalItems === 0 ? (
        <div className="bp-empty">背包里还没有道具。前往商店挑选肥料、防护或宠物用品。</div>
      ) : (
        Object.keys(itemsByCat).map((cat) => (
          <div key={cat}>
            <div className="bp-cat-label">{categoryLabel[cat] ?? cat}</div>
            <div className="bp-grid">
              {itemsByCat[cat].map((it) => {
                const def = SHOP_ITEMS_V2[it.key];
                return (
                  <button key={it.key} className="bp-card" onClick={() => onItemClick(it.key)}>
                    <div className="bp-emoji">{def.emoji}</div>
                    <div className="bp-name">{def.name}</div>
                    <div className="bp-count">×{it.count}</div>
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}
    </ModalShell>
  );
}

// ===================== EventLogModal （事件）=====================
interface EventLogModalProps {
  open: boolean;
  events: FarmEvent[];
  onClose: () => void;
}

export function EventLogModal({ open, events, onClose }: EventLogModalProps) {
  return (
    <ModalShell
      open={open} onClose={onClose} size="md"
      title={<><ScrollText /> 庄园事件日志</>}
    >
      <p className="lwf-modal-sub">最近 30 条庄园动态。</p>
      {events.length === 0 ? (
        <div className="bp-empty">还没有事件。开始种植第一颗种子吧。</div>
      ) : (
        <div className="event-list-modal">
          {events.map((e) => (
            <div key={e.id} className={`event-row ev-${e.type}`}>
              <span className="event-icon">{eventIconMap(e.type)}</span>
              <span className="event-text">{e.text}</span>
              <span className="event-time">{fmtTimeAgoMd(Date.now() - e.ts)}</span>
            </div>
          ))}
        </div>
      )}
    </ModalShell>
  );
}

// ===================== WeatherTvModal （电视机天气预报）=====================
interface WeatherTvModalProps {
  open: boolean;
  forecast: WeatherForecastV2;
  onClose: () => void;
}

function describeWeatherForecast(weather: WeatherV2): string {
  const def = WEATHERS_V2[weather];
  if (def.autoWaterMinutes > 0) return `${def.name}会自动补水，浇水压力会低很多。`;
  if (def.crowFactor === 0) return '乌鸦不会出没，成熟作物会更安全。';
  if (def.crowFactor >= 1.4) return '乌鸦风险偏高，建议提前准备防护。';
  if (def.crowFactor > 1) return '乌鸦会更活跃，成熟后尽量及时处理。';
  if (def.waterFactor < 1) return '天气偏干，作物更容易需要浇水。';
  if (def.waterFactor > 1) return '水分消耗较慢，作物照料会更从容。';
  return '天气平稳，适合正常种植和收获。';
}

export function WeatherTvModal({ open, forecast, onClose }: WeatherTvModalProps) {
  const tomorrow = forecast.tomorrow;
  const weather = WEATHERS_V2[tomorrow.weather];

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      size="md"
      title={<><Tv /> 电视机天气预报</>}
      footer={<button className="lwf-btn-primary" onClick={onClose}>知道了</button>}
    >
      <div className="weather-tv-card">
        <div className="weather-tv-screen">
          <div className="weather-tv-scanline" />
          <div className="weather-tv-emoji">{weather.emoji}</div>
          <div className="weather-tv-label">明日天气</div>
          <div className="weather-tv-title">{weather.name}</div>
        </div>
        <div className="weather-tv-info">
          <div>
            <span>日期</span>
            <strong>{tomorrow.date}</strong>
          </div>
          <div>
            <span>季节</span>
            <strong>{SEASON_LABEL[tomorrow.season]}</strong>
          </div>
        </div>
        <p className="weather-tv-tip">{describeWeatherForecast(tomorrow.weather)}</p>
      </div>
    </ModalShell>
  );
}

function eventIconMap(t: string): string {
  return ({
    mature: '🌟', wither: '🥀', crow_eat: '🐦', crow_chased: '🛡️',
    stolen_in: '😱', stolen_out: '😎', season_change: '🍃', pet_adopted: '🐾',
    pet_grow: '🌱', harvest: '🌾', plant: '🌱', water_rain: '🌧️', water_pet: '💧',
    pet_task: '🐾', land_buy: '🏞️', weather_change: '☀️', friday_event: '🎲',
  } as Record<string, string>)[t] ?? '•';
}

function fmtTimeAgoMd(ms: number): string {
  if (ms < 60_000) return '刚刚';
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}分钟前`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}小时前`;
  return `${Math.floor(ms / 86400_000)}天前`;
}

// ===================== LandQuickUseModal =====================
type LandUseMode = 'fertilizer' | 'item';

const FERTILIZER_ITEMS: ShopItemKey[] = ['fert_normal', 'fert_medium', 'fert_premium'];
const LAND_TOOL_ITEMS: ShopItemKey[] = ['birdnet', 'speed_normal', 'speed_premium'];
const NEEDS_LAND: ShopItemKey[] = [...FERTILIZER_ITEMS, ...LAND_TOOL_ITEMS];
const DIRECT_USE: ShopItemKey[] = ['scarecrow', 'bell', 'firework', 'cloud_bottle', 'last_supper', ...PET_SKILL_BOOK_KEYS];
const PASSIVE_ITEMS: ShopItemKey[] = ['weather_tv'];

function fertilizerName(type: FertilizerType): string {
  return type ? FERTILIZERS[type].name : '未施肥';
}

function canUseItemOnLand(itemKey: ShopItemKey, land: ComputedLand | null): boolean {
  if (!land || land.status === 'locked') return false;

  if (FERTILIZER_ITEMS.includes(itemKey)) {
    return !!land.crop
      && land.status !== 'mature'
      && land.status !== 'withered'
      && land.status !== 'eaten'
      && !land.crop.fertilizer;
  }

  if (itemKey === 'birdnet') {
    return !!land.crop && (land.status === 'growing' || land.status === 'thirsty' || land.status === 'mature');
  }

  if (itemKey === 'speed_normal' || itemKey === 'speed_premium') {
    return !!land.crop
      && land.status !== 'mature'
      && land.status !== 'withered'
      && land.status !== 'eaten'
      && land.crop.speedUsed < 1;
  }

  return true;
}

function itemDisabledReason(itemKey: ShopItemKey, land: ComputedLand | null, count: number): string {
  if (count <= 0) return '库存不足';
  if (!land?.crop) return '土地上没有作物';
  if (FERTILIZER_ITEMS.includes(itemKey) && land.crop.fertilizer) {
    return `已施用${fertilizerName(land.crop.fertilizer)}`;
  }
  if ((itemKey === 'speed_normal' || itemKey === 'speed_premium') && land.crop.speedUsed >= 1) {
    return '已用过加速';
  }
  if (land.status === 'mature') return '作物已成熟';
  if (land.status === 'withered' || land.status === 'eaten') return '土地不可用';
  return '当前不可用';
}

interface LandQuickUseModalProps {
  open: boolean;
  mode: LandUseMode;
  land: ComputedLand | null;
  inventory: Inventory;
  onClose: () => void;
  onUse: (key: ShopItemKey, plotIndex?: number) => Promise<void>;
}

export function LandQuickUseModal({ open, mode, land, inventory, onClose, onUse }: LandQuickUseModalProps) {
  const itemKeys = mode === 'fertilizer' ? FERTILIZER_ITEMS : LAND_TOOL_ITEMS;
  const title = mode === 'fertilizer' ? '使用肥料' : '使用道具';
  const cropName = land?.crop ? CROPS_V2[land.crop.cropId].name : '';

  return (
    <ModalShell
      open={open} onClose={onClose} size="md"
      title={<><Package /> {title}</>}
    >
      <div className="land-use-target">
        <span>第 {land?.index ?? '-'} 块地</span>
        {cropName && <strong>{cropName}</strong>}
        {land?.crop?.fertilizer && <em>已施用{fertilizerName(land.crop.fertilizer)}</em>}
      </div>
      <div className="land-use-list">
        {itemKeys.map((itemKey) => {
          const def = SHOP_ITEMS_V2[itemKey];
          const count = inventory[itemKey]?.count ?? 0;
          const canUse = count > 0 && canUseItemOnLand(itemKey, land);
          return (
            <button
              key={itemKey}
              className="land-use-row"
              disabled={!canUse}
              onClick={async () => {
                if (!land) return;
                await onUse(itemKey, land.index - 1);
              }}
            >
              <span className="land-use-emoji">{def.emoji}</span>
              <span className="land-use-copy">
                <strong>{def.name}</strong>
                <em>{def.description}</em>
              </span>
              <span className="land-use-count">
                {canUse ? `背包 ×${count}` : itemDisabledReason(itemKey, land, count)}
              </span>
            </button>
          );
        })}
      </div>
    </ModalShell>
  );
}

// ===================== LandDetailModal =====================
interface LandDetailModalProps {
  open: boolean;
  land: ComputedLand | null;
  onClose: () => void;
}

function landStatusName(status: ComputedLand['status']): string {
  return ({
    locked: '未解锁',
    empty: '空地',
    growing: '生长中',
    thirsty: '缺水',
    mature: '成熟',
    withered: '枯萎',
    eaten: '被乌鸦破坏',
  } as Record<ComputedLand['status'], string>)[status];
}

function cropStageName(stage: ComputedLand['stage']): string {
  if (!stage) return '无作物';
  return ({ seed: '种子期', sprout: '幼苗期', growing: '生长期', mature: '成熟期' } as Record<NonNullable<ComputedLand['stage']>, string>)[stage];
}

function qualityNameText(q: ComputedLand['expectedQualityHint']): string {
  if (!q) return '生长中';
  return ({ normal: '普通', silver: '银星', gold: '金星' } as Record<NonNullable<ComputedLand['expectedQualityHint']>, string>)[q];
}

type GrowthTimelineState = 'done' | 'active' | 'future';
type GrowthTimelineTone = 'normal' | 'warn';

interface GrowthTimelineItem {
  key: string;
  label: string;
  time: string;
  detail: string;
  state: GrowthTimelineState;
  tone: GrowthTimelineTone;
}

function buildGrowthTimeline(land: ComputedLand, crop: NonNullable<ComputedLand['crop']>): GrowthTimelineItem[] {
  const now = Date.now();
  const growthMs = Math.max(1, crop.matureAt - crop.plantedAt);
  const sproutAt = crop.plantedAt + Math.round(growthMs * 0.2);
  const growingAt = crop.plantedAt + Math.round(growthMs * 0.5);
  const overripeAt = crop.matureAt + 12 * 60 * 60 * 1000;
  const witherAt = crop.matureAt + 48 * 60 * 60 * 1000;

  const activeKey = (() => {
    if (land.status === 'withered') return 'wither';
    if (now >= witherAt) return 'wither';
    if (now >= overripeAt) return 'overripe';
    if (now >= crop.matureAt || land.status === 'mature') return 'mature';
    if (land.growthProgress >= 0.5) return 'growing';
    if (land.growthProgress >= 0.2) return 'sprout';
    return 'seed';
  })();

  const points = [
    { key: 'seed', label: '种子', at: crop.plantedAt, detail: '种下作物', tone: 'normal' as const },
    { key: 'sprout', label: '幼苗', at: sproutAt, detail: '成长 20%', tone: 'normal' as const },
    { key: 'growing', label: '生长', at: growingAt, detail: '成长 50%', tone: 'normal' as const },
    { key: 'mature', label: '成熟', at: crop.matureAt, detail: '可以收获', tone: 'normal' as const },
    { key: 'overripe', label: '过熟', at: overripeAt, detail: '收益开始下降', tone: 'warn' as const },
    { key: 'wither', label: '枯萎', at: witherAt, detail: '超时会枯萎', tone: 'warn' as const },
  ];

  return points.map((point) => ({
    key: point.key,
    label: point.label,
    time: fmtExactTime(point.at),
    detail: point.detail,
    tone: point.tone,
    state: point.key === activeKey ? 'active' : point.at < now ? 'done' : 'future',
  }));
}

export function LandDetailModal({ open, land, onClose }: LandDetailModalProps) {
  if (!open || !land) return null;
  const crop = land.crop;
  const cropDef = crop ? CROPS_V2[crop.cropId] : null;
  const progress = Math.round(land.growthProgress * 100);
  const fertilizer = crop ? fertilizerName(crop.fertilizer) : '无';
  const plantedAt = crop ? fmtExactTime(crop.plantedAt) : '-';
  const matureAt = crop ? fmtExactTime(crop.matureAt) : '-';
  const waterText = !crop || land.status === 'mature'
    ? '无需浇水'
      : land.nextWaterRemainingMs <= 0
      ? '现在需要浇水'
      : fmtMs(land.nextWaterRemainingMs);
  const timeline = crop ? buildGrowthTimeline(land, crop) : [];
  const activeTimelineIndex = Math.max(0, timeline.findIndex((item) => item.state === 'active'));
  const timelineProgress = timeline.length > 1
    ? (activeTimelineIndex / (timeline.length - 1)) * 100
    : 0;

  return (
    <ModalShell
      open={open} onClose={onClose} size="md"
      title={<><HelpCircle /> 土地详情</>}
      footer={<button className="lwf-btn-ghost" onClick={onClose}>关闭</button>}
    >
      <div className="land-detail">
        <div className="land-detail-head">
          <div className="land-detail-visual">
            {crop && cropDef ? (
              <CropSprite cropId={crop.cropId} stage={land.stage ?? 'seed'} size={72} />
            ) : (
              <Sprout size={34} />
            )}
          </div>
          <div>
            <h4 className="land-detail-title">
              第 {land.index} 块地
              <span>{landStatusName(land.status)}</span>
            </h4>
            <p className="land-detail-sub">
              {cropDef ? `${cropDef.name} · ${cropStageName(land.stage)}` : '当前没有种植作物'}
            </p>
          </div>
        </div>

        {crop && cropDef ? (
          <>
            <div className="land-detail-progress">
              <div className="land-detail-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <div
              className="land-growth-timeline"
              style={{ '--timeline-progress': `${timelineProgress}%` } as React.CSSProperties}
            >
              <div className="land-growth-line" />
              {timeline.map((item) => (
                <div key={item.key} className={`land-growth-step ${item.state} ${item.tone}`}>
                  <span className="land-growth-dot" />
                  <strong>{item.label}</strong>
                  <em>{item.time}</em>
                  <small>{item.detail}</small>
                </div>
              ))}
            </div>
            <div className="land-detail-grid">
              <div><span>成长进度</span><strong>{progress}%</strong></div>
              <div><span>距成熟</span><strong>{land.remainingMs > 0 ? fmtMs(land.remainingMs) : '已成熟'}</strong></div>
              <div><span>下次浇水</span><strong>{waterText}</strong></div>
              <div><span>缺水次数</span><strong>{crop.waterMissCount}</strong></div>
              <div><span>肥料</span><strong>{fertilizer}</strong></div>
              <div><span>预估品质</span><strong>{qualityNameText(land.expectedQualityHint)}</strong></div>
              <div><span>过熟系数</span><strong>×{land.overripeFactor.toFixed(1)}</strong></div>
              <div><span>被偷收益</span><strong>{crop.stolenAmount}</strong></div>
              <div><span>种植时间</span><strong>{plantedAt}</strong></div>
              <div><span>成熟时间</span><strong>{matureAt}</strong></div>
            </div>
            {(land.netActive || land.scarecrowActive || land.bellActive) && (
              <div className="land-detail-buffs">
                {land.netActive && <span>防鸟网生效</span>}
                {land.scarecrowActive && <span>稻草人生效</span>}
                {land.bellActive && <span>铃铛生效</span>}
              </div>
            )}
          </>
        ) : (
          <p className="land-detail-empty">点按空地后选择种植，可以挑选种子开始耕作。</p>
        )}
      </div>
    </ModalShell>
  );
}

function fmtExactTime(ts: number): string {
  const date = new Date(ts);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

// ===================== ItemDetailModal =====================
interface ItemDetailModalProps {
  itemKey: ShopItemKey | null;
  inventory: Inventory;
  lands: ComputedLand[];
  onClose: () => void;
  onUse: (key: ShopItemKey, plotIndex?: number) => Promise<void>;
}

export function ItemDetailModal({ itemKey, inventory, lands, onClose, onUse }: ItemDetailModalProps) {
  const [pickPlot, setPickPlot] = useState<number | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => { if (itemKey) setPickPlot(null); }, [itemKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!itemKey) return null;
  const def = SHOP_ITEMS_V2[itemKey];
  if (!def) return null;
  const count = inventory[itemKey]?.count ?? 0;
  const needsLand = NEEDS_LAND.includes(itemKey);
  const passiveItem = PASSIVE_ITEMS.includes(itemKey);
  const canUse = count > 0 && (needsLand ? pickPlot != null : true);

  // 哪些土地可作为目标？
  const eligibleLands = lands.filter((l) => {
    return canUseItemOnLand(itemKey, l);
  });

  return (
    <ModalShell
      open={!!itemKey} onClose={onClose} size="md"
      title={<><Package /> 道具详情</>}
      footer={
        passiveItem ? (
          <button className="lwf-btn-primary" onClick={onClose}>知道了</button>
        ) : (
          <button className="lwf-btn-primary" disabled={!canUse} onClick={() => onUse(itemKey, pickPlot ?? undefined)}>
            {count > 0 ? (needsLand && pickPlot == null ? '请先选择土地' : '使用道具') : '库存不足'}
          </button>
        )
      }
    >
      <div className="bp-detail">
        <div className="bp-detail-head">
          <div className="bp-detail-emoji">{def.emoji}</div>
          <div>
            <h4 className="bp-detail-name">{def.name} <span className="bp-detail-count">背包 ×{count}</span></h4>
            <p className="bp-detail-cat">{categoryName(def.category)} · 单价 {def.cost} 积分</p>
          </div>
        </div>
        <p className="bp-detail-desc">{def.description}</p>
        {def.durationMinutes && (
          <p className="bp-detail-extra">⏳ 持续时间 {def.durationMinutes >= 60 ? `${def.durationMinutes / 60} 小时` : `${def.durationMinutes} 分钟`}</p>
        )}
        {!needsLand && DIRECT_USE.includes(itemKey) && (
          <p className="bp-detail-hint">点击下方按钮即可使用，效果立即生效。</p>
        )}
        {itemKey === 'weather_tv' && (
          <p className="bp-detail-hint">电视机会安装在土地一览旁边，点击电视机按钮即可查看明日天气预报。</p>
        )}
        {PET_SKILL_BOOK_KEYS.includes(itemKey as (typeof PET_SKILL_BOOK_KEYS)[number]) && (
          <p className="bp-detail-hint">技能书只能由成年宠物学习，同一只宠物同技能只能学习一次；收菜和种菜会被动触发。</p>
        )}
        {needsLand && (
          <>
            <div className="bp-section-title"><Sprout size={14} /> 选择目标土地</div>
            {eligibleLands.length === 0 ? (
              <div className="bp-empty">当前没有可作用的土地。</div>
            ) : (
              <div className="bp-land-grid">
                {eligibleLands.map((land) => (
                  <button
                    key={land.index}
                    className={`bp-land-card ${pickPlot === land.index - 1 ? 'selected' : ''}`}
                    onClick={() => setPickPlot(land.index - 1)}
                  >
                    {land.crop && <CropSprite cropId={land.crop.cropId} stage={land.stage ?? 'seed'} size={36} />}
                    <strong>第 {land.index} 块</strong>
                    {land.crop && <span>{CROPS_V2[land.crop.cropId].name}</span>}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </ModalShell>
  );
}

function categoryName(cat: string): string {
  return ({ fertilizer: '肥料', protection: '防护', speed: '加速', pet: '宠物', special: '特殊' } as Record<string,string>)[cat] ?? cat;
}

// ===================== SeedDetailModal =====================
interface SeedDetailModalProps {
  cropId: CropIdV2 | null;
  seedInventory: Partial<Record<CropIdV2, number>>;
  currentSeason: Season;
  onClose: () => void;
}

export function SeedDetailModal({ cropId, seedInventory, currentSeason, onClose }: SeedDetailModalProps) {
  if (!cropId) return null;
  const c = CROPS_V2[cropId];
  const count = seedInventory[cropId] ?? 0;
  const inSeason = c.seasons.includes(currentSeason);

  return (
    <ModalShell
      open={!!cropId} onClose={onClose} size="md"
      title={<><Sprout /> 作物详情</>}
      footer={<button className="lwf-btn-ghost" onClick={onClose}>关闭</button>}
    >
      <div className="bp-detail">
        <div className="bp-detail-head">
          <div className="bp-detail-sprite"><CropSprite cropId={cropId} stage="mature" size={88} /></div>
          <div>
            <h4 className="bp-detail-name">{c.name}种子 <span className="bp-detail-count">背包 ×{count}</span></h4>
            <p className="bp-detail-cat">单价 {c.seedCost} 积分</p>
          </div>
        </div>
        <div className="bp-detail-stats">
          <div className="bp-stat"><div className="bp-stat-label">成长时间</div><div className="bp-stat-val">{c.growthMinutes} 分钟</div></div>
          <div className="bp-stat"><div className="bp-stat-label">浇水间隔</div><div className="bp-stat-val">{c.waterIntervalMinutes} 分钟</div></div>
          <div className="bp-stat"><div className="bp-stat-label">基础收益</div><div className="bp-stat-val">{c.baseYield} 积分</div></div>
          <div className="bp-stat"><div className="bp-stat-label">适宜季节</div><div className="bp-stat-val">{c.seasons.map((s) => SEASON_LABEL[s]).join('、')}</div></div>
          <div className="bp-stat"><div className="bp-stat-label">解锁条件</div><div className="bp-stat-val">{c.unlockLandCount} 块土地</div></div>
          <div className="bp-stat">
            <div className="bp-stat-label">当前可种</div>
            <div className="bp-stat-val">
              {inSeason ? <span style={{ color: '#16a34a', fontWeight: 800 }}>是</span> : <span style={{ color: '#dc2626', fontWeight: 800 }}>非本季</span>}
            </div>
          </div>
        </div>
        <p className="bp-detail-hint">长按空地后选择种植，可使用背包中的种子。换季时上一季种下的作物会枯萎，要在换季前及时收获。</p>
      </div>
    </ModalShell>
  );
}

// ===================== ModalStyles =====================
function ModalStyles() {
  return (
    <style jsx global>{`
      .lwf-modal-mask {
        position: fixed; inset: 0; z-index: 1000;
        display: flex; align-items: center; justify-content: center;
        padding: 24px; animation: lwfMaskIn 0.2s ease-out;
      }
      @keyframes lwfMaskIn { from { opacity: 0; } to { opacity: 1; } }
      .lwf-modal-backdrop {
        position: absolute; inset: 0;
        background: rgba(15, 23, 42, 0.45);
        backdrop-filter: blur(8px);
      }
      .lwf-modal {
        position: relative;
        background: linear-gradient(180deg, #ffffff 0%, #f0fdf4 100%);
        border-radius: 28px;
        max-width: 600px; width: 100%; max-height: 88vh;
        display: flex; flex-direction: column;
        box-shadow: 0 30px 60px rgba(0, 0, 0, 0.3);
        animation: lwfModalIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .lwf-modal.lwf-modal-md { max-width: 640px; }
      .lwf-modal.lwf-modal-lg { max-width: 820px; }
      @keyframes lwfModalIn { from { transform: translateY(20px) scale(0.96); opacity: 0; } to { transform: none; opacity: 1; } }
      .lwf-modal-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 22px 26px 16px;
        border-bottom: 1px solid rgba(15,23,42,0.06);
      }
      .lwf-modal-header h3 {
        display: flex; align-items: center; gap: 10px;
        margin: 0; font-size: 20px; font-weight: 800;
        color: #15803d; letter-spacing: -0.4px;
      }
      .lwf-modal-header h3 svg { width: 22px; height: 22px; }
      .lwf-modal-close {
        width: 32px; height: 32px; border-radius: 50%;
        background: rgba(15,23,42,0.04); border: none; color: #64748b;
        cursor: pointer; display: flex; align-items: center; justify-content: center;
        transition: all 0.2s;
      }
      .lwf-modal-close:hover { background: rgba(15,23,42,0.08); color: #1f2937; }
      .lwf-modal-close svg { width: 16px; height: 16px; }
      .lwf-modal-body { padding: 20px 26px; overflow-y: auto; flex: 1; }
      .lwf-modal-footer {
        padding: 14px 26px 18px; border-top: 1px solid rgba(15,23,42,0.06);
        display: flex; justify-content: flex-end; gap: 8px;
      }
      .lwf-modal-sub { font-size: 13px; color: #64748b; line-height: 1.6; margin: 0 0 16px; }

      .lwf-btn-primary {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 11px 22px; border: none; border-radius: 999px;
        background: linear-gradient(135deg, #84cc16, #16a34a);
        color: #fff; font-size: 14px; font-weight: 700;
        cursor: pointer; transition: all 0.2s;
        box-shadow: 0 8px 16px rgba(22, 163, 74, 0.3);
      }
      .lwf-btn-primary:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 12px 24px rgba(22, 163, 74, 0.4); }
      .lwf-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
      .lwf-btn-primary svg { width: 14px; height: 14px; }

      .farm-success-card {
        display: flex; align-items: center; gap: 14px;
        padding: 18px; border-radius: 18px;
        background: linear-gradient(135deg, rgba(236,252,203,0.95), rgba(220,252,231,0.95));
        border: 1px solid rgba(132,204,22,0.28);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.9);
      }
      .farm-success-icon {
        width: 58px; height: 58px; border-radius: 18px;
        display: flex; align-items: center; justify-content: center;
        background: rgba(255,255,255,0.84);
        box-shadow: 0 12px 24px rgba(22,163,74,0.14);
        font-size: 31px; flex-shrink: 0;
      }
      .farm-success-copy {
        display: flex; flex-direction: column; gap: 5px;
        min-width: 0;
      }
      .farm-success-copy strong {
        color: #14532d; font-size: 17px; font-weight: 900;
        line-height: 1.35;
      }
      .farm-success-copy span {
        color: #4b5563; font-size: 13px; line-height: 1.5;
      }

      /* Adopt */
      .adopt-summary {
        display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        width: fit-content; max-width: 100%;
        padding: 7px 12px; border-radius: 999px;
        background: rgba(132,204,22,0.12); color: #15803d;
        font-size: 12.5px; font-weight: 800; margin-bottom: 12px;
      }
      .adopt-summary strong { color: #14532d; font-weight: 900; }
      .adopt-summary em {
        font-style: normal; color: #b91c1c;
        background: rgba(254,226,226,0.75);
        padding: 2px 8px; border-radius: 999px;
      }
      .adopt-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .adopt-card {
        display: flex; flex-direction: column; align-items: center; gap: 6px;
        min-width: 0; min-height: 230px;
        padding: 16px 12px; background: #fff;
        border: 2px solid transparent; border-radius: 16px;
        cursor: pointer; transition: all 0.25s;
        box-shadow: 0 6px 18px rgba(15,23,42,0.05);
      }
      .adopt-card:hover { transform: translateY(-3px); border-color: #84cc16; box-shadow: 0 12px 24px rgba(132,204,22,0.2); }
      .adopt-card.selected { border-color: #16a34a; background: rgba(220,252,231,0.55); }
      .adopt-card h4 { font-size: 18px; font-weight: 800; color: #15803d; margin: 6px 0 0; }
      .adopt-card p { font-size: 12.5px; color: #64748b; margin: 0; line-height: 1.45; text-align: center; }
      .adopt-tag {
        display: inline-block; padding: 4px 10px; border-radius: 999px;
        font-size: 11px; font-weight: 700; margin-top: 2px;
      }
      .adopt-tag.t-orange { background: rgba(249,115,22,0.12); color: #c2410c; }
      .adopt-tag.t-amber { background: rgba(251,191,36,0.18); color: #92400e; }
      .adopt-tag.t-pink { background: rgba(244,114,182,0.14); color: #be185d; }
      .adopt-tag.t-russet { background: rgba(194,65,12,0.12); color: #9a3412; }
      .adopt-name-field {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        margin-top: 14px; padding: 8px 10px 8px 14px;
        border-radius: 999px; border: 1px solid rgba(15,23,42,0.08);
        background: #fff;
      }
      .adopt-name-field span { color: #64748b; font-size: 12.5px; font-weight: 800; flex-shrink: 0; }
      .adopt-name-field input {
        min-width: 0; flex: 1; height: 34px; border: none; outline: none;
        border-radius: 999px; background: rgba(132,204,22,0.10);
        color: #14532d; padding: 0 14px; font-size: 14px; font-weight: 800;
      }
      .adopt-naming {
        display: flex; flex-direction: column; align-items: center; gap: 10px;
      }
      .adopt-naming-visual {
        width: 120px; height: 120px; border-radius: 36px;
        background: linear-gradient(180deg, #f7fee7, #dcfce7);
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 6px 16px rgba(132,204,22,0.18);
      }
      .adopt-naming .adopt-name-field { width: 100%; margin-top: 4px; }

      /* Pet item picker */
      .pet-item-list { display: flex; flex-direction: column; gap: 8px; }
      .pet-item-row {
        display: flex; align-items: center; gap: 12px;
        width: 100%; padding: 12px 14px;
        background: #fff; border: 2px solid transparent; border-radius: 16px;
        box-shadow: 0 4px 12px rgba(15,23,42,0.04);
        cursor: pointer; transition: all 0.2s; text-align: left;
      }
      .pet-item-row:hover:not(:disabled) { transform: translateY(-2px); border-color: #84cc16; box-shadow: 0 8px 18px rgba(132,204,22,0.2); }
      .pet-item-row:disabled { opacity: 0.5; cursor: not-allowed; }
      .pet-item-emoji { width: 38px; font-size: 28px; text-align: center; flex-shrink: 0; }
      .pet-item-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
      .pet-item-copy strong { font-size: 14px; color: #15803d; font-weight: 900; display: inline-flex; align-items: center; gap: 6px; }
      .pet-item-copy span { font-size: 12px; color: #64748b; line-height: 1.45; }
      .pet-item-effect { color: #b45309 !important; font-weight: 700; }
      .pet-item-free {
        font-style: normal; padding: 1px 8px; border-radius: 999px;
        background: rgba(132,204,22,0.18); color: #15803d;
        font-size: 10.5px; font-weight: 800;
      }
      .pet-item-count {
        flex-shrink: 0; max-width: 128px;
        padding: 3px 9px; border-radius: 999px;
        background: rgba(132,204,22,0.14); color: #15803d;
        font-size: 11.5px; font-weight: 800; text-align: center; white-space: nowrap;
      }

      /* Plant */
      .plant-balance {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 7px 14px; border-radius: 999px;
        background: rgba(132,204,22,0.12); color: #15803d;
        font-size: 13px; font-weight: 700; margin-bottom: 14px;
      }
      .plant-balance svg { width: 14px; height: 14px; }
      .plant-balance strong { color: #14532d; font-weight: 900; }

      .plant-crops {
        display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
        margin-bottom: 16px;
      }
      .plant-crop-card {
        display: flex; flex-direction: column; align-items: center; gap: 4px;
        min-height: 172px;
        padding: 14px 8px 12px;
        background: #fff; border: 2px solid transparent; border-radius: 16px;
        cursor: pointer; transition: all 0.2s; position: relative;
        box-shadow: 0 4px 12px rgba(15,23,42,0.04);
      }
      .plant-crop-card.selected { border-color: #16a34a; background: rgba(220,252,231,0.55); }
      .plant-crop-card.disabled { opacity: 0.4; cursor: not-allowed; }
      .plant-crop-sprite { height: 74px; display: flex; align-items: center; justify-content: center; }
      .plant-crop-name { font-size: 14px; font-weight: 800; color: #15803d; }
      .plant-crop-meta { font-size: 11px; color: #64748b; }
      .plant-crop-yield { font-size: 11px; font-weight: 700; color: #d97706; background: rgba(251,191,36,0.16); padding: 1px 7px; border-radius: 6px; }
      .plant-crop-lock { position: absolute; top: 4px; right: 4px; padding: 2px 7px; border-radius: 6px; background: #fbbf24; color: #fff; font-size: 10px; font-weight: 800; }

      /* Harvest */
      .harvest-perfect-badge {
        background: linear-gradient(135deg, #fde047, #f59e0b);
        color: #fff; padding: 8px 14px; border-radius: 999px;
        font-size: 12.5px; font-weight: 800; text-align: center; margin-bottom: 14px;
        box-shadow: 0 8px 16px rgba(251,191,36,0.35);
      }
      .harvest-list { display: flex; flex-direction: column; gap: 10px; }
      .harvest-row {
        display: flex; align-items: center; gap: 12px;
        padding: 12px 14px; background: #fff; border-radius: 16px;
        box-shadow: 0 4px 12px rgba(15,23,42,0.04);
      }
      .harvest-row.q-gold { background: linear-gradient(135deg, rgba(254,243,199,0.95), rgba(254,215,170,0.55)); }
      .harvest-row.q-silver { background: linear-gradient(135deg, rgba(241,245,249,0.95), rgba(226,232,240,0.55)); }
      .harvest-info { flex: 1; min-width: 0; }
      .harvest-name { font-weight: 800; color: #15803d; display: flex; align-items: center; gap: 8px; }
      .harvest-badge { padding: 2px 8px; border-radius: 8px; font-size: 11px; font-weight: 700; }
      .harvest-badge.q-gold { background: #fbbf24; color: #fff; }
      .harvest-badge.q-silver { background: #94a3b8; color: #fff; }
      .harvest-badge.q-normal { background: #e5e7eb; color: #4b5563; }
      .harvest-formula { font-size: 11px; color: #64748b; margin-top: 3px; }
      .harvest-yield { font-size: 22px; font-weight: 900; color: #d97706; min-width: 70px; text-align: right; }
      .harvest-total {
        margin-top: 14px; padding: 12px 16px; border-radius: 14px;
        background: rgba(132,204,22,0.12); color: #15803d;
        font-size: 14px; text-align: center; font-weight: 700;
      }
      .harvest-total strong { color: #14532d; font-size: 18px; font-weight: 900; }
      .harvest-total.has-gold { background: linear-gradient(135deg, rgba(254,243,199,0.6), rgba(254,215,170,0.6)); }

      /* Shop */
      .shop-balance {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 7px 14px; border-radius: 999px;
        background: rgba(132,204,22,0.12); color: #15803d;
        font-size: 13px; font-weight: 700; margin-bottom: 12px; flex-wrap: wrap;
      }
      .shop-balance svg { width: 14px; height: 14px; }
      .shop-balance strong { color: #14532d; font-weight: 900; }
      .shop-buff { padding: 3px 10px; background: rgba(132,204,22,0.18); border-radius: 999px; font-size: 11.5px; font-weight: 700; }

      .shop-tabs {
        display: flex; gap: 6px; padding: 5px;
        background: rgba(132,204,22,0.08); border-radius: 999px;
        margin-bottom: 16px; flex-wrap: wrap;
      }
      .shop-tab {
        flex: 1; padding: 9px 16px; border: none;
        background: transparent; border-radius: 999px;
        font-size: 13px; font-weight: 700; color: #64748b;
        cursor: pointer; transition: all 0.2s; display: inline-flex; align-items: center; justify-content: center; gap: 4px;
        min-width: 80px;
      }
      .shop-tab.active { background: linear-gradient(135deg, #84cc16, #16a34a); color: #fff; box-shadow: 0 6px 14px rgba(22,163,74,0.3); }

      .shop-items { display: flex; flex-direction: column; gap: 8px; }
      .shop-row {
        display: flex; align-items: center; gap: 14px;
        padding: 12px 14px; background: #fff; border-radius: 16px;
        box-shadow: 0 4px 12px rgba(15,23,42,0.04);
      }
      .shop-emoji { font-size: 28px; width: 50px; text-align: center; flex-shrink: 0; }
      .shop-info { flex: 1; min-width: 0; }
      .shop-name { font-weight: 800; color: #15803d; font-size: 14px; }
      .shop-stock { background: rgba(15,23,42,0.05); padding: 1px 8px; border-radius: 6px; font-size: 11px; color: #475569; margin-left: 6px; font-weight: 700; }
      .shop-desc { font-size: 12px; color: #64748b; margin-top: 2px; line-height: 1.5; }
      .shop-actions { display: flex; gap: 6px; flex-shrink: 0; }
      .shop-btn { padding: 8px 14px; border-radius: 999px; border: none; cursor: pointer; font-weight: 700; font-size: 12.5px; transition: all 0.2s; }
      .shop-btn.buy { background: linear-gradient(135deg, #84cc16, #16a34a); color: #fff; box-shadow: 0 6px 12px rgba(22,163,74,0.25); }
      .shop-btn.buy:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; }
      .shop-btn.use { background: rgba(56,189,248,0.15); color: #0284c7; }
      .shop-btn.use:hover { background: rgba(56,189,248,0.3); }

      /* Purchase quantity */
      .purchase-card {
        display: flex; align-items: center; gap: 14px;
        padding: 14px; border-radius: 18px;
        background: #fff; box-shadow: 0 4px 12px rgba(15,23,42,0.04);
        margin-bottom: 14px;
      }
      .purchase-visual {
        width: 82px; height: 82px; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        border-radius: 22px; background: rgba(132,204,22,0.12);
      }
      .purchase-visual span { font-size: 34px; }
      .purchase-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .purchase-info strong { color: #15803d; font-size: 16px; font-weight: 900; }
      .purchase-info span { color: #64748b; font-size: 12.5px; line-height: 1.45; }
      .purchase-info em {
        width: fit-content; font-style: normal;
        padding: 2px 8px; border-radius: 999px;
        background: rgba(15,23,42,0.06); color: #475569;
        font-size: 11px; font-weight: 800;
      }
      .purchase-summary {
        display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        margin-bottom: 14px;
      }
      .purchase-summary span {
        padding: 5px 10px; border-radius: 999px;
        background: rgba(132,204,22,0.12); color: #15803d;
        font-size: 12px; font-weight: 800;
      }
      .purchase-summary strong { color: #14532d; font-weight: 900; }
      .purchase-qty-row {
        display: grid; grid-template-columns: 44px minmax(0, 1fr) 44px;
        align-items: stretch; gap: 10px; margin-bottom: 14px;
      }
      .purchase-step {
        width: 44px; height: 44px; border: none; border-radius: 50%;
        display: inline-flex; align-items: center; justify-content: center;
        background: rgba(132,204,22,0.14); color: #15803d;
        cursor: pointer; transition: all 0.2s;
      }
      .purchase-step:hover:not(:disabled) { background: linear-gradient(135deg, #84cc16, #16a34a); color: #fff; transform: translateY(-1px); }
      .purchase-step:disabled { opacity: 0.4; cursor: not-allowed; }
      .purchase-step svg { width: 17px; height: 17px; }
      .purchase-input-wrap {
        min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 10px;
        padding: 6px 8px 6px 14px; border-radius: 999px;
        background: #fff; border: 1px solid rgba(15,23,42,0.08);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.8);
      }
      .purchase-input-wrap span { color: #64748b; font-size: 12px; font-weight: 800; }
      .purchase-input-wrap input {
        width: 96px; height: 32px; border: none; outline: none;
        border-radius: 999px; background: rgba(132,204,22,0.10);
        color: #14532d; text-align: center; font-size: 16px; font-weight: 900;
      }
      .purchase-total {
        display: flex; align-items: center; justify-content: center; gap: 6px; flex-wrap: wrap;
        padding: 12px 14px; border-radius: 16px;
        background: rgba(220,252,231,0.7); color: #15803d;
        font-size: 14px; font-weight: 800;
      }
      .purchase-total strong { color: #14532d; font-size: 20px; font-weight: 900; }
      .purchase-total.disabled { background: rgba(254,226,226,0.7); color: #b91c1c; }
      .purchase-total span { width: 100%; text-align: center; font-size: 12px; font-weight: 700; }

      /* Steal */
      .steal-empty { text-align: center; padding: 30px; color: #94a3b8; font-size: 14px; }
      .steal-list { display: flex; flex-direction: column; gap: 10px; }
      .steal-row {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        padding: 12px 14px; background: #fff; border-radius: 16px;
        box-shadow: 0 4px 12px rgba(15,23,42,0.04);
      }
      .steal-person { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .steal-avatar {
        width: 42px; height: 42px; border-radius: 14px; flex: 0 0 auto;
        overflow: hidden; display: flex; align-items: center; justify-content: center;
        background: linear-gradient(135deg, #dcfce7, #bbf7d0);
        color: #15803d; font-size: 16px; font-weight: 900;
        box-shadow: inset 0 0 0 1px rgba(22,163,74,0.14);
      }
      .steal-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .steal-copy { min-width: 0; }
      .steal-name {
        font-weight: 800; color: #15803d; overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap;
      }
      .steal-hint { margin-top: 3px; font-size: 11px; color: #94a3b8; font-weight: 700; }
      .steal-crop {
        flex: 0 0 auto; display: flex; align-items: center; justify-content: center; gap: 6px;
        min-height: 34px; padding: 7px 14px; border: none; border-radius: 999px;
        background: rgba(132,204,22,0.1); color: #15803d;
        font-size: 12px; font-weight: 700; cursor: pointer; transition: all 0.2s;
      }
      .steal-crop:hover { background: rgba(132,204,22,0.25); transform: translateY(-1px); }
      .steal-result { margin-top: 14px; text-align: center; padding: 11px; background: rgba(220,252,231,0.7); border-radius: 12px; color: #15803d; font-weight: 700; }

      /* land quick use */
      .land-use-target {
        display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        padding: 10px 14px; border-radius: 14px;
        background: rgba(132,204,22,0.10);
        color: #15803d; font-size: 13px; margin-bottom: 12px;
      }
      .land-use-target span { font-weight: 800; }
      .land-use-target strong { color: #14532d; font-weight: 900; }
      .land-use-target em {
        font-style: normal; padding: 2px 8px; border-radius: 999px;
        background: rgba(251,191,36,0.18); color: #b45309;
        font-size: 11.5px; font-weight: 800;
      }
      .land-use-list { display: flex; flex-direction: column; gap: 8px; }
      .land-use-row {
        display: flex; align-items: center; gap: 12px;
        width: 100%; padding: 12px 14px;
        background: #fff; border: 2px solid transparent; border-radius: 16px;
        box-shadow: 0 4px 12px rgba(15,23,42,0.04);
        cursor: pointer; transition: all 0.2s; text-align: left;
      }
      .land-use-row:hover:not(:disabled) { transform: translateY(-2px); border-color: #84cc16; box-shadow: 0 8px 18px rgba(132,204,22,0.2); }
      .land-use-row:disabled { opacity: 0.5; cursor: not-allowed; }
      .land-use-emoji { width: 38px; font-size: 28px; text-align: center; flex-shrink: 0; }
      .land-use-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
      .land-use-copy strong { font-size: 14px; color: #15803d; font-weight: 900; }
      .land-use-copy em { font-style: normal; font-size: 12px; color: #64748b; line-height: 1.45; }
      .land-use-count {
        flex-shrink: 0; max-width: 128px;
        padding: 3px 9px; border-radius: 999px;
        background: rgba(132,204,22,0.14); color: #15803d;
        font-size: 11.5px; font-weight: 800; text-align: center;
      }

      /* land detail */
      .land-detail { display: flex; flex-direction: column; gap: 14px; }
      .land-detail-head { display: flex; align-items: center; gap: 14px; }
      .land-detail-visual {
        width: 82px; height: 82px; border-radius: 22px;
        display: flex; align-items: center; justify-content: center;
        background: linear-gradient(180deg, #f7fee7, #dcfce7);
        color: #15803d; flex-shrink: 0;
      }
      .land-detail-title {
        display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        margin: 0; font-size: 18px; font-weight: 900; color: #15803d;
      }
      .land-detail-title span {
        padding: 2px 9px; border-radius: 999px;
        background: rgba(132,204,22,0.16);
        color: #65a30d; font-size: 11.5px; font-weight: 900;
      }
      .land-detail-sub { margin: 5px 0 0; font-size: 13px; color: #64748b; font-weight: 700; }
      .land-detail-progress {
        height: 8px; border-radius: 999px; overflow: hidden;
        background: rgba(15,23,42,0.06);
      }
      .land-detail-progress-fill {
        height: 100%; border-radius: 999px;
        background: linear-gradient(135deg, #84cc16, #16a34a);
      }
      .land-growth-timeline {
        --timeline-progress: 0%;
        position: relative;
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 8px;
        padding: 18px 8px 10px;
        border-radius: 16px;
        background: linear-gradient(180deg, rgba(247,254,231,0.9), rgba(255,255,255,0.95));
        box-shadow: 0 4px 14px rgba(15,23,42,0.05);
        overflow: hidden;
      }
      .land-growth-line {
        position: absolute;
        left: 36px;
        right: 36px;
        top: 32px;
        height: 4px;
        border-radius: 999px;
        background: rgba(148,163,184,0.22);
      }
      .land-growth-line::after {
        content: '';
        position: absolute;
        inset: 0 auto 0 0;
        width: var(--timeline-progress);
        border-radius: inherit;
        background: linear-gradient(90deg, #84cc16, #16a34a, #f59e0b);
      }
      .land-growth-step {
        position: relative;
        z-index: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
        text-align: center;
      }
      .land-growth-dot {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #e2e8f0;
        box-shadow: 0 0 0 4px #fff;
      }
      .land-growth-step.done .land-growth-dot {
        background: linear-gradient(135deg, #84cc16, #16a34a);
      }
      .land-growth-step.active .land-growth-dot {
        background: linear-gradient(135deg, #facc15, #f59e0b);
        box-shadow: 0 0 0 4px #fff, 0 0 0 8px rgba(245,158,11,0.16);
      }
      .land-growth-step.warn.active .land-growth-dot {
        background: linear-gradient(135deg, #fb923c, #ef4444);
        box-shadow: 0 0 0 4px #fff, 0 0 0 8px rgba(239,68,68,0.16);
      }
      .land-growth-step strong {
        margin-top: 4px;
        color: #14532d;
        font-size: 11.5px;
        font-weight: 900;
      }
      .land-growth-step.future strong { color: #94a3b8; }
      .land-growth-step.warn strong { color: #b45309; }
      .land-growth-step.warn.active strong { color: #b91c1c; }
      .land-growth-step em,
      .land-growth-step small {
        max-width: 100%;
        font-style: normal;
        color: #64748b;
        font-size: 10px;
        font-weight: 700;
        line-height: 1.2;
        overflow-wrap: anywhere;
      }
      .land-growth-step small { color: #94a3b8; }
      .land-detail-grid {
        display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;
      }
      .land-detail-grid div {
        padding: 10px 12px; border-radius: 13px;
        background: #fff; box-shadow: 0 3px 10px rgba(15,23,42,0.04);
      }
      .land-detail-grid span {
        display: block; font-size: 11px; color: #64748b; font-weight: 800;
      }
      .land-detail-grid strong {
        display: block; margin-top: 3px; font-size: 13px;
        color: #15803d; font-weight: 900;
      }
      .land-detail-buffs { display: flex; gap: 6px; flex-wrap: wrap; }
      .land-detail-buffs span {
        padding: 5px 10px; border-radius: 999px;
        background: rgba(59,130,246,0.12); color: #2563eb;
        font-size: 12px; font-weight: 800;
      }
      .land-detail-empty {
        margin: 0; padding: 16px; border-radius: 14px;
        background: rgba(132,204,22,0.08);
        color: #15803d; font-size: 13px; font-weight: 700;
      }

      /* Rules detail */
      .rules-legend {
        display: flex; flex-wrap: wrap; gap: 8px;
        padding: 10px 12px; margin-bottom: 14px;
        background: rgba(15,23,42,0.03); border-radius: 12px;
      }
      .rules-legend-item {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 4px 10px; border-radius: 999px;
        font-size: 12px; font-weight: 800; line-height: 1;
        border: 1px solid transparent;
      }
      .rules-legend-item .rl-dot { font-size: 12px; }
      .rules-legend-item.lvl-critical  { background: rgba(220,38,38,0.10); color: #b91c1c; border-color: rgba(220,38,38,0.25); }
      .rules-legend-item.lvl-important { background: rgba(234,88,12,0.10); color: #c2410c; border-color: rgba(234,88,12,0.25); }
      .rules-legend-item.lvl-advanced  { background: rgba(124,58,237,0.10); color: #6d28d9; border-color: rgba(124,58,237,0.25); }
      .rules-legend-item.lvl-basic     { background: rgba(2,132,199,0.10); color: #0369a1; border-color: rgba(2,132,199,0.25); }

      .rules-detail { display: flex; flex-direction: column; gap: 14px; }
      .rules-section {
        position: relative;
        padding: 14px 16px 14px 22px; background: #fff; border-radius: 16px;
        box-shadow: 0 4px 12px rgba(15,23,42,0.05);
        border: 1px solid rgba(15,23,42,0.04);
      }
      .rules-section::before {
        content: ''; position: absolute; left: 0; top: 14px; bottom: 14px;
        width: 5px; border-radius: 0 4px 4px 0;
        background: #94a3b8;
      }
      .rules-section.lvl-critical  { background: linear-gradient(180deg, #fff5f5, #fff); border-color: rgba(220,38,38,0.18); }
      .rules-section.lvl-critical::before  { background: linear-gradient(180deg, #f87171, #dc2626); }
      .rules-section.lvl-important { background: linear-gradient(180deg, #fff8f1, #fff); border-color: rgba(234,88,12,0.18); }
      .rules-section.lvl-important::before { background: linear-gradient(180deg, #fb923c, #ea580c); }
      .rules-section.lvl-advanced  { background: linear-gradient(180deg, #faf6ff, #fff); border-color: rgba(124,58,237,0.18); }
      .rules-section.lvl-advanced::before  { background: linear-gradient(180deg, #a78bfa, #7c3aed); }
      .rules-section.lvl-basic     { background: linear-gradient(180deg, #f1f9ff, #fff); border-color: rgba(2,132,199,0.18); }
      .rules-section.lvl-basic::before     { background: linear-gradient(180deg, #38bdf8, #0284c7); }

      .rules-section-title {
        display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
        font-size: 15px; font-weight: 800; color: #0f172a;
        margin-bottom: 10px;
      }
      .rules-section-name { color: inherit; }
      .rules-icon { font-size: 16px; }
      .rules-num {
        background: #e2e8f0;
        color: #475569; font-size: 11px; font-weight: 900;
        padding: 3px 9px; border-radius: 999px; letter-spacing: 1px;
      }
      .rules-section.lvl-critical  .rules-section-name { color: #991b1b; }
      .rules-section.lvl-critical  .rules-num { background: linear-gradient(135deg, #fca5a5, #dc2626); color: #fff; }
      .rules-section.lvl-important .rules-section-name { color: #9a3412; }
      .rules-section.lvl-important .rules-num { background: linear-gradient(135deg, #fdba74, #ea580c); color: #fff; }
      .rules-section.lvl-advanced  .rules-section-name { color: #5b21b6; }
      .rules-section.lvl-advanced  .rules-num { background: linear-gradient(135deg, #c4b5fd, #7c3aed); color: #fff; }
      .rules-section.lvl-basic     .rules-section-name { color: #075985; }
      .rules-section.lvl-basic     .rules-num { background: linear-gradient(135deg, #7dd3fc, #0284c7); color: #fff; }

      .rules-level-badge {
        margin-left: auto; padding: 3px 10px; border-radius: 999px;
        font-size: 11px; font-weight: 800; letter-spacing: 0.5px;
        background: rgba(15,23,42,0.06); color: #475569;
      }
      .rules-section.lvl-critical  .rules-level-badge { background: rgba(220,38,38,0.14); color: #b91c1c; }
      .rules-section.lvl-important .rules-level-badge { background: rgba(234,88,12,0.14); color: #c2410c; }
      .rules-section.lvl-advanced  .rules-level-badge { background: rgba(124,58,237,0.14); color: #6d28d9; }
      .rules-section.lvl-basic     .rules-level-badge { background: rgba(2,132,199,0.14); color: #0369a1; }

      .rules-detail-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
      .rules-detail-list li {
        font-size: 13px; color: #475569; line-height: 1.6;
        padding-left: 16px; position: relative;
      }
      .rules-detail-list li::before {
        content: '•'; position: absolute; left: 4px; font-weight: 800; color: #94a3b8;
      }
      .rules-section.lvl-critical  .rules-detail-list li::before { color: #dc2626; }
      .rules-section.lvl-important .rules-detail-list li::before { color: #ea580c; }
      .rules-section.lvl-advanced  .rules-detail-list li::before { color: #7c3aed; }
      .rules-section.lvl-basic     .rules-detail-list li::before { color: #0284c7; }

      /* 背包 / 详情 */
      .bp-summary {
        display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
        padding: 10px 14px; border-radius: 14px;
        background: rgba(132,204,22,0.10); margin-bottom: 12px;
        font-size: 13px; color: #15803d;
      }
      .bp-summary span { display: inline-flex; align-items: center; gap: 4px; }
      .bp-summary strong { color: #14532d; font-weight: 900; margin: 0 4px; }
      .bp-section-title {
        display: flex; align-items: center; gap: 6px;
        font-size: 13.5px; font-weight: 800; color: #15803d;
        margin: 14px 0 8px;
      }
      .bp-cat-label { font-size: 12px; font-weight: 800; color: #65a30d; margin: 8px 0 6px; letter-spacing: 0.5px; }
      .bp-empty { padding: 18px; text-align: center; font-size: 13px; color: #94a3b8; background: rgba(15,23,42,0.03); border-radius: 12px; }
      .bp-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
      .bp-card {
        display: flex; flex-direction: column; align-items: center; gap: 4px;
        min-height: 134px;
        padding: 12px 8px 10px; background: #fff;
        border: 2px solid transparent; border-radius: 16px;
        cursor: pointer; transition: all 0.2s; position: relative;
        box-shadow: 0 4px 12px rgba(15,23,42,0.04);
      }
      .bp-card:hover { transform: translateY(-2px); border-color: #84cc16; box-shadow: 0 8px 18px rgba(132,204,22,0.2); }
      .bp-card.seed { background: linear-gradient(180deg, #f7fee7, #ecfccb); }
      .bp-emoji { font-size: 28px; line-height: 1; padding: 2px 0; }
      .bp-sprite { height: 66px; display: flex; align-items: center; justify-content: center; }
      .bp-name { font-size: 12px; font-weight: 700; color: #15803d; text-align: center; line-height: 1.3; }
      .bp-count {
        font-size: 11px; font-weight: 800; color: #fff;
        background: linear-gradient(135deg, #84cc16, #16a34a);
        padding: 1px 9px; border-radius: 999px;
      }
      .bp-detail { display: flex; flex-direction: column; gap: 12px; }
      .bp-detail-head { display: flex; gap: 14px; align-items: center; }
      .bp-detail-emoji { font-size: 50px; line-height: 1; width: 70px; height: 70px; display: flex; align-items: center; justify-content: center; background: linear-gradient(180deg, #f7fee7, #ecfccb); border-radius: 18px; }
      .bp-detail-sprite { width: 92px; height: 92px; display: flex; align-items: center; justify-content: center; background: linear-gradient(180deg, #f7fee7, #ecfccb); border-radius: 20px; flex-shrink: 0; }
      .bp-detail-name { margin: 0; font-size: 18px; font-weight: 800; color: #15803d; display: flex; align-items: center; gap: 8px; }
      .bp-detail-count { font-size: 12px; padding: 2px 9px; border-radius: 999px; background: rgba(132,204,22,0.18); color: #15803d; font-weight: 800; }
      .bp-detail-cat { margin: 4px 0 0; font-size: 12.5px; color: #64748b; font-weight: 600; }
      .bp-detail-desc { padding: 12px 14px; background: rgba(132,204,22,0.08); border-radius: 12px; font-size: 13px; color: #15803d; line-height: 1.6; margin: 0; }
      .bp-detail-extra { font-size: 13px; color: #b45309; margin: 0; }
      .bp-detail-hint { font-size: 12px; color: #64748b; margin: 4px 0 0; line-height: 1.6; }
      .bp-detail-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
      .bp-stat { padding: 10px 12px; background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(15,23,42,0.04); }
      .bp-stat-label { font-size: 11px; color: #64748b; font-weight: 700; }
      .bp-stat-val { font-size: 14px; font-weight: 800; color: #15803d; margin-top: 2px; }
      .bp-land-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
      .bp-land-card {
        display: flex; flex-direction: column; align-items: center; gap: 2px;
        padding: 10px 6px; background: #fff;
        border: 2px solid transparent; border-radius: 14px;
        cursor: pointer; transition: all 0.2s;
        box-shadow: 0 4px 10px rgba(15,23,42,0.04);
      }
      .bp-land-card:hover { transform: translateY(-2px); border-color: #84cc16; }
      .bp-land-card.selected { border-color: #16a34a; background: rgba(220,252,231,0.55); }
      .bp-land-card strong { font-size: 12px; font-weight: 800; color: #15803d; }
      .bp-land-card span { font-size: 11px; color: #64748b; }

      /* weather TV */
      .weather-tv-card { display: flex; flex-direction: column; gap: 12px; }
      .weather-tv-screen {
        position: relative;
        overflow: hidden;
        min-height: 190px;
        border-radius: 22px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        color: #ecfeff;
        background:
          radial-gradient(circle at 22% 16%, rgba(255,255,255,0.28), transparent 28%),
          linear-gradient(135deg, #0f766e 0%, #0f172a 78%);
        box-shadow: inset 0 0 0 5px rgba(15,23,42,0.34), 0 18px 34px rgba(15,23,42,0.16);
      }
      .weather-tv-scanline {
        position: absolute; inset: 0; pointer-events: none; opacity: 0.12;
        background: repeating-linear-gradient(180deg, #fff 0 1px, transparent 1px 6px);
      }
      .weather-tv-emoji { position: relative; font-size: 54px; line-height: 1; filter: drop-shadow(0 8px 18px rgba(0,0,0,0.28)); }
      .weather-tv-label { position: relative; font-size: 12px; font-weight: 900; letter-spacing: 2px; color: rgba(236,254,255,0.72); }
      .weather-tv-title { position: relative; font-size: 32px; font-weight: 950; letter-spacing: 0; }
      .weather-tv-info { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .weather-tv-info div {
        padding: 11px 13px;
        border-radius: 14px;
        background: #fff;
        box-shadow: 0 4px 12px rgba(15,23,42,0.05);
      }
      .weather-tv-info span { display: block; font-size: 11px; font-weight: 800; color: #64748b; }
      .weather-tv-info strong { display: block; margin-top: 3px; font-size: 15px; font-weight: 900; color: #15803d; }
      .weather-tv-tip {
        margin: 0;
        padding: 12px 14px;
        border-radius: 14px;
        background: rgba(14,165,233,0.08);
        color: #0f766e;
        font-size: 13px;
        font-weight: 800;
        line-height: 1.55;
      }

      /* event log modal */
      .event-list-modal { display: flex; flex-direction: column; gap: 6px; max-height: 60vh; overflow-y: auto; }
      .event-list-modal .event-row {
        display: flex; align-items: center; gap: 10px;
        padding: 9px 12px; background: #fff;
        border-radius: 12px; font-size: 13px;
      }
      .event-list-modal .event-icon { font-size: 16px; flex-shrink: 0; }
      .event-list-modal .event-text { flex: 1; color: #1f2937; }
      .event-list-modal .event-time { color: #94a3b8; font-size: 11px; flex-shrink: 0; }
      .event-list-modal .event-row.ev-mature { background: rgba(254,243,199,0.5); }
      .event-list-modal .event-row.ev-crow_eat { background: rgba(254,226,226,0.5); }
      .event-list-modal .event-row.ev-stolen_in { background: rgba(254,226,226,0.5); }
      .event-list-modal .event-row.ev-stolen_out { background: rgba(220,252,231,0.5); }
      .event-list-modal .event-row.ev-harvest { background: rgba(220,252,231,0.5); }

      /* btn-ghost in modal */
      .lwf-btn-ghost {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 11px 22px; border: 1px solid rgba(15,23,42,0.12);
        background: #fff; color: #15803d;
        font-size: 13px; font-weight: 700;
        border-radius: 999px; cursor: pointer; transition: all 0.2s;
      }
      .lwf-btn-ghost:hover { background: rgba(132,204,22,0.1); border-color: #84cc16; }
      .lwf-btn-ghost svg { width: 14px; height: 14px; }

      /* shop sprite + locked rows */
      .shop-row.shop-row-locked { opacity: 0.55; }
      .shop-sprite-wrap { width: 64px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }

      /* plant crop "have" badge + empty state */
      .plant-crop-have { font-size: 11px; font-weight: 800; color: #15803d; background: rgba(132,204,22,0.14); padding: 1px 7px; border-radius: 6px; }
      .plant-crop-lock.empty { background: #94a3b8; }

      /* 响应式 */
      @media (max-width: 640px) {
        .lwf-modal { border-radius: 22px; }
        .lwf-modal-header { padding: 18px 20px 12px; }
        .lwf-modal-body { padding: 16px 20px; }
        .lwf-modal-footer { padding: 12px 20px 16px; }
        .adopt-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
        .adopt-card {
          min-height: 160px;
          padding: 10px 8px;
          border-radius: 14px;
          gap: 4px;
        }
        .adopt-card .farm-pet-sprite { width: 86px !important; height: 86px !important; }
        .adopt-card h4 { font-size: 14px; margin: 4px 0 0; }
        .adopt-card p { font-size: 11px; line-height: 1.4; }
        .adopt-tag { font-size: 10px; padding: 3px 8px; }
        .adopt-name-field { align-items: stretch; flex-direction: column; border-radius: 16px; }
        .plant-crops { grid-template-columns: repeat(3, 1fr); }
        .shop-row { flex-wrap: wrap; }
        .shop-actions { width: 100%; justify-content: flex-end; }
        .shop-tab { font-size: 12px; padding: 8px 10px; min-width: 60px; }
        .purchase-card { align-items: flex-start; }
        .purchase-summary { justify-content: center; }
        .bp-grid { grid-template-columns: repeat(3, 1fr); }
        .bp-land-grid { grid-template-columns: repeat(3, 1fr); }
        .bp-detail-stats { grid-template-columns: repeat(2, 1fr); }
        .steal-row { align-items: stretch; flex-direction: column; }
        .steal-crop { width: 100%; }
      }

      /* === 手机端重排 v2：参考排行榜/游戏中心 === */
      @media (max-width: 640px) {
        /* 弹窗本身：贴近底部更易触达，整体瘦身 */
        .lwf-modal-mask {
          padding: 12px;
          align-items: flex-end;
        }
        .lwf-modal {
          width: 100%;
          max-height: calc(100vh - 24px);
          max-height: calc(100dvh - 24px);
          border-radius: 22px;
        }
        .lwf-modal-header {
          padding: 14px 16px 10px;
          gap: 10px;
        }
        .lwf-modal-header h3 { font-size: 16px; }
        .lwf-modal-body {
          padding: 14px 16px;
          gap: 12px;
        }
        .lwf-modal-footer {
          padding: 10px 16px max(14px, calc(10px + env(safe-area-inset-bottom)));
          gap: 8px;
          flex-wrap: wrap;
        }
        .lwf-modal-footer button {
          flex: 1 1 auto;
          min-width: 0;
          padding: 11px 14px;
          font-size: 13px;
        }

        /* 商店 row：图标 + 信息 + 按钮纵向更舒展 */
        .shop-row {
          display: grid;
          grid-template-columns: 70px minmax(0, 1fr);
          gap: 12px;
          padding: 12px;
          border-radius: 14px;
        }
        .shop-sprite-wrap {
          grid-row: 1 / 3;
          width: 70px;
        }
        .shop-actions {
          grid-column: 2;
          width: 100%;
          justify-content: space-between;
          gap: 8px;
        }
        .shop-actions button {
          padding: 8px 12px;
          font-size: 12.5px;
        }
        .shop-tab {
          font-size: 11.5px;
          padding: 7px 9px;
          min-width: 54px;
        }

        /* 种植/背包/土地网格：480-640 保持 3 列但更紧凑 */
        .plant-crops { gap: 8px; }
        .bp-grid { gap: 8px; }
        .bp-land-grid { gap: 8px; }

        /* 事件日志 */
        .event-list-modal .event-row {
          flex-wrap: wrap;
          padding: 8px 10px;
          font-size: 12px;
        }
        .event-list-modal .event-time { width: 100%; padding-left: 26px; }
      }

      @media (max-width: 480px) {
        .lwf-modal-mask { padding: 8px; }
        .lwf-modal { border-radius: 20px; }
        .lwf-modal-header { padding: 12px 14px 8px; gap: 8px; }
        .lwf-modal-header h3 { font-size: 15px; }
        .lwf-modal-body { padding: 12px 14px; gap: 10px; }
        .lwf-modal-footer {
          padding: 10px 14px max(14px, calc(10px + env(safe-area-inset-bottom)));
          flex-direction: column;
        }
        .lwf-modal-footer button { width: 100%; flex: none; }

        /* 480px 时三列网格切换为两列，避免按钮过窄 */
        .plant-crops { grid-template-columns: repeat(2, 1fr); }
        .bp-grid { grid-template-columns: repeat(2, 1fr); }
        .bp-land-grid { grid-template-columns: repeat(2, 1fr); }
        .bp-detail-stats { grid-template-columns: 1fr; }

        /* 宠物领养：保持 2 列但更紧凑 */
        .adopt-grid { gap: 6px; }
        .adopt-card { min-height: 138px; padding: 8px 6px; border-radius: 12px; }
        .adopt-card .farm-pet-sprite { width: 72px !important; height: 72px !important; }
        .adopt-card h4 { font-size: 13px; margin: 3px 0 0; }
        .adopt-card p { font-size: 10.5px; }
        .adopt-tag { font-size: 9.5px; padding: 2px 7px; }

        .shop-row {
          grid-template-columns: 64px minmax(0, 1fr);
          padding: 10px;
          gap: 10px;
        }
        .shop-sprite-wrap { width: 64px; }
        .shop-actions { gap: 6px; }
        .shop-actions button { padding: 7px 10px; font-size: 12px; }
        .shop-tab { font-size: 11px; padding: 6px 8px; min-width: 50px; }

        .lwf-btn-ghost {
          padding: 9px 16px;
          font-size: 12px;
        }
      }
    `}</style>
  );
}
