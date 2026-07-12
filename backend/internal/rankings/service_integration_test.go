//go:build integration

package rankings

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestServiceReadOnlyLeaderboardsUsePostgres(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过排行榜集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()
	if _, err := pgmigration.NewRunner(db, rankingsMigrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	baseID := int64(78001 + time.Now().UnixNano()%1_000_000_000)
	userA := baseID
	userB := baseID + 1
	cleanupRankingsUsers(t, ctx, db, userA, userB)
	defer cleanupRankingsUsers(t, ctx, db, userA, userB)
	seedRankingUser(t, ctx, db, userA, "rank_alice", "Alice")
	seedRankingUser(t, ctx, db, userB, "rank_bob", "Bob")

	now := time.Date(2026, 6, 25, 4, 0, 0, 0, time.UTC)
	seedRankingsData(t, ctx, db, userA, userB, now)
	service := NewServiceWithNow(db, func() time.Time { return now })

	points, err := service.PointsLeaderboard(ctx, "monthly", 10)
	if err != nil {
		t.Fatalf("points leaderboard failed: %v", err)
	}
	if points.Period != PointsPeriodMonthly || len(points.Leaderboard) < 2 {
		t.Fatalf("unexpected points leaderboard: %+v", points)
	}
	pointsUserB, ok := findPointsEntry(points.Leaderboard, userB)
	if !ok || pointsUserB.Points != 900000000120 {
		t.Fatalf("unexpected points winner: %+v", points.Leaderboard[0])
	}

	checkins, err := service.CheckinStreakLeaderboard(ctx, "all", 10)
	if err != nil {
		t.Fatalf("checkin leaderboard failed: %v", err)
	}
	if checkins.Period != CheckinPeriodAll || len(checkins.Leaderboard) < 2 {
		t.Fatalf("unexpected checkin leaderboard: %+v", checkins)
	}
	checkinUserA, ok := findCheckinEntry(checkins.Leaderboard, userA)
	if !ok || checkinUserA.Streak != 3 {
		t.Fatalf("unexpected checkin row for user A: %+v", checkins.Leaderboard)
	}

	games, err := service.AllGamesLeaderboard(ctx, "daily", 10)
	if err != nil {
		t.Fatalf("games leaderboard failed: %v", err)
	}
	if games.Period != PeriodDaily || len(games.Overall) < 2 || len(games.Games) == 0 {
		t.Fatalf("unexpected games leaderboard: %+v", games)
	}
	if games.Overall[0].UserID != userA || games.Overall[0].TotalScore != 900000000480 {
		t.Fatalf("unexpected overall winner: %+v", games.Overall[0])
	}
	luckyTD, ok := findGameRanking(games.Games, "lucky_td")
	if !ok {
		t.Fatalf("lucky_td leaderboard missing: %+v", games.Games)
	}
	if len(luckyTD.DifficultyOptions) != 7 || luckyTD.DifficultyOptions[0] != (GameDifficultyOption{Value: "all", Label: "全部地图"}) {
		t.Fatalf("unexpected lucky_td map options: %+v", luckyTD.DifficultyOptions)
	}
	trainingRows := luckyTD.LeaderboardsByDifficulty["training_field"]
	if len(trainingRows) != 1 || trainingRows[0].UserID != userA || trainingRows[0].BestScore != 80 {
		t.Fatalf("pending or cross-map lucky_td record leaked into training leaderboard: %+v", trainingRows)
	}
	frostfireRows := luckyTD.LeaderboardsByDifficulty["frostfire_fault"]
	if len(frostfireRows) != 1 || frostfireRows[0].UserID != userB || frostfireRows[0].BestScore != 90 {
		t.Fatalf("unexpected frostfire lucky_td leaderboard: %+v", frostfireRows)
	}
	if len(luckyTD.Leaderboard) != 2 || luckyTD.Leaderboard[0].UserID != userB {
		t.Fatalf("unexpected all-map lucky_td leaderboard: %+v", luckyTD.Leaderboard)
	}

	peaks, err := service.MonthlyPeakHistory(ctx, 2, 10)
	if err != nil {
		t.Fatalf("monthly peak history failed: %v", err)
	}
	if len(peaks.Months) != 2 || peaks.TopLimit != 10 {
		t.Fatalf("unexpected monthly peaks shape: %+v", peaks)
	}
	mayPeak := peaks.Months[0]
	mayUserA, ok := findPointsEntry(mayPeak.Leaderboard, userA)
	if mayPeak.MonthKey != "2026-05" || !ok || mayUserA.Points != 9000000000000000 {
		t.Fatalf("unexpected monthly peak item: %+v", mayPeak)
	}

	seedRankingSettlement(t, ctx, db, userA)
	history, err := service.SettlementHistory(ctx, "monthly", 1, 10)
	if err != nil {
		t.Fatalf("settlement history failed: %v", err)
	}
	if history.Period != SettlementPeriodMonthly || history.Pagination.Total < 1 || len(history.Items) == 0 || history.Items[0].ID != "rankings_settlement_test" {
		t.Fatalf("unexpected settlement history: %+v", history)
	}
}

func TestServiceSettleRankingPeriodGrantsRewardsIdempotently(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过排行榜结算集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()
	if _, err := pgmigration.NewRunner(db, rankingsMigrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	baseID := int64(178001 + time.Now().UnixNano()%1_000_000_000)
	userA := baseID
	userB := baseID + 1
	weeklyNow := time.Date(2026, 6, 25, 4, 0, 0, 0, time.UTC)
	monthlyNow := time.Date(2026, 7, 2, 4, 0, 0, 0, time.UTC)
	weeklyRange := previousSettlementRange(SettlementPeriodWeekly, weeklyNow)
	monthlyRange := previousSettlementRange(SettlementPeriodMonthly, monthlyNow)

	cleanupRankingsSettlementWindows(t, ctx, db, weeklyRange, monthlyRange)
	cleanupRankingsUsers(t, ctx, db, userA, userB)
	defer cleanupRankingsSettlementWindows(t, ctx, db, weeklyRange, monthlyRange)
	defer cleanupRankingsUsers(t, ctx, db, userA, userB)

	seedRankingUser(t, ctx, db, userA, "settle_alice", "Settle Alice")
	seedRankingUser(t, ctx, db, userB, "settle_bob", "Settle Bob")
	insertRankingGameRecord(t, ctx, db, userA, "memory", "easy", 1000, 100, time.UnixMilli(weeklyRange.startAt).Add(2*time.Hour))
	insertRankingGameRecord(t, ctx, db, userB, "memory", "easy", 500, 50, time.UnixMilli(weeklyRange.startAt).Add(3*time.Hour))
	insertRankingGameRecord(t, ctx, db, userA, "match3", "", 800, 80, time.UnixMilli(monthlyRange.startAt).Add(48*time.Hour))

	service := NewServiceWithNow(db, func() time.Time { return weeklyNow })
	dryRun, err := service.SettleRankingPeriod(ctx, SettleInput{
		Period:           SettlementPeriodWeekly,
		OperatorID:       1,
		OperatorUsername: "settle_admin",
		TopN:             2,
		RewardPoints:     []int64{10, 5},
		DryRun:           true,
	})
	if err != nil {
		t.Fatalf("dry-run settlement failed: %v", err)
	}
	if dryRun.AlreadySettled || fmt.Sprint(dryRun.Record.Summary["granted"]) != "0" {
		t.Fatalf("unexpected dry-run result: %+v", dryRun)
	}
	assertRankingSettlementCounts(t, ctx, db, weeklyRange, userA, 0, 0, 0)

	first, err := service.SettleRankingPeriod(ctx, SettleInput{
		Period:           SettlementPeriodWeekly,
		OperatorID:       1,
		OperatorUsername: "settle_admin",
		TopN:             2,
		RewardPoints:     []int64{10, 5},
	})
	if err != nil {
		t.Fatalf("weekly settlement failed: %v", err)
	}
	if first.AlreadySettled || first.Record.Status != settlementStatusSuccess {
		t.Fatalf("unexpected first settlement result: %+v", first)
	}
	assertRankingSettlementCounts(t, ctx, db, weeklyRange, userA, 10, 1, 1)
	assertRankingSettlementCounts(t, ctx, db, weeklyRange, userB, 5, 1, 1)

	second, err := service.SettleRankingPeriod(ctx, SettleInput{
		Period:           SettlementPeriodWeekly,
		OperatorID:       1,
		OperatorUsername: "settle_admin",
		TopN:             2,
		RewardPoints:     []int64{10, 5},
	})
	if err != nil {
		t.Fatalf("repeat weekly settlement failed: %v", err)
	}
	if !second.AlreadySettled {
		t.Fatalf("expected repeat settlement to return existing record: %+v", second)
	}
	assertRankingSettlementCounts(t, ctx, db, weeklyRange, userA, 10, 1, 1)
	assertRankingSettlementCounts(t, ctx, db, weeklyRange, userB, 5, 1, 1)

	monthlyService := NewServiceWithNow(db, func() time.Time { return monthlyNow })
	monthly, err := monthlyService.SettleRankingPeriod(ctx, SettleInput{
		Period:           SettlementPeriodMonthly,
		OperatorID:       1,
		OperatorUsername: "settle_admin",
		TopN:             1,
		RewardPoints:     []int64{30},
	})
	if err != nil {
		t.Fatalf("monthly settlement failed: %v", err)
	}
	if monthly.Record.Status != settlementStatusSuccess {
		t.Fatalf("unexpected monthly settlement result: %+v", monthly)
	}
	assertPeakFirstGranted(t, ctx, db, userA)
}

func seedRankingsData(t *testing.T, ctx context.Context, db *pgxpool.Pool, userA int64, userB int64, now time.Time) {
	t.Helper()
	if _, err := db.Exec(ctx,
		`UPDATE point_accounts SET balance = CASE user_id WHEN $1 THEN 500 WHEN $2 THEN 900 ELSE balance END
		  WHERE user_id IN ($1, $2)`,
		userA,
		userB,
	); err != nil {
		t.Fatalf("seed balances failed: %v", err)
	}
	insertLedger(t, ctx, db, userA, 80000000080, "game_reward", now.Add(-2*time.Hour))
	insertLedger(t, ctx, db, userB, 900000000120, "game_reward", now.Add(-1*time.Hour))
	insertLedger(t, ctx, db, userB, 999, "admin_adjust", now.Add(-30*time.Minute))
	insertLedger(t, ctx, db, userA, 9000000000000000, "game_reward", time.Date(2026, 5, 15, 4, 0, 0, 0, time.UTC))
	insertLedger(t, ctx, db, userB, 8000000000000000, "game_reward", time.Date(2026, 5, 16, 4, 0, 0, 0, time.UTC))

	for _, date := range []string{"2026-06-25", "2026-06-24", "2026-06-23"} {
		insertCheckin(t, ctx, db, userA, date)
	}
	for _, date := range []string{"2026-06-25", "2026-06-24"} {
		insertCheckin(t, ctx, db, userB, date)
	}

	insertRankingGameRecord(t, ctx, db, userA, "memory", "easy", 900000000300, 30, now.Add(-1*time.Hour))
	insertRankingGameRecord(t, ctx, db, userA, "match3", "", 100, 10, now.Add(-50*time.Minute))
	insertRankingGameRecord(t, ctx, db, userB, "memory", "easy", 250, 25, now.Add(-40*time.Minute))
	insertRankingGameRecord(t, ctx, db, userA, "lucky_td", "training_field", 80, 8, now.Add(-35*time.Minute))
	insertRankingGameRecord(t, ctx, db, userB, "lucky_td", "frostfire_fault", 90, 9, now.Add(-30*time.Minute))
	insertPendingRankingGameRecord(t, ctx, db, userB, "lucky_td", "training_field", 999999999999, now.Add(-25*time.Minute))
}

func seedRankingSettlement(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64) {
	t.Helper()
	if _, err := db.Exec(ctx, `DELETE FROM ranking_settlements WHERE id = 'rankings_settlement_test'`); err != nil {
		t.Fatalf("cleanup settlement failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO ranking_settlements (
		   id, period, period_start_ms, period_end_ms, period_label, status,
		   reward_policy, total_participants, rewards, summary,
		   created_at_ms, settled_at_ms, retry_count, triggered_by
		 ) VALUES (
		   'rankings_settlement_test', 'monthly', 1777564800000, 1780243200000,
		   '2026-05-01 ~ 2026-05-31', 'success',
		   '{"topN":1,"rewardPoints":[1500]}'::jsonb,
		   1,
		   jsonb_build_array(jsonb_build_object('rank', 1, 'userId', $1::bigint, 'username', 'rank_alice', 'rewardPoints', 1500, 'status', 'granted')),
		   '{"granted":1,"skipped":0,"failed":0,"totalRewardPoints":1500}'::jsonb,
		   1780243200000, 1780243200000, 0,
		   '{"id":1,"username":"admin"}'::jsonb
		 )`,
		userID,
	); err != nil {
		t.Fatalf("seed settlement failed: %v", err)
	}
}

func findPointsEntry(entries []PointsEntry, userID int64) (PointsEntry, bool) {
	for _, entry := range entries {
		if entry.UserID == userID {
			return entry, true
		}
	}
	return PointsEntry{}, false
}

func findCheckinEntry(entries []CheckinEntry, userID int64) (CheckinEntry, bool) {
	for _, entry := range entries {
		if entry.UserID == userID {
			return entry, true
		}
	}
	return CheckinEntry{}, false
}

func findGameRanking(games []GameResult, gameType string) (GameResult, bool) {
	for _, game := range games {
		if game.GameType == gameType {
			return game, true
		}
	}
	return GameResult{}, false
}

func seedRankingUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64, username string, displayName string) {
	t.Helper()
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $3, now(), now())
		 ON CONFLICT (id) DO UPDATE SET username = excluded.username, display_name = excluded.display_name, updated_at = now()`,
		userID,
		username,
		displayName,
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 0, now())
		 ON CONFLICT (user_id) DO UPDATE SET balance = 0, updated_at = now()`,
		userID,
	); err != nil {
		t.Fatalf("seed point account failed: %v", err)
	}
}

func insertLedger(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64, amount int64, source string, createdAt time.Time) {
	t.Helper()
	if _, err := db.Exec(ctx,
		`INSERT INTO point_ledger (id, user_id, amount, source, description, balance_after, created_at)
		 VALUES ($1, $2, $3, $4, 'rankings test', $3, $5)`,
		fmt.Sprintf("rankings_%d_%d_%s", userID, amount, source),
		userID,
		amount,
		source,
		createdAt,
	); err != nil {
		t.Fatalf("insert ledger failed: %v", err)
	}
}

func insertCheckin(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64, date string) {
	t.Helper()
	if _, err := db.Exec(ctx,
		`INSERT INTO checkin_records (user_id, checkin_date, source, points_awarded, extra_spins_awarded, week_broken)
		 VALUES ($1, $2, 'daily', 50, 1, false)
		 ON CONFLICT (user_id, checkin_date) DO NOTHING`,
		userID,
		date,
	); err != nil {
		t.Fatalf("insert checkin failed: %v", err)
	}
}

func insertRankingGameRecord(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64, gameType string, difficulty string, score int64, points int64, createdAt time.Time) {
	t.Helper()
	if _, err := db.Exec(ctx,
		`INSERT INTO game_records (id, user_id, session_id, game_type, difficulty, score, points_earned, payload, created_at)
		 VALUES ($1, $2, $1, $3, $4, $5, $6, '{}'::jsonb, $7)`,
		fmt.Sprintf("rankings_%d_%s_%d", userID, gameType, score),
		userID,
		gameType,
		difficulty,
		score,
		points,
		createdAt,
	); err != nil {
		t.Fatalf("insert game record failed: %v", err)
	}
}

func insertPendingRankingGameRecord(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64, gameType string, difficulty string, score int64, createdAt time.Time) {
	t.Helper()
	if _, err := db.Exec(ctx,
		`INSERT INTO game_records (id, user_id, session_id, game_type, difficulty, score, points_earned, payload, created_at)
		 VALUES ($1, $2, $1, $3, $4, $5, 0, '{"pending":true}'::jsonb, $6)`,
		fmt.Sprintf("rankings_pending_%d_%s_%d", userID, gameType, score),
		userID,
		gameType,
		difficulty,
		score,
		createdAt,
	); err != nil {
		t.Fatalf("insert pending game record failed: %v", err)
	}
}

func cleanupRankingsUsers(t *testing.T, ctx context.Context, db *pgxpool.Pool, userIDs ...int64) {
	t.Helper()
	if _, err := db.Exec(ctx, `DELETE FROM ranking_settlements WHERE id = 'rankings_settlement_test'`); err != nil {
		t.Fatalf("cleanup rankings settlement failed: %v", err)
	}
	for _, userID := range userIDs {
		for _, query := range []string{
			`DELETE FROM game_records WHERE user_id = $1`,
			`DELETE FROM checkin_records WHERE user_id = $1`,
			`DELETE FROM notifications WHERE user_id = $1`,
			`DELETE FROM point_ledger WHERE user_id = $1`,
			`DELETE FROM ranking_reward_claims WHERE user_id = $1`,
			`DELETE FROM point_accounts WHERE user_id = $1`,
			`DELETE FROM user_profiles WHERE user_id = $1`,
			`DELETE FROM user_forced_achievements WHERE user_id = $1`,
			`DELETE FROM user_equipped_achievements WHERE user_id = $1`,
			`DELETE FROM user_achievement_grants WHERE user_id = $1`,
			`DELETE FROM users WHERE id = $1`,
		} {
			if _, err := db.Exec(ctx, query, userID); err != nil {
				t.Fatalf("cleanup rankings user %d failed: %v", userID, err)
			}
		}
	}
}

func cleanupRankingsSettlementWindows(t *testing.T, ctx context.Context, db *pgxpool.Pool, ranges ...settlementRange) {
	t.Helper()
	for _, currentRange := range ranges {
		if _, err := db.Exec(ctx,
			`DELETE FROM ranking_settlements WHERE period_start_ms = $1 AND period_end_ms = $2`,
			currentRange.startAt,
			currentRange.endAt,
		); err != nil {
			t.Fatalf("cleanup ranking settlements failed: %v", err)
		}
		if _, err := db.Exec(ctx,
			`DELETE FROM ranking_reward_claims WHERE period_start_ms = $1 AND period_end_ms = $2`,
			currentRange.startAt,
			currentRange.endAt,
		); err != nil {
			t.Fatalf("cleanup ranking reward claims failed: %v", err)
		}
	}
}

func assertRankingSettlementCounts(t *testing.T, ctx context.Context, db *pgxpool.Pool, currentRange settlementRange, userID int64, expectedBalance int64, expectedLedger int64, expectedNotifications int64) {
	t.Helper()
	var balance int64
	if err := db.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, userID).Scan(&balance); err != nil {
		t.Fatalf("query balance failed: %v", err)
	}
	if balance != expectedBalance {
		t.Fatalf("unexpected balance for %d: got %d want %d", userID, balance, expectedBalance)
	}
	var ledgerCount int64
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*)::bigint FROM point_ledger
		  WHERE user_id = $1 AND source = 'ranking_reward'`,
		userID,
	).Scan(&ledgerCount); err != nil {
		t.Fatalf("query ledger count failed: %v", err)
	}
	if ledgerCount != expectedLedger {
		t.Fatalf("unexpected ledger count for %d: got %d want %d", userID, ledgerCount, expectedLedger)
	}
	var notificationCount int64
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*)::bigint FROM notifications
		  WHERE user_id = $1 AND data->>'kind' = 'ranking_reward'`,
		userID,
	).Scan(&notificationCount); err != nil {
		t.Fatalf("query notification count failed: %v", err)
	}
	if notificationCount != expectedNotifications {
		t.Fatalf("unexpected notification count for %d: got %d want %d", userID, notificationCount, expectedNotifications)
	}
}

func assertPeakFirstGranted(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64) {
	t.Helper()
	var count int64
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*)::bigint
		   FROM user_achievement_grants
		  WHERE user_id = $1 AND achievement_id = 'peak_first' AND source = 'ranking_monthly' AND expires_at_ms IS NOT NULL`,
		userID,
	).Scan(&count); err != nil {
		t.Fatalf("query peak_first grant failed: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected peak_first grant for %d, got %d", userID, count)
	}
}

func rankingsMigrationsDir(t *testing.T) string {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	return filepath.Join(filepath.Dir(filename), "..", "..", "migrations")
}
