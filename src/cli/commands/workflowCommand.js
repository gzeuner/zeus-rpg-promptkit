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
const path = require('path');
const { readAnalyzeRunManifest } = require('../../analyze/analyzeRunManifest');
const { runAnalyze } = require('./analyzeCommand');
const { runBundle } = require('./bundleCommand');
const { resolveAnalyzeConfig } = require('../../config/runtimeConfig');
const { resolveWorkflowPresetSettings, listWorkflowPresets } = require('../../workflow/workflowPresetRegistry');
const { buildWorkflowRunManifest, writeWorkflowRunManifest } = require('../../workflow/workflowRunManifest');
const { normalizeReproducibilitySettings } = require('../../reproducibility/reproducibility');

function printWorkflowPresets() {
  console.log('Supported workflow presets:');
  for (const preset of listWorkflowPresets()) {
    const settings = resolveWorkflowPresetSettings(preset.name);
    console.log(`- ${preset.name}: ${preset.description}`);
    console.log(`  analyze mode: ${settings.analyzeMode}`);
    console.log(`  prompt templates: ${settings.promptTemplates.length > 0 ? settings.promptTemplates.join(', ') : 'none'}`);
    console.log(`  bundle artifacts: ${settings.bundleArtifacts.length}`);
    if (settings.reviewWorkflow) {
      console.log(`  intended audience: ${(settings.reviewWorkflow.intendedAudience || []).join('; ') || 'n/a'}`);
      console.log(`  expected decisions: ${(settings.reviewWorkflow.expectedDecisions || []).join('; ') || 'n/a'}`);
    }
  }
}

function runWorkflow(args) {
  if (args['list-presets']) {
    printWorkflowPresets();
    return;
  }

  if (!args.preset || !String(args.preset).trim()) {
    console.error('Missing required option: --preset <name>');
    process.exit(2);
  }

  let preset;
  try {
    preset = resolveWorkflowPresetSettings(args.preset);
  } catch (error) {
    console.error(`${error.message}. Use --list-presets to inspect supported workflow presets.`);
    process.exit(2);
  }

  const analyzeArgs = {
    ...args,
    mode: preset.analyzeMode,
    'workflow-preset-settings': preset,
  };
  delete analyzeArgs.preset;
  delete analyzeArgs['list-presets'];
  delete analyzeArgs['bundle-output'];
  const reproducibility = normalizeReproducibilitySettings(Boolean(args.reproducible));

  runAnalyze(analyzeArgs);

  const analyzeConfig = resolveAnalyzeConfig(analyzeArgs);
  const outputRoot = path.resolve(process.cwd(), analyzeConfig.outputRoot);
  const outputProgramDir = path.join(outputRoot, String(args.program || '').trim());
  const analyzeManifest = readAnalyzeRunManifest(outputProgramDir);
  const bundleResult = runBundle({
    program: args.program,
    profile: args.profile,
    'source-output-root': outputRoot,
    output: args['bundle-output'],
    'artifact-paths': preset.bundleArtifacts,
    'bundle-file-name': `${String(args.program || '').trim()}-${preset.bundleFileName}`,
    'workflow-preset-settings': preset,
    reproducible: reproducibility.enabled,
    verbose: args.verbose,
  });

  const workflowManifest = buildWorkflowRunManifest({
    preset,
    analyzeManifest,
    bundleManifest: bundleResult.manifest,
    bundlePath: bundleResult.zipPath,
    reproducibility,
  });
  writeWorkflowRunManifest(outputProgramDir, workflowManifest);

  console.log(`Workflow preset complete: ${preset.name}`);
  console.log(`Workflow manifest written to: ${path.join(outputProgramDir, 'workflow-run-manifest.json')}`);
}

module.exports = {
  runWorkflow,
};
