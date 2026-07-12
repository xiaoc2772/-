import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const defaultBaseURL = 'http://127.0.0.1:8080';
const baseURL = (process.env.FARM_GO_API_BASE_URL || defaultBaseURL).replace(/\/+$/, '');
const origin = process.env.FARM_GO_API_ORIGIN || defaultBaseURL;
const cookie = process.env.FARM_GO_API_COOKIE || '';
const useDocker = process.env.FARM_GO_API_USE_DOCKER !== '0' && !process.env.FARM_GO_API_BASE_URL;

const getPaths = [
  '/api/farm/status',
  '/api/farm/shop',
  '/api/farm/steal/list',
];

const postPaths = [
  ['/api/farm/status', '{}'],
  ['/api/farm/plant', '{"plotIndex":0,"cropId":"wheat"}'],
  ['/api/farm/water', '{"plotIndex":0}'],
  ['/api/farm/water-all', '{}'],
  ['/api/farm/harvest', '{"plotIndex":0}'],
  ['/api/farm/harvest-all', '{}'],
  ['/api/farm/remove', '{"plotIndex":0}'],
  ['/api/farm/buy-land', '{"landIndex":5}'],
  ['/api/farm/shop/buy', '{"key":"scarecrow","qty":1}'],
  ['/api/farm/seeds/buy', '{"cropId":"wheat","qty":1}'],
  ['/api/farm/shop/use', '{"key":"scarecrow"}'],
  ['/api/farm/pet/adopt', '{"type":"cat","name":"小咪"}'],
  ['/api/farm/pet/feed', '{"kind":"normal"}'],
  ['/api/farm/pet/wash', '{}'],
  ['/api/farm/pet/drink', '{}'],
  ['/api/farm/pet/play', '{}'],
  ['/api/farm/pet/dispatch', '{"task":"water"}'],
  ['/api/farm/steal/do', '{"targetUserId":1}'],
];

const authenticatedReadPaths = [
  '/api/farm/status',
  '/api/farm/shop',
  '/api/farm/steal/list',
];

const expectedGatewayFarmRules = [...getPaths, ...postPaths.map(([path]) => path)]
  .map((path) => `handle ${path} {`);

function fail(message) {
  console.error(`farm Go API smoke failed: ${message}`);
  process.exit(1);
}

function assertGatewayFarmRulesExact() {
  const caddyfile = readFileSync('gateway/Caddyfile', 'utf8');
  const activeFarmRules = caddyfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .filter((line) => line.includes('/api/farm'));
  const missing = expectedGatewayFarmRules.filter((line) => !activeFarmRules.includes(line));
  const unexpected = activeFarmRules.filter((line) => !expectedGatewayFarmRules.includes(line));
  if (missing.length > 0 || unexpected.length > 0) {
    fail(`gateway/Caddyfile farm rules must be exact; missing=${missing.join('; ')} unexpected=${unexpected.join('; ')}`);
  }
}

function dockerWget(method, path, body = '', headers = {}) {
  const args = ['compose', 'exec', '-T', 'api', 'wget', '-S', '-O', '-'];
  for (const [key, value] of Object.entries(headers)) {
    args.push('--header', `${key}: ${value}`);
  }
  if (method === 'POST') {
    args.push('--post-data', body);
  }
  args.push(`${baseURL}${path}`);

  const result = spawnSync('docker', args, { encoding: 'utf8' });
  return {
    status: parseStatus(`${result.stderr}\n${result.stdout}`),
    body: result.stdout,
    raw: `${result.stderr}\n${result.stdout}`,
  };
}

async function fetchRequest(method, path, body = '', headers = {}) {
  const response = await fetch(`${baseURL}${path}`, {
    method,
    headers,
    body: method === 'POST' ? body : undefined,
  });
  return {
    status: response.status,
    body: await response.text(),
    raw: '',
  };
}

async function request(method, path, body = '', headers = {}) {
  if (useDocker) {
    return dockerWget(method, path, body, headers);
  }
  return fetchRequest(method, path, body, headers);
}

function parseStatus(output) {
  const matches = [...output.matchAll(/HTTP\/\d(?:\.\d)?\s+(\d{3})/g)];
  if (matches.length === 0) {
    return 0;
  }
  return Number(matches[matches.length - 1][1]);
}

function parseJSON(body, label) {
  try {
    return JSON.parse(body);
  } catch {
    fail(`${label} did not return JSON: ${body.slice(0, 200)}`);
  }
}

function assertStatus(actual, expected, label, raw = '') {
  if (actual !== expected) {
    fail(`${label} expected HTTP ${expected}, got ${actual}; raw=${raw.slice(0, 500)}`);
  }
}

async function main() {
  assertGatewayFarmRulesExact();

  const ready = await request('GET', '/readyz');
  assertStatus(ready.status, 200, 'GET /readyz', ready.raw);
  const readyPayload = parseJSON(ready.body, 'GET /readyz');
  if (!readyPayload.ok || !readyPayload.postgres || !readyPayload.redis) {
    fail(`GET /readyz is not fully ready: ${ready.body}`);
  }

  for (const path of getPaths) {
    const response = await request('GET', path);
    assertStatus(response.status, 401, `GET ${path} without login`, response.raw);
  }

  for (const [path, body] of postPaths) {
    const response = await request('POST', path, body, {
      Origin: origin,
      'Content-Type': 'application/json',
    });
    assertStatus(response.status, 401, `POST ${path} without login`, response.raw);
  }

  if (cookie) {
    for (const path of authenticatedReadPaths) {
      const response = await request('GET', path, '', { Cookie: cookie });
      assertStatus(response.status, 200, `GET ${path} with FARM_GO_API_COOKIE`, response.raw);
      const payload = parseJSON(response.body, `GET ${path} with FARM_GO_API_COOKIE`);
      if (!payload.success || !payload.data) {
        fail(`GET ${path} authenticated payload is not compatible: ${response.body.slice(0, 500)}`);
      }
    }
  }

  console.log(JSON.stringify({
    ok: true,
    mode: useDocker ? 'docker-compose-exec-api' : 'direct-fetch',
    baseURL,
    checkedUnauthenticatedPaths: getPaths.length + postPaths.length,
    checkedAuthenticatedReadPaths: cookie ? authenticatedReadPaths.length : 0,
    gatewayFarmRules: 'enabled-exact',
  }, null, 2));
}

main().catch((error) => {
  fail(error?.stack || String(error));
});
