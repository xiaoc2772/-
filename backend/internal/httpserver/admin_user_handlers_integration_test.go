//go:build integration

package httpserver

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"redemption/backend/internal/config"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestAdminUserRoutesListDetailAndAchievements(t *testing.T) {
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

	if _, err := pgmigration.NewRunner(db, httpMigrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	suffix := time.Now().UnixNano() % 1_000_000_000
	userID := int64(91001 + suffix)
	otherUserID := userID + 1
	raffleID := "admin-users-raffle-" + strconv.FormatInt(suffix, 10)
	entryID := "admin-users-entry-" + strconv.FormatInt(suffix, 10)
	exchangeID := "admin-users-exchange-" + strconv.FormatInt(suffix, 10)
	projectID := "admin-users-project-" + strconv.FormatInt(suffix, 10)
	cleanupAdminUsersHTTPTest(t, ctx, db, userID, otherUserID, raffleID, projectID)
	defer cleanupAdminUsersHTTPTest(t, ctx, db, userID, otherUserID, raffleID, projectID)

	now := time.Now()
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES
		   ($1, $2, 'Admin Users Target', $4, now()),
		   ($3, $5, 'Admin Users Other', $4 - interval '1 hour', now())`,
		userID,
		"admin_users_target_"+strconv.FormatInt(suffix, 10),
		otherUserID,
		now,
		"admin_users_other_"+strconv.FormatInt(suffix, 10),
	); err != nil {
		t.Fatalf("seed users failed: %v", err)
	}
	// isNewUser 现仅由领取新人专属项目消耗(7025940),种子领取记录须关联 new_user_only 项目
	if _, err := db.Exec(ctx,
		`INSERT INTO projects (
		   id, name, description, max_claims, claimed_count, codes_count, status,
		   created_at_ms, created_by, reward_type, direct_points, new_user_only, pinned, pinned_at_ms
		 ) VALUES ($1, '商城兑换项', '后台用户测试项目', 10, 1, 10, 'active', $2, 'test', 'direct', 100, true, false, NULL)`,
		projectID,
		now.UnixMilli(),
	); err != nil {
		t.Fatalf("seed project failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO exchange_logs (id, user_id, item_id, item_name, points_cost, value, type, quantity, created_at)
		 VALUES ($1, $2, $3, '商城兑换项', 0, 100, 'project_direct', 1, now())`,
		exchangeID,
		userID,
		projectID,
	); err != nil {
		t.Fatalf("seed exchange log failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO raffles (
		   id, mode, title, description, prizes, trigger_type, threshold, status,
		   participants_count, winners_count, created_by, created_at_ms, updated_at_ms
		 ) VALUES ($1, 'draw', '后台用户抽奖', '详情测试', '[]'::jsonb, 'manual', 1, 'active', 1, 0, 1, $2, $2)`,
		raffleID,
		now.UnixMilli(),
	); err != nil {
		t.Fatalf("seed raffle failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO raffle_entries (id, raffle_id, user_id, username, entry_number, created_at_ms)
		 VALUES ($1, $2, $3, $4, 1, $5)`,
		entryID,
		raffleID,
		userID,
		"admin_users_target_"+strconv.FormatInt(suffix, 10),
		now.UnixMilli(),
	); err != nil {
		t.Fatalf("seed raffle entry failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO user_achievement_grants (
		   user_id, achievement_id, source, granted_at_ms, expires_at_ms, reason,
		   granted_by_username, metadata
		 ) VALUES ($1, 'beginner', 'auto', $2, NULL, 'seed', 'system', '{}'::jsonb)`,
		userID,
		now.UnixMilli(),
	); err != nil {
		t.Fatalf("seed achievement grant failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO user_equipped_achievements (user_id, achievement_id, updated_at_ms)
		 VALUES ($1, 'beginner', $2)`,
		userID,
		now.UnixMilli(),
	); err != nil {
		t.Fatalf("seed equipped achievement failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{
			SessionSecret:  testSessionSecret,
			AdminUsernames: map[string]struct{}{"admin": {}},
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})

	search := "admin_users_target_" + strconv.FormatInt(suffix, 10)
	listRequest := httptest.NewRequest(http.MethodGet, "/api/admin/users?page=1&limit=10&search="+search, nil)
	listRequest.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	listResponse := performRequest(handler, listRequest)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("expected list 200, got %d body=%s", listResponse.Code, listResponse.Body.String())
	}
	var listPayload struct {
		Success bool `json:"success"`
		Users   []struct {
			ID           int64  `json:"id"`
			Username     string `json:"username"`
			ClaimsCount  int64  `json:"claimsCount"`
			LotteryCount int64  `json:"lotteryCount"`
			IsNewUser    bool   `json:"isNewUser"`
		} `json:"users"`
		Pagination struct {
			Total   int64 `json:"total"`
			HasMore bool  `json:"hasMore"`
		} `json:"pagination"`
		Stats struct {
			Total            int64 `json:"total"`
			NewUserCount     int64 `json:"newUserCount"`
			ClaimedUserCount int64 `json:"claimedUserCount"`
		} `json:"stats"`
	}
	if err := json.NewDecoder(listResponse.Body).Decode(&listPayload); err != nil {
		t.Fatalf("decode list response failed: %v", err)
	}
	if !listPayload.Success || len(listPayload.Users) != 1 || listPayload.Users[0].ID != userID {
		t.Fatalf("unexpected list payload: %+v", listPayload)
	}
	if listPayload.Users[0].ClaimsCount != 1 || listPayload.Users[0].LotteryCount != 1 || listPayload.Users[0].IsNewUser {
		t.Fatalf("unexpected list user stats: %+v", listPayload.Users[0])
	}
	if listPayload.Pagination.Total != 1 || listPayload.Pagination.HasMore || listPayload.Stats.Total != 1 || listPayload.Stats.ClaimedUserCount != 1 || listPayload.Stats.NewUserCount != 0 {
		t.Fatalf("unexpected list pagination/stats: %+v", listPayload)
	}

	detailRequest := httptest.NewRequest(http.MethodGet, "/api/admin/users/"+strconv.FormatInt(userID, 10), nil)
	detailRequest.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	detailResponse := performRequest(handler, detailRequest)
	if detailResponse.Code != http.StatusOK {
		t.Fatalf("expected detail 200, got %d body=%s", detailResponse.Code, detailResponse.Body.String())
	}
	var detailPayload struct {
		Success bool `json:"success"`
		Claims  []struct {
			ID          string `json:"id"`
			ProjectName string `json:"projectName"`
		} `json:"claims"`
		LotteryRecords []struct {
			ID       string `json:"id"`
			OderID   string `json:"oderId"`
			TierName string `json:"tierName"`
		} `json:"lotteryRecords"`
		Achievements []struct {
			ID         string `json:"id"`
			UnlockMode string `json:"unlockMode"`
			Unlocked   bool   `json:"unlocked"`
			Equipped   bool   `json:"equipped"`
		} `json:"achievements"`
	}
	if err := json.NewDecoder(detailResponse.Body).Decode(&detailPayload); err != nil {
		t.Fatalf("decode detail response failed: %v", err)
	}
	if !detailPayload.Success || len(detailPayload.Claims) != 1 || detailPayload.Claims[0].ProjectName != "商城兑换项" {
		t.Fatalf("unexpected detail claims: %+v", detailPayload)
	}
	if len(detailPayload.LotteryRecords) != 1 || detailPayload.LotteryRecords[0].OderID != raffleID || detailPayload.LotteryRecords[0].TierName != "后台用户抽奖" {
		t.Fatalf("unexpected detail lottery records: %+v", detailPayload.LotteryRecords)
	}
	if !hasAchievementState(detailPayload.Achievements, "beginner", true, true) || !hasAchievementState(detailPayload.Achievements, "contributor", false, false) {
		t.Fatalf("unexpected initial achievements: %+v", detailPayload.Achievements)
	}

	unsupportedRequest := httptest.NewRequest(http.MethodPost, "/api/admin/users/"+strconv.FormatInt(userID, 10)+"/achievements", strings.NewReader(`{"achievementId":"beginner","action":"grant"}`))
	unsupportedRequest.Host = "example.com"
	unsupportedRequest.Header.Set("Origin", "http://example.com")
	unsupportedRequest.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	unsupportedResponse := performRequest(handler, unsupportedRequest)
	if unsupportedResponse.Code != http.StatusBadRequest || !strings.Contains(unsupportedResponse.Body.String(), "该成就不支持手动颁发") {
		t.Fatalf("expected unsupported achievement 400, got %d body=%s", unsupportedResponse.Code, unsupportedResponse.Body.String())
	}

	grantRequest := httptest.NewRequest(http.MethodPost, "/api/admin/users/"+strconv.FormatInt(userID, 10)+"/achievements", strings.NewReader(`{"achievementId":"contributor","action":"grant","reason":"integration"}`))
	grantRequest.Host = "example.com"
	grantRequest.Header.Set("Origin", "http://example.com")
	grantRequest.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	grantResponse := performRequest(handler, grantRequest)
	if grantResponse.Code != http.StatusOK {
		t.Fatalf("expected grant 200, got %d body=%s", grantResponse.Code, grantResponse.Body.String())
	}
	var grantPayload struct {
		Success      bool `json:"success"`
		Achievements []struct {
			ID       string `json:"id"`
			Unlocked bool   `json:"unlocked"`
		} `json:"achievements"`
	}
	if err := json.NewDecoder(grantResponse.Body).Decode(&grantPayload); err != nil {
		t.Fatalf("decode grant response failed: %v", err)
	}
	if !grantPayload.Success || !hasUnlockedAchievement(grantPayload.Achievements, "contributor") {
		t.Fatalf("unexpected grant payload: %+v", grantPayload)
	}

	revokeRequest := httptest.NewRequest(http.MethodPost, "/api/admin/users/"+strconv.FormatInt(userID, 10)+"/achievements", strings.NewReader(`{"achievementId":"contributor","action":"revoke"}`))
	revokeRequest.Host = "example.com"
	revokeRequest.Header.Set("Origin", "http://example.com")
	revokeRequest.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	revokeResponse := performRequest(handler, revokeRequest)
	if revokeResponse.Code != http.StatusOK {
		t.Fatalf("expected revoke 200, got %d body=%s", revokeResponse.Code, revokeResponse.Body.String())
	}
	var remaining int64
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*)
		   FROM user_achievement_grants
		  WHERE user_id = $1 AND achievement_id = 'contributor'`,
		userID,
	).Scan(&remaining); err != nil {
		t.Fatalf("query contributor grant failed: %v", err)
	}
	if remaining != 0 {
		t.Fatalf("contributor grant should be removed, got %d", remaining)
	}
}

func cleanupAdminUsersHTTPTest(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64, otherUserID int64, raffleID string, projectID string) {
	t.Helper()
	_, _ = db.Exec(ctx, `DELETE FROM user_achievement_grants WHERE user_id IN ($1, $2)`, userID, otherUserID)
	_, _ = db.Exec(ctx, `DELETE FROM user_equipped_achievements WHERE user_id IN ($1, $2)`, userID, otherUserID)
	_, _ = db.Exec(ctx, `DELETE FROM user_forced_achievements WHERE user_id IN ($1, $2)`, userID, otherUserID)
	_, _ = db.Exec(ctx, `DELETE FROM exchange_logs WHERE user_id IN ($1, $2)`, userID, otherUserID)
	_, _ = db.Exec(ctx, `DELETE FROM projects WHERE id = $1`, projectID)
	_, _ = db.Exec(ctx, `DELETE FROM raffle_entries WHERE raffle_id = $1`, raffleID)
	_, _ = db.Exec(ctx, `DELETE FROM raffles WHERE id = $1`, raffleID)
	_, _ = db.Exec(ctx, `DELETE FROM point_accounts WHERE user_id IN ($1, $2)`, userID, otherUserID)
	_, _ = db.Exec(ctx, `DELETE FROM users WHERE id IN ($1, $2)`, userID, otherUserID)
}

func hasAchievementState(items []struct {
	ID         string `json:"id"`
	UnlockMode string `json:"unlockMode"`
	Unlocked   bool   `json:"unlocked"`
	Equipped   bool   `json:"equipped"`
}, id string, unlocked bool, equipped bool) bool {
	for _, item := range items {
		if item.ID == id {
			return item.Unlocked == unlocked && item.Equipped == equipped
		}
	}
	return false
}

func hasUnlockedAchievement(items []struct {
	ID       string `json:"id"`
	Unlocked bool   `json:"unlocked"`
}, id string) bool {
	for _, item := range items {
		if item.ID == id {
			return item.Unlocked
		}
	}
	return false
}
