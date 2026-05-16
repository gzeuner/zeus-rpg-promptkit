const test = require('node:test');
const assert = require('node:assert/strict');

const { validateWriteSql } = require('../src/cli/commands/writeSqlCommand');

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
