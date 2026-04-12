const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

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

test('analyze can emit IFS path, full-text search, and diagnostic pack artifacts', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-investigation-'));
  const sourceRoot = path.join(tempRoot, 'src');
  const outputRoot = path.join(tempRoot, 'output');

  fs.cpSync(fixtureRoot, sourceRoot, { recursive: true });
  fs.appendFileSync(
    path.join(sourceRoot, 'ORDERPGM.sqlrpgle'),
    "\n// Investigation fixtures\nDCL-S HomePath VARCHAR(256) INZ('/home/order/docs/order.json');\n",
    'utf8',
  );

  try {
    runCli([
      'analyze',
      '--source',
      sourceRoot,
      '--program',
      'ORDERPGM',
      '--out',
      outputRoot,
      '--scan-ifs-paths',
      '--search-terms',
      'INVPGM,/home/order',
      '--diagnostic-packs',
      'table-investigation',
      '--diagnostic-params',
      'table=ORDERS',
    ], projectRoot);

    const programOutputDir = path.join(outputRoot, 'ORDERPGM');
    assert.equal(fs.existsSync(path.join(programOutputDir, 'ifs-paths.json')), true);
    assert.equal(fs.existsSync(path.join(programOutputDir, 'search-results.json')), true);
    assert.equal(fs.existsSync(path.join(programOutputDir, 'diagnostic-query-packs.json')), true);
    assert.equal(fs.existsSync(path.join(programOutputDir, 'diagnostic-query-pack-manifest.json')), true);

    const ifsPaths = readJson(path.join(programOutputDir, 'ifs-paths.json'));
    assert.equal(ifsPaths.enabled, true);
    assert.ok(ifsPaths.paths.some((entry) => entry.path === '/home/order/docs/order.json'));

    const searchResults = readJson(path.join(programOutputDir, 'search-results.json'));
    assert.equal(searchResults.enabled, true);
    assert.ok(searchResults.matches.some((entry) => entry.term === 'INVPGM'));
    assert.ok(searchResults.matches.some((entry) => entry.term === '/home/order'));

    const diagnosticPacks = readJson(path.join(programOutputDir, 'diagnostic-query-packs.json'));
    assert.equal(diagnosticPacks.enabled, true);
    assert.equal(diagnosticPacks.summary.packCount, 1);
    assert.equal(diagnosticPacks.packs[0].name, 'table-investigation');
    assert.equal(diagnosticPacks.packs[0].summary.skippedStepCount, 2);

    const report = fs.readFileSync(path.join(programOutputDir, 'report.md'), 'utf8');
    assert.match(report, /## IFS Path Usage/);
    assert.match(report, /## Full-Text Search/);
    assert.match(report, /## Diagnostic Query Packs/);

    const manifest = readJson(path.join(programOutputDir, 'analyze-run-manifest.json'));
    assert.equal(manifest.inputs.options.investigation.scanIfsPathsEnabled, true);
    assert.deepEqual(manifest.inputs.options.investigation.searchTerms, ['/home/order', 'INVPGM']);
    assert.deepEqual(manifest.inputs.options.investigation.diagnosticPacks, ['table-investigation']);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
