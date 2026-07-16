const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { analyze, listRuns, readKnowledge, runWorkflow, zeus } = require('../src/api/zeusApi');
const { REPRODUCIBLE_TIMESTAMP } = require('../src/reproducibility/reproducibility');

const fixtureRoot = path.join(__dirname, 'fixtures', 'v1-smoke', 'src');
const KNOWN_FACTS_UPDATED_AT = '1999-12-16T00:00:00.000Z';
const KNOWN_FACTS_EXPIRES_AT = '2000-01-15T00:00:00.000Z';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test('zeusApi exposes reusable analyze and workflow entry points', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-api-'));
  const sourceRoot = path.join(tempRoot, 'src');
  const configRoot = path.join(tempRoot, 'config');
  const localOnlyRoot = path.join(configRoot, 'local-only', 'known-facts');

  fs.cpSync(fixtureRoot, sourceRoot, { recursive: true });
  fs.mkdirSync(configRoot, { recursive: true });
  fs.mkdirSync(localOnlyRoot, { recursive: true });
  fs.writeFileSync(
    path.join(configRoot, 'profiles.json'),
    `${JSON.stringify(
      {
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
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(localOnlyRoot, 'local.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        kind: 'zeus-local-known-facts',
        mode: 'local-only',
        profile: 'local',
        versionMarker: {
          toolVersion: '0.1.0',
          updatedAt: KNOWN_FACTS_UPDATED_AT,
          expiresAt: KNOWN_FACTS_EXPIRES_AT,
          ttlDays: 30,
        },
        facts: [
          {
            subject: 'ORDERS',
            attribute: 'primaryKey',
            value: 'ORDER_ID',
            confidence: 'HIGH',
          },
        ],
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  try {
    const analyzeResult = analyze('local', {
      member: 'ORDERPGM',
      mode: 'documentation',
      'with-known-facts': true,
      reproducible: true,
      runtime: {
        cwd: tempRoot,
        env: {},
      },
    });
    assert.equal(analyzeResult.reproducibility.stableTimestamp, REPRODUCIBLE_TIMESTAMP);
    assert.equal(analyzeResult.program, 'ORDERPGM');
    assert.equal(fs.existsSync(path.join(analyzeResult.outputProgramDir, 'context.json')), true);
    assert.equal(
      fs.existsSync(path.join(analyzeResult.outputProgramDir, 'known-facts.json')),
      true
    );
    assert.equal(analyzeResult.result.context.knownFacts.enabled, true);
    assert.equal(analyzeResult.result.context.knownFacts.factCount, 1);
    assert.equal(analyzeResult.result.context.knownFacts.facts[0].attribute, 'primaryKey');
    const knownFactsArtifact = readJson(
      path.join(analyzeResult.outputProgramDir, 'known-facts.json')
    );
    assert.equal(knownFactsArtifact.kind, 'analysis-known-facts');
    assert.equal(knownFactsArtifact.factCount, 1);
    const analyzeManifest = readJson(
      path.join(analyzeResult.outputProgramDir, 'analyze-run-manifest.json')
    );
    assert.ok(analyzeManifest.artifacts.some(artifact => artifact.path === 'known-facts.json'));
    const report = fs.readFileSync(path.join(analyzeResult.outputProgramDir, 'report.md'), 'utf8');
    assert.match(report, /## Known Facts/);
    assert.match(report, /Artifact: known-facts\.json/);

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

test('zeusApi resolves run explorer output roots from the selected profile', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-api-runs-'));
  const configRoot = path.join(tempRoot, 'config');
  const outputRoot = path.join(tempRoot, 'output');
  const programDir = path.join(outputRoot, 'ORDERPGM');

  fs.mkdirSync(configRoot, { recursive: true });
  fs.mkdirSync(programDir, { recursive: true });
  fs.writeFileSync(
    path.join(configRoot, 'profiles.json'),
    `${JSON.stringify(
      {
        local: {
          outputRoot: './output',
        },
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(programDir, 'analyze-run-manifest.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        tool: { name: 'zeus-rpg-promptkit', command: 'analyze' },
        run: { status: 'succeeded', completedAt: '2026-04-13T12:00:00.000Z' },
        inputs: { sourceRoot: './src', options: {} },
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  try {
    const result = listRuns('local', {
      runtime: {
        cwd: tempRoot,
        env: {},
      },
    });
    assert.equal(result.outputRoot, outputRoot);
    assert.equal(result.runs.length, 1);
    assert.equal(result.runs[0].program, 'ORDERPGM');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('zeusApi knowledge access is disabled until a privacy-gated catalog exists', () => {
  const knowledge = readKnowledge({
    runtime: {
      cwd: process.cwd(),
      env: {},
    },
  });
  assert.equal(knowledge.available, false);
  assert.equal(knowledge.status, 'disabled');
  assert.match(knowledge.reason, /privacy-gated project-neutral catalog/i);
});

test('zeus rich API supports pluggable registries (analyzers, mcpTools, stages, components)', () => {
  assert.ok(zeus && typeof zeus === 'object');
  assert.ok(zeus.analyzers && typeof zeus.analyzers.registerAnalyzer === 'function');
  assert.ok(zeus.mcpTools && typeof zeus.mcpTools.registerTool === 'function');
  assert.ok(zeus.analyzeStages && typeof zeus.analyzeStages.registerStage === 'function');
  assert.ok(zeus.components && typeof zeus.components.register === 'function');

  zeus.analyzers.registerAnalyzer('test-plug', { run: () => ({ plugged: true }) });
  assert.ok(zeus.analyzers.list().some(a => a.id === 'test-plug'));
  assert.ok(zeus.analyzeStages.listStages().length > 0, 'core stages should be populated');
});

test('zeus rich API exposes investigation sessions (Prio 1)', () => {
  assert.ok(zeus && typeof zeus === 'object');
  assert.ok(zeus.investigations && typeof zeus.investigations.createOrLoad === 'function');
  assert.ok(zeus.investigations && typeof zeus.investigations.list === 'function');
  assert.ok(zeus.investigations && typeof zeus.investigations.updateFocus === 'function');

  // Basic smoke: create a temp session context (requires a dir with artifacts)
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-zeusapi-inv-'));
  const analysisDir = path.join(tempRoot, 'output', 'TESTPGM');
  fs.mkdirSync(analysisDir, { recursive: true });
  fs.writeFileSync(
    path.join(analysisDir, 'context.json'),
    JSON.stringify({ summary: { text: 'test' } }),
    'utf8'
  );

  try {
    const ctx = zeus.investigations.createOrLoad({
      outputProgramDir: analysisDir,
      goal: 'api test',
    });
    assert.ok(ctx.session);
    assert.ok(ctx.session.id);
    assert.equal(ctx.session.goal, 'api test');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
