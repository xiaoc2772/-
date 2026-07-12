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
