const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  autoLoadEnvFiles,
  discoverEnvFiles,
  parseEnvFileContent,
  resolveEnvSearchDirs,
  resolveEnvFileNames,
  isSecretName,
  loadExplicitEnvFiles,
} = require('../src/config/envFileLoader');

test('explicit native env loading handles quoted hashes, layers and does not mutate shell', () => {
  const fixture = createConfigFixture();
  try {
    const base = path.join(fixture.localOnlyDir, '.env.base.local');
    const selected = path.join(fixture.localOnlyDir, '.env.selected.local');
    fs.writeFileSync(base, 'NEUTRAL="value # preserved"\nHOST=base\n');
    fs.writeFileSync(selected, 'export HOST=selected\n');
    const env = { HOST: 'stale-shell' };
    const loaded = loadExplicitEnvFiles([base, selected], { env });
    assert.equal(loaded.env.NEUTRAL, 'value # preserved');
    assert.equal(loaded.env.HOST, 'selected');
    assert.equal(env.HOST, 'stale-shell');
    assert.equal(JSON.stringify(loaded.files).includes('value # preserved'), false);
    assert.throws(
      () => loadExplicitEnvFiles(['.env.local']),
      error => error.code === 'ENV_FILE_EXPLICIT_REQUIRED'
    );
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('explicit profile JSON locates adjacent env rather than treating filename as directory', () => {
  const cwd = path.resolve('/work');
  assert.deepEqual(resolveEnvSearchDirs({ cwd, configDir: 'config/private.json' }), [
    path.join(cwd, 'config', 'local-only'),
    path.join(cwd, 'config'),
    cwd,
  ]);
});

function createConfigFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-env-loader-'));
  const configDir = path.join(tempRoot, 'config');
  const localOnlyDir = path.join(configDir, 'local-only');
  fs.mkdirSync(localOnlyDir, { recursive: true });
  return { tempRoot, configDir, localOnlyDir };
}

test('parseEnvFileContent extracts KEY=VALUE and skips comments', () => {
  const entries = parseEnvFileContent(
    [
      '# full line comment',
      '',
      'ZEUS_DB_HOST=DEMOHOST',
      'ZEUS_DB_USER=DEMOUSER   # inline comment stripped',
      'ZEUS_DB_PASSWORD=p#ssword',
      'not a valid line',
      '   ZEUS_DB_DEFAULT_SCHEMA=DEMO ',
    ].join('\n')
  );

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
  assert.deepEqual(dirs, [path.join(cwd, 'config', 'local-only'), path.join(cwd, 'config'), cwd]);
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
    const result = discoverEnvFiles({
      cwd: fixture.tempRoot,
      configDir: 'config',
      environment: 'default',
    });
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
      'utf8'
    );
    const env = { ZEUS_DB_HOST: 'SHELLHOST' };
    const summary = autoLoadEnvFiles({
      cwd: fixture.tempRoot,
      env,
      configDir: 'config',
      environment: 'default',
    });

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
    fs.writeFileSync(
      path.join(fixture.localOnlyDir, '.env.local'),
      'ZEUS_DB_URL=jdbc:file\n',
      'utf8'
    );
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
    fs.writeFileSync(
      path.join(fixture.localOnlyDir, '.env.local'),
      'ZEUS_DB_HOST=BASEHOST\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(fixture.localOnlyDir, '.env.ders.local'),
      'ZEUS_DB_HOST=DERSHOST\n',
      'utf8'
    );
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
    const summary = autoLoadEnvFiles({
      cwd: fixture.tempRoot,
      env,
      configDir: 'config',
      environment: 'default',
    });
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
    fs.writeFileSync(
      path.join(fixture.localOnlyDir, '.env.local'),
      'ZEUS_DB_PASSWORD=topsecret\n',
      'utf8'
    );
    const env = {};
    const summary = autoLoadEnvFiles({
      cwd: fixture.tempRoot,
      env,
      configDir: 'config',
      environment: 'default',
    });
    const serialized = JSON.stringify(summary);
    assert.equal(
      serialized.includes('topsecret'),
      false,
      'secret value must not appear in summary'
    );
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

const loaderRoot = path.resolve(__dirname, '..');
const shellEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !/^ZEUS_|^(BASH_ENV|ENV)$/i.test(name))
);
const bashExecutable = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const powershellExecutable = 'pwsh';
const loaders = [
  {
    name: 'PowerShell',
    file: 'load-env.ps1',
    executable: powershellExecutable,
    available:
      spawnSync(powershellExecutable, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'])
        .status === 0,
  },
  {
    name: 'Bash',
    file: 'load-env.sh',
    executable: bashExecutable,
    available: spawnSync(bashExecutable, ['--noprofile', '--norc', '-c', 'exit 0']).status === 0,
  },
];

function runShellLoader(
  loader,
  fixture,
  { mode = '', environment = 'default', checkValues = false } = {}
) {
  const powershell = loader.name === 'PowerShell';
  const check = checkValues
    ? powershell
      ? `if ($env:ZEUS_DB_PASSWORD -ne 'fixture#password' -or $env:ZEUS_DB_HOST -ne 'OVERRIDE_HOST' -or $env:ZEUS_OUTPUT_ROOT -ne './fixture-output') { throw 'Fixture values differ' }; Write-Output 'LOADER_VALUES_OK';`
      : `if [ "$ZEUS_DB_PASSWORD" != 'fixture#password' ] || [ "$ZEUS_DB_HOST" != 'OVERRIDE_HOST' ] || [ "$ZEUS_OUTPUT_ROOT" != './fixture-output' ]; then exit 9; fi; printf 'LOADER_VALUES_OK\\n';`
    : '';
  const command = powershell
    ? `try { . ./config/load-env.ps1 -Environment ${environment} ${mode ? `-${mode}` : ''}; ${check} exit 0 } catch { [Console]::Error.WriteLine($_.Exception.Message); if ($global:LASTEXITCODE -in 2,3) { exit $global:LASTEXITCODE }; exit 1 }`
    : `source ./config/load-env.sh ${environment} ${mode ? `--${mode.toLowerCase()}` : ''}; loader_status=$?; if [ "$loader_status" -ne 0 ]; then exit "$loader_status"; fi; ${check} exit 0`;
  const args = powershell
    ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command]
    : ['--noprofile', '--norc', '-c', command];
  return spawnSync(loader.executable, args, {
    cwd: fixture.tempRoot,
    env: shellEnv,
    encoding: 'utf8',
    timeout: 30000,
  });
}

function createShellFixture(loader) {
  const fixture = createConfigFixture();
  fs.copyFileSync(
    path.join(loaderRoot, 'config', loader.file),
    path.join(fixture.configDir, loader.file)
  );
  return fixture;
}

test('shell loader output statements never interpolate environment values', () => {
  for (const loader of loaders) {
    const content = fs.readFileSync(path.join(loaderRoot, 'config', loader.file), 'utf8');
    const outputLines = content
      .split(/\r?\n/)
      .filter(line => /Write-(?:Host|Verbose|Warning|Error)|\becho\b/.test(line));
    for (const line of outputLines) {
      assert.doesNotMatch(line, /\$(?:\{)?(?:value|displayValue|env:)/i);
    }
  }
});

for (const loader of loaders) {
  for (const mode of ['', 'Quiet', 'Verbose']) {
    test(
      `${loader.name} ${mode || 'default'} bootstrap is compact and value-free`,
      { skip: !loader.available },
      () => {
        const fixture = createShellFixture(loader);
        try {
          fs.writeFileSync(
            path.join(fixture.localOnlyDir, '.env.local'),
            [
              'ZEUS_JDBC_ONLY=1',
              'ZEUS_DB_HOST=BASE_HOST',
              'ZEUS_DB_PASSWORD=fixture#password',
              'ZEUS_DB_URL=jdbc:fixture://hidden-host;user=hidden-user;password=hidden-pass',
              'ZEUS_API_TOKEN=enc:v1:fixture-credential-blob',
              '  ZEUS_OUTPUT_ROOT=./fixture-output   # comment',
            ].join('\r\n')
          );
          fs.writeFileSync(
            path.join(fixture.configDir, '.env.fixture.local'),
            'ZEUS_DB_HOST=OVERRIDE_HOST\n'
          );
          const result = runShellLoader(loader, fixture, {
            mode,
            environment: 'fixture',
            checkValues: true,
          });
          const output = result.stdout + result.stderr;
          assert.equal(result.status, 0, output);
          assert.match(output, /LOADER_VALUES_OK/);
          assert.doesNotMatch(
            output,
            /fixture#password|jdbc:fixture|hidden-host|hidden-user|hidden-pass|enc:v1|BASE_HOST|OVERRIDE_HOST|fixture-output/
          );
          if (mode === 'Quiet') {
            assert.equal(output.trim(), 'LOADER_VALUES_OK');
          } else {
            assert.match(output, /Loaded \.env\.local: 6 variable\(s\)\./);
            assert.match(output, /Loaded \.env\.fixture\.local: 1 variable\(s\)\./);
            if (mode === 'Verbose') {
              assert.match(output, /ZEUS_DB_PASSWORD \(value hidden\)/);
              assert.match(output, /shell session only/);
            } else {
              assert.doesNotMatch(output, /ZEUS_DB_PASSWORD|ZEUS_DB_URL|ZEUS_API_TOKEN/);
            }
          }
        } finally {
          fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
        }
      }
    );
  }

  test(
    `${loader.name} keeps missing-file and missing-variable failures visible in Quiet mode`,
    { skip: !loader.available },
    () => {
      const fixture = createShellFixture(loader);
      try {
        const missingFile = runShellLoader(loader, fixture, { mode: 'Quiet' });
        assert.equal(missingFile.status, 2, missingFile.stdout + missingFile.stderr);
        assert.match(missingFile.stdout + missingFile.stderr, /\.env\.local/);
        fs.writeFileSync(
          path.join(fixture.localOnlyDir, '.env.local'),
          'ZEUS_DB_HOST=hidden-target\n'
        );
        const missingVariables = runShellLoader(loader, fixture, { mode: 'Quiet' });
        assert.equal(missingVariables.status, 3, missingVariables.stdout + missingVariables.stderr);
        assert.match(missingVariables.stdout + missingVariables.stderr, /ZEUS_DB_PASSWORD/);
        assert.doesNotMatch(missingVariables.stdout + missingVariables.stderr, /hidden-target/);
      } finally {
        fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
      }
    }
  );
}
