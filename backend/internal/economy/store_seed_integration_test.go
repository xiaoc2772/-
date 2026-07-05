//go:build integration

package economy

import (
	"context"
	"testing"
	"time"

	"redemption/backend/internal/auth"
)

func TestDeletedDefaultStoreItemStaysDeleted(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	userID := int64(97001 + time.Now().UnixNano()%1_000_000_000)
	user := auth.User{ID: userID, Username: "store_seed_user", DisplayName: "Store Seed User"}
	defer func() {
		_, _ = service.db.Exec(ctx, `DELETE FROM point_ledger WHERE user_id = $1`, userID)
		_, _ = service.db.Exec(ctx, `DELETE FROM point_accounts WHERE user_id = $1`, userID)
		_, _ = service.db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
	}()

	// 首次访问，确保默认商品已在库
	if _, err := service.GetStoreHome(ctx, user); err != nil {
		t.Fatalf("first store home failed: %v", err)
	}

	deleted, err := service.DeleteStoreItem(ctx, "makeup-card-1")
	if err != nil {
		t.Fatalf("delete default item failed: %v", err)
	}
	if !deleted {
		t.Fatalf("expected makeup-card-1 to exist before deletion")
	}
	// 测试库是共享的，结束后恢复默认商品，避免影响其他用例
	defer func() {
		_, _ = service.db.Exec(ctx,
			`INSERT INTO store_items
			   (id, name, description, type, category_id, points_cost, value, daily_limit, sort_order, enabled, created_at, updated_at)
			 VALUES ('makeup-card-1', '补签卡 x1', '用于补回本周漏签的日子，补签后视同已签到。', 'makeup_card', 'makeup', 30, 1, NULL, 8, true, now(), now())
			 ON CONFLICT (id) DO NOTHING`)
	}()

	home, err := service.GetStoreHome(ctx, user)
	if err != nil {
		t.Fatalf("second store home failed: %v", err)
	}
	for _, item := range home.Items {
		if item.ID == "makeup-card-1" {
			t.Fatalf("管理员删除的默认商品被静默种回（用户商城）")
		}
	}

	adminData, err := service.GetStoreAdmin(ctx)
	if err != nil {
		t.Fatalf("store admin failed: %v", err)
	}
	for _, item := range adminData.Items {
		if item.ID == "makeup-card-1" {
			t.Fatalf("管理员删除的默认商品被静默种回（管理端）")
		}
	}

	var count int64
	if err := service.db.QueryRow(ctx, `SELECT count(*) FROM store_items WHERE id = 'makeup-card-1'`).Scan(&count); err != nil {
		t.Fatalf("query item failed: %v", err)
	}
	if count != 0 {
		t.Fatalf("管理员删除的默认商品在数据库中被静默恢复")
	}
}
