package luckytd

const (
	GameType        = "lucky_td"
	LuckyTdWinScore = int64(600)
	LuckyTdWinWaves = 30
)

type Session struct {
	ID                  string       `json:"id"`
	UserID              int64        `json:"userId"`
	GameType            string       `json:"gameType"`
	Seed                string       `json:"seed"`
	MapID               string       `json:"mapId"`
	Squad               []string     `json:"squad"`
	ConfigVersion       int          `json:"configVersion"`
	StartedAt           int64        `json:"startedAt"`
	ExpiresAt           int64        `json:"expiresAt"`
	Status              string       `json:"status"`
	Actions             []GameAction `json:"actions"`
	ActionCount         int          `json:"actionCount"`
	LastCheckpointWave  int          `json:"lastCheckpointWave"`
	LastCheckpointFrame int          `json:"lastCheckpointFrame"`
	Checkpoints         []Checkpoint `json:"checkpoints"`
}

type Checkpoint struct {
	WaveIndex        int    `json:"waveIndex"`
	Frame            int    `json:"frame"`
	StateHash        uint32 `json:"stateHash"`
	ServerReceivedAt int64  `json:"serverReceivedAt"`
}

type SessionView struct {
	SessionID string       `json:"sessionId"`
	Seed      string       `json:"seed"`
	MapID     string       `json:"mapId"`
	Squad     []string     `json:"squad"`
	Actions   []GameAction `json:"actions"`
	Frame     int          `json:"frame"`
	ExpiresAt int64        `json:"expiresAt"`
}

type Record struct {
	ID                  string         `json:"id"`
	UserID              int64          `json:"userId,omitempty"`
	SessionID           string         `json:"sessionId,omitempty"`
	GameType            string         `json:"gameType,omitempty"`
	MapID               string         `json:"mapId"`
	Status              int            `json:"status"`
	Won                 bool           `json:"won"`
	WavesCleared        int            `json:"wavesCleared"`
	Score               int64          `json:"score"`
	BasePoints          int64          `json:"basePoints,omitempty"`
	RewardPoints        int64          `json:"rewardPoints,omitempty"`
	SquadSize           int            `json:"squadSize,omitempty"`
	SquadBonusPermyriad int            `json:"squadBonusPermyriad,omitempty"`
	PointsEarned        int64          `json:"pointsEarned"`
	DurationMs          int64          `json:"durationMs"`
	FinalFrame          int            `json:"finalFrame"`
	ClaimedScore        int            `json:"claimedScore,omitempty"`
	Breakdown           ScoreBreakdown `json:"breakdown"`
	Pending             bool           `json:"pending,omitempty"`
	ReplayHash          uint32         `json:"replayHash,omitempty"`
	CreatedAt           int64          `json:"createdAt"`
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

type StartInput struct {
	MapID string   `json:"mapId"`
	Squad []string `json:"squad"`
}

type CheckpointInput struct {
	SessionID    string       `json:"sessionId"`
	WaveIndex    int          `json:"waveIndex"`
	Frame        int          `json:"frame"`
	StateHash    uint32       `json:"stateHash"`
	ActionsDelta []GameAction `json:"actionsDelta"`
}

type SubmitInput struct {
	SessionID    string       `json:"sessionId"`
	FinalFrame   int          `json:"finalFrame"`
	ClaimedScore int          `json:"claimedScore"`
	ActionsDelta []GameAction `json:"actionsDelta"`
}

type CancelInput struct {
	SessionID string `json:"sessionId"`
}

type StartResult struct {
	Success bool
	Message string
	Session *Session
}

type CheckpointResult struct {
	Success   bool
	Message   string
	ExpiresAt int64
}

type SubmitData struct {
	Score               int64       `json:"score"`
	BasePoints          int64       `json:"basePoints"`
	RewardPoints        int64       `json:"rewardPoints"`
	SquadSize           int         `json:"squadSize"`
	SquadBonusPermyriad int         `json:"squadBonusPermyriad"`
	PointsEarned        int64       `json:"pointsEarned"`
	WavesCleared        int         `json:"wavesCleared"`
	Status              int         `json:"status"`
	Won                 bool        `json:"won"`
	DailyStats          *DailyStats `json:"dailyStats"`
	PointsLimitReached  bool        `json:"pointsLimitReached"`
}

type SubmitResult struct {
	Success bool
	Message string
	Data    *SubmitData
	Record  *Record
}

type SimpleResult struct {
	Success bool
	Message string
}
