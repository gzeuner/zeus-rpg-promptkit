'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertReadOnlySelect,
  buildJournalQuery,
  normalizeTimestampLiteral,
  parseColumnList,
  parseLayout,
  runJournalRowDiff,
} = require('../src/db2/journalRowDiffService');
const { buildToolsDescribePayload } = require('../src/cli/commandHelp');

const layout = parseLayout('ID:P:3:0,STATUS:C:1:0,AMOUNT:P:4:2');

test('journal row diff normalizes timestamps and builds bounded safe journal SQL', () => {
  assert.equal(normalizeTimestampLiteral('2026-08-21T10:20:30', 'start'), '2026-08-21-10.20.30');
  const query = buildJournalQuery({
    journalLibrary: 'appdata',
    journalName: 'appjrn',
    start: '2026-08-21-10.00.00',
    end: '2026-08-21-11.00.00',
    maxPairs: 25,
  });
  assert.match(query, /DISPLAY_JOURNAL\('APPDATA', 'APPJRN'/);
  assert.match(query, /FETCH FIRST 50 ROWS ONLY/);
  assert.throws(
    () =>
      buildJournalQuery({
        journalLibrary: 'APPDATA;DROP',
        journalName: 'APPJRN',
        start: '2026-08-21-10.00.00',
        end: '2026-08-21-11.00.00',
      }),
    /simple IBM i identifier/
  );
});

test('journal row diff validates layouts, key references, timestamps, and read-only SQL', () => {
  assert.deepEqual(parseColumnList('id,status', 'key column', layout), ['ID', 'STATUS']);
  assert.throws(() => parseColumnList('MISSING', 'key column', layout), /not present/);
  assert.throws(() => parseLayout('ID:X:3:0'), /Invalid layout column/);
  assert.throws(() => normalizeTimestampLiteral('2026-02-30-10.00.00', 'start'), /valid timestamp/);
  assert.doesNotThrow(() =>
    assertReadOnlySelect("WITH q AS (SELECT 'update' AS value) SELECT * FROM q", 'audit query')
  );
  assert.throws(
    () => assertReadOnlySelect("UPDATE APPDATA.TABLE SET STATUS = 'X'", 'audit query'),
    /read-only/
  );
  assert.throws(
    () => assertReadOnlySelect('SELECT 1; DELETE FROM APPDATA.TABLE', 'audit query'),
    /read-only/
  );
});

test('journal row diff passes only redacted credentials and aggregate-safe arguments to Java', () => {
  let captured;
  const result = runJournalRowDiff({
    dbConfig: {
      url: 'jdbc:as400://ibmi.example',
      user: 'READONLY',
      password: 'runtime-only-secret',
      defaultSchema: 'APPDATA',
    },
    journalLibrary: 'APPDATA',
    journalName: 'APPJRN',
    start: '2026-08-21-10.00.00',
    end: '2026-08-21-11.00.00',
    maxPairs: 10,
    auditQuery: 'SELECT ID, CHANGED_AT FROM APPDATA.AUDIT_LOG',
    layout,
    keyColumns: ['ID'],
    ignoreColumns: ['STATUS'],
    runtime: {
      runJavaHelper: (className, args, options) => {
        captured = { className, args, options };
        return {
          status: 0,
          stdout: '{"status":"OK","diff":{"noOpCount":1,"contentChangeCount":0}}',
          stderr: '',
        };
      },
    },
  });
  assert.equal(result.status, 'OK');
  assert.equal(captured.className, 'JournalRowDiffAnalyzer');
  assert.equal(captured.args[2], '@ZEUS_SECRET_ENV@');
  assert.equal(captured.options.password, 'runtime-only-secret');
  assert.equal(
    captured.args.some(value => String(value).includes('runtime-only-secret')),
    false
  );
  assert.equal(captured.args.length, 10);
  assert.equal(captured.args[3].includes('DISPLAY_JOURNAL'), true);
  assert.equal(captured.args[4], 'SELECT ID, CHANGED_AT FROM APPDATA.AUDIT_LOG');
});

test('journal row diff is discoverable through the stable command catalog', () => {
  const payload = buildToolsDescribePayload('journal-row-diff');
  assert.equal(payload.help.command, 'journal-row-diff');
  assert.equal(payload.help.safety, 'S2');
  assert.equal(payload.help.scope, 'DB2 read');
  assert.equal(payload.help.mcpNames.length, 0);
  assert.match(payload.help.purpose, /aggregate no-op/i);
});
