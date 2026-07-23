//go:build integration

package httpserver

import (
	"context"
	"encoding/json"
	"fmt"
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
	"redemption/backend/internal/pianotiles"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

// 选一张音块数最少的谱面，便于构造一圈命中事件流。
func smallestPianoChart(t *testing.T) pianotiles.ChartSummary {
	t.Helper()
	var best pianotiles.ChartSummary
	for _, id := range pianotiles.ChartIDs() {
		chart, ok := pianotiles.ChartSummaryFor(id)
		if !ok {
			continue
		}
		if best.ID == "" || len(chart.Notes) < len(best.Notes) {
			best = chart
		}
	}
	if best.ID == "" {
		t.Fatal("no embedded piano charts available")
	}
	return best
}

func hitPianoEventsJSON(chart pianotiles.ChartSummary, count int, terminal bool) string {
	parts := make([]string, 0, count+1)
	for index := 0; index < count; index++ {
		note := chart.Notes[index%len(chart.Notes)]
		parts = append(parts, fmt.Sprintf(`{"t":%d,"lane":%d,"j":"h"}`, index*50, note.Lane))
	}
	if terminal {
		parts = append(parts, fmt.Sprintf(`{"t":%d,"lane":0,"j":"w"}`, count*50))
	}
	return "[" + strings.Join(parts, ",") + "]"
}

func performPianoTilesJSONRequest(handler http.Handler, userID int64, method string, path string, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Host = "example.com"
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if method == http.MethodPost {
		request.Header.Set("Origin", "http://example.com")
	}
	request.AddCookie(testSessionCookieFor(userID, "piano_http_"+strconv.FormatInt(userID, 10), "Piano HTTP User"))
	return performRequest(handler, request)
}

func cleanupHTTPTestPianoUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64) {
	t.Helper()
	statements := []string{
		`DELETE FROM game_records WHERE user_id = $1`,
		`DELETE FROM active_game_sessions WHERE user_id = $1`,
		`DELETE FROM game_sessions WHERE user_id = $1`,
		`DELETE FROM game_cooldowns WHERE user_id = $1`,
		`DELETE FROM game_daily_stats WHERE user_id = $1`,
		`DELETE FROM daily_game_points WHERE user_id = $1`,
		`DELETE FROM point_ledger WHERE user_id = $1`,
		`DELETE FROM point_accounts WHERE user_id = $1`,
		`DELETE FROM users WHERE id = $1`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(ctx, statement, userID); err != nil {
			t.Fatalf("cleanup piano http user %d failed: %v", userID, err)
		}
	}
}

func TestPianoTilesHTTPStartRetryWithSameRequestIDIsIdempotent(t *testing.T) {
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

	userID := int64(46501 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestPianoUser(t, ctx, db, userID)
	defer cleanupHTTPTestPianoUser(t, ctx, db, userID)

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	chart := smallestPianoChart(t)
	startBody := `{"chartId":"` + chart.ID + `","mode":"classic","checksum":"` + chart.Checksum + `","startRequestId":"start-retry-1"}`

	first := performPianoTilesJSONRequest(handler, userID, http.MethodPost, "/api/games/piano-tiles/start", startBody)
	if first.Code != http.StatusOK {
		t.Fatalf("expected first start 200, got %d body=%s", first.Code, first.Body.String())
	}
	var firstPayload struct {
		Success bool `json:"success"`
		Data    struct {
			SessionID string `json:"sessionId"`
		} `json:"data"`
	}
	if err := json.NewDecoder(first.Body).Decode(&firstPayload); err != nil {
		t.Fatalf("decode first start failed: %v", err)
	}
	if !firstPayload.Success || firstPayload.Data.SessionID == "" {
		t.Fatalf("unexpected first start payload: %+v", firstPayload)
	}

	// 模拟客户端没有收到第一次响应后的安全重试：应返回同一会话，不能新增一局。
	retry := performPianoTilesJSONRequest(handler, userID, http.MethodPost, "/api/games/piano-tiles/start", startBody)
	if retry.Code != http.StatusOK {
		t.Fatalf("expected same-request retry 200, got %d body=%s", retry.Code, retry.Body.String())
	}
	var retryPayload struct {
		Success bool `json:"success"`
		Data    struct {
			SessionID string `json:"sessionId"`
		} `json:"data"`
	}
	if err := json.NewDecoder(retry.Body).Decode(&retryPayload); err != nil {
		t.Fatalf("decode retry start failed: %v", err)
	}
	if !retryPayload.Success || retryPayload.Data.SessionID != firstPayload.Data.SessionID {
		t.Fatalf("same-request retry should reuse session: first=%q retry=%q", firstPayload.Data.SessionID, retryPayload.Data.SessionID)
	}

	var sessionCount, activeCount int
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM game_sessions WHERE user_id=$1 AND game_type=$2`, userID, pianotiles.GameType).Scan(&sessionCount); err != nil {
		t.Fatalf("count game sessions failed: %v", err)
	}
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM active_game_sessions WHERE user_id=$1 AND game_type=$2`, userID, pianotiles.GameType).Scan(&activeCount); err != nil {
		t.Fatalf("count active sessions failed: %v", err)
	}
	if sessionCount != 1 || activeCount != 1 {
		t.Fatalf("idempotent retry should keep one session and one active pointer: sessions=%d active=%d", sessionCount, activeCount)
	}

	// 不同请求标识不能接管现有会话，即使曲目和模式完全相同。
	differentRequest := strings.Replace(startBody, "start-retry-1", "start-retry-2", 1)
	different := performPianoTilesJSONRequest(handler, userID, http.MethodPost, "/api/games/piano-tiles/start", differentRequest)
	if different.Code != http.StatusBadRequest || !strings.Contains(different.Body.String(), "你已有正在进行的游戏") {
		t.Fatalf("different request id should be rejected, got %d body=%s", different.Code, different.Body.String())
	}

	// 一旦服务端确认了任何进度，原请求标识也不能再把它当成“未收到响应的空局”恢复。
	eventBody := `{"sessionId":"` + firstPayload.Data.SessionID + `","events":` + hitPianoEventsJSON(chart, 1, false) + `}`
	checkpoint := performPianoTilesJSONRequest(handler, userID, http.MethodPost, "/api/games/piano-tiles/checkpoint", eventBody)
	if checkpoint.Code != http.StatusOK {
		t.Fatalf("expected progress checkpoint 200, got %d body=%s", checkpoint.Code, checkpoint.Body.String())
	}
	afterProgress := performPianoTilesJSONRequest(handler, userID, http.MethodPost, "/api/games/piano-tiles/start", startBody)
	if afterProgress.Code != http.StatusBadRequest || !strings.Contains(afterProgress.Body.String(), "你已有正在进行的游戏") {
		t.Fatalf("request retry after confirmed progress should be rejected, got %d body=%s", afterProgress.Code, afterProgress.Body.String())
	}
}

func TestPianoTilesHTTPStartClearsTerminalActivePointerWithoutDeletingSession(t *testing.T) {
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

	userID := int64(46751 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestPianoUser(t, ctx, db, userID)
	defer cleanupHTTPTestPianoUser(t, ctx, db, userID)

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	chart := smallestPianoChart(t)
	firstBody := `{"chartId":"` + chart.ID + `","mode":"classic","checksum":"` + chart.Checksum + `","startRequestId":"terminal-active-1"}`
	first := performPianoTilesJSONRequest(handler, userID, http.MethodPost, "/api/games/piano-tiles/start", firstBody)
	if first.Code != http.StatusOK {
		t.Fatalf("expected first start 200, got %d body=%s", first.Code, first.Body.String())
	}
	var firstPayload struct {
		Data struct {
			SessionID string `json:"sessionId"`
		} `json:"data"`
	}
	if err := json.NewDecoder(first.Body).Decode(&firstPayload); err != nil {
		t.Fatalf("decode first start failed: %v", err)
	}
	oldSessionID := firstPayload.Data.SessionID
	if oldSessionID == "" {
		t.Fatal("first start returned empty session id")
	}

	// 模拟历史异常：game_sessions 已进入终态，但 active 指针仍残留。
	// payload 故意保持 playing，验证 SQL 状态也会被可信地识别为终态。
	if _, err := db.Exec(ctx, `UPDATE game_sessions SET status=$1 WHERE id=$2 AND user_id=$3 AND game_type=$4`, string(pianotiles.StatusFailed), oldSessionID, userID, pianotiles.GameType); err != nil {
		t.Fatalf("mark old session failed failed: %v", err)
	}
	var staleActiveID string
	if err := db.QueryRow(ctx, `SELECT session_id FROM active_game_sessions WHERE user_id=$1 AND game_type=$2`, userID, pianotiles.GameType).Scan(&staleActiveID); err != nil {
		t.Fatalf("load stale active pointer failed: %v", err)
	}
	if staleActiveID != oldSessionID {
		t.Fatalf("expected stale active pointer %q, got %q", oldSessionID, staleActiveID)
	}

	secondBody := strings.Replace(firstBody, "terminal-active-1", "terminal-active-2", 1)
	second := performPianoTilesJSONRequest(handler, userID, http.MethodPost, "/api/games/piano-tiles/start", secondBody)
	if second.Code != http.StatusOK {
		t.Fatalf("expected new start after terminal stale pointer 200, got %d body=%s", second.Code, second.Body.String())
	}
	var secondPayload struct {
		Data struct {
			SessionID string `json:"sessionId"`
		} `json:"data"`
	}
	if err := json.NewDecoder(second.Body).Decode(&secondPayload); err != nil {
		t.Fatalf("decode second start failed: %v", err)
	}
	newSessionID := secondPayload.Data.SessionID
	if newSessionID == "" || newSessionID == oldSessionID {
		t.Fatalf("expected a distinct new session, old=%q new=%q", oldSessionID, newSessionID)
	}

	var oldSessionCount, allSessionCount int
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM game_sessions WHERE id=$1 AND user_id=$2 AND game_type=$3 AND status=$4`, oldSessionID, userID, pianotiles.GameType, string(pianotiles.StatusFailed)).Scan(&oldSessionCount); err != nil {
		t.Fatalf("verify old session failed: %v", err)
	}
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM game_sessions WHERE user_id=$1 AND game_type=$2`, userID, pianotiles.GameType).Scan(&allSessionCount); err != nil {
		t.Fatalf("count preserved sessions failed: %v", err)
	}
	if oldSessionCount != 1 || allSessionCount != 2 {
		t.Fatalf("terminal session should be preserved beside new session: old=%d total=%d", oldSessionCount, allSessionCount)
	}

	var activeSessionID string
	if err := db.QueryRow(ctx, `SELECT session_id FROM active_game_sessions WHERE user_id=$1 AND game_type=$2`, userID, pianotiles.GameType).Scan(&activeSessionID); err != nil {
		t.Fatalf("load replacement active pointer failed: %v", err)
	}
	if activeSessionID != newSessionID {
		t.Fatalf("active pointer should target new session: got=%q want=%q", activeSessionID, newSessionID)
	}
}

func TestPianoTilesHTTPCompleteGameAndReplayDuplicateSettlement(t *testing.T) {
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

	userID := int64(47001 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestPianoUser(t, ctx, db, userID)
	defer cleanupHTTPTestPianoUser(t, ctx, db, userID)

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})

	chart := smallestPianoChart(t)

	startBody := `{"chartId":"` + chart.ID + `","mode":"classic","checksum":"` + chart.Checksum + `"}`
	startResponse := performPianoTilesJSONRequest(handler, userID, http.MethodPost, "/api/games/piano-tiles/start", startBody)
	if startResponse.Code != http.StatusOK {
		t.Fatalf("expected start 200, got %d body=%s", startResponse.Code, startResponse.Body.String())
	}
	var startPayload struct {
		Success bool `json:"success"`
		Data    struct {
			SessionID string `json:"sessionId"`
		} `json:"data"`
	}
	if err := json.NewDecoder(startResponse.Body).Decode(&startPayload); err != nil {
		t.Fatalf("decode start response failed: %v", err)
	}
	if !startPayload.Success || startPayload.Data.SessionID == "" {
		t.Fatalf("unexpected start payload: %+v", startPayload)
	}
	sessionID := startPayload.Data.SessionID

	events := hitPianoEventsJSON(chart, len(chart.Notes), true)

	checkpointBody := `{"sessionId":"` + sessionID + `","events":` + events + `}`
	checkpointResponse := performPianoTilesJSONRequest(handler, userID, http.MethodPost, "/api/games/piano-tiles/checkpoint", checkpointBody)
	if checkpointResponse.Code != http.StatusOK {
		t.Fatalf("expected checkpoint 200, got %d body=%s", checkpointResponse.Code, checkpointResponse.Body.String())
	}

	playedMs := int64(len(chart.Notes) * 50)
	submitBody := `{"sessionId":"` + sessionID + `","result":{"status":"failed","score":` +
		strconv.Itoa(len(chart.Notes)) + `,"tilesHit":` + strconv.Itoa(len(chart.Notes)) +
		`,"crowns":1,"laps":1,"playedMs":` + strconv.FormatInt(playedMs, 10) + `},"events":` + events + `}`
	submitResponse := performPianoTilesJSONRequest(handler, userID, http.MethodPost, "/api/games/piano-tiles/submit", submitBody)
	if submitResponse.Code != http.StatusOK {
		t.Fatalf("expected submit 200, got %d body=%s", submitResponse.Code, submitResponse.Body.String())
	}
	var submitPayload struct {
		Success bool `json:"success"`
		Data    struct {
			Score         int64              `json:"score"`
			PointsAwarded int64              `json:"pointsAwarded"`
			Record        *pianotiles.Record `json:"record"`
		} `json:"data"`
	}
	if err := json.NewDecoder(submitResponse.Body).Decode(&submitPayload); err != nil {
		t.Fatalf("decode submit response failed: %v", err)
	}
	if !submitPayload.Success || submitPayload.Data.Record == nil {
		t.Fatalf("unexpected submit payload: %+v", submitPayload)
	}
	if submitPayload.Data.Record.Status != pianotiles.StatusFailed || submitPayload.Data.Record.Crowns != 1 {
		t.Fatalf("expected failed record with one crown, got %+v", submitPayload.Data.Record)
	}
	if submitPayload.Data.Score <= 0 || submitPayload.Data.PointsAwarded <= 0 {
		t.Fatalf("expected positive score/points, got score=%d points=%d", submitPayload.Data.Score, submitPayload.Data.PointsAwarded)
	}

	// 幂等：重复 submit 返回同一记录，不再加分
	duplicateResponse := performPianoTilesJSONRequest(handler, userID, http.MethodPost, "/api/games/piano-tiles/submit", submitBody)
	if duplicateResponse.Code != http.StatusOK {
		t.Fatalf("expected duplicate submit 200, got %d body=%s", duplicateResponse.Code, duplicateResponse.Body.String())
	}
	var duplicatePayload struct {
		Success bool `json:"success"`
		Data    struct {
			Score         int64              `json:"score"`
			PointsAwarded int64              `json:"pointsAwarded"`
			Record        *pianotiles.Record `json:"record"`
		} `json:"data"`
	}
	if err := json.NewDecoder(duplicateResponse.Body).Decode(&duplicatePayload); err != nil {
		t.Fatalf("decode duplicate submit response failed: %v", err)
	}
	if duplicatePayload.Data.Record == nil || duplicatePayload.Data.Record.ID != submitPayload.Data.Record.ID {
		t.Fatalf("expected idempotent record, first=%+v second=%+v", submitPayload.Data.Record, duplicatePayload.Data.Record)
	}

	var ledgerCount int
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM point_ledger WHERE user_id = $1`, userID).Scan(&ledgerCount); err != nil {
		t.Fatalf("count ledger failed: %v", err)
	}
	if ledgerCount != 1 {
		t.Fatalf("expected exactly 1 ledger entry after duplicate submit, got %d", ledgerCount)
	}
}

func TestPianoTilesHTTPHeartbeatRenewsPayloadAndBothSessionTables(t *testing.T) {
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

	userID := int64(47501 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestPianoUser(t, ctx, db, userID)
	defer cleanupHTTPTestPianoUser(t, ctx, db, userID)
	handler := New(Dependencies{Config: config.Config{SessionSecret: testSessionSecret}, Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), DB: db})
	chart := smallestPianoChart(t)
	startBody := `{"chartId":"` + chart.ID + `","mode":"classic","checksum":"` + chart.Checksum + `"}`
	startResponse := performPianoTilesJSONRequest(handler, userID, http.MethodPost, "/api/games/piano-tiles/start", startBody)
	if startResponse.Code != http.StatusOK {
		t.Fatalf("expected start 200, got %d body=%s", startResponse.Code, startResponse.Body.String())
	}
	var started struct {
		Data struct {
			SessionID string `json:"sessionId"`
		} `json:"data"`
	}
	if err := json.NewDecoder(startResponse.Body).Decode(&started); err != nil {
		t.Fatalf("decode start response failed: %v", err)
	}

	var raw []byte
	if err := db.QueryRow(ctx, `SELECT payload FROM game_sessions WHERE id=$1`, started.Data.SessionID).Scan(&raw); err != nil {
		t.Fatalf("load session payload failed: %v", err)
	}
	var session pianotiles.Session
	if err := json.Unmarshal(raw, &session); err != nil {
		t.Fatalf("decode session payload failed: %v", err)
	}
	// 兼容旧部署遗漏 active_game_sessions 续租的历史会话：active 行即使已经
	// 过期，只要 payload 租期仍有效，status 应修复指针而不是误删整局。
	if _, err := db.Exec(ctx, `UPDATE active_game_sessions SET expires_at=$1 WHERE user_id=$2 AND game_type=$3`, time.Now().Add(-time.Minute), userID, pianotiles.GameType); err != nil {
		t.Fatalf("expire active session pointer failed: %v", err)
	}
	statusResponse := performPianoTilesJSONRequest(handler, userID, http.MethodGet, "/api/games/piano-tiles/status", "")
	if statusResponse.Code != http.StatusOK {
		t.Fatalf("expected status to repair stale active expiry, got %d body=%s", statusResponse.Code, statusResponse.Body.String())
	}
	var statusPayload struct {
		Data pianotiles.StatusData `json:"data"`
	}
	if err := json.NewDecoder(statusResponse.Body).Decode(&statusPayload); err != nil {
		t.Fatalf("decode repaired status failed: %v", err)
	}
	if statusPayload.Data.ActiveSession == nil || statusPayload.Data.ActiveSession.SessionID != session.ID {
		t.Fatalf("stale active expiry should preserve current session: %+v", statusPayload.Data.ActiveSession)
	}
	var repairedActiveExpiry time.Time
	if err := db.QueryRow(ctx, `SELECT expires_at FROM active_game_sessions WHERE user_id=$1 AND game_type=$2`, userID, pianotiles.GameType).Scan(&repairedActiveExpiry); err != nil {
		t.Fatalf("query repaired active expiry failed: %v", err)
	}
	if repairedActiveExpiry.UnixMilli() != session.ExpiresAt {
		t.Fatalf("active expiry was not repaired from payload: got=%d want=%d", repairedActiveExpiry.UnixMilli(), session.ExpiresAt)
	}

	shortExpiry := time.Now().Add(time.Hour).Truncate(time.Millisecond)
	session.ExpiresAt = shortExpiry.UnixMilli()
	raw, err = json.Marshal(session)
	if err != nil {
		t.Fatalf("encode shortened session failed: %v", err)
	}
	if _, err := db.Exec(ctx, `UPDATE game_sessions SET payload=$1, expires_at=$2 WHERE id=$3`, raw, shortExpiry, session.ID); err != nil {
		t.Fatalf("shorten game_sessions expiry failed: %v", err)
	}
	if _, err := db.Exec(ctx, `UPDATE active_game_sessions SET expires_at=$1 WHERE user_id=$2 AND game_type=$3`, shortExpiry, userID, pianotiles.GameType); err != nil {
		t.Fatalf("shorten active session expiry failed: %v", err)
	}

	heartbeatBody := `{"sessionId":"` + session.ID + `","eventOffset":0,"events":[]}`
	heartbeatResponse := performPianoTilesJSONRequest(handler, userID, http.MethodPost, "/api/games/piano-tiles/checkpoint", heartbeatBody)
	if heartbeatResponse.Code != http.StatusOK {
		t.Fatalf("expected heartbeat 200, got %d body=%s", heartbeatResponse.Code, heartbeatResponse.Body.String())
	}
	var heartbeat struct {
		Data pianotiles.CheckpointResult `json:"data"`
	}
	if err := json.NewDecoder(heartbeatResponse.Body).Decode(&heartbeat); err != nil {
		t.Fatalf("decode heartbeat response failed: %v", err)
	}
	if !heartbeat.Data.Success || heartbeat.Data.EventCount != 0 || heartbeat.Data.AcceptedEvents != 0 {
		t.Fatalf("unexpected heartbeat payload: %+v", heartbeat.Data)
	}

	var payloadExpires int64
	var gameExpires, activeExpires time.Time
	if err := db.QueryRow(ctx, `SELECT (payload->>'expiresAt')::bigint, expires_at FROM game_sessions WHERE id=$1`, session.ID).Scan(&payloadExpires, &gameExpires); err != nil {
		t.Fatalf("query renewed game session failed: %v", err)
	}
	if err := db.QueryRow(ctx, `SELECT expires_at FROM active_game_sessions WHERE user_id=$1 AND game_type=$2`, userID, pianotiles.GameType).Scan(&activeExpires); err != nil {
		t.Fatalf("query renewed active session failed: %v", err)
	}
	if payloadExpires != heartbeat.Data.ExpiresAt || gameExpires.UnixMilli() != payloadExpires || activeExpires.UnixMilli() != payloadExpires {
		t.Fatalf("三处过期时间未同步: response=%d payload=%d game=%d active=%d", heartbeat.Data.ExpiresAt, payloadExpires, gameExpires.UnixMilli(), activeExpires.UnixMilli())
	}
	if payloadExpires <= shortExpiry.UnixMilli() {
		t.Fatalf("heartbeat 未延长租期: old=%d new=%d", shortExpiry.UnixMilli(), payloadExpires)
	}
}

func TestPianoTilesHTTPRejectsDensityAttack(t *testing.T) {
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

	userID := int64(48001 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestPianoUser(t, ctx, db, userID)
	defer cleanupHTTPTestPianoUser(t, ctx, db, userID)

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})

	chart := smallestPianoChart(t)
	startBody := `{"chartId":"` + chart.ID + `","mode":"rush","checksum":"` + chart.Checksum + `"}`
	startResponse := performPianoTilesJSONRequest(handler, userID, http.MethodPost, "/api/games/piano-tiles/start", startBody)
	if startResponse.Code != http.StatusOK {
		t.Fatalf("expected start 200, got %d body=%s", startResponse.Code, startResponse.Body.String())
	}
	var startPayload struct {
		Data struct {
			SessionID string `json:"sessionId"`
		} `json:"data"`
	}
	if err := json.NewDecoder(startResponse.Body).Decode(&startPayload); err != nil {
		t.Fatalf("decode start response failed: %v", err)
	}

	// 1 秒内 31 条合法顺序命中事件：应触发密度校验 409
	parts := make([]string, 0, 31)
	for i := 0; i < 31; i++ {
		note := chart.Notes[i%len(chart.Notes)]
		parts = append(parts, fmt.Sprintf(`{"t":%d,"lane":%d,"j":"h"}`, i*25, note.Lane))
	}
	attackBody := `{"sessionId":"` + startPayload.Data.SessionID + `","events":[` + strings.Join(parts, ",") + `]}`
	attackResponse := performPianoTilesJSONRequest(handler, userID, http.MethodPost, "/api/games/piano-tiles/checkpoint", attackBody)
	if attackResponse.Code != http.StatusConflict {
		t.Fatalf("expected density attack 409, got %d body=%s", attackResponse.Code, attackResponse.Body.String())
	}
}
