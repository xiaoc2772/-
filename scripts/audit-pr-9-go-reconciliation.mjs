import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'docs/pr-9-go-reconciliation.md',
  'backend/internal/rankings/games.go',
  'backend/internal/rankings/games_test.go',
  'src/app/rankings/page.tsx',
  'src/app/games/2048/page.tsx',
  'src/app/games/roguelite/page.tsx',
  'src/app/games/eco/page.tsx',
  'src/app/admin/users/page.tsx',
  'src/components/MarkdownPreview.tsx',
  'public/images-optimized/ui/games/2048/board.webp',
  'public/images-optimized/ui/games/covers/2048.webp',
  'public/images-optimized/ui/games/mascots/2048.webp',
];

const requiredTileImages = [
  '2', '4', '8', '16', '32', '64', '128', '256',
  '512', '1024', '2048', '4096', '8192', '16384', '32768', '65536',
].map((value) => `public/images-optimized/ui/games/2048/tiles/${value}.webp`);

function read(file) {
  return readFileSync(file, 'utf8');
}

function fail(message, details = {}) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'pr-9-go-reconciliation-audit',
    message,
    details,
  }, null, 2));
  process.exit(1);
}

const missingFiles = [...requiredFiles, ...requiredTileImages].filter((file) => !existsSync(file));
if (missingFiles.length > 0) {
  fail('required PR #9 reconciliation files are missing', { missingFiles });
}

const reconciliation = read('docs/pr-9-go-reconciliation.md');
const rankingsGo = read('backend/internal/rankings/games.go');
const rankingsTest = read('backend/internal/rankings/games_test.go');
const rankingsPage = read('src/app/rankings/page.tsx');
const game2048Page = read('src/app/games/2048/page.tsx');
const roguelitePage = read('src/app/games/roguelite/page.tsx');
const ecoPage = read('src/app/games/eco/page.tsx');
const adminUsersPage = read('src/app/admin/users/page.tsx');

const missingRequiredPhrases = [
  [reconciliation, '不能直接 merge PR #9'],
  [reconciliation, 'game_2048'],
  [reconciliation, '不恢复旧 `games/fallback`'],
  [reconciliation, '不再作为长期发布门禁'],
  [rankingsGo, '{dbName: "game_2048", apiName: "game_2048"}'],
  [rankingsTest, 'TestSupportedGamesIncludesGame2048'],
  [rankingsPage, "game_2048: '2048'"],
  [rankingsPage, "game_2048: 't-2048'"],
  [rankingsPage, "if (gameType === 'game_2048') return <Grid3X3 />"],
  [game2048Page, "router.replace('/login?redirect=/games/2048')"],
].filter(([content, phrase]) => !content.includes(phrase)).map(([, phrase]) => phrase);

const forbiddenPagePhrases = [
  ['src/app/games/2048/page.tsx', game2048Page, 'requestGameFallback'],
  ['src/app/games/roguelite/page.tsx', roguelitePage, 'requestGameFallback'],
  ['src/app/games/eco/page.tsx', ecoPage, 'stealProtectedUntil'],
  ['src/app/games/eco/page.tsx', ecoPage, 'theftCaughtCount'],
  ['src/app/admin/users/page.tsx', adminUsersPage, '同步历史用户'],
  ['src/app/admin/users/page.tsx', adminUsersPage, '迁移新人资格'],
].filter(([, content, phrase]) => content.includes(phrase))
  .map(([file, , phrase]) => ({ file, phrase }));

if (missingRequiredPhrases.length > 0 || forbiddenPagePhrases.length > 0) {
  fail('PR #9 Go reconciliation invariants failed', {
    missingRequiredPhrases,
    forbiddenPagePhrases,
  });
}

console.log(JSON.stringify({
  ok: true,
  mode: 'pr-9-go-reconciliation-audit',
  checkedFiles: requiredFiles.length + requiredTileImages.length,
  checkedTileImages: requiredTileImages.length,
  checkedRequiredPhrases: 10,
  checkedForbiddenPhrases: 6,
}, null, 2));
