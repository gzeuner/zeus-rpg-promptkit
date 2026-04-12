const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runAnalyzePipeline } = require('../src/analyze/analyzePipeline');

test('analyze pipeline normalizes BOM-marked and UTF-16 sources into a consistent scan contract', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-source-normalization-'));
  const sourceRoot = path.join(tempRoot, 'src');
  const outputRoot = path.join(tempRoot, 'output');
  const outputProgramDir = path.join(outputRoot, 'ORDERPGM');

  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(outputProgramDir, { recursive: true });

  const rootFile = path.join(sourceRoot, 'ORDERPGM.rpgle');
  const calleeFile = path.join(sourceRoot, 'INVPGM.rpgle');

  fs.writeFileSync(
    rootFile,
    Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('**FREE\r\nCALL INVPGM;\r\n', 'utf8'),
    ]),
  );
  fs.writeFileSync(
    calleeFile,
    Buffer.from('\ufeff**FREE\r\nDCL-F ORDERS DISK;\r\n', 'utf16le'),
  );

  try {
    const result = runAnalyzePipeline({
      program: 'ORDERPGM',
      sourceRoot,
      outputRoot,
      outputProgramDir,
      config: {
        extensions: ['.rpgle'],
        contextOptimizer: {},
        testData: { limit: 25, maskColumns: [] },
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
    assert.equal(collectStage.metadata.scannableSourceFileCount, 2);
    assert.equal(collectStage.metadata.sourceNormalization.convertedEncodingCount, 1);
    assert.equal(collectStage.metadata.sourceNormalization.bomRemovedCount, 2);
    assert.equal(collectStage.metadata.sourceNormalization.normalizedLineEndingCount, 2);
    assert.ok(collectStage.diagnostics.some((entry) => entry.code === 'SOURCE_ENCODING_CONVERTED'));
    assert.ok(collectStage.diagnostics.some((entry) => entry.code === 'SOURCE_BOM_REMOVED'));
    assert.ok(collectStage.diagnostics.some((entry) => entry.code === 'SOURCE_LINE_ENDINGS_NORMALIZED'));

    assert.deepEqual(
      result.context.dependencies.programCalls.map((entry) => entry.name),
      ['INVPGM'],
    );
    const sourceFiles = result.context.sourceFiles.reduce((acc, entry) => {
      acc[entry.path] = entry;
      return acc;
    }, {});
    assert.equal(sourceFiles['ORDERPGM.rpgle'].normalization.status, 'normalized');
    assert.equal(sourceFiles['INVPGM.rpgle'].normalization.status, 'converted');
    assert.equal(sourceFiles['INVPGM.rpgle'].normalization.detectedEncoding, 'UTF-16LE');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
