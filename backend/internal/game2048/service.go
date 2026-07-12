package game2048

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"redemption/backend/internal/auth"
	"redemption/backend/internal/systemconfig"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	sessionTTLSeconds       = int64(12 * 60 * 60)
	cooldownTTLSeconds      = int64(5)
	maxRecordsListSize      = 50
	defaultRecordsListSize  = 10
	maxRetryableTxRetries   = 12
	recordDifficulty        = ""
	settlementDescriptionCN = "2048 得分 %d，最高方块 %d，福利积分 %d"
)

var ErrUnavailable = errors.New("game2048 database unavailable")

type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

func (service *Service) Start(ctx context.Context, user auth.User) (StartResult, error) {
	if service.db == nil {
		return StartResult{}, ErrUnavailable
	}

	var output StartResult
	err := service.withRetryableTx(ctx, func(tx pgx.Tx) error {
		if err := ensureUser(ctx, tx, user); err != nil {
			return err
		}
		if _, err := lockUserAccount(ctx, tx, user.ID); err != nil {
			return err
		}
		if remaining, err := cooldownRemaining(ctx, tx, user.ID, time.Now()); err != nil {
			return err
		} else if remaining > 0 {
			output = StartResult{Success: false, Message: fmt.Sprintf("请等待 %d 秒后再开始游戏", remaining)}
			return nil
		}
		active, err := getActiveSessionForUpdate(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		if active != nil && active.Status == "playing" && time.Now().UnixMilli() < active.ExpiresAt {
			output = StartResult{Success: false, Message: "你已有正在进行的游戏"}
			return nil
		}
		if active != nil {
			if err := deleteSessionAndActive(ctx, tx, user.ID, active.ID); err != nil {
				return err
			}
		}

		now := time.Now()
		nowMs := millis(now)
		session := Session{
			ID:        randomHex(16),
			UserID:    user.ID,
			GameType:  GameType,
			Seed:      randomHex(16),
			StartedAt: nowMs,
			ExpiresAt: nowMs + sessionTTLSeconds*1000,
			Status:    "playing",
		}
		if err := saveSession(ctx, tx, session); err != nil {
			return err
		}
		output = StartResult{Success: true, Session: &session}
		return nil
	})
	return output, err
}

func (service *Service) Status(ctx context.Context, user auth.User) (StatusData, error) {
	if service.db == nil {
		return StatusData{}, ErrUnavailable
	}

	var output StatusData
	err := service.withRetryableTx(ctx, func(tx pgx.Tx) error {
		if err := ensureUser(ctx, tx, user); err != nil {
			return err
		}
		balance, err := getBalance(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		dailyStats, err := getDailyStats(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		remaining, err := cooldownRemaining(ctx, tx, user.ID, time.Now())
		if err != nil {
			return err
		}
		active, err := getActiveSessionForUpdate(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		records, err := listRecords(ctx, tx, user.ID, defaultRecordsListSize)
		if err != nil {
			return err
		}
		var activeView *SessionView
		if active != nil {
			view := BuildSessionView(*active)
			activeView = &view
		}
		dailyLimit, err := systemconfig.DailyPointsLimit(ctx, tx)
		if err != nil {
			return err
		}
		dailyGamePointsEarned, err := getDailyGamePointsEarned(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		output = StatusData{
			Balance:            balance,
			DailyStats:         dailyStats,
			InCooldown:         remaining > 0,
			CooldownRemaining:  remaining,
			DailyLimit:         dailyLimit,
			PointsLimitReached: dailyGamePointsEarned >= dailyLimit,
			Records:            records,
			ActiveSession:      activeView,
		}
		return nil
	})
	return output, err
}

func (service *Service) Cancel(ctx context.Context, user auth.User) (SimpleResult, error) {
	if service.db == nil {
		return SimpleResult{}, ErrUnavailable
	}

	var output SimpleResult
	err := service.withRetryableTx(ctx, func(tx pgx.Tx) error {
		if err := ensureUser(ctx, tx, user); err != nil {
			return err
		}
		if _, err := lockUserAccount(ctx, tx, user.ID); err != nil {
			return err
		}
		active, err := getActiveSessionForUpdate(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		if active == nil {
			output = SimpleResult{Success: false, Message: "没有正在进行的游戏"}
			return nil
		}
		if err := deleteRecordBySession(ctx, tx, user.ID, active.ID); err != nil {
			return err
		}
		if err := deleteSessionAndActive(ctx, tx, user.ID, active.ID); err != nil {
			return err
		}
		if err := setCooldown(ctx, tx, user.ID, time.Now().Add(time.Duration(cooldownTTLSeconds)*time.Second)); err != nil {
			return err
		}
		output = SimpleResult{Success: true}
		return nil
	})
	return output, err
}

func (service *Service) Checkpoint(ctx context.Context, user auth.User, input SubmitInput) (CheckpointResult, error) {
	if service.db == nil {
		return CheckpointResult{}, ErrUnavailable
	}
	input.SessionID = strings.TrimSpace(input.SessionID)
	normalized, ok, message := NormalizeMoves(input.Moves, MaxMoves)
	if input.SessionID == "" || !ok {
		if message == "" {
			message = "参数错误"
		}
		return CheckpointResult{Success: false, Message: message}, nil
	}

	var output CheckpointResult
	err := service.withRetryableTx(ctx, func(tx pgx.Tx) error {
		session, err := service.requirePlayingSession(ctx, tx, user, input.SessionID, false, nil)
		if err != nil {
			var checkpointErr checkpointFailure
			if errors.As(err, &checkpointErr) {
				output = CheckpointResult{Success: false, Message: checkpointErr.Error()}
				return nil
			}
			return err
		}
		if session == nil {
			output = CheckpointResult{Success: false, Message: "游戏会话不存在或已过期"}
			return nil
		}
		simulation := simulateSegment(*session, normalized)
		nextSession := *session
		nextSession.ExpiresAt = millis(time.Now()) + sessionTTLSeconds*1000
		nextSession.CheckpointGrid = simulation.Grid
		nextSession.CheckpointScore = simulation.Score
		nextSession.CheckpointMovesApplied = simulation.MovesApplied
		nextSession.CheckpointMovesSubmitted = simulation.MovesSubmitted
		if err := updateSessionPayload(ctx, tx, nextSession); err != nil {
			return err
		}
		if err := upsertRecord(ctx, tx, buildRecordFromSimulation(nextSession, simulation, 0, time.Now(), true)); err != nil {
			return err
		}
		output = CheckpointResult{Success: true, Session: &nextSession}
		return nil
	})
	return output, err
}

func (service *Service) Submit(ctx context.Context, user auth.User, input SubmitInput) (SubmitResult, error) {
	if service.db == nil {
		return SubmitResult{}, ErrUnavailable
	}
	input.SessionID = strings.TrimSpace(input.SessionID)
	normalized, ok, message := NormalizeMoves(input.Moves, MaxMoves)
	if input.SessionID == "" || !ok {
		if message == "" {
			message = "参数错误"
		}
		return SubmitResult{Success: false, Message: message}, nil
	}

	var output SubmitResult
	err := service.withRetryableTx(ctx, func(tx pgx.Tx) error {
		session, err := service.requirePlayingSession(ctx, tx, user, input.SessionID, true, &output)
		if err != nil || session == nil {
			return err
		}

		now := time.Now()
		simulation := simulateSegment(*session, normalized)
		pointReward := CalculatePointReward(simulation.Score, simulation.HighestTile)
		dailyLimit, err := systemconfig.DailyPointsLimit(ctx, tx)
		if err != nil {
			return err
		}
		pointsEarned, dailyEarned, err := addGamePointsWithLimit(
			ctx,
			tx,
			user,
			pointReward,
			dailyLimit,
			fmt.Sprintf(settlementDescriptionCN, simulation.Score, simulation.HighestTile, pointReward),
		)
		if err != nil {
			return err
		}
		duration := millis(now) - session.StartedAt
		if duration < 0 {
			duration = 0
		}
		maxDuration := sessionTTLSeconds * 1000
		if duration > maxDuration {
			duration = maxDuration
		}
		record := buildRecordFromSimulation(*session, simulation, pointsEarned, now, false)
		record.Duration = duration
		if err := upsertRecord(ctx, tx, record); err != nil {
			return err
		}
		if err := incrementDailyStats(ctx, tx, user.ID, simulation.Score, dailyEarned, now); err != nil {
			return err
		}
		if err := deleteSessionAndActive(ctx, tx, user.ID, session.ID); err != nil {
			return err
		}
		if err := setCooldown(ctx, tx, user.ID, now.Add(time.Duration(cooldownTTLSeconds)*time.Second)); err != nil {
			return err
		}
		output = SubmitResult{Success: true, Record: &record, PointsEarned: pointsEarned}
		return nil
	})
	return output, err
}

func (service *Service) requirePlayingSession(ctx context.Context, tx pgx.Tx, user auth.User, sessionID string, idempotent bool, submitOutput *SubmitResult) (*Session, error) {
	session, err := getSessionForUpdate(ctx, tx, sessionID)
	if err != nil {
		return nil, err
	}
	if session == nil {
		if idempotent {
			return nil, service.settledRecordOrFailure(ctx, tx, user, sessionID, "游戏会话不存在或已过期", submitOutput)
		}
		return nil, setCheckpointFailure("游戏会话不存在或已过期")
	}
	if session.UserID != user.ID {
		if idempotent {
			*submitOutput = SubmitResult{Success: false, Message: "会话不属于该用户"}
			return nil, nil
		}
		return nil, setCheckpointFailure("会话不属于该用户")
	}
	if ok, err := isCurrentActiveSession(ctx, tx, user.ID, session.ID); err != nil {
		return nil, err
	} else if !ok {
		if idempotent {
			return nil, service.settledRecordOrFailure(ctx, tx, user, session.ID, "游戏会话已不是当前活跃局", submitOutput)
		}
		return nil, setCheckpointFailure("游戏会话已不是当前活跃局")
	}
	if session.Status != "playing" {
		if idempotent {
			return nil, service.settledRecordOrFailure(ctx, tx, user, session.ID, "游戏会话已结束", submitOutput)
		}
		return nil, setCheckpointFailure("游戏会话已结束")
	}
	if time.Now().UnixMilli() > session.ExpiresAt {
		if err := deleteSessionAndActive(ctx, tx, user.ID, session.ID); err != nil {
			return nil, err
		}
		if idempotent {
			return nil, service.settledRecordOrFailure(ctx, tx, user, session.ID, "游戏会话已过期", submitOutput)
		}
		return nil, setCheckpointFailure("游戏会话已过期")
	}
	return session, nil
}

type checkpointFailure string

func (err checkpointFailure) Error() string {
	return string(err)
}

func setCheckpointFailure(message string) error {
	return checkpointFailure(message)
}

func (service *Service) settledRecordOrFailure(ctx context.Context, tx pgx.Tx, user auth.User, sessionID string, message string, output *SubmitResult) error {
	record, err := findRecordForUpdateBySession(ctx, tx, user.ID, sessionID)
	if err != nil {
		return err
	}
	if record != nil {
		if record.Pending {
			// checkpoint 也会写入 pending 记录；只有明确结束的快照才能恢复结算，
			// 避免会话过期后把未完成对局当作正式成绩发放积分。
			if !record.Won && !record.GameOver {
				*output = SubmitResult{Success: false, Message: message}
				return nil
			}
			finalized, err := service.finalizePendingRecord(ctx, tx, user, *record)
			if err != nil {
				return err
			}
			record = finalized
		}
		*output = SubmitResult{Success: true, Record: record, PointsEarned: record.PointsEarned}
		return nil
	}
	*output = SubmitResult{Success: false, Message: message}
	return nil
}

func (service *Service) finalizePendingRecord(ctx context.Context, tx pgx.Tx, user auth.User, record Record) (*Record, error) {
	pointReward := CalculatePointReward(record.Score, record.HighestTile)
	dailyLimit, err := systemconfig.DailyPointsLimit(ctx, tx)
	if err != nil {
		return nil, err
	}
	pointsEarned, dailyEarned, err := addGamePointsWithLimit(
		ctx,
		tx,
		user,
		pointReward-record.PointsEarned,
		dailyLimit,
		fmt.Sprintf(settlementDescriptionCN, record.Score, record.HighestTile, pointReward),
	)
	if err != nil {
		return nil, err
	}
	record.PointsEarned += pointsEarned
	record.Pending = false
	if err := upsertRecord(ctx, tx, record); err != nil {
		return nil, err
	}
	if err := incrementDailyStats(ctx, tx, user.ID, record.Score, dailyEarned, time.UnixMilli(record.CreatedAt)); err != nil {
		return nil, err
	}
	return &record, nil
}

func BuildSessionView(session Session) SessionView {
	checkpoint := getCheckpoint(session)
	return SessionView{
		SessionID:          session.ID,
		Seed:               session.Seed,
		StartedAt:          session.StartedAt,
		ExpiresAt:          session.ExpiresAt,
		InitialGrid:        checkpoint.grid,
		BaseScore:          checkpoint.score,
		BaseMoves:          checkpoint.movesApplied,
		BaseMovesSubmitted: checkpoint.movesSubmitted,
	}
}

type checkpointState struct {
	grid           Grid
	score          int64
	movesApplied   int
	movesSubmitted int
}

func getCheckpoint(session Session) checkpointState {
	if IsValidGrid(session.CheckpointGrid) &&
		session.CheckpointScore >= 0 &&
		session.CheckpointMovesApplied >= 0 &&
		session.CheckpointMovesSubmitted >= session.CheckpointMovesApplied {
		return checkpointState{
			grid:           session.CheckpointGrid,
			score:          session.CheckpointScore,
			movesApplied:   session.CheckpointMovesApplied,
			movesSubmitted: session.CheckpointMovesSubmitted,
		}
	}
	return checkpointState{
		grid: CreateInitialGrid(session.Seed),
	}
}

func simulateSegment(session Session, moves []Direction) SimulationResult {
	checkpoint := getCheckpoint(session)
	grid := checkpoint.grid
	score := checkpoint.score
	movesApplied := checkpoint.movesApplied
	for _, direction := range moves {
		moved := MoveGrid(grid, direction)
		if !moved.Moved {
			continue
		}
		score += moved.ScoreDelta
		grid = SpawnTile(moved.Grid, session.Seed, movesApplied+2)
		movesApplied++
	}
	highestTile := HighestTile(grid)
	return SimulationResult{
		OK:             true,
		Grid:           grid,
		Score:          score,
		HighestTile:    highestTile,
		MovesSubmitted: checkpoint.movesSubmitted + len(moves),
		MovesApplied:   movesApplied,
		Won:            IsWinningScore(score),
		GameOver:       IsGameOver(grid),
	}
}

func (service *Service) withRetryableTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	var lastErr error
	for attempt := 0; attempt <= maxRetryableTxRetries; attempt++ {
		tx, err := service.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
		if err != nil {
			return err
		}
		err = fn(tx)
		var checkpointErr checkpointFailure
		if errors.As(err, &checkpointErr) {
			_ = tx.Rollback(ctx)
			return err
		}
		if err == nil {
			err = tx.Commit(ctx)
		}
		if err == nil {
			return nil
		}
		_ = tx.Rollback(ctx)
		lastErr = err
		if !isRetryableTxError(err) || attempt == maxRetryableTxRetries {
			return err
		}
		if err := sleepBeforeRetry(ctx, attempt); err != nil {
			return err
		}
	}
	return lastErr
}

func ensureUser(ctx context.Context, tx pgx.Tx, user auth.User) error {
	displayName := strings.TrimSpace(user.DisplayName)
	if displayName == "" {
		displayName = user.Username
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $3, now(), now())
		 ON CONFLICT (id) DO UPDATE SET
		   username = excluded.username,
		   display_name = excluded.display_name,
		   updated_at = now()`,
		user.ID, user.Username, displayName,
	); err != nil {
		return err
	}
	_, err := tx.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 0, now())
		 ON CONFLICT (user_id) DO NOTHING`,
		user.ID,
	)
	return err
}

func lockUserAccount(ctx context.Context, tx pgx.Tx, userID int64) (int64, error) {
	var balance int64
	err := tx.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1 FOR UPDATE`, userID).Scan(&balance)
	return balance, err
}

func getBalance(ctx context.Context, tx pgx.Tx, userID int64) (int64, error) {
	var balance int64
	err := tx.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, userID).Scan(&balance)
	return balance, err
}

func cooldownRemaining(ctx context.Context, tx pgx.Tx, userID int64, now time.Time) (int64, error) {
	var expiresAt time.Time
	err := tx.QueryRow(ctx,
		`SELECT expires_at FROM game_cooldowns WHERE user_id = $1 AND game_type = $2`,
		userID, GameType,
	).Scan(&expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if !expiresAt.After(now) {
		_, err := tx.Exec(ctx, `DELETE FROM game_cooldowns WHERE user_id = $1 AND game_type = $2`, userID, GameType)
		return 0, err
	}
	return int64(math.Ceil(expiresAt.Sub(now).Seconds())), nil
}

func getActiveSessionForUpdate(ctx context.Context, tx pgx.Tx, userID int64) (*Session, error) {
	var sessionID string
	var activeExpiresAt time.Time
	err := tx.QueryRow(ctx,
		`SELECT session_id, expires_at
		 FROM active_game_sessions
		 WHERE user_id = $1 AND game_type = $2
		 FOR UPDATE`,
		userID, GameType,
	).Scan(&sessionID, &activeExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !activeExpiresAt.After(time.Now()) {
		return nil, deleteSessionAndActive(ctx, tx, userID, sessionID)
	}
	return getSessionForUpdate(ctx, tx, sessionID)
}

func getSessionForUpdate(ctx context.Context, tx pgx.Tx, sessionID string) (*Session, error) {
	var payload []byte
	err := tx.QueryRow(ctx,
		`SELECT payload
		 FROM game_sessions
		 WHERE id = $1 AND game_type = $2
		 FOR UPDATE`,
		sessionID, GameType,
	).Scan(&payload)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var session Session
	if err := json.Unmarshal(payload, &session); err != nil {
		return nil, err
	}
	return &session, nil
}

func saveSession(ctx context.Context, tx pgx.Tx, session Session) error {
	raw, err := json.Marshal(session)
	if err != nil {
		return err
	}
	expiresAt := time.UnixMilli(session.ExpiresAt)
	if _, err := tx.Exec(ctx,
		`INSERT INTO game_sessions (id, user_id, game_type, status, payload, started_at, expires_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
		session.ID, session.UserID, session.GameType, session.Status, raw, time.UnixMilli(session.StartedAt), expiresAt,
	); err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO active_game_sessions (user_id, game_type, session_id, expires_at)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (user_id, game_type) DO UPDATE SET
		   session_id = excluded.session_id,
		   expires_at = excluded.expires_at`,
		session.UserID, session.GameType, session.ID, expiresAt,
	)
	return err
}

func updateSessionPayload(ctx context.Context, tx pgx.Tx, session Session) error {
	raw, err := json.Marshal(session)
	if err != nil {
		return err
	}
	expiresAt := time.UnixMilli(session.ExpiresAt)
	if _, err := tx.Exec(ctx,
		`UPDATE game_sessions
		 SET status = $2, payload = $3, expires_at = $4, updated_at = now()
		 WHERE id = $1 AND game_type = $5`,
		session.ID, session.Status, raw, expiresAt, GameType,
	); err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`UPDATE active_game_sessions
		 SET expires_at = $3
		 WHERE user_id = $1 AND game_type = $2`,
		session.UserID, GameType, expiresAt,
	)
	return err
}

func deleteSessionAndActive(ctx context.Context, tx pgx.Tx, userID int64, sessionID string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM active_game_sessions WHERE user_id = $1 AND game_type = $2`, userID, GameType); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `DELETE FROM game_sessions WHERE id = $1 AND game_type = $2`, sessionID, GameType)
	return err
}

func setCooldown(ctx context.Context, tx pgx.Tx, userID int64, expiresAt time.Time) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO game_cooldowns (user_id, game_type, expires_at, updated_at)
		 VALUES ($1, $2, $3, now())
		 ON CONFLICT (user_id, game_type) DO UPDATE SET
		   expires_at = excluded.expires_at,
		   updated_at = now()`,
		userID, GameType, expiresAt,
	)
	return err
}

func getDailyStats(ctx context.Context, tx pgx.Tx, userID int64) (DailyStats, error) {
	date := todayChina()
	var stats DailyStats
	var statDate time.Time
	var lastGameAt *time.Time
	err := tx.QueryRow(ctx,
		`SELECT user_id, stat_date, games_played, total_score, points_earned, last_game_at
		 FROM game_daily_stats
		 WHERE user_id = $1 AND stat_date = $2`,
		userID, date,
	).Scan(&stats.UserID, &statDate, &stats.GamesPlayed, &stats.TotalScore, &stats.PointsEarned, &lastGameAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return DailyStats{UserID: userID, Date: date}, nil
	}
	if err != nil {
		return DailyStats{}, err
	}
	stats.Date = statDate.Format("2006-01-02")
	if lastGameAt != nil {
		stats.LastGameAt = millis(*lastGameAt)
	}
	return stats, nil
}

func getDailyGamePointsEarned(ctx context.Context, tx pgx.Tx, userID int64) (int64, error) {
	var earned int64
	err := tx.QueryRow(ctx,
		`SELECT earned_points
		 FROM daily_game_points
		 WHERE user_id = $1 AND stat_date = $2`,
		userID, todayChina(),
	).Scan(&earned)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return earned, err
}

func incrementDailyStats(ctx context.Context, tx pgx.Tx, userID int64, scoreDelta int64, cumulativePointsEarned int64, now time.Time) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO game_daily_stats (user_id, stat_date, games_played, total_score, points_earned, last_game_at, updated_at)
		 VALUES ($1, $2, 1, $3, $4, $5, now())
		 ON CONFLICT (user_id, stat_date) DO UPDATE SET
		   games_played = game_daily_stats.games_played + 1,
		   total_score = game_daily_stats.total_score + excluded.total_score,
		   points_earned = GREATEST(game_daily_stats.points_earned, excluded.points_earned),
		   last_game_at = excluded.last_game_at,
		   updated_at = now()`,
		userID, todayChina(), scoreDelta, cumulativePointsEarned, now,
	)
	return err
}

func addGamePointsWithLimit(ctx context.Context, tx pgx.Tx, user auth.User, points int64, dailyLimit int64, description string) (int64, int64, error) {
	if points < 0 {
		points = 0
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO daily_game_points (user_id, stat_date, earned_points, updated_at)
		 VALUES ($1, $2, 0, now())
		 ON CONFLICT (user_id, stat_date) DO NOTHING`,
		user.ID, todayChina(),
	); err != nil {
		return 0, 0, err
	}
	var dailyEarned int64
	if err := tx.QueryRow(ctx,
		`SELECT earned_points
		 FROM daily_game_points
		 WHERE user_id = $1 AND stat_date = $2
		 FOR UPDATE`,
		user.ID, todayChina(),
	).Scan(&dailyEarned); err != nil {
		return 0, 0, err
	}
	balance, err := lockUserAccount(ctx, tx, user.ID)
	if err != nil {
		return 0, 0, err
	}
	remaining := dailyLimit - dailyEarned
	if remaining < 0 {
		remaining = 0
	}
	grant := points
	if grant > remaining {
		grant = remaining
	}
	nextDaily := dailyEarned + grant
	nextBalance := balance + grant
	if grant > 0 {
		if _, err := tx.Exec(ctx, `UPDATE point_accounts SET balance = $1, updated_at = now() WHERE user_id = $2`, nextBalance, user.ID); err != nil {
			return 0, 0, err
		}
		if _, err := tx.Exec(ctx, `UPDATE daily_game_points SET earned_points = $1, updated_at = now() WHERE user_id = $2 AND stat_date = $3`, nextDaily, user.ID, todayChina()); err != nil {
			return 0, 0, err
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO point_ledger (id, user_id, amount, source, description, balance_after, created_at)
			 VALUES ($1, $2, $3, 'game_play', $4, $5, now())`,
			randomHex(16), user.ID, grant, description, nextBalance,
		); err != nil {
			return 0, 0, err
		}
	}
	return grant, nextDaily, nil
}

func buildRecordFromSimulation(session Session, simulation SimulationResult, pointsEarned int64, now time.Time, pending bool) Record {
	duration := millis(now) - session.StartedAt
	if duration < 0 {
		duration = 0
	}
	maxDuration := sessionTTLSeconds * 1000
	if duration > maxDuration {
		duration = maxDuration
	}
	return Record{
		ID:             randomHex(16),
		UserID:         session.UserID,
		SessionID:      session.ID,
		GameType:       GameType,
		Pending:        pending,
		Score:          simulation.Score,
		PointsEarned:   pointsEarned,
		HighestTile:    simulation.HighestTile,
		Moves:          simulation.MovesApplied,
		MovesSubmitted: simulation.MovesSubmitted,
		Won:            simulation.Won,
		GameOver:       simulation.GameOver,
		Grid:           simulation.Grid,
		Duration:       duration,
		CreatedAt:      millis(now),
	}
}

func upsertRecord(ctx context.Context, tx pgx.Tx, record Record) error {
	existing, err := findRecordForUpdateBySession(ctx, tx, record.UserID, record.SessionID)
	if err != nil {
		return err
	}
	if existing != nil {
		record.ID = existing.ID
		if record.PointsEarned < existing.PointsEarned {
			record.PointsEarned = existing.PointsEarned
		}
	}
	raw, err := json.Marshal(record)
	if err != nil {
		return err
	}
	if existing != nil {
		_, err = tx.Exec(ctx,
			`UPDATE game_records
			 SET difficulty = $1, score = $2, points_earned = $3, payload = $4, created_at = $5
			 WHERE id = $6`,
			recordDifficulty, record.Score, record.PointsEarned, raw, time.UnixMilli(record.CreatedAt), record.ID,
		)
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO game_records (id, user_id, session_id, game_type, difficulty, score, points_earned, payload, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		record.ID, record.UserID, record.SessionID, record.GameType, recordDifficulty, record.Score, record.PointsEarned, raw, time.UnixMilli(record.CreatedAt),
	)
	return err
}

func listRecords(ctx context.Context, tx pgx.Tx, userID int64, limit int) ([]Record, error) {
	if limit <= 0 || limit > maxRecordsListSize {
		limit = defaultRecordsListSize
	}
	rows, err := tx.Query(ctx,
		`SELECT payload
		 FROM game_records
		 WHERE user_id = $1 AND game_type = $2
		   AND COALESCE((payload->>'pending')::boolean, false) = false
		 ORDER BY created_at DESC, id DESC
		 LIMIT $3`,
		userID, GameType, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	records := []Record{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var record Record
		if err := json.Unmarshal(raw, &record); err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, rows.Err()
}

func findRecordForUpdateBySession(ctx context.Context, tx pgx.Tx, userID int64, sessionID string) (*Record, error) {
	var raw []byte
	err := tx.QueryRow(ctx,
		`SELECT payload
		 FROM game_records
		 WHERE user_id = $1 AND game_type = $2 AND session_id = $3
		 ORDER BY created_at DESC, id DESC
		 LIMIT 1
		 FOR UPDATE`,
		userID, GameType, sessionID,
	).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var record Record
	if err := json.Unmarshal(raw, &record); err != nil {
		return nil, err
	}
	return &record, nil
}

func findSettledRecord(ctx context.Context, tx pgx.Tx, userID int64, sessionID string) (*Record, error) {
	rows, err := tx.Query(ctx,
		`SELECT payload
		 FROM game_records
		 WHERE user_id = $1 AND game_type = $2 AND session_id = $3
		 ORDER BY created_at DESC, id DESC
		 LIMIT 1`,
		userID, GameType, sessionID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var record Record
		if err := json.Unmarshal(raw, &record); err != nil {
			return nil, err
		}
		return &record, nil
	}
	return nil, rows.Err()
}

func deleteRecordBySession(ctx context.Context, tx pgx.Tx, userID int64, sessionID string) error {
	_, err := tx.Exec(ctx,
		`DELETE FROM game_records
		 WHERE user_id = $1 AND game_type = $2 AND session_id = $3
		   AND COALESCE((payload->>'pending')::boolean, false) = true`,
		userID, GameType, sessionID,
	)
	return err
}

func isCurrentActiveSession(ctx context.Context, tx pgx.Tx, userID int64, sessionID string) (bool, error) {
	var activeID string
	err := tx.QueryRow(ctx, `SELECT session_id FROM active_game_sessions WHERE user_id = $1 AND game_type = $2`, userID, GameType).Scan(&activeID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return activeID == sessionID, nil
}

func randomHex(size int) string {
	buffer := make([]byte, size)
	if _, err := rand.Read(buffer); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buffer)
}

func millis(t time.Time) int64 {
	return t.UnixNano() / int64(time.Millisecond)
}

func todayChina() string {
	return time.Now().UTC().Add(8 * time.Hour).Format("2006-01-02")
}

func isRetryableTxError(err error) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return false
	}
	return pgErr.Code == "40001" || pgErr.Code == "40P01"
}

func sleepBeforeRetry(ctx context.Context, attempt int) error {
	step := int64(attempt)
	if step > 5 {
		step = 5
	}
	delay := (25 * time.Millisecond) << step
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
