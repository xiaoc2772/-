package luckytd

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
	// 正常对局虽会在 maxFrames 内结束，但玩家可能长时间暂停或停留在祝福选择界面。
	// 保留 6 小时会话窗口，确保 5 小时长时游玩/挂起后仍可继续并结算。
	sessionTTLSeconds      = int64(6 * 60 * 60)
	cooldownTTLSeconds     = int64(5)
	defaultRecordsListSize = 10
	maxRecordsListSize     = 50
	maxCheckpointCount     = 32
	maxRetryableTxRetries  = 12
	// 最快真实败局约 630 帧；下限须留在其下，避免正常快速败局被误拦。
	minFinishDurationMs     = int64(10 * 1000)
	replayTimeout           = 6 * time.Second
	maxAllowedSpeed         = int64(2)
	paceAuditToleranceMs    = int64(5000)
	settlementDescriptionCN = "幸运塔防得分 %d，通关波数 %d，编队 %d 人，积分倍率 %d%%，福利积分 %d"
	configChangedMessageCN  = "游戏配置已更新，请重新开始游戏"
)

var ErrUnavailable = errors.New("luckytd database unavailable")

type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

func (service *Service) Start(ctx context.Context, user auth.User, input StartInput) (StartResult, error) {
	if service.db == nil {
		return StartResult{}, ErrUnavailable
	}
	input.MapID = strings.TrimSpace(input.MapID)
	if input.MapID == "" {
		input.MapID = "training_field"
	}
	if _, err := InitState("validation", input.MapID, input.Squad); err != nil {
		return StartResult{Success: false, Message: err.Error()}, nil
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
		data, err := GetEngineData()
		if err != nil {
			return err
		}
		now := time.Now()
		nowMs := millis(now)
		session := Session{
			ID:            randomHex(16),
			UserID:        user.ID,
			GameType:      GameType,
			Seed:          randomHex(16),
			MapID:         input.MapID,
			Squad:         append([]string(nil), input.Squad...),
			ConfigVersion: data.Config.Version,
			StartedAt:     nowMs,
			ExpiresAt:     nowMs + sessionTTLSeconds*1000,
			Status:        "playing",
			Actions:       []GameAction{},
			Checkpoints:   []Checkpoint{},
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
		records, err := listRecords(ctx, tx, user.ID, defaultRecordsListSize)
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
		dailyEarned, err := getDailyGamePointsEarned(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		output = StatusData{
			Balance:            balance,
			DailyStats:         dailyStats,
			InCooldown:         remaining > 0,
			CooldownRemaining:  remaining,
			DailyLimit:         dailyLimit,
			PointsLimitReached: dailyEarned >= dailyLimit,
			Records:            records,
			ActiveSession:      activeView,
		}
		return nil
	})
	return output, err
}

func (service *Service) Checkpoint(ctx context.Context, user auth.User, input CheckpointInput) (CheckpointResult, error) {
	if service.db == nil {
		return CheckpointResult{}, ErrUnavailable
	}
	input.SessionID = strings.TrimSpace(input.SessionID)
	if input.SessionID == "" || input.WaveIndex < 1 || input.Frame < 0 {
		return CheckpointResult{Success: false, Message: "参数错误"}, nil
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
		if input.WaveIndex <= session.LastCheckpointWave {
			output = CheckpointResult{Success: false, Message: "checkpoint 波次必须递增"}
			return nil
		}
		if input.Frame <= session.LastCheckpointFrame {
			output = CheckpointResult{Success: false, Message: "checkpoint 帧数必须递增"}
			return nil
		}
		if len(session.Checkpoints) >= maxCheckpointCount {
			output = CheckpointResult{Success: false, Message: "checkpoint 次数超过上限"}
			return nil
		}
		actions, err := appendActionDelta(session.Actions, input.ActionsDelta, input.Frame)
		if err != nil {
			output = CheckpointResult{Success: false, Message: err.Error()}
			return nil
		}
		if err := validateCheckpointReplay(*session, actions, input); err != nil {
			output = CheckpointResult{Success: false, Message: err.Error()}
			return nil
		}
		nowMs := millis(time.Now())
		session.Actions = actions
		session.ActionCount = len(actions)
		session.LastCheckpointWave = input.WaveIndex
		session.LastCheckpointFrame = input.Frame
		session.ExpiresAt = nowMs + sessionTTLSeconds*1000
		session.Checkpoints = append(session.Checkpoints, Checkpoint{
			WaveIndex:        input.WaveIndex,
			Frame:            input.Frame,
			StateHash:        input.StateHash,
			ServerReceivedAt: nowMs,
		})
		if err := updateSessionPayload(ctx, tx, *session); err != nil {
			return err
		}
		output = CheckpointResult{Success: true, ExpiresAt: session.ExpiresAt}
		return nil
	})
	return output, err
}

func (service *Service) Submit(ctx context.Context, user auth.User, input SubmitInput) (SubmitResult, error) {
	if service.db == nil {
		return SubmitResult{}, ErrUnavailable
	}
	input.SessionID = strings.TrimSpace(input.SessionID)
	if input.SessionID == "" || input.FinalFrame < 0 {
		return SubmitResult{Success: false, Message: "参数错误"}, nil
	}

	var output SubmitResult
	err := service.withRetryableTx(ctx, func(tx pgx.Tx) error {
		session, err := service.requirePlayingSession(ctx, tx, user, input.SessionID, true, &output)
		if err != nil || session == nil {
			return err
		}
		actions, err := appendActionDelta(session.Actions, input.ActionsDelta, input.FinalFrame)
		if err != nil {
			output = SubmitResult{Success: false, Message: err.Error()}
			return nil
		}
		now := time.Now()
		duration := millis(now) - session.StartedAt
		if duration < 0 {
			duration = 0
		}
		if err := auditPace(*session, input.FinalFrame, duration); err != nil {
			output = SubmitResult{Success: false, Message: err.Error()}
			return nil
		}
		replay, err := replayWithTimeout(ctx, *session, actions)
		if err != nil {
			return err
		}
		if !replay.OK || replay.State == nil || replay.Result == nil {
			output = SubmitResult{Success: false, Message: replay.Error}
			return nil
		}
		if replay.Result.Frames != input.FinalFrame {
			output = SubmitResult{Success: false, Message: "终局帧数不一致"}
			return nil
		}
		if err := validateCheckpointHashes(*session, replay.State); err != nil {
			output = SubmitResult{Success: false, Message: err.Error()}
			return nil
		}
		basePoints := int64(replay.Result.Score)
		squadSize := len(session.Squad)
		squadBonus := SquadBonusPermyriad(squadSize)
		pointReward := PointRewardForScore(replay.Result.Score, squadSize)
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
			fmt.Sprintf(settlementDescriptionCN, replay.Result.Score, replay.Result.WavesCleared, clampSquadSize(squadSize), squadBonus/100, pointReward),
		)
		if err != nil {
			return err
		}
		record := buildRecord(*session, *replay.Result, basePoints, pointReward, squadBonus, pointsEarned, duration, input.ClaimedScore, HashState(replay.State), now)
		if err := upsertRecord(ctx, tx, record); err != nil {
			return err
		}
		if err := incrementDailyStats(ctx, tx, user.ID, record.Score, dailyEarned, now); err != nil {
			return err
		}
		if err := deleteSessionAndActive(ctx, tx, user.ID, session.ID); err != nil {
			return err
		}
		if err := setGameCooldown(ctx, tx, user.ID, now.Add(time.Duration(cooldownTTLSeconds)*time.Second)); err != nil {
			return err
		}
		stats, err := getDailyStats(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		output = SubmitResult{
			Success: true,
			Record:  &record,
			Data: &SubmitData{
				Score:               record.Score,
				BasePoints:          record.BasePoints,
				RewardPoints:        record.RewardPoints,
				SquadSize:           record.SquadSize,
				SquadBonusPermyriad: record.SquadBonusPermyriad,
				PointsEarned:        pointsEarned,
				WavesCleared:        record.WavesCleared,
				Status:              record.Status,
				Won:                 record.Won,
				DailyStats:          &stats,
				PointsLimitReached:  dailyEarned >= dailyLimit,
			},
		}
		return nil
	})
	return output, err
}

func (service *Service) Cancel(ctx context.Context, user auth.User, input CancelInput) (SimpleResult, error) {
	if service.db == nil {
		return SimpleResult{}, ErrUnavailable
	}
	input.SessionID = strings.TrimSpace(input.SessionID)
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
		if input.SessionID != "" && active.ID != input.SessionID {
			output = SimpleResult{Success: false, Message: "会话已不是当前活跃局"}
			return nil
		}
		if err := deleteRecordBySession(ctx, tx, user.ID, active.ID); err != nil {
			return err
		}
		if err := deleteSessionAndActive(ctx, tx, user.ID, active.ID); err != nil {
			return err
		}
		if err := setGameCooldown(ctx, tx, user.ID, time.Now().Add(time.Duration(cooldownTTLSeconds)*time.Second)); err != nil {
			return err
		}
		output = SimpleResult{Success: true}
		return nil
	})
	return output, err
}

func BuildSessionView(session Session) SessionView {
	return SessionView{
		SessionID: session.ID,
		Seed:      session.Seed,
		MapID:     session.MapID,
		Squad:     append([]string(nil), session.Squad...),
		Actions:   append([]GameAction(nil), session.Actions...),
		Frame:     session.LastCheckpointFrame,
		ExpiresAt: session.ExpiresAt,
	}
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
		return nil, checkpointFailure("游戏会话不存在或已过期")
	}
	if session.UserID != user.ID {
		if idempotent {
			submitOutput.Success = false
			submitOutput.Message = "会话不属于该用户"
			return nil, nil
		}
		return nil, checkpointFailure("会话不属于该用户")
	}
	if ok, err := isCurrentActiveSession(ctx, tx, user.ID, session.ID); err != nil {
		return nil, err
	} else if !ok {
		if idempotent {
			return nil, service.settledRecordOrFailure(ctx, tx, user, session.ID, "游戏会话已不是当前活跃局", submitOutput)
		}
		return nil, checkpointFailure("游戏会话已不是当前活跃局")
	}
	if session.Status != "playing" {
		if idempotent {
			return nil, service.settledRecordOrFailure(ctx, tx, user, session.ID, "游戏会话已结束", submitOutput)
		}
		return nil, checkpointFailure("游戏会话已结束")
	}
	if time.Now().UnixMilli() > session.ExpiresAt {
		if err := deleteSessionAndActive(ctx, tx, user.ID, session.ID); err != nil {
			return nil, err
		}
		if idempotent {
			return nil, service.settledRecordOrFailure(ctx, tx, user, session.ID, "游戏会话已过期", submitOutput)
		}
		return nil, checkpointFailure("游戏会话已过期")
	}
	if err := validateSessionConfigVersion(*session); err != nil {
		if deleteErr := deleteSessionAndActive(ctx, tx, user.ID, session.ID); deleteErr != nil {
			return nil, deleteErr
		}
		if idempotent {
			submitOutput.Success = false
			submitOutput.Message = err.Error()
			return nil, nil
		}
		return nil, checkpointFailure(err.Error())
	}
	return session, nil
}

type checkpointFailure string

func (err checkpointFailure) Error() string {
	return string(err)
}

func appendActionDelta(current []GameAction, delta []GameAction, maxFrame int) ([]GameAction, error) {
	actions := append([]GameAction(nil), current...)
	// 丢 ACK 重试会把已入库的动作重发：与已存尾部逐字段一致的前缀直接跳过，不一致才拒绝。
	delta, err := trimReplayedActionPrefix(actions, delta)
	if err != nil {
		return nil, err
	}
	if len(delta) == 0 {
		return actions, nil
	}
	if len(actions)+len(delta) > mustEngineData().Config.Engine.MaxActions {
		return nil, errors.New("操作数超过上限")
	}
	var prev *GameAction
	if len(actions) > 0 {
		prev = &actions[len(actions)-1]
	}
	for i := range delta {
		action := delta[i]
		if action.Frame < 0 || action.Frame > maxFrame {
			return nil, errors.New("操作帧非法")
		}
		if action.Seq < 0 {
			return nil, errors.New("操作序号非法")
		}
		if prev != nil && (action.Frame < prev.Frame || (action.Frame == prev.Frame && action.Seq <= prev.Seq)) {
			return nil, errors.New("操作未按 (frame, seq) 严格递增排序")
		}
		if action.Type != "deploy" && action.Type != "retreat" && action.Type != "bless" &&
			action.Type != "skill" && action.Type != "skillUpgrade" {
			return nil, errors.New("未知操作")
		}
		actions = append(actions, action)
		prev = &actions[len(actions)-1]
	}
	return actions, nil
}

// trimReplayedActionPrefix 处理丢 ACK 后的幂等重发：delta 中 (frame, seq) 未超过
// 已存尾部的前缀段必须与已存尾部逐字段一致，一致则跳过，否则视为篡改历史拒绝。
func trimReplayedActionPrefix(current []GameAction, delta []GameAction) ([]GameAction, error) {
	if len(current) == 0 || len(delta) == 0 {
		return delta, nil
	}
	last := current[len(current)-1]
	overlap := 0
	for overlap < len(delta) {
		action := delta[overlap]
		if action.Frame > last.Frame || (action.Frame == last.Frame && action.Seq > last.Seq) {
			break
		}
		overlap++
	}
	if overlap == 0 {
		return delta, nil
	}
	if overlap > len(current) {
		return nil, errors.New("操作重复段与已保存记录不一致")
	}
	tail := current[len(current)-overlap:]
	for i := range tail {
		if !actionsEqual(tail[i], delta[i]) {
			return nil, errors.New("操作重复段与已保存记录不一致")
		}
	}
	return delta[overlap:], nil
}

func actionsEqual(a, b GameAction) bool {
	return a.Frame == b.Frame && a.Seq == b.Seq && a.Type == b.Type &&
		intPtrEqual(a.Unit, b.Unit) && intPtrEqual(a.Row, b.Row) && intPtrEqual(a.Col, b.Col) &&
		intPtrEqual(a.Dir, b.Dir) &&
		intPtrEqual(a.UnitID, b.UnitID) && intPtrEqual(a.Blessing, b.Blessing)
}

func intPtrEqual(a, b *int) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func validateCheckpointReplay(session Session, actions []GameAction, input CheckpointInput) error {
	state, err := replayUntilWave(session, actions, input.WaveIndex)
	if err != nil {
		return err
	}
	if input.WaveIndex > len(state.WaveHashes) {
		return errors.New("checkpoint 波次尚未结清")
	}
	if state.WaveHashes[input.WaveIndex-1] != input.StateHash {
		return errors.New("checkpoint 状态哈希不一致")
	}
	if state.Frame != input.Frame {
		return errors.New("checkpoint 帧数不一致")
	}
	return nil
}

func replayUntilWave(session Session, actions []GameAction, waveIndex int) (*GameState, error) {
	state, err := InitState(session.Seed, session.MapID, session.Squad)
	if err != nil {
		return nil, err
	}
	idx := 0
	for {
		if len(state.WaveHashes) >= waveIndex {
			return state, nil
		}
		if state.Status != StatusPlaying {
			return nil, errors.New("对局已提前结束")
		}
		for idx < len(actions) && actions[idx].Frame == state.Frame && state.Status == StatusPlaying {
			result := ApplyAction(state, actions[idx])
			if !result.OK {
				return nil, fmt.Errorf("第 %d 条操作被拒绝: %s", idx+1, result.Message)
			}
			idx++
		}
		if len(state.WaveHashes) >= waveIndex {
			return state, nil
		}
		if state.PendingBlessing != nil {
			return nil, errors.New("祝福未决且没有对应的 bless 操作")
		}
		if idx < len(actions) && actions[idx].Frame < state.Frame {
			return nil, errors.New("操作帧已错过")
		}
		Tick(state)
	}
}

func replayWithTimeout(ctx context.Context, session Session, actions []GameAction) (ReplayOutput, error) {
	replayCtx, cancel := context.WithTimeout(ctx, replayTimeout)
	defer cancel()
	done := make(chan ReplayOutput, 1)
	go func() {
		done <- Replay(ReplayInput{Seed: session.Seed, MapID: session.MapID, Squad: session.Squad, Actions: actions})
	}()
	select {
	case <-replayCtx.Done():
		return ReplayOutput{}, errors.New("幸运塔防重放超时")
	case output := <-done:
		return output, nil
	}
}

func validateCheckpointHashes(session Session, state *GameState) error {
	for _, checkpoint := range session.Checkpoints {
		if checkpoint.WaveIndex < 1 || checkpoint.WaveIndex > len(state.WaveHashes) {
			return errors.New("checkpoint 波次与终局不一致")
		}
		if state.WaveHashes[checkpoint.WaveIndex-1] != checkpoint.StateHash {
			return errors.New("checkpoint 状态哈希与终局重放不一致")
		}
	}
	return nil
}

func auditPace(session Session, finalFrame int, durationMs int64) error {
	if durationMs < minFinishDurationMs {
		return errors.New("游戏时长过短")
	}
	for _, checkpoint := range session.Checkpoints {
		checkpointDuration := checkpoint.ServerReceivedAt - session.StartedAt
		if checkpointDuration < 0 {
			checkpointDuration = 0
		}
		if err := auditFramePace(checkpoint.Frame, checkpointDuration); err != nil {
			return errors.New("checkpoint 完成速度异常，请正常游玩后再结算")
		}
	}
	return auditFramePace(finalFrame, durationMs)
}

func auditFramePace(frame int, durationMs int64) error {
	data := mustEngineData()
	minDuration := int64(frame) * 1000 / int64(data.Config.Engine.Fps) / maxAllowedSpeed
	if minDuration > paceAuditToleranceMs {
		minDuration -= paceAuditToleranceMs
	} else {
		minDuration = 0
	}
	if durationMs < minDuration {
		return errors.New("游戏完成速度异常，请正常游玩后再结算")
	}
	return nil
}

func validateSessionConfigVersion(session Session) error {
	data, err := GetEngineData()
	if err != nil {
		return err
	}
	if session.ConfigVersion != data.Config.Version {
		return errors.New(configChangedMessageCN)
	}
	return nil
}

func buildRecord(session Session, result GameResult, basePoints int64, rewardPoints int64, squadBonusPermyriad int, pointsEarned int64, duration int64, claimedScore int, replayHash uint32, now time.Time) Record {
	maxDuration := sessionTTLSeconds * 1000
	if duration > maxDuration {
		duration = maxDuration
	}
	squadSize := clampSquadSize(len(session.Squad))
	return Record{
		ID:                  randomHex(16),
		UserID:              session.UserID,
		SessionID:           session.ID,
		GameType:            GameType,
		MapID:               session.MapID,
		Status:              result.Status,
		Won:                 result.Status == 1 && result.WavesCleared >= LuckyTdWinWaves && int64(result.Score) >= LuckyTdWinScore,
		WavesCleared:        result.WavesCleared,
		Score:               int64(result.Score),
		BasePoints:          basePoints,
		RewardPoints:        rewardPoints,
		SquadSize:           squadSize,
		SquadBonusPermyriad: squadBonusPermyriad,
		PointsEarned:        pointsEarned,
		DurationMs:          duration,
		FinalFrame:          result.Frames,
		ClaimedScore:        claimedScore,
		Breakdown:           result.Breakdown,
		ReplayHash:          replayHash,
		CreatedAt:           millis(now),
	}
}

func (service *Service) settledRecordOrFailure(ctx context.Context, tx pgx.Tx, user auth.User, sessionID string, message string, output *SubmitResult) error {
	record, err := findRecordForUpdateBySession(ctx, tx, user.ID, sessionID)
	if err != nil {
		return err
	}
	if record != nil {
		stats, err := getDailyStats(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		dailyLimit, err := systemconfig.DailyPointsLimit(ctx, tx)
		if err != nil {
			return err
		}
		dailyEarned, err := getDailyGamePointsEarned(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		basePoints, rewardPoints, squadSize, squadBonus := rewardFieldsForRecord(record)
		*output = SubmitResult{
			Success: true,
			Record:  record,
			Data: &SubmitData{
				Score:               record.Score,
				BasePoints:          basePoints,
				RewardPoints:        rewardPoints,
				SquadSize:           squadSize,
				SquadBonusPermyriad: squadBonus,
				PointsEarned:        record.PointsEarned,
				WavesCleared:        record.WavesCleared,
				Status:              record.Status,
				Won:                 record.Won,
				DailyStats:          &stats,
				PointsLimitReached:  dailyEarned >= dailyLimit,
			},
		}
		return nil
	}
	*output = SubmitResult{Success: false, Message: message}
	return nil
}

func rewardFieldsForRecord(record *Record) (int64, int64, int, int) {
	basePoints := record.BasePoints
	if basePoints == 0 {
		basePoints = record.Score
	}
	squadSize := record.SquadSize
	if squadSize == 0 {
		squadSize = MaxSquadSize
	}
	squadSize = clampSquadSize(squadSize)
	squadBonus := record.SquadBonusPermyriad
	if squadBonus == 0 {
		squadBonus = SquadBonusPermyriad(squadSize)
	}
	rewardPoints := record.RewardPoints
	if rewardPoints == 0 {
		rewardPoints = basePoints * int64(squadBonus) / 10000
	}
	return basePoints, rewardPoints, squadSize, squadBonus
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
	normalizeSession(&session)
	return &session, nil
}

func normalizeSession(session *Session) {
	session.GameType = GameType
	if session.Actions == nil {
		session.Actions = []GameAction{}
	}
	if session.Checkpoints == nil {
		session.Checkpoints = []Checkpoint{}
	}
	if session.ActionCount < len(session.Actions) {
		session.ActionCount = len(session.Actions)
	}
	if session.LastCheckpointWave < 0 {
		session.LastCheckpointWave = 0
	}
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

func setGameCooldown(ctx context.Context, tx pgx.Tx, userID int64, expiresAt time.Time) error {
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
			record.MapID, record.Score, record.PointsEarned, raw, time.UnixMilli(record.CreatedAt), record.ID,
		)
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO game_records (id, user_id, session_id, game_type, difficulty, score, points_earned, payload, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		record.ID, record.UserID, record.SessionID, record.GameType, record.MapID, record.Score, record.PointsEarned, raw, time.UnixMilli(record.CreatedAt),
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
