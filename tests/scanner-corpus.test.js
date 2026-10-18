const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { runScannerCorpus } = require('../src/scanner/scannerCorpusRunner');
const { scanRpgFile } = require('../src/scanner/rpgScanner');

test('scanner corpus runner validates the curated pattern corpus without regressions', () => {
  const corpusPath = path.join(
    __dirname,
    'fixtures',
    'sanitized-corpus',
    'scanner',
    'core-patterns.json'
  );
  const result = runScannerCorpus(corpusPath);

  assert.equal(result.summary.caseCount, 6);
  assert.equal(
    result.summary.failedCaseCount,
    0,
    JSON.stringify(
      result.results.filter(entry => !entry.passed),
      null,
      2
    )
  );
  assert.equal(
    result.results.every(entry => entry.passed),
    true
  );
  assert.ok(result.results.some(entry => entry.id === 'fixed-form-rpg'));
  assert.ok(result.results.some(entry => entry.id === 'sqlrpgle'));
  assert.ok(result.results.some(entry => entry.id === 'ile-binding'));
  assert.ok(result.results.some(entry => entry.id === 'fixed-native-io'));
  assert.ok(result.results.some(entry => entry.id === 'free-native-io'));
});

test('ambiguous record-format I/O retains candidates without inventing a target file', () => {
  const fixture = path.join(
    __dirname,
    'fixtures',
    'sanitized-corpus',
    'scanner',
    'core-patterns',
    'ambiguous-native-io.rpgle'
  );
  const result = scanRpgFile(fixture);
  const access = result.nativeFileAccesses.find(entry => entry.opcode === 'UPDATE');

  assert.equal(access.fileName, null);
  assert.equal(access.targetName, 'SHARED');
  assert.equal(access.resolution, 'AMBIGUOUS');
  assert.deepEqual(access.candidateFiles, ['FILEONE', 'FILETWO']);
  assert.equal(access.mutating, true);
  assert.ok(result.diagnostics.some(entry => entry.code === 'NATIVE_IO_TARGET_AMBIGUOUS'));
});
