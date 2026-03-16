/*
Copyright 2026 Guido Zeuner

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
const fs = require('fs');
const path = require('path');
const { collectSourceFiles } = require('../collector/sourceCollector');
const { scanSourceFiles } = require('../scanner/rpgScanner');
const { buildContext } = require('../context/contextBuilder');
const { buildPrompts } = require('../prompt/promptBuilder');
const { generateMarkdownReport } = require('../report/markdownReport');
const { writeJsonReport } = require('../report/jsonReport');
const { generateArchitectureReport } = require('../report/architectureReport');
const { optimizeContext, DEFAULT_CONTEXT_OPTIMIZER_OPTIONS } = require('../ai/contextOptimizer');
const { estimateTokensFromObject, computeReduction } = require('../ai/tokenEstimator');
const { generateArchitectureViewer } = require('../viewer/architectureViewerGenerator');
const { exportDb2Metadata } = require('../db2/metadataExportService');
const { exportTestData } = require('../db2/testDataExportService');
const { buildDependencyGraph, buildGraphSummary } = require('../dependency/dependencyGraphBuilder');
const { buildCrossProgramGraph } = require('../dependency/crossProgramGraphBuilder');
const {
  renderJson,
  renderMermaid,
  renderMarkdown,
  renderCrossProgramMarkdown,
} = require('../dependency/graphSerializer');
const { pickSourceSnippet } = require('../cli/helpers/sourceSnippet');
const { runStages } = require('./runStages');

function addNotes(target, notes) {
  if (!notes || notes.length === 0) {
    return;
  }
  target.notes = Array.from(new Set([...(target.notes || []), ...notes])).sort((a, b) => a.localeCompare(b));
}

function collectAndScanStage(state) {
  const { sourceRoot, config, logVerbose } = state;
  const sourceFiles = collectSourceFiles(sourceRoot, config.extensions);
  logVerbose(`Collected source files: ${sourceFiles.length}`);

  const scanSummary = scanSourceFiles(sourceFiles);
  const notes = [...(scanSummary.notes || [])];
  const stageDiagnostics = [];
  if (sourceFiles.length === 0) {
    const warning = 'No source files found for provided sourceRoot/extensions.';
    notes.push(warning);
    stageDiagnostics.push({
      severity: 'warning',
      code: 'NO_SOURCE_FILES',
      message: warning,
      details: {
        sourceRoot,
        extensions: config.extensions,
      },
    });
    console.warn(`Warning: ${warning}`);
  }

  return {
    ...state,
    sourceFiles,
    scanSummary,
    notes,
    dependencies: {
      tables: scanSummary.tables,
      calls: scanSummary.calls,
      copyMembers: scanSummary.copyMembers,
      sqlStatements: scanSummary.sqlStatements,
    },
    stageMetadata: {
      sourceFileCount: sourceFiles.length,
      scannedFileCount: (scanSummary.sourceFiles || []).length,
      tableCount: (scanSummary.tables || []).length,
      programCallCount: (scanSummary.calls || []).length,
      copyMemberCount: (scanSummary.copyMembers || []).length,
      sqlStatementCount: (scanSummary.sqlStatements || []).length,
      noteCount: notes.length,
    },
    stageDiagnostics,
  };
}

function buildContextStage(state) {
  const { program, sourceRoot, sourceFiles, scanSummary, dependencies, notes } = state;
  const context = buildContext({
    program,
    sourceRoot,
    sourceFiles: scanSummary.sourceFiles || [],
    dependencies,
    notes,
    graph: {
      nodeCount: 0,
      edgeCount: 0,
      tableCount: 0,
      programCallCount: 0,
      copyMemberCount: 0,
      files: {
        json: 'dependency-graph.json',
        mermaid: 'dependency-graph.mmd',
        markdown: 'dependency-graph.md',
      },
    },
  });

  const graph = buildDependencyGraph(context);
  context.graph = buildGraphSummary(graph);
  const crossProgramGraph = buildCrossProgramGraph({
    rootProgram: program,
    sourceFiles,
  });
  context.crossProgramGraph = {
    programCount: Number(crossProgramGraph.summary.programCount) || 0,
    tableCount: Number(crossProgramGraph.summary.tableCount) || 0,
    copyMemberCount: Number(crossProgramGraph.summary.copyMemberCount) || 0,
    edgeCount: Number(crossProgramGraph.summary.edgeCount) || 0,
    unresolvedPrograms: crossProgramGraph.unresolvedPrograms || [],
    files: {
      json: 'program-call-tree.json',
      mermaid: 'program-call-tree.mmd',
      markdown: 'program-call-tree.md',
    },
  };

  return {
    ...state,
    context,
    graph,
    crossProgramGraph,
    sourceSnippet: pickSourceSnippet(scanSummary.sourceFiles, program),
    stageMetadata: {
      dependencyGraph: buildGraphSummary(graph),
      crossProgramGraph: crossProgramGraph.summary,
      sourceSnippetFound: Boolean(pickSourceSnippet(scanSummary.sourceFiles, program)),
    },
  };
}

function optimizeContextStage(state) {
  const { context, config, optimizeContextEnabled } = state;
  const contextTokens = estimateTokensFromObject(context);

  if (!optimizeContextEnabled) {
    return {
      ...state,
      promptContext: context,
      optimizedContext: null,
      optimizationReport: {
        enabled: false,
        contextTokens,
        optimizedTokens: contextTokens,
        reductionPercent: 0,
        softTokenLimit: Number(config.contextOptimizer.softTokenLimit) || DEFAULT_CONTEXT_OPTIMIZER_OPTIONS.softTokenLimit,
        warning: false,
      },
      stageMetadata: {
        enabled: false,
        contextTokens,
        optimizedTokens: contextTokens,
        reductionPercent: 0,
      },
    };
  }

  const optimizedContext = optimizeContext(context, config.contextOptimizer);
  const optimizedTokens = estimateTokensFromObject(optimizedContext);

  return {
    ...state,
    promptContext: optimizedContext,
    optimizedContext,
    optimizationReport: {
      enabled: true,
      contextTokens,
      optimizedTokens,
      reductionPercent: computeReduction(contextTokens, optimizedTokens),
      softTokenLimit: Number(config.contextOptimizer.softTokenLimit) || DEFAULT_CONTEXT_OPTIMIZER_OPTIONS.softTokenLimit,
      warning: optimizedTokens > (Number(config.contextOptimizer.softTokenLimit) || DEFAULT_CONTEXT_OPTIMIZER_OPTIONS.softTokenLimit),
    },
    stageMetadata: {
      enabled: true,
      contextTokens,
      optimizedTokens,
      reductionPercent: computeReduction(contextTokens, optimizedTokens),
    },
    stageDiagnostics: optimizedTokens > (Number(config.contextOptimizer.softTokenLimit) || DEFAULT_CONTEXT_OPTIMIZER_OPTIONS.softTokenLimit)
      ? [{
        severity: 'warning',
        code: 'OPTIMIZED_CONTEXT_EXCEEDS_SOFT_LIMIT',
        message: 'Optimized context may exceed the configured soft token limit.',
        details: {
          optimizedTokens,
          softTokenLimit: Number(config.contextOptimizer.softTokenLimit) || DEFAULT_CONTEXT_OPTIMIZER_OPTIONS.softTokenLimit,
        },
      }]
      : [],
  };
}

function exportDb2Stage(state) {
  const { program, context, optimizedContext, config, outputProgramDir, verbose } = state;
  const db2Export = exportDb2Metadata({
    program,
    dependencies: context.dependencies,
    dbConfig: config.db,
    outputDir: outputProgramDir,
    verbose,
  });

  context.db2Metadata = db2Export.summary;
  addNotes(context, db2Export.notes);
  if (optimizedContext) {
    optimizedContext.db2Metadata = db2Export.summary;
    addNotes(optimizedContext, db2Export.notes);
  }

  return {
    ...state,
    db2Export,
    stageMetadata: db2Export.summary,
    stageDiagnostics: (db2Export.notes || []).map((message) => ({
      severity: db2Export.summary.status === 'skipped' ? 'warning' : 'info',
      code: db2Export.summary.status === 'skipped' ? 'DB2_EXPORT_SKIPPED' : 'DB2_EXPORT_NOTE',
      message,
    })),
  };
}

function exportTestDataStage(state) {
  const {
    program,
    context,
    optimizedContext,
    config,
    outputProgramDir,
    testDataLimit,
    skipTestData,
    verbose,
    db2Export,
  } = state;

  const testDataExport = exportTestData({
    program,
    dependencies: context.dependencies,
    dbConfig: config.db,
    outputDir: outputProgramDir,
    metadataPayload: db2Export.payload,
    testDataConfig: {
      ...config.testData,
      limit: testDataLimit,
    },
    skipTestData,
    verbose,
  });

  context.testData = testDataExport.summary;
  addNotes(context, testDataExport.notes);
  if (optimizedContext) {
    optimizedContext.testData = testDataExport.summary;
    addNotes(optimizedContext, testDataExport.notes);
  }

  return {
    ...state,
    testDataExport,
    stageMetadata: testDataExport.summary,
    stageDiagnostics: (testDataExport.notes || []).map((message) => ({
      severity: testDataExport.summary.status === 'skipped' ? 'warning' : 'info',
      code: testDataExport.summary.status === 'skipped' ? 'TEST_DATA_SKIPPED' : 'TEST_DATA_NOTE',
      message,
    })),
  };
}

function writeArtifactsStage(state) {
  const {
    context,
    optimizedContext,
    graph,
    crossProgramGraph,
    outputProgramDir,
    promptContext,
    sourceSnippet,
    optimizationReport,
  } = state;

  writeJsonReport(path.join(outputProgramDir, 'context.json'), context);
  if (optimizedContext) {
    writeJsonReport(path.join(outputProgramDir, 'optimized-context.json'), optimizedContext);
  }

  const programCallTreeJsonPath = path.join(outputProgramDir, 'program-call-tree.json');
  fs.writeFileSync(path.join(outputProgramDir, 'dependency-graph.json'), renderJson(graph), 'utf8');
  fs.writeFileSync(path.join(outputProgramDir, 'dependency-graph.mmd'), renderMermaid(graph), 'utf8');
  fs.writeFileSync(path.join(outputProgramDir, 'dependency-graph.md'), renderMarkdown(graph), 'utf8');
  fs.writeFileSync(programCallTreeJsonPath, renderJson(crossProgramGraph), 'utf8');
  fs.writeFileSync(path.join(outputProgramDir, 'program-call-tree.mmd'), renderMermaid(crossProgramGraph), 'utf8');
  fs.writeFileSync(path.join(outputProgramDir, 'program-call-tree.md'), renderCrossProgramMarkdown(crossProgramGraph), 'utf8');
  generateArchitectureViewer({
    graphPath: programCallTreeJsonPath,
    outputPath: path.join(outputProgramDir, 'architecture.html'),
  });

  const reportMarkdown = generateMarkdownReport(context, optimizationReport);
  generateArchitectureReport({
    contextPath: path.join(outputProgramDir, 'context.json'),
    graphPath: path.join(outputProgramDir, 'dependency-graph.json'),
    outputPath: path.join(outputProgramDir, 'architecture-report.md'),
    optimizedContextPath: optimizedContext ? path.join(outputProgramDir, 'optimized-context.json') : null,
    mermaidPath: path.join(outputProgramDir, 'dependency-graph.mmd'),
  });
  buildPrompts({
    context: promptContext,
    outputDir: outputProgramDir,
    sourceSnippet,
  });
  fs.writeFileSync(path.join(outputProgramDir, 'report.md'), reportMarkdown, 'utf8');

  return {
    ...state,
    reportMarkdown,
    generatedFiles: [
      'context.json',
      ...(optimizedContext ? ['optimized-context.json'] : []),
      'dependency-graph.json',
      'dependency-graph.mmd',
      'dependency-graph.md',
      'program-call-tree.json',
      'program-call-tree.mmd',
      'program-call-tree.md',
      'architecture.html',
      'architecture-report.md',
      'ai_prompt_documentation.md',
      'ai_prompt_error_analysis.md',
      'report.md',
    ],
    stageMetadata: {
      fileCount: optimizedContext ? 13 : 12,
      generatedFiles: [
        'context.json',
        ...(optimizedContext ? ['optimized-context.json'] : []),
        'dependency-graph.json',
        'dependency-graph.mmd',
        'dependency-graph.md',
        'program-call-tree.json',
        'program-call-tree.mmd',
        'program-call-tree.md',
        'architecture.html',
        'architecture-report.md',
        'ai_prompt_documentation.md',
        'ai_prompt_error_analysis.md',
        'report.md',
      ],
    },
  };
}

function runAnalyzePipeline(initialState) {
  return runStages([
    { id: 'collect-scan', run: collectAndScanStage },
    { id: 'build-context', run: buildContextStage },
    { id: 'optimize-context', run: optimizeContextStage },
    { id: 'export-db2', run: exportDb2Stage },
    { id: 'export-test-data', run: exportTestDataStage },
    { id: 'write-artifacts', run: writeArtifactsStage },
  ], initialState);
}

module.exports = {
  runAnalyzePipeline,
};
