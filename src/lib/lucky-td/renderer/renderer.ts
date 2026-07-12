// 幸运塔防 战斗渲染器：驱动 TS 引擎 30Hz 模拟 + Canvas 渲染 + 输入 + HUD 快照。
// 与 React 的边界：React 只消费 HudSnapshot 与回调，本类内部为性能豁免区（可变状态、
// 渲染层 Map 仅做视觉记账，不影响逻辑）。动画参数见 docs/lucky-td-art-guide.md §2。

import { getEngineData, offsetKey, positionOnPath } from '../engine/data';
import { activeSkillCooldownFor, activeSkillDetail, activeSkillFor, activeSkillUpgradeCost, ACTIVE_SKILL_MAX_LEVEL, skillLevelAtkBonusPermyriad } from '../engine/active-skills';
import type { PrecomputedMap } from '../engine/data';
import { applyAction, finalize, tick } from '../engine/engine';
import { initState } from '../engine/engine';
import type { EnemyState, GameAction, GameResult, GameState, UnitState } from '../engine/types';
import { ENEMY_MECHANICS } from '../ui-metadata';
import {
  DIR_VECTORS,
  STAGE_H,
  STAGE_W,
  TILE,
  UNIT_STYLE,
  cellCenter,
  directionPadHit,
  drawBoard,
  drawCellHighlight,
  drawDirectionPad,
  drawEnemySprite,
  drawFloaters,
  drawParticles,
  drawPathPreview,
  drawProjectile,
  drawUnitSprite,
  makeGeom,
  milliToStage,
  pointerToCell,
} from './draw';
import type { Floater, Particle, PathPreviewVis, ProjectileVis, StageGeom } from './draw';
import { drawSkillEffect, EffectBudget, spawnAmbient } from './art/effects';
import type { SkillEffect, SkillEffectKind } from './art/effects';
import { scenePalette } from './art/palette';

const FRAME_MS = 1000 / 30;
const MAX_STEP_MS = 120;
const MAX_SIM_STEPS_PER_FRAME = 4;
const HUD_EVERY_TICKS = 6;
const SPAWN_SCALE_MS = 260;
const WINDUP_MS = 140;
const WALK_FRAME_MILLI = 450;
const WALK_DUST_EVERY_MS = 340;
const DIE_FADE_MS = 450;

function pm(value: number, permyriad: number): number {
  return Math.floor((value * permyriad) / 10000);
}

export interface SquadSlotView {
  typeIdx: number;
  name: string;
  emoji: string;
  color: string;
  cost: number;
  block: number;
  onFieldId: number;
  hpPm: number;
  redeployRemaining: number;
  affordable: boolean;
}

export interface FieldUnitView {
  id: number;
  typeIdx: number;
  name: string;
  atkLabel: string;
  atk: number;
  def: number;
  res: number;
  hp: number;
  maxHp: number;
  refund: number;
  skillName: string;
  skillDesc: string;
  skillDetail: string;
  skillLevel: number;
  skillCooldown: number;
  skillCooldownTotal: number;
  skillReady: boolean;
  skillUpgradeCost: number;
  skillMaxed: boolean;
  canUpgradeSkill: boolean;
  dangerEnemies: DangerEnemyView[];
}

export interface DangerEnemyView {
  id: string;
  name: string;
  count: number;
  nextSkill: number;
  detail: string;
}

export interface HudSnapshot {
  frame: number;
  cost: number;
  costMax: number;
  lives: number;
  waveIndex: number;
  totalWaves: number;
  phase: number;
  intermissionSeconds: number;
  status: number;
  speed: number;
  paused: boolean;
  selectedSquadUnit: number | null;
  squad: SquadSlotView[];
  fieldUnit: FieldUnitView | null;
  scoreWaves: number;
  scoreKills: number;
  scoreLucky: number;
  message: { text: string; at: number } | null;
}

export interface WaveClearInfo {
  waveIndex: number;
  frame: number;
  stateHash: number;
  actions: GameAction[];
}

export interface TerminalInfo {
  result: GameResult;
  finalFrame: number;
  actions: GameAction[];
}

export interface BattleCallbacks {
  onHud(snapshot: HudSnapshot): void;
  onBlessing(options: number[] | null): void;
  onWaveCleared(info: WaveClearInfo): void;
  onTerminal(info: TerminalInfo): void;
}

export interface BattleOptions {
  bgCanvas: HTMLCanvasElement;
  mainCanvas: HTMLCanvasElement;
  seed: string;
  mapId: string;
  squad: string[];
  initialActions?: GameAction[];
  reducedMotion?: boolean;
  callbacks: BattleCallbacks;
}

interface DieVis {
  x: number;
  y: number;
  typeIdx: number;
  kind: 'unit' | 'enemy';
  at: number;
}

/** 部署交互状态机：idle → trayDrag（托盘拖拽跟随）→ aim（落格后选朝向）→ idle。 */
type Interaction =
  | { mode: 'idle' }
  | { mode: 'trayDrag'; typeIdx: number; x: number; y: number; cell: { row: number; col: number } | null; valid: boolean }
  | { mode: 'aim'; typeIdx: number; row: number; col: number; hoverDir: number | null; dragging: boolean };

const DRAG_CONFIRM_DIST = TILE * 0.45;

/** 远程弹道变体（REQ8）：artillery 炮弹烟尘 / frostbinder 寒霜 / stormsniper 风暴电痕 / venomwitch 剧毒。 */
const PROJECTILE_VARIANTS: Partial<Record<number, NonNullable<ProjectileVis['variant']>>> = {
  9: 'cannon',
  10: 'frost',
  13: 'storm',
  14: 'venom',
};

/** 近战攻击特效映射（REQ8）：vanguard/thornwarden 突刺、ranger/phantom 弧斩、flameblade 横扫；defender 单独走盾击环。 */
const MELEE_ATTACK_FX: Partial<Record<number, SkillEffectKind>> = {
  0: 'thrust',
  2: 'slashArc',
  3: 'cleave',
  8: 'slashArc',
  12: 'thrust',
};

/** 近战特效色：'lighter' 叠加需要亮色，过暗的单位主题色（如幻影黑）不可直接用。 */
const MELEE_ATTACK_COLOR: Record<number, string> = {
  0: '#5eead4',
  2: '#fca5a5',
  3: '#fdba74',
  8: '#c7d2fe',
  12: '#a3e635',
};

export class LuckyTdBattle {
  private readonly data = getEngineData();
  private readonly state: GameState;
  private readonly map: PrecomputedMap;
  private readonly geom: StageGeom;
  private readonly callbacks: BattleCallbacks;
  private readonly bgCanvas: HTMLCanvasElement;
  private readonly mainCanvas: HTMLCanvasElement;
  private readonly reducedMotion: boolean;

  private actions: GameAction[] = [];
  private seq = 0;
  private speed = 1;
  private paused = false;
  private destroyed = false;
  private rafId = 0;
  private lastTs = 0;
  private accum = 0;
  private ticksSinceHud = 0;
  private blessingNotified = false;
  private terminalNotified = false;
  private terminalAt = 0;
  private renderErrorLogged = false;
  private lastSimAt = 0;
  private lastSimFrame = 0;
  private waveHashCount = 0;
  private selectedSquadUnit: number | null = null;
  private selectedFieldUnitId = 0;
  private interaction: Interaction = { mode: 'idle' };
  private message: { text: string; at: number } | null = null;

  private readonly enemyPrev = new Map<number, { x: number; y: number }>();
  private readonly enemyCurr = new Map<number, { x: number; y: number }>();
  private readonly flashUntil = new Map<string, number>();
  private readonly unitAnimAt = new Map<number, number>();
  private readonly deployAt = new Map<number, number>();
  /** 敌人出场时间（260ms 缩放入场）；构造/快进时预填避免 resume 重播。 */
  private readonly enemySpawnAt = new Map<number, number>();
  /** 敌人攻击起手时间（140ms 前顶）。 */
  private readonly enemyAttackAt = new Map<number, number>();
  /** 敌人累积行走里程（milli），驱动两帧步行循环。 */
  private readonly enemyWalkDist = new Map<number, number>();
  /** 敌人上次足尘时间。 */
  private readonly enemyLastDust = new Map<number, number>();
  private readonly budget: EffectBudget;
  private readonly spawnGlowColor: string;
  private dieVis: DieVis[] = [];
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private projectiles: ProjectileVis[] = [];
  private skillEffects: SkillEffect[] = [];
  private pathPreview: PathPreviewVis | null = null;

  private resizeObserver: ResizeObserver | null = null;
  private readonly onPointerDown: (event: PointerEvent) => void;
  private readonly onWindowPointerMove: (event: PointerEvent) => void;
  private readonly onWindowPointerUp: (event: PointerEvent) => void;

  constructor(options: BattleOptions) {
    this.bgCanvas = options.bgCanvas;
    this.mainCanvas = options.mainCanvas;
    this.callbacks = options.callbacks;
    this.reducedMotion = options.reducedMotion ?? false;
    this.state = initState(options.seed, options.mapId, options.squad);
    this.map = this.data.maps[this.state.mapIdx];
    this.geom = makeGeom(this.map.cfg.cols, this.map.cfg.rows);
    this.budget = new EffectBudget(this.reducedMotion);
    this.spawnGlowColor = scenePalette(options.mapId).gate.spawnGlow;
    if (options.initialActions && options.initialActions.length > 0) {
      this.fastForward(options.initialActions);
    }
    this.waveHashCount = this.state.waveHashes.length;
    this.syncEnemyPositions(this.enemyCurr);
    this.syncEnemyPositions(this.enemyPrev);
    // 预填已在场敌人的出场时间，防止 resume/checkpoint 恢复时重播出生特效
    for (const enemy of this.state.enemies) {
      this.enemySpawnAt.set(enemy.id, 0);
    }

    this.onPointerDown = (event) => this.handlePointer(event);
    this.mainCanvas.addEventListener('pointerdown', this.onPointerDown);
    this.onWindowPointerMove = (event) => this.handleWindowPointerMove(event);
    this.onWindowPointerUp = (event) => this.handleWindowPointerUp(event);
    window.addEventListener('pointermove', this.onWindowPointerMove);
    window.addEventListener('pointerup', this.onWindowPointerUp);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.mainCanvas.parentElement ?? this.mainCanvas);
    this.resize();
    this.emitHud();
    if (this.state.pendingBlessing) {
      this.blessingNotified = true;
      this.callbacks.onBlessing([...this.state.pendingBlessing.options]);
    }
    this.lastTs = performance.now();
    this.lastSimAt = this.lastTs;
    this.lastSimFrame = this.state.frame;
    this.rafId = requestAnimationFrame(() => this.loop());
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.rafId);
    this.mainCanvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onWindowPointerMove);
    window.removeEventListener('pointerup', this.onWindowPointerUp);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.enemySpawnAt.clear();
    this.enemyAttackAt.clear();
    this.enemyWalkDist.clear();
    this.enemyLastDust.clear();
    this.particles = [];
    this.floaters = [];
    this.projectiles = [];
    this.skillEffects = [];
    this.dieVis = [];
  }

  setSpeed(speed: number): void {
    this.speed = speed === 2 ? 2 : 1;
    this.emitHud();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.interaction = { mode: 'idle' };
      this.selectedSquadUnit = null;
    }
    this.emitHud();
  }

  selectSquadUnit(typeIdx: number | null): void {
    if (this.paused || this.state.status !== 0) {
      return;
    }
    this.interaction = { mode: 'idle' };
    this.selectedSquadUnit = this.selectedSquadUnit === typeIdx ? null : typeIdx;
    this.selectedFieldUnitId = 0;
    this.emitHud();
  }

  /** 托盘卡 pointerdown 起手拖拽部署（React 侧调用）；后续 pointermove/up 由 window 级监听接管。 */
  beginTrayDrag(typeIdx: number, point: { clientX: number; clientY: number }): void {
    if (this.paused || this.state.status !== 0) {
      return;
    }
    const p = this.stagePoint(point);
    this.selectedSquadUnit = typeIdx;
    this.selectedFieldUnitId = 0;
    this.interaction = { mode: 'trayDrag', typeIdx, x: p.x, y: p.y, cell: null, valid: false };
    this.emitHud();
  }

  requestRetreat(unitId: number): void {
    if (this.paused || this.state.status !== 0) {
      return;
    }
    this.recordAction({ type: 'retreat', unitId });
    this.selectedFieldUnitId = 0;
    this.emitHud();
  }

  requestSkill(unitId: number): void {
    if (this.paused || this.state.status !== 0) {
      return;
    }
    const ok = this.recordAction({ type: 'skill', unitId });
    if (ok) {
      this.spawnSkillEffect(unitId);
    }
    this.emitHud();
  }

  requestSkillUpgrade(unitId: number): void {
    if (this.paused || this.state.status !== 0) {
      return;
    }
    this.recordAction({ type: 'skillUpgrade', unitId });
    this.emitHud();
  }

  requestBless(blessing: number): void {
    if (this.paused || this.state.status !== 0) {
      return;
    }
    const ok = this.recordAction({ type: 'bless', blessing });
    if (ok) {
      this.blessingNotified = false;
      this.accum = 0;
      this.callbacks.onBlessing(null);
    }
    this.emitHud();
  }

  // ── 内部：操作与快进 ────────────────────────────

  private recordAction(partial: Omit<GameAction, 'frame' | 'seq'>): boolean {
    const action: GameAction = { ...partial, frame: this.state.frame, seq: this.seq };
    const result = applyAction(this.state, action);
    if (!result.ok) {
      this.message = { text: result.message, at: performance.now() };
      return false;
    }
    this.seq += 1;
    this.actions.push(action);
    return true;
  }

  private fastForward(initial: GameAction[]): void {
    const maxFastForwardTicks = this.data.config.engine.maxFrames + 1;
    for (const action of initial) {
      let guard = 0;
      while (this.state.status === 0 && !this.state.pendingBlessing && this.state.frame < action.frame) {
        tick(this.state);
        guard += 1;
        if (guard > maxFastForwardTicks) {
          return;
        }
      }
      const result = applyAction(this.state, action);
      if (!result.ok) {
        break;
      }
      this.actions.push(action);
      this.seq = Math.max(this.seq, action.seq + 1);
    }
  }

  // ── 内部：主循环 ────────────────────────────

  private loop(): void {
    if (this.destroyed) {
      return;
    }
    // 刻意不用 rAF 回调参数的时间戳：合成帧（CDP 截屏、后台补帧）会给出
    // 与真实流逝不符的 ts，导致模拟被快进；performance.now() 只按真实时间推进。
    const ts = performance.now();
    const rawDt = ts - this.lastTs;
    const dt = Number.isFinite(rawDt) ? Math.max(0, Math.min(rawDt, MAX_STEP_MS)) : 0;
    this.budget.noteFrame(rawDt);
    if (!Number.isFinite(this.accum) || this.accum < 0 || rawDt > 1200) {
      this.accum = 0;
      this.syncEnemyPositions(this.enemyCurr);
      this.syncEnemyPositions(this.enemyPrev);
    }
    this.lastTs = ts;
    if (!this.paused && this.state.status === 0 && !this.state.pendingBlessing) {
      this.accum += dt * this.speed;
      let steps = 0;
      while (this.accum >= FRAME_MS && steps < MAX_SIM_STEPS_PER_FRAME && this.state.status === 0 && !this.state.pendingBlessing) {
        this.accum -= FRAME_MS;
        this.stepTick(ts);
        steps += 1;
      }
      if (steps >= MAX_SIM_STEPS_PER_FRAME) {
        this.accum = 0;
      }
      if (steps > 0) {
        this.lastSimAt = ts;
        this.lastSimFrame = this.state.frame;
      } else if (ts - this.lastSimAt > 900 && this.state.frame === this.lastSimFrame) {
        this.accum = FRAME_MS;
      }
    }
    if (this.state.pendingBlessing && !this.blessingNotified) {
      this.blessingNotified = true;
      this.accum = 0;
      this.callbacks.onBlessing([...this.state.pendingBlessing.options]);
      this.emitHud();
    }
    if (this.state.status !== 0 && !this.terminalNotified) {
      this.terminalNotified = true;
      this.terminalAt = ts;
      this.emitHud();
      this.callbacks.onTerminal({
        result: finalize(this.state),
        finalFrame: this.state.frame,
        actions: this.actions.slice(),
      });
    }
    try {
      this.render(ts);
    } catch (error) {
      // 绘制异常只丢当帧画面，绝不打断 rAF 链（曾因负半径 arc 抛错导致整局永久冻结）
      if (!this.renderErrorLogged) {
        this.renderErrorLogged = true;
        console.error('[lucky-td] render failed', error);
      }
    }
    if (this.terminalNotified && ts - this.terminalAt > 1600) {
      return;
    }
    this.rafId = requestAnimationFrame(() => this.loop());
  }

  private syncEnemyPositions(target: Map<number, { x: number; y: number }>): void {
    target.clear();
    for (const enemy of this.state.enemies) {
      target.set(enemy.id, this.enemyStagePosition(enemy));
    }
  }

  private enemyPath(enemy: EnemyState) {
    const paths = this.data.config.enemies[enemy.typeIdx]?.flying ? this.map.flightPaths : this.map.paths;
    return paths[Math.max(0, enemy.pathIdx % paths.length)];
  }

  private enemyStagePosition(enemy: EnemyState): { x: number; y: number } {
    const pos = positionOnPath(this.enemyPath(enemy), enemy.progress);
    return milliToStage(this.geom, pos.x, pos.y);
  }

  private startPathPreview(now: number): void {
    const pathIdxs: number[] = [];
    const flightPathIdxs: number[] = [];
    for (const event of this.state.waveEvents) {
      const pathIdx = event[2];
      const enemy = this.data.config.enemies[event[1]];
      const list = enemy?.flying ? flightPathIdxs : pathIdxs;
      const max = enemy?.flying ? this.map.flightPaths.length : this.map.paths.length;
      if (pathIdx >= 0 && pathIdx < max && !list.includes(pathIdx)) {
        list.push(pathIdx);
      }
    }
    if (pathIdxs.length === 0 && flightPathIdxs.length === 0) {
      return;
    }
    this.pathPreview = {
      pathIdxs,
      flightPathIdxs,
      born: now,
      duration: this.reducedMotion ? 620 : 1150,
      waveIndex: this.state.waveIndex,
    };
  }

  private stepTick(now: number): void {
    const state = this.state;
    const prevPhase = state.phase;
    const prevWaveIndex = state.waveIndex;
    const prevEnemyHp = new Map<number, number>();
    const prevEnemyShield = new Map<number, number>();
    const prevEnemySkillCooldown = new Map<number, number>();
    const prevEnemyAtkCooldown = new Map<number, number>();
    const prevEnemyPos = new Map<number, { x: number; y: number }>();
    const prevEnemyProgress = new Map<number, number>();
    /** 漏怪归因用：路径/速度/扣命值（敌人进基地当帧即被移除，需在 tick 前捕获）。 */
    const prevEnemyMeta = new Map<number, { pathIdx: number; flying: boolean; speed: number; dmgToBase: number }>();
    for (const enemy of state.enemies) {
      prevEnemyHp.set(enemy.id, enemy.hp);
      prevEnemyShield.set(enemy.id, enemy.shield);
      prevEnemySkillCooldown.set(enemy.id, enemy.skillCooldown);
      prevEnemyAtkCooldown.set(enemy.id, enemy.atkCooldown);
      prevEnemyProgress.set(enemy.id, enemy.progress);
      prevEnemyMeta.set(enemy.id, {
        pathIdx: enemy.pathIdx,
        flying: this.data.config.enemies[enemy.typeIdx]?.flying === true,
        speed: enemy.speed,
        dmgToBase: enemy.dmgToBase,
      });
      const curr = this.enemyCurr.get(enemy.id);
      if (curr) {
        prevEnemyPos.set(enemy.id, curr);
      }
    }
    const prevUnitHp = new Map<number, number>();
    const prevUnitCooldown = new Map<number, number>();
    for (const unit of state.units) {
      prevUnitHp.set(unit.id, unit.hp);
      prevUnitCooldown.set(unit.id, unit.atkCooldown);
    }
    const prevLives = state.lives;
    const prevLucky = state.scoreLucky;

    tick(state);

    if (prevPhase === 0 && state.phase === 1 && state.waveIndex === prevWaveIndex) {
      this.startPathPreview(now);
    }

    this.enemyPrev.clear();
    for (const [id, pos] of this.enemyCurr) {
      this.enemyPrev.set(id, pos);
    }
    this.syncEnemyPositions(this.enemyCurr);

    // 事件推导（仅视觉，不回写逻辑）
    const damagedEnemies: { id: number; x: number; y: number; delta: number }[] = [];
    /** 本 tick 掉血或阵亡的单位（供远程敌人弹道定位；位置=格中心，阵亡者用上帧格位）。 */
    const damagedUnits: { id: number; x: number; y: number }[] = [];
    for (const unit of state.units) {
      const prevHpForShot = prevUnitHp.get(unit.id);
      if (prevHpForShot !== undefined && unit.hp < prevHpForShot) {
        const at = cellCenter(this.geom, unit.row, unit.col);
        damagedUnits.push({ id: unit.id, x: at.x, y: at.y });
      }
    }
    for (const [deadId] of prevUnitHp) {
      if (!state.units.some((unit) => unit.id === deadId)) {
        const info = this.lastKnownUnitCell.get(deadId);
        if (info) {
          const at = cellCenter(this.geom, info.row, info.col);
          damagedUnits.push({ id: deadId, x: at.x, y: at.y });
        }
      }
    }
    const aliveIds = new Set<number>();
    for (const enemy of state.enemies) {
      aliveIds.add(enemy.id);
      const prev = prevEnemyHp.get(enemy.id);
      // 新出场敌人：涟漪 + 缩放入场（快照恢复时构造器已预填，不会重播）
      if (!prevEnemyHp.has(enemy.id) && !this.enemySpawnAt.has(enemy.id)) {
        this.enemySpawnAt.set(enemy.id, now);
        const spawnPos = this.enemyCurr.get(enemy.id);
        if (spawnPos && !this.reducedMotion) {
          this.addSkillEffect('spawnRipple', spawnPos.x, spawnPos.y, this.spawnGlowColor, 40, 0, [], 520);
        }
      }
      if (prev !== undefined && enemy.hp < prev) {
        const pos = this.enemyCurr.get(enemy.id);
        if (pos) {
          damagedEnemies.push({ id: enemy.id, x: pos.x, y: pos.y, delta: prev - enemy.hp });
          this.flashUntil.set(`e${enemy.id}`, now + 90);
          if (!this.reducedMotion) {
            this.floaters.push({ x: pos.x, y: pos.y - 20, text: `-${prev - enemy.hp}`, color: '#f8fafc', born: now });
          }
        }
      }
      const pos = this.enemyCurr.get(enemy.id);
      // 攻击起手：atkCooldown 上跳 → 记录前顶时间 + 运动弧 + 被阻挡单位处的爪击/狼咬
      const prevAtkCd = prevEnemyAtkCooldown.get(enemy.id);
      if (pos && prevAtkCd !== undefined && enemy.atkCooldown > prevAtkCd) {
        this.enemyAttackAt.set(enemy.id, now);
        if (!this.reducedMotion) {
          this.addSkillEffect('windup', pos.x, pos.y, 'rgba(255, 240, 220, 0.9)', 24, this.enemyFacing(enemy.id), [], 260);
          const blocked = enemy.blockedBy !== 0 ? state.units.find((u) => u.id === enemy.blockedBy) : undefined;
          if (blocked) {
            const uAt = cellCenter(this.geom, blocked.row, blocked.col);
            const angle = Math.atan2(uAt.y - pos.y, uAt.x - pos.x);
            const isWolf = this.enemyId(enemy.typeIdx) === 'wolf';
            this.addSkillEffect(isWolf ? 'biteSnap' : 'clawSwipe', uAt.x, uAt.y - 10, isWolf ? '#fde68a' : '#fb7185', 40, angle, [], isWolf ? 180 : 200);
          } else if ((this.data.config.enemies[enemy.typeIdx]?.atkRange ?? 0) > 0 && damagedUnits.length > 0) {
            // 远程敌人射击：弹道飞向本 tick 掉血/阵亡单位中离自己最近的一个
            let shot = damagedUnits[0];
            let bestDist = Number.POSITIVE_INFINITY;
            for (const victim of damagedUnits) {
              const dist = (victim.x - pos.x) ** 2 + (victim.y - pos.y) ** 2;
              if (dist < bestDist) {
                bestDist = dist;
                shot = victim;
              }
            }
            this.projectiles.push({ kind: 'arrow', variant: 'thorn', fromX: pos.x, fromY: pos.y - 18, toX: shot.x, toY: shot.y - 22, born: now, duration: 170 });
          }
        }
      }
      // 行走里程累积（milli）驱动两帧步态 + 足尘节奏
      const prevProg = prevEnemyProgress.get(enemy.id);
      if (prevProg !== undefined && enemy.blockedBy === 0) {
        const moved = Math.abs(enemy.progress - prevProg);
        if (moved > 0) {
          this.enemyWalkDist.set(enemy.id, (this.enemyWalkDist.get(enemy.id) ?? 0) + moved);
          if (pos && !this.reducedMotion && this.budget.ambientCount > 0 && now - (this.enemyLastDust.get(enemy.id) ?? 0) > WALK_DUST_EVERY_MS) {
            this.enemyLastDust.set(enemy.id, now);
            this.particles.push({
              x: pos.x - this.enemyFacing(enemy.id) * 6,
              y: pos.y + 10,
              vx: -this.enemyFacing(enemy.id) * 14,
              vy: -8,
              born: now,
              life: 340,
              size: 3,
              color: 'rgba(214, 204, 180, 0.55)',
              gravity: -18,
              ring: false,
            });
            this.trimParticles();
          }
        }
      }
      if (pos && prev !== undefined && enemy.hp > prev) {
        this.spawnEnemySkillFeedback(enemy.typeIdx, pos.x, pos.y, enemy.hp - prev, 'heal', now);
      }
      const prevShield = prevEnemyShield.get(enemy.id);
      if (pos && prevShield !== undefined && enemy.shield > prevShield) {
        this.spawnEnemySkillFeedback(enemy.typeIdx, pos.x, pos.y, enemy.shield - prevShield, 'shield', now);
      } else if (pos && prevShield !== undefined && prevShield > enemy.shield && prev === enemy.hp) {
        this.spawnEnemyShieldHit(pos.x, pos.y, prevShield - enemy.shield, now);
      }
      const prevSkill = prevEnemySkillCooldown.get(enemy.id);
      if (pos && prevSkill !== undefined && prevSkill <= 0 && enemy.skillCooldown > prevSkill) {
        this.spawnEnemySkillFeedback(enemy.typeIdx, pos.x, pos.y, 0, 'cast', now);
      }
    }
    /** 本 tick 漏进基地的敌人：各自路径终点（用于在正确的门上提示扣命）。 */
    const leaks: { x: number; y: number; dmg: number }[] = [];
    for (const [id, hp] of prevEnemyHp) {
      if (!aliveIds.has(id)) {
        // 漏怪判定：掉命 + 消失前已推进到路径末端附近 → 在该敌人自己的出口门结算
        let leaked = false;
        const meta = prevEnemyMeta.get(id);
        const prevProg = prevEnemyProgress.get(id);
        if (state.lives < prevLives && meta && prevProg !== undefined) {
          const paths = meta.flying ? this.map.flightPaths : this.map.paths;
          const path = paths[Math.max(0, meta.pathIdx % paths.length)];
          if (prevProg >= path.lengthMilli - Math.max(400, meta.speed * 3)) {
            const exitMilli = positionOnPath(path, path.lengthMilli);
            const exitAt = milliToStage(this.geom, exitMilli.x, exitMilli.y);
            leaks.push({ x: exitAt.x, y: exitAt.y, dmg: meta.dmgToBase });
            leaked = true;
          }
        }
        const pos = prevEnemyPos.get(id) ?? this.enemyPrev.get(id);
        if (pos && hp > 0 && !leaked) {
          // 当帧被击杀的敌人也计入受击列表：否则一击秒杀完全不显示弹道/近战特效
          damagedEnemies.push({ id, x: pos.x, y: pos.y, delta: hp });
          const enemyTypeIdx = this.lastKnownEnemyType.get(id) ?? 0;
          this.dieVis.push({ x: pos.x, y: pos.y, typeIdx: enemyTypeIdx, kind: 'enemy', at: now });
          this.pushDissolve(pos.x, pos.y, 'enemy', enemyTypeIdx);
          this.spawnBurst(pos.x, pos.y, '#c4b5fd', 8);
        }
        this.lastKnownEnemyType.delete(id);
        this.enemySpawnAt.delete(id);
        this.enemyAttackAt.delete(id);
        this.enemyWalkDist.delete(id);
        this.enemyLastDust.delete(id);
      }
    }
    for (const enemy of state.enemies) {
      this.lastKnownEnemyType.set(enemy.id, enemy.typeIdx);
    }
    if (state.scoreLucky > prevLucky && !this.reducedMotion) {
      this.floaters.push({ x: STAGE_W / 2, y: 70, text: `幸运 +${state.scoreLucky - prevLucky}`, color: '#fbbf24', born: now });
    }
    if (state.lives < prevLives) {
      // 在被突破的那个门上提示：漏怪各自的路径终点；兜底（未能归因）退回 0 号路径终点
      let points = leaks;
      if (points.length === 0) {
        const exitCell = this.map.paths[0].cells[this.map.paths[0].cells.length - 1];
        const at = cellCenter(this.geom, exitCell.row, exitCell.col);
        points = [{ x: at.x, y: at.y, dmg: prevLives - state.lives }];
      }
      for (const leak of points) {
        this.floaters.push({ x: leak.x, y: leak.y - 26, text: `-${leak.dmg} 生命`, color: '#f87171', born: now });
        if (!this.reducedMotion) {
          this.addSkillEffect('spawnRipple', leak.x, leak.y, '#f87171', 44, 0, [], 520);
          this.particles.push({
            x: leak.x,
            y: leak.y - 4,
            vx: 0,
            vy: 0,
            born: now,
            life: 320,
            size: 30,
            color: 'rgba(248, 113, 113, 0.85)',
            gravity: 0,
            ring: true,
          });
          this.trimParticles();
        }
      }
    }
    const aliveUnitIds = new Set<number>();
    for (const unit of state.units) {
      aliveUnitIds.add(unit.id);
      const prevHp = prevUnitHp.get(unit.id);
      if (prevHp !== undefined && unit.hp < prevHp) {
        this.flashUntil.set(`u${unit.id}`, now + 90);
        this.spawnUnitHitFeedback(unit.id, unit.row, unit.col, prevHp - unit.hp, prevEnemyAtkCooldown, now);
      }
      if (prevHp !== undefined && unit.hp > prevHp && !this.reducedMotion) {
        const at = cellCenter(this.geom, unit.row, unit.col);
        this.floaters.push({ x: at.x, y: at.y - 30, text: `+${unit.hp - prevHp}`, color: '#4ade80', born: now });
      }
      const prevCd = prevUnitCooldown.get(unit.id);
      if (prevCd !== undefined && unit.atkCooldown > prevCd) {
        this.unitAnimAt.set(unit.id, now);
        this.spawnAttackVisual(unit.typeIdx, unit.row, unit.col, unit.dir, damagedEnemies, prevUnitHp, now);
      }
    }
    for (const [id] of prevUnitHp) {
      if (!aliveUnitIds.has(id)) {
        const info = this.lastKnownUnitCell.get(id);
        if (info) {
          const at = cellCenter(this.geom, info.row, info.col);
          this.dieVis.push({ x: at.x, y: at.y, typeIdx: info.typeIdx, kind: 'unit', at: now });
          this.pushDissolve(at.x, at.y, 'unit', info.typeIdx);
          this.spawnBurst(at.x, at.y, '#e2e8f0', 10);
        }
        if (this.selectedFieldUnitId === id) {
          this.selectedFieldUnitId = 0;
        }
        this.lastKnownUnitCell.delete(id);
      }
    }
    for (const unit of state.units) {
      this.lastKnownUnitCell.set(unit.id, { row: unit.row, col: unit.col, typeIdx: unit.typeIdx });
    }

    if (state.waveHashes.length > this.waveHashCount) {
      this.waveHashCount = state.waveHashes.length;
      this.callbacks.onWaveCleared({
        waveIndex: this.waveHashCount,
        frame: state.frame,
        stateHash: state.waveHashes[this.waveHashCount - 1],
        actions: this.actions.slice(),
      });
    }

    this.ticksSinceHud += 1;
    if (this.ticksSinceHud >= HUD_EVERY_TICKS) {
      this.emitHud();
    }
  }

  private readonly lastKnownEnemyType = new Map<number, number>();
  private readonly lastKnownUnitCell = new Map<number, { row: number; col: number; typeIdx: number }>();

  private enemyId(typeIdx: number): string {
    return this.data.config.enemies[typeIdx]?.id ?? '';
  }

  /** 敌人朝向符号：由 prev/curr 位移 x 分量推得，静止时回退朝左（-1）。 */
  private enemyFacing(enemyId: number): number {
    const curr = this.enemyCurr.get(enemyId);
    const prev = this.enemyPrev.get(enemyId);
    if (curr && prev && Math.abs(curr.x - prev.x) > 0.01) {
      return curr.x > prev.x ? 1 : -1;
    }
    return -1;
  }

  /** 死亡消散：单位飘花瓣（火系飘余烬）、敌人碎晶。 */
  private pushDissolve(x: number, y: number, kind: 'unit' | 'enemy', typeIdx: number): void {
    if (this.reducedMotion) {
      return;
    }
    let variant: 'petal' | 'ember' | 'shard' = 'shard';
    let color = '#c4b5fd';
    if (kind === 'unit') {
      const id = this.data.config.units[typeIdx]?.id ?? '';
      const flaming = id.includes('flame') || id.includes('sun');
      variant = flaming ? 'ember' : 'petal';
      color = flaming ? '#fb923c' : '#fda4af';
    } else if (this.enemyId(typeIdx) === 'coin') {
      variant = 'ember';
      color = '#fbbf24';
    }
    this.skillEffects.push({
      kind: 'dissolve',
      x,
      y,
      born: performance.now(),
      duration: 700,
      color,
      radius: 30,
      dir: 0,
      targets: [],
      variant,
      glowLayers: this.budget.glowLayers,
    });
  }

  private spawnEnemySkillFeedback(
    typeIdx: number,
    x: number,
    y: number,
    amount: number,
    kind: 'heal' | 'shield' | 'cast',
    now: number,
  ): void {
    if (this.reducedMotion) {
      return;
    }
    if (kind === 'heal') {
      this.addSkillEffect('heal', x, y, '#4ade80', 76, 0, [{ x, y }], 620);
      this.floaters.push({ x, y: y - 34, text: `回血 +${amount}`, color: '#86efac', born: now });
      this.emitRadialSparks(x, y, '#bbf7d0', 10, 70);
      return;
    }
    if (kind === 'shield') {
      this.addSkillEffect('shield', x, y, '#a78bfa', 72, 0, [], 680);
      this.floaters.push({ x, y: y - 34, text: amount > 0 ? `护盾 +${amount}` : '护盾', color: '#ddd6fe', born: now });
      this.emitRadialSparks(x, y, '#c4b5fd', 12, 82);
      return;
    }
    const label = this.enemyId(typeIdx) === 'boss' ? '首领技' : '技能';
    this.addSkillEffect('nova', x, y, '#c084fc', 86, 0, [], 640);
    this.floaters.push({ x, y: y - 44, text: label, color: '#f5d0fe', born: now });
  }

  private spawnEnemyShieldHit(x: number, y: number, amount: number, now: number): void {
    if (this.reducedMotion) {
      return;
    }
    this.particles.push({
      x,
      y: y - 4,
      vx: 0,
      vy: 0,
      born: now,
      life: 260,
      size: 24,
      color: 'rgba(167, 139, 250, 0.75)',
      gravity: 0,
      ring: true,
    });
    this.floaters.push({ x, y: y - 28, text: `吸收 ${amount}`, color: '#c4b5fd', born: now });
    this.trimParticles();
  }

  private spawnUnitHitFeedback(
    unitId: number,
    row: number,
    col: number,
    damage: number,
    prevEnemyAtkCooldown: Map<number, number>,
    now: number,
  ): void {
    if (this.reducedMotion) {
      return;
    }
    const at = cellCenter(this.geom, row, col);
    let from: { x: number; y: number } | null = null;
    for (const enemy of this.state.enemies) {
      if (enemy.blockedBy !== unitId) {
        continue;
      }
      const prevCd = prevEnemyAtkCooldown.get(enemy.id);
      if (prevCd !== undefined && enemy.atkCooldown > prevCd) {
        from = this.enemyCurr.get(enemy.id) ?? null;
        break;
      }
    }
    this.floaters.push({ x: at.x, y: at.y - 46, text: `-${damage}`, color: '#fecaca', born: now });
    this.spawnBurst(at.x, at.y, '#f87171', 7);
    if (from) {
      const dx = at.x - from.x;
      const dy = at.y - from.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      for (let i = 0; i < 5; i += 1) {
        const t = (i + 1) / 6;
        this.particles.push({
          x: from.x + dx * t,
          y: from.y + dy * t - 8,
          vx: (dx / dist) * 35,
          vy: (dy / dist) * 35 - 12,
          born: now + i * 18,
          life: 220,
          size: 3,
          color: '#fb7185',
          gravity: 45,
          ring: false,
        });
      }
      this.trimParticles();
    }
  }

  private spawnAttackVisual(
    typeIdx: number,
    row: number,
    col: number,
    dir: number,
    damaged: { id: number; x: number; y: number }[],
    prevUnitHp: Map<number, number>,
    now: number,
  ): void {
    if (this.reducedMotion) {
      return;
    }
    const cfg = this.data.config.units[typeIdx];
    const from = cellCenter(this.geom, row, col);
    if (cfg.atkType === 'heal') {
      for (const unit of this.state.units) {
        const prev = prevUnitHp.get(unit.id);
        if (prev !== undefined && unit.hp > prev) {
          const to = cellCenter(this.geom, unit.row, unit.col);
          this.projectiles.push({ kind: 'heal', fromX: from.x, fromY: from.y - 30, toX: to.x, toY: to.y - 24, born: now, duration: 260 });
          break;
        }
      }
      return;
    }
    if (cfg.block > 0) {
      this.spawnMeleeAttackFx(typeIdx, from, dir, damaged, now);
      return;
    }
    if (damaged.length === 0) {
      return;
    }
    let best = damaged[0];
    let bestDist = Number.POSITIVE_INFINITY;
    for (const d of damaged) {
      const dist = (d.x - from.x) ** 2 + (d.y - from.y) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    const variant = PROJECTILE_VARIANTS[typeIdx];
    this.projectiles.push({
      kind: cfg.atkType === 'magic' ? 'bolt' : 'arrow',
      ...(variant ? { variant } : {}),
      fromX: from.x,
      fromY: from.y - 34,
      toX: best.x,
      toY: best.y - 8,
      born: now,
      duration: cfg.atkType === 'magic' ? 220 : 150,
    });
    if (cfg.atkType === 'magic') {
      this.particles.push({ x: best.x, y: best.y, vx: 0, vy: 0, born: now + 200, life: 240, size: (cfg.aoeRadius / 1000) * TILE, color: 'rgba(139, 92, 246, 0.8)', gravity: 0, ring: true });
    }
  }

  /** 近战攻击特效（REQ8）：优先落在被打中的目标上，否则打在朝向前方；defender 走盾击小环脉冲。 */
  private spawnMeleeAttackFx(
    typeIdx: number,
    from: { x: number; y: number },
    dir: number,
    damaged: { id: number; x: number; y: number }[],
    now: number,
  ): void {
    const [ux, uy] = DIR_VECTORS[dir] ?? DIR_VECTORS[0];
    let target = { x: from.x + ux * TILE * 0.7, y: from.y + uy * TILE * 0.7 };
    let bestDist = Number.POSITIVE_INFINITY;
    for (const d of damaged) {
      const dist = (d.x - from.x) ** 2 + (d.y - from.y) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        target = { x: d.x, y: d.y };
      }
    }
    if (typeIdx === 1) {
      // defender 盾击：目标处小环脉冲。born 必须用帧时钟 now，
      // 中途取 performance.now() 会晚于当帧渲染时间戳，产生 t<0 的「未来粒子」
      this.particles.push({
        x: target.x,
        y: target.y - 6,
        vx: 0,
        vy: 0,
        born: now,
        life: 240,
        size: 24,
        color: 'rgba(203, 213, 225, 0.85)',
        gravity: 0,
        ring: true,
      });
      this.trimParticles();
      return;
    }
    const kind = MELEE_ATTACK_FX[typeIdx];
    if (!kind) {
      return;
    }
    this.addSkillEffect(kind, target.x, target.y - 10, MELEE_ATTACK_COLOR[typeIdx] ?? '#f8fafc', 54, dir, [], kind === 'cleave' ? 240 : 190);
  }

  private spawnBurst(x: number, y: number, color: string, count: number): void {
    if (this.reducedMotion) {
      return;
    }
    const now = performance.now();
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const speed = 40 + Math.random() * 70;
      this.particles.push({
        x,
        y: y - 10,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 30,
        born: now,
        life: 380 + Math.random() * 120,
        size: 2.5 + Math.random() * 2,
        color,
        gravity: 160,
        ring: false,
      });
    }
    if (this.particles.length > this.budget.particleCap) {
      this.particles.splice(0, this.particles.length - this.budget.particleCap);
    }
  }

  private spawnSkillEffect(unitId: number): void {
    if (this.reducedMotion) {
      return;
    }
    const unit = this.state.units.find((candidate) => candidate.id === unitId);
    if (!unit) {
      return;
    }
    const at = cellCenter(this.geom, unit.row, unit.col);
    const now = performance.now();
    const color = UNIT_STYLE[unit.typeIdx]?.color ?? '#38bdf8';
    const level = this.state.activeSkillLevels[unit.typeIdx] ?? 1;
    const targets = this.skillTargets(unit);
    const skill = activeSkillFor(unit.typeIdx);
    this.spawnBurst(at.x, at.y - 12, color, 16);
    this.floaters.push({ x: at.x, y: at.y - 52, text: skill.name, color: '#fef3c7', born: now });

    switch (unit.typeIdx) {
      case 0:
        this.floaters.push({ x: at.x, y: at.y - 76, text: `+${(6 + (level - 1) * 0.8).toFixed(1)} 费`, color: '#fde68a', born: now + 80 });
        this.addSkillEffect('aura', at.x, at.y, color, 92, unit.dir, targets, 620);
        this.emitRadialSparks(at.x, at.y, '#fbbf24', 12, 110);
        break;
      case 1:
        this.addSkillEffect('shield', at.x, at.y, '#93c5fd', 82, unit.dir, targets, 760);
        this.emitRadialSparks(at.x, at.y, '#bfdbfe', 16, 75);
        break;
      case 2:
        this.addSkillEffect('slash', at.x, at.y, '#f87171', 118, unit.dir, targets, 520);
        this.spawnTargetBursts(targets.slice(0, 1), '#fecaca');
        break;
      case 3:
        this.addSkillEffect('blast', at.x, at.y, '#fb923c', 100 + level * 7, unit.dir, targets, 640);
        this.spawnTargetBursts(targets.slice(0, 4), '#fed7aa');
        break;
      case 4:
        this.addSkillEffect('volley', at.x, at.y, '#86efac', 120, unit.dir, targets.slice(0, 4 + Math.ceil(level / 2)), 620);
        for (const target of targets.slice(0, 4 + Math.ceil(level / 2))) {
          this.projectiles.push({ kind: 'arrow', fromX: at.x, fromY: at.y - 34, toX: target.x, toY: target.y - 8, born: now, duration: 180 });
        }
        break;
      case 5:
        this.addSkillEffect('nova', targets[0]?.x ?? at.x, targets[0]?.y ?? at.y, '#c4b5fd', 96 + level * 8, unit.dir, targets, 720);
        this.spawnTargetBursts(targets.slice(0, 4), '#ddd6fe');
        break;
      case 6:
        this.addSkillEffect('heal', at.x, at.y, '#67e8f9', 125, unit.dir, this.allyTargets(), 720);
        this.emitRadialSparks(at.x, at.y, '#5eead4', 18, 105);
        break;
      case 7:
        this.addSkillEffect('wish', at.x, at.y, '#f9a8d4', 115, unit.dir, targets, 820);
        this.floaters.push({ x: at.x, y: at.y - 76, text: '好运签', color: '#fbcfe8', born: now + 80 });
        this.emitRadialSparks(at.x, at.y, '#f9a8d4', 18, 120);
        break;
      case 8:
        this.addSkillEffect('slash', at.x, at.y, '#111827', 132, unit.dir, targets.slice(0, 1), 520);
        this.spawnTargetBursts(targets.slice(0, 1), '#e5e7eb');
        break;
      case 9:
        this.addSkillEffect('blast', targets[0]?.x ?? at.x, targets[0]?.y ?? at.y, '#f59e0b', 122 + level * 9, unit.dir, targets.slice(0, 4), 720);
        this.spawnTargetBursts(targets.slice(0, 4), '#fde68a');
        break;
      case 10:
        this.addSkillEffect('nova', at.x, at.y, '#7dd3fc', 112 + level * 8, unit.dir, targets, 780);
        this.floaters.push({ x: at.x, y: at.y - 76, text: '回退', color: '#bae6fd', born: now + 80 });
        this.spawnTargetBursts(targets.slice(0, 4), '#bae6fd');
        break;
      case 11:
        this.addSkillEffect('wish', at.x, at.y, '#facc15', 128, unit.dir, this.allyTargets(), 820);
        this.floaters.push({ x: at.x, y: at.y - 76, text: '冷却缩短', color: '#fef08a', born: now + 80 });
        this.emitRadialSparks(at.x, at.y, '#facc15', 18, 115);
        break;
      case 12:
        this.addSkillEffect('shield', at.x, at.y, '#9ca3af', 88, unit.dir, targets, 760);
        this.floaters.push({ x: at.x, y: at.y - 76, text: '盾反', color: '#e5e7eb', born: now + 80 });
        this.spawnTargetBursts(targets.slice(0, 3), '#d1d5db');
        break;
      case 13:
        {
          const targetCount = level >= 10 ? 3 : level >= 5 ? 2 : 1;
          this.addSkillEffect('volley', at.x, at.y, '#93c5fd', 132, unit.dir, targets.slice(0, targetCount), 620);
          for (const target of targets.slice(0, targetCount)) {
          this.projectiles.push({ kind: 'arrow', variant: 'storm', fromX: at.x, fromY: at.y - 34, toX: target.x, toY: target.y - 8, born: now, duration: 150 });
          }
          this.spawnTargetBursts(targets.slice(0, targetCount), '#bfdbfe');
        }
        break;
      case 14:
        this.addSkillEffect('nova', targets[0]?.x ?? at.x, targets[0]?.y ?? at.y, '#84cc16', 106 + level * 8, unit.dir, targets, 760);
        this.floaters.push({ x: at.x, y: at.y - 76, text: '减速', color: '#d9f99d', born: now + 80 });
        this.spawnTargetBursts(targets.slice(0, 4), '#bef264');
        break;
      case 15:
        this.addSkillEffect('heal', at.x, at.y, '#fb923c', 132, unit.dir, this.allyTargets(), 760);
        this.floaters.push({ x: at.x, y: at.y - 76, text: '再部署加速', color: '#fed7aa', born: now + 80 });
        this.emitRadialSparks(at.x, at.y, '#fdba74', 18, 105);
        break;
      case 16:
        this.addSkillEffect('aura', at.x, at.y, '#f59e0b', 112, unit.dir, this.allyTargets(), 700);
        this.floaters.push({ x: at.x, y: at.y - 76, text: `+${(5 + (level - 1) * 1.2).toFixed(1)} 费`, color: '#fde68a', born: now + 80 });
        this.emitRadialSparks(at.x, at.y, '#fbbf24', 14, 95);
        break;
      case 17:
        this.addSkillEffect('nova', targets[0]?.x ?? at.x, targets[0]?.y ?? at.y, '#c084fc', 120 + level * 9, unit.dir, targets, 820);
        this.floaters.push({ x: at.x, y: at.y - 76, text: '坍缩', color: '#e9d5ff', born: now + 80 });
        this.spawnTargetBursts(targets.slice(0, 5), '#d8b4fe');
        break;
      default:
        this.addSkillEffect('aura', at.x, at.y, color, 90, unit.dir, targets, 600);
        break;
    }
  }

  private addSkillEffect(
    kind: SkillEffectKind,
    x: number,
    y: number,
    color: string,
    radius: number,
    dir: number,
    targets: { x: number; y: number }[],
    duration: number,
  ): void {
    this.skillEffects.push({ kind, x, y, born: performance.now(), duration, color, radius, dir, targets, glowLayers: this.budget.glowLayers });
  }

  private skillTargets(unit: UnitState): { x: number; y: number }[] {
    const level = this.state.activeSkillLevels[unit.typeIdx] ?? 1;
    const rangeSet = this.data.unitRangeLevelSets[unit.typeIdx][level - 1][unit.dir];
    const targets: { x: number; y: number; remaining: number; id: number }[] = [];
    for (const enemy of this.state.enemies) {
      if (enemy.hp === 0) {
        continue;
      }
      const path = this.enemyPath(enemy);
      const pos = positionOnPath(path, enemy.progress);
      const eRow = Math.floor(pos.y / 1000);
      const eCol = Math.floor(pos.x / 1000);
      if (rangeSet.has(offsetKey(eRow - unit.row, eCol - unit.col))) {
        const stage = milliToStage(this.geom, pos.x, pos.y);
        targets.push({ ...stage, remaining: path.lengthMilli - enemy.progress, id: enemy.id });
      }
    }
    targets.sort((a, b) => a.remaining - b.remaining || a.id - b.id);
    return targets;
  }

  private allyTargets(): { x: number; y: number }[] {
    return this.state.units
      .filter((unit) => unit.hp > 0)
      .map((unit) => {
        const at = cellCenter(this.geom, unit.row, unit.col);
        return { x: at.x, y: at.y };
      });
  }

  private spawnTargetBursts(targets: { x: number; y: number }[], color: string): void {
    for (const target of targets.slice(0, 4)) {
      this.spawnBurst(target.x, target.y, color, 5);
    }
  }

  private emitRadialSparks(x: number, y: number, color: string, count: number, speed: number): void {
    const now = performance.now();
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count;
      this.particles.push({
        x,
        y: y - 12,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 20,
        born: now,
        life: 460,
        size: 3,
        color,
        gravity: 50,
        ring: false,
      });
    }
    this.trimParticles();
  }

  private trimParticles(): void {
    const cap = this.budget.particleCap;
    if (this.particles.length > cap) {
      this.particles.splice(0, this.particles.length - cap);
    }
  }

  // ── 内部：渲染 ────────────────────────────

  private resize(): void {
    const parent = this.mainCanvas.parentElement;
    if (!parent) {
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = parent.clientWidth;
    const cssH = parent.clientHeight;
    for (const canvas of [this.bgCanvas, this.mainCanvas]) {
      canvas.width = Math.max(1, Math.round(cssW * dpr));
      canvas.height = Math.max(1, Math.round(cssH * dpr));
    }
    const bgCtx = this.bgCanvas.getContext('2d');
    if (bgCtx) {
      bgCtx.setTransform((this.bgCanvas.width) / STAGE_W, 0, 0, (this.bgCanvas.height) / STAGE_H, 0, 0);
      drawBoard(bgCtx, this.map, this.geom);
    }
  }

  private render(now: number): void {
    const ctx = this.mainCanvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.setTransform(this.mainCanvas.width / STAGE_W, 0, 0, this.mainCanvas.height / STAGE_H, 0, 0);
    ctx.clearRect(0, 0, STAGE_W, STAGE_H);
    if (this.pathPreview) {
      const alive = drawPathPreview(ctx, this.map, this.geom, this.pathPreview, now);
      if (!alive) {
        this.pathPreview = null;
      }
    }
    // 部署高亮
    if (this.selectedSquadUnit !== null) {
      const cfg = this.data.config.units[this.selectedSquadUnit];
      const cellSet = cfg.block > 0 ? this.map.meleeCellSet : this.map.rangedCellSet;
      const pulse = this.reducedMotion ? 0.32 : 0.22 + 0.14 * Math.sin(now / 260);
      const occupied = new Set(this.state.units.map((unit) => unit.row * 1000 + unit.col));
      for (const key of cellSet) {
        if (occupied.has(key)) {
          continue;
        }
        drawCellHighlight(ctx, this.geom, Math.floor(key / 1000), key % 1000, cfg.block > 0 ? '#3b82f6' : '#22c55e', pulse);
      }
    }
    // 阵亡余像
    const keptDie: DieVis[] = [];
    for (const die of this.dieVis) {
      const t = (now - die.at) / DIE_FADE_MS;
      if (t >= 1) {
        continue;
      }
      keptDie.push(die);
      if (die.kind === 'unit') {
        drawUnitSprite(ctx, die.x, die.y, die.typeIdx, {
          hpRatio: -1,
          flash: 0,
          alpha: 1 - t,
          scaleX: 1,
          scaleY: 1 - t * 0.4,
          offsetX: 0,
          offsetY: 0,
          gray: true,
          skillActive: false,
          selected: false,
          dir: -1,
        });
      } else {
        drawEnemySprite(ctx, die.x, die.y, die.typeIdx, { hpRatio: -1, flash: 0, rot: 0, bob: 0, alpha: 1 - t, scaleY: Math.max(0.2, 1 - t) });
      }
    }
    this.dieVis = keptDie;

    // 实体按 y 排序绘制
    const lerpT = Math.max(0, Math.min(1, this.accum / FRAME_MS));
    type RenderItem = { y: number; draw: () => void };
    const items: RenderItem[] = [];
    for (const unit of this.state.units) {
      const at = cellCenter(this.geom, unit.row, unit.col);
      const cfg = this.data.config.units[unit.typeIdx];
      const deployT = Math.min(1, (now - (this.deployAt.get(unit.id) ?? 0)) / 350);
      const animAt = this.unitAnimAt.get(unit.id) ?? 0;
      const animT = (now - animAt) / 140;
      let offsetX = 0;
      if (!this.reducedMotion && animT < 1) {
        offsetX = cfg.block > 0 ? Math.sin(Math.min(1, animT) * Math.PI) * 7 : -Math.sin(Math.min(1, animT) * Math.PI) * 3;
      }
      const breath = this.reducedMotion ? 1 : 1 + 0.02 * Math.sin(now / 320 + unit.id * 2.1);
      const flashLeft = (this.flashUntil.get(`u${unit.id}`) ?? 0) - now;
      const dropY = deployT < 1 ? -(1 - deployT) * (1 - deployT) * 40 : 0;
      const squash = deployT < 1 && deployT > 0.7 ? 1.12 : 1;
      items.push({
        y: at.y,
        draw: () =>
          drawUnitSprite(ctx, at.x, at.y, unit.typeIdx, {
            hpRatio: unit.hp / unit.maxHp,
            flash: this.reducedMotion ? 0 : Math.max(0, flashLeft / 90) * 0.7,
            alpha: 1,
            scaleX: squash,
            scaleY: breath / squash,
            offsetX,
            offsetY: dropY,
            gray: false,
            skillActive: unit.skillActive > 0,
            selected: this.selectedFieldUnitId === unit.id,
            dir: unit.dir,
          }),
      });
    }
    for (const enemy of this.state.enemies) {
      const curr = this.enemyCurr.get(enemy.id);
      if (!curr) {
        continue;
      }
      const prev = this.enemyPrev.get(enemy.id) ?? curr;
      let x = prev.x + (curr.x - prev.x) * lerpT;
      const y = prev.y + (curr.y - prev.y) * lerpT;
      const moving = enemy.blockedBy === 0;
      const bob = this.reducedMotion || !moving ? 0 : Math.sin(now / 110 + enemy.id * 1.7) * 2;
      const rot = this.reducedMotion || !moving ? 0 : Math.sin(now / 130 + enemy.id) * 0.06;
      const flashLeft = (this.flashUntil.get(`e${enemy.id}`) ?? 0) - now;
      // 出场缩放（260ms easeOutBack 0.3→1）
      const spawnAt = this.enemySpawnAt.get(enemy.id) ?? 0;
      const spawnT = Math.min(1, (now - spawnAt) / SPAWN_SCALE_MS);
      let spawnScale = 1;
      if (!this.reducedMotion && spawnT < 1) {
        const c1 = 1.70158;
        const u = spawnT - 1;
        spawnScale = 0.3 + 0.7 * (1 + (c1 + 1) * u * u * u + c1 * u * u);
      }
      // 攻击前顶（140ms 朝向前冲）
      const atkAt = this.enemyAttackAt.get(enemy.id) ?? 0;
      const atkT = (now - atkAt) / WINDUP_MS;
      if (!this.reducedMotion && atkT >= 0 && atkT < 1) {
        x += this.enemyFacing(enemy.id) * Math.sin(atkT * Math.PI) * 7;
      }
      // 行走两帧步态：累积里程每 450 milli 切换一帧
      const frame: 0 | 1 = moving ? ((Math.floor((this.enemyWalkDist.get(enemy.id) ?? 0) / WALK_FRAME_MILLI) % 2) as 0 | 1) : 0;
      const drawX = x;
      items.push({
        y,
        draw: () => {
          const scaled = spawnScale !== 1;
          if (scaled) {
            ctx.save();
            ctx.translate(drawX, y);
            ctx.scale(spawnScale, spawnScale);
            ctx.translate(-drawX, -y);
          }
          drawEnemySprite(ctx, drawX, y, enemy.typeIdx, {
            hpRatio: enemy.hp / enemy.maxHp,
            flash: this.reducedMotion ? 0 : Math.max(0, flashLeft / 90) * 0.75,
            rot,
            bob,
            alpha: scaled ? 0.4 + spawnT * 0.6 : 1,
            scaleY: 1,
            frame,
          });
          if (scaled) {
            ctx.restore();
          }
        },
      });
    }
    items.sort((a, b) => a.y - b.y);
    for (const item of items) {
      item.draw();
    }

    // 选中单位射程格（方向模板旋转后高亮；koi 显示光环格）
    if (this.selectedFieldUnitId !== 0) {
      const unit = this.state.units.find((candidate) => candidate.id === this.selectedFieldUnitId);
      if (unit) {
        this.drawTemplateCells(ctx, unit.typeIdx, unit.row, unit.col, unit.dir, this.state.activeSkillLevels[unit.typeIdx] ?? 1, now);
      }
    }

    // 拖拽部署：悬停格描边 + 幽灵单位跟随指针
    if (this.interaction.mode === 'trayDrag') {
      const drag = this.interaction;
      if (drag.cell) {
        ctx.strokeStyle = drag.valid ? 'rgba(34, 197, 94, 0.95)' : 'rgba(244, 63, 94, 0.9)';
        ctx.lineWidth = 3;
        ctx.strokeRect(this.geom.ox + drag.cell.col * TILE + 2, this.geom.oy + drag.cell.row * TILE + 2, TILE - 4, TILE - 4);
      }
      drawUnitSprite(ctx, drag.x, drag.y - 10, drag.typeIdx, {
        hpRatio: -1,
        flash: 0,
        alpha: 0.8,
        scaleX: 1,
        scaleY: 1,
        offsetX: 0,
        offsetY: 0,
        gray: false,
        skillActive: false,
        selected: false,
        dir: -1,
      });
    }

    // 方向选择：暗化背景 + 模板预览（跟随悬停方向）+ 幽灵单位 + 四向盘
    if (this.interaction.mode === 'aim') {
      const aim = this.interaction;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.35)';
      ctx.fillRect(0, 0, STAGE_W, STAGE_H);
      if (aim.hoverDir !== null) {
        this.drawTemplateCells(ctx, aim.typeIdx, aim.row, aim.col, aim.hoverDir, this.state.activeSkillLevels[aim.typeIdx] ?? 1, now);
      }
      const center = cellCenter(this.geom, aim.row, aim.col);
      drawUnitSprite(ctx, center.x, center.y, aim.typeIdx, {
        hpRatio: -1,
        flash: 0,
        alpha: 0.95,
        scaleX: 1,
        scaleY: 1,
        offsetX: 0,
        offsetY: 0,
        gray: false,
        skillActive: false,
        selected: false,
        dir: aim.hoverDir ?? -1,
      });
      drawDirectionPad(ctx, this.geom, aim.row, aim.col, aim.hoverDir);
    }

    this.skillEffects = this.skillEffects.filter((effect) => drawSkillEffect(ctx, effect, now));
    this.projectiles = this.projectiles.filter((p) => drawProjectile(ctx, p, now));
    if (!this.reducedMotion && !this.terminalNotified) {
      spawnAmbient(this.particles, this.map.cfg.id, this.budget, now);
    }
    this.particles = drawParticles(ctx, this.particles, now);
    this.floaters = drawFloaters(ctx, this.floaters, now);
  }

  /** 模板/光环格高亮（部署预览与选中单位共用）。 */
  private drawTemplateCells(
    ctx: CanvasRenderingContext2D,
    typeIdx: number,
    row: number,
    col: number,
    dir: number,
    level: number,
    now: number,
  ): void {
    const cfg = this.data.config.units[typeIdx];
    const isAura = cfg.rangeCells.length === 0;
    const set = isAura ? this.data.auraLevelSets[typeIdx][level - 1] : this.data.unitRangeLevelSets[typeIdx][level - 1][dir];
    const alpha = this.reducedMotion ? 0.3 : 0.22 + 0.1 * Math.sin(now / 300);
    for (const key of set) {
      const rr = Math.round(key / 100);
      const rc = key - rr * 100;
      const cellRow = row + rr;
      const cellCol = col + rc;
      if (cellRow < 0 || cellRow >= this.map.cfg.rows || cellCol < 0 || cellCol >= this.map.cfg.cols) {
        continue;
      }
      drawCellHighlight(ctx, this.geom, cellRow, cellCol, isAura ? '#f59e0b' : '#3b82f6', alpha);
    }
  }

  // ── 内部：输入与 HUD ────────────────────────────

  private handlePointer(event: PointerEvent): void {
    if (this.paused || this.state.status !== 0) {
      return;
    }
    const p = this.stagePoint(event);
    const cell = pointerToCell(this.geom, p.x, p.y);
    if (this.interaction.mode === 'aim') {
      const aim = this.interaction;
      const hit = directionPadHit(this.geom, aim.row, aim.col, p.x, p.y);
      if (hit !== null) {
        this.confirmDeploy(aim.typeIdx, aim.row, aim.col, hit);
        return;
      }
      if (cell && cell.row === aim.row && cell.col === aim.col) {
        // 按住格心再拖出 = 明日方舟式方向手势（window pointerup 结算）
        this.interaction = { ...aim, dragging: true, hoverDir: null };
        return;
      }
      this.cancelPlacement();
      return;
    }
    if (this.interaction.mode === 'trayDrag') {
      return;
    }
    if (!cell) {
      this.selectedFieldUnitId = 0;
      this.emitHud();
      return;
    }
    if (this.selectedSquadUnit !== null) {
      if (this.isPlaceable(this.selectedSquadUnit, cell.row, cell.col)) {
        this.interaction = { mode: 'aim', typeIdx: this.selectedSquadUnit, row: cell.row, col: cell.col, hoverDir: null, dragging: false };
        this.emitHud();
      } else {
        this.message = { text: '该格不可部署此单位', at: performance.now() };
        this.emitHud();
      }
      return;
    }
    const unit = this.state.units.find((candidate) => candidate.row === cell.row && candidate.col === cell.col);
    this.selectedFieldUnitId = unit ? unit.id : 0;
    this.emitHud();
  }

  private stagePoint(point: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.mainCanvas.getBoundingClientRect();
    return {
      x: ((point.clientX - rect.left) / rect.width) * STAGE_W,
      y: ((point.clientY - rect.top) / rect.height) * STAGE_H,
    };
  }

  private isPlaceable(typeIdx: number, row: number, col: number): boolean {
    const cfg = this.data.config.units[typeIdx];
    const key = row * 1000 + col;
    const cellSet = cfg.block > 0 ? this.map.meleeCellSet : this.map.rangedCellSet;
    if (!cellSet.has(key)) {
      return false;
    }
    return !this.state.units.some((unit) => unit.row === row && unit.col === col);
  }

  private fieldUnitAtk(unit: UnitState, level: number): number {
    const cfg = this.data.config.units[unit.typeIdx];
    let atk = pm(cfg.atk, 10000 + skillLevelAtkBonusPermyriad(level));
    if (this.state.rangedAtkBonusPm > 0 && cfg.tags.includes('rangedAtk')) {
      atk = pm(atk, 10000 + this.state.rangedAtkBonusPm);
    }
    if (cfg.block === 0) {
      for (const mechanic of this.map.cfg.mechanics ?? []) {
        if (mechanic.rangedAtkPermyriad && mechanic.rangedAtkPermyriad > 0) {
          atk = pm(atk, mechanic.rangedAtkPermyriad);
        }
      }
    }
    for (const mechanic of this.map.cfg.mechanics ?? []) {
      const multiplier = cfg.block > 0 ? mechanic.groundUnitAtkPermyriad : mechanic.highGroundUnitAtkPermyriad;
      if (multiplier && multiplier > 0) {
        atk = pm(atk, multiplier);
      }
    }
    return atk;
  }

  private fieldUnitDef(unit: UnitState): number {
    const cfg = this.data.config.units[unit.typeIdx];
    let value = cfg.def;
    if (cfg.skill?.kind === 'shield' && unit.skillActive > 0) {
      value = pm(value, cfg.skill.permyriad);
    }
    const key = unit.row * 1000 + unit.col;
    for (const mechanic of this.map.cfg.mechanics ?? []) {
      if (cfg.block > 0 && mechanic.groundUnitDefPermyriad && mechanic.groundUnitDefPermyriad > 0) {
        value = pm(value, mechanic.groundUnitDefPermyriad);
      }
      if (
        mechanic.cellUnitDefPermyriad
        && mechanic.cellUnitDefPermyriad > 0
        && (this.map.mechanicCellSets[mechanic.id]?.has(key) ?? false)
      ) {
        value = pm(value, mechanic.cellUnitDefPermyriad);
      }
    }
    return value;
  }

  private fieldUnitAtkLabel(typeIdx: number): string {
    const cfg = this.data.config.units[typeIdx];
    if (cfg.atkType === 'heal') {
      return '治疗';
    }
    if (cfg.atkType === 'none') {
      return '辅助';
    }
    return cfg.atkType === 'magic' ? '法术攻击' : '物理攻击';
  }

  private dangerEnemyViews(): DangerEnemyView[] {
    const grouped = new Map<string, DangerEnemyView>();
    for (const enemy of this.state.enemies) {
      if (enemy.hp <= 0) {
        continue;
      }
      const cfg = this.data.config.enemies[enemy.typeIdx];
      if (!cfg || cfg.id === 'coin' || !ENEMY_MECHANICS[cfg.id]) {
        continue;
      }
      const nextSkill = Math.max(0, Math.ceil(enemy.skillCooldown / 30));
      const current = grouped.get(cfg.id);
      if (current) {
        current.count += 1;
        current.nextSkill = Math.min(current.nextSkill, nextSkill);
      } else {
        grouped.set(cfg.id, {
          id: cfg.id,
          name: cfg.name,
          count: 1,
          nextSkill,
          detail: ENEMY_MECHANICS[cfg.id],
        });
      }
    }
    return [...grouped.values()]
      .sort((a, b) => Number(b.id === 'boss') - Number(a.id === 'boss') || a.nextSkill - b.nextSkill || a.name.localeCompare(b.name, 'zh-CN'))
      .slice(0, 4);
  }

  /** 拖出向量 → 朝向：主轴分量取胜。 */
  private dirFromDelta(dx: number, dy: number): number {
    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx > 0 ? 0 : 2;
    }
    return dy > 0 ? 1 : 3;
  }

  private confirmDeploy(typeIdx: number, row: number, col: number, dir: number): void {
    const ok = this.recordAction({ type: 'deploy', unit: typeIdx, row, col, dir });
    if (ok) {
      const unit = this.state.units[this.state.units.length - 1];
      this.deployAt.set(unit.id, performance.now());
      const at = cellCenter(this.geom, row, col);
      if (!this.reducedMotion) {
        this.addSkillEffect('deployBloom', at.x, at.y, UNIT_STYLE[typeIdx]?.color ?? '#fda4af', 46, 0, [], 560);
      }
      this.spawnBurst(at.x, at.y + 8, '#d6d3d1', 6);
    }
    this.interaction = { mode: 'idle' };
    this.selectedSquadUnit = null;
    this.emitHud();
  }

  private cancelPlacement(): void {
    this.interaction = { mode: 'idle' };
    this.selectedSquadUnit = null;
    this.emitHud();
  }

  private handleWindowPointerMove(event: PointerEvent): void {
    if (this.paused || this.state.status !== 0) {
      return;
    }
    if (this.interaction.mode === 'trayDrag') {
      const p = this.stagePoint(event);
      const cell = pointerToCell(this.geom, p.x, p.y);
      const valid = cell !== null && this.isPlaceable(this.interaction.typeIdx, cell.row, cell.col);
      this.interaction = { ...this.interaction, x: p.x, y: p.y, cell, valid };
      return;
    }
    if (this.interaction.mode === 'aim') {
      const aim = this.interaction;
      const p = this.stagePoint(event);
      if (aim.dragging) {
        const center = cellCenter(this.geom, aim.row, aim.col);
        const dx = p.x - center.x;
        const dy = p.y - center.y;
        const far = dx * dx + dy * dy >= DRAG_CONFIRM_DIST * DRAG_CONFIRM_DIST;
        this.interaction = { ...aim, hoverDir: far ? this.dirFromDelta(dx, dy) : null };
      } else {
        this.interaction = { ...aim, hoverDir: directionPadHit(this.geom, aim.row, aim.col, p.x, p.y) };
      }
    }
  }

  private handleWindowPointerUp(event: PointerEvent): void {
    if (this.paused || this.state.status !== 0) {
      return;
    }
    if (this.interaction.mode === 'trayDrag') {
      const drag = this.interaction;
      const p = this.stagePoint(event);
      const cell = pointerToCell(this.geom, p.x, p.y);
      if (cell && this.isPlaceable(drag.typeIdx, cell.row, cell.col)) {
        this.interaction = { mode: 'aim', typeIdx: drag.typeIdx, row: cell.row, col: cell.col, hoverDir: null, dragging: false };
      } else {
        this.interaction = { mode: 'idle' };
        this.selectedSquadUnit = null;
      }
      this.emitHud();
      return;
    }
    if (this.interaction.mode === 'aim' && this.interaction.dragging) {
      const aim = this.interaction;
      const p = this.stagePoint(event);
      const center = cellCenter(this.geom, aim.row, aim.col);
      const dx = p.x - center.x;
      const dy = p.y - center.y;
      if (dx * dx + dy * dy >= DRAG_CONFIRM_DIST * DRAG_CONFIRM_DIST) {
        this.confirmDeploy(aim.typeIdx, aim.row, aim.col, this.dirFromDelta(dx, dy));
      } else {
        this.interaction = { ...aim, dragging: false, hoverDir: null };
      }
    }
  }

  private emitHud(): void {
    this.ticksSinceHud = 0;
    const state = this.state;
    const engine = this.data.config.engine;
    const squad: SquadSlotView[] = state.squad.map((typeIdx) => {
      const cfg = this.data.config.units[typeIdx];
      const onField = state.units.find((unit) => unit.typeIdx === typeIdx);
      return {
        typeIdx,
        name: cfg.name,
        emoji: UNIT_STYLE[typeIdx]?.emoji ?? '❔',
        color: UNIT_STYLE[typeIdx]?.color ?? '#64748b',
        cost: cfg.cost,
        block: cfg.block,
        onFieldId: onField?.id ?? 0,
        hpPm: onField ? Math.floor((onField.hp * 10000) / onField.maxHp) : -1,
        redeployRemaining: Math.ceil(state.redeployCooldown[typeIdx] / 30),
        affordable: !onField && state.redeployCooldown[typeIdx] === 0 && state.costMilli >= cfg.cost * 1000,
      };
    });
    let fieldUnit: FieldUnitView | null = null;
    if (this.selectedFieldUnitId !== 0) {
      const unit = state.units.find((candidate) => candidate.id === this.selectedFieldUnitId);
      if (unit) {
        const cfg = this.data.config.units[unit.typeIdx];
        const level = state.activeSkillLevels[unit.typeIdx] ?? 1;
        const cooldown = state.activeSkillCooldown[unit.typeIdx] ?? 0;
        const skill = activeSkillFor(unit.typeIdx);
        const upgradeCost = activeSkillUpgradeCost(unit.typeIdx, level);
        const skillMaxed = level >= ACTIVE_SKILL_MAX_LEVEL;
        fieldUnit = {
          id: unit.id,
          typeIdx: unit.typeIdx,
          name: cfg.name,
          atkLabel: this.fieldUnitAtkLabel(unit.typeIdx),
          atk: this.fieldUnitAtk(unit, level),
          def: this.fieldUnitDef(unit),
          res: Math.round(cfg.res / 100),
          hp: unit.hp,
          maxHp: unit.maxHp,
          refund: Math.floor((cfg.cost * engine.retreatRefundPermyriad) / 10000),
          skillName: skill.name,
          skillDesc: skill.desc,
          skillDetail: activeSkillDetail(unit.typeIdx, level),
          skillLevel: level,
          skillCooldown: Math.ceil(cooldown / 30),
          skillCooldownTotal: Math.ceil(activeSkillCooldownFor(unit.typeIdx, level) / 30),
          skillReady: cooldown <= 0,
          skillUpgradeCost: upgradeCost,
          skillMaxed,
          canUpgradeSkill: !skillMaxed && state.costMilli >= upgradeCost * 1000,
          dangerEnemies: this.dangerEnemyViews(),
        };
      }
    }
    this.callbacks.onHud({
      frame: state.frame,
      cost: Math.floor(state.costMilli / 1000),
      costMax: Math.floor(engine.costMaxMilli / 1000),
      lives: Math.max(0, state.lives),
      waveIndex: state.waveIndex,
      totalWaves: this.map.cfg.waves.length,
      phase: state.phase,
      intermissionSeconds: Math.ceil(state.intermissionRemaining / 30),
      status: state.status,
      speed: this.speed,
      paused: this.paused,
      selectedSquadUnit: this.selectedSquadUnit,
      squad,
      fieldUnit,
      scoreWaves: state.scoreWaves,
      scoreKills: state.scoreKills,
      scoreLucky: state.scoreLucky,
      message: this.message,
    });
  }
}
