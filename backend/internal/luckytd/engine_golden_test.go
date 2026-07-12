package luckytd

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// 黄金向量与 TS 侧共用同一批 fixtures，schema 见 docs/lucky-td-engine-spec.md §10。
type goldenExpect struct {
	Status       int      `json:"status"`
	Frames       int      `json:"frames"`
	WavesCleared int      `json:"wavesCleared"`
	Score        int      `json:"score"`
	FinalHash    uint32   `json:"finalHash"`
	WaveHashes   []uint32 `json:"waveHashes"`
}

type goldenVector struct {
	Name    string       `json:"name"`
	Seed    string       `json:"seed"`
	MapID   string       `json:"mapId"`
	Squad   []string     `json:"squad"`
	Actions []GameAction `json:"actions"`
	Expect  goldenExpect `json:"expect"`
}

func loadVectors(t *testing.T, filename string) []goldenVector {
	t.Helper()
	path := filepath.Join("..", "..", "..", "src", "lib", "lucky-td", "__fixtures__", "golden", filename)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读取向量文件 %s 失败: %v", filename, err)
	}
	var vectors []goldenVector
	if err := json.Unmarshal(raw, &vectors); err != nil {
		t.Fatalf("解析向量文件 %s 失败: %v", filename, err)
	}
	if len(vectors) == 0 {
		t.Fatalf("向量文件 %s 为空", filename)
	}
	return vectors
}

func assertVector(t *testing.T, vector goldenVector) {
	t.Helper()
	out := Replay(ReplayInput{
		Seed:    vector.Seed,
		MapID:   vector.MapID,
		Squad:   vector.Squad,
		Actions: vector.Actions,
	})
	if !out.OK {
		t.Fatalf("回放失败: %s", out.Error)
	}
	result := out.Result
	expect := vector.Expect
	if result.Status != expect.Status || result.Frames != expect.Frames ||
		result.WavesCleared != expect.WavesCleared || result.Score != expect.Score {
		t.Fatalf("终局结果不符: got status=%d frames=%d waves=%d score=%d, want status=%d frames=%d waves=%d score=%d",
			result.Status, result.Frames, result.WavesCleared, result.Score,
			expect.Status, expect.Frames, expect.WavesCleared, expect.Score)
	}
	if got := HashState(out.State); got != expect.FinalHash {
		t.Fatalf("最终哈希不符: got %d, want %d", got, expect.FinalHash)
	}
	if len(out.State.WaveHashes) != len(expect.WaveHashes) {
		t.Fatalf("波哈希数量不符: got %d, want %d", len(out.State.WaveHashes), len(expect.WaveHashes))
	}
	for i := range expect.WaveHashes {
		if out.State.WaveHashes[i] != expect.WaveHashes[i] {
			t.Fatalf("第 %d 波哈希不符: got %d, want %d", i+1, out.State.WaveHashes[i], expect.WaveHashes[i])
		}
	}
}

func TestGoldenVectors(t *testing.T) {
	for _, vector := range loadVectors(t, "golden.json") {
		t.Run(vector.Name, func(t *testing.T) {
			assertVector(t, vector)
		})
	}
}

func TestFuzzVectors(t *testing.T) {
	for _, vector := range loadVectors(t, "fuzz.json") {
		t.Run(vector.Name, func(t *testing.T) {
			assertVector(t, vector)
		})
	}
}

func TestTrainingAnchorReplayDuration(t *testing.T) {
	vectors := loadVectors(t, "golden.json")
	var target *goldenVector
	for i := range vectors {
		if vectors[i].Name == "training-anchor" {
			target = &vectors[i]
			break
		}
	}
	if target == nil {
		t.Fatal("缺少 training-anchor 向量")
	}
	// 预热配置装载，只对模拟本身计时。
	if _, err := GetEngineData(); err != nil {
		t.Fatalf("加载配置失败: %v", err)
	}
	start := time.Now()
	out := Replay(ReplayInput{
		Seed:    target.Seed,
		MapID:   target.MapID,
		Squad:   target.Squad,
		Actions: target.Actions,
	})
	elapsed := time.Since(start)
	if !out.OK {
		t.Fatalf("回放失败: %s", out.Error)
	}
	t.Logf("training-anchor 单局重放耗时: %s", elapsed)
	if elapsed >= time.Second {
		t.Fatalf("重放耗时 %s 超过 1s 上限", elapsed)
	}
}
