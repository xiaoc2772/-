'use client';

// 战斗弹层：规则说明、幸运祝福 3 选 1、结算弹窗、横屏引导。

import { BookOpen, Heart, Loader2, RotateCcw, Shield, Smartphone, Sparkles, Sword, Trophy, X, Zap } from 'lucide-react';
import { useEffect } from 'react';
import { activeSkillDetail, activeSkillFor, ACTIVE_SKILL_MAX_LEVEL, skillGrowthDetail } from '@/lib/lucky-td/engine/active-skills';
import { getEngineData } from '@/lib/lucky-td/engine/data';
import type { GameResult } from '@/lib/lucky-td/engine/types';
import type { LuckyTdSubmitData } from '@/lib/lucky-td/api';
import { UNIT_STYLE } from '@/lib/lucky-td/renderer/draw';
import { ENEMY_MECHANICS } from '@/lib/lucky-td/ui-metadata';
import { LUCKY_TD_WIN_SCORE, MAX_SQUAD_SIZE, SQUAD_REWARD_BONUS_PER_MISSING_PERMYRIAD, squadBonusPermyriad } from '@/lib/lucky-td/constants';
import { EnemyPortrait, UnitPortrait } from './ArtThumbs';

const BLESSING_EMOJI = ['💧', '🛡️', '🏹', '💖', '🧿', '💰', '🎐', '🪽', '🌠', '📜', '⚙️', '📯'];
const DATA = getEngineData();

function formatFrames(frames: number): string {
  return `${(frames / DATA.config.engine.fps).toFixed(1)} 秒`;
}

function formatRes(value: number): string {
  return `${Math.round(value / 100)}%`;
}

function formatRewardMultiplier(permyriad: number): string {
  return `×${(permyriad / 10000).toFixed(2)}`;
}

interface RulesModalProps {
  open: boolean;
  onClose: () => void;
}

export function RulesModal({ open, onClose }: RulesModalProps) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }
  const engine = DATA.config.engine;
  const squadBonusStepPercent = Math.round(SQUAD_REWARD_BONUS_PER_MISSING_PERMYRIAD / 100);
  const soloMultiplier = formatRewardMultiplier(squadBonusPermyriad(1));
  return (
    <div
      className="ltd-rules-overlay fixed inset-0 z-[90] flex items-center justify-center px-4 py-5"
      role="dialog"
      aria-modal="true"
      aria-label="幸运塔防规则"
      onMouseDown={onClose}
    >
      <div
        className="ltd-rules-panel flex max-h-full w-full max-w-[1120px] flex-col overflow-hidden rounded-[30px] border border-white/90 bg-white/95 text-slate-950 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="ltd-rules-header flex shrink-0 items-center gap-3 border-b border-emerald-100/80 px-5 py-4">
          <div className="ltd-rules-icon flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/18 text-emerald-300">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <div className="text-lg font-black">幸运塔防规则</div>
            <div className="text-xs font-bold text-slate-500">部署、地图机制、敌人属性、幸运祝福与角色主动技能说明</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ltd-rules-close ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-white/80 transition"
            aria-label="关闭规则"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="ltd-rules-scroll min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="grid gap-4 lg:grid-cols-[0.95fr_1.35fr]">
            <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
              <div className="flex items-center gap-2 text-sm font-black text-emerald-200">
                <Shield className="h-4 w-4" />
                对局目标
              </div>
              <ul className="mt-3 space-y-2 text-sm font-bold leading-6 text-white/74">
                <li>守住全部 {DATA.config.maps[0]?.waves.length ?? 30} 波敌人，基地生命归零则失败。</li>
                <li>胜率统计要求完整守住 30 波且结算分数达到 {LUCKY_TD_WIN_SCORE} 分，未达分数线不计胜场。</li>
                <li>开局 {Math.floor(engine.initialCostMilli / 1000)} 费，费用上限 {Math.floor(engine.costMaxMilli / 1000)}。</li>
                <li>每秒自然回复 {(engine.costRegenMilliPerSec / 1000).toFixed(1)} 费，击杀、波次结算、祝福和部分技能可额外获得费用。</li>
                <li>每局最多选择 {MAX_SQUAD_SIZE} 名角色，同一角色场上只能存在 1 个。</li>
                <li>结算积分会按编队人数加成：{MAX_SQUAD_SIZE} 人为 ×1.00，每少 1 人额外 +{squadBonusStepPercent}%，1 人最高 {soloMultiplier}，每日积分上限仍会限制实际到账。</li>
              </ul>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
              <div className="flex items-center gap-2 text-sm font-black text-sky-200">
                <Sword className="h-4 w-4" />
                部署与战斗
              </div>
              <ul className="mt-3 grid gap-2 text-sm font-bold leading-6 text-white/74 sm:grid-cols-2">
                <li>近战角色部署在道路格，负责阻挡敌人；远程、治疗和光环角色部署在高台格。</li>
                <li>部署时必须选择朝向，角色只会按当前朝向模板攻击或治疗范围内目标。</li>
                <li>点击场上角色会显示射程、生命、撤退返费、主动技能与技能升级按钮。</li>
                <li>撤退会返还 {Math.floor(engine.retreatRefundPermyriad / 100)}% 部署费用，并进入该角色再部署冷却。</li>
                <li>第 {engine.blessingWaves.join(' / ')} 波结束后出现幸运祝福，必须选择后才会继续下一波。</li>
                <li>分数来自清波、击杀、幸运加分和剩余生命，地图难度会影响最终分数倍率。</li>
              </ul>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 lg:col-span-2">
              <div className="flex items-center gap-2 text-sm font-black text-rose-200">
                <Zap className="h-4 w-4" />
                波次与敌人机制
              </div>
              <ul className="mt-3 grid gap-2 text-sm font-bold leading-6 text-white/74 md:grid-cols-2">
                <li>每局会按本局种子重新生成刷怪表，敌人数量、种类、路线和出场间隔都会变化。</li>
                <li>每张地图都有独立的波次成长曲线；越到后期，敌人生命、攻击、攻速、护盾和技能数值越高。</li>
                <li>第 1~3 波以杂兵和少量疾影狼为主，数量少、出场慢，适合完成基础部署。</li>
                <li>第 4~8 波开始混入重甲卫、咒盾傀儡和飞翼哨兵，多路线压力和敌人数会明显上升。</li>
                <li>第 9 波后可能出现深渊魔王；第 10 波起若随机未抽到 Boss，会额外保底刷新 Boss。</li>
                <li>第 16~30 波仍会持续强化，但生命、攻击、攻速与护盾采用更平缓的成长曲线，给玩家保留调整阵容和技能的空间。</li>
                <li>第 15 波保留原有双 Boss 里程碑压力，第 30 波为最终决战波。</li>
                <li>疾影狼会突进，飞翼哨兵会俯冲，路面和防空压力会随路线随机分配变化。</li>
                <li>重甲卫、咒盾傀儡和深渊魔王会通过装甲、补盾、法抗和压迫技能拉高处理门槛。</li>
                <li>高等级角色技能会同时提高属性和范围，合理升级与释放主动技能是通关高难图的核心。</li>
              </ul>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 lg:col-span-2">
              <div className="flex items-center gap-2 text-sm font-black text-cyan-200">
                <Shield className="h-4 w-4" />
                地图机制
              </div>
              <div className="mt-3 grid gap-3 text-sm font-bold leading-6 text-white/74 md:grid-cols-2 xl:grid-cols-3">
                {DATA.config.maps.map((map) => (
                  <div key={map.id} className="rounded-2xl border border-white/10 bg-slate-900/70 p-3">
                    <div className="text-sm font-black text-white">{map.name}</div>
                    <div className="mt-1 text-xs font-black text-white/52">
                      {map.difficulty} · {map.rows}×{map.cols} · {map.paths.length} 路 · {map.rangedCells.length} 个高台位
                    </div>
                    <div className="mt-2 space-y-2">
                      {map.mechanics.length === 0 ? (
                        <div className="rounded-xl bg-white/[0.06] px-3 py-2 text-xs leading-5 text-white/62">无地图机制，适合熟悉部署、阻挡和射程。</div>
                      ) : null}
                      {map.mechanics.map((mechanic) => (
                        <div key={mechanic.id} className="rounded-xl bg-white/[0.06] px-3 py-2">
                          <div className="text-xs font-black text-cyan-200">{mechanic.name}</div>
                          <div className="mt-1 text-xs leading-5 text-white/68">{mechanic.desc}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 lg:col-span-2">
              <div className="flex items-center gap-2 text-sm font-black text-orange-200">
                <Sword className="h-4 w-4" />
                怪物属性与机制
              </div>
              <div className="mt-3 grid gap-3 text-sm font-bold leading-6 text-white/74 lg:grid-cols-2">
                {DATA.config.enemies.map((enemy, enemyIdx) => {
                  const stats = [
                    ['类型', enemy.flying ? '空中' : '地面'],
                    ['生命', String(enemy.hp)],
                    ['攻击', String(enemy.atk)],
                    ['攻击间隔', formatFrames(enemy.interval)],
                    ['防御', String(enemy.def)],
                    ['法抗', formatRes(enemy.res)],
                    ['移速', String(enemy.speed)],
                    ['基地损伤', String(enemy.dmgToBase)],
                    ['阻挡', enemy.blockable ? '可阻挡' : '不可阻挡'],
                  ];
                  return (
                    <div key={enemy.id} className="rounded-2xl border border-white/10 bg-slate-900/70 p-3">
                      <div className="flex items-start gap-3">
                        <div
                          className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-fuchsia-200/15 bg-gradient-to-br from-violet-400/20 via-fuchsia-400/10 to-slate-950/30 shadow-inner"
                          aria-hidden
                        >
                          <EnemyPortrait typeIdx={enemyIdx} size={50} />
                        </div>
                        <div className="min-w-0 flex-1 pt-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-base font-black text-white">{enemy.name}</span>
                            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-black text-white/58">{enemy.id}</span>
                            <span className="rounded-full bg-orange-400/15 px-2 py-0.5 text-[11px] font-black text-orange-200">
                              {enemy.flying ? '空中单位' : '地面单位'} · {enemy.blockable ? '可阻挡' : '不可阻挡'}
                            </span>
                          </div>
                          <p className="mt-1.5 text-xs font-bold leading-5 text-white/68">{ENEMY_MECHANICS[enemy.id] ?? '无额外机制。'}</p>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {stats.map(([label, value]) => (
                          <div key={label} className="rounded-xl bg-white/[0.055] px-2 py-2">
                            <div className="text-[10px] font-black text-white/45">{label}</div>
                            <div className="mt-0.5 text-xs font-black text-white/82">{value}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 lg:col-span-2">
              <div className="flex items-center gap-2 text-sm font-black text-amber-200">
                <Sparkles className="h-4 w-4" />
                幸运祝福全集
              </div>
              <div className="mt-3 grid gap-3 text-sm font-bold leading-6 text-white/74 md:grid-cols-2 xl:grid-cols-3">
                {DATA.config.blessings.map((blessing, idx) => (
                  <div key={blessing.id} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-slate-900/70 p-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-300/14 text-2xl" aria-hidden>
                      {BLESSING_EMOJI[idx] ?? '✨'}
                    </span>
                    <div>
                      <div className="text-sm font-black text-white">{blessing.name}</div>
                      <div className="mt-1 text-xs leading-5 text-white/68">{blessing.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 lg:col-span-2">
              <div className="flex items-center gap-2 text-sm font-black text-amber-200">
                <Zap className="h-4 w-4" />
                主动技能规则
              </div>
              <div className="mt-3 grid gap-3 text-sm font-bold leading-6 text-white/74 md:grid-cols-3">
                <p>每个角色拥有独立主动技能，初始 1 级，最高 {ACTIVE_SKILL_MAX_LEVEL} 级。</p>
                <p>升级消耗费用；释放技能后进入冷却，冷却期间不能再次释放。</p>
                <p>升级会同步提高角色攻击/治疗、生命、攻速，并仅在 Lv.5 与 Lv.10 扩大攻击或光环范围。</p>
              </div>
            </section>
          </div>

          <section className="mt-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-black text-white/85">
              <Sparkles className="h-4 w-4 text-amber-300" />
              角色技能详情
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {DATA.config.units.map((unit, idx) => {
                const skill = activeSkillFor(idx);
                const costs = skill.upgradeCosts.join(' / ');
                return (
                  <div key={unit.id} className="rounded-2xl border border-white/10 bg-white/[0.055] p-4">
                    <div className="flex items-start gap-3">
                      <div
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
                        style={{ backgroundColor: `${UNIT_STYLE[idx]?.color ?? '#10b981'}26` }}
                        aria-hidden
                      >
                        <UnitPortrait typeIdx={idx} size={40} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-black">{unit.name}</span>
                          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-black text-white/65">
                            {unit.cost} 费 · {unit.block > 0 ? `阻挡 ${unit.block}` : unit.atkType === 'heal' ? '治疗' : '远程'}
                          </span>
                          <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-black text-amber-200">
                            冷却 {Math.ceil(skill.cooldown / 30)}s
                          </span>
                        </div>
                        <div className="mt-1 text-sm font-black text-sky-200">{skill.name}</div>
                        <p className="mt-1 text-sm font-bold leading-6 text-white/68">{skill.desc}</p>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs font-bold text-white/70 sm:grid-cols-5">
                      {Array.from({ length: ACTIVE_SKILL_MAX_LEVEL }, (_, levelIdx) => (
                        <div key={levelIdx} className="rounded-xl bg-slate-900/70 px-2 py-2">
                          <div className="font-black text-white">Lv.{levelIdx + 1}</div>
                          <div className="mt-1 leading-5">{activeSkillDetail(idx, levelIdx + 1)}</div>
                          <div className="mt-1 leading-5 text-emerald-200/85">{skillGrowthDetail(levelIdx + 1)}</div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-black text-white/62">
                      <Heart className="h-3.5 w-3.5 text-rose-300" />
                      升级费用：{costs} 费
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
      <style jsx global>{`
        .ltd-rules-overlay {
          background:
            radial-gradient(circle at 16% 14%, rgba(167, 243, 208, 0.46), transparent 38%),
            radial-gradient(circle at 88% 18%, rgba(125, 211, 252, 0.24), transparent 34%),
            rgba(15, 23, 42, 0.42);
          backdrop-filter: blur(18px) saturate(1.25);
          -webkit-backdrop-filter: blur(18px) saturate(1.25);
        }

        .ltd-rules-panel {
          position: relative;
          box-shadow: 0 30px 90px rgba(15, 23, 42, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.96);
        }

        .ltd-rules-panel::before {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            linear-gradient(135deg, rgba(16, 185, 129, 0.1), transparent 34%),
            linear-gradient(315deg, rgba(14, 165, 233, 0.08), transparent 36%);
        }

        .ltd-rules-panel > * {
          position: relative;
          z-index: 1;
        }

        .ltd-rules-header {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(236, 253, 245, 0.82));
        }

        .ltd-rules-icon {
          background: linear-gradient(135deg, #34d399, #047857) !important;
          color: #fff !important;
          box-shadow: 0 12px 22px rgba(4, 120, 87, 0.26);
        }

        .ltd-rules-close {
          color: #047857;
          border: 1px solid rgba(255, 255, 255, 0.9);
          box-shadow: 0 10px 22px rgba(15, 23, 42, 0.08);
        }

        .ltd-rules-close:hover {
          transform: translateY(-1px);
          background: #ecfdf5;
          box-shadow: 0 14px 28px rgba(16, 185, 129, 0.15);
        }

        .ltd-rules-scroll {
          background: linear-gradient(180deg, rgba(248, 250, 252, 0.72), rgba(236, 253, 245, 0.46));
          scrollbar-color: rgba(16, 185, 129, 0.38) transparent;
        }

        .ltd-rules-scroll::-webkit-scrollbar {
          width: 10px;
        }

        .ltd-rules-scroll::-webkit-scrollbar-thumb {
          border: 3px solid transparent;
          border-radius: 999px;
          background: rgba(16, 185, 129, 0.34);
          background-clip: padding-box;
        }

        .ltd-rules-panel section {
          border-color: rgba(255, 255, 255, 0.9) !important;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(240, 253, 250, 0.68)) !important;
          box-shadow: 0 16px 34px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.92);
        }

        .ltd-rules-panel section > div:first-child {
          color: #047857 !important;
        }

        .ltd-rules-panel h2,
        .ltd-rules-panel h3,
        .ltd-rules-panel strong,
        .ltd-rules-panel .text-white {
          color: #0f172a !important;
        }

        .ltd-rules-panel [class*='text-white/'],
        .ltd-rules-panel ul,
        .ltd-rules-panel p {
          color: #475569 !important;
        }

        .ltd-rules-panel li::marker {
          color: #10b981;
        }

        .ltd-rules-panel [class*='bg-slate-900'] {
          border-color: rgba(16, 185, 129, 0.16) !important;
          background: rgba(255, 255, 255, 0.74) !important;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.92);
        }

        .ltd-rules-panel [class*='bg-white/'] {
          background: rgba(255, 255, 255, 0.62) !important;
        }

        .ltd-rules-panel [class*='text-sky-'],
        .ltd-rules-panel [class*='text-cyan-'],
        .ltd-rules-panel [class*='text-emerald-'] {
          color: #047857 !important;
        }

        .ltd-rules-panel [class*='text-amber-'],
        .ltd-rules-panel [class*='text-orange-'] {
          color: #b45309 !important;
        }

        .ltd-rules-panel [class*='text-rose-'] {
          color: #be123c !important;
        }

        .ltd-rules-panel [class*='rounded-full'] {
          border: 1px solid rgba(16, 185, 129, 0.14);
        }

        @media (max-width: 640px) {
          .ltd-rules-panel {
            max-height: calc(100vh - 18px);
            border-radius: 24px;
          }

          .ltd-rules-header {
            padding: 14px;
          }

          .ltd-rules-scroll {
            padding: 14px;
          }
        }
      `}</style>
    </div>
  );
}

interface BlessingPickerProps {
  options: number[] | null;
  onPick: (blessing: number) => void;
}

export function BlessingPicker({ options, onPick }: BlessingPickerProps) {
  if (!options) {
    return null;
  }
  const blessings = getEngineData().config.blessings;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/60 backdrop-blur-[6px]" role="dialog" aria-modal="true" aria-label="幸运祝福">
      <div className="mx-4 w-full max-w-[640px] rounded-[28px] border border-amber-200/40 bg-slate-900/90 p-5 text-white shadow-2xl">
        <div className="flex items-center justify-center gap-2 text-sm font-black tracking-wider text-amber-300">
          <Sparkles className="h-4 w-4" />
          幸运祝福 · 三选一
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {options.map((idx) => {
            const blessing = blessings[idx];
            return (
              <button
                key={idx}
                type="button"
                onClick={() => onPick(idx)}
                className="flex flex-col items-center gap-2 rounded-2xl border-2 border-white/15 bg-white/5 px-3 py-4 text-center transition hover:-translate-y-1 hover:border-amber-300/70 hover:bg-amber-400/10"
              >
                <span className="text-3xl" aria-hidden>
                  {BLESSING_EMOJI[idx] ?? '✨'}
                </span>
                <span className="text-sm font-black">{blessing?.name ?? '未知祝福'}</span>
                <span className="text-xs font-bold leading-5 text-white/70">{blessing?.desc ?? ''}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export interface ResultInfo {
  result: GameResult;
  submit: LuckyTdSubmitData | null;
  isLocal: boolean;
  submitError: string | null;
  submitting: boolean;
}

interface ResultModalProps {
  info: ResultInfo | null;
  cooldownRemaining: number;
  onRetrySubmit: () => void;
  onRestart: () => void;
  onExit: () => void;
}

export function ResultModal({ info, cooldownRemaining, onRetrySubmit, onRestart, onExit }: ResultModalProps) {
  if (!info) {
    return null;
  }
  const won = info.result.status === 1;
  const breakdown = info.result.breakdown;
  const rewardBase = info.submit?.basePoints ?? info.result.score;
  const rewardPoints = info.submit?.rewardPoints ?? rewardBase;
  const squadSize = info.submit?.squadSize ?? MAX_SQUAD_SIZE;
  const rewardBonusPermyriad = info.submit?.squadBonusPermyriad ?? 10000;
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/70 backdrop-blur-[8px]" role="dialog" aria-modal="true" aria-label="对局结算">
      <div className="mx-4 w-full max-w-[560px] rounded-[30px] border border-white/20 bg-slate-900/95 p-6 text-white shadow-2xl">
        <div className="flex flex-col items-center text-center">
          <div
            className={`flex h-16 w-16 items-center justify-center rounded-3xl text-white shadow-lg ${
              won ? 'bg-gradient-to-br from-amber-400 to-orange-500' : 'bg-gradient-to-br from-slate-500 to-slate-700'
            }`}
          >
            <Trophy className="h-8 w-8" />
          </div>
          <h2 className="mt-3 text-2xl font-black">{won ? '防线告捷！' : '防线失守'}</h2>
          <p className="mt-1 text-sm font-bold text-white/70">
            通过 {info.result.wavesCleared} 波 · 用时 {Math.round(info.result.frames / 30)} 秒
          </p>
        </div>

        <div className="mt-5 grid grid-cols-4 gap-2 text-center">
          {[
            ['波次', breakdown.waves],
            ['击杀', breakdown.kills],
            ['幸运', breakdown.lucky],
            ['生命', breakdown.lives],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-white/8 px-2 py-3">
              <div className="text-[10px] font-black uppercase tracking-wider text-white/60">{label}</div>
              <div className="mt-1 text-lg font-black text-emerald-300">{value}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-2xl bg-white/8 px-5 py-4 text-center">
          <div className="text-xs font-black uppercase tracking-wider text-white/60">本局得分</div>
          <div className="mt-1 text-4xl font-black text-amber-300">{info.result.score}</div>
          <div className="mt-2 text-sm font-bold text-white/80">
            {info.isLocal ? (
              <>
                本地试玩模式 · 本局不计积分
                {info.submit?.rewardPoints !== undefined && <span className="ml-2 text-emerald-300">理论 +{info.submit.rewardPoints}</span>}
              </>
            ) : info.submitting ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> 结算上报中…
              </span>
            ) : info.submitError ? (
              <span className="text-rose-300">{info.submitError}</span>
            ) : info.submit ? (
              <>
                获得积分 <span className="font-black text-emerald-300">+{info.submit.pointsEarned}</span>
                {info.submit.pointsLimitReached && <span className="ml-2 text-amber-300">（已达每日上限）</span>}
              </>
            ) : (
              '—'
            )}
          </div>
          {info.submit && (
            <div className="mt-2 text-xs font-black leading-5 text-white/58">
              基础积分 {rewardBase} · 编队 {squadSize} 人 · 少人倍率 {formatRewardMultiplier(rewardBonusPermyriad)}
              {rewardPoints !== rewardBase ? ` · 应得 ${rewardPoints}` : ''}
            </div>
          )}
          {info.submitError && !info.submitting && (
            <button
              type="button"
              onClick={onRetrySubmit}
              className="mt-2 rounded-full bg-white/15 px-4 py-1.5 text-xs font-black transition hover:bg-white/25"
            >
              重试上报
            </button>
          )}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onExit}
            className="rounded-2xl border border-white/20 bg-white/5 px-5 py-3 text-sm font-black transition hover:bg-white/15"
          >
            返回准备室
          </button>
          <button
            type="button"
            onClick={onRestart}
            disabled={cooldownRemaining > 0 || info.submitting}
            className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-black text-white shadow-lg transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" />
            {cooldownRemaining > 0 ? `冷却中 ${cooldownRemaining}s` : '再来一局'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 移动端竖屏时的横屏引导（纯 CSS 媒体变体控制显隐）。 */
export function RotateHint() {
  return (
    <div className="absolute inset-0 z-50 hidden items-center justify-center bg-slate-950/92 text-white portrait:flex">
      <div className="flex flex-col items-center gap-3 px-8 text-center">
        <Smartphone className="h-12 w-12 rotate-90 text-emerald-300" />
        <div className="text-lg font-black">请横屏游玩</div>
        <p className="text-sm font-bold text-white/70">幸运塔防为横屏战场，请旋转设备（或调宽窗口）继续战斗。</p>
      </div>
    </div>
  );
}
