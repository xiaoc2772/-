import { existsSync, readFileSync } from 'node:fs';

const composePath = 'compose.yml';
const gatewayDockerfile = 'gateway/Dockerfile';
const webDockerfile = 'Dockerfile';
const backendDockerfile = 'backend/Dockerfile';

const compose = readFileSync(composePath, 'utf8');

const requiredFiles = [
  composePath,
  gatewayDockerfile,
  webDockerfile,
  backendDockerfile,
  'gateway/Caddyfile',
];

const requiredSnippets = [
  'name: redemption',
  'services:',
  '  gateway:',
  '  web:',
  '  api:',
  '  worker:',
  '  postgres:',
  '  redis:',
  'context: ./gateway',
  'context: .',
  'context: ./backend',
  'dockerfile: Dockerfile',
  'target: web-runtime',
  'entrypoint: ["/app/worker"]',
  'API_UPSTREAM: api:8080',
  'WEB_UPSTREAM: web:3000',
  'PORT: "8080"',
  'PORT: "3000"',
  'NODE_ENV: production',
  'NEXT_PUBLIC_BASE_URL: http://localhost:8080',
  'DATABASE_URL: postgres://app:app@postgres:5432/app?sslmode=disable',
  'REDIS_URL: redis://redis:6379/0',
  'SESSION_SECRET: local-development-session-secret-at-least-32-chars',
  'ADMIN_USERNAMES: ${ADMIN_USERNAMES:-lucky}',
  'INTERNAL_API_SECRET: local-internal-secret',
  'NEW_API_URL: ${NEW_API_URL:-https://www.lucky04.dpdns.org}',
  'R2_PUBLIC_URL: ""',
  'FEEDBACK_MEDIA_DIR: /data/feedback-media',
  'RAFFLE_DELIVERY_CRON_SECRET: local-cron-secret',
  'CRON_SECRET: local-cron-secret',
  'POSTGRES_DB: app',
  'POSTGRES_USER: app',
  'POSTGRES_PASSWORD: app',
  '- "8080:8080"',
  '- "5432:5432"',
  '- "6379:6379"',
  '- "3000"',
  '- "8080"',
  'postgres-data:/var/lib/postgresql/data',
  'redis-data:/data',
  'feedback-media-data:/data/feedback-media',
  'pg_isready -U app -d app',
  'redis-cli',
  'condition: service_healthy',
  'volumes:',
  '  postgres-data:',
  '  redis-data:',
  '  feedback-media-data:',
];

const requiredDependencyPairs = [
  ['gateway', 'web'],
  ['gateway', 'api'],
  ['web', 'api'],
  ['api', 'postgres'],
  ['api', 'redis'],
  ['worker', 'postgres'],
  ['worker', 'redis'],
];

function serviceBlock(service) {
  const lines = compose.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${service}:`);
  if (start === -1) {
    return '';
  }
  const block = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^  [a-zA-Z0-9_-]+:/.test(line) || line === 'volumes:') {
      break;
    }
    block.push(line);
  }
  return block.join('\n');
}

const missingFiles = requiredFiles.filter((file) => !existsSync(file));
const missingSnippets = requiredSnippets.filter((snippet) => !compose.includes(snippet));
const missingDependencies = [];

for (const [service, dependency] of requiredDependencyPairs) {
  const block = serviceBlock(service);
  if (!block.includes('depends_on:') || !block.includes(dependency)) {
    missingDependencies.push(`${service}->${dependency}`);
  }
}

if (missingFiles.length > 0 || missingSnippets.length > 0 || missingDependencies.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'compose-topology-audit',
    missingFiles,
    missingSnippets,
    missingDependencies,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'compose-topology-audit',
  checkedFiles: requiredFiles.length,
  checkedSnippets: requiredSnippets.length,
  checkedDependencies: requiredDependencyPairs.length,
}, null, 2));
