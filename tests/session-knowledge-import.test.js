'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  previewSessionKnowledge,
  importSessionKnowledge,
} = require('../src/knowledge/sessionKnowledgeImport');

function workspace() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-session-import-'));
  fs.writeFileSync(
    path.join(cwd, 'session.md'),
    '# Hypothesis\nAn unverified guess.\n# Validated solution\nUse the explicit source scope.\n\n```sh\nrm -rf ignored\n```\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(cwd, 'session.html'),
    '<script>DO_NOT_IMPORT</script><h2>Observation</h2><p>password=TOPSECRET</p><p>Plain note</p>',
    'utf8'
  );
  return cwd;
}

function options(cwd) {
  return {
    cwd,
    files: ['session.md', 'session.html'],
    sessionId: 'session-demo',
    scope: { projectId: 'demo', systemAlias: 'test', toolVersion: '0.3.0' },
  };
}

test('Markdown and HTML import is passive, bounded, redacted and sensitive-local', () => {
  const cwd = workspace();
  try {
    const preview = previewSessionKnowledge(options(cwd));
    assert.equal(preview.readOnly, true);
    assert.equal(fs.existsSync(path.join(cwd, '.zeus')), false);
    assert.doesNotMatch(JSON.stringify(preview), /TOPSECRET|DO_NOT_IMPORT|rm -rf/);
    assert.ok(preview.candidate.sources.every(source => source.parserVersion && source.sha256));
    assert.ok(preview.candidate.chunks.every(chunk => chunk.span.startLine > 0));
    assert.equal(preview.candidate.status, 'needs-review');
    assert.equal(preview.candidate.privacy, 'sensitive-local');
    assert.equal(preview.candidate.authority, 'advisory');

    const imported = importSessionKnowledge(options(cwd));
    assert.equal(importSessionKnowledge(options(cwd)).duplicate, true);
    assert.equal(imported.candidate.candidateId, preview.candidate.candidateId);
    assert.equal(imported.candidateHash.length, 64);
    const artifact = fs.readFileSync(path.join(cwd, imported.path), 'utf8');
    assert.doesNotMatch(artifact, /TOPSECRET|DO_NOT_IMPORT|rm -rf/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('session import rejects traversal, oversized sets and unselected content', () => {
  const cwd = workspace();
  try {
    assert.throws(() => previewSessionKnowledge({ ...options(cwd), files: ['../escape.md'] }));
    assert.throws(() => previewSessionKnowledge({ ...options(cwd), files: ['.local/session.md'] }));
    assert.throws(() =>
      previewSessionKnowledge({ ...options(cwd), files: Array(9).fill('session.md') })
    );
    assert.throws(() =>
      previewSessionKnowledge({
        ...options(cwd),
        files: ['session.md', 'session.html', 'package.json'],
      })
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('knowledge CLI exposes explicit session preview and import only', () => {
  const cwd = workspace();
  try {
    const cliPath = path.resolve(__dirname, '../cli/zeus.js');
    const args = [
      cliPath,
      'knowledge',
      'preview-session',
      '--file',
      'session.md,session.html',
      '--session-id',
      'session-demo',
      '--project',
      'demo',
      '--system-alias',
      'test',
      '--tool-version',
      '0.3.0',
      '--json',
    ];
    const preview = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(JSON.parse(preview.stdout).readOnly, true);
    assert.equal(fs.existsSync(path.join(cwd, '.zeus')), false);

    const imported = spawnSync(
      process.execPath,
      [...args.slice(0, 2), 'import-session', ...args.slice(3)],
      { cwd, encoding: 'utf8' }
    );
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(JSON.parse(imported.stdout).operation, 'session-import');
    assert.equal(fs.existsSync(path.join(cwd, '.zeus/session-imports')), true);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
