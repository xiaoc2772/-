//go:build integration

// M4 真实对账三阶段管线（与 src/lib/lucky-td/__tests__/reconcile.m4.test.ts 配合）：
//
//	export TEST_DATABASE_URL=postgres://app:app@localhost:15432/app_test?sslmode=disable
//	export LUCKYTD_RECONCILE_DIR=<绝对路径>
//	1) go test -tags integration -run TestLuckyTdReconcilePhase1 ./internal/httpserver   → sessions.json
//	2) LUCKYTD_RECONCILE_DIR=... npx vitest run src/lib/lucky-td/__tests__/reconcile.m4.test.ts → games.json
//	3) go test -tags integration -run TestLuckyTdReconcilePhase3 -v ./internal/httpserver → 对账 + 发分断言
//
// phase3 与生产唯一的偏差：提交前把 started_at 回拨到「按 30fps 实时打完 + 60s」，
// 让配速审计面对与真实游玩等价的时长（管线本身秒级完成，不可能真等 8~12 分钟/局）。
package httpserver

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"redemption/backend/internal/config"
	"redemption/backend/internal/luckytd"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"
	"redemption/backend/internal/systemconfig"

	"github.com/jackc/pgx/v5/pgxpool"
)

const reconcileGameCount = 20
const reconcileUserBase = int64(905_000_000)

type reconcileSession struct {
	Index     int      `json:"index"`
	UserID    int64    `json:"userId"`
	SessionID string   `json:"sessionId"`
	Seed      string   `json:"seed"`
	MapID     string   `json:"mapId"`
	Squad     []string `json:"squad"`
	PlanKey   string   `json:"planKey"`
}

type reconcileCheckpoint struct {
	WaveIndex   int    `json:"waveIndex"`
	Frame       int    `json:"frame"`
	StateHash   uint32 `json:"stateHash"`
	ActionCount int    `json:"actionCount"`
}

type reconcileGame struct {
	reconcileSession
	Actions      []luckytd.GameAction  `json:"actions"`
	Checkpoints  []reconcileCheckpoint `json:"checkpoints"`
	FinalFrame   int                   `json:"finalFrame"`
	Score        int                   `json:"score"`
	Status       int                   `json:"status"`
	WavesCleared int                   `json:"wavesCleared"`
	FinalHash    uint32                `json:"finalHash"`
}

func reconcileEnv(t *testing.T) (string, *pgxpool.Pool, http.Handler, context.Context) {
	t.Helper()
	dir := os.Getenv("LUCKYTD_RECONCILE_DIR")
	if dir == "" {
		t.Skip("LUCKYTD_RECONCILE_DIR 未设置，跳过 M4 对账")
	}
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}
	ctx := context.Background()
	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	t.Cleanup(db.Close)
	if _, err := pgmigration.NewRunner(db, httpMigrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}
	resetInMemoryRateLimitsForTest()
	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	return dir, db, handler, ctx
}

func reconcilePlanFor(index int) (string, []string, string) {
	if index%8 == 7 {
		return "training_field", []string{"flameblade", "koi", "archer", "medic", "vanguard"}, "koi"
	}
	base := []string{"vanguard", "defender", "ranger", "archer", "caster", "medic"}
	blade := []string{"vanguard", "defender", "ranger", "flameblade", "caster", "medic"}
	switch index % 6 {
	case 0:
		return "training_field", base, "training"
	case 1:
		return "brook_ford", blade, "brook"
	case 2:
		return "starlamp_outpost", base, "starlamp"
	case 3:
		return "frostfire_fault", base, "frostfire"
	case 4:
		return "rubblemist_plateau", blade, "rubblemist"
	default:
		return "thundervoid_gate", base, "thundervoid"
	}
}

func TestLuckyTdReconcilePhase1CreateSessions(t *testing.T) {
	dir, db, handler, ctx := reconcileEnv(t)

	sessions := make([]reconcileSession, 0, reconcileGameCount)
	for i := 0; i < reconcileGameCount; i++ {
		userID := reconcileUserBase + int64(i)
		cleanupHTTPTestLuckyTdUser(t, ctx, db, userID)
		mapID, squad, planKey := reconcilePlanFor(i)
		body, err := json.Marshal(luckytd.StartInput{MapID: mapID, Squad: squad})
		if err != nil {
			t.Fatalf("marshal start input failed: %v", err)
		}
		response := performLuckyTdJSONRequest(handler, userID, http.MethodPost, "/api/games/lucky-td/start", string(body))
		if response.Code != http.StatusOK {
			t.Fatalf("game %d: expected start 200, got %d body=%s", i, response.Code, response.Body.String())
		}
		var payload struct {
			Success bool `json:"success"`
			Data    struct {
				SessionID string `json:"sessionId"`
				Seed      string `json:"seed"`
			} `json:"data"`
		}
		if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
			t.Fatalf("game %d: decode start response failed: %v", i, err)
		}
		if !payload.Success || payload.Data.SessionID == "" || payload.Data.Seed == "" {
			t.Fatalf("game %d: unexpected start payload: %+v", i, payload)
		}
		sessions = append(sessions, reconcileSession{
			Index:     i,
			UserID:    userID,
			SessionID: payload.Data.SessionID,
			Seed:      payload.Data.Seed,
			MapID:     mapID,
			Squad:     squad,
			PlanKey:   planKey,
		})
	}

	raw, err := json.MarshalIndent(sessions, "", "  ")
	if err != nil {
		t.Fatalf("marshal sessions failed: %v", err)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir reconcile dir failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "sessions.json"), raw, 0o644); err != nil {
		t.Fatalf("write sessions.json failed: %v", err)
	}
	t.Logf("phase1: %d sessions created", len(sessions))
}

func TestLuckyTdReconcilePhase3SubmitAndSettle(t *testing.T) {
	dir, db, handler, ctx := reconcileEnv(t)

	raw, err := os.ReadFile(filepath.Join(dir, "games.json"))
	if err != nil {
		t.Skipf("games.json 不存在（先跑 phase2 vitest）：%v", err)
	}
	var games []reconcileGame
	if err := json.Unmarshal(raw, &games); err != nil {
		t.Fatalf("decode games.json failed: %v", err)
	}
	if len(games) == 0 {
		t.Fatal("games.json is empty")
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx failed: %v", err)
	}
	dailyLimit, err := systemconfig.DailyPointsLimit(ctx, tx)
	if err != nil {
		t.Fatalf("load daily limit failed: %v", err)
	}
	_ = tx.Rollback(ctx)

	fps := luckytdFPS(t)
	wins := 0
	totalPoints := int64(0)
	minWin, maxWin := 0, 0
	for _, game := range games {
		prev := 0
		for _, checkpoint := range game.Checkpoints {
			delta := game.Actions[prev:checkpoint.ActionCount]
			prev = checkpoint.ActionCount
			body, err := json.Marshal(luckytd.CheckpointInput{
				SessionID:    game.SessionID,
				WaveIndex:    checkpoint.WaveIndex,
				Frame:        checkpoint.Frame,
				StateHash:    checkpoint.StateHash,
				ActionsDelta: delta,
			})
			if err != nil {
				t.Fatalf("game %d: marshal checkpoint failed: %v", game.Index, err)
			}
			response := performLuckyTdJSONRequest(handler, game.UserID, http.MethodPost, "/api/games/lucky-td/checkpoint", string(body))
			if response.Code != http.StatusOK {
				t.Fatalf("game %d wave %d: checkpoint rejected: %d %s", game.Index, checkpoint.WaveIndex, response.Code, response.Body.String())
			}
		}

		session := loadLuckyTdSessionForHTTPTest(t, ctx, db, game.SessionID)
		session.StartedAt -= int64(game.FinalFrame*1000/fps) + 60_000
		adjusted, err := json.Marshal(session)
		if err != nil {
			t.Fatalf("game %d: marshal adjusted session failed: %v", game.Index, err)
		}
		if _, err := db.Exec(ctx,
			`UPDATE game_sessions SET payload = $1, started_at = $2 WHERE id = $3`,
			adjusted, time.UnixMilli(session.StartedAt), game.SessionID,
		); err != nil {
			t.Fatalf("game %d: adjust session start time failed: %v", game.Index, err)
		}

		submitBody, err := json.Marshal(luckytd.SubmitInput{
			SessionID:    game.SessionID,
			FinalFrame:   game.FinalFrame,
			ClaimedScore: game.Score,
			ActionsDelta: game.Actions[prev:],
		})
		if err != nil {
			t.Fatalf("game %d: marshal submit failed: %v", game.Index, err)
		}
		response := performLuckyTdJSONRequest(handler, game.UserID, http.MethodPost, "/api/games/lucky-td/submit", string(submitBody))
		if response.Code != http.StatusOK {
			t.Fatalf("game %d: submit rejected: %d %s", game.Index, response.Code, response.Body.String())
		}
		var payload struct {
			Success bool `json:"success"`
			Data    struct {
				Score        int64 `json:"score"`
				PointsEarned int64 `json:"pointsEarned"`
				WavesCleared int   `json:"wavesCleared"`
				Status       int   `json:"status"`
			} `json:"data"`
		}
		if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
			t.Fatalf("game %d: decode submit response failed: %v", game.Index, err)
		}
		if !payload.Success {
			t.Fatalf("game %d: submit not successful: %s", game.Index, response.Body.String())
		}
		if payload.Data.Score != int64(game.Score) || payload.Data.Status != game.Status || payload.Data.WavesCleared != game.WavesCleared {
			t.Fatalf("game %d: 对账不一致 server={score:%d status:%d waves:%d} ts={score:%d status:%d waves:%d}",
				game.Index, payload.Data.Score, payload.Data.Status, payload.Data.WavesCleared,
				game.Score, game.Status, game.WavesCleared)
		}
		expectedPoints := int64(game.Score)
		if expectedPoints > dailyLimit {
			expectedPoints = dailyLimit
		}
		if payload.Data.PointsEarned != expectedPoints {
			t.Fatalf("game %d: 发分不符 got=%d want=%d (dailyLimit=%d)", game.Index, payload.Data.PointsEarned, expectedPoints, dailyLimit)
		}

		var balance int64
		if err := db.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, game.UserID).Scan(&balance); err != nil {
			t.Fatalf("game %d: query balance failed: %v", game.Index, err)
		}
		if balance != expectedPoints {
			t.Fatalf("game %d: 余额不符 got=%d want=%d", game.Index, balance, expectedPoints)
		}
		if expectedPoints > 0 {
			var ledgerCount int64
			if err := db.QueryRow(ctx,
				`SELECT count(*) FROM point_ledger WHERE user_id = $1 AND source = 'game_play'`, game.UserID,
			).Scan(&ledgerCount); err != nil {
				t.Fatalf("game %d: query ledger failed: %v", game.Index, err)
			}
			if ledgerCount != 1 {
				t.Fatalf("game %d: 台账条数不符 got=%d want=1", game.Index, ledgerCount)
			}
		}
		var activeCount int64
		if err := db.QueryRow(ctx,
			`SELECT count(*) FROM active_game_sessions WHERE user_id = $1`, game.UserID,
		).Scan(&activeCount); err != nil {
			t.Fatalf("game %d: query active session failed: %v", game.Index, err)
		}
		if activeCount != 0 {
			t.Fatalf("game %d: 结算后活跃会话未清除", game.Index)
		}

		totalPoints += payload.Data.PointsEarned
		if game.Status == 1 {
			wins++
			if minWin == 0 || game.Score < minWin {
				minWin = game.Score
			}
			if game.Score > maxWin {
				maxWin = game.Score
			}
		}
	}

	t.Logf("phase3: %d 局全部对账一致；胜 %d 局（胜局分数 %d~%d），发分合计 %d（dailyLimit=%d）",
		len(games), wins, minWin, maxWin, totalPoints, dailyLimit)

	for _, game := range games {
		cleanupHTTPTestLuckyTdUser(t, ctx, db, game.UserID)
	}
}
