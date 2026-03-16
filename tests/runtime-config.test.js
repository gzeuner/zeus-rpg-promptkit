const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  ALLOWED_FETCH_TRANSPORTS,
  loadProfiles,
  resolveAnalyzeConfig,
  resolveFetchConfig,
  resolveBundleConfig,
} = require('../src/config/runtimeConfig');

function createTempProject(profiles) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-runtime-config-'));
  fs.mkdirSync(path.join(tempRoot, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(tempRoot, 'config', 'profiles.example.json'),
    `${JSON.stringify(profiles, null, 2)}\n`,
    'utf8',
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
    const profiles = loadProfiles({ cwd: tempRoot });
    assert.equal(profiles.default.sourceRoot, './src');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveAnalyzeConfig merges profile settings with global optimizer and test data defaults', () => {
  const tempRoot = createTempProject({
    contextOptimizer: {
      softTokenLimit: 2000,
      maxProgramCalls: 15,
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
      },
      testData: {
        maskColumns: ['EMAIL', 'PHONE'],
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
    assert.equal(config.testData.limit, 25);
    assert.deepEqual(config.testData.maskColumns, ['EMAIL', 'PHONE']);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveAnalyzeConfig applies environment overrides for DB credentials', () => {
  const tempRoot = createTempProject({
    sample: {
      db: {
        host: 'profile-host',
        user: 'profile-user',
        password: 'profile-pass',
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
          ZEUS_DB_HOST: 'env-host',
          ZEUS_DB_USER: 'env-user',
          ZEUS_DB_PASSWORD: 'env-pass',
          ZEUS_DB_DEFAULT_SCHEMA: 'ENVLIB',
        },
      },
    );

    assert.deepEqual(config.db, {
      host: 'env-host',
      user: 'env-user',
      password: 'env-pass',
      defaultSchema: 'ENVLIB',
    });
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
          ZEUS_FETCH_PASSWORD: 'env-pass',
          ZEUS_FETCH_SOURCE_LIB: 'qcllesrc',
          ZEUS_FETCH_FILES: 'qrpglesrc,qsqlrpglesrc',
          ZEUS_FETCH_REPLACE: 'true',
        },
      },
    );

    assert.equal(config.host, 'profile-host');
    assert.equal(config.user, 'profile-user');
    assert.equal(config.password, 'env-pass');
    assert.equal(config.sourceLib, 'QCLLESRC');
    assert.deepEqual(config.files, ['QRPGLESRC', 'QSQLRPGLESRC']);
    assert.equal(config.replace, true);
    assert.equal(config.transport, 'sftp');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveBundleConfig throws for unknown profiles', () => {
  const tempRoot = createTempProject({});

  try {
    assert.throws(
      () => resolveBundleConfig({ profile: 'missing' }, { cwd: tempRoot }),
      /Profile "missing" not found/,
    );
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
      () => loadProfiles({ cwd: tempRoot }),
      /Invalid configuration: profile "broken"\.extensions must be an array of strings/,
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
      /Invalid configuration: testData\.limit must be a positive integer/,
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
      /Invalid configuration: profile "fetcher"\.fetch\.transport must be one of: auto, sftp, jt400, ftp/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
