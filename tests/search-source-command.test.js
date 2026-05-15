const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runSearchSource } = require('../src/cli/commands/searchSourceCommand');

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
