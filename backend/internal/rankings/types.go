package rankings

type Period string

const (
	PeriodDaily   Period = "daily"
	PeriodWeekly  Period = "weekly"
	PeriodMonthly Period = "monthly"
)

type PointsPeriod string

const (
	PointsPeriodAll     PointsPeriod = "all"
	PointsPeriodMonthly PointsPeriod = "monthly"
)

type CheckinPeriod string

const (
	CheckinPeriodAll     CheckinPeriod = "all"
	CheckinPeriodMonthly CheckinPeriod = "monthly"
)

type PublicAchievement struct {
	ID        string `json:"id"`
	Emoji     string `json:"emoji"`
	Name      string `json:"name"`
	Desc      string `json:"desc"`
	ExpiresAt *int64 `json:"expiresAt,omitempty"`
}

type UserEntry struct {
	Rank                int64              `json:"rank"`
	UserID              int64              `json:"userId"`
	Username            string             `json:"username"`
	DisplayName         *string            `json:"displayName"`
	AvatarURL           *string            `json:"avatarUrl"`
	EquippedAchievement *PublicAchievement `json:"equippedAchievement"`
}

type PointsEntry struct {
	UserEntry
	Points int64 `json:"points"`
}

type PointsResult struct {
	Period      PointsPeriod  `json:"period"`
	GeneratedAt int64         `json:"generatedAt"`
	Leaderboard []PointsEntry `json:"leaderboard"`
}

type MonthlyPeakHistoryItem struct {
	MonthKey    string        `json:"monthKey"`
	MonthLabel  string        `json:"monthLabel"`
	StartAt     int64         `json:"startAt"`
	EndAt       int64         `json:"endAt"`
	Leaderboard []PointsEntry `json:"leaderboard"`
}

type MonthlyPeakHistoryResult struct {
	GeneratedAt int64                    `json:"generatedAt"`
	Months      []MonthlyPeakHistoryItem `json:"months"`
	TopLimit    int64                    `json:"topLimit"`
}

type CheckinEntry struct {
	UserEntry
	Streak int64 `json:"streak"`
}

type CheckinResult struct {
	Period      CheckinPeriod  `json:"period"`
	GeneratedAt int64          `json:"generatedAt"`
	Leaderboard []CheckinEntry `json:"leaderboard"`
}

type GameEntry struct {
	UserEntry
	GameType        string `json:"gameType"`
	TotalScore      int64  `json:"totalScore"`
	TotalPoints     int64  `json:"totalPoints"`
	BestScore       int64  `json:"bestScore"`
	BestPerformance int64  `json:"bestPerformance,omitempty"`
	GamesPlayed     int64  `json:"gamesPlayed"`
}

type GameDifficultyOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

type GameResult struct {
	GameType                 string                 `json:"gameType"`
	Leaderboard              []GameEntry            `json:"leaderboard"`
	SelectedDifficulty       *string                `json:"selectedDifficulty,omitempty"`
	DifficultyOptions        []GameDifficultyOption `json:"difficultyOptions,omitempty"`
	LeaderboardsByDifficulty map[string][]GameEntry `json:"leaderboardsByDifficulty,omitempty"`
}

type OverallEntry struct {
	UserEntry
	TotalScore    int64                               `json:"totalScore"`
	TotalPoints   int64                               `json:"totalPoints"`
	GamesPlayed   int64                               `json:"gamesPlayed"`
	GameBreakdown map[string]OverallGameBreakdownItem `json:"gameBreakdown"`
}

type OverallGameBreakdownItem struct {
	Score  int64 `json:"score"`
	Points int64 `json:"points"`
	Games  int64 `json:"games"`
}

type AllGamesResult struct {
	Period      Period         `json:"period"`
	GeneratedAt int64          `json:"generatedAt"`
	StartAt     int64          `json:"startAt"`
	Games       []GameResult   `json:"games"`
	Overall     []OverallEntry `json:"overall"`
}

type SettlementPeriod string

const (
	SettlementPeriodWeekly  SettlementPeriod = "weekly"
	SettlementPeriodMonthly SettlementPeriod = "monthly"
)

type SettlementPagination struct {
	Page       int64 `json:"page"`
	Limit      int64 `json:"limit"`
	Total      int64 `json:"total"`
	TotalPages int64 `json:"totalPages"`
	HasMore    bool  `json:"hasMore"`
}

type SettlementRecord struct {
	ID                string           `json:"id"`
	Period            SettlementPeriod `json:"period"`
	PeriodStart       int64            `json:"periodStart"`
	PeriodEnd         int64            `json:"periodEnd"`
	PeriodLabel       string           `json:"periodLabel"`
	Status            string           `json:"status"`
	RewardPolicy      map[string]any   `json:"rewardPolicy"`
	TotalParticipants int64            `json:"totalParticipants"`
	Rewards           []any            `json:"rewards"`
	Summary           map[string]any   `json:"summary"`
	CreatedAt         int64            `json:"createdAt"`
	SettledAt         int64            `json:"settledAt"`
	RetryCount        int64            `json:"retryCount"`
	TriggeredBy       map[string]any   `json:"triggeredBy"`
}

type SettlementHistoryResult struct {
	Period     SettlementPeriod     `json:"period"`
	Pagination SettlementPagination `json:"pagination"`
	Items      []SettlementRecord   `json:"items"`
}

type RewardPolicy struct {
	TopN         int64   `json:"topN"`
	RewardPoints []int64 `json:"rewardPoints"`
}

type SettlementReward struct {
	Rank         int64  `json:"rank"`
	UserID       int64  `json:"userId"`
	Username     string `json:"username"`
	TotalScore   int64  `json:"totalScore"`
	TotalPoints  int64  `json:"totalPoints"`
	GamesPlayed  int64  `json:"gamesPlayed"`
	RewardPoints int64  `json:"rewardPoints"`
	Status       string `json:"status"`
	Reason       string `json:"reason,omitempty"`
	Balance      *int64 `json:"balance,omitempty"`
	ProcessedAt  int64  `json:"processedAt"`
}

type SettlementSummary struct {
	Granted           int64 `json:"granted"`
	Skipped           int64 `json:"skipped"`
	Failed            int64 `json:"failed"`
	TotalRewardPoints int64 `json:"totalRewardPoints"`
}

type SettlementOperator struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
}

type SettleInput struct {
	Period           SettlementPeriod
	OperatorID       int64
	OperatorUsername string
	TopN             int64
	RewardPoints     []int64
	DryRun           bool
	RetryFailed      bool
}

type SettleResult struct {
	AlreadySettled bool             `json:"alreadySettled"`
	Retried        bool             `json:"retried"`
	Record         SettlementRecord `json:"record"`
}
