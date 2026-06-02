const test = require('node:test');
const assert = require('node:assert/strict');

const {
  UiActionError,
  createLocalUiActionService,
  normalizeAnalyzeExistingWorkspacePayload,
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

test('analyze-existing-workspace action accepts valid payload, applies safe defaults, and returns safe links', async () => {
  let receivedArgs = null;
  const service = createLocalUiActionService({
    cwd: '/workspace/project',
    analyzeConfigResolver: () => ({
      sourceRoot: './workspace',
      outputRoot: './output',
    }),
    analyzeExecutor: (args) => {
      receivedArgs = args;
      return {
        program: 'ORDERPGM',
        analyzeManifest: {
          run: {
            status: 'succeeded',
          },
          summary: {
            stageCount: 8,
            diagnosticCount: 0,
            warningCount: 0,
            errorCount: 0,
            generatedArtifactCount: 4,
            sourceFileCount: 2,
          },
          artifacts: [
            { path: 'report.md' },
            { path: 'context.json' },
          ],
        },
      };
    },
  });

  const result = await service.executeAction('analyze-existing-workspace', {
    profile: 'dev',
    member: 'orderpgm',
  });

  assert.deepEqual(receivedArgs, {
    profile: 'dev',
    program: undefined,
    member: 'ORDERPGM',
    'safe-sharing': true,
  });
  assert.equal(result.action, 'analyze-existing-workspace');
  assert.equal(result.status, 'completed');
  assert.equal(result.input.member, 'ORDERPGM');
  assert.equal(result.input.safeSharing, true);
  assert.equal(result.workspace.sourceRoot, './workspace');
  assert.equal(result.workspace.outputRoot, './output');
  assert.equal(result.output.runId, 'ORDERPGM');
  assert.equal(result.output.manifestPath, 'ORDERPGM/analyze-run-manifest.json');
  assert.equal(result.output.reportArtifactPath, 'ORDERPGM/report.md');
  assert.match(result.output.reportUrl, /^\/runs\/ORDERPGM\/artifacts\/raw\?path=report\.md$/);
  assert.ok(result.notes.some((entry) => /does not fetch remote sources/i.test(entry)));
});

test('analyze-existing-workspace rejects unknown payload keys and raw command strings', () => {
  assert.throws(
    () => normalizeAnalyzeExistingWorkspacePayload({
      profile: 'dev',
      program: 'ORDERPGM',
      command: 'rm -rf /',
    }),
    /unsupported key/i,
  );
});

test('analyze-existing-workspace rejects unsafe profile, program, and member names', async () => {
  const service = createLocalUiActionService({
    analyzeConfigResolver: () => ({
      sourceRoot: './workspace',
      outputRoot: './output',
    }),
    analyzeExecutor: () => ({
      program: 'ORDERPGM',
      analyzeManifest: {
        run: { status: 'succeeded' },
        summary: {},
        artifacts: [],
      },
    }),
  });

  for (const profile of ['../development', 'development test', 'development;rm -rf', '"development"']) {
    await assert.rejects(
      () => service.executeAction('analyze-existing-workspace', {
        profile,
        program: 'ORDERPGM',
      }),
      /invalid payload/i,
    );
  }

  for (const program of ['../ORDERPGM', 'ORDER PGM', 'ORDERPGM;rm -rf', '"ORDERPGM"']) {
    await assert.rejects(
      () => service.executeAction('analyze-existing-workspace', {
        profile: 'dev',
        program,
      }),
      /invalid payload/i,
    );
  }

  for (const member of ['../ORDERPGM', 'ORDER PGM', 'ORDERPGM;rm -rf', '"ORDERPGM"']) {
    await assert.rejects(
      () => service.executeAction('analyze-existing-workspace', {
        profile: 'dev',
        member,
      }),
      /invalid payload/i,
    );
  }
});

test('analyze-existing-workspace returns structured failed status for expected analyze failures without leaking private paths', async () => {
  const service = createLocalUiActionService({
    cwd: '/workspace/project',
    analyzeConfigResolver: () => ({
      sourceRoot: '/private/source/root',
      outputRoot: './output',
    }),
    analyzeExecutor: () => {
      const error = new Error('Source directory not found: /private/source/root. Provide a valid --source path.');
      error.code = 'SOURCE_ROOT_MISSING';
      throw error;
    },
  });

  const result = await service.executeAction('analyze-existing-workspace', {
    profile: 'dev',
    program: 'ORDERPGM',
    safeSharing: false,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.input.safeSharing, false);
  assert.equal(result.workspace.sourceRoot, '(configured outside project root)');
  assert.equal(result.diagnostics.length, 1);
  assert.match(result.diagnostics[0].message, /not found locally/i);
  assert.equal(JSON.stringify(result).includes('/private/source/root'), false);
});
