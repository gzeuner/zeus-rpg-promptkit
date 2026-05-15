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

test('analyze --list-modes exposes guided workflow presets', () => {
  const output = runCli(['analyze', '--list-modes'], projectRoot);
  assert.match(output, /Supported analyze workflow modes:/);
  assert.match(output, /- architecture:/);
  assert.match(output, /- modernization:/);
  assert.match(output, /- refactoring:/);
  assert.match(output, /- test-generation:/);
  assert.match(output, /- impact:/);
  assert.match(output, /intended audience:/);
  assert.match(output, /expected decisions:/);
});

test('guided analyze mode writes task index, selected mode metadata, and mode-specific prompts', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-guided-mode-'));
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
      '--mode',
      'modernization',
    ], projectRoot);

    const programOutputDir = path.join(outputRoot, 'ORDERPGM');
    assert.equal(fs.existsSync(path.join(programOutputDir, 'optimized-context.json')), true);
    assert.equal(fs.existsSync(path.join(programOutputDir, 'analysis-index.json')), true);
    assert.equal(fs.existsSync(path.join(programOutputDir, 'ai_prompt_documentation.md')), true);
    assert.equal(fs.existsSync(path.join(programOutputDir, 'ai_prompt_architecture_review.md')), true);
    assert.equal(fs.existsSync(path.join(programOutputDir, 'ai_prompt_modernization.md')), true);
    assert.equal(fs.existsSync(path.join(programOutputDir, 'ai_prompt_error_analysis.md')), false);

    const analysisIndex = readJson(path.join(programOutputDir, 'analysis-index.json'));
    assert.equal(analysisIndex.selectedMode, 'modernization');
    assert.equal(analysisIndex.selectedPreset, null);
    assert.equal(analysisIndex.summary.selectedTaskCount, 1);
    assert.equal(analysisIndex.summary.selectedPresetCount, 0);
    assert.ok(analysisIndex.guidedModes.some((entry) => entry.name === 'modernization' && entry.selected === true));
    const modernizationTask = analysisIndex.tasks.find((entry) => entry.id === 'modernization');
    assert.ok(modernizationTask);
    assert.equal(modernizationTask.selected, true);
    assert.ok(modernizationTask.prompts.some((entry) => entry.name === 'modernization' && entry.generated === true));
    assert.ok(Array.isArray(modernizationTask.reviewWorkflow.intendedAudience));
    assert.match(modernizationTask.reviewWorkflow.intendedAudience.join('\n'), /Modernization leads/);
    assert.match(modernizationTask.reviewWorkflow.keyQuestionsAnswered.join('\n'), /extract or rewrite first/i);
    assert.ok(Array.isArray(analysisIndex.derivedModeSettings.reviewWorkflow.expectedDecisions));

    const manifest = readJson(path.join(programOutputDir, 'analyze-run-manifest.json'));
    assert.equal(manifest.inputs.options.guidedMode.name, 'modernization');
    assert.deepEqual(manifest.inputs.options.guidedMode.promptTemplates, ['documentation', 'architecture-review', 'modernization']);
    assert.equal(manifest.inputs.options.guidedMode.effectiveOptimizeContext, true);
    assert.match(manifest.inputs.options.guidedMode.reviewWorkflow.expectedDecisions.join('\n'), /pilot extraction candidate/i);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
