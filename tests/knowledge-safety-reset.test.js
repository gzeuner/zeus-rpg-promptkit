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
  const localKnownFactsDir = path.join(tempRoot, 'config', 'local-only', 'known-facts');

  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.mkdirSync(staleKnowledgeDir, { recursive: true });
  fs.mkdirSync(localKnownFactsDir, { recursive: true });
  fs.writeFileSync(path.join(staleKnowledgeDir, 'stale.json'), '{"unsafe":true}\n', 'utf8');
  fs.writeFileSync(
    path.join(localKnownFactsDir, 'dev.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: 'zeus-local-known-facts',
        mode: 'local-only',
        profile: 'dev',
        versionMarker: {
          toolVersion: '0.1.0',
          updatedAt: '2026-06-16T10:00:00.000Z',
          expiresAt: '2026-07-16T10:00:00.000Z',
          ttlDays: 30,
        },
        facts: [
          {
            subject: 'ORDERS',
            attribute: 'ownerProgram',
            value: 'ORDERPGM',
          },
        ],
      },
      null,
      2
    ),
    'utf8'
  );
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
    assert.equal(coreResult.context.knownFacts.enabled, false);
    assert.equal(coreResult.context.knownFacts.factCount, 0);
    assert.equal(
      coreResult.context.notes.some(note =>
        /PUI pattern|known facts|knowledge/i.test(String(note))
      ),
      false
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
