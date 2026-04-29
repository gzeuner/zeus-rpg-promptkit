const test = require('node:test');
const assert = require('node:assert/strict');

const {
  executeReadOnlyDb2QueryWithFallback,
  extractSqlState,
} = require('../src/db2/readOnlyQueryService');

test('extractSqlState recognizes IBM i SQL codes and SQLSTATE values', () => {
  assert.equal(extractSqlState(new Error('SQL0204 Tabelle nicht gefunden')), 'SQL0204');
  assert.equal(extractSqlState(new Error('Fehler SQLSTATE=55019 Commitment control')), '55019');
  assert.equal(extractSqlState(new Error('kein sql state hier')), '');
});

test('executeReadOnlyDb2QueryWithFallback retries with the handler-provided query', () => {
  const calls = [];
  const result = executeReadOnlyDb2QueryWithFallback({
    dbConfig: {
      host: 'ibmi.example.com',
      user: 'ZEUS',
      password: 'secret',
    },
    query: 'SELECT * FROM MISSING',
    maxRows: 200,
    context: {
      table: 'MISSING',
    },
    retryHandlers: {
      SQL0204: ({ context }) => ({
        query: `SELECT * FROM ${context.table}_FALLBACK`,
      }),
    },
    runtime: {
      runJavaHelper(_className, args) {
        calls.push(args[3]);
        if (calls.length === 1) {
          return {
            status: 2,
            stdout: '',
            stderr: 'SQL0204 Tabelle nicht gefunden',
          };
        }
        return {
          status: 0,
          stdout: JSON.stringify({
            columns: ['ID'],
            rows: [{ ID: 1 }],
            rowCount: 1,
          }),
          stderr: '',
        };
      },
    },
  });

  assert.deepEqual(calls, ['SELECT * FROM MISSING', 'SELECT * FROM MISSING_FALLBACK']);
  assert.equal(result.rowCount, 1);
});
