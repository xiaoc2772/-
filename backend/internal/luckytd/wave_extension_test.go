package luckytd

import "testing"

func TestWaveExtensionConfigAndTraitCurve(t *testing.T) {
	data, err := GetEngineData()
	if err != nil {
		t.Fatal(err)
	}
	for _, gameMap := range data.Config.Maps {
		if len(gameMap.Waves) != 30 || len(gameMap.WaveHpPermyriad) != 30 {
			t.Fatalf("map %s should contain 30 waves, got waves=%d hp=%d", gameMap.ID, len(gameMap.Waves), len(gameMap.WaveHpPermyriad))
		}
		for index := 2; index < 30; index++ {
			currentIncrement := gameMap.WaveHpPermyriad[index] - gameMap.WaveHpPermyriad[index-1]
			previousIncrement := gameMap.WaveHpPermyriad[index-1] - gameMap.WaveHpPermyriad[index-2]
			if currentIncrement != previousIncrement+40 {
				t.Fatalf("map %s wave %d increment mismatch: got %d want %d", gameMap.ID, index+1, currentIncrement, previousIncrement+40)
			}
		}
	}
	checks := map[int]int{1: 0, 4: 1, 7: 2, 10: 3, 13: 4, 15: 4, 16: 4, 18: 5, 21: 6, 24: 7, 27: 8, 30: 9}
	for wave, want := range checks {
		if got := waveTraitTier(wave); got != want {
			t.Fatalf("wave %d trait tier mismatch: got %d want %d", wave, got, want)
		}
	}
}

func TestWaveExtensionCanReachWave30Victory(t *testing.T) {
	data, err := GetEngineData()
	if err != nil {
		t.Fatal(err)
	}
	state, err := InitState("wave-extension-terminal", "training_field", []string{"vanguard"})
	if err != nil {
		t.Fatal(err)
	}
	seq := 0
	for guard := 0; state.Status == StatusPlaying; guard++ {
		if guard >= data.Config.Engine.MaxFrames+1000 {
			t.Fatal("30 wave simulation exceeded safety guard")
		}
		if state.PendingBlessing != nil {
			result := ApplyAction(state, GameAction{
				Frame:    state.Frame,
				Seq:      seq,
				Type:     "bless",
				Blessing: waveIntPtr(state.PendingBlessing.Options[0]),
			})
			if !result.OK {
				t.Fatalf("blessing rejected: %s", result.Message)
			}
			seq++
			continue
		}
		Tick(state)
		for index := range state.Enemies {
			state.Enemies[index].HP = 0
		}
	}
	if state.Status != StatusWon || state.WaveIndex != 30 || len(state.WaveHashes) != 30 {
		t.Fatalf("unexpected terminal state: status=%d wave=%d hashes=%d", state.Status, state.WaveIndex, len(state.WaveHashes))
	}
}

func waveIntPtr(value int) *int {
	return &value
}
