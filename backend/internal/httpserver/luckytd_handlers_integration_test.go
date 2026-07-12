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
	"testing"
	"time"

	"redemption/backend/internal/config"
	"redemption/backend/internal/luckytd"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestLuckyTdHTTPStartSubmitAndReplayDuplicateSettlement(t *testing.T) {
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

	resetInMemoryRateLimitsForTest()
	userID := int64(90420 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestLuckyTdUser(t, ctx, db, userID)
	defer cleanupHTTPTestLuckyTdUser(t, ctx, db, userID)

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})

	startResponse := performLuckyTdJSONRequest(handler, userID, http.MethodPost, "/api/games/lucky-td/start", `{"mapId":"training_field","squad":["vanguard"]}`)
	if startResponse.Code != http.StatusOK {
		t.Fatalf("expected start 200, got %d body=%s", startResponse.Code, startResponse.Body.String())
	}
	var startPayload struct {
		Success bool                `json:"success"`
		Data    luckytd.SessionView `json:"data"`
	}
	if err := json.NewDecoder(startResponse.Body).Decode(&startPayload); err != nil {
		t.Fatalf("decode start response failed: %v", err)
	}
	if !startPayload.Success || startPayload.Data.SessionID == "" || startPayload.Data.Seed == "" {
		t.Fatalf("unexpected start payload: %+v", startPayload)
	}

	session := loadLuckyTdSessionForHTTPTest(t, ctx, db, startPayload.Data.SessionID)
	replay := luckytd.Replay(luckytd.ReplayInput{
		Seed:    session.Seed,
		MapID:   session.MapID,
		Squad:   session.Squad,
		Actions: nil,
	})
	if !replay.OK || replay.Result == nil {
		t.Fatalf("empty action replay failed: %s", replay.Error)
	}

	session.StartedAt -= int64(replay.Result.Frames*1000/luckytdFPS(t)) + 60_000
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

	submitBody, err := json.Marshal(luckytd.SubmitInput{
		SessionID:    session.ID,
		FinalFrame:   replay.Result.Frames,
		ClaimedScore: replay.Result.Score,
		ActionsDelta: []luckytd.GameAction{},
	})
	if err != nil {
		t.Fatalf("marshal submit body failed: %v", err)
	}
	submitResponse := performLuckyTdJSONRequest(handler, userID, http.MethodPost, "/api/games/lucky-td/submit", string(submitBody))
	if submitResponse.Code != http.StatusOK {
		t.Fatalf("expected submit 200, got %d body=%s", submitResponse.Code, submitResponse.Body.String())
	}
	var submitPayload struct {
		Success bool `json:"success"`
		Data    struct {
			Score               int64 `json:"score"`
			BasePoints          int64 `json:"basePoints"`
			RewardPoints        int64 `json:"rewardPoints"`
			SquadSize           int   `json:"squadSize"`
			SquadBonusPermyriad int   `json:"squadBonusPermyriad"`
			PointsEarned        int64 `json:"pointsEarned"`
			WavesCleared        int   `json:"wavesCleared"`
			Status              int   `json:"status"`
		} `json:"data"`
	}
	if err := json.NewDecoder(submitResponse.Body).Decode(&submitPayload); err != nil {
		t.Fatalf("decode submit response failed: %v", err)
	}
	if !submitPayload.Success || submitPayload.Data.Score != int64(replay.Result.Score) || submitPayload.Data.Status != replay.Result.Status {
		t.Fatalf("unexpected submit payload: %+v replay=%+v", submitPayload, replay.Result)
	}
	if submitPayload.Data.BasePoints != int64(replay.Result.Score) ||
		submitPayload.Data.SquadSize != 1 ||
		submitPayload.Data.SquadBonusPermyriad != luckytd.SquadBonusPermyriad(1) ||
		submitPayload.Data.RewardPoints != luckytd.PointRewardForScore(replay.Result.Score, 1) ||
		submitPayload.Data.PointsEarned != submitPayload.Data.RewardPoints {
		t.Fatalf("unexpected squad reward fields: %+v replay=%+v", submitPayload.Data, replay.Result)
	}

	duplicate := performLuckyTdJSONRequest(handler, userID, http.MethodPost, "/api/games/lucky-td/submit", string(submitBody))
	if duplicate.Code != http.StatusOK {
		t.Fatalf("expected duplicate submit 200, got %d body=%s", duplicate.Code, duplicate.Body.String())
	}

	var balance int64
	if err := db.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, userID).Scan(&balance); err != nil {
		t.Fatalf("query balance failed: %v", err)
	}
	if balance != submitPayload.Data.PointsEarned {
		t.Fatalf("duplicate submit should not grant points twice, balance=%d points=%d", balance, submitPayload.Data.PointsEarned)
	}
	var recordCount int64
	if err := db.QueryRow(ctx, `SELECT count(*) FROM game_records WHERE user_id = $1 AND game_type = $2`, userID, luckytd.GameType).Scan(&recordCount); err != nil {
		t.Fatalf("query record count failed: %v", err)
	}
	if recordCount != 1 {
		t.Fatalf("expected exactly one lucky_td record, got %d", recordCount)
	}
}

func performLuckyTdJSONRequest(handler http.Handler, userID int64, method string, path string, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	request.Host = "example.com"
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch || method == http.MethodDelete {
		request.Header.Set("Origin", "http://example.com")
	}
	request.AddCookie(testSessionCookieFor(userID, "luckytd_http_"+strconv.FormatInt(userID, 10), "Lucky TD HTTP User"))
	return performRequest(handler, request)
}

func loadLuckyTdSessionForHTTPTest(t *testing.T, ctx context.Context, db *pgxpool.Pool, sessionID string) luckytd.Session {
	t.Helper()
	var raw []byte
	if err := db.QueryRow(ctx, `SELECT payload FROM game_sessions WHERE id = $1`, sessionID).Scan(&raw); err != nil {
		t.Fatalf("load lucky td session failed: %v", err)
	}
	var session luckytd.Session
	if err := json.Unmarshal(raw, &session); err != nil {
		t.Fatalf("decode lucky td session failed: %v", err)
	}
	return session
}

func luckytdFPS(t *testing.T) int {
	t.Helper()
	data, err := luckytd.GetEngineData()
	if err != nil {
		t.Fatalf("load lucky td config failed: %v", err)
	}
	return data.Config.Engine.Fps
}

func cleanupHTTPTestLuckyTdUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64) {
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
			t.Fatalf("cleanup lucky td http user %d failed: %v", userID, err)
		}
	}
}
