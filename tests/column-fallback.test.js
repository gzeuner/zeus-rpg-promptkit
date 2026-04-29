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
  }, 'DATEIEN', 'WERBPLA_00', buildRuntimeWithRows([
    { COLUMN_NAME: 'pjahr' },
    { COLUMN_NAME: 'pwpreis' },
  ]));

  assert.deepEqual(columns, ['PJAHR', 'PWPREIS']);
});

test('resolveColumn uses central alias candidates before giving up', () => {
  const resolved = resolveColumn({
    host: 'ibmi.example.com',
    user: 'ZEUS',
    password: 'secret',
  }, 'DATEIEN', 'WERBPLA_00', 'WERBEJAHR', buildRuntimeWithRows([
    { COLUMN_NAME: 'PJAHR' },
    { COLUMN_NAME: 'PWPREIS' },
  ]));

  assert.deepEqual(COLUMN_ALIASES.WERBEJAHR, ['WERBEJAHR', 'PJAHR', 'XJAHR', 'WERBJAHR']);
  assert.equal(resolved, 'PJAHR');
});
