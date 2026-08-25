'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createPopulatedGuiRun(outputRoot) {
  const program = 'ORDERPGM';
  const programDir = path.join(outputRoot, program);
  const sourceRoot = path.join(outputRoot, 'synthetic-source');
  fs.mkdirSync(programDir, { recursive: true });
  fs.mkdirSync(sourceRoot, { recursive: true });

  const files = {
    'report.md': '# Synthetic report\n\nA local E2E analysis result.\n',
    'context.json': {
      program,
      dependencies: {
        tables: [{ name: 'ORDERS' }],
        programCalls: [{ name: 'INVOICEPGM' }],
      },
    },
    'architecture.html': '<!doctype html><title>Architecture Viewer</title>',
    'program-call-tree.json': {
      rootProgram: program,
      nodes: [
        { id: program, type: 'PROGRAM' },
        { id: 'INVOICEPGM', type: 'PROGRAM' },
        { id: 'ORDERS', type: 'TABLE' },
      ],
      edges: [
        { from: program, to: 'INVOICEPGM', type: 'CALLS_PROGRAM' },
        { from: program, to: 'ORDERS', type: 'USES_TABLE' },
      ],
    },
    'db2-metadata.json': {
      tables: [
        {
          schema: 'APPDATA',
          table: 'ORDERS',
          sourceLink: {
            matchStatus: 'resolved',
            sourceEvidence: [{ file: 'ORDERPGM.rpgle', startLine: 1 }],
          },
        },
      ],
      summary: { tableCount: 1 },
    },
    'test-data.json': {
      tables: [
        {
          schema: 'APPDATA',
          table: 'ORDERS',
          rows: [{ ORDER_ID: '1001' }],
          policyDecision: { eligibility: 'allowed', maskedColumns: ['EMAIL'] },
          sourceLink: {
            matchStatus: 'resolved',
            sourceEvidence: [{ file: 'ORDERPGM.rpgle', startLine: 1 }],
          },
        },
      ],
      summary: { tableCount: 1, policySummary: { maskedTableCount: 1 } },
    },
    'ai_prompt_documentation.md': '# Documentation prompt\n\nExplain the synthetic program.\n',
    'ai_prompt_modernization.md': '# Modernization prompt\n\nImprove the synthetic program.\n',
  };

  for (const [fileName, content] of Object.entries(files)) {
    const filePath = path.join(programDir, fileName);
    if (typeof content === 'string') fs.writeFileSync(filePath, content, 'utf8');
    else writeJson(filePath, content);
  }

  const sourcePath = path.join(sourceRoot, 'ORDERPGM.rpgle');
  fs.writeFileSync(sourcePath, '// Synthetic RPGLE source for GUI E2E coverage.\n', 'utf8');

  const artifactPaths = Object.keys(files);
  const artifacts = artifactPaths.map(fileName => {
    const filePath = path.join(programDir, fileName);
    const content = fs.readFileSync(filePath);
    return {
      path: fileName,
      kind:
        path.extname(fileName) === '.md'
          ? 'markdown'
          : path.extname(fileName) === '.html'
            ? 'html'
            : 'json',
      sizeBytes: content.length,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
    };
  });
  const sourceContent = fs.readFileSync(sourcePath);
  writeJson(path.join(programDir, 'analyze-run-manifest.json'), {
    schemaVersion: 1,
    tool: { name: 'zeus-rpg-promptkit', command: 'analyze' },
    run: { status: 'succeeded', completedAt: '2026-04-13T12:00:00.000Z' },
    inputs: {
      sourceRoot: './synthetic-source',
      options: {
        guidedMode: { name: 'documentation' },
        workflowPreset: { name: 'documentation-review' },
        reproducibleEnabled: true,
      },
      sourceSnapshot: {
        root: sourceRoot,
        fileCount: 1,
        files: [
          {
            path: 'ORDERPGM.rpgle',
            sizeBytes: sourceContent.length,
            sha256: crypto.createHash('sha256').update(sourceContent).digest('hex'),
          },
        ],
      },
    },
    summary: { stageCount: 8, diagnosticCount: 0 },
    artifacts,
  });

  return { program, programDir, sourceRoot };
}

module.exports = { createPopulatedGuiRun };
