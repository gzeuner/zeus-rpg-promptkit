const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { startLocalUiServer } = require('../src/ui/localUiServer');

const projectRoot = path.resolve(__dirname, '..');
const cliPath = path.join(projectRoot, 'cli', 'zeus.js');

function createUiFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-local-ui-'));
  const configDir = path.join(tempRoot, 'config');
  const outputRoot = path.join(tempRoot, 'output');
  const programDir = path.join(outputRoot, 'ORDERPGM');
  const safeDir = path.join(programDir, 'safe-sharing');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(safeDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'profiles.example.json'), `${JSON.stringify({
    'default-shared': {
      outputRoot: './workspace/output',
    },
    dev: {
      extends: 'default-shared',
      sourceRoot: './workspace/source',
      outputRoot: './workspace/output',
      db: {
        system: 'dev',
      },
      systems: {
        dev: {
          displayName: 'Development IBM i',
          host: 'internal-host.example',
          user: '${env:ZEUS_DB_USER}',
          password: '${env:ZEUS_DB_PASSWORD}',
          defaultSchema: 'APPDEV',
        },
      },
    },
  }, null, 2)}\n`, 'utf8');

  fs.writeFileSync(path.join(programDir, 'report.md'), '# Report\n\nSummary.\n', 'utf8');
  fs.writeFileSync(path.join(programDir, 'context.json'), `${JSON.stringify({
    program: 'ORDERPGM',
    dependencies: {
      tables: [{ name: 'ORDERS' }, { name: 'CUSTOMER' }],
      programCalls: [{ name: 'INVPGM' }],
    },
  }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(programDir, 'architecture.html'), '<!doctype html><title>Architecture Viewer</title>', 'utf8');
  fs.writeFileSync(path.join(programDir, 'program-call-tree.json'), `${JSON.stringify({
    rootProgram: 'ORDERPGM',
    nodes: [
      { id: 'ORDERPGM', type: 'PROGRAM' },
      { id: 'INVPGM', type: 'PROGRAM' },
      { id: 'ORDERS', type: 'TABLE' },
    ],
    edges: [
      { from: 'ORDERPGM', to: 'INVPGM', type: 'CALLS_PROGRAM' },
      { from: 'ORDERPGM', to: 'ORDERS', type: 'USES_TABLE' },
    ],
    summary: {
      programCount: 2,
      tableCount: 1,
      edgeCount: 2,
    },
  }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(programDir, 'db2-metadata.json'), `${JSON.stringify({
    tables: [{
      schema: 'MYLIB',
      table: 'ORDERS',
      sourceLink: {
        matchStatus: 'resolved',
        sourceEvidence: [{ file: 'ORDERPGM.rpgle', startLine: 1 }],
      },
    }],
    summary: {
      tableCount: 1,
    },
  }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(programDir, 'test-data.json'), `${JSON.stringify({
    tables: [{
      schema: 'MYLIB',
      table: 'ORDERS',
      rows: [{ ORDER_ID: '1001' }],
      policyDecision: {
        eligibility: 'allowed',
        maskedColumns: ['EMAIL'],
      },
      sourceLink: {
        matchStatus: 'resolved',
        sourceEvidence: [{ file: 'ORDERPGM.rpgle', startLine: 1 }],
      },
    }],
    summary: {
      tableCount: 1,
      policySummary: {
        maskedTableCount: 1,
      },
    },
  }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(programDir, 'ai_prompt_documentation.md'), '# Documentation Prompt\n\nExplain ORDERPGM.\n', 'utf8');
  fs.writeFileSync(path.join(programDir, 'ai_prompt_modernization.md'), '# Modernization Prompt\n\nModernize ORDERPGM.\n', 'utf8');
  fs.writeFileSync(path.join(safeDir, 'report.md'), '# Safe Report\n', 'utf8');
  fs.writeFileSync(path.join(programDir, 'analyze-run-manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    tool: { name: 'zeus-rpg-promptkit', command: 'analyze' },
    run: {
      status: 'succeeded',
      completedAt: '2026-04-13T12:00:00.000Z',
    },
    inputs: {
      sourceRoot: 'C:/temp/src',
      options: {
        guidedMode: { name: 'modernization' },
        workflowPreset: { name: 'modernization-review' },
        reproducibleEnabled: false,
      },
      sourceSnapshot: {
        fileCount: 2,
      },
    },
    summary: {
      stageCount: 8,
      diagnosticCount: 1,
    },
    artifacts: [
      { path: 'context.json', kind: 'json', sizeBytes: 24, sha256: 'a' },
      { path: 'report.md', kind: 'markdown', sizeBytes: 18, sha256: 'b' },
      { path: 'architecture.html', kind: 'html', sizeBytes: 48, sha256: 'c' },
      { path: 'program-call-tree.json', kind: 'json', sizeBytes: 48, sha256: 'd' },
      { path: 'db2-metadata.json', kind: 'json', sizeBytes: 48, sha256: 'e' },
      { path: 'test-data.json', kind: 'json', sizeBytes: 48, sha256: 'f' },
      { path: 'ai_prompt_documentation.md', kind: 'markdown', sizeBytes: 48, sha256: 'g' },
      { path: 'ai_prompt_modernization.md', kind: 'markdown', sizeBytes: 48, sha256: 'h' },
    ],
  }, null, 2)}\n`, 'utf8');

  return {
    tempRoot,
    outputRoot,
    templateStorePath: path.join(tempRoot, 'config', 'local-only', 'prompt-workbench', 'templates.json'),
  };
}

test('local UI server exposes run explorer data and Prompt Workbench routes through a local-only API', async () => {
  const { tempRoot, outputRoot, templateStorePath } = createUiFixture();
  let started = null;

  try {
    started = await startLocalUiServer({
      outputRoot,
      port: 0,
      templateStorePath,
      actionServiceOptions: {
        doctorExecutor: (args) => {
          if (args.profile === 'explode') {
            throw new Error('unexpected internal failure');
          }
          return {
            hasCriticalFailure: false,
            checks: [
              { name: 'Config/Profile', status: 'PASS', details: 'Loaded profile "dev".' },
              { name: 'Java', status: 'WARN', details: 'Java runtime optional for this test.' },
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
                message: '<strong>unsafe</strong>',
              },
            ],
          };
        },
        analyzeConfigResolver: () => ({
          sourceRoot: './workspace',
          outputRoot: './output',
        }),
        fetchConfigResolver: () => ({
          sourceLibrary: 'APPLIB',
          files: ['QRPGLESRC', 'QCLSRC'],
          members: ['ORDERPGM'],
          out: './rpg_sources',
          sourceLibEnvOverride: null,
        }),
        workflowConfigResolver: () => ({
          members: ['CUSTSRV', 'ORDERPGM'],
          tables: [
            { schema: 'APP', table: 'ORDERS', filter: 'ORDER%' },
          ],
        }),
        analyzeExecutor: (args) => {
          if (args.profile === 'explode-analyze') {
            throw new Error('unexpected analyze failure');
          }
          return {
            program: args.program || args.member || 'ORDERPGM',
            analyzeManifest: {
              run: {
                status: 'succeeded',
              },
              summary: {
                stageCount: 8,
                diagnosticCount: 0,
                warningCount: 0,
                errorCount: 0,
                generatedArtifactCount: 3,
                sourceFileCount: 2,
              },
              artifacts: [
                { path: 'report.md' },
                { path: 'context.json' },
              ],
            },
          };
        },
        cwd: tempRoot,
        env: {},
      },
    });

    const health = await fetch(`${started.url}/api/health`).then((response) => response.json());
    assert.equal(health.ok, true);

    const uiMetadata = await fetch(`${started.url}/api/ui-metadata`).then((response) => response.json());
    assert.equal(uiMetadata.schemaVersion, 1);
    assert.equal(uiMetadata.uiMode, 'metadata-workflow-shell');
    assert.ok(Array.isArray(uiMetadata.config.sections));
    assert.ok(Array.isArray(uiMetadata.config.fields));
    assert.ok(Array.isArray(uiMetadata.commands.entries));
    assert.ok(Array.isArray(uiMetadata.workflowCards));
    assert.equal(uiMetadata.workflowCards.length, 6);
    assert.equal(uiMetadata.workflowCards.find((entry) => entry.id === 'configure').title, 'Setup');
    assert.equal(uiMetadata.workflowCards.find((entry) => entry.id === 'configure').availability, 'production-ready');
    assert.equal(uiMetadata.workflowCards.find((entry) => entry.id === 'configure').status, 'Available now');
    assert.equal(uiMetadata.workflowCards.find((entry) => entry.id === 'review-reports').enabledInShell, true);
    assert.equal(uiMetadata.workflowCards.find((entry) => entry.id === 'review-reports').uiTarget, 'reports');
    assert.equal(uiMetadata.workflowCards.find((entry) => entry.id === 'fetch-sources').enabledInShell, false);
    assert.equal(uiMetadata.workflowCards.find((entry) => entry.id === 'fetch-sources').status, 'Coming later');
    assert.equal(uiMetadata.guidedConfiguration.schemaVersion, 1);
    assert.ok(Array.isArray(uiMetadata.guidedConfiguration.steps));
    assert.ok(uiMetadata.guidedConfiguration.steps.length >= 7);
    assert.ok(Array.isArray(uiMetadata.guidedConfiguration.discoveryActions));
    assert.ok(uiMetadata.guidedConfiguration.discoveryActions.some((entry) => entry.id === 'discover-source-libraries'));
    assert.equal(uiMetadata.aiSessionStarter.templateSource, 'docs/ai/session-prompt.md');
    assert.equal(uiMetadata.aiSessionStarter.actionPath, '/api/ui-actions/generate-ai-session-prompt');
    assert.equal(uiMetadata.aiSessionStarter.goalMaxLength, 4000);
    assert.equal(uiMetadata.aiSessionStarter.envLoading.powerShell.command.includes('load-env.ps1'), true);
    assert.equal(uiMetadata.aiSessionStarter.envLoading.bash.command.includes('load-env.sh'), true);
    assert.equal(uiMetadata.profileWizard.mode, 'local-only-profile-wizard');
    assert.ok(Array.isArray(uiMetadata.profileWizard.steps));
    assert.ok(uiMetadata.profileWizard.steps.some((entry) => entry.id === 'managed-environments'));
    const sensitiveFields = uiMetadata.config.fields.filter((field) => field.sensitive === true);
    assert.ok(sensitiveFields.length >= 2);
    assert.equal(Object.prototype.hasOwnProperty.call(sensitiveFields[0], 'value'), false);

    const profileWizardState = await fetch(`${started.url}/api/profile-wizard/state`).then((response) => response.json());
    assert.equal(profileWizardState.schemaVersion, 1);
    assert.equal(profileWizardState.mode, 'local-only-profile-wizard');
    assert.ok(Array.isArray(profileWizardState.profiles));
    assert.ok(profileWizardState.profiles.some((entry) => entry.name === 'dev'));
    assert.equal(profileWizardState.profiles.find((entry) => entry.name === 'dev').sourceKind, 'shared');
    assert.equal(JSON.stringify(profileWizardState).includes('internal-host.example'), false);

    const profileWizardPreviewResponse = await fetch(`${started.url}/api/profile-wizard/preview`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        profileName: 'gui-dev',
        comment: 'GUI dev profile',
        extends: ['default-shared', '_gui-environments'],
        sourceRoot: './workspace/source',
        outputRoot: './workspace/output',
        environmentBindings: {
          defaultDbSystem: 'devgui',
          metadataSystem: 'devgui',
          testDataSystem: 'devgui',
          fetchSystem: 'devgui',
        },
        fetch: {
          enabled: true,
          sourceLibrary: 'APPLIB',
          out: './rpg_sources',
          files: ['QRPGLESRC'],
          members: ['ORDERPGM'],
          transport: 'auto',
        },
        managedEnvironments: [{
          key: 'devgui',
          displayName: 'GUI Dev',
          systemName: 'SYSDEV',
          aliases: 'DEVBOX',
          hostEnvVar: 'ZEUS_DEV_HOST',
          userEnvVar: 'ZEUS_DEV_USER',
          passwordEnvVar: 'ZEUS_DEV_PASSWORD',
          defaultLibrary: 'APPLIB',
          defaultSchema: 'APPLIB',
        }],
      }),
    });
    assert.equal(profileWizardPreviewResponse.status, 200);
    const profileWizardPreview = await profileWizardPreviewResponse.json();
    assert.equal(profileWizardPreview.valid, true);
    assert.equal(profileWizardPreview.profilePreview.fetch.system, 'devgui');
    assert.ok(Array.isArray(profileWizardPreview.diagnostics));
    assert.ok(Array.isArray(profileWizardPreview.stepValidation));

    const profileWizardSaveResponse = await fetch(`${started.url}/api/profile-wizard/save`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        profileName: 'gui-dev',
        comment: 'GUI dev profile',
        extends: ['default-shared', '_gui-environments'],
        sourceRoot: './workspace/source',
        outputRoot: './workspace/output',
        analysesRegistryPath: './analysis/_registry.json',
        environmentBindings: {
          defaultDbSystem: 'devgui',
          metadataSystem: 'devgui',
          testDataSystem: 'devgui',
          fetchSystem: 'devgui',
        },
        fetch: {
          enabled: true,
          sourceLibrary: 'APPLIB',
          out: './rpg_sources',
          files: ['QRPGLESRC'],
          members: ['ORDERPGM'],
          transport: 'auto',
        },
        managedEnvironments: [{
          key: 'devgui',
          displayName: 'GUI Dev',
          systemName: 'SYSDEV',
          aliases: 'DEVBOX',
          hostEnvVar: 'ZEUS_DEV_HOST',
          userEnvVar: 'ZEUS_DEV_USER',
          passwordEnvVar: 'ZEUS_DEV_PASSWORD',
          defaultLibrary: 'APPLIB',
          defaultSchema: 'APPLIB',
        }],
      }),
    });
    assert.equal(profileWizardSaveResponse.status, 200);
    const profileWizardSave = await profileWizardSaveResponse.json();
    assert.equal(profileWizardSave.saved, true);
    const savedProfiles = JSON.parse(fs.readFileSync(path.join(tempRoot, 'config', 'local-only', 'profiles.json'), 'utf8'));
    assert.ok(savedProfiles['gui-dev']);
    assert.ok(savedProfiles['_gui-environments']);

    const profileWizardStateAfterSave = await fetch(`${started.url}/api/profile-wizard/state`).then((response) => response.json());
    assert.equal(profileWizardStateAfterSave.profiles.find((entry) => entry.name === 'gui-dev').sourceKind, 'local-only');
    assert.ok(profileWizardStateAfterSave.managedEnvironmentUsage.dependentProfiles.includes('gui-dev'));

    const profileWizardDeleteResponse = await fetch(`${started.url}/api/profile-wizard/profiles/gui-dev`, {
      method: 'DELETE',
    });
    assert.equal(profileWizardDeleteResponse.status, 200);
    const profileWizardDelete = await profileWizardDeleteResponse.json();
    assert.equal(profileWizardDelete.deleted, true);

    const invalidPreviewResponse = await fetch(`${started.url}/api/profile-wizard/preview`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        profileName: '',
        managedEnvironments: [],
      }),
    });
    assert.equal(invalidPreviewResponse.status, 400);
    const invalidPreview = await invalidPreviewResponse.json();
    assert.equal(invalidPreview.error, 'profileName is required');
    assert.ok(Array.isArray(invalidPreview.diagnostics));
    assert.equal(invalidPreview.diagnostics[0].fieldPath, 'profileName');

    const doctorResponse = await fetch(`${started.url}/api/ui-actions/doctor`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        profile: 'dev',
        showResolved: false,
      }),
    });
    assert.equal(doctorResponse.status, 200);
    assert.match(doctorResponse.headers.get('content-type') || '', /application\/json/);
    const doctorPayload = await doctorResponse.json();
    assert.equal(doctorPayload.action, 'doctor');
    assert.ok(['ready', 'warning', 'failed'].includes(doctorPayload.status));
    assert.equal(doctorPayload.status, 'warning');
    assert.equal(doctorPayload.input.profile, 'dev');
    assert.equal(doctorPayload.input.showResolved, false);
    assert.equal(Object.prototype.hasOwnProperty.call(doctorPayload, 'resolvedValues'), false);
    assert.equal(Array.isArray(doctorPayload.diagnostics), true);
    assert.equal(doctorPayload.diagnostics.length, 1);
    assert.equal(doctorPayload.diagnostics[0].code, 'ENV_PROFILE_CONFLICT');
    assert.equal(doctorPayload.diagnostics[0].message.includes('<strong>'), false);
    assert.equal(JSON.stringify(doctorPayload).includes('PASSWORD'), false);

    const doctorUnknownKey = await fetch(`${started.url}/api/ui-actions/doctor`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        profile: 'dev',
        command: 'rm -rf /',
      }),
    });
    assert.equal(doctorUnknownKey.status, 400);

    const aiSessionPromptResponse = await fetch(`${started.url}/api/ui-actions/generate-ai-session-prompt`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
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
      }),
    });
    assert.equal(aiSessionPromptResponse.status, 200);
    const aiSessionPromptPayload = await aiSessionPromptResponse.json();
    assert.equal(aiSessionPromptPayload.action, 'generate-ai-session-prompt');
    assert.equal(aiSessionPromptPayload.status, 'completed');
    assert.match(aiSessionPromptPayload.prompt, /Analyze program ORDERPGM and summarize dependencies\./);
    assert.match(aiSessionPromptPayload.prompt, /docs\/tool-catalog\.md/);
    assert.equal(aiSessionPromptPayload.metadata.profile, 'dev');
    assert.equal(aiSessionPromptPayload.metadata.environment, 'development');
    assert.equal(aiSessionPromptPayload.metadata.includedDoctorSummary, true);
    assert.equal(Array.isArray(aiSessionPromptPayload.warnings), true);
    assert.equal(JSON.stringify(aiSessionPromptPayload).includes('password=super-secret'), false);

    const invalidAiSessionPromptResponse = await fetch(`${started.url}/api/ui-actions/generate-ai-session-prompt`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        profile: 'dev',
        goal: 'jdbc:as400://user:secret@internal-host.example;password=secret',
      }),
    });
    assert.equal(invalidAiSessionPromptResponse.status, 400);

    const discoveryResponse = await fetch(`${started.url}/api/ui-actions/discovery-preview`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        profile: 'dev',
        actionId: 'discover-db2-tables',
      }),
    });
    assert.equal(discoveryResponse.status, 200);
    const discoveryPayload = await discoveryResponse.json();
    assert.equal(discoveryPayload.action, 'discovery-preview');
    assert.equal(discoveryPayload.status, 'config-preview-ready');
    assert.equal(discoveryPayload.result.implemented, true);
    assert.equal(discoveryPayload.result.readOnly, true);
    assert.equal(Array.isArray(discoveryPayload.result.commandPreview), true);
    assert.equal(discoveryPayload.result.previewKind, 'config-derived-local-preview');
    assert.ok(discoveryPayload.result.candidates.some((entry) => entry.value === 'APP.ORDERS'));

    const objectPreviewResponse = await fetch(`${started.url}/api/ui-actions/discovery-preview`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        profile: 'dev',
        actionId: 'discover-object-types',
      }),
    });
    assert.equal(objectPreviewResponse.status, 200);
    const objectPreviewPayload = await objectPreviewResponse.json();
    assert.equal(objectPreviewPayload.action, 'discovery-preview');
    assert.equal(objectPreviewPayload.status, 'config-preview-ready');
    assert.equal(objectPreviewPayload.result.previewKind, 'config-derived-local-preview');
    assert.ok(objectPreviewPayload.result.candidates.some((entry) => entry.value === 'APPLIB'));
    assert.ok(objectPreviewPayload.result.candidates.some((entry) => entry.value === 'CUSTSRV'));

    const sourcePreviewResponse = await fetch(`${started.url}/api/ui-actions/discovery-preview`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        profile: 'dev',
        actionId: 'discover-source-physical-files',
      }),
    });
    assert.equal(sourcePreviewResponse.status, 200);
    const sourcePreviewPayload = await sourcePreviewResponse.json();
    assert.equal(sourcePreviewPayload.action, 'discovery-preview');
    assert.equal(sourcePreviewPayload.status, 'config-preview-ready');
    assert.equal(sourcePreviewPayload.result.previewKind, 'config-derived-local-preview');
    assert.equal(sourcePreviewPayload.result.implemented, true);
    assert.equal(sourcePreviewPayload.result.readOnly, true);
    assert.ok(Array.isArray(sourcePreviewPayload.result.candidates));
    assert.equal(sourcePreviewPayload.result.candidates[0].value, 'QRPGLESRC');

    for (const unsafeProfile of ['../dev', 'dev;rm -rf', 'dev && echo hacked', 'dev test', '"dev"']) {
      const unsafeResponse = await fetch(`${started.url}/api/ui-actions/doctor`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          profile: unsafeProfile,
        }),
      });
      assert.equal(unsafeResponse.status, 400);
    }

    const unknownAction = await fetch(`${started.url}/api/ui-actions/fetch`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        profile: 'dev',
      }),
    });
    assert.equal(unknownAction.status, 404);

    const analyzeResponse = await fetch(`${started.url}/api/ui-actions/analyze-existing-workspace`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        profile: 'dev',
        member: 'orderpgm',
      }),
    });
    assert.equal(analyzeResponse.status, 200);
    const analyzePayload = await analyzeResponse.json();
    assert.equal(analyzePayload.action, 'analyze-existing-workspace');
    assert.equal(analyzePayload.status, 'completed');
    assert.equal(analyzePayload.input.member, 'ORDERPGM');
    assert.equal(analyzePayload.input.safeSharing, true);
    assert.equal(analyzePayload.workspace.sourceRoot, './workspace');
    assert.match(analyzePayload.output.reportUrl, /^\/runs\/ORDERPGM\/artifacts\/raw\?path=report\.md$/);

    const analyzeInvalidPayload = await fetch(`${started.url}/api/ui-actions/analyze-existing-workspace`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        profile: 'dev',
        member: 'ORDERPGM',
        command: 'rm -rf /',
      }),
    });
    assert.equal(analyzeInvalidPayload.status, 400);

    const analyzeUnsafePayload = await fetch(`${started.url}/api/ui-actions/analyze-existing-workspace`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        profile: 'dev',
        member: '../ORDERPGM',
      }),
    });
    assert.equal(analyzeUnsafePayload.status, 400);

    const nonJsonAction = await fetch(`${started.url}/api/ui-actions/doctor`, {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
      },
      body: 'profile=dev',
    });
    assert.equal(nonJsonAction.status, 400);

    const unexpectedFailure = await fetch(`${started.url}/api/ui-actions/doctor`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        profile: 'explode',
      }),
    });
    assert.equal(unexpectedFailure.status, 500);
    const unexpectedFailurePayload = await unexpectedFailure.json();
    assert.equal(unexpectedFailurePayload.error, 'Internal server error');

    const unexpectedAnalyzeFailure = await fetch(`${started.url}/api/ui-actions/analyze-existing-workspace`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        profile: 'explode-analyze',
        program: 'ORDERPGM',
      }),
    });
    assert.equal(unexpectedAnalyzeFailure.status, 500);
    const unexpectedAnalyzeFailurePayload = await unexpectedAnalyzeFailure.json();
    assert.equal(unexpectedAnalyzeFailurePayload.error, 'Internal server error');

    const analyses = await fetch(`${started.url}/api/analyses`).then((response) => response.json());
    assert.equal(Array.isArray(analyses.workspaces), true);
    assert.equal(analyses.workspaces.length, 1);
    assert.equal(analyses.workspaces[0].id, 'default');

    const runs = await fetch(`${started.url}/api/runs`).then((response) => response.json());
    assert.equal(runs.length, 1);
    assert.equal(runs[0].program, 'ORDERPGM');
    assert.equal(runs[0].workflowPreset, 'modernization-review');

    const detail = await fetch(`${started.url}/api/runs/ORDERPGM`).then((response) => response.json());
    assert.equal(detail.summary.program, 'ORDERPGM');
    assert.ok(detail.artifacts.some((artifact) => artifact.path === 'architecture.html'));
    assert.ok(detail.artifacts.some((artifact) => artifact.path === 'safe-sharing/report.md'));
    assert.equal(detail.views.graph.available, true);
    assert.equal(detail.views.db2.metadataAvailable, true);
    assert.equal(detail.views.db2.testDataAvailable, true);
    assert.equal(detail.views.prompts.artifacts.length, 2);
    assert.ok(detail.views.graph.nodes.some((node) => node.id === 'ORDERS' && node.relatedArtifactPaths.includes('test-data.json')));

    const views = await fetch(`${started.url}/api/runs/ORDERPGM/views`).then((response) => response.json());
    assert.equal(views.summary.graphNodeCount, 3);
    assert.equal(views.summary.db2TableCount, 1);
    assert.equal(views.graph.nodes.find((node) => node.id === 'ORDERPGM').relatedPromptPaths.includes('ai_prompt_documentation.md'), true);
    assert.equal(views.db2.tables[0].sampleRowCount, 1);
    assert.deepEqual(views.db2.tables[0].relatedArtifactPaths, ['db2-metadata.json', 'test-data.json']);
    assert.equal(views.prompts.artifacts[0].path.startsWith('ai_prompt_'), true);

    const artifact = await fetch(`${started.url}/api/runs/ORDERPGM/artifacts/content?path=report.md`).then((response) => response.json());
    assert.equal(artifact.kind, 'markdown');
    assert.match(artifact.content, /Summary\./);

    const rawArtifactResponse = await fetch(`${started.url}/runs/ORDERPGM/artifacts/raw?path=architecture.html`);
    assert.equal(rawArtifactResponse.status, 200);
    assert.match(rawArtifactResponse.headers.get('content-type'), /text\/html/);
    assert.match(await rawArtifactResponse.text(), /Architecture Viewer/);

    const shellHtml = await fetch(`${started.url}/`).then((response) => response.text());
    assert.match(shellHtml, /Zeus RPG PromptKit/);
    assert.match(shellHtml, /Setup/);
    assert.match(shellHtml, /Reports/);
    assert.match(shellHtml, /Advanced \/ Tools/);
    assert.match(shellHtml, /Setup &amp; Readiness|Setup & Readiness/);
    assert.match(shellHtml, /Use Setup as a simple 3-step path/);
    assert.match(shellHtml, /Run Zeus Doctor/);
    assert.match(shellHtml, /Resolution order/);
    assert.match(shellHtml, /CLI overrides env\. Env overrides profile\. Profile overrides defaults\./);
    assert.match(shellHtml, /Environment Override Explanation/);
    assert.match(shellHtml, /Config Metadata Overview/);
    assert.match(shellHtml, /Recommended Next Step/);
    assert.match(shellHtml, /Check Readiness/);
    assert.match(shellHtml, /Doctor Readiness Check/);
    assert.match(shellHtml, /Start AI Session/);
    assert.match(shellHtml, /Generate Session Prompt/);
    assert.match(shellHtml, /Copy Prompt/);
    assert.match(shellHtml, /Include compact Doctor summary/);
    assert.match(shellHtml, /The Local UI cannot load env vars into your already-open terminal/);
    assert.match(shellHtml, /load-env\.ps1/);
    assert.match(shellHtml, /load-env\.sh/);
    assert.match(shellHtml, /Do not paste credentials into the goal/);
    assert.match(shellHtml, /Local-only Profile Wizard/);
    assert.match(shellHtml, /Advanced Setup Details/);
    assert.match(shellHtml, /Reports are local and read-only/);
    assert.match(shellHtml, /Overview/);
    assert.match(shellHtml, /\['artifacts','Overview'\]/);
    assert.match(shellHtml, /\['graph','Graph'\]/);
    assert.match(shellHtml, /\['db2','DB2 \/ Test Data'\]/);
    assert.match(shellHtml, /\['prompts','Prompt Compare'\]/);
    assert.match(shellHtml, /Reports Overview/);
    assert.match(shellHtml, /Reports Overview/);
    assert.match(shellHtml, /After Setup/);
    assert.match(shellHtml, /What is available here/);
    assert.match(shellHtml, /selected run:/);
    assert.match(shellHtml, /runs found:/);
    assert.match(shellHtml, /safe local read/);
    assert.match(shellHtml, /title:'Graph'/);
    assert.match(shellHtml, /title:'DB2\/Test Data'/);
    assert.match(shellHtml, /title:'Prompt Compare'/);
    assert.match(shellHtml, /Browse Artifacts/);
    assert.match(shellHtml, /No analysis runs found yet\. Finish Setup first, then generate output with the CLI and refresh this list\./);
    assert.match(shellHtml, /This JSON artifact could not be formatted for preview\. Use Open Raw to inspect the saved file directly\./);
    assert.match(shellHtml, /Artifact preview is unavailable right now\. Refresh Reports or use Open Raw if the file exists\./);
    assert.match(shellHtml, /Analyze Workspace/);
    assert.match(shellHtml, /Prompt Tools/);
    assert.match(shellHtml, /Local Analysis Tools/);
    assert.match(shellHtml, /Experimental \/ Coming Later/);
    assert.match(shellHtml, /Advanced: optional/);
    assert.match(shellHtml, /Everything here is optional and intended for experienced users/);
    assert.match(shellHtml, /Open In Reports/);
    assert.match(shellHtml, /local-only/);
    assert.match(shellHtml, /Deferred remote workflows/);
    assert.match(shellHtml, /Open analysis report/);
    assert.match(shellHtml, /Show raw result/);
    assert.match(shellHtml, /\/api\/ui-actions\/analyze-existing-workspace/);
    assert.match(shellHtml, /\/api\/profile-wizard\/state/);
    assert.match(shellHtml, /Preview needs refresh|preview-stale/);
    assert.match(shellHtml, /Configuration warnings/);
    assert.match(shellHtml, /Selected profile and environment point to different DB targets/);
    assert.match(shellHtml, /Graph Explorer|Graph/);
    assert.match(shellHtml, /DB2\/Test Data/);
    assert.match(shellHtml, /Prompt Compare/);
    assert.match(shellHtml, /Artifacts In This Run/);
    assert.match(shellHtml, /Prompt Workbench/);
    assert.match(shellHtml, /Advanced prompt composition tool/);
    assert.match(shellHtml, /Finish Setup first/);
    assert.match(shellHtml, /Use Reports for normal output review/);
    assert.match(shellHtml, /Prompt Canvas/);
    assert.match(shellHtml, /Templates/);
    assert.match(shellHtml, /Import From Reports/);
    assert.match(shellHtml, /Advanced Options/);
    assert.match(shellHtml, /Use This Pattern/);
    assert.match(shellHtml, /Load Template/);
    assert.match(shellHtml, /Save Local Template/);
    assert.match(shellHtml, /Delete Local Template/);
    assert.match(shellHtml, /Load Report Prompts/);
    assert.match(shellHtml, /Import From Report Artifact/);
    assert.match(shellHtml, /Preview Prompt/);
    assert.match(shellHtml, /Copy Preview/);
    assert.match(shellHtml, /Export Preview/);
    assert.match(shellHtml, /Preview is safe and local/);
    assert.match(shellHtml, /Beginner path/);
    assert.match(shellHtml, /Coming Later/);
    assert.match(shellHtml, /Remote fetch is not a supported browser action in this iteration\./);
    assert.match(shellHtml, /Quick Actions|Open Prompt Workbench|Open Prompt Workbench/);
    assert.doesNotMatch(shellHtml, /Prepare Fetch Inputs/);
    assert.doesNotMatch(shellHtml, /Review Query Commands/);
    const scriptMatch = shellHtml.match(/<script>([\s\S]*)<\/script>/);
    assert.ok(scriptMatch);
    assert.doesNotThrow(() => new Function(scriptMatch[1]));
    assert.match(scriptMatch[1], /esc\(message\)/);

    const promptContracts = await fetch(`${started.url}/api/prompt-builder/contracts`).then((response) => response.json());
    assert.equal(promptContracts.version, 1);
    assert.equal(promptContracts.routes.preview.path, '/api/prompt-builder/preview');

    const useCasesPayload = await fetch(`${started.url}/api/prompt-builder/use-cases`).then((response) => response.json());
    assert.ok(Array.isArray(useCasesPayload.useCases));
    assert.ok(useCasesPayload.useCases.some((entry) => entry.id === 'documentation-generation'));

    const modulesPayload = await fetch(`${started.url}/api/prompt-builder/modules`).then((response) => response.json());
    assert.ok(Array.isArray(modulesPayload.modules));
    assert.ok(modulesPayload.modules.some((entry) => entry.id === 'system-role'));

    const previewPayload = await fetch(`${started.url}/api/prompt-builder/preview`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        useCaseId: 'documentation-generation',
        fields: {
          goal: 'Document Prompt Workbench implementation for maintainers.',
          language: 'English',
        },
        additionalRequirements: 'Reference changed files and test scope.',
      }),
    }).then((response) => response.json());
    assert.equal(previewPayload.preview.useCase.id, 'documentation-generation');
    assert.ok(previewPayload.preview.estimatedTokens > 0);
    assert.match(previewPayload.preview.content, /Prompt Workbench/);

    const emptyTemplates = await fetch(`${started.url}/api/prompt-builder/templates`).then((response) => response.json());
    assert.deepEqual(emptyTemplates.templates, []);

    const createdTemplate = await fetch(`${started.url}/api/prompt-builder/templates`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Workbench API Contract Review',
        description: 'Template for API-first implementation review.',
        useCaseId: 'impact-change-analysis',
        moduleIds: ['system-role', 'toolset-context', 'implementation-task', 'quality-guardrails'],
        fields: {
          goal: 'Assess impact of new prompt builder routes.',
        },
      }),
    }).then((response) => response.json());
    assert.equal(typeof createdTemplate.template.id, 'string');
    assert.equal(createdTemplate.template.useCaseId, 'impact-change-analysis');

    const listedTemplates = await fetch(`${started.url}/api/prompt-builder/templates`).then((response) => response.json());
    assert.equal(listedTemplates.templates.length, 1);
    const templateId = listedTemplates.templates[0].id;

    const loadedTemplate = await fetch(`${started.url}/api/prompt-builder/templates/${encodeURIComponent(templateId)}`).then((response) => response.json());
    assert.equal(loadedTemplate.template.id, templateId);
    assert.equal(loadedTemplate.template.name, 'Workbench API Contract Review');

    const updatedTemplate = await fetch(`${started.url}/api/prompt-builder/templates/${encodeURIComponent(templateId)}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Workbench API Contract Review v2',
        description: 'Updated template',
        useCaseId: 'impact-change-analysis',
        moduleIds: ['system-role', 'toolset-context', 'implementation-task', 'output-contract'],
        fields: {
          goal: 'Assess impact and regression risks of prompt builder APIs.',
        },
      }),
    }).then((response) => response.json());
    assert.equal(updatedTemplate.template.id, templateId);
    assert.equal(updatedTemplate.template.name, 'Workbench API Contract Review v2');

    const deletedTemplate = await fetch(`${started.url}/api/prompt-builder/templates/${encodeURIComponent(templateId)}`, {
      method: 'DELETE',
    }).then((response) => response.json());
    assert.equal(deletedTemplate.deleted.id, templateId);

    const templatesAfterDelete = await fetch(`${started.url}/api/prompt-builder/templates`).then((response) => response.json());
    assert.deepEqual(templatesAfterDelete.templates, []);

    const promptBuilderMethodError = await fetch(`${started.url}/api/prompt-builder/use-cases`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    assert.equal(promptBuilderMethodError.status, 405);
    assert.match(promptBuilderMethodError.headers.get('allow') || '', /GET/);

    const invalidPreviewJson = await fetch(`${started.url}/api/prompt-builder/preview`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"useCaseId":',
    });
    assert.equal(invalidPreviewJson.status, 400);

    const invalidPreviewPayload = await fetch(`${started.url}/api/prompt-builder/preview`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        fields: {},
      }),
    });
    assert.equal(invalidPreviewPayload.status, 400);

    const templateNotFound = await fetch(`${started.url}/api/prompt-builder/templates/does-not-exist`);
    assert.equal(templateNotFound.status, 404);

    const contextSources = await fetch(`${started.url}/api/prompt-builder/context-sources`).then((response) => response.json());
    assert.equal(contextSources.contextSources.length, 1);
    assert.equal(contextSources.contextSources[0].program, 'ORDERPGM');
    assert.ok(contextSources.contextSources[0].promptArtifacts.some((entry) => entry.path === 'ai_prompt_documentation.md'));

    const contextPrompts = await fetch(`${started.url}/api/prompt-builder/context-sources/ORDERPGM/prompts`).then((response) => response.json());
    assert.equal(contextPrompts.program, 'ORDERPGM');
    assert.ok(contextPrompts.promptArtifacts.some((entry) => entry.path === 'ai_prompt_modernization.md'));

    const importedPrompt = await fetch(`${started.url}/api/prompt-builder/context-sources/import`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        program: 'ORDERPGM',
        path: 'ai_prompt_documentation.md',
      }),
    }).then((response) => response.json());
    assert.equal(importedPrompt.seed.program, 'ORDERPGM');
    assert.equal(importedPrompt.seed.path, 'ai_prompt_documentation.md');
    assert.match(importedPrompt.seed.content, /Documentation Prompt/);

    const invalidImportedPrompt = await fetch(`${started.url}/api/prompt-builder/context-sources/import`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        program: 'ORDERPGM',
        path: 'report.md',
      }),
    });
    assert.equal(invalidImportedPrompt.status, 400);

    const missingImportedPromptPayload = await fetch(`${started.url}/api/prompt-builder/context-sources/import`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        program: 'ORDERPGM',
      }),
    });
    assert.equal(missingImportedPromptPayload.status, 400);

    const missingRunContextPrompts = await fetch(`${started.url}/api/prompt-builder/context-sources/UNKNOWNPGM/prompts`);
    assert.equal(missingRunContextPrompts.status, 404);

    const traversal = await fetch(`${started.url}/api/runs/ORDERPGM/artifacts/content?path=..%2Fsecret.txt`);
    assert.equal(traversal.status, 400);

    const readOnlyRouteMethodError = await fetch(`${started.url}/api/runs`, {
      method: 'POST',
    });
    assert.equal(readOnlyRouteMethodError.status, 405);
    assert.match(readOnlyRouteMethodError.headers.get('allow') || '', /GET/);
  } finally {
    if (started) {
      await new Promise((resolve) => started.server.close(resolve));
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('serve CLI boots the local UI shell on loopback and answers health checks', async () => {
  const { tempRoot, outputRoot } = createUiFixture();

  try {
    const child = spawn(process.execPath, [cliPath, 'serve', '--source-output-root', outputRoot, '--port', '0'], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const started = await new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`serve command did not start in time\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      }, 10000);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
        const match = stdout.match(/Zeus local UI available at: (http:\/\/[^\s]+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[1]);
        }
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', (code) => {
        if (code !== null && code !== 0) {
          clearTimeout(timeout);
          reject(new Error(`serve command exited early with code ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
        }
      });
    });

    const health = await fetch(`${started}/api/health`).then((response) => response.json());
    assert.equal(health.ok, true);

    await new Promise((resolve) => {
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
