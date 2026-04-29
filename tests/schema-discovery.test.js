const test = require('node:test');
const assert = require('node:assert/strict');

const { discoverSchema, sortSchemaCandidates } = require('../src/db2/schemaDiscovery');

function buildRuntimeWithRows(rows) {
  return {
    runJavaHelper() {
      return {
        status: 0,
        stdout: JSON.stringify({
          columns: ['TABLE_SCHEMA'],
          rows,
          rowCount: rows.length,
        }),
        stderr: '',
      };
    },
  };
}

test('sortSchemaCandidates prefers production-like schemas first', () => {
  const sorted = sortSchemaCandidates([
    { TABLE_SCHEMA: 'ARCHIVE' },
    { TABLE_SCHEMA: 'DATEIEN' },
    { TABLE_SCHEMA: 'PROD' },
  ]);

  assert.deepEqual(sorted.map((entry) => entry.TABLE_SCHEMA), ['DATEIEN', 'PROD', 'ARCHIVE']);
});

test('discoverSchema returns the preferred schema candidate', () => {
  const resolved = discoverSchema({
    host: 'ibmi.example.com',
    user: 'ZEUS',
    password: 'secret',
  }, 'meine_tabelle', buildRuntimeWithRows([
    { TABLE_SCHEMA: 'ARCHIVE' },
    { TABLE_SCHEMA: 'DATEIEN' },
  ]));

  assert.equal(resolved.TABLE_SCHEMA, 'DATEIEN');
});
