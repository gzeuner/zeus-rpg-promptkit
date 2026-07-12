const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildWorkspaceIndex,
  writeWorkspaceIndex,
} = require('../src/workspace/workspaceIndexBuilder');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('buildWorkspaceIndex aggregates runs, source members, and reports', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-workspace-index-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  const outputDir = path.join(workspacePath, 'output');
  const programDir = path.join(outputDir, 'ORDERPGM');
  const sourceDir = path.join(workspacePath, 'rpg_sources');

  fs.mkdirSync(programDir, { recursive: true });
  writeJson(path.join(programDir, 'analyze-run-manifest.json'), {
    schemaVersion: 1,
    run: {
      status: 'succeeded',
      completedAt: '2026-05-18T09:00:00.000Z',
    },
    inputs: {
      sourceRoot: 'C:/src',
      options: {
        guidedMode: {
          name: 'documentation',
        },
      },
    },
  });
  fs.writeFileSync(path.join(programDir, 'report.md'), '# Report\n', 'utf8');
  fs.writeFileSync(path.join(programDir, 'context.json'), '{"ok":true}\n', 'utf8');
  fs.writeFileSync(
    path.join(programDir, 'architecture-report.md'),
    '# Architecture Report\n',
    'utf8'
  );

  fs.mkdirSync(path.join(sourceDir, 'QRPGLESRC'), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'QCLLESRC'), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'QRPGLESRC', 'ORDERPGM.rpgle'), 'dcl-proc X;\n', 'utf8');
  fs.writeFileSync(path.join(sourceDir, 'QRPGLESRC', 'ORDERSRV.rpgle'), 'dcl-proc Y;\n', 'utf8');
  fs.writeFileSync(path.join(sourceDir, 'QCLLESRC', 'ORDERCL.clle'), 'PGM\n', 'utf8');

  const index = buildWorkspaceIndex(workspacePath, {
    id: 'workspace-a',
    name: 'Workspace A',
    outputDir: 'output',
    sourceDir: 'rpg_sources',
  });

  assert.equal(index.id, 'workspace-a');
  assert.equal(index.programs.length, 1);
  assert.equal(index.programs[0].name, 'ORDERPGM');
  assert.equal(index.programs[0].workflowMode, 'documentation');
  assert.equal(index.sourceMembers.QRPGLESRC, 2);
  assert.equal(index.sourceMembers.QCLLESRC, 1);
  assert.ok(index.reports.some(entry => /architecture-report\.md$/i.test(entry.path)));
});

test('writeWorkspaceIndex persists workspace-index.json', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-workspace-index-write-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  fs.mkdirSync(path.join(workspacePath, 'output'), { recursive: true });

  const result = writeWorkspaceIndex(workspacePath, {
    id: 'workspace-b',
    name: 'Workspace B',
  });

  assert.equal(path.basename(result.path), 'workspace-index.json');
  assert.equal(fs.existsSync(result.path), true);
  const saved = JSON.parse(fs.readFileSync(result.path, 'utf8'));
  assert.equal(saved.id, 'workspace-b');
});
