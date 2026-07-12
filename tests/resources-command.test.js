const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const cliPath = path.resolve(__dirname, '../cli/zeus.js');

function createTempConfig(profiles) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-resources-cli-'));
  const configDir = path.join(tempRoot, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'profiles.example.json'),
    `${JSON.stringify(profiles, null, 2)}\n`,
    'utf8'
  );
  return { tempRoot, configDir };
}

function runCli(commandArgs, configDir) {
  return spawnSync(process.execPath, [cliPath, '--config', configDir, ...commandArgs], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, ZEUS_NO_AUTO_ENV: '1' },
    encoding: 'utf8',
  });
}

test('resources command prints the resolved resource model as JSON', () => {
  const { tempRoot, configDir } = createTempConfig({
    multi: {
      systems: {
        test: { host: 'test.example.local', systemName: 'SYSTEST' },
        prod: { host: 'prod.example.local', systemName: 'SYSPROD' },
      },
      resources: {
        sourceCode: { system: 'test', libraries: ['SRCLIB'], sourceFiles: ['QRPGLESRC'] },
        metadata: { system: 'prod', schemas: ['CATALOG'] },
      },
    },
  });
  try {
    const result = runCli(['resources', '--profile', 'multi', '--json'], configDir);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.profile, 'multi');
    assert.equal(parsed.model.multiSystem, true);
    assert.equal(parsed.model.resources.sourceCode.system, 'test');
    assert.deepEqual(parsed.model.resources.sourceCode.sourceFiles, ['QRPGLESRC']);
    assert.equal(parsed.model.resources.metadata.system, 'prod');
    // No secrets in output.
    assert.doesNotMatch(result.stdout, /password/i);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resources command renders an ASCII table for the four resource kinds', () => {
  const { tempRoot, configDir } = createTempConfig({
    single: {
      fetch: { sourceLib: 'DEVLIB', files: ['QRPGLESRC'] },
      dbRoles: { metadata: { defaultSchema: 'APPMETA' } },
    },
  });
  try {
    const result = runCli(['resources', '--profile', 'single'], configDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Source code/);
    assert.match(result.stdout, /Objects/);
    assert.match(result.stdout, /DB metadata/);
    assert.match(result.stdout, /DB data/);
    assert.match(result.stdout, /backward compatible/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resources command fails clearly without a profile', () => {
  const { tempRoot, configDir } = createTempConfig({ x: {} });
  try {
    const result = runCli(['resources'], configDir);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Missing required option: --profile/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('discover-environment fails gracefully when DB connection is not configured', () => {
  const { tempRoot, configDir } = createTempConfig({
    nodbprofile: {
      fetch: { sourceLib: 'DEVLIB' },
    },
  });
  try {
    const result = runCli(['discover-environment', '--profile', 'nodbprofile'], configDir);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /connection configuration is incomplete/i);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
