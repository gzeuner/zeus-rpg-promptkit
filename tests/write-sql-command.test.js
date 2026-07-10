const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildBackupObjectName,
  ensureBackupCreated,
  resolveSqlStatements,
  validateWriteSql,
} = require('../src/cli/commands/writeSqlCommand');
const {
  executeWriteDb2QueriesRaw,
} = require('../src/db2/writeQueryService');

test('validateWriteSql accepts INSERT/UPDATE/DELETE/MERGE in upsert mode', () => {
  assert.doesNotThrow(() => validateWriteSql('INSERT INTO T (ID) VALUES (1)', { mode: 'upsert-sql' }));
  assert.doesNotThrow(() => validateWriteSql('UPDATE T SET STATUS = 1 WHERE ID = 1', { mode: 'upsert-sql' }));
  assert.doesNotThrow(() => validateWriteSql('DELETE FROM T WHERE ID = 1', { mode: 'upsert-sql' }));
  assert.doesNotThrow(() => validateWriteSql('MERGE INTO T USING S ON T.ID = S.ID WHEN MATCHED THEN UPDATE SET T.N = S.N', { mode: 'upsert-sql' }));
});

test('validateWriteSql rejects SELECT in upsert mode', () => {
  assert.throws(
    () => validateWriteSql('SELECT * FROM T', { mode: 'upsert-sql' }),
    /upsert-sql only accepts DML statements: INSERT, UPDATE, DELETE, MERGE/i
  );
});

test('validateWriteSql insert mode accepts only INSERT', () => {
  assert.doesNotThrow(() => validateWriteSql('INSERT INTO T (ID) VALUES (1)', { mode: 'insert' }));
  assert.throws(
    () => validateWriteSql('UPDATE T SET STATUS = 1 WHERE ID = 1', { mode: 'insert' }),
    /insert only accepts DML statements: INSERT/i
  );
});

test('validateWriteSql update mode accepts only UPDATE', () => {
  assert.doesNotThrow(() => validateWriteSql('UPDATE T SET STATUS = 1 WHERE ID = 1', { mode: 'update' }));
  assert.throws(
    () => validateWriteSql('INSERT INTO T (ID) VALUES (1)', { mode: 'update' }),
    /update only accepts DML statements: UPDATE/i
  );
});

test('buildBackupObjectName generates IBM i compatible backup names without leading underscores', () => {
  const backupName = buildBackupObjectName('_customer-orders', {
    now: new Date('2026-06-15T12:34:56.000Z'),
  });

  assert.match(backupName, /^BAK[A-Z0-9_]+$/);
  assert.equal(backupName.startsWith('_'), false);
  assert.equal(backupName.length <= 18, true);
});

test('ensureBackupCreated aborts when require-backup is set and no target table can be resolved', () => {
  assert.throws(
    () => ensureBackupCreated({
      args: { 'require-backup': true },
      config: { db: { defaultSchema: 'APP' } },
      dbConfig: { host: 'ibmi.example.com', user: 'ZEUS', password: 'secret' },
      sql: 'MERGE INTO APP.ORDERS O USING APP.STAGE S ON O.ID = S.ID WHEN MATCHED THEN UPDATE SET O.STATUS = S.STATUS',
      services: {
        runWriteDb2Query() {
          throw new Error('should not be called');
        },
      },
    }),
    /require-backup/i,
  );
});

test('ensureBackupCreated executes backup creation before writes', () => {
  const statements = [];
  const created = ensureBackupCreated({
    args: { backup: true },
    config: { db: { defaultSchema: 'ARCHIVE' } },
    dbConfig: { host: 'ibmi.example.com', user: 'ZEUS', password: 'secret' },
    sql: 'DELETE FROM APP.ORDERS WHERE STATUS = 0',
    services: {
      runWriteDb2Query({ sql }) {
        statements.push(sql);
        return { rowsAffected: 0 };
      },
    },
  });

  assert.equal(statements.length, 1);
  assert.match(statements[0], /^CREATE TABLE ARCHIVE\.BAK[A-Z0-9_]+ AS \(SELECT \* FROM APP\.ORDERS\) WITH DATA$/);
  assert.equal(created.targetTable, 'APP.ORDERS');
});

test('resolveSqlStatements splits multiple DML statements', () => {
  assert.deepEqual(
    resolveSqlStatements({
      sql: "INSERT INTO T (NAME) VALUES ('A;B'); UPDATE T SET STATUS = 'Y' WHERE ID = 1;",
    }),
    [
      "INSERT INTO T (NAME) VALUES ('A;B')",
      "UPDATE T SET STATUS = 'Y' WHERE ID = 1",
    ],
  );
});

test('executeWriteDb2QueriesRaw uses one Java call with a statements file', () => {
  let capturedArgs = null;
  const result = executeWriteDb2QueriesRaw({
    dbConfig: {
      host: 'ibmi.example.com',
      user: 'ZEUS',
      password: 'secret',
    },
    statements: [
      'INSERT INTO T (ID) VALUES (1)',
      'UPDATE T SET STATUS = 1 WHERE ID = 1',
    ],
    runtime: {
      skipConnectionGuard: true,
      runJavaHelper(className, args) {
        capturedArgs = args;
        assert.equal(className, 'Db2WriteQueryRunner');
        assert.ok(args.includes('--statements-file'));
        return {
          status: 0,
          stdout: JSON.stringify({
            statementCount: 2,
            results: [
              { sql: 'INSERT INTO T (ID) VALUES (1)', rowsAffected: 1 },
              { sql: 'UPDATE T SET STATUS = 1 WHERE ID = 1', rowsAffected: 1 },
            ],
            rowsAffected: 2,
          }),
          stderr: '',
        };
      },
    },
  });

  assert.equal(capturedArgs[2], '@ZEUS_SECRET_ENV@');
  assert.equal(result.rowsAffected, 2);
  assert.equal(result.statementCount, 2);
  assert.deepEqual(result.results.map((entry) => entry.rowsAffected), [1, 1]);
});
