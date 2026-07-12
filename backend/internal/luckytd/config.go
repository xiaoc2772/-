// 幸运塔防配置装载与地图预计算。契约见 docs/lucky-td-engine-spec.md §3。
// 语义与 TS 参考实现（src/lib/lucky-td/engine/data.ts）完全一致；
// 内嵌配置与前端 src/lib/lucky-td/config/lucky-td-config.json 字节一致，禁止改动。
// 预计算结果只做只读查询；map 集合仅用于成员判定，逻辑代码禁止依赖其遍历顺序。

package luckytd

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
)

//go:embed config/lucky-td-config.json
var rawConfigBytes []byte

// PathCell 为路径途经格；CenterProgress 为该格中心的累计 progress（重复途经取首次）。
type PathCell struct {
	Row            int
	Col            int
	Key            int
	CenterProgress int
}

// PathWaypoint 为拐点 milli 坐标与累计 progress。
type PathWaypoint struct {
	X   int
	Y   int
	Cum int
}

// PrecomputedPath 的 Cells 按 CenterProgress 升序存放（逐格展开顺序天然递增）。
type PrecomputedPath struct {
	Cells       []PathCell
	Waypoints   []PathWaypoint
	LengthMilli int
	SpawnKey    int
	ExitKey     int
}

type PrecomputedMap struct {
	Cfg           *MapConfig
	Paths         []PrecomputedPath
	FlightPaths   []PrecomputedPath
	MeleeCells    map[int]struct{}
	RangedCells   map[int]struct{}
	MechanicCells map[string]map[int]struct{}
}

type EngineData struct {
	Config       *LuckyTdConfig
	Maps         []PrecomputedMap
	MapIDToIdx   map[string]int
	UnitIDToIdx  map[string]int
	CoinEnemyIdx int
	// UnitRangeSets[typeIdx][dir] → 旋转后相对偏移键集合（键 = offsetKey）。
	UnitRangeSets [][]map[int]struct{}
	// UnitRangeLevelSets[typeIdx][level-1][dir] → 技能等级成长后的攻击/治疗范围集合。
	UnitRangeLevelSets [][][]map[int]struct{}
	// AuraSets[typeIdx] → 光环相对偏移键集合（无方向）。
	AuraSets []map[int]struct{}
	// AuraLevelSets[typeIdx][level-1] → 技能等级成长后的光环范围集合。
	AuraLevelSets [][]map[int]struct{}
}

func cellKey(row, col int) int {
	return row*1000 + col
}

// offsetKey 相对偏移键。域约束：|dCol| < 50（模板偏移 ≤12、地图 cols ≤13），无碰撞。
func offsetKey(dRow, dCol int) int {
	return dRow*100 + dCol
}

// rotateOffset 朝右（dir=0）基准偏移顺时针旋转 dir 次，每次 (dr,dc)→(dc,−dr)。契约见规格 §7.2/§12.14。
func rotateOffset(dRow, dCol, dir int) (int, int) {
	dr, dc := dRow, dCol
	for k := 0; k < dir&3; k++ {
		dr, dc = dc, -dr
	}
	return dr, dc
}

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func expandCells(cells [][]int, radius int, dir int) map[int]struct{} {
	set := make(map[int]struct{}, len(cells)*(radius*radius+1))
	for _, cell := range cells {
		baseRow, baseCol := cell[0], cell[1]
		if dir >= 0 {
			baseRow, baseCol = rotateOffset(baseRow, baseCol, dir)
		}
		for er := -radius; er <= radius; er++ {
			horizontal := radius - absInt(er)
			for ec := -horizontal; ec <= horizontal; ec++ {
				set[offsetKey(baseRow+er, baseCol+ec)] = struct{}{}
			}
		}
	}
	return set
}

// expandForwardCells 仅向朝右基准的左、右、前方扩展，最后再整体旋转到部署朝向。
func expandForwardCells(cells [][]int, stages, dir int) map[int]struct{} {
	current := make(map[int]struct{}, len(cells))
	for _, cell := range cells {
		current[offsetKey(cell[0], cell[1])] = struct{}{}
	}
	for stage := 0; stage < stages; stage++ {
		next := make(map[int]struct{}, len(current)*3)
		for key := range current {
			next[key] = struct{}{}
			dr, dc := decodeOffsetKey(key)
			next[offsetKey(dr-1, dc)] = struct{}{}
			next[offsetKey(dr+1, dc)] = struct{}{}
			next[offsetKey(dr, dc+1)] = struct{}{}
		}
		current = next
	}
	rotated := make(map[int]struct{}, len(current))
	for key := range current {
		dr, dc := decodeOffsetKey(key)
		row, col := rotateOffset(dr, dc, dir)
		rotated[offsetKey(row, col)] = struct{}{}
	}
	return rotated
}

func decodeOffsetKey(key int) (int, int) {
	dr := key / 100
	dc := key % 100
	if dc > 50 {
		dr++
		dc -= 100
	} else if dc < -50 {
		dr--
		dc += 100
	}
	return dr, dc
}

func signInt(v int) int {
	if v > 0 {
		return 1
	}
	if v < 0 {
		return -1
	}
	return 0
}

func buildPath(points [][]int, rows, cols int) (PrecomputedPath, error) {
	if len(points) < 2 {
		return PrecomputedPath{}, errors.New("lucky-td config: path needs at least 2 waypoints")
	}
	var cells []PathCell
	seen := make(map[int]struct{})
	var waypoints []PathWaypoint
	cum := 0
	pushCell := func(row, col, progress int) error {
		if row < 0 || row >= rows || col < 0 || col >= cols {
			return fmt.Errorf("lucky-td config: path cell out of bounds (%d,%d)", row, col)
		}
		key := cellKey(row, col)
		if _, exists := seen[key]; !exists {
			seen[key] = struct{}{}
			cells = append(cells, PathCell{Row: row, Col: col, Key: key, CenterProgress: progress})
		}
		return nil
	}
	for i := range points {
		if len(points[i]) != 2 {
			return PrecomputedPath{}, errors.New("lucky-td config: malformed path point")
		}
		row, col := points[i][0], points[i][1]
		waypoints = append(waypoints, PathWaypoint{X: col*1000 + 500, Y: row*1000 + 500, Cum: cum})
		if i == 0 {
			if err := pushCell(row, col, 0); err != nil {
				return PrecomputedPath{}, err
			}
			continue
		}
		prevRow, prevCol := points[i-1][0], points[i-1][1]
		if prevRow != row && prevCol != col {
			return PrecomputedPath{}, errors.New("lucky-td config: path segment must be axis-aligned")
		}
		steps := absInt(prevRow-row) + absInt(prevCol-col)
		dRow := signInt(row - prevRow)
		dCol := signInt(col - prevCol)
		for s := 1; s <= steps; s++ {
			cum += 1000
			if err := pushCell(prevRow+dRow*s, prevCol+dCol*s, cum); err != nil {
				return PrecomputedPath{}, err
			}
		}
		waypoints[len(waypoints)-1].Cum = cum
	}
	return PrecomputedPath{
		Cells:       cells,
		Waypoints:   waypoints,
		LengthMilli: cum,
		SpawnKey:    cellKey(points[0][0], points[0][1]),
		ExitKey:     cellKey(points[len(points)-1][0], points[len(points)-1][1]),
	}, nil
}

func buildMap(cfg *MapConfig, unitCount, enemyCount int) (PrecomputedMap, error) {
	paths := make([]PrecomputedPath, 0, len(cfg.Paths))
	for _, points := range cfg.Paths {
		path, err := buildPath(points, cfg.Rows, cfg.Cols)
		if err != nil {
			return PrecomputedMap{}, err
		}
		paths = append(paths, path)
	}
	flightPathPoints := cfg.FlightPaths
	if len(flightPathPoints) == 0 {
		flightPathPoints = cfg.Paths
	}
	flightPaths := make([]PrecomputedPath, 0, len(flightPathPoints))
	for _, points := range flightPathPoints {
		path, err := buildPath(points, cfg.Rows, cfg.Cols)
		if err != nil {
			return PrecomputedMap{}, err
		}
		flightPaths = append(flightPaths, path)
	}
	// 近战位 = 所有路径途经格并集 − 每条路径的出生格与终点格；远程位为显式列表。
	meleeCells := make(map[int]struct{})
	for i := range paths {
		for _, cell := range paths[i].Cells {
			meleeCells[cell.Key] = struct{}{}
		}
	}
	for i := range paths {
		delete(meleeCells, paths[i].SpawnKey)
		delete(meleeCells, paths[i].ExitKey)
	}
	rangedCells := make(map[int]struct{})
	for _, rc := range cfg.RangedCells {
		if len(rc) != 2 {
			return PrecomputedMap{}, errors.New("lucky-td config: malformed ranged cell")
		}
		row, col := rc[0], rc[1]
		if row < 0 || row >= cfg.Rows || col < 0 || col >= cfg.Cols {
			return PrecomputedMap{}, fmt.Errorf("lucky-td config: ranged cell out of bounds (%d,%d)", row, col)
		}
		key := cellKey(row, col)
		if _, ok := meleeCells[key]; ok {
			return PrecomputedMap{}, fmt.Errorf("lucky-td config: ranged cell overlaps path (%d,%d)", row, col)
		}
		rangedCells[key] = struct{}{}
	}
	mechanicCells := make(map[string]map[int]struct{}, len(cfg.Mechanics))
	for _, mechanic := range cfg.Mechanics {
		set := make(map[int]struct{}, len(mechanic.Cells))
		for _, cell := range mechanic.Cells {
			if len(cell) != 2 {
				return PrecomputedMap{}, errors.New("lucky-td config: malformed mechanic cell")
			}
			row, col := cell[0], cell[1]
			if row < 0 || row >= cfg.Rows || col < 0 || col >= cfg.Cols {
				return PrecomputedMap{}, fmt.Errorf("lucky-td config: mechanic %s cell out of bounds (%d,%d)", mechanic.ID, row, col)
			}
			set[cellKey(row, col)] = struct{}{}
		}
		mechanicCells[mechanic.ID] = set
	}
	if len(cfg.WaveHpPermyriad) != len(cfg.Waves) {
		return PrecomputedMap{}, fmt.Errorf("lucky-td config: map %s waveHp length mismatch", cfg.ID)
	}
	for waveIdx, wave := range cfg.Waves {
		for _, event := range wave {
			if len(event) != 5 {
				return PrecomputedMap{}, fmt.Errorf("lucky-td config: map %s wave %d malformed event", cfg.ID, waveIdx+1)
			}
			delay, enemyIdx, pathIdx, count, interval := event[0], event[1], event[2], event[3], event[4]
			if delay < 0 || enemyIdx < 0 || enemyIdx >= enemyCount || pathIdx < 0 || pathIdx >= len(paths) || count < 1 || interval < 1 {
				return PrecomputedMap{}, fmt.Errorf("lucky-td config: map %s wave %d invalid event values", cfg.ID, waveIdx+1)
			}
		}
	}
	if unitCount < 1 {
		return PrecomputedMap{}, errors.New("lucky-td config: no units")
	}
	return PrecomputedMap{Cfg: cfg, Paths: paths, FlightPaths: flightPaths, MeleeCells: meleeCells, RangedCells: rangedCells, MechanicCells: mechanicCells}, nil
}

var (
	engineDataOnce  sync.Once
	engineDataValue *EngineData
	engineDataErr   error
)

// GetEngineData 解析并校验内嵌配置，完成地图预计算；结果进程内只计算一次。
func GetEngineData() (*EngineData, error) {
	engineDataOnce.Do(func() {
		engineDataValue, engineDataErr = loadEngineData()
	})
	return engineDataValue, engineDataErr
}

func loadEngineData() (*EngineData, error) {
	config := &LuckyTdConfig{}
	if err := json.Unmarshal(rawConfigBytes, config); err != nil {
		return nil, fmt.Errorf("lucky-td config: 解析内嵌配置失败: %w", err)
	}
	if len(config.Units) < 8 || len(config.Enemies) < 7 || len(config.Blessings) < 6 {
		return nil, errors.New("lucky-td config: units/enemies/blessings count mismatch")
	}
	if len(activeSkills) < len(config.Units) {
		return nil, errors.New("lucky-td config: active skills count mismatch")
	}
	maps := make([]PrecomputedMap, 0, len(config.Maps))
	for i := range config.Maps {
		precomputed, err := buildMap(&config.Maps[i], len(config.Units), len(config.Enemies))
		if err != nil {
			return nil, err
		}
		maps = append(maps, precomputed)
	}
	mapIDToIdx := make(map[string]int, len(config.Maps))
	for i := range config.Maps {
		mapIDToIdx[config.Maps[i].ID] = i
	}
	unitIDToIdx := make(map[string]int, len(config.Units))
	for i := range config.Units {
		unitIDToIdx[config.Units[i].ID] = i
	}
	coinEnemyIdx := -1
	for i := range config.Enemies {
		if config.Enemies[i].ID == "coin" {
			coinEnemyIdx = i
			break
		}
	}
	if coinEnemyIdx < 0 {
		return nil, errors.New("lucky-td config: coin enemy missing")
	}
	validateCells := func(unitID, field string, cells [][]int) error {
		for _, cell := range cells {
			if len(cell) != 2 || absInt(cell[0]) > 12 || absInt(cell[1]) > 12 {
				return fmt.Errorf("lucky-td config: unit %s %s invalid offset", unitID, field)
			}
		}
		return nil
	}
	unitRangeLevelSets := make([][][]map[int]struct{}, len(config.Units))
	auraLevelSets := make([][]map[int]struct{}, len(config.Units))
	for i := range config.Units {
		unit := &config.Units[i]
		if err := validateCells(unit.ID, "rangeCells", unit.RangeCells); err != nil {
			return nil, err
		}
		if unit.AtkType != "none" && len(unit.RangeCells) == 0 {
			return nil, fmt.Errorf("lucky-td config: unit %s rangeCells empty", unit.ID)
		}
		levelSets := make([][]map[int]struct{}, activeSkillMaxLevel)
		symmetricRange := unit.AtkType == "heal" || len(unit.AuraCells) > 0
		for level := 1; level <= activeSkillMaxLevel; level++ {
			sets := make([]map[int]struct{}, 4)
			for dir := 0; dir < 4; dir++ {
				if symmetricRange {
					sets[dir] = expandCells(unit.RangeCells, skillLevelRangeRadius(level), dir)
				} else {
					sets[dir] = expandForwardCells(unit.RangeCells, skillLevelRangeRadius(level), dir)
				}
			}
			levelSets[level-1] = sets
		}
		unitRangeLevelSets[i] = levelSets
		if err := validateCells(unit.ID, "auraCells", unit.AuraCells); err != nil {
			return nil, err
		}
		auraSets := make([]map[int]struct{}, activeSkillMaxLevel)
		for level := 1; level <= activeSkillMaxLevel; level++ {
			auraSets[level-1] = expandCells(unit.AuraCells, skillLevelRangeRadius(level), -1)
		}
		auraLevelSets[i] = auraSets
	}
	unitRangeSets := make([][]map[int]struct{}, len(unitRangeLevelSets))
	for i := range unitRangeLevelSets {
		unitRangeSets[i] = unitRangeLevelSets[i][0]
	}
	auraSets := make([]map[int]struct{}, len(auraLevelSets))
	for i := range auraLevelSets {
		auraSets[i] = auraLevelSets[i][0]
	}
	return &EngineData{
		Config:             config,
		Maps:               maps,
		MapIDToIdx:         mapIDToIdx,
		UnitIDToIdx:        unitIDToIdx,
		CoinEnemyIdx:       coinEnemyIdx,
		UnitRangeSets:      unitRangeSets,
		UnitRangeLevelSets: unitRangeLevelSets,
		AuraSets:           auraSets,
		AuraLevelSets:      auraLevelSets,
	}, nil
}

// positionOnPath 沿路径按 progress 求 milli 坐标（线性走拐点段，两端实现必须一致）。
func positionOnPath(path *PrecomputedPath, progress int) (int, int) {
	clamped := progress
	if clamped < 0 {
		clamped = 0
	} else if clamped > path.LengthMilli {
		clamped = path.LengthMilli
	}
	waypoints := path.Waypoints
	for i := len(waypoints) - 1; i >= 0; i-- {
		wp := waypoints[i]
		if clamped < wp.Cum {
			continue
		}
		if i == len(waypoints)-1 {
			return wp.X, wp.Y
		}
		next := waypoints[i+1]
		span := next.Cum - wp.Cum
		offset := clamped - wp.Cum
		if span == 0 {
			return wp.X, wp.Y
		}
		dx := signInt(next.X - wp.X)
		dy := signInt(next.Y - wp.Y)
		return wp.X + dx*offset, wp.Y + dy*offset
	}
	return waypoints[0].X, waypoints[0].Y
}
