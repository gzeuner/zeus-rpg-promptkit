const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readAnalysisRun } = require('../src/ui/localUiDataApi');
const { writeTestDataIndex } = require('../src/db2/testDataExportService');

function writeTestDataRun(programOutputDir, payload) {
  fs.mkdirSync(programOutputDir, { recursive: true });
  fs.writeFileSync(
    path.join(programOutputDir, 'context.json'),
    JSON.stringify({ program: 'ORDERPGM' })
  );
  fs.writeFileSync(path.join(programOutputDir, 'test-data.json'), JSON.stringify(payload));
  writeTestDataIndex(programOutputDir, payload, {
    status: 'exported',
    tableCount: payload.tables.length,
    requestedTableCount: payload.tables.length,
    skippedTableCount: 0,
  });
  const artifacts = ['context.json', 'test-data.json', 'test-data-index.json'].map(fileName => {
    const content = fs.readFileSync(path.join(programOutputDir, fileName));
    return {
      path: fileName,
      kind: 'json',
      sizeBytes: content.length,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
    };
  });
  fs.writeFileSync(
    path.join(programOutputDir, 'analyze-run-manifest.json'),
    JSON.stringify({
      run: { status: 'succeeded' },
      inputs: { options: {}, sourceSnapshot: { fileCount: 0 } },
      artifacts,
    })
  );
}

test('readAnalysisRun scans its artifact directory once', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-local-ui-scan-'));
  const programOutputDir = path.join(outputRoot, 'ORDERPGM');
  fs.mkdirSync(programOutputDir, { recursive: true });
  fs.writeFileSync(
    path.join(programOutputDir, 'analyze-run-manifest.json'),
    JSON.stringify({
      run: { status: 'succeeded' },
      inputs: { options: {}, sourceSnapshot: { fileCount: 0 } },
      artifacts: [],
    })
  );
  fs.writeFileSync(path.join(programOutputDir, 'context.json'), '{"program":"ORDERPGM"}');
  const originalReaddirSync = fs.readdirSync;
  let scans = 0;
  try {
    fs.readdirSync = function trackedReaddirSync(directory, ...args) {
      if (path.resolve(String(directory)) === programOutputDir) scans += 1;
      return originalReaddirSync.call(this, directory, ...args);
    };
    const run = readAnalysisRun(outputRoot, 'ORDERPGM');
    assert.equal(scans, 1);
    assert.equal(run.summary.artifactCount, run.artifacts.length);
    assert.equal(run.workflowRunCard.scope.artifactCount, run.artifacts.length);
  } finally {
    fs.readdirSync = originalReaddirSync;
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('DB2 graph view retains both node types when an id is shared', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-local-ui-graph-'));
  const programOutputDir = path.join(outputRoot, 'ORDERPGM');
  fs.mkdirSync(programOutputDir, { recursive: true });
  fs.writeFileSync(
    path.join(programOutputDir, 'analyze-run-manifest.json'),
    JSON.stringify({
      run: { status: 'succeeded' },
      inputs: { options: {}, sourceSnapshot: { fileCount: 0 } },
      artifacts: [],
    })
  );
  fs.writeFileSync(path.join(programOutputDir, 'context.json'), '{"program":"ORDERPGM"}');
  fs.writeFileSync(
    path.join(programOutputDir, 'program-call-tree.json'),
    JSON.stringify({
      rootProgram: 'ORDERPGM',
      nodes: [
        { id: 'ORDERPGM', type: 'PROGRAM' },
        { id: 'SHARED', type: 'TABLE' },
        { id: 'SHARED', type: 'PROGRAM' },
      ],
      edges: [{ from: 'ORDERPGM', to: 'SHARED', type: 'REFERENCE' }],
    })
  );
  try {
    const run = readAnalysisRun(outputRoot, 'ORDERPGM');
    const root = run.views.graph.nodes.find(node => node.id === 'ORDERPGM');
    assert.deepEqual(root.connectedTableIds, ['SHARED']);
    assert.deepEqual(root.connectedProgramIds, ['SHARED']);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('DB2 view uses the verified compact index without parsing sample rows', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-local-ui-index-'));
  const programOutputDir = path.join(outputRoot, 'ORDERPGM');
  writeTestDataRun(programOutputDir, {
    program: 'ORDERPGM',
    rowLimit: 50,
    tables: [
      {
        schema: 'APP',
        table: 'CUSTOMERS',
        status: 'exported',
        rowCount: 25,
        rows: [{ EMAIL: 'private@example.test' }],
        policyDecision: { eligibility: 'allowed', maskedColumns: ['EMAIL'] },
        sourceLink: { matchStatus: 'resolved', sourceEvidence: [{ path: 'CUSTOMERS.rpgle' }] },
      },
    ],
  });
  const dataPath = path.join(programOutputDir, 'test-data.json');
  const originalReadFileSync = fs.readFileSync;
  let textReadsOfTestData = 0;
  try {
    fs.readFileSync = function trackedReadFileSync(filePath, ...args) {
      if (path.resolve(String(filePath)) === dataPath && args[0] === 'utf8') {
        textReadsOfTestData += 1;
      }
      return originalReadFileSync.call(this, filePath, ...args);
    };
    const run = readAnalysisRun(outputRoot, 'ORDERPGM');
    const table = run.views.db2.tables.find(entry => entry.qualifiedName === 'APP.CUSTOMERS');
    assert.equal(textReadsOfTestData, 0);
    assert.equal(table.sampleRowCount, 25);
    assert.equal(table.maskedColumnCount, 1);
    assert.equal(table.sourceEvidenceCount, 1);
    assert.ok(table.relatedArtifactPaths.includes('test-data-index.json'));
  } finally {
    fs.readFileSync = originalReadFileSync;
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('DB2 view reads full data when its recorded hash is stale', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-local-ui-stale-'));
  const programOutputDir = path.join(outputRoot, 'ORDERPGM');
  const payload = {
    program: 'ORDERPGM',
    tables: [
      { schema: 'APP', table: 'CUSTOMERS', status: 'exported', rowCount: 1, rows: [{ ID: 1 }] },
    ],
  };
  writeTestDataRun(programOutputDir, payload);
  fs.writeFileSync(
    path.join(programOutputDir, 'test-data.json'),
    JSON.stringify({
      ...payload,
      tables: [
        { schema: 'APP', table: 'CUSTOMERS', status: 'exported', rows: [{ ID: 1 }, { ID: 2 }] },
      ],
    })
  );
  try {
    const run = readAnalysisRun(outputRoot, 'ORDERPGM');
    const table = run.views.db2.tables.find(entry => entry.qualifiedName === 'APP.CUSTOMERS');
    assert.equal(table.sampleRowCount, 2);
    assert.equal(
      run.views.evidence.entries.find(entry => entry.path === 'test-data.json').hashStatus,
      'changed'
    );
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});
