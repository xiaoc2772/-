//go:build integration

package lottery

import (
	"context"
	"os"
	"strconv"
	"sync"
	"testing"
	"time"

	"redemption/backend/internal/auth"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"
)

func TestPlaceNumberBombBetConcurrentFirstBetSingleCharge(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过数字炸弹集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()
	if _, err := pgmigration.NewRunner(db, "../../migrations").Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	userID := int64(99801 + time.Now().UnixNano()%1_000_000_000)
	recordID := "number_bomb_it_" + strconv.FormatInt(userID, 10)
	cleanupLotteryIntegrationUser(t, ctx, db, userID, recordID)
	defer cleanupLotteryIntegrationUser(t, ctx, db, userID, recordID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $3, now(), now())`,
		userID, "nb_concurrent_user", "NB Concurrent User",
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	const initialBalance = int64(1000)
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance) VALUES ($1, $2)`,
		userID, initialBalance,
	); err != nil {
		t.Fatalf("seed point account failed: %v", err)
	}

	service := NewService(db)
	user := auth.User{ID: userID, Username: "nb_concurrent_user", DisplayName: "NB Concurrent User"}

	multipliers := []int{1, 2, 5, 10, 1, 2, 5, 10}
	var waitGroup sync.WaitGroup
	for _, multiplier := range multipliers {
		waitGroup.Add(1)
		go func(m int) {
			defer waitGroup.Done()
			if _, err := service.PlaceNumberBombBet(ctx, user, NumberBombBetInput{SelectedNumber: 3, Multiplier: m}); err != nil {
				t.Errorf("place bet multiplier=%d failed: %v", m, err)
			}
		}(multiplier)
	}
	waitGroup.Wait()

	var balance int64
	if err := db.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, userID).Scan(&balance); err != nil {
		t.Fatalf("query balance failed: %v", err)
	}
	var pendingCount int64
	var ticketCost int64
	if err := db.QueryRow(ctx,
		`SELECT count(*), COALESCE(SUM(ticket_cost), 0) FROM number_bomb_bets WHERE user_id = $1 AND status = 'pending'`,
		userID,
	).Scan(&pendingCount, &ticketCost); err != nil {
		t.Fatalf("query pending bet failed: %v", err)
	}
	if pendingCount != 1 {
		t.Fatalf("expected exactly one pending bet, got %d", pendingCount)
	}
	if charged := initialBalance - balance; charged != ticketCost {
		t.Fatalf("并发投注实际扣款 %d 与在案门票 %d 不一致（重复扣费）", charged, ticketCost)
	}

	var ledgerNet int64
	if err := db.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount), 0) FROM point_ledger WHERE user_id = $1 AND source IN ($2, $3)`,
		userID, numberBombBetSource, numberBombRefundSource,
	).Scan(&ledgerNet); err != nil {
		t.Fatalf("query ledger failed: %v", err)
	}
	if ledgerNet != -ticketCost {
		t.Fatalf("流水净额 %d 与在案门票 -%d 不一致", ledgerNet, ticketCost)
	}
}
