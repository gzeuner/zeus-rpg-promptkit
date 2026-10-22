'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { inspectInventory, renderSummary, MCP_TEST } = require('../scripts/test-inventory');
const baseConfig = require('../scripts/test-inventory.config');
const { createTestEnvironment, completeTestEvidence } = require('../scripts/run-tests');
const { createEvidenceCollector } = require('../scripts/test-evidence-reporter');

test('test runner removes ambient credentials and runtime injection from child environment', () => {
  const parent = {
    PATH: 'tool-path',
    SystemRoot: 'operating-system',
    JAVA_HOME: 'jdk-path',
    npm_execpath: 'npm-cli.js',
    CI_JOB_TOKEN: 'synthetic-token',
    ZEUS_DB_PASSWORD: 'synthetic-password',
    ZEUS_TEST_KEEP_ENV: '1',
    NODE_OPTIONS: '--require untrusted-file',
    NODE_EXTRA_CA_CERTS: 'synthetic-ca.pem',
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
    JAVA_TOOL_OPTIONS: 'untrusted-agent',
    HOME: 'ambient-home',
    LANG: 'tr_TR.UTF-8',
  };
  const original = { ...parent };
  const child = createTestEnvironment(parent, 'isolated-home');
  assert.deepEqual(parent, original);
  assert.equal(child.PATH, parent.PATH);
  assert.equal(child.SystemRoot, parent.SystemRoot);
  assert.equal(child.JAVA_HOME, parent.JAVA_HOME);
  assert.equal(child.npm_execpath, parent.npm_execpath);
  for (const key of [
    'CI_JOB_TOKEN',
    'ZEUS_DB_PASSWORD',
    'ZEUS_TEST_KEEP_ENV',
    'NODE_OPTIONS',
    'NODE_EXTRA_CA_CERTS',
    'NODE_TLS_REJECT_UNAUTHORIZED',
    'JAVA_TOOL_OPTIONS',
  ])
    assert.equal(Object.hasOwn(child, key), false);
  assert.equal(child.HOME, 'isolated-home');
  assert.equal(child.TMP, 'isolated-home');
  assert.equal(child.LANG, 'C.UTF-8');
  assert.equal(child.TZ, 'UTC');
});

test('test evidence fails closed when reporter output is missing or malformed', () => {
  for (const text of [undefined, 'synthetic-private-invalid-json', '{}']) {
    const report = completeTestEvidence(text, 0, ['tests/test-inventory.test.js'], 'selected');
    assert.equal(report.runStatus, 'failed');
    assert.equal(report.reason, 'REPORTER_DID_NOT_COMPLETE');
    assert.equal(report.unreported[0].file, 'tests/test-inventory.test.js');
    assert.equal(report.counts.executed, 0);
    assert.equal(JSON.stringify(report).includes('synthetic-private-invalid-json'), false);
  }
});

test('test evidence records skips and failures without private diagnostics', () => {
  const collector = createEvidenceCollector({ node: 'v22.14.0', platform: 'win32', ci: false });
  const secret = 'synthetic-private-diagnostic';
  const file = path.join(__dirname, 'test-inventory.test.js');
  collector.observe({ type: 'test:pass', data: { file, name: secret } });
  collector.observe({ type: 'test:pass', data: { file, skip: `pwsh unavailable ${secret}` } });
  collector.observe({
    type: 'test:fail',
    data: {
      file,
      name: 'test runner removes ambient credentials and runtime injection from child environment',
      details: { error: { message: secret } },
    },
  });
  const report = collector.report();
  assert.equal(report.counts.passed, 1);
  assert.equal(report.counts.skipped, 1);
  assert.equal(report.counts.failed, 1);
  assert.ok(report.results.some(row => row.requirement === 'TEST-REPRO-ENV'));
  assert.ok(report.results.some(row => row.skipReasons.includes('POWERSHELL_UNAVAILABLE')));
  assert.equal(report.remote.status, 'not_available');
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.equal(JSON.stringify(report).includes(__dirname), false);
});

function configWith(mutator) {
  const config = {
    categories: Object.fromEntries(
      Object.entries(baseConfig.categories).map(([name, files]) => [name, [...files]])
    ),
    exclusions: baseConfig.exclusions.map(entry => ({ ...entry })),
  };
  mutator(config);
  return config;
}

test('maintained inventory is complete, unique, deterministic, and includes MCP', () => {
  const first = inspectInventory();
  const second = inspectInventory();
  assert.deepEqual(first.maintained, second.maintained);
  assert.deepEqual(first.categories, second.categories);
  assert.equal(renderSummary(first), renderSummary(second));
  assert.deepEqual(first.errors, []);
  assert.equal(first.classified, first.maintained.length);
  assert.equal(first.owners.get(MCP_TEST).length, 1);
  assert.equal(first.categories.unit.includes(MCP_TEST), true);
  assert.ok(first.categories.resource.includes('tests/resources-command.test.js'));
});

test('an untracked maintained-path test is rejected as unclassified', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-test-inventory-'));
  try {
    execFileSync('git', ['init', '--quiet', root]);
    fs.mkdirSync(path.join(root, 'tests'));
    const temporary = path.join(root, 'tests', 'temporary-unclassified.test.js');
    fs.writeFileSync(temporary, "'use strict';\n", 'utf8');
    const report = inspectInventory({ categories: { unit: [] }, exclusions: [] }, new Date(), root);
    assert.match(report.errors.join('\n'), /omitted test: tests\/temporary-unclassified\.test\.js/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('duplicate primary classification fails inventory', () => {
  const report = inspectInventory(
    configWith(config => config.categories.smoke.push('tests/analyze-run-manifest.test.js'))
  );
  assert.match(report.errors.join('\n'), /duplicate primary classification/);
});

test('missing referenced test fails inventory', () => {
  const report = inspectInventory(
    configWith(config => config.categories.unit.push('tests/does-not-exist.test.js'))
  );
  assert.match(report.errors.join('\n'), /missing referenced test/);
});

test('expired or issue-less exclusions fail inventory', () => {
  const expired = inspectInventory(
    configWith(config =>
      config.exclusions.push({
        file: 'tests/zeus-api.test.js',
        issue: 'https://github.com/gzeuner/zeus-rpg-promptkit/issues/1',
        reason: 'Reproducible runner defect',
        owner: 'repository-owner',
        introduced: '2026-01-01',
        expires: '2026-01-02',
      })
    )
  );
  assert.match(expired.errors.join('\n'), /expired or invalid exclusion/);

  const issueLess = inspectInventory(
    configWith(config =>
      config.exclusions.push({
        file: 'tests/zeus-api.test.js',
        reason: 'Reproducible runner defect',
        owner: 'repository-owner',
        introduced: '2026-01-01',
        expires: '2099-01-02',
      })
    )
  );
  assert.match(issueLess.errors.join('\n'), /invalid exclusion issue/);
});

test('MCP server test cannot be excluded', () => {
  const report = inspectInventory(
    configWith(config =>
      config.exclusions.push({
        file: MCP_TEST,
        issue: 'https://github.com/gzeuner/zeus-rpg-promptkit/issues/1',
        reason: 'Reproducible runner defect',
        owner: 'repository-owner',
        introduced: '2026-01-01',
        expires: '2099-01-02',
      })
    )
  );
  assert.match(report.errors.join('\n'), /may not be excluded/);
});
