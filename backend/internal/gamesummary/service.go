package gamesummary

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"redemption/backend/internal/auth"
	"redemption/backend/internal/systemconfig"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrUnavailable = errors.New("game summary database unavailable")

const (
	recordFetchLimit = 50
	game2048WinScore = int64(20000)
	luckyTdWinScore  = int64(600)
	luckyTdWinWaves  = int64(30)
)

var supportedGames = []string{
	"roguelite",
	"minesweeper",
	"whack_mole",
	"memory",
	"match3",
	"linkgame",
	"game_2048",
	"lucky_td",
	"piano_tiles",
}

type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

func (service *Service) GetOverview(ctx context.Context, user auth.User) (OverviewData, error) {
	if service.db == nil {
		return OverviewData{}, ErrUnavailable
	}
	balance, err := service.getBalance(ctx, user.ID)
	if err != nil {
		return OverviewData{}, err
	}
	stats, err := service.getDailyStats(ctx, user.ID)
	if err != nil {
		return OverviewData{}, err
	}
	dailyLimit, err := systemconfig.DailyPointsLimit(ctx, service.db)
	if err != nil {
		return OverviewData{}, err
	}
	return OverviewData{
		Balance:            balance,
		DailyStats:         stats,
		DailyLimit:         dailyLimit,
		PointsLimitReached: false,
	}, nil
}

func (service *Service) GetProfile(ctx context.Context, user auth.User) (ProfileData, error) {
	if service.db == nil {
		return ProfileData{}, ErrUnavailable
	}
	overview, err := service.GetOverview(ctx, user)
	if err != nil {
		return ProfileData{}, err
	}
	rows, err := service.listRecentGameRows(ctx, user.ID)
	if err != nil {
		return ProfileData{}, err
	}

	perGame := make(map[string]GameProgress, len(supportedGames))
	for _, gameType := range supportedGames {
		perGame[toAPIKey(gameType)] = GameProgress{HasWinFlag: true}
	}

	var peakScore int64
	var peakGame *string
	var mostPlays int64
	var favoriteGame *string
	var mostWinsCount int64
	var mostWinsGame *string
	var bestStreak int64
	var bestStreakGame *string
	var totalPlays int64
	var weightedPlaysForWin int64
	var weightedWins int64

	for _, gameType := range supportedGames {
		apiKey := toAPIKey(gameType)
		progress := summarizeGameRows(rows[gameType], gameType)
		perGame[apiKey] = progress

		totalPlays += progress.TotalPlays
		if progress.BestScore > peakScore {
			peakScore = progress.BestScore
			peakGame = stringPtr(apiKey)
		}
		if progress.TotalPlays > mostPlays {
			mostPlays = progress.TotalPlays
			favoriteGame = stringPtr(apiKey)
		}
		if progress.HasWinFlag {
			weightedPlaysForWin += progress.TotalPlays
			weightedWins += progress.Wins
			if progress.Wins > mostWinsCount {
				mostWinsCount = progress.Wins
				mostWinsGame = stringPtr(apiKey)
			}
			if progress.BestWinStreak > bestStreak {
				bestStreak = progress.BestWinStreak
				bestStreakGame = stringPtr(apiKey)
			}
		}
	}

	winRate := 0.0
	if weightedPlaysForWin > 0 {
		winRate = float64(weightedWins) / float64(weightedPlaysForWin)
	}

	return ProfileData{
		Balance:          overview.Balance,
		DailyStats:       overview.DailyStats,
		TotalGamesPlayed: totalPlays,
		PeakScore:        peakScore,
		PeakGame:         peakGame,
		FavoriteGame:     favoriteGame,
		MostWinsGame:     mostWinsGame,
		MostWinsCount:    mostWinsCount,
		BestStreakGame:   bestStreakGame,
		BestStreak:       bestStreak,
		WinRate:          winRate,
		PerGame:          perGame,
	}, nil
}

func (service *Service) getBalance(ctx context.Context, userID int64) (int64, error) {
	var balance int64
	err := service.db.QueryRow(ctx, `SELECT COALESCE(balance, 0) FROM point_accounts WHERE user_id = $1`, userID).Scan(&balance)
	if isNoRows(err) {
		return 0, nil
	}
	return balance, err
}

func (service *Service) getDailyStats(ctx context.Context, userID int64) (DailyStats, error) {
	var stats DailyStats
	err := service.db.QueryRow(ctx,
		`SELECT COALESCE(games_played, 0), COALESCE(points_earned, 0)
		   FROM game_daily_stats
		  WHERE user_id = $1 AND stat_date = $2`,
		userID,
		todayChina(),
	).Scan(&stats.GamesPlayed, &stats.PointsEarned)
	if isNoRows(err) {
		return DailyStats{}, nil
	}
	return stats, err
}

type gameRecordRow struct {
	GameType     string
	Difficulty   string
	Score        int64
	PointsEarned int64
	Payload      []byte
}

func (service *Service) listRecentGameRows(ctx context.Context, userID int64) (map[string][]gameRecordRow, error) {
	rows, err := service.db.Query(ctx,
		`WITH recent AS (
		   SELECT game_type, COALESCE(difficulty, '') AS difficulty, score, points_earned, payload,
		          ROW_NUMBER() OVER (PARTITION BY game_type ORDER BY created_at DESC, id DESC) AS rn
		     FROM game_records
		    WHERE user_id = $1
		      AND game_type IN ('roguelite', 'minesweeper', 'whack_mole', 'memory', 'match3', 'linkgame', 'game_2048', 'lucky_td', 'piano_tiles')
		      AND COALESCE((payload->>'pending')::boolean, false) = false
		 )
		 SELECT game_type, difficulty, score, points_earned, payload
		   FROM recent
		  WHERE rn <= $2
		  ORDER BY game_type, rn`,
		userID,
		recordFetchLimit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := map[string][]gameRecordRow{}
	for rows.Next() {
		var row gameRecordRow
		if err := rows.Scan(&row.GameType, &row.Difficulty, &row.Score, &row.PointsEarned, &row.Payload); err != nil {
			return nil, err
		}
		result[row.GameType] = append(result[row.GameType], row)
	}
	return result, rows.Err()
}

func summarizeGameRows(rows []gameRecordRow, gameType string) GameProgress {
	progress := GameProgress{HasWinFlag: true}
	var currentStreak int64
	for _, row := range rows {
		progress.TotalPlays++
		progress.TotalPointsEarned += row.PointsEarned
		if row.Score > progress.BestScore {
			progress.BestScore = row.Score
		}
		if rowWon(row, gameType) {
			progress.Wins++
			currentStreak++
			if currentStreak > progress.BestWinStreak {
				progress.BestWinStreak = currentStreak
			}
		} else {
			currentStreak = 0
		}
	}
	return progress
}

func rowWon(row gameRecordRow, gameType string) bool {
	var data map[string]any
	_ = json.Unmarshal(row.Payload, &data)
	switch gameType {
	case "memory", "linkgame":
		return boolField(data, "completed")
	case "minesweeper", "roguelite":
		return boolField(data, "won")
	case "game_2048":
		return row.Score >= game2048WinScore
	case "lucky_td":
		if won, ok := data["won"].(bool); ok {
			return won
		}
		return numericField(data, "status") == 1 &&
			numericField(data, "wavesCleared") >= luckyTdWinWaves &&
			row.Score >= luckyTdWinScore
	case "piano_tiles":
		mode, _ := data["mode"].(string)
		if mode == "" {
			mode = row.Difficulty
		}
		if mode == "rush" {
			// 限时冲刺必须完整跑满 60 秒，并且至少完成一次有效命中。
			// 服务端结算时会重放事件，因此这里只消费已验证的结果字段。
			return stringField(data, "status") == "timeup" &&
				numericField(data, "playedMs") >= 60000 &&
				row.Score > 0
		}
		return mode == "classic" && numericField(data, "crowns") >= 1
	case "match3":
		return row.Score >= 1200
	case "whack_mole":
		return row.Score >= whackMoleWinScore(row.Difficulty)
	default:
		return false
	}
}

func boolField(data map[string]any, key string) bool {
	value, ok := data[key].(bool)
	return ok && value
}

func whackMoleWinScore(difficulty string) int64 {
	switch difficulty {
	case "easy":
		return 800
	case "hard":
		return 1500
	default:
		return 1200
	}
}

func toAPIKey(gameType string) string {
	if gameType == "whack_mole" {
		return "whack-mole"
	}
	if gameType == "game_2048" {
		return "2048"
	}
	if gameType == "lucky_td" {
		return "lucky-td"
	}
	if gameType == "piano_tiles" {
		return "piano-tiles"
	}
	return gameType
}

func numericField(data map[string]any, key string) int64 {
	switch value := data[key].(type) {
	case float64:
		return int64(value)
	case int64:
		return value
	default:
		return 0
	}
}

func stringField(data map[string]any, key string) string {
	value, _ := data[key].(string)
	return value
}

func stringPtr(value string) *string {
	return &value
}

func todayChina() string {
	return time.Now().UTC().Add(8 * time.Hour).Format("2006-01-02")
}

func isNoRows(err error) bool {
	return errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows)
}
