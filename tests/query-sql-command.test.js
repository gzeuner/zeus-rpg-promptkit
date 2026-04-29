const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_MAX_ROWS,
  normalizeOutput,
  parseMaxRows,
  toRowMatrix,
} = require('../src/cli/commands/querySqlCommand');

test('parseMaxRows defaults to the larger read-only query budget', () => {
  assert.equal(parseMaxRows(undefined), DEFAULT_MAX_ROWS);
  assert.equal(parseMaxRows('250'), 250);
  assert.throws(
    () => parseMaxRows('0'),
    /--max-rows/,
  );
});

test('normalizeOutput accepts table and csv only', () => {
  assert.equal(normalizeOutput(undefined), 'table');
  assert.equal(normalizeOutput('csv'), 'csv');
  assert.throws(
    () => normalizeOutput('json'),
    /--output must be one of: table, csv/,
  );
});

test('toRowMatrix preserves column order for object rows', () => {
  const matrix = toRowMatrix(['ID', 'NAME'], [
    { NAME: 'Alpha', ID: 1 },
    { NAME: 'Beta', ID: 2 },
  ]);

  assert.deepEqual(matrix, [
    [1, 'Alpha'],
    [2, 'Beta'],
  ]);
});
