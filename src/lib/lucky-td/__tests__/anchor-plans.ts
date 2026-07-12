// 幸运塔防 锚点站位计划：黄金向量、平衡探针与对账测试共用。
// dir 语义见规格 §7.2：0右 1下 2左 3上。

export interface DeployStep {
  unit: string;
  row: number;
  col: number;
  dir: number;
}

export const TRAINING_SQUAD = ['vanguard', 'defender', 'ranger', 'archer', 'caster', 'medic'];
export const TRAINING_PLAN: DeployStep[] = [
  { unit: 'vanguard', row: 1, col: 5, dir: 2 },
  { unit: 'defender', row: 3, col: 8, dir: 2 },
  { unit: 'ranger', row: 6, col: 8, dir: 2 },
  { unit: 'caster', row: 2, col: 9, dir: 2 },
  { unit: 'archer', row: 4, col: 9, dir: 2 },
  { unit: 'medic', row: 7, col: 10, dir: 2 },
];

export const BROOK_SQUAD = ['vanguard', 'thornwarden', 'flameblade', 'stormsniper', 'venomwitch', 'sunpriest'];
export const BROOK_PLAN: DeployStep[] = [
  { unit: 'vanguard', row: 4, col: 14, dir: 2 },
  { unit: 'thornwarden', row: 5, col: 11, dir: 2 },
  { unit: 'flameblade', row: 7, col: 5, dir: 2 },
  { unit: 'stormsniper', row: 3, col: 12, dir: 2 },
  { unit: 'venomwitch', row: 6, col: 4, dir: 0 },
  { unit: 'sunpriest', row: 6, col: 13, dir: 2 },
];

export const STARLAMP_SQUAD = ['vanguard', 'thornwarden', 'ranger', 'stormsniper', 'venomwitch', 'sunpriest'];
export const STARLAMP_PLAN: DeployStep[] = [
  { unit: 'vanguard', row: 2, col: 6, dir: 2 },
  { unit: 'thornwarden', row: 7, col: 6, dir: 2 },
  { unit: 'ranger', row: 5, col: 10, dir: 3 },
  { unit: 'stormsniper', row: 1, col: 4, dir: 0 },
  { unit: 'venomwitch', row: 3, col: 5, dir: 0 },
  { unit: 'sunpriest', row: 5, col: 6, dir: 2 },
];

export const FROSTFIRE_SQUAD = ['vanguard', 'thornwarden', 'ranger', 'stormsniper', 'venomwitch', 'sunpriest'];
export const FROSTFIRE_PLAN: DeployStep[] = [
  { unit: 'vanguard', row: 5, col: 8, dir: 2 },
  { unit: 'thornwarden', row: 4, col: 10, dir: 2 },
  { unit: 'ranger', row: 6, col: 10, dir: 2 },
  { unit: 'stormsniper', row: 7, col: 10, dir: 3 },
  { unit: 'venomwitch', row: 3, col: 12, dir: 1 },
  { unit: 'sunpriest', row: 4, col: 6, dir: 0 },
];

export const RUBBLEMIST_SQUAD = ['vanguard', 'thornwarden', 'flameblade', 'stormsniper', 'venomwitch', 'sunpriest'];
export const RUBBLEMIST_PLAN: DeployStep[] = [
  { unit: 'vanguard', row: 5, col: 8, dir: 2 },
  { unit: 'thornwarden', row: 6, col: 8, dir: 2 },
  { unit: 'flameblade', row: 8, col: 8, dir: 2 },
  { unit: 'stormsniper', row: 4, col: 10, dir: 2 },
  { unit: 'venomwitch', row: 4, col: 9, dir: 0 },
  { unit: 'sunpriest', row: 6, col: 13, dir: 2 },
];

export const THUNDERVOID_SQUAD = ['vanguard', 'defender', 'thornwarden', 'stormsniper', 'venomwitch', 'sunpriest'];
export const THUNDERVOID_PLAN: DeployStep[] = [
  { unit: 'vanguard', row: 4, col: 8, dir: 2 },
  { unit: 'defender', row: 4, col: 10, dir: 2 },
  { unit: 'thornwarden', row: 5, col: 10, dir: 2 },
  { unit: 'stormsniper', row: 6, col: 7, dir: 0 },
  { unit: 'venomwitch', row: 3, col: 6, dir: 0 },
  { unit: 'sunpriest', row: 1, col: 7, dir: 1 },
];

export const KOI_SQUAD = ['flameblade', 'koi', 'archer', 'medic', 'vanguard'];
export const KOI_PLAN: DeployStep[] = [
  { unit: 'flameblade', row: 1, col: 5, dir: 2 },
  { unit: 'vanguard', row: 3, col: 5, dir: 2 },
  { unit: 'koi', row: 2, col: 9, dir: 2 },
  { unit: 'archer', row: 4, col: 9, dir: 2 },
  { unit: 'medic', row: 7, col: 10, dir: 2 },
];

export const ANCHORS: Record<string, { squad: string[]; plan: DeployStep[] }> = {
  training_field: { squad: TRAINING_SQUAD, plan: TRAINING_PLAN },
  brook_ford: { squad: BROOK_SQUAD, plan: BROOK_PLAN },
  starlamp_outpost: { squad: STARLAMP_SQUAD, plan: STARLAMP_PLAN },
  frostfire_fault: { squad: FROSTFIRE_SQUAD, plan: FROSTFIRE_PLAN },
  rubblemist_plateau: { squad: RUBBLEMIST_SQUAD, plan: RUBBLEMIST_PLAN },
  thundervoid_gate: { squad: THUNDERVOID_SQUAD, plan: THUNDERVOID_PLAN },
};
