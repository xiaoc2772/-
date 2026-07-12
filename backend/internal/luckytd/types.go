// 幸运塔防引擎类型定义。契约见 docs/lucky-td-engine-spec.md §3~§5。
// 逻辑层全部为整数：坐标 milli-tile，百分比为万分比（permyriad）；
// 结构与 TS 参考实现（src/lib/lucky-td/engine/types.ts）一一对应。

package luckytd

// SkillConfig 的 kind 取值为 "shield" | "triple"。
type SkillConfig struct {
	Kind      string `json:"kind"`
	SpCost    int    `json:"spCost"`
	Duration  int    `json:"duration"`
	Permyriad int    `json:"permyriad"`
	Every     int    `json:"every"`
}

// UnitConfig 的 atkType 取值为 "phys" | "magic" | "heal" | "none"。
type UnitConfig struct {
	ID              string       `json:"id"`
	Name            string       `json:"name"`
	Cost            int          `json:"cost"`
	Block           int          `json:"block"`
	HP              int          `json:"hp"`
	Atk             int          `json:"atk"`
	AtkType         string       `json:"atkType"`
	Interval        int          `json:"interval"`
	Def             int          `json:"def"`
	Res             int          `json:"res"`
	Redeploy        int          `json:"redeploy"`
	Tags            []string     `json:"tags"`
	Skill           *SkillConfig `json:"skill"`
	SplashRadius    int          `json:"splashRadius"`
	SplashPermyriad int          `json:"splashPermyriad"`
	AoeRadius       int          `json:"aoeRadius"`
	RangeCells      [][]int      `json:"rangeCells"`
	AuraCells       [][]int      `json:"auraCells"`
}

type EnemyConfig struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	HP        int    `json:"hp"`
	Atk       int    `json:"atk"`
	Interval  int    `json:"interval"`
	Def       int    `json:"def"`
	Res       int    `json:"res"`
	Speed     int    `json:"speed"`
	DmgToBase int    `json:"dmgToBase"`
	Blockable bool   `json:"blockable"`
	Flying    bool   `json:"flying,omitempty"`
	// AtkRange 远程攻击射程（milli 格）：>0 时未被阻挡也会攻击射程内单位；0 为近战。
	AtkRange int `json:"atkRange,omitempty"`
}

type BlessingConfig struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Desc string `json:"desc"`
}

type MapMechanicConfig struct {
	ID                                 string  `json:"id"`
	Name                               string  `json:"name"`
	Desc                               string  `json:"desc"`
	Cells                              [][]int `json:"cells,omitempty"`
	UnitIntervalPermyriad              int     `json:"unitIntervalPermyriad,omitempty"`
	UnitAttackSpeedPermyriad           int     `json:"unitAttackSpeedPermyriad,omitempty"`
	CellUnitAttackSpeedPermyriad       int     `json:"cellUnitAttackSpeedPermyriad,omitempty"`
	UnitDamagePerSecond                int     `json:"unitDamagePerSecond,omitempty"`
	EnemyMaxHpDamagePermyriadPerSecond int     `json:"enemyMaxHpDamagePermyriadPerSecond,omitempty"`
	CellEnemySpeedPermyriad            int     `json:"cellEnemySpeedPermyriad,omitempty"`
	RangedAtkPermyriad                 int     `json:"rangedAtkPermyriad,omitempty"`
	HighGroundUnitAttackSpeedPermyriad int     `json:"highGroundUnitAttackSpeedPermyriad,omitempty"`
	HighGroundUnitAtkPermyriad         int     `json:"highGroundUnitAtkPermyriad,omitempty"`
	GroundUnitAtkPermyriad             int     `json:"groundUnitAtkPermyriad,omitempty"`
	GroundUnitDefPermyriad             int     `json:"groundUnitDefPermyriad,omitempty"`
	CellUnitDefPermyriad               int     `json:"cellUnitDefPermyriad,omitempty"`
	EnemyHpPermyriad                   int     `json:"enemyHpPermyriad,omitempty"`
	EnemyAtkPermyriad                  int     `json:"enemyAtkPermyriad,omitempty"`
	EnemySpeedPermyriad                int     `json:"enemySpeedPermyriad,omitempty"`
	AllEnemySpeedPermyriad             int     `json:"allEnemySpeedPermyriad,omitempty"`
	FlyingEnemyAttackSpeedPermyriad    int     `json:"flyingEnemyAttackSpeedPermyriad,omitempty"`
	FlyingEnemyAtkPermyriad            int     `json:"flyingEnemyAtkPermyriad,omitempty"`
	GroundEnemyAtkPermyriad            int     `json:"groundEnemyAtkPermyriad,omitempty"`
	GroundEnemyDefPermyriad            int     `json:"groundEnemyDefPermyriad,omitempty"`
	CellEnemyDefPermyriad              int     `json:"cellEnemyDefPermyriad,omitempty"`
	EnemyDefBonus                      int     `json:"enemyDefBonus,omitempty"`
	EnemyResBonus                      int     `json:"enemyResBonus,omitempty"`
	EnemyShieldPermyriad               int     `json:"enemyShieldPermyriad,omitempty"`
	CostRegenPermyriad                 int     `json:"costRegenPermyriad,omitempty"`
	LeakDamageBonus                    int     `json:"leakDamageBonus,omitempty"`
}

// MapConfig 的 waves 中每个事件为 [delayFrames, enemyTypeIdx, pathIdx, count, intervalFrames]。
type MapConfig struct {
	ID              string              `json:"id"`
	Name            string              `json:"name"`
	Difficulty      string              `json:"difficulty"`
	Rows            int                 `json:"rows"`
	Cols            int                 `json:"cols"`
	HpPermyriad     int                 `json:"hpPermyriad"`
	ScorePermyriad  int                 `json:"scorePermyriad"`
	Paths           [][][]int           `json:"paths"`
	FlightPaths     [][][]int           `json:"flightPaths"`
	RangedCells     [][]int             `json:"rangedCells"`
	Mechanics       []MapMechanicConfig `json:"mechanics"`
	WaveHpPermyriad []int               `json:"waveHpPermyriad"`
	Waves           [][][]int           `json:"waves"`
}

type EngineConstants struct {
	Fps                    int   `json:"fps"`
	MaxFrames              int   `json:"maxFrames"`
	MaxActions             int   `json:"maxActions"`
	IntermissionFrames     int   `json:"intermissionFrames"`
	InitialCostMilli       int   `json:"initialCostMilli"`
	CostRegenMilliPerSec   int   `json:"costRegenMilliPerSec"`
	CostMaxMilli           int   `json:"costMaxMilli"`
	InitialLives           int   `json:"initialLives"`
	LivesCap               int   `json:"livesCap"`
	RetreatRefundPermyriad int   `json:"retreatRefundPermyriad"`
	WaveClearCostMilli     int   `json:"waveClearCostMilli"`
	BlessingWaves          []int `json:"blessingWaves"`
	BlessingChoices        int   `json:"blessingChoices"`
	CoinChancePermyriad    int   `json:"coinChancePermyriad"`
	CoinDelayBaseFrames    int   `json:"coinDelayBaseFrames"`
	CoinDelaySpreadFrames  int   `json:"coinDelaySpreadFrames"`
	WaveScoreBase          int   `json:"waveScoreBase"`
	WaveScorePerWave       int   `json:"waveScorePerWave"`
	KillScore              int   `json:"killScore"`
	CoinScore              int   `json:"coinScore"`
	KoiWaveScore           int   `json:"koiWaveScore"`
	LivesScorePerLife      int   `json:"livesScorePerLife"`
	ScoreCap               int   `json:"scoreCap"`
	KoiSpeedPermyriad      int   `json:"koiSpeedPermyriad"`
	VanguardKillCostMilli  int   `json:"vanguardKillCostMilli"`
}

type LuckyTdConfig struct {
	Version   int              `json:"version"`
	Engine    EngineConstants  `json:"engine"`
	Units     []UnitConfig     `json:"units"`
	Enemies   []EnemyConfig    `json:"enemies"`
	Blessings []BlessingConfig `json:"blessings"`
	Maps      []MapConfig      `json:"maps"`
}

// 对局状态：0 playing / 1 won / 2 lost。
const (
	StatusPlaying = 0
	StatusWon     = 1
	StatusLost    = 2
)

type UnitState struct {
	ID          int
	TypeIdx     int
	Row         int
	Col         int
	Dir         int
	HP          int
	MaxHP       int
	AtkCooldown int
	SpTimer     int
	Sp          int
	SkillActive int
	AttackCount int
}

type EnemyState struct {
	ID            int
	TypeIdx       int
	PathIdx       int
	Progress      int
	HP            int
	MaxHP         int
	Atk           int
	Interval      int
	Def           int
	Res           int
	Speed         int
	DmgToBase     int
	Shield        int
	SkillCooldown int
	TraitTier     int
	HazardAcc     int
	AtkCooldown   int
	BlockedBy     int
	Leaked        bool
}

type CoinPlan struct {
	Active int
	Frame  int
	Path   int
}

type PendingBlessing struct {
	Options []int
}

// GameState 是引擎就地修改的模拟状态（30Hz 性能豁免区），外部不得共享引用。
// Phase：0 = intermission，1 = wave。WaveEvents、SpawnCursor 与 WaveHashes 不参与状态哈希。
type GameState struct {
	Seed                  string
	RngState              uint32
	Frame                 int
	Status                int
	MapIdx                int
	Squad                 []int
	CostMilli             int
	CostAcc               int
	Lives                 int
	WaveIndex             int
	Phase                 int
	IntermissionRemaining int
	WaveFrame             int
	WaveEvents            [][]int
	SpawnCursor           []int
	SpawnedInWave         int
	CoinPlan              CoinPlan
	PendingBlessing       *PendingBlessing
	BlessingsOwned        int
	RegenMilliPerSec      int
	MeleeHpBonusPm        int
	RangedAtkBonusPm      int
	NextWaveDebuffPm      int
	DebuffWave            int
	ScoreWaves            int
	ScoreKills            int
	ScoreLucky            int
	UnitSeq               int
	EnemySeq              int
	Units                 []UnitState
	Enemies               []EnemyState
	RedeployCooldown      []int
	ActiveSkillLevels     []int
	ActiveSkillCooldown   []int
	WaveHashes            []uint32
}

// GameAction 可选字段用指针表达缺省：TS 侧缺省值为 unit/row/col/blessing = -1、
// unitId = 0，与 Go 裸 int 零值不同，缺字段与显式 0 必须可区分。
type GameAction struct {
	Frame    int    `json:"frame"`
	Seq      int    `json:"seq"`
	Type     string `json:"type"`
	Unit     *int   `json:"unit,omitempty"`
	Row      *int   `json:"row,omitempty"`
	Col      *int   `json:"col,omitempty"`
	Dir      *int   `json:"dir,omitempty"`
	UnitID   *int   `json:"unitId,omitempty"`
	Blessing *int   `json:"blessing,omitempty"`
}

type ActionResult struct {
	OK      bool
	Message string
}

type ScoreBreakdown struct {
	Waves int `json:"waves"`
	Kills int `json:"kills"`
	Lucky int `json:"lucky"`
	Lives int `json:"lives"`
}

type GameResult struct {
	Status       int            `json:"status"`
	Frames       int            `json:"frames"`
	WavesCleared int            `json:"wavesCleared"`
	Score        int            `json:"score"`
	Breakdown    ScoreBreakdown `json:"breakdown"`
}

type ReplayInput struct {
	Seed    string       `json:"seed"`
	MapID   string       `json:"mapId"`
	Squad   []string     `json:"squad"`
	Actions []GameAction `json:"actions"`
}

type ReplayOutput struct {
	OK     bool
	Error  string
	State  *GameState
	Result *GameResult
}
