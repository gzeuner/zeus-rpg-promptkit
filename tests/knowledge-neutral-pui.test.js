const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildPuiProjection } = require('../src/pui/puiProjection');
const {
  buildNeutralPuiKnowledgeCatalog,
  extractAndPersistNeutralPuiKnowledge,
} = require('../src/knowledge/extractors/puiPatternExtractor');
const { readFinalKnowledgeCatalog } = require('../src/knowledge/knowledgePipeline');

function syntheticPuiMember() {
  const json = JSON.stringify({
    'record format name': 'CUSTOMER_RECORD_FORMAT',
    items: [
      {
        'field type': 'grid',
        id: 'CUSTOMER_GRID',
        'number of columns': '2',
        'column headings': 'Customer Name,Secret Status',
        'column widths': '20,10',
      },
      {
        grid: 'CUSTOMER_GRID',
        column: '1',
        id: 'CUSTOMER_NAME_FIELD',
        'field name': 'CUSTOMER_NAME',
        'field type': 'output field',
        tooltip: 'Customer label',
      },
      {
        grid: 'CUSTOMER_GRID',
        column: '2',
        id: 'CUSTOMER_STATUS_FIELD',
        'field name': 'CUSTOMER_STATUS',
        'field type': 'output field',
        tooltip: 'Internal status',
      },
    ],
  });
  return `A                                      1  2HTML('${json}')`;
}

test('neutral PUI extractor emits only structural final patterns', () => {
  const projection = buildPuiProjection(syntheticPuiMember(), { file: 'CUSTOMER.dds' });
  const catalog = buildNeutralPuiKnowledgeCatalog(projection, {
    generatedAt: '2026-08-04T12:00:00.000Z',
  });
  const serialized = JSON.stringify(catalog);

  assert.equal(catalog.patterns.length, 1);
  assert.equal(catalog.patterns[0].kind, 'ui.grid');
  assert.equal(catalog.patterns[0].evidenceSummary.boundColumnCount, 2);
  assert.equal(serialized.includes('CUSTOMER'), false);
  assert.equal(serialized.includes('Secret Status'), false);
  assert.equal(serialized.includes('Customer label'), false);
});

test('neutral PUI extractor persists a privacy-gated final artifact', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-neutral-pui-'));
  try {
    const projection = buildPuiProjection(syntheticPuiMember(), { file: 'CUSTOMER.dds' });
    const written = extractAndPersistNeutralPuiKnowledge({
      projection,
      outputRoot,
      runId: 'synthetic-pui-001',
      generatedAt: '2026-08-04T12:00:00.000Z',
    });
    const read = readFinalKnowledgeCatalog({ catalogPath: written.path });
    assert.equal(read.available, true);
    assert.equal(read.status, 'ready');
    assert.equal(read.catalog.patterns[0].privacyAssessment.status, 'passed');
    assert.equal(fs.existsSync(path.join(outputRoot, 'knowledge-work')), false);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('neutral PUI extractor is deterministic for the same projection', () => {
  const projection = buildPuiProjection(syntheticPuiMember(), { file: 'CUSTOMER.dds' });
  const options = { generatedAt: '2026-08-04T12:00:00.000Z' };
  assert.deepEqual(
    buildNeutralPuiKnowledgeCatalog(projection, options),
    buildNeutralPuiKnowledgeCatalog(projection, options)
  );
});
