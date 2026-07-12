const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildEnvironmentChecks, runDoctorChecks } = require('../src/cli/commands/doctorCommand');

function createTempProject(profiles) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-doctor-'));
  fs.mkdirSync(path.join(tempRoot, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(tempRoot, 'config', 'profiles.json'),
    `${JSON.stringify(profiles, null, 2)}\n`,
    'utf8'
  );
  return tempRoot;
}

test('buildEnvironmentChecks flags missing env vars with concrete set hints', () => {
  const checks = buildEnvironmentChecks({
    profile: {
      db: {},
      fetch: {},
    },
    analyzeConfig: null,
    fetchConfig: null,
    env: {},
  });

  assert.ok(
    checks.some(
      entry =>
        entry.name === 'ZEUS_DB_HOST' &&
        entry.status === 'FAIL' &&
        /set ZEUS_DB_HOST=primary-system/.test(entry.details)
    )
  );
  assert.ok(
    checks.some(
      entry =>
        entry.name === 'ZEUS_FETCH_OUT' &&
        entry.status === 'FAIL' &&
        /set ZEUS_FETCH_OUT=\.\/fetched-source\/demo/.test(entry.details)
    )
  );
  assert.ok(checks.some(entry => entry.name === 'ZEUS_OUTPUT_ROOT' && entry.status === 'WARN'));
  assert.ok(
    checks.some(entry => entry.name === 'ZEUS_ANALYSES_REGISTRY' && entry.status === 'WARN')
  );
});

test('buildEnvironmentChecks downgrades to warnings when the profile already provides literal fallbacks', () => {
  const checks = buildEnvironmentChecks({
    profile: {
      db: {
        host: 'profile-host',
        user: 'profile-user',
        password: 'profile-pass',
      },
      fetch: {
        out: './rpg_sources',
      },
      outputRoot: './output',
    },
    analyzeConfig: null,
    fetchConfig: null,
    env: {},
  });

  assert.ok(checks.some(entry => entry.name === 'ZEUS_DB_HOST' && entry.status === 'WARN'));
  assert.ok(checks.some(entry => entry.name === 'ZEUS_FETCH_OUT' && entry.status === 'WARN'));
  assert.ok(checks.some(entry => entry.name === 'ZEUS_OUTPUT_ROOT' && entry.status === 'WARN'));
});

test('buildEnvironmentChecks does not warn about ZEUS_DB_URL when ZEUS_DB_HOST is already configured', () => {
  const checks = buildEnvironmentChecks({
    profile: {
      db: {
        host: 'profile-host',
        user: 'profile-user',
        password: 'profile-pass',
      },
    },
    analyzeConfig: null,
    fetchConfig: null,
    env: {},
  });

  assert.ok(checks.some(entry => entry.name === 'ZEUS_DB_HOST'));
  assert.equal(
    checks.some(entry => entry.name === 'ZEUS_DB_URL'),
    false
  );
});

test('buildEnvironmentChecks includes dedicated metadata and test-data DB role variables when configured', () => {
  const checks = buildEnvironmentChecks({
    profile: {
      db: {
        host: 'base-host',
        user: 'base-user',
        password: 'base-pass',
      },
      dbRoles: {
        metadata: {
          host: '${env:ZEUS_METADATA_DB_HOST}',
        },
        testData: {
          host: '${env:ZEUS_TESTDATA_DB_HOST}',
        },
      },
    },
    analyzeConfig: {
      dbRoles: {
        metadata: {
          host: 'meta-host',
          user: 'meta-user',
          password: 'meta-pass',
        },
        testData: {
          host: 'test-host',
          user: 'test-user',
          password: 'test-pass',
        },
      },
    },
    fetchConfig: null,
    env: {},
  });

  assert.ok(
    checks.some(entry => entry.name === 'ZEUS_METADATA_DB_HOST' && entry.status === 'WARN')
  );
  assert.ok(
    checks.some(entry => entry.name === 'ZEUS_TESTDATA_DB_HOST' && entry.status === 'WARN')
  );
  assert.ok(
    checks.some(entry => entry.name === 'ZEUS_METADATA_DB_PASSWORD' && entry.status === 'WARN')
  );
  assert.ok(
    checks.some(entry => entry.name === 'ZEUS_TESTDATA_DB_PASSWORD' && entry.status === 'WARN')
  );
});

test('runDoctorChecks skips remote probes unless --probe is requested', () => {
  const tempRoot = createTempProject({
    demo: {
      db: {
        host: 'db.example.com',
        user: '${env:ZEUS_DB_USER}',
        password: '${env:ZEUS_DB_PASSWORD}',
      },
    },
  });
  const result = runDoctorChecks(
    {
      profile: 'demo',
    },
    {
      cwd: tempRoot,
      env: {
        ZEUS_DB_USER: 'DBUSR',
        ZEUS_DB_PASSWORD: 'db-secret',
      },
      services: {
        runReadOnlyDb2Query() {
          throw new Error('should not be called');
        },
        executeClCommandRaw() {
          throw new Error('should not be called');
        },
      },
    }
  );

  assert.ok(result.checks.some(entry => entry.name === 'Probe Mode' && entry.status === 'INFO'));
  assert.equal(result.probeRows.length, 0);
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('runDoctorChecks records probe matrix entries when --probe is enabled', () => {
  const tempRoot = createTempProject({
    demo: {
      db: {
        host: 'db.example.com',
        user: '${env:ZEUS_DB_USER}',
        password: '${env:ZEUS_DB_PASSWORD}',
      },
      fetch: {
        host: '${env:ZEUS_FETCH_HOST}',
        user: '${env:ZEUS_FETCH_USER}',
        password: '${env:ZEUS_FETCH_PASSWORD}',
        sourceLib: 'DEMO',
        ifsDir: '/tmp/demo',
        out: './out',
      },
    },
  });
  const result = runDoctorChecks(
    {
      profile: 'demo',
      probe: true,
    },
    {
      cwd: tempRoot,
      env: {
        ZEUS_FETCH_HOST: 'fetch.example.com',
        ZEUS_FETCH_USER: 'FETCHUSR',
        ZEUS_FETCH_PASSWORD: 'fetch-secret',
        ZEUS_FETCH_SOURCE_LIB: 'DEMO',
        ZEUS_FETCH_IFS_DIR: '/tmp/demo',
        ZEUS_FETCH_OUT: './out',
        ZEUS_DB_HOST: 'db.example.com',
        ZEUS_DB_USER: 'DBUSR',
        ZEUS_DB_PASSWORD: 'db-secret',
      },
      services: {
        executeClCommandRaw() {
          return {
            ok: true,
            messages: [],
            stderr: '',
          };
        },
        runReadOnlyDb2Query() {
          return {
            columns: ['HEALTHCHECK'],
            rows: [{ HEALTHCHECK: 1 }],
            rowCount: 1,
          };
        },
        getIbmiOsVersion() {
          return {
            versionString: 'IBM i 7.5',
          };
        },
      },
    }
  );

  assert.ok(result.checks.some(entry => entry.name === 'Fetch Probe' && entry.status === 'PASS'));
  assert.ok(result.checks.some(entry => entry.name === 'JDBC Metadata' && entry.status === 'PASS'));
  assert.ok(
    result.probeRows.some(entry => entry.functionName === 'fetch' && entry.status === 'OK')
  );
  assert.ok(
    result.probeRows.some(entry => entry.functionName === 'metadata-db' && entry.status === 'OK')
  );
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
