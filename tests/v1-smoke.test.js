const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');

const projectRoot = path.resolve(__dirname, '..');
const cliPath = path.join(projectRoot, 'cli', 'zeus.js');
const fixtureRoot = path.join(__dirname, 'fixtures', 'v1-smoke', 'src');

function runCli(args, cwd) {
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test('V1 smoke flow generates analysis artifacts and bundle outputs', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-v1-smoke-'));
  const sourceRoot = path.join(tempRoot, 'src');
  const outputRoot = path.join(tempRoot, 'output');
  const bundleRoot = path.join(tempRoot, 'bundles');

  fs.cpSync(fixtureRoot, sourceRoot, { recursive: true });

  try {
    runCli([
      'analyze',
      '--source',
      sourceRoot,
      '--program',
      'ORDERPGM',
      '--out',
      outputRoot,
      '--optimize-context',
      '--test-data-limit',
      '25',
    ], projectRoot);

    const programOutputDir = path.join(outputRoot, 'ORDERPGM');
    const expectedFiles = [
      'analyze-run-manifest.json',
      'canonical-analysis.json',
      'context.json',
      'optimized-context.json',
      'ai-knowledge.json',
      'analysis-index.json',
      'report.md',
      'architecture-report.md',
      'ai_prompt_documentation.md',
      'ai_prompt_error_analysis.md',
      'dependency-graph.json',
      'dependency-graph.md',
      'dependency-graph.mmd',
      'program-call-tree.json',
      'program-call-tree.md',
      'program-call-tree.mmd',
      'architecture.html',
    ];

    for (const fileName of expectedFiles) {
      assert.equal(fs.existsSync(path.join(programOutputDir, fileName)), true, `missing ${fileName}`);
    }

    const canonicalAnalysis = readJson(path.join(programOutputDir, 'canonical-analysis.json'));
    assert.equal(canonicalAnalysis.rootProgram, 'ORDERPGM');
    assert.equal(canonicalAnalysis.kind, 'canonical-analysis');
    assert.ok(canonicalAnalysis.relations.some((relation) => relation.type === 'CALLS_PROGRAM'));

    const context = readJson(path.join(programOutputDir, 'context.json'));
    assert.equal(context.program, 'ORDERPGM');
    assert.deepEqual(
      context.dependencies.tables.map((entry) => entry.name),
      ['CUSTOMER', 'INVOICE', 'ORDERS'],
    );
    assert.deepEqual(
      context.dependencies.programCalls.map((entry) => entry.name),
      ['INVPGM'],
    );
    assert.deepEqual(
      context.dependencies.copyMembers.map((entry) => entry.name),
      ['QRPGLESRC,ORDCOPY'],
    );
    assert.equal(context.sql.statements.length, 2);
    assert.equal(context.sql.summary.readStatementCount, 1);
    assert.equal(context.sql.summary.writeStatementCount, 1);
    assert.equal(context.sql.summary.dynamicStatementCount, 0);
    assert.deepEqual(
      context.sql.statements.map((statement) => statement.tables.join(',')).sort(),
      ['CUSTOMER,ORDERS', 'INVOICE'],
    );
    assert.equal(context.db2Metadata.status, 'skipped');
    assert.equal(context.testData.status, 'skipped');
    assert.equal(context.testData.rowLimit, 25);
    assert.equal(context.procedureAnalysis.summary.procedureCount, 2);
    assert.equal(context.procedureAnalysis.summary.externalCallCount, 0);
    assert.equal(context.procedureAnalysis.summary.unresolvedCallCount, 1);
    assert.equal(context.nativeFileUsage.summary.fileCount, 3);
    assert.equal(context.nativeFileUsage.summary.keyedFileCount, 1);
    assert.match(
      context.notes.join('\n'),
      /Test data extraction was skipped because no DB2 connection configuration was available\./,
    );

    const optimizedContext = readJson(path.join(programOutputDir, 'optimized-context.json'));
    assert.equal(optimizedContext.program, 'ORDERPGM');
    assert.equal(optimizedContext.optimization.strategy, 'salience-ranked-evidence-packs');
    assert.ok(optimizedContext.workflows.documentation.tokenBudget >= 1);
    assert.ok(Array.isArray(optimizedContext.workflows.documentation.evidenceHighlights));
    const aiKnowledge = readJson(path.join(programOutputDir, 'ai-knowledge.json'));
    assert.equal(aiKnowledge.kind, 'ai-knowledge-projection');
    assert.equal(aiKnowledge.program, 'ORDERPGM');
    assert.ok(Array.isArray(aiKnowledge.evidenceIndex));
    assert.ok(aiKnowledge.workflows.documentation);
    assert.ok(Array.isArray(aiKnowledge.workflows.documentation.evidencePacks.sql));
    const analysisIndex = readJson(path.join(programOutputDir, 'analysis-index.json'));
    assert.equal(analysisIndex.kind, 'analysis-task-index');
    assert.equal(analysisIndex.program, 'ORDERPGM');
    assert.equal(analysisIndex.selectedMode, null);
    assert.equal(analysisIndex.selectedPreset, null);
    assert.equal(analysisIndex.summary.selectedPresetCount, 0);
    assert.ok(Array.isArray(analysisIndex.guidedModes));
    assert.ok(analysisIndex.tasks.some((task) => task.id === 'modernization'));
    assert.ok(analysisIndex.tasks.some((task) => task.id === 'impact'));
    assert.ok(analysisIndex.tasks.every((task) => task.reviewWorkflow));

    const report = fs.readFileSync(path.join(programOutputDir, 'report.md'), 'utf8');
    assert.match(report, /## Analysis Cache/);
    assert.match(report, /## Native File I\/O/);
    assert.match(report, /Read Statements: 1/);
    assert.match(report, /## Test Data Extract/);
    assert.match(report, /Test data extraction was skipped because no DB2 connection configuration was available\./);

    const prompt = fs.readFileSync(path.join(programOutputDir, 'ai_prompt_documentation.md'), 'utf8');
    assert.match(prompt, /3 native files/);
    assert.match(prompt, /Risk markers:/);
    assert.match(prompt, /Evidence Highlights/);
    assert.match(prompt, /#1 /);
    assert.match(prompt, /\[SELECT\/READ\]/);
    assert.match(prompt, /Representative sample rows are not available in this analysis run\./);

    const graph = readJson(path.join(programOutputDir, 'program-call-tree.json'));
    assert.equal(graph.summary.programCount, 2);
    assert.equal(graph.summary.tableCount, 3);
    const architectureViewer = fs.readFileSync(path.join(programOutputDir, 'architecture.html'), 'utf8');
    assert.equal(/<script[^>]+src=/i.test(architectureViewer), false);
    assert.doesNotMatch(architectureViewer, /unpkg\.com\/vis-network/);
    assert.match(architectureViewer, /Bundled asset: vis-network /);

    const analyzeManifest = readJson(path.join(programOutputDir, 'analyze-run-manifest.json'));
    assert.equal(analyzeManifest.schemaVersion, 1);
    assert.equal(analyzeManifest.tool.command, 'analyze');
    assert.equal(analyzeManifest.run.status, 'succeeded');
    assert.equal(analyzeManifest.inputs.program, 'ORDERPGM');
    assert.equal(analyzeManifest.summary.stageCount, 8);
    assert.ok(analyzeManifest.summary.generatedArtifactCount >= 13);
    assert.equal(analyzeManifest.cacheStatus.sourceScan.misses, 2);
    assert.equal(analyzeManifest.inputs.sourceSnapshot.fileCount, 2);
    assert.ok(analyzeManifest.inputs.options.analysisLimits.maxProgramDepth >= 1);
    assert.ok(Array.isArray(analyzeManifest.inputs.options.testDataPolicy.maskColumns));
    assert.equal(analyzeManifest.inputs.options.guidedMode, null);
    assert.equal(analyzeManifest.inputs.options.investigation.scanIfsPathsEnabled, false);
    assert.ok(analyzeManifest.stages.some((stage) => stage.id === 'collect-scan'));
    assert.ok(analyzeManifest.stages.some((stage) => stage.id === 'investigate-sources'));
    assert.ok(analyzeManifest.stages.some((stage) => stage.id === 'run-diagnostic-packs'));
    assert.ok(analyzeManifest.stages.some((stage) => stage.id === 'write-artifacts'));
    assert.ok(analyzeManifest.stages.every((stage) => Object.prototype.hasOwnProperty.call(stage, 'definition')));
    assert.ok(analyzeManifest.artifacts.some((artifact) => artifact.path === 'context.json'));
    assert.ok(analyzeManifest.artifacts.some((artifact) => artifact.path === 'analysis-index.json'));
    assert.equal(analyzeManifest.comparison, null);

    runCli([
      'bundle',
      '--program',
      'ORDERPGM',
      '--source-output-root',
      outputRoot,
      '--output',
      bundleRoot,
    ], projectRoot);

    const bundlePath = path.join(bundleRoot, 'ORDERPGM-analysis-bundle.zip');
    assert.equal(fs.existsSync(bundlePath), true);

    const manifest = readJson(path.join(programOutputDir, 'bundle-manifest.json'));
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.tool.command, 'bundle');
    assert.equal(manifest.program, 'ORDERPGM');
    assert.ok(manifest.files.includes('canonical-analysis.json'));
    assert.ok(manifest.files.includes('context.json'));
    assert.ok(manifest.files.includes('ai-knowledge.json'));
    assert.ok(manifest.files.includes('analysis-index.json'));
    assert.ok(manifest.files.includes('report.md'));
    assert.ok(manifest.files.includes('architecture.html'));
    assert.ok(Array.isArray(manifest.artifacts));
    assert.ok(manifest.artifacts.some((artifact) => artifact.path === 'context.json' && artifact.sha256));
    assert.equal(manifest.analyzeRun.status, 'succeeded');

    const zip = new AdmZip(bundlePath);
    const entryNames = zip.getEntries().map((entry) => entry.entryName).sort();
    assert.ok(entryNames.includes('canonical-analysis.json'));
    assert.ok(entryNames.includes('context.json'));
    assert.ok(entryNames.includes('ai-knowledge.json'));
    assert.ok(entryNames.includes('analysis-index.json'));
    assert.ok(entryNames.includes('report.md'));
    assert.ok(entryNames.includes('architecture.html'));
    assert.ok(entryNames.includes('manifest.json'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
