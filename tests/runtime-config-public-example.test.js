const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { loadProfiles, resolveProfile, validateProfiles } = require('../src/config/runtimeConfig');
const { getConnectionTargetMetadata } = require('../src/config/connectionTargetMetadata');

const projectRoot = path.resolve(__dirname, '..');
const examplePath = path.join(projectRoot, 'config', 'profiles.example.json');

test('profiles.example.json is strict JSON, validates, and exposes the public profile contract', () => {
  const raw = fs.readFileSync(examplePath, 'utf8');
  const parsed = JSON.parse(raw);

  validateProfiles(parsed);

  for (const name of [
    'default-shared',
    'default-fetch',
    'default-local',
    'dev',
    'demo',
    'demo-sqlserver-jtds',
    'sftp-fetch',
    'readonly-db2',
    'combined-fetch-and-query',
    'sample-source',
    'sample-preprod',
    'sample-dev',
    'sample-fetch',
    'sample-prod-ro',
  ]) {
    assert.ok(parsed[name], `expected profile ${name}`);
  }

  for (const token of [
    '"schemaPreference"',
    '"defaultWorkspaceRoot"',
    '"diagnoseTransport"',
    '"transportTimeoutMs"',
    '"productionSystem"',
    '"journaledTables"',
    '"workflowTokenBudgets"',
    '"jdbcConnections"',
  ]) {
    assert.ok(raw.includes(token), `expected ${token} in public example profile`);
  }

  for (const blocked of [
    '/home/',
    'analysis/zeus-fetch',
    'config/local-only',
    'BEGIN RSA',
    'BEGIN OPENSSH',
    'Kopie.local',
  ]) {
    assert.equal(
      raw.includes(blocked),
      false,
      `did not expect ${blocked} in profiles.example.json`
    );
  }

  assert.equal(raw.includes('"analyzeMode"'), false, 'public example should use analyzeModes');
  assert.equal(
    raw.includes('"compiledProgramLib"'),
    false,
    'unsupported runtimeContext.compiledProgramLib should not be documented'
  );
  assert.equal(
    raw.includes('"activeLibraries"'),
    false,
    'unsupported runtimeContext.activeLibraries should not be documented'
  );
});

test('public example profiles resolve mixins and workflow presets without local-only files', () => {
  const exampleEnv = {
    ZEUS_FETCH_HOST: 'YOUR_DEV_IBM_I_HOST',
  };
  const profiles = loadProfiles({ cwd: projectRoot, env: exampleEnv });
  const devProfile = resolveProfile(profiles, 'dev', { env: exampleEnv });
  const combinedProfile = resolveProfile(profiles, 'combined-fetch-and-query', {
    env: exampleEnv,
  });
  const sampleSourceProfile = resolveProfile(profiles, 'sample-source', { env: exampleEnv });

  assert.equal(devProfile.db.host, 'YOUR_DEV_IBM_I_HOST');
  assert.equal(devProfile.fetch.sourceLib, 'SOURCE_EXAMPLE');
  assert.equal(sampleSourceProfile.fetch.sourceLib, 'SOURCEN');
  assert.deepEqual(combinedProfile.workflow.presets['security-check'].analyzeModes, ['security']);
  assert.deepEqual(combinedProfile.runtimeContext.journaledTables, [
    'DATA_EXAMPLE.CUSTOMERS',
    'REPORTING_EXAMPLE.ORDERS',
  ]);
  assert.deepEqual(getConnectionTargetMetadata(devProfile.db), {
    kind: 'connection-target',
    source: 'system-ref',
    systemKey: 'dev',
    systemName: 'YOUR_DEV_SYSTEM_NAME',
    displayName: 'Development IBM i',
    aliases: ['YOUR_DEV_SYSTEM_ALIAS'],
    configuredNames: [
      'DEV',
      'YOUR_DEV_SYSTEM_NAME',
      'YOUR_DEV_SYSTEM_ALIAS',
      'YOUR_DEV_IBM_I_HOST',
    ],
  });
});
