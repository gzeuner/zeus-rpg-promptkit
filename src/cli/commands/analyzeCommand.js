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
const path = require('path');
const { listWorkflowModes, resolveWorkflowModeSettings } = require('../../workflow/workflowModeRegistry');
const { createJsonOutput } = require('../helpers/jsonOutput');
const { resolvePromptTemplates } = require('../../prompt/promptBuilder');
const { listDiagnosticPacks } = require('../../investigation/diagnosticPackRegistry');
const { executeAnalyze } = require('../../core/analyzeService');

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

async function runAnalyze(args) {
  if (args['list-modes']) {
    printWorkflowModes();
    return;
  }
  if (args['list-diagnostic-packs']) {
    printDiagnosticPacks();
    return;
  }
  try {
    // Route through capability (package 07)
    let execution;
    try {
      const { capabilities } = require('../../api/zeusApi');
      const res = capabilities && typeof capabilities.execute === 'function' ? await capabilities.execute('analysis.analyze', { cwd: process.cwd(), env: process.env, args }, args) : null;
      if (res && res.ok && res.result) {
        execution = res.result;
      }
    } catch (e) {
      // fallthrough
    }
    if (!execution) {
      execution = executeAnalyze(args);
    }
    const { result, program, outputProgramDir, guidedMode, workflowPreset, safeSharingEnabled, denseLevel, searchTerms, diagnosticPacks, emitDiagnostics } = execution;

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
    if (denseLevel) {
      console.log(`Dense output: ${denseLevel}`);
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
    if (result.context && result.context.knownFacts && result.context.knownFacts.status !== 'disabled') {
      console.log(`Known facts: ${result.context.knownFacts.status} (${result.context.knownFacts.factCount || 0} facts)`);
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

    const json = createJsonOutput(args);
    if (json.isJsonMode) {
      json.print(result);
    }
  } catch (error) {
    const message = args.mode
      ? `${error.message}. Use --list-modes to inspect supported workflow modes.`
      : error.message;
    console.error(message);
    process.exit(2);
  }
}

module.exports = {
  runAnalyze,
};
