const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  runAnalyzeArtifactAdapter,
  runAnalyzeCore,
} = require('../src/analyze/analyzePipeline');

test('analyze core can run without artifact writes and the writer adapter can be applied afterwards', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-analyze-runtime-'));
  const sourceRoot = path.join(tempRoot, 'src');
  const outputRoot = path.join(tempRoot, 'output');
  const outputProgramDir = path.join(outputRoot, 'ORDERPGM');

  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(outputProgramDir, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'ORDERPGM.rpgle'), '**FREE\nCALL SUBPGM;\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, 'SUBPGM.rpgle'), '**FREE\nDCL-F ORDERS DISK;\n', 'utf8');

  try {
    const coreResult = runAnalyzeCore({
      program: 'ORDERPGM',
      sourceRoot,
      outputRoot,
      config: {
        extensions: ['.rpgle'],
        contextOptimizer: {},
        testData: { limit: 10, maskColumns: [] },
        db: null,
      },
      testDataLimit: 10,
      skipTestData: true,
      verbose: false,
      optimizeContextEnabled: false,
      logVerbose() {},
    });

    assert.equal(Array.isArray(coreResult.generatedFiles), false);
    assert.equal(coreResult.stageReports.some((stage) => stage.id === 'write-artifacts'), false);
    assert.equal(coreResult.context.analysisCache.sourceScan.misses, 2);
    assert.equal(coreResult.cacheStatus.sourceScan.misses, 2);
    assert.equal(fs.existsSync(path.join(outputProgramDir, 'report.md')), false);

    const writtenResult = runAnalyzeArtifactAdapter({
      ...coreResult,
      outputRoot,
      outputProgramDir,
      emitDiagnostics: true,
    });

    assert.ok(Array.isArray(writtenResult.generatedFiles));
    assert.ok(writtenResult.generatedFiles.includes('report.md'));
    assert.ok(writtenResult.generatedFiles.includes('analysis-diagnostics.json'));
    assert.equal(writtenResult.stageReports.some((stage) => stage.id === 'write-artifacts'), true);
    assert.equal(fs.existsSync(path.join(outputProgramDir, 'report.md')), true);
    assert.equal(fs.existsSync(path.join(outputProgramDir, 'analysis-diagnostics.json')), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
