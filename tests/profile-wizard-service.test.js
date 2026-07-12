const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  MANAGED_ENVIRONMENT_PROFILE_KEY,
  buildProfileFromDraft,
  createProfileWizardService,
  normalizeProfileWizardDraft,
} = require('../src/ui/profileWizardService');

function createTempProject() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-profile-wizard-'));
  const configDir = path.join(tempRoot, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'profiles.example.json'),
    `${JSON.stringify(
      {
        'default-shared': {
          outputRoot: '${env:ZEUS_OUTPUT_ROOT}',
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
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  return tempRoot;
}

test('profile wizard state summarizes profiles and systems without exposing raw hosts', () => {
  const tempRoot = createTempProject();
  try {
    const service = createProfileWizardService({
      cwd: tempRoot,
      env: {},
    });
    const state = service.getState();

    assert.equal(state.schemaVersion, 1);
    assert.equal(state.mode, 'local-only-profile-wizard');
    assert.ok(Array.isArray(state.profiles));
    assert.ok(state.profiles.some(entry => entry.name === 'dev'));
    const devProfile = state.profiles.find(entry => entry.name === 'dev');
    assert.equal(devProfile.sourceKind, 'shared');
    assert.equal(devProfile.deleteAllowed, false);
    assert.deepEqual(state.managedEnvironmentUsage.dependentProfiles, []);
    assert.ok(Array.isArray(state.systems));
    const devSystem = state.systems.find(entry => entry.key === 'dev');
    assert.equal(devSystem.displayName, 'Development IBM i');
    assert.equal(devSystem.hostMode, 'configured');
    assert.equal(JSON.stringify(state).includes('internal-host.example'), false);
    assert.match(state.source.localOnlyTarget, /config\/local-only\/profiles\.json$/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('profile wizard preview validates and emits safe placeholder-based managed environments', () => {
  const tempRoot = createTempProject();
  try {
    const service = createProfileWizardService({
      cwd: tempRoot,
      env: {},
    });
    const preview = service.previewDraft({
      profileName: 'gui-dev',
      comment: 'GUI created dev profile',
      extends: ['default-shared', MANAGED_ENVIRONMENT_PROFILE_KEY],
      sourceRoot: './workspace/source',
      outputRoot: './workspace/output',
      environmentBindings: {
        defaultDbSystem: 'devgui',
        metadataSystem: 'readonly',
        testDataSystem: 'devgui',
        fetchSystem: 'devgui',
      },
      fetch: {
        enabled: true,
        sourceLibrary: 'APPLIB',
        out: './rpg_sources',
        files: ['QRPGLESRC', 'QCLSRC'],
        members: ['ORDERPGM'],
        transport: 'auto',
      },
      managedEnvironments: [
        {
          key: 'devgui',
          displayName: 'GUI Dev',
          systemName: 'SYSDEV',
          aliases: 'DEVBOX, GUIDEV',
          hostEnvVar: 'ZEUS_DEV_HOST',
          userEnvVar: 'ZEUS_DEV_USER',
          passwordEnvVar: 'ZEUS_DEV_PASSWORD',
          defaultLibrary: 'APPLIB',
          defaultSchema: 'APPLIB',
        },
        {
          key: 'readonly',
          displayName: 'Read-only',
          systemName: 'SYSRO',
          aliases: '',
          hostEnvVar: 'ZEUS_RO_HOST',
          userEnvVar: 'ZEUS_RO_USER',
          passwordEnvVar: 'ZEUS_RO_PASSWORD',
          defaultLibrary: 'REPORTLIB',
          defaultSchema: 'REPORTLIB',
        },
      ],
    });

    assert.equal(preview.valid, true);
    assert.equal(preview.profilePreview.db.system, 'devgui');
    assert.equal(preview.profilePreview.fetch.system, 'devgui');
    assert.equal(
      preview.managedEnvironmentProfilePreview.systems.devgui.host,
      '${env:ZEUS_DEV_HOST}'
    );
    assert.equal(
      preview.managedEnvironmentProfilePreview.systems.readonly.password,
      '${env:ZEUS_RO_PASSWORD}'
    );
    assert.ok(
      preview.safeCliPreview.commands.every(entry => !/password|internal-host/i.test(entry))
    );
    assert.ok(Array.isArray(preview.handoffCommands));
    assert.match(preview.handoffCommands[0].command, /zeus doctor --profile gui-dev/);
    assert.ok(Array.isArray(preview.diagnostics));
    assert.ok(Array.isArray(preview.stepValidation));
    assert.equal(preview.stepValidation.find(entry => entry.id === 'workspace').status, 'review');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('profile wizard preview returns field diagnostics for incomplete local-only drafts', () => {
  const tempRoot = createTempProject();
  try {
    const service = createProfileWizardService({
      cwd: tempRoot,
      env: {},
    });
    const preview = service.previewDraft({
      profileName: 'gui-incomplete',
      comment: 'Incomplete GUI profile',
      extends: ['default-shared'],
      sourceRoot: './workspace/source',
      outputRoot: './workspace/output',
      analysesRegistryPath: '',
      environmentBindings: {},
      fetch: {
        enabled: true,
        sourceLibrary: '',
        ifsDir: '',
        out: './rpg_sources',
        files: [],
        members: [],
        transport: 'auto',
      },
      managedEnvironments: [],
    });

    assert.ok(preview.diagnostics.some(entry => entry.fieldPath === 'analysesRegistryPath'));
    assert.ok(preview.diagnostics.some(entry => entry.fieldPath === 'fetch.sourceLibrary'));
    assert.ok(preview.diagnostics.some(entry => entry.fieldPath === 'fetch.files'));
    assert.equal(
      preview.stepValidation.find(entry => entry.id === 'fetch-scope').status,
      'needs-scope'
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('profile wizard preview warns when a local-only save would shadow shared profiles or systems', () => {
  const tempRoot = createTempProject();
  try {
    const service = createProfileWizardService({
      cwd: tempRoot,
      env: {},
    });
    const preview = service.previewDraft({
      profileName: 'dev',
      comment: 'GUI override for dev',
      extends: ['default-shared', MANAGED_ENVIRONMENT_PROFILE_KEY],
      sourceRoot: './workspace/source',
      outputRoot: './workspace/output',
      environmentBindings: {
        defaultDbSystem: 'dev',
        metadataSystem: 'dev',
        testDataSystem: 'dev',
        fetchSystem: 'dev',
      },
      fetch: {
        enabled: true,
        sourceLibrary: 'APPLIB',
        out: './rpg_sources',
        files: ['QRPGLESRC'],
        members: ['ORDERPGM'],
        transport: 'auto',
      },
      managedEnvironments: [
        {
          key: 'dev',
          displayName: 'GUI Dev Shadow',
          systemName: 'SYSDEV',
          aliases: '',
          hostEnvVar: 'ZEUS_DEV_HOST',
          userEnvVar: 'ZEUS_DEV_USER',
          passwordEnvVar: 'ZEUS_DEV_PASSWORD',
          defaultLibrary: 'APPLIB',
          defaultSchema: 'APPLIB',
        },
      ],
    });

    assert.ok(preview.conflicts.some(entry => entry.code === 'PROFILE_SHADOWS_SHARED'));
    assert.ok(preview.conflicts.some(entry => entry.code === 'MANAGED_ENVIRONMENT_SHADOWS_SHARED'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('profile wizard save writes only local-only overlay content', () => {
  const tempRoot = createTempProject();
  try {
    const service = createProfileWizardService({
      cwd: tempRoot,
      env: {},
    });
    const result = service.saveDraft({
      profileName: 'gui-local',
      comment: 'GUI local profile',
      extends: ['default-shared', MANAGED_ENVIRONMENT_PROFILE_KEY],
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
        transport: 'jt400',
      },
      managedEnvironments: [
        {
          key: 'devgui',
          displayName: 'GUI Dev',
          systemName: 'SYSDEV',
          aliases: 'DEVBOX',
          hostEnvVar: 'ZEUS_DEV_HOST',
          userEnvVar: 'ZEUS_DEV_USER',
          passwordEnvVar: 'ZEUS_DEV_PASSWORD',
          defaultLibrary: 'APPLIB',
          defaultSchema: 'APPLIB',
        },
      ],
    });

    assert.equal(result.saved, true);
    const savedPath = path.join(tempRoot, 'config', 'local-only', 'profiles.json');
    const saved = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
    assert.ok(saved['gui-local']);
    assert.ok(saved[MANAGED_ENVIRONMENT_PROFILE_KEY]);
    assert.equal(saved['gui-local'].fetch.system, 'devgui');
    assert.equal(
      saved[MANAGED_ENVIRONMENT_PROFILE_KEY].systems.devgui.host,
      '${env:ZEUS_DEV_HOST}'
    );
    assert.equal(Object.prototype.hasOwnProperty.call(saved, 'default-shared'), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('profile wizard can delete only local-only profiles and preserves shared profiles', () => {
  const tempRoot = createTempProject();
  try {
    const service = createProfileWizardService({
      cwd: tempRoot,
      env: {},
    });
    service.saveDraft({
      profileName: 'gui-local',
      comment: 'GUI local profile',
      extends: ['default-shared'],
      sourceRoot: './workspace/source',
      outputRoot: './workspace/output',
      analysesRegistryPath: './analysis/_registry.json',
      environmentBindings: {},
      fetch: {
        enabled: false,
        sourceLibrary: '',
        out: './rpg_sources',
        files: [],
        members: [],
        transport: 'auto',
      },
      managedEnvironments: [],
    });

    const stateAfterSave = service.getState();
    const localProfile = stateAfterSave.profiles.find(entry => entry.name === 'gui-local');
    assert.equal(localProfile.sourceKind, 'local-only');
    assert.equal(localProfile.deleteAllowed, true);

    const result = service.deleteProfile('gui-local');
    assert.equal(result.deleted, true);
    const savedPath = path.join(tempRoot, 'config', 'local-only', 'profiles.json');
    const saved = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
    assert.equal(Object.prototype.hasOwnProperty.call(saved, 'gui-local'), false);
    assert.throws(
      () => service.deleteProfile('dev'),
      /only local-only profiles can be deleted here/i
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('normalize profile wizard draft rejects invalid env variable names', () => {
  assert.throws(
    () =>
      normalizeProfileWizardDraft({
        profileName: 'gui',
        managedEnvironments: [
          {
            key: 'dev',
            hostEnvVar: 'bad-var',
          },
        ],
      }),
    /invalid environment variable name/i
  );
});

test('normalize profile wizard draft rejects duplicate managed environment keys', () => {
  assert.throws(
    () =>
      normalizeProfileWizardDraft({
        profileName: 'gui',
        managedEnvironments: [
          { key: 'dev', hostEnvVar: 'ZEUS_A', userEnvVar: 'ZEUS_B', passwordEnvVar: 'ZEUS_C' },
          { key: 'dev', hostEnvVar: 'ZEUS_D', userEnvVar: 'ZEUS_E', passwordEnvVar: 'ZEUS_F' },
        ],
      }),
    /duplicate managed environment key/i
  );
});

test('profile wizard save keeps the existing managed environment catalog when draft has no env edits', () => {
  const tempRoot = createTempProject();
  try {
    const service = createProfileWizardService({
      cwd: tempRoot,
      env: {},
    });
    service.saveDraft({
      profileName: 'gui-catalog-owner',
      comment: 'GUI local profile',
      extends: ['default-shared', MANAGED_ENVIRONMENT_PROFILE_KEY],
      sourceRoot: './workspace/source',
      outputRoot: './workspace/output',
      analysesRegistryPath: './analysis/_registry.json',
      environmentBindings: {
        defaultDbSystem: 'devgui',
      },
      fetch: {
        enabled: false,
        sourceLibrary: '',
        out: './rpg_sources',
        files: [],
        members: [],
        transport: 'auto',
      },
      managedEnvironments: [
        {
          key: 'devgui',
          displayName: 'GUI Dev',
          systemName: 'SYSDEV',
          aliases: '',
          hostEnvVar: 'ZEUS_DEV_HOST',
          userEnvVar: 'ZEUS_DEV_USER',
          passwordEnvVar: 'ZEUS_DEV_PASSWORD',
          defaultLibrary: 'APPLIB',
          defaultSchema: 'APPLIB',
        },
      ],
    });

    service.saveDraft({
      profileName: 'gui-second',
      comment: 'Second GUI local profile',
      extends: ['default-shared'],
      sourceRoot: './workspace/source',
      outputRoot: './workspace/output',
      analysesRegistryPath: './analysis/_registry.json',
      environmentBindings: {},
      fetch: {
        enabled: false,
        sourceLibrary: '',
        out: './rpg_sources',
        files: [],
        members: [],
        transport: 'auto',
      },
      managedEnvironments: [],
    });

    const savedPath = path.join(tempRoot, 'config', 'local-only', 'profiles.json');
    const saved = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
    assert.ok(saved[MANAGED_ENVIRONMENT_PROFILE_KEY]);
    assert.ok(saved[MANAGED_ENVIRONMENT_PROFILE_KEY].systems.devgui);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('build profile from draft emits the expected role and fetch structure', () => {
  const profile = buildProfileFromDraft({
    profileName: 'gui-local',
    comment: 'Local GUI profile',
    extends: ['default-shared', MANAGED_ENVIRONMENT_PROFILE_KEY],
    sourceRoot: './workspace/source',
    outputRoot: './workspace/output',
    analysesRegistryPath: './analysis/_registry.json',
    productionSystem: false,
    environmentBindings: {
      defaultDbSystem: 'devgui',
      metadataSystem: 'readonly',
      testDataSystem: 'devgui',
      fetchSystem: 'devgui',
    },
    fetch: {
      enabled: true,
      sourceLibrary: 'APPLIB',
      ifsDir: '',
      out: './rpg_sources',
      files: ['QRPGLESRC'],
      members: ['ORDERPGM'],
      transport: 'auto',
    },
    managedEnvironments: [],
  });

  assert.deepEqual(profile.db, { system: 'devgui' });
  assert.deepEqual(profile.dbRoles, {
    metadata: { system: 'readonly' },
    testData: { system: 'devgui' },
  });
  assert.deepEqual(profile.fetch, {
    system: 'devgui',
    sourceLibrary: 'APPLIB',
    out: './rpg_sources',
    files: ['QRPGLESRC'],
    members: ['ORDERPGM'],
    transport: 'auto',
  });
});
