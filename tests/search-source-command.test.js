const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runSearchSource } = require('../src/cli/commands/searchSourceCommand');
const { executeSearchSource } = require('../src/core/searchSourceService');

function captureConsoleLogs(fn) {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(' '));
  };

  return Promise.resolve()
    .then(() => fn())
    .then(() => logs)
    .finally(() => {
      console.log = originalLog;
    });
}

test('search-source finds matches in synthetic source files', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-search-source-'));

  try {
    fs.writeFileSync(
        path.join(tempDir, 'PROGRAM_001.rpgle'),
        [
          '**FREE',
          'dcl-s id int(10);',
          'exec sql SELECT * FROM TABLE_A;',
        ].join('\n'),
        'utf8',
      );

    const logs = await captureConsoleLogs(() => runSearchSource({
      'source-root': tempDir,
      'search-term': 'SELECT',
      'file-pattern': '*.rpgle',
      'max-results': '10',
    }));

    const output = logs.join('\n');
    assert.match(output, /PROGRAM_001\.rpgle/);
    assert.match(output, /SELECT \* FROM TABLE_A/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('search-source service reports no source files for unmatched pattern', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-search-source-empty-'));
  try {
    const execution = await executeSearchSource({
      'source-root': tempDir,
      'search-term': 'SELECT',
      'file-pattern': '*.rpgle',
    });

    assert.equal(execution.noSourceFiles, true);
    assert.deepEqual(execution.results, []);
    assert.equal(execution.filePattern, '*.rpgle');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('search-source exits with code 2 when no criteria are provided', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-search-source-args-'));
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
      () => runSearchSource({
        'source-root': tempDir,
      }),
      /__EXIT__2/,
    );
    assert.equal(exitCode, 2);
    assert.match(errors.join('\n'), /Provide at least one search criterion/);
  } finally {
    process.exit = originalExit;
    console.error = originalError;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
