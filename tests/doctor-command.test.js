const test = require('node:test');
const assert = require('node:assert/strict');

const { buildEnvironmentChecks } = require('../src/cli/commands/doctorCommand');

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

  assert.ok(checks.some((entry) => entry.name === 'ZEUS_DB_HOST' && entry.status === 'FAIL' && /set ZEUS_DB_HOST=mein-ibmi-host/.test(entry.details)));
  assert.ok(checks.some((entry) => entry.name === 'ZEUS_FETCH_OUT' && entry.status === 'FAIL' && /set ZEUS_FETCH_OUT=C:\/Projekte\/ticket\/zeus-fetch/.test(entry.details)));
  assert.ok(checks.some((entry) => entry.name === 'ZEUS_OUTPUT_ROOT' && entry.status === 'WARN'));
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

  assert.ok(checks.some((entry) => entry.name === 'ZEUS_DB_HOST' && entry.status === 'WARN'));
  assert.ok(checks.some((entry) => entry.name === 'ZEUS_FETCH_OUT' && entry.status === 'WARN'));
  assert.ok(checks.some((entry) => entry.name === 'ZEUS_OUTPUT_ROOT' && entry.status === 'WARN'));
});
