const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runAnalyzePipeline } = require('../src/analyze/analyzePipeline');

test('analyze pipeline classifies CL and DDS sources and emits source-type-specific findings', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-source-type-scan-'));
  const sourceRoot = path.join(tempRoot, 'src');
  const outputRoot = path.join(tempRoot, 'output');
  const outputProgramDir = path.join(outputRoot, 'ROOTCL');

  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(outputProgramDir, { recursive: true });

  fs.writeFileSync(path.join(sourceRoot, 'ROOTCL.clle'), [
    'PGM',
    'DCLF FILE(ORDERS)',
    'OVRDBF FILE(ORDERS) TOFILE(APPLIB/ORDERSH)',
    'CALL PGM(INVPGM)',
    'ENDPGM',
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(sourceRoot, 'SCREEN.dspf'), [
    'A          R SCREEN01',
    'A                                      CA03',
    '',
  ].join('\n'), 'utf8');

  try {
    const result = runAnalyzePipeline({
      program: 'ROOTCL',
      sourceRoot,
      outputRoot,
      outputProgramDir,
      config: {
        extensions: ['.clle', '.dspf'],
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
    assert.equal(collectStage.metadata.sourceTypeSummary.byType.CLLE, 1);
    assert.equal(collectStage.metadata.sourceTypeSummary.byType.DSPF, 1);
    assert.ok(collectStage.metadata.commandCount >= 4);
    assert.ok(collectStage.metadata.objectUsageCount >= 2);
    assert.equal(collectStage.metadata.ddsFileCount, 1);

    assert.deepEqual(
      result.context.dependencies.programCalls.map((entry) => entry.name),
      ['INVPGM'],
    );
    assert.deepEqual(
      result.context.dependencies.tables.map((entry) => entry.name),
      ['ORDERS', 'ORDERSH'],
    );
    assert.ok(result.context.sourceTypeAnalysis.commands.some((entry) => entry.command === 'CALL'));
    assert.ok(result.context.sourceTypeAnalysis.objectUsages.some((entry) => entry.name === 'ORDERSH' && entry.objectType === 'FILE'));
    assert.deepEqual(
      result.context.sourceTypeAnalysis.ddsFiles.map((entry) => ({
        name: entry.name,
        kind: entry.kind,
        recordFormats: entry.recordFormats,
      })),
      [{
        name: 'SCREEN',
        kind: 'WORKSTN',
        recordFormats: ['SCREEN01'],
      }],
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
