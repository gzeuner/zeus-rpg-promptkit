const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_MAX_ROWS,
  normalizeOutput,
  parseMaxRows,
  splitSqlStatements,
  toRowMatrix,
} = require('../src/cli/commands/querySqlCommand');

test('parseMaxRows defaults to the larger read-only query budget', () => {
  assert.equal(parseMaxRows(undefined), DEFAULT_MAX_ROWS);
  assert.equal(parseMaxRows('250'), 250);
  assert.throws(() => parseMaxRows('0'), /--max-rows/);
});

test('normalizeOutput accepts table, csv, and json', () => {
  assert.equal(normalizeOutput(undefined), 'table');
  assert.equal(normalizeOutput('csv'), 'csv');
  assert.equal(normalizeOutput('json'), 'json');
});

test('toRowMatrix preserves column order for object rows', () => {
  const matrix = toRowMatrix(
    ['ID', 'NAME'],
    [
      { NAME: 'Alpha', ID: 1 },
      { NAME: 'Beta', ID: 2 },
    ]
  );

  assert.deepEqual(matrix, [
    [1, 'Alpha'],
    [2, 'Beta'],
  ]);
});

test('splitSqlStatements supports quoted semicolons and multiple statements', () => {
  assert.deepEqual(
    splitSqlStatements(
      "SELECT 'A;B' AS X FROM SYSIBM.SYSDUMMY1; SELECT 2 AS Y FROM SYSIBM.SYSDUMMY1;"
    ),
    ["SELECT 'A;B' AS X FROM SYSIBM.SYSDUMMY1", 'SELECT 2 AS Y FROM SYSIBM.SYSDUMMY1']
  );
});
