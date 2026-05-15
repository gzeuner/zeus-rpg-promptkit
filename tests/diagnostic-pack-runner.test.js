const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseDiagnosticParameterString,
  runDiagnosticPacks,
  validateReadOnlyCommand,
  validateReadOnlySql,
} = require('../src/investigation/diagnosticPackRunner');

test('diagnostic pack runner executes SQL and command steps through injected executors', () => {
  const executed = [];
  const result = runDiagnosticPacks({
    packNames: ['table-investigation', 'program-investigation'],
    parameterString: 'table=ORDERS,program=ORDERPGM,library=APPLIB',
    dbConfig: { host: 'ibmi.example.com', user: 'USER', password: 'SECRET', defaultSchema: 'APPLIB' },
    ibmiConfig: { host: 'ibmi.example.com', user: 'USER', password: 'SECRET' },
    executors: {
      sql: ({ query }) => {
        executed.push({ kind: 'sql', query });
        return {
          columns: ['NAME'],
          rows: [{ NAME: 'VALUE' }],
          rowCount: 1,
        };
      },
      command: ({ command }) => {
        executed.push({ kind: 'command', command });
        return {
          ok: true,
          messages: ['CPF0000 completed'],
          exitCode: 0,
        };
      },
    },
  });

  assert.equal(result.report.enabled, true);
  assert.equal(result.report.summary.packCount, 2);
  assert.equal(result.report.summary.failedPackCount, 0);
  assert.ok(executed.some((entry) => entry.kind === 'sql' && /QSYS2\.SYSTABLES/i.test(entry.query)));
  assert.ok(executed.some((entry) => entry.kind === 'command' && /DSPOBJD/i.test(entry.command)));
  assert.equal(result.manifest.kind, 'diagnostic-query-pack-manifest');
});

test('diagnostic parameter parsing is deterministic', () => {
  assert.deepEqual(parseDiagnosticParameterString('table=ORDERS, library = APPLIB ,invalid'), {
    table: 'ORDERS',
    library: 'APPLIB',
  });
});

test('diagnostic runner rejects unsafe SQL and commands', () => {
  assert.throws(() => validateReadOnlySql('update orders set status = 1'), /select or with|read-only/i);
  assert.throws(() => validateReadOnlyCommand('DLTOBJ OBJ(APPLIB/ORDERS) OBJTYPE(*FILE)'), /allowlist/i);
});
