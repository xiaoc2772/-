package pianotiles

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
)

const (
	ViewWindowMS = int64(2_200)
	// 长按奖励（服务端权威计时）：长按块按下上报 h(b=0)，结束时上报 r(b=0..2)；
	// 服务端用 r 与按下的墙钟间隔按当圈速度换算进度复核——
	// 进度 <50% 奖励 0、>=50% 奖励 1、划满奖励 2（对应总分 1/2/3）。
	HoldBonusMax = int64(2)
	// 长按进度复核宽限（谱面毫秒）：吸收迟按填充回溯（<=120ms 谱面时间）、
	// 事件时间钳制（按下最多 +25ms 墙钟）与帧量化/取整误差在 3 倍速下的放大。
	HoldProgressGraceMS = int64(300)
	MaxCrowns           = 3
	MinHitIntervalMS    = int64(25)
	LapTailMinimumMS    = int64(400)
	RushDurationMS      = int64(60_000)
	EventTimeGraceMS    = int64(5_000)
	MaxEventsPerSecond  = 30
	MaxEventsPerBatch   = 2_048
	// 当前客户端恒速滚动，相机推进上限即 speedMultiplier 上限（3 倍）；
	// 历史客户端存在追块加速（最多再推进 3 倍、合计 12 倍），
	// 保留 12 作为兼容旧客户端的宽松上界。
	MaxCameraAdvanceRate = int64(12)
	// 前端事件时间由 Math.round 生成，边界处允许 1ms 取整误差。
	EarlyHitRoundingGraceMS = int64(1)
)

type ValidationError struct{ Code, Message string }

func (err *ValidationError) Error() string { return err.Message }
func IsValidationError(err error) bool     { var target *ValidationError; return errors.As(err, &target) }
func IsMode(mode Mode) bool                { return mode == ModeClassic || mode == ModeRush }
func IsStatus(status Status) bool          { return status == StatusFailed || status == StatusTimeUp }
func IsJudgement(j Judgement) bool {
	return j == JudgementHit || j == JudgementMiss || j == JudgementWrong || j == JudgementRelease
}

func LapDurationMS(chart ChartSummary) int64 {
	lap := chart.DurationMs
	if len(chart.Notes) == 0 {
		return lap
	}
	last := chart.Notes[len(chart.Notes)-1]
	tail := last.Duration
	if tail < LapTailMinimumMS {
		tail = LapTailMinimumMS
	}
	if last.T+tail > lap {
		lap = last.T + tail
	}
	return lap
}

func tileAt(chart ChartSummary, hitIndex int) (ChartNote, int64, int) {
	total := len(chart.Notes)
	lap := hitIndex / total
	note := chart.Notes[hitIndex%total]
	return note, note.T + int64(lap)*LapDurationMS(chart), lap
}

func ValidateEventPrefix(chart ChartSummary, mode Mode, events []Event) (EngineResult, error) {
	state, err := AdvanceReplayState(chart, mode, ReplayState{}, events)
	if err != nil {
		return EngineResult{}, err
	}
	return replayStateResult(chart, mode, state, StatusPlaying, state.LastEventT), nil
}

func ReplayEvents(chart ChartSummary, mode Mode, events []Event, claimed ClientResult) (EngineResult, error) {
	state, err := AdvanceReplayState(chart, mode, ReplayState{}, events)
	if err != nil {
		return EngineResult{}, err
	}
	return FinalizeReplayState(chart, mode, state, claimed)
}

// AdvanceReplayState 只校验并应用传入的增量事件，返回新的有界重放状态。
// 调用方应在事务中将返回值与会话一起保存；发生错误时原状态不会被修改。
func AdvanceReplayState(chart ChartSummary, mode Mode, current ReplayState, events []Event) (ReplayState, error) {
	if err := validateReplayChart(chart); err != nil {
		return ReplayState{}, err
	}
	if !IsMode(mode) {
		return ReplayState{}, validationError("invalid_mode", "无效的游戏模式")
	}
	state := cloneReplayState(current)
	if state.EventCount < 0 || state.Hits < 0 || state.HoldHits < 0 || state.VerifiedScore < 0 {
		return ReplayState{}, validationError("invalid_replay_state", "服务端重放状态非法")
	}
	if state.Hits > int(^uint(0)>>1)-len(events) {
		return ReplayState{}, validationError("event_count_overflow", "事件数量超过系统上限")
	}
	for index, event := range events {
		globalIndex := state.EventCount + int64(index)
		if !IsJudgement(event.Judgement) {
			return ReplayState{}, validationError("invalid_judgement", fmt.Sprintf("第 %d 条事件判定类型非法", globalIndex+1))
		}
		if event.Lane < 0 || event.Lane > 3 {
			return ReplayState{}, validationError("invalid_lane", fmt.Sprintf("第 %d 条事件轨道非法", globalIndex+1))
		}
		if event.T < 0 {
			return ReplayState{}, validationError("invalid_event_time", fmt.Sprintf("第 %d 条事件时间非法", globalIndex+1))
		}
		if state.HasEvents && event.T < state.LastEventT {
			return ReplayState{}, validationError("event_time_not_monotonic", "事件时间必须单调不减")
		}
		// 跨 checkpoint 保留最近一秒时间戳，事件密度限制不会因分批而失效。
		state.RecentEventTimes = pruneEventTimes(state.RecentEventTimes, event.T)
		if len(state.RecentEventTimes) >= MaxEventsPerSecond {
			return ReplayState{}, validationError("event_density_exceeded", "事件密度超过限制")
		}
		if state.Terminal != "" {
			return ReplayState{}, validationError("event_after_terminal", "失败事件后不得继续上报事件")
		}

		switch event.Judgement {
		case JudgementHit:
			note, globalTime, lap := tileAt(chart, state.Hits)
			if event.Lane != note.Lane {
				return ReplayState{}, validationError("hit_lane_mismatch", fmt.Sprintf("第 %d 个命中事件轨道不匹配", state.Hits+1))
			}
			earliest := earliestHitTimeMS(chart, globalTime)
			if earliest > EarlyHitRoundingGraceMS && event.T < earliest-EarlyHitRoundingGraceMS {
				return ReplayState{}, validationError("hit_too_early", fmt.Sprintf("第 %d 个命中事件早于相机推进上限", state.Hits+1))
			}
			if event.T > globalTime+ViewWindowMS+EventTimeGraceMS {
				return ReplayState{}, validationError("hit_too_late", fmt.Sprintf("第 %d 个命中事件超过节奏上限", state.Hits+1))
			}
			if event.HoldBonus != 0 {
				return ReplayState{}, validationError("invalid_hold_bonus", "长按奖励只能由松手事件上报")
			}
			if state.HasHits && event.T-state.LastHitT < MinHitIntervalMS {
				return ReplayState{}, validationError("hit_interval_too_short", "相邻命中事件间隔过短")
			}
			state.Hits++
			if isHoldNote(chart, note) {
				state.HoldHits++
				// 不上报松手事件的旧客户端直接按下一个长按：上一个视为已结束（奖励 0）。
				state.HoldOpen = true
				state.HoldPressT = event.T
				state.HoldDurationMS = note.Duration
				state.HoldLane = note.Lane
				state.HoldLap = lap
			}
			state.VerifiedScore++
			state.HasHits = true
			state.LastHitT = event.T
		case JudgementRelease:
			if event.HoldBonus < 0 || event.HoldBonus > HoldBonusMax {
				return ReplayState{}, validationError("invalid_hold_bonus", "长按奖励超出允许范围")
			}
			if !state.HoldOpen {
				return ReplayState{}, validationError("release_without_hold", "没有进行中的长按，不能上报松手事件")
			}
			if event.Lane != state.HoldLane {
				return ReplayState{}, validationError("release_lane_mismatch", "松手事件轨道与长按块不匹配")
			}
			if event.HoldBonus > maxHoldBonus(state, event.T) {
				return ReplayState{}, validationError("hold_bonus_too_high", "长按奖励超过按住时长可验证的上限")
			}
			state.VerifiedScore += event.HoldBonus
			state.HoldOpen = false
			state.HoldPressT, state.HoldDurationMS, state.HoldLane, state.HoldLap = 0, 0, 0, 0
		case JudgementMiss, JudgementWrong:
			if event.HoldBonus != 0 {
				return ReplayState{}, validationError("terminal_bonus_invalid", "失败事件不能包含长按奖励")
			}
			state.Terminal = event.Judgement
			if index != len(events)-1 {
				return ReplayState{}, validationError("event_after_terminal", "失败事件必须是最后一条")
			}
		}
		state.EventCount++
		state.HasEvents = true
		state.LastEventT = event.T
		state.RecentEventTimes = append(state.RecentEventTimes, event.T)
	}
	return state, nil
}

// FinalizeReplayState 校验终局声明，并将客户端声明转换为服务端可信结果。
func FinalizeReplayState(chart ChartSummary, mode Mode, state ReplayState, claimed ClientResult) (EngineResult, error) {
	if err := validateReplayChart(chart); err != nil {
		return EngineResult{}, err
	}
	if !IsMode(mode) {
		return EngineResult{}, validationError("invalid_mode", "无效的游戏模式")
	}
	if !IsStatus(claimed.Status) {
		return EngineResult{}, validationError("invalid_status", "无效的结算状态")
	}
	if claimed.PlayedMs < 0 {
		return EngineResult{}, validationError("invalid_played_ms", "游戏时长非法")
	}
	if state.HasEvents && claimed.PlayedMs < state.LastEventT {
		return EngineResult{}, validationError("played_ms_before_event", "游戏时长早于最后事件")
	}
	if claimed.Score != state.VerifiedScore {
		return EngineResult{}, validationError("score_mismatch", "客户端分数与服务端重放结果不一致")
	}
	laps := state.Hits / len(chart.Notes)
	crowns := laps
	if crowns > MaxCrowns {
		crowns = MaxCrowns
	}
	if claimed.TilesHit != state.Hits || claimed.Crowns != crowns || claimed.Laps != laps {
		return EngineResult{}, validationError("result_mismatch", "客户端结算统计与服务端重放结果不一致")
	}
	if claimed.Status == StatusFailed {
		if state.Terminal == "" {
			return EngineResult{}, validationError("failed_without_terminal", "失败结算缺少漏块或点错事件")
		}
	} else {
		if mode != ModeRush {
			return EngineResult{}, validationError("classic_timeup", "经典模式不能以 timeup 结算")
		}
		if state.Terminal != "" {
			return EngineResult{}, validationError("timeup_with_terminal", "限时结束不能包含失败事件")
		}
		if claimed.PlayedMs < RushDurationMS || claimed.PlayedMs > RushDurationMS+EventTimeGraceMS {
			return EngineResult{}, validationError("rush_duration_mismatch", "限时冲刺时长不一致")
		}
	}
	return replayStateResult(chart, mode, state, claimed.Status, claimed.PlayedMs), nil
}

func replayStateResult(chart ChartSummary, mode Mode, state ReplayState, status Status, playedMs int64) EngineResult {
	laps := state.Hits / len(chart.Notes)
	crowns := laps
	if crowns > MaxCrowns {
		crowns = MaxCrowns
	}
	return EngineResult{Mode: mode, Status: status, Score: state.VerifiedScore, TilesHit: state.Hits, Crowns: crowns, Laps: laps, TotalNotes: len(chart.Notes), PlayedMs: playedMs}
}

func cloneReplayState(state ReplayState) ReplayState {
	state.RecentEventTimes = append([]int64(nil), state.RecentEventTimes...)
	return state
}

func pruneEventTimes(times []int64, current int64) []int64 {
	first := 0
	for first < len(times) && current-times[first] > 1_000 {
		first++
	}
	if first == 0 {
		return times
	}
	return append([]int64(nil), times[first:]...)
}

func validateReplayChart(chart ChartSummary) error {
	// 嵌入谱面在 charts.go 加载时会执行 120~1000ms 及整数网格校验；
	// 这里保留对测试/工具谱面的宽容范围，避免把引擎和资源加载职责耦合。
	if chart.DurationMs <= 0 || chart.UnitMs <= 0 || chart.UnitMs > 1000 || len(chart.Notes) == 0 {
		return validationError("invalid_chart", "谱面数据无效")
	}
	last := int64(-1)
	for _, note := range chart.Notes {
		if note.T < 0 || note.T < last || note.Lane < 0 || note.Lane > 3 || note.Duration <= 0 {
			return validationError("invalid_chart", "谱面数据无效")
		}
		last = note.T
	}
	return nil
}

func isHoldNote(chart ChartSummary, note ChartNote) bool {
	// 4*d >= 7*unitMs 等价于 d >= 1.75*unitMs，避免浮点误差。
	return note.Duration*4 >= chart.UnitMs*7
}

// maxHoldBonus 按松手与按下事件的墙钟间隔换算长按进度，返回可验证的奖励上限。
// 相机每真实毫秒推进 speedMultiplier 谱面毫秒（1 + 0.12*圈数，封顶 3 倍），
// 长按填充速率恒等于相机速度。校验速度取按下圈 +2 圈的目标速度上界：
// 填充可能跨圈（相机越界至多 1 圈，多指抢点最多再推进 1 圈），跨圈后客户端
// 相机会在 1.5 秒内渐变到新圈速度，按上界速度信用可避免误判压线划满的
// 诚实玩家（校验失败会作废整局）；换来的作弊余量只是稍早领到本就能通过
// 真实按住获得的奖励，不抬高分数上限。
func maxHoldBonus(state ReplayState, releaseT int64) int64 {
	speedNum := int64(100 + 12*(state.HoldLap+2))
	if speedNum > 300 {
		speedNum = 300
	}
	credited := (releaseT-state.HoldPressT)*speedNum/100 + HoldProgressGraceMS
	switch {
	case credited >= state.HoldDurationMS:
		return 2
	case credited*2 >= state.HoldDurationMS:
		return 1
	default:
		return 0
	}
}

// earliestHitTimeMS 返回当前前端实现下，指定音块最早可能被看到并命中的墙钟时间。
//
// 客户端允许音块进入一整屏后提前点击；相机每毫秒最多推进 12ms 的谱面时间。
// 这里额外假设开局时第一块已经位于判定线，再放宽一整屏可见范围，明显宽于
// 当前实际的开局位置（第一块距判定线约 2.2 个单位），以避免正常玩家被误判。
func earliestHitTimeMS(chart ChartSummary, globalTime int64) int64 {
	initialVisibleUntil := chart.Notes[0].T + 4*chart.UnitMs
	distance := globalTime - initialVisibleUntil
	if distance <= 0 {
		return 0
	}
	return (distance + MaxCameraAdvanceRate - 1) / MaxCameraAdvanceRate
}

// HashEvents 为 checkpoint 幂等重试生成稳定摘要。
func HashEvents(events []Event) string {
	raw, _ := json.Marshal(events)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func CalculatePointsAwarded(score int64, crowns int) int64 {
	if score < 0 {
		score = 0
	}
	if crowns < 0 {
		crowns = 0
	}
	if crowns > MaxCrowns {
		crowns = MaxCrowns
	}
	points := int64(math.Round(float64(score)/8)) + int64(crowns)*15
	if points > 200 {
		return 200
	}
	return points
}

func validationError(code, message string) error {
	return &ValidationError{Code: code, Message: message}
}
