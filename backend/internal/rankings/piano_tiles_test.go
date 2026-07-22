package rankings

import (
	"testing"
	"time"

	"redemption/backend/internal/pianotiles"
)

func TestParsePianoBoardKey(t *testing.T) {
	tests := []struct {
		value string
		mode  pianotiles.Mode
		stars int
		ok    bool
	}{
		{value: "classic", mode: pianotiles.ModeClassic, stars: 0, ok: true},
		{value: "classic:3", mode: pianotiles.ModeClassic, stars: 3, ok: true},
		{value: "rush:5", mode: pianotiles.ModeRush, stars: 5, ok: true},
		{value: "classic:0", ok: false},
		{value: "rush:6", ok: false},
		{value: "all", ok: false},
	}
	for _, test := range tests {
		mode, ok := parsePianoBoardKey(test.value)
		if ok != test.ok || (ok && (mode.Mode != test.mode || mode.Stars != test.stars)) {
			t.Fatalf("parsePianoBoardKey(%q) = %+v, %v; want mode=%q stars=%d ok=%v", test.value, mode, ok, test.mode, test.stars, test.ok)
		}
	}
}

func TestPianoTilesBoardsNormalizeAcrossSongs(t *testing.T) {
	charts := map[string]pianotiles.ChartSummary{
		"long": {
			DurationMs: 10_000,
			UnitMs:     200,
			Notes:      make([]pianotiles.ChartNote, 100),
		},
		"short": {
			DurationMs: 10_000,
			UnitMs:     200,
			Notes:      make([]pianotiles.ChartNote, 50),
		},
	}
	users := map[int64]UserEntry{
		1: {UserID: 1, Username: "long-song"},
		2: {UserID: 2, Username: "short-song"},
	}
	when := time.UnixMilli(1_000)
	records := []pianoRankingRecord{
		// 原始分数更高，但只完成长歌一圈（100%）。
		{UserID: 1, Score: 100, Points: 1, ChartID: "long", Mode: pianotiles.ModeClassic, CreatedAt: when},
		// 原始分数更低，却相当于短歌 1.5 圈（150%），应排在第一。
		{UserID: 2, Score: 75, Points: 1, ChartID: "short", Mode: pianotiles.ModeClassic, CreatedAt: when.Add(time.Second)},
	}
	boards := buildPianoTilesLeaderboards(records, users, 10, func(id string) (pianotiles.ChartSummary, bool) {
		chart, ok := charts[id]
		return chart, ok
	})
	rows := boards["classic"]
	if len(rows) != 2 {
		t.Fatalf("classic board length = %d, want 2", len(rows))
	}
	if rows[0].UserID != 2 || rows[0].BestPerformance <= rows[1].BestPerformance {
		t.Fatalf("normalized order is wrong: %+v", rows)
	}
	if rows[1].BestPerformance != pianotiles.PerformanceReference {
		t.Fatalf("long-song performance = %d, want %d", rows[1].BestPerformance, pianotiles.PerformanceReference)
	}
}

func TestPianoTilesBoardsFilterModeAndStars(t *testing.T) {
	charts := map[string]pianotiles.ChartSummary{
		"one": {
			DurationMs: 10_000,
			UnitMs:     200,
			Notes:      make([]pianotiles.ChartNote, 10),
		},
		"five": {
			DurationMs: 10_000,
			UnitMs:     200,
			Notes:      make([]pianotiles.ChartNote, 60),
		},
	}
	users := map[int64]UserEntry{
		1: {UserID: 1, Username: "classic-one"},
		2: {UserID: 2, Username: "rush-five"},
	}
	records := []pianoRankingRecord{
		{UserID: 1, Score: 10, Points: 1, ChartID: "one", Mode: pianotiles.ModeClassic},
		{UserID: 2, Score: 10, Points: 1, ChartID: "five", Mode: pianotiles.ModeRush},
	}
	boards := buildPianoTilesLeaderboards(records, users, 10, func(id string) (pianotiles.ChartSummary, bool) {
		chart, ok := charts[id]
		return chart, ok
	})
	if len(boards["classic:1"]) != 1 || boards["classic:1"][0].UserID != 1 {
		t.Fatalf("classic:1 board = %+v", boards["classic:1"])
	}
	if len(boards["rush:5"]) != 1 || boards["rush:5"][0].UserID != 2 {
		t.Fatalf("rush:5 board = %+v", boards["rush:5"])
	}
	if len(boards["classic:5"]) != 0 || len(boards["rush:1"]) != 0 {
		t.Fatalf("mode/star filters leaked records: classic:5=%+v rush:1=%+v", boards["classic:5"], boards["rush:1"])
	}
}

func TestPianoTilesBoardsSkipRecordsWithoutChartMetadata(t *testing.T) {
	users := map[int64]UserEntry{1: {UserID: 1, Username: "legacy"}}
	records := []pianoRankingRecord{{UserID: 1, Score: 999, Mode: pianotiles.ModeClassic}}
	boards := buildPianoTilesLeaderboards(records, users, 10, func(string) (pianotiles.ChartSummary, bool) {
		return pianotiles.ChartSummary{}, false
	})
	if len(boards["classic"]) != 0 {
		t.Fatalf("metadata-less legacy record leaked into fair board: %+v", boards["classic"])
	}
}
