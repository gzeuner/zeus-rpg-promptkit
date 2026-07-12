const test = require('node:test');
const assert = require('node:assert/strict');

const { runReadOnlyDb2Query } = require('../src/db2/readOnlyQueryService');
const { listMembers } = require('../src/fetch/jt400CommandRunner');
const { resetConnectionGuardState } = require('../src/security/connectionGuards');

function sampleDbConfig() {
  return {
    host: 'ibmi.example.com',
    user: 'ZEUS',
    password: 'secret',
  };
}

test('DB2 connection guard aborts repeated auth failures after the first probe', () => {
  resetConnectionGuardState();
  const calls = [];
  const runtime = {
    runJavaHelper(_className, args) {
      calls.push(args[3]);
      return {
        status: 2,
        stdout: '',
        stderr: 'SQL30082 Authentication failed',
      };
    },
  };

  assert.throws(
    () =>
      runReadOnlyDb2Query({
        dbConfig: sampleDbConfig(),
        query: 'SELECT * FROM QSYS2.SYSTABLES FETCH FIRST 1 ROW ONLY',
        runtime,
      }),
    /Pre-flight login check failed/i
  );
  assert.throws(
    () =>
      runReadOnlyDb2Query({
        dbConfig: sampleDbConfig(),
        query: 'SELECT * FROM QSYS2.SYSTABLES FETCH FIRST 1 ROW ONLY',
        runtime,
      }),
    /already failed/i
  );

  assert.deepEqual(calls, ['SELECT 1 AS HEALTHCHECK FROM SYSIBM.SYSDUMMY1']);
  resetConnectionGuardState();
});

test('fetch connection guard aborts repeated auth failures before member listing', () => {
  resetConnectionGuardState();
  const calls = [];
  const runtime = {
    runJavaHelper(className, args) {
      calls.push({ className, arg: args[3] || args[4] });
      if (className === 'IbmiCommandRunner') {
        return {
          status: 2,
          stdout: '',
          stderr: 'CPF22E2 Signon failed',
        };
      }
      return {
        status: 0,
        stdout: JSON.stringify({ ok: true, members: ['ORDERPGM'] }),
        stderr: '',
      };
    },
  };

  assert.throws(
    () =>
      listMembers({
        host: 'ibmi.example.com',
        user: 'ZEUS',
        password: 'secret',
        sourceLib: 'DEMO',
        sourceFile: 'QRPGLESRC',
        runtime,
      }),
    /Pre-flight login check failed/i
  );
  assert.throws(
    () =>
      listMembers({
        host: 'ibmi.example.com',
        user: 'ZEUS',
        password: 'secret',
        sourceLib: 'DEMO',
        sourceFile: 'QRPGLESRC',
        runtime,
      }),
    /already failed/i
  );

  assert.deepEqual(calls, [
    {
      className: 'IbmiCommandRunner',
      arg: 'CHKOBJ OBJ(QSYS/QSYS) OBJTYPE(*LIB)',
    },
  ]);
  resetConnectionGuardState();
});
