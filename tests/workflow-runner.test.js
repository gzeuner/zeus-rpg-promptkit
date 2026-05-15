const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runWorkflowEngine } = require('../src/workflow/workflowRunner');

const fixtureRoot = path.join(__dirname, 'fixtures', 'v1-smoke', 'src');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test('runWorkflowEngine writes a standardized run directory with context and report', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-workflow-runner-'));
  const sourceRoot = path.join(tempRoot, 'src');
  const configRoot = path.join(tempRoot, 'config');

  fs.cpSync(fixtureRoot, sourceRoot, { recursive: true });
  fs.mkdirSync(configRoot, { recursive: true });
  fs.writeFileSync(path.join(configRoot, 'profiles.json'), `${JSON.stringify({
    local: {
      sourceRoot: './src',
      outputRoot: './output',
      extensions: ['.rpgle', '.clle', '.dds', '.pf', '.lf'],
      workflow: {
        outputRoot: './analysis',
        defaultPreset: 'legacy-rpg-analysis',
        analyzeModes: ['documentation'],
        members: ['ORDERPGM'],
        presets: {
          'legacy-rpg-analysis': {
            steps: ['analyze', 'report'],
          },
        },
      },
    },
  }, null, 2)}\n`, 'utf8');

  try {
    const state = await runWorkflowEngine({
      profile: 'local',
      preset: 'legacy-rpg-analysis',
    }, {
      cwd: tempRoot,
      env: {},
    });

    assert.equal(state.status, 'succeeded');
    assert.equal(fs.existsSync(state.paths.contextPath), true);
    assert.equal(fs.existsSync(state.paths.reportPath), true);
    assert.equal(fs.existsSync(path.join(state.paths.analyzeRoot, 'documentation', 'ORDERPGM', 'context.json')), true);

    const context = readJson(state.paths.contextPath);
    assert.equal(context.profile, 'local');
    assert.equal(context.preset, 'legacy-rpg-analysis');
    assert.equal(context.status, 'succeeded');
    assert.equal(context.steps.some((entry) => entry.name === 'analyze' && entry.status === 'passed'), true);
    assert.equal(context.results.analyze.entries[0].member, 'ORDERPGM');

    const report = fs.readFileSync(state.paths.reportPath, 'utf8');
    assert.match(report, /Zeus Workflow Report/);
    assert.match(report, /ORDERPGM/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
