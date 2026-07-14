'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'cli', 'zeus.js');

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

function assertTopLevelHelp(result) {
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:\s*\n\s*zeus /);
  assert.equal(result.stderr, '');
  assert.equal(result.error, undefined);
}

test('explicit top-level --help exits successfully', () => {
  assertTopLevelHelp(run(['--help']));
});

test('explicit top-level -h exits successfully', () => {
  assertTopLevelHelp(run(['-h']));
});

test('no-command invocation retains usage error semantics', () => {
  const result = run([]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Usage:\s*\n\s*zeus /);
  assert.equal(result.stderr, '');
});

test('unknown command remains an error even when followed by --help', () => {
  const result = run(['definitely-not-a-command', '--help']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Usage:\s*\n\s*zeus /);
});

test('known command help remains successful', () => {
  const result = run(['bridge', '--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Bridge commands/);
});

test('help lookalikes are not accepted as explicit top-level help', () => {
  for (const option of ['--help=true', '--helpful', '-hx']) {
    const result = run([option]);
    assert.equal(result.status, 1, option);
  }
});

test('package smoke strictly invokes the temporary installed executable', () => {
  const smoke = fs.readFileSync(path.join(ROOT, 'scripts', 'package-smoke.js'), 'utf8');
  assert.match(smoke, /path\.join\(inst, 'node_modules', '\.bin', binName\)/);
  assert.match(smoke, /runInstalled\(bin, \['--help'\], inst\)/);
  assert.match(smoke, /runInstalled\(bin, \['-h'\], inst\)/);
  assert.doesNotMatch(smoke, /cli[\\/]zeus\.js/);
  assert.doesNotMatch(smoke, /\|\|\s*(?:true|echo)\b/);
});

test('Windows CI runs installed-package smoke validation', () => {
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const windowsStart = ci.indexOf('  test-windows-20:');
  const nextJob = ci.indexOf('\n  package-smoke:', windowsStart);
  assert.notEqual(windowsStart, -1);
  assert.notEqual(nextJob, -1);
  assert.match(ci.slice(windowsStart, nextJob), /npm run package:smoke/);
});
