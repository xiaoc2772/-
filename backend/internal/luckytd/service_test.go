package luckytd

import (
	"context"
	"strings"
	"testing"
	"time"

	"redemption/backend/internal/auth"
)

func TestBuildRecordAppliesLuckyTdWinLine(t *testing.T) {
	session := Session{ID: "session", UserID: 1, MapID: "training_field", Squad: []string{"vanguard"}}
	now := time.Unix(0, 0)
	win := buildRecord(session, GameResult{Status: 1, WavesCleared: 30, Score: 600}, 600, 600, 10000, 0, 1000, 600, 0, now)
	if !win.Won {
		t.Fatal("通关 30 波且达到 600 分应计为胜利")
	}
	lowScore := buildRecord(session, GameResult{Status: 1, WavesCleared: 30, Score: 599}, 599, 599, 10000, 0, 1000, 599, 0, now)
	if lowScore.Won {
		t.Fatal("未达到 600 分不应计为胜利")
	}
	incomplete := buildRecord(session, GameResult{Status: 2, WavesCleared: 29, Score: 800}, 800, 800, 10000, 0, 1000, 800, 0, now)
	if incomplete.Won {
		t.Fatal("未通关 30 波即使达到分数线也不应计为胜利")
	}
}

func testUser() auth.User {
	return auth.User{ID: 1001, Username: "luckytd-test", DisplayName: "Lucky TD Test"}
}

func TestServiceNilDatabase(t *testing.T) {
	service := NewService(nil)
	user := testUser()
	ctx := context.Background()

	if _, err := service.Status(ctx, user); err != ErrUnavailable {
		t.Fatalf("expected unavailable on status, got %v", err)
	}
	if _, err := service.Start(ctx, user, StartInput{}); err != ErrUnavailable {
		t.Fatalf("expected unavailable on start, got %v", err)
	}
	if _, err := service.Checkpoint(ctx, user, CheckpointInput{}); err != ErrUnavailable {
		t.Fatalf("expected unavailable on checkpoint, got %v", err)
	}
	if _, err := service.Submit(ctx, user, SubmitInput{}); err != ErrUnavailable {
		t.Fatalf("expected unavailable on submit, got %v", err)
	}
	if _, err := service.Cancel(ctx, user, CancelInput{}); err != ErrUnavailable {
		t.Fatalf("expected unavailable on cancel, got %v", err)
	}
}

func TestAppendActionDeltaValidatesFrameSeqAndType(t *testing.T) {
	current := []GameAction{{Frame: 10, Seq: 1, Type: "deploy"}}

	if _, err := appendActionDelta(current, []GameAction{{Frame: 11, Seq: 3, Type: "retreat"}, {Frame: 11, Seq: 2, Type: "retreat"}}, 20); err == nil || !strings.Contains(err.Error(), "严格递增") {
		t.Fatalf("expected strict ordering error, got %v", err)
	}
	if _, err := appendActionDelta(current, []GameAction{{Frame: 11, Seq: -1, Type: "retreat"}}, 20); err == nil || !strings.Contains(err.Error(), "序号非法") {
		t.Fatalf("expected illegal sequence error, got %v", err)
	}
	if _, err := appendActionDelta(current, []GameAction{{Frame: 21, Seq: 2, Type: "retreat"}}, 20); err == nil || !strings.Contains(err.Error(), "操作帧非法") {
		t.Fatalf("expected illegal frame error, got %v", err)
	}
	if _, err := appendActionDelta(current, []GameAction{{Frame: 11, Seq: 2, Type: "skill"}, {Frame: 12, Seq: 3, Type: "skillUpgrade"}}, 20); err != nil {
		t.Fatalf("expected active skill actions to be accepted, got %v", err)
	}
	if _, err := appendActionDelta(current, []GameAction{{Frame: 11, Seq: 2, Type: "bad"}}, 20); err == nil || !strings.Contains(err.Error(), "未知操作") {
		t.Fatalf("expected unknown action error, got %v", err)
	}
}

func TestAppendActionDeltaCopiesInput(t *testing.T) {
	current := []GameAction{{Frame: 1, Seq: 1, Type: "deploy"}}
	next, err := appendActionDelta(current, []GameAction{{Frame: 2, Seq: 2, Type: "retreat"}}, 10)
	if err != nil {
		t.Fatalf("append action delta failed: %v", err)
	}
	if len(next) != 2 || len(current) != 1 {
		t.Fatalf("unexpected action lengths: next=%d current=%d", len(next), len(current))
	}
	next[0].Type = "bless"
	if current[0].Type != "deploy" {
		t.Fatalf("appendActionDelta should not alias the current slice")
	}
}

func TestAuditPaceRejectsFastFinalAndCheckpoint(t *testing.T) {
	data, err := GetEngineData()
	if err != nil {
		t.Fatalf("load engine data failed: %v", err)
	}
	frame := data.Config.Engine.Fps * 120

	if err := auditPace(Session{StartedAt: 100_000}, frame, 1_000); err == nil || !strings.Contains(err.Error(), "游戏时长过短") {
		t.Fatalf("expected minimum duration error, got %v", err)
	}

	session := Session{
		StartedAt: 100_000,
		Checkpoints: []Checkpoint{{
			WaveIndex:        1,
			Frame:            frame,
			StateHash:        1,
			ServerReceivedAt: 101_000,
		}},
	}
	if err := auditPace(session, frame, 70_000); err == nil || !strings.Contains(err.Error(), "checkpoint 完成速度异常") {
		t.Fatalf("expected checkpoint pace error, got %v", err)
	}
}

func TestAuditPaceAcceptsExpectedSpeed(t *testing.T) {
	data, err := GetEngineData()
	if err != nil {
		t.Fatalf("load engine data failed: %v", err)
	}
	frame := data.Config.Engine.Fps * 120
	session := Session{
		StartedAt: 100_000,
		Checkpoints: []Checkpoint{{
			WaveIndex:        1,
			Frame:            frame,
			StateHash:        1,
			ServerReceivedAt: 160_000,
		}},
	}
	if err := auditPace(session, frame, 70_000); err != nil {
		t.Fatalf("expected pace audit to pass, got %v", err)
	}
}

func TestValidateSessionConfigVersion(t *testing.T) {
	data, err := GetEngineData()
	if err != nil {
		t.Fatalf("load engine data failed: %v", err)
	}
	if err := validateSessionConfigVersion(Session{ConfigVersion: data.Config.Version}); err != nil {
		t.Fatalf("current config version should pass, got %v", err)
	}
	if err := validateSessionConfigVersion(Session{ConfigVersion: data.Config.Version + 1}); err == nil || err.Error() != configChangedMessageCN {
		t.Fatalf("expected config changed error, got %v", err)
	}
}

func TestSquadRewardBonus(t *testing.T) {
	cases := []struct {
		squadSize int
		bonus     int
		reward    int64
	}{
		{squadSize: 9, bonus: 10000, reward: 100},
		{squadSize: 6, bonus: 12400, reward: 124},
		{squadSize: 1, bonus: 16400, reward: 164},
		{squadSize: 0, bonus: 16400, reward: 164},
		{squadSize: 12, bonus: 10000, reward: 100},
	}
	for _, testCase := range cases {
		if got := SquadBonusPermyriad(testCase.squadSize); got != testCase.bonus {
			t.Fatalf("squadSize=%d bonus got %d want %d", testCase.squadSize, got, testCase.bonus)
		}
		if got := PointRewardForScore(100, testCase.squadSize); got != testCase.reward {
			t.Fatalf("squadSize=%d reward got %d want %d", testCase.squadSize, got, testCase.reward)
		}
	}
	if got := PointRewardForScore(-1, 1); got != 0 {
		t.Fatalf("negative score reward should be 0, got %d", got)
	}
}

func TestBuildSessionViewCopiesMutableSlices(t *testing.T) {
	session := Session{
		ID:                  "session-1",
		Seed:                "seed-1",
		MapID:               "training_field",
		Squad:               []string{"vanguard"},
		Actions:             []GameAction{{Frame: 1, Seq: 1, Type: "deploy"}},
		LastCheckpointFrame: 30,
		ExpiresAt:           200,
	}
	view := BuildSessionView(session)
	if view.SessionID != session.ID || view.Seed != session.Seed || view.Frame != 30 || view.ExpiresAt != 200 {
		t.Fatalf("unexpected session view: %+v", view)
	}
	view.Squad[0] = "defender"
	view.Actions[0].Type = "retreat"
	if session.Squad[0] != "vanguard" || session.Actions[0].Type != "deploy" {
		t.Fatalf("session view should copy mutable slices")
	}
}

func intPtr(value int) *int {
	return &value
}

func TestAppendActionDeltaSkipsExactReplayedPrefix(t *testing.T) {
	current := []GameAction{
		{Frame: 10, Seq: 1, Type: "deploy", Unit: intPtr(0), Row: intPtr(3), Col: intPtr(4), Dir: intPtr(2)},
		{Frame: 20, Seq: 2, Type: "retreat", UnitID: intPtr(1)},
	}

	next, err := appendActionDelta(current, []GameAction{current[1], {Frame: 30, Seq: 3, Type: "bless", Blessing: intPtr(1)}}, 40)
	if err != nil {
		t.Fatalf("expected replayed prefix to be skipped, got %v", err)
	}
	if len(next) != 3 || next[2].Frame != 30 {
		t.Fatalf("unexpected merged actions: %+v", next)
	}

	same, err := appendActionDelta(current, append([]GameAction(nil), current...), 40)
	if err != nil {
		t.Fatalf("expected full duplicate delta to be accepted, got %v", err)
	}
	if len(same) != len(current) {
		t.Fatalf("full duplicate delta should not grow actions: %+v", same)
	}
}

func TestAppendActionDeltaRejectsMismatchedReplayedPrefix(t *testing.T) {
	current := []GameAction{{Frame: 10, Seq: 1, Type: "deploy", Unit: intPtr(0), Dir: intPtr(0)}}

	if _, err := appendActionDelta(current, []GameAction{{Frame: 10, Seq: 1, Type: "retreat"}}, 40); err == nil || !strings.Contains(err.Error(), "不一致") {
		t.Fatalf("expected mismatched type to be rejected, got %v", err)
	}
	if _, err := appendActionDelta(current, []GameAction{{Frame: 10, Seq: 1, Type: "deploy", Unit: intPtr(2), Dir: intPtr(0)}}, 40); err == nil || !strings.Contains(err.Error(), "不一致") {
		t.Fatalf("expected mismatched unit to be rejected, got %v", err)
	}
	if _, err := appendActionDelta(current, []GameAction{{Frame: 10, Seq: 1, Type: "deploy", Unit: intPtr(0), Dir: intPtr(1)}}, 40); err == nil || !strings.Contains(err.Error(), "不一致") {
		t.Fatalf("expected mismatched dir to be rejected, got %v", err)
	}
	if _, err := appendActionDelta(current, []GameAction{{Frame: 5, Seq: 1, Type: "deploy"}, {Frame: 10, Seq: 1, Type: "deploy", Unit: intPtr(0), Dir: intPtr(0)}}, 40); err == nil || !strings.Contains(err.Error(), "不一致") {
		t.Fatalf("expected overlap longer than stored history to be rejected, got %v", err)
	}
}

func TestAuditPaceAllowsFastDefeat(t *testing.T) {
	if err := auditPace(Session{StartedAt: 100_000}, 630, 10_500); err != nil {
		t.Fatalf("fast defeat above minimum duration should pass, got %v", err)
	}
	if err := auditPace(Session{StartedAt: 100_000}, 630, 9_000); err == nil || !strings.Contains(err.Error(), "游戏时长过短") {
		t.Fatalf("expected minimum duration rejection, got %v", err)
	}
}

func TestSessionWindowSupportsFiveHourPlay(t *testing.T) {
	if sessionTTLSeconds < int64(5*time.Hour/time.Second) {
		t.Fatalf("session TTL must cover five-hour play, got %s", time.Duration(sessionTTLSeconds)*time.Second)
	}
	record := buildRecord(
		Session{UserID: 1, ID: "long-session", MapID: "training_field", Squad: []string{"vanguard"}},
		GameResult{Status: StatusLost, Frames: 90000},
		0, 0, 10000, 0, int64(5*time.Hour/time.Millisecond), 0, 0, time.Now(),
	)
	if record.DurationMs != int64(5*time.Hour/time.Millisecond) {
		t.Fatalf("five-hour duration should be retained, got %d", record.DurationMs)
	}
}
