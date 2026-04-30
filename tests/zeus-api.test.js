const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { analyze, runWorkflow } = require('../src/api/zeusApi');

const fixtureRoot = path.join(__dirname, 'fixtures', 'v1-smoke', 'src');

test('zeusApi exposes reusable analyze and workflow entry points', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-api-'));
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
        members: ['ORDERPGM'],
        analyzeModes: ['documentation'],
        presets: {
          'legacy-rpg-analysis': {
            steps: ['analyze', 'report'],
          },
        },
      },
    },
  }, null, 2)}\n`, 'utf8');

  try {
    const analyzeResult = analyze('local', {
      member: 'ORDERPGM',
      mode: 'documentation',
      runtime: {
        cwd: tempRoot,
        env: {},
      },
    });
    assert.equal(analyzeResult.program, 'ORDERPGM');
    assert.equal(fs.existsSync(path.join(analyzeResult.outputProgramDir, 'context.json')), true);

    const workflowResult = await runWorkflow('local', 'legacy-rpg-analysis', {
      runtime: {
        cwd: tempRoot,
        env: {},
      },
    });
    assert.equal(workflowResult.status, 'succeeded');
    assert.equal(fs.existsSync(workflowResult.paths.reportPath), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
