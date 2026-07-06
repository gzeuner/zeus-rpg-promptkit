const test = require('node:test');
const assert = require('node:assert/strict');

const {
  executeReadOnlyDb2QueryWithFallback,
  extractSqlState,
} = require('../src/db2/readOnlyQueryService');
const { SECRET_ENV_SENTINEL } = require('../src/java/javaRuntime');

test('extractSqlState recognizes IBM i SQL codes and SQLSTATE values', () => {
  assert.equal(extractSqlState(new Error('SQL0204 Tabelle nicht gefunden')), 'SQL0204');
  assert.equal(extractSqlState(new Error('Fehler SQLSTATE=55019 Commitment control')), '55019');
  assert.equal(extractSqlState(new Error('kein sql state hier')), '');
});

test('read-only query passes the password via options, not as a CLI argument', () => {
  let capturedArgs = null;
  let capturedOptions = null;
  executeReadOnlyDb2QueryWithFallback({
    dbConfig: {
      host: 'ibmi.example.com',
      user: 'ZEUS',
      password: 'top-secret-pw',
    },
    query: 'SELECT 1 FROM SYSIBM.SYSDUMMY1',
    maxRows: 10,
    runtime: {
      skipConnectionGuard: true,
      runJavaHelper(_className, args, options) {
        capturedArgs = args;
        capturedOptions = options;
        return {
          status: 0,
          stdout: JSON.stringify({ columns: ['C'], rows: [{ C: 1 }], rowCount: 1 }),
          stderr: '',
        };
      },
    },
  });

  // The password must NOT appear anywhere in the argument vector (which is visible
  // in the OS process list); the sentinel takes its place.
  assert.equal(capturedArgs[2], SECRET_ENV_SENTINEL);
  assert.ok(!capturedArgs.includes('top-secret-pw'));
  // The real password is handed over out-of-band via the options.
  assert.equal(capturedOptions.password, 'top-secret-pw');
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
      skipConnectionGuard: true,
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
  assert.deepEqual(result.meta, {
    degradedMode: false,
    attemptCount: 2,
    usedVariant: 'fallback-42704-1',
  });
});
