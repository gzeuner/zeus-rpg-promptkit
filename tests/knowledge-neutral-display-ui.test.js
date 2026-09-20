const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildDisplayUiProjection } = require('../src/displayUi/displayUiProjection');
const {
  buildNeutralDisplayUiKnowledgeCatalog,
  extractAndPersistNeutralDisplayUiKnowledge,
} = require('../src/knowledge/extractors/displayUiPatternExtractor');
const { extractDisplayUiBatch } = require('../src/knowledge/extractors/displayUiBatchExtractor');
const { readFinalKnowledgeCatalog } = require('../src/knowledge/knowledgePipeline');
const displayUiSourceMarker = ['P', 'U', 'I'].join('');

function syntheticDisplayUiMember() {
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

test('neutral Display UI extractor emits only structural final patterns', () => {
  const projection = buildDisplayUiProjection(syntheticDisplayUiMember(), { file: 'CUSTOMER.dds' });
  const catalog = buildNeutralDisplayUiKnowledgeCatalog(projection, {
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

test('neutral Display UI extractor persists a privacy-gated final artifact', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-neutral-display-ui-'));
  try {
    const projection = buildDisplayUiProjection(syntheticDisplayUiMember(), {
      file: 'CUSTOMER.dds',
    });
    const written = extractAndPersistNeutralDisplayUiKnowledge({
      projection,
      outputRoot,
      runId: 'synthetic-display-ui-001',
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

test('neutral Display UI extractor is deterministic for the same projection', () => {
  const projection = buildDisplayUiProjection(syntheticDisplayUiMember(), { file: 'CUSTOMER.dds' });
  const options = { generatedAt: '2026-08-04T12:00:00.000Z' };
  assert.deepEqual(
    buildNeutralDisplayUiKnowledgeCatalog(projection, options),
    buildNeutralDisplayUiKnowledgeCatalog(projection, options)
  );
});

test('neutral Display UI extractor maps widget types to controlled structural categories', () => {
  const catalog = buildNeutralDisplayUiKnowledgeCatalog({
    recordFormats: [
      {
        widgets: [
          { fieldType: 'input', boundField: 'FIELD_A', staticValue: null },
          { fieldType: 'checkbox', boundField: 'FIELD_B', staticValue: null },
          { fieldType: 'error-message', boundField: null, staticValue: 'Message' },
          { fieldType: 'dialog', boundField: null, staticValue: null },
          { fieldType: 'tab', boundField: null, staticValue: null },
          { fieldType: 'button', boundField: null, staticValue: 'Run' },
        ],
      },
    ],
  });

  assert.equal(catalog.taxonomyVersion, 'draft-2');
  assert.deepEqual(
    catalog.patterns.map(pattern => pattern.kind),
    ['ui.form', 'ui.selection', 'ui.validation', 'ui.dialog', 'ui.navigation', 'ui.toolbar']
  );
  const serialized = JSON.stringify(catalog);
  assert.equal(serialized.includes('FIELD_A'), false);
  assert.equal(serialized.includes('Message'), false);
});

test('batch extraction separates the neutral catalog from the local-only inventory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-neutral-display-ui-batch-'));
  const sourceRoot = path.join(root, 'source');
  const outputRoot = path.join(root, 'general-output');
  const privateOutputRoot = path.join(root, 'private-output');
  fs.mkdirSync(path.join(sourceRoot, 'nested'), { recursive: true });
  try {
    fs.writeFileSync(
      path.join(sourceRoot, 'nested', 'synthetic.dds'),
      `${syntheticDisplayUiMember()}\n* ${displayUiSourceMarker}`,
      'utf8'
    );
    fs.writeFileSync(path.join(sourceRoot, 'ignored.dds'), 'synthetic DDS without marker', 'utf8');
    const result = extractDisplayUiBatch({
      sourceRoot,
      outputRoot,
      privateOutputRoot,
      runId: 'synthetic-batch-001',
      generatedAt: '2026-08-04T12:00:00.000Z',
    });
    assert.equal(result.fileCount, 1);
    assert.equal(fs.existsSync(result.path), true);
    assert.equal(fs.existsSync(result.privatePath), true);

    const publicCatalog = fs.readFileSync(result.path, 'utf8');
    const privateInventory = fs.readFileSync(result.privatePath, 'utf8');
    assert.equal(publicCatalog.includes('PRIVATE'), false);
    assert.equal(publicCatalog.includes('synthetic.dds'), false);
    assert.equal(privateInventory.includes('synthetic.dds'), true);
    assert.equal(privateInventory.includes('decodedProjectionIncluded'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('batch extraction rejects overlapping general and private output roots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-neutral-display-ui-overlap-'));
  const sourceRoot = path.join(root, 'source');
  fs.mkdirSync(sourceRoot, { recursive: true });
  try {
    assert.throws(
      () =>
        extractDisplayUiBatch({
          sourceRoot,
          outputRoot: path.join(root, 'output'),
          privateOutputRoot: path.join(root, 'output', 'private'),
          runId: 'synthetic-overlap-001',
        }),
      /separate, non-overlapping directories/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
