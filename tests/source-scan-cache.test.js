const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createSourceScanCache } = require('../src/scanner/sourceScanCache');
const { scanSourceFiles } = require('../src/scanner/rpgScanner');
const { runAnalyzePipeline } = require('../src/analyze/analyzePipeline');

test('source scan cache reuses unchanged file scans and invalidates on file changes', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-scan-cache-'));
  const sourceFile = path.join(tempRoot, 'ORDERPGM.rpgle');
  fs.writeFileSync(sourceFile, '**FREE\nCALL INVPGM;\n', 'utf8');

  let scanCount = 0;
  const cache = createSourceScanCache();
  const scanFn = (filePath) => {
    scanCount += 1;
    return {
      sourceFile: { path: filePath, sizeBytes: fs.statSync(filePath).size, lines: 2 },
      tables: [],
      calls: [],
      copyMembers: [],
      sqlStatements: [],
      notes: [],
    };
  };

  cache.getOrScan(sourceFile, scanFn);
  cache.getOrScan(sourceFile, scanFn);
  assert.equal(scanCount, 1);
  assert.deepEqual(cache.getStats(), {
    requests: 2,
    hits: 1,
    misses: 1,
    invalidations: 0,
    entryCount: 1,
  });

  const futureTime = new Date(Date.now() + 2000);
  fs.writeFileSync(sourceFile, '**FREE\nCALL INVPGM;\nCALL SUBPGM;\n', 'utf8');
  fs.utimesSync(sourceFile, futureTime, futureTime);
  cache.getOrScan(sourceFile, scanFn);

  assert.equal(scanCount, 2);
  assert.deepEqual(cache.getStats(), {
    requests: 3,
    hits: 1,
    misses: 2,
    invalidations: 1,
    entryCount: 1,
  });

  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('analyze pipeline reuses scan results during cross-program graph traversal', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-analyze-scan-cache-'));
  const sourceRoot = path.join(tempRoot, 'src');
  const outputRoot = path.join(tempRoot, 'output');
  const outputProgramDir = path.join(outputRoot, 'ROOTPGM');

  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(outputProgramDir, { recursive: true });

  fs.writeFileSync(path.join(sourceRoot, 'ROOTPGM.rpgle'), '**FREE\nCALL SUBPGM;\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, 'SUBPGM.rpgle'), '**FREE\nDCL-F ORDERS DISK;\n', 'utf8');

  const result = runAnalyzePipeline({
    program: 'ROOTPGM',
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
  const buildContextStage = result.stageReports.find((stage) => stage.id === 'build-context');

  assert.ok(collectStage);
  assert.ok(buildContextStage);
  assert.equal(collectStage.metadata.scanCache.misses, 2);
  assert.equal(collectStage.metadata.scanCache.hits, 0);
  assert.ok(buildContextStage.metadata.scanCache.hits >= 2);
  assert.equal(buildContextStage.metadata.scanCache.entryCount, 2);

  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('scanSourceFiles can use a shared cache without changing aggregate results', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-scan-cache-aggregate-'));
  const sourceFile = path.join(tempRoot, 'ORDERPGM.rpgle');
  fs.writeFileSync(sourceFile, '**FREE\nDCL-F ORDERS DISK;\nCALL INVPGM;\n', 'utf8');

  const scanCache = createSourceScanCache();
  const first = scanSourceFiles([sourceFile], { scanCache });
  const second = scanSourceFiles([sourceFile], { scanCache });

  assert.deepEqual(first, second);
  assert.equal(scanCache.getStats().hits, 1);

  fs.rmSync(tempRoot, { recursive: true, force: true });
});
