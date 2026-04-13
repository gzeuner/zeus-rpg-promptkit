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
const { createSourceScanCache } = require('../scanner/sourceScanCache');
const {
  buildCanonicalAnalysisModel,
  enrichCanonicalAnalysisModel,
} = require('../context/canonicalAnalysisModel');
const { buildContext } = require('../context/contextBuilder');
const { buildPrompts, resolvePromptTemplates } = require('../prompt/promptBuilder');
const { generateMarkdownReport } = require('../report/markdownReport');
const { writeJsonReport } = require('../report/jsonReport');
const { generateArchitectureReport } = require('../report/architectureReport');
const { optimizeContext, DEFAULT_CONTEXT_OPTIMIZER_OPTIONS } = require('../ai/contextOptimizer');
const { buildAiKnowledgeProjection } = require('../ai/knowledgeProjection');
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
const { readImportManifest } = require('../fetch/importManifest');
const { validateSourceFiles } = require('../source/sourceIntegrity');
const { buildAnalysisIndex } = require('../workflow/analysisIndex');
const { getPromptContract } = require('../prompt/promptRegistry');
const { scanIfsPaths, renderIfsPathMarkdown } = require('../investigation/ifsPathScanner');
const { runFullTextSearch, renderFullTextSearchMarkdown } = require('../investigation/fullTextSearch');
const { runDiagnosticPacks, renderDiagnosticPackMarkdown } = require('../investigation/diagnosticPackRunner');
const {
  buildReproduciblePathReplacements,
  normalizeReproducibilitySettings,
  replaceExactStringsDeep,
  resolveTimestamp,
} = require('../reproducibility/reproducibility');

function resolvePromptContext(context, optimizedContext) {
  return optimizedContext || context;
}

function buildSourceFileMetadataMap(canonicalAnalysis) {
  return new Map((canonicalAnalysis && canonicalAnalysis.sourceFiles ? canonicalAnalysis.sourceFiles : [])
    .map((entry) => [entry.path, entry]));
}

function collectAndScanStage(state) {
  const { sourceRoot, config, logVerbose } = state;
  const scanCache = state.scanCache || createSourceScanCache();
  const sourceFiles = collectSourceFiles(sourceRoot, config.extensions);
  logVerbose(`Collected source files: ${sourceFiles.length}`);

  const importManifestResult = readImportManifest(sourceRoot);
  const validation = validateSourceFiles(sourceFiles, {
    rootDir: sourceRoot,
    importManifest: importManifestResult.manifest,
    importManifestPath: importManifestResult.manifestPath,
  });
  logVerbose(`Validated scannable source files: ${validation.validFiles.length}`);

  const sourceMetadataByPath = new Map(validation.results.map((result) => [result.path, result]));
  const normalizedSourceTextByRelativePath = new Map(
    validation.results
      .filter((result) => typeof result.normalizedText === 'string')
      .map((result) => [result.relativePath, result.normalizedText]),
  );
  const scanSummary = scanSourceFiles(validation.validFiles, {
    scanCache,
    sourceMetadataByPath,
  });
  const notes = [
    ...(scanSummary.notes || []),
    ...validation.results.flatMap((result) => result.issues.map((issue) => issue.message)),
  ];
  const stageDiagnostics = [];

  if (importManifestResult.error) {
    stageDiagnostics.push({
      severity: 'warning',
      code: 'IMPORT_MANIFEST_INVALID',
      message: `Import manifest could not be read: ${importManifestResult.manifestPath}`,
      details: {
        error: importManifestResult.error.message,
      },
    });
    notes.push(`Import manifest could not be read: ${importManifestResult.manifestPath}`);
  }

  for (const result of validation.results) {
    for (const issue of result.issues) {
      stageDiagnostics.push({
        severity: issue.severity,
        code: issue.code,
        message: issue.message,
        details: {
          file: result.relativePath,
        },
      });
    }
  }

  for (const diagnostic of scanSummary.diagnostics || []) {
    stageDiagnostics.push({
      severity: diagnostic.severity || 'warning',
      code: diagnostic.code || 'SCAN_DIAGNOSTIC',
      message: diagnostic.message || 'Scanner diagnostic',
      details: diagnostic.details || {},
    });
  }

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
  if (sourceFiles.length > 0 && validation.validFiles.length === 0) {
    const warning = 'No valid UTF-8 source files remained after source integrity validation.';
    notes.push(warning);
    stageDiagnostics.push({
      severity: 'warning',
      code: 'NO_SCANNABLE_SOURCE_FILES',
      message: warning,
      details: {
        sourceRoot,
      },
    });
  }

  return {
    ...state,
    scanCache,
    sourceFiles,
    scannableSourceFiles: validation.validFiles,
    sourceMetadataByPath,
    normalizedSourceTextByRelativePath,
    sourceNormalizationSummary: validation.normalizationSummary,
    importManifest: importManifestResult.manifest,
    importManifestPath: importManifestResult.manifestPath,
    scanSummary,
    notes,
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
    stageMetadata: {
      sourceFileCount: sourceFiles.length,
      scannableSourceFileCount: validation.validFiles.length,
      invalidSourceFileCount: validation.invalidCount,
      sourceValidationWarningCount: validation.warningCount,
      importManifestFound: Boolean(importManifestResult.manifest),
      scanCache: scanCache.getStats(),
      scannedFileCount: (scanSummary.sourceFiles || []).length,
      tableCount: (scanSummary.tables || []).length,
      programCallCount: (scanSummary.calls || []).length,
      copyMemberCount: (scanSummary.copyMembers || []).length,
      sqlStatementCount: (scanSummary.sqlStatements || []).length,
      procedureCount: (scanSummary.procedures || []).length,
      prototypeCount: (scanSummary.prototypes || []).length,
      procedureCallCount: (scanSummary.procedureCalls || []).length,
      nativeFileCount: (scanSummary.nativeFiles || []).length,
      nativeFileAccessCount: (scanSummary.nativeFileAccesses || []).length,
      moduleCount: (scanSummary.modules || []).length,
      bindingDirectoryCount: (scanSummary.bindingDirectories || []).length,
      serviceProgramCount: (scanSummary.servicePrograms || []).length,
      commandCount: (scanSummary.commands || []).length,
      objectUsageCount: (scanSummary.objectUsages || []).length,
      ddsFileCount: (scanSummary.ddsFiles || []).length,
      sourceTypeSummary: scanSummary.sourceTypeSummary || { byType: {}, byFamily: {} },
      sourceNormalization: validation.normalizationSummary,
      diagnosticCount: (scanSummary.diagnostics || []).length,
      noteCount: notes.length,
    },
    stageDiagnostics,
  };
}

function buildContextStage(state) {
  const {
    program,
    sourceRoot,
    scannableSourceFiles,
    scanSummary,
    dependencies,
    notes,
    scanCache,
    sourceMetadataByPath,
    normalizedSourceTextByRelativePath,
    sourceNormalizationSummary,
  } = state;

  let canonicalAnalysis = buildCanonicalAnalysisModel({
    program,
    sourceRoot,
    sourceFiles: scanSummary.sourceFiles || [],
    dependencies,
    notes,
    importManifest: state.importManifest,
    generatedAt: resolveTimestamp(state.reproducibility),
  });
  let context = buildContext({ canonicalAnalysis });

  const graph = buildDependencyGraph(context);
  const crossProgramGraph = buildCrossProgramGraph({
    rootProgram: program,
    sourceFiles: scannableSourceFiles || [],
    sourceRoot,
    importManifest: state.importManifest,
    scanCache,
    sourceMetadataByPath,
  });

  canonicalAnalysis = enrichCanonicalAnalysisModel(canonicalAnalysis, {
    graph: buildGraphSummary(graph),
    crossProgramGraph: {
      programCount: Number(crossProgramGraph.summary.programCount) || 0,
      tableCount: Number(crossProgramGraph.summary.tableCount) || 0,
      copyMemberCount: Number(crossProgramGraph.summary.copyMemberCount) || 0,
      edgeCount: Number(crossProgramGraph.summary.edgeCount) || 0,
      ambiguousPrograms: crossProgramGraph.ambiguousPrograms || [],
      unresolvedPrograms: crossProgramGraph.unresolvedPrograms || [],
      files: {
        json: 'program-call-tree.json',
        mermaid: 'program-call-tree.mmd',
        markdown: 'program-call-tree.md',
      },
    },
    sourceCatalog: crossProgramGraph.sourceCatalog,
    sourceNormalization: sourceNormalizationSummary || null,
    sourceTypeAnalysis: scanSummary.sourceTypeAnalysis || null,
  });
  context = buildContext({ canonicalAnalysis });

  const sourceSnippet = pickSourceSnippet(scanSummary.sourceFiles, program, {
    normalizedSourceTextByRelativePath,
    sourceRoot,
  });

  return {
    ...state,
    canonicalAnalysis,
    context,
    graph,
    crossProgramGraph,
    sourceSnippet,
    stageMetadata: {
      canonicalAnalysis: {
        schemaVersion: canonicalAnalysis.schemaVersion,
        relationCount: canonicalAnalysis.relations.length,
        sourceFileCount: canonicalAnalysis.sourceFiles.length,
      },
      dependencyGraph: buildGraphSummary(graph),
      crossProgramGraph: crossProgramGraph.summary,
      sourceCatalog: crossProgramGraph.sourceCatalog,
      scanCache: scanCache ? scanCache.getStats() : null,
      sourceSnippetFound: Boolean(sourceSnippet),
    },
  };
}

function investigateSourcesStage(state) {
  const {
    canonicalAnalysis,
    context,
    optimizedContext,
    normalizedSourceTextByRelativePath,
    scanIfsPathsEnabled,
    searchTerms,
    searchIgnorePatterns,
    searchMaxResults,
  } = state;
  const sourceFileMetadata = buildSourceFileMetadataMap(canonicalAnalysis);
  const ifsPathReport = scanIfsPaths(normalizedSourceTextByRelativePath, {
    enabled: scanIfsPathsEnabled,
  });
  const searchResults = runFullTextSearch(normalizedSourceTextByRelativePath, sourceFileMetadata, {
    terms: searchTerms,
    ignorePatterns: searchIgnorePatterns,
    maxResults: searchMaxResults,
  });

  const nextCanonicalAnalysis = enrichCanonicalAnalysisModel(canonicalAnalysis, {
    ifsPaths: ifsPathReport,
    searchResults,
  });
  const nextContext = buildContext({ canonicalAnalysis: nextCanonicalAnalysis });
  const nextOptimizedContext = optimizedContext
    ? {
      ...optimizedContext,
      ifsPaths: ifsPathReport,
      searchResults,
      notes: nextContext.notes,
    }
    : null;

  return {
    ...state,
    canonicalAnalysis: nextCanonicalAnalysis,
    context: nextContext,
    optimizedContext: nextOptimizedContext,
    promptContext: resolvePromptContext(nextContext, nextOptimizedContext),
    ifsPathReport,
    searchResults,
    stageMetadata: {
      ifsPathScanEnabled: Boolean(scanIfsPathsEnabled),
      ifsPathCount: Number(ifsPathReport.summary.uniquePathCount) || 0,
      searchEnabled: Boolean((searchTerms || []).length > 0),
      searchTermCount: (searchResults.terms || []).length,
      searchMatchCount: Number(searchResults.summary.matchCount) || 0,
      searchTruncated: Boolean(searchResults.summary.truncated),
    },
    stageDiagnostics: (searchResults.notes || []).map((message) => ({
      severity: 'warning',
      code: 'SEARCH_RESULT_LIMIT',
      message,
    })),
  };
}

function optimizeContextStage(state) {
  const { canonicalAnalysis, context, config, optimizeContextEnabled } = state;
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

  const baseAiProjection = buildAiKnowledgeProjection({
    canonicalAnalysis,
    context,
    optimizedContext: null,
  });
  const optimizedContext = optimizeContext(context, config.contextOptimizer, baseAiProjection);
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
  const {
    program,
    canonicalAnalysis,
    context,
    optimizedContext,
    config,
    outputProgramDir,
    verbose,
  } = state;
  const db2Export = exportDb2Metadata({
    program,
    dependencies: context.dependencies,
    dbConfig: config.db,
    outputDir: outputProgramDir,
    verbose,
    canonicalAnalysis,
    context,
  });

  const nextCanonicalAnalysis = enrichCanonicalAnalysisModel(canonicalAnalysis, {
    entities: db2Export.canonicalUpdates && db2Export.canonicalUpdates.entities ? db2Export.canonicalUpdates.entities : undefined,
    relations: db2Export.canonicalUpdates && db2Export.canonicalUpdates.relations ? db2Export.canonicalUpdates.relations : undefined,
    db2Metadata: db2Export.summary,
    notes: db2Export.notes || [],
  });
  const nextContext = buildContext({ canonicalAnalysis: nextCanonicalAnalysis });
  const nextOptimizedContext = optimizedContext
    ? {
      ...optimizedContext,
      db2Metadata: db2Export.summary,
      notes: nextContext.notes,
    }
    : null;

  return {
    ...state,
    canonicalAnalysis: nextCanonicalAnalysis,
    context: nextContext,
    optimizedContext: nextOptimizedContext,
    promptContext: resolvePromptContext(nextContext, nextOptimizedContext),
    db2Export,
    stageMetadata: db2Export.summary,
    stageDiagnostics: [
      ...(db2Export.notes || []).map((message) => ({
        severity: db2Export.summary.status === 'skipped' ? 'warning' : 'info',
        code: db2Export.summary.status === 'skipped' ? 'DB2_EXPORT_SKIPPED' : 'DB2_EXPORT_NOTE',
        message,
      })),
      ...((db2Export.diagnostics || []).map((entry) => ({
        severity: entry.severity || 'warning',
        code: entry.code || 'DB2_EXPORT_DIAGNOSTIC',
        message: entry.message || 'DB2 export diagnostic',
        details: entry.details || {},
      }))),
    ],
  };
}

function exportTestDataStage(state) {
  const {
    program,
    canonicalAnalysis,
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
    canonicalAnalysis,
    context,
    testDataConfig: {
      ...config.testData,
      limit: testDataLimit,
    },
    skipTestData,
    verbose,
  });

  const nextCanonicalAnalysis = enrichCanonicalAnalysisModel(canonicalAnalysis, {
    testData: testDataExport.summary,
    notes: testDataExport.notes || [],
  });
  const nextContext = buildContext({ canonicalAnalysis: nextCanonicalAnalysis });
  const nextOptimizedContext = optimizedContext
    ? {
      ...optimizedContext,
      testData: testDataExport.summary,
      notes: nextContext.notes,
    }
    : null;

  return {
    ...state,
    canonicalAnalysis: nextCanonicalAnalysis,
    context: nextContext,
    optimizedContext: nextOptimizedContext,
    promptContext: resolvePromptContext(nextContext, nextOptimizedContext),
    testDataExport,
    stageMetadata: testDataExport.summary,
    stageDiagnostics: (testDataExport.notes || []).map((message) => ({
      severity: testDataExport.summary.status === 'skipped' ? 'warning' : 'info',
      code: testDataExport.summary.status === 'skipped' ? 'TEST_DATA_SKIPPED' : 'TEST_DATA_NOTE',
      message,
    })),
  };
}

function runDiagnosticPacksStage(state) {
  const {
    canonicalAnalysis,
    context,
    optimizedContext,
    diagnosticPacks,
    diagnosticParameterString,
    config,
    ibmiConfig,
    reproducibility,
    verbose,
  } = state;
  const diagnosticResult = runDiagnosticPacks({
    packNames: diagnosticPacks,
    parameterString: diagnosticParameterString,
    dbConfig: config.db,
    ibmiConfig,
    reproducibility,
    verbose,
    executors: state.diagnosticExecutors || null,
  });

  const nextCanonicalAnalysis = enrichCanonicalAnalysisModel(canonicalAnalysis, {
    diagnosticPacks: diagnosticResult.report,
    notes: diagnosticResult.notes || [],
  });
  const nextContext = buildContext({ canonicalAnalysis: nextCanonicalAnalysis });
  const nextOptimizedContext = optimizedContext
    ? {
      ...optimizedContext,
      diagnosticPacks: diagnosticResult.report,
      notes: nextContext.notes,
    }
    : null;

  return {
    ...state,
    canonicalAnalysis: nextCanonicalAnalysis,
    context: nextContext,
    optimizedContext: nextOptimizedContext,
    promptContext: resolvePromptContext(nextContext, nextOptimizedContext),
    diagnosticPackReport: diagnosticResult.report,
    diagnosticPackManifest: diagnosticResult.manifest,
    stageMetadata: {
      enabled: Boolean((diagnosticPacks || []).length > 0),
      packCount: Number(diagnosticResult.report.summary.packCount) || 0,
      failedPackCount: Number(diagnosticResult.report.summary.failedPackCount) || 0,
      stepCount: Number(diagnosticResult.report.summary.stepCount) || 0,
    },
    stageDiagnostics: (diagnosticResult.notes || []).map((message) => ({
      severity: 'warning',
      code: 'DIAGNOSTIC_PACK_NOTE',
      message,
    })),
  };
}

function writeArtifactsStage(state) {
  const {
    canonicalAnalysis,
    context,
    optimizedContext,
    graph,
    crossProgramGraph,
    outputProgramDir,
    promptContext,
    sourceSnippet,
    optimizationReport,
    promptTemplates,
    workflowMode,
    workflowModeSettings,
    workflowPreset,
    reproducibility,
    normalizedSourceTextByRelativePath,
    ifsPathReport,
    searchResults,
    diagnosticPackReport,
    diagnosticPackManifest,
  } = state;
  const reproducibilitySettings = normalizeReproducibilitySettings(reproducibility);
  const selectedPromptTemplates = resolvePromptTemplates(promptTemplates);

  const aiKnowledge = buildAiKnowledgeProjection({
    canonicalAnalysis,
    context,
    optimizedContext,
    sourceTextByRelativePath: normalizedSourceTextByRelativePath,
  });

  const generatedPromptFiles = selectedPromptTemplates.map((templateName) => getPromptContract(templateName).outputFileName);
  const generatedDb2Files = context.db2Metadata && context.db2Metadata.status === 'exported'
    ? [
      context.db2Metadata.file || 'db2-metadata.json',
      context.db2Metadata.markdownFile || 'db2-metadata.md',
    ]
    : [];
  const generatedTestDataFiles = context.testData && context.testData.status === 'exported'
    ? [
      context.testData.file || 'test-data.json',
      context.testData.markdownFile || 'test-data.md',
    ]
    : [];
  const generatedInvestigationFiles = [];
  if (ifsPathReport && ifsPathReport.enabled) {
    generatedInvestigationFiles.push('ifs-paths.json', 'ifs-paths.md');
  }
  if (searchResults && searchResults.enabled) {
    generatedInvestigationFiles.push('search-results.json', 'search-results.md');
  }
  if (diagnosticPackReport && diagnosticPackReport.enabled) {
    generatedInvestigationFiles.push(
      'diagnostic-query-packs.json',
      'diagnostic-query-packs.md',
      'diagnostic-query-pack-manifest.json',
    );
  }
  const generatedFiles = [
    'canonical-analysis.json',
    'context.json',
    ...(optimizedContext ? ['optimized-context.json'] : []),
    'ai-knowledge.json',
    'analysis-index.json',
    'dependency-graph.json',
    'dependency-graph.mmd',
    'dependency-graph.md',
    'program-call-tree.json',
    'program-call-tree.mmd',
    'program-call-tree.md',
    'architecture.html',
    'architecture-report.md',
    ...generatedDb2Files,
    ...generatedTestDataFiles,
    ...generatedInvestigationFiles,
    ...generatedPromptFiles,
    'report.md',
  ];
  const analysisIndex = buildAnalysisIndex({
    canonicalAnalysis,
    context,
    aiKnowledge,
    generatedFiles,
    selectedMode: workflowMode,
    derivedModeSettings: workflowModeSettings,
    selectedPreset: workflowPreset,
  });
  const pathReplacements = reproducibilitySettings.enabled
    ? buildReproduciblePathReplacements({
      cwd: process.cwd(),
      sourceRoot: state.sourceRoot,
      outputRoot: state.outputRoot,
      outputProgramDir,
      program: state.program,
    })
    : null;
  const writtenCanonicalAnalysis = reproducibilitySettings.enabled
    ? replaceExactStringsDeep(canonicalAnalysis, pathReplacements)
    : canonicalAnalysis;
  const writtenContext = reproducibilitySettings.enabled
    ? replaceExactStringsDeep(context, pathReplacements)
    : context;
  const writtenOptimizedContext = reproducibilitySettings.enabled && optimizedContext
    ? replaceExactStringsDeep(optimizedContext, pathReplacements)
    : optimizedContext;
  const writtenAiKnowledge = reproducibilitySettings.enabled
    ? replaceExactStringsDeep(aiKnowledge, pathReplacements)
    : aiKnowledge;
  const writtenAnalysisIndex = reproducibilitySettings.enabled
    ? replaceExactStringsDeep(analysisIndex, pathReplacements)
    : analysisIndex;

  writeJsonReport(path.join(outputProgramDir, 'canonical-analysis.json'), writtenCanonicalAnalysis);
  writeJsonReport(path.join(outputProgramDir, 'context.json'), writtenContext);
  if (writtenOptimizedContext) {
    writeJsonReport(path.join(outputProgramDir, 'optimized-context.json'), writtenOptimizedContext);
  }
  writeJsonReport(path.join(outputProgramDir, 'ai-knowledge.json'), writtenAiKnowledge);
  if (ifsPathReport && ifsPathReport.enabled) {
    writeJsonReport(path.join(outputProgramDir, 'ifs-paths.json'), ifsPathReport);
    fs.writeFileSync(path.join(outputProgramDir, 'ifs-paths.md'), renderIfsPathMarkdown(ifsPathReport), 'utf8');
  }
  if (searchResults && searchResults.enabled) {
    writeJsonReport(path.join(outputProgramDir, 'search-results.json'), searchResults);
    fs.writeFileSync(path.join(outputProgramDir, 'search-results.md'), renderFullTextSearchMarkdown(searchResults), 'utf8');
  }
  if (diagnosticPackReport && diagnosticPackReport.enabled) {
    writeJsonReport(path.join(outputProgramDir, 'diagnostic-query-packs.json'), diagnosticPackReport);
    writeJsonReport(path.join(outputProgramDir, 'diagnostic-query-pack-manifest.json'), diagnosticPackManifest);
    fs.writeFileSync(
      path.join(outputProgramDir, 'diagnostic-query-packs.md'),
      renderDiagnosticPackMarkdown(diagnosticPackReport),
      'utf8',
    );
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

  const reportMarkdown = generateMarkdownReport(writtenContext, optimizationReport);
  generateArchitectureReport({
    contextPath: path.join(outputProgramDir, 'context.json'),
    graphPath: path.join(outputProgramDir, 'dependency-graph.json'),
    outputPath: path.join(outputProgramDir, 'architecture-report.md'),
    optimizedContextPath: writtenOptimizedContext ? path.join(outputProgramDir, 'optimized-context.json') : null,
    mermaidPath: path.join(outputProgramDir, 'dependency-graph.mmd'),
  });
  buildPrompts({
    aiProjection: writtenAiKnowledge,
    outputDir: outputProgramDir,
    sourceSnippet,
    templates: selectedPromptTemplates,
  });
  fs.writeFileSync(path.join(outputProgramDir, 'report.md'), reportMarkdown, 'utf8');
  writeJsonReport(path.join(outputProgramDir, 'analysis-index.json'), writtenAnalysisIndex);

  return {
    ...state,
    reportMarkdown,
    analysisIndex: writtenAnalysisIndex,
    generatedFiles,
    stageMetadata: {
      fileCount: generatedFiles.length,
      generatedFiles,
      workflowMode: workflowMode || null,
      workflowPreset: workflowPreset ? workflowPreset.name : null,
      promptTemplateCount: selectedPromptTemplates.length,
    },
  };
}

function runAnalyzePipeline(initialState) {
  return runStages([
    { id: 'collect-scan', run: collectAndScanStage },
    { id: 'build-context', run: buildContextStage },
    { id: 'investigate-sources', run: investigateSourcesStage },
    { id: 'optimize-context', run: optimizeContextStage },
    { id: 'export-db2', run: exportDb2Stage },
    { id: 'export-test-data', run: exportTestDataStage },
    { id: 'run-diagnostic-packs', run: runDiagnosticPacksStage },
    { id: 'write-artifacts', run: writeArtifactsStage },
  ], initialState);
}

module.exports = {
  runAnalyzePipeline,
};
