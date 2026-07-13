const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, '../scripts/repository-control.js');

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15000,
  });
}

test('repo:control --help exits 0', () => {
  const res = run(['--help']);
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes('Repository Control (read-only)'));
});

test('repo:control invalid scope exits 64', () => {
  const res = run(['--scope', 'invalid']);
  assert.equal(res.status, 64);
});

test('repo:control overview runs (read-only, produces report)', () => {
  const res = spawnSync(process.execPath, [SCRIPT, '--scope', 'overview', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
  });
  // Should produce JSON report structure even if some data is UNKNOWN
  const out = res.stdout || '';
  assert.ok(out.includes('schemaVersion') || out.includes('"decision"'));
});
