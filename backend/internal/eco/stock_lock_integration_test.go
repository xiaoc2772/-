//go:build integration

package eco

import (
	"context"
	"testing"
	"time"
)

// 状态轮询在不生成奖品时不应触碰全局库存锁——否则任何一个慢事务
// 会把所有用户的 /status 轮询串行化，耗尽连接池。
func TestGetStatusDoesNotBlockOnGlobalPrizeStockLock(t *testing.T) {
	ctx := context.Background()
	service, db, cleanup := newEcoIntegrationService(t, ctx)
	defer cleanup()
	userID := int64(99671)
	cleanupEcoUser(t, ctx, db, userID)

	previousRoll := ecoPrizeRollFloat
	ecoPrizeRollFloat = func() float64 { return 0.999 }
	defer func() { ecoPrizeRollFloat = previousRoll }()

	if _, err := db.Exec(ctx,
		`INSERT INTO eco_global_prize_stock (prize_key, claimed_count)
		 VALUES ('coin', 1)
		 ON CONFLICT (prize_key) DO UPDATE SET claimed_count = excluded.claimed_count`,
	); err != nil {
		t.Fatalf("seed stock failed: %v", err)
	}
	lockTx, err := db.Begin(ctx)
	if err != nil {
		t.Fatalf("begin lock tx failed: %v", err)
	}
	defer func() { _ = lockTx.Rollback(ctx) }()
	if _, err := lockTx.Exec(ctx, `SELECT prize_key FROM eco_global_prize_stock FOR UPDATE`); err != nil {
		t.Fatalf("lock stock table failed: %v", err)
	}

	nowMs := testChinaDateMs(2026, 6, 23) + int64(time.Hour/time.Millisecond)
	statusCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if _, err := service.GetStatus(statusCtx, userID, nowMs); err != nil {
		t.Fatalf("状态轮询不应等待全局库存锁（无奖品生成时不该碰库存表）: %v", err)
	}
}

// 全局限量已满时，即使强制 roll 出奖品也不能超发。
func TestGetStatusDoesNotOvergrantBeyondGlobalLimit(t *testing.T) {
	ctx := context.Background()
	service, db, cleanup := newEcoIntegrationService(t, ctx)
	defer cleanup()
	userID := int64(99672)
	cleanupEcoUser(t, ctx, db, userID)
	nowMs := testChinaDateMs(2026, 6, 23) + int64(time.Hour/time.Millisecond)
	lastTickMs := nowMs - int64(time.Minute/time.Millisecond)

	previousRoll := ecoPrizeRollFloat
	ecoPrizeRollFloat = func() float64 { return 0 }
	defer func() { ecoPrizeRollFloat = previousRoll }()

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'eco_99672', 'eco_99672', now(), now())`, userID,
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at) VALUES ($1, 0, now())`, userID,
	); err != nil {
		t.Fatalf("seed balance failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_states (
		   user_id, pending, lucky_generations_remaining, last_tick_at_ms,
		   created_at_ms, updated_at_ms, raw_state
		 ) VALUES ($1, 0, 1, $2, $2, $2, '{}'::jsonb)`,
		userID, lastTickMs,
	); err != nil {
		t.Fatalf("seed state failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_global_prize_stock (prize_key, claimed_count)
		 VALUES ('diamond', $1)
		 ON CONFLICT (prize_key) DO UPDATE SET claimed_count = excluded.claimed_count`,
		ecoPrizeDefinitions["diamond"].GlobalLimit,
	); err != nil {
		t.Fatalf("seed stock failed: %v", err)
	}

	status, err := service.GetStatus(ctx, userID, nowMs)
	if err != nil {
		t.Fatalf("get status failed: %v", err)
	}
	for _, prize := range status.VisiblePrizes {
		if prize.Key == "diamond" {
			t.Fatalf("库存已满仍生成了 diamond: %+v", status.VisiblePrizes)
		}
	}
	var diamondStock int64
	if err := db.QueryRow(ctx,
		`SELECT claimed_count FROM eco_global_prize_stock WHERE prize_key = 'diamond'`,
	).Scan(&diamondStock); err != nil {
		t.Fatalf("query stock failed: %v", err)
	}
	if diamondStock != ecoPrizeDefinitions["diamond"].GlobalLimit {
		t.Fatalf("库存计数被超发: %d", diamondStock)
	}
}
