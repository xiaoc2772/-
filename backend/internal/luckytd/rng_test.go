package luckytd

import "testing"

func TestXorshift32Seed1(t *testing.T) {
	if got := xorshift32(1); got != 270369 {
		t.Fatalf("xorshift32(1) = %d, want 270369", got)
	}
}

func TestFnv1a32EmptyString(t *testing.T) {
	if got := fnv1a32String(""); got != 0x811c9dc5 {
		t.Fatalf(`fnv1a32("") = %#x, want 0x811c9dc5`, got)
	}
}

func TestFnv1a32LetterA(t *testing.T) {
	if got := fnv1a32String("a"); got != 0xe40c292c {
		t.Fatalf(`fnv1a32("a") = %#x, want 0xe40c292c`, got)
	}
}

func TestTickTimeoutSetsLost(t *testing.T) {
	data, err := GetEngineData()
	if err != nil {
		t.Fatalf("加载配置失败: %v", err)
	}
	state, err := InitState("timeout-seed", "training_field", []string{"vanguard"})
	if err != nil {
		t.Fatalf("初始化失败: %v", err)
	}
	state.Frame = data.Config.Engine.MaxFrames - 1
	if !Tick(state) {
		t.Fatal("超时帧的 tick 应返回 true")
	}
	if state.Status != StatusLost {
		t.Fatalf("status = %d, want %d (lost)", state.Status, StatusLost)
	}
}
