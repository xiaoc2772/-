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
	"redemption/backend/internal/match3"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestMatch3HTTPCompleteGameAndReplayDuplicateSettlement(t *testing.T) {
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

	userID := int64(41001 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestMatch3User(t, ctx, db, userID)
	defer cleanupHTTPTestMatch3User(t, ctx, db, userID)

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})

	startResponse := performMatch3JSONRequest(handler, userID, http.MethodPost, "/api/games/match3/start", `{}`)
	if startResponse.Code != http.StatusOK {
		t.Fatalf("expected start 200, got %d body=%s", startResponse.Code, startResponse.Body.String())
	}
	var startPayload struct {
		Success bool               `json:"success"`
		Data    match3.SessionView `json:"data"`
	}
	if err := json.NewDecoder(startResponse.Body).Decode(&startPayload); err != nil {
		t.Fatalf("decode start response failed: %v", err)
	}
	if !startPayload.Success || startPayload.Data.SessionID == "" || startPayload.Data.Seed == "" {
		t.Fatalf("unexpected start payload: %+v", startPayload)
	}

	session := loadMatch3SessionForHTTPTest(t, ctx, db, startPayload.Data.SessionID)
	session.StartedAt -= 11_000
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

	move, sim := firstValidMatch3Move(t, session.Seed, session.Config)
	submitBody, err := json.Marshal(match3.SubmitInput{
		SessionID: session.ID,
		Moves:     []match3.Move{move},
	})
	if err != nil {
		t.Fatalf("marshal submit body failed: %v", err)
	}
	submitResponse := performMatch3JSONRequest(handler, userID, http.MethodPost, "/api/games/match3/submit", string(submitBody))
	if submitResponse.Code != http.StatusOK {
		t.Fatalf("expected submit 200, got %d body=%s", submitResponse.Code, submitResponse.Body.String())
	}
	var submitPayload struct {
		Success bool `json:"success"`
		Data    struct {
			PointsEarned int64         `json:"pointsEarned"`
			Record       match3.Record `json:"record"`
		} `json:"data"`
	}
	if err := json.NewDecoder(submitResponse.Body).Decode(&submitPayload); err != nil {
		t.Fatalf("decode submit response failed: %v", err)
	}
	if !submitPayload.Success || submitPayload.Data.Record.Score != sim.Score || submitPayload.Data.PointsEarned != match3.CalculatePointReward(sim.Score) {
		t.Fatalf("unexpected submit payload: %+v sim=%+v", submitPayload, sim)
	}

	var duplicateSuccesses atomic.Int64
	var duplicateFailures atomic.Int64
	var waitGroup sync.WaitGroup
	for index := 0; index < 20; index++ {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			duplicate := performMatch3JSONRequest(handler, userID, http.MethodPost, "/api/games/match3/submit", string(submitBody))
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
	if balance != submitPayload.Data.PointsEarned {
		t.Fatalf("duplicate submit should not grant points twice, balance=%d points=%d", balance, submitPayload.Data.PointsEarned)
	}
	var recordCount int64
	if err := db.QueryRow(ctx, `SELECT count(*) FROM game_records WHERE user_id = $1 AND game_type = 'match3'`, userID).Scan(&recordCount); err != nil {
		t.Fatalf("query record count failed: %v", err)
	}
	if recordCount != 1 {
		t.Fatalf("expected exactly one match3 record, got %d", recordCount)
	}
}

func performMatch3JSONRequest(handler http.Handler, userID int64, method string, path string, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	request.Host = "example.com"
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch || method == http.MethodDelete {
		request.Header.Set("Origin", "http://example.com")
	}
	request.AddCookie(testSessionCookieFor(userID, "match3_http_"+strconv.FormatInt(userID, 10), "Match3 HTTP User"))
	return performRequest(handler, request)
}

func loadMatch3SessionForHTTPTest(t *testing.T, ctx context.Context, db *pgxpool.Pool, sessionID string) match3.Session {
	t.Helper()
	var raw []byte
	if err := db.QueryRow(ctx, `SELECT payload FROM game_sessions WHERE id = $1`, sessionID).Scan(&raw); err != nil {
		t.Fatalf("load match3 session failed: %v", err)
	}
	var session match3.Session
	if err := json.Unmarshal(raw, &session); err != nil {
		t.Fatalf("decode match3 session failed: %v", err)
	}
	return session
}

func firstValidMatch3Move(t *testing.T, seed string, config match3.Config) (match3.Move, match3.SimulationResult) {
	t.Helper()
	total := config.Rows * config.Cols
	for index := 0; index < total; index++ {
		candidates := []int{}
		if index%config.Cols < config.Cols-1 {
			candidates = append(candidates, index+1)
		}
		if index/config.Cols < config.Rows-1 {
			candidates = append(candidates, index+config.Cols)
		}
		for _, to := range candidates {
			move := match3.Move{From: index, To: to}
			sim := match3.SimulateGame(seed, config, []match3.Move{move})
			if sim.OK {
				return move, sim
			}
		}
	}
	t.Fatalf("no valid match3 move found for seed %s", seed)
	return match3.Move{}, match3.SimulationResult{}
}

func cleanupHTTPTestMatch3User(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64) {
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
			t.Fatalf("cleanup match3 http user %d failed: %v", userID, err)
		}
	}
}
