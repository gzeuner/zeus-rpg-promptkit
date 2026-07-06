const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  autoLoadEnvFiles,
  discoverEnvFiles,
  parseEnvFileContent,
  resolveEnvSearchDirs,
  resolveEnvFileNames,
  isSecretName,
} = require('../src/config/envFileLoader');

function createConfigFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-env-loader-'));
  const configDir = path.join(tempRoot, 'config');
  const localOnlyDir = path.join(configDir, 'local-only');
  fs.mkdirSync(localOnlyDir, { recursive: true });
  return { tempRoot, configDir, localOnlyDir };
}

test('parseEnvFileContent extracts KEY=VALUE and skips comments', () => {
  const entries = parseEnvFileContent([
    '# full line comment',
    '',
    'ZEUS_DB_HOST=DEMOHOST',
    'ZEUS_DB_USER=DEMOUSER   # inline comment stripped',
    'ZEUS_DB_PASSWORD=p#ssword',
    'not a valid line',
    '   ZEUS_DB_DEFAULT_SCHEMA=DEMO ',
  ].join('\n'));

  assert.deepEqual(entries, [
    { key: 'ZEUS_DB_HOST', value: 'DEMOHOST' },
    { key: 'ZEUS_DB_USER', value: 'DEMOUSER' },
    { key: 'ZEUS_DB_PASSWORD', value: 'p#ssword' },
    { key: 'ZEUS_DB_DEFAULT_SCHEMA', value: 'DEMO' },
  ]);
});

test('resolveEnvSearchDirs prioritizes local-only then config then cwd', () => {
  const cwd = path.resolve('/work');
  const dirs = resolveEnvSearchDirs({ cwd, configDir: 'config' });
  assert.deepEqual(dirs, [
    path.join(cwd, 'config', 'local-only'),
    path.join(cwd, 'config'),
    cwd,
  ]);
});

test('resolveEnvFileNames returns base only for default environment', () => {
  assert.deepEqual(resolveEnvFileNames('default'), [{ name: '.env.local', role: 'base' }]);
  assert.deepEqual(resolveEnvFileNames(''), [{ name: '.env.local', role: 'base' }]);
  assert.deepEqual(resolveEnvFileNames('ders'), [
    { name: '.env.local', role: 'base' },
    { name: '.env.ders.local', role: 'environment' },
  ]);
});

test('discoverEnvFiles finds files in config/local-only', () => {
  const fixture = createConfigFixture();
  try {
    fs.writeFileSync(path.join(fixture.localOnlyDir, '.env.local'), 'ZEUS_DB_HOST=H\n', 'utf8');
    const result = discoverEnvFiles({ cwd: fixture.tempRoot, configDir: 'config', environment: 'default' });
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].role, 'base');
    assert.equal(path.dirname(result.files[0].path), fixture.localOnlyDir);
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('autoLoadEnvFiles loads missing vars but never overwrites preexisting ones', () => {
  const fixture = createConfigFixture();
  try {
    fs.writeFileSync(
      path.join(fixture.localOnlyDir, '.env.local'),
      'ZEUS_DB_HOST=FILEHOST\nZEUS_DB_USER=FILEUSER\nZEUS_OUTPUT_ROOT=./out\n',
      'utf8',
    );
    const env = { ZEUS_DB_HOST: 'SHELLHOST' };
    const summary = autoLoadEnvFiles({ cwd: fixture.tempRoot, env, configDir: 'config', environment: 'default' });

    assert.equal(env.ZEUS_DB_HOST, 'SHELLHOST', 'preexisting value preserved');
    assert.equal(env.ZEUS_DB_USER, 'FILEUSER', 'missing value loaded from file');
    assert.equal(env.ZEUS_OUTPUT_ROOT, './out');
    assert.equal(summary.loaded, true);
    assert.deepEqual(summary.applied.sort(), ['ZEUS_DB_USER', 'ZEUS_OUTPUT_ROOT']);
    assert.deepEqual(summary.skippedPreexisting, ['ZEUS_DB_HOST']);
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('autoLoadEnvFiles preserves explicitly-set empty variables', () => {
  const fixture = createConfigFixture();
  try {
    fs.writeFileSync(path.join(fixture.localOnlyDir, '.env.local'), 'ZEUS_DB_URL=jdbc:file\n', 'utf8');
    const env = { ZEUS_DB_URL: '' };
    autoLoadEnvFiles({ cwd: fixture.tempRoot, env, configDir: 'config', environment: 'default' });
    assert.equal(env.ZEUS_DB_URL, '', 'present-but-empty var is not overwritten');
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('autoLoadEnvFiles lets environment file override base file among files', () => {
  const fixture = createConfigFixture();
  try {
    fs.writeFileSync(path.join(fixture.localOnlyDir, '.env.local'), 'ZEUS_DB_HOST=BASEHOST\n', 'utf8');
    fs.writeFileSync(path.join(fixture.localOnlyDir, '.env.ders.local'), 'ZEUS_DB_HOST=DERSHOST\n', 'utf8');
    const env = {};
    autoLoadEnvFiles({ cwd: fixture.tempRoot, env, configDir: 'config', environment: 'ders' });
    assert.equal(env.ZEUS_DB_HOST, 'DERSHOST', 'environment file wins over base file');
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('autoLoadEnvFiles is a no-op when no env files exist', () => {
  const fixture = createConfigFixture();
  try {
    const env = {};
    const summary = autoLoadEnvFiles({ cwd: fixture.tempRoot, env, configDir: 'config', environment: 'default' });
    assert.equal(summary.loaded, false);
    assert.deepEqual(summary.applied, []);
    assert.deepEqual(Object.keys(env), []);
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('summary never exposes secret values, only counts and names', () => {
  const fixture = createConfigFixture();
  try {
    fs.writeFileSync(path.join(fixture.localOnlyDir, '.env.local'), 'ZEUS_DB_PASSWORD=topsecret\n', 'utf8');
    const env = {};
    const summary = autoLoadEnvFiles({ cwd: fixture.tempRoot, env, configDir: 'config', environment: 'default' });
    const serialized = JSON.stringify(summary);
    assert.equal(serialized.includes('topsecret'), false, 'secret value must not appear in summary');
    assert.ok(summary.applied.includes('ZEUS_DB_PASSWORD'));
    assert.equal(summary.appliedSecretCount, 1);
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('isSecretName flags credential-like variable names', () => {
  assert.equal(isSecretName('ZEUS_DB_PASSWORD'), true);
  assert.equal(isSecretName('ZEUS_API_TOKEN'), true);
  assert.equal(isSecretName('ZEUS_DB_HOST'), false);
});
