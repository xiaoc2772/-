import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const envFile = process.env.ZEABUR_ENV_FILE || '';
const evidenceFile = process.env.CUTOVER_EVIDENCE_FILE || '';
const strict = process.env.PRODUCTION_CUTOVER_READINESS_STRICT === '1';
const env = {
  ...readEnvFile(envFile),
  ...process.env,
};

const requiredFiles = [
  'docs/profile-cutover-preflight.md',
  'docs/notifications-cutover-preflight.md',
  'docs/farm-status-cutover-preflight.md',
  'docs/cards-cutover-preflight.md',
  'docs/admin-cards-cutover-preflight.md',
  'docs/wallet-cutover-preflight.md',
  'scripts/preflight-zeabur-go-api.mjs',
  'scripts/audit-gateway-upstreams.mjs',
  'scripts/audit-gateway-cutover-guard.mjs',
  'scripts/smoke-zeabur-runtime.mjs',
  'scripts/smoke-auth-login-go-api.mjs',
  'scripts/smoke-auth-me-go-api.mjs',
  'scripts/smoke-auth-logout-go-api.mjs',
  'scripts/smoke-wallet-go-api.mjs',
  'scripts/smoke-profile-go-api.mjs',
  'scripts/smoke-notifications-go-api.mjs',
  'scripts/smoke-farm-go-api.mjs',
  'scripts/smoke-cards-go-api.mjs',
  'scripts/smoke-admin-cards-go-api.mjs',
  'scripts/audit-zeabur-runtime-env.mjs',
  'scripts/audit-production-cutover-evidence.mjs',
  'docs/production-cutover-evidence.md',
  'deploy/production-cutover-evidence.example.json',
];

function readEnvFile(filePath) {
  if (!filePath) {
    return {};
  }
  if (!existsSync(filePath)) {
    return {};
  }
  const values = {};
  const content = readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const index = line.indexOf('=');
    if (index <= 0) {
      continue;
    }
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function hasValue(key) {
  const value = String(env[key] || '').trim();
  return value !== '' && !value.startsWith('replace-with-') && !value.startsWith('${');
}

function runNodeScript(args, extraEnv = {}, timeout = 60000) {
  const result = spawnSync('node', args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...extraEnv,
    },
    timeout,
    maxBuffer: 1024 * 1024 * 4,
  });
  if (result.status !== 0) {
    return {
      ok: false,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    };
  }
  return {
    ok: true,
    stdout: result.stdout.trim(),
  };
}

function runNodeScriptJSON(args, extraEnv = {}) {
  const result = runNodeScript(args, extraEnv);
  if (!result.ok) {
    return result;
  }
  try {
    return {
      ok: true,
      json: JSON.parse(result.stdout),
    };
  } catch {
    return {
      ok: false,
      stdout: result.stdout,
      stderr: 'script did not return JSON',
    };
  }
}

function buildModule(name, checks, commands) {
  const blockers = checks
    .filter((check) => !check.ok)
    .map((check) => check.message);
  return {
    name,
    ready: blockers.length === 0,
    blockers,
    requiredReviewCommands: commands,
  };
}

const missingFiles = requiredFiles.filter((file) => !existsSync(file));
const gatewayUpstreams = runNodeScript(['scripts/audit-gateway-upstreams.mjs']);
const gatewayGuard = runNodeScript(['scripts/audit-gateway-cutover-guard.mjs']);
const evidenceAudit = evidenceFile
  ? runNodeScriptJSON(['scripts/audit-production-cutover-evidence.mjs'], {
      CUTOVER_EVIDENCE_FILE: evidenceFile,
      D1_EXPORT_SQL: env.D1_EXPORT_SQL || process.env.D1_EXPORT_SQL || '',
      ZEABUR_ENV_FILE: envFile,
    })
  : runNodeScriptJSON(['scripts/audit-production-cutover-evidence.mjs']);
const runtimeEnvAudit = envFile
  ? runNodeScript(['scripts/audit-zeabur-runtime-env.mjs'], { ZEABUR_ENV_FILE: envFile })
  : { ok: true, skipped: true };
const remoteRuntimeSmoke = hasValue('ZEABUR_RUNTIME_BASE_URL')
  ? runNodeScript(['scripts/smoke-zeabur-runtime.mjs'], {
      ZEABUR_RUNTIME_BASE_URL: env.ZEABUR_RUNTIME_BASE_URL,
      ZEABUR_RUNTIME_REQUIRE_REMOTE: '1',
    }, 120000)
  : { ok: true, skipped: true };

const freshDatabaseCheck = {
  ok: true,
  message: 'fresh Zeabur 部署不要求 Cloudflare D1 导出；如需旧数据归档迁移，可额外传入 D1_EXPORT_SQL',
};

const hasNewAPIAdminAuth = (
  hasValue('NEW_API_ADMIN_ACCESS_TOKEN') &&
  hasValue('NEW_API_ADMIN_USER_ID')
) || (
  hasValue('NEW_API_ADMIN_USERNAME') &&
  hasValue('NEW_API_ADMIN_PASSWORD')
);

const modules = [
  buildModule('auth', [
    freshDatabaseCheck,
    { ok: hasValue('AUTH_GO_API_COOKIE'), message: '缺少 AUTH_GO_API_COOKIE，无法记录测试账号真实登录态 auth/me 证据' },
  ], [
    'docker compose exec -T api /app/migrate',
    'node scripts/smoke-auth-login-go-api.mjs',
    'node scripts/smoke-auth-me-go-api.mjs',
    'node scripts/smoke-auth-logout-go-api.mjs',
    '使用测试账号完成 /login -> /api/auth/me 页面级冒烟，并记录 AUTH_GO_API_COOKIE 对应的测试登录态证据',
    '使用测试账号完成 /logout 页面级冒烟，确认旧 Cookie 失效',
  ]),
  buildModule('wallet', [
    { ok: hasValue('NEW_API_URL'), message: '缺少 NEW_API_URL' },
    { ok: hasNewAPIAdminAuth, message: '缺少 new-api 管理凭证：需要 NEW_API_ADMIN_ACCESS_TOKEN + NEW_API_ADMIN_USER_ID，或 NEW_API_ADMIN_USERNAME + NEW_API_ADMIN_PASSWORD' },
    { ok: hasValue('WALLET_GO_API_COOKIE'), message: '缺少 WALLET_GO_API_COOKIE，无法做真实登录态余额只读冒烟' },
  ], [
    'node scripts/smoke-wallet-go-api.mjs',
    'WALLET_GO_API_COOKIE="..." WALLET_GO_API_EXPECT_NEW_API=1 node scripts/smoke-wallet-go-api.mjs',
  ]),
  buildModule('profile', [
    freshDatabaseCheck,
    { ok: hasValue('PROFILE_GO_API_COOKIE'), message: '缺少 PROFILE_GO_API_COOKIE，无法做真实登录态 profile 只读冒烟' },
  ], [
    'docker compose exec -T api /app/migrate',
    '确认新库资料/成就默认状态或种子数据符合新部署预期',
    'PROFILE_GO_API_COOKIE="..." node scripts/smoke-profile-go-api.mjs',
  ]),
  buildModule('notifications', [
    freshDatabaseCheck,
    { ok: hasValue('NOTIFICATIONS_GO_API_COOKIE'), message: '缺少 NOTIFICATIONS_GO_API_COOKIE，无法做真实登录态 notifications 只读冒烟' },
  ], [
    'docker compose exec -T api /app/migrate',
    '确认新库通知和奖励领取默认状态符合新部署预期',
    'NOTIFICATIONS_GO_API_COOKIE="..." node scripts/smoke-notifications-go-api.mjs',
  ]),
  buildModule('farm', [
    freshDatabaseCheck,
    { ok: hasValue('FARM_GO_API_COOKIE'), message: '缺少 FARM_GO_API_COOKIE，无法做真实登录态 farm 直连冒烟' },
  ], [
    'docker compose exec -T api /app/migrate',
    '确认新库农场初始状态、商城配置和种子数据符合新部署预期',
    'FARM_GO_API_COOKIE="..." node scripts/smoke-farm-go-api.mjs',
    '使用真实样本账号完成 /farm 页面级冒烟',
  ]),
  buildModule('cards', [
    freshDatabaseCheck,
    { ok: hasValue('CARDS_GO_API_COOKIE'), message: '缺少 CARDS_GO_API_COOKIE，无法做前台卡牌真实登录态冒烟' },
    { ok: hasValue('ADMIN_CARDS_GO_API_COOKIE'), message: '缺少 ADMIN_CARDS_GO_API_COOKIE，无法做后台卡牌真实管理员冒烟' },
  ], [
    'docker compose exec -T api /app/migrate',
    '确认新库卡牌规则、默认奖励和后台配置符合新部署预期',
    'CARDS_GO_API_COOKIE="..." node scripts/smoke-cards-go-api.mjs',
    'ADMIN_CARDS_GO_API_COOKIE="..." node scripts/smoke-admin-cards-go-api.mjs',
    '使用真实样本账号完成 /cards 与 /admin/cards 页面级冒烟',
  ]),
];

if (evidenceFile && evidenceAudit.ok && evidenceAudit.json) {
  const evidenceModules = new Map(
    (evidenceAudit.json.modules || []).map((item) => [item.name, item]),
  );
  for (const cutoverModule of modules) {
    const evidenceModule = evidenceModules.get(cutoverModule.name);
    if (!evidenceModule) {
      cutoverModule.blockers.push(`证据包缺少 ${cutoverModule.name} 模块`);
      continue;
    }
    if (!evidenceModule.ready) {
      const evidenceBlockers = Array.isArray(evidenceModule.blockers)
        ? evidenceModule.blockers
        : ['证据包模块未 ready'];
      for (const blocker of evidenceBlockers) {
        cutoverModule.blockers.push(`证据包未满足: ${blocker}`);
      }
    }
  }
}

for (const cutoverModule of modules) {
  cutoverModule.ready = cutoverModule.blockers.length === 0;
}

const readyModules = modules.filter((item) => item.ready).map((item) => item.name);
const blockedModules = modules.filter((item) => !item.ready).map((item) => item.name);

if (
  missingFiles.length > 0 ||
  !gatewayUpstreams.ok ||
  !gatewayGuard.ok ||
  !evidenceAudit.ok ||
  !runtimeEnvAudit.ok ||
  !remoteRuntimeSmoke.ok
) {
  console.error(JSON.stringify({
    ok: false,
    reason: 'readiness audit prerequisites failed',
    missingFiles,
    gatewayUpstreams,
    gatewayGuard,
    evidenceAudit,
    runtimeEnvAudit,
    remoteRuntimeSmoke,
  }, null, 2));
  process.exit(1);
}

const output = {
  ok: true,
  ready: blockedModules.length === 0,
  mode: 'production-cutover-readiness-audit',
  strict,
  envFile: envFile || null,
  readyModules,
  blockedModules,
  modules,
  evidenceAudit: evidenceFile
    ? {
        ok: true,
        evidenceFile,
        ready: evidenceAudit.json?.ready ?? false,
        blockedModules: evidenceAudit.json?.blockedModules || [],
      }
    : {
        ok: true,
        evidenceFile: null,
        templateValidated: true,
      },
  runtimeEnvAudit: envFile ? { ok: true } : { ok: true, skipped: true },
  remoteRuntimeSmoke: hasValue('ZEABUR_RUNTIME_BASE_URL') ? { ok: true } : { ok: true, skipped: true },
  gatewayUpstreamsConfigured: true,
  gatewayForbiddenPathsStillGuarded: true,
  note: 'ready=false 表示仍缺真实 Cookie、生产配置、远端冒烟或证据审批；fresh Zeabur 部署不再要求 Cloudflare D1 导出。',
};

if (strict && !output.ready) {
  console.error(JSON.stringify(output, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(output, null, 2));
