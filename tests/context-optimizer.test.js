const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scanSourceFiles } = require('../src/scanner/rpgScanner');
const { buildCanonicalAnalysisModel } = require('../src/context/canonicalAnalysisModel');
const { buildContext } = require('../src/context/contextBuilder');
const { optimizeContext } = require('../src/ai/contextOptimizer');
const { buildAiKnowledgeProjection } = require('../src/ai/knowledgeProjection');

test('optimizeContext keeps high-risk SQL, native file, and error-path evidence under workflow budgets', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-context-optimizer-'));
  const sourceFile = path.join(tempRoot, 'RISKYPGM.sqlrpgle');

  fs.writeFileSync(sourceFile, `**FREE
ctl-opt dftactgrp(*no);
dcl-f CustFile usage(*update) keyed;
dcl-s stmt varchar(500);

dcl-proc main;
  monitor;
    chain CustKey CustFile;
    update CustFmt;

    exec sql
      prepare S1 from :stmt;

    if sqlcod <> 0;
      rollback;
    endif;
  on-error;
    rollback;
  endmon;
end-proc;
`, 'utf8');

  try {
    const scanSummary = scanSourceFiles([sourceFile]);
    const canonicalAnalysis = buildCanonicalAnalysisModel({
      program: 'RISKYPGM',
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
    const optimized = optimizeContext(context, {
      maxTables: 5,
      maxProgramCalls: 4,
      maxCopyMembers: 2,
      maxSQLStatements: 2,
      maxSourceSnippets: 6,
      workflowTokenBudgets: {
        documentation: 900,
        errorAnalysis: 700,
      },
    }, baseProjection);

    assert.equal(optimized.optimization.strategy, 'salience-ranked-evidence-packs');
    assert.equal(optimized.workflows.documentation.tokenBudget, 900);
    assert.equal(optimized.workflows.errorAnalysis.tokenBudget, 700);
    assert.ok(optimized.workflows.errorAnalysis.estimatedTokens <= 700);
    assert.ok(optimized.workflows.errorAnalysis.sqlStatements.some((entry) => entry.dynamic === true));
    assert.ok(optimized.workflows.errorAnalysis.nativeFiles.some((entry) => entry.mutating === true));
    assert.ok(optimized.workflows.errorAnalysis.evidencePacks.errorPaths.some((entry) => /ON-ERROR|ROLLBACK|SQLCOD/i.test(entry.snippet)));
    assert.ok(optimized.workflows.documentation.evidenceHighlights[0].rank === 1);
    assert.ok(optimized.snippets.some((entry) => entry.category === 'sql' || entry.category === 'errorPaths'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
