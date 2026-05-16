/*
Copyright 2026 gzeuner - tiny-tool.de

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
const { DEFAULT_TEST_DATA_LIMIT } = require('../db2/testDataExportService');
const { resolveAnalyzeConfig } = require('../config/runtimeConfig');
const {
  runAnalyzeArtifactAdapter,
  runAnalyzeCore,
} = require('../analyze/analyzePipeline');
const {
  buildAnalyzeRunManifest,
  readAnalyzeRunManifest,
  writeAnalyzeRunManifest,
} = require('../analyze/analyzeRunManifest');
const { buildSafeSharingArtifacts } = require('../sharing/safeSharingArtifactBuilder');
const { resolveWorkflowModeSettings } = require('../workflow/workflowModeRegistry');
const { resolvePromptTemplates } = require('../prompt/promptBuilder');
const { resolveMemberProgram } = require('../cli/helpers/memberResolver');
const {
  normalizeReproducibilitySettings,
  resolveDurationMs,
  resolveTimestamp,
} = require('../reproducibility/reproducibility');

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

function executeAnalyze(args, { cwd = process.cwd() } = {}) {
  const verbose = Boolean(args.verbose);
  const logVerbose = (message) => {
    if (verbose) {
      console.log(`[verbose] ${message}`);
    }
  };

  const config = resolveAnalyzeConfig(args, { cwd });
  const resolvedSourceRoot = config.sourceRoot ? path.resolve(cwd, config.sourceRoot) : '';
  let resolvedProgram = args.program;

  if ((!resolvedProgram || !String(resolvedProgram).trim()) && args.member) {
    if (!resolvedSourceRoot || !String(resolvedSourceRoot).trim()) {
      const error = new Error('Missing required option: --source <path>');
      error.code = 'SOURCE_REQUIRED';
      throw error;
    }
    resolvedProgram = resolveMemberProgram({
      member: args.member,
      sourceRoot: resolvedSourceRoot,
      extensions: config.extensions,
    }).program;
  }

  if (!resolvedProgram || !String(resolvedProgram).trim()) {
    const error = new Error('Missing required option: --program <name>');
    error.code = 'PROGRAM_REQUIRED';
    throw error;
  }

  if (!resolvedSourceRoot || !String(resolvedSourceRoot).trim()) {
    const error = new Error('Missing required option: --source <path>');
    error.code = 'SOURCE_REQUIRED';
    throw error;
  }

  const sourceRoot = resolvedSourceRoot;
  const outputRoot = path.resolve(cwd, config.outputRoot);
  const program = String(resolvedProgram).trim();
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
    workflowModeSettings = resolveWorkflowModeSettings(args.mode);
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
    throw new Error('Invalid option: --test-data-limit must be a positive integer');
  }
  if (searchMaxResults === null) {
    throw new Error('Invalid option: --search-max-results must be a positive integer');
  }

  if (!fs.existsSync(sourceRoot)) {
    const error = new Error(`Source directory not found: ${sourceRoot}. Provide a valid --source path.`);
    error.code = 'SOURCE_ROOT_MISSING';
    throw error;
  }

  const outputProgramDir = path.join(outputRoot, program);
  fs.mkdirSync(outputProgramDir, { recursive: true });
  logVerbose(`Writing output to ${outputProgramDir}`);
  const previousManifest = readAnalyzeRunManifest(outputProgramDir);
  const startedAt = resolveTimestamp(reproducibility);
  const startedNs = process.hrtime.bigint();

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
    const result = runAnalyzeArtifactAdapter({
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
        cwd,
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
        tokenBudget: config.tokenBudget,
        extensions: config.extensions,
        connectionRoles: config.connections ? {
          source: config.connections.source ? {
            kind: config.connections.source.kind,
            profileKey: config.connections.source.profileKey,
          } : null,
          metadata: config.connections.metadata ? {
            kind: config.connections.metadata.kind,
            profileKey: config.connections.metadata.profileKey,
          } : null,
          testData: config.connections.testData ? {
            kind: config.connections.testData.kind,
            profileKey: config.connections.testData.profileKey,
          } : null,
        } : null,
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

    return {
      program,
      config,
      sourceRoot,
      outputRoot,
      outputProgramDir,
      result,
      analyzeManifest: manifest,
      guidedMode,
      workflowPreset,
      safeSharingEnabled,
      emitDiagnostics,
      searchTerms,
      diagnosticPacks,
      reproducibility,
    };
  } catch (error) {
    const durationMs = resolveDurationMs(reproducibility, Number((process.hrtime.bigint() - startedNs) / 1000000n));
    const manifest = buildAnalyzeRunManifest({
      status: 'failed',
      context: {
        program,
        sourceRoot,
        outputRoot,
        outputProgramDir,
        cwd,
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
        tokenBudget: config.tokenBudget,
        extensions: config.extensions,
        connectionRoles: config.connections ? {
          source: config.connections.source ? {
            kind: config.connections.source.kind,
            profileKey: config.connections.source.profileKey,
          } : null,
          metadata: config.connections.metadata ? {
            kind: config.connections.metadata.kind,
            profileKey: config.connections.metadata.profileKey,
          } : null,
          testData: config.connections.testData ? {
            kind: config.connections.testData.kind,
            profileKey: config.connections.testData.profileKey,
          } : null,
        } : null,
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
    error.analyzeManifest = manifest;
    throw error;
  }
}

module.exports = {
  executeAnalyze,
};
