const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scanSourceFiles } = require('../src/scanner/rpgScanner');
const { buildCanonicalAnalysisModel } = require('../src/context/canonicalAnalysisModel');
const { buildContext } = require('../src/context/contextBuilder');
const { optimizeContext } = require('../src/ai/contextOptimizer');
const { AI_KNOWLEDGE_PROJECTION_SCHEMA_VERSION, buildAiKnowledgeProjection } = require('../src/ai/knowledgeProjection');
const { buildPrompt } = require('../src/prompt/promptBuilder');
const { buildCompactDb2TableLink, buildCompactTestDataLink, buildDb2SourceLinkage } = require('../src/db2/db2EvidenceLinker');

test('buildAiKnowledgeProjection emits a versioned prompt-ready projection with evidence and workflows', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-ai-projection-'));
  const sourceFile = path.join(tempRoot, 'ORDERPGM.sqlrpgle');

  fs.writeFileSync(sourceFile, `**FREE
dcl-s stmt varchar(500);
dcl-proc main;
  exec sql
    select ORDER_ID
      from ORDERS;

  exec sql
    prepare S1 from :stmt;
end-proc;
`, 'utf8');

  try {
    const scanSummary = scanSourceFiles([sourceFile]);
    const canonicalAnalysis = buildCanonicalAnalysisModel({
      program: 'ORDERPGM',
      sourceRoot: tempRoot,
      sourceFiles: scanSummary.sourceFiles,
      dependencies: {
        tables: scanSummary.tables,
        calls: scanSummary.calls,
        copyMembers: scanSummary.copyMembers,
        sqlStatements: scanSummary.sqlStatements,
        procedures: scanSummary.procedures,
        prototypes: scanSummary.prototypes,
        procedureCalls: scanSummary.procedureCalls,
        nativeFiles: scanSummary.nativeFiles,
        nativeFileAccesses: scanSummary.nativeFileAccesses,
        modules: scanSummary.modules,
        bindingDirectories: scanSummary.bindingDirectories,
        servicePrograms: scanSummary.servicePrograms,
      },
      notes: scanSummary.notes,
    });
    const context = buildContext({ canonicalAnalysis });
    const baseProjection = buildAiKnowledgeProjection({ canonicalAnalysis, context });
    const optimizedContext = optimizeContext(context, {
      maxSQLStatements: 1,
      maxSourceSnippets: 2,
      workflowTokenBudgets: {
        documentation: 800,
        errorAnalysis: 700,
      },
    }, baseProjection);
    const projection = buildAiKnowledgeProjection({ canonicalAnalysis, context, optimizedContext });

    assert.equal(projection.schemaVersion, AI_KNOWLEDGE_PROJECTION_SCHEMA_VERSION);
    assert.equal(projection.kind, 'ai-knowledge-projection');
    assert.equal(projection.program, 'ORDERPGM');
    assert.ok(projection.evidenceIndex.length >= 2);
    assert.ok(projection.riskMarkers.includes('Dynamic SQL detected'));
    assert.ok(projection.uncertaintyMarkers.includes('DYNAMIC_SQL'));
    assert.equal(projection.workflows.documentation.sqlStatements.length, 1);
    assert.ok(projection.workflows.documentation.tokenBudget >= 1);
    assert.ok(Array.isArray(projection.workflows.documentation.evidencePacks.sql));
    assert.ok(projection.entities.sqlStatements.some((entry) => entry.dynamic === true));
    assert.ok(projection.entities.sqlStatements.some((entry) => entry.evidenceRefs.length > 0));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('buildPrompt consumes ai-knowledge projection workflows', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-ai-prompt-'));
  const outputPath = path.join(tempRoot, 'prompt.md');

  try {
    const projection = {
      kind: 'ai-knowledge-projection',
      schemaVersion: 1,
      generatedAt: '2026-04-08T10:00:00.000Z',
      program: 'ORDERPGM',
      workflows: {
        documentation: {
          summary: 'Program ORDERPGM reads ORDERS.',
          tables: [{ name: 'ORDERS', kind: 'TABLE' }],
          programCalls: [{ name: 'INVPGM', kind: 'PROGRAM' }],
          copyMembers: [],
          sqlStatements: [{ type: 'SELECT', intent: 'READ', tables: ['ORDERS'], text: 'select * from orders' }],
          riskMarkers: ['Dynamic SQL detected'],
          uncertaintyMarkers: ['DYNAMIC_SQL'],
          evidenceHighlights: [{
            rank: 1,
            score: 120,
            file: 'ORDERPGM.sqlrpgle',
            startLine: 4,
            label: 'SQL',
            snippet: 'exec sql select * from orders;',
          }],
          dependencyGraphSummary: { nodeCount: 3, edgeCount: 2 },
          testData: { status: 'skipped' },
        },
      },
    };

    const content = buildPrompt('documentation', projection, outputPath);
    assert.match(content, /Risk markers: Dynamic SQL detected\./);
    assert.match(content, /Uncertainty markers: DYNAMIC_SQL\./);
    assert.match(content, /Evidence Highlights/);
    assert.match(content, /#1 SQL @ ORDERPGM\.sqlrpgle:4/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('buildAiKnowledgeProjection carries DB2 metadata and test data links into workflow projections', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-ai-db2-projection-'));
  const sourceFile = path.join(tempRoot, 'ORDERPGM.sqlrpgle');

  fs.writeFileSync(sourceFile, `**FREE
dcl-proc main;
  exec sql
    select ORDER_ID
      from ORDERS;
end-proc;
`, 'utf8');

  try {
    const scanSummary = scanSourceFiles([sourceFile]);
    const canonicalAnalysis = buildCanonicalAnalysisModel({
      program: 'ORDERPGM',
      sourceRoot: tempRoot,
      sourceFiles: scanSummary.sourceFiles,
      dependencies: {
        tables: scanSummary.tables,
        calls: scanSummary.calls,
        copyMembers: scanSummary.copyMembers,
        sqlStatements: scanSummary.sqlStatements,
        procedures: scanSummary.procedures,
        prototypes: scanSummary.prototypes,
        procedureCalls: scanSummary.procedureCalls,
        nativeFiles: scanSummary.nativeFiles,
        nativeFileAccesses: scanSummary.nativeFileAccesses,
        modules: scanSummary.modules,
        bindingDirectories: scanSummary.bindingDirectories,
        servicePrograms: scanSummary.servicePrograms,
      },
      notes: scanSummary.notes,
    });
    const context = buildContext({ canonicalAnalysis });
    const linkage = buildDb2SourceLinkage({
      requestedTables: ['ORDERS'],
      exportedTables: [
        {
          schema: 'APP',
          table: 'ORDERS',
          columns: [{ name: 'ORDER_ID', type: 'DECIMAL' }],
          foreignKeys: [],
        },
      ],
      canonicalAnalysis,
      context,
    });
    const tableLink = linkage.tableLinks[0];
    context.db2Metadata = {
      status: 'exported',
      file: 'db2-metadata.json',
      markdownFile: 'db2-metadata.md',
      tableCount: 1,
      requestedTableCount: 1,
      resolvedTableCount: 1,
      unresolvedTableCount: 0,
      ambiguousTableCount: 0,
      tables: [
        buildCompactDb2TableLink(tableLink, {
          schema: 'APP',
          table: 'ORDERS',
          columns: [{ name: 'ORDER_ID', type: 'DECIMAL' }],
          foreignKeys: [],
        }),
      ],
    };
    context.testData = {
      status: 'exported',
      file: 'test-data.json',
      markdownFile: 'test-data.md',
      tableCount: 1,
      requestedTableCount: 1,
      skippedTableCount: 0,
      rowLimit: 5,
      tables: [
        buildCompactTestDataLink(tableLink, {
          schema: 'APP',
          table: 'ORDERS',
          status: 'exported',
          rowCount: 2,
        }),
      ],
    };

    const projection = buildAiKnowledgeProjection({ canonicalAnalysis, context });

    assert.equal(projection.entities.db2Tables.length, 1);
    assert.equal(projection.entities.db2Tables[0].table, 'ORDERS');
    assert.ok(projection.entities.db2Tables[0].evidenceRefs.length >= 1);
    assert.equal(projection.workflows.documentation.db2Tables.length, 1);
    assert.equal(projection.workflows.documentation.testData.tables.length, 1);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
