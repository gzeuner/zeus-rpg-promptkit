const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { runScannerCorpus } = require('../src/scanner/scannerCorpusRunner');

test('scanner corpus runner validates the curated pattern corpus without regressions', () => {
  const corpusPath = path.join(__dirname, 'fixtures', 'sanitized-corpus', 'scanner', 'core-patterns.json');
  const result = runScannerCorpus(corpusPath);

  assert.equal(result.summary.caseCount, 4);
  assert.equal(result.summary.failedCaseCount, 0, JSON.stringify(result.results.filter((entry) => !entry.passed), null, 2));
  assert.equal(result.results.every((entry) => entry.passed), true);
  assert.ok(result.results.some((entry) => entry.id === 'fixed-form-rpg'));
  assert.ok(result.results.some((entry) => entry.id === 'sqlrpgle'));
  assert.ok(result.results.some((entry) => entry.id === 'ile-binding'));
});
