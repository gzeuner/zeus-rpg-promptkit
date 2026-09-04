'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  maskSpoolText,
  optionalPositiveInteger,
  run,
} = require('../src/cli/commands/spoolReadCommand');
const { resetConnectionGuardState } = require('../src/security/connectionGuards');

test('optionalPositiveInteger accepts a positive value and omits absent options', () => {
  assert.equal(optionalPositiveInteger({}, 'spool-number', 99), null);
  assert.equal(optionalPositiveInteger({ 'spool-number': '42' }, 'spool-number', 99), 42);
});

test('optionalPositiveInteger rejects values outside the permitted range', () => {
  assert.throws(
    () => optionalPositiveInteger({ 'spool-number': '0' }, 'spool-number', 99),
    /integer between 1 and 99/
  );
  assert.throws(
    () => optionalPositiveInteger({ 'spool-number': '100' }, 'spool-number', 99),
    /integer between 1 and 99/
  );
});

test('maskSpoolText redacts URL credentials and configured sensitive terms', () => {
  const output = maskSpoolText(
    'remote https://build-user:secret-token@example.test/team/repo.git password=secret-token',
    ['secret-token']
  );

  assert.match(output, /https:\/\/\[REDACTED\]:\[REDACTED\]@example\.test/);
  assert.doesNotMatch(output, /build-user|secret-token/);
});

test('run performs a read-only preflight and keeps the password out of Java arguments', async () => {
  const calls = [];
  const optionsByClass = new Map();
  resetConnectionGuardState();

  try {
    const result = await run(
      {
        profile: 'default-fetch',
        host: 'test-host',
        user: 'TESTUSER',
        password: 'test-password',
        'job-number': '000001',
        'job-user': 'TESTUSER',
        'job-name': 'TESTJOB',
        'spool-file': 'QPRINT',
        'spool-number': '1',
        json: true,
      },
      {
        cwd: process.cwd(),
        env: {
          ZEUS_FETCH_HOST: 'test-host',
          ZEUS_FETCH_USER: 'TESTUSER',
        },
        timeoutMs: 4321,
        runJavaHelper(className, args, options) {
          calls.push(className);
          optionsByClass.set(className, { args, options });
          if (className === 'IbmiCommandRunner') {
            return {
              status: 0,
              stdout: JSON.stringify({ ok: true, results: [], messages: [] }),
              stderr: '',
            };
          }
          return {
            status: 0,
            stdout: JSON.stringify({
              ok: true,
              found: true,
              matches: [
                {
                  jobNumber: '000001',
                  jobUser: 'TESTUSER',
                  jobName: 'TESTJOB',
                  spoolFileName: 'QPRINT',
                  spoolFileNumber: 1,
                  truncated: false,
                  text: 'password=test-password',
                },
              ],
            }),
            stderr: '',
          };
        },
      }
    );

    assert.deepEqual(calls, ['IbmiCommandRunner', 'IbmiSpooledFileReader']);
    assert.equal(result.found, true);
    assert.equal(result.matches[0].text, 'password=[REDACTED]');
    assert.equal(optionsByClass.get('IbmiSpooledFileReader').options.password, 'test-password');
    assert.equal(optionsByClass.get('IbmiSpooledFileReader').options.timeout, 4321);
    assert.ok(!optionsByClass.get('IbmiSpooledFileReader').args.includes('test-password'));
  } finally {
    resetConnectionGuardState();
  }
});
