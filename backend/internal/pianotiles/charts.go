package pianotiles

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

var checksumPattern = regexp.MustCompile(`^[0-9a-f]{8}$`)

// ChartNote 只保留服务端核分需要的时间、轨道和时值。
type ChartNote struct {
	T        int64
	Lane     int
	Duration int64
}

type ChartSummary struct {
	ID         string
	Checksum   string
	DurationMs int64
	UnitMs     int64
	Notes      []ChartNote
}

type embeddedChartSummary struct {
	Checksum   string     `json:"checksum"`
	DurationMs int64      `json:"durationMs"`
	UnitMs     int64      `json:"unitMs"`
	Notes      [][3]int64 `json:"notes"`
}

//go:embed charts_summary.json
var chartsSummaryJSON []byte

var chartSummaries = mustLoadChartSummaries(chartsSummaryJSON)

func IsChecksum(value string) bool {
	return checksumPattern.MatchString(strings.ToLower(strings.TrimSpace(value)))
}

func ChartSummaryFor(chartID string) (ChartSummary, bool) {
	summary, ok := chartSummaries[strings.TrimSpace(chartID)]
	if !ok {
		return ChartSummary{}, false
	}
	summary.Notes = append([]ChartNote(nil), summary.Notes...)
	return summary, true
}

func ChartCount() int {
	return len(chartSummaries)
}

func ChartIDs() []string {
	ids := make([]string, 0, len(chartSummaries))
	for id := range chartSummaries {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func mustLoadChartSummaries(raw []byte) map[string]ChartSummary {
	var embedded map[string]embeddedChartSummary
	if err := json.Unmarshal(raw, &embedded); err != nil {
		panic(fmt.Sprintf("解析钢琴块谱面摘要失败: %v", err))
	}
	if len(embedded) == 0 {
		panic("钢琴块谱面摘要为空")
	}

	result := make(map[string]ChartSummary, len(embedded))
	for id, source := range embedded {
		id = strings.TrimSpace(id)
		checksum := strings.ToLower(strings.TrimSpace(source.Checksum))
		if id == "" || !IsChecksum(checksum) || source.DurationMs <= 0 || len(source.Notes) == 0 {
			panic(fmt.Sprintf("钢琴块谱面摘要无效: chartId=%q", id))
		}
		unitMs := source.UnitMs
		if unitMs < 120 || unitMs > 1000 {
			panic(fmt.Sprintf("钢琴块谱面单位时长无效: chartId=%q unitMs=%d", id, unitMs))
		}
		notes := make([]ChartNote, 0, len(source.Notes))
		lastTime := int64(-1)
		hasUnitNote := false
		for index, tuple := range source.Notes {
			note := ChartNote{T: tuple[0], Lane: int(tuple[1]), Duration: tuple[2]}
			if note.T < 0 || note.T < lastTime || note.Lane < 0 || note.Lane > 3 || note.Duration <= 0 || note.Duration%unitMs != 0 {
				panic(fmt.Sprintf("钢琴块谱面音块无效: chartId=%q note=%d", id, index))
			}
			notes = append(notes, note)
			if note.Duration == unitMs {
				hasUnitNote = true
			}
			lastTime = note.T
		}
		if !hasUnitNote {
			panic(fmt.Sprintf("钢琴块谱面缺少单位音块: chartId=%q", id))
		}
		result[id] = ChartSummary{
			ID:         id,
			Checksum:   checksum,
			DurationMs: source.DurationMs,
			UnitMs:     unitMs,
			Notes:      notes,
		}
	}
	return result
}
