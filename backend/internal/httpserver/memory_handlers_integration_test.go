//go:build integration

package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"redemption/backend/internal/config"
	"redemption/backend/internal/memory"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestMemoryHTTPCompleteGameAndReplayDuplicateSettlement(t *testing.T) {
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

	userID := int64(39001 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestMemoryUser(t, ctx, db, userID)
	defer cleanupHTTPTestMemoryUser(t, ctx, db, userID)

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})

	startResponse := performMemoryJSONRequest(handler, userID, http.MethodPost, "/api/games/memory/start", `{"difficulty":"easy"}`)
	if startResponse.Code != http.StatusOK {
		t.Fatalf("expected start 200, got %d body=%s", startResponse.Code, startResponse.Body.String())
	}
	var startPayload struct {
		Success bool `json:"success"`
		Data    struct {
			SessionID  string   `json:"sessionId"`
			CardLayout []string `json:"cardLayout"`
		} `json:"data"`
	}
	if err := json.NewDecoder(startResponse.Body).Decode(&startPayload); err != nil {
		t.Fatalf("decode start response failed: %v", err)
	}
	if !startPayload.Success || startPayload.Data.SessionID == "" {
		t.Fatalf("unexpected start payload: %+v", startPayload)
	}
	for _, card := range startPayload.Data.CardLayout {
		if card != "__hidden__" {
			t.Fatalf("start response must mask layout, got %+v", startPayload.Data.CardLayout)
		}
	}

	session := loadMemorySessionForHTTPTest(t, ctx, db, startPayload.Data.SessionID)
	session.StartedAt -= 6000
	raw, err := json.Marshal(session)
	if err != nil {
		t.Fatalf("marshal adjusted session failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`UPDATE game_sessions SET payload = $1, started_at = $2 WHERE id = $3`,
		raw,
		time.UnixMilli(session.StartedAt),
		session.ID,
	); err != nil {
		t.Fatalf("adjust session start time failed: %v", err)
	}

	pairs := memoryPairs(session.CardLayout)
	moves := make([]memory.Move, 0, len(pairs))
	for _, pair := range pairs {
		first := performMemoryJSONRequest(handler, userID, http.MethodPost, "/api/games/memory/flip", `{"sessionId":"`+session.ID+`","cardIndex":`+strconv.Itoa(pair[0])+`}`)
		if first.Code != http.StatusOK {
			t.Fatalf("first flip failed: status=%d body=%s", first.Code, first.Body.String())
		}
		second := performMemoryJSONRequest(handler, userID, http.MethodPost, "/api/games/memory/flip", `{"sessionId":"`+session.ID+`","cardIndex":`+strconv.Itoa(pair[1])+`}`)
		if second.Code != http.StatusOK {
			t.Fatalf("second flip failed: status=%d body=%s", second.Code, second.Body.String())
		}
		var flipPayload struct {
			Success bool              `json:"success"`
			Data    memory.FlipResult `json:"data"`
		}
		if err := json.NewDecoder(second.Body).Decode(&flipPayload); err != nil {
			t.Fatalf("decode flip response failed: %v", err)
		}
		if !flipPayload.Success || flipPayload.Data.Move == nil || !flipPayload.Data.Matched {
			t.Fatalf("unexpected flip payload: %+v", flipPayload)
		}
		moves = append(moves, *flipPayload.Data.Move)
	}

	submitBody, err := json.Marshal(memory.SubmitInput{
		SessionID: session.ID,
		Moves:     moves,
		Completed: true,
		Duration:  6000,
	})
	if err != nil {
		t.Fatalf("marshal submit body failed: %v", err)
	}
	submitResponse := performMemoryJSONRequest(handler, userID, http.MethodPost, "/api/games/memory/submit", string(submitBody))
	if submitResponse.Code != http.StatusOK {
		t.Fatalf("expected submit 200, got %d body=%s", submitResponse.Code, submitResponse.Body.String())
	}
	var submitPayload struct {
		Success bool `json:"success"`
		Data    struct {
			PointsEarned int64         `json:"pointsEarned"`
			Record       memory.Record `json:"record"`
		} `json:"data"`
	}
	if err := json.NewDecoder(submitResponse.Body).Decode(&submitPayload); err != nil {
		t.Fatalf("decode submit response failed: %v", err)
	}
	if !submitPayload.Success || submitPayload.Data.PointsEarned != 24 || submitPayload.Data.Record.Score != 220 {
		t.Fatalf("unexpected submit payload: %+v", submitPayload)
	}

	var duplicateSuccesses atomic.Int64
	var duplicateFailures atomic.Int64
	var waitGroup sync.WaitGroup
	for index := 0; index < 20; index++ {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			duplicate := performMemoryJSONRequest(handler, userID, http.MethodPost, "/api/games/memory/submit", string(submitBody))
			if duplicate.Code == http.StatusOK {
				duplicateSuccesses.Add(1)
				return
			}
			if duplicate.Code == http.StatusBadRequest {
				duplicateFailures.Add(1)
				return
			}
			t.Errorf("unexpected duplicate submit response: status=%d body=%s", duplicate.Code, duplicate.Body.String())
		}()
	}
	waitGroup.Wait()
	if duplicateSuccesses.Load() != 20 || duplicateFailures.Load() != 0 {
		t.Fatalf("duplicate submit should replay settled record, successes=%d failures=%d", duplicateSuccesses.Load(), duplicateFailures.Load())
	}

	var balance int64
	if err := db.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, userID).Scan(&balance); err != nil {
		t.Fatalf("query balance failed: %v", err)
	}
	if balance != 24 {
		t.Fatalf("duplicate submit should not grant points twice, balance=%d", balance)
	}
	var recordCount int64
	if err := db.QueryRow(ctx, `SELECT count(*) FROM game_records WHERE user_id = $1 AND game_type = 'memory'`, userID).Scan(&recordCount); err != nil {
		t.Fatalf("query record count failed: %v", err)
	}
	if recordCount != 1 {
		t.Fatalf("expected exactly one memory record, got %d", recordCount)
	}
}

func performMemoryJSONRequest(handler http.Handler, userID int64, method string, path string, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	request.Host = "example.com"
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch || method == http.MethodDelete {
		request.Header.Set("Origin", "http://example.com")
	}
	request.AddCookie(testSessionCookieFor(userID, "memory_http_"+strconv.FormatInt(userID, 10), "Memory HTTP User"))
	return performRequest(handler, request)
}

func loadMemorySessionForHTTPTest(t *testing.T, ctx context.Context, db *pgxpool.Pool, sessionID string) memory.Session {
	t.Helper()
	var raw []byte
	if err := db.QueryRow(ctx, `SELECT payload FROM game_sessions WHERE id = $1`, sessionID).Scan(&raw); err != nil {
		t.Fatalf("load memory session failed: %v", err)
	}
	var session memory.Session
	if err := json.Unmarshal(raw, &session); err != nil {
		t.Fatalf("decode memory session failed: %v", err)
	}
	return session
}

func memoryPairs(layout []string) [][2]int {
	firstByIcon := map[string]int{}
	pairs := make([][2]int, 0, len(layout)/2)
	for index, icon := range layout {
		if first, ok := firstByIcon[icon]; ok {
			pairs = append(pairs, [2]int{first, index})
			delete(firstByIcon, icon)
			continue
		}
		firstByIcon[icon] = index
	}
	return pairs
}

func cleanupHTTPTestMemoryUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64) {
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
			t.Fatalf("cleanup memory http user %d failed: %v", userID, err)
		}
	}
}
