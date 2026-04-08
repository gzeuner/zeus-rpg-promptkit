const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scanSourceFiles } = require('../src/scanner/rpgScanner');
const { buildCanonicalAnalysisModel } = require('../src/context/canonicalAnalysisModel');
const { buildContext } = require('../src/context/contextBuilder');
const { buildDependencyGraph } = require('../src/dependency/dependencyGraphBuilder');
const { runAnalyzePipeline } = require('../src/analyze/analyzePipeline');

test('canonical analysis models modules, service programs, binding directories, and bind relations', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-binding-semantics-'));
  const moduleFile = path.join(tempRoot, 'ORDMOD.rpgle');
  const binderFile = path.join(tempRoot, 'ORDERSRV.bnd');

  fs.writeFileSync(moduleFile, `**FREE
ctl-opt nomain bnddir('APPBNDDIR') bndsrvpgm('ORDERSRV');

dcl-pr ProcessOrder extproc('PROCESSORDER');
end-pr;

dcl-proc LocalExport export;
end-proc;
`, 'utf8');

  fs.writeFileSync(binderFile, `STRPGMEXP PGMLVL(*CURRENT)
  EXPORT SYMBOL('LOCALEXPORT')
ENDPGMEXP
`, 'utf8');

  try {
    const scanSummary = scanSourceFiles([moduleFile, binderFile]);
    const canonicalAnalysis = buildCanonicalAnalysisModel({
      program: 'ORDMOD',
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
    const graph = buildDependencyGraph(context);

    assert.ok(canonicalAnalysis.entities.modules.some((entry) => entry.name === 'ORDMOD'));
    assert.ok(canonicalAnalysis.entities.servicePrograms.some((entry) => entry.name === 'ORDERSRV'));
    assert.ok(canonicalAnalysis.entities.bindingDirectories.some((entry) => entry.name === 'APPBNDDIR'));
    assert.ok(canonicalAnalysis.relations.some((entry) => entry.type === 'HAS_MODULE'));
    assert.ok(canonicalAnalysis.relations.some((entry) => entry.type === 'USES_BINDING_DIRECTORY'));
    assert.ok(canonicalAnalysis.relations.some((entry) => entry.type === 'BINDS_SERVICE_PROGRAM'));
    assert.ok(canonicalAnalysis.relations.some((entry) => entry.type === 'IMPORTS_PROCEDURE'));
    assert.ok(canonicalAnalysis.relations.some((entry) => entry.type === 'EXPORTS_PROCEDURE'));
    assert.equal(context.bindingAnalysis.summary.moduleCount, 1);
    assert.equal(context.bindingAnalysis.summary.serviceProgramCount, 1);
    assert.equal(context.bindingAnalysis.summary.bindingDirectoryCount, 1);
    assert.equal(context.bindingAnalysis.summary.unresolvedModuleCount, 0);
    assert.ok(graph.edges.some((edge) => edge.type === 'BINDS_SERVICE_PROGRAM'));
    assert.ok(graph.edges.some((edge) => edge.type === 'USES_BINDING_DIRECTORY'));
    assert.equal(graph.summary.bindEdgeCount >= 3, true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('analyze pipeline surfaces structured unresolved binding diagnostics', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-binding-diagnostics-'));
  const sourceRoot = path.join(tempRoot, 'src');
  const outputRoot = path.join(tempRoot, 'out');
  const outputProgramDir = path.join(outputRoot, 'ORDMOD');

  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(outputProgramDir, { recursive: true });

  fs.writeFileSync(path.join(sourceRoot, 'ORDMOD.rpgle'), `**FREE
dcl-pr ProcessOrder extproc('PROCESSORDER');
end-pr;
`, 'utf8');

  fs.writeFileSync(path.join(sourceRoot, 'ORDERSRV.bnd'), `STRPGMEXP PGMLVL(*CURRENT)
  EXPORT SYMBOL('MISSINGEXPORT')
ENDPGMEXP
`, 'utf8');

  try {
    const result = runAnalyzePipeline({
      program: 'ORDMOD',
      sourceRoot,
      outputRoot,
      outputProgramDir,
      config: {
        extensions: ['.rpgle', '.bnd'],
        contextOptimizer: {},
        testData: { limit: 10, maskColumns: [] },
        db: null,
      },
      testDataLimit: 10,
      skipTestData: true,
      verbose: false,
      optimizeContextEnabled: false,
      logVerbose() {},
    });

    const collectStage = result.stageReports.find((stage) => stage.id === 'collect-scan');
    assert.ok(collectStage);
    assert.ok(collectStage.diagnostics.some((entry) => entry.code === 'UNRESOLVED_BINDING_IMPORTS'));
    assert.ok(collectStage.diagnostics.some((entry) => entry.code === 'UNRESOLVED_BINDER_EXPORT'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
