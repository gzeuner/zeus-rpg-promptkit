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

test('refactoring and test-generation prompt packs are emitted through guided modes and presets', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-prompt-packs-'));
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
      '--mode',
      'refactoring',
    ], projectRoot);

    const refactoringDir = path.join(outputRoot, 'ORDERPGM');
    assert.equal(fs.existsSync(path.join(refactoringDir, 'ai_prompt_architecture_review.md')), true);
    assert.equal(fs.existsSync(path.join(refactoringDir, 'ai_prompt_refactoring_plan.md')), true);

    runCli([
      'workflow',
      '--preset',
      'test-generation-review',
      '--source',
      sourceRoot,
      '--program',
      'ORDERPGM',
      '--out',
      outputRoot,
      '--bundle-output',
      bundleRoot,
    ], projectRoot);

    const workflowDir = path.join(outputRoot, 'ORDERPGM');
    assert.equal(fs.existsSync(path.join(workflowDir, 'ai_prompt_test_generation.md')), true);
    const workflowManifest = JSON.parse(fs.readFileSync(path.join(workflowDir, 'workflow-run-manifest.json'), 'utf8'));
    assert.equal(workflowManifest.preset.name, 'test-generation-review');
    assert.equal(workflowManifest.preset.analyzeMode, 'test-generation');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
