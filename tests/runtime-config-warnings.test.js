const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveAnalyzeConfig, resolveAnalyzeDbConfig } = require('../src/config/runtimeConfig');
const {
  buildDbRuntimeConflictDiagnostics,
  getDbRuntimeConflictWarnings,
  printDbRuntimeConflictWarnings,
} = require('../src/cli/helpers/runtimeConfigWarnings');

function createTempProject(profiles) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-runtime-warning-'));
  fs.mkdirSync(path.join(tempRoot, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(tempRoot, 'config', 'profiles.example.json'),
    `${JSON.stringify(profiles, null, 2)}\n`,
    'utf8'
  );
  return tempRoot;
}

test('runtime DB warnings describe env/profile target mismatches', () => {
  const tempRoot = createTempProject({
    development: {
      db: {
        host: 'primary-system',
        user: 'readonly-user',
        password: 'profile-pass',
      },
    },
  });

  try {
    const config = resolveAnalyzeConfig(
      { profile: 'development' },
      {
        cwd: tempRoot,
        env: {
          ZEUS_DB_HOST: 'secondary-system',
          ZEUS_DB_PASSWORD: 'runtime-pass',
        },
      }
    );
    const dbConfig = resolveAnalyzeDbConfig(config, 'metadata');
    const warnings = getDbRuntimeConflictWarnings(dbConfig);
    const lines = [];

    assert.equal(warnings.length, 1);
    printDbRuntimeConflictWarnings(dbConfig, {
      writeLine: line => lines.push(line),
    });

    assert.match(lines[0], /Runtime config mismatch detected/);
    assert.match(lines[1], /ZEUS_DB_HOST="secondary-system"/);
    assert.match(lines[1], /db\.host="primary-system"/);
    assert.match(lines[2], /doctor --profile <name> --show-resolved/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime DB diagnostics expose safe structured conflict details', () => {
  const tempRoot = createTempProject({
    'primary-readonly': {
      db: {
        host: 'primary-system',
        user: 'readonly-user',
        password: 'profile-pass',
      },
    },
  });

  try {
    const config = resolveAnalyzeConfig(
      { profile: 'primary-readonly' },
      {
        cwd: tempRoot,
        env: {
          ZEUS_DB_HOST: 'secondary-system',
          ZEUS_DB_PASSWORD: 'runtime-pass',
        },
      }
    );
    const dbConfig = resolveAnalyzeDbConfig(config, 'metadata');
    const diagnostics = buildDbRuntimeConflictDiagnostics(dbConfig, {
      profile: 'primary-readonly',
    });

    assert.equal(diagnostics.length, 1);
    assert.deepEqual(diagnostics[0], {
      code: 'ENV_PROFILE_CONFLICT',
      severity: 'WARN',
      path: 'db.host',
      profile: 'primary-readonly',
      profileValue: 'primary-system',
      envVar: 'ZEUS_DB_HOST',
      effectiveValue: 'secondary-system',
      message:
        'Profile "primary-readonly" declares db.host="primary-system", but ZEUS_DB_HOST overrides it with "secondary-system". Env vars have precedence.',
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
