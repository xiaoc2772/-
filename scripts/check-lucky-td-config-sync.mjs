// 校验幸运塔防配置的前端源文件与 Go embed 副本字节一致，并做最小 schema 检查。
// 用法：node scripts/check-lucky-td-config-sync.mjs
import { readFileSync } from 'node:fs';

const FRONTEND_PATH = 'src/lib/lucky-td/config/lucky-td-config.json';
const BACKEND_PATH = 'backend/internal/luckytd/config/lucky-td-config.json';

function fail(message) {
  console.error(`[lucky-td-config-sync] FAIL: ${message}`);
  process.exit(1);
}

let frontendRaw;
let backendRaw;
try {
  frontendRaw = readFileSync(FRONTEND_PATH);
} catch {
  fail(`missing ${FRONTEND_PATH}`);
}
try {
  backendRaw = readFileSync(BACKEND_PATH);
} catch {
  fail(`missing ${BACKEND_PATH}（请执行: cp ${FRONTEND_PATH} ${BACKEND_PATH}）`);
}

if (!frontendRaw.equals(backendRaw)) {
  fail(`两份配置字节不一致（请执行: cp ${FRONTEND_PATH} ${BACKEND_PATH} 并重新生成黄金向量）`);
}

const config = JSON.parse(frontendRaw.toString('utf8'));
if (!Number.isInteger(config.version) || config.version < 1) {
  fail('version 字段缺失或非法');
}
if (config.units?.length !== 18 || config.enemies?.length !== 8 || config.blessings?.length < 12 || config.maps?.length !== 6) {
  fail('units/enemies/blessings/maps 数量与规格不符');
}
for (const unit of config.units) {
  if (!Array.isArray(unit.rangeCells) || !Array.isArray(unit.auraCells) || 'range' in unit || 'auraRange' in unit) {
    fail(`单位 ${unit.id} 射程字段不符合 v3 schema（需 rangeCells/auraCells，禁 range/auraRange）`);
  }
}
for (const map of config.maps) {
  if (!Array.isArray(map.flightPaths) || map.flightPaths.length < 1) {
    fail(`地图 ${map.id} 缺少飞行路线 flightPaths`);
  }
  if (map.waves?.length !== 30 || map.waveHpPermyriad?.length !== 30) {
    fail(`地图 ${map.id} 波次表或 HP 曲线不是 30 项`);
  }
}

console.log(`[lucky-td-config-sync] OK: version=${config.version}, ${frontendRaw.length} bytes, 双端字节一致`);
