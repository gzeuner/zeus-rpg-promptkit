const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runAnalyzeArtifactAdapter, runAnalyzeCore } = require('../src/analyze/analyzePipeline');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

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
      denseLevel: 'ultra',
      logVerbose() {},
    });

    assert.equal(Array.isArray(coreResult.generatedFiles), false);
    assert.equal(
      coreResult.stageReports.some(stage => stage.id === 'write-artifacts'),
      false
    );
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
    assert.equal(
      writtenResult.stageReports.some(stage => stage.id === 'write-artifacts'),
      true
    );
    assert.equal(fs.existsSync(path.join(outputProgramDir, 'report.md')), true);
    assert.equal(fs.existsSync(path.join(outputProgramDir, 'analysis-diagnostics.json')), true);

    // Verify denseLevel propagates to generated artifacts
    const reportContent = fs.readFileSync(path.join(outputProgramDir, 'report.md'), 'utf8');
    assert.ok(
      reportContent.includes('# Analysis Report (dense:ultra)'),
      'report.md should reflect dense:ultra title'
    );

    const promptFiles = writtenResult.generatedFiles.filter(f => f.startsWith('ai_prompt_'));
    if (promptFiles.length > 0) {
      const promptContent = fs.readFileSync(path.join(outputProgramDir, promptFiles[0]), 'utf8');
      assert.ok(
        promptContent.includes('Style: Ultra-dense technical'),
        'prompt should include ultra dense style directive'
      );
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('analyze without denseLevel produces normal (non-dense) report output', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-analyze-no-dense-'));
  const sourceRoot = path.join(tempRoot, 'src');
  const outputRoot = path.join(tempRoot, 'output');
  const outputProgramDir = path.join(outputRoot, 'ORDERPGM');

  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(outputProgramDir, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'ORDERPGM.rpgle'), '**FREE\nDCL-F ORDERS;\n', 'utf8');

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
      // no denseLevel passed
      logVerbose() {},
    });

    runAnalyzeArtifactAdapter({ ...coreResult, outputRoot, outputProgramDir });
    const report = fs.readFileSync(path.join(outputProgramDir, 'report.md'), 'utf8');
    assert.ok(
      report.startsWith('# Zeus RPG Analysis Report'),
      'default should use normal report title, not dense'
    );
    assert.ok(!report.includes('(dense'), 'no dense marker when denseLevel omitted');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('analyze core can opt in local known facts without auto-loading them by default', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-analyze-known-facts-'));
  const sourceRoot = path.join(tempRoot, 'src');
  const outputRoot = path.join(tempRoot, 'output');
  const outputProgramDir = path.join(outputRoot, 'ORDERPGM');
  const knownFactsDir = path.join(tempRoot, 'config', 'local-only', 'known-facts');

  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(outputProgramDir, { recursive: true });
  fs.mkdirSync(knownFactsDir, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'ORDERPGM.rpgle'), '**FREE\nCALL SUBPGM;\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, 'SUBPGM.rpgle'), '**FREE\nDCL-F ORDERS DISK;\n', 'utf8');
  fs.writeFileSync(
    path.join(knownFactsDir, 'dev.json'),
    `${JSON.stringify(
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
            confidence: 'HIGH',
          },
        ],
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  try {
    const coreResult = runAnalyzeCore({
      program: 'ORDERPGM',
      sourceRoot,
      outputRoot,
      profile: 'dev',
      loadKnownFactsEnabled: true,
      cwd: tempRoot,
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

    assert.equal(coreResult.context.knownFacts.enabled, true);
    assert.equal(coreResult.context.knownFacts.status, 'ready');
    assert.equal(coreResult.context.knownFacts.profile, 'dev');
    assert.equal(coreResult.context.knownFacts.factCount, 1);
    assert.equal(coreResult.context.knownFacts.facts[0].subject, 'ORDERS');
    assert.ok(
      coreResult.stageReports.some(
        stage => stage.id === 'load-known-facts' && stage.status === 'completed'
      )
    );

    const writtenResult = runAnalyzeArtifactAdapter({
      ...coreResult,
      outputRoot,
      outputProgramDir,
      emitDiagnostics: false,
    });

    assert.ok(writtenResult.generatedFiles.includes('known-facts.json'));
    assert.equal(fs.existsSync(path.join(outputProgramDir, 'known-facts.json')), true);
    const knownFactsArtifact = readJson(path.join(outputProgramDir, 'known-facts.json'));
    assert.equal(knownFactsArtifact.kind, 'analysis-known-facts');
    assert.equal(knownFactsArtifact.status, 'ready');
    assert.equal(knownFactsArtifact.enabled, true);
    assert.equal(knownFactsArtifact.factCount, 1);
    assert.equal(knownFactsArtifact.facts[0].attribute, 'ownerProgram');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('known facts opt-in keeps missing local store visible in context and artifacts', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-analyze-known-facts-missing-'));
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
      profile: 'missing-dev',
      loadKnownFactsEnabled: true,
      cwd: tempRoot,
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

    assert.equal(coreResult.context.knownFacts.enabled, false);
    assert.equal(coreResult.context.knownFacts.status, 'missing');
    assert.equal(coreResult.context.knownFacts.profile, 'missing-dev');
    assert.equal(coreResult.context.knownFacts.factCount, 0);
    assert.match(coreResult.context.knownFacts.notes.join('\n'), /not found/i);
    assert.ok(
      coreResult.stageReports.some(
        stage =>
          stage.id === 'load-known-facts' &&
          stage.status === 'completed' &&
          stage.metadata.status === 'missing'
      )
    );

    const writtenResult = runAnalyzeArtifactAdapter({
      ...coreResult,
      outputRoot,
      outputProgramDir,
      emitDiagnostics: true,
    });

    assert.ok(writtenResult.generatedFiles.includes('known-facts.json'));
    const knownFactsArtifact = readJson(path.join(outputProgramDir, 'known-facts.json'));
    assert.equal(knownFactsArtifact.kind, 'analysis-known-facts');
    assert.equal(knownFactsArtifact.status, 'missing');
    assert.equal(knownFactsArtifact.enabled, false);
    assert.equal(knownFactsArtifact.factCount, 0);
    assert.match(knownFactsArtifact.notes.join('\n'), /not found/i);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
