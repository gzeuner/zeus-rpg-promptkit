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
const { collectSourceFiles } = require('../collector/sourceCollector');
const { scanSourceFiles } = require('../scanner/rpgScanner');
const {
  createSourceScanCache,
  resolveDefaultSourceScanCacheDir,
} = require('../scanner/sourceScanCache');
const {
  buildCanonicalAnalysisModel,
  defaultAnalysisCache,
  enrichCanonicalAnalysisModel,
} = require('../context/canonicalAnalysisModel');
const { buildContext } = require('../context/contextBuilder');
const { optimizeContext, DEFAULT_CONTEXT_OPTIMIZER_OPTIONS } = require('../ai/contextOptimizer');
const { buildAiKnowledgeProjection } = require('../ai/knowledgeProjection');
const { estimateTokensFromObject, computeReduction } = require('../ai/tokenEstimator');
const { exportDb2Metadata, buildDb2MetadataCanonicalUpdatesFromPayload } = require('../db2/metadataExportService');
const { exportTestData } = require('../db2/testDataExportService');
const { buildDependencyGraph, buildGraphSummary } = require('../dependency/dependencyGraphBuilder');
const { buildCrossProgramGraph } = require('../dependency/crossProgramGraphBuilder');
const { pickSourceSnippet } = require('../cli/helpers/sourceSnippet');
const { runStages } = require('./runStages');
const { writeAnalyzeArtifacts } = require('./analyzeArtifactWriter');
const { readImportManifest } = require('../fetch/importManifest');
const { validateSourceFiles } = require('../source/sourceIntegrity');
const { scanIfsPaths } = require('../investigation/ifsPathScanner');
const { runFullTextSearch } = require('../investigation/fullTextSearch');
const { runDiagnosticPacks } = require('../investigation/diagnosticPackRunner');
const {
  ANALYSIS_ARTIFACT_CACHE_FILE,
  buildDb2MetadataCacheKey,
  buildTestDataCacheKey,
  readAnalysisArtifactCache,
  readCachedArtifact,
  storeCachedArtifact,
  writeAnalysisArtifactCache,
} = require('./analysisArtifactCache');
const { resolveTimestamp } = require('../reproducibility/reproducibility');

function resolvePromptContext(context, optimizedContext) {
  return optimizedContext || context;
}

function buildSourceFileMetadataMap(canonicalAnalysis) {
  return new Map((canonicalAnalysis && canonicalAnalysis.sourceFiles ? canonicalAnalysis.sourceFiles : [])
    .map((entry) => [entry.path, entry]));
}

function mergeObject(baseValue, patchValue) {
  const base = baseValue && typeof baseValue === 'object' && !Array.isArray(baseValue) ? baseValue : {};
  const patch = patchValue && typeof patchValue === 'object' && !Array.isArray(patchValue) ? patchValue : {};
  return {
    ...base,
    ...patch,
  };
}

function mergeAnalysisCache(baseValue, patchValue) {
  const base = mergeObject(defaultAnalysisCache(), baseValue);
  const patch = patchValue && typeof patchValue === 'object' ? patchValue : {};
  return {
    ...base,
    ...patch,
    sourceScan: mergeObject(base.sourceScan, patch.sourceScan),
    db2Metadata: mergeObject(base.db2Metadata, patch.db2Metadata),
    testData: mergeObject(base.testData, patch.testData),
  };
}

function createEmptyAnalysisArtifactCache() {
  return {
    schemaVersion: 1,
    kind: 'analysis-artifact-cache',
    artifacts: {},
  };
}

function ensureAnalysisArtifactCache(state) {
  if (state.analysisArtifactCache) {
    return state.analysisArtifactCache;
  }
  if (!state.outputProgramDir) {
    return createEmptyAnalysisArtifactCache();
  }
  return readAnalysisArtifactCache(state.outputProgramDir);
}

function updateOptimizedContext(optimizedContext, context, patch = {}) {
  if (!optimizedContext) {
    return null;
  }

  return {
    ...optimizedContext,
    analysisCache: context.analysisCache,
    ifsPaths: context.ifsPaths,
    searchResults: context.searchResults,
    diagnosticPacks: context.diagnosticPacks,
    db2Metadata: context.db2Metadata,
    testData: context.testData,
    notes: context.notes,
    ...patch,
  };
}

function buildScanCacheOptions(state) {
  const options = {
    ...(state.scanCacheOptions || {}),
  };

  if (state.scanCacheDir !== undefined) {
    options.cacheDir = state.scanCacheDir;
  } else if (options.cacheDir === undefined) {
    options.cacheDir = resolveDefaultSourceScanCacheDir(state.outputRoot);
  }

  return options;
}

function collectAndScanStage(state) {
  const { sourceRoot, config, logVerbose } = state;
  const scanCache = state.scanCache || createSourceScanCache(buildScanCacheOptions(state));
  const analysisArtifactCache = ensureAnalysisArtifactCache(state);
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

  const cacheStatus = mergeAnalysisCache(state.cacheStatus, {
    enabled: Boolean(scanCache.getStats().cacheDir || state.outputProgramDir),
    artifactManifestFile: state.outputProgramDir ? ANALYSIS_ARTIFACT_CACHE_FILE : null,
    sourceScan: scanCache.getStats(),
  });

  return {
    ...state,
    analysisArtifactCache,
    cacheStatus,
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
      scanCache: cacheStatus.sourceScan,
      analysisArtifactCacheEntries: Object.keys(analysisArtifactCache.artifacts || {}).length,
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
    config,
    scannableSourceFiles,
    scanSummary,
    dependencies,
    notes,
    scanCache,
    sourceMetadataByPath,
    normalizedSourceTextByRelativePath,
    sourceNormalizationSummary,
    cacheStatus,
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
    limits: config.analysisLimits,
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
    analysisCache: cacheStatus || defaultAnalysisCache(),
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
    stageDiagnostics: crossProgramGraph.diagnostics || [],
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
  const nextOptimizedContext = updateOptimizedContext(optimizedContext, nextContext, {
    ifsPaths: ifsPathReport,
    searchResults,
  });

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
  const analysisArtifactCache = ensureAnalysisArtifactCache(state);
  const currentCacheStatus = mergeAnalysisCache(state.cacheStatus);
  const currentDb2Cache = mergeObject(currentCacheStatus.db2Metadata, {});
  const currentDb2Hits = Number(currentDb2Cache.hits) || 0;
  const currentDb2Misses = Number(currentDb2Cache.misses) || 0;
  const cacheKey = outputProgramDir
    ? buildDb2MetadataCacheKey({
      program,
      dependencies: context.dependencies,
      dbConfig: config.db,
    })
    : null;
  const cachedArtifact = cacheKey && outputProgramDir
    ? readCachedArtifact(outputProgramDir, analysisArtifactCache, 'db2Metadata', cacheKey)
    : null;

  let nextAnalysisArtifactCache = analysisArtifactCache;
  let db2Export;
  let db2CacheMetadata;

  if (cachedArtifact) {
    db2Export = {
      payload: cachedArtifact.payload,
      summary: {
        ...(cachedArtifact.summary || {}),
        cacheStatus: 'hit',
      },
      notes: Array.isArray(cachedArtifact.payload.notes) ? cachedArtifact.payload.notes : [],
      diagnostics: [],
      canonicalUpdates: buildDb2MetadataCanonicalUpdatesFromPayload({
        canonicalAnalysis,
        payload: cachedArtifact.payload,
      }),
    };
    db2CacheMetadata = {
      ...currentDb2Cache,
      status: 'hit',
      hits: currentDb2Hits + 1,
      misses: currentDb2Misses,
      cacheKey,
      payloadFile: cachedArtifact.payloadFile,
      markdownFile: cachedArtifact.markdownFile,
      manifestFile: ANALYSIS_ARTIFACT_CACHE_FILE,
    };
  } else {
    db2Export = exportDb2Metadata({
      program,
      dependencies: context.dependencies,
      dbConfig: config.db,
      outputDir: outputProgramDir,
      verbose,
      canonicalAnalysis,
      context,
    });

    const exported = db2Export.summary && db2Export.summary.status === 'exported';
    if (exported && outputProgramDir && cacheKey && db2Export.payload) {
      nextAnalysisArtifactCache = storeCachedArtifact(
        analysisArtifactCache,
        'db2Metadata',
        cacheKey,
        db2Export.summary,
        db2Export.summary.file || 'db2-metadata.json',
        db2Export.summary.markdownFile || 'db2-metadata.md',
      );
      writeAnalysisArtifactCache(outputProgramDir, nextAnalysisArtifactCache);
    }

    db2CacheMetadata = {
      ...currentDb2Cache,
      status: exported ? 'miss' : (currentDb2Cache.status || 'skipped'),
      hits: currentDb2Hits,
      misses: exported ? currentDb2Misses + 1 : currentDb2Misses,
      cacheKey: exported ? cacheKey : null,
      payloadFile: exported ? (db2Export.summary.file || 'db2-metadata.json') : null,
      markdownFile: exported ? (db2Export.summary.markdownFile || 'db2-metadata.md') : null,
      manifestFile: outputProgramDir ? ANALYSIS_ARTIFACT_CACHE_FILE : null,
      reason: exported ? null : (db2Export.summary ? db2Export.summary.reason || null : null),
    };
    db2Export.summary = {
      ...(db2Export.summary || {}),
      cacheStatus: db2CacheMetadata.status,
    };
  }

  const nextCacheStatus = mergeAnalysisCache(currentCacheStatus, {
    db2Metadata: db2CacheMetadata,
  });
  const nextCanonicalAnalysis = enrichCanonicalAnalysisModel(canonicalAnalysis, {
    entities: db2Export.canonicalUpdates && db2Export.canonicalUpdates.entities ? db2Export.canonicalUpdates.entities : undefined,
    relations: db2Export.canonicalUpdates && db2Export.canonicalUpdates.relations ? db2Export.canonicalUpdates.relations : undefined,
    db2Metadata: db2Export.summary,
    analysisCache: nextCacheStatus,
    notes: db2Export.notes || [],
  });
  const nextContext = buildContext({ canonicalAnalysis: nextCanonicalAnalysis });
  const nextOptimizedContext = updateOptimizedContext(optimizedContext, nextContext, {
    db2Metadata: db2Export.summary,
  });

  return {
    ...state,
    analysisArtifactCache: nextAnalysisArtifactCache,
    cacheStatus: nextCacheStatus,
    canonicalAnalysis: nextCanonicalAnalysis,
    context: nextContext,
    optimizedContext: nextOptimizedContext,
    promptContext: resolvePromptContext(nextContext, nextOptimizedContext),
    db2Export,
    stageMetadata: {
      ...db2Export.summary,
      cache: db2CacheMetadata,
    },
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
  const analysisArtifactCache = ensureAnalysisArtifactCache(state);
  const currentCacheStatus = mergeAnalysisCache(state.cacheStatus);
  const currentTestDataCache = mergeObject(currentCacheStatus.testData, {});
  const currentTestDataHits = Number(currentTestDataCache.hits) || 0;
  const currentTestDataMisses = Number(currentTestDataCache.misses) || 0;
  const testDataConfig = {
    ...config.testData,
    limit: testDataLimit,
  };
  const cacheKey = outputProgramDir
    ? buildTestDataCacheKey({
      program,
      metadataPayload: db2Export && db2Export.payload ? db2Export.payload : null,
      dbConfig: config.db,
      testDataConfig,
    })
    : null;
  const cachedArtifact = cacheKey && outputProgramDir
    ? readCachedArtifact(outputProgramDir, analysisArtifactCache, 'testData', cacheKey)
    : null;

  let nextAnalysisArtifactCache = analysisArtifactCache;
  let testDataExport;
  let testDataCacheMetadata;

  if (cachedArtifact) {
    testDataExport = {
      payload: cachedArtifact.payload,
      summary: {
        ...(cachedArtifact.summary || {}),
        cacheStatus: 'hit',
      },
      notes: Array.isArray(cachedArtifact.payload.notes) ? cachedArtifact.payload.notes : [],
    };
    testDataCacheMetadata = {
      ...currentTestDataCache,
      status: 'hit',
      hits: currentTestDataHits + 1,
      misses: currentTestDataMisses,
      cacheKey,
      payloadFile: cachedArtifact.payloadFile,
      markdownFile: cachedArtifact.markdownFile,
      manifestFile: ANALYSIS_ARTIFACT_CACHE_FILE,
    };
  } else {
    testDataExport = exportTestData({
      program,
      dependencies: context.dependencies,
      dbConfig: config.db,
      outputDir: outputProgramDir,
      metadataPayload: db2Export ? db2Export.payload : null,
      canonicalAnalysis,
      context,
      testDataConfig,
      skipTestData,
      verbose,
    });

    const exported = testDataExport.summary && testDataExport.summary.status === 'exported';
    if (exported && outputProgramDir && cacheKey && testDataExport.payload) {
      nextAnalysisArtifactCache = storeCachedArtifact(
        analysisArtifactCache,
        'testData',
        cacheKey,
        testDataExport.summary,
        testDataExport.summary.file || 'test-data.json',
        testDataExport.summary.markdownFile || 'test-data.md',
      );
      writeAnalysisArtifactCache(outputProgramDir, nextAnalysisArtifactCache);
    }

    testDataCacheMetadata = {
      ...currentTestDataCache,
      status: exported ? 'miss' : (currentTestDataCache.status || 'skipped'),
      hits: currentTestDataHits,
      misses: exported ? currentTestDataMisses + 1 : currentTestDataMisses,
      cacheKey: exported ? cacheKey : null,
      payloadFile: exported ? (testDataExport.summary.file || 'test-data.json') : null,
      markdownFile: exported ? (testDataExport.summary.markdownFile || 'test-data.md') : null,
      manifestFile: outputProgramDir ? ANALYSIS_ARTIFACT_CACHE_FILE : null,
      reason: exported ? null : (testDataExport.summary ? testDataExport.summary.reason || null : null),
    };
    testDataExport.summary = {
      ...(testDataExport.summary || {}),
      cacheStatus: testDataCacheMetadata.status,
    };
  }

  const nextCacheStatus = mergeAnalysisCache(currentCacheStatus, {
    testData: testDataCacheMetadata,
  });
  const nextCanonicalAnalysis = enrichCanonicalAnalysisModel(canonicalAnalysis, {
    testData: testDataExport.summary,
    analysisCache: nextCacheStatus,
    notes: testDataExport.notes || [],
  });
  const nextContext = buildContext({ canonicalAnalysis: nextCanonicalAnalysis });
  const nextOptimizedContext = updateOptimizedContext(optimizedContext, nextContext, {
    testData: testDataExport.summary,
  });

  return {
    ...state,
    analysisArtifactCache: nextAnalysisArtifactCache,
    cacheStatus: nextCacheStatus,
    canonicalAnalysis: nextCanonicalAnalysis,
    context: nextContext,
    optimizedContext: nextOptimizedContext,
    promptContext: resolvePromptContext(nextContext, nextOptimizedContext),
    testDataExport,
    stageMetadata: {
      ...testDataExport.summary,
      cache: testDataCacheMetadata,
    },
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
  const nextOptimizedContext = updateOptimizedContext(optimizedContext, nextContext, {
    diagnosticPacks: diagnosticResult.report,
  });

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

function getAnalyzeCoreStages() {
  return [
    { id: 'collect-scan', run: collectAndScanStage },
    { id: 'build-context', run: buildContextStage },
    { id: 'investigate-sources', run: investigateSourcesStage },
    { id: 'optimize-context', run: optimizeContextStage },
    { id: 'export-db2', run: exportDb2Stage },
    { id: 'export-test-data', run: exportTestDataStage },
    { id: 'run-diagnostic-packs', run: runDiagnosticPacksStage },
  ];
}

function runAnalyzeCore(initialState) {
  return runStages(getAnalyzeCoreStages(), initialState);
}

function runAnalyzeArtifactAdapter(initialState) {
  return runStages([
    { id: 'write-artifacts', run: writeAnalyzeArtifacts },
  ], initialState);
}

function runAnalyzePipeline(initialState) {
  return runAnalyzeArtifactAdapter(runAnalyzeCore(initialState));
}

module.exports = {
  getAnalyzeCoreStages,
  runAnalyzeArtifactAdapter,
  runAnalyzeCore,
  runAnalyzePipeline,
};
