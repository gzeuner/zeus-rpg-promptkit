'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { inspectInventory, renderSummary, MCP_TEST } = require('../scripts/test-inventory');
const baseConfig = require('../scripts/test-inventory.config');

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
});

test('an untracked maintained-path test is rejected as unclassified', () => {
  const temporary = path.join(__dirname, 'temporary-unclassified.test.js');
  try {
    fs.writeFileSync(temporary, "'use strict';\n", 'utf8');
    const report = inspectInventory();
    assert.match(report.errors.join('\n'), /omitted test: tests\/temporary-unclassified\.test\.js/);
  } finally {
    fs.rmSync(temporary, { force: true });
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
