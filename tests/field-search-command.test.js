const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeMode,
  parseMaxResultsOption,
} = require('../src/cli/commands/fieldSearchCommand');

test('normalizeMode accepts local/remote/xref/all only', () => {
  assert.equal(normalizeMode(undefined), 'all');
  assert.equal(normalizeMode('local'), 'local');
  assert.equal(normalizeMode('REMOTE'), 'remote');
  assert.throws(
    () => normalizeMode('invalid'),
    /--mode must be one of local, remote, xref, all/,
  );
});

test('parseMaxResultsOption validates positive integer', () => {
  assert.equal(parseMaxResultsOption(undefined), 300);
  assert.equal(parseMaxResultsOption('25'), 25);
  assert.throws(
    () => parseMaxResultsOption('0'),
    /--max-results/,
  );
  assert.throws(
    () => parseMaxResultsOption('foo'),
    /--max-results/,
  );
});
