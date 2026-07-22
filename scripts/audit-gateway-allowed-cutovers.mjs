import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const gatewayPath = path.join(repoRoot, 'gateway', 'Caddyfile');

const allowedApiCutovers = [
  '/healthz',
  '/readyz',
  '/api/auth/login',
  '/api/auth/me',
  '/api/auth/logout',
  '/api/checkin',
  '/api/checkin/makeup',
  '/api/points',
  '/api/rankings/eco',
  '/api/rankings/points',
  '/api/rankings/games',
  '/api/rankings/checkin-streak',
  '/api/rankings/history',
  '/api/admin/rankings/settle',
  '/api/games/overview',
  '/api/games/profile',
  '/api/profile/overview',
  '/api/profile/settings',
  '/api/profile/achievements/equip',
  '/api/notifications',
  '/api/notifications/unread-count',
  '/api/notifications/read',
  '/api/notifications/delete',
  '/api/notifications/claim',
  '/api/announcements',
  '/api/admin/announcements',
  '/api/admin/announcements/*',
  '/api/lottery',
  '/api/lottery/spin',
  '/api/lottery/records',
  '/api/lottery/ranking',
  '/api/lottery/number-bomb',
  '/api/lottery/number-bomb/bet',
  '/api/lottery/number-bomb/cancel',
  '/api/rankings/lottery',
  '/api/admin/lottery',
  '/api/admin/lottery/config',
  '/api/admin/lottery/number-bomb',
  '/api/admin/lottery/debug',
  '/api/admin/lottery/recalculate',
  '/api/admin/lottery/reset',
  '/api/admin/lottery/tiers/*',
  '/api/farm/status',
  '/api/farm/shop',
  '/api/farm/plant',
  '/api/farm/water',
  '/api/farm/water-all',
  '/api/farm/harvest',
  '/api/farm/harvest-all',
  '/api/farm/remove',
  '/api/farm/buy-land',
  '/api/farm/shop/buy',
  '/api/farm/seeds/buy',
  '/api/farm/shop/use',
  '/api/farm/pet/adopt',
  '/api/farm/pet/feed',
  '/api/farm/pet/wash',
  '/api/farm/pet/drink',
  '/api/farm/pet/play',
  '/api/farm/pet/dispatch',
  '/api/farm/steal/list',
  '/api/farm/steal/do',
  '/api/games/eco/status',
  '/api/games/eco/collect',
  '/api/games/eco/buy',
  '/api/games/eco/claim-prize',
  '/api/games/eco/sell',
  '/api/games/eco/merchant-sell',
  '/api/games/eco/black-market-sell',
  '/api/games/eco/steal',
  '/api/games/memory/status',
  '/api/games/memory/start',
  '/api/games/memory/flip',
  '/api/games/memory/submit',
  '/api/games/memory/cancel',
  '/api/games/match3/status',
  '/api/games/match3/start',
  '/api/games/match3/submit',
  '/api/games/match3/cancel',
  '/api/games/whack-mole/status',
  '/api/games/whack-mole/sync',
  '/api/games/whack-mole/start',
  '/api/games/whack-mole/submit',
  '/api/games/whack-mole/cancel',
  '/api/games/minesweeper/status',
  '/api/games/minesweeper/start',
  '/api/games/minesweeper/step',
  '/api/games/minesweeper/submit',
  '/api/games/minesweeper/cancel',
  '/api/games/piano-tiles/status',
  '/api/games/piano-tiles/personal-bests',
  '/api/games/piano-tiles/start',
  '/api/games/piano-tiles/checkpoint',
  '/api/games/piano-tiles/submit',
  '/api/games/piano-tiles/cancel',
  '/api/games/linkgame/status',
  '/api/games/linkgame/start',
  '/api/games/linkgame/submit',
  '/api/games/linkgame/cancel',
  '/api/games/roguelite/status',
  '/api/games/roguelite/start',
  '/api/games/roguelite/step',
  '/api/games/roguelite/submit',
  '/api/games/roguelite/cancel',
  '/api/games/2048/status',
  '/api/games/2048/start',
  '/api/games/2048/checkpoint',
  '/api/games/2048/submit',
  '/api/games/2048/cancel',
  '/api/games/lucky-td/status',
  '/api/games/lucky-td/start',
  '/api/games/lucky-td/checkpoint',
  '/api/games/lucky-td/submit',
  '/api/games/lucky-td/cancel',
  '/api/store',
  '/api/store/exchange',
  '/api/store/topup',
  '/api/store/withdraw',
  '/api/store/admin',
  '/api/admin/store/reset',
  '/api/cards/inventory',
  '/api/cards/rules',
  '/api/cards/draw',
  '/api/cards/purchase',
  '/api/cards/exchange',
  '/api/cards/claim-reward',
  '/api/admin/cards/users',
  '/api/admin/cards/user/*',
  '/api/admin/cards/reset',
  '/api/admin/cards/albums',
  '/api/admin/cards/rules',
  '/api/feedback',
  '/api/feedback/*',
  '/api/admin/raffle',
  '/api/admin/raffle/*',
  '/api/admin/eco',
  '/api/admin/points',
  '/api/admin/users',
  '/api/admin/users/*',
  '/api/admin/sync-users',
  '/api/admin/fix-codes-count',
  '/api/admin/migrate-native-hot-data',
  '/api/admin/migrate-new-user-eligibility',
  '/api/admin/dashboard',
  '/api/admin/alerts',
  '/api/admin/alerts/*',
  '/api/admin/config',
  '/api/admin/rewards',
  '/api/admin/rewards/*',
  '/api/admin/projects',
  '/api/admin/projects/*',
  '/api/admin/feedback',
  '/api/admin/feedback/*',
  '/api/projects',
  '/api/projects/my-claims',
  '/api/projects/*',
  '/api/raffle',
  '/api/raffle/*',
];

const allowedApiProxyTargets = new Set([
  'api:8080',
  '{$API_UPSTREAM:api:8080}',
]);
const allowedWebProxyTargets = new Set([
  'web:3000',
  '{$WEB_UPSTREAM:web:3000}',
]);

function countBraces(line) {
  return (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
}

function parseHandleBlocks(caddyfile) {
  const activeLines = caddyfile
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'));

  const blocks = [];
  const violations = [];
  let current = null;
  let braceDepth = 0;

  for (const entry of activeLines) {
    const handleMatch = entry.line.match(/^(handle|handle_path)(?:\s+([^\s{]+))?\s*\{/);

    if (!current && handleMatch) {
      const [, directive, matcher = null] = handleMatch;
      if (directive === 'handle_path') {
        violations.push({
          lineNumber: entry.lineNumber,
          line: entry.line,
          reason: 'Gateway 切流必须使用 handle 精确规则，禁止 handle_path 改写路径',
        });
      }
      current = {
        directive,
        matcher,
        lineNumber: entry.lineNumber,
        reverseProxyTargets: [],
      };
      braceDepth = countBraces(entry.line);
    } else if (!current && /^reverse_proxy\s+/.test(entry.line)) {
      violations.push({
        lineNumber: entry.lineNumber,
        line: entry.line,
        reason: 'reverse_proxy 必须位于明确的 handle 块内',
      });
      continue;
    } else if (current) {
      const proxyMatch = entry.line.match(/^reverse_proxy\s+([^\s]+)/);
      if (proxyMatch) {
        current.reverseProxyTargets.push({
          target: proxyMatch[1],
          lineNumber: entry.lineNumber,
        });
      }
      braceDepth += countBraces(entry.line);
    }

    if (current && braceDepth <= 0) {
      blocks.push(current);
      current = null;
    }
  }

  if (current) {
    violations.push({
      lineNumber: current.lineNumber,
      line: `${current.directive} ${current.matcher || ''}`.trim(),
      reason: 'handle 块没有正常闭合',
    });
  }

  return { blocks, violations };
}

const caddyfile = readFileSync(gatewayPath, 'utf8');
const { blocks, violations } = parseHandleBlocks(caddyfile);

const apiCutovers = [];
for (const block of blocks) {
  const unknownTargets = block.reverseProxyTargets
    .filter((proxy) => !allowedApiProxyTargets.has(proxy.target) && !allowedWebProxyTargets.has(proxy.target));
  for (const proxy of unknownTargets) {
    violations.push({
      lineNumber: proxy.lineNumber,
      line: `reverse_proxy ${proxy.target}`,
      reason: 'Gateway 只能转发到 API_UPSTREAM 或 WEB_UPSTREAM',
    });
  }

  const apiTargets = block.reverseProxyTargets.filter((proxy) => allowedApiProxyTargets.has(proxy.target));
  if (apiTargets.length === 0) {
    continue;
  }
  if (!block.matcher) {
    violations.push({
      lineNumber: block.lineNumber,
      line: 'handle',
      reason: '转发到 api:8080 的规则必须有精确路径 matcher',
    });
    continue;
  }
  apiCutovers.push({
    path: block.matcher,
    lineNumber: block.lineNumber,
  });
}

const expected = new Set(allowedApiCutovers);
const actual = new Set(apiCutovers.map((entry) => entry.path));
const missingAllowedCutovers = allowedApiCutovers.filter((route) => !actual.has(route));
const unexpectedApiCutovers = apiCutovers
  .filter((entry) => !expected.has(entry.path))
  .map((entry) => `${entry.path} at gateway/Caddyfile:${entry.lineNumber}`);

if (missingAllowedCutovers.length > 0 || unexpectedApiCutovers.length > 0 || violations.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'gateway-allowed-cutovers-audit',
    missingAllowedCutovers,
    unexpectedApiCutovers,
    violations,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'gateway-allowed-cutovers-audit',
  checkedApiCutovers: apiCutovers.length,
  checkedAllowedCutovers: allowedApiCutovers.length,
  allowedApiProxyTargets: [...allowedApiProxyTargets],
  allowedWebProxyTargets: [...allowedWebProxyTargets],
  apiCutovers: allowedApiCutovers,
}, null, 2));
