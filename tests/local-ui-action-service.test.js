const test = require('node:test');
const assert = require('node:assert/strict');

const {
  UiActionError,
  createLocalUiActionService,
  normalizeDoctorDiagnostics,
  normalizeDoctorPayload,
  validateProfileName,
} = require('../src/ui/localUiActionService');

test('doctor action accepts valid payload and returns structured metadata', async () => {
  const service = createLocalUiActionService({
    doctorExecutor: () => ({
      hasCriticalFailure: false,
      checks: [
        { name: 'Config/Profile', status: 'PASS', details: 'ok' },
        { name: 'Java', status: 'WARN', details: 'java optional' },
      ],
      diagnostics: [
        {
          code: 'ENV_PROFILE_CONFLICT',
          severity: 'WARN',
          path: 'db.host',
          profile: 'primary-readonly',
          profileValue: 'primary-system',
          envVar: 'ZEUS_DB_HOST',
          effectiveValue: 'secondary-system',
          message: 'unsafe placeholder',
        },
      ],
    }),
  });

  const result = await service.executeAction('doctor', {
    profile: 'dev',
    showResolved: false,
  });

  assert.equal(result.action, 'doctor');
  assert.equal(result.status, 'warning');
  assert.equal(typeof result.startedAt, 'string');
  assert.equal(typeof result.finishedAt, 'string');
  assert.equal(typeof result.durationMs, 'number');
  assert.equal(result.input.profile, 'dev');
  assert.equal(result.input.showResolved, false);
  assert.equal(result.result.summary.pass, 1);
  assert.equal(result.result.summary.warn, 1);
  assert.equal(result.result.diagnosticsSummary.warn, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, 'ENV_PROFILE_CONFLICT');
  assert.equal(result.diagnostics[0].message.includes('Env vars have precedence.'), true);
});

test('unknown action is rejected', async () => {
  const service = createLocalUiActionService({
    doctorExecutor: () => ({ hasCriticalFailure: false, checks: [] }),
  });
  await assert.rejects(
    () => service.executeAction('fetch', { profile: 'dev' }),
    (error) => error instanceof UiActionError && error.statusCode === 404,
  );
});

test('unknown payload keys are rejected', () => {
  assert.throws(
    () => normalizeDoctorPayload({
      profile: 'dev',
      showResolved: false,
      cmd: 'rm -rf /',
    }),
    /unsupported key/i,
  );
});

test('unsafe profile names are rejected', () => {
  for (const candidate of [
    '../dev',
    'dev;rm -rf',
    'dev && echo hacked',
    'dev test',
    '"dev"',
    'dev/profile',
    'dev\\profile',
  ]) {
    assert.throws(
      () => validateProfileName(candidate),
      /invalid payload/i,
      `expected profile "${candidate}" to be rejected`,
    );
  }
});

test('showResolved=true is accepted without exposing resolved values', async () => {
  const service = createLocalUiActionService({
    doctorExecutor: () => ({
      hasCriticalFailure: false,
      checks: [
        { name: 'Config/Profile', status: 'PASS', details: 'Loaded profile "dev".' },
      ],
    }),
  });
  const result = await service.executeAction('doctor', {
    profile: 'dev',
    showResolved: true,
  });

  assert.equal(result.input.showResolved, true);
  assert.ok(Array.isArray(result.notes));
  assert.ok(result.notes.some((entry) => /intentionally not exposed/i.test(entry)));
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'resolvedValues'), false);
});

test('normalizeDoctorDiagnostics redacts secret-like values and summarizes jdbc URLs safely', () => {
  const diagnostics = normalizeDoctorDiagnostics([
    {
      code: 'ENV_PROFILE_CONFLICT',
      severity: 'WARN',
      path: 'db.url',
      profile: 'development',
      profileValue: 'jdbc:as400://profile-user:secret@primary-system;naming=system',
      envVar: 'ZEUS_DB_URL',
      effectiveValue: 'jdbc:as400://env-user:secret@secondary-system;naming=system',
      message: '<script>alert(1)</script>',
    },
    {
      code: 'ENV_PROFILE_CONFLICT',
      severity: 'WARN',
      path: 'db.password',
      profile: 'development',
      profileValue: 'profile-secret',
      envVar: 'ZEUS_DB_PASSWORD',
      effectiveValue: 'env-secret',
      message: 'do not expose',
    },
  ]);

  assert.equal(diagnostics[0].profileValue, 'primary-system');
  assert.equal(diagnostics[0].effectiveValue, 'secondary-system');
  assert.equal(diagnostics[0].message.includes('<script>'), false);
  assert.equal(diagnostics[1].profileValue, '(redacted)');
  assert.equal(diagnostics[1].effectiveValue, '(redacted)');
});
