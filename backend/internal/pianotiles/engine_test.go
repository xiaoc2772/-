package pianotiles

import (
	"errors"
	"fmt"
	"testing"
	"time"
)

func TestV2FastPlayIsValid(t *testing.T) {
	chart := testChart(4, 1_000)
	events := []Event{{T: 0, Lane: 0, Judgement: JudgementHit}, {T: 500, Lane: 1, Judgement: JudgementHit}, {T: 1_000, Lane: 2, Judgement: JudgementHit}, {T: 1_500, Lane: 3, Judgement: JudgementHit}, {T: 1_600, Lane: 0, Judgement: JudgementWrong}}
	result, err := ReplayEvents(chart, ModeClassic, events, ClientResult{Status: StatusFailed, Score: 4, TilesHit: 4, Crowns: 1, Laps: 1, PlayedMs: 1_600})
	if err != nil {
		t.Fatalf("2 倍快打应合法: %v", err)
	}
	if result.TilesHit != 4 || result.Laps != 1 || result.Crowns != 1 || result.Score != 4 {
		t.Fatalf("结果不一致: %+v", result)
	}
}

func TestV2LaneOrderAndHitInterval(t *testing.T) {
	chart := testChart(2, 1_000)
	if _, err := ValidateEventPrefix(chart, ModeClassic, []Event{{T: 0, Lane: 1, Judgement: JudgementHit}}); err == nil {
		t.Fatal("伪造 lane 应拒绝")
	}
	if _, err := ValidateEventPrefix(chart, ModeClassic, []Event{{T: 0, Lane: 0, Judgement: JudgementHit}, {T: 24, Lane: 1, Judgement: JudgementHit}}); err == nil {
		t.Fatal("24ms 命中间隔应拒绝")
	}
	if _, err := ValidateEventPrefix(chart, ModeClassic, []Event{{T: 0, Lane: 0, Judgement: JudgementHit}, {T: 25, Lane: 1, Judgement: JudgementHit}}); err != nil {
		t.Fatalf("25ms 命中间隔应接受: %v", err)
	}
}

func TestV2LateUpperBound(t *testing.T) {
	chart := testChart(1, 1_000)
	limit := ViewWindowMS + EventTimeGraceMS
	if _, err := ValidateEventPrefix(chart, ModeClassic, []Event{{T: limit, Lane: 0, Judgement: JudgementHit}}); err != nil {
		t.Fatalf("节奏上界应接受: %v", err)
	}
	if _, err := ValidateEventPrefix(chart, ModeClassic, []Event{{T: limit + 1, Lane: 0, Judgement: JudgementHit}}); err == nil {
		t.Fatal("超过节奏上界应拒绝")
	}
}

func TestV3EarlyHitBoundRejectsImpossibleBatchForgery(t *testing.T) {
	chart := testChart(1, 1_000)
	events := make([]Event, 12)
	for index := range events {
		events[index] = Event{T: int64(index * 25), Lane: 0, Judgement: JudgementHit}
	}
	_, err := ValidateEventPrefix(chart, ModeClassic, events)
	if err == nil {
		t.Fatal("以 25ms 间隔在相机不可能到达时连续伪造跨圈命中应拒绝")
	}
	var validation *ValidationError
	if !errors.As(err, &validation) || validation.Code != "hit_too_early" {
		t.Fatalf("应由过早命中校验拒绝，得到 %T: %v", err, err)
	}
}

func TestV3EarlyHitBoundAllowsConservativeMaximumCameraAdvance(t *testing.T) {
	chart := testChart(1, 1_000)
	events := make([]Event, 64)
	last := int64(-MinHitIntervalMS)
	for index := range events {
		_, globalTime, _ := tileAt(chart, index)
		at := earliestHitTimeMS(chart, globalTime)
		if at < last+MinHitIntervalMS {
			at = last + MinHitIntervalMS
		}
		events[index] = Event{T: at, Lane: 0, Judgement: JudgementHit}
		last = at
	}
	if _, err := ValidateEventPrefix(chart, ModeClassic, events); err != nil {
		t.Fatalf("按前端理论最大相机推进生成的跨圈命中不应被误杀: %v", err)
	}
}

func TestV2TerminalRules(t *testing.T) {
	chart := testChart(2, 1_000)
	bad := []Event{{T: 0, Lane: 0, Judgement: JudgementMiss}, {T: 25, Lane: 0, Judgement: JudgementHit}}
	if _, err := ReplayEvents(chart, ModeClassic, bad, ClientResult{Status: StatusFailed, Score: 0, PlayedMs: 25}); err == nil {
		t.Fatal("m 后追加事件应拒绝")
	}
	if _, err := ReplayEvents(chart, ModeClassic, nil, ClientResult{Status: StatusFailed, Score: 0, PlayedMs: 0}); err == nil {
		t.Fatal("failed 必须有终止事件")
	}
	if _, err := ReplayEvents(chart, ModeClassic, []Event{{T: 0, Lane: 0, Judgement: JudgementWrong}}, ClientResult{Status: StatusFailed, Score: 0, TilesHit: 0, Crowns: 0, Laps: 0, PlayedMs: 0}); err != nil {
		t.Fatalf("经典失败应接受: %v", err)
	}
	if _, err := ReplayEvents(chart, ModeClassic, nil, ClientResult{Status: StatusTimeUp, Score: 0, PlayedMs: RushDurationMS}); err == nil {
		t.Fatal("经典模式不能 timeup")
	}
}

func TestV2LapsCrownsScoreAndPoints(t *testing.T) {
	chart := testChart(4, 1_000)
	events := make([]Event, 0, 11)
	for i := 0; i < 10; i++ {
		note, _, _ := tileAt(chart, i)
		events = append(events, Event{T: int64(i * 100), Lane: note.Lane, Judgement: JudgementHit})
	}
	events = append(events, Event{T: 1_100, Lane: 0, Judgement: JudgementWrong})
	result, err := ReplayEvents(chart, ModeClassic, events, ClientResult{Status: StatusFailed, Score: 10, TilesHit: 10, Crowns: 2, Laps: 2, PlayedMs: 1_100})
	if err != nil {
		t.Fatalf("2.5 圈应合法: %v", err)
	}
	if result.Laps != 2 || result.Crowns != 2 || result.TilesHit != 10 {
		t.Fatalf("圈数/皇冠错误: %+v", result)
	}
	if CalculatePointsAwarded(result.Score, result.Crowns) != 31 {
		t.Fatalf("积分公式错误")
	}
	if _, err := ReplayEvents(chart, ModeClassic, events, ClientResult{Status: StatusFailed, Score: 41, TilesHit: 10, Crowns: 2, Laps: 2, PlayedMs: 1_100}); err == nil {
		t.Fatal("分数与服务端精确重放结果不一致应拒绝")
	}
	if CalculatePointsAwarded(10_000, 3) != 200 {
		t.Fatal("积分应封顶 200")
	}
}

func TestV2DensityAndCheckpoint(t *testing.T) {
	chart := testChart(40, 25)
	events := make([]Event, 31)
	for i := range events {
		events[i] = Event{T: int64(i * 25), Lane: i % 4, Judgement: JudgementHit}
	}
	if _, err := ValidateEventPrefix(chart, ModeClassic, events); err == nil {
		t.Fatal("1 秒内 31 条事件应拒绝")
	}
	state, err := AdvanceReplayState(chart, ModeClassic, ReplayState{}, []Event{{T: 0, Lane: 0, Judgement: JudgementHit}})
	if err != nil {
		t.Fatalf("第一批 checkpoint 增量失败: %v", err)
	}
	state, err = AdvanceReplayState(chart, ModeClassic, state, []Event{{T: 25, Lane: 1, Judgement: JudgementHit}})
	if err != nil || state.EventCount != 2 {
		t.Fatalf("跨批 checkpoint 增量失败: %+v %v", state, err)
	}
}

func TestV2LapDurationAndEmbeddedCharts(t *testing.T) {
	chart := ChartSummary{DurationMs: 1_000, Notes: []ChartNote{{T: 900, Lane: 0, Duration: 800}}}
	if LapDurationMS(chart) != 1_700 {
		t.Fatalf("长按圈长错误: %d", LapDurationMS(chart))
	}
	if ChartCount() != 810 {
		t.Fatalf("谱面摘要数量错误: %d", ChartCount())
	}
	loaded, ok := ChartSummaryFor("101")
	if !ok || loaded.Checksum != "901bf3f2" {
		t.Fatal("101 谱面摘要加载失败")
	}
}

func TestV2ScoreBoundariesRemainReplayable(t *testing.T) {
	chart := testChart(1, 1_000)
	for _, targetScore := range []int{10, 50, 100, 500, 1_000} {
		t.Run(fmt.Sprintf("score_%d", targetScore), func(t *testing.T) {
			events := make([]Event, 0, targetScore+1)
			for index := 0; index < targetScore; index++ {
				events = append(events, Event{T: int64(index * 100), Lane: 0, Judgement: JudgementHit})
			}
			playedMs := int64(targetScore * 100)
			events = append(events, Event{T: playedMs, Lane: 1, Judgement: JudgementWrong})
			crowns := targetScore
			if crowns > MaxCrowns {
				crowns = MaxCrowns
			}
			result, err := ReplayEvents(chart, ModeClassic, events, ClientResult{
				Status:   StatusFailed,
				Score:    int64(targetScore),
				TilesHit: targetScore,
				Crowns:   crowns,
				Laps:     targetScore,
				PlayedMs: playedMs,
			})
			if err != nil {
				t.Fatalf("分数 %d 应可正常重放结算: %v", targetScore, err)
			}
			if result.Score != int64(targetScore) || result.TilesHit != targetScore {
				t.Fatalf("分数 %d 结算结果错误: %+v", targetScore, result)
			}
		})
	}
}

func TestV2LongDurationsRemainRepresentable(t *testing.T) {
	chart := testChart(1, 1_000)
	for _, hours := range []int64{1, 2, 10, 24} {
		t.Run(fmt.Sprintf("hours_%d", hours), func(t *testing.T) {
			playedMs := hours * int64(time.Hour/time.Millisecond)
			result, err := ReplayEvents(chart, ModeClassic,
				[]Event{{T: playedMs, Lane: 1, Judgement: JudgementWrong}},
				ClientResult{Status: StatusFailed, Score: 0, TilesHit: 0, Crowns: 0, Laps: 0, PlayedMs: playedMs},
			)
			if err != nil {
				t.Fatalf("%d 小时时长应可正常表示和结算: %v", hours, err)
			}
			if result.PlayedMs != playedMs {
				t.Fatalf("%d 小时时长被截断: got=%d want=%d", hours, result.PlayedMs, playedMs)
			}
		})
	}
}

func testChart(noteCount int, interval int64) ChartSummary {
	notes := make([]ChartNote, noteCount)
	for i := range notes {
		notes[i] = ChartNote{T: int64(i) * interval, Lane: i % 4, Duration: interval}
	}
	return ChartSummary{ID: "test", Checksum: "12345678", DurationMs: int64(noteCount) * interval, UnitMs: interval, Notes: notes}
}
