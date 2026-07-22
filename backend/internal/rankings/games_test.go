package rankings

import "testing"

func TestSupportedGamesIncludesGame2048(t *testing.T) {
	for _, game := range supportedGames {
		if game.dbName == "game_2048" && game.apiName == "game_2048" {
			return
		}
	}
	t.Fatal("supportedGames should include game_2048")
}

func TestSupportedGamesIncludesLuckyTD(t *testing.T) {
	for _, game := range supportedGames {
		if game.dbName == "lucky_td" && game.apiName == "lucky_td" {
			return
		}
	}
	t.Fatal("supportedGames should include lucky_td")
}

func TestSupportedGamesIncludesPianoTilesModeAndStarBoards(t *testing.T) {
	game := gameDefinition{dbName: "piano_tiles", apiName: "piano-tiles"}
	found := false
	for _, candidate := range supportedGames {
		if candidate == game {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("supportedGames should include piano-tiles")
	}
	want := []GameDifficultyOption{
		{Value: "classic", Label: "经典 · 全星级"},
		{Value: "classic:1", Label: "经典 · 1星"},
		{Value: "classic:2", Label: "经典 · 2星"},
		{Value: "classic:3", Label: "经典 · 3星"},
		{Value: "classic:4", Label: "经典 · 4星"},
		{Value: "classic:5", Label: "经典 · 5星"},
		{Value: "rush", Label: "冲刺 · 全星级"},
		{Value: "rush:1", Label: "冲刺 · 1星"},
		{Value: "rush:2", Label: "冲刺 · 2星"},
		{Value: "rush:3", Label: "冲刺 · 3星"},
		{Value: "rush:4", Label: "冲刺 · 4星"},
		{Value: "rush:5", Label: "冲刺 · 5星"},
	}
	got := difficultyOptions(game)
	if len(got) != len(want) {
		t.Fatalf("unexpected piano tiles board count: got=%d want=%d", len(got), len(want))
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("unexpected piano tiles mode at %d: got=%+v want=%+v", index, got[index], want[index])
		}
	}
	if label := allDifficultyLabel(game); label != "全部模式" {
		t.Fatalf("unexpected piano tiles aggregate label: %q", label)
	}
}

func TestLuckyTDUsesMapOptions(t *testing.T) {
	game := gameDefinition{dbName: "lucky_td", apiName: "lucky_td"}
	want := []GameDifficultyOption{
		{Value: "training_field", Label: "晨光训练场"},
		{Value: "brook_ford", Label: "溪桥缓坡"},
		{Value: "starlamp_outpost", Label: "星灯前哨"},
		{Value: "frostfire_fault", Label: "霜熔断层"},
		{Value: "rubblemist_plateau", Label: "碎雾高原"},
		{Value: "thundervoid_gate", Label: "雷空风门"},
	}
	got := difficultyOptions(game)
	if len(got) != len(want) {
		t.Fatalf("unexpected lucky_td map option count: got=%d want=%d", len(got), len(want))
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("unexpected lucky_td map option at %d: got=%+v want=%+v", index, got[index], want[index])
		}
	}
	if label := allDifficultyLabel(game); label != "全部地图" {
		t.Fatalf("unexpected lucky_td aggregate label: %q", label)
	}
	if label := allDifficultyLabel(gameDefinition{dbName: "memory", apiName: "memory"}); label != "全部难度" {
		t.Fatalf("difficulty games should keep aggregate label, got %q", label)
	}
}
