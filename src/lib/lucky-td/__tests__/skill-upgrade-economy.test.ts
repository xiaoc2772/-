// 满编技能升级经济契约：按标准连续推进节奏，最快第 28 波、最迟第 30 波满级。

import { describe, expect, it } from 'vitest';
import { ACTIVE_SKILLS } from '../engine/active-skills';
import { getEngineData } from '../engine/data';

const DATA = getEngineData();
const SQUAD_SIZE = 9;
// 经济角色整局预期创造费用；定价时从总支出中抵消，比较不同阵容的净升级负担。
const EXPECTED_GENERATED_COST: Record<string, number> = {
  vanguard: 330,
  koi: 280,
  banner: 180,
  engineer: 320,
};
const WAVE_27_BUDGET = 1420;
const WAVE_28_BUDGET = 1470;
const WAVE_30_BUDGET = 1650;

function combinations(count: number, choose: number): number[][] {
  const out: number[][] = [];
  const current: number[] = [];
  const visit = (start: number): void => {
    if (current.length === choose) {
      out.push([...current]);
      return;
    }
    for (let idx = start; idx <= count - (choose - current.length); idx += 1) {
      current.push(idx);
      visit(idx + 1);
      current.pop();
    }
  };
  visit(0);
  return out;
}

function netFullBuildCost(squad: number[]): number {
  return squad.reduce((sum, idx) => {
    const unit = DATA.config.units[idx];
    const upgrades = ACTIVE_SKILLS[idx].upgradeCosts.reduce((skillSum, cost) => skillSum + cost, 0);
    return sum + unit.cost + upgrades - (EXPECTED_GENERATED_COST[unit.id] ?? 0);
  }, 0);
}

describe('lucky-td 满编技能升级经济', () => {
  it('81 次升级的净费用落在第 28~30 波经济窗口', () => {
    expect(ACTIVE_SKILLS.every((skill) => skill.upgradeCosts.length === 9)).toBe(true);
    expect(ACTIVE_SKILLS.every((skill) => skill.upgradeCosts.every((cost) => cost > 0 && cost <= 99))).toBe(true);
    const totals = combinations(DATA.config.units.length, SQUAD_SIZE).map(netFullBuildCost);
    expect(totals).toHaveLength(48620);
    const cheapest = Math.min(...totals);
    const mostExpensive = Math.max(...totals);
    expect(cheapest).toBeGreaterThan(WAVE_27_BUDGET);
    expect(cheapest).toBeLessThanOrEqual(WAVE_28_BUDGET);
    expect(mostExpensive).toBeLessThanOrEqual(WAVE_30_BUDGET);
  });
});
