// 幸运塔防 引擎类型定义。契约见 docs/lucky-td-engine-spec.md。
// 逻辑层全部为整数：坐标 milli-tile，百分比为万分比（permyriad）。

export type AtkType = 'phys' | 'magic' | 'heal' | 'none';

export interface SkillConfig {
  kind: 'shield' | 'triple';
  spCost: number;
  duration: number;
  permyriad: number;
  every: number;
}

export interface UnitConfig {
  id: string;
  name: string;
  cost: number;
  block: number;
  hp: number;
  atk: number;
  atkType: AtkType;
  interval: number;
  def: number;
  res: number;
  redeploy: number;
  tags: string[];
  skill: SkillConfig | null;
  splashRadius: number;
  splashPermyriad: number;
  aoeRadius: number;
  /** 朝右（dir=0）为基准的相对格子模板 [[dRow,dCol],...]；atkType!=='none' 必须非空 */
  rangeCells: number[][];
  /** 以自身为中心、与朝向无关的光环格子集合（当前仅 koi 使用） */
  auraCells: number[][];
}

export interface EnemyConfig {
  id: string;
  name: string;
  hp: number;
  atk: number;
  interval: number;
  def: number;
  res: number;
  speed: number;
  dmgToBase: number;
  blockable: boolean;
  flying?: boolean;
  /** 远程攻击射程（milli 格）：>0 时未被阻挡也会攻击射程内单位；缺省近战。 */
  atkRange?: number;
}

export interface BlessingConfig {
  id: string;
  name: string;
  desc: string;
}

export interface MapMechanicConfig {
  id: string;
  name: string;
  desc: string;
  cells?: number[][];
  unitIntervalPermyriad?: number;
  unitAttackSpeedPermyriad?: number;
  cellUnitAttackSpeedPermyriad?: number;
  unitDamagePerSecond?: number;
  enemyMaxHpDamagePermyriadPerSecond?: number;
  cellEnemySpeedPermyriad?: number;
  rangedAtkPermyriad?: number;
  highGroundUnitAttackSpeedPermyriad?: number;
  highGroundUnitAtkPermyriad?: number;
  groundUnitAtkPermyriad?: number;
  groundUnitDefPermyriad?: number;
  cellUnitDefPermyriad?: number;
  enemyHpPermyriad?: number;
  enemyAtkPermyriad?: number;
  enemySpeedPermyriad?: number;
  allEnemySpeedPermyriad?: number;
  flyingEnemyAttackSpeedPermyriad?: number;
  flyingEnemyAtkPermyriad?: number;
  groundEnemyAtkPermyriad?: number;
  groundEnemyDefPermyriad?: number;
  cellEnemyDefPermyriad?: number;
  enemyDefBonus?: number;
  enemyResBonus?: number;
  enemyShieldPermyriad?: number;
  costRegenPermyriad?: number;
  leakDamageBonus?: number;
}

/** [delayFrames, enemyTypeIdx, pathIdx, count, intervalFrames] */
export type SpawnEvent = number[];

export interface MapConfig {
  id: string;
  name: string;
  difficulty: string;
  rows: number;
  cols: number;
  hpPermyriad: number;
  scorePermyriad: number;
  paths: number[][][];
  /** 飞行敌人专用路线；不参与地面部署格计算。 */
  flightPaths: number[][][];
  rangedCells: number[][];
  mechanics: MapMechanicConfig[];
  waveHpPermyriad: number[];
  waves: SpawnEvent[][];
}

export interface EngineConstants {
  fps: number;
  maxFrames: number;
  maxActions: number;
  intermissionFrames: number;
  initialCostMilli: number;
  costRegenMilliPerSec: number;
  costMaxMilli: number;
  initialLives: number;
  livesCap: number;
  retreatRefundPermyriad: number;
  waveClearCostMilli: number;
  blessingWaves: number[];
  blessingChoices: number;
  coinChancePermyriad: number;
  coinDelayBaseFrames: number;
  coinDelaySpreadFrames: number;
  waveScoreBase: number;
  waveScorePerWave: number;
  killScore: number;
  coinScore: number;
  koiWaveScore: number;
  livesScorePerLife: number;
  scoreCap: number;
  koiSpeedPermyriad: number;
  vanguardKillCostMilli: number;
}

export interface LuckyTdConfig {
  version: number;
  engine: EngineConstants;
  units: UnitConfig[];
  enemies: EnemyConfig[];
  blessings: BlessingConfig[];
  maps: MapConfig[];
}

/** 0 = playing, 1 = won, 2 = lost */
export type GameStatus = 0 | 1 | 2;

export interface UnitState {
  id: number;
  typeIdx: number;
  row: number;
  col: number;
  /** 朝向 0=右(+col) 1=下(+row) 2=左(−col) 3=上(−row) */
  dir: number;
  hp: number;
  maxHp: number;
  atkCooldown: number;
  spTimer: number;
  sp: number;
  skillActive: number;
  attackCount: number;
}

export interface EnemyState {
  id: number;
  typeIdx: number;
  pathIdx: number;
  progress: number;
  hp: number;
  maxHp: number;
  atk: number;
  interval: number;
  def: number;
  res: number;
  speed: number;
  dmgToBase: number;
  shield: number;
  skillCooldown: number;
  traitTier: number;
  hazardAcc: number;
  atkCooldown: number;
  blockedBy: number;
  leaked: boolean;
}

export interface CoinPlan {
  active: number;
  frame: number;
  path: number;
}

export interface GameState {
  seed: string;
  rngState: number;
  frame: number;
  status: GameStatus;
  mapIdx: number;
  squad: number[];
  costMilli: number;
  costAcc: number;
  lives: number;
  waveIndex: number;
  /** 0 = intermission, 1 = wave */
  phase: 0 | 1;
  intermissionRemaining: number;
  waveFrame: number;
  waveEvents: SpawnEvent[];
  spawnCursor: number[];
  spawnedInWave: number;
  coinPlan: CoinPlan;
  pendingBlessing: { options: number[] } | null;
  blessingsOwned: number;
  regenMilliPerSec: number;
  meleeHpBonusPm: number;
  rangedAtkBonusPm: number;
  nextWaveDebuffPm: number;
  debuffWave: number;
  scoreWaves: number;
  scoreKills: number;
  scoreLucky: number;
  unitSeq: number;
  enemySeq: number;
  units: UnitState[];
  enemies: EnemyState[];
  redeployCooldown: number[];
  activeSkillLevels: number[];
  activeSkillCooldown: number[];
  waveHashes: number[];
}

export type ActionType = 'deploy' | 'retreat' | 'bless' | 'skill' | 'skillUpgrade';

export interface GameAction {
  frame: number;
  seq: number;
  type: ActionType;
  unit?: number;
  row?: number;
  col?: number;
  /** deploy 必填：朝向 0..3 */
  dir?: number;
  unitId?: number;
  blessing?: number;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

export interface ScoreBreakdown {
  waves: number;
  kills: number;
  lucky: number;
  lives: number;
}

export interface GameResult {
  status: GameStatus;
  frames: number;
  wavesCleared: number;
  score: number;
  breakdown: ScoreBreakdown;
}

export interface ReplayInput {
  seed: string;
  mapId: string;
  squad: string[];
  actions: GameAction[];
}

export interface ReplayOutput {
  ok: boolean;
  error: string;
  state: GameState | null;
  result: GameResult | null;
}
