package pianotiles

type Mode string
type Status string
type Judgement string

const (
	GameType = "piano_tiles"
	// Version 3 使用增量重放快照，不再把整局事件保存在会话 JSON 中。
	Version = 3

	ModeClassic Mode = "classic"
	ModeRush    Mode = "rush"

	StatusPlaying Status = "playing"
	StatusFailed  Status = "failed"
	StatusTimeUp  Status = "timeup"

	JudgementHit   Judgement = "h"
	JudgementMiss  Judgement = "m"
	JudgementWrong Judgement = "w"
	// JudgementRelease 是长按松手事件：客户端在长按结束（松手/划满/被顶替）时上报，
	// b 为按住进度对应的奖励分，服务端按与按下事件的墙钟间隔复核。
	JudgementRelease Judgement = "r"
)

// Event 是客户端上报的判定事件。T 为玩家点击开始块后的墙钟毫秒。
type Event struct {
	T         int64     `json:"t"`
	Lane      int       `json:"lane"`
	Judgement Judgement `json:"j"`
	// HoldBonus 仅松手事件（r）允许非零：0=进度<50%，1=进度>=50%，2=划满。
	HoldBonus int64 `json:"b,omitempty"`
}

// ReplayState 是服务端对已确认事件的有界摘要。
type ReplayState struct {
	EventCount       int64     `json:"eventCount"`
	Hits             int       `json:"hits"`
	VerifiedScore    int64     `json:"verifiedScore"`
	HoldHits         int       `json:"holdHits"`
	HasEvents        bool      `json:"hasEvents"`
	LastEventT       int64     `json:"lastEventT"`
	HasHits          bool      `json:"hasHits"`
	LastHitT         int64     `json:"lastHitT"`
	Terminal         Judgement `json:"terminal,omitempty"`
	RecentEventTimes []int64   `json:"recentEventTimes,omitempty"`
	// 进行中的长按（等待松手事件）：跨 checkpoint 持久化，供 r 事件复核奖励。
	HoldOpen       bool  `json:"holdOpen,omitempty"`
	HoldPressT     int64 `json:"holdPressT,omitempty"`
	HoldDurationMS int64 `json:"holdDurationMs,omitempty"`
	HoldLane       int   `json:"holdLane,omitempty"`
	HoldLap        int   `json:"holdLap,omitempty"`
}

// BatchReceipt 仅保存上一批 checkpoint 的摘要，用于响应丢失后的幂等重试。
type BatchReceipt struct {
	Offset int64  `json:"offset"`
	Count  int    `json:"count"`
	Hash   string `json:"hash"`
}

type Session struct {
	ID       string `json:"id"`
	UserID   int64  `json:"userId"`
	GameType string `json:"gameType"`
	Version  int    `json:"version"`
	// StartRequestID 是客户端一次“开局请求”的幂等标识。
	// 只有同一标识的重试才允许复用尚未产生事件的会话，避免两个标签页
	// 同时选择同一首歌时误把另一局当成网络重试。
	StartRequestID string        `json:"startRequestId,omitempty"`
	ChartID        string        `json:"chartId"`
	Checksum       string        `json:"checksum"`
	Mode           Mode          `json:"mode"`
	StartedAt      int64         `json:"startedAt"`
	ExpiresAt      int64         `json:"expiresAt"`
	Status         Status        `json:"status"`
	Replay         ReplayState   `json:"replay"`
	LastBatch      *BatchReceipt `json:"lastBatch,omitempty"`
}

type SessionView struct {
	SessionID string `json:"sessionId"`
	ChartID   string `json:"chartId"`
	Mode      Mode   `json:"mode"`
	StartedAt int64  `json:"startedAt"`
}

type Record struct {
	ID            string `json:"id"`
	UserID        int64  `json:"userId,omitempty"`
	SessionID     string `json:"sessionId"`
	GameType      string `json:"gameType,omitempty"`
	ChartID       string `json:"chartId"`
	Mode          Mode   `json:"mode"`
	Status        Status `json:"status"`
	Score         int64  `json:"score"`
	PointsAwarded int64  `json:"pointsAwarded"`
	TilesHit      int    `json:"tilesHit"`
	Crowns        int    `json:"crowns"`
	Laps          int    `json:"laps"`
	TotalNotes    int    `json:"totalNotes"`
	PlayedMs      int64  `json:"playedMs"`
	CreatedAt     int64  `json:"createdAt"`
}

type DailyStats struct {
	Plays  int64 `json:"plays"`
	Points int64 `json:"points"`
}
type StatusData struct {
	InCooldown          bool         `json:"inCooldown"`
	CooldownRemainingMs int64        `json:"cooldownRemainingMs"`
	PointsLimitReached  bool         `json:"pointsLimitReached"`
	DailyStats          DailyStats   `json:"dailyStats"`
	ActiveSession       *SessionView `json:"activeSession"`
}

// PersonalBest 是当前用户在指定歌曲和模式下的最佳单局成绩。
type PersonalBest struct {
	Score         int64  `json:"score"`
	PointsAwarded int64  `json:"pointsAwarded"`
	TilesHit      int    `json:"tilesHit"`
	Crowns        int    `json:"crowns"`
	Laps          int    `json:"laps"`
	PlayedMs      int64  `json:"playedMs"`
	Status        Status `json:"status"`
	CreatedAt     int64  `json:"createdAt"`
}

// PersonalSongBests 固定返回两个模式，未产生过成绩的模式为 null。
type PersonalSongBests struct {
	ChartID string        `json:"chartId"`
	Classic *PersonalBest `json:"classic"`
	Rush    *PersonalBest `json:"rush"`
}

type PersonalBestsData struct {
	Songs []PersonalSongBests `json:"songs"`
}

type StartInput struct {
	ChartID        string `json:"chartId"`
	Mode           Mode   `json:"mode"`
	Checksum       string `json:"checksum"`
	StartRequestID string `json:"startRequestId,omitempty"`
}
type StartResult struct {
	Success bool
	Message string
	Session *Session
}
type CheckpointInput struct {
	SessionID   string  `json:"sessionId"`
	Events      []Event `json:"events"`
	EventOffset *int64  `json:"eventOffset,omitempty"`
}
type CheckpointResult struct {
	Success        bool   `json:"success"`
	Message        string `json:"message,omitempty"`
	AcceptedEvents int    `json:"acceptedEvents"`
	EventCount     int64  `json:"eventCount"`
	ExpiresAt      int64  `json:"expiresAt"`
}

// ClientResult 中的 score 必须与服务端按事件 b 字段重放出的精确分数一致。
type ClientResult struct {
	Status   Status `json:"status"`
	Score    int64  `json:"score"`
	TilesHit int    `json:"tilesHit"`
	Crowns   int    `json:"crowns"`
	Laps     int    `json:"laps"`
	PlayedMs int64  `json:"playedMs"`
}

type SubmitInput struct {
	SessionID   string       `json:"sessionId"`
	Result      ClientResult `json:"result"`
	Events      []Event      `json:"events"`
	EventOffset *int64       `json:"eventOffset,omitempty"`
}
type SubmitResult struct {
	Success       bool
	Message       string
	Score         int64
	PointsAwarded int64
	Record        *Record
}
type CancelInput struct {
	SessionID string `json:"sessionId"`
}
type SimpleResult struct {
	Success bool
	Message string
}

type EngineResult struct {
	Mode       Mode   `json:"mode"`
	Status     Status `json:"status"`
	Score      int64  `json:"score"`
	TilesHit   int    `json:"tilesHit"`
	Crowns     int    `json:"crowns"`
	Laps       int    `json:"laps"`
	TotalNotes int    `json:"totalNotes"`
	PlayedMs   int64  `json:"playedMs"`
}
