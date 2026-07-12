package rankings

type gameDefinition struct {
	dbName  string
	apiName string
}

var supportedGames = []gameDefinition{
	{dbName: "linkgame", apiName: "linkgame"},
	{dbName: "match3", apiName: "match3"},
	{dbName: "memory", apiName: "memory"},
	{dbName: "whack_mole", apiName: "whack_mole"},
	{dbName: "roguelite", apiName: "roguelite"},
	{dbName: "minesweeper", apiName: "minesweeper"},
	{dbName: "game_2048", apiName: "game_2048"},
	{dbName: "lucky_td", apiName: "lucky_td"},
}

func difficultyOptions(game gameDefinition) []GameDifficultyOption {
	switch game.dbName {
	case "linkgame", "memory", "whack_mole", "minesweeper":
		return []GameDifficultyOption{
			{Value: "easy", Label: "简单"},
			{Value: "normal", Label: "普通"},
			{Value: "hard", Label: "困难"},
		}
	case "lucky_td":
		return []GameDifficultyOption{
			{Value: "training_field", Label: "晨光训练场"},
			{Value: "brook_ford", Label: "溪桥缓坡"},
			{Value: "starlamp_outpost", Label: "星灯前哨"},
			{Value: "frostfire_fault", Label: "霜熔断层"},
			{Value: "rubblemist_plateau", Label: "碎雾高原"},
			{Value: "thundervoid_gate", Label: "雷空风门"},
		}
	default:
		return nil
	}
}

func allDifficultyLabel(game gameDefinition) string {
	if game.dbName == "lucky_td" {
		return "全部地图"
	}
	return "全部难度"
}
