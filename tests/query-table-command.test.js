const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildQueryTableQueries,
  validateFilterPattern,
} = require('../src/cli/commands/queryTableCommand');

test('buildQueryTableQueries constrains table, schema, and optional column filter', () => {
  const queries = buildQueryTableQueries({
    schema: 'MYLIB',
    table: 'ORDERS',
    filter: '%DATE%',
  });

  assert.match(queries.tableInfo, /FROM QSYS2\.SYSTABLES/);
  assert.match(queries.tableInfo, /TABLE_SCHEMA = 'MYLIB'/);
  assert.match(queries.tableInfo, /TABLE_NAME = 'ORDERS'/);
  assert.doesNotMatch(queries.tableInfo, /ROW_COUNT/);
  assert.match(queries.columns, /FROM QSYS2\.SYSCOLUMNS/);
  assert.match(queries.columns, /COLUMN_NAME LIKE '%DATE%'/);
  assert.match(queries.columns, /ORDINAL_POSITION/);
});

test('validateFilterPattern rejects unsafe characters', () => {
  assert.equal(validateFilterPattern('cust%'), 'CUST%');
  assert.throws(
    () => validateFilterPattern("X%' OR 1=1 --"),
    /Invalid --filter pattern/,
  );
});
