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
const { buildPrompts, resolvePromptTemplates } = require('../prompt/promptBuilder');
const { generateMarkdownReport } = require('../report/markdownReport');
const { writeJsonReport } = require('../report/jsonReport');
const { generateArchitectureReport } = require('../report/architectureReport');
const { buildAiKnowledgeProjection } = require('../ai/knowledgeProjection');
const {
  generateArchitectureViewer,
  getArchitectureViewerAssetMetadata,
} = require('../viewer/architectureViewerGenerator');
const { buildAnalysisIndex } = require('../workflow/analysisIndex');
const { getPromptContract } = require('../prompt/promptRegistry');
const { renderIfsPathMarkdown } = require('../investigation/ifsPathScanner');
const { renderFullTextSearchMarkdown } = require('../investigation/fullTextSearch');
const { renderDiagnosticPackMarkdown } = require('../investigation/diagnosticPackRunner');
const {
  renderJson,
  renderMermaid,
  renderMarkdown,
  renderCrossProgramMarkdown,
} = require('../dependency/graphSerializer');
const {
  buildReproduciblePathReplacements,
  normalizeReproducibilitySettings,
  replaceExactStringsDeep,
} = require('../reproducibility/reproducibility');

function buildAnalysisDiagnostics(state) {
  return {
    schemaVersion: 1,
    kind: 'analysis-diagnostics',
    program: state.program,
    workflowMode: state.workflowMode || null,
    workflowPreset: state.workflowPreset ? state.workflowPreset.name : null,
    generatedAt: state.context ? state.context.scannedAt : null,
    cacheStatus: state.cacheStatus || null,
    diagnostics: Array.isArray(state.diagnostics) ? state.diagnostics : [],
    stages: Array.isArray(state.stageReports) ? state.stageReports.map((stage) => ({
      id: stage.id,
      status: stage.status,
      durationMs: stage.durationMs,
      definition: stage.definition || null,
      metadata: stage.metadata || {},
      diagnostics: stage.diagnostics || [],
    })) : [],
  };
}

function writeAnalyzeArtifacts(state) {
  const {
    canonicalAnalysis,
    context,
    optimizedContext,
    graph,
    crossProgramGraph,
    outputProgramDir,
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
    emitDiagnostics,
    config,
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
    ...(emitDiagnostics ? ['analysis-diagnostics.json'] : []),
  ];
  const viewerAssetMetadata = getArchitectureViewerAssetMetadata();
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
    tokenBudgets: config && config.tokenBudget ? config.tokenBudget : null,
  });
  fs.writeFileSync(path.join(outputProgramDir, 'report.md'), reportMarkdown, 'utf8');
  writeJsonReport(path.join(outputProgramDir, 'analysis-index.json'), writtenAnalysisIndex);

  if (emitDiagnostics) {
    const diagnosticsPayload = reproducibilitySettings.enabled
      ? replaceExactStringsDeep(buildAnalysisDiagnostics(state), pathReplacements)
      : buildAnalysisDiagnostics(state);
    writeJsonReport(path.join(outputProgramDir, 'analysis-diagnostics.json'), diagnosticsPayload);
  }

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
      diagnosticsFileWritten: Boolean(emitDiagnostics),
      viewerAsset: viewerAssetMetadata,
    },
  };
}

module.exports = {
  buildAnalysisDiagnostics,
  writeAnalyzeArtifacts,
};
