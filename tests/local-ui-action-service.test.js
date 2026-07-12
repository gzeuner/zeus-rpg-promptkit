const test = require('node:test');
const assert = require('node:assert/strict');

const {
  UiActionError,
  buildDb2DiscoveryConfigContext,
  buildDiscoveryConfigContext,
  buildObjectDiscoveryConfigContext,
  createLocalUiActionService,
  normalizeAnalyzeExistingWorkspacePayload,
  normalizeAiSessionPromptPayload,
  normalizeDiscoveryPreviewPayload,
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
    error => error instanceof UiActionError && error.statusCode === 404
  );
});

test('generate-ai-session-prompt action accepts valid payload and returns prompt metadata', async () => {
  const service = createLocalUiActionService();
  const result = await service.executeAction('generate-ai-session-prompt', {
    profile: 'dev',
    environment: 'development',
    goal: 'Analyze program ORDERPGM and summarize dependencies.',
    includeDoctorSummary: true,
    doctorSummary: {
      status: 'warning',
      summary: {
        total: 2,
        pass: 1,
        warn: 1,
        fail: 0,
        info: 0,
        skip: 0,
      },
      finishedAt: '2026-06-19T12:00:00.000Z',
    },
  });

  assert.equal(result.action, 'generate-ai-session-prompt');
  assert.equal(result.status, 'completed');
  assert.equal(result.input.profile, 'dev');
  assert.equal(result.input.environment, 'development');
  assert.equal(result.input.includeDoctorSummary, true);
  assert.match(result.prompt, /Analyze program ORDERPGM and summarize dependencies\./);
  assert.match(result.prompt, /docs\/tool-catalog\.md/);
  assert.ok(Array.isArray(result.warnings));
  assert.equal(result.metadata.profile, 'dev');
  assert.equal(result.metadata.environment, 'development');
  assert.equal(result.metadata.includedDoctorSummary, true);
  assert.equal(result.metadata.templateSource, 'docs/ai/session-prompt.md');
});

test('discovery-preview action derives source scope locally from resolved fetch config', async () => {
  const service = createLocalUiActionService({
    cwd: '/workspace/project',
    fetchConfigResolver: () => ({
      sourceLibrary: 'APPLIB',
      files: ['qrpglesrc', 'qclsrc'],
      members: ['orderpgm'],
      out: '/workspace/project/rpg_sources',
      sourceLibEnvOverride: null,
    }),
  });
  const result = await service.executeAction('discovery-preview', {
    profile: 'dev',
    actionId: 'discover-source-libraries',
  });

  assert.equal(result.action, 'discovery-preview');
  assert.equal(result.status, 'config-preview-ready');
  assert.equal(result.input.profile, 'dev');
  assert.equal(result.input.actionId, 'discover-source-libraries');
  assert.equal(result.result.implemented, true);
  assert.equal(result.result.readOnly, true);
  assert.equal(result.result.previewKind, 'config-derived-local-preview');
  assert.equal(result.result.candidates[0].value, 'APPLIB');
  assert.equal(result.result.resolvedScope.outputRoot, './rpg_sources');
  assert.ok(Array.isArray(result.result.notes));
  assert.ok(result.notes.some(entry => /resolved runtime configuration/i.test(entry)));
});

test('discovery-preview derives DB2 metadata scope locally from resolved analyze and workflow config', async () => {
  const service = createLocalUiActionService({
    analyzeConfigResolver: () => ({
      db: {
        defaultSchema: 'BASELIB',
      },
      dbRoles: {
        metadata: {
          defaultSchema: 'METALIB',
        },
        testData: {
          defaultSchema: 'TESTLIB',
        },
      },
      connections: {
        metadata: {
          profileKey: 'dbRoles.metadata',
        },
        testData: {
          profileKey: 'dbRoles.testData',
        },
      },
      testData: {
        limit: 25,
        allowTables: ['APP.CUSTOMERS'],
        denyTables: ['APP.AUDITLOG'],
        maskColumns: ['EMAIL'],
        maskRules: [{ table: 'APP.CUSTOMERS', column: 'PHONE', value: 'MASKED' }],
      },
    }),
    workflowConfigResolver: () => ({
      tables: [{ schema: 'APP', table: 'ORDERS', filter: 'ORDER%' }],
    }),
  });
  const result = await service.executeAction('discovery-preview', {
    profile: 'dev',
    actionId: 'discover-db2-tables',
  });

  assert.equal(result.action, 'discovery-preview');
  assert.equal(result.status, 'config-preview-ready');
  assert.equal(result.result.implemented, true);
  assert.equal(result.result.readOnly, true);
  assert.equal(result.result.previewKind, 'config-derived-local-preview');
  assert.ok(
    result.result.candidates.some(
      entry => entry.value === 'METALIB' && entry.kind === 'metadata-schema'
    )
  );
  assert.ok(
    result.result.candidates.some(
      entry => entry.value === 'TESTLIB' && entry.kind === 'test-data-schema'
    )
  );
  assert.ok(
    result.result.candidates.some(
      entry => entry.value === 'APP.ORDERS' && entry.kind === 'workflow-table'
    )
  );
  assert.equal(result.result.resolvedScope.testDataRowLimit, 25);
  assert.ok(Array.isArray(result.result.notes));
});

test('discovery-preview derives object scope locally from resolved fetch and workflow config', async () => {
  const service = createLocalUiActionService({
    fetchConfigResolver: () => ({
      sourceLibrary: 'APPLIB',
      files: ['QRPGLESRC', 'QSRVSRC'],
      members: ['ORDERPGM'],
      out: './rpg_sources',
      sourceLibEnvOverride: null,
    }),
    workflowConfigResolver: () => ({
      members: ['CUSTSRV', 'ORDERPGM'],
    }),
  });
  const result = await service.executeAction('discovery-preview', {
    profile: 'dev',
    actionId: 'discover-object-types',
  });

  assert.equal(result.action, 'discovery-preview');
  assert.equal(result.status, 'config-preview-ready');
  assert.equal(result.result.implemented, true);
  assert.equal(result.result.readOnly, true);
  assert.equal(result.result.previewKind, 'config-derived-local-preview');
  assert.ok(
    result.result.candidates.some(
      entry => entry.value === 'APPLIB' && entry.kind === 'object-library'
    )
  );
  assert.ok(
    result.result.candidates.some(
      entry => entry.value === 'CUSTSRV' && entry.kind === 'workflow-member'
    )
  );
  assert.equal(result.result.resolvedScope.fetchMemberCount, 1);
  assert.equal(result.result.resolvedScope.workflowMemberCount, 2);
});

test('unknown payload keys are rejected', () => {
  assert.throws(
    () =>
      normalizeDoctorPayload({
        profile: 'dev',
        showResolved: false,
        cmd: 'rm -rf /',
      }),
    /unsupported key/i
  );
});

test('AI session prompt payload rejects unknown keys, unsafe goal text, and invalid doctor summary details', () => {
  assert.throws(
    () =>
      normalizeAiSessionPromptPayload({
        profile: 'dev',
        goal: 'Review ORDERPGM.',
        command: 'rm -rf /',
      }),
    /unsupported key/i
  );

  assert.throws(
    () =>
      normalizeAiSessionPromptPayload({
        profile: 'dev',
        goal: 'jdbc:as400://user:secret@internal-host.example;password=secret',
      }),
    /contain secrets/i
  );

  assert.throws(
    () =>
      normalizeAiSessionPromptPayload({
        profile: 'dev',
        goal: 'Review ORDERPGM.',
        doctorSummary: {
          status: 'ready',
          checks: [{ name: 'Java' }],
        },
      }),
    /unsupported doctorSummary key/i
  );
});

test('AI session prompt payload rejects empty, overly long, and control-character goals', () => {
  assert.throws(
    () =>
      normalizeAiSessionPromptPayload({
        profile: 'dev',
        goal: '',
      }),
    /goal is required/i
  );

  assert.throws(
    () =>
      normalizeAiSessionPromptPayload({
        profile: 'dev',
        goal: 'A'.repeat(4001),
      }),
    /goal exceeds 4000 characters/i
  );

  assert.throws(
    () =>
      normalizeAiSessionPromptPayload({
        profile: 'dev',
        goal: 'Review ORDERPGM.\u0007',
      }),
    /unsupported control characters/i
  );
});

test('AI session prompt payload accepts multiline goals and optional environment names', () => {
  const payload = normalizeAiSessionPromptPayload({
    profile: 'dev',
    environment: 'sandbox-1',
    goal: 'Review ORDERPGM.\r\nSummarize evidence-first next steps.',
    includeDoctorSummary: false,
  });

  assert.equal(payload.profile, 'dev');
  assert.equal(payload.environment, 'sandbox-1');
  assert.equal(payload.goal, 'Review ORDERPGM.\nSummarize evidence-first next steps.');
  assert.equal(payload.includeDoctorSummary, false);
});

test('AI session prompt payload rejects unsafe environment names', () => {
  assert.throws(
    () =>
      normalizeAiSessionPromptPayload({
        profile: 'dev',
        environment: '../private',
        goal: 'Review ORDERPGM.',
      }),
    /environment/i
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
      `expected profile "${candidate}" to be rejected`
    );
  }
});

test('discovery preview payload rejects unknown keys and unknown actions', () => {
  assert.throws(
    () =>
      normalizeDiscoveryPreviewPayload({
        profile: 'dev',
        actionId: 'discover-source-libraries',
        command: 'scan everything',
      }),
    /unsupported key/i
  );

  assert.throws(
    () =>
      normalizeDiscoveryPreviewPayload({
        profile: 'dev',
        actionId: 'discover-everything',
      }),
    /unknown discovery action/i
  );
});

test('buildDiscoveryConfigContext keeps only safe source-scope details', () => {
  const context = buildDiscoveryConfigContext(
    {
      sourceLibrary: 'applib',
      files: ['qrpglesrc', 'qclsrc'],
      members: ['orderpgm'],
      out: '/workspace/project/rpg_sources',
      sourceLibEnvOverride: { envValue: 'ALT', profileValue: 'APP' },
    },
    '/workspace/project'
  );

  assert.deepEqual(context, {
    sourceLibrary: 'APPLIB',
    sourceFiles: ['QRPGLESRC', 'QCLSRC'],
    members: ['ORDERPGM'],
    outputRoot: './rpg_sources',
    hasSourceLibOverride: true,
    matchesDefaultSourceFiles: false,
  });
});

test('buildDb2DiscoveryConfigContext keeps only safe DB2 scope hints', () => {
  const context = buildDb2DiscoveryConfigContext(
    {
      db: {
        defaultSchema: 'BASELIB',
      },
      dbRoles: {
        metadata: {
          defaultSchema: 'METALIB',
        },
        testData: {
          defaultSchema: 'TESTLIB',
        },
      },
      connections: {
        metadata: {
          profileKey: 'dbRoles.metadata',
        },
        testData: {
          profileKey: 'dbRoles.testData',
        },
      },
      testData: {
        limit: 50,
        allowTables: ['app.customers'],
        denyTables: ['app.auditlog'],
        maskColumns: ['email'],
        maskRules: [{ table: 'APP.CUSTOMERS', column: 'PHONE', value: 'MASKED' }],
      },
    },
    {
      tables: [{ schema: 'app', table: 'orders', filter: 'order%' }],
    }
  );

  assert.deepEqual(context, {
    metadataSchema: 'METALIB',
    testDataSchema: 'TESTLIB',
    metadataRoleProfileKey: 'dbRoles.metadata',
    testDataRoleProfileKey: 'dbRoles.testData',
    workflowTables: [{ schema: 'APP', table: 'ORDERS', filter: 'ORDER%' }],
    testDataLimit: 50,
    allowTables: ['APP.CUSTOMERS'],
    denyTables: ['APP.AUDITLOG'],
    maskColumns: ['EMAIL'],
    maskRuleCount: 1,
  });
});

test('buildObjectDiscoveryConfigContext keeps only safe object-scope hints', () => {
  const context = buildObjectDiscoveryConfigContext(
    {
      sourceLibrary: 'applib',
      files: ['qrpglesrc', 'qsrvsrc'],
      members: ['orderpgm'],
    },
    {
      members: ['custsrv', ' orderpgm '],
    },
    ['fetch scope unresolved elsewhere']
  );

  assert.deepEqual(context, {
    objectLibrary: 'APPLIB',
    sourceFiles: ['QRPGLESRC', 'QSRVSRC'],
    fetchMembers: ['ORDERPGM'],
    workflowMembers: ['CUSTSRV', 'ORDERPGM'],
    hasSourceLibrary: true,
    hasWorkflowMembers: true,
    hasFetchMembers: true,
    warnings: ['fetch scope unresolved elsewhere'],
  });
});

test('showResolved=true is accepted without exposing resolved values', async () => {
  const service = createLocalUiActionService({
    doctorExecutor: () => ({
      hasCriticalFailure: false,
      checks: [{ name: 'Config/Profile', status: 'PASS', details: 'Loaded profile "dev".' }],
    }),
  });
  const result = await service.executeAction('doctor', {
    profile: 'dev',
    showResolved: true,
  });

  assert.equal(result.input.showResolved, true);
  assert.ok(Array.isArray(result.notes));
  assert.ok(result.notes.some(entry => /intentionally not exposed/i.test(entry)));
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
    analyzeExecutor: args => {
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
          artifacts: [{ path: 'report.md' }, { path: 'context.json' }],
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
  assert.ok(result.notes.some(entry => /does not fetch remote sources/i.test(entry)));
});

test('analyze-existing-workspace rejects unknown payload keys and raw command strings', () => {
  assert.throws(
    () =>
      normalizeAnalyzeExistingWorkspacePayload({
        profile: 'dev',
        program: 'ORDERPGM',
        command: 'rm -rf /',
      }),
    /unsupported key/i
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

  for (const profile of [
    '../development',
    'development test',
    'development;rm -rf',
    '"development"',
  ]) {
    await assert.rejects(
      () =>
        service.executeAction('analyze-existing-workspace', {
          profile,
          program: 'ORDERPGM',
        }),
      /invalid payload/i
    );
  }

  for (const program of ['../ORDERPGM', 'ORDER PGM', 'ORDERPGM;rm -rf', '"ORDERPGM"']) {
    await assert.rejects(
      () =>
        service.executeAction('analyze-existing-workspace', {
          profile: 'dev',
          program,
        }),
      /invalid payload/i
    );
  }

  for (const member of ['../ORDERPGM', 'ORDER PGM', 'ORDERPGM;rm -rf', '"ORDERPGM"']) {
    await assert.rejects(
      () =>
        service.executeAction('analyze-existing-workspace', {
          profile: 'dev',
          member,
        }),
      /invalid payload/i
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
      const error = new Error(
        'Source directory not found: /private/source/root. Provide a valid --source path.'
      );
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
