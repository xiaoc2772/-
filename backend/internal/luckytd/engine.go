// 幸运塔防确定性引擎（Go 实现）。契约见 docs/lucky-td-engine-spec.md §4~§9、§12。
// 必须与 TS 参考实现（src/lib/lucky-td/engine/engine.ts）逐位一致：
// tick 各阶段顺序、RNG 消耗次序、实体数组序（即 id 升序）、哈希字段序均不可改动。
// 本文件是性能豁免区——引擎对 state 就地修改，外部消费方不得共享引用。

package luckytd

import (
	"errors"
	"fmt"
	"slices"
)

func mustEngineData() *EngineData {
	data, err := GetEngineData()
	if err != nil {
		panic(fmt.Errorf("luckytd: 内嵌配置非法: %w", err))
	}
	return data
}

// pm 计算 floor(value×permyriad/10000)；契约保证两参数非负，Go 整除即向下取整。
func pm(value, permyriad int) int {
	return value * permyriad / 10000
}

func mapCostRegenPermyriad(data *EngineData, mapIdx int) int {
	value := 10000
	for _, mechanic := range data.Maps[mapIdx].Cfg.Mechanics {
		if mechanic.CostRegenPermyriad > 0 {
			value = pm(value, mechanic.CostRegenPermyriad)
		}
	}
	return value
}

func mechanicAppliesToUnit(data *EngineData, state *GameState, mechanic *MapMechanicConfig, unit *UnitState) bool {
	if len(mechanic.Cells) == 0 {
		return true
	}
	key := cellKey(unit.Row, unit.Col)
	_, ok := data.Maps[state.MapIdx].MechanicCells[mechanic.ID][key]
	return ok
}

func mechanicAppliesToEnemy(data *EngineData, state *GameState, mechanic *MapMechanicConfig, enemy *EnemyState) bool {
	set := data.Maps[state.MapIdx].MechanicCells[mechanic.ID]
	if len(set) == 0 {
		return true
	}
	x, y := enemyPosition(data, state, enemy)
	_, ok := set[cellKey(y/1000, x/1000)]
	return ok
}

func unitHazardDamagePerSecond(data *EngineData, state *GameState, unit *UnitState) int {
	damage := 0
	for i := range data.Maps[state.MapIdx].Cfg.Mechanics {
		mechanic := &data.Maps[state.MapIdx].Cfg.Mechanics[i]
		if mechanic.UnitDamagePerSecond <= 0 {
			continue
		}
		if mechanicAppliesToUnit(data, state, mechanic, unit) {
			damage += mechanic.UnitDamagePerSecond
		}
	}
	return damage
}

func skillLevel(state *GameState, typeIdx int) int {
	if typeIdx < 0 || typeIdx >= len(state.ActiveSkillLevels) {
		return 1
	}
	return state.ActiveSkillLevels[typeIdx]
}

func effectiveMaxHP(state *GameState, cfg *UnitConfig, typeIdx int) int {
	bonus := skillLevelHpBonusPermyriad(skillLevel(state, typeIdx))
	if cfg.Block > 0 {
		bonus += state.MeleeHpBonusPm
	}
	return pm(cfg.HP, 10000+bonus)
}

func effectiveAtk(state *GameState, cfg *UnitConfig, typeIdx int) int {
	atk := pm(cfg.Atk, 10000+skillLevelAtkBonusPermyriad(skillLevel(state, typeIdx)))
	if state.RangedAtkBonusPm > 0 && hasTag(cfg, "rangedAtk") {
		atk = pm(atk, 10000+state.RangedAtkBonusPm)
	}
	if cfg.Block == 0 {
		data := mustEngineData()
		for _, mechanic := range data.Maps[state.MapIdx].Cfg.Mechanics {
			if mechanic.RangedAtkPermyriad > 0 {
				atk = pm(atk, mechanic.RangedAtkPermyriad)
			}
		}
	}
	data := mustEngineData()
	for _, mechanic := range data.Maps[state.MapIdx].Cfg.Mechanics {
		multiplier := mechanic.HighGroundUnitAtkPermyriad
		if cfg.Block > 0 {
			multiplier = mechanic.GroundUnitAtkPermyriad
		}
		if multiplier > 0 {
			atk = pm(atk, multiplier)
		}
	}
	return atk
}

func effectiveUnitDef(data *EngineData, state *GameState, unit *UnitState) int {
	cfg := &data.Config.Units[unit.TypeIdx]
	value := cfg.Def
	if cfg.Skill != nil && cfg.Skill.Kind == "shield" && unit.SkillActive > 0 {
		value = pm(value, cfg.Skill.Permyriad)
	}
	for i := range data.Maps[state.MapIdx].Cfg.Mechanics {
		mechanic := &data.Maps[state.MapIdx].Cfg.Mechanics[i]
		if cfg.Block > 0 && mechanic.GroundUnitDefPermyriad > 0 {
			value = pm(value, mechanic.GroundUnitDefPermyriad)
		}
		if mechanic.CellUnitDefPermyriad > 0 && mechanicAppliesToUnit(data, state, mechanic, unit) {
			value = pm(value, mechanic.CellUnitDefPermyriad)
		}
	}
	return value
}

func effectiveInterval(state *GameState, cfg *UnitConfig, typeIdx int) int {
	speedBonus := skillLevelSpeedBonusPermyriad(skillLevel(state, typeIdx))
	return max(6, cfg.Interval*10000/(10000+speedBonus))
}

func effectiveEnemyDef(data *EngineData, state *GameState, enemy *EnemyState) int {
	value := enemy.Def
	for i := range data.Maps[state.MapIdx].Cfg.Mechanics {
		mechanic := &data.Maps[state.MapIdx].Cfg.Mechanics[i]
		if mechanic.CellEnemyDefPermyriad > 0 && mechanicAppliesToEnemy(data, state, mechanic, enemy) {
			value = pm(value, mechanic.CellEnemyDefPermyriad)
		}
	}
	return value
}

func effectiveRangeSet(data *EngineData, state *GameState, unit *UnitState) map[int]struct{} {
	return data.UnitRangeLevelSets[unit.TypeIdx][skillLevel(state, unit.TypeIdx)-1][unit.Dir]
}

func effectiveAuraSet(data *EngineData, state *GameState, unit *UnitState) map[int]struct{} {
	return data.AuraLevelSets[unit.TypeIdx][skillLevel(state, unit.TypeIdx)-1]
}

func nextUint32(state *GameState) uint32 {
	state.RngState = xorshift32(state.RngState)
	return state.RngState
}

func nextInt(state *GameState, n int) int {
	return int(nextUint32(state) % uint32(n))
}

var waveThreatBudgetTable = []int{5, 8, 12, 17, 23, 31, 41, 53, 68, 85, 105, 128, 154, 183, 216}

const (
	legacyWaveCount      = 15
	legacyMaxTraitTier   = 4
	extendedMaxTraitTier = 9
)

const wavePathPreviewLeadFrames = 60

type weightedEnemyEntry struct {
	TypeIdx int
	Weight  int
}

func enemyIdx(data *EngineData, id string) int {
	for i := range data.Config.Enemies {
		if data.Config.Enemies[i].ID == id {
			return i
		}
	}
	return -1
}

func enemyID(data *EngineData, typeIdx int) string {
	if typeIdx < 0 || typeIdx >= len(data.Config.Enemies) {
		return ""
	}
	return data.Config.Enemies[typeIdx].ID
}

func isFlyingEnemy(data *EngineData, typeIdx int) bool {
	return typeIdx >= 0 && typeIdx < len(data.Config.Enemies) && data.Config.Enemies[typeIdx].Flying
}

func pathListForEnemyType(data *EngineData, m *PrecomputedMap, typeIdx int) []PrecomputedPath {
	paths := m.Paths
	if isFlyingEnemy(data, typeIdx) {
		paths = m.FlightPaths
	}
	if len(paths) == 0 {
		return m.Paths
	}
	return paths
}

func pathForEnemyType(data *EngineData, m *PrecomputedMap, typeIdx, pathIdx int) *PrecomputedPath {
	paths := pathListForEnemyType(data, m, typeIdx)
	idx := 0
	if len(paths) > 0 {
		idx = max(0, pathIdx%len(paths))
	}
	return &paths[idx]
}

func enemyPath(data *EngineData, state *GameState, enemy *EnemyState) *PrecomputedPath {
	return pathForEnemyType(data, &data.Maps[state.MapIdx], enemy.TypeIdx, enemy.PathIdx)
}

func randomPathForEnemy(data *EngineData, state *GameState, m *PrecomputedMap, typeIdx int) int {
	return nextInt(state, len(pathListForEnemyType(data, m, typeIdx)))
}

func unitCanHitEnemy(data *EngineData, unitCfg *UnitConfig, enemy *EnemyState) bool {
	return !(unitCfg.Block > 0 && isFlyingEnemy(data, enemy.TypeIdx))
}

func waveTraitTier(waveIndex int) int {
	if waveIndex <= legacyWaveCount {
		return min(legacyMaxTraitTier, (waveIndex-1)*5/(legacyWaveCount-1))
	}
	extendedTier := legacyMaxTraitTier + (waveIndex-legacyWaveCount)*5/legacyWaveCount
	return min(extendedMaxTraitTier, extendedTier)
}

func weightedEnemyPick(state *GameState, entries []weightedEnemyEntry) int {
	total := 0
	for _, entry := range entries {
		total += entry.Weight
	}
	roll := nextInt(state, total)
	for _, entry := range entries {
		if roll < entry.Weight {
			return entry.TypeIdx
		}
		roll -= entry.Weight
	}
	return entries[len(entries)-1].TypeIdx
}

func randomEnemyTypeForWave(data *EngineData, state *GameState) int {
	wave := state.WaveIndex
	grunt := enemyIdx(data, "grunt")
	wolf := enemyIdx(data, "wolf")
	golem := enemyIdx(data, "golem")
	puppet := enemyIdx(data, "puppet")
	boss := enemyIdx(data, "boss")
	drone := enemyIdx(data, "drone")
	shooter := enemyIdx(data, "shooter")
	entries := make([]weightedEnemyEntry, 0, 7)
	add := func(typeIdx, weight int) {
		if typeIdx >= 0 && weight > 0 {
			entries = append(entries, weightedEnemyEntry{TypeIdx: typeIdx, Weight: weight})
		}
	}
	switch {
	case wave <= 1:
		add(grunt, 100)
	case wave <= 3:
		add(grunt, 62)
		add(wolf, 38)
	case wave <= 5:
		add(grunt, 36)
		add(wolf, 30)
		add(golem, 16)
		add(puppet, 11)
		add(drone, 16)
	case wave <= 8:
		add(grunt, 20)
		add(wolf, 25)
		add(golem, 25)
		add(puppet, 21)
		add(drone, 23)
		add(shooter, 10)
	case wave <= 11:
		add(grunt, 12)
		add(wolf, 22)
		add(golem, 26)
		add(puppet, 24)
		add(drone, 24)
		add(boss, 9)
		add(shooter, 14)
	case wave <= 14:
		add(grunt, 8)
		add(wolf, 19)
		add(golem, 28)
		add(puppet, 26)
		add(drone, 25)
		add(boss, 16)
		add(shooter, 16)
	default:
		add(grunt, 5)
		add(wolf, 16)
		add(golem, 30)
		add(puppet, 28)
		add(drone, 26)
		add(boss, 24)
		add(shooter, 18)
	}
	if len(entries) == 0 {
		entries = append(entries, weightedEnemyEntry{TypeIdx: 0, Weight: 1})
	}
	return weightedEnemyPick(state, entries)
}

func enemyThreatCost(data *EngineData, typeIdx int) int {
	switch enemyID(data, typeIdx) {
	case "boss":
		return 18
	case "golem":
		return 6
	case "puppet":
		return 5
	case "shooter":
		return 5
	case "drone":
		return 4
	case "wolf":
		return 2
	default:
		return 1
	}
}

func maxEventCountForEnemy(data *EngineData, typeIdx, waveIndex int) int {
	switch enemyID(data, typeIdx) {
	case "boss":
		return 1 + min(2, max(0, (waveIndex-10)/3))
	case "golem", "puppet", "shooter":
		return 2 + min(5, max(0, (waveIndex-4)/3))
	case "drone":
		return 3 + min(7, waveIndex/3)
	case "wolf":
		return 3 + min(8, waveIndex/3)
	default:
		return 5 + min(12, waveIndex*9/10)
	}
}

func eventIntervalForEnemy(data *EngineData, state *GameState, typeIdx int) int {
	wave := state.WaveIndex
	base := 42
	switch enemyID(data, typeIdx) {
	case "boss":
		base = 64
	case "golem":
		base = 48
	case "puppet":
		base = 42
	case "drone":
		base = 32
	case "wolf":
		base = 28
	default:
		base = 40
	}
	return max(12, base-wave*6/5+nextInt(state, 9))
}

func waveThreatBudget(state *GameState) int {
	wave := state.WaveIndex
	base := 0
	if wave-1 >= 0 && wave-1 < len(waveThreatBudgetTable) {
		base = waveThreatBudgetTable[wave-1]
	} else {
		base = waveThreatBudgetTable[len(waveThreatBudgetTable)-1] + (wave-len(waveThreatBudgetTable))*24
	}
	growth := max(0, wave-1)*2 + wave*wave/18
	return base + growth + nextInt(state, max(2, base/4))
}

func waveGroupCount(state *GameState, pathCount int) int {
	wave := state.WaveIndex
	if wave <= 2 {
		return 1
	}
	base := 1 + (wave-1)/2
	laneBonus := min(3, max(0, pathCount-1))
	spread := min(4, max(1, wave/3))
	return min(12, base+laneBonus+nextInt(state, spread+1))
}

func buildRandomWaveEvents(data *EngineData, state *GameState) [][]int {
	m := &data.Maps[state.MapIdx]
	totalWaves := len(m.Cfg.Waves)
	groupCount := waveGroupCount(state, max(len(m.Paths), len(m.FlightPaths)))
	budget := waveThreatBudget(state)
	delay := wavePathPreviewLeadFrames + nextInt(state, max(1, 24-min(16, state.WaveIndex)))
	events := make([][]int, 0, groupCount+1)
	for group := 0; group < groupCount; group++ {
		typeIdx := randomEnemyTypeForWave(data, state)
		cost := enemyThreatCost(data, typeIdx)
		groupsLeft := groupCount - group
		plannedBudget := max(cost, (budget+groupsLeft-1)/groupsLeft)
		maxCount := max(1, min(maxEventCountForEnemy(data, typeIdx, state.WaveIndex), plannedBudget/cost+2))
		minCount := max(1, min(maxCount, plannedBudget/(cost*2)))
		count := minCount + nextInt(state, maxCount-minCount+1)
		interval := eventIntervalForEnemy(data, state, typeIdx)
		for spawn := 0; spawn < count; spawn++ {
			events = append(events, []int{delay + spawn*interval, typeIdx, randomPathForEnemy(data, state, m, typeIdx), 1, interval})
		}
		budget = max(0, budget-count*cost)
		delay += max(18, 70-state.WaveIndex*3) + nextInt(state, 28)
	}
	boss := enemyIdx(data, "boss")
	bossCount := 0
	for _, event := range events {
		if event[1] == boss {
			bossCount += event[3]
		}
	}
	if boss >= 0 && state.WaveIndex >= 10 && bossCount == 0 {
		count := 1
		if state.WaveIndex == legacyWaveCount || state.WaveIndex >= totalWaves {
			count = 2
		}
		bossDelay := 80 + nextInt(state, 120)
		bossInterval := max(45, 70-state.WaveIndex)
		for spawn := 0; spawn < count; spawn++ {
			events = append(events, []int{bossDelay + spawn*bossInterval, boss, randomPathForEnemy(data, state, m, boss), 1, bossInterval})
		}
	}
	return events
}

func enemyHpPermyriad(data *EngineData, typeIdx, waveIndex, tier int) int {
	if typeIdx == data.CoinEnemyIdx {
		return 10000
	}
	value := 8700 + max(0, waveIndex-4)*240 + tier*240
	if waveIndex <= 1 {
		value = 7000
	} else if waveIndex == 2 {
		value = 8000
	}
	switch enemyID(data, typeIdx) {
	case "boss":
		value += 450 + tier*200
	case "golem":
		value += 260 + tier*120
	case "puppet":
		value += 150 + tier*100
	case "drone":
		value -= 600
	case "wolf":
		value -= 250
	}
	return value
}

func enemyAtkPermyriad(data *EngineData, typeIdx, waveIndex, tier int) int {
	if typeIdx == data.CoinEnemyIdx {
		return 10000
	}
	value := 8500 + max(0, waveIndex-3)*280 + tier*170
	if waveIndex <= 1 {
		value = 6700
	} else if waveIndex == 2 {
		value = 7800
	}
	switch enemyID(data, typeIdx) {
	case "boss":
		value += 400 + tier*150
	case "wolf":
		value += 80
	case "drone":
		value -= 150
	}
	return value
}

func enemySpeedPermyriad(data *EngineData, typeIdx, waveIndex, tier int) int {
	if typeIdx == data.CoinEnemyIdx {
		return 10000
	}
	value := 9500 + max(0, waveIndex-4)*130 + tier*110
	if waveIndex <= 1 {
		value = 8300
	} else if waveIndex == 2 {
		value = 9100
	}
	switch enemyID(data, typeIdx) {
	case "wolf":
		value += 1200 + tier*180
	case "drone":
		value += 600 + tier*120
	case "golem":
		value -= 900
	case "boss":
		value -= 1300
	}
	return max(6000, value)
}

func enemyAttackSpeedPermyriad(data *EngineData, typeIdx, waveIndex, tier int) int {
	if typeIdx == data.CoinEnemyIdx {
		return 10000
	}
	value := 10000 + max(0, waveIndex-5)*160 + tier*130
	switch enemyID(data, typeIdx) {
	case "wolf":
		value += 300
	case "drone":
		value += 180
	case "boss":
		value += 300
	}
	return value
}

func enemyDefValue(data *EngineData, typeIdx, waveIndex, tier int) int {
	cfg := &data.Config.Enemies[typeIdx]
	if typeIdx == data.CoinEnemyIdx {
		return cfg.Def
	}
	value := cfg.Def + max(0, waveIndex-5)*6 + tier*14
	if enemyID(data, typeIdx) == "golem" {
		value += 20 + tier*14
	}
	return value
}

func enemyResValue(data *EngineData, typeIdx, waveIndex, tier int) int {
	cfg := &data.Config.Enemies[typeIdx]
	if typeIdx == data.CoinEnemyIdx {
		return cfg.Res
	}
	value := cfg.Res + max(0, waveIndex-7)*80 + tier*170
	switch enemyID(data, typeIdx) {
	case "puppet":
		value += 350 + tier*160
	case "boss":
		value += 220 + tier*100
	}
	return min(7000, value)
}

func okResult() ActionResult {
	return ActionResult{OK: true}
}

func reject(message string) ActionResult {
	return ActionResult{OK: false, Message: message}
}

// intOrDefault 还原 TS 侧 `action.x ?? fallback` 的缺省语义。
func intOrDefault(value *int, fallback int) int {
	if value == nil {
		return fallback
	}
	return *value
}

func hasTag(cfg *UnitConfig, tag string) bool {
	return slices.Contains(cfg.Tags, tag)
}

func InitState(seed, mapID string, squadIDs []string) (*GameState, error) {
	data, err := GetEngineData()
	if err != nil {
		return nil, err
	}
	mapIdx, found := data.MapIDToIdx[mapID]
	if !found {
		return nil, errors.New("未知地图")
	}
	if len(squadIDs) < 1 || len(squadIDs) > MaxSquadSize {
		return nil, fmt.Errorf("编队人数须为 1~%d", MaxSquadSize)
	}
	squad := make([]int, 0, len(squadIDs))
	for _, unitID := range squadIDs {
		idx, known := data.UnitIDToIdx[unitID]
		if !known {
			return nil, fmt.Errorf("未知单位: %s", unitID)
		}
		if slices.Contains(squad, idx) {
			return nil, fmt.Errorf("编队重复单位: %s", unitID)
		}
		squad = append(squad, idx)
	}
	eng := &data.Config.Engine
	mapRegenPermyriad := mapCostRegenPermyriad(data, mapIdx)
	return &GameState{
		Seed:                  seed,
		RngState:              seedToRngState(seed),
		Frame:                 0,
		Status:                StatusPlaying,
		MapIdx:                mapIdx,
		Squad:                 squad,
		CostMilli:             eng.InitialCostMilli,
		CostAcc:               0,
		Lives:                 eng.InitialLives,
		WaveIndex:             1,
		Phase:                 0,
		IntermissionRemaining: eng.IntermissionFrames,
		WaveFrame:             -1,
		WaveEvents:            nil,
		SpawnCursor:           nil,
		SpawnedInWave:         0,
		CoinPlan:              CoinPlan{},
		PendingBlessing:       nil,
		BlessingsOwned:        0,
		RegenMilliPerSec:      pm(eng.CostRegenMilliPerSec, mapRegenPermyriad),
		MeleeHpBonusPm:        0,
		RangedAtkBonusPm:      0,
		NextWaveDebuffPm:      10000,
		DebuffWave:            0,
		ScoreWaves:            0,
		ScoreKills:            0,
		ScoreLucky:            0,
		UnitSeq:               0,
		EnemySeq:              0,
		Units:                 nil,
		Enemies:               nil,
		RedeployCooldown:      make([]int, len(data.Config.Units)),
		ActiveSkillLevels:     makeActiveSkillLevels(len(data.Config.Units)),
		ActiveSkillCooldown:   make([]int, len(data.Config.Units)),
		WaveHashes:            nil,
	}, nil
}

func makeActiveSkillLevels(count int) []int {
	levels := make([]int, count)
	for i := range levels {
		levels[i] = 1
	}
	return levels
}

func applyDeploy(data *EngineData, state *GameState, action GameAction) ActionResult {
	typeIdx := intOrDefault(action.Unit, -1)
	if typeIdx < 0 || typeIdx >= len(data.Config.Units) {
		return reject("未知单位")
	}
	if !slices.Contains(state.Squad, typeIdx) {
		return reject("单位不在编队中")
	}
	for i := range state.Units {
		if state.Units[i].TypeIdx == typeIdx {
			return reject("该单位已在场上")
		}
	}
	if state.RedeployCooldown[typeIdx] > 0 {
		return reject("再部署冷却中")
	}
	cfg := &data.Config.Units[typeIdx]
	if state.CostMilli < cfg.Cost*1000 {
		return reject("费用不足")
	}
	row := intOrDefault(action.Row, -1)
	col := intOrDefault(action.Col, -1)
	m := &data.Maps[state.MapIdx]
	if row < 0 || row >= m.Cfg.Rows || col < 0 || col >= m.Cfg.Cols {
		return reject("位置越界")
	}
	dir := intOrDefault(action.Dir, -1)
	if dir < 0 || dir > 3 {
		return reject("朝向非法")
	}
	key := cellKey(row, col)
	validCell := false
	if cfg.Block > 0 {
		_, validCell = m.MeleeCells[key]
	} else {
		_, validCell = m.RangedCells[key]
	}
	if !validCell {
		return reject("该格不可部署此单位")
	}
	for i := range state.Units {
		if state.Units[i].Row == row && state.Units[i].Col == col {
			return reject("该格已有单位")
		}
	}
	state.CostMilli -= cfg.Cost * 1000
	maxHP := effectiveMaxHP(state, cfg, typeIdx)
	state.UnitSeq++
	state.Units = append(state.Units, UnitState{
		ID:      state.UnitSeq,
		TypeIdx: typeIdx,
		Row:     row,
		Col:     col,
		Dir:     dir,
		HP:      maxHP,
		MaxHP:   maxHP,
	})
	state.ActiveSkillCooldown[typeIdx] = activeSkillCooldownFor(typeIdx, state.ActiveSkillLevels[typeIdx])
	return okResult()
}

func applyRetreat(data *EngineData, state *GameState, action GameAction) ActionResult {
	unitID := intOrDefault(action.UnitID, 0)
	idx := -1
	for i := range state.Units {
		if state.Units[i].ID == unitID {
			idx = i
			break
		}
	}
	if idx < 0 {
		return reject("单位不存在")
	}
	eng := &data.Config.Engine
	unit := state.Units[idx]
	cfg := &data.Config.Units[unit.TypeIdx]
	refund := pm(cfg.Cost*1000, eng.RetreatRefundPermyriad)
	state.CostMilli = min(eng.CostMaxMilli, state.CostMilli+refund)
	for i := range state.Enemies {
		if state.Enemies[i].BlockedBy == unit.ID {
			state.Enemies[i].BlockedBy = 0
		}
	}
	state.Units = append(state.Units[:idx], state.Units[idx+1:]...)
	state.RedeployCooldown[unit.TypeIdx] = cfg.Redeploy
	return okResult()
}

func addMeleeHPBonus(data *EngineData, state *GameState, bonusPm int) {
	state.MeleeHpBonusPm += bonusPm
	for i := range state.Units {
		unit := &state.Units[i]
		cfg := &data.Config.Units[unit.TypeIdx]
		if cfg.Block > 0 {
			newMax := effectiveMaxHP(state, cfg, unit.TypeIdx)
			unit.HP += newMax - unit.MaxHP
			unit.MaxHP = newMax
		}
	}
}

func applyBless(data *EngineData, state *GameState, action GameAction) ActionResult {
	pending := state.PendingBlessing
	if pending == nil {
		return reject("当前没有待选祝福")
	}
	blessing := intOrDefault(action.Blessing, -1)
	if !slices.Contains(pending.Options, blessing) {
		return reject("无效祝福选项")
	}
	eng := &data.Config.Engine
	// 祝福效果保持在引擎内执行，配置只承载规则弹窗展示文案。
	switch blessing {
	case 0:
		state.RegenMilliPerSec = pm(eng.CostRegenMilliPerSec, 12500)
	case 1:
		addMeleeHPBonus(data, state, 2000)
	case 2:
		state.RangedAtkBonusPm += 1200
	case 3:
		state.Lives = min(eng.LivesCap, state.Lives+2)
	case 4:
		state.NextWaveDebuffPm = 9000
		state.DebuffWave = state.WaveIndex
	case 5:
		state.CostMilli = min(eng.CostMaxMilli, state.CostMilli+12000)
	case 6:
		state.CostMilli = min(eng.CostMaxMilli, state.CostMilli+8000)
		cutRedeployCooldowns(state, 8*30)
		cutActiveSkillCooldowns(state, 6*30)
	case 7:
		state.RangedAtkBonusPm += 800
		for i := range state.Enemies {
			enemy := &state.Enemies[i]
			if enemy.HP > 0 && isFlyingEnemy(data, enemy.TypeIdx) {
				enemy.Shield = pm(enemy.Shield, 6500)
				slowEnemy(enemy, 9000)
			}
		}
	case 8:
		for i := range state.Enemies {
			state.Enemies[i].Shield = pm(state.Enemies[i].Shield, 5500)
		}
		state.NextWaveDebuffPm = min(state.NextWaveDebuffPm, 9400)
		if state.Phase == 0 {
			state.DebuffWave = state.WaveIndex
		} else {
			state.DebuffWave = state.WaveIndex + 1
		}
	case 9:
		state.Lives = min(eng.LivesCap, state.Lives+1)
		addMeleeHPBonus(data, state, 1000)
	case 10:
		state.CostMilli = min(eng.CostMaxMilli, state.CostMilli+18000)
		for i := range state.ActiveSkillCooldown {
			state.ActiveSkillCooldown[i] += 4 * 30
		}
	case 11:
		for i := range state.Units {
			unit := &state.Units[i]
			healUnit(unit, max(1, pm(unit.MaxHP, 1500)))
		}
		cutActiveSkillCooldowns(state, 10*30)
		state.ScoreLucky += 6
	default:
		return reject("未知祝福")
	}
	state.BlessingsOwned |= 1 << blessing
	state.PendingBlessing = nil
	return okResult()
}

func findUnitByID(state *GameState, unitID int) *UnitState {
	for i := range state.Units {
		unit := &state.Units[i]
		if unit.ID == unitID && unit.HP > 0 {
			return unit
		}
	}
	return nil
}

func applySkillUpgrade(data *EngineData, state *GameState, action GameAction) ActionResult {
	unitID := intOrDefault(action.UnitID, 0)
	unit := findUnitByID(state, unitID)
	if unit == nil {
		return reject("单位不存在")
	}
	typeIdx := unit.TypeIdx
	level := state.ActiveSkillLevels[typeIdx]
	if level >= activeSkillMaxLevel {
		return reject("技能已满级")
	}
	cost := activeSkillUpgradeCost(typeIdx, level)
	if state.CostMilli < cost*1000 {
		return reject("费用不足")
	}
	state.CostMilli -= cost * 1000
	state.ActiveSkillLevels[typeIdx] = level + 1
	cfg := &data.Config.Units[typeIdx]
	newMax := effectiveMaxHP(state, cfg, typeIdx)
	unit.HP += newMax - unit.MaxHP
	unit.MaxHP = newMax
	return okResult()
}

func enemiesInUnitRange(data *EngineData, state *GameState, unit *UnitState) []*EnemyState {
	cfg := &data.Config.Units[unit.TypeIdx]
	rangeSet := effectiveRangeSet(data, state, unit)
	enemies := make([]*EnemyState, 0, len(state.Enemies))
	for i := range state.Enemies {
		enemy := &state.Enemies[i]
		if enemy.HP == 0 {
			continue
		}
		if !unitCanHitEnemy(data, cfg, enemy) {
			continue
		}
		path := enemyPath(data, state, enemy)
		px, py := positionOnPath(path, enemy.Progress)
		eRow := py / 1000
		eCol := px / 1000
		if _, ok := rangeSet[offsetKey(eRow-unit.Row, eCol-unit.Col)]; ok {
			enemies = append(enemies, enemy)
		}
	}
	slices.SortFunc(enemies, func(a, b *EnemyState) int {
		pathA := enemyPath(data, state, a)
		pathB := enemyPath(data, state, b)
		remainA := pathA.LengthMilli - a.Progress
		remainB := pathB.LengthMilli - b.Progress
		if remainA != remainB {
			return remainA - remainB
		}
		return a.ID - b.ID
	})
	return enemies
}

func enemyPosition(data *EngineData, state *GameState, enemy *EnemyState) (int, int) {
	return positionOnPath(enemyPath(data, state, enemy), enemy.Progress)
}

func healUnit(unit *UnitState, amount int) bool {
	if unit.HP <= 0 || unit.HP >= unit.MaxHP {
		return false
	}
	unit.HP = min(unit.MaxHP, unit.HP+amount)
	return true
}

func healAllies(state *GameState, amount int) bool {
	applied := false
	for i := range state.Units {
		if healUnit(&state.Units[i], amount) {
			applied = true
		}
	}
	return applied
}

func cutActiveSkillCooldowns(state *GameState, frames int) {
	for i := range state.ActiveSkillCooldown {
		state.ActiveSkillCooldown[i] = max(0, state.ActiveSkillCooldown[i]-frames)
	}
}

func cutRedeployCooldowns(state *GameState, frames int) {
	for i := range state.RedeployCooldown {
		state.RedeployCooldown[i] = max(0, state.RedeployCooldown[i]-frames)
	}
}

func slowEnemy(enemy *EnemyState, speedPermyriad int) {
	enemy.Speed = max(18, pm(enemy.Speed, speedPermyriad))
}

func damageEnemiesAround(data *EngineData, state *GameState, attackerCfg *UnitConfig, centerX, centerY, radius, amount, kind int) bool {
	radiusSq := radius * radius
	applied := false
	for i := range state.Enemies {
		enemy := &state.Enemies[i]
		if enemy.HP == 0 || !unitCanHitEnemy(data, attackerCfg, enemy) {
			continue
		}
		px, py := enemyPosition(data, state, enemy)
		dx := px - centerX
		dy := py - centerY
		if dx*dx+dy*dy <= radiusSq {
			dealDamage(data, state, attackerCfg, enemy, amount, kind)
			applied = true
		}
	}
	return applied
}

func applySkill(data *EngineData, state *GameState, action GameAction) ActionResult {
	unitID := intOrDefault(action.UnitID, 0)
	unit := findUnitByID(state, unitID)
	if unit == nil {
		return reject("单位不存在")
	}
	typeIdx := unit.TypeIdx
	if state.ActiveSkillCooldown[typeIdx] > 0 {
		return reject("技能冷却中")
	}
	cfg := &data.Config.Units[typeIdx]
	level := state.ActiveSkillLevels[typeIdx]
	eng := &data.Config.Engine
	applied := false

	switch typeIdx {
	case 0:
		state.CostMilli = min(eng.CostMaxMilli, state.CostMilli+6000+(level-1)*800)
		healUnit(unit, 110+(level-1)*25)
		target := pickEnemyTarget(data, state, unit, cfg)
		if target != nil {
			dealDamage(data, state, cfg, target, 130+(level-1)*30, 2)
			if target.HP > 0 {
				target.Progress = max(0, target.Progress-(220+level*25))
				target.BlockedBy = 0
			}
		}
		applied = true
	case 1:
		unit.SkillActive = max(unit.SkillActive, 180+(level-1)*15)
		healUnit(unit, 220+(level-1)*45)
		unit.Sp = 0
		unit.SpTimer = 0
		for i := range state.Enemies {
			enemy := &state.Enemies[i]
			if enemy.HP > 0 && enemy.BlockedBy == unit.ID {
				dealDamage(data, state, cfg, enemy, 160+(level-1)*35, 2)
			}
		}
		applied = true
	case 2:
		targets := enemiesInUnitRange(data, state, unit)
		if len(targets) == 0 {
			return reject("没有可作用目标")
		}
		amount := 190 + (level-1)*45
		limit := min(len(targets), 3+(level+1)/2)
		for _, enemy := range targets[:limit] {
			hit := amount
			if enemy.BlockedBy == unit.ID {
				hit = pm(hit, 13500)
			}
			dealDamage(data, state, cfg, enemy, hit, 2)
		}
		applied = true
	case 3:
		centerX := unit.Col*1000 + 500
		centerY := unit.Row*1000 + 500
		radius := 1450 + (level-1)*60
		radiusSq := radius * radius
		amount := 240 + (level-1)*55
		speedPm := max(5700, 8400-(level-1)*300)
		for i := range state.Enemies {
			enemy := &state.Enemies[i]
			if enemy.HP == 0 {
				continue
			}
			if !unitCanHitEnemy(data, cfg, enemy) {
				continue
			}
			px, py := enemyPosition(data, state, enemy)
			dx := px - centerX
			dy := py - centerY
			if dx*dx+dy*dy <= radiusSq {
				dealDamage(data, state, cfg, enemy, amount, 1)
				if enemy.HP > 0 {
					slowEnemy(enemy, speedPm)
				}
				applied = true
			}
		}
		if !applied {
			return reject("没有可作用目标")
		}
	case 4:
		targets := enemiesInUnitRange(data, state, unit)
		if len(targets) == 0 {
			return reject("没有可作用目标")
		}
		amount := 220 + (level-1)*50
		priority := make([]*EnemyState, 0, len(targets))
		for _, enemy := range targets {
			if data.Config.Enemies[enemy.TypeIdx].Flying {
				priority = append(priority, enemy)
			}
		}
		for _, enemy := range targets {
			if !data.Config.Enemies[enemy.TypeIdx].Flying {
				priority = append(priority, enemy)
			}
		}
		limit := min(len(priority), 4+(level+1)/2)
		for _, enemy := range priority[:limit] {
			hit := amount
			if data.Config.Enemies[enemy.TypeIdx].Flying {
				hit = pm(hit, 14000)
			}
			dealDamage(data, state, cfg, enemy, hit, 0)
			if enemy.HP > 0 {
				enemy.Progress = max(0, enemy.Progress-(240+level*45))
				enemy.BlockedBy = 0
			}
		}
		applied = true
	case 5:
		target := pickEnemyTarget(data, state, unit, cfg)
		if target == nil {
			return reject("没有可作用目标")
		}
		cx, cy := enemyPosition(data, state, target)
		radius := 1050 + (level-1)*80
		radiusSq := radius * radius
		amount := 300 + (level-1)*65
		shieldPm := max(0, 10000-(2500+level*300))
		resCut := 160 + level*45
		for i := range state.Enemies {
			enemy := &state.Enemies[i]
			if enemy.HP == 0 {
				continue
			}
			if !unitCanHitEnemy(data, cfg, enemy) {
				continue
			}
			px, py := enemyPosition(data, state, enemy)
			dx := px - cx
			dy := py - cy
			if dx*dx+dy*dy <= radiusSq {
				enemy.Shield = pm(enemy.Shield, shieldPm)
				enemy.Res = max(0, enemy.Res-resCut)
				dealDamage(data, state, cfg, enemy, amount, 1)
				applied = true
			}
		}
	case 6:
		healAllies(state, 240+(level-1)*50)
		cutActiveSkillCooldowns(state, (3+(level+1)/2)*30)
		applied = true
	case 7:
		state.CostMilli = min(eng.CostMaxMilli, state.CostMilli+5000+level*700)
		healAllies(state, 90+level*35)
		cutActiveSkillCooldowns(state, (2+level/2)*30)
		fortuneCount := 4
		if level >= 6 {
			fortuneCount = 5
		}
		fortune := nextInt(state, fortuneCount)
		if fortune == 0 {
			state.CostMilli = min(eng.CostMaxMilli, state.CostMilli+3200+level*650)
		} else if fortune == 1 {
			lives := 1
			if level >= 10 {
				lives = 2
			}
			state.Lives = min(eng.LivesCap, state.Lives+lives)
		} else if fortune == 2 {
			state.NextWaveDebuffPm = min(state.NextWaveDebuffPm, 9600-level*140)
			if state.Phase == 0 {
				state.DebuffWave = state.WaveIndex
			} else {
				state.DebuffWave = state.WaveIndex + 1
			}
		} else if fortune == 3 {
			for i := range state.Enemies {
				enemy := &state.Enemies[i]
				if enemy.HP <= 0 {
					continue
				}
				enemy.Shield = pm(enemy.Shield, max(5200, 8200-level*300))
				slowEnemy(enemy, max(6800, 9400-level*260))
				if isFlyingEnemy(data, enemy.TypeIdx) {
					enemy.Progress = max(0, enemy.Progress-(220+level*80))
					enemy.BlockedBy = 0
				}
			}
		} else {
			state.ScoreLucky += 6 + level*3
			state.CostMilli = min(eng.CostMaxMilli, state.CostMilli+2400+level*500)
		}
		applied = true
	case 8:
		targets := enemiesInUnitRange(data, state, unit)
		if len(targets) == 0 {
			return reject("没有可作用目标")
		}
		target := targets[0]
		for _, enemy := range targets {
			if enemy.HP < target.HP || (enemy.HP == target.HP && enemy.ID < target.ID) {
				target = enemy
			}
		}
		before := target.HP
		dealDamage(data, state, cfg, target, 380+(level-1)*90+pm(target.MaxHP, 500+level*70), 2)
		if before > 0 && target.HP == 0 {
			state.CostMilli = min(eng.CostMaxMilli, state.CostMilli+4000+level*600)
		}
		applied = true
	case 9:
		targets := enemiesInUnitRange(data, state, unit)
		if len(targets) == 0 {
			return reject("没有可作用目标")
		}
		radius := 1200 + (level-1)*80
		radiusSq := radius * radius
		best := targets[0]
		bestCount := -1
		for _, candidate := range targets {
			cx, cy := enemyPosition(data, state, candidate)
			count := 0
			for i := range state.Enemies {
				enemy := &state.Enemies[i]
				if enemy.HP == 0 {
					continue
				}
				if !unitCanHitEnemy(data, cfg, enemy) {
					continue
				}
				px, py := enemyPosition(data, state, enemy)
				dx := px - cx
				dy := py - cy
				if dx*dx+dy*dy <= radiusSq {
					count++
				}
			}
			if count > bestCount || (count == bestCount && candidate.ID < best.ID) {
				best = candidate
				bestCount = count
			}
		}
		cx, cy := enemyPosition(data, state, best)
		amount := 280 + (level-1)*70
		for i := range state.Enemies {
			enemy := &state.Enemies[i]
			if enemy.HP == 0 {
				continue
			}
			if !unitCanHitEnemy(data, cfg, enemy) {
				continue
			}
			px, py := enemyPosition(data, state, enemy)
			dx := px - cx
			dy := py - cy
			if dx*dx+dy*dy <= radiusSq {
				enemy.Shield = pm(enemy.Shield, 6500)
				dealDamage(data, state, cfg, enemy, amount, 2)
				applied = true
			}
		}
	case 10:
		targets := enemiesInUnitRange(data, state, unit)
		if len(targets) == 0 {
			return reject("没有可作用目标")
		}
		amount := 180 + (level-1)*45
		push := 650 + (level-1)*100
		speedPm := max(5500, 8500-level*300)
		for _, enemy := range targets {
			dealDamage(data, state, cfg, enemy, amount, 1)
			if enemy.HP > 0 {
				slowEnemy(enemy, speedPm)
				enemy.Progress = max(0, enemy.Progress-push)
				enemy.BlockedBy = 0
			}
		}
		applied = true
	case 11:
		healAllies(state, 150+(level-1)*35)
		state.CostMilli = min(eng.CostMaxMilli, state.CostMilli+2500+level*700)
		cutActiveSkillCooldowns(state, (4+level/2)*30)
		applied = true
	case 12:
		unit.SkillActive = max(unit.SkillActive, 180+(level-1)*15)
		healUnit(unit, 180+(level-1)*40)
		unit.Sp = 0
		unit.SpTimer = 0
		amount := 220 + (level-1)*45
		for i := range state.Enemies {
			enemy := &state.Enemies[i]
			if enemy.HP > 0 && enemy.BlockedBy == unit.ID {
				enemy.Atk = max(1, pm(enemy.Atk, max(7400, 9200-(level-1)*200)))
				dealDamage(data, state, cfg, enemy, amount, 2)
			}
		}
		damageEnemiesAround(data, state, cfg, unit.Col*1000+500, unit.Row*1000+500, 1150+level*120, amount/2, 2)
		applied = true
	case 13:
		targets := enemiesInUnitRange(data, state, unit)
		if len(targets) == 0 {
			return reject("没有可作用目标")
		}
		priority := make([]*EnemyState, 0, len(targets))
		for _, enemy := range targets {
			if data.Config.Enemies[enemy.TypeIdx].Flying {
				priority = append(priority, enemy)
			}
		}
		for _, enemy := range targets {
			if !data.Config.Enemies[enemy.TypeIdx].Flying {
				priority = append(priority, enemy)
			}
		}
		amount := 450 + (level-1)*100
		limit := 1
		if level >= 10 {
			limit = 3
		} else if level >= 5 {
			limit = 2
		}
		limit = min(limit, len(priority))
		for _, target := range priority[:limit] {
			hit := amount
			if data.Config.Enemies[target.TypeIdx].Flying {
				hit = pm(hit, 15500)
			}
			target.Shield = pm(target.Shield, 5000)
			dealDamage(data, state, cfg, target, hit, 0)
			if target.HP > 0 {
				target.Progress = max(0, target.Progress-(420+level*90))
				target.BlockedBy = 0
			}
		}
		applied = true
	case 14:
		targets := enemiesInUnitRange(data, state, unit)
		if len(targets) == 0 {
			return reject("没有可作用目标")
		}
		amount := 170 + (level-1)*40
		speedPm := max(6100, 8800-(level-1)*300)
		armorCut := 20 + level*5
		resCut := 140 + level*40
		for _, enemy := range targets {
			dealDamage(data, state, cfg, enemy, amount, 1)
			if enemy.HP > 0 {
				slowEnemy(enemy, speedPm)
				enemy.Def = max(0, enemy.Def-armorCut)
				enemy.Res = max(0, enemy.Res-resCut)
			}
		}
		applied = true
	case 15:
		healAllies(state, 220+(level-1)*45)
		cutRedeployCooldowns(state, (5+level/2)*30)
		if level >= 10 {
			state.Lives = min(eng.LivesCap, state.Lives+1)
		}
		applied = true
	case 16:
		state.CostMilli = min(eng.CostMaxMilli, state.CostMilli+5000+(level-1)*1200)
		var target *UnitState
		for i := range state.Units {
			ally := &state.Units[i]
			if ally.HP <= 0 || ally.HP >= ally.MaxHP {
				continue
			}
			if target == nil || ally.HP*target.MaxHP < target.HP*ally.MaxHP || (ally.HP == target.HP && ally.ID < target.ID) {
				target = ally
			}
		}
		if target != nil {
			healUnit(target, 180+(level-1)*40)
		}
		cutRedeployCooldowns(state, (4+level/2)*30)
		cutActiveSkillCooldowns(state, (1+level/3)*30)
		applied = true
	case 17:
		targets := enemiesInUnitRange(data, state, unit)
		if len(targets) == 0 {
			return reject("没有可作用目标")
		}
		flat := 140 + (level-1)*35
		percent := 600 + level*90
		pull := 500 + (level-1)*100
		for _, enemy := range targets {
			enemy.Shield = pm(enemy.Shield, 4500)
			dealDamage(data, state, cfg, enemy, pm(enemy.MaxHP, percent)+flat, 2)
			if enemy.HP > 0 {
				slowEnemy(enemy, max(6400, 8200-(level-1)*200))
				enemy.Progress = max(0, enemy.Progress-pull)
				enemy.BlockedBy = 0
			}
		}
		applied = true
	default:
		return reject("未知技能")
	}

	if applied {
		state.ActiveSkillCooldown[typeIdx] = activeSkillCooldownFor(typeIdx, level)
	}
	return okResult()
}

func ApplyAction(state *GameState, action GameAction) ActionResult {
	data := mustEngineData()
	if state.Status != StatusPlaying {
		return reject("对局已结束")
	}
	if state.PendingBlessing != nil {
		if action.Type != "bless" {
			return reject("祝福待选中，仅可选择祝福")
		}
		return applyBless(data, state, action)
	}
	switch action.Type {
	case "deploy":
		return applyDeploy(data, state, action)
	case "retreat":
		return applyRetreat(data, state, action)
	case "bless":
		return reject("当前没有待选祝福")
	case "skill":
		return applySkill(data, state, action)
	case "skillUpgrade":
		return applySkillUpgrade(data, state, action)
	default:
		return reject("未知操作")
	}
}

func stepWave(data *EngineData, state *GameState) {
	eng := &data.Config.Engine
	m := &data.Maps[state.MapIdx]
	if state.Phase == 0 {
		state.IntermissionRemaining--
		if state.IntermissionRemaining <= 0 {
			state.Phase = 1
			state.WaveFrame = -1
			state.SpawnedInWave = 0
			state.WaveEvents = buildRandomWaveEvents(data, state)
			state.SpawnCursor = make([]int, len(state.WaveEvents))
			state.CoinPlan = CoinPlan{}
			// 金币怪计划：除第 15 波里程碑与最终波外，第 2 波起每波均可出现；命中时再依次消耗 delay、path。
			if state.WaveIndex >= 2 && state.WaveIndex < len(m.Cfg.Waves) && state.WaveIndex != legacyWaveCount {
				roll := nextInt(state, 10000)
				if roll < eng.CoinChancePermyriad {
					frame := eng.CoinDelayBaseFrames + nextInt(state, eng.CoinDelaySpreadFrames)
					path := nextInt(state, len(m.Paths))
					state.CoinPlan = CoinPlan{Active: 1, Frame: frame, Path: path}
				}
			}
		}
		return
	}
	state.WaveFrame++
	events := state.WaveEvents
	for ei := range events {
		event := events[ei]
		delay, enemyIdx, pathIdx, count, interval := event[0], event[1], event[2], event[3], event[4]
		spawned := state.SpawnCursor[ei]
		if spawned >= count {
			continue
		}
		if state.WaveFrame == delay+spawned*interval {
			spawnEnemy(data, state, enemyIdx, pathIdx)
			state.SpawnCursor[ei] = spawned + 1
		}
	}
	// 金币怪在全部 spawnEvent 处理之后刷出；刷出后 coinPlan 三字段一并归零（§12.2）。
	if state.CoinPlan.Active == 1 && state.WaveFrame == state.CoinPlan.Frame {
		spawnEnemy(data, state, data.CoinEnemyIdx, state.CoinPlan.Path)
		state.CoinPlan = CoinPlan{}
	}
}

func enemySkillBaseCooldown(id string, tier int) int {
	switch id {
	case "grunt":
		return max(150, 300-tier*12)
	case "wolf":
		return max(90, 190-tier*10)
	case "golem":
		return max(150, 270-tier*12)
	case "puppet":
		return max(130, 240-tier*10)
	case "boss":
		return max(120, 260-tier*14)
	case "drone":
		return max(105, 220-tier*10)
	default:
		return 0
	}
}

func resetEnemySkillCooldown(data *EngineData, enemy *EnemyState) {
	enemy.SkillCooldown = enemySkillBaseCooldown(enemyID(data, enemy.TypeIdx), enemy.TraitTier)
}

func spawnEnemy(data *EngineData, state *GameState, typeIdx, pathIdx int) {
	m := &data.Maps[state.MapIdx]
	cfg := &data.Config.Enemies[typeIdx]
	routeCount := len(pathListForEnemyType(data, m, typeIdx))
	if routeCount > 0 {
		pathIdx = max(0, pathIdx%routeCount)
	} else {
		pathIdx = 0
	}
	tier := 0
	if typeIdx != data.CoinEnemyIdx {
		tier = waveTraitTier(state.WaveIndex)
	}
	hp := pm(cfg.HP, m.Cfg.WaveHpPermyriad[state.WaveIndex-1])
	hp = pm(hp, m.Cfg.HpPermyriad)
	hp = pm(hp, enemyHpPermyriad(data, typeIdx, state.WaveIndex, tier))
	for _, mechanic := range m.Cfg.Mechanics {
		if typeIdx != data.CoinEnemyIdx && mechanic.EnemyHpPermyriad > 0 {
			hp = pm(hp, mechanic.EnemyHpPermyriad)
		}
	}
	if state.WaveIndex == state.DebuffWave {
		hp = pm(hp, state.NextWaveDebuffPm)
	}
	if hp < 1 {
		hp = 1
	}
	atk := max(1, pm(cfg.Atk, enemyAtkPermyriad(data, typeIdx, state.WaveIndex, tier)))
	for _, mechanic := range m.Cfg.Mechanics {
		if typeIdx != data.CoinEnemyIdx && mechanic.EnemyAtkPermyriad > 0 {
			atk = max(1, pm(atk, mechanic.EnemyAtkPermyriad))
		}
		classAtk := mechanic.GroundEnemyAtkPermyriad
		if isFlyingEnemy(data, typeIdx) {
			classAtk = mechanic.FlyingEnemyAtkPermyriad
		}
		if classAtk > 0 {
			atk = max(1, pm(atk, classAtk))
		}
	}
	interval := max(18, cfg.Interval*10000/enemyAttackSpeedPermyriad(data, typeIdx, state.WaveIndex, tier))
	for _, mechanic := range m.Cfg.Mechanics {
		if isFlyingEnemy(data, typeIdx) && mechanic.FlyingEnemyAttackSpeedPermyriad > 0 {
			interval = max(18, interval*10000/mechanic.FlyingEnemyAttackSpeedPermyriad)
		}
	}
	speed := max(1, pm(cfg.Speed, enemySpeedPermyriad(data, typeIdx, state.WaveIndex, tier)))
	for _, mechanic := range m.Cfg.Mechanics {
		if typeIdx != data.CoinEnemyIdx && mechanic.EnemySpeedPermyriad > 0 {
			speed = max(1, pm(speed, mechanic.EnemySpeedPermyriad))
		}
		if mechanic.AllEnemySpeedPermyriad > 0 {
			speed = max(1, pm(speed, mechanic.AllEnemySpeedPermyriad))
		}
	}
	shield := 0
	switch enemyID(data, typeIdx) {
	case "puppet":
		shield = pm(hp, 900+tier*220+max(0, state.WaveIndex-8)*50)
	case "boss":
		shield = pm(hp, 300+tier*100)
	}
	for _, mechanic := range m.Cfg.Mechanics {
		if typeIdx != data.CoinEnemyIdx && mechanic.EnemyShieldPermyriad > 0 {
			shield += pm(hp, mechanic.EnemyShieldPermyriad)
		}
	}
	skillCooldown := enemySkillBaseCooldown(enemyID(data, typeIdx), tier)
	dmgToBase := cfg.DmgToBase
	if typeIdx != data.CoinEnemyIdx && state.WaveIndex >= 12 {
		dmgToBase++
	}
	if enemyID(data, typeIdx) == "boss" && state.WaveIndex >= 14 {
		dmgToBase++
	}
	def := enemyDefValue(data, typeIdx, state.WaveIndex, tier)
	res := enemyResValue(data, typeIdx, state.WaveIndex, tier)
	for _, mechanic := range m.Cfg.Mechanics {
		if typeIdx == data.CoinEnemyIdx {
			continue
		}
		def += mechanic.EnemyDefBonus
		if !isFlyingEnemy(data, typeIdx) && mechanic.GroundEnemyDefPermyriad > 0 {
			def = pm(def, mechanic.GroundEnemyDefPermyriad)
		}
		res = min(9000, res+mechanic.EnemyResBonus)
		dmgToBase += mechanic.LeakDamageBonus
	}
	state.EnemySeq++
	state.Enemies = append(state.Enemies, EnemyState{
		ID:            state.EnemySeq,
		TypeIdx:       typeIdx,
		PathIdx:       pathIdx,
		Progress:      0,
		HP:            hp,
		MaxHP:         hp,
		Atk:           atk,
		Interval:      interval,
		Def:           def,
		Res:           res,
		Speed:         speed,
		DmgToBase:     dmgToBase,
		Shield:        shield,
		SkillCooldown: skillCooldown,
		TraitTier:     tier,
		HazardAcc:     0,
	})
	state.SpawnedInWave++
}

func killCredit(data *EngineData, state *GameState, attackerCfg *UnitConfig, enemy *EnemyState) {
	eng := &data.Config.Engine
	state.ScoreKills += eng.KillScore
	if enemy.TypeIdx == data.CoinEnemyIdx {
		state.ScoreLucky += eng.CoinScore
		state.CostMilli = min(eng.CostMaxMilli, state.CostMilli+4000)
	}
	if hasTag(attackerCfg, "killCost") {
		state.CostMilli = min(eng.CostMaxMilli, state.CostMilli+eng.VanguardKillCostMilli)
	}
}

func nearbySameEnemyCount(data *EngineData, state *GameState, enemy *EnemyState, id string, radius int) int {
	centerX, centerY := enemyPosition(data, state, enemy)
	radiusSq := radius * radius
	count := 0
	for i := range state.Enemies {
		other := &state.Enemies[i]
		if other.ID == enemy.ID || other.HP == 0 || enemyID(data, other.TypeIdx) != id {
			continue
		}
		px, py := enemyPosition(data, state, other)
		dx := px - centerX
		dy := py - centerY
		if dx*dx+dy*dy <= radiusSq {
			count++
		}
	}
	return count
}

// dealDamage 结算一次伤害并处理击杀；kind: 0=物理 1=法术 2=直伤（溅射二段）。返回实际伤害。
func dealDamage(data *EngineData, state *GameState, attackerCfg *UnitConfig, enemy *EnemyState, amount, kind int) int {
	cfg := &data.Config.Enemies[enemy.TypeIdx]
	if !unitCanHitEnemy(data, attackerCfg, enemy) {
		return 0
	}
	incoming := amount
	if cfg.ID == "grunt" && kind != 2 {
		pack := min(4, nearbySameEnemyCount(data, state, enemy, "grunt", 1400))
		if pack > 0 {
			incoming = max(1, pm(incoming, max(7000, 9600-pack*400-enemy.TraitTier*120)))
		}
	}
	if cfg.ID == "drone" && kind == 0 {
		incoming = max(1, pm(incoming, max(7800, 9000-enemy.TraitTier*180)))
	}
	if cfg.ID == "boss" && enemy.Shield > 0 && kind != 2 {
		incoming = max(1, pm(incoming, max(8200, 9000-enemy.TraitTier*180)))
	}
	if cfg.ID == "golem" && kind == 0 && enemy.HP*2 > enemy.MaxHP {
		incoming = max(1, pm(incoming, max(6800, 8200-enemy.TraitTier*300)))
	}
	var dealt int
	switch kind {
	case 0:
		dealt = max(1, incoming-effectiveEnemyDef(data, state, enemy))
	case 1:
		dealt = max(1, pm(incoming, 10000-enemy.Res))
	default:
		dealt = max(1, incoming)
	}
	if enemy.Shield > 0 {
		absorbed := min(enemy.Shield, dealt)
		enemy.Shield -= absorbed
		dealt -= absorbed
		if dealt <= 0 {
			return 0
		}
	}
	enemy.HP -= dealt
	if enemy.HP <= 0 {
		enemy.HP = 0
		killCredit(data, state, attackerCfg, enemy)
	}
	return dealt
}

func setCooldown(data *EngineData, state *GameState, unit *UnitState, cfg *UnitConfig) {
	eng := &data.Config.Engine
	interval := effectiveInterval(state, cfg, unit.TypeIdx)
	for i := range state.Units {
		ally := &state.Units[i]
		if ally.HP == 0 {
			continue
		}
		auraSet := effectiveAuraSet(data, state, ally)
		if len(auraSet) == 0 {
			continue
		}
		if _, ok := auraSet[offsetKey(unit.Row-ally.Row, unit.Col-ally.Col)]; ok {
			interval = interval * 10000 / (10000 + eng.KoiSpeedPermyriad)
			break
		}
	}
	for i := range data.Maps[state.MapIdx].Cfg.Mechanics {
		mechanic := &data.Maps[state.MapIdx].Cfg.Mechanics[i]
		if mechanic.UnitIntervalPermyriad <= 0 {
			continue
		}
		if mechanicAppliesToUnit(data, state, mechanic, unit) {
			interval = max(1, interval*mechanic.UnitIntervalPermyriad/10000)
		}
	}
	for i := range data.Maps[state.MapIdx].Cfg.Mechanics {
		mechanic := &data.Maps[state.MapIdx].Cfg.Mechanics[i]
		if cfg.Block == 0 && mechanic.HighGroundUnitAttackSpeedPermyriad > 0 {
			interval = max(1, interval*10000/mechanic.HighGroundUnitAttackSpeedPermyriad)
		}
		if mechanic.UnitAttackSpeedPermyriad > 0 {
			interval = max(1, interval*10000/mechanic.UnitAttackSpeedPermyriad)
		}
		if mechanic.CellUnitAttackSpeedPermyriad > 0 && mechanicAppliesToUnit(data, state, mechanic, unit) {
			interval = max(1, interval*10000/mechanic.CellUnitAttackSpeedPermyriad)
		}
	}
	unit.AtkCooldown = interval
}

func pickEnemyTarget(data *EngineData, state *GameState, unit *UnitState, cfg *UnitConfig) *EnemyState {
	if cfg.Block > 0 {
		var bestBlocked *EnemyState
		for i := range state.Enemies {
			enemy := &state.Enemies[i]
			if enemy.HP == 0 || enemy.BlockedBy != unit.ID {
				continue
			}
			if bestBlocked == nil || enemy.Progress > bestBlocked.Progress ||
				(enemy.Progress == bestBlocked.Progress && enemy.ID < bestBlocked.ID) {
				bestBlocked = enemy
			}
		}
		if bestBlocked != nil {
			return bestBlocked
		}
	}
	// 射程 = 方向格集合：敌人所在格 = (floor(y/1000), floor(x/1000))，坐标恒非负，整除即 floor（§12.15）。
	rangeSet := effectiveRangeSet(data, state, unit)
	var best *EnemyState
	bestRemaining := 0
	for i := range state.Enemies {
		enemy := &state.Enemies[i]
		if enemy.HP == 0 {
			continue
		}
		if !unitCanHitEnemy(data, cfg, enemy) {
			continue
		}
		path := enemyPath(data, state, enemy)
		px, py := positionOnPath(path, enemy.Progress)
		eRow := py / 1000
		eCol := px / 1000
		if _, ok := rangeSet[offsetKey(eRow-unit.Row, eCol-unit.Col)]; !ok {
			continue
		}
		remaining := path.LengthMilli - enemy.Progress
		if best == nil || remaining < bestRemaining || (remaining == bestRemaining && enemy.ID < best.ID) {
			best = enemy
			bestRemaining = remaining
		}
	}
	return best
}

func unitAct(data *EngineData, state *GameState, unit *UnitState) {
	if unit.HP == 0 {
		return
	}
	cfg := &data.Config.Units[unit.TypeIdx]
	// shield 技能触发判定位于冷却检查之前（§12.7）。
	if cfg.Skill != nil && cfg.Skill.Kind == "shield" && unit.Sp >= cfg.Skill.SpCost {
		unit.Sp = 0
		unit.SkillActive = cfg.Skill.Duration
	}
	if unit.AtkCooldown > 0 {
		return
	}
	if cfg.AtkType == "none" {
		return
	}
	if cfg.AtkType == "heal" {
		// 医疗目标集合含自身；按 hp*10000/maxHp 最小、平局小 id；无目标不进冷却。射程 = 方向格集合。
		rangeSet := effectiveRangeSet(data, state, unit)
		var target *UnitState
		bestRatio := 0
		for i := range state.Units {
			ally := &state.Units[i]
			if ally.HP == 0 || ally.HP >= ally.MaxHP {
				continue
			}
			if _, ok := rangeSet[offsetKey(ally.Row-unit.Row, ally.Col-unit.Col)]; !ok {
				continue
			}
			ratio := ally.HP * 10000 / ally.MaxHP
			if target == nil || ratio < bestRatio || (ratio == bestRatio && ally.ID < target.ID) {
				target = ally
				bestRatio = ratio
			}
		}
		if target == nil {
			return
		}
		target.HP = min(target.MaxHP, target.HP+effectiveAtk(state, cfg, unit.TypeIdx))
		setCooldown(data, state, unit, cfg)
		return
	}
	target := pickEnemyTarget(data, state, unit, cfg)
	if target == nil {
		return
	}
	atkBase := effectiveAtk(state, cfg, unit.TypeIdx)
	// triple：仅在选中目标后自增 attackCount，每 every 次按 permyriad 增伤。
	if cfg.Skill != nil && cfg.Skill.Kind == "triple" {
		unit.AttackCount++
		if unit.AttackCount%cfg.Skill.Every == 0 {
			atkBase = pm(atkBase, cfg.Skill.Permyriad)
		}
	}
	kind := 0
	if cfg.AtkType == "magic" {
		kind = 1
	}
	if kind == 1 && cfg.AoeRadius > 0 {
		// AOE：以主目标位置为圆心，半径内所有存活敌人（含主目标）各结算一次全额法术。
		cx, cy := enemyPosition(data, state, target)
		radiusSq := cfg.AoeRadius * cfg.AoeRadius
		for i := range state.Enemies {
			enemy := &state.Enemies[i]
			if enemy.HP == 0 {
				continue
			}
			if !unitCanHitEnemy(data, cfg, enemy) {
				continue
			}
			px, py := enemyPosition(data, state, enemy)
			dx := px - cx
			dy := py - cy
			if dx*dx+dy*dy <= radiusSq {
				dealDamage(data, state, cfg, enemy, atkBase, 1)
			}
		}
	} else {
		dealt := dealDamage(data, state, cfg, target, atkBase, kind)
		if cfg.SplashRadius > 0 {
			// 溅射二段为直伤：max(1, floor(主目标实际伤害×splashPermyriad/10000))，不吃 DEF/RES（§12.4）。
			cx, cy := enemyPosition(data, state, target)
			radiusSq := cfg.SplashRadius * cfg.SplashRadius
			splash := pm(dealt, cfg.SplashPermyriad)
			for i := range state.Enemies {
				enemy := &state.Enemies[i]
				if enemy.HP == 0 || enemy.ID == target.ID {
					continue
				}
				if !unitCanHitEnemy(data, cfg, enemy) {
					continue
				}
				px, py := enemyPosition(data, state, enemy)
				dx := px - cx
				dy := py - cy
				if dx*dx+dy*dy <= radiusSq {
					dealDamage(data, state, cfg, enemy, splash, 2)
				}
			}
		}
	}
	setCooldown(data, state, unit, cfg)
}

func findMeleeUnitAt(data *EngineData, state *GameState, row, col int) *UnitState {
	for i := range state.Units {
		unit := &state.Units[i]
		if unit.HP == 0 || unit.Row != row || unit.Col != col {
			continue
		}
		if data.Config.Units[unit.TypeIdx].Block > 0 {
			return unit
		}
	}
	return nil
}

func damageUnitsAroundPoint(state *GameState, centerX, centerY, radius, amount int) bool {
	radiusSq := radius * radius
	applied := false
	for i := range state.Units {
		unit := &state.Units[i]
		if unit.HP <= 0 {
			continue
		}
		ux := unit.Col*1000 + 500
		uy := unit.Row*1000 + 500
		dx := ux - centerX
		dy := uy - centerY
		if dx*dx+dy*dy <= radiusSq {
			unit.HP = max(0, unit.HP-amount)
			applied = true
		}
	}
	return applied
}

func addEnemyShield(enemy *EnemyState, shieldPermyriad, capPermyriad int) bool {
	cap := max(0, pm(enemy.MaxHP, capPermyriad))
	if cap <= 0 || enemy.Shield >= cap {
		return false
	}
	next := min(cap, enemy.Shield+max(1, pm(enemy.MaxHP, shieldPermyriad)))
	applied := next > enemy.Shield
	enemy.Shield = next
	return applied
}

func shieldEnemiesAround(data *EngineData, state *GameState, source *EnemyState, radius, shieldPermyriad, capPermyriad int) bool {
	centerX, centerY := enemyPosition(data, state, source)
	radiusSq := radius * radius
	applied := false
	for i := range state.Enemies {
		enemy := &state.Enemies[i]
		if enemy.HP <= 0 || enemy.TypeIdx == data.CoinEnemyIdx {
			continue
		}
		px, py := enemyPosition(data, state, enemy)
		dx := px - centerX
		dy := py - centerY
		if dx*dx+dy*dy <= radiusSq {
			applied = addEnemyShield(enemy, shieldPermyriad, capPermyriad) || applied
		}
	}
	return applied
}

func castEnemySkill(data *EngineData, state *GameState, enemy *EnemyState) bool {
	id := enemyID(data, enemy.TypeIdx)
	tier := enemy.TraitTier
	switch id {
	case "grunt":
		addEnemyShield(enemy, 120+tier*40, 900+tier*160)
		shieldEnemiesAround(data, state, enemy, 1400, 50+tier*20, 700+tier*120)
		return true
	case "wolf":
		if enemy.BlockedBy != 0 {
			var blocker *UnitState
			for i := range state.Units {
				if state.Units[i].ID == enemy.BlockedBy {
					blocker = &state.Units[i]
					break
				}
			}
			if blocker != nil && blocker.HP > 0 {
				blocker.HP = max(0, blocker.HP-(35+tier*20))
				addEnemyShield(enemy, 80+tier*25, 700+tier*120)
				return true
			}
		}
		enemy.Progress += 210 + tier*55
		return true
	case "golem":
		if enemy.BlockedBy == 0 {
			return false
		}
		var blocker *UnitState
		for i := range state.Units {
			if state.Units[i].ID == enemy.BlockedBy {
				blocker = &state.Units[i]
				break
			}
		}
		if blocker == nil || blocker.HP <= 0 {
			return false
		}
		addEnemyShield(enemy, 100+tier*35, 850+tier*150)
		damageUnitsAroundPoint(state, blocker.Col*1000+500, blocker.Row*1000+500, 1100, 70+tier*25)
		return true
	case "puppet":
		targetShield := pm(enemy.MaxHP, 850+tier*160)
		if enemy.Shield >= targetShield {
			return false
		}
		addEnemyShield(enemy, 420+tier*100, 850+tier*160)
		enemy.Res = min(7600, enemy.Res+70+tier*30)
		return true
	case "boss":
		heal := max(1, pm(enemy.MaxHP, 160+tier*45))
		enemy.HP = min(enemy.MaxHP, enemy.HP+heal)
		addEnemyShield(enemy, 180+tier*50, 700+tier*130)
		px, py := enemyPosition(data, state, enemy)
		damageUnitsAroundPoint(state, px, py, 1700+tier*100, 60+tier*35)
		shieldEnemiesAround(data, state, enemy, 2200, 70+tier*25, 650+tier*110)
		return true
	case "drone":
		enemy.Progress += 170 + tier*55
		addEnemyShield(enemy, 90+tier*25, 600+tier*100)
		return true
	default:
		return false
	}
}

func enemyAct(data *EngineData, state *GameState, enemy *EnemyState) {
	if enemy.HP == 0 {
		return
	}
	cfg := &data.Config.Enemies[enemy.TypeIdx]
	if enemy.SkillCooldown > 0 {
		enemy.SkillCooldown--
	}
	if enemy.SkillCooldown <= 0 && enemySkillBaseCooldown(cfg.ID, enemy.TraitTier) > 0 {
		if castEnemySkill(data, state, enemy) {
			resetEnemySkillCooldown(data, enemy)
		} else {
			enemy.SkillCooldown = 15
		}
	}
	if enemy.HP == 0 {
		return
	}
	if enemy.BlockedBy != 0 {
		var blocker *UnitState
		for i := range state.Units {
			if state.Units[i].ID == enemy.BlockedBy {
				blocker = &state.Units[i]
				break
			}
		}
		if blocker != nil && blocker.HP > 0 {
			if enemy.AtkCooldown > 0 {
				enemy.AtkCooldown--
				return
			}
			defEff := effectiveUnitDef(data, state, blocker)
			dealt := max(1, enemy.Atk-defEff)
			blocker.HP -= dealt
			if blocker.HP <= 0 {
				blocker.HP = 0
			}
			enemy.AtkCooldown = enemy.Interval
			return
		}
		// 阻挡者消失或死亡：同帧解除阻挡并立即进入移动分支（§12.8）。
		enemy.BlockedBy = 0
	}
	path := enemyPath(data, state, enemy)
	// 远程敌人（atkRange>0）：未被阻挡时边走边射，目标=射程内距离²最小者（同距取 id 小）
	if cfg.AtkRange > 0 {
		if enemy.AtkCooldown > 0 {
			enemy.AtkCooldown--
		} else {
			px, py := positionOnPath(path, enemy.Progress)
			rangeSq := cfg.AtkRange * cfg.AtkRange
			var target *UnitState
			bestDistSq := 0
			for i := range state.Units {
				unit := &state.Units[i]
				if unit.HP == 0 {
					continue
				}
				dx := unit.Col*1000 + 500 - px
				dy := unit.Row*1000 + 500 - py
				distSq := dx*dx + dy*dy
				if distSq > rangeSq {
					continue
				}
				if target == nil || distSq < bestDistSq || (distSq == bestDistSq && unit.ID < target.ID) {
					target = unit
					bestDistSq = distSq
				}
			}
			if target != nil {
				defEff := effectiveUnitDef(data, state, target)
				dealt := max(1, enemy.Atk-defEff)
				target.HP -= dealt
				if target.HP <= 0 {
					target.HP = 0
				}
				enemy.AtkCooldown = enemy.Interval
			}
		}
	}
	from := enemy.Progress
	effectiveSpeed := enemy.Speed
	for i := range data.Maps[state.MapIdx].Cfg.Mechanics {
		mechanic := &data.Maps[state.MapIdx].Cfg.Mechanics[i]
		if mechanic.CellEnemySpeedPermyriad > 0 && mechanicAppliesToEnemy(data, state, mechanic, enemy) {
			effectiveSpeed = max(1, pm(effectiveSpeed, mechanic.CellEnemySpeedPermyriad))
		}
	}
	moveSpeed := effectiveSpeed
	if cfg.ID == "wolf" {
		moveSpeed += max(1, pm(effectiveSpeed, 1200+enemy.TraitTier*250))
	}
	to := from + moveSpeed
	if cfg.Blockable {
		// 阻挡捕获：途经格 centerProgress ∈ (from, to]，按升序取第一个有空位的近战单位。
		for _, cell := range path.Cells {
			if cell.CenterProgress <= from {
				continue
			}
			if cell.CenterProgress > to {
				break
			}
			unit := findMeleeUnitAt(data, state, cell.Row, cell.Col)
			if unit == nil {
				continue
			}
			blockLimit := data.Config.Units[unit.TypeIdx].Block
			blockedCount := 0
			for i := range state.Enemies {
				other := &state.Enemies[i]
				if other.HP > 0 && other.BlockedBy == unit.ID {
					blockedCount++
				}
			}
			if blockedCount >= blockLimit {
				continue
			}
			enemy.Progress = cell.CenterProgress
			enemy.BlockedBy = unit.ID
			return
		}
	}
	enemy.Progress = to
	if enemy.Progress >= path.LengthMilli {
		// 泄漏：lives 不做下限截断；leaked 标记确保不触发击杀计分。
		state.Lives -= enemy.DmgToBase
		enemy.Leaked = true
		enemy.HP = 0
	}
}

func applyMapUnitHazards(data *EngineData, state *GameState) {
	fps := data.Config.Engine.Fps
	if fps <= 0 || state.Frame%fps != 0 {
		return
	}
	for i := range state.Units {
		unit := &state.Units[i]
		if unit.HP == 0 {
			continue
		}
		damage := unitHazardDamagePerSecond(data, state, unit)
		if damage <= 0 {
			continue
		}
		unit.HP = max(0, unit.HP-damage)
	}
}

func applyMapEnemyHazards(data *EngineData, state *GameState) {
	fps := data.Config.Engine.Fps
	if fps <= 0 {
		return
	}
	for i := range state.Enemies {
		enemy := &state.Enemies[i]
		if enemy.HP <= 0 {
			continue
		}
		damagePermyriad := 0
		for mi := range data.Maps[state.MapIdx].Cfg.Mechanics {
			mechanic := &data.Maps[state.MapIdx].Cfg.Mechanics[mi]
			if mechanic.EnemyMaxHpDamagePermyriadPerSecond > 0 && mechanicAppliesToEnemy(data, state, mechanic, enemy) {
				damagePermyriad += mechanic.EnemyMaxHpDamagePermyriadPerSecond
			}
		}
		if damagePermyriad <= 0 {
			enemy.HazardAcc = 0
			continue
		}
		enemy.HazardAcc += enemy.MaxHP * damagePermyriad
		divisor := fps * 10000
		damage := enemy.HazardAcc / divisor
		enemy.HazardAcc %= divisor
		if damage > 0 {
			enemy.HP = max(0, enemy.HP-damage)
		}
	}
}

func sweep(data *EngineData, state *GameState) {
	// 清扫顺序：先敌后单位；死亡单位需先释放其阻挡并设再部署冷却，再移除。
	hasDeadEnemy := false
	for i := range state.Enemies {
		if state.Enemies[i].HP == 0 {
			hasDeadEnemy = true
			break
		}
	}
	if hasDeadEnemy {
		aliveEnemies := state.Enemies[:0]
		for i := range state.Enemies {
			if state.Enemies[i].HP > 0 {
				aliveEnemies = append(aliveEnemies, state.Enemies[i])
			}
		}
		state.Enemies = aliveEnemies
	}
	hasDeadUnit := false
	for i := range state.Units {
		if state.Units[i].HP == 0 {
			hasDeadUnit = true
			break
		}
	}
	if hasDeadUnit {
		for i := range state.Units {
			unit := &state.Units[i]
			if unit.HP != 0 {
				continue
			}
			for j := range state.Enemies {
				if state.Enemies[j].BlockedBy == unit.ID {
					state.Enemies[j].BlockedBy = 0
				}
			}
			state.RedeployCooldown[unit.TypeIdx] = data.Config.Units[unit.TypeIdx].Redeploy
		}
		aliveUnits := state.Units[:0]
		for i := range state.Units {
			if state.Units[i].HP > 0 {
				aliveUnits = append(aliveUnits, state.Units[i])
			}
		}
		state.Units = aliveUnits
	}
}

func checkWaveClear(data *EngineData, state *GameState) {
	if state.Status != StatusPlaying || state.Phase != 1 {
		return
	}
	eng := &data.Config.Engine
	m := &data.Maps[state.MapIdx]
	events := state.WaveEvents
	for ei := range events {
		if state.SpawnCursor[ei] < events[ei][3] {
			return
		}
	}
	if state.CoinPlan.Active == 1 || len(state.Enemies) > 0 {
		return
	}
	// debuff 复位是波结清处理的第一步，先于费用/波分/波哈希/祝福掷选（§12.3）。
	if state.WaveIndex == state.DebuffWave {
		state.NextWaveDebuffPm = 10000
		state.DebuffWave = 0
	}
	state.CostMilli = min(eng.CostMaxMilli, state.CostMilli+eng.WaveClearCostMilli)
	state.ScoreWaves += eng.WaveScoreBase + eng.WaveScorePerWave*state.WaveIndex
	for i := range state.Units {
		unit := &state.Units[i]
		if unit.HP > 0 && len(data.Config.Units[unit.TypeIdx].AuraCells) > 0 {
			state.ScoreLucky += eng.KoiWaveScore
			break
		}
	}
	// 波哈希记录点：此刻 waveIndex 尚未 ++、phase 仍为 wave、pendingBlessing 尚未设置。
	state.WaveHashes = append(state.WaveHashes, HashState(state))
	if state.WaveIndex == len(m.Cfg.Waves) {
		state.Status = StatusWon
		return
	}
	if slices.Contains(eng.BlessingWaves, state.WaveIndex) {
		// 祝福掷选：候选为未拥有祝福下标升序，部分 Fisher-Yates：j = i + nextInt(len-i)。
		var candidates []int
		for b := 0; b < len(data.Config.Blessings); b++ {
			if state.BlessingsOwned&(1<<b) == 0 {
				candidates = append(candidates, b)
			}
		}
		if len(candidates) > 0 {
			picks := min(eng.BlessingChoices, len(candidates))
			for i := 0; i < picks; i++ {
				j := i + nextInt(state, len(candidates)-i)
				candidates[i], candidates[j] = candidates[j], candidates[i]
			}
			options := make([]int, picks)
			copy(options, candidates[:picks])
			state.PendingBlessing = &PendingBlessing{Options: options}
		}
	}
	state.WaveIndex++
	state.Phase = 0
	state.IntermissionRemaining = eng.IntermissionFrames
}

// Tick 推进一帧；返回 false 表示本帧为冻结/终局 no-op（frame 不变）。
func Tick(state *GameState) bool {
	if state.Status != StatusPlaying || state.PendingBlessing != nil {
		return false
	}
	data := mustEngineData()
	eng := &data.Config.Engine
	state.Frame++
	if state.Frame >= eng.MaxFrames {
		state.Status = StatusLost
		return true
	}
	for i := range state.RedeployCooldown {
		if state.RedeployCooldown[i] > 0 {
			state.RedeployCooldown[i]--
		}
	}
	for i := range state.ActiveSkillCooldown {
		if state.ActiveSkillCooldown[i] > 0 {
			state.ActiveSkillCooldown[i]--
		}
	}
	for i := range state.Units {
		unit := &state.Units[i]
		if unit.SkillActive > 0 {
			unit.SkillActive--
		}
		if unit.AtkCooldown > 0 {
			unit.AtkCooldown--
		}
		// 仅 shield 单位推进 spTimer/sp（§12.7）。
		skill := data.Config.Units[unit.TypeIdx].Skill
		if skill != nil && skill.Kind == "shield" {
			unit.SpTimer++
			if unit.SpTimer >= 30 {
				unit.SpTimer = 0
				unit.Sp++
			}
		}
	}
	applyMapUnitHazards(data, state)
	state.CostAcc += state.RegenMilliPerSec
	state.CostMilli += state.CostAcc / 30
	state.CostAcc %= 30
	if state.CostMilli > eng.CostMaxMilli {
		state.CostMilli = eng.CostMaxMilli
	}
	stepWave(data, state)
	applyMapEnemyHazards(data, state)
	for i := range state.Units {
		unitAct(data, state, &state.Units[i])
	}
	for i := range state.Enemies {
		enemyAct(data, state, &state.Enemies[i])
	}
	sweep(data, state)
	checkWaveClear(data, state)
	// 败北判定仅在 status==playing 时执行：同帧 won 优先（§12.1）。
	if state.Status == StatusPlaying && state.Lives <= 0 {
		state.Status = StatusLost
	}
	return true
}

// HashState 按规格 §8 字段序折叠状态哈希；有符号值经两补码转 uint32。
// waveEvents、spawnCursor 与 waveHashes 不入哈希。
func HashState(state *GameState) uint32 {
	h := hashInit()
	mixInt := func(value int) {
		h = hashMixUint32(h, uint32(value))
	}
	mixInt(state.Frame)
	h = hashMixUint32(h, state.RngState)
	mixInt(state.Status)
	mixInt(state.CostMilli)
	mixInt(state.CostAcc)
	mixInt(state.Lives)
	mixInt(state.WaveIndex)
	mixInt(state.Phase)
	mixInt(state.IntermissionRemaining)
	mixInt(state.WaveFrame)
	mixInt(state.SpawnedInWave)
	mixInt(state.CoinPlan.Active)
	mixInt(state.CoinPlan.Frame)
	mixInt(state.CoinPlan.Path)
	if state.PendingBlessing != nil {
		mixInt(1)
		options := state.PendingBlessing.Options
		for i := 0; i < 3; i++ {
			if i < len(options) {
				mixInt(options[i])
			} else {
				h = hashMixUint32(h, 0xffffffff)
			}
		}
	} else {
		mixInt(0)
		for i := 0; i < 3; i++ {
			h = hashMixUint32(h, 0xffffffff)
		}
	}
	mixInt(state.BlessingsOwned)
	mixInt(state.RegenMilliPerSec)
	mixInt(state.MeleeHpBonusPm)
	mixInt(state.RangedAtkBonusPm)
	mixInt(state.NextWaveDebuffPm)
	mixInt(state.DebuffWave)
	mixInt(state.ScoreWaves)
	mixInt(state.ScoreKills)
	mixInt(state.ScoreLucky)
	mixInt(state.UnitSeq)
	mixInt(state.EnemySeq)
	for i := range state.RedeployCooldown {
		mixInt(state.RedeployCooldown[i])
	}
	for i := range state.ActiveSkillLevels {
		mixInt(state.ActiveSkillLevels[i])
	}
	for i := range state.ActiveSkillCooldown {
		mixInt(state.ActiveSkillCooldown[i])
	}
	mixInt(len(state.Units))
	for i := range state.Units {
		unit := &state.Units[i]
		mixInt(unit.ID)
		mixInt(unit.TypeIdx)
		mixInt(unit.Row)
		mixInt(unit.Col)
		mixInt(unit.Dir)
		mixInt(unit.HP)
		mixInt(unit.MaxHP)
		mixInt(unit.AtkCooldown)
		mixInt(unit.SpTimer)
		mixInt(unit.Sp)
		mixInt(unit.SkillActive)
		mixInt(unit.AttackCount)
	}
	mixInt(len(state.Enemies))
	for i := range state.Enemies {
		enemy := &state.Enemies[i]
		mixInt(enemy.ID)
		mixInt(enemy.TypeIdx)
		mixInt(enemy.PathIdx)
		mixInt(enemy.Progress)
		mixInt(enemy.HP)
		mixInt(enemy.MaxHP)
		mixInt(enemy.Atk)
		mixInt(enemy.Interval)
		mixInt(enemy.Def)
		mixInt(enemy.Res)
		mixInt(enemy.Speed)
		mixInt(enemy.DmgToBase)
		mixInt(enemy.Shield)
		mixInt(enemy.SkillCooldown)
		mixInt(enemy.TraitTier)
		mixInt(enemy.HazardAcc)
		mixInt(enemy.AtkCooldown)
		mixInt(enemy.BlockedBy)
		if enemy.Leaked {
			mixInt(1)
		} else {
			mixInt(0)
		}
	}
	return h
}

func Finalize(state *GameState) GameResult {
	data := mustEngineData()
	eng := &data.Config.Engine
	m := &data.Maps[state.MapIdx]
	livesScore := max(0, state.Lives) * eng.LivesScorePerLife
	raw := state.ScoreWaves + state.ScoreKills + state.ScoreLucky + livesScore
	total := min(eng.ScoreCap, pm(raw, m.Cfg.ScorePermyriad))
	wavesCleared := state.WaveIndex - 1
	if state.Status == StatusWon {
		wavesCleared = len(m.Cfg.Waves)
	}
	return GameResult{
		Status:       state.Status,
		Frames:       state.Frame,
		WavesCleared: wavesCleared,
		Score:        total,
		Breakdown: ScoreBreakdown{
			Waves: state.ScoreWaves,
			Kills: state.ScoreKills,
			Lucky: state.ScoreLucky,
			Lives: livesScore,
		},
	}
}

// Replay 校验并重放整局。pendingBlessing 冻结期间 frame 不增，故到期 bless 操作
// 与冻结帧同帧；祝福未决且无对应操作即失败（§9 快进语义）。
func Replay(input ReplayInput) ReplayOutput {
	data, err := GetEngineData()
	if err != nil {
		return ReplayOutput{Error: err.Error()}
	}
	fail := func(message string) ReplayOutput {
		return ReplayOutput{Error: message}
	}
	if len(input.Actions) > data.Config.Engine.MaxActions {
		return fail("操作数超过上限")
	}
	for i := range input.Actions {
		action := &input.Actions[i]
		if action.Frame < 0 {
			return fail("操作帧或序号非法")
		}
		if i > 0 {
			prev := &input.Actions[i-1]
			if action.Frame < prev.Frame || (action.Frame == prev.Frame && action.Seq <= prev.Seq) {
				return fail("操作未按 (frame, seq) 严格递增排序")
			}
		}
	}
	state, err := InitState(input.Seed, input.MapID, input.Squad)
	if err != nil {
		return fail(err.Error())
	}
	idx := 0
	for {
		for idx < len(input.Actions) && input.Actions[idx].Frame == state.Frame && state.Status == StatusPlaying {
			result := ApplyAction(state, input.Actions[idx])
			if !result.OK {
				return fail(fmt.Sprintf("第 %d 条操作被拒绝: %s", idx+1, result.Message))
			}
			idx++
		}
		if state.Status != StatusPlaying {
			break
		}
		if state.PendingBlessing != nil {
			return fail("祝福未决且没有对应的 bless 操作")
		}
		Tick(state)
	}
	if idx < len(input.Actions) {
		return fail("终局后仍有未应用的操作")
	}
	result := Finalize(state)
	return ReplayOutput{OK: true, State: state, Result: &result}
}
