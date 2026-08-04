const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createFinalKnowledgeCatalog } = require('../src/knowledge/final/finalKnowledgeCatalog');
const {
  finalCatalogPath,
  persistFinalKnowledgeCatalog,
  readFinalKnowledgeCatalog,
} = require('../src/knowledge/knowledgePipeline');

function genericCatalog() {
  return createFinalKnowledgeCatalog({
    generatedAt: '2026-08-04T12:00:00.000Z',
    generatorVersion: '0.2.0',
    patterns: [
      {
        id: 'pattern-grid',
        kind: 'ui.grid',
        domain: 'ui',
        technology: ['ui-framework'],
        features: ['row-selection'],
        elements: [{ role: 'grid', intent: 'list-records' }],
        confidence: { level: 'high', score: 0.9 },
        evidenceSummary: { category: 'ui-structure' },
        privacyAssessment: { status: 'passed' },
        limitations: ['synthetic fixture'],
      },
    ],
  });
}

test('pipeline persists only a privacy-gated final catalog at the documented path', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-knowledge-pipeline-'));
  try {
    const result = persistFinalKnowledgeCatalog({
      outputRoot,
      runId: 'synthetic-run-001',
      catalog: genericCatalog(),
    });
    const expectedPath = finalCatalogPath(outputRoot, 'synthetic-run-001');
    assert.equal(result.path, expectedPath);
    assert.deepEqual(JSON.parse(fs.readFileSync(expectedPath, 'utf8')), result.catalog);
    assert.equal(fs.existsSync(path.join(outputRoot, 'knowledge-work')), false);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('pipeline fails closed and does not create output for rejected catalog', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-knowledge-pipeline-'));
  try {
    const catalog = genericCatalog();
    catalog.patterns[0].features.push('/home/customer/private/source');
    assert.throws(
      () => persistFinalKnowledgeCatalog({ outputRoot, runId: 'synthetic-run-002', catalog }),
      error => error && error.code === 'KNOWLEDGE_PRIVACY_GATE_REJECTED'
    );
    assert.equal(fs.existsSync(path.join(outputRoot, 'knowledge')), false);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('pipeline rejects path traversal in run identifiers', () => {
  assert.throws(
    () => finalCatalogPath(os.tmpdir(), '../unsafe'),
    /runId must contain only letters/
  );
});

test('read-only catalog loader returns a validated final catalog', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-knowledge-reader-'));
  try {
    const written = persistFinalKnowledgeCatalog({
      outputRoot,
      runId: 'synthetic-read-001',
      catalog: genericCatalog(),
    });
    const result = readFinalKnowledgeCatalog({ catalogPath: written.path });
    assert.equal(result.available, true);
    assert.equal(result.status, 'ready');
    assert.deepEqual(result.catalog, written.catalog);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('read-only catalog loader fails closed for privacy-invalid JSON', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-knowledge-reader-'));
  const targetPath = finalCatalogPath(outputRoot, 'synthetic-read-002');
  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const catalog = genericCatalog();
    catalog.patterns[0].features.push('APPDATA.ORDERHDR');
    fs.writeFileSync(targetPath, JSON.stringify(catalog), 'utf8');
    const result = readFinalKnowledgeCatalog({ catalogPath: targetPath });
    assert.equal(result.available, false);
    assert.equal(result.status, 'failed');
    assert.ok(result.reasons.includes('SQL_OBJECT_NAME'));
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('read-only catalog loader requires the final artifact filename', () => {
  assert.throws(
    () => readFinalKnowledgeCatalog({ catalogPath: path.join(os.tmpdir(), 'catalog.json') }),
    /catalogPath must point to project-neutral-knowledge.json/
  );
});
