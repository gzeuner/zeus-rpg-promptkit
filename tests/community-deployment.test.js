const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { startLocalUiServer } = require('../src/ui/localUiServer');

const ROOT = path.resolve(__dirname, '..');
const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
const compose = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
const docs = fs.readFileSync(path.join(ROOT, 'docs/deployment/community-container.md'), 'utf8');
const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');

test('community image is pinned and runs as a non-root user', () => {
  assert.match(dockerfile, /^FROM node:22\.18\.0-bookworm-slim$/m);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(dockerfile, /ENTRYPOINT \["node", "cli\/zeus\.js"\]/);
  assert.match(dockerfile, /CMD \["--help"\]/);
  assert.doesNotMatch(dockerfile, /USER root|sudo|curl .*https?:/i);
});

test('compose profiles keep local access and writable artifacts bounded', () => {
  assert.match(compose, /profiles: \[zeus\]/);
  assert.match(compose, /profiles: \[local-provider\]/);
  assert.equal((compose.match(/127\.0\.0\.1:4782:4782/g) || []).length, 2);
  assert.equal((compose.match(/read_only: true/g) || []).length, 2);
  assert.equal((compose.match(/zeus-artifacts:\/data\/artifacts/g) || []).length, 2);
  assert.equal((compose.match(/tmpfs:/g) || []).length, 2);
  assert.equal((compose.match(/no-new-privileges:true/g) || []).length, 2);
  assert.equal((compose.match(/cap_drop: \[ALL\]/g) || []).length, 2);
  assert.match(compose, /ZEUS_PROVIDER_ENDPOINT/);
  assert.match(compose, /ZEUS_PROVIDER_MODEL/);
  assert.doesNotMatch(compose, /privileged:\s*true|network_mode:\s*host|pid:\s*host/i);
  assert.equal((compose.match(/'--host', '0\.0\.0\.0'/g) || []).length, 2);
  assert.doesNotMatch(compose, /0\.0\.0\.0:4782:4782|hostPath:|docker\.sock/i);
  assert.doesNotMatch(compose, /(password|token|secret|private[_-]?key)\s*[:=]\s*[^$\s}]+/i);
});

test('container listener bind is explicitly supported without changing the local default', async () => {
  const started = await startLocalUiServer({ outputRoot: ROOT, host: '0.0.0.0', port: 0 });
  try {
    const response = await fetch(`http://127.0.0.1:${started.port}/api/health`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
  } finally {
    await new Promise(resolve => started.server.close(resolve));
  }
});

test('community docs state reference limitations and secret/model boundaries', () => {
  assert.match(docs, /not a production certification/i);
  assert.match(docs, /non-root/i);
  assert.match(docs, /read-only root filesystem/i);
  assert.match(docs, /127\.0\.0\.1:4782/);
  assert.match(docs, /No model is downloaded/i);
  assert.match(docs, /No credential is included/i);
  assert.match(docs, /private Enterprise module/i);
  assert.doesNotMatch(docs, /production-ready|certified for production/i);
});

test('CI provides real container evidence without suppressing failures', () => {
  const section = workflow.slice(
    workflow.indexOf('community-container:'),
    workflow.indexOf('  # Boundary guards')
  );
  assert.match(section, /runs-on: ubuntu-latest/);
  assert.match(section, /npm run test:deployment:community/);
  assert.match(section, /docker compose --profile zeus config --quiet/);
  assert.match(section, /docker build --pull/);
  assert.match(section, /docker run --rm --read-only/);
  assert.match(section, /--mount type=tmpfs,destination=\/data\/artifacts/);
  assert.match(section, /docker compose .* up -d/);
  assert.match(section, /127\.0\.0\.1:4782\/api\/health/);
  assert.match(section, /docker compose .* down .*--volumes/);
  assert.match(section, /curl .*--fail/);
  assert.match(section, /trap cleanup EXIT/);
  assert.doesNotMatch(section, /continue-on-error|\|\|\s*true/);
});
test('local CLI help smoke is offline and does not require a provider', () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'cli/zeus.js'), '--help'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /zeus.*analyze/);
});
