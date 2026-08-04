const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createFinalKnowledgeCatalog } = require('../src/knowledge/final/finalKnowledgeCatalog');
const {
  finalCatalogPath,
  persistFinalKnowledgeCatalog,
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
