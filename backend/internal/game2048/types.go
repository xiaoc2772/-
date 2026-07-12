package game2048

const (
	GameType = "game_2048"

	BoardSize     = 5
	WinTile       = 2048
	WinScore      = int64(20000)
	MaxMoves      = 8000
	RewardDivisor = int64(128)
	MaxTileValue  = 1073741824
)

type Direction string

const (
	DirectionUp    Direction = "up"
	DirectionDown  Direction = "down"
	DirectionLeft  Direction = "left"
	DirectionRight Direction = "right"
)

type Grid [][]int

type MoveResult struct {
	Grid       Grid
	ScoreDelta int64
	Moved      bool
}

type SimulationResult struct {
	OK             bool
	Message        string
	Grid           Grid
	Score          int64
	HighestTile    int
	MovesSubmitted int
	MovesApplied   int
	Won            bool
	GameOver       bool
}

type Session struct {
	ID                       string `json:"id"`
	UserID                   int64  `json:"userId"`
	GameType                 string `json:"gameType"`
	Seed                     string `json:"seed"`
	StartedAt                int64  `json:"startedAt"`
	ExpiresAt                int64  `json:"expiresAt"`
	Status                   string `json:"status"`
	CheckpointGrid           Grid   `json:"checkpointGrid,omitempty"`
	CheckpointScore          int64  `json:"checkpointScore,omitempty"`
	CheckpointMovesApplied   int    `json:"checkpointMovesApplied,omitempty"`
	CheckpointMovesSubmitted int    `json:"checkpointMovesSubmitted,omitempty"`
}

type SessionView struct {
	SessionID          string `json:"sessionId"`
	Seed               string `json:"seed"`
	StartedAt          int64  `json:"startedAt"`
	ExpiresAt          int64  `json:"expiresAt"`
	InitialGrid        Grid   `json:"initialGrid"`
	BaseScore          int64  `json:"baseScore"`
	BaseMoves          int    `json:"baseMoves"`
	BaseMovesSubmitted int    `json:"baseMovesSubmitted"`
}

type Record struct {
	ID             string `json:"id"`
	UserID         int64  `json:"userId"`
	SessionID      string `json:"sessionId"`
	GameType       string `json:"gameType"`
	Pending        bool   `json:"pending,omitempty"`
	Score          int64  `json:"score"`
	PointsEarned   int64  `json:"pointsEarned"`
	HighestTile    int    `json:"highestTile"`
	Moves          int    `json:"moves"`
	MovesSubmitted int    `json:"movesSubmitted"`
	Won            bool   `json:"won"`
	GameOver       bool   `json:"gameOver"`
	Grid           Grid   `json:"grid"`
	Duration       int64  `json:"duration"`
	CreatedAt      int64  `json:"createdAt"`
}

type DailyStats struct {
	UserID       int64  `json:"userId,omitempty"`
	Date         string `json:"date,omitempty"`
	GamesPlayed  int64  `json:"gamesPlayed"`
	TotalScore   int64  `json:"totalScore,omitempty"`
	PointsEarned int64  `json:"pointsEarned"`
	LastGameAt   int64  `json:"lastGameAt,omitempty"`
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

type SubmitInput struct {
	SessionID string      `json:"sessionId"`
	Moves     []Direction `json:"moves"`
}

type StartResult struct {
	Success bool
	Message string
	Session *Session
}

type CheckpointResult struct {
	Success bool
	Message string
	Session *Session
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
