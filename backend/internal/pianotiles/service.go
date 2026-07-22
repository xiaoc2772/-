package pianotiles

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
	cooldownSeconds = 5
	// 48 小时滑动租期覆盖长局及长时间暂停；绝对上限避免僵尸会话永久占用账号。
	sessionTTL    = 48 * time.Hour
	maxSessionAge = 7 * 24 * time.Hour
)

var ErrUnavailable = errors.New("piano tiles database unavailable")
var ErrBatchTooLarge = errors.New("piano tiles event batch too large")

type Service struct{ db *pgxpool.Pool }

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

func (s *Service) Start(ctx context.Context, user auth.User, in StartInput) (StartResult, error) {
	if s.db == nil {
		return StartResult{}, ErrUnavailable
	}
	in.ChartID = strings.TrimSpace(in.ChartID)
	in.Checksum = strings.ToLower(strings.TrimSpace(in.Checksum))
	chart, ok := ChartSummaryFor(in.ChartID)
	if !ok {
		return StartResult{Message: "谱面不存在"}, nil
	}
	if !IsMode(in.Mode) {
		return StartResult{Message: "无效的游戏模式"}, nil
	}
	if in.Checksum != chart.Checksum {
		return StartResult{Message: "chart checksum mismatch"}, nil
	}
	var out StartResult
	err := s.tx(ctx, func(tx pgx.Tx) error {
		if err := ensureUser(ctx, tx, user); err != nil {
			return err
		}
		if _, err := lockAccount(ctx, tx, user.ID); err != nil {
			return err
		}
		if rem, err := cooldown(ctx, tx, user.ID, time.Now()); err != nil {
			return err
		} else if rem > 0 {
			out = StartResult{Message: fmt.Sprintf("请等待 %d 秒后再开始游戏", rem)}
			return nil
		}
		active, err := activeSession(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		if active != nil {
			out = StartResult{Message: "你已有正在进行的游戏"}
			return nil
		}
		now := time.Now()
		session := Session{ID: randomID(), UserID: user.ID, GameType: GameType, Version: Version, ChartID: in.ChartID, Checksum: chart.Checksum, Mode: in.Mode, StartedAt: now.UnixMilli(), ExpiresAt: sessionExpiry(now, now), Status: StatusPlaying, Replay: ReplayState{}}
		if err := saveSession(ctx, tx, session); err != nil {
			return err
		}
		out = StartResult{Success: true, Session: &session}
		return nil
	})
	return out, err
}

func (s *Service) Status(ctx context.Context, user auth.User) (StatusData, error) {
	if s.db == nil {
		return StatusData{}, ErrUnavailable
	}
	var out StatusData
	err := s.tx(ctx, func(tx pgx.Tx) error {
		if err := ensureUser(ctx, tx, user); err != nil {
			return err
		}
		rem, err := cooldown(ctx, tx, user.ID, time.Now())
		if err != nil {
			return err
		}
		stats, err := dailyStats(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		limit, err := systemconfig.DailyPointsLimit(ctx, tx)
		if err != nil {
			return err
		}
		earned, err := dailyEarned(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		active, err := activeSession(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		var view *SessionView
		if active != nil {
			v := viewOf(*active)
			view = &v
		}
		out = StatusData{InCooldown: rem > 0, CooldownRemainingMs: rem * 1000, PointsLimitReached: earned >= limit, DailyStats: stats, ActiveSession: view}
		return nil
	})
	return out, err
}

// PersonalBests 返回当前用户每首内置歌曲在经典、冲刺模式下的最佳单局成绩。
// 最佳成绩首先比较分数；平分时依次比较皇冠、圈数、命中数和游玩时长，
// 最后以更早达成的记录作为稳定排序条件。
func (s *Service) PersonalBests(ctx context.Context, user auth.User) (PersonalBestsData, error) {
	if s.db == nil {
		return PersonalBestsData{}, ErrUnavailable
	}

	byChart := make(map[string]*PersonalSongBests, ChartCount())
	for _, chartID := range ChartIDs() {
		byChart[chartID] = &PersonalSongBests{ChartID: chartID}
	}

	rows, err := s.db.Query(ctx,
		`WITH candidates AS (
		   SELECT id, payload, score, created_at,
		          payload->>'chartId' AS chart_id,
		          COALESCE(NULLIF(difficulty, ''), payload->>'mode') AS mode,
		          COALESCE((payload->>'crowns')::integer, 0) AS crowns,
		          COALESCE((payload->>'laps')::integer, 0) AS laps,
		          COALESCE((payload->>'tilesHit')::integer, 0) AS tiles_hit,
		          COALESCE((payload->>'playedMs')::bigint, 0) AS played_ms
		     FROM game_records
		    WHERE user_id = $1
		      AND game_type = $2
		      AND COALESCE(payload->>'pending', 'false') <> 'true'
		), best AS (
		   SELECT DISTINCT ON (chart_id, mode) payload
		     FROM candidates
		    WHERE chart_id <> ''
		      AND mode IN ('classic', 'rush')
		    ORDER BY chart_id, mode, score DESC, crowns DESC, laps DESC,
		             tiles_hit DESC, played_ms DESC, created_at ASC, id ASC
		)
		SELECT payload FROM best`,
		user.ID, GameType,
	)
	if err != nil {
		return PersonalBestsData{}, err
	}
	defer rows.Close()

	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return PersonalBestsData{}, err
		}
		var record Record
		if err := json.Unmarshal(raw, &record); err != nil {
			return PersonalBestsData{}, err
		}
		song := byChart[record.ChartID]
		if song == nil {
			// 历史记录可能引用已经下架的谱面，不在当前界面中展示。
			continue
		}
		best := personalBestOf(record)
		switch record.Mode {
		case ModeClassic:
			song.Classic = &best
		case ModeRush:
			song.Rush = &best
		}
	}
	if err := rows.Err(); err != nil {
		return PersonalBestsData{}, err
	}

	songs := make([]PersonalSongBests, 0, len(byChart))
	for _, chartID := range ChartIDs() {
		songs = append(songs, *byChart[chartID])
	}
	return PersonalBestsData{Songs: songs}, nil
}

func personalBestOf(record Record) PersonalBest {
	return PersonalBest{
		Score:         record.Score,
		PointsAwarded: record.PointsAwarded,
		TilesHit:      record.TilesHit,
		Crowns:        record.Crowns,
		Laps:          record.Laps,
		PlayedMs:      record.PlayedMs,
		Status:        record.Status,
		CreatedAt:     record.CreatedAt,
	}
}

func (s *Service) Checkpoint(ctx context.Context, user auth.User, in CheckpointInput) (CheckpointResult, error) {
	if s.db == nil {
		return CheckpointResult{}, ErrUnavailable
	}
	if len(in.Events) > MaxEventsPerBatch {
		return CheckpointResult{}, ErrBatchTooLarge
	}
	var out CheckpointResult
	var violation error
	err := s.tx(ctx, func(tx pgx.Tx) error {
		session, err := sessionForUpdate(ctx, tx, user.ID, strings.TrimSpace(in.SessionID))
		if err != nil {
			return err
		}
		if session == nil {
			out = CheckpointResult{Message: "游戏会话不存在或已过期"}
			return nil
		}
		now := time.Now()
		if session.Version != Version {
			if err := deleteSession(ctx, tx, user.ID, session.ID); err != nil {
				return err
			}
			out = CheckpointResult{Message: "游戏会话版本已升级，请重新开始"}
			return nil
		}
		if sessionExpired(*session, now) {
			if err := deleteSession(ctx, tx, user.ID, session.ID); err != nil {
				return err
			}
			out = CheckpointResult{Message: "游戏会话已过期"}
			return nil
		}
		chart, ok := currentSessionChart(*session)
		if !ok {
			if err := deleteSession(ctx, tx, user.ID, session.ID); err != nil {
				return err
			}
			out = CheckpointResult{Message: "谱面已更新，请重新开始"}
			return nil
		}
		if session.Status != StatusPlaying {
			out = CheckpointResult{Message: "游戏会话已结束"}
			return nil
		}
		delta, offset, duplicate, err := checkpointDelta(*session, in.EventOffset, in.Events)
		if err != nil {
			if IsValidationError(err) {
				violation = err
				return invalidateSession(ctx, tx, *session)
			}
			return err
		}
		state := session.Replay
		if !duplicate {
			state, err = AdvanceReplayState(chart, session.Mode, state, delta)
		}
		if err != nil {
			if IsValidationError(err) {
				violation = err
				return invalidateSession(ctx, tx, *session)
			}
			return err
		}
		if !duplicate && len(delta) > 0 {
			session.LastBatch = &BatchReceipt{Offset: offset, Count: len(delta), Hash: HashEvents(delta)}
		}
		session.Replay = state
		session.ExpiresAt = sessionExpiry(now, time.UnixMilli(session.StartedAt))
		if err := updateSession(ctx, tx, *session); err != nil {
			return err
		}
		accepted := len(delta)
		if duplicate {
			accepted = 0
		}
		out = CheckpointResult{Success: true, AcceptedEvents: accepted, EventCount: state.EventCount, ExpiresAt: session.ExpiresAt}
		return nil
	})
	if err == nil && violation != nil {
		return out, violation
	}
	return out, err
}

func (s *Service) Submit(ctx context.Context, user auth.User, in SubmitInput) (SubmitResult, error) {
	if s.db == nil {
		return SubmitResult{}, ErrUnavailable
	}
	if len(in.Events) > MaxEventsPerBatch {
		return SubmitResult{}, ErrBatchTooLarge
	}
	var out SubmitResult
	var violation error
	err := s.tx(ctx, func(tx pgx.Tx) error {
		session, err := sessionForUpdate(ctx, tx, user.ID, strings.TrimSpace(in.SessionID))
		if err != nil {
			return err
		}
		if session == nil {
			rec, findErr := findRecord(ctx, tx, user.ID, in.SessionID)
			if findErr != nil {
				return findErr
			}
			if rec != nil {
				out = SubmitResult{Success: true, Score: rec.Score, PointsAwarded: rec.PointsAwarded, Record: rec}
				return nil
			}
			out = SubmitResult{Message: "游戏会话不存在或已过期"}
			return nil
		}
		now := time.Now()
		if session.Version != Version {
			if err := deleteSession(ctx, tx, user.ID, session.ID); err != nil {
				return err
			}
			out = SubmitResult{Message: "游戏会话版本已升级，请重新开始"}
			return nil
		}
		if sessionExpired(*session, now) {
			if err := deleteSession(ctx, tx, user.ID, session.ID); err != nil {
				return err
			}
			out = SubmitResult{Message: "游戏会话已过期"}
			return nil
		}
		chart, ok := currentSessionChart(*session)
		if !ok {
			if err := deleteSession(ctx, tx, user.ID, session.ID); err != nil {
				return err
			}
			out = SubmitResult{Message: "谱面已更新，请重新开始"}
			return nil
		}
		if session.Status != StatusPlaying {
			rec, findErr := findRecord(ctx, tx, user.ID, session.ID)
			if findErr != nil {
				return findErr
			}
			if rec != nil {
				out = SubmitResult{Success: true, Score: rec.Score, PointsAwarded: rec.PointsAwarded, Record: rec}
				return nil
			}
			out = SubmitResult{Message: "游戏会话已结束"}
			return nil
		}
		events, err := submitDelta(*session, in.EventOffset, in.Events)
		if err != nil {
			if IsValidationError(err) {
				violation = err
				return invalidateSession(ctx, tx, *session)
			}
			return err
		}
		serverElapsed := now.UnixMilli() - session.StartedAt
		// 前端墙钟从玩家点击第一块开始，而服务端会话在选曲完成后即创建。
		// 因此允许服务端 elapsed 更长（玩家可停留等待），只拒绝客户端声称的时间超前。
		if in.Result.PlayedMs > serverElapsed+10_000 {
			violation = validationError("played_ms_mismatch", "游戏时长不一致")
			return invalidateSession(ctx, tx, *session)
		}
		state, err := AdvanceReplayState(chart, session.Mode, session.Replay, events)
		if err != nil {
			if IsValidationError(err) {
				violation = err
				return invalidateSession(ctx, tx, *session)
			}
			return err
		}
		res, err := FinalizeReplayState(chart, session.Mode, state, in.Result)
		if err != nil {
			if IsValidationError(err) {
				violation = err
				return invalidateSession(ctx, tx, *session)
			}
			return err
		}
		points := CalculatePointsAwarded(res.Score, res.Crowns)
		limit, err := systemconfig.DailyPointsLimit(ctx, tx)
		if err != nil {
			return err
		}
		grant, daily, err := addPoints(ctx, tx, user, points, limit, fmt.Sprintf("钢琴块 %s 得分 %d", session.ChartID, res.Score))
		if err != nil {
			return err
		}
		rec := Record{ID: randomID(), UserID: user.ID, SessionID: session.ID, GameType: GameType, ChartID: session.ChartID, Mode: session.Mode, Status: res.Status, Score: res.Score, PointsAwarded: grant, TilesHit: res.TilesHit, Crowns: res.Crowns, Laps: res.Laps, TotalNotes: res.TotalNotes, PlayedMs: res.PlayedMs, CreatedAt: now.UnixMilli()}
		if err := insertRecord(ctx, tx, rec); err != nil {
			return err
		}
		if err := incStats(ctx, tx, user.ID, res.Score, daily, now); err != nil {
			return err
		}
		if err := deleteSession(ctx, tx, user.ID, session.ID); err != nil {
			return err
		}
		if err := setCooldown(ctx, tx, user.ID, now.Add(cooldownSeconds*time.Second)); err != nil {
			return err
		}
		out = SubmitResult{Success: true, Score: res.Score, PointsAwarded: grant, Record: &rec}
		return nil
	})
	if err == nil && violation != nil {
		return out, violation
	}
	return out, err
}

func (s *Service) Cancel(ctx context.Context, user auth.User, in CancelInput) (SimpleResult, error) {
	if s.db == nil {
		return SimpleResult{}, ErrUnavailable
	}
	var out SimpleResult
	err := s.tx(ctx, func(tx pgx.Tx) error {
		sess, err := sessionForUpdate(ctx, tx, user.ID, strings.TrimSpace(in.SessionID))
		if err != nil {
			return err
		}
		if sess == nil {
			out = SimpleResult{Message: "游戏会话不存在"}
			return nil
		}
		if err := deleteSession(ctx, tx, user.ID, sess.ID); err != nil {
			return err
		}
		if err := setCooldown(ctx, tx, user.ID, time.Now().Add(cooldownSeconds*time.Second)); err != nil {
			return err
		}
		out = SimpleResult{Success: true}
		return nil
	})
	return out, err
}

// sessionExpiry 返回滑动租期，同时受绝对寿命限制。
func sessionExpiry(now, started time.Time) int64 {
	expires := now.Add(sessionTTL)
	absolute := started.Add(maxSessionAge)
	if expires.After(absolute) {
		expires = absolute
	}
	return expires.UnixMilli()
}

func sessionExpired(session Session, now time.Time) bool {
	return now.UnixMilli() >= session.ExpiresAt || !now.Before(time.UnixMilli(session.StartedAt).Add(maxSessionAge))
}

// checkpointDelta 解析 checkpoint 批次的全局偏移，并处理上一批响应丢失时的幂等重试。
// 返回值中的 delta 一定只包含尚未应用的事件；duplicate 表示整批已应用。
func checkpointDelta(session Session, requested *int64, incoming []Event) (delta []Event, offset int64, duplicate bool, err error) {
	current := session.Replay.EventCount
	if current < 0 {
		return nil, 0, false, validationError("invalid_event_offset", "服务端事件计数非法")
	}
	if requested == nil {
		// 旧客户端将每次 checkpoint 作为“下一批增量”提交。
		if session.LastBatch != nil && session.LastBatch.Offset+int64(session.LastBatch.Count) == current && HashEvents(incoming) == session.LastBatch.Hash {
			return nil, current, true, nil
		}
		return incoming, current, false, nil
	}
	offset = *requested
	if offset < 0 || offset > current {
		return nil, offset, false, validationError("invalid_event_offset", "checkpoint 事件偏移非法")
	}
	if offset == current {
		if session.LastBatch != nil && session.LastBatch.Offset+int64(session.LastBatch.Count) == current && HashEvents(incoming) == session.LastBatch.Hash {
			return nil, current, true, nil
		}
		return incoming, offset, false, nil
	}
	// 允许在途请求携带“已确认前缀 + 新事件”。只需验证前缀中包含的
	// 上一批摘要，避免客户端任意跳过尚未确认的服务端状态。
	if session.LastBatch == nil {
		return nil, offset, false, validationError("checkpoint_history_mismatch", "checkpoint 历史摘要不存在")
	}
	last := session.LastBatch
	prefixLen := current - offset
	if prefixLen < 0 || int64(len(incoming)) < prefixLen {
		return nil, offset, false, validationError("checkpoint_history_mismatch", "checkpoint 事件前缀不完整")
	}
	lastStart := last.Offset - offset
	if lastStart < 0 || lastStart+int64(last.Count) > int64(len(incoming)) {
		return nil, offset, false, validationError("checkpoint_history_mismatch", "checkpoint 事件前缀不匹配")
	}
	start, end := int(lastStart), int(lastStart+int64(last.Count))
	if HashEvents(incoming[start:end]) != last.Hash {
		return nil, offset, false, validationError("checkpoint_history_mismatch", "checkpoint 事件前缀不匹配")
	}
	return incoming[int(prefixLen):], current, false, nil
}

// submitDelta 支持新客户端的 offset+尾批，也兼容旧客户端提交完整事件流。
// 已确认前缀由服务端快照负责，不重复重放。
func submitDelta(session Session, requested *int64, submitted []Event) ([]Event, error) {
	current := session.Replay.EventCount
	if current < 0 {
		return nil, validationError("invalid_event_offset", "服务端事件计数非法")
	}
	offset := int64(0)
	if requested != nil {
		offset = *requested
	}
	if offset < 0 || offset > current {
		return nil, validationError("invalid_event_offset", "提交事件偏移非法")
	}
	needed := current - offset
	if int64(len(submitted)) < needed {
		return nil, validationError("checkpoint_history_mismatch", "提交事件未覆盖已确认前缀")
	}
	if needed > 0 && session.LastBatch != nil {
		last := session.LastBatch
		lastStart := last.Offset - offset
		if lastStart < 0 || lastStart+int64(last.Count) > int64(len(submitted)) {
			return nil, validationError("checkpoint_history_mismatch", "提交事件前缀不匹配")
		}
		start, end := int(lastStart), int(lastStart+int64(last.Count))
		if HashEvents(submitted[start:end]) != last.Hash {
			return nil, validationError("checkpoint_history_mismatch", "提交事件前缀不匹配")
		}
	}
	return submitted[int(needed):], nil
}

func mustChart(id string) ChartSummary { c, _ := ChartSummaryFor(id); return c }
func viewOf(s Session) SessionView {
	return SessionView{SessionID: s.ID, ChartID: s.ChartID, Mode: s.Mode, StartedAt: s.StartedAt}
}

// currentSessionChart 防止部署期间同一 chartId 的资源发生变化后，旧会话继续按
// 新谱面重放，导致正常成绩被误判或旧事件在新榜单规则下结算。
func currentSessionChart(session Session) (ChartSummary, bool) {
	chart, ok := ChartSummaryFor(session.ChartID)
	return chart, ok && session.Checksum == chart.Checksum
}

func (s *Service) tx(ctx context.Context, fn func(pgx.Tx) error) error {
	for i := 0; i < 4; i++ {
		tx, err := s.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
		if err != nil {
			return err
		}
		err = fn(tx)
		if err == nil {
			err = tx.Commit(ctx)
		} else {
			_ = tx.Rollback(ctx)
		}
		if err == nil {
			return nil
		}
		var pe *pgconn.PgError
		if errors.As(err, &pe) && (pe.Code == "40001" || pe.Code == "40P01") {
			time.Sleep(time.Duration(25*(1<<i)) * time.Millisecond)
			continue
		}
		return err
	}
	return errors.New("transaction retries exhausted")
}
func ensureUser(ctx context.Context, tx pgx.Tx, u auth.User) error {
	_, err := tx.Exec(ctx, `INSERT INTO users(id,username,display_name,first_seen_at,updated_at) VALUES($1,$2,$3,now(),now()) ON CONFLICT(id) DO UPDATE SET username=excluded.username,display_name=excluded.display_name,updated_at=now()`, u.ID, u.Username, u.DisplayName)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO point_accounts(user_id,balance,updated_at) VALUES($1,0,now()) ON CONFLICT(user_id) DO NOTHING`, u.ID)
	return err
}
func lockAccount(ctx context.Context, tx pgx.Tx, id int64) (int64, error) {
	var b int64
	err := tx.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id=$1 FOR UPDATE`, id).Scan(&b)
	return b, err
}
func cooldown(ctx context.Context, tx pgx.Tx, id int64, now time.Time) (int64, error) {
	var exp time.Time
	err := tx.QueryRow(ctx, `SELECT expires_at FROM game_cooldowns WHERE user_id=$1 AND game_type=$2`, id, GameType).Scan(&exp)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if !exp.After(now) {
		_, err = tx.Exec(ctx, `DELETE FROM game_cooldowns WHERE user_id=$1 AND game_type=$2`, id, GameType)
		return 0, err
	}
	return int64(math.Ceil(exp.Sub(now).Seconds())), nil
}
func activeSession(ctx context.Context, tx pgx.Tx, id int64) (*Session, error) {
	var sid string
	var expiresAt time.Time
	err := tx.QueryRow(ctx, `SELECT session_id, expires_at FROM active_game_sessions WHERE user_id=$1 AND game_type=$2 FOR UPDATE`, id, GameType).Scan(&sid, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	session, err := sessionForUpdate(ctx, tx, id, sid)
	if err != nil {
		return nil, err
	}
	if session == nil {
		// 外键正常时不会发生；若历史数据不一致，只清理这条孤儿 active 指针。
		_, err = tx.Exec(ctx, `DELETE FROM active_game_sessions WHERE user_id=$1 AND game_type=$2 AND session_id=$3`, id, GameType, sid)
		return nil, err
	}
	now := time.Now()
	if session.Version != Version || sessionExpired(*session, now) {
		if err := deleteSession(ctx, tx, id, sid); err != nil {
			return nil, err
		}
		return nil, nil
	}
	payloadExpiry := time.UnixMilli(session.ExpiresAt)
	if !expiresAt.Equal(payloadExpiry) {
		// 兼容旧版本只续租 game_sessions/payload、遗漏 active 行的会话。
		if _, err := tx.Exec(ctx, `UPDATE active_game_sessions SET expires_at=$1 WHERE user_id=$2 AND game_type=$3 AND session_id=$4`, payloadExpiry, id, GameType, sid); err != nil {
			return nil, err
		}
	}
	if _, ok := currentSessionChart(*session); !ok {
		if err := deleteSession(ctx, tx, id, sid); err != nil {
			return nil, err
		}
		return nil, nil
	}
	return session, nil
}
func sessionForUpdate(ctx context.Context, tx pgx.Tx, uid int64, sid string) (*Session, error) {
	var raw []byte
	err := tx.QueryRow(ctx, `SELECT payload FROM game_sessions WHERE id=$1 AND user_id=$2 AND game_type=$3 FOR UPDATE`, sid, uid, GameType).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var s Session
	if err = json.Unmarshal(raw, &s); err != nil {
		return nil, err
	}
	return &s, nil
}
func saveSession(ctx context.Context, tx pgx.Tx, s Session) error {
	raw, _ := json.Marshal(s)
	if _, err := tx.Exec(ctx, `INSERT INTO game_sessions(id,user_id,game_type,status,payload,started_at,expires_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,now())`, s.ID, s.UserID, GameType, string(s.Status), raw, time.UnixMilli(s.StartedAt), time.UnixMilli(s.ExpiresAt)); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `INSERT INTO active_game_sessions(user_id,game_type,session_id,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,game_type) DO UPDATE SET session_id=excluded.session_id,expires_at=excluded.expires_at`, s.UserID, GameType, s.ID, time.UnixMilli(s.ExpiresAt))
	return err
}
func updateSession(ctx context.Context, tx pgx.Tx, s Session) error {
	raw, _ := json.Marshal(s)
	if _, err := tx.Exec(ctx, `UPDATE game_sessions SET status=$1,payload=$2,expires_at=$3,updated_at=now() WHERE id=$4 AND game_type=$5`, string(s.Status), raw, time.UnixMilli(s.ExpiresAt), s.ID, GameType); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `UPDATE active_game_sessions SET expires_at=$1 WHERE user_id=$2 AND game_type=$3 AND session_id=$4`, time.UnixMilli(s.ExpiresAt), s.UserID, GameType, s.ID)
	return err
}
func deleteSession(ctx context.Context, tx pgx.Tx, uid int64, sid string) error {
	// 只删除仍指向该 session 的 active 行，避免迟到的旧会话请求误删同一用户
	// 后来已经创建的新会话。
	if _, err := tx.Exec(ctx, `DELETE FROM active_game_sessions WHERE user_id=$1 AND game_type=$2 AND session_id=$3`, uid, GameType, sid); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `DELETE FROM game_sessions WHERE id=$1 AND user_id=$2 AND game_type=$3`, sid, uid, GameType)
	return err
}

func invalidateSession(ctx context.Context, tx pgx.Tx, session Session) error {
	session.Status = StatusFailed
	if err := updateSession(ctx, tx, session); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM active_game_sessions WHERE user_id=$1 AND game_type=$2 AND session_id=$3`, session.UserID, GameType, session.ID); err != nil {
		return err
	}
	return setCooldown(ctx, tx, session.UserID, time.Now().Add(cooldownSeconds*time.Second))
}
func setCooldown(ctx context.Context, tx pgx.Tx, uid int64, at time.Time) error {
	_, err := tx.Exec(ctx, `INSERT INTO game_cooldowns(user_id,game_type,expires_at,updated_at) VALUES($1,$2,$3,now()) ON CONFLICT(user_id,game_type) DO UPDATE SET expires_at=excluded.expires_at,updated_at=now()`, uid, GameType, at)
	return err
}
func addPoints(ctx context.Context, tx pgx.Tx, u auth.User, p int64, limit int64, desc string) (int64, int64, error) {
	if _, err := tx.Exec(ctx, `INSERT INTO daily_game_points(user_id,stat_date,earned_points,updated_at) VALUES($1,(now() at time zone 'Asia/Shanghai')::date,0,now()) ON CONFLICT DO NOTHING`, u.ID); err != nil {
		return 0, 0, err
	}
	var d, b int64
	if err := tx.QueryRow(ctx, `SELECT earned_points FROM daily_game_points WHERE user_id=$1 AND stat_date=(now() at time zone 'Asia/Shanghai')::date FOR UPDATE`, u.ID).Scan(&d); err != nil {
		return 0, 0, err
	}
	if err := tx.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id=$1 FOR UPDATE`, u.ID).Scan(&b); err != nil {
		return 0, 0, err
	}
	g := p
	if g > limit-d {
		g = limit - d
	}
	if g < 0 {
		g = 0
	}
	if g > 0 {
		b += g
		d += g
		if _, err := tx.Exec(ctx, `UPDATE point_accounts SET balance=$1,updated_at=now() WHERE user_id=$2`, b, u.ID); err != nil {
			return 0, 0, err
		}
		if _, err := tx.Exec(ctx, `UPDATE daily_game_points SET earned_points=$1,updated_at=now() WHERE user_id=$2 AND stat_date=(now() at time zone 'Asia/Shanghai')::date`, d, u.ID); err != nil {
			return 0, 0, err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO point_ledger(id,user_id,amount,source,description,balance_after,created_at) VALUES($1,$2,$3,'game_play',$4,$5,now())`, randomID(), u.ID, g, desc, b); err != nil {
			return 0, 0, err
		}
	}
	return g, d, nil
}
func dailyEarned(ctx context.Context, tx pgx.Tx, id int64) (int64, error) {
	var d int64
	err := tx.QueryRow(ctx, `SELECT earned_points FROM daily_game_points WHERE user_id=$1 AND stat_date=(now() at time zone 'Asia/Shanghai')::date`, id).Scan(&d)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return d, err
}
func dailyStats(ctx context.Context, tx pgx.Tx, id int64) (DailyStats, error) {
	var d DailyStats
	err := tx.QueryRow(ctx, `SELECT games_played,points_earned FROM game_daily_stats WHERE user_id=$1 AND stat_date=(now() at time zone 'Asia/Shanghai')::date`, id).Scan(&d.Plays, &d.Points)
	if errors.Is(err, pgx.ErrNoRows) {
		return d, nil
	}
	return d, err
}
func incStats(ctx context.Context, tx pgx.Tx, id, score, daily int64, now time.Time) error {
	_, err := tx.Exec(ctx, `INSERT INTO game_daily_stats(user_id,stat_date,games_played,total_score,points_earned,last_game_at,updated_at) VALUES($1,(now() at time zone 'Asia/Shanghai')::date,1,$2,$3,$4,now()) ON CONFLICT(user_id,stat_date) DO UPDATE SET games_played=game_daily_stats.games_played+1,total_score=game_daily_stats.total_score+excluded.total_score,points_earned=GREATEST(game_daily_stats.points_earned,excluded.points_earned),last_game_at=excluded.last_game_at,updated_at=now()`, id, score, daily, now)
	return err
}
func insertRecord(ctx context.Context, tx pgx.Tx, r Record) error {
	raw, _ := json.Marshal(r)
	_, err := tx.Exec(ctx, `INSERT INTO game_records(id,user_id,session_id,game_type,difficulty,score,points_earned,payload,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, r.ID, r.UserID, r.SessionID, GameType, string(r.Mode), r.Score, r.PointsAwarded, raw, time.UnixMilli(r.CreatedAt))
	return err
}
func findRecord(ctx context.Context, tx pgx.Tx, uid int64, sid string) (*Record, error) {
	var raw []byte
	err := tx.QueryRow(ctx, `SELECT payload FROM game_records WHERE user_id=$1 AND game_type=$2 AND session_id=$3 ORDER BY created_at DESC LIMIT 1`, uid, GameType, sid).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var r Record
	err = json.Unmarshal(raw, &r)
	return &r, err
}
func randomID() string { b := make([]byte, 16); _, _ = rand.Read(b); return hex.EncodeToString(b) }
func abs64(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}
