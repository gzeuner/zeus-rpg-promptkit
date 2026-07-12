'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { REQUIRED, parseConfig, verifyScope } = require('../scripts/check-typecheck-scope');
const packageJson = require('../package.json');

test('core typecheck declares every required contract file', () => {
  const report = verifyScope();
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.files, REQUIRED);
});

test('core typecheck runs the compiler directly without failure masking', () => {
  assert.equal(packageJson.scripts.typecheck, 'npm run typecheck:core');
  assert.match(packageJson.scripts['typecheck:core'], /&& tsc /);
  assert.doesNotMatch(packageJson.scripts['typecheck:core'], /\|\||\|(?!\|)|continue-on-error/);
});

test('malformed compiler configuration fails parsing', () => {
  const temp = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-typecheck-')),
    'jsconfig.json'
  );
  fs.writeFileSync(temp, '{ invalid', 'utf8');
  assert.throws(() => parseConfig(temp), SyntaxError);
  fs.rmSync(path.dirname(temp), { recursive: true, force: true });
});

test('missing required declaration and missing declared file fail scope verification', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-typecheck-'));
  const temp = path.join(dir, 'jsconfig.json');
  fs.writeFileSync(temp, JSON.stringify({ files: ['missing-contract.js'] }), 'utf8');
  const report = verifyScope(temp);
  assert.match(report.errors.join('\n'), /required core file is not declared/);
  assert.match(report.errors.join('\n'), /declared core file is missing/);
  fs.rmSync(dir, { recursive: true, force: true });
});
