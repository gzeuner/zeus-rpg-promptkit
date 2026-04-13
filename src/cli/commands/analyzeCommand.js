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
const { DEFAULT_TEST_DATA_LIMIT } = require('../../db2/testDataExportService');
const { resolveAnalyzeConfig } = require('../../config/runtimeConfig');
const {
  runAnalyzeArtifactAdapter,
  runAnalyzeCore,
} = require('../../analyze/analyzePipeline');
const {
  buildAnalyzeRunManifest,
  readAnalyzeRunManifest,
  writeAnalyzeRunManifest,
} = require('../../analyze/analyzeRunManifest');
const { buildSafeSharingArtifacts } = require('../../sharing/safeSharingArtifactBuilder');
const { listWorkflowModes, resolveWorkflowModeSettings } = require('../../workflow/workflowModeRegistry');
const { resolvePromptTemplates } = require('../../prompt/promptBuilder');
const { listDiagnosticPacks } = require('../../investigation/diagnosticPackRegistry');
const {
  normalizeReproducibilitySettings,
  resolveDurationMs,
  resolveTimestamp,
} = require('../../reproducibility/reproducibility');

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === true) return fallback;
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseCsv(value) {
  if (value === undefined || value === null || value === true) {
    return [];
  }
  return Array.from(new Set(String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

function printWorkflowModes() {
  console.log('Supported analyze workflow modes:');
  for (const mode of listWorkflowModes()) {
    const templates = resolvePromptTemplates(mode.promptTemplates);
    console.log(`- ${mode.name}: ${mode.description}`);
    console.log(`  auto-optimize-context: ${mode.autoOptimizeContext ? 'yes' : 'no'}`);
    console.log(`  prompt templates: ${templates.length > 0 ? templates.join(', ') : 'none'}`);
    if (mode.reviewWorkflow) {
      console.log(`  intended audience: ${(mode.reviewWorkflow.intendedAudience || []).join('; ') || 'n/a'}`);
      console.log(`  expected decisions: ${(mode.reviewWorkflow.expectedDecisions || []).join('; ') || 'n/a'}`);
    }
  }
}

function printDiagnosticPacks() {
  console.log('Supported diagnostic packs:');
  for (const pack of listDiagnosticPacks()) {
    console.log(`- ${pack.name}: ${pack.description}`);
    console.log(`  parameters: ${pack.parameters.map((parameter) => `${parameter.name}${parameter.required ? ' (required)' : ''}`).join(', ')}`);
    console.log(`  steps: ${(pack.steps || []).length}`);
  }
}

function runAnalyze(args) {
  const verbose = Boolean(args.verbose);

  if (args['list-modes']) {
    printWorkflowModes();
    return;
  }
  if (args['list-diagnostic-packs']) {
    printDiagnosticPacks();
    return;
  }

  const logVerbose = (message) => {
    if (verbose) {
      console.log(`[verbose] ${message}`);
    }
  };

  if (!args.program || !String(args.program).trim()) {
    console.error('Missing required option: --program <name>');
    process.exit(2);
  }

  const config = resolveAnalyzeConfig(args);
  if (!config.sourceRoot || !String(config.sourceRoot).trim()) {
    console.error('Missing required option: --source <path>');
    process.exit(2);
  }

  const sourceRoot = path.resolve(process.cwd(), config.sourceRoot);
  const outputRoot = path.resolve(process.cwd(), config.outputRoot);
  const program = String(args.program).trim();
  const workflowPreset = args['workflow-preset-settings'] && typeof args['workflow-preset-settings'] === 'object'
    ? {
      ...args['workflow-preset-settings'],
      promptTemplates: [...(args['workflow-preset-settings'].promptTemplates || [])],
      workflowKeys: [...(args['workflow-preset-settings'].workflowKeys || [])],
      bundleArtifacts: [...(args['workflow-preset-settings'].bundleArtifacts || [])],
    }
    : null;
  let workflowModeSettings = null;
  if (args.mode) {
    try {
      workflowModeSettings = resolveWorkflowModeSettings(args.mode);
    } catch (error) {
      console.error(`${error.message}. Use --list-modes to inspect supported workflow modes.`);
      process.exit(2);
    }
  }
  const optimizeContextEnabled = Boolean(args['optimize-context'])
    || Boolean(workflowModeSettings && workflowModeSettings.autoOptimizeContext);
  const guidedMode = workflowModeSettings
    ? {
      ...workflowModeSettings,
      effectiveOptimizeContext: optimizeContextEnabled,
    }
    : null;
  const promptTemplates = workflowModeSettings
    ? resolvePromptTemplates(workflowModeSettings.promptTemplates)
    : resolvePromptTemplates();
  const testDataLimit = parsePositiveInteger(args['test-data-limit'], Number(config.testData.limit) || DEFAULT_TEST_DATA_LIMIT);
  const searchMaxResults = parsePositiveInteger(args['search-max-results'], 200);
  const skipTestData = Boolean(args['skip-test-data']);
  const safeSharingEnabled = Boolean(args['safe-sharing']);
  const emitDiagnostics = Boolean(args['emit-diagnostics']);
  const scanIfsPathsEnabled = Boolean(args['scan-ifs-paths']);
  const searchTerms = parseCsv(args['search-terms']);
  const searchIgnorePatterns = parseCsv(args['search-ignore']);
  const diagnosticPacks = parseCsv(args['diagnostic-packs']);
  const diagnosticParameterString = typeof args['diagnostic-params'] === 'string' ? args['diagnostic-params'] : '';
  const reproducibility = normalizeReproducibilitySettings(Boolean(args.reproducible));

  if (testDataLimit === null) {
    console.error('Invalid option: --test-data-limit must be a positive integer');
    process.exit(2);
  }
  if (searchMaxResults === null) {
    console.error('Invalid option: --search-max-results must be a positive integer');
    process.exit(2);
  }

  logVerbose(`Program: ${program}`);
  logVerbose(`Source root: ${sourceRoot}`);
  logVerbose(`Output root: ${outputRoot}`);
  logVerbose(`Extensions: ${config.extensions.join(', ')}`);
  logVerbose(`Context optimization: ${optimizeContextEnabled ? 'enabled' : 'disabled'}`);
  logVerbose(`Safe sharing: ${safeSharingEnabled ? 'enabled' : 'disabled'}`);
  logVerbose(`Structured diagnostics: ${emitDiagnostics ? 'enabled' : 'disabled'}`);
  logVerbose(`Reproducible mode: ${reproducibility.enabled ? 'enabled' : 'disabled'}`);
  logVerbose(`Test data extraction: ${skipTestData ? 'disabled' : `enabled (limit ${testDataLimit})`}`);
  logVerbose(`Analysis limits: depth ${config.analysisLimits.maxProgramDepth}, programs ${config.analysisLimits.maxPrograms}, nodes ${config.analysisLimits.maxNodes}, edges ${config.analysisLimits.maxEdges}`);
  logVerbose(`IFS path scan: ${scanIfsPathsEnabled ? 'enabled' : 'disabled'}`);
  logVerbose(`Search terms: ${searchTerms.length > 0 ? searchTerms.join(', ') : 'none'}`);
  logVerbose(`Diagnostic packs: ${diagnosticPacks.length > 0 ? diagnosticPacks.join(', ') : 'none'}`);
  if (guidedMode) {
    logVerbose(`Workflow mode: ${guidedMode.name}`);
    logVerbose(`Workflow prompt templates: ${promptTemplates.length > 0 ? promptTemplates.join(', ') : 'none'}`);
  }
  if (workflowPreset) {
    logVerbose(`Workflow preset: ${workflowPreset.name}`);
  }

  if (!fs.existsSync(sourceRoot)) {
    console.error(`Source directory not found: ${sourceRoot}. Provide a valid --source path.`);
    process.exit(2);
  }

  const outputProgramDir = path.join(outputRoot, program);
  fs.mkdirSync(outputProgramDir, { recursive: true });
  logVerbose(`Writing output to ${outputProgramDir}`);
  const previousManifest = readAnalyzeRunManifest(outputProgramDir);
  const startedAt = resolveTimestamp(reproducibility);
  const startedNs = process.hrtime.bigint();

  let result;
  try {
    const coreResult = runAnalyzeCore({
      program,
      sourceRoot,
      outputRoot,
      outputProgramDir,
      config,
      testDataLimit,
      skipTestData,
      verbose,
      optimizeContextEnabled,
      workflowMode: guidedMode ? guidedMode.name : null,
      workflowModeSettings: guidedMode,
      promptTemplates,
      workflowPreset,
      scanIfsPathsEnabled,
      searchTerms,
      searchIgnorePatterns,
      searchMaxResults,
      diagnosticPacks,
      diagnosticParameterString,
      ibmiConfig: config.ibmi,
      reproducibility,
      logVerbose,
    });
    result = runAnalyzeArtifactAdapter({
      ...coreResult,
      emitDiagnostics,
    });
    const durationMs = resolveDurationMs(reproducibility, Number((process.hrtime.bigint() - startedNs) / 1000000n));
    const manifest = buildAnalyzeRunManifest({
      status: 'succeeded',
      context: {
        program,
        sourceRoot,
        outputRoot,
        outputProgramDir,
        cwd: process.cwd(),
        startedAt,
        completedAt: resolveTimestamp(reproducibility),
        durationMs,
        optimizeContextEnabled,
        safeSharingEnabled,
        emitDiagnosticsEnabled: emitDiagnostics,
        skipTestData,
        testDataLimit,
        analysisLimits: config.analysisLimits,
        testDataPolicy: config.testData,
        extensions: config.extensions,
        reproducibility,
        guidedMode,
        workflowPreset,
        investigation: {
          scanIfsPathsEnabled,
          searchTerms,
          searchIgnorePatterns,
          searchMaxResults,
          diagnosticPacks,
          diagnosticParameterString,
        },
      },
      result,
      previousManifest,
    });
    writeAnalyzeRunManifest(outputProgramDir, manifest);
    if (safeSharingEnabled) {
      buildSafeSharingArtifacts({
        outputProgramDir,
        analyzeManifest: manifest,
        reproducibility,
      });
    }
  } catch (error) {
    const durationMs = resolveDurationMs(reproducibility, Number((process.hrtime.bigint() - startedNs) / 1000000n));
    const manifest = buildAnalyzeRunManifest({
      status: 'failed',
      context: {
        program,
        sourceRoot,
        outputRoot,
        outputProgramDir,
        cwd: process.cwd(),
        startedAt,
        completedAt: resolveTimestamp(reproducibility),
        durationMs,
        optimizeContextEnabled,
        safeSharingEnabled,
        emitDiagnosticsEnabled: emitDiagnostics,
        skipTestData,
        testDataLimit,
        analysisLimits: config.analysisLimits,
        testDataPolicy: config.testData,
        extensions: config.extensions,
        reproducibility,
        guidedMode,
        workflowPreset,
        investigation: {
          scanIfsPathsEnabled,
          searchTerms,
          searchIgnorePatterns,
          searchMaxResults,
          diagnosticPacks,
          diagnosticParameterString,
        },
      },
      error,
      previousManifest,
    });
    writeAnalyzeRunManifest(outputProgramDir, manifest);
    throw error;
  }

  console.log(`Analysis complete for program ${program}`);
  if (guidedMode) {
    console.log(`Guided mode: ${guidedMode.name}`);
  }
  if (workflowPreset) {
    console.log(`Workflow preset: ${workflowPreset.name}`);
  }
  if (safeSharingEnabled) {
    console.log(`Safe-sharing artifacts: ${path.join(outputProgramDir, 'safe-sharing')}`);
  }
  if (searchTerms.length > 0) {
    console.log(`Search terms: ${searchTerms.join(', ')}`);
  }
  if (diagnosticPacks.length > 0) {
    console.log(`Diagnostic packs: ${diagnosticPacks.join(', ')}`);
  }
  console.log(`Source files scanned: ${(result.scanSummary.sourceFiles || []).length}`);
  if (result.cacheStatus && result.cacheStatus.sourceScan) {
    console.log(`Source scan cache: ${result.cacheStatus.sourceScan.hits || 0} hits, ${result.cacheStatus.sourceScan.misses || 0} misses`);
  }
  if (result.cacheStatus && result.cacheStatus.db2Metadata && result.cacheStatus.db2Metadata.status !== 'disabled') {
    console.log(`DB2 metadata cache: ${result.cacheStatus.db2Metadata.status}`);
  }
  if (result.cacheStatus && result.cacheStatus.testData && result.cacheStatus.testData.status !== 'disabled') {
    console.log(`Test data cache: ${result.cacheStatus.testData.status}`);
  }
  if (result.optimizationReport.enabled) {
    console.log(`Context tokens: ${result.optimizationReport.contextTokens}`);
    console.log(`Optimized tokens: ${result.optimizationReport.optimizedTokens}`);
    console.log(`Reduction: ${result.optimizationReport.reductionPercent}%`);
    if (result.optimizationReport.warning) {
      console.warn('Warning: optimized context may exceed safe prompt size.');
    }
  } else {
    console.log(`Context tokens: ${result.optimizationReport.contextTokens}`);
  }
  if (emitDiagnostics) {
    console.log(`Diagnostics written to: ${path.join(outputProgramDir, 'analysis-diagnostics.json')}`);
  }
  console.log(`Output written to: ${outputProgramDir}`);
}

module.exports = {
  runAnalyze,
};
