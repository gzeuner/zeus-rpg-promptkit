const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../src/cli/commands/knowledgeCommand');

function member() {
  const json = JSON.stringify({
    'record format name': 'PRIVATE_RECORD',
    items: [
      {
        'field type': 'grid',
        id: 'PRIVATE_GRID',
        'number of columns': '1',
        'column headings': 'Private',
      },
      { grid: 'PRIVATE_GRID', column: '1', id: 'PRIVATE_FIELD', 'field name': 'PRIVATE_FIELD' },
    ],
  });
  return `A                                      1  2HTML('${json}')`;
}

test('knowledge CLI extracts, validates, and inspects a neutral catalog', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-knowledge-cli-'));
  const source = path.join(root, 'PRIVATE.dds');
  const output = path.join(root, 'output');
  fs.writeFileSync(source, member(), 'utf8');
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    const extracted = await run({
      _: ['extract'],
      mode: 'ui-patterns',
      file: source,
      out: output,
      'run-id': 'synthetic-cli-001',
    });
    assert.equal(extracted.ok, true);
    assert.equal(extracted.patternCount, 1);
    assert.equal(fs.existsSync(extracted.path), true);

    const validated = await run({ _: ['validate'], input: extracted.path, json: true });
    assert.equal(validated.ok, true);
    assert.equal(validated.status, 'ready');

    const inspected = await run({ _: ['inspect'], input: extracted.path, json: true });
    assert.equal(inspected.ok, true);
    assert.equal(inspected.catalog.patterns[0].kind, 'ui.grid');
    assert.equal(JSON.stringify(inspected).includes('PRIVATE'), false);
  } finally {
    process.exitCode = previousExitCode;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('knowledge CLI fails closed for unsupported extraction modes', async () => {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    const result = await run({ _: ['extract'], mode: 'dddl' });
    assert.equal(result.ok, false);
    assert.match(result.reason, /ui-patterns/);
    assert.equal(process.exitCode, 2);
  } finally {
    process.exitCode = previousExitCode;
  }
});
