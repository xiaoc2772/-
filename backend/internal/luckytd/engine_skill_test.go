package luckytd

import "testing"

func TestActiveSkillUpgradeUseAndCooldown(t *testing.T) {
	state, err := InitState("active-skill-check", "training_field", []string{
		"vanguard", "defender", "ranger", "archer", "caster", "medic",
	})
	if err != nil {
		t.Fatalf("初始化失败: %v", err)
	}
	data, err := GetEngineData()
	if err != nil {
		t.Fatalf("加载配置失败: %v", err)
	}
	vanguardIdx := data.UnitIDToIdx["vanguard"]

	deploy := ApplyAction(state, GameAction{
		Frame: 0,
		Seq:   0,
		Type:  "deploy",
		Unit:  intPtr(vanguardIdx),
		Row:   intPtr(1),
		Col:   intPtr(5),
		Dir:   intPtr(0),
	})
	if !deploy.OK {
		t.Fatalf("部署被拒绝: %s", deploy.Message)
	}
	unitID := state.Units[0].ID
	afterDeployCost := state.CostMilli

	if got := state.ActiveSkillCooldown[vanguardIdx]; got != 720 {
		t.Fatalf("部署后技能冷却不符: got %d, want 720", got)
	}
	if immediate := ApplyAction(state, GameAction{
		Frame:  0,
		Seq:    1,
		Type:   "skill",
		UnitID: intPtr(unitID),
	}); immediate.OK {
		t.Fatal("部署后立刻释放技能应被拒绝")
	}
	if got := state.CostMilli; got != afterDeployCost {
		t.Fatalf("被拒绝后费用不应变化: got %d, want %d", got, afterDeployCost)
	}

	Tick(state)
	if got := state.ActiveSkillCooldown[vanguardIdx]; got != 719 {
		t.Fatalf("冷却递减不符: got %d, want 719", got)
	}
	for i := 0; i < 719; i++ {
		Tick(state)
	}
	if got := state.ActiveSkillCooldown[vanguardIdx]; got != 0 {
		t.Fatalf("冷却归零不符: got %d, want 0", got)
	}

	beforeFirstSkillCost := state.CostMilli
	firstSkill := ApplyAction(state, GameAction{
		Frame:  state.Frame,
		Seq:    2,
		Type:   "skill",
		UnitID: intPtr(unitID),
	})
	if !firstSkill.OK {
		t.Fatalf("释放 1 级技能被拒绝: %s", firstSkill.Message)
	}
	if got := state.CostMilli; got != beforeFirstSkillCost+6000 {
		t.Fatalf("释放 1 级技能后费用不符: got %d, want %d", got, beforeFirstSkillCost+6000)
	}
	if got := state.ActiveSkillCooldown[vanguardIdx]; got != 720 {
		t.Fatalf("技能冷却不符: got %d, want 720", got)
	}
	if again := ApplyAction(state, GameAction{Frame: state.Frame, Seq: 3, Type: "skill", UnitID: intPtr(unitID)}); again.OK {
		t.Fatal("冷却中重复释放应被拒绝")
	}

	beforeUpgradeCost := state.CostMilli
	upgrade := ApplyAction(state, GameAction{
		Frame:  state.Frame,
		Seq:    4,
		Type:   "skillUpgrade",
		UnitID: intPtr(unitID),
	})
	if !upgrade.OK {
		t.Fatalf("升级技能被拒绝: %s", upgrade.Message)
	}
	if got := state.ActiveSkillLevels[vanguardIdx]; got != 2 {
		t.Fatalf("技能等级不符: got %d, want 2", got)
	}
	if got := state.CostMilli; got != beforeUpgradeCost-20000 {
		t.Fatalf("升级后费用不符: got %d, want %d", got, beforeUpgradeCost-20000)
	}

	for i := 0; i < 720; i++ {
		Tick(state)
	}
	if got := state.ActiveSkillCooldown[vanguardIdx]; got != 0 {
		t.Fatalf("二次冷却归零不符: got %d, want 0", got)
	}
	beforeSkillCost := state.CostMilli
	useSkill := ApplyAction(state, GameAction{
		Frame:  state.Frame,
		Seq:    5,
		Type:   "skill",
		UnitID: intPtr(unitID),
	})
	if !useSkill.OK {
		t.Fatalf("释放技能被拒绝: %s", useSkill.Message)
	}
	wantSkillCost := min(data.Config.Engine.CostMaxMilli, beforeSkillCost+6800)
	if got := state.CostMilli; got != wantSkillCost {
		t.Fatalf("释放后费用不符: got %d, want %d", got, wantSkillCost)
	}
	wantCooldown := activeSkillCooldownFor(vanguardIdx, state.ActiveSkillLevels[vanguardIdx])
	if got := state.ActiveSkillCooldown[vanguardIdx]; got != wantCooldown {
		t.Fatalf("技能冷却不符: got %d, want %d", got, wantCooldown)
	}
}
