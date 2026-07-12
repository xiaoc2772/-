'use client';

// 战斗 HUD：顶栏（波次/生命/费用/倍速/暂停/放弃）+ 底部部署托盘 + 选中单位面板。
// 只消费渲染器的 HudSnapshot，不直接接触引擎状态。

import { AlertTriangle, Flag, Heart, LogOut, Pause, Play, Shield, Sparkles, Swords, TrendingUp, Zap } from 'lucide-react';
import type { HudSnapshot } from '@/lib/lucky-td/renderer/renderer';
import { UnitPortrait } from './ArtThumbs';

interface BattleHudTopProps {
  hud: HudSnapshot;
  onToggleSpeed: () => void;
  onTogglePause: () => void;
  onSurrender: () => void;
}

export function BattleHudTop({ hud, onToggleSpeed, onTogglePause, onSurrender }: BattleHudTopProps) {
  return (
    <div className="ltd-hud-top">
      <div className="ltd-hud-stats">
        <div className="ltd-hud-stat">
          <Flag className="h-3.5 w-3.5 text-emerald-300" />
          <span>波次</span>
          <strong>
            {Math.min(hud.waveIndex, hud.totalWaves)}/{hud.totalWaves}
            {hud.phase === 0 && hud.status === 0 ? ` · ${hud.intermissionSeconds}s` : ''}
          </strong>
        </div>
        <div className="ltd-hud-stat">
          <Heart className="h-3.5 w-3.5 text-rose-400" fill="currentColor" />
          <span>生命</span>
          <strong>{hud.lives}</strong>
        </div>
        <div className="ltd-hud-stat">
          <Zap className="h-3.5 w-3.5 text-amber-300" fill="currentColor" />
          <span>费用</span>
          <strong>{hud.cost}</strong>
        </div>
        <div className="ltd-hud-stat">
          <Sparkles className="h-3.5 w-3.5 text-emerald-200" />
          <span>分数</span>
          <strong>{hud.scoreWaves + hud.scoreKills + hud.scoreLucky}</strong>
        </div>
      </div>
      <div className="ltd-hud-actions">
        <button
          type="button"
          onClick={onToggleSpeed}
          disabled={hud.paused}
          className="ltd-hud-button"
          aria-label="切换倍速"
        >
          {hud.speed}×
        </button>
        <button
          type="button"
          onClick={onTogglePause}
          className="ltd-hud-button"
          aria-label={hud.paused ? '继续' : '暂停'}
        >
          {hud.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={onSurrender}
          className="ltd-hud-button danger"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>放弃</span>
        </button>
      </div>
    </div>
  );
}

interface BattleHudTrayProps {
  hud: HudSnapshot;
  disabled: boolean;
  onSelectSquadUnit: (typeIdx: number) => void;
  onTrayDragStart: (typeIdx: number, point: { clientX: number; clientY: number }) => void;
  onRetreat: (unitId: number) => void;
  onUseSkill: (unitId: number) => void;
  onUpgradeSkill: (unitId: number) => void;
}

export function BattleHudTray({ hud, disabled, onSelectSquadUnit, onTrayDragStart, onRetreat, onUseSkill, onUpgradeSkill }: BattleHudTrayProps) {
  const message = hud.message && performance.now() - hud.message.at < 2600 ? hud.message : null;
  const fieldUnit = hud.fieldUnit;
  return (
    <div className={`ltd-battle-tray ${disabled ? 'is-disabled' : ''}`}>
      {message && (
        <div className="ltd-tray-message">
          {message.text}
        </div>
      )}
      {fieldUnit && (
        <div className="ltd-field-card">
          <div className="ltd-field-main">
            <div className="min-w-0">
              <strong>{fieldUnit.name}</strong>
              <span>Lv.{fieldUnit.skillLevel} · {fieldUnit.hp}/{fieldUnit.maxHp}</span>
            </div>
            <button
              type="button"
              onClick={() => onRetreat(fieldUnit.id)}
              disabled={disabled}
            >
              撤退 +{fieldUnit.refund}
            </button>
          </div>
          <div className="ltd-skill-panel">
            <div className="ltd-field-stats">
              <div>
                <Swords className="h-3.5 w-3.5" />
                <span>{fieldUnit.atkLabel}</span>
                <strong>{fieldUnit.atk}</strong>
              </div>
              <div>
                <Shield className="h-3.5 w-3.5" />
                <span>防御</span>
                <strong>{fieldUnit.def}</strong>
              </div>
              <div>
                <Heart className="h-3.5 w-3.5" />
                <span>生命</span>
                <strong>{fieldUnit.hp}/{fieldUnit.maxHp}</strong>
              </div>
              <div>
                <Zap className="h-3.5 w-3.5" />
                <span>法抗</span>
                <strong>{fieldUnit.res}%</strong>
              </div>
            </div>
            <div className="min-w-0">
              <div className="ltd-skill-title">
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-sky-300" />
                <span>{fieldUnit.skillName}</span>
                <span className="ltd-skill-level">Lv.{fieldUnit.skillLevel}</span>
              </div>
              <div className="ltd-skill-desc">{fieldUnit.skillDesc}</div>
              <div className="ltd-skill-detail">{fieldUnit.skillDetail}</div>
              <div className="ltd-skill-meta">
                <span>技能冷却：{fieldUnit.skillReady ? '可释放' : `${fieldUnit.skillCooldown}/${fieldUnit.skillCooldownTotal}s`}</span>
                <span>升级费用：{fieldUnit.skillMaxed ? '已满级' : `${fieldUnit.skillUpgradeCost} 费`}</span>
              </div>
            </div>
            {fieldUnit.dangerEnemies.length > 0 && (
              <div className="ltd-danger-panel" role="alert">
                <div className="ltd-danger-title">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  危险敌人技能
                </div>
                <div className="ltd-danger-list">
                  {fieldUnit.dangerEnemies.map((enemy) => (
                    <div key={enemy.id}>
                      <strong>{enemy.name} ×{enemy.count}</strong>
                      <span>{enemy.nextSkill <= 0 ? '即将释放' : `${enemy.nextSkill}s 后可释放`} · {enemy.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="ltd-skill-actions">
              <button
                type="button"
                onClick={() => onUseSkill(fieldUnit.id)}
                disabled={disabled || !fieldUnit.skillReady}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {fieldUnit.skillReady ? '释放' : `${fieldUnit.skillCooldown}s`}
              </button>
              <button
                type="button"
                onClick={() => onUpgradeSkill(fieldUnit.id)}
                disabled={disabled || fieldUnit.skillMaxed || !fieldUnit.canUpgradeSkill}
              >
                <TrendingUp className="h-3.5 w-3.5" />
                {fieldUnit.skillMaxed ? '满级' : `升级 ${fieldUnit.skillUpgradeCost}`}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="ltd-squad-rail">
        {hud.squad.map((slot) => {
          const selected = hud.selectedSquadUnit === slot.typeIdx;
          const slotDisabled = disabled || !slot.affordable;
          return (
            <button
              key={slot.typeIdx}
              type="button"
              onClick={() => onSelectSquadUnit(slot.typeIdx)}
              onPointerDown={(event) => {
                if (!slotDisabled && slot.onFieldId === 0) {
                  onTrayDragStart(slot.typeIdx, { clientX: event.clientX, clientY: event.clientY });
                }
              }}
              disabled={slotDisabled || slot.onFieldId !== 0}
              className={`ltd-squad-card ${selected ? 'is-selected' : ''} ${slot.onFieldId !== 0 || slotDisabled ? 'is-disabled' : ''}`}
              aria-label={`部署${slot.name}`}
            >
              <span className="emoji" aria-hidden>
                <UnitPortrait typeIdx={slot.typeIdx} size={40} />
              </span>
              <span className="name">{slot.name.slice(0, 4)}</span>
              <span className="cost">
                <Zap className="h-2.5 w-2.5" fill="currentColor" />
                {slot.cost}
              </span>
              {slot.onFieldId !== 0 && slot.hpPm >= 0 && (
                <span className="ltd-hp-bar">
                  <span
                    style={{ width: `${Math.max(0, Math.min(100, slot.hpPm / 100))}%` }}
                  />
                </span>
              )}
              {slot.onFieldId === 0 && slot.redeployRemaining > 0 && (
                <span className="ltd-redeploy-mask">
                  {slot.redeployRemaining}s
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
