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
const { runAnalyzePipeline } = require('../../analyze/analyzePipeline');
const {
  buildAnalyzeRunManifest,
  readAnalyzeRunManifest,
  writeAnalyzeRunManifest,
} = require('../../analyze/analyzeRunManifest');

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === true) return fallback;
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function runAnalyze(args) {
  const verbose = Boolean(args.verbose);
  const optimizeContextEnabled = Boolean(args['optimize-context']);

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
  const testDataLimit = parsePositiveInteger(args['test-data-limit'], Number(config.testData.limit) || DEFAULT_TEST_DATA_LIMIT);
  const skipTestData = Boolean(args['skip-test-data']);

  if (testDataLimit === null) {
    console.error('Invalid option: --test-data-limit must be a positive integer');
    process.exit(2);
  }

  logVerbose(`Program: ${program}`);
  logVerbose(`Source root: ${sourceRoot}`);
  logVerbose(`Output root: ${outputRoot}`);
  logVerbose(`Extensions: ${config.extensions.join(', ')}`);
  logVerbose(`Context optimization: ${optimizeContextEnabled ? 'enabled' : 'disabled'}`);
  logVerbose(`Test data extraction: ${skipTestData ? 'disabled' : `enabled (limit ${testDataLimit})`}`);

  if (!fs.existsSync(sourceRoot)) {
    console.error(`Source directory not found: ${sourceRoot}. Provide a valid --source path.`);
    process.exit(2);
  }

  const outputProgramDir = path.join(outputRoot, program);
  fs.mkdirSync(outputProgramDir, { recursive: true });
  logVerbose(`Writing output to ${outputProgramDir}`);
  const previousManifest = readAnalyzeRunManifest(outputProgramDir);
  const startedAt = new Date().toISOString();
  const startedNs = process.hrtime.bigint();

  let result;
  try {
    result = runAnalyzePipeline({
      program,
      sourceRoot,
      outputRoot,
      outputProgramDir,
      config,
      testDataLimit,
      skipTestData,
      verbose,
      optimizeContextEnabled,
      logVerbose,
    });
    const durationMs = Number((process.hrtime.bigint() - startedNs) / 1000000n);
    const manifest = buildAnalyzeRunManifest({
      status: 'succeeded',
      context: {
        program,
        sourceRoot,
        outputRoot,
        outputProgramDir,
        cwd: process.cwd(),
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs,
        optimizeContextEnabled,
        skipTestData,
        testDataLimit,
        extensions: config.extensions,
      },
      result,
      previousManifest,
    });
    writeAnalyzeRunManifest(outputProgramDir, manifest);
  } catch (error) {
    const durationMs = Number((process.hrtime.bigint() - startedNs) / 1000000n);
    const manifest = buildAnalyzeRunManifest({
      status: 'failed',
      context: {
        program,
        sourceRoot,
        outputRoot,
        outputProgramDir,
        cwd: process.cwd(),
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs,
        optimizeContextEnabled,
        skipTestData,
        testDataLimit,
        extensions: config.extensions,
      },
      error,
      previousManifest,
    });
    writeAnalyzeRunManifest(outputProgramDir, manifest);
    throw error;
  }

  console.log(`Analysis complete for program ${program}`);
  console.log(`Source files scanned: ${(result.scanSummary.sourceFiles || []).length}`);
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
  console.log(`Output written to: ${outputProgramDir}`);
}

module.exports = {
  runAnalyze,
};
