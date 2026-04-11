const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const cliPath = path.join(projectRoot, 'cli', 'zeus.js');
const fixtureRoot = path.join(__dirname, 'fixtures', 'v1-smoke', 'src');
const STABLE_TIMESTAMP = '2000-01-01T00:00:00.000Z';

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

function captureFiles(rootDir, relativePaths) {
  const snapshot = {};
  for (const relativePath of relativePaths) {
    snapshot[relativePath] = fs.readFileSync(path.join(rootDir, relativePath));
  }
  return snapshot;
}

test('reproducible mode produces identical analyze, impact, and bundle artifacts across repeated runs', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-reproducible-output-'));
  const sourceRoot = path.join(tempRoot, 'src');
  const outputRoot = path.join(tempRoot, 'output');
  const bundleRoot = path.join(tempRoot, 'bundles');

  fs.cpSync(fixtureRoot, sourceRoot, { recursive: true });

  const programOutputDir = path.join(outputRoot, 'ORDERPGM');
  const trackedArtifacts = [
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
    'impact-analysis.json',
    'impact-analysis.md',
    'bundle-manifest.json',
  ];

  function executeCycle() {
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
      '--reproducible',
    ], projectRoot);

    runCli([
      'impact',
      '--target',
      'ORDERS',
      '--program',
      'ORDERPGM',
      '--out',
      outputRoot,
      '--reproducible',
    ], projectRoot);

    runCli([
      'bundle',
      '--program',
      'ORDERPGM',
      '--source-output-root',
      outputRoot,
      '--output',
      bundleRoot,
      '--reproducible',
    ], projectRoot);

    const artifacts = captureFiles(programOutputDir, trackedArtifacts);
    const bundlePath = path.join(bundleRoot, 'ORDERPGM-analysis-bundle.zip');
    const bundleBytes = fs.readFileSync(bundlePath);
    return { artifacts, bundleBytes };
  }

  try {
    const firstRun = executeCycle();

    const analyzeManifest = readJson(path.join(programOutputDir, 'analyze-run-manifest.json'));
    const impactResult = readJson(path.join(programOutputDir, 'impact-analysis.json'));
    const bundleManifest = readJson(path.join(programOutputDir, 'bundle-manifest.json'));

    assert.equal(analyzeManifest.inputs.options.reproducibleEnabled, true);
    assert.equal(analyzeManifest.run.startedAt, STABLE_TIMESTAMP);
    assert.equal(analyzeManifest.run.completedAt, STABLE_TIMESTAMP);
    assert.equal(analyzeManifest.run.durationMs, 0);
    assert.equal(analyzeManifest.comparison, null);
    assert.equal(analyzeManifest.reproducibility.enabled, true);
    assert.equal(bundleManifest.reproducibility.enabled, true);
    assert.equal(bundleManifest.generatedAt, STABLE_TIMESTAMP);
    assert.equal(impactResult.reproducibility.enabled, true);

    fs.rmSync(outputRoot, { recursive: true, force: true });
    fs.rmSync(bundleRoot, { recursive: true, force: true });

    const secondRun = executeCycle();

    assert.deepEqual(
      Object.keys(firstRun.artifacts).sort(),
      Object.keys(secondRun.artifacts).sort(),
    );
    for (const relativePath of Object.keys(firstRun.artifacts)) {
      assert.equal(
        Buffer.compare(firstRun.artifacts[relativePath], secondRun.artifacts[relativePath]),
        0,
        `artifact changed between reproducible runs: ${relativePath}`,
      );
    }
    assert.equal(Buffer.compare(firstRun.bundleBytes, secondRun.bundleBytes), 0, 'bundle zip changed between reproducible runs');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
