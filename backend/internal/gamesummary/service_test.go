package gamesummary

import (
	"encoding/json"
	"testing"
)

func TestSummarizeGameRowsMatchesWinRules(t *testing.T) {
	memoryWin, _ := json.Marshal(map[string]any{"completed": true})
	memoryLoss, _ := json.Marshal(map[string]any{"completed": false})
	memoryProgress := summarizeGameRows([]gameRecordRow{
		{Score: 10, PointsEarned: 1, Payload: memoryWin},
		{Score: 20, PointsEarned: 2, Payload: memoryWin},
		{Score: 30, PointsEarned: 3, Payload: memoryLoss},
		{Score: 40, PointsEarned: 4, Payload: memoryWin},
	}, "memory")
	if memoryProgress.TotalPlays != 4 || memoryProgress.Wins != 3 || memoryProgress.BestWinStreak != 2 {
		t.Fatalf("unexpected memory progress: %+v", memoryProgress)
	}
	if memoryProgress.BestScore != 40 || memoryProgress.TotalPointsEarned != 10 {
		t.Fatalf("unexpected memory score summary: %+v", memoryProgress)
	}

	match3Progress := summarizeGameRows([]gameRecordRow{
		{Score: 1199},
		{Score: 1200},
		{Score: 1500},
	}, "match3")
	if match3Progress.Wins != 2 || match3Progress.BestWinStreak != 2 {
		t.Fatalf("unexpected match3 progress: %+v", match3Progress)
	}

	whackProgress := summarizeGameRows([]gameRecordRow{
		{Difficulty: "easy", Score: 799},
		{Difficulty: "easy", Score: 800},
		{Difficulty: "hard", Score: 1499},
		{Difficulty: "hard", Score: 1500},
	}, "whack_mole")
	if whackProgress.Wins != 2 || whackProgress.BestWinStreak != 1 {
		t.Fatalf("unexpected whack mole progress: %+v", whackProgress)
	}

	game2048Progress := summarizeGameRows([]gameRecordRow{
		{Score: 20000, PointsEarned: 96},
		{Score: 19999, PointsEarned: 40},
	}, "game_2048")
	if game2048Progress.Wins != 1 || game2048Progress.BestWinStreak != 1 {
		t.Fatalf("unexpected 2048 progress: %+v", game2048Progress)
	}
	if game2048Progress.BestScore != 20000 || game2048Progress.TotalPointsEarned != 136 {
		t.Fatalf("unexpected 2048 score summary: %+v", game2048Progress)
	}

	luckyWin, _ := json.Marshal(map[string]any{"won": true, "status": 1, "wavesCleared": 30})
	luckyLegacyWin, _ := json.Marshal(map[string]any{"status": 1, "wavesCleared": 30})
	luckyLoss, _ := json.Marshal(map[string]any{"won": false, "status": 2, "wavesCleared": 29})
	luckyProgress := summarizeGameRows([]gameRecordRow{
		{Score: 600, Payload: luckyWin},
		{Score: 700, Payload: luckyLegacyWin},
		{Score: 800, Payload: luckyLoss},
	}, "lucky_td")
	if luckyProgress.Wins != 2 || luckyProgress.BestWinStreak != 2 {
		t.Fatalf("unexpected lucky td progress: %+v", luckyProgress)
	}
}

func TestToAPIKeyNormalizesWhackMole(t *testing.T) {
	if got := toAPIKey("whack_mole"); got != "whack-mole" {
		t.Fatalf("expected whack-mole, got %s", got)
	}
	if got := toAPIKey("memory"); got != "memory" {
		t.Fatalf("expected memory, got %s", got)
	}
	if got := toAPIKey("game_2048"); got != "2048" {
		t.Fatalf("expected 2048, got %s", got)
	}
}
