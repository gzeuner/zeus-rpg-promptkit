const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

const cliPath = path.resolve(__dirname, '../cli/zeus.js');

function runCliWithEnv(envOverrides = {}) {
  return spawnSync(process.execPath, [cliPath, 'query-sql'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      ...envOverrides,
    },
    encoding: 'utf8',
  });
}

test('CLI env warning does not require ZEUS_DB_URL when ZEUS_DB_HOST is present', () => {
  const result = runCliWithEnv({
    ZEUS_DB_USER: 'TESTUSR',
    ZEUS_DB_PASSWORD: 'TESTPWD',
    ZEUS_DB_HOST: 'pub400.example',
    ZEUS_DB_URL: '',
  });

  assert.equal(/Umgebungsvariablen nicht geladen: .*ZEUS_DB_URL/i.test(result.stderr), false);
});

test('CLI env warning still reports missing DB target when host and URL are both absent', () => {
  const result = runCliWithEnv({
    ZEUS_DB_USER: 'TESTUSR',
    ZEUS_DB_PASSWORD: 'TESTPWD',
    ZEUS_DB_HOST: '',
    ZEUS_DB_URL: '',
  });

  assert.match(result.stderr, /ZEUS_DB_HOST\|ZEUS_DB_URL/);
});
