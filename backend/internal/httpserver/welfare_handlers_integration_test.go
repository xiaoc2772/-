//go:build integration

package httpserver

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"redemption/backend/internal/config"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"
	"redemption/backend/internal/welfare"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

func TestRaffleJoinRouteDrawsAndDeliversThresholdRaffle(t *testing.T) {
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

	suffix := time.Now().UnixNano()
	raffleID := "http-join-raffle-" + time.Now().Format("20060102150405") + "-" + stringID(suffix)
	userID := int64(16001 + suffix%1_000_000_000)
	if _, err := db.Exec(ctx,
		`INSERT INTO raffles (
		   id, mode, title, description, prizes, trigger_type, threshold, status,
		   participants_count, winners_count, created_by, created_at_ms, updated_at_ms
		 ) VALUES ($1, 'draw', 'HTTP 抽奖', 'HTTP 测试',
		           '[{"id":"p1","name":"10积分","points":10,"quantity":1}]'::jsonb,
		           'threshold', 1, 'active', 0, 0, 0, $2, $2)`,
		raffleID,
		time.Now().UnixMilli(),
	); err != nil {
		t.Fatalf("seed raffle failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodPost, "/api/raffle/"+raffleID+"/join", nil)
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(userID, "join_user", "Join User"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success    bool                 `json:"success"`
		Message    string               `json:"message"`
		ShouldDraw bool                 `json:"shouldDraw"`
		Entry      *welfare.RaffleEntry `json:"entry"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || !payload.ShouldDraw || payload.Entry == nil || payload.Entry.UserID != userID {
		t.Fatalf("unexpected join response: %+v", payload)
	}

	var status string
	var winnersCount int64
	var winnersRaw []byte
	if err := db.QueryRow(ctx,
		`SELECT status, winners_count, winners FROM raffles WHERE id = $1`,
		raffleID,
	).Scan(&status, &winnersCount, &winnersRaw); err != nil {
		t.Fatalf("query raffle failed: %v", err)
	}
	if status != "ended" || winnersCount != 1 {
		t.Fatalf("raffle should be ended with one winner, status=%s winners=%d", status, winnersCount)
	}

	var winners []welfare.RaffleWinner
	if err := json.Unmarshal(winnersRaw, &winners); err != nil {
		t.Fatalf("decode winners failed: %v", err)
	}
	if len(winners) != 1 || winners[0].UserID != userID || winners[0].RewardStatus != "pending" {
		t.Fatalf("winner should be pending before queue processing: %+v", winners)
	}

	queueResult, err := welfare.NewService(db).ProcessRaffleDeliveryQueue(ctx, 1)
	if err != nil {
		t.Fatalf("process raffle delivery queue failed: %v", err)
	}
	if !queueResult.Success || queueResult.ProcessedJobs != 1 || queueResult.Delivered != 1 {
		t.Fatalf("unexpected queue result: %+v", queueResult)
	}

	var balance int64
	if err := db.QueryRow(ctx,
		`SELECT balance FROM point_accounts WHERE user_id = $1`,
		userID,
	).Scan(&balance); err != nil {
		t.Fatalf("query point balance failed: %v", err)
	}
	if balance != 10 {
		t.Fatalf("expected delivered balance 10, got %d", balance)
	}
}

func TestRaffleJoinRouteRejectsRevokedSession(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	redisURL := os.Getenv("TEST_REDIS_URL")
	if databaseURL == "" || redisURL == "" {
		t.Skip("TEST_DATABASE_URL 或 TEST_REDIS_URL 未设置，跳过集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, httpMigrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	options, err := redis.ParseURL(redisURL)
	if err != nil {
		t.Fatalf("parse redis url failed: %v", err)
	}
	client := redis.NewClient(options)
	defer client.Close()

	suffix := time.Now().UnixNano()
	raffleID := "http-join-revoked-" + stringID(suffix)
	userID := int64(17001 + suffix%1_000_000_000)
	if _, err := db.Exec(ctx,
		`INSERT INTO raffles (
		   id, mode, title, description, prizes, trigger_type, threshold, status,
		   participants_count, winners_count, created_by, created_at_ms, updated_at_ms
		 ) VALUES ($1, 'draw', '撤销会话测试', '撤销会话测试',
		           '[{"id":"p1","name":"10积分","points":10,"quantity":1}]'::jsonb,
		           'threshold', 999, 'active', 0, 0, 0, $2, $2)`,
		raffleID,
		time.Now().UnixMilli(),
	); err != nil {
		t.Fatalf("seed raffle failed: %v", err)
	}

	jti := "join-revoked-" + stringID(suffix)
	if err := client.Set(ctx, sessionBlacklistKeyPrefix+jti, "1", time.Minute).Err(); err != nil {
		t.Fatalf("blacklist session failed: %v", err)
	}
	defer func() {
		_ = client.Del(ctx, sessionBlacklistKeyPrefix+jti).Err()
	}()

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
		Redis:  client,
	})
	request := httptest.NewRequest(http.MethodPost, "/api/raffle/"+raffleID+"/join", nil)
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieForWithJTI(userID, "revoked_join_user", "Revoked Join User", jti))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "登录已失效") {
		t.Fatalf("expected revoked session join to be rejected, got status=%d body=%s", response.Code, response.Body.String())
	}

	var entryCount int64
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*) FROM raffle_entries WHERE raffle_id = $1 AND user_id = $2`,
		raffleID,
		userID,
	).Scan(&entryCount); err != nil {
		t.Fatalf("query raffle entries failed: %v", err)
	}
	if entryCount != 0 {
		t.Fatalf("撤销会话不应产生参与记录，实际 %d 条", entryCount)
	}
}

func TestRaffleJoinRouteGrabsRedPacket(t *testing.T) {
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

	suffix := time.Now().UnixNano()
	raffleID := "http-red-packet-" + stringID(suffix)
	userID := int64(18001 + suffix%1_000_000_000)
	if _, err := db.Exec(ctx,
		`INSERT INTO raffles (
		   id, mode, title, description, prizes, trigger_type, threshold, status,
		   participants_count, winners_count, winners, red_packet_total_points,
		   red_packet_total_slots, red_packet_remaining_points, red_packet_remaining_slots,
		   red_packet_packets, created_by, created_at_ms, updated_at_ms
		 ) VALUES ($1, 'red_packet', 'HTTP 红包', 'HTTP 红包测试', '[]'::jsonb, 'manual', 1, 'active',
		           0, 0, '[]'::jsonb, 9, 1, 9, 1, '[9]'::jsonb, 0, $2, $2)`,
		raffleID,
		time.Now().UnixMilli(),
	); err != nil {
		t.Fatalf("seed red packet failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(os.Stderr, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodPost, "/api/raffle/"+raffleID+"/join", nil)
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(userID, "packet_user", "Packet User"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool                  `json:"success"`
		Message string                `json:"message"`
		Entry   *welfare.RaffleEntry  `json:"entry"`
		Reward  *welfare.RaffleWinner `json:"reward"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || payload.Entry == nil || payload.Reward == nil || payload.Reward.Points != 9 || payload.Reward.RewardStatus != "delivered" {
		t.Fatalf("unexpected red packet response: %+v", payload)
	}
	if payload.Message != "抢到 9 积分，已到账" {
		t.Fatalf("unexpected red packet message: %s", payload.Message)
	}

	var status string
	var remainingSlots int64
	var remainingPoints int64
	var balance int64
	if err := db.QueryRow(ctx,
		`SELECT r.status, COALESCE(r.red_packet_remaining_slots, 0), COALESCE(r.red_packet_remaining_points, 0), p.balance
		 FROM raffles r
		 JOIN point_accounts p ON p.user_id = $2
		 WHERE r.id = $1`,
		raffleID,
		userID,
	).Scan(&status, &remainingSlots, &remainingPoints, &balance); err != nil {
		t.Fatalf("query red packet result failed: %v", err)
	}
	if status != "ended" || remainingSlots != 0 || remainingPoints != 0 || balance != 9 {
		t.Fatalf("unexpected red packet state status=%s slots=%d points=%d balance=%d", status, remainingSlots, remainingPoints, balance)
	}
}

func TestAdminRaffleReadRoutesExposeDraftsAndEntries(t *testing.T) {
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

	suffix := time.Now().UnixNano()
	draftID := "http-admin-list-draft-" + stringID(suffix)
	activeID := "http-admin-detail-active-" + stringID(suffix)
	entryID := "http-admin-detail-entry-" + stringID(suffix)
	userID := int64(19501 + suffix%1_000_000_000)
	if _, err := db.Exec(ctx,
		`INSERT INTO raffles (
		   id, mode, title, description, prizes, trigger_type, threshold, status,
		   participants_count, winners_count, created_by, created_at_ms, updated_at_ms
		 ) VALUES ($1, 'draw', '后台草稿', '后台草稿描述',
		           '[{"id":"p1","name":"草稿积分","points":5,"quantity":1}]'::jsonb,
		           'manual', 1, 'draft', 0, 0, 7, $2, $2)`,
		draftID,
		time.Now().UnixMilli(),
	); err != nil {
		t.Fatalf("seed draft raffle failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO raffles (
		   id, mode, title, description, prizes, trigger_type, threshold, status,
		   participants_count, winners_count, created_by, created_at_ms, updated_at_ms
		 ) VALUES ($1, 'draw', '后台详情', '后台详情描述',
		           '[{"id":"p1","name":"详情积分","points":8,"quantity":1}]'::jsonb,
		           'threshold', 2, 'active', 1, 0, 9, $2, $2)`,
		activeID,
		time.Now().UnixMilli(),
	); err != nil {
		t.Fatalf("seed active raffle failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO raffle_entries (id, raffle_id, user_id, username, entry_number, created_at_ms)
		 VALUES ($1, $2, $3, 'admin_reader', 1, $4)`,
		entryID,
		activeID,
		userID,
		time.Now().UnixMilli(),
	); err != nil {
		t.Fatalf("seed entry failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{
			SessionSecret:  testSessionSecret,
			AdminUsernames: map[string]struct{}{"admin": {}},
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})

	listRequest := httptest.NewRequest(http.MethodGet, "/api/admin/raffle?status=draft", nil)
	listRequest.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	listResponse := httptest.NewRecorder()
	handler.ServeHTTP(listResponse, listRequest)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", listResponse.Code, listResponse.Body.String())
	}
	var listPayload struct {
		Success bool                  `json:"success"`
		Raffles []welfare.AdminRaffle `json:"raffles"`
	}
	if err := json.Unmarshal(listResponse.Body.Bytes(), &listPayload); err != nil {
		t.Fatalf("decode list response failed: %v", err)
	}
	if !listPayload.Success || !containsAdminRaffle(listPayload.Raffles, draftID) {
		t.Fatalf("admin list should include draft raffle: %+v", listPayload)
	}

	detailRequest := httptest.NewRequest(http.MethodGet, "/api/admin/raffle/"+activeID, nil)
	detailRequest.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	detailResponse := httptest.NewRecorder()
	handler.ServeHTTP(detailResponse, detailRequest)
	if detailResponse.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", detailResponse.Code, detailResponse.Body.String())
	}
	var detailPayload struct {
		Success bool                  `json:"success"`
		Raffle  welfare.AdminRaffle   `json:"raffle"`
		Entries []welfare.RaffleEntry `json:"entries"`
	}
	if err := json.Unmarshal(detailResponse.Body.Bytes(), &detailPayload); err != nil {
		t.Fatalf("decode detail response failed: %v", err)
	}
	if !detailPayload.Success || detailPayload.Raffle.ID != activeID || detailPayload.Raffle.CreatedBy != 9 || len(detailPayload.Entries) != 1 || detailPayload.Entries[0].UserID != userID {
		t.Fatalf("unexpected admin detail response: %+v", detailPayload)
	}
}

func TestAdminRaffleCreateRouteCreatesDrawAndRedPacketDrafts(t *testing.T) {
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

	handler := New(Dependencies{
		Config: config.Config{
			SessionSecret:  testSessionSecret,
			AdminUsernames: map[string]struct{}{"admin": {}},
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})

	drawBody := `{"title":"后台创建普通抽奖","description":"普通抽奖说明","triggerType":"threshold","threshold":2,"prizes":[{"name":"10积分","points":10,"quantity":1}]}`
	drawResponse := performAdminJSONRequest(handler, http.MethodPost, "/api/admin/raffle", drawBody)
	if drawResponse.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", drawResponse.Code, drawResponse.Body.String())
	}
	var drawPayload struct {
		Success bool                `json:"success"`
		Message string              `json:"message"`
		Raffle  welfare.AdminRaffle `json:"raffle"`
	}
	if err := json.Unmarshal(drawResponse.Body.Bytes(), &drawPayload); err != nil {
		t.Fatalf("decode draw response failed: %v", err)
	}
	if !drawPayload.Success || drawPayload.Message != "活动创建成功" || drawPayload.Raffle.ID == "" || drawPayload.Raffle.Status != "draft" || drawPayload.Raffle.Mode != "draw" || drawPayload.Raffle.CreatedBy != 1 {
		t.Fatalf("unexpected draw create response: %+v", drawPayload)
	}
	var drawPrizes []welfare.AdminRafflePrizeInput
	if err := json.Unmarshal(drawPayload.Raffle.Prizes, &drawPrizes); err != nil {
		t.Fatalf("decode draw prizes failed: %v", err)
	}
	if len(drawPrizes) != 1 || drawPrizes[0].Name != "10积分" || drawPrizes[0].Quantity != 1 {
		t.Fatalf("unexpected draw prizes: %+v", drawPrizes)
	}

	packetBody := `{"mode":"red_packet","title":"后台创建红包","description":"红包说明","redPacketTotalPoints":9,"redPacketTotalSlots":3}`
	packetResponse := performAdminJSONRequest(handler, http.MethodPost, "/api/admin/raffle", packetBody)
	if packetResponse.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", packetResponse.Code, packetResponse.Body.String())
	}
	var packetPayload struct {
		Success bool                `json:"success"`
		Raffle  welfare.AdminRaffle `json:"raffle"`
	}
	if err := json.Unmarshal(packetResponse.Body.Bytes(), &packetPayload); err != nil {
		t.Fatalf("decode packet response failed: %v", err)
	}
	if !packetPayload.Success || packetPayload.Raffle.Status != "draft" || packetPayload.Raffle.Mode != "red_packet" || packetPayload.Raffle.RedPacketTotalPoints == nil || *packetPayload.Raffle.RedPacketTotalPoints != 9 || packetPayload.Raffle.RedPacketTotalSlots == nil || *packetPayload.Raffle.RedPacketTotalSlots != 3 {
		t.Fatalf("unexpected red packet create response: %+v", packetPayload)
	}
	if string(packetPayload.Raffle.Prizes) != "[]" || string(packetPayload.Raffle.RedPacketPackets) != "[]" {
		t.Fatalf("red packet draft should have empty prizes and packets: prizes=%s packets=%s", string(packetPayload.Raffle.Prizes), string(packetPayload.Raffle.RedPacketPackets))
	}
}

func TestAdminRaffleUpdateRouteUpdatesDraftAndRejectsActive(t *testing.T) {
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

	handler := New(Dependencies{
		Config: config.Config{
			SessionSecret:  testSessionSecret,
			AdminUsernames: map[string]struct{}{"admin": {}},
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})

	createBody := `{"title":"待更新普通抽奖","description":"普通抽奖说明","triggerType":"threshold","threshold":2,"prizes":[{"name":"10积分","points":10,"quantity":1}]}`
	createResponse := performAdminJSONRequest(handler, http.MethodPost, "/api/admin/raffle", createBody)
	if createResponse.Code != http.StatusOK {
		t.Fatalf("expected create 200, got %d body=%s", createResponse.Code, createResponse.Body.String())
	}
	var createPayload struct {
		Raffle welfare.AdminRaffle `json:"raffle"`
	}
	if err := json.Unmarshal(createResponse.Body.Bytes(), &createPayload); err != nil {
		t.Fatalf("decode create response failed: %v", err)
	}

	updateDrawBody := `{"title":"已更新普通抽奖","description":"更新后的说明","mode":"draw","triggerType":"manual","prizes":[{"name":"20积分","points":20,"quantity":2}]}`
	updateDrawResponse := performAdminJSONRequest(handler, http.MethodPut, "/api/admin/raffle/"+createPayload.Raffle.ID, updateDrawBody)
	if updateDrawResponse.Code != http.StatusOK {
		t.Fatalf("expected update draw 200, got %d body=%s", updateDrawResponse.Code, updateDrawResponse.Body.String())
	}
	var updateDrawPayload struct {
		Success bool                `json:"success"`
		Message string              `json:"message"`
		Raffle  welfare.AdminRaffle `json:"raffle"`
	}
	if err := json.Unmarshal(updateDrawResponse.Body.Bytes(), &updateDrawPayload); err != nil {
		t.Fatalf("decode update draw response failed: %v", err)
	}
	if !updateDrawPayload.Success || updateDrawPayload.Message != "更新成功" || updateDrawPayload.Raffle.Title != "已更新普通抽奖" || updateDrawPayload.Raffle.Mode != "draw" || updateDrawPayload.Raffle.TriggerType != "manual" || updateDrawPayload.Raffle.Status != "draft" {
		t.Fatalf("unexpected update draw response: %+v", updateDrawPayload)
	}
	var updatedPrizes []welfare.AdminRafflePrizeInput
	if err := json.Unmarshal(updateDrawPayload.Raffle.Prizes, &updatedPrizes); err != nil {
		t.Fatalf("decode updated prizes failed: %v", err)
	}
	if len(updatedPrizes) != 1 || updatedPrizes[0].Name != "20积分" || updatedPrizes[0].Quantity != 2 {
		t.Fatalf("unexpected updated prizes: %+v", updatedPrizes)
	}

	updatePacketBody := `{"title":"已切换红包","description":"红包说明","mode":"red_packet","redPacketTotalPoints":15,"redPacketTotalSlots":5}`
	updatePacketResponse := performAdminJSONRequest(handler, http.MethodPut, "/api/admin/raffle/"+createPayload.Raffle.ID, updatePacketBody)
	if updatePacketResponse.Code != http.StatusOK {
		t.Fatalf("expected update packet 200, got %d body=%s", updatePacketResponse.Code, updatePacketResponse.Body.String())
	}
	var updatePacketPayload struct {
		Success bool                `json:"success"`
		Raffle  welfare.AdminRaffle `json:"raffle"`
	}
	if err := json.Unmarshal(updatePacketResponse.Body.Bytes(), &updatePacketPayload); err != nil {
		t.Fatalf("decode update packet response failed: %v", err)
	}
	if !updatePacketPayload.Success || updatePacketPayload.Raffle.Mode != "red_packet" || updatePacketPayload.Raffle.TriggerType != "manual" || updatePacketPayload.Raffle.Threshold != 5 || updatePacketPayload.Raffle.RedPacketTotalPoints == nil || *updatePacketPayload.Raffle.RedPacketTotalPoints != 15 || updatePacketPayload.Raffle.RedPacketTotalSlots == nil || *updatePacketPayload.Raffle.RedPacketTotalSlots != 5 {
		t.Fatalf("unexpected update packet response: %+v", updatePacketPayload)
	}
	if string(updatePacketPayload.Raffle.Prizes) != "[]" || string(updatePacketPayload.Raffle.RedPacketPackets) != "[]" {
		t.Fatalf("red packet draft should reset prizes and packets: prizes=%s packets=%s", string(updatePacketPayload.Raffle.Prizes), string(updatePacketPayload.Raffle.RedPacketPackets))
	}

	publishResponse := performAdminJSONRequest(handler, http.MethodPost, "/api/admin/raffle/"+createPayload.Raffle.ID+"/publish", "")
	if publishResponse.Code != http.StatusOK {
		t.Fatalf("expected publish 200, got %d body=%s", publishResponse.Code, publishResponse.Body.String())
	}
	activeUpdateResponse := performAdminJSONRequest(handler, http.MethodPut, "/api/admin/raffle/"+createPayload.Raffle.ID, `{"title":"不能更新"}`)
	if activeUpdateResponse.Code != http.StatusBadRequest || !strings.Contains(activeUpdateResponse.Body.String(), "只能修改草稿状态的活动") {
		t.Fatalf("expected active update 400, got %d body=%s", activeUpdateResponse.Code, activeUpdateResponse.Body.String())
	}
}

func TestAdminRafflePublishRoutePublishesDrawAndRedPacketDrafts(t *testing.T) {
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

	handler := New(Dependencies{
		Config: config.Config{
			SessionSecret:  testSessionSecret,
			AdminUsernames: map[string]struct{}{"admin": {}},
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})

	drawBody := `{"title":"待发布普通抽奖","description":"普通抽奖说明","triggerType":"threshold","threshold":2,"prizes":[{"name":"10积分","points":10,"quantity":2}]}`
	drawCreateResponse := performAdminJSONRequest(handler, http.MethodPost, "/api/admin/raffle", drawBody)
	if drawCreateResponse.Code != http.StatusOK {
		t.Fatalf("expected create draw 200, got %d body=%s", drawCreateResponse.Code, drawCreateResponse.Body.String())
	}
	var drawCreatePayload struct {
		Raffle welfare.AdminRaffle `json:"raffle"`
	}
	if err := json.Unmarshal(drawCreateResponse.Body.Bytes(), &drawCreatePayload); err != nil {
		t.Fatalf("decode draw create response failed: %v", err)
	}

	drawPublishResponse := performAdminJSONRequest(handler, http.MethodPost, "/api/admin/raffle/"+drawCreatePayload.Raffle.ID+"/publish", "")
	if drawPublishResponse.Code != http.StatusOK {
		t.Fatalf("expected publish draw 200, got %d body=%s", drawPublishResponse.Code, drawPublishResponse.Body.String())
	}
	var drawPublishPayload struct {
		Success bool                `json:"success"`
		Message string              `json:"message"`
		Raffle  welfare.AdminRaffle `json:"raffle"`
	}
	if err := json.Unmarshal(drawPublishResponse.Body.Bytes(), &drawPublishPayload); err != nil {
		t.Fatalf("decode draw publish response failed: %v", err)
	}
	if !drawPublishPayload.Success || drawPublishPayload.Message != "活动已发布" || drawPublishPayload.Raffle.Status != "active" || drawPublishPayload.Raffle.Mode != "draw" {
		t.Fatalf("unexpected draw publish response: %+v", drawPublishPayload)
	}

	repeatPublishResponse := performAdminJSONRequest(handler, http.MethodPost, "/api/admin/raffle/"+drawCreatePayload.Raffle.ID+"/publish", "")
	if repeatPublishResponse.Code != http.StatusBadRequest || !strings.Contains(repeatPublishResponse.Body.String(), "只能发布草稿状态的活动") {
		t.Fatalf("expected repeat publish 400, got %d body=%s", repeatPublishResponse.Code, repeatPublishResponse.Body.String())
	}

	packetBody := `{"mode":"red_packet","title":"待发布红包","description":"红包说明","redPacketTotalPoints":12,"redPacketTotalSlots":4}`
	packetCreateResponse := performAdminJSONRequest(handler, http.MethodPost, "/api/admin/raffle", packetBody)
	if packetCreateResponse.Code != http.StatusOK {
		t.Fatalf("expected create packet 200, got %d body=%s", packetCreateResponse.Code, packetCreateResponse.Body.String())
	}
	var packetCreatePayload struct {
		Raffle welfare.AdminRaffle `json:"raffle"`
	}
	if err := json.Unmarshal(packetCreateResponse.Body.Bytes(), &packetCreatePayload); err != nil {
		t.Fatalf("decode packet create response failed: %v", err)
	}

	packetPublishResponse := performAdminJSONRequest(handler, http.MethodPost, "/api/admin/raffle/"+packetCreatePayload.Raffle.ID+"/publish", "")
	if packetPublishResponse.Code != http.StatusOK {
		t.Fatalf("expected publish packet 200, got %d body=%s", packetPublishResponse.Code, packetPublishResponse.Body.String())
	}
	var packetPublishPayload struct {
		Success bool                `json:"success"`
		Raffle  welfare.AdminRaffle `json:"raffle"`
	}
	if err := json.Unmarshal(packetPublishResponse.Body.Bytes(), &packetPublishPayload); err != nil {
		t.Fatalf("decode packet publish response failed: %v", err)
	}
	if !packetPublishPayload.Success || packetPublishPayload.Raffle.Status != "active" || packetPublishPayload.Raffle.Mode != "red_packet" || packetPublishPayload.Raffle.TriggerType != "manual" || packetPublishPayload.Raffle.Threshold != 4 {
		t.Fatalf("unexpected packet publish response: %+v", packetPublishPayload)
	}
	if packetPublishPayload.Raffle.RedPacketRemainingPoints == nil || *packetPublishPayload.Raffle.RedPacketRemainingPoints != 12 || packetPublishPayload.Raffle.RedPacketRemainingSlots == nil || *packetPublishPayload.Raffle.RedPacketRemainingSlots != 4 {
		t.Fatalf("unexpected packet remaining state: %+v", packetPublishPayload.Raffle)
	}
	var packets []int64
	if err := json.Unmarshal(packetPublishPayload.Raffle.RedPacketPackets, &packets); err != nil {
		t.Fatalf("decode red packet packets failed: %v", err)
	}
	if len(packets) != 4 || sumInt64(packets) != 12 {
		t.Fatalf("unexpected red packet packets: %+v", packets)
	}
	if string(packetPublishPayload.Raffle.Prizes) != "[]" {
		t.Fatalf("red packet publish should keep empty prizes: %s", string(packetPublishPayload.Raffle.Prizes))
	}
}

func TestAdminRaffleCancelRouteCancelsActiveAndRejectsEnded(t *testing.T) {
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

	handler := New(Dependencies{
		Config: config.Config{
			SessionSecret:  testSessionSecret,
			AdminUsernames: map[string]struct{}{"admin": {}},
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})

	drawBody := `{"title":"待取消抽奖","description":"普通抽奖说明","triggerType":"manual","prizes":[{"name":"10积分","points":10,"quantity":1}]}`
	createResponse := performAdminJSONRequest(handler, http.MethodPost, "/api/admin/raffle", drawBody)
	if createResponse.Code != http.StatusOK {
		t.Fatalf("expected create 200, got %d body=%s", createResponse.Code, createResponse.Body.String())
	}
	var createPayload struct {
		Raffle welfare.AdminRaffle `json:"raffle"`
	}
	if err := json.Unmarshal(createResponse.Body.Bytes(), &createPayload); err != nil {
		t.Fatalf("decode create response failed: %v", err)
	}
	publishResponse := performAdminJSONRequest(handler, http.MethodPost, "/api/admin/raffle/"+createPayload.Raffle.ID+"/publish", "")
	if publishResponse.Code != http.StatusOK {
		t.Fatalf("expected publish 200, got %d body=%s", publishResponse.Code, publishResponse.Body.String())
	}

	cancelResponse := performAdminJSONRequest(handler, http.MethodPost, "/api/admin/raffle/"+createPayload.Raffle.ID+"/cancel", "")
	if cancelResponse.Code != http.StatusOK {
		t.Fatalf("expected cancel 200, got %d body=%s", cancelResponse.Code, cancelResponse.Body.String())
	}
	var cancelPayload struct {
		Success bool                `json:"success"`
		Message string              `json:"message"`
		Raffle  welfare.AdminRaffle `json:"raffle"`
	}
	if err := json.Unmarshal(cancelResponse.Body.Bytes(), &cancelPayload); err != nil {
		t.Fatalf("decode cancel response failed: %v", err)
	}
	if !cancelPayload.Success || cancelPayload.Message != "活动已取消" || cancelPayload.Raffle.Status != "cancelled" {
		t.Fatalf("unexpected cancel response: %+v", cancelPayload)
	}

	suffix := time.Now().UnixNano()
	endedID := "http-admin-cancel-ended-" + stringID(suffix)
	if _, err := db.Exec(ctx,
		`INSERT INTO raffles (
		   id, mode, title, description, prizes, trigger_type, threshold, status,
		   participants_count, winners_count, winners, created_by, created_at_ms, updated_at_ms
		 ) VALUES ($1, 'draw', '已结束抽奖', '不能取消',
		           '[{"id":"p1","name":"10积分","points":10,"quantity":1}]'::jsonb,
		           'manual', 1, 'ended', 0, 0, '[]'::jsonb, 1, $2, $2)`,
		endedID,
		time.Now().UnixMilli(),
	); err != nil {
		t.Fatalf("seed ended raffle failed: %v", err)
	}
	endedCancelResponse := performAdminJSONRequest(handler, http.MethodPost, "/api/admin/raffle/"+endedID+"/cancel", "")
	if endedCancelResponse.Code != http.StatusBadRequest || !strings.Contains(endedCancelResponse.Body.String(), "已结束的活动无法取消") {
		t.Fatalf("expected ended cancel 400, got %d body=%s", endedCancelResponse.Code, endedCancelResponse.Body.String())
	}
}

func TestAdminRaffleDeleteRouteDeletesDraftAndCancelledButRejectsActive(t *testing.T) {
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

	handler := New(Dependencies{
		Config: config.Config{
			SessionSecret:  testSessionSecret,
			AdminUsernames: map[string]struct{}{"admin": {}},
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})

	draftBody := `{"title":"待删除草稿","description":"普通抽奖说明","triggerType":"manual","prizes":[{"name":"10积分","points":10,"quantity":1}]}`
	draftCreateResponse := performAdminJSONRequest(handler, http.MethodPost, "/api/admin/raffle", draftBody)
	if draftCreateResponse.Code != http.StatusOK {
		t.Fatalf("expected draft create 200, got %d body=%s", draftCreateResponse.Code, draftCreateResponse.Body.String())
	}
	var draftCreatePayload struct {
		Raffle welfare.AdminRaffle `json:"raffle"`
	}
	if err := json.Unmarshal(draftCreateResponse.Body.Bytes(), &draftCreatePayload); err != nil {
		t.Fatalf("decode draft create response failed: %v", err)
	}

	draftDeleteResponse := performAdminJSONRequest(handler, http.MethodDelete, "/api/admin/raffle/"+draftCreatePayload.Raffle.ID, "")
	if draftDeleteResponse.Code != http.StatusOK || !strings.Contains(draftDeleteResponse.Body.String(), "删除成功") {
		t.Fatalf("expected draft delete 200, got %d body=%s", draftDeleteResponse.Code, draftDeleteResponse.Body.String())
	}
	if countRafflesByID(ctx, t, db, draftCreatePayload.Raffle.ID) != 0 {
		t.Fatalf("draft raffle should be deleted")
	}

	activeBody := `{"title":"待删除进行中","description":"普通抽奖说明","triggerType":"manual","prizes":[{"name":"10积分","points":10,"quantity":1}]}`
	activeCreateResponse := performAdminJSONRequest(handler, http.MethodPost, "/api/admin/raffle", activeBody)
	if activeCreateResponse.Code != http.StatusOK {
		t.Fatalf("expected active create 200, got %d body=%s", activeCreateResponse.Code, activeCreateResponse.Body.String())
	}
	var activeCreatePayload struct {
		Raffle welfare.AdminRaffle `json:"raffle"`
	}
	if err := json.Unmarshal(activeCreateResponse.Body.Bytes(), &activeCreatePayload); err != nil {
		t.Fatalf("decode active create response failed: %v", err)
	}
	publishResponse := performAdminJSONRequest(handler, http.MethodPost, "/api/admin/raffle/"+activeCreatePayload.Raffle.ID+"/publish", "")
	if publishResponse.Code != http.StatusOK {
		t.Fatalf("expected publish 200, got %d body=%s", publishResponse.Code, publishResponse.Body.String())
	}
	activeDeleteResponse := performAdminJSONRequest(handler, http.MethodDelete, "/api/admin/raffle/"+activeCreatePayload.Raffle.ID, "")
	if activeDeleteResponse.Code != http.StatusBadRequest || !strings.Contains(activeDeleteResponse.Body.String(), "只能删除草稿或已取消的活动") {
		t.Fatalf("expected active delete 400, got %d body=%s", activeDeleteResponse.Code, activeDeleteResponse.Body.String())
	}
	if countRafflesByID(ctx, t, db, activeCreatePayload.Raffle.ID) != 1 {
		t.Fatalf("active raffle should still exist after rejected delete")
	}

	cancelResponse := performAdminJSONRequest(handler, http.MethodPost, "/api/admin/raffle/"+activeCreatePayload.Raffle.ID+"/cancel", "")
	if cancelResponse.Code != http.StatusOK {
		t.Fatalf("expected cancel 200, got %d body=%s", cancelResponse.Code, cancelResponse.Body.String())
	}
	cancelledDeleteResponse := performAdminJSONRequest(handler, http.MethodDelete, "/api/admin/raffle/"+activeCreatePayload.Raffle.ID, "")
	if cancelledDeleteResponse.Code != http.StatusOK {
		t.Fatalf("expected cancelled delete 200, got %d body=%s", cancelledDeleteResponse.Code, cancelledDeleteResponse.Body.String())
	}
	if countRafflesByID(ctx, t, db, activeCreatePayload.Raffle.ID) != 0 {
		t.Fatalf("cancelled raffle should be deleted")
	}
}

func TestAdminRaffleDrawRouteDrawsAndDelivers(t *testing.T) {
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

	suffix := time.Now().UnixNano()
	raffleID := "http-admin-draw-raffle-" + stringID(suffix)
	userID := int64(17001 + suffix%1_000_000_000)
	entryID := "http-admin-draw-entry-" + stringID(suffix)
	if _, err := db.Exec(ctx,
		`INSERT INTO raffles (
		   id, mode, title, description, prizes, trigger_type, threshold, status,
		   participants_count, winners_count, created_by, created_at_ms, updated_at_ms
		 ) VALUES ($1, 'draw', 'HTTP 管理开奖', 'HTTP 管理测试',
		           '[{"id":"p1","name":"15积分","points":15,"quantity":1}]'::jsonb,
		           'manual', 99, 'active', 1, 0, 0, $2, $2)`,
		raffleID,
		time.Now().UnixMilli(),
	); err != nil {
		t.Fatalf("seed raffle failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO raffle_entries (id, raffle_id, user_id, username, entry_number, created_at_ms)
		 VALUES ($1, $2, $3, 'winner_user', 1, $4)`,
		entryID,
		raffleID,
		userID,
		time.Now().UnixMilli(),
	); err != nil {
		t.Fatalf("seed entry failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{
			SessionSecret:  testSessionSecret,
			AdminUsernames: map[string]struct{}{"admin": {}},
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodPost, "/api/admin/raffle/"+raffleID+"/draw", nil)
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success         bool                               `json:"success"`
		Winners         []welfare.RaffleWinner             `json:"winners"`
		DeliveryResults []welfare.RaffleRewardDeliveryItem `json:"deliveryResults"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || len(payload.Winners) != 1 || len(payload.DeliveryResults) != 1 || !payload.DeliveryResults[0].Success {
		t.Fatalf("unexpected admin draw response: %+v", payload)
	}

	var status string
	var balance int64
	if err := db.QueryRow(ctx,
		`SELECT r.status, p.balance
		 FROM raffles r
		 JOIN point_accounts p ON p.user_id = $2
		 WHERE r.id = $1`,
		raffleID,
		userID,
	).Scan(&status, &balance); err != nil {
		t.Fatalf("query draw result failed: %v", err)
	}
	if status != "ended" || balance != 15 {
		t.Fatalf("expected ended raffle and balance 15, got status=%s balance=%d", status, balance)
	}
}

func TestAdminRaffleRetryRouteDeliversPendingWinner(t *testing.T) {
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

	suffix := time.Now().UnixNano()
	raffleID := "http-admin-retry-raffle-" + stringID(suffix)
	entryID := "http-admin-retry-entry-" + stringID(suffix)
	userID := int64(19001 + suffix%1_000_000_000)
	if _, err := db.Exec(ctx,
		`INSERT INTO raffles (
		   id, mode, title, description, prizes, trigger_type, threshold, status,
		   participants_count, winners_count, winners, drawn_at_ms, created_by, created_at_ms, updated_at_ms
		 ) VALUES ($1, 'draw', 'HTTP 重试发奖', 'HTTP 重试测试',
		           '[{"id":"p1","name":"11积分","points":11,"quantity":1}]'::jsonb,
		           'manual', 99, 'ended', 1, 1,
		           jsonb_build_array(jsonb_build_object(
		             'entryId', $2::text,
		             'userId', $3::bigint,
		             'username', 'retry_user',
		             'prizeId', 'p1',
		             'prizeName', '11积分',
		             'points', 11,
		             'rewardStatus', 'pending'
		           )),
		           $4, 0, $4, $4)`,
		raffleID,
		entryID,
		userID,
		time.Now().UnixMilli(),
	); err != nil {
		t.Fatalf("seed retry raffle failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{
			SessionSecret:  testSessionSecret,
			AdminUsernames: map[string]struct{}{"admin": {}},
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodPost, "/api/admin/raffle/"+raffleID+"/retry", nil)
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success         bool                               `json:"success"`
		DeliveryResults []welfare.RaffleRewardDeliveryItem `json:"deliveryResults"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || len(payload.DeliveryResults) != 1 || !payload.DeliveryResults[0].Success {
		t.Fatalf("unexpected retry response: %+v", payload)
	}

	var balance int64
	var winnersRaw []byte
	if err := db.QueryRow(ctx,
		`SELECT p.balance, r.winners
		 FROM raffles r
		 JOIN point_accounts p ON p.user_id = $2
		 WHERE r.id = $1`,
		raffleID,
		userID,
	).Scan(&balance, &winnersRaw); err != nil {
		t.Fatalf("query retry result failed: %v", err)
	}
	if balance != 11 {
		t.Fatalf("expected balance 11, got %d", balance)
	}
	var winners []welfare.RaffleWinner
	if err := json.Unmarshal(winnersRaw, &winners); err != nil {
		t.Fatalf("decode winners failed: %v", err)
	}
	if len(winners) != 1 || winners[0].RewardStatus != "delivered" || winners[0].DeliveredAt == 0 {
		t.Fatalf("winner should be delivered after retry: %+v", winners)
	}
}

func TestAdminProjectRoutesManageDirectProjects(t *testing.T) {
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

	handler := New(Dependencies{
		Config: config.Config{
			SessionSecret:  testSessionSecret,
			AdminUsernames: map[string]struct{}{"admin": {}},
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})

	createResponse := performAdminFormRequest(handler, http.MethodPost, "/api/admin/projects", url.Values{
		"name":         {"后台直充项目"},
		"description":  {"后台直充说明"},
		"maxClaims":    {"2"},
		"directPoints": {"9"},
		"newUserOnly":  {"true"},
		"autoPauseAt":  {"2026-01-02T03:04"},
	})
	if createResponse.Code != http.StatusOK {
		t.Fatalf("expected create 200, got %d body=%s", createResponse.Code, createResponse.Body.String())
	}
	var createPayload struct {
		Success    bool            `json:"success"`
		Message    string          `json:"message"`
		Project    welfare.Project `json:"project"`
		CodesAdded int64           `json:"codesAdded"`
	}
	if err := json.Unmarshal(createResponse.Body.Bytes(), &createPayload); err != nil {
		t.Fatalf("decode create response failed: %v", err)
	}
	expectedAutoPauseAt := time.Date(2026, 1, 2, 3, 4, 0, 0, time.FixedZone("Asia/Shanghai", 8*60*60)).UTC().UnixMilli()
	if !createPayload.Success || createPayload.Message != "项目创建成功" || createPayload.Project.ID == "" || createPayload.Project.RewardType != "direct" || createPayload.Project.DirectPoints == nil || *createPayload.Project.DirectPoints != 9 || createPayload.Project.CodesCount != 2 || !createPayload.Project.NewUserOnly || createPayload.Project.AutoPauseAt == nil || *createPayload.Project.AutoPauseAt != expectedAutoPauseAt {
		t.Fatalf("unexpected create response: %+v", createPayload)
	}

	listResponse := performAdminJSONRequest(handler, http.MethodGet, "/api/admin/projects", "")
	if listResponse.Code != http.StatusOK {
		t.Fatalf("expected list 200, got %d body=%s", listResponse.Code, listResponse.Body.String())
	}
	var listPayload struct {
		Success  bool              `json:"success"`
		Projects []welfare.Project `json:"projects"`
	}
	if err := json.Unmarshal(listResponse.Body.Bytes(), &listPayload); err != nil {
		t.Fatalf("decode list response failed: %v", err)
	}
	if !listPayload.Success || !containsProject(listPayload.Projects, createPayload.Project.ID) {
		t.Fatalf("admin list should include created project: %+v", listPayload)
	}
	if listed := findProject(listPayload.Projects, createPayload.Project.ID); listed == nil || listed.AutoPauseAt == nil || *listed.AutoPauseAt != expectedAutoPauseAt {
		t.Fatalf("admin list should include auto pause timestamp, project=%+v", listed)
	}

	userID := int64(21001 + time.Now().UnixNano()%1_000_000_000)
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name)
		 VALUES ($1, 'project_user', 'Project User')
		 ON CONFLICT (id) DO UPDATE SET username = excluded.username, display_name = excluded.display_name`,
		userID,
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	logID := "project-exchange-" + stringID(time.Now().UnixNano())
	if _, err := db.Exec(ctx,
		`INSERT INTO exchange_logs (id, user_id, item_id, item_name, points_cost, value, type, quantity, created_at)
		 VALUES ($1, $2, $3, '后台直充项目', 0, 9, 'project_direct', 1, now())`,
		logID,
		userID,
		createPayload.Project.ID,
	); err != nil {
		t.Fatalf("seed exchange log failed: %v", err)
	}

	detailResponse := performAdminJSONRequest(handler, http.MethodGet, "/api/admin/projects/"+createPayload.Project.ID, "")
	if detailResponse.Code != http.StatusOK {
		t.Fatalf("expected detail 200, got %d body=%s", detailResponse.Code, detailResponse.Body.String())
	}
	var detailPayload struct {
		Success bool                         `json:"success"`
		Project welfare.Project              `json:"project"`
		Records []welfare.AdminProjectRecord `json:"records"`
	}
	if err := json.Unmarshal(detailResponse.Body.Bytes(), &detailPayload); err != nil {
		t.Fatalf("decode detail response failed: %v", err)
	}
	if !detailPayload.Success || detailPayload.Project.ID != createPayload.Project.ID || len(detailPayload.Records) != 1 || detailPayload.Records[0].UserID != userID || detailPayload.Records[0].CreditedPoints == nil || *detailPayload.Records[0].CreditedPoints != 9 {
		t.Fatalf("unexpected detail response: %+v", detailPayload)
	}

	updateResponse := performAdminJSONRequest(handler, http.MethodPatch, "/api/admin/projects/"+createPayload.Project.ID, `{"name":"已更新项目","description":"已更新说明","status":"paused","pinned":true,"maxClaims":4}`)
	if updateResponse.Code != http.StatusOK || !strings.Contains(updateResponse.Body.String(), "项目更新成功") {
		t.Fatalf("expected update 200, got %d body=%s", updateResponse.Code, updateResponse.Body.String())
	}
	var updatedName string
	var updatedStatus string
	var updatedMaxClaims int64
	var updatedCodesCount int64
	var updatedPinned bool
	if err := db.QueryRow(ctx,
		`SELECT name, status, max_claims, codes_count, pinned
		   FROM projects
		  WHERE id = $1`,
		createPayload.Project.ID,
	).Scan(&updatedName, &updatedStatus, &updatedMaxClaims, &updatedCodesCount, &updatedPinned); err != nil {
		t.Fatalf("query updated project failed: %v", err)
	}
	if updatedName != "已更新项目" || updatedStatus != "paused" || updatedMaxClaims != 4 || updatedCodesCount != 4 || !updatedPinned {
		t.Fatalf("unexpected updated project state name=%s status=%s max=%d codes=%d pinned=%v", updatedName, updatedStatus, updatedMaxClaims, updatedCodesCount, updatedPinned)
	}

	appendResponse := performAdminFormRequest(handler, http.MethodPost, "/api/admin/projects/"+createPayload.Project.ID, url.Values{
		"appendClaims": {"3"},
	})
	if appendResponse.Code != http.StatusOK {
		t.Fatalf("expected append 200, got %d body=%s", appendResponse.Code, appendResponse.Body.String())
	}
	var appendPayload struct {
		Success   bool  `json:"success"`
		Appended  int64 `json:"appended"`
		MaxClaims int64 `json:"maxClaims"`
	}
	if err := json.Unmarshal(appendResponse.Body.Bytes(), &appendPayload); err != nil {
		t.Fatalf("decode append response failed: %v", err)
	}
	if !appendPayload.Success || appendPayload.Appended != 3 || appendPayload.MaxClaims != 7 {
		t.Fatalf("unexpected append response: %+v", appendPayload)
	}

	deleteResponse := performAdminJSONRequest(handler, http.MethodDelete, "/api/admin/projects/"+createPayload.Project.ID, "")
	if deleteResponse.Code != http.StatusOK || !strings.Contains(deleteResponse.Body.String(), "项目已删除") {
		t.Fatalf("expected delete 200, got %d body=%s", deleteResponse.Code, deleteResponse.Body.String())
	}
	if countProjectsByID(ctx, t, db, createPayload.Project.ID) != 0 {
		t.Fatalf("project should be deleted")
	}
}

func TestPublicProjectRoutesClaimDirectProject(t *testing.T) {
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

	suffix := time.Now().UnixNano()
	projectID := "http-public-project-" + stringID(suffix)
	userID := int64(22001 + suffix%1_000_000_000)
	defer func() {
		_, _ = db.Exec(ctx, `DELETE FROM exchange_logs WHERE user_id = $1 OR item_id = $2`, userID, projectID)
		_, _ = db.Exec(ctx, `DELETE FROM point_ledger WHERE user_id = $1`, userID)
		_, _ = db.Exec(ctx, `DELETE FROM point_accounts WHERE user_id = $1`, userID)
		_, _ = db.Exec(ctx, `DELETE FROM user_assets WHERE user_id = $1`, userID)
		_, _ = db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
		_, _ = db.Exec(ctx, `DELETE FROM projects WHERE id = $1`, projectID)
	}()

	if _, err := db.Exec(ctx,
		`INSERT INTO projects (
		   id, name, description, max_claims, claimed_count, codes_count,
		   status, created_at_ms, created_by, reward_type, direct_points, new_user_only
		 ) VALUES ($1, '公开直充项目', '公开项目说明', 2, 0, 2, 'active', $2, 'admin', 'direct', 12, false)`,
		projectID,
		time.Now().UnixMilli(),
	); err != nil {
		t.Fatalf("seed public project failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(os.Stderr, nil)),
		DB:     db,
	})

	anonymousDetail := httptest.NewRequest(http.MethodGet, "/api/projects/"+projectID, nil)
	anonymousResponse := httptest.NewRecorder()
	handler.ServeHTTP(anonymousResponse, anonymousDetail)
	if anonymousResponse.Code != http.StatusOK || !strings.Contains(anonymousResponse.Body.String(), `"claimed":null`) {
		t.Fatalf("expected anonymous detail with null claim, got %d body=%s", anonymousResponse.Code, anonymousResponse.Body.String())
	}

	unauthenticatedClaims := httptest.NewRequest(http.MethodGet, "/api/projects/my-claims", nil)
	unauthenticatedResponse := httptest.NewRecorder()
	handler.ServeHTTP(unauthenticatedResponse, unauthenticatedClaims)
	if unauthenticatedResponse.Code != http.StatusUnauthorized {
		t.Fatalf("expected my-claims unauthorized, got %d body=%s", unauthenticatedResponse.Code, unauthenticatedResponse.Body.String())
	}

	claimResponse := performUserProjectRequest(handler, http.MethodPost, "/api/projects/"+projectID, userID)
	if claimResponse.Code != http.StatusOK {
		t.Fatalf("expected claim 200, got %d body=%s", claimResponse.Code, claimResponse.Body.String())
	}
	var claimPayload struct {
		Success        bool   `json:"success"`
		DirectCredit   bool   `json:"directCredit"`
		CreditedPoints int64  `json:"creditedPoints"`
		CreditStatus   string `json:"creditStatus"`
	}
	if err := json.Unmarshal(claimResponse.Body.Bytes(), &claimPayload); err != nil {
		t.Fatalf("decode claim response failed: %v", err)
	}
	if !claimPayload.Success || !claimPayload.DirectCredit || claimPayload.CreditedPoints != 12 || claimPayload.CreditStatus != "success" {
		t.Fatalf("unexpected claim response: %+v", claimPayload)
	}

	duplicateResponse := performUserProjectRequest(handler, http.MethodPost, "/api/projects/"+projectID, userID)
	if duplicateResponse.Code != http.StatusOK {
		t.Fatalf("expected duplicate claim 200, got %d body=%s", duplicateResponse.Code, duplicateResponse.Body.String())
	}

	myClaimsResponse := performUserProjectRequest(handler, http.MethodGet, "/api/projects/my-claims", userID)
	if myClaimsResponse.Code != http.StatusOK || !strings.Contains(myClaimsResponse.Body.String(), projectID) {
		t.Fatalf("expected my-claims to include project, got %d body=%s", myClaimsResponse.Code, myClaimsResponse.Body.String())
	}

	claimedDetail := performUserProjectRequest(handler, http.MethodGet, "/api/projects/"+projectID, userID)
	if claimedDetail.Code != http.StatusOK || !strings.Contains(claimedDetail.Body.String(), `"creditedPoints":12`) {
		t.Fatalf("expected claimed detail, got %d body=%s", claimedDetail.Code, claimedDetail.Body.String())
	}

	var balance int64
	var ledgers int64
	var logs int64
	var claimedCount int64
	if err := db.QueryRow(ctx,
		`SELECT
		   (SELECT balance FROM point_accounts WHERE user_id = $1),
		   (SELECT COUNT(*) FROM point_ledger WHERE user_id = $1 AND source = 'project_claim'),
		   (SELECT COUNT(*) FROM exchange_logs WHERE user_id = $1 AND item_id = $2 AND type = 'project_direct'),
		   (SELECT claimed_count FROM projects WHERE id = $2)`,
		userID,
		projectID,
	).Scan(&balance, &ledgers, &logs, &claimedCount); err != nil {
		t.Fatalf("query public claim state failed: %v", err)
	}
	if balance != 12 || ledgers != 1 || logs != 1 || claimedCount != 1 {
		t.Fatalf("unexpected public claim state balance=%d ledgers=%d logs=%d claimed=%d", balance, ledgers, logs, claimedCount)
	}
}

func TestAdminProjectAppendRejectsLegacyCodeProject(t *testing.T) {
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

	projectID := "http-admin-code-project-" + stringID(time.Now().UnixNano())
	if _, err := db.Exec(ctx,
		`INSERT INTO projects (
		   id, name, description, max_claims, claimed_count, codes_count,
		   status, created_at_ms, created_by, reward_type, direct_points, new_user_only
		 ) VALUES ($1, '历史兑换码项目', '只读', 1, 0, 1, 'active', $2, 'admin', 'code', NULL, false)`,
		projectID,
		time.Now().UnixMilli(),
	); err != nil {
		t.Fatalf("seed code project failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{
			SessionSecret:  testSessionSecret,
			AdminUsernames: map[string]struct{}{"admin": {}},
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})

	appendResponse := performAdminFormRequest(handler, http.MethodPost, "/api/admin/projects/"+projectID, url.Values{
		"appendClaims": {"1"},
	})
	if appendResponse.Code != http.StatusBadRequest || !strings.Contains(appendResponse.Body.String(), "历史兑换码项目已设为只读") {
		t.Fatalf("expected legacy code project append 400, got %d body=%s", appendResponse.Code, appendResponse.Body.String())
	}
}

func httpMigrationsDir(t *testing.T) string {
	t.Helper()

	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatalf("cannot resolve test file path")
	}
	return filepath.Join(filepath.Dir(file), "..", "..", "migrations")
}

func stringID(value int64) string {
	return strconv.FormatInt(value, 10)
}

func containsAdminRaffle(raffles []welfare.AdminRaffle, id string) bool {
	for _, raffle := range raffles {
		if raffle.ID == id {
			return true
		}
	}
	return false
}

func containsProject(projects []welfare.Project, id string) bool {
	return findProject(projects, id) != nil
}

func findProject(projects []welfare.Project, id string) *welfare.Project {
	for _, project := range projects {
		if project.ID == id {
			return &project
		}
	}
	return nil
}

func performAdminJSONRequest(handler http.Handler, method string, path string, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func performAdminFormRequest(handler http.Handler, method string, path string, values url.Values) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader(values.Encode()))
	request.Host = "example.com"
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func performUserProjectRequest(handler http.Handler, method string, path string, userID int64) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader("{}"))
	request.Host = "example.com"
	if method != http.MethodGet {
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Origin", "http://example.com")
	}
	request.AddCookie(testSessionCookieFor(userID, "project_user", "Project User"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func sumInt64(values []int64) int64 {
	var total int64
	for _, value := range values {
		total += value
	}
	return total
}

func countRafflesByID(ctx context.Context, t *testing.T, db *pgxpool.Pool, id string) int64 {
	t.Helper()

	var count int64
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM raffles WHERE id = $1`, id).Scan(&count); err != nil {
		t.Fatalf("count raffles failed: %v", err)
	}
	return count
}

func countProjectsByID(ctx context.Context, t *testing.T, db *pgxpool.Pool, id string) int64 {
	t.Helper()

	var count int64
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM projects WHERE id = $1`, id).Scan(&count); err != nil {
		t.Fatalf("count projects failed: %v", err)
	}
	return count
}
