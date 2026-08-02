package pianotiles

import "testing"

func TestDifficultyStarsMatchesManifestDensityRules(t *testing.T) {
	tests := []struct {
		name     string
		notes    int
		duration int64
		want     int
	}{
		{name: "one star", notes: 14, duration: 10_000, want: 1},
		{name: "two stars boundary", notes: 15, duration: 10_000, want: 2},
		{name: "three stars boundary", notes: 25, duration: 10_000, want: 3},
		{name: "four stars boundary", notes: 35, duration: 10_000, want: 4},
		{name: "five stars boundary", notes: 50, duration: 10_000, want: 5},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			chart := ChartSummary{DurationMs: test.duration, UnitMs: 200, Notes: make([]ChartNote, test.notes)}
			if got := DifficultyStars(chart); got != test.want {
				t.Fatalf("DifficultyStars() = %d, want %d", got, test.want)
			}
		})
	}
}

func TestNormalizedPerformanceClassicUsesFullLapScore(t *testing.T) {
	chart := ChartSummary{
		DurationMs: 10_000,
		UnitMs:     200,
		Notes: []ChartNote{
			{T: 0, Lane: 0, Duration: 200},
			{T: 1_000, Lane: 1, Duration: 400},
		},
	}
	// 第二块 d=400 >= 1.75*200 为长按：满圈分 = 2 次命中 + 划满奖励 2。
	if got := MaxLapScore(chart); got != 2+HoldBonusMax {
		t.Fatalf("MaxLapScore() = %d, want %d", got, 2+HoldBonusMax)
	}
	if got := NormalizedPerformance(chart, ModeClassic, 2+HoldBonusMax); got != PerformanceReference {
		t.Fatalf("one perfect lap = %d, want %d", got, PerformanceReference)
	}
	if got := NormalizedPerformance(chart, ModeClassic, 2*(2+HoldBonusMax)); got != 2*PerformanceReference {
		t.Fatalf("two perfect laps = %d, want %d", got, 2*PerformanceReference)
	}
}

func TestNormalizedPerformanceRushUsesSixtySecondReference(t *testing.T) {
	chart := ChartSummary{
		DurationMs: 30_000,
		UnitMs:     200,
		Notes: []ChartNote{
			{T: 0, Lane: 0, Duration: 200},
			{T: 15_000, Lane: 1, Duration: 200},
		},
	}
	if got := RushReferenceScore(chart); got != 4 {
		t.Fatalf("RushReferenceScore() = %d, want 4", got)
	}
	if got := NormalizedPerformance(chart, ModeRush, 4); got != PerformanceReference {
		t.Fatalf("rush reference score = %d, want %d", got, PerformanceReference)
	}
}

func TestRushReferenceScoreCountsPartialHoldProgress(t *testing.T) {
	chart := ChartSummary{
		DurationMs: 70_000,
		UnitMs:     1_000,
		Notes: []ChartNote{
			{T: 0, Lane: 0, Duration: 1_000},
			{T: 59_000, Lane: 1, Duration: 2_000},
		},
	}
	// 60 秒截止时长按只划过一半（1000/2000）：按进度阶梯折算奖励 1，
	// 参考分 = 2 次命中 + 1。
	if got := RushReferenceScore(chart); got != 3 {
		t.Fatalf("RushReferenceScore() = %d, want 3", got)
	}
}
