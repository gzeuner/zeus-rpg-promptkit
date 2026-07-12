const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { listRuns, readArtifact, readRun, readRunViews } = require('../src/api/zeusApi');

function createUiFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-explorer-api-'));
  const outputRoot = path.join(tempRoot, 'output');
  const programDir = path.join(outputRoot, 'ORDERPGM');
  const safeDir = path.join(programDir, 'safe-sharing');
  fs.mkdirSync(safeDir, { recursive: true });

  fs.writeFileSync(path.join(programDir, 'report.md'), '# Report\n\nSummary.\n', 'utf8');
  fs.writeFileSync(
    path.join(programDir, 'context.json'),
    `${JSON.stringify(
      {
        program: 'ORDERPGM',
        dependencies: {
          tables: [{ name: 'ORDERS' }],
          programCalls: [{ name: 'INVPGM' }],
        },
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(programDir, 'architecture.html'),
    '<!doctype html><title>Architecture Viewer</title>',
    'utf8'
  );
  fs.writeFileSync(
    path.join(programDir, 'program-call-tree.json'),
    `${JSON.stringify(
      {
        rootProgram: 'ORDERPGM',
        nodes: [
          { id: 'ORDERPGM', type: 'PROGRAM' },
          { id: 'ORDERS', type: 'TABLE' },
        ],
        edges: [{ from: 'ORDERPGM', to: 'ORDERS', type: 'USES_TABLE' }],
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(programDir, 'db2-metadata.json'),
    `${JSON.stringify(
      {
        tables: [
          {
            schema: 'MYLIB',
            table: 'ORDERS',
            sourceLink: {
              matchStatus: 'resolved',
              sourceEvidence: [{ file: 'ORDERPGM.rpgle', startLine: 1 }],
            },
          },
        ],
        summary: {
          tableCount: 1,
        },
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(programDir, 'test-data.json'),
    `${JSON.stringify(
      {
        tables: [
          {
            schema: 'MYLIB',
            table: 'ORDERS',
            rows: [{ ORDER_ID: '1001' }],
            policyDecision: {
              eligibility: 'allowed',
              maskedColumns: ['EMAIL'],
            },
            sourceLink: {
              matchStatus: 'resolved',
              sourceEvidence: [{ file: 'ORDERPGM.rpgle', startLine: 1 }],
            },
          },
        ],
        summary: {
          tableCount: 1,
        },
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(programDir, 'ai_prompt_documentation.md'),
    '# Documentation Prompt\n',
    'utf8'
  );
  fs.writeFileSync(path.join(safeDir, 'report.md'), '# Safe Report\n', 'utf8');
  fs.writeFileSync(
    path.join(programDir, 'analyze-run-manifest.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        tool: { name: 'zeus-rpg-promptkit', command: 'analyze' },
        run: {
          status: 'succeeded',
          completedAt: '2026-04-13T12:00:00.000Z',
        },
        inputs: {
          sourceRoot: 'C:/temp/src',
          options: {
            guidedMode: { name: 'documentation' },
            workflowPreset: { name: 'onboarding' },
            reproducibleEnabled: false,
          },
        },
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  return {
    tempRoot,
    outputRoot,
  };
}

test('zeusApi exposes direct explorer access for runs, views, and artifacts', () => {
  const { tempRoot, outputRoot } = createUiFixture();

  try {
    const listed = listRuns('unused', {
      sourceOutputRoot: outputRoot,
    });
    assert.equal(listed.runs.length, 1);
    assert.equal(listed.runs[0].program, 'ORDERPGM');

    const run = readRun('unused', 'ORDERPGM', {
      sourceOutputRoot: outputRoot,
    });
    assert.equal(run.run.summary.program, 'ORDERPGM');
    assert.equal(run.run.views.graph.available, true);
    assert.equal(run.run.views.db2.tables.length, 1);

    const views = readRunViews('unused', 'ORDERPGM', {
      sourceOutputRoot: outputRoot,
    });
    assert.equal(views.views.summary.graphNodeCount, 2);
    assert.equal(views.views.prompts.artifacts.length, 1);

    const artifact = readArtifact('unused', 'ORDERPGM', 'report.md', {
      sourceOutputRoot: outputRoot,
    });
    assert.equal(artifact.artifact.kind, 'markdown');
    assert.match(artifact.artifact.content, /Summary\./);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
