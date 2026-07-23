package pianotiles

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

// regressionChart 构造一张不依赖 embed 数据的最小谱面。
// 事件时间是玩家墙钟时间；测试事件既要满足节奏上界，也要满足相机理论
// 最大推进速度对应的过早命中下界。
func regressionChart(noteCount int, unitMs int64, durations ...int64) ChartSummary {
	if noteCount < 1 {
		noteCount = 1
	}
	notes := make([]ChartNote, noteCount)
	for i := range notes {
		d := unitMs
		if i < len(durations) && durations[i] > 0 {
			d = durations[i]
		}
		notes[i] = ChartNote{T: int64(i) * unitMs, Lane: i % 4, Duration: d}
	}
	return ChartSummary{
		ID:         "regression",
		Checksum:   "12345678",
		DurationMs: int64(noteCount) * unitMs,
		UnitMs:     unitMs,
		Notes:      notes,
	}
}

func hitBatch(start, count int, at func(int) int64) []Event {
	events := make([]Event, count)
	for i := range events {
		index := start + i
		events[i] = Event{T: at(i), Lane: index % 4, Judgement: JudgementHit}
	}
	return events
}

func TestIncrementalReplayAccumulatesAcrossBatches(t *testing.T) {
	chart := regressionChart(8, 1_000)
	first := hitBatch(0, 3, func(i int) int64 { return int64(i * 100) })
	state, err := AdvanceReplayState(chart, ModeClassic, ReplayState{}, first)
	if err != nil {
		t.Fatalf("第一批事件应通过增量校验: %v", err)
	}
	if state.EventCount != 3 || state.Hits != 3 || state.VerifiedScore != 3 {
		t.Fatalf("第一批摘要错误: %+v", state)
	}

	second := hitBatch(3, 2, func(i int) int64 { return int64(300 + i*100) })
	state, err = AdvanceReplayState(chart, ModeClassic, state, second)
	if err != nil {
		t.Fatalf("第二批事件应通过增量校验: %v", err)
	}
	if state.EventCount != 5 || state.Hits != 5 || state.VerifiedScore != 5 {
		t.Fatalf("跨批摘要未累积: %+v", state)
	}

	// 空批是前端的 heartbeat：不得改变重放摘要，也不得因为没有事件而
	// 触发终止状态。
	before := state
	state, err = AdvanceReplayState(chart, ModeClassic, state, nil)
	if err != nil {
		t.Fatalf("空 heartbeat 不应失败: %v", err)
	}
	if state.EventCount != before.EventCount || state.Hits != before.Hits ||
		state.VerifiedScore != before.VerifiedScore || state.Terminal != before.Terminal {
		t.Fatalf("空 heartbeat 改变了重放摘要: before=%+v after=%+v", before, state)
	}
}

func TestIncrementalReplayRejectsCrossBatchDensityAndHitInterval(t *testing.T) {
	// 使用 25ms 测试谱面隔离事件密度边界，避免被相机推进上限先行拒绝。
	chart := regressionChart(64, 25)
	first := hitBatch(0, 30, func(i int) int64 { return int64(i * 25) })
	state, err := AdvanceReplayState(chart, ModeClassic, ReplayState{}, first)
	if err != nil {
		t.Fatalf("恰好 30 条/秒应通过: %v", err)
	}

	// 第 31 条仍落在首个 1 秒窗口内；若只检查当前批次而不保留
	// RecentEventTimes，这个攻击会被错误放行。
	tooDense := []Event{{T: 750, Lane: 2, Judgement: JudgementHit}}
	if _, err := AdvanceReplayState(chart, ModeClassic, state, tooDense); err == nil {
		t.Fatal("跨批 1 秒窗口第 31 条事件应被拒绝")
	} else if !IsValidationError(err) {
		t.Fatalf("应返回可识别的校验错误，得到 %T: %v", err, err)
	}

	// 重新构造合法的第一批，专门检查跨批命中最小间隔。
	first = hitBatch(0, 2, func(i int) int64 { return int64(i * 100) })
	state, err = AdvanceReplayState(chart, ModeClassic, ReplayState{}, first)
	if err != nil {
		t.Fatalf("间隔 100ms 的第一批应通过: %v", err)
	}
	if _, err := AdvanceReplayState(chart, ModeClassic, state,
		[]Event{{T: 124, Lane: 2, Judgement: JudgementHit}}); err == nil {
		t.Fatal("跨批命中间隔 24ms 应被拒绝")
	}
	if _, err := AdvanceReplayState(chart, ModeClassic, state,
		[]Event{{T: 125, Lane: 2, Judgement: JudgementHit}}); err != nil {
		t.Fatalf("跨批命中间隔 25ms 应通过: %v", err)
	}
}

func TestIncrementalReplayRejectsOrdinaryTileHoldForgery(t *testing.T) {
	chart := regressionChart(1, 200, 200) // 普通块：d < 1.75*unitMs
	_, err := AdvanceReplayState(chart, ModeClassic, ReplayState{}, []Event{
		{T: 0, Lane: 0, Judgement: JudgementHit, HoldBonus: 1},
	})
	if err == nil {
		t.Fatal("普通块伪造长按奖励应被拒绝")
	}
	if !IsValidationError(err) {
		t.Fatalf("普通块长按伪造应返回校验错误，得到 %T: %v", err, err)
	}
}

func TestIncrementalReplayHoldThresholdUsesExactIntegerBoundary(t *testing.T) {
	// 4*d == 7*unit 是长按边界，避免浮点比较在不同平台产生差异。
	// unitMs 取 200（满足真实谱面单位范围），边界时值为 350ms。
	boundary := regressionChart(1, 200, 350)
	if !isHoldNote(boundary, boundary.Notes[0]) {
		t.Fatal("4*d=7*unit 应识别为长按块")
	}
	state, err := AdvanceReplayState(boundary, ModeClassic, ReplayState{}, []Event{
		{T: 0, Lane: 0, Judgement: JudgementHit, HoldBonus: HoldBonusMax},
	})
	if err != nil {
		t.Fatalf("4*d=7*unit 的长按应通过: %v", err)
	}
	state, err = AdvanceReplayState(boundary, ModeClassic, state, []Event{
		{T: 25, Lane: 1, Judgement: JudgementWrong},
	})
	if err != nil {
		t.Fatalf("长按命中后的终止事件应通过: %v", err)
	}
	result, err := FinalizeReplayState(boundary, ModeClassic, state, ClientResult{
		Status: StatusFailed, Score: 1 + HoldBonusMax, TilesHit: 1,
		Crowns: 1, Laps: 1, PlayedMs: 25,
	})
	if err != nil {
		t.Fatalf("边界长按应按精确奖励完成结算: %v", err)
	}
	if result.Score != 1+HoldBonusMax || result.TilesHit != 1 {
		t.Fatalf("边界长按结算结果错误: %+v", result)
	}

	below := regressionChart(1, 200, 349)
	if isHoldNote(below, below.Notes[0]) {
		t.Fatal("4*d<7*unit 不应识别为长按块")
	}
	if _, err := AdvanceReplayState(below, ModeClassic, ReplayState{}, []Event{
		{T: 0, Lane: 0, Judgement: JudgementHit, HoldBonus: 1},
	}); err == nil {
		t.Fatal("4*d<7*unit 的普通块不应获得长按奖励")
	}
}

func TestIncrementalReplayRejectsClientReportedHoldBonus(t *testing.T) {
	chart := regressionChart(1, 200, 350)
	_, err := AdvanceReplayState(chart, ModeClassic, ReplayState{}, []Event{
		{T: 0, Lane: 0, Judgement: JudgementHit, HoldBonus: 1},
	})
	if err == nil || !IsValidationError(err) {
		t.Fatalf("客户端上报长按奖励必须被拒绝，得到: %v", err)
	}
}

func TestIncrementalReplayLongPlayedMsDoesNotOverflow(t *testing.T) {
	chart := regressionChart(1, 1_000)
	for _, hours := range []int64{1, 2, 10, 24} {
		t.Run(fmt.Sprintf("%dh", hours), func(t *testing.T) {
			playedMs := hours * 60 * 60 * 1_000
			state, err := AdvanceReplayState(chart, ModeClassic, ReplayState{}, []Event{
				{T: playedMs, Lane: 1, Judgement: JudgementWrong},
			})
			if err != nil {
				t.Fatalf("%d 小时终止事件应可记录: %v", hours, err)
			}
			result, err := FinalizeReplayState(chart, ModeClassic, state,
				ClientResult{Status: StatusFailed, Score: 0, PlayedMs: playedMs})
			if err != nil {
				t.Fatalf("%d 小时结算失败: %v", hours, err)
			}
			if result.PlayedMs != playedMs || result.Score != 0 {
				t.Fatalf("%d 小时数值被截断或溢出: %+v", hours, result)
			}
		})
	}
}

func TestIncrementalReplayBatchHashIsStableForIdempotentRetry(t *testing.T) {
	events := []Event{
		{T: 10, Lane: 0, Judgement: JudgementHit},
		{T: 40, Lane: 1, Judgement: JudgementHit, HoldBonus: 2},
	}
	if got, want := HashEvents(events), HashEvents(append([]Event(nil), events...)); got != want {
		t.Fatalf("同一批事件重试时 hash 不稳定: got=%q want=%q", got, want)
	}
	changed := append([]Event(nil), events...)
	changed[1].HoldBonus++
	if HashEvents(events) == HashEvents(changed) {
		t.Fatal("不同事件批次不应共享幂等 hash")
	}
}

func TestIncrementalReplayStateStaysBoundedDuringVeryLongRun(t *testing.T) {
	chart := regressionChart(1, 1_000)
	state := ReplayState{}
	const totalEvents = 50_000
	for start := 0; start < totalEvents; start += 500 {
		batch := make([]Event, 0, 500)
		for index := start; index < start+500 && index < totalEvents; index++ {
			batch = append(batch, Event{T: int64(index * 100), Lane: 0, Judgement: JudgementHit})
		}
		var err error
		state, err = AdvanceReplayState(chart, ModeClassic, state, batch)
		if err != nil {
			t.Fatalf("第 %d 批长局事件校验失败: %v", start/500+1, err)
		}
		if len(state.RecentEventTimes) > MaxEventsPerSecond {
			t.Fatalf("最近事件窗口无限增长: %d", len(state.RecentEventTimes))
		}
	}
	if state.EventCount != totalEvents || state.Hits != totalEvents || state.VerifiedScore != totalEvents {
		t.Fatalf("长局摘要计数错误: %+v", state)
	}
	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("序列化长局摘要失败: %v", err)
	}
	if len(raw) > 2_048 {
		t.Fatalf("长局摘要体积应保持有界，实际 %d 字节", len(raw))
	}
}

func TestCheckpointDeltaHonorsOffsetAndRetryWithoutDoubleApplying(t *testing.T) {
	first := []Event{
		{T: 0, Lane: 0, Judgement: JudgementHit},
		{T: 100, Lane: 1, Judgement: JudgementHit},
	}
	second := []Event{{T: 200, Lane: 2, Judgement: JudgementHit}}
	session := Session{
		Replay:    ReplayState{EventCount: int64(len(first))},
		LastBatch: &BatchReceipt{Offset: 0, Count: len(first), Hash: HashEvents(first)},
	}

	// 旧客户端没有 offset 时，上一批响应丢失后重传必须被识别为幂等，
	// 不得再次推进 EventCount。
	delta, offset, duplicate, err := checkpointDelta(session, nil, first)
	if err != nil || !duplicate || len(delta) != 0 || offset != int64(len(first)) {
		t.Fatalf("无 offset 的重复批次未正确幂等: delta=%+v offset=%d duplicate=%v err=%v", delta, offset, duplicate, err)
	}

	// 新客户端带 offset 重传“已确认前缀+尾部”时，只返回尾部增量。
	combined := append(append([]Event(nil), first...), second...)
	delta, offset, duplicate, err = checkpointDelta(session, int64Ptr(0), combined)
	if err != nil || duplicate || offset != int64(len(first)) || len(delta) != 1 || delta[0] != second[0] {
		t.Fatalf("带 offset 的重叠批次解析错误: delta=%+v offset=%d duplicate=%v err=%v", delta, offset, duplicate, err)
	}

	// 前缀被篡改时不能靠 offset 跳过服务端快照。
	badPrefix := append([]Event(nil), combined...)
	badPrefix[0].Lane = 3
	if _, _, _, err := checkpointDelta(session, int64Ptr(0), badPrefix); err == nil {
		t.Fatal("篡改已确认前缀应被拒绝")
	}

	// 即使客户端谎称 offset 已经是 current，重复上一批的相同事件也不能
	// 被当成新命中再次计分。
	delta, offset, duplicate, err = checkpointDelta(session, int64Ptr(int64(len(first))), first)
	if err != nil || !duplicate || len(delta) != 0 || offset != int64(len(first)) {
		t.Fatalf("current offset 的重复批次未正确幂等: delta=%+v offset=%d duplicate=%v err=%v", delta, offset, duplicate, err)
	}

	// 空 heartbeat 使用当前 offset，允许只续租而不改变重放摘要。
	delta, offset, duplicate, err = checkpointDelta(session, int64Ptr(int64(len(first))), nil)
	if err != nil || duplicate || len(delta) != 0 || offset != int64(len(first)) {
		t.Fatalf("空 heartbeat offset 语义错误: delta=%+v offset=%d duplicate=%v err=%v", delta, offset, duplicate, err)
	}
}

func TestSubmitDeltaRequiresConfirmedPrefixCoverage(t *testing.T) {
	first := []Event{
		{T: 0, Lane: 0, Judgement: JudgementHit},
		{T: 100, Lane: 1, Judgement: JudgementHit},
	}
	tail := []Event{{T: 200, Lane: 2, Judgement: JudgementWrong}}
	session := Session{
		Replay:    ReplayState{EventCount: int64(len(first))},
		LastBatch: &BatchReceipt{Offset: 0, Count: len(first), Hash: HashEvents(first)},
	}

	delta, err := submitDelta(session, int64Ptr(int64(len(first))), tail)
	if err != nil || len(delta) != 1 || delta[0] != tail[0] {
		t.Fatalf("offset 尾批未正确提取: delta=%+v err=%v", delta, err)
	}

	full := append(append([]Event(nil), first...), tail...)
	delta, err = submitDelta(session, int64Ptr(0), full)
	if err != nil || len(delta) != 1 || delta[0] != tail[0] {
		t.Fatalf("全量提交兼容逻辑错误: delta=%+v err=%v", delta, err)
	}
	badPrefix := append([]Event(nil), full...)
	badPrefix[0].Lane = 3
	if _, err := submitDelta(session, int64Ptr(0), badPrefix); err == nil {
		t.Fatal("提交包篡改已确认前缀时应拒绝")
	}

	if _, err := submitDelta(session, int64Ptr(0), tail); err == nil {
		t.Fatal("提交包未覆盖已确认前缀时应拒绝")
	}
	if _, err := submitDelta(session, int64Ptr(-1), full); err == nil {
		t.Fatal("负 eventOffset 应拒绝")
	}
}

func TestEmptyHeartbeatRenewsLeaseForLongPauseAndKeepsAbsoluteCap(t *testing.T) {
	started := time.UnixMilli(0)
	for _, hours := range []int64{1, 2, 10, 24} {
		now := started.Add(time.Duration(hours) * time.Hour)
		expires := time.UnixMilli(sessionExpiry(now, started))
		if !expires.After(now) {
			t.Fatalf("%d 小时 heartbeat 后租期未向未来续期: now=%v expires=%v", hours, now, expires)
		}
		if sessionExpired(Session{StartedAt: started.UnixMilli(), ExpiresAt: expires.UnixMilli()}, now) {
			t.Fatalf("%d 小时 heartbeat 后不应立即过期", hours)
		}
	}

	// 会话存活超过 7 天时，滑动租期不能无限续命。
	oldStarted := time.UnixMilli(0)
	now := oldStarted.Add(6 * 24 * time.Hour)
	expires := time.UnixMilli(sessionExpiry(now, oldStarted))
	wantAbsolute := oldStarted.Add(maxSessionAge)
	if !expires.Equal(wantAbsolute) {
		t.Fatalf("绝对租期上限未生效: got=%v want=%v", expires, wantAbsolute)
	}
	if sessionExpired(Session{StartedAt: oldStarted.UnixMilli(), ExpiresAt: expires.UnixMilli()}, now) {
		t.Fatal("绝对上限前会话不应过期")
	}
	if !sessionExpired(Session{StartedAt: oldStarted.UnixMilli(), ExpiresAt: expires.UnixMilli()}, wantAbsolute.Add(time.Millisecond)) {
		t.Fatal("达到绝对租期后应过期")
	}
}

func TestCurrentSessionChartRejectsChangedOrRemovedChart(t *testing.T) {
	chart := mustChart("101")
	if loaded, ok := currentSessionChart(Session{ChartID: chart.ID, Checksum: chart.Checksum}); !ok || loaded.Checksum != chart.Checksum {
		t.Fatal("当前谱面 checksum 一致的会话应继续有效")
	}
	if _, ok := currentSessionChart(Session{ChartID: chart.ID, Checksum: "deadbeef"}); ok {
		t.Fatal("部署后谱面 checksum 变化时旧会话应失效")
	}
	if _, ok := currentSessionChart(Session{ChartID: "removed-chart", Checksum: chart.Checksum}); ok {
		t.Fatal("谱面下架后旧会话应失效")
	}
}

func TestCanRecoverStartRequiresMatchingEmptySession(t *testing.T) {
	chart := mustChart("101")
	base := Session{
		Status:         StatusPlaying,
		ChartID:        chart.ID,
		Checksum:       chart.Checksum,
		Mode:           ModeClassic,
		StartRequestID: "request-1",
	}
	input := StartInput{
		ChartID:        chart.ID,
		Checksum:       chart.Checksum,
		Mode:           ModeClassic,
		StartRequestID: "request-1",
	}
	if !canRecoverStart(base, input) {
		t.Fatal("同一请求标识、曲目、模式和 checksum 的空 playing 会话应可恢复")
	}

	cases := map[string]func(*Session, *StartInput){
		"空请求标识":       func(session *Session, in *StartInput) { in.StartRequestID = "" },
		"不同请求标识":      func(session *Session, in *StartInput) { in.StartRequestID = "request-2" },
		"不同曲目":        func(session *Session, in *StartInput) { in.ChartID = "102" },
		"不同模式":        func(session *Session, in *StartInput) { in.Mode = ModeRush },
		"不同 checksum": func(session *Session, in *StartInput) { in.Checksum = "deadbeef" },
		"终态会话":        func(session *Session, in *StartInput) { session.Status = StatusFailed },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			session := base
			in := input
			mutate(&session, &in)
			if canRecoverStart(session, in) {
				t.Fatalf("%s 不应恢复", name)
			}
		})
	}
}

func TestCanRecoverStartRejectsAnyConfirmedProgress(t *testing.T) {
	chart := mustChart("101")
	input := StartInput{
		ChartID:        chart.ID,
		Checksum:       chart.Checksum,
		Mode:           ModeClassic,
		StartRequestID: "request-1",
	}
	progressCases := map[string]func(*Session){
		"事件计数":   func(session *Session) { session.Replay.EventCount = 1 },
		"命中数":    func(session *Session) { session.Replay.Hits = 1 },
		"已验证分数":  func(session *Session) { session.Replay.VerifiedScore = 1 },
		"长按命中数":  func(session *Session) { session.Replay.HoldHits = 1 },
		"事件标记":   func(session *Session) { session.Replay.HasEvents = true },
		"最后事件时间": func(session *Session) { session.Replay.LastEventT = 1 },
		"命中标记":   func(session *Session) { session.Replay.HasHits = true },
		"最后命中时间": func(session *Session) { session.Replay.LastHitT = 1 },
		"终止判定":   func(session *Session) { session.Replay.Terminal = JudgementWrong },
		"最近事件窗口": func(session *Session) { session.Replay.RecentEventTimes = []int64{1} },
		"上一批摘要":  func(session *Session) { session.LastBatch = &BatchReceipt{Count: 1, Hash: "hash"} },
	}
	for name, markProgress := range progressCases {
		t.Run(name, func(t *testing.T) {
			session := Session{
				Status:         StatusPlaying,
				ChartID:        chart.ID,
				Checksum:       chart.Checksum,
				Mode:           ModeClassic,
				StartRequestID: "request-1",
			}
			markProgress(&session)
			if canRecoverStart(session, input) {
				t.Fatalf("存在%s证据时不应恢复", name)
			}
		})
	}
}

func int64Ptr(value int64) *int64 { return &value }
