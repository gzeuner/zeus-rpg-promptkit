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

test('analyze honors inherited profile limits and test-data governance policy in outputs and manifests', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-governance-config-'));
  const sourceRoot = path.join(tempRoot, 'src');
  const outputRoot = path.join(tempRoot, 'output');
  const configRoot = path.join(tempRoot, 'config');

  fs.cpSync(fixtureRoot, sourceRoot, { recursive: true });
  fs.mkdirSync(configRoot, { recursive: true });
  fs.writeFileSync(path.join(configRoot, 'profiles.example.json'), `${JSON.stringify({
    analysisLimits: {
      maxProgramDepth: 8,
      maxPrograms: 80,
    },
    base: {
      sourceRoot: './src',
      outputRoot: './output',
      testData: {
        allowTables: ['ORDERS', 'CUSTOMER'],
        denyTables: ['INVOICE'],
        maskColumns: ['EMAIL'],
      },
    },
    governed: {
      extends: 'base',
      analysisLimits: {
        maxProgramDepth: 2,
      },
      testData: {
        maskRules: [{
          table: 'CUSTOMER',
          columns: ['PHONE'],
          value: 'MASKED_PHONE',
        }],
      },
    },
  }, null, 2)}\n`, 'utf8');

  try {
    runCli([
      'analyze',
      '--profile',
      'governed',
      '--program',
      'ORDERPGM',
      '--skip-test-data',
    ], tempRoot);

    const programOutputDir = path.join(outputRoot, 'ORDERPGM');
    const context = readJson(path.join(programOutputDir, 'context.json'));
    const analyzeManifest = readJson(path.join(programOutputDir, 'analyze-run-manifest.json'));
    const report = fs.readFileSync(path.join(programOutputDir, 'report.md'), 'utf8');

    assert.equal(analyzeManifest.inputs.options.analysisLimits.maxProgramDepth, 2);
    assert.equal(analyzeManifest.inputs.options.analysisLimits.maxPrograms, 80);
    assert.deepEqual(analyzeManifest.inputs.options.testDataPolicy.allowTables, ['ORDERS', 'CUSTOMER']);
    assert.deepEqual(analyzeManifest.inputs.options.testDataPolicy.denyTables, ['INVOICE']);
    assert.equal(analyzeManifest.inputs.options.testDataPolicy.maskRules[0].value, 'MASKED_PHONE');

    assert.deepEqual(context.testData.policy.allowTables.map((entry) => entry.table), ['CUSTOMER', 'ORDERS']);
    assert.equal(context.testData.policySummary.allowlistCount, 2);
    assert.equal(context.testData.policySummary.denylistCount, 1);
    assert.equal(context.testData.policySummary.maskRuleCount, 1);
    assert.match(report, /Allowlist entries: 2/);
    assert.match(report, /Mask rules: 1/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
