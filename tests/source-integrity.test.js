const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runAnalyzePipeline } = require('../src/analyze/analyzePipeline');
const { writeImportManifest } = require('../src/fetch/importManifest');

test('analyze pipeline validates malformed source files before scanning', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-source-integrity-'));
  const sourceRoot = path.join(tempRoot, 'src');
  const outputRoot = path.join(tempRoot, 'output');
  const outputProgramDir = path.join(outputRoot, 'ORDERPGM');

  fs.mkdirSync(path.join(sourceRoot, 'QRPGLESRC'), { recursive: true });
  fs.mkdirSync(outputProgramDir, { recursive: true });

  const validFile = path.join(sourceRoot, 'QRPGLESRC', 'ORDERPGM.rpgle');
  const invalidFile = path.join(sourceRoot, 'QRPGLESRC', 'BROKEN.rpgle');

  fs.writeFileSync(validFile, '**FREE\nDCL-F ORDERS DISK;\nCALL INVPGM;\n', 'utf8');
  fs.writeFileSync(invalidFile, Buffer.from([0xc3, 0x28]));

  writeImportManifest(sourceRoot, {
    schemaVersion: 1,
    tool: { name: 'zeus-rpg-promptkit', command: 'fetch' },
    fetchedAt: '2026-03-19T00:00:00.000Z',
    remote: { host: 'myibmi.example.com', sourceLib: 'SOURCEN', ifsDir: '/home/zeus/rpg_sources' },
    localDestination: sourceRoot,
    transportRequested: 'sftp',
    transportUsed: 'sftp',
    streamFileCcsid: 1208,
    encodingPolicy: 'UTF-8 stream files (CCSID 1208)',
    summary: {
      exportedSuccess: 2,
      exportedTotal: 2,
      downloadedCount: 2,
      fileCount: 2,
      invalidFileCount: 0,
      warningCount: 0,
    },
    files: [
      {
        sourceLib: 'SOURCEN',
        sourceFile: 'QRPGLESRC',
        member: 'ORDERPGM',
        remotePath: '/home/zeus/rpg_sources/QRPGLESRC/ORDERPGM.rpgle',
        localPath: 'QRPGLESRC/ORDERPGM.rpgle',
        exported: true,
        fallbackUsed: false,
        messages: [],
        stderr: '',
        exists: true,
        sizeBytes: fs.statSync(validFile).size,
        sha256: 'mismatch-on-purpose',
        utf8Valid: true,
        newlineStyle: 'LF',
        validationStatus: 'ok',
        validationMessages: [],
      },
      {
        sourceLib: 'SOURCEN',
        sourceFile: 'QRPGLESRC',
        member: 'BROKEN',
        remotePath: '/home/zeus/rpg_sources/QRPGLESRC/BROKEN.rpgle',
        localPath: 'QRPGLESRC/BROKEN.rpgle',
        exported: true,
        fallbackUsed: false,
        messages: [],
        stderr: '',
        exists: true,
        sizeBytes: fs.statSync(invalidFile).size,
        sha256: 'also-mismatch',
        utf8Valid: true,
        newlineStyle: 'LF',
        validationStatus: 'ok',
        validationMessages: [],
      },
    ],
    notes: [],
  });

  const result = runAnalyzePipeline({
    program: 'ORDERPGM',
    sourceRoot,
    outputRoot,
    outputProgramDir,
    config: {
      extensions: ['.rpgle'],
      contextOptimizer: {},
      testData: { limit: 50, maskColumns: [] },
      db: null,
    },
    testDataLimit: 25,
    skipTestData: true,
    verbose: false,
    optimizeContextEnabled: false,
    logVerbose() {},
  });

  const collectStage = result.stageReports.find((stage) => stage.id === 'collect-scan');
  assert.ok(collectStage);
  assert.equal(collectStage.metadata.sourceFileCount, 2);
  assert.equal(collectStage.metadata.scannableSourceFileCount, 1);
  assert.equal(collectStage.metadata.invalidSourceFileCount, 1);
  assert.equal(collectStage.metadata.importManifestFound, true);
  assert.ok(
    collectStage.diagnostics.some((entry) => entry.code === 'INVALID_UTF8'),
    'expected INVALID_UTF8 diagnostic',
  );
  assert.ok(
    collectStage.diagnostics.some((entry) => entry.code === 'SOURCE_CHANGED_SINCE_IMPORT'),
    'expected checksum drift diagnostic',
  );
  assert.equal(result.scanSummary.sourceFiles.length, 1);
  assert.equal(result.context.program, 'ORDERPGM');
  assert.ok(result.notes.some((note) => note.includes('Invalid UTF-8 source encoding detected')));
  assert.equal(result.sourceFiles.length, 2);
  assert.equal(result.scannableSourceFiles.length, 1);

  fs.rmSync(tempRoot, { recursive: true, force: true });
});
