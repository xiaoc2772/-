package roguelite

type CellType string
type Risk string
type RelicType string
type GameStatus string
type CellViewState string

const (
	GameType = "roguelite"

	CellStart    CellType = "start"
	CellEmpty    CellType = "empty"
	CellMonster  CellType = "monster"
	CellStardust CellType = "stardust"
	CellRelic    CellType = "relic"
	CellEvent    CellType = "event"
	CellShop     CellType = "shop"
	CellRift     CellType = "rift"
	CellChest    CellType = "chest"
	CellExit     CellType = "exit"
	CellBoss     CellType = "boss"
	CellHidden   CellType = "hidden"

	RiskSafe   Risk = "safe"
	RiskLow    Risk = "low"
	RiskMedium Risk = "medium"
	RiskHigh   Risk = "high"

	RelicEdgeMender    RelicType = "edge_mender"
	RelicGlassAegis    RelicType = "glass_aegis"
	RelicStarCompass   RelicType = "star_compass"
	RelicKeySpring     RelicType = "key_spring"
	RelicRiftFilter    RelicType = "rift_filter"
	RelicBattleCharm   RelicType = "battle_charm"
	RelicTreasureEcho  RelicType = "treasure_echo"
	RelicStarlightLens RelicType = "starlight_lens"
	RelicDustCollector RelicType = "dust_collector"
	RelicPrismVial     RelicType = "prism_vial"
	RelicWardenGlyph   RelicType = "warden_glyph"
	RelicSpoilsMagnet  RelicType = "spoils_magnet"
	RelicMeteorBoots   RelicType = "meteor_boots"

	StatusPlaying  GameStatus = "playing"
	StatusEscaped  GameStatus = "escaped"
	StatusDefeated GameStatus = "defeated"

	ViewHidden   CellViewState = "hidden"
	ViewScouted  CellViewState = "scouted"
	ViewRevealed CellViewState = "revealed"
	ViewCurrent  CellViewState = "current"
)

type Position struct {
	Row int `json:"row"`
	Col int `json:"col"`
}

type Monster struct {
	Name           string `json:"name"`
	HP             int    `json:"hp"`
	MaxHP          int    `json:"maxHp"`
	Attack         int    `json:"attack"`
	RewardStardust int    `json:"rewardStardust"`
	Elite          bool   `json:"elite,omitempty"`
}

type EventOption struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

type ShopItem struct {
	ID          string    `json:"id"`
	Label       string    `json:"label"`
	Description string    `json:"description"`
	Cost        int       `json:"cost"`
	Kind        string    `json:"kind"`
	Relic       RelicType `json:"relic,omitempty"`
}

type ChestReward struct {
	Stardust int       `json:"stardust"`
	Relic    RelicType `json:"relic,omitempty"`
}

type Cell struct {
	ID           string        `json:"id"`
	Position     Position      `json:"position"`
	Type         CellType      `json:"type"`
	Risk         Risk          `json:"risk"`
	Hint         string        `json:"hint"`
	Label        string        `json:"label"`
	Icon         string        `json:"icon"`
	Stardust     *int          `json:"stardust,omitempty"`
	Damage       *int          `json:"damage,omitempty"`
	Monster      *Monster      `json:"monster,omitempty"`
	Relic        RelicType     `json:"relic,omitempty"`
	EventOptions []EventOption `json:"eventOptions,omitempty"`
	ShopItems    []ShopItem    `json:"shopItems,omitempty"`
	ChestReward  *ChestReward  `json:"chestReward,omitempty"`
}

type Board struct {
	Floor         int      `json:"floor"`
	StartPosition Position `json:"startPosition"`
	ExitPosition  Position `json:"exitPosition"`
	Cells         []Cell   `json:"cells"`
}

type PlayerState struct {
	HP               int         `json:"hp"`
	MaxHP            int         `json:"maxHp"`
	Shield           int         `json:"shield"`
	Stardust         int         `json:"stardust"`
	Keys             int         `json:"keys"`
	StepsRemaining   int         `json:"stepsRemaining"`
	Attack           int         `json:"attack"`
	Position         Position    `json:"position"`
	Relics           []RelicType `json:"relics"`
	MonstersDefeated int         `json:"monstersDefeated"`
	ChestsOpened     int         `json:"chestsOpened"`
	EventsResolved   int         `json:"eventsResolved"`
	FloorsCleared    int         `json:"floorsCleared"`
	ExploredCells    int         `json:"exploredCells"`
	UsedAegis        bool        `json:"usedAegis"`
	RingHealKeys     []string    `json:"ringHealKeys"`
}

type Pending struct {
	Type     string        `json:"type"`
	Position Position      `json:"position"`
	Monster  *Monster      `json:"monster,omitempty"`
	Round    int           `json:"round,omitempty"`
	IsBoss   bool          `json:"isBoss,omitempty"`
	Options  []EventOption `json:"options,omitempty"`
	Items    []ShopItem    `json:"items,omitempty"`
	Reward   *ChestReward  `json:"reward,omitempty"`
}

type GameState struct {
	Seed           string          `json:"seed"`
	Floor          int             `json:"floor"`
	Board          Board           `json:"board"`
	Player         PlayerState     `json:"player"`
	Visited        []string        `json:"visited"`
	Revealed       []string        `json:"revealed"`
	Pending        *Pending        `json:"pending,omitempty"`
	Status         GameStatus      `json:"status"`
	DefeatedReason string          `json:"defeatedReason,omitempty"`
	CellOverrides  map[string]Cell `json:"cellOverrides,omitempty"`
}

type Action struct {
	Type     string   `json:"type"`
	To       Position `json:"to,omitempty"`
	Style    string   `json:"style,omitempty"`
	OptionID string   `json:"optionId,omitempty"`
	ItemID   string   `json:"itemId,omitempty"`
	Open     bool     `json:"open"`
}

type ActionOutcome struct {
	Message       string     `json:"message"`
	DamageTaken   int        `json:"damageTaken"`
	ShieldBlocked int        `json:"shieldBlocked"`
	StardustDelta int        `json:"stardustDelta"`
	KeyDelta      int        `json:"keyDelta"`
	HPDelta       int        `json:"hpDelta"`
	RelicGained   RelicType  `json:"relicGained,omitempty"`
	FloorChanged  bool       `json:"floorChanged"`
	CombatEnded   bool       `json:"combatEnded"`
	Status        GameStatus `json:"status"`
}

type ActionResult struct {
	OK      bool
	State   GameState
	Outcome ActionOutcome
	Message string
}

type CellView struct {
	ID               string        `json:"id"`
	Position         Position      `json:"position"`
	ViewPosition     Position      `json:"viewPosition"`
	RelativePosition Position      `json:"relativePosition"`
	State            CellViewState `json:"state"`
	Type             CellType      `json:"type"`
	Risk             Risk          `json:"risk"`
	Hint             string        `json:"hint"`
	Label            string        `json:"label"`
	Icon             string        `json:"icon"`
	Adjacent         bool          `json:"adjacent"`
	Exhausted        bool          `json:"exhausted"`
	Stardust         *int          `json:"stardust,omitempty"`
	Damage           *int          `json:"damage,omitempty"`
	Monster          *Monster      `json:"monster,omitempty"`
	Relic            RelicType     `json:"relic,omitempty"`
	EventOptions     []EventOption `json:"eventOptions,omitempty"`
	ShopItems        []ShopItem    `json:"shopItems,omitempty"`
	ChestReward      *ChestReward  `json:"chestReward,omitempty"`
}

type StarGateView struct {
	Position        *Position `json:"position,omitempty"`
	Distance        int       `json:"distance"`
	Direction       string    `json:"direction"`
	Exact           bool      `json:"exact"`
	EndlessUnlocked bool      `json:"endlessUnlocked"`
}

type StateView struct {
	Floor          int            `json:"floor"`
	BoardSize      int            `json:"boardSize"`
	ViewportRadius int            `json:"viewportRadius"`
	SightRadius    int            `json:"sightRadius"`
	Board          []CellView     `json:"board"`
	Player         PlayerState    `json:"player"`
	StarGate       StarGateView   `json:"starGate"`
	Pending        *Pending       `json:"pending,omitempty"`
	Status         GameStatus     `json:"status"`
	DefeatedReason string         `json:"defeatedReason,omitempty"`
	ScorePreview   ScoreBreakdown `json:"scorePreview"`
}

type ScoreBreakdown struct {
	FloorPoints       int `json:"floorPoints"`
	ExplorationPoints int `json:"explorationPoints"`
	MonsterPoints     int `json:"monsterPoints"`
	StardustPoints    int `json:"stardustPoints"`
	LifePoints        int `json:"lifePoints"`
	RelicPoints       int `json:"relicPoints"`
	ChestPoints       int `json:"chestPoints"`
	WinBonus          int `json:"winBonus"`
	Total             int `json:"total"`
}

type Session struct {
	ID          string    `json:"id"`
	UserID      int64     `json:"userId"`
	GameType    string    `json:"gameType"`
	Seed        string    `json:"seed"`
	StartedAt   int64     `json:"startedAt"`
	ExpiresAt   int64     `json:"expiresAt"`
	Status      string    `json:"status"`
	State       GameState `json:"state"`
	Actions     []Action  `json:"actions"`
	ActionCount int       `json:"actionCount,omitempty"`
	MoveCount   int       `json:"moveCount,omitempty"`
}

type Record struct {
	ID               string         `json:"id"`
	UserID           int64          `json:"userId"`
	SessionID        string         `json:"sessionId"`
	GameType         string         `json:"gameType"`
	Pending          bool           `json:"pending,omitempty"`
	Finished         bool           `json:"finished,omitempty"`
	Won              bool           `json:"won"`
	FinalFloor       int            `json:"finalFloor"`
	FloorsCleared    int            `json:"floorsCleared"`
	Score            int64          `json:"score"`
	PointsEarned     int64          `json:"pointsEarned"`
	Stardust         int            `json:"stardust"`
	HPRemaining      int            `json:"hpRemaining"`
	Relics           int            `json:"relics"`
	MonstersDefeated int            `json:"monstersDefeated"`
	ChestsOpened     int            `json:"chestsOpened"`
	StepsUsed        int            `json:"stepsUsed"`
	Duration         int64          `json:"duration"`
	ScoreBreakdown   ScoreBreakdown `json:"scoreBreakdown"`
	CreatedAt        int64          `json:"createdAt"`
}

type DailyStats struct {
	UserID       int64  `json:"userId,omitempty"`
	Date         string `json:"date,omitempty"`
	GamesPlayed  int64  `json:"gamesPlayed"`
	TotalScore   int64  `json:"totalScore,omitempty"`
	PointsEarned int64  `json:"pointsEarned"`
	LastGameAt   int64  `json:"lastGameAt,omitempty"`
}

type SessionView struct {
	SessionID    string    `json:"sessionId"`
	StartedAt    int64     `json:"startedAt"`
	ExpiresAt    int64     `json:"expiresAt"`
	ActionsCount int       `json:"actionsCount"`
	State        StateView `json:"state"`
}

type StatusData struct {
	Balance            int64        `json:"balance"`
	DailyStats         DailyStats   `json:"dailyStats"`
	InCooldown         bool         `json:"inCooldown"`
	CooldownRemaining  int64        `json:"cooldownRemaining"`
	DailyLimit         int64        `json:"dailyLimit"`
	PointsLimitReached bool         `json:"pointsLimitReached"`
	Records            []Record     `json:"records"`
	ActiveSession      *SessionView `json:"activeSession"`
}

type StartResult struct {
	Success bool
	Message string
	Session *Session
}

type StepInput struct {
	SessionID string `json:"sessionId"`
	Action    Action `json:"action"`
}

type StepResult struct {
	Success bool
	Message string
	Session *SessionView
	Outcome *ActionOutcome
}

type SubmitInput struct {
	SessionID string `json:"sessionId"`
}

type SubmitResult struct {
	Success      bool
	Message      string
	Record       *Record
	PointsEarned int64
}

type SimpleResult struct {
	Success bool
	Message string
}
