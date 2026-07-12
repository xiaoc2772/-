import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function fail(message, details = []) {
  console.error(`lucky-td cutover audit failed: ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

const requiredFiles = [
  'backend/internal/luckytd/service.go',
  'backend/internal/luckytd/service_types.go',
  'backend/internal/httpserver/luckytd_handlers.go',
  'docs/lucky-td-cutover-preflight.md',
];

const missingFiles = requiredFiles.filter((relativePath) => !existsSync(path.join(repoRoot, relativePath)));
if (missingFiles.length > 0) {
  fail('required M2 files are missing', missingFiles);
}

const serverSource = read('backend/internal/httpserver/server.go');
const requiredServerSnippets = [
  'luckyTdHandlers := newLuckyTdHandlers(deps)',
  'api.Route("/games/lucky-td"',
  'luckyTdRouter.Get("/status", luckyTdHandlers.status)',
  'luckyTdRouter.Post("/start", luckyTdHandlers.start)',
  'luckyTdRouter.Post("/checkpoint", luckyTdHandlers.checkpoint)',
  'luckyTdRouter.Post("/submit", luckyTdHandlers.submit)',
  'luckyTdRouter.Post("/cancel", luckyTdHandlers.cancel)',
];
const missingServerSnippets = requiredServerSnippets.filter((snippet) => !serverSource.includes(snippet));
if (missingServerSnippets.length > 0) {
  fail('Go lucky-td routes are incomplete', missingServerSnippets);
}

const frontendApiSource = read('src/lib/lucky-td/api.ts');
const requiredFrontendPaths = [
  "const BASE = '/api/games/lucky-td'",
  "('/status')",
  "('/start'",
  "('/checkpoint'",
  "('/submit'",
  "('/cancel'",
];
const missingFrontendPaths = requiredFrontendPaths.filter((snippet) => !frontendApiSource.includes(snippet));
if (missingFrontendPaths.length > 0) {
  fail('frontend lucky-td API client contract changed', missingFrontendPaths);
}

const gatewaySource = read('gateway/Caddyfile');
const requiredGatewayRules = [
  'handle /api/games/lucky-td/status {',
  'handle /api/games/lucky-td/start {',
  'handle /api/games/lucky-td/checkpoint {',
  'handle /api/games/lucky-td/submit {',
  'handle /api/games/lucky-td/cancel {',
];
const missingGatewayRules = requiredGatewayRules.filter((snippet) => !gatewaySource.includes(snippet));
if (missingGatewayRules.length > 0) {
  fail('Gateway lucky-td exact routing rules are incomplete', missingGatewayRules);
}

const activeLuckyTdGatewayLines = gatewaySource
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'))
  .filter((entry) => entry.line.includes('/api/games/lucky-td'));

const allowedGatewayRules = new Set(requiredGatewayRules);
const unexpectedGatewayRules = activeLuckyTdGatewayLines.filter((entry) => !allowedGatewayRules.has(entry.line));
if (unexpectedGatewayRules.length > 0) {
  fail(
    'Gateway contains unexpected lucky-td wildcard or extra routing rules',
    unexpectedGatewayRules.map((entry) => `gateway/Caddyfile:${entry.lineNumber} ${entry.line}`),
  );
}

const gameSummarySource = read('backend/internal/gamesummary/service.go');
const requiredSummarySnippets = [
  '"lucky_td"',
  "game_type IN ('roguelite', 'minesweeper', 'whack_mole', 'memory', 'match3', 'linkgame', 'game_2048', 'lucky_td')",
  'return numericField(data, "status") == 1',
  'return "lucky-td"',
];
const missingSummarySnippets = requiredSummarySnippets.filter((snippet) => !gameSummarySource.includes(snippet));
if (missingSummarySnippets.length > 0) {
  fail('games summary lucky-td aggregation is incomplete', missingSummarySnippets);
}

console.log(JSON.stringify({
  goRoutes: requiredServerSnippets,
  gatewayRules: activeLuckyTdGatewayLines.map((entry) => entry.line),
  frontendBase: '/api/games/lucky-td',
  gameType: 'lucky_td',
}, null, 2));
