package pianotiles

import "math"

// PerformanceReference 表示排行榜中的 100.00%。
// 使用基点保存，避免前后端传递浮点数时产生排序误差。
const PerformanceReference = int64(10_000)

// DifficultyStars 与前端谱面清单使用同一套音块密度规则。
func DifficultyStars(chart ChartSummary) int {
	if chart.DurationMs <= 0 || len(chart.Notes) == 0 {
		return 1
	}
	density := float64(len(chart.Notes)) / (float64(chart.DurationMs) / 1_000)
	switch {
	case density < 1.5:
		return 1
	case density < 2.5:
		return 2
	case density < 3.5:
		return 3
	case density < 5:
		return 4
	default:
		return 5
	}
}

// MaxLapScore 返回一圈谱面全部命中、长按全部按满时的分数。
func MaxLapScore(chart ChartSummary) int64 {
	score := int64(len(chart.Notes))
	for _, note := range chart.Notes {
		if isHoldNote(chart, note) {
			score += HoldBonusMax
		}
	}
	return score
}

// RushReferenceScore 返回基础速度下 60 秒内可取得的参考满分。
// 完整圈按满分计，最后不足一圈的部分按音块出现时间和长按进度计分。
func RushReferenceScore(chart ChartSummary) int64 {
	lapDuration := LapDurationMS(chart)
	lapScore := MaxLapScore(chart)
	if lapDuration <= 0 || lapScore <= 0 {
		return 1
	}

	fullLaps := RushDurationMS / lapDuration
	reference := fullLaps * lapScore
	remaining := RushDurationMS % lapDuration
	for _, note := range chart.Notes {
		if note.T >= remaining {
			break
		}
		reference++
		if !isHoldNote(chart, note) || remaining <= note.T {
			continue
		}
		heldMs := remaining - note.T
		bonus := heldMs * HoldBonusMax / note.Duration
		if bonus > HoldBonusMax {
			bonus = HoldBonusMax
		}
		reference += bonus
	}
	if reference < 1 {
		return 1
	}
	return reference
}

// NormalizedPerformance 把不同长度、长按占比的歌曲换算为可比较的标准表现。
//
//   - 经典模式：满分完成一圈 = 100.00%。
//   - 冲刺模式：达到基础速度 60 秒参考满分 = 100.00%。
//
// 玩家完成多圈或利用提速后可以超过 100%，这是预期行为。
func NormalizedPerformance(chart ChartSummary, mode Mode, score int64) int64 {
	if score <= 0 {
		return 0
	}
	denominator := MaxLapScore(chart)
	if mode == ModeRush {
		denominator = RushReferenceScore(chart)
	}
	if denominator <= 0 {
		return 0
	}
	value := math.Round(float64(score) * float64(PerformanceReference) / float64(denominator))
	if value >= float64(math.MaxInt64) {
		return math.MaxInt64
	}
	return int64(value)
}
