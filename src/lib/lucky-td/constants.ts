export const MAX_SQUAD_SIZE = 9;
export const SQUAD_REWARD_BONUS_PER_MISSING_PERMYRIAD = 800;
export const LUCKY_TD_WIN_SCORE = 600;

function clampSquadSize(squadSize: number): number {
  if (!Number.isFinite(squadSize)) {
    return MAX_SQUAD_SIZE;
  }
  return Math.min(MAX_SQUAD_SIZE, Math.max(1, Math.floor(squadSize)));
}

export function squadBonusPermyriad(squadSize: number): number {
  const size = clampSquadSize(squadSize);
  return 10000 + (MAX_SQUAD_SIZE - size) * SQUAD_REWARD_BONUS_PER_MISSING_PERMYRIAD;
}

export function pointRewardForScore(score: number, squadSize: number): number {
  if (!Number.isFinite(score) || score <= 0) {
    return 0;
  }
  return Math.floor((Math.floor(score) * squadBonusPermyriad(squadSize)) / 10000);
}
