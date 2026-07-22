package rankings

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrUnavailable = errors.New("rankings database unavailable")

const (
	chinaOffset    = 8 * time.Hour
	maxCheckinDays = 400
)

var excludedPositivePointSources = map[string]struct{}{
	"admin_adjust": {},
}

type Service struct {
	db  *pgxpool.Pool
	now func() time.Time
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db, now: time.Now}
}

func NewServiceWithNow(db *pgxpool.Pool, now func() time.Time) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{db: db, now: now}
}

func (service *Service) PointsLeaderboard(ctx context.Context, period string, limit int64) (PointsResult, error) {
	if service.db == nil {
		return PointsResult{}, ErrUnavailable
	}
	safePeriod := normalizePointsPeriod(period)
	safeLimit := clampLimit(limit, 20, 100)
	now := service.now()

	var rows []PointsEntry
	var err error
	if safePeriod == PointsPeriodMonthly {
		rows, err = service.monthlyPointsRows(ctx, monthStartUTC(now), now.Add(time.Millisecond).UnixMilli(), now.UnixMilli(), safeLimit)
	} else {
		rows, err = service.allPointsRows(ctx, now.UnixMilli(), safeLimit)
	}
	if err != nil {
		return PointsResult{}, err
	}
	return PointsResult{Period: safePeriod, GeneratedAt: now.UnixMilli(), Leaderboard: rows}, nil
}

func (service *Service) MonthlyPeakHistory(ctx context.Context, months int64, topLimit int64) (MonthlyPeakHistoryResult, error) {
	if service.db == nil {
		return MonthlyPeakHistoryResult{}, ErrUnavailable
	}
	safeMonths := clampLimitWithMin(months, 12, 1, 12)
	safeLimit := clampLimitWithMin(topLimit, 10, 1, 10)
	now := service.now()
	ranges := completedMonthRanges(now, safeMonths)
	items := make([]MonthlyPeakHistoryItem, 0, len(ranges))
	for _, currentRange := range ranges {
		rows, err := service.monthlyPointsRows(ctx, currentRange.startAt, currentRange.endAt, now.UnixMilli(), safeLimit)
		if err != nil {
			return MonthlyPeakHistoryResult{}, err
		}
		items = append(items, MonthlyPeakHistoryItem{
			MonthKey:    currentRange.monthKey,
			MonthLabel:  currentRange.monthLabel,
			StartAt:     currentRange.startAt,
			EndAt:       currentRange.endAt,
			Leaderboard: rows,
		})
	}
	return MonthlyPeakHistoryResult{
		GeneratedAt: now.UnixMilli(),
		Months:      items,
		TopLimit:    safeLimit,
	}, nil
}

func (service *Service) SettlementHistory(ctx context.Context, period string, page int64, limit int64) (SettlementHistoryResult, error) {
	if service.db == nil {
		return SettlementHistoryResult{}, ErrUnavailable
	}
	safePeriod := normalizeSettlementPeriod(period)
	safePage := maxInt64(1, page)
	safeLimit := clampLimitWithMin(limit, 20, 1, 50)
	offset := (safePage - 1) * safeLimit

	var total int64
	if err := service.db.QueryRow(ctx,
		`SELECT COUNT(*)::bigint FROM ranking_settlements WHERE period = $1`,
		safePeriod,
	).Scan(&total); err != nil {
		return SettlementHistoryResult{}, err
	}

	rows, err := service.db.Query(ctx,
		`SELECT id, period, period_start_ms, period_end_ms, period_label, status,
		        reward_policy, total_participants, rewards, summary,
		        created_at_ms, settled_at_ms, retry_count, triggered_by
		   FROM ranking_settlements
		  WHERE period = $1
		  ORDER BY period_end_ms DESC
		  LIMIT $2 OFFSET $3`,
		safePeriod,
		safeLimit,
		offset,
	)
	if err != nil {
		return SettlementHistoryResult{}, err
	}
	defer rows.Close()

	items := []SettlementRecord{}
	for rows.Next() {
		var record SettlementRecord
		var rewardPolicy []byte
		var rewards []byte
		var summary []byte
		var triggeredBy []byte
		if err := rows.Scan(
			&record.ID,
			&record.Period,
			&record.PeriodStart,
			&record.PeriodEnd,
			&record.PeriodLabel,
			&record.Status,
			&rewardPolicy,
			&record.TotalParticipants,
			&rewards,
			&summary,
			&record.CreatedAt,
			&record.SettledAt,
			&record.RetryCount,
			&triggeredBy,
		); err != nil {
			return SettlementHistoryResult{}, err
		}
		record.RewardPolicy = decodeJSONMap(rewardPolicy)
		record.Rewards = decodeJSONArray(rewards)
		record.Summary = decodeJSONMap(summary)
		record.TriggeredBy = decodeJSONMap(triggeredBy)
		items = append(items, record)
	}
	if err := rows.Err(); err != nil {
		return SettlementHistoryResult{}, err
	}

	totalPages := int64(1)
	if total > 0 {
		totalPages = (total + safeLimit - 1) / safeLimit
	}
	return SettlementHistoryResult{
		Period: safePeriod,
		Pagination: SettlementPagination{
			Page:       safePage,
			Limit:      safeLimit,
			Total:      total,
			TotalPages: totalPages,
			HasMore:    safePage < totalPages,
		},
		Items: items,
	}, nil
}

func (service *Service) CheckinStreakLeaderboard(ctx context.Context, period string, limit int64) (CheckinResult, error) {
	if service.db == nil {
		return CheckinResult{}, ErrUnavailable
	}
	safePeriod := normalizeCheckinPeriod(period)
	safeLimit := clampLimit(limit, 20, 100)
	now := service.now()
	chinaNow := now.UTC().Add(chinaOffset)
	startDate := chinaNow.AddDate(0, 0, -(maxCheckinDays - 1)).Format("2006-01-02")
	endDate := ""
	dayCount := maxCheckinDays
	if safePeriod == CheckinPeriodMonthly {
		monthStart := time.Date(chinaNow.Year(), chinaNow.Month(), 1, 0, 0, 0, 0, time.UTC)
		startDate = monthStart.Format("2006-01-02")
		endDate = chinaNow.Format("2006-01-02")
		dayCount = int(chinaDayStartUTC(now).Sub(monthStart.Add(-chinaOffset))/(24*time.Hour)) + 1
		if dayCount < 1 {
			dayCount = 1
		}
		if dayCount > 31 {
			dayCount = 31
		}
	}

	users, err := service.loadUsers(ctx, now.UnixMilli())
	if err != nil {
		return CheckinResult{}, err
	}
	entries, err := service.loadCheckinDates(ctx, startDate, endDate)
	if err != nil {
		return CheckinResult{}, err
	}
	rows := make([]CheckinEntry, 0, len(users))
	for _, user := range users {
		dateSet := entries[user.UserID]
		streak := computeStreak(dateSet, chinaNow, dayCount)
		rows = append(rows, CheckinEntry{UserEntry: user, Streak: streak})
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Streak != rows[j].Streak {
			return rows[i].Streak > rows[j].Streak
		}
		return rows[i].UserID < rows[j].UserID
	})
	if int64(len(rows)) > safeLimit {
		rows = rows[:safeLimit]
	}
	for index := range rows {
		rows[index].Rank = int64(index + 1)
	}
	return CheckinResult{Period: safePeriod, GeneratedAt: now.UnixMilli(), Leaderboard: rows}, nil
}

func (service *Service) AllGamesLeaderboard(ctx context.Context, period string, limit int64) (AllGamesResult, error) {
	if service.db == nil {
		return AllGamesResult{}, ErrUnavailable
	}
	safePeriod := normalizePeriod(period)
	safeLimit := clampLimit(limit, 20, 100)
	now := service.now()
	startAt := periodStartUTC(now, safePeriod)
	startTime := time.UnixMilli(startAt)
	endTime := now.Add(time.Second)

	games := make([]GameResult, 0, len(supportedGames))
	overallMap := map[int64]*OverallEntry{}
	for _, game := range supportedGames {
		var gameResult GameResult
		var err error
		if game.dbName == "piano_tiles" {
			// 钢琴块不能把不同歌曲的原始分数直接放在同一榜单；
			// 独立聚合会按谱面星级和标准表现生成模式×星级榜。
			gameResult, err = service.pianoTilesGameResult(ctx, startTime, endTime, safeLimit)
		} else {
			allRows, rowsErr := service.gameLeaderboardRows(ctx, game, startTime, endTime, safeLimit, "")
			if rowsErr != nil {
				return AllGamesResult{}, rowsErr
			}
			gameResult = GameResult{
				GameType:    game.apiName,
				Leaderboard: allRows,
			}
			options := difficultyOptions(game)
			if len(options) > 0 {
				selected := "all"
				gameResult.SelectedDifficulty = &selected
				gameResult.DifficultyOptions = append([]GameDifficultyOption{{Value: "all", Label: allDifficultyLabel(game)}}, options...)
				gameResult.LeaderboardsByDifficulty = map[string][]GameEntry{"all": allRows}
				for _, option := range options {
					difficultyRows, rowsErr := service.gameLeaderboardRows(ctx, game, startTime, endTime, safeLimit, option.Value)
					if rowsErr != nil {
						return AllGamesResult{}, rowsErr
					}
					gameResult.LeaderboardsByDifficulty[option.Value] = difficultyRows
				}
			}
		}
		if err != nil {
			return AllGamesResult{}, err
		}
		games = append(games, gameResult)

		breakdownRows, err := service.gameLeaderboardRows(ctx, game, startTime, endTime, 10000, "")
		if err != nil {
			return AllGamesResult{}, err
		}
		for _, row := range breakdownRows {
			current := overallMap[row.UserID]
			if current == nil {
				current = &OverallEntry{
					UserEntry: UserEntry{
						UserID:              row.UserID,
						Username:            row.Username,
						DisplayName:         row.DisplayName,
						AvatarURL:           row.AvatarURL,
						EquippedAchievement: row.EquippedAchievement,
					},
					GameBreakdown: map[string]OverallGameBreakdownItem{},
				}
				overallMap[row.UserID] = current
			}
			current.TotalScore += row.TotalScore
			current.TotalPoints += row.TotalPoints
			current.GamesPlayed += row.GamesPlayed
			current.GameBreakdown[game.apiName] = OverallGameBreakdownItem{
				Score:  row.TotalScore,
				Points: row.TotalPoints,
				Games:  row.GamesPlayed,
			}
		}
	}
	overall := make([]OverallEntry, 0, len(overallMap))
	for _, entry := range overallMap {
		overall = append(overall, *entry)
	}
	sort.Slice(overall, func(i, j int) bool {
		if overall[i].TotalScore != overall[j].TotalScore {
			return overall[i].TotalScore > overall[j].TotalScore
		}
		if overall[i].TotalPoints != overall[j].TotalPoints {
			return overall[i].TotalPoints > overall[j].TotalPoints
		}
		if overall[i].GamesPlayed != overall[j].GamesPlayed {
			return overall[i].GamesPlayed > overall[j].GamesPlayed
		}
		return overall[i].UserID < overall[j].UserID
	})
	if int64(len(overall)) > safeLimit {
		overall = overall[:safeLimit]
	}
	for index := range overall {
		overall[index].Rank = int64(index + 1)
	}
	return AllGamesResult{
		Period:      safePeriod,
		GeneratedAt: now.UnixMilli(),
		StartAt:     startAt,
		Games:       games,
		Overall:     overall,
	}, nil
}

func (service *Service) allPointsRows(ctx context.Context, nowMs int64, limit int64) ([]PointsEntry, error) {
	rows, err := service.db.Query(ctx,
		`SELECT u.id, u.username, u.display_name, p.display_name, p.avatar_url,
		        a.achievement_id, a.expires_at_ms, COALESCE(pa.balance, 0)
		   FROM users u
		   LEFT JOIN point_accounts pa ON pa.user_id = u.id
		   LEFT JOIN user_profiles p ON p.user_id = u.id
		   LEFT JOIN LATERAL (`+equippedAchievementSQL("$1")+`) a ON true
		  ORDER BY COALESCE(pa.balance, 0) DESC, u.id ASC
		  LIMIT $2`,
		nowMs,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPointsRows(rows)
}

func (service *Service) monthlyPointsRows(ctx context.Context, startAt int64, endAt int64, nowMs int64, limit int64) ([]PointsEntry, error) {
	rows, err := service.db.Query(ctx,
		`WITH monthly AS (
		   SELECT user_id, SUM(amount)::bigint AS points
		     FROM point_ledger
		    WHERE created_at >= $1
		      AND created_at < $2
		      AND amount > 0
		      AND source <> ALL($5::text[])
		    GROUP BY user_id
		 )
		 SELECT u.id, u.username, u.display_name, p.display_name, p.avatar_url,
		        a.achievement_id, a.expires_at_ms, COALESCE(m.points, 0)
		   FROM monthly m
		   JOIN users u ON u.id = m.user_id
		   LEFT JOIN user_profiles p ON p.user_id = u.id
		   LEFT JOIN LATERAL (`+equippedAchievementSQL("$3")+`) a ON true
		  WHERE COALESCE(m.points, 0) > 0
		  ORDER BY COALESCE(m.points, 0) DESC, u.id ASC
		  LIMIT $4`,
		time.UnixMilli(startAt),
		time.UnixMilli(endAt),
		nowMs,
		limit,
		[]string{keys(excludedPositivePointSources)[0]},
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPointsRows(rows)
}

func scanPointsRows(rows pgx.Rows) ([]PointsEntry, error) {
	leaderboard := []PointsEntry{}
	rank := int64(1)
	for rows.Next() {
		var user UserEntry
		var points int64
		if err := scanUserWithPoints(rows, &user, &points); err != nil {
			return nil, err
		}
		user.Rank = rank
		leaderboard = append(leaderboard, PointsEntry{UserEntry: user, Points: points})
		rank++
	}
	return leaderboard, rows.Err()
}

func (service *Service) loadUsers(ctx context.Context, nowMs int64) ([]UserEntry, error) {
	rows, err := service.db.Query(ctx,
		`SELECT u.id, u.username, u.display_name, p.display_name, p.avatar_url,
		        a.achievement_id, a.expires_at_ms
		   FROM users u
		   LEFT JOIN user_profiles p ON p.user_id = u.id
		   LEFT JOIN LATERAL (`+equippedAchievementSQL("$1")+`) a ON true
		  ORDER BY u.id ASC`,
		nowMs,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := []UserEntry{}
	for rows.Next() {
		var user UserEntry
		if err := scanUserBase(rows, &user); err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, rows.Err()
}

func (service *Service) loadCheckinDates(ctx context.Context, startDate string, endDate string) (map[int64]map[string]struct{}, error) {
	query := `SELECT user_id, checkin_date::text
	            FROM checkin_records
	           WHERE checkin_date >= $1`
	args := []any{startDate}
	if endDate != "" {
		query += ` AND checkin_date <= $2`
		args = append(args, endDate)
	}
	rows, err := service.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[int64]map[string]struct{}{}
	for rows.Next() {
		var userID int64
		var date string
		if err := rows.Scan(&userID, &date); err != nil {
			return nil, err
		}
		if result[userID] == nil {
			result[userID] = map[string]struct{}{}
		}
		result[userID][date] = struct{}{}
	}
	return result, rows.Err()
}

func (service *Service) gameLeaderboardRows(ctx context.Context, game gameDefinition, startAt time.Time, endAt time.Time, limit int64, difficulty string) ([]GameEntry, error) {
	whereDifficulty := ""
	nowMs := service.now().UnixMilli()
	args := []any{game.dbName, startAt, endAt, nowMs, limit}
	if difficulty != "" {
		whereDifficulty = " AND COALESCE(NULLIF(difficulty, ''), 'normal') = $6"
		args = append(args, difficulty)
	}
	rows, err := service.db.Query(ctx,
		`WITH grouped AS (
		   SELECT user_id,
		          SUM(score)::bigint AS total_score,
		          SUM(points_earned)::bigint AS total_points,
		          MAX(score)::bigint AS best_score,
		          COUNT(*)::bigint AS games_played
		     FROM game_records
		    WHERE game_type = $1
		      AND created_at >= $2
		      AND created_at < $3
		      AND COALESCE(payload->>'pending', 'false') <> 'true'`+whereDifficulty+`
		    GROUP BY user_id
		 )
		 SELECT u.id, u.username, u.display_name, p.display_name, p.avatar_url,
		        a.achievement_id, a.expires_at_ms,
		        g.total_score, g.total_points, g.best_score, g.games_played
		   FROM grouped g
		   JOIN users u ON u.id = g.user_id
		   LEFT JOIN user_profiles p ON p.user_id = u.id
		   LEFT JOIN LATERAL (`+equippedAchievementSQL("$4")+`) a ON true
		  ORDER BY g.best_score DESC, g.total_points DESC, g.games_played ASC, u.id ASC
		  LIMIT $5`,
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	leaderboard := []GameEntry{}
	rank := int64(1)
	for rows.Next() {
		var entry GameEntry
		if err := scanGameEntry(rows, &entry); err != nil {
			return nil, err
		}
		entry.Rank = rank
		entry.GameType = game.apiName
		leaderboard = append(leaderboard, entry)
		rank++
	}
	return leaderboard, rows.Err()
}

func scanUserWithPoints(rows pgx.Rows, user *UserEntry, points *int64) error {
	var raw rawUserEntry
	if err := rows.Scan(
		&raw.userID,
		&raw.username,
		&raw.baseDisplayName,
		&raw.profileDisplayName,
		&raw.avatarURL,
		&raw.achievementID,
		&raw.achievementExpiresAt,
		points,
	); err != nil {
		return err
	}
	*user = raw.toUserEntry()
	return nil
}

func scanUserBase(rows pgx.Rows, user *UserEntry) error {
	var raw rawUserEntry
	if err := rows.Scan(
		&raw.userID,
		&raw.username,
		&raw.baseDisplayName,
		&raw.profileDisplayName,
		&raw.avatarURL,
		&raw.achievementID,
		&raw.achievementExpiresAt,
	); err != nil {
		return err
	}
	*user = raw.toUserEntry()
	return nil
}

func scanGameEntry(rows pgx.Rows, entry *GameEntry) error {
	var raw rawUserEntry
	if err := rows.Scan(
		&raw.userID,
		&raw.username,
		&raw.baseDisplayName,
		&raw.profileDisplayName,
		&raw.avatarURL,
		&raw.achievementID,
		&raw.achievementExpiresAt,
		&entry.TotalScore,
		&entry.TotalPoints,
		&entry.BestScore,
		&entry.GamesPlayed,
	); err != nil {
		return err
	}
	entry.UserEntry = raw.toUserEntry()
	return nil
}

type rawUserEntry struct {
	userID               int64
	username             string
	baseDisplayName      string
	profileDisplayName   sql.NullString
	avatarURL            sql.NullString
	achievementID        sql.NullString
	achievementExpiresAt sql.NullInt64
}

func (raw rawUserEntry) toUserEntry() UserEntry {
	user := UserEntry{
		UserID:   raw.userID,
		Username: fallbackUsername(raw.userID, raw.username),
	}
	displayName := strings.TrimSpace(raw.profileDisplayName.String)
	if displayName == "" && strings.TrimSpace(raw.baseDisplayName) != "" && raw.baseDisplayName != user.Username {
		displayName = strings.TrimSpace(raw.baseDisplayName)
	}
	if displayName != "" {
		user.DisplayName = ptrString(displayName)
	}
	if raw.avatarURL.Valid && strings.TrimSpace(raw.avatarURL.String) != "" {
		user.AvatarURL = ptrString(strings.TrimSpace(raw.avatarURL.String))
	}
	if raw.achievementID.Valid {
		user.EquippedAchievement = publicAchievementByID(raw.achievementID.String, raw.achievementExpiresAt)
	}
	return user
}

func equippedAchievementSQL(nowParam string) string {
	return `SELECT candidate.achievement_id, grant_row.expires_at_ms
	          FROM (
	            SELECT f.achievement_id, 0 AS priority
	              FROM user_forced_achievements f
	             WHERE f.user_id = u.id AND f.until_ms > ` + nowParam + `
	            UNION ALL
	            SELECT e.achievement_id, 1 AS priority
	              FROM user_equipped_achievements e
	             WHERE e.user_id = u.id
	          ) candidate
	          JOIN user_achievement_grants grant_row
	            ON grant_row.user_id = u.id
	           AND grant_row.achievement_id = candidate.achievement_id
	           AND (grant_row.expires_at_ms IS NULL OR grant_row.expires_at_ms > ` + nowParam + `)
	         ORDER BY candidate.priority
	         LIMIT 1`
}

func computeStreak(dateSet map[string]struct{}, chinaNow time.Time, dayCount int) int64 {
	if dayCount <= 0 {
		return 0
	}
	startOffset := 0
	today := chinaNow.Format("2006-01-02")
	yesterday := chinaNow.AddDate(0, 0, -1).Format("2006-01-02")
	if _, ok := dateSet[today]; !ok {
		if _, ok := dateSet[yesterday]; !ok {
			return 0
		}
		startOffset = 1
	}
	var streak int64
	for offset := startOffset; offset < dayCount; offset++ {
		date := chinaNow.AddDate(0, 0, -offset).Format("2006-01-02")
		if _, ok := dateSet[date]; !ok {
			break
		}
		streak++
	}
	return streak
}

func periodStartUTC(now time.Time, period Period) int64 {
	chinaNow := now.UTC().Add(chinaOffset)
	switch period {
	case PeriodWeekly:
		start := time.Date(chinaNow.Year(), chinaNow.Month(), chinaNow.Day(), 0, 0, 0, 0, time.UTC)
		weekday := int(start.Weekday())
		diffToMonday := weekday - 1
		if weekday == 0 {
			diffToMonday = 6
		}
		return start.AddDate(0, 0, -diffToMonday).Add(-chinaOffset).UnixMilli()
	case PeriodMonthly:
		start := time.Date(chinaNow.Year(), chinaNow.Month(), 1, 0, 0, 0, 0, time.UTC)
		return start.Add(-chinaOffset).UnixMilli()
	default:
		return chinaDayStartUTC(now).UnixMilli()
	}
}

func chinaDayStartUTC(now time.Time) time.Time {
	chinaNow := now.UTC().Add(chinaOffset)
	start := time.Date(chinaNow.Year(), chinaNow.Month(), chinaNow.Day(), 0, 0, 0, 0, time.UTC)
	return start.Add(-chinaOffset)
}

func monthStartUTC(now time.Time) int64 {
	chinaNow := now.UTC().Add(chinaOffset)
	start := time.Date(chinaNow.Year(), chinaNow.Month(), 1, 0, 0, 0, 0, time.UTC)
	return start.Add(-chinaOffset).UnixMilli()
}

type monthRange struct {
	monthKey   string
	monthLabel string
	startAt    int64
	endAt      int64
}

func completedMonthRanges(now time.Time, count int64) []monthRange {
	chinaNow := now.UTC().Add(chinaOffset)
	currentMonthStart := time.Date(chinaNow.Year(), chinaNow.Month(), 1, 0, 0, 0, 0, time.UTC)
	ranges := make([]monthRange, 0, count)
	for index := int64(0); index < count; index++ {
		endChina := currentMonthStart.AddDate(0, -int(index), 0)
		startChina := currentMonthStart.AddDate(0, -int(index)-1, 0)
		ranges = append(ranges, monthRange{
			monthKey:   fmt.Sprintf("%04d-%02d", startChina.Year(), int(startChina.Month())),
			monthLabel: fmt.Sprintf("%d 年 %d 月", startChina.Year(), int(startChina.Month())),
			startAt:    startChina.Add(-chinaOffset).UnixMilli(),
			endAt:      endChina.Add(-chinaOffset).UnixMilli(),
		})
	}
	return ranges
}

func normalizePeriod(period string) Period {
	switch Period(strings.TrimSpace(period)) {
	case PeriodWeekly:
		return PeriodWeekly
	case PeriodMonthly:
		return PeriodMonthly
	default:
		return PeriodDaily
	}
}

func normalizePointsPeriod(period string) PointsPeriod {
	if strings.TrimSpace(period) == string(PointsPeriodMonthly) {
		return PointsPeriodMonthly
	}
	return PointsPeriodAll
}

func normalizeCheckinPeriod(period string) CheckinPeriod {
	if strings.TrimSpace(period) == string(CheckinPeriodMonthly) {
		return CheckinPeriodMonthly
	}
	return CheckinPeriodAll
}

func normalizeSettlementPeriod(period string) SettlementPeriod {
	if strings.TrimSpace(period) == string(SettlementPeriodMonthly) {
		return SettlementPeriodMonthly
	}
	return SettlementPeriodWeekly
}

func clampLimit(value int64, fallback int64, maxValue int64) int64 {
	if value <= 0 {
		value = fallback
	}
	if value > maxValue {
		value = maxValue
	}
	return value
}

func clampLimitWithMin(value int64, fallback int64, minValue int64, maxValue int64) int64 {
	if value <= 0 {
		value = fallback
	}
	if value < minValue {
		value = minValue
	}
	if value > maxValue {
		value = maxValue
	}
	return value
}

func maxInt64(left int64, right int64) int64 {
	if left > right {
		return left
	}
	return right
}

func fallbackUsername(userID int64, username string) string {
	username = strings.TrimSpace(username)
	if username != "" {
		return username
	}
	return "#" + intString(userID)
}

func ptrString(value string) *string {
	return &value
}

func ptrInt64(value int64) *int64 {
	return &value
}

func intString(value int64) string {
	return strconv.FormatInt(value, 10)
}

func keys(input map[string]struct{}) []string {
	result := make([]string, 0, len(input))
	for key := range input {
		result = append(result, key)
	}
	sort.Strings(result)
	return result
}

func decodeJSONMap(raw []byte) map[string]any {
	if len(raw) == 0 {
		return map[string]any{}
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil || value == nil {
		return map[string]any{}
	}
	return value
}

func decodeJSONArray(raw []byte) []any {
	if len(raw) == 0 {
		return []any{}
	}
	var value []any
	if err := json.Unmarshal(raw, &value); err != nil || value == nil {
		return []any{}
	}
	return value
}
