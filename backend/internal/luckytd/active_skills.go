package luckytd

const activeSkillMaxLevel = 10
const skillLevelAtkBonusPm = 400
const skillLevelHpBonusPm = 450
const skillLevelSpeedBonusPm = 200
const skillLevelCooldownReductionPm = 200

// 以满编 9 人持续推进为基准：最便宜的 9 人组合总升级费约 1350，
// 正常经济最快在第 28 波附近全部满级；后三级刻意提高边际成本，保留终盘取舍。
var lowUpgradeCosts = []int{6, 8, 9, 11, 14, 17, 20, 24, 30}
var standardUpgradeCosts = []int{8, 9, 11, 12, 15, 18, 23, 27, 33}
var highUpgradeCosts = []int{9, 11, 12, 14, 17, 21, 26, 30, 38}
var vanguardUpgradeCosts = []int{20, 30, 40, 50, 55, 60, 65, 70, 79}
var koiUpgradeCosts = []int{18, 26, 35, 45, 50, 55, 60, 68, 79}
var bannerUpgradeCosts = []int{14, 20, 27, 34, 40, 45, 48, 52, 56}
var engineerUpgradeCosts = []int{19, 29, 39, 49, 54, 59, 64, 69, 77}

type activeSkillInfo struct {
	ID           string
	Name         string
	Desc         string
	Cooldown     int
	UpgradeCosts []int
}

var activeSkills = []activeSkillInfo{
	{
		ID:           "supply",
		Name:         "疾风征调",
		Desc:         "立即获得费用，治疗自身，并对正前方敌人追加一次突刺回推。",
		Cooldown:     720,
		UpgradeCosts: vanguardUpgradeCosts,
	},
	{
		ID:           "bulwark",
		Name:         "星岩壁垒",
		Desc:         "展开高额防御立场，治疗自身，并震伤当前阻挡的敌人。",
		Cooldown:     900,
		UpgradeCosts: standardUpgradeCosts,
	},
	{
		ID:           "duel",
		Name:         "双刃风暴",
		Desc:         "连续斩击阻挡和射程内敌人，对同一波压力点快速削血。",
		Cooldown:     660,
		UpgradeCosts: standardUpgradeCosts,
	},
	{
		ID:           "flame-ring",
		Name:         "熔火回廊",
		Desc:         "点燃自身周围道路，造成范围法术伤害并压低敌人移速。",
		Cooldown:     780,
		UpgradeCosts: standardUpgradeCosts,
	},
	{
		ID:           "volley",
		Name:         "穿云连射",
		Desc:         "优先锁定空中单位，对多个高威胁目标连射并轻微回推。",
		Cooldown:     600,
		UpgradeCosts: lowUpgradeCosts,
	},
	{
		ID:           "nova",
		Name:         "星辉裁决",
		Desc:         "在目标区域释放星辉爆炸，造成法术伤害并削弱护盾与法抗。",
		Cooldown:     840,
		UpgradeCosts: highUpgradeCosts,
	},
	{
		ID:           "moonheal",
		Name:         "月相急救",
		Desc:         "治疗全体友方，并小幅缩短全队主动技能冷却。",
		Cooldown:     720,
		UpgradeCosts: standardUpgradeCosts,
	},
	{
		ID:           "lucky-draw",
		Name:         "锦鲤祈愿",
		Desc:         "释放锦鲤祈愿，获得保底费用、治疗与冷却缩短，并随机触发费用、生命、削弱、控场或幸运分好运签。",
		Cooldown:     960,
		UpgradeCosts: koiUpgradeCosts,
	},
	{
		ID:           "execute",
		Name:         "影袭断魂",
		Desc:         "锁定低生命目标造成直伤和最大生命伤害，击杀后返还费用。",
		Cooldown:     660,
		UpgradeCosts: standardUpgradeCosts,
	},
	{
		ID:           "barrage",
		Name:         "雷震炮阵",
		Desc:         "向最密集敌群覆盖炮击，造成大范围直伤并击碎部分护盾。",
		Cooldown:     900,
		UpgradeCosts: highUpgradeCosts,
	},
	{
		ID:           "frost-tide",
		Name:         "霜潮回环",
		Desc:         "冻结射程内敌人，造成法术伤害、降低移速并将其向入口回推。",
		Cooldown:     780,
		UpgradeCosts: standardUpgradeCosts,
	},
	{
		ID:           "battle-drum",
		Name:         "战鼓总攻",
		Desc:         "鼓舞全队，治疗友方、获得费用并显著缩短主动技能冷却。",
		Cooldown:     900,
		UpgradeCosts: bannerUpgradeCosts,
	},
	{
		ID:           "thorn-bastion",
		Name:         "荆棘壁垒",
		Desc:         "开启防御姿态，治疗自身，反刺并削弱被阻挡敌人的攻击。",
		Cooldown:     840,
		UpgradeCosts: standardUpgradeCosts,
	},
	{
		ID:           "storm-mark",
		Name:         "雷羽天罚",
		Desc:         "优先点杀空中单位，连发破盾重箭并把目标向入口击退。",
		Cooldown:     720,
		UpgradeCosts: highUpgradeCosts,
	},
	{
		ID:           "venom-mire",
		Name:         "蚀雾沼泽",
		Desc:         "腐蚀射程内敌人，造成法术伤害并永久削减移速、防御和法抗。",
		Cooldown:     780,
		UpgradeCosts: standardUpgradeCosts,
	},
	{
		ID:           "solar-grace",
		Name:         "日冕赐福",
		Desc:         "治疗全体友方，缩短再部署等待，高等级额外恢复基地生命。",
		Cooldown:     780,
		UpgradeCosts: standardUpgradeCosts,
	},
	{
		ID:           "field-workshop",
		Name:         "应急工坊",
		Desc:         "立即获得费用，修理低血量友方，并整理再部署与技能冷却。",
		Cooldown:     840,
		UpgradeCosts: engineerUpgradeCosts,
	},
	{
		ID:           "void-collapse",
		Name:         "虚空坍缩",
		Desc:         "对射程内敌人造成最大生命比例直伤，破盾、减速并向入口拖回。",
		Cooldown:     960,
		UpgradeCosts: highUpgradeCosts,
	},
}

func activeSkillUpgradeCost(typeIdx, level int) int {
	if level < 1 || level >= activeSkillMaxLevel {
		return 0
	}
	if typeIdx < 0 || typeIdx >= len(activeSkills) {
		return 0
	}
	return activeSkills[typeIdx].UpgradeCosts[level-1]
}

func activeSkillCooldownFor(typeIdx, level int) int {
	if typeIdx < 0 || typeIdx >= len(activeSkills) {
		return 120
	}
	reduction := skillExtraLevels(level) * skillLevelCooldownReductionPm
	return max(120, activeSkills[typeIdx].Cooldown*max(6500, 10000-reduction)/10000)
}

func skillExtraLevels(level int) int {
	if level < 1 {
		return 0
	}
	if level > activeSkillMaxLevel {
		level = activeSkillMaxLevel
	}
	return level - 1
}

func skillLevelAtkBonusPermyriad(level int) int {
	return skillExtraLevels(level) * skillLevelAtkBonusPm
}

func skillLevelHpBonusPermyriad(level int) int {
	return skillExtraLevels(level) * skillLevelHpBonusPm
}

func skillLevelSpeedBonusPermyriad(level int) int {
	return skillExtraLevels(level) * skillLevelSpeedBonusPm
}

func skillLevelRangeRadius(level int) int {
	if level < 1 {
		level = 1
	}
	if level > activeSkillMaxLevel {
		level = activeSkillMaxLevel
	}
	if level >= 10 {
		return 2
	}
	if level >= 5 {
		return 1
	}
	return 0
}
