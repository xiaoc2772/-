// 幸运塔防主动技能定义。等级 1~10，升级消耗为整费，冷却按 30fps 帧数计。

export interface ActiveSkillInfo {
  id: string;
  name: string;
  desc: string;
  cooldown: number;
  upgradeCosts: number[];
}

export const ACTIVE_SKILL_MAX_LEVEL = 10;
const SKILL_LEVEL_ATK_BONUS_PM = 400;
const SKILL_LEVEL_HP_BONUS_PM = 450;
const SKILL_LEVEL_SPEED_BONUS_PM = 200;
const SKILL_LEVEL_COOLDOWN_REDUCTION_PM = 200;

// 以满编 9 人持续推进为基准：最便宜的 9 人组合总升级费约 1350，
// 正常经济最快在第 28 波附近全部满级；后三级刻意提高边际成本，保留终盘取舍。
const LOW_UPGRADE_COSTS = [6, 8, 9, 11, 14, 17, 20, 24, 30];
const STANDARD_UPGRADE_COSTS = [8, 9, 11, 12, 15, 18, 23, 27, 33];
const HIGH_UPGRADE_COSTS = [9, 11, 12, 14, 17, 21, 26, 30, 38];
// 经济角色会持续创造费用，额外成本用于抵消整局预期回费，避免经济编队提前满级。
const VANGUARD_UPGRADE_COSTS = [20, 30, 40, 50, 55, 60, 65, 70, 79];
const KOI_UPGRADE_COSTS = [18, 26, 35, 45, 50, 55, 60, 68, 79];
const BANNER_UPGRADE_COSTS = [14, 20, 27, 34, 40, 45, 48, 52, 56];
const ENGINEER_UPGRADE_COSTS = [19, 29, 39, 49, 54, 59, 64, 69, 77];

export const ACTIVE_SKILLS: ActiveSkillInfo[] = [
  {
    id: 'supply',
    name: '疾风征调',
    desc: '立即获得费用，治疗自身，并对正前方敌人追加一次突刺回推。',
    cooldown: 720,
    upgradeCosts: VANGUARD_UPGRADE_COSTS,
  },
  {
    id: 'bulwark',
    name: '星岩壁垒',
    desc: '展开高额防御立场，治疗自身，并震伤当前阻挡的敌人。',
    cooldown: 900,
    upgradeCosts: STANDARD_UPGRADE_COSTS,
  },
  {
    id: 'duel',
    name: '双刃风暴',
    desc: '连续斩击阻挡和射程内敌人，对同一波压力点快速削血。',
    cooldown: 660,
    upgradeCosts: STANDARD_UPGRADE_COSTS,
  },
  {
    id: 'flame-ring',
    name: '熔火回廊',
    desc: '点燃自身周围道路，造成范围法术伤害并压低敌人移速。',
    cooldown: 780,
    upgradeCosts: STANDARD_UPGRADE_COSTS,
  },
  {
    id: 'volley',
    name: '穿云连射',
    desc: '优先锁定空中单位，对多个高威胁目标连射并轻微回推。',
    cooldown: 600,
    upgradeCosts: LOW_UPGRADE_COSTS,
  },
  {
    id: 'nova',
    name: '星辉裁决',
    desc: '在目标区域释放星辉爆炸，造成法术伤害并削弱护盾与法抗。',
    cooldown: 840,
    upgradeCosts: HIGH_UPGRADE_COSTS,
  },
  {
    id: 'moonheal',
    name: '月相急救',
    desc: '治疗全体友方，并小幅缩短全队主动技能冷却。',
    cooldown: 720,
    upgradeCosts: STANDARD_UPGRADE_COSTS,
  },
  {
    id: 'lucky-draw',
    name: '锦鲤祈愿',
    desc: '释放锦鲤祈愿，获得保底费用、治疗与冷却缩短，并随机触发费用、生命、削弱、控场或幸运分好运签。',
    cooldown: 960,
    upgradeCosts: KOI_UPGRADE_COSTS,
  },
  {
    id: 'execute',
    name: '影袭断魂',
    desc: '锁定低生命目标造成直伤和最大生命伤害，击杀后返还费用。',
    cooldown: 660,
    upgradeCosts: STANDARD_UPGRADE_COSTS,
  },
  {
    id: 'barrage',
    name: '雷震炮阵',
    desc: '向最密集敌群覆盖炮击，造成大范围直伤并击碎部分护盾。',
    cooldown: 900,
    upgradeCosts: HIGH_UPGRADE_COSTS,
  },
  {
    id: 'frost-tide',
    name: '霜潮回环',
    desc: '冻结射程内敌人，造成法术伤害、降低移速并将其向入口回推。',
    cooldown: 780,
    upgradeCosts: STANDARD_UPGRADE_COSTS,
  },
  {
    id: 'battle-drum',
    name: '战鼓总攻',
    desc: '鼓舞全队，治疗友方、获得费用并显著缩短主动技能冷却。',
    cooldown: 900,
    upgradeCosts: BANNER_UPGRADE_COSTS,
  },
  {
    id: 'thorn-bastion',
    name: '荆棘壁垒',
    desc: '开启防御姿态，治疗自身，反刺并削弱被阻挡敌人的攻击。',
    cooldown: 840,
    upgradeCosts: STANDARD_UPGRADE_COSTS,
  },
  {
    id: 'storm-mark',
    name: '雷羽天罚',
    desc: '优先点杀空中单位，连发破盾重箭并把目标向入口击退。',
    cooldown: 720,
    upgradeCosts: HIGH_UPGRADE_COSTS,
  },
  {
    id: 'venom-mire',
    name: '蚀雾沼泽',
    desc: '腐蚀射程内敌人，造成法术伤害并永久削减移速、防御和法抗。',
    cooldown: 780,
    upgradeCosts: STANDARD_UPGRADE_COSTS,
  },
  {
    id: 'solar-grace',
    name: '日冕赐福',
    desc: '治疗全体友方，缩短再部署等待，高等级额外恢复基地生命。',
    cooldown: 780,
    upgradeCosts: STANDARD_UPGRADE_COSTS,
  },
  {
    id: 'field-workshop',
    name: '应急工坊',
    desc: '立即获得费用，修理低血量友方，并整理再部署与技能冷却。',
    cooldown: 840,
    upgradeCosts: ENGINEER_UPGRADE_COSTS,
  },
  {
    id: 'void-collapse',
    name: '虚空坍缩',
    desc: '对射程内敌人造成最大生命比例直伤，破盾、减速并向入口拖回。',
    cooldown: 960,
    upgradeCosts: HIGH_UPGRADE_COSTS,
  },
];

export function activeSkillFor(typeIdx: number): ActiveSkillInfo {
  return ACTIVE_SKILLS[typeIdx];
}

export function activeSkillUpgradeCost(typeIdx: number, level: number): number {
  if (level < 1 || level >= ACTIVE_SKILL_MAX_LEVEL) {
    return 0;
  }
  return activeSkillFor(typeIdx).upgradeCosts[level - 1] ?? 0;
}

export function activeSkillCooldownFor(typeIdx: number, level: number): number {
  const reduction = skillExtraLevels(level) * SKILL_LEVEL_COOLDOWN_REDUCTION_PM;
  return Math.max(120, Math.floor((activeSkillFor(typeIdx).cooldown * Math.max(6500, 10000 - reduction)) / 10000));
}

function skillExtraLevels(level: number): number {
  return Math.max(0, Math.min(ACTIVE_SKILL_MAX_LEVEL, level) - 1);
}

export function skillLevelAtkBonusPermyriad(level: number): number {
  return skillExtraLevels(level) * SKILL_LEVEL_ATK_BONUS_PM;
}

export function skillLevelHpBonusPermyriad(level: number): number {
  return skillExtraLevels(level) * SKILL_LEVEL_HP_BONUS_PM;
}

export function skillLevelSpeedBonusPermyriad(level: number): number {
  return skillExtraLevels(level) * SKILL_LEVEL_SPEED_BONUS_PM;
}

export function skillLevelRangeRadius(level: number): number {
  const bounded = Math.min(ACTIVE_SKILL_MAX_LEVEL, Math.max(1, level));
  return bounded >= 10 ? 2 : bounded >= 5 ? 1 : 0;
}

export function skillGrowthDetail(level: number): string {
  const extra = skillExtraLevels(level);
  const atk = Math.floor(skillLevelAtkBonusPermyriad(level) / 100);
  const hp = Math.floor(skillLevelHpBonusPermyriad(level) / 100);
  const speed = Math.floor(skillLevelSpeedBonusPermyriad(level) / 100);
  const range = skillLevelRangeRadius(level);
  const cooldown = Math.floor((extra * SKILL_LEVEL_COOLDOWN_REDUCTION_PM) / 100);
  return extra === 0 ? '基础属性，无额外成长' : `攻击/治疗 +${atk}%，生命 +${hp}%，攻速 +${speed}%，冷却 -${cooldown}%${range > 0 ? `，范围 +${range}` : ''}`;
}

export function activeSkillDetail(typeIdx: number, level: number): string {
  switch (typeIdx) {
    case 0:
      return `获得 ${(6 + (level - 1) * 0.8).toFixed(1)} 费，自疗 ${110 + (level - 1) * 25}，突刺 ${130 + (level - 1) * 30}`;
    case 1:
      return `壁垒 ${Math.ceil((180 + (level - 1) * 15) / 30)} 秒，自疗 ${220 + (level - 1) * 45}，震伤 ${160 + (level - 1) * 35}`;
    case 2:
      return `斩击 ${3 + Math.ceil(level / 2)} 个目标，每段 ${190 + (level - 1) * 45} 直伤`;
    case 3:
      return `范围法术 ${240 + (level - 1) * 55}，移速降至 ${Math.max(57, 84 - (level - 1) * 3)}%`;
    case 4:
      return `连射 ${4 + Math.ceil(level / 2)} 个目标，每箭 ${220 + (level - 1) * 50}，空中 +40%`;
    case 5:
      return `范围魔法 ${300 + (level - 1) * 65}，护盾削减 ${25 + level * 3}%`;
    case 6:
      return `全体治疗 ${240 + (level - 1) * 50}，技能冷却 -${3 + Math.ceil(level / 2)} 秒`;
    case 7:
      return `保底 ${(5 + level * 0.7).toFixed(1)} 费，全体治疗 ${90 + level * 35}，技能冷却 -${2 + Math.floor(level / 2)} 秒；随机触发好运签${level >= 6 ? '（含幸运分大奖）' : ''}`;
    case 8:
      return `直伤 ${380 + (level - 1) * 90} + 最大生命 ${(5 + level * 0.7).toFixed(1)}%，击杀返还 ${(4 + level * 0.6).toFixed(1)} 费`;
    case 9:
      return `炮击范围 ${Math.ceil((1200 + (level - 1) * 80) / 1000)} 格，直伤 ${280 + (level - 1) * 70}，破盾 35%`;
    case 10:
      return `范围魔法 ${180 + (level - 1) * 45}，回退 ${((650 + (level - 1) * 100) / 1000).toFixed(1)} 格，移速 -${15 + level * 3}%`;
    case 11:
      return `全队治疗 ${150 + (level - 1) * 35}，获得 ${(2.5 + level * 0.7).toFixed(1)} 费，技能冷却 -${4 + Math.floor(level / 2)} 秒`;
    case 12:
      return `防御姿态 ${Math.ceil((180 + (level - 1) * 15) / 30)} 秒，自疗 ${180 + (level - 1) * 40}，反刺 ${220 + (level - 1) * 45}`;
    case 13:
      return `点名 ${450 + (level - 1) * 100}，空中 +55%，破盾并回推`;
    case 14:
      return `范围法术 ${170 + (level - 1) * 40}，移速 -${12 + (level - 1) * 3}%，防御/法抗削弱`;
    case 15:
      return `全体治疗 ${220 + (level - 1) * 45}，再部署 -${5 + Math.floor(level / 2)} 秒${level >= 10 ? '，恢复 1 生命' : ''}`;
    case 16:
      return `获得 ${(5 + (level - 1) * 1.2).toFixed(1)} 费，修理 ${180 + (level - 1) * 40}，再部署/技能冷却缩短`;
    case 17:
      return `最大生命直伤 ${(6 + level * 0.9).toFixed(1)}% + ${140 + (level - 1) * 35}，回拖 ${((500 + (level - 1) * 100) / 1000).toFixed(1)} 格`;
    default:
      return '未知技能';
  }
}
