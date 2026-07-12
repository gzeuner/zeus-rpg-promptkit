const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeSeverity,
  parseMaxMessages,
  runJoblog,
} = require('../src/cli/commands/joblogCommand');

test('parseMaxMessages validates positive integers and enforces ceiling', () => {
  assert.equal(parseMaxMessages(undefined), 100);
  assert.equal(parseMaxMessages('25'), 25);
  assert.equal(parseMaxMessages('999'), 500);
  assert.throws(() => parseMaxMessages('0'), /--max-messages/);
});

test('normalizeSeverity accepts INFO/WARNING/ERROR only', () => {
  assert.equal(normalizeSeverity(undefined), null);
  assert.equal(normalizeSeverity('warning'), 'WARNING');
  assert.equal(normalizeSeverity('ERROR'), 'ERROR');
  assert.throws(() => normalizeSeverity('fatal'), /--severity/);
});

test('joblog exits with code 2 when profile is missing', async () => {
  const originalExit = process.exit;
  const originalError = console.error;
  let exitCode = null;
  const errors = [];

  process.exit = code => {
    exitCode = code;
    throw new Error(`__EXIT__${code}`);
  };
  console.error = (...args) => {
    errors.push(args.join(' '));
  };

  try {
    await assert.rejects(() => runJoblog({}), /__EXIT__2/);
    assert.equal(exitCode, 2);
    assert.match(errors.join('\n'), /--profile/);
  } finally {
    process.exit = originalExit;
    console.error = originalError;
  }
});
