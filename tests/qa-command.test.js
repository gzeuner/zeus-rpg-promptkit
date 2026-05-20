const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  loadCanonicalAnalysis,
  normalizeFormat,
  normalizeStrict,
} = require('../src/cli/commands/qaCommand');

test('qa command validates format and strict options', () => {
  assert.equal(normalizeFormat(undefined), 'markdown');
  assert.equal(normalizeFormat('JIRA'), 'jira');
  assert.throws(() => normalizeFormat('xml'), /--format/);

  assert.equal(normalizeStrict(undefined), 'LENIENT');
  assert.equal(normalizeStrict('strict'), 'STRICT');
  assert.throws(() => normalizeStrict('hard'), /--strict/);
});

test('qa command loads canonical-analysis.json from directory and file path', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-qa-command-'));
  const payload = { kind: 'canonical-analysis', entities: {}, relations: [] };
  const filePath = path.join(tempDir, 'canonical-analysis.json');
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  try {
    assert.deepEqual(loadCanonicalAnalysis(tempDir), payload);
    assert.deepEqual(loadCanonicalAnalysis(filePath), payload);
    assert.throws(() => loadCanonicalAnalysis(path.join(tempDir, 'missing')), /Input path not found/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
