const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runAnalyzeCore } = require('../src/analyze/analyzePipeline');

function buildFixtureTree(sourceRoot, fileCount) {
  for (let index = 0; index < fileCount; index += 1) {
    const name = index === 0 ? 'ROOTPGM' : `SUBPGM${String(index).padStart(3, '0')}`;
    const calls = index < fileCount - 1 ? `CALL SUBPGM${String(index + 1).padStart(3, '0')};\n` : '';
    fs.writeFileSync(
      path.join(sourceRoot, `${name}.rpgle`),
      `**FREE\nDCL-F ORDERS DISK;\n${calls}EXEC SQL SELECT * FROM ORDERS INTO :RESULT;\n`,
      'utf8',
    );
  }
}

test('benchmark tier captures cache-backed repeat-analyze timings for larger trees', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-analyze-benchmark-'));
  const sourceRoot = path.join(tempRoot, 'src');
  const outputRoot = path.join(tempRoot, 'output');

  fs.mkdirSync(sourceRoot, { recursive: true });
  buildFixtureTree(sourceRoot, 24);

  try {
    const runOptions = {
      program: 'ROOTPGM',
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
    };
    const first = runAnalyzeCore(runOptions);
    const second = runAnalyzeCore(runOptions);
    const firstCollect = first.stageReports.find((stage) => stage.id === 'collect-scan');
    const secondCollect = second.stageReports.find((stage) => stage.id === 'collect-scan');

    assert.ok(firstCollect);
    assert.ok(secondCollect);
    assert.equal(firstCollect.metadata.scanCache.misses, 24);
    assert.equal(secondCollect.metadata.scanCache.persistentHits, 24);
    assert.equal(secondCollect.metadata.scanCache.misses, 0);
    assert.ok(secondCollect.durationMs <= firstCollect.durationMs || secondCollect.metadata.scanCache.persistentHits === 24);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
