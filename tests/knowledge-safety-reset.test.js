const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runAnalyzeCore } = require('../src/analyze/analyzePipeline');

test('runAnalyzeCore does not auto-load local knowledge artifacts after reset', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-knowledge-reset-'));
  const sourceRoot = path.join(tempRoot, 'src');
  const outputRoot = path.join(tempRoot, 'output');
  const staleKnowledgeDir = path.join(tempRoot, '.zeus', 'knowledge', 'pui-patterns', 'catalogs');

  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.mkdirSync(staleKnowledgeDir, { recursive: true });
  fs.writeFileSync(path.join(staleKnowledgeDir, 'stale.json'), '{"unsafe":true}\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, 'ORDERPGM.rpgle'), '**FREE\nCALL SUBPGM;\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, 'SUBPGM.rpgle'), '**FREE\nDCL-F ORDERS DISK;\n', 'utf8');

  try {
    const coreResult = runAnalyzeCore({
      program: 'ORDERPGM',
      sourceRoot,
      outputRoot,
      cwd: tempRoot,
      env: process.env,
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

    assert.equal(coreResult.context.puiPatterns.enabled, false);
    assert.equal(
      coreResult.context.notes.some((note) => /PUI pattern|knowledge/i.test(String(note))),
      false,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
