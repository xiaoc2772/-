package memory

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"redemption/backend/internal/auth"
	"redemption/backend/internal/systemconfig"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	sessionTTLSeconds        = int64(5 * 60)
	cooldownTTLSeconds       = int64(5)
	minGameDurationMillis    = int64(5000)
	memoryPointRewardDivisor = int64(9)
	maxRetryableTxRetries    = 12
	hiddenCardSentinel       = "__hidden__"
)

var (
	ErrUnavailable = errors.New("memory database unavailable")

	DifficultyConfigs = map[Difficulty]DifficultyConfig{
		DifficultyEasy: {
			Rows: 4, Cols: 4, Pairs: 8,
			BaseScore: 220, PenaltyPerMove: 2, MinScore: 60, TimeLimit: 180,
		},
		DifficultyNormal: {
			Rows: 4, Cols: 6, Pairs: 12,
			BaseScore: 450, PenaltyPerMove: 4, MinScore: 120, TimeLimit: 180,
		},
		DifficultyHard: {
			Rows: 6, Cols: 6, Pairs: 18,
			BaseScore: 900, PenaltyPerMove: 6, MinScore: 220, TimeLimit: 180,
		},
	}

	cardIcons = []string{
		"apple", "banana", "cherry", "grapes", "strawberry",
		"watermelon", "orange", "pear", "peach", "lemon",
		"carrot", "corn", "pepper", "mushroom", "broccoli",
		"cat", "dog", "rabbit", "bear", "bird",
		"fish", "butterfly", "bee", "turtle", "frog",
	}
)

type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

func (service *Service) Start(ctx context.Context, user auth.User, difficulty Difficulty) (StartResult, error) {
	if service.db == nil {
		return StartResult{}, ErrUnavailable
	}
	if _, ok := DifficultyConfigs[difficulty]; !ok {
		return StartResult{Success: false, Message: "无效的难度选择"}, nil
	}

	var output StartResult
	err := service.withRetryableTx(ctx, func(tx pgx.Tx) error {
		if err := ensureUser(ctx, tx, user); err != nil {
			return err
		}
		if _, err := lockUserAccount(ctx, tx, user.ID); err != nil {
			return err
		}
		if remaining, err := cooldownRemaining(ctx, tx, user.ID, GameType, time.Now()); err != nil {
			return err
		} else if remaining > 0 {
			output = StartResult{Success: false, Message: fmt.Sprintf("请等待 %d 秒后再开始游戏", remaining)}
			return nil
		}
		if active, err := getActiveSessionForUpdate(ctx, tx, user.ID); err != nil {
			return err
		} else if active != nil {
			output = StartResult{Success: false, Message: "你已有正在进行的游戏"}
			return nil
		}

		now := time.Now()
		nowMs := millis(now)
		seed := randomHex(16)
		session := Session{
			ID:           randomHex(16),
			UserID:       user.ID,
			GameType:     GameType,
			Difficulty:   difficulty,
			Seed:         seed,
			CardLayout:   GenerateCardLayout(difficulty, seed),
			MatchedCards: []int{},
			MoveLog:      []Move{},
			StartedAt:    nowMs,
			ExpiresAt:    nowMs + sessionTTLSeconds*1000,
			Status:       "playing",
		}
		if err := saveSession(ctx, tx, session, now); err != nil {
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
		remaining, err := cooldownRemaining(ctx, tx, user.ID, GameType, time.Now())
		if err != nil {
			return err
		}
		active, err := getActiveSessionForUpdate(ctx, tx, user.ID)
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
		output = StatusData{
			Balance:            balance,
			DailyStats:         dailyStats,
			InCooldown:         remaining > 0,
			CooldownRemaining:  remaining,
			DailyLimit:         dailyLimit,
			PointsLimitReached: false,
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
		if err := deleteSessionAndActive(ctx, tx, user.ID, active.ID); err != nil {
			return err
		}
		if err := setCooldown(ctx, tx, user.ID, GameType, time.Now().Add(time.Duration(cooldownTTLSeconds)*time.Second)); err != nil {
			return err
		}
		output = SimpleResult{Success: true}
		return nil
	})
	return output, err
}

func (service *Service) Flip(ctx context.Context, user auth.User, sessionID string, cardIndex int) (FlipServiceResult, error) {
	if service.db == nil {
		return FlipServiceResult{}, ErrUnavailable
	}
	if strings.TrimSpace(sessionID) == "" || cardIndex < 0 {
		return FlipServiceResult{Success: false, Message: "参数错误"}, nil
	}

	var output FlipServiceResult
	err := service.withRetryableTx(ctx, func(tx pgx.Tx) error {
		session, err := getSessionForUpdate(ctx, tx, sessionID)
		if err != nil {
			return err
		}
		if session == nil {
			output = FlipServiceResult{Success: false, Message: "游戏会话不存在或已过期"}
			return nil
		}
		if session.UserID != user.ID {
			output = FlipServiceResult{Success: false, Message: "会话不属于该用户"}
			return nil
		}
		if ok, err := isCurrentActiveSession(ctx, tx, user.ID, session.ID); err != nil {
			return err
		} else if !ok {
			output = FlipServiceResult{Success: false, Message: "游戏会话已不是当前活跃局"}
			return nil
		}
		if session.Status != "playing" {
			output = FlipServiceResult{Success: false, Message: "游戏会话已结束"}
			return nil
		}
		if time.Now().UnixMilli() > session.ExpiresAt {
			if err := deleteSessionAndActive(ctx, tx, user.ID, session.ID); err != nil {
				return err
			}
			output = FlipServiceResult{Success: false, Message: "游戏会话已过期"}
			return nil
		}

		totalCards := totalCards(session.Difficulty)
		if cardIndex >= totalCards {
			output = FlipServiceResult{Success: false, Message: "无效的卡片索引"}
			return nil
		}
		matchedSet := intSet(session.MatchedCards)
		if matchedSet[cardIndex] {
			output = FlipServiceResult{Success: false, Message: "该卡片已配对"}
			return nil
		}
		cardIcon := session.CardLayout[cardIndex]
		if cardIcon == "" {
			output = FlipServiceResult{Success: false, Message: "卡片数据异常"}
			return nil
		}
		if session.FirstFlippedCard != nil && *session.FirstFlippedCard == cardIndex {
			output = FlipServiceResult{Success: false, Message: "不能重复翻开同一张卡片"}
			return nil
		}

		now := time.Now()
		if session.FirstFlippedCard == nil {
			first := cardIndex
			session.FirstFlippedCard = &first
			if err := updateSessionPayload(ctx, tx, *session); err != nil {
				return err
			}
			result := FlipResult{
				CardIndex:    cardIndex,
				IconID:       cardIcon,
				Matched:      false,
				Completed:    len(matchedSet) == totalCards,
				MoveCount:    len(session.MoveLog),
				MatchedCount: len(matchedSet),
			}
			output = FlipServiceResult{Success: true, Data: &result}
			return nil
		}

		firstIndex := *session.FirstFlippedCard
		if firstIndex < 0 || firstIndex >= len(session.CardLayout) {
			session.FirstFlippedCard = nil
			if err := updateSessionPayload(ctx, tx, *session); err != nil {
				return err
			}
			output = FlipServiceResult{Success: false, Message: "会话状态异常，请重试"}
			return nil
		}
		firstIcon := session.CardLayout[firstIndex]
		if firstIcon == "" {
			output = FlipServiceResult{Success: false, Message: "卡片数据异常"}
			return nil
		}

		isMatch := firstIcon == cardIcon
		move := Move{Card1: firstIndex, Card2: cardIndex, Matched: isMatch, Timestamp: millis(now)}
		if isMatch {
			matchedSet[firstIndex] = true
			matchedSet[cardIndex] = true
		}
		session.FirstFlippedCard = nil
		session.MoveLog = append(session.MoveLog, move)
		session.MatchedCards = sortedKeys(matchedSet)
		completed := len(session.MatchedCards) == totalCards
		if err := updateSessionPayload(ctx, tx, *session); err != nil {
			return err
		}

		result := FlipResult{
			CardIndex:       cardIndex,
			IconID:          cardIcon,
			FirstCardIndex:  &firstIndex,
			FirstCardIconID: firstIcon,
			Matched:         isMatch,
			Completed:       completed,
			MoveCount:       len(session.MoveLog),
			MatchedCount:    len(session.MatchedCards),
			Move:            &move,
		}
		output = FlipServiceResult{Success: true, Data: &result}
		return nil
	})
	return output, err
}

func (service *Service) Submit(ctx context.Context, user auth.User, input SubmitInput) (SubmitResult, error) {
	if service.db == nil {
		return SubmitResult{}, ErrUnavailable
	}
	if strings.TrimSpace(input.SessionID) == "" || input.Moves == nil {
		return SubmitResult{Success: false, Message: "参数错误"}, nil
	}

	var output SubmitResult
	err := service.withRetryableTx(ctx, func(tx pgx.Tx) error {
		session, err := getSessionForUpdate(ctx, tx, input.SessionID)
		if err != nil {
			return err
		}
		if session == nil {
			return service.settledRecordOrFailure(ctx, tx, user.ID, input.SessionID, "游戏会话不存在或已过期", &output)
		}
		if session.UserID != user.ID {
			output = SubmitResult{Success: false, Message: "会话不属于该用户"}
			return nil
		}
		if ok, err := isCurrentActiveSession(ctx, tx, user.ID, session.ID); err != nil {
			return err
		} else if !ok {
			return service.settledRecordOrFailure(ctx, tx, user.ID, session.ID, "游戏会话已不是当前活跃局", &output)
		}
		if session.Status != "playing" {
			return service.settledRecordOrFailure(ctx, tx, user.ID, session.ID, "游戏会话已结束", &output)
		}
		now := time.Now()
		serverDuration := millis(now) - session.StartedAt
		if millis(now) > session.ExpiresAt {
			if err := deleteSessionAndActive(ctx, tx, user.ID, session.ID); err != nil {
				return err
			}
			return service.settledRecordOrFailure(ctx, tx, user.ID, session.ID, "游戏会话已过期", &output)
		}
		config := DifficultyConfigs[session.Difficulty]
		timedOut := serverDuration > config.TimeLimit*1000
		effectiveCompleted := !timedOut && input.Completed
		if !timedOut && session.FirstFlippedCard != nil {
			output = SubmitResult{Success: false, Message: "存在未完成翻牌，请完成后再结算"}
			return nil
		}
		if valid, message := validateResult(*session, input, effectiveCompleted, timedOut); !valid {
			output = SubmitResult{Success: false, Message: message}
			return nil
		}
		if serverDuration < minGameDurationMillis {
			output = SubmitResult{Success: false, Message: "游戏时长过短"}
			return nil
		}
		if len(input.Moves) > 0 && len(input.Moves) != len(session.MoveLog) {
			output = SubmitResult{Success: false, Message: "提交步数与服务端记录不一致"}
			return nil
		}
		for index := range input.Moves {
			if !sameMove(input.Moves[index], session.MoveLog[index]) {
				output = SubmitResult{Success: false, Message: "提交步数与服务端记录不一致"}
				return nil
			}
		}

		score := CalculateScore(session.Difficulty, len(session.MoveLog), effectiveCompleted)
		pointReward := score / memoryPointRewardDivisor
		dailyLimit, err := systemconfig.DailyPointsLimit(ctx, tx)
		if err != nil {
			return err
		}
		pointsEarned, dailyEarned, err := addGamePointsWithLimit(ctx, tx, user, pointReward, dailyLimit, fmt.Sprintf("记忆游戏得分 %d，福利积分 %d", score, pointReward))
		if err != nil {
			return err
		}

		record := Record{
			ID:           randomHex(16),
			UserID:       user.ID,
			SessionID:    input.SessionID,
			GameType:     GameType,
			Difficulty:   session.Difficulty,
			Moves:        len(session.MoveLog),
			Completed:    effectiveCompleted,
			Score:        score,
			PointsEarned: pointsEarned,
			Duration:     serverDuration,
			CreatedAt:    millis(now),
		}
		if err := insertRecord(ctx, tx, record); err != nil {
			return err
		}
		if err := incrementDailyStats(ctx, tx, user.ID, score, dailyEarned, now); err != nil {
			return err
		}
		if err := deleteSessionAndActive(ctx, tx, user.ID, session.ID); err != nil {
			return err
		}
		if err := setCooldown(ctx, tx, user.ID, GameType, now.Add(time.Duration(cooldownTTLSeconds)*time.Second)); err != nil {
			return err
		}

		output = SubmitResult{Success: true, Record: &record, PointsEarned: pointsEarned}
		return nil
	})
	return output, err
}

// settledRecordOrFailure 让结算请求具备幂等性：服务端已完成结算但响应丢失时，
// 客户端使用同一会话重试会拿到原结算记录，不会重复发放积分。
func (service *Service) settledRecordOrFailure(ctx context.Context, tx pgx.Tx, userID int64, sessionID string, message string, output *SubmitResult) error {
	record, err := findSettledRecord(ctx, tx, userID, sessionID)
	if err != nil {
		return err
	}
	if record != nil {
		*output = SubmitResult{Success: true, Record: record, PointsEarned: record.PointsEarned}
		return nil
	}
	*output = SubmitResult{Success: false, Message: message}
	return nil
}

func BuildSessionView(session Session) SessionView {
	viewLayout := make([]string, len(session.CardLayout))
	for i := range viewLayout {
		viewLayout[i] = hiddenCardSentinel
	}
	for _, index := range session.MatchedCards {
		if index >= 0 && index < len(session.CardLayout) {
			viewLayout[index] = session.CardLayout[index]
		}
	}
	if session.FirstFlippedCard != nil {
		index := *session.FirstFlippedCard
		if index >= 0 && index < len(session.CardLayout) {
			viewLayout[index] = session.CardLayout[index]
		}
	}
	return SessionView{
		SessionID:        session.ID,
		Difficulty:       session.Difficulty,
		CardLayout:       viewLayout,
		MatchedCards:     append([]int(nil), session.MatchedCards...),
		FirstFlippedCard: session.FirstFlippedCard,
		MoveCount:        len(session.MoveLog),
		StartedAt:        session.StartedAt,
		ExpiresAt:        session.ExpiresAt,
		Config:           DifficultyConfigs[session.Difficulty],
	}
}

func GenerateCardLayout(difficulty Difficulty, seed string) []string {
	config := DifficultyConfigs[difficulty]
	selected := append([]string(nil), cardIcons[:config.Pairs]...)
	cards := append([]string{}, selected...)
	cards = append(cards, selected...)
	for len(cards) < config.Rows*config.Cols {
		cards = append(cards, selected[0])
	}
	for i := len(cards) - 1; i > 0; i-- {
		j := int(math.Floor(seededRandom(seed, i) * float64(i+1)))
		cards[i], cards[j] = cards[j], cards[i]
	}
	return cards
}

func CalculateScore(difficulty Difficulty, moves int, completed bool) int64 {
	if !completed {
		return 0
	}
	config := DifficultyConfigs[difficulty]
	extraMoves := int64(moves - config.Pairs)
	if extraMoves < 0 {
		extraMoves = 0
	}
	score := config.BaseScore - extraMoves*config.PenaltyPerMove
	if score < config.MinScore {
		return config.MinScore
	}
	return score
}

func (service *Service) withRetryableTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	var lastErr error
	for attempt := 0; attempt <= maxRetryableTxRetries; attempt++ {
		tx, err := service.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
		if err != nil {
			return err
		}
		err = fn(tx)
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

func cooldownRemaining(ctx context.Context, tx pgx.Tx, userID int64, gameType string, now time.Time) (int64, error) {
	var expiresAt time.Time
	err := tx.QueryRow(ctx,
		`SELECT expires_at FROM game_cooldowns WHERE user_id = $1 AND game_type = $2`,
		userID, gameType,
	).Scan(&expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if !expiresAt.After(now) {
		_, err := tx.Exec(ctx, `DELETE FROM game_cooldowns WHERE user_id = $1 AND game_type = $2`, userID, gameType)
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
	var expiresAt time.Time
	err := tx.QueryRow(ctx,
		`SELECT payload, expires_at
		 FROM game_sessions
		 WHERE id = $1 AND game_type = $2
		 FOR UPDATE`,
		sessionID, GameType,
	).Scan(&payload, &expiresAt)
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
	normalizeSession(&session)
	if !expiresAt.After(time.Now()) {
		return &session, nil
	}
	return &session, nil
}

func saveSession(ctx context.Context, tx pgx.Tx, session Session, now time.Time) error {
	raw, err := json.Marshal(session)
	if err != nil {
		return err
	}
	startedAt := time.UnixMilli(session.StartedAt)
	expiresAt := time.UnixMilli(session.ExpiresAt)
	if _, err := tx.Exec(ctx,
		`INSERT INTO game_sessions (id, user_id, game_type, status, payload, started_at, expires_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, now())
		 ON CONFLICT (id) DO UPDATE SET
		   status = excluded.status,
		   payload = excluded.payload,
		   expires_at = excluded.expires_at,
		   updated_at = now()`,
		session.ID, session.UserID, session.GameType, session.Status, raw, startedAt, expiresAt,
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
	_ = now
	return err
}

func updateSessionPayload(ctx context.Context, tx pgx.Tx, session Session) error {
	raw, err := json.Marshal(session)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`UPDATE game_sessions
		 SET status = $2, payload = $3, expires_at = $4, updated_at = now()
		 WHERE id = $1 AND game_type = $5`,
		session.ID, session.Status, raw, time.UnixMilli(session.ExpiresAt), GameType,
	)
	return err
}

func deleteSessionAndActive(ctx context.Context, tx pgx.Tx, userID int64, sessionID string) error {
	if _, err := tx.Exec(ctx,
		`DELETE FROM active_game_sessions WHERE user_id = $1 AND game_type = $2`,
		userID, GameType,
	); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `DELETE FROM game_sessions WHERE id = $1 AND game_type = $2`, sessionID, GameType)
	return err
}

func setCooldown(ctx context.Context, tx pgx.Tx, userID int64, gameType string, expiresAt time.Time) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO game_cooldowns (user_id, game_type, expires_at, updated_at)
		 VALUES ($1, $2, $3, now())
		 ON CONFLICT (user_id, game_type) DO UPDATE SET
		   expires_at = excluded.expires_at,
		   updated_at = now()`,
		userID, gameType, expiresAt,
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
		if _, err := tx.Exec(ctx,
			`UPDATE point_accounts SET balance = $1, updated_at = now() WHERE user_id = $2`,
			nextBalance, user.ID,
		); err != nil {
			return 0, 0, err
		}
		if _, err := tx.Exec(ctx,
			`UPDATE daily_game_points SET earned_points = $1, updated_at = now() WHERE user_id = $2 AND stat_date = $3`,
			nextDaily, user.ID, todayChina(),
		); err != nil {
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

func insertRecord(ctx context.Context, tx pgx.Tx, record Record) error {
	raw, err := json.Marshal(record)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO game_records (id, user_id, session_id, game_type, difficulty, score, points_earned, payload, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		record.ID, record.UserID, record.SessionID, record.GameType, string(record.Difficulty), record.Score, record.PointsEarned, raw, time.UnixMilli(record.CreatedAt),
	)
	return err
}

func findSettledRecord(ctx context.Context, tx pgx.Tx, userID int64, sessionID string) (*Record, error) {
	var raw []byte
	err := tx.QueryRow(ctx,
		`SELECT payload
		 FROM game_records
		 WHERE user_id = $1 AND game_type = $2 AND session_id = $3
		 ORDER BY created_at DESC, id DESC
		 LIMIT 1`,
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

func validateResult(session Session, input SubmitInput, effectiveCompleted bool, ignoreCompletedMismatch bool) (bool, string) {
	config := DifficultyConfigs[session.Difficulty]
	total := config.Rows * config.Cols
	maxMoves := config.Pairs * 10
	if len(session.MoveLog) > maxMoves {
		return false, "操作步数异常"
	}
	if effectiveCompleted && len(session.MoveLog) < config.Pairs {
		return false, "操作步数不足以完成游戏"
	}
	matched := map[int]bool{}
	for _, move := range session.MoveLog {
		if move.Card1 < 0 || move.Card1 >= total || move.Card2 < 0 || move.Card2 >= total {
			return false, "无效的卡片索引"
		}
		if move.Card1 == move.Card2 {
			return false, "不能翻同一张卡"
		}
		if matched[move.Card1] || matched[move.Card2] {
			return false, "该卡片已被匹配"
		}
		icon1 := session.CardLayout[move.Card1]
		icon2 := session.CardLayout[move.Card2]
		if icon1 == "" || icon2 == "" {
			return false, "卡片数据异常"
		}
		shouldMatch := icon1 == icon2
		if move.Matched != shouldMatch {
			return false, "匹配结果不一致"
		}
		if move.Matched {
			matched[move.Card1] = true
			matched[move.Card2] = true
		}
	}
	actuallyCompleted := len(matched) == total
	if !ignoreCompletedMismatch && input.Completed != actuallyCompleted {
		return false, "完成状态不一致"
	}
	expected := intSet(session.MatchedCards)
	if len(expected) != len(matched) {
		return false, "服务端匹配记录不一致"
	}
	for index := range matched {
		if !expected[index] {
			return false, "服务端匹配记录不一致"
		}
	}
	return true, ""
}

func isCurrentActiveSession(ctx context.Context, tx pgx.Tx, userID int64, sessionID string) (bool, error) {
	var activeID string
	err := tx.QueryRow(ctx,
		`SELECT session_id FROM active_game_sessions WHERE user_id = $1 AND game_type = $2`,
		userID, GameType,
	).Scan(&activeID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return activeID == sessionID, nil
}

func normalizeSession(session *Session) {
	if session.MatchedCards == nil {
		session.MatchedCards = []int{}
	}
	if session.MoveLog == nil {
		session.MoveLog = []Move{}
	}
}

func totalCards(difficulty Difficulty) int {
	config := DifficultyConfigs[difficulty]
	return config.Rows * config.Cols
}

func seededRandom(seed string, index int) float64 {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s-%d", seed, index)))
	value := binary.BigEndian.Uint32(sum[:4])
	return float64(value) / float64(uint64(1)<<32)
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

func intSet(values []int) map[int]bool {
	result := make(map[int]bool, len(values))
	for _, value := range values {
		result[value] = true
	}
	return result
}

func sortedKeys(values map[int]bool) []int {
	result := make([]int, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	sort.Ints(result)
	return result
}

func sameMove(left Move, right Move) bool {
	return left.Card1 == right.Card1 && left.Card2 == right.Card2 && left.Matched == right.Matched
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
