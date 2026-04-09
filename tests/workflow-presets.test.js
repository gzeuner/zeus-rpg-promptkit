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

test('workflow --list-presets exposes named guided workflow bundles', () => {
  const output = runCli(['workflow', '--list-presets'], projectRoot);
  assert.match(output, /Supported workflow presets:/);
  assert.match(output, /- architecture-review:/);
  assert.match(output, /- modernization-review:/);
  assert.match(output, /- onboarding:/);
  assert.match(output, /- dependency-risk:/);
});

test('workflow preset runs analyze plus bundle and records preset metadata in manifests', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-workflow-preset-'));
  const sourceRoot = path.join(tempRoot, 'src');
  const outputRoot = path.join(tempRoot, 'output');
  const bundleRoot = path.join(tempRoot, 'bundles');

  fs.cpSync(fixtureRoot, sourceRoot, { recursive: true });

  try {
    runCli([
      'workflow',
      '--preset',
      'modernization-review',
      '--source',
      sourceRoot,
      '--program',
      'ORDERPGM',
      '--out',
      outputRoot,
      '--bundle-output',
      bundleRoot,
    ], projectRoot);

    const programOutputDir = path.join(outputRoot, 'ORDERPGM');
    const analyzeManifest = readJson(path.join(programOutputDir, 'analyze-run-manifest.json'));
    const workflowManifest = readJson(path.join(programOutputDir, 'workflow-run-manifest.json'));
    const bundleManifest = readJson(path.join(programOutputDir, 'bundle-manifest.json'));
    const bundlePath = path.join(bundleRoot, 'ORDERPGM-modernization-review-bundle.zip');

    assert.equal(analyzeManifest.inputs.options.guidedMode.name, 'modernization');
    assert.equal(analyzeManifest.inputs.options.workflowPreset.name, 'modernization-review');
    assert.deepEqual(
      analyzeManifest.inputs.options.workflowPreset.promptTemplates,
      ['documentation', 'modernization'],
    );

    assert.equal(workflowManifest.kind, 'workflow-run-manifest');
    assert.equal(workflowManifest.preset.name, 'modernization-review');
    assert.equal(workflowManifest.preset.analyzeMode, 'modernization');
    assert.equal(workflowManifest.bundle.zipPath, 'ORDERPGM-modernization-review-bundle.zip');

    assert.equal(bundleManifest.workflowPreset.name, 'modernization-review');
    assert.equal(bundleManifest.workflowPreset.analyzeMode, 'modernization');
    assert.ok(bundleManifest.files.includes('ai_prompt_modernization.md'));
    assert.ok(bundleManifest.files.includes('architecture-report.md'));
    assert.equal(bundleManifest.files.includes('context.json'), false);
    assert.equal(fs.existsSync(bundlePath), true);

    const zip = new AdmZip(bundlePath);
    const entryNames = zip.getEntries().map((entry) => entry.entryName).sort();
    assert.ok(entryNames.includes('ai_prompt_modernization.md'));
    assert.ok(entryNames.includes('architecture-report.md'));
    assert.equal(entryNames.includes('context.json'), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
