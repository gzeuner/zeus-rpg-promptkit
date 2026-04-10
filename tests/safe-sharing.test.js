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

test('analyze --safe-sharing writes redacted variants with stable placeholders', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-safe-sharing-analyze-'));
  const sourceRoot = path.join(tempRoot, 'src');
  const outputRoot = path.join(tempRoot, 'output');

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
      '--safe-sharing',
      '--mode',
      'modernization',
    ], projectRoot);

    const safeDir = path.join(outputRoot, 'ORDERPGM', 'safe-sharing');
    assert.equal(fs.existsSync(path.join(safeDir, 'context.json')), true);
    assert.equal(fs.existsSync(path.join(safeDir, 'ai-knowledge.json')), true);
    assert.equal(fs.existsSync(path.join(safeDir, 'report.md')), true);
    assert.equal(fs.existsSync(path.join(safeDir, 'ai_prompt_documentation.md')), true);
    assert.equal(fs.existsSync(path.join(safeDir, 'ai_prompt_modernization.md')), true);
    assert.equal(fs.existsSync(path.join(safeDir, 'analyze-run-manifest.json')), true);
    assert.equal(fs.existsSync(path.join(safeDir, 'redaction-manifest.json')), true);

    const safeContext = readJson(path.join(safeDir, 'context.json'));
    const safeManifest = readJson(path.join(safeDir, 'redaction-manifest.json'));
    const safeReport = fs.readFileSync(path.join(safeDir, 'report.md'), 'utf8');
    const safePrompt = fs.readFileSync(path.join(safeDir, 'ai_prompt_modernization.md'), 'utf8');

    assert.equal(safeContext.program, 'PROGRAM_001');
    assert.ok(safeContext.dependencies.tables.every((entry) => /^TABLE_\d{3}$/.test(entry.name)));
    assert.ok(safeContext.dependencies.programCalls.every((entry) => /^PROGRAM_\d{3}$/.test(entry.name)));
    assert.match(safeReport, /PROGRAM_001/);
    assert.match(safePrompt, /PROGRAM_001/);
    assert.match(safePrompt, /VALUE_\d{3}/);
    assert.doesNotMatch(safeReport, /ORDERPGM|INVPGM|CUSTOMER|ORDERS|INVOICE|MYLIB|READY|NEW/);
    assert.doesNotMatch(safePrompt, /ORDERPGM|INVPGM|CUSTOMER|ORDERS|INVOICE|MYLIB|READY|NEW/);
    assert.ok(safeManifest.summary.placeholderCounts.PROGRAM >= 1);
    assert.ok(safeManifest.summary.placeholderCounts.TABLE >= 1);
    assert.ok(safeManifest.summary.placeholderCounts.VALUE >= 1);
    assert.ok(safeManifest.redactedArtifacts.includes('safe-sharing/report.md'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('bundle --safe-sharing packages only redacted shareable artifacts', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-safe-sharing-bundle-'));
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
      '--safe-sharing',
    ], projectRoot);

    runCli([
      'bundle',
      '--program',
      'ORDERPGM',
      '--source-output-root',
      outputRoot,
      '--output',
      bundleRoot,
      '--safe-sharing',
    ], projectRoot);

    const bundlePath = path.join(bundleRoot, 'ORDERPGM-safe-sharing-bundle.zip');
    const bundleManifest = readJson(path.join(outputRoot, 'ORDERPGM', 'bundle-manifest.json'));
    const zip = new AdmZip(bundlePath);
    const entryNames = zip.getEntries().map((entry) => entry.entryName).sort();
    const readme = zip.readAsText('README.txt');

    assert.equal(fs.existsSync(bundlePath), true);
    assert.equal(bundleManifest.safeSharing.enabled, true);
    assert.ok(bundleManifest.files.every((entry) => entry.startsWith('safe-sharing/')));
    assert.ok(entryNames.includes('safe-sharing/report.md'));
    assert.ok(entryNames.includes('safe-sharing/context.json'));
    assert.ok(entryNames.includes('safe-sharing/redaction-manifest.json'));
    assert.equal(entryNames.includes('report.md'), false);
    assert.equal(entryNames.includes('context.json'), false);
    assert.match(readme, /Safe sharing: enabled/);
    assert.match(readme, /safe-sharing\/redaction-manifest\.json/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
