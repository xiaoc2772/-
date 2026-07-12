// 幸运塔防 配置装载与地图预计算。契约见 docs/lucky-td-engine-spec.md §3。
// 预计算结果只做只读查询；集合仅用于成员判定，禁止依赖其遍历顺序。

import rawConfig from '../config/lucky-td-config.json';
import { ACTIVE_SKILLS, ACTIVE_SKILL_MAX_LEVEL, skillLevelRangeRadius } from './active-skills';
import type { LuckyTdConfig, MapConfig } from './types';

export interface PathCell {
  row: number;
  col: number;
  key: number;
  centerProgress: number;
}

export interface PrecomputedPath {
  /** 途经格（按 progress 升序；重复格只保留首次） */
  cells: PathCell[];
  /** 拐点 milli 坐标与累计 progress */
  waypoints: { x: number; y: number; cum: number }[];
  lengthMilli: number;
  spawnKey: number;
  exitKey: number;
}

export interface PrecomputedMap {
  cfg: MapConfig;
  paths: PrecomputedPath[];
  flightPaths: PrecomputedPath[];
  meleeCellSet: Set<number>;
  rangedCellSet: Set<number>;
  mechanicCellSets: Record<string, Set<number>>;
}

export interface EngineData {
  config: LuckyTdConfig;
  maps: PrecomputedMap[];
  mapIdToIdx: Record<string, number>;
  unitIdToIdx: Record<string, number>;
  coinEnemyIdx: number;
  /** [typeIdx][dir] → 旋转后相对偏移键集合（键 = offsetKey） */
  unitRangeSets: Set<number>[][];
  /** [typeIdx][level-1][dir] → 技能等级成长后的攻击/治疗范围集合 */
  unitRangeLevelSets: Set<number>[][][];
  /** [typeIdx] → 光环相对偏移键集合（无方向） */
  auraSets: Set<number>[];
  /** [typeIdx][level-1] → 技能等级成长后的光环范围集合 */
  auraLevelSets: Set<number>[][];
}

export function cellKey(row: number, col: number): number {
  return row * 1000 + col;
}

/** 相对偏移键。域约束：|dCol| < 50（模板偏移 ≤12、地图 cols ≤13），无碰撞。 */
export function offsetKey(dRow: number, dCol: number): number {
  return dRow * 100 + dCol;
}

/** 朝右（dir=0）基准偏移顺时针旋转 dir 次，每次 (dr,dc)→(dc,−dr)。契约见规格 §7.2/§12.14。 */
export function rotateOffset(dRow: number, dCol: number, dir: number): [number, number] {
  let dr = dRow;
  let dc = dCol;
  for (let k = 0; k < (dir & 3); k += 1) {
    const t = dr;
    dr = dc;
    dc = 0 - t;
  }
  return [dr, dc];
}

function expandCells(cells: number[][], radius: number, dir: number | null): Set<number> {
  const set = new Set<number>();
  for (const [dr, dc] of cells) {
    const [baseRow, baseCol] = dir === null ? [dr, dc] : rotateOffset(dr, dc, dir);
    for (let er = -radius; er <= radius; er += 1) {
      const horizontal = radius - Math.abs(er);
      for (let ec = -horizontal; ec <= horizontal; ec += 1) {
        set.add(offsetKey(baseRow + er, baseCol + ec));
      }
    }
  }
  return set;
}

/** 普通角色仅向基准朝向的左、右、前方扩展，旋转后仍不会生成身后格。 */
function expandForwardCells(cells: number[][], stages: number, dir: number): Set<number> {
  let current = new Set(cells.map(([dr, dc]) => offsetKey(dr, dc)));
  for (let stage = 0; stage < stages; stage += 1) {
    const next = new Set(current);
    for (const key of current) {
      const dr = Math.round(key / 100);
      const dc = key - dr * 100;
      next.add(offsetKey(dr - 1, dc));
      next.add(offsetKey(dr + 1, dc));
      next.add(offsetKey(dr, dc + 1));
    }
    current = next;
  }
  const rotated = new Set<number>();
  for (const key of current) {
    const dr = Math.round(key / 100);
    const dc = key - dr * 100;
    const [row, col] = rotateOffset(dr, dc, dir);
    rotated.add(offsetKey(row, col));
  }
  return rotated;
}

function buildPath(points: number[][], rows: number, cols: number): PrecomputedPath {
  if (points.length < 2) {
    throw new Error('lucky-td config: path needs at least 2 waypoints');
  }
  const cells: PathCell[] = [];
  const seen = new Set<number>();
  const waypoints: { x: number; y: number; cum: number }[] = [];
  let cum = 0;
  const pushCell = (row: number, col: number, progress: number) => {
    if (row < 0 || row >= rows || col < 0 || col >= cols) {
      throw new Error(`lucky-td config: path cell out of bounds (${row},${col})`);
    }
    const key = cellKey(row, col);
    if (!seen.has(key)) {
      seen.add(key);
      cells.push({ row, col, key, centerProgress: progress });
    }
  };
  for (let i = 0; i < points.length; i += 1) {
    const [row, col] = points[i];
    waypoints.push({ x: col * 1000 + 500, y: row * 1000 + 500, cum });
    if (i === 0) {
      pushCell(row, col, 0);
      continue;
    }
    const [prevRow, prevCol] = points[i - 1];
    if (prevRow !== row && prevCol !== col) {
      throw new Error('lucky-td config: path segment must be axis-aligned');
    }
    const steps = Math.abs(prevRow - row) + Math.abs(prevCol - col);
    const dRow = Math.sign(row - prevRow);
    const dCol = Math.sign(col - prevCol);
    for (let s = 1; s <= steps; s += 1) {
      cum += 1000;
      pushCell(prevRow + dRow * s, prevCol + dCol * s, cum);
    }
    waypoints[waypoints.length - 1].cum = cum;
  }
  return {
    cells,
    waypoints,
    lengthMilli: cum,
    spawnKey: cellKey(points[0][0], points[0][1]),
    exitKey: cellKey(points[points.length - 1][0], points[points.length - 1][1]),
  };
}

function buildMap(cfg: MapConfig, unitCount: number, enemyCount: number): PrecomputedMap {
  const paths = cfg.paths.map((points) => buildPath(points, cfg.rows, cfg.cols));
  const flightPathPoints = cfg.flightPaths && cfg.flightPaths.length > 0 ? cfg.flightPaths : cfg.paths;
  const flightPaths = flightPathPoints.map((points) => buildPath(points, cfg.rows, cfg.cols));
  const meleeCellSet = new Set<number>();
  for (const path of paths) {
    for (const cell of path.cells) {
      meleeCellSet.add(cell.key);
    }
  }
  for (const path of paths) {
    meleeCellSet.delete(path.spawnKey);
    meleeCellSet.delete(path.exitKey);
  }
  const rangedCellSet = new Set<number>();
  for (const [row, col] of cfg.rangedCells) {
    if (row < 0 || row >= cfg.rows || col < 0 || col >= cfg.cols) {
      throw new Error(`lucky-td config: ranged cell out of bounds (${row},${col})`);
    }
    const key = cellKey(row, col);
    if (meleeCellSet.has(key)) {
      throw new Error(`lucky-td config: ranged cell overlaps path (${row},${col})`);
    }
    rangedCellSet.add(key);
  }
  const mechanicCellSets: Record<string, Set<number>> = {};
  for (const mechanic of cfg.mechanics ?? []) {
    const set = new Set<number>();
    for (const [row, col] of mechanic.cells ?? []) {
      if (row < 0 || row >= cfg.rows || col < 0 || col >= cfg.cols) {
        throw new Error(`lucky-td config: mechanic ${mechanic.id} cell out of bounds (${row},${col})`);
      }
      set.add(cellKey(row, col));
    }
    mechanicCellSets[mechanic.id] = set;
  }
  if (cfg.waveHpPermyriad.length !== cfg.waves.length) {
    throw new Error(`lucky-td config: map ${cfg.id} waveHp length mismatch`);
  }
  cfg.waves.forEach((wave, waveIdx) => {
    for (const event of wave) {
      if (event.length !== 5) {
        throw new Error(`lucky-td config: map ${cfg.id} wave ${waveIdx + 1} malformed event`);
      }
      const [delay, enemyIdx, pathIdx, count, interval] = event;
      if (delay < 0 || enemyIdx < 0 || enemyIdx >= enemyCount || pathIdx < 0 || pathIdx >= paths.length || count < 1 || interval < 1) {
        throw new Error(`lucky-td config: map ${cfg.id} wave ${waveIdx + 1} invalid event values`);
      }
    }
  });
  if (unitCount < 1) {
    throw new Error('lucky-td config: no units');
  }
  return { cfg, paths, flightPaths, meleeCellSet, rangedCellSet, mechanicCellSets };
}

let cached: EngineData | null = null;

export function getEngineData(): EngineData {
  if (cached) {
    return cached;
  }
  const config = rawConfig as unknown as LuckyTdConfig;
  if (config.units.length < 8 || config.enemies.length < 7 || config.blessings.length < 6) {
    throw new Error('lucky-td config: units/enemies/blessings count mismatch');
  }
  if (ACTIVE_SKILLS.length < config.units.length) {
    throw new Error('lucky-td config: active skills count mismatch');
  }
  const maps = config.maps.map((mapCfg) => buildMap(mapCfg, config.units.length, config.enemies.length));
  const mapIdToIdx: Record<string, number> = {};
  config.maps.forEach((mapCfg, idx) => {
    mapIdToIdx[mapCfg.id] = idx;
  });
  const unitIdToIdx: Record<string, number> = {};
  config.units.forEach((unit, idx) => {
    unitIdToIdx[unit.id] = idx;
  });
  const coinEnemyIdx = config.enemies.findIndex((enemy) => enemy.id === 'coin');
  if (coinEnemyIdx < 0) {
    throw new Error('lucky-td config: coin enemy missing');
  }
  const validateCells = (unitId: string, field: string, cells: number[][]): void => {
    for (const cell of cells) {
      if (
        cell.length !== 2 ||
        !Number.isInteger(cell[0]) ||
        !Number.isInteger(cell[1]) ||
        Math.abs(cell[0]) > 12 ||
        Math.abs(cell[1]) > 12
      ) {
        throw new Error(`lucky-td config: unit ${unitId} ${field} invalid offset`);
      }
    }
  };
  const unitRangeLevelSets = config.units.map((unit) => {
    validateCells(unit.id, 'rangeCells', unit.rangeCells);
    if (unit.atkType !== 'none' && unit.rangeCells.length === 0) {
      throw new Error(`lucky-td config: unit ${unit.id} rangeCells empty`);
    }
    const symmetricRange = unit.atkType === 'heal' || unit.auraCells.length > 0;
    return Array.from({ length: ACTIVE_SKILL_MAX_LEVEL }, (_, levelIdx) =>
      [0, 1, 2, 3].map((dir) => {
        const stage = skillLevelRangeRadius(levelIdx + 1);
        return symmetricRange ? expandCells(unit.rangeCells, stage, dir) : expandForwardCells(unit.rangeCells, stage, dir);
      }),
    );
  });
  const unitRangeSets = unitRangeLevelSets.map((sets) => sets[0]);
  const auraLevelSets = config.units.map((unit) => {
    validateCells(unit.id, 'auraCells', unit.auraCells);
    return Array.from({ length: ACTIVE_SKILL_MAX_LEVEL }, (_, levelIdx) =>
      expandCells(unit.auraCells, skillLevelRangeRadius(levelIdx + 1), null),
    );
  });
  const auraSets = auraLevelSets.map((sets) => sets[0]);
  cached = { config, maps, mapIdToIdx, unitIdToIdx, coinEnemyIdx, unitRangeSets, unitRangeLevelSets, auraSets, auraLevelSets };
  return cached;
}

/** 沿路径按 progress 求 milli 坐标（两端实现必须一致：线性走拐点段）。 */
export function positionOnPath(path: PrecomputedPath, progress: number): { x: number; y: number } {
  const clamped = progress < 0 ? 0 : progress > path.lengthMilli ? path.lengthMilli : progress;
  const { waypoints } = path;
  for (let i = waypoints.length - 1; i >= 0; i -= 1) {
    const wp = waypoints[i];
    if (clamped >= wp.cum) {
      if (i === waypoints.length - 1) {
        return { x: wp.x, y: wp.y };
      }
      const next = waypoints[i + 1];
      const span = next.cum - wp.cum;
      const offset = clamped - wp.cum;
      if (span === 0) {
        return { x: wp.x, y: wp.y };
      }
      const dx = next.x === wp.x ? 0 : next.x > wp.x ? 1 : -1;
      const dy = next.y === wp.y ? 0 : next.y > wp.y ? 1 : -1;
      return { x: wp.x + dx * offset, y: wp.y + dy * offset };
    }
  }
  return { x: waypoints[0].x, y: waypoints[0].y };
}
