const test = require('node:test');
const assert = require('node:assert/strict');

const { COLUMN_ALIASES, getActualColumns, resolveColumn } = require('../src/db2/columnFallback');

function buildRuntimeWithRows(rows) {
  return {
    runJavaHelper() {
      return {
        status: 0,
        stdout: JSON.stringify({
          columns: ['COLUMN_NAME'],
          rows,
          rowCount: rows.length,
        }),
        stderr: '',
      };
    },
  };
}

test('getActualColumns returns uppercase column names in ordinal order', () => {
  const columns = getActualColumns({
    host: 'ibmi.example.com',
    user: 'ZEUS',
    password: 'secret',
  }, 'APPDATA', 'APPVIEW_00', buildRuntimeWithRows([
    { COLUMN_NAME: 'pjahr' },
    { COLUMN_NAME: 'pwpreis' },
  ]));

  assert.deepEqual(columns, ['P_YEAR', 'P_PRICE']);
});

test('resolveColumn uses central alias candidates before giving up', () => {
  const resolved = resolveColumn({
    host: 'ibmi.example.com',
    user: 'ZEUS',
    password: 'secret',
  }, 'APPDATA', 'APPVIEW_00', 'APP_YEAR', buildRuntimeWithRows([
    { COLUMN_NAME: 'P_YEAR' },
    { COLUMN_NAME: 'P_PRICE' },
  ]));

  assert.deepEqual(COLUMN_ALIASES.APP_YEAR, ['APP_YEAR', 'P_YEAR', 'X_YEAR', 'APP_YEAR_ALT']);
  assert.equal(resolved, 'P_YEAR');
});
