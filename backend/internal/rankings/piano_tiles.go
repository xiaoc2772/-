package rankings

import (
	"context"
	"database/sql"
	"sort"
	"strconv"
	"strings"
	"time"

	"redemption/backend/internal/pianotiles"
)

type pianoRankingRecord struct {
	UserID    int64
	Score     int64
	Points    int64
	ChartID   string
	Mode      pianotiles.Mode
	CreatedAt time.Time
}

type pianoBoardKey struct {
	Mode  pianotiles.Mode
	Stars int
}

type pianoUserAggregate struct {
	UserID          int64
	TotalScore      int64
	TotalPoints     int64
	BestScore       int64
	BestPerformance int64
	GamesPlayed     int64
	bestCreatedAt   time.Time
	hasBest         bool
}

type pianoOverallAggregate struct {
	UserID           int64
	TotalPerformance int64
	TotalPoints      int64
	BestPerformance  int64
	GamesPlayed      int64
}

type pianoChartLookup func(string) (pianotiles.ChartSummary, bool)

func (service *Service) pianoTilesResults(
	ctx context.Context,
	startAt time.Time,
	endAt time.Time,
	limit int64,
) (GameResult, []GameEntry, error) {
	records, err := service.loadPianoTilesRankingRecords(ctx, startAt, endAt)
	if err != nil {
		return GameResult{}, nil, err
	}
	users, err := service.loadUsers(ctx, service.now().UnixMilli())
	if err != nil {
		return GameResult{}, nil, err
	}
	usersByID := make(map[int64]UserEntry, len(users))
	for _, user := range users {
		usersByID[user.UserID] = user
	}

	boards := buildPianoTilesLeaderboards(records, usersByID, limit, pianotiles.ChartSummaryFor)
	overall := buildPianoTilesOverallRows(records, usersByID, 10000, pianotiles.ChartSummaryFor)
	selected := string(pianotiles.ModeClassic)
	return GameResult{
		GameType:                 "piano-tiles",
		Leaderboard:              boards[selected],
		SelectedDifficulty:       &selected,
		DifficultyOptions:        pianoTilesDifficultyOptions(),
		LeaderboardsByDifficulty: boards,
	}, overall, nil
}

func (service *Service) loadPianoTilesRankingRecords(
	ctx context.Context,
	startAt time.Time,
	endAt time.Time,
) ([]pianoRankingRecord, error) {
	rows, err := service.db.Query(ctx,
		`SELECT user_id, score, points_earned,
		        COALESCE(NULLIF(payload->>'chartId', ''), NULLIF(payload->>'chartID', ''), NULLIF(payload->>'chart_id', '')),
		        COALESCE(NULLIF(payload->>'mode', ''), NULLIF(difficulty, '')),
		        created_at
		   FROM game_records
		  WHERE game_type = $1
		    AND created_at >= $2
		    AND created_at < $3
		    AND COALESCE(payload->>'pending', 'false') <> 'true'`,
		pianotiles.GameType,
		startAt,
		endAt,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	records := make([]pianoRankingRecord, 0)
	for rows.Next() {
		var record pianoRankingRecord
		var chartID sql.NullString
		var mode sql.NullString
		if err := rows.Scan(
			&record.UserID,
			&record.Score,
			&record.Points,
			&chartID,
			&mode,
			&record.CreatedAt,
		); err != nil {
			return nil, err
		}
		record.ChartID = strings.TrimSpace(chartID.String)
		record.Mode = pianotiles.Mode(strings.TrimSpace(mode.String))
		records = append(records, record)
	}
	return records, rows.Err()
}

func buildPianoTilesOverallRows(
	records []pianoRankingRecord,
	usersByID map[int64]UserEntry,
	limit int64,
	lookup pianoChartLookup,
) []GameEntry {
	aggregates := make(map[int64]*pianoOverallAggregate)
	for _, record := range records {
		if !pianotiles.IsMode(record.Mode) || record.ChartID == "" {
			continue
		}
		chart, ok := lookup(record.ChartID)
		if !ok {
			continue
		}
		performance := pianotiles.NormalizedPerformance(chart, record.Mode, record.Score)
		aggregate := aggregates[record.UserID]
		if aggregate == nil {
			aggregate = &pianoOverallAggregate{UserID: record.UserID}
			aggregates[record.UserID] = aggregate
		}
		aggregate.TotalPerformance += performance
		aggregate.TotalPoints += record.Points
		aggregate.GamesPlayed++
		if performance > aggregate.BestPerformance {
			aggregate.BestPerformance = performance
		}
	}

	entries := make([]GameEntry, 0, len(aggregates))
	for userID, aggregate := range aggregates {
		user, ok := usersByID[userID]
		if !ok {
			continue
		}
		entries = append(entries, GameEntry{
			UserEntry:       user,
			GameType:        "piano-tiles",
			TotalScore:      aggregate.TotalPerformance,
			TotalPoints:     aggregate.TotalPoints,
			BestScore:       aggregate.BestPerformance,
			BestPerformance: aggregate.BestPerformance,
			GamesPlayed:     aggregate.GamesPlayed,
		})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].TotalScore != entries[j].TotalScore {
			return entries[i].TotalScore > entries[j].TotalScore
		}
		if entries[i].TotalPoints != entries[j].TotalPoints {
			return entries[i].TotalPoints > entries[j].TotalPoints
		}
		if entries[i].GamesPlayed != entries[j].GamesPlayed {
			return entries[i].GamesPlayed < entries[j].GamesPlayed
		}
		return entries[i].UserID < entries[j].UserID
	})
	if int64(len(entries)) > limit {
		entries = entries[:limit]
	}
	for index := range entries {
		entries[index].Rank = int64(index + 1)
	}
	return entries
}

func buildPianoTilesLeaderboards(
	records []pianoRankingRecord,
	usersByID map[int64]UserEntry,
	limit int64,
	lookup pianoChartLookup,
) map[string][]GameEntry {
	aggregates := make(map[pianoBoardKey]map[int64]*pianoUserAggregate)
	for _, record := range records {
		if !pianotiles.IsMode(record.Mode) || record.ChartID == "" {
			continue
		}
		chart, ok := lookup(record.ChartID)
		if !ok {
			// 无谱面 ID 的更早期记录无法可靠判断难度或换算分数，不能混入公平榜。
			continue
		}
		stars := pianotiles.DifficultyStars(chart)
		performance := pianotiles.NormalizedPerformance(chart, record.Mode, record.Score)
		for _, key := range []pianoBoardKey{
			{Mode: record.Mode},
			{Mode: record.Mode, Stars: stars},
		} {
			byUser := aggregates[key]
			if byUser == nil {
				byUser = make(map[int64]*pianoUserAggregate)
				aggregates[key] = byUser
			}
			aggregate := byUser[record.UserID]
			if aggregate == nil {
				aggregate = &pianoUserAggregate{UserID: record.UserID}
				byUser[record.UserID] = aggregate
			}
			aggregate.TotalScore += record.Score
			aggregate.TotalPoints += record.Points
			aggregate.GamesPlayed++
			if record.Score > aggregate.BestScore {
				aggregate.BestScore = record.Score
			}
			if !aggregate.hasBest ||
				performance > aggregate.BestPerformance ||
				(performance == aggregate.BestPerformance && record.CreatedAt.Before(aggregate.bestCreatedAt)) {
				aggregate.BestPerformance = performance
				aggregate.bestCreatedAt = record.CreatedAt
				aggregate.hasBest = true
			}
		}
	}

	boards := make(map[string][]GameEntry, len(pianoTilesDifficultyOptions()))
	for _, option := range pianoTilesDifficultyOptions() {
		key, ok := parsePianoBoardKey(option.Value)
		if !ok {
			boards[option.Value] = []GameEntry{}
			continue
		}
		byUser := aggregates[key]
		entries := make([]GameEntry, 0, len(byUser))
		for userID, aggregate := range byUser {
			user, exists := usersByID[userID]
			if !exists {
				continue
			}
			entries = append(entries, GameEntry{
				UserEntry:       user,
				GameType:        "piano-tiles",
				TotalScore:      aggregate.TotalScore,
				TotalPoints:     aggregate.TotalPoints,
				BestScore:       aggregate.BestScore,
				BestPerformance: aggregate.BestPerformance,
				GamesPlayed:     aggregate.GamesPlayed,
			})
		}
		sort.Slice(entries, func(i, j int) bool {
			if entries[i].BestPerformance != entries[j].BestPerformance {
				return entries[i].BestPerformance > entries[j].BestPerformance
			}
			if entries[i].TotalPoints != entries[j].TotalPoints {
				return entries[i].TotalPoints > entries[j].TotalPoints
			}
			if entries[i].GamesPlayed != entries[j].GamesPlayed {
				return entries[i].GamesPlayed < entries[j].GamesPlayed
			}
			return entries[i].UserID < entries[j].UserID
		})
		if int64(len(entries)) > limit {
			entries = entries[:limit]
		}
		for index := range entries {
			entries[index].Rank = int64(index + 1)
		}
		boards[option.Value] = entries
	}
	return boards
}

func parsePianoBoardKey(value string) (pianoBoardKey, bool) {
	parts := strings.Split(value, ":")
	mode := pianotiles.Mode(parts[0])
	if !pianotiles.IsMode(mode) || len(parts) > 2 {
		return pianoBoardKey{}, false
	}
	key := pianoBoardKey{Mode: mode}
	if len(parts) == 1 {
		return key, true
	}
	stars, err := strconv.Atoi(parts[1])
	if err != nil || stars < 1 || stars > 5 {
		return pianoBoardKey{}, false
	}
	key.Stars = stars
	return key, true
}
