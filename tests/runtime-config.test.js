const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  ALLOWED_FETCH_TRANSPORTS,
  DEFAULT_ANALYSIS_LIMITS,
  DEFAULT_WORK_COPY,
  getProfilesMetadata,
  loadProfiles,
  readTokenBudgetConfig,
  readWorkflowConfig,
  readWorkCopyConfig,
  resolveAnalyzeDbConfig,
  resolveAnalyzeConfig,
  resolveProfile,
  resolveProfilesConfigPaths,
  resolveFetchConfig,
  resolveBundleConfig,
  resolveWorkflowPresetConfig,
  validateProfiles,
} = require('../src/config/runtimeConfig');
const { getRuntimeConfigMetadata } = require('../src/config/dbRuntimeConfigDiagnostics');
const { listConnectionTargetNames } = require('../src/config/connectionTargetMetadata');
const { encryptSecret } = require('../src/security/secretVault');

function createTempProject(profiles) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-runtime-config-'));
  fs.mkdirSync(path.join(tempRoot, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(tempRoot, 'config', 'profiles.example.json'),
    `${JSON.stringify(profiles, null, 2)}\n`,
    'utf8'
  );
  return tempRoot;
}

test('loadProfiles falls back to profiles.example.json', () => {
  const tempRoot = createTempProject({
    default: {
      sourceRoot: './src',
    },
  });

  try {
    const profiles = loadProfiles({ cwd: tempRoot, env: {} });
    assert.equal(profiles.default.sourceRoot, './src');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('loadProfiles resolves config directory from --config before cwd/config', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-runtime-config-cli-'));
  const defaultConfigDir = path.join(tempRoot, 'config');
  const customConfigDir = path.join(tempRoot, 'custom-config');
  fs.mkdirSync(defaultConfigDir, { recursive: true });
  fs.mkdirSync(customConfigDir, { recursive: true });
  fs.writeFileSync(
    path.join(defaultConfigDir, 'profiles.example.json'),
    `${JSON.stringify(
      {
        default: { sourceRoot: './default' },
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(
    path.join(customConfigDir, 'profiles.json'),
    `${JSON.stringify(
      {
        custom: { sourceRoot: './custom' },
      },
      null,
      2
    )}\n`
  );

  try {
    const profiles = loadProfiles({
      cwd: tempRoot,
      args: {
        config: './custom-config',
      },
    });
    const metadata = getProfilesMetadata(profiles);
    assert.equal(profiles.custom.sourceRoot, './custom');
    assert.equal(metadata.profilePath, path.join(customConfigDir, 'profiles.json'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('loadProfiles applies overlay files in deterministic sorted order', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-runtime-config-overlays-'));
  const configDir = path.join(tempRoot, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'profiles.json'),
    `${JSON.stringify(
      {
        sample: {
          sourceRoot: './base-source',
          outputRoot: './base-output',
          extensions: ['.rpgle'],
        },
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(
    path.join(configDir, 'profiles.alpha.json'),
    `${JSON.stringify(
      {
        sample: {
          outputRoot: './alpha-output',
        },
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(
    path.join(configDir, 'profiles.beta.json'),
    `${JSON.stringify(
      {
        sample: {
          outputRoot: './beta-output',
        },
      },
      null,
      2
    )}\n`
  );

  try {
    const profiles = loadProfiles({ cwd: tempRoot, env: {} });
    const metadata = getProfilesMetadata(profiles);

    assert.equal(profiles.sample.sourceRoot, './base-source');
    assert.equal(profiles.sample.outputRoot, './beta-output');
    assert.ok(metadata.sourceFileLabel.includes('profiles.alpha.json +'));
    assert.ok(metadata.sourceFileLabel.includes('profiles.beta.json'));
    const alphaIndex = metadata.attemptedPaths.findIndex(entry =>
      entry.endsWith(path.join('config', 'profiles.alpha.json'))
    );
    const betaIndex = metadata.attemptedPaths.findIndex(entry =>
      entry.endsWith(path.join('config', 'profiles.beta.json'))
    );
    assert.ok(alphaIndex >= 0);
    assert.ok(betaIndex >= 0);
    assert.ok(alphaIndex < betaIndex);
    assert.equal(path.basename(metadata.profilePath), 'profiles.json');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveProfilesConfigPaths honors ZEUS_CONFIG_DIR when --config is absent', () => {
  const resolved = resolveProfilesConfigPaths({
    cwd: 'C:/workspace/project',
    env: {
      ZEUS_CONFIG_DIR: './profiles-dir',
    },
  });

  assert.equal(resolved.source, 'env');
  assert.equal(
    resolved.preferredPath.endsWith(path.join('profiles-dir', 'local-only', 'profiles.json')),
    true
  );
});

test('resolveProfilesConfigPaths supports --config with direct JSON file path', () => {
  const resolved = resolveProfilesConfigPaths({
    cwd: '/workspace/project',
    args: {
      config: './config/custom-profiles.json',
    },
    env: {},
  });

  assert.equal(resolved.source, 'cli');
  assert.equal(resolved.preferredPath.endsWith(path.join('config', 'custom-profiles.json')), true);
  assert.equal(resolved.fallbackPath, null);
  assert.deepEqual(resolved.attemptedPaths, [resolved.preferredPath]);
  assert.equal(resolved.configDir.endsWith(path.join('config')), true);
});

test('resolveAnalyzeConfig merges profile settings with global optimizer and test data defaults', () => {
  const tempRoot = createTempProject({
    analysisLimits: {
      maxProgramDepth: 12,
      maxPrograms: 80,
    },
    contextOptimizer: {
      softTokenLimit: 2000,
      maxProgramCalls: 15,
      workflowTokenBudgets: {
        documentation: 1800,
      },
    },
    testData: {
      limit: 25,
      maskColumns: ['EMAIL'],
    },
    default: {
      sourceRoot: './rpg',
      outputRoot: './out',
      extensions: ['.rpgle', '.sqlrpgle'],
      contextOptimizer: {
        maxProgramCalls: 5,
        workflowTokenBudgets: {
          errorAnalysis: 900,
        },
      },
      testData: {
        maskColumns: ['EMAIL', 'PHONE'],
      },
      analysisLimits: {
        maxPrograms: 40,
      },
    },
  });

  try {
    const config = resolveAnalyzeConfig({ profile: 'default' }, { cwd: tempRoot, env: {} });
    assert.equal(config.sourceRoot, './rpg');
    assert.equal(config.outputRoot, './out');
    assert.deepEqual(config.extensions, ['.rpgle', '.sqlrpgle']);
    assert.equal(config.contextOptimizer.softTokenLimit, 2000);
    assert.equal(config.contextOptimizer.maxProgramCalls, 5);
    assert.equal(config.contextOptimizer.workflowTokenBudgets.documentation, 1800);
    assert.equal(config.contextOptimizer.workflowTokenBudgets.errorAnalysis, 900);
    assert.equal(config.testData.limit, 25);
    assert.deepEqual(config.testData.maskColumns, ['EMAIL', 'PHONE']);
    assert.equal(config.analysisLimits.maxProgramDepth, 12);
    assert.equal(config.analysisLimits.maxPrograms, 40);
    assert.equal(config.analysisLimits.maxNodes, DEFAULT_ANALYSIS_LIMITS.maxNodes);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveProfile supports inheritance and env placeholder expansion for secrets', () => {
  const tempRoot = createTempProject({
    parent: {
      sourceRoot: './src',
      db: {
        host: 'ibmi.example.com',
        user: 'ZEUS',
      },
      testData: {
        allowTables: ['APP.CUSTOMERS'],
        maskColumns: ['EMAIL'],
      },
    },
    child: {
      extends: 'parent',
      db: {
        password: '${env:ZEUS_DB_PASSWORD}',
      },
      testData: {
        denyTables: ['APP.AUDITLOG'],
        maskRules: [
          {
            table: 'CUSTOMERS',
            columns: ['PHONE'],
            value: 'MASKED_PHONE',
          },
        ],
      },
    },
  });

  try {
    const profile = resolveProfile(loadProfiles({ cwd: tempRoot, env: {} }), 'child', {
      env: {
        ZEUS_DB_PASSWORD: 'super-secret',
      },
    });

    assert.equal(profile.sourceRoot, './src');
    assert.equal(profile.db.host, 'ibmi.example.com');
    assert.equal(profile.db.user, 'ZEUS');
    assert.equal(profile.db.password, 'super-secret');
    assert.deepEqual(profile.testData.allowTables, ['APP.CUSTOMERS']);
    assert.deepEqual(profile.testData.denyTables, ['APP.AUDITLOG']);
    assert.deepEqual(profile.testData.maskColumns, ['EMAIL']);
    assert.equal(profile.testData.maskRules[0].value, 'MASKED_PHONE');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveAnalyzeConfig exposes profile token budgets and work-copy defaults', () => {
  const tempRoot = createTempProject({
    sample: {
      tokenBudget: {
        documentation: 4000,
        'error-analysis': 4100,
        'defect-analysis': 4200,
      },
      workCopy: {
        root: './workspace-source',
        extension: 'suffixed',
      },
    },
  });

  try {
    const profiles = loadProfiles({ cwd: tempRoot, env: {} });
    const profile = resolveProfile(profiles, 'sample', { env: {} });
    const config = resolveAnalyzeConfig({ profile: 'sample' }, { cwd: tempRoot, env: {} });

    assert.deepEqual(readTokenBudgetConfig(profile, {}), {
      documentation: 4000,
      errorAnalysis: 4100,
      defectAnalysis: 4200,
    });
    assert.deepEqual(readWorkCopyConfig(profile, {}), {
      root: './workspace-source',
      extension: 'suffixed',
    });
    assert.equal(config.tokenBudget.documentation, 4000);
    assert.equal(config.tokenBudget.errorAnalysis, 4100);
    assert.equal(config.tokenBudget.defectAnalysis, 4200);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('readWorkCopyConfig falls back to project defaults', () => {
  assert.deepEqual(readWorkCopyConfig(null, {}), DEFAULT_WORK_COPY);
});

test('readWorkflowConfig merges global, profile, and workflow preset definitions', () => {
  const tempRoot = createTempProject({
    presets: {
      shared: {
        steps: ['analyze', 'report'],
        analyzeModes: ['documentation'],
      },
    },
    sample: {
      sourceRoot: './src',
      presets: {
        local: {
          steps: ['copy', 'analyze', 'report'],
          members: ['ORDERPGM'],
        },
      },
      workflow: {
        outputRoot: './analysis',
        defaultPreset: 'local',
        analyzeModes: ['documentation', 'defect-analysis'],
        tables: [
          {
            table: 'ORDERS',
            schema: 'APP',
          },
        ],
        presets: {
          local: {
            steps: ['fetch', 'copy', 'analyze', 'report'],
            impact: [
              {
                field: 'CUSTOMER_ID',
                member: 'ORDERPGM',
              },
            ],
          },
        },
      },
    },
  });

  try {
    const profiles = loadProfiles({ cwd: tempRoot, env: {} });
    const profile = resolveProfile(profiles, 'sample', { env: {} });
    const workflowConfig = readWorkflowConfig(profiles, profile, {});
    const preset = resolveWorkflowPresetConfig(profiles, profile, 'local', {});

    assert.equal(workflowConfig.outputRoot, './analysis');
    assert.equal(workflowConfig.defaultPreset, 'local');
    assert.deepEqual(workflowConfig.analyzeModes, ['documentation', 'defect-analysis']);
    assert.deepEqual(workflowConfig.tables, [
      {
        table: 'ORDERS',
        schema: 'APP',
        filter: '',
      },
    ]);
    assert.deepEqual(Object.keys(workflowConfig.presets).sort(), ['local', 'shared']);
    assert.deepEqual(preset.steps, ['fetch', 'copy', 'analyze', 'report']);
    assert.deepEqual(preset.members, ['ORDERPGM']);
    assert.equal(preset.impact[0].field, 'CUSTOMER_ID');
    assert.equal(preset.impact[0].member, 'ORDERPGM');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveAnalyzeConfig applies environment overrides for DB credentials', () => {
  const tempRoot = createTempProject({
    sample: {
      db: {
        host: 'primary-system',
        user: 'profile-user',
        password: '${env:ZEUS_DB_PASSWORD}',
        defaultSchema: 'profilelib',
      },
    },
  });

  try {
    const config = resolveAnalyzeConfig(
      { profile: 'sample' },
      {
        cwd: tempRoot,
        env: {
          ZEUS_DB_HOST: 'secondary-system',
          ZEUS_DB_USER: 'env-user',
          ZEUS_DB_PASSWORD: 'env-pass',
          ZEUS_DB_DEFAULT_SCHEMA: 'ENVLIB',
        },
      }
    );

    assert.deepEqual(config.db, {
      host: 'secondary-system',
      user: 'env-user',
      password: 'env-pass',
      defaultSchema: 'ENVLIB',
    });
    const metadata = getRuntimeConfigMetadata(config.db);
    assert.equal(metadata.fields.host.origin, 'env');
    assert.equal(metadata.fields.user.origin, 'env');
    assert.equal(metadata.fields.password.origin, 'profile-env-placeholder');
    assert.equal(metadata.fields.defaultSchema.origin, 'env');
    assert.equal(metadata.warnings.length, 1);
    assert.equal(metadata.warnings[0].field, 'host');
    assert.equal(metadata.warnings[0].envKey, 'ZEUS_DB_HOST');
    assert.equal(metadata.warnings[0].profileValue, 'primary-system');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveAnalyzeConfig decrypts an encrypted DB password provided via env override', () => {
  const tempRoot = createTempProject({
    sample: {
      db: {
        host: 'primary-system',
        user: 'app-user',
        password: '${env:ZEUS_DB_PASSWORD}',
      },
    },
  });

  const KEY = 'runtime-config-master-key';
  const token = encryptSecret('plain-db-pass', { keyMaterial: KEY });

  try {
    const config = resolveAnalyzeConfig(
      { profile: 'sample' },
      {
        cwd: tempRoot,
        env: {
          ZEUS_SECRET_KEY: KEY,
          ZEUS_DB_PASSWORD: token,
        },
      }
    );
    // Der verschluesselte Env-Wert muss am Ende als Klartext ankommen.
    assert.equal(config.db.password, 'plain-db-pass');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveAnalyzeConfig CLI --schema/--library override profile and env schema', () => {
  const tempRoot = createTempProject({
    sample: {
      db: {
        host: 'primary-system',
        user: 'profile-user',
        password: 'profile-pass',
        defaultSchema: 'profilelib',
        defaultLibrary: 'PROFILELIB',
      },
    },
  });

  try {
    const config = resolveAnalyzeConfig(
      { profile: 'sample', schema: 'data_x', library: 'applib' },
      {
        cwd: tempRoot,
        env: { ZEUS_DB_DEFAULT_SCHEMA: 'ENVLIB' },
      }
    );

    // CLI-Werte haben Vorrang und werden normalisiert (UPPERCASE).
    assert.equal(config.db.defaultSchema, 'DATA_X');
    assert.equal(config.db.defaultLibrary, 'APPLIB');
    // Auch die testData-Rolle uebernimmt den Override.
    assert.equal(config.dbRoles.testData.defaultSchema, 'DATA_X');
    assert.equal(config.dbRoles.testData.defaultLibrary, 'APPLIB');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveAnalyzeConfig accepts --source-root as an alias for --source', () => {
  const tempRoot = createTempProject({
    sample: {
      sourceRoot: './profile-src',
    },
  });

  try {
    const config = resolveAnalyzeConfig(
      { profile: 'sample', 'source-root': './cli-src' },
      { cwd: tempRoot, env: {} }
    );
    assert.equal(config.sourceRoot, './cli-src');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveAnalyzeConfig does not flag delegated env placeholders as runtime conflicts', () => {
  const tempRoot = createTempProject({
    sample: {
      db: {
        host: '${env:ZEUS_DB_HOST}',
        user: '${env:ZEUS_DB_USER}',
        password: '${env:ZEUS_DB_PASSWORD}',
      },
    },
  });

  try {
    const config = resolveAnalyzeConfig(
      { profile: 'sample' },
      {
        cwd: tempRoot,
        env: {
          ZEUS_DB_HOST: 'primary-system',
          ZEUS_DB_USER: 'readonly-user',
          ZEUS_DB_PASSWORD: 'readonly-pass',
        },
      }
    );

    const metadata = getRuntimeConfigMetadata(config.db);
    assert.equal(metadata.fields.host.origin, 'profile-env-placeholder');
    assert.equal(metadata.fields.user.origin, 'profile-env-placeholder');
    assert.equal(metadata.fields.password.origin, 'profile-env-placeholder');
    assert.deepEqual(metadata.warnings, []);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveAnalyzeConfig supports dedicated metadata and test-data DB roles with fallback inheritance', () => {
  const tempRoot = createTempProject({
    sample: {
      db: {
        host: 'base-host',
        user: 'base-user',
        password: 'base-pass',
        defaultSchema: 'BASELIB',
      },
      dbRoles: {
        metadata: {
          host: 'meta-host',
          user: 'meta-user',
        },
        testData: {
          defaultSchema: 'TESTLIB',
        },
      },
    },
  });

  try {
    const config = resolveAnalyzeConfig(
      { profile: 'sample' },
      {
        cwd: tempRoot,
        env: {
          ZEUS_METADATA_DB_PASSWORD: 'meta-pass',
          ZEUS_TESTDATA_DB_HOST: 'test-host',
          ZEUS_TESTDATA_DB_USER: 'test-user',
          ZEUS_TESTDATA_DB_PASSWORD: 'test-pass',
        },
      }
    );

    assert.deepEqual(resolveAnalyzeDbConfig(config, 'metadata'), {
      host: 'meta-host',
      user: 'meta-user',
      password: 'meta-pass',
      defaultSchema: 'BASELIB',
    });
    assert.deepEqual(resolveAnalyzeDbConfig(config, 'testData'), {
      host: 'test-host',
      user: 'test-user',
      password: 'test-pass',
      defaultSchema: 'TESTLIB',
    });
    assert.equal(config.connections.metadata.profileKey, 'dbRoles.metadata');
    assert.equal(config.connections.testData.profileKey, 'dbRoles.testData');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveFetchConfig accepts environment overrides for sensitive fetch settings', () => {
  const tempRoot = createTempProject({
    fetcher: {
      fetch: {
        host: 'profile-host',
        user: 'profile-user',
        password: 'profile-pass',
        sourceLib: 'qrpglsrc',
        ifsDir: '/home/profile',
        out: './download',
        files: ['qrpglesrc'],
        streamFileCcsid: 1208,
        replace: false,
        transport: 'sftp',
      },
    },
  });

  try {
    const config = resolveFetchConfig(
      { profile: 'fetcher' },
      {
        cwd: tempRoot,
        env: {
          ZEUS_FETCH_HOST: 'env-host',
          ZEUS_FETCH_USER: 'env-user',
          ZEUS_FETCH_PASSWORD: 'env-pass',
          ZEUS_FETCH_SOURCE_LIB: 'qcllesrc',
          ZEUS_FETCH_IFS_DIR: '/home/env',
          ZEUS_FETCH_OUT: './env-download',
          ZEUS_FETCH_FILES: 'qrpglesrc,qsqlrpglesrc',
          ZEUS_FETCH_TRANSPORT: 'jt400',
          ZEUS_FETCH_REPLACE: 'true',
        },
      }
    );

    assert.equal(config.host, 'env-host');
    assert.equal(config.user, 'env-user');
    assert.equal(config.password, 'env-pass');
    assert.equal(config.sourceLib, 'QCLLESRC');
    assert.equal(config.ifsDir, '/home/env');
    assert.equal(config.out, './env-download');
    assert.deepEqual(config.files, ['QRPGLESRC', 'QSQLRPGLESRC']);
    assert.equal(config.streamFileCcsid, 1208);
    assert.equal(config.transport, 'jt400');
    assert.equal(config.replace, true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveFetchConfig resolves fetch port from profile and environment overrides', () => {
  const tempRoot = createTempProject({
    fetcher: {
      fetch: {
        host: 'profile-host',
        user: 'profile-user',
        password: 'profile-pass',
        sourceLib: 'qrpglsrc',
        ifsDir: '/home/profile',
        out: './download',
        port: 2222,
      },
    },
  });

  try {
    const configFromProfile = resolveFetchConfig(
      { profile: 'fetcher' },
      {
        cwd: tempRoot,
        env: {},
      }
    );
    assert.equal(configFromProfile.port, 2222);

    const configFromEnv = resolveFetchConfig(
      { profile: 'fetcher' },
      {
        cwd: tempRoot,
        env: {
          ZEUS_FETCH_PORT: '2200',
        },
      }
    );
    assert.equal(configFromEnv.port, 2200);

    const configFromArgs = resolveFetchConfig(
      { profile: 'fetcher', port: '2022' },
      {
        cwd: tempRoot,
        env: {
          ZEUS_FETCH_PORT: '2200',
        },
      }
    );
    assert.equal(configFromArgs.port, 2022);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveFetchConfig allows fetch to switch to another named system via CLI', () => {
  const tempRoot = createTempProject({
    multi: {
      systems: {
        dev: {
          displayName: 'Development IBM i',
          systemName: 'SYSDEV',
          aliases: ['DEVBOX'],
          host: 'dev-host',
          user: 'dev-user',
          password: 'dev-pass',
        },
        prodro: {
          displayName: 'Read-only IBM i',
          systemName: 'SYSPROD',
          aliases: ['PRODRO'],
          host: 'prod-host',
          user: 'prod-user',
          password: 'prod-pass',
        },
      },
      fetch: {
        system: 'dev',
        sourceLib: 'SOURCEDEV',
        ifsDir: '/home/dev',
        out: './download',
      },
    },
  });

  try {
    const config = resolveFetchConfig(
      { profile: 'multi', system: 'SYSPROD' },
      {
        cwd: tempRoot,
        env: {
          ZEUS_FETCH_HOST: 'stale-env-host',
          ZEUS_FETCH_USER: 'stale-env-user',
          ZEUS_FETCH_PASSWORD: 'stale-env-pass',
        },
      }
    );

    assert.equal(config.host, 'prod-host');
    assert.equal(config.user, 'prod-user');
    assert.equal(config.password, 'prod-pass');
    assert.equal(config.sourceLib, 'SOURCEDEV');
    assert.equal(config.hostEnvOverride, null);
    assert.deepEqual(listConnectionTargetNames(config), ['PRODRO', 'SYSPROD', 'PROD-HOST']);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveFetchConfig reports unknown fetch system overrides clearly', () => {
  const tempRoot = createTempProject({
    multi: {
      systems: {
        dev: {
          host: 'dev-host',
        },
      },
      fetch: {
        system: 'dev',
        sourceLib: 'SOURCEDEV',
        ifsDir: '/home/dev',
        out: './download',
      },
    },
  });

  try {
    assert.throws(
      () => resolveFetchConfig({ profile: 'multi', system: 'missing' }, { cwd: tempRoot, env: {} }),
      /Fetch system "missing" not found in profile systems. Available systems: dev/
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveFetchConfig preserves boolean fetch toggles from profile definitions', () => {
  const tempRoot = createTempProject({
    fetcher: {
      fetch: {
        host: 'profile-host',
        user: 'profile-user',
        password: 'profile-pass',
        sourceLib: 'QRPGLESRC',
        ifsDir: '/home/profile',
        out: './download',
        diagnoseTransport: true,
        replace: false,
        encrypted: true,
      },
    },
  });

  try {
    const config = resolveFetchConfig(
      { profile: 'fetcher' },
      {
        cwd: tempRoot,
        env: {},
      }
    );

    assert.equal(config.diagnoseTransport, true);
    assert.equal(config.replace, false);
    assert.equal(config.encrypted, true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveBundleConfig throws for unknown profiles', () => {
  const tempRoot = createTempProject({});

  try {
    assert.throws(
      () => resolveBundleConfig({ profile: 'missing' }, { cwd: tempRoot }),
      /Profile "missing" not found/
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveBundleConfig resolves known profile with default bundle output root', () => {
  const tempRoot = createTempProject({
    sample: {
      outputRoot: './profile-output',
    },
  });

  try {
    const config = resolveBundleConfig({ profile: 'sample' }, { cwd: tempRoot, env: {} });
    assert.equal(config.sourceOutputRoot, './profile-output');
    assert.equal(config.bundleOutputRoot, 'bundles');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('loadProfiles rejects invalid profile structure', () => {
  const tempRoot = createTempProject({
    broken: {
      extensions: '.rpgle',
    },
  });

  try {
    assert.throws(
      () => loadProfiles({ cwd: tempRoot, env: {} }),
      /Failed to load profiles from .*Invalid configuration: profile "broken"\.extensions must be an array of strings/
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('loadProfiles rejects invalid test-data policy shape', () => {
  const tempRoot = createTempProject({
    broken: {
      testData: {
        maskRules: [
          {
            columns: [],
          },
        ],
      },
    },
  });

  try {
    assert.throws(
      () => loadProfiles({ cwd: tempRoot, env: {} }),
      /Failed to load profiles from .*Invalid configuration: profile "broken"\.testData\.maskRules\[0\] must define at least one of \.table or \.schema/
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveProfile rejects cyclic inheritance chains', () => {
  const tempRoot = createTempProject({
    a: { extends: 'b' },
    b: { extends: 'a' },
  });

  try {
    assert.throws(
      () => resolveProfile(loadProfiles({ cwd: tempRoot, env: {} }), 'a', { env: {} }),
      /cyclic inheritance chain/i
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveAnalyzeConfig rejects invalid global test data limit', () => {
  const tempRoot = createTempProject({
    testData: {
      limit: 0,
    },
  });

  try {
    assert.throws(
      () => resolveAnalyzeConfig({}, { cwd: tempRoot, env: {} }),
      /Invalid configuration: testData\.limit must be a positive integer/
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveFetchConfig rejects unsupported transport values', () => {
  const tempRoot = createTempProject({
    fetcher: {
      fetch: {
        transport: 'smtp',
      },
    },
  });

  try {
    assert.equal(ALLOWED_FETCH_TRANSPORTS.has('smtp'), false);
    assert.throws(
      () => resolveFetchConfig({ profile: 'fetcher' }, { cwd: tempRoot, env: {} }),
      /Invalid configuration: profile "fetcher"\.fetch\.transport must be one of: auto, sftp, jt400, ftp/
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveFetchConfig rejects invalid stream file CCSID values', () => {
  const tempRoot = createTempProject({
    fetcher: {
      fetch: {
        streamFileCcsid: 0,
      },
    },
  });

  try {
    assert.throws(
      () => resolveFetchConfig({ profile: 'fetcher' }, { cwd: tempRoot, env: {} }),
      /Invalid configuration: profile "fetcher"\.fetch\.streamFileCcsid must be a positive integer/
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('loadProfiles rejects invalid bridge mode values', () => {
  const tempRoot = createTempProject({
    broken: {
      bridge: {
        enabled: true,
        mode: 'unsafe',
      },
    },
  });

  try {
    assert.throws(
      () => loadProfiles({ cwd: tempRoot, env: {} }),
      /Invalid configuration: profile "broken"\.bridge\.mode must be one of: plan-only, plan-stage-apply, plan-stage-apply-compile/
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('validateProfiles accepts minimal valid structures and rejects invalid profile shape', () => {
  assert.doesNotThrow(() => validateProfiles({}));
  assert.doesNotThrow(() =>
    validateProfiles({
      default: {
        sourceRoot: './src',
      },
    })
  );

  assert.throws(
    () =>
      validateProfiles({
        broken: {
          extensions: '.rpgle',
        },
      }),
    /Invalid configuration: profile "broken"\.extensions must be an array of strings/
  );
});

test('loadProfiles with --config JSON file path loads only that file (no overlay merge)', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-runtime-config-json-file-'));
  const configDir = path.join(tempRoot, 'config');
  fs.mkdirSync(configDir, { recursive: true });

  const directPath = path.join(configDir, 'custom-profiles.json');
  fs.writeFileSync(
    directPath,
    `${JSON.stringify(
      {
        sample: {
          sourceRoot: './direct-source',
          outputRoot: './direct-output',
        },
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(
    path.join(configDir, 'profiles.alpha.json'),
    `${JSON.stringify(
      {
        sample: {
          outputRoot: './overlay-output',
        },
      },
      null,
      2
    )}\n`
  );

  try {
    const profiles = loadProfiles({
      cwd: tempRoot,
      env: {},
      args: {
        config: './config/custom-profiles.json',
      },
    });
    const metadata = getProfilesMetadata(profiles);

    assert.equal(profiles.sample.sourceRoot, './direct-source');
    assert.equal(profiles.sample.outputRoot, './direct-output');
    assert.equal(metadata.profilePath, directPath);
    assert.deepEqual(metadata.attemptedPaths, [directPath]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('loadProfiles prefers local-only/profiles.json over config/profiles.json', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-runtime-config-local-only-'));
  const configDir = path.join(tempRoot, 'config');
  const localOnlyDir = path.join(configDir, 'local-only');
  fs.mkdirSync(localOnlyDir, { recursive: true });

  fs.writeFileSync(
    path.join(configDir, 'profiles.json'),
    `${JSON.stringify(
      {
        sample: {
          sourceRoot: './shared-source',
          outputRoot: './shared-output',
        },
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(
    path.join(localOnlyDir, 'profiles.json'),
    `${JSON.stringify(
      {
        sample: {
          sourceRoot: './local-source',
          outputRoot: './local-output',
        },
      },
      null,
      2
    )}\n`
  );

  try {
    const profiles = loadProfiles({ cwd: tempRoot, env: {} });
    const metadata = getProfilesMetadata(profiles);

    assert.equal(profiles.sample.sourceRoot, './local-source');
    assert.equal(profiles.sample.outputRoot, './local-output');
    assert.equal(metadata.profilePath, path.join(localOnlyDir, 'profiles.json'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('readWorkflowConfig normalizes workflow preset fields deterministically', () => {
  const tempRoot = createTempProject({
    sample: {
      sourceRoot: './src',
      workflow: {
        presets: {
          release: {
            steps: [' Analyze ', 'REPORT', 'report'],
            members: ['orderpgm', ' ORDERPGM ', 'bpgm'],
            analyzeModes: ['documentation', 'documentation', 'error-analysis'],
            tables: [
              {
                table: ' orders ',
                schema: ' app ',
                filter: 'status = "o"',
              },
            ],
            impact: [
              {
                field: 'customer_id',
                member: 'orderpgm',
              },
            ],
          },
        },
      },
    },
  });

  try {
    const profiles = loadProfiles({ cwd: tempRoot, env: {} });
    const profile = resolveProfile(profiles, 'sample', { env: {} });
    const preset = resolveWorkflowPresetConfig(profiles, profile, 'release', {});

    assert.deepEqual(preset.steps, ['analyze', 'report']);
    assert.deepEqual(preset.members, ['BPGM', 'ORDERPGM']);
    assert.deepEqual(preset.analyzeModes, ['documentation', 'error-analysis']);
    assert.deepEqual(preset.tables, [
      {
        schema: 'APP',
        table: 'ORDERS',
        filter: 'STATUS = "O"',
      },
    ]);
    assert.deepEqual(preset.impact, [
      {
        target: '',
        field: 'CUSTOMER_ID',
        program: '',
        member: 'ORDERPGM',
      },
    ]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveProfile expands env placeholders in nested objects and arrays, including missing values', () => {
  const tempRoot = createTempProject({
    sample: {
      db: {
        host: '${env:ZEUS_DB_HOST}',
        user: 'USER_${env:ZEUS_DB_USER_SUFFIX}',
      },
      testData: {
        maskColumns: ['EMAIL', '${env:ZEUS_MASK_COLUMN}', '${env:ZEUS_MISSING_COLUMN}'],
      },
    },
  });

  try {
    const profile = resolveProfile(loadProfiles({ cwd: tempRoot, env: {} }), 'sample', {
      env: {
        ZEUS_DB_HOST: 'ibmi.example.com',
        ZEUS_DB_USER_SUFFIX: 'OPS',
        ZEUS_MASK_COLUMN: 'PHONE',
      },
    });

    assert.equal(profile.db.host, 'ibmi.example.com');
    assert.equal(profile.db.user, 'USER_OPS');
    assert.deepEqual(profile.testData.maskColumns, ['EMAIL', 'PHONE', '']);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveProfile merge semantics keep object inheritance and replace arrays', () => {
  const tempRoot = createTempProject({
    parent: {
      extensions: ['.rpg', '.rpgle'],
      db: {
        host: 'base-host',
        user: 'base-user',
        password: 'base-password',
      },
      testData: {
        maskColumns: ['EMAIL', 'PHONE'],
      },
    },
    child: {
      extends: 'parent',
      extensions: ['.sqlrpgle'],
      db: {
        user: 'child-user',
      },
      testData: {
        maskColumns: ['SSN'],
      },
    },
  });

  try {
    const profile = resolveProfile(loadProfiles({ cwd: tempRoot, env: {} }), 'child', { env: {} });

    assert.deepEqual(profile.extensions, ['.sqlrpgle']);
    assert.deepEqual(profile.db, {
      host: 'base-host',
      user: 'child-user',
      password: 'base-password',
    });
    assert.deepEqual(profile.testData.maskColumns, ['SSN']);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveProfile distinguishes null overrides from undefined inherit-through', () => {
  const profiles = {
    parent: {
      db: {
        host: 'base-host',
        user: 'base-user',
      },
    },
    child: {
      extends: 'parent',
      db: {
        host: null,
        user: undefined,
      },
    },
  };

  assert.doesNotThrow(() => validateProfiles(profiles));
  const resolved = resolveProfile(profiles, 'child', { env: {} });
  assert.equal(resolved.db.host, null);
  assert.equal(resolved.db.user, 'base-user');
});
