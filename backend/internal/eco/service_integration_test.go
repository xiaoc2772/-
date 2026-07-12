//go:build integration

package eco

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestGetStateSnapshotReadsStructuredTables(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}
	if _, err := db.Exec(ctx, `DELETE FROM users WHERE id IN (99411, 99412)`); err != nil {
		t.Fatalf("cleanup users failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES (99411, 'eco_99411', 'eco_99411', now(), now())`,
	); err != nil {
		t.Fatalf("insert user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_states (
		   user_id, pending, spawn_leftover_ms, auto_leftover_ms, point_buffer,
		   lucky_generations_remaining, glove_uses_remaining, daily_trash_date,
		   daily_trash_points, exp, lifetime_cleared, lifetime_points,
		   points_snapshot, last_tick_at_ms, created_at_ms, updated_at_ms, raw_state
		 ) VALUES (
		   99411, 10, 0, 0, 3, 5, 6, '2026-06-23',
		   14, 15, 16, 17, 940, 1000, 1000, 2000, '{}'::jsonb
		 )`,
	); err != nil {
		t.Fatalf("insert eco state failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_user_upgrades (user_id, upgrade_key, level)
		 VALUES (99411, 'spawn', 2), (99411, 'storage', 1), (99411, 'auto', 1)`,
	); err != nil {
		t.Fatalf("insert upgrades failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_prize_inventory
		   (user_id, prize_key, inventory_count, limited_count, lifetime_claim_count)
		 VALUES (99411, 'diamond', 2, 1, 3)`,
	); err != nil {
		t.Fatalf("insert inventory failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_prize_lots
		   (id, user_id, prize_key, acquired_at_ms, available_at_ms, limited, source)
		 VALUES ('lot-99411-1', 99411, 'diamond', 1000, 2000, true, 'claim')`,
	); err != nil {
		t.Fatalf("insert prize lot failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_visible_prizes (id, user_id, prize_key, created_at_ms, limited)
		 VALUES ('vis-99411-1', 99411, 'coin', 3000, false)`,
	); err != nil {
		t.Fatalf("insert visible prize failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_item_purchases (user_id, item_key, purchase_date, purchase_count)
		 VALUES (99411, 'clear_truck', '2026-06-23', 2)`,
	); err != nil {
		t.Fatalf("insert item purchase failed: %v", err)
	}

	service := NewService(db)
	snapshot, err := service.GetStateSnapshot(ctx, 99411, 61000)
	if err != nil {
		t.Fatalf("get state snapshot failed: %v", err)
	}
	if !snapshot.Exists || snapshot.Pending != 10 || snapshot.PointsSnapshot != 940 || snapshot.DailyTrashDate != "2026-06-23" {
		t.Fatalf("unexpected snapshot: %+v", snapshot)
	}
	if snapshot.Upgrades["spawn"] != 2 || snapshot.Upgrades["storage"] != 1 || snapshot.Upgrades["auto"] != 1 {
		t.Fatalf("unexpected upgrades: %+v", snapshot.Upgrades)
	}
	if snapshot.PrizeInventory["diamond"].InventoryCount != 2 || snapshot.PrizeInventory["diamond"].LimitedCount != 1 {
		t.Fatalf("unexpected inventory: %+v", snapshot.PrizeInventory["diamond"])
	}
	if len(snapshot.PrizeLots) != 1 || snapshot.PrizeLots[0].ID != "lot-99411-1" {
		t.Fatalf("unexpected prize lots: %+v", snapshot.PrizeLots)
	}
	if len(snapshot.VisiblePrizes) != 1 || snapshot.VisiblePrizes[0].ID != "vis-99411-1" {
		t.Fatalf("unexpected visible prizes: %+v", snapshot.VisiblePrizes)
	}
	if len(snapshot.ItemPurchases) != 1 || snapshot.ItemPurchases[0].PurchaseCount != 2 {
		t.Fatalf("unexpected item purchases: %+v", snapshot.ItemPurchases)
	}

	next, tick := AdvanceState(snapshot, 61000)
	if tick.Spawned != 16 || tick.AutoCollected != 1 || next.Pending != 25 {
		t.Fatalf("unexpected advanced state: next=%+v tick=%+v", next, tick)
	}
}

func TestGetStateSnapshotReturnsInitialWhenMissing(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	service := NewService(db)
	snapshot, err := service.GetStateSnapshot(ctx, 99499, 12345)
	if err != nil {
		t.Fatalf("get missing state snapshot failed: %v", err)
	}
	if snapshot.Exists || snapshot.UserID != 99499 || snapshot.LastTickAtMs != 12345 {
		t.Fatalf("unexpected missing snapshot: %+v", snapshot)
	}
}

func TestBuyItemEnforcesDailyLimit(t *testing.T) {
	ctx := context.Background()
	service, db, cleanup := newEcoIntegrationService(t, ctx)
	defer cleanup()
	cleanupEcoUser(t, ctx, db, 99701)
	nowMs := testChinaDateMs(2026, 6, 23)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES (99701, 'eco_99701', 'eco_99701', now(), now())`,
	); err != nil {
		t.Fatalf("seed eco buy-item user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES (99701, 1000, now())`,
	); err != nil {
		t.Fatalf("seed eco buy-item balance failed: %v", err)
	}

	// recycle_glove 每日限购 2 次，应只能成功买两次
	for attempt := int64(1); attempt <= 2; attempt++ {
		result, err := service.BuyItem(ctx, BuyItemInput{UserID: 99701, Key: "recycle_glove", NowMs: nowMs})
		if err != nil {
			t.Fatalf("buy attempt %d failed: %v", attempt, err)
		}
		if !result.Success {
			t.Fatalf("buy attempt %d should succeed, got: %s", attempt, result.Message)
		}
		if result.PurchasedToday != attempt {
			t.Fatalf("buy attempt %d purchasedToday = %d, want %d", attempt, result.PurchasedToday, attempt)
		}
	}

	// 第 3 次应被每日限购拒绝
	third, err := service.BuyItem(ctx, BuyItemInput{UserID: 99701, Key: "recycle_glove", NowMs: nowMs})
	if err != nil {
		t.Fatalf("buy attempt 3 failed: %v", err)
	}
	if third.Success {
		t.Fatalf("buy attempt 3 应被每日限购拒绝，却成功了")
	}
	if third.RemainingToday != 0 {
		t.Fatalf("buy attempt 3 remainingToday = %d, want 0", third.RemainingToday)
	}

	// 数据库里购买次数应停在上限 2，不应被突破
	var count int64
	if err := db.QueryRow(ctx,
		`SELECT purchase_count FROM eco_item_purchases
		  WHERE user_id = 99701 AND item_key = 'recycle_glove' AND purchase_date = '2026-06-23'`,
	).Scan(&count); err != nil {
		t.Fatalf("query item purchase failed: %v", err)
	}
	if count != 2 {
		t.Fatalf("purchase_count = %d, want 2 (每日限购不应被突破)", count)
	}
}

func TestCollectTrashCreditsPointsAndRankings(t *testing.T) {
	ctx := context.Background()
	service, db, cleanup := newEcoIntegrationService(t, ctx)
	defer cleanup()
	cleanupEcoUser(t, ctx, db, 99501)
	nowMs := testChinaDateMs(2026, 6, 23)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES (99501, 'eco_99501', 'eco_99501', now(), now())`,
	); err != nil {
		t.Fatalf("seed eco collect user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES (99501, 0, now())`,
	); err != nil {
		t.Fatalf("seed eco collect balance failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_states (
		   user_id, pending, point_buffer, glove_uses_remaining,
		   daily_trash_date, daily_trash_points, last_tick_at_ms,
		   created_at_ms, updated_at_ms, raw_state
		 ) VALUES (
		   99501, 25, 9, 2, '2026-06-22', 99, $1, $1, $1, '{}'::jsonb
		 )`,
		nowMs,
	); err != nil {
		t.Fatalf("seed eco collect state failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_user_upgrades (user_id, upgrade_key, level)
		 VALUES (99501, 'value', 1)`,
	); err != nil {
		t.Fatalf("seed eco collect upgrade failed: %v", err)
	}

	result, err := service.CollectTrash(ctx, CollectInput{UserID: 99501, Drags: 5, NowMs: nowMs})
	if err != nil {
		t.Fatalf("collect trash failed: %v", err)
	}
	if result.Cleared != 7 || result.PointsEarned != 2 || result.Balance != 2 || result.Pending != 18 || result.PointBuffer != 6 || result.GloveUsesLeft != 0 {
		t.Fatalf("unexpected collect result: %+v", result)
	}

	var pending int64
	var pointBuffer int64
	var dailyDate string
	var dailyPoints int64
	var exp int64
	var lifetimeCleared int64
	var lifetimePoints int64
	if err := db.QueryRow(ctx,
		`SELECT pending, point_buffer, daily_trash_date::text, daily_trash_points,
		        exp, lifetime_cleared, lifetime_points
		   FROM eco_states
		  WHERE user_id = 99501`,
	).Scan(&pending, &pointBuffer, &dailyDate, &dailyPoints, &exp, &lifetimeCleared, &lifetimePoints); err != nil {
		t.Fatalf("query collected eco state failed: %v", err)
	}
	if pending != 18 || pointBuffer != 6 || dailyDate != "2026-06-23" || dailyPoints != 2 || exp != 7 || lifetimeCleared != 7 || lifetimePoints != 2 {
		t.Fatalf("unexpected stored eco state: pending=%d buffer=%d date=%s daily=%d exp=%d cleared=%d points=%d", pending, pointBuffer, dailyDate, dailyPoints, exp, lifetimeCleared, lifetimePoints)
	}

	var ranking int64
	if err := db.QueryRow(ctx,
		`SELECT trash_cleared
		   FROM eco_trash_rankings
		  WHERE period = 'daily' AND period_key = '2026-06-23' AND user_id = 99501`,
	).Scan(&ranking); err != nil {
		t.Fatalf("query eco ranking failed: %v", err)
	}
	if ranking != 7 {
		t.Fatalf("unexpected daily ranking: %d", ranking)
	}
}

func TestCollectTrashSerializesConcurrentRequests(t *testing.T) {
	ctx := context.Background()
	service, db, cleanup := newEcoIntegrationService(t, ctx)
	defer cleanup()
	cleanupEcoUser(t, ctx, db, 99502)
	nowMs := testChinaDateMs(2026, 6, 23)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES (99502, 'eco_99502', 'eco_99502', now(), now())`,
	); err != nil {
		t.Fatalf("seed concurrent user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES (99502, 0, now())`,
	); err != nil {
		t.Fatalf("seed concurrent balance failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_states (
		   user_id, pending, point_buffer, last_tick_at_ms,
		   created_at_ms, updated_at_ms, raw_state
		 ) VALUES (
		   99502, 1000, 0, $1, $1, $1, '{}'::jsonb
		 )`,
		nowMs,
	); err != nil {
		t.Fatalf("seed concurrent eco state failed: %v", err)
	}

	var successes atomic.Int64
	var totalCleared atomic.Int64
	var wg sync.WaitGroup
	for index := 0; index < 20; index++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			result, err := service.CollectTrash(ctx, CollectInput{UserID: 99502, Drags: 10, NowMs: nowMs})
			if err != nil {
				t.Errorf("collect trash returned error: %v", err)
				return
			}
			successes.Add(1)
			totalCleared.Add(result.Cleared)
		}()
	}
	wg.Wait()

	if successes.Load() != 20 || totalCleared.Load() != 200 {
		t.Fatalf("unexpected concurrent results: successes=%d cleared=%d", successes.Load(), totalCleared.Load())
	}

	var pending int64
	var balance int64
	var lifetimeCleared int64
	if err := db.QueryRow(ctx,
		`SELECT s.pending, a.balance, s.lifetime_cleared
		   FROM eco_states s
		   JOIN point_accounts a ON a.user_id = s.user_id
		  WHERE s.user_id = 99502`,
	).Scan(&pending, &balance, &lifetimeCleared); err != nil {
		t.Fatalf("query concurrent collect state failed: %v", err)
	}
	if pending != 800 || balance != 20 || lifetimeCleared != 200 {
		t.Fatalf("unexpected concurrent final state: pending=%d balance=%d cleared=%d", pending, balance, lifetimeCleared)
	}
}

func TestGetStatusGeneratesOnlinePrizesAndReleasesExpiredStock(t *testing.T) {
	ctx := context.Background()
	service, db, cleanup := newEcoIntegrationService(t, ctx)
	defer cleanup()
	cleanupEcoUser(t, ctx, db, 99601)
	nowMs := testChinaDateMs(2026, 6, 23) + int64(time.Hour/time.Millisecond)
	lastTickMs := nowMs - int64(time.Minute/time.Millisecond)
	expiredAtMs := nowMs - ecoPrizeTTLMS - 1

	previousRoll := ecoPrizeRollFloat
	ecoPrizeRollFloat = func() float64 { return 0 }
	defer func() { ecoPrizeRollFloat = previousRoll }()

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES (99601, 'eco_99601', 'eco_99601', now(), now())`,
	); err != nil {
		t.Fatalf("seed online prize user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES (99601, 0, now())`,
	); err != nil {
		t.Fatalf("seed online prize balance failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_states (
		   user_id, pending, lucky_generations_remaining, last_tick_at_ms,
		   created_at_ms, updated_at_ms, raw_state
		 ) VALUES (
		   99601, 0, 1, $1, $1, $1, '{}'::jsonb
		 )`,
		lastTickMs,
	); err != nil {
		t.Fatalf("seed online prize state failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_visible_prizes (id, user_id, prize_key, created_at_ms, limited)
		 VALUES ('expired-99601-coin', 99601, 'coin', $1, true)`,
		expiredAtMs,
	); err != nil {
		t.Fatalf("seed expired visible prize failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_global_prize_stock (prize_key, claimed_count)
		 VALUES ('coin', 1), ('diamond', 0)
		 ON CONFLICT (prize_key) DO UPDATE SET claimed_count = excluded.claimed_count`,
	); err != nil {
		t.Fatalf("seed global prize stock failed: %v", err)
	}

	status, err := service.GetStatus(ctx, 99601, nowMs)
	if err != nil {
		t.Fatalf("get status with online prizes failed: %v", err)
	}
	if len(status.VisiblePrizes) != 10 {
		t.Fatalf("expected 10 generated visible prizes, got %+v", status.VisiblePrizes)
	}
	for _, prize := range status.VisiblePrizes {
		if prize.Key != "diamond" {
			t.Fatalf("expected generated diamond, got %+v", status.VisiblePrizes)
		}
	}
	if status.LuckyGenerationsRemaining != 0 {
		t.Fatalf("expected lucky flashlight to be consumed, got %d", status.LuckyGenerationsRemaining)
	}

	var visibleCoinCount int64
	var visibleDiamondCount int64
	var coinStock int64
	var diamondStock int64
	var luckyRemaining int64
	if err := db.QueryRow(ctx,
		`SELECT
		   (SELECT COUNT(*) FROM eco_visible_prizes WHERE user_id = 99601 AND prize_key = 'coin'),
		   (SELECT COUNT(*) FROM eco_visible_prizes WHERE user_id = 99601 AND prize_key = 'diamond'),
		   (SELECT claimed_count FROM eco_global_prize_stock WHERE prize_key = 'coin'),
		   (SELECT claimed_count FROM eco_global_prize_stock WHERE prize_key = 'diamond'),
		   lucky_generations_remaining
		 FROM eco_states
		 WHERE user_id = 99601`,
	).Scan(&visibleCoinCount, &visibleDiamondCount, &coinStock, &diamondStock, &luckyRemaining); err != nil {
		t.Fatalf("query online prize result failed: %v", err)
	}
	if visibleCoinCount != 0 || visibleDiamondCount != 10 || coinStock != 0 || diamondStock != 10 || luckyRemaining != 0 {
		t.Fatalf("unexpected online prize storage: coinVisible=%d diamondVisible=%d coinStock=%d diamondStock=%d lucky=%d",
			visibleCoinCount, visibleDiamondCount, coinStock, diamondStock, luckyRemaining)
	}
}

func TestProcessTheftInvestigationsMarksExpiredTheftEscaped(t *testing.T) {
	ctx := context.Background()
	service, db, cleanup := newEcoIntegrationService(t, ctx)
	defer cleanup()
	ownerID := int64(99621)
	thiefID := int64(99622)
	cleanupEcoTheftInvestigationFixtures(t, ctx, db)
	defer cleanupEcoTheftInvestigationFixtures(t, ctx, db)
	nowMs := testChinaDateMs(2026, 6, 23) + int64(25*time.Hour/time.Millisecond)
	stolenAtMs := nowMs - theftBlackMarketDelayMS - int64(time.Minute/time.Millisecond)

	seedEcoTheftInvestigationUsers(t, ctx, db, ownerID, thiefID, 0, 0, nowMs)
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_public_prizes (
		   id, prize_key, owner_user_id, owner_name, owner_lot_id,
		   public_at_ms, merchant_available_at_ms, status, thief_user_id,
		   thief_name, theft_message, stolen_at_ms
		 ) VALUES (
		   'public-99621', 'coin', $1, 'owner', 'owner-lot-99621',
		   $3, $3, 'stolen', $2, 'thief', 'message', $3
		 )`,
		ownerID,
		thiefID,
		stolenAtMs,
	); err != nil {
		t.Fatalf("seed escaped public prize failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_thefts (
		   id, prize_key, original_user_id, thief_user_id, public_entry_id,
		   original_lot_id, thief_lot_id, stolen_at_ms, next_check_at_ms,
		   black_market_available_at_ms, message
		 ) VALUES (
		   'theft-99621', 'coin', $1, $2, 'public-99621',
		   'owner-lot-99621', 'thief-lot-99622', $3, $4, $5, 'message'
		 )`,
		ownerID,
		thiefID,
		stolenAtMs,
		nowMs-int64(time.Minute/time.Millisecond),
		stolenAtMs+theftBlackMarketDelayMS,
	); err != nil {
		t.Fatalf("seed escaped theft failed: %v", err)
	}

	result, err := service.ProcessTheftInvestigations(ctx, 25, nowMs)
	if err != nil {
		t.Fatalf("process escaped theft failed: %v", err)
	}
	if result.Checked != 1 || result.Escaped != 1 || result.Caught != 0 || result.Rescheduled != 0 {
		t.Fatalf("unexpected escaped result: %+v", result)
	}

	var outcome string
	var publicCount int64
	if err := db.QueryRow(ctx,
		`SELECT
		   (SELECT outcome FROM eco_thefts WHERE id = 'theft-99621'),
		   (SELECT COUNT(*) FROM eco_public_prizes WHERE id = 'public-99621')`,
	).Scan(&outcome, &publicCount); err != nil {
		t.Fatalf("query escaped theft result failed: %v", err)
	}
	if outcome != "escaped" || publicCount != 0 {
		t.Fatalf("unexpected escaped storage: outcome=%s publicCount=%d", outcome, publicCount)
	}
}

func TestProcessTheftInvestigationsReschedulesWhenNotCaught(t *testing.T) {
	ctx := context.Background()
	service, db, cleanup := newEcoIntegrationService(t, ctx)
	defer cleanup()
	ownerID := int64(99631)
	thiefID := int64(99632)
	cleanupEcoTheftInvestigationFixtures(t, ctx, db)
	defer cleanupEcoTheftInvestigationFixtures(t, ctx, db)
	nowMs := testChinaDateMs(2026, 6, 23) + int64(2*time.Hour/time.Millisecond)
	stolenAtMs := nowMs - int64(time.Hour/time.Millisecond)
	nextCheckAtMs := nowMs - int64(time.Minute/time.Millisecond)
	blackMarketAtMs := nowMs + int64(10*time.Hour/time.Millisecond)

	previousRoll := ecoTheftInvestigationRollFloat
	ecoTheftInvestigationRollFloat = func() float64 { return 0.99 }
	defer func() { ecoTheftInvestigationRollFloat = previousRoll }()

	seedEcoTheftInvestigationUsers(t, ctx, db, ownerID, thiefID, 0, 0, nowMs)
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_thefts (
		   id, prize_key, original_user_id, thief_user_id, public_entry_id,
		   original_lot_id, thief_lot_id, stolen_at_ms, next_check_at_ms,
		   black_market_available_at_ms, message
		 ) VALUES (
		   'theft-99631', 'coin', $1, $2, 'public-99631',
		   'owner-lot-99631', 'thief-lot-99632', $3, $4, $5, 'message'
		 )`,
		ownerID,
		thiefID,
		stolenAtMs,
		nextCheckAtMs,
		blackMarketAtMs,
	); err != nil {
		t.Fatalf("seed rescheduled theft failed: %v", err)
	}

	result, err := service.ProcessTheftInvestigations(ctx, 25, nowMs)
	if err != nil {
		t.Fatalf("process rescheduled theft failed: %v", err)
	}
	if result.Checked != 1 || result.Rescheduled != 1 || result.Caught != 0 || result.Escaped != 0 {
		t.Fatalf("unexpected rescheduled result: %+v", result)
	}

	var resolved bool
	var nextCheck int64
	if err := db.QueryRow(ctx,
		`SELECT resolved_at_ms IS NOT NULL, next_check_at_ms
		   FROM eco_thefts
		  WHERE id = 'theft-99631'`,
	).Scan(&resolved, &nextCheck); err != nil {
		t.Fatalf("query rescheduled theft failed: %v", err)
	}
	if resolved || nextCheck != nextCheckAtMs+theftCheckIntervalMS {
		t.Fatalf("unexpected rescheduled storage: resolved=%v nextCheck=%d", resolved, nextCheck)
	}
}

func TestProcessTheftInvestigationsRepeatTheftLowersInitialCatchRate(t *testing.T) {
	ctx := context.Background()
	service, db, cleanup := newEcoIntegrationService(t, ctx)
	defer cleanup()
	ownerID := int64(99651)
	thiefID := int64(99652)
	cleanupEcoTheftInvestigationFixtures(t, ctx, db)
	defer cleanupEcoTheftInvestigationFixtures(t, ctx, db)
	nowMs := testChinaDateMs(2026, 6, 23) + int64(2*time.Hour/time.Millisecond)
	stolenAtMs := nowMs - int64(10*time.Minute/time.Millisecond)
	nextCheckAtMs := nowMs - int64(time.Minute/time.Millisecond)
	blackMarketAtMs := nowMs + int64(10*time.Hour/time.Millisecond)

	previousRoll := ecoTheftInvestigationRollFloat
	ecoTheftInvestigationRollFloat = func() float64 { return 0.18 }
	defer func() { ecoTheftInvestigationRollFloat = previousRoll }()

	seedEcoTheftInvestigationUsers(t, ctx, db, ownerID, thiefID, 0, 0, nowMs)
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_thefts (
		   id, prize_key, original_user_id, thief_user_id, public_entry_id,
		   original_lot_id, thief_lot_id, stolen_at_ms, next_check_at_ms,
		   black_market_available_at_ms, message, resolved_at_ms, outcome
		 ) VALUES (
		   'theft-99651-old', 'coin', $1, $2, 'public-99651',
		   'owner-lot-old', 'thief-lot-old', $3 - 3600000, $3 - 1800000,
		   $5, 'old message', $3 - 1200000, 'caught'
		 ), (
		   'theft-99651', 'coin', $1, $2, 'public-99651',
		   'owner-lot-99651', 'thief-lot-99652', $3, $4, $5, 'message', NULL, NULL
		 )`,
		ownerID,
		thiefID,
		stolenAtMs,
		nextCheckAtMs,
		blackMarketAtMs,
	); err != nil {
		t.Fatalf("seed repeat theft failed: %v", err)
	}

	result, err := service.ProcessTheftInvestigations(ctx, 25, nowMs)
	if err != nil {
		t.Fatalf("process repeat theft failed: %v", err)
	}
	if result.Checked != 1 || result.Rescheduled != 1 || result.Caught != 0 || result.Escaped != 0 {
		t.Fatalf("unexpected repeat theft result: %+v", result)
	}

	var nextCheck int64
	if err := db.QueryRow(ctx, `SELECT next_check_at_ms FROM eco_thefts WHERE id = 'theft-99651'`).Scan(&nextCheck); err != nil {
		t.Fatalf("query repeat theft failed: %v", err)
	}
	if nextCheck != nextCheckAtMs+theftCheckIntervalMS {
		t.Fatalf("unexpected repeat theft next check: got %d want %d", nextCheck, nextCheckAtMs+theftCheckIntervalMS)
	}
}

func TestEcoPublicBoardProtectsPrizeAfterCaughtTheft(t *testing.T) {
	ctx := context.Background()
	service, db, cleanup := newEcoIntegrationService(t, ctx)
	defer cleanup()
	ownerID := int64(99661)
	viewerID := int64(99662)
	cleanupEcoTheftInvestigationFixtures(t, ctx, db)
	defer cleanupEcoTheftInvestigationFixtures(t, ctx, db)
	nowMs := testChinaDateMs(2026, 6, 23) + int64(2*time.Hour/time.Millisecond)
	resolvedAtMs := nowMs - int64(time.Hour/time.Millisecond)

	seedEcoTheftInvestigationUsers(t, ctx, db, ownerID, viewerID, 0, 0, nowMs)
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_prize_inventory
		   (user_id, prize_key, inventory_count, limited_count, lifetime_claim_count)
		 VALUES ($1, 'coin', 1, 0, 1)`,
		ownerID,
	); err != nil {
		t.Fatalf("seed protected inventory failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_prize_lots (
		   id, user_id, prize_key, acquired_at_ms, available_at_ms, limited, source,
		   public_entry_id, publicly_listed_at_ms, merchant_available_at_ms
		 ) VALUES (
		   'owner-lot-99661', $1, 'coin', $2, $2, false, 'restored',
		   'public-99661', $2, $2
		 )`,
		ownerID,
		nowMs,
	); err != nil {
		t.Fatalf("seed protected lot failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_public_prizes (
		   id, prize_key, owner_user_id, owner_name, owner_lot_id,
		   public_at_ms, merchant_available_at_ms, status
		 ) VALUES (
		   'public-99661', 'coin', $1, 'owner', 'owner-lot-99661',
		   $2, $2, 'listed'
		 )`,
		ownerID,
		nowMs,
	); err != nil {
		t.Fatalf("seed protected public prize failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_thefts (
		   id, prize_key, original_user_id, thief_user_id, public_entry_id,
		   original_lot_id, thief_lot_id, stolen_at_ms, next_check_at_ms,
		   black_market_available_at_ms, message, resolved_at_ms, outcome
		 ) VALUES (
		   'theft-99661', 'coin', $1, $2, 'public-99661',
		   'old-owner-lot', 'old-thief-lot', $3 - 3600000, $3 - 1800000,
		   $3 + 86400000, 'message', $3, 'caught'
		 )`,
		ownerID,
		viewerID,
		resolvedAtMs,
	); err != nil {
		t.Fatalf("seed protected theft failed: %v", err)
	}

	status, err := service.GetStatus(ctx, viewerID, nowMs)
	if err != nil {
		t.Fatalf("get protected status failed: %v", err)
	}
	if len(status.PublicBoard.Entries) == 0 {
		t.Fatalf("expected protected public entry")
	}
	entry := status.PublicBoard.Entries[0]
	if entry.ID != "public-99661" || entry.CanSteal || entry.StealDisabledReason == nil || *entry.StealDisabledReason != "保护中" || entry.ProtectedUntil == nil || *entry.ProtectedUntil != resolvedAtMs+theftProtectionMS {
		t.Fatalf("unexpected protected entry: %+v", entry)
	}
}

func TestProcessTheftInvestigationsCatchesAndRestoresPrize(t *testing.T) {
	ctx := context.Background()
	service, db, cleanup := newEcoIntegrationService(t, ctx)
	defer cleanup()
	ownerID := int64(99641)
	thiefID := int64(99642)
	cleanupEcoTheftInvestigationFixtures(t, ctx, db)
	defer cleanupEcoTheftInvestigationFixtures(t, ctx, db)
	nowMs := testChinaDateMs(2026, 6, 23) + int64(2*time.Hour/time.Millisecond)
	stolenAtMs := nowMs - int64(time.Hour/time.Millisecond)
	blackMarketAtMs := nowMs + int64(10*time.Hour/time.Millisecond)

	previousRoll := ecoTheftInvestigationRollFloat
	ecoTheftInvestigationRollFloat = func() float64 { return 0 }
	defer func() { ecoTheftInvestigationRollFloat = previousRoll }()

	seedEcoTheftInvestigationUsers(t, ctx, db, ownerID, thiefID, 100, 1000, nowMs)
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_prize_inventory
		   (user_id, prize_key, inventory_count, limited_count, lifetime_claim_count)
		 VALUES
		   ($1, 'coin', 0, 0, 5),
		   ($2, 'coin', 1, 1, 0)`,
		ownerID,
		thiefID,
	); err != nil {
		t.Fatalf("seed caught inventory failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_prize_lots (
		   id, user_id, prize_key, acquired_at_ms, available_at_ms, limited, source,
		   stolen_from_user_id, stolen_at_ms, theft_id, black_market_available_at_ms
		 ) VALUES (
		   'thief-lot-99642', $1, 'coin', $2, $3, true, 'stolen',
		   $4, $2, 'theft-99641', $3
		 )`,
		thiefID,
		stolenAtMs,
		blackMarketAtMs,
		ownerID,
	); err != nil {
		t.Fatalf("seed caught stolen lot failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_public_prizes (
		   id, prize_key, owner_user_id, owner_name, owner_lot_id,
		   public_at_ms, merchant_available_at_ms, status, thief_user_id,
		   thief_name, theft_message, stolen_at_ms
		 ) VALUES (
		   'public-99641', 'coin', $1, 'owner', 'owner-lot-99641',
		   $3, $3, 'stolen', $2, 'thief', 'message', $3
		 )`,
		ownerID,
		thiefID,
		stolenAtMs,
	); err != nil {
		t.Fatalf("seed caught public prize failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_thefts (
		   id, prize_key, original_user_id, thief_user_id, public_entry_id,
		   original_lot_id, thief_lot_id, stolen_at_ms, next_check_at_ms,
		   black_market_available_at_ms, message
		 ) VALUES (
		   'theft-99641', 'coin', $1, $2, 'public-99641',
		   'owner-lot-99641', 'thief-lot-99642', $3, $4, $5, 'message'
		 )`,
		ownerID,
		thiefID,
		stolenAtMs,
		nowMs-int64(time.Minute/time.Millisecond),
		blackMarketAtMs,
	); err != nil {
		t.Fatalf("seed caught theft failed: %v", err)
	}

	result, err := service.ProcessTheftInvestigations(ctx, 25, nowMs)
	if err != nil {
		t.Fatalf("process caught theft failed: %v", err)
	}
	if result.Checked != 1 || result.Caught != 1 || result.Escaped != 0 || result.Rescheduled != 0 {
		t.Fatalf("unexpected caught result: %+v", result)
	}

	expectedPenalty := minInt64(1000, ecoPrizePrice("coin", chinaDateKey(nowMs), prizeClaimStats{})/10)
	expectedCompensation := expectedPenalty / 2
	expectedMerchantAt := maxInt64(nowMs, nextChinaSixMs(stolenAtMs))

	var outcome string
	var publicStatus string
	var publicOwnerLotID string
	var publicThiefCount int64
	var ownerInventory int64
	var ownerLimited int64
	var ownerLifetime int64
	var thiefInventory int64
	var thiefLimited int64
	var thiefLotCount int64
	var ownerBalance int64
	var thiefBalance int64
	var restoredLotCount int64
	var restoredMerchantAt int64
	var forcedUntil int64
	if err := db.QueryRow(ctx,
		`SELECT
		   (SELECT outcome FROM eco_thefts WHERE id = 'theft-99641'),
		   (SELECT status FROM eco_public_prizes WHERE id = 'public-99641'),
		   (SELECT owner_lot_id FROM eco_public_prizes WHERE id = 'public-99641'),
		   (SELECT COUNT(*) FROM eco_public_prizes WHERE id = 'public-99641' AND thief_user_id IS NOT NULL),
		   (SELECT inventory_count FROM eco_prize_inventory WHERE user_id = $1 AND prize_key = 'coin'),
		   (SELECT limited_count FROM eco_prize_inventory WHERE user_id = $1 AND prize_key = 'coin'),
		   (SELECT lifetime_claim_count FROM eco_prize_inventory WHERE user_id = $1 AND prize_key = 'coin'),
		   (SELECT inventory_count FROM eco_prize_inventory WHERE user_id = $2 AND prize_key = 'coin'),
		   (SELECT limited_count FROM eco_prize_inventory WHERE user_id = $2 AND prize_key = 'coin'),
		   (SELECT COUNT(*) FROM eco_prize_lots WHERE id = 'thief-lot-99642'),
		   (SELECT balance FROM point_accounts WHERE user_id = $1),
		   (SELECT balance FROM point_accounts WHERE user_id = $2),
		   (SELECT COUNT(*) FROM eco_prize_lots WHERE user_id = $1 AND source = 'restored' AND public_entry_id = 'public-99641'),
		   (SELECT merchant_available_at_ms FROM eco_prize_lots WHERE user_id = $1 AND source = 'restored' AND public_entry_id = 'public-99641'),
		   (SELECT until_ms FROM user_forced_achievements WHERE user_id = $2 AND achievement_id = 'thief')`,
		ownerID,
		thiefID,
	).Scan(
		&outcome,
		&publicStatus,
		&publicOwnerLotID,
		&publicThiefCount,
		&ownerInventory,
		&ownerLimited,
		&ownerLifetime,
		&thiefInventory,
		&thiefLimited,
		&thiefLotCount,
		&ownerBalance,
		&thiefBalance,
		&restoredLotCount,
		&restoredMerchantAt,
		&forcedUntil,
	); err != nil {
		t.Fatalf("query caught theft result failed: %v", err)
	}
	if outcome != "caught" || publicStatus != "listed" || publicOwnerLotID == "owner-lot-99641" || publicThiefCount != 0 {
		t.Fatalf("unexpected caught public state: outcome=%s status=%s ownerLot=%s thiefCount=%d", outcome, publicStatus, publicOwnerLotID, publicThiefCount)
	}
	if ownerInventory != 1 || ownerLimited != 1 || ownerLifetime != 5 || thiefInventory != 0 || thiefLimited != 0 || thiefLotCount != 0 {
		t.Fatalf("unexpected caught inventory: owner=%d limited=%d lifetime=%d thief=%d limited=%d thiefLots=%d",
			ownerInventory, ownerLimited, ownerLifetime, thiefInventory, thiefLimited, thiefLotCount)
	}
	if ownerBalance != 100+expectedCompensation || thiefBalance != 1000-expectedPenalty {
		t.Fatalf("unexpected caught balances: owner=%d thief=%d penalty=%d compensation=%d",
			ownerBalance, thiefBalance, expectedPenalty, expectedCompensation)
	}
	if restoredLotCount != 1 || restoredMerchantAt != expectedMerchantAt || forcedUntil != nowMs+thiefForcedAchievementMS {
		t.Fatalf("unexpected caught restored state: lots=%d merchantAt=%d forcedUntil=%d",
			restoredLotCount, restoredMerchantAt, forcedUntil)
	}
}

func TestGetTrashLeaderboardReadsStructuredRankings(t *testing.T) {
	ctx := context.Background()
	service, db, cleanup := newEcoIntegrationService(t, ctx)
	defer cleanup()
	firstUserID := int64(99651)
	secondUserID := int64(99652)
	thirdUserID := int64(99653)
	for _, userID := range []int64{firstUserID, secondUserID, thirdUserID} {
		cleanupEcoUser(t, ctx, db, userID)
	}
	defer func() {
		for _, userID := range []int64{firstUserID, secondUserID, thirdUserID} {
			cleanupEcoUser(t, ctx, db, userID)
		}
	}()

	nowMs := testChinaDateMs(2035, 6, 23) + int64(time.Hour/time.Millisecond)
	periodKey := chinaDateKey(nowMs)
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES
		   ($1, 'eco_rank_b', 'Eco Rank B', now(), now()),
		   ($2, 'eco_rank_a', 'Eco Rank A', now(), now()),
		   ($3, 'eco_rank_c', '', now(), now())`,
		firstUserID,
		secondUserID,
		thirdUserID,
	); err != nil {
		t.Fatalf("seed ranking users failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_trash_rankings (period, period_key, user_id, trash_cleared)
		 VALUES
		   ('daily', $1::date::text, $2, 7),
		   ('daily', $1::date::text, $3, 7),
		   ('daily', $1::date::text, $4, 3)`,
		periodKey,
		secondUserID,
		firstUserID,
		thirdUserID,
	); err != nil {
		t.Fatalf("seed trash rankings failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO user_achievement_grants
		   (user_id, achievement_id, source, granted_at_ms, expires_at_ms, reason)
		 VALUES ($1, 'thief', 'auto', $2, $3, 'test')
		 ON CONFLICT (user_id, achievement_id) DO UPDATE SET expires_at_ms = excluded.expires_at_ms`,
		firstUserID,
		nowMs,
		nowMs+thiefForcedAchievementMS,
	); err != nil {
		t.Fatalf("seed ranking achievement grant failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO user_equipped_achievements (user_id, achievement_id, updated_at_ms)
		 VALUES ($1, 'thief', $2)
		 ON CONFLICT (user_id) DO UPDATE SET achievement_id = excluded.achievement_id, updated_at_ms = excluded.updated_at_ms`,
		firstUserID,
		nowMs,
	); err != nil {
		t.Fatalf("seed ranking equipped achievement failed: %v", err)
	}

	result, err := service.GetTrashLeaderboard(ctx, "daily", 10, nowMs)
	if err != nil {
		t.Fatalf("get trash leaderboard failed: %v", err)
	}
	if result.Period != TrashRankingDaily || result.PeriodKey != periodKey || result.TotalParticipants != 3 || len(result.Leaderboard) != 3 {
		t.Fatalf("unexpected leaderboard summary: %+v", result)
	}
	if result.Leaderboard[0].UserID != firstUserID || result.Leaderboard[1].UserID != secondUserID || result.Leaderboard[2].UserID != thirdUserID {
		t.Fatalf("unexpected leaderboard order: %+v", result.Leaderboard)
	}
	if result.Leaderboard[0].Rank != 1 || result.Leaderboard[0].TrashCleared != 7 || result.Leaderboard[0].DisplayName == nil || *result.Leaderboard[0].DisplayName != "Eco Rank B" {
		t.Fatalf("unexpected first ranking entry: %+v", result.Leaderboard[0])
	}
	if result.Leaderboard[0].EquippedAchievement == nil || result.Leaderboard[0].EquippedAchievement.ID != "thief" || result.Leaderboard[0].EquippedAchievement.ExpiresAt == nil {
		t.Fatalf("expected thief achievement on first entry: %+v", result.Leaderboard[0].EquippedAchievement)
	}
}

func TestAdminEcoOverviewAndPrizeRateSettings(t *testing.T) {
	ctx := context.Background()
	service, db, cleanup := newEcoIntegrationService(t, ctx)
	defer cleanup()

	nowMs := testChinaDateMs(2026, 6, 23)
	userID := int64(99701 + time.Now().UnixNano()%1_000_000)
	thiefID := userID + 1
	cleanupAdminEcoFixtures(t, ctx, db, userID, thiefID)
	defer cleanupAdminEcoFixtures(t, ctx, db, userID, thiefID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES
		   ($1, $2, 'Eco Admin Owner', now(), now()),
		   ($3, $4, 'Eco Admin Thief', now(), now())`,
		userID,
		"eco_admin_owner_"+strconv.FormatInt(userID, 10),
		thiefID,
		"eco_admin_thief_"+strconv.FormatInt(thiefID, 10),
	); err != nil {
		t.Fatalf("seed admin eco users failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO user_profiles (user_id, display_name, avatar_url, updated_at_ms)
		 VALUES ($1, 'Owner Profile', 'https://example.com/a.webp', $3),
		        ($2, 'Thief Profile', NULL, $3)`,
		userID,
		thiefID,
		nowMs,
	); err != nil {
		t.Fatalf("seed admin eco profiles failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_prize_inventory (user_id, prize_key, inventory_count, limited_count, lifetime_claim_count)
		 VALUES ($1, 'coin', 2, 0, 5),
		        ($2, 'coin', 1, 0, 1)`,
		userID,
		thiefID,
	); err != nil {
		t.Fatalf("seed admin eco inventory failed: %v", err)
	}
	ownerLotID := "admin-eco-owner-lot-" + strconv.FormatInt(userID, 10)
	thiefLotID := "admin-eco-thief-lot-" + strconv.FormatInt(thiefID, 10)
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_prize_lots (id, user_id, prize_key, acquired_at_ms, available_at_ms, limited, source, stolen_from_user_id, stolen_at_ms, theft_id, black_market_available_at_ms)
		 VALUES
		   ($3, $1, 'coin', $5, $5, false, 'claim', NULL, NULL, NULL, NULL),
		   ($4, $2, 'coin', $5, $5 + 86400000, false, 'stolen', $1, $5, 'admin-eco-theft', $5 + 86400000)`,
		userID,
		thiefID,
		ownerLotID,
		thiefLotID,
		nowMs,
	); err != nil {
		t.Fatalf("seed admin eco lots failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_thefts (
		   id, prize_key, original_user_id, thief_user_id, public_entry_id,
		   original_lot_id, thief_lot_id, stolen_at_ms, next_check_at_ms,
		   black_market_available_at_ms, message
		 ) VALUES (
		   'admin-eco-theft', 'coin', $1, $2, 'admin-eco-public',
		   $3, $4, $5::bigint, $5::bigint + 1800000, $5::bigint + 86400000, '测试留言'
		 )`,
		userID,
		thiefID,
		ownerLotID,
		thiefLotID,
		nowMs,
	); err != nil {
		t.Fatalf("seed admin eco theft failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_trash_rankings (period, period_key, user_id, trash_cleared)
		 VALUES ('daily', '2026-06-22', $1, 7),
		        ('daily', '2026-06-23', $1, 9)`,
		userID,
	); err != nil {
		t.Fatalf("seed admin eco trash rankings failed: %v", err)
	}

	prizes, err := service.UpdatePrizeRateSettings(ctx, map[string]float64{"coin": 0.02})
	if err != nil {
		t.Fatalf("update prize rates failed: %v", err)
	}
	if findAdminPrizeRate(prizes, "coin") != 0.02 {
		t.Fatalf("coin rate should be updated: %+v", prizes)
	}
	if _, err := service.UpdatePrizeRateSettings(ctx, map[string]float64{"coin": 1, "photo": 1}); !errors.Is(err, ErrInvalidPrizeRateSettings) {
		t.Fatalf("expected invalid total rate error, got %v", err)
	}

	overview, err := service.GetAdminOverview(ctx, AdminOverviewInput{TrashPage: 1, TrashLimit: 10, NowMs: nowMs})
	if err != nil {
		t.Fatalf("get admin overview failed: %v", err)
	}
	coinSummary := findAdminPrizeSummary(overview.Prizes, "coin")
	if coinSummary == nil || coinSummary.CurrentRate != 0.02 || coinSummary.HolderCount < 2 || coinSummary.TotalCurrentInventory < 3 {
		t.Fatalf("unexpected coin admin summary: %+v", coinSummary)
	}
	if !adminPrizeSummaryHasHolder(*coinSummary, userID, 2, 5) || !adminPrizeSummaryHasHolder(*coinSummary, thiefID, 1, 1) {
		t.Fatalf("coin summary should include seeded holders: %+v", coinSummary.Holders)
	}
	if !adminTheftViewsContain(overview.Thefts, "admin-eco-theft", thiefID) {
		t.Fatalf("unexpected admin thefts: %+v", overview.Thefts)
	}
	manualTrashRow := findAdminManualTrashRow(overview.ManualTrash.Rows, userID)
	if manualTrashRow == nil || manualTrashRow.Total != 16 || manualTrashRow.Days["2026-06-23"] != 9 {
		t.Fatalf("unexpected manual trash summary: %+v", overview.ManualTrash)
	}
}

func newEcoIntegrationService(t *testing.T, ctx context.Context) (*Service, *pgxpool.Pool, func()) {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		db.Close()
		t.Fatalf("apply migrations failed: %v", err)
	}
	return NewService(db), db, db.Close
}

func cleanupAdminEcoFixtures(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64, thiefID int64) {
	t.Helper()
	statements := []string{
		`DELETE FROM eco_thefts WHERE id = 'admin-eco-theft' OR original_user_id IN ($1, $2) OR thief_user_id IN ($1, $2)`,
		`DELETE FROM eco_public_prizes WHERE owner_user_id IN ($1, $2) OR thief_user_id IN ($1, $2)`,
		`DELETE FROM user_profiles WHERE user_id IN ($1, $2)`,
		`DELETE FROM eco_prize_rate_settings WHERE prize_key IN ('coin', 'photo')`,
	}
	for _, statement := range statements {
		var err error
		if strings.Contains(statement, "$1") {
			_, err = db.Exec(ctx, statement, userID, thiefID)
		} else {
			_, err = db.Exec(ctx, statement)
		}
		if err != nil {
			t.Fatalf("cleanup admin eco fixtures failed: %v", err)
		}
	}
	cleanupEcoUser(t, ctx, db, userID)
	cleanupEcoUser(t, ctx, db, thiefID)
}

func findAdminPrizeRate(views []AdminPrizeRateView, key string) float64 {
	for _, view := range views {
		if view.Key == key {
			return view.CurrentRate
		}
	}
	return -1
}

func findAdminPrizeSummary(summaries []AdminPrizeSummary, key string) *AdminPrizeSummary {
	for index := range summaries {
		if summaries[index].Key == key {
			return &summaries[index]
		}
	}
	return nil
}

func adminPrizeSummaryHasHolder(summary AdminPrizeSummary, userID int64, current int64, lifetime int64) bool {
	for _, holder := range summary.Holders {
		if holder.UserID == userID {
			return holder.CurrentCount == current && holder.LifetimeCount == lifetime
		}
	}
	return false
}

func adminTheftViewsContain(thefts []AdminTheftView, id string, thiefID int64) bool {
	for _, theft := range thefts {
		if theft.ID == id && theft.ThiefUserID == thiefID && theft.PrizeName != "" {
			return true
		}
	}
	return false
}

func findAdminManualTrashRow(rows []AdminManualTrashRow, userID int64) *AdminManualTrashRow {
	for index := range rows {
		if rows[index].UserID == userID {
			return &rows[index]
		}
	}
	return nil
}

func seedEcoTheftInvestigationUsers(t *testing.T, ctx context.Context, db *pgxpool.Pool, ownerID int64, thiefID int64, ownerBalance int64, thiefBalance int64, nowMs int64) {
	t.Helper()
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES
		   ($1::bigint, 'owner_' || $1::bigint::text, 'owner_' || $1::bigint::text, now(), now()),
		   ($2::bigint, 'thief_' || $2::bigint::text, 'thief_' || $2::bigint::text, now(), now())`,
		ownerID,
		thiefID,
	); err != nil {
		t.Fatalf("seed theft users failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, $2, now()), ($3, $4, now())`,
		ownerID,
		ownerBalance,
		thiefID,
		thiefBalance,
	); err != nil {
		t.Fatalf("seed theft point accounts failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_states (user_id, last_tick_at_ms, created_at_ms, updated_at_ms, raw_state)
		 VALUES ($1, $3, $3, $3, '{}'::jsonb), ($2, $3, $3, $3, '{}'::jsonb)`,
		ownerID,
		thiefID,
		nowMs,
	); err != nil {
		t.Fatalf("seed theft eco states failed: %v", err)
	}
}

func cleanupEcoTheftInvestigationFixtures(t *testing.T, ctx context.Context, db *pgxpool.Pool) {
	t.Helper()
	for _, userID := range []int64{99621, 99622, 99631, 99632, 99641, 99642, 99651, 99652, 99661, 99662} {
		cleanupEcoUser(t, ctx, db, userID)
	}
}

func cleanupEcoUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64) {
	t.Helper()
	statements := []string{
		`DELETE FROM eco_trash_rankings WHERE user_id = $1`,
		`DELETE FROM eco_item_purchases WHERE user_id = $1`,
		`DELETE FROM eco_visible_prizes WHERE user_id = $1`,
		`DELETE FROM eco_prize_lots WHERE user_id = $1`,
		`DELETE FROM eco_prize_inventory WHERE user_id = $1`,
		`DELETE FROM eco_user_upgrades WHERE user_id = $1`,
		`DELETE FROM eco_states WHERE user_id = $1`,
		`DELETE FROM point_ledger WHERE user_id = $1`,
		`DELETE FROM point_accounts WHERE user_id = $1`,
		`DELETE FROM users WHERE id = $1`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(ctx, statement, userID); err != nil {
			t.Fatalf("cleanup user %d failed: %v", userID, err)
		}
	}
}

func testChinaDateMs(year int, month time.Month, day int) int64 {
	location := time.FixedZone("Asia/Shanghai", 8*60*60)
	return time.Date(year, month, day, 0, 0, 0, 0, location).UnixMilli()
}

func migrationsDir(t *testing.T) string {
	t.Helper()

	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatalf("cannot resolve test file path")
	}
	return filepath.Join(filepath.Dir(file), "..", "..", "migrations")
}
