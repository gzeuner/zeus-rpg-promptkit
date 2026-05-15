const test = require('node:test');
const assert = require('node:assert/strict');

const { runJoblog } = require('../src/cli/commands/joblogCommand');

test('joblog exits with code 2 when profile is missing', async () => {
  const originalExit = process.exit;
  const originalError = console.error;
  let exitCode = null;
  const errors = [];

  process.exit = (code) => {
    exitCode = code;
    throw new Error(`__EXIT__${code}`);
  };
  console.error = (...args) => {
    errors.push(args.join(' '));
  };

  try {
    await assert.rejects(
      () => runJoblog({}),
      /__EXIT__2/,
    );
    assert.equal(exitCode, 2);
    assert.match(errors.join('\n'), /--profile/);
  } finally {
    process.exit = originalExit;
    console.error = originalError;
  }
});
