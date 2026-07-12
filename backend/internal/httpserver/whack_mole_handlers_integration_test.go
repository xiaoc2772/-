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
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"
	"redemption/backend/internal/whackmole"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestWhackMoleHTTPCompleteGameAndReplayDuplicateSettlement(t *testing.T) {
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

	userID := int64(43001 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestWhackMoleUser(t, ctx, db, userID)
	defer cleanupHTTPTestWhackMoleUser(t, ctx, db, userID)

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})

	startResponse := performWhackMoleJSONRequest(handler, userID, http.MethodPost, "/api/games/whack-mole/start", `{"difficulty":"normal"}`)
	if startResponse.Code != http.StatusOK {
		t.Fatalf("expected start 200, got %d body=%s", startResponse.Code, startResponse.Body.String())
	}
	var startPayload struct {
		Success bool                  `json:"success"`
		Data    whackmole.SessionView `json:"data"`
	}
	if err := json.NewDecoder(startResponse.Body).Decode(&startPayload); err != nil {
		t.Fatalf("decode start response failed: %v", err)
	}
	if !startPayload.Success || startPayload.Data.SessionID == "" || startPayload.Data.Seed == "" || startPayload.Data.DurationMs != 60_000 {
		t.Fatalf("unexpected start payload: %+v", startPayload)
	}

	syncResponse := performWhackMoleJSONRequest(handler, userID, http.MethodGet, "/api/games/whack-mole/sync", "")
	if syncResponse.Code != http.StatusOK {
		t.Fatalf("expected sync 200, got %d body=%s", syncResponse.Code, syncResponse.Body.String())
	}

	session := loadWhackMoleSessionForHTTPTest(t, ctx, db, startPayload.Data.SessionID)
	config := whackmole.DifficultyConfigFor(session.Difficulty)
	session.StartedAt -= config.DurationMs
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

	event, scored := firstWhackMoleHitEvent(t, session.Seed, session.Difficulty)
	submitBody, err := json.Marshal(whackmole.SubmitInput{
		SessionID: session.ID,
		Events:    []whackmole.HitEvent{event},
	})
	if err != nil {
		t.Fatalf("marshal submit body failed: %v", err)
	}
	submitResponse := performWhackMoleJSONRequest(handler, userID, http.MethodPost, "/api/games/whack-mole/submit", string(submitBody))
	if submitResponse.Code != http.StatusOK {
		t.Fatalf("expected submit 200, got %d body=%s", submitResponse.Code, submitResponse.Body.String())
	}
	var submitPayload struct {
		Success bool `json:"success"`
		Data    struct {
			PointsEarned int64            `json:"pointsEarned"`
			Record       whackmole.Record `json:"record"`
		} `json:"data"`
	}
	if err := json.NewDecoder(submitResponse.Body).Decode(&submitPayload); err != nil {
		t.Fatalf("decode submit response failed: %v", err)
	}
	if !submitPayload.Success || submitPayload.Data.Record.Score != scored.Score || submitPayload.Data.PointsEarned != whackmole.CalculatePointReward(scored.Score, session.Difficulty) {
		t.Fatalf("unexpected submit payload: %+v scored=%+v", submitPayload, scored)
	}

	var duplicateSuccesses atomic.Int64
	var duplicateFailures atomic.Int64
	var waitGroup sync.WaitGroup
	for index := 0; index < 20; index++ {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			duplicate := performWhackMoleJSONRequest(handler, userID, http.MethodPost, "/api/games/whack-mole/submit", string(submitBody))
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
	if err := db.QueryRow(ctx, `SELECT count(*) FROM game_records WHERE user_id = $1 AND game_type = 'whack_mole'`, userID).Scan(&recordCount); err != nil {
		t.Fatalf("query record count failed: %v", err)
	}
	if recordCount != 1 {
		t.Fatalf("expected exactly one whack_mole record, got %d", recordCount)
	}
}

func performWhackMoleJSONRequest(handler http.Handler, userID int64, method string, path string, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	request.Host = "example.com"
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch || method == http.MethodDelete {
		request.Header.Set("Origin", "http://example.com")
	}
	request.AddCookie(testSessionCookieFor(userID, "whack_http_"+strconv.FormatInt(userID, 10), "Whack HTTP User"))
	return performRequest(handler, request)
}

func loadWhackMoleSessionForHTTPTest(t *testing.T, ctx context.Context, db *pgxpool.Pool, sessionID string) whackmole.Session {
	t.Helper()
	var raw []byte
	if err := db.QueryRow(ctx, `SELECT payload FROM game_sessions WHERE id = $1`, sessionID).Scan(&raw); err != nil {
		t.Fatalf("load whack mole session failed: %v", err)
	}
	var session whackmole.Session
	if err := json.Unmarshal(raw, &session); err != nil {
		t.Fatalf("decode whack mole session failed: %v", err)
	}
	return session
}

func firstWhackMoleHitEvent(t *testing.T, seed string, difficulty whackmole.Difficulty) (whackmole.HitEvent, whackmole.ScoreResult) {
	t.Helper()
	config := whackmole.DifficultyConfigFor(difficulty)
	for elapsedMs := int64(1000); elapsedMs < config.DurationMs; elapsedMs += 250 {
		board := whackmole.GetBoard(seed, elapsedMs, difficulty)
		for index, cell := range board {
			if cell == whackmole.CellMole || cell == whackmole.CellGolden {
				event := whackmole.HitEvent{Index: index, ElapsedMs: elapsedMs}
				scored := whackmole.ScoreEvents(seed, []whackmole.HitEvent{event}, difficulty)
				if scored.Score > 0 {
					return event, scored
				}
			}
		}
	}
	t.Fatalf("no valid whack mole hit event found for seed %s", seed)
	return whackmole.HitEvent{}, whackmole.ScoreResult{}
}

func cleanupHTTPTestWhackMoleUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64) {
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
			t.Fatalf("cleanup whack mole http user %d failed: %v", userID, err)
		}
	}
}
