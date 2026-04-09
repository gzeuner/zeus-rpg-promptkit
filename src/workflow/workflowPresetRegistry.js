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
const { resolveWorkflowModeSettings } = require('./workflowModeRegistry');

const WORKFLOW_PRESET_REGISTRY = Object.freeze({
  'architecture-review': Object.freeze({
    name: 'architecture-review',
    title: 'Architecture Review',
    description: 'Run a structure-first analysis and package graph, architecture, and documentation artifacts together.',
    analyzeMode: 'architecture',
    bundleArtifacts: Object.freeze([
      'analyze-run-manifest.json',
      'analysis-index.json',
      'canonical-analysis.json',
      'ai-knowledge.json',
      'architecture-report.md',
      'dependency-graph.md',
      'program-call-tree.md',
      'architecture.html',
      'ai_prompt_documentation.md',
    ]),
  }),
  'modernization-review': Object.freeze({
    name: 'modernization-review',
    title: 'Modernization Review',
    description: 'Bundle modernization prompts, semantic architecture evidence, and change-boundary artifacts.',
    analyzeMode: 'modernization',
    bundleArtifacts: Object.freeze([
      'analyze-run-manifest.json',
      'analysis-index.json',
      'canonical-analysis.json',
      'ai-knowledge.json',
      'architecture-report.md',
      'report.md',
      'program-call-tree.md',
      'ai_prompt_documentation.md',
      'ai_prompt_modernization.md',
    ]),
  }),
  onboarding: Object.freeze({
    name: 'onboarding',
    title: 'Onboarding',
    description: 'Produce a concise starter bundle for engineers who need orientation and documentation quickly.',
    analyzeMode: 'documentation',
    bundleArtifacts: Object.freeze([
      'analyze-run-manifest.json',
      'analysis-index.json',
      'context.json',
      'ai-knowledge.json',
      'report.md',
      'architecture-report.md',
      'ai_prompt_documentation.md',
    ]),
  }),
  'dependency-risk': Object.freeze({
    name: 'dependency-risk',
    title: 'Dependency Risk',
    description: 'Package defect-oriented prompts and dependency artifacts for risk review and follow-up investigation.',
    analyzeMode: 'defect-analysis',
    bundleArtifacts: Object.freeze([
      'analyze-run-manifest.json',
      'analysis-index.json',
      'canonical-analysis.json',
      'ai-knowledge.json',
      'report.md',
      'dependency-graph.json',
      'dependency-graph.md',
      'program-call-tree.json',
      'program-call-tree.md',
      'ai_prompt_error_analysis.md',
      'ai_prompt_defect_analysis.md',
    ]),
  }),
});

function normalizeWorkflowPresetName(value) {
  return String(value || '').trim().toLowerCase();
}

function getWorkflowPreset(presetName) {
  const normalized = normalizeWorkflowPresetName(presetName);
  const preset = WORKFLOW_PRESET_REGISTRY[normalized];
  if (!preset) {
    throw new Error(`Unknown workflow preset: ${presetName}`);
  }
  return preset;
}

function listWorkflowPresets() {
  return Object.values(WORKFLOW_PRESET_REGISTRY);
}

function resolveWorkflowPresetSettings(presetName) {
  if (!presetName) {
    return null;
  }

  const preset = getWorkflowPreset(presetName);
  const guidedMode = resolveWorkflowModeSettings(preset.analyzeMode);

  return {
    name: preset.name,
    title: preset.title,
    description: preset.description,
    analyzeMode: guidedMode.name,
    guidedMode,
    promptTemplates: [...guidedMode.promptTemplates],
    workflowKeys: [...guidedMode.workflowKeys],
    autoOptimizeContext: Boolean(guidedMode.autoOptimizeContext),
    bundleArtifacts: [...preset.bundleArtifacts],
    bundleFileName: `${preset.name}-bundle.zip`,
  };
}

module.exports = {
  getWorkflowPreset,
  listWorkflowPresets,
  normalizeWorkflowPresetName,
  resolveWorkflowPresetSettings,
  WORKFLOW_PRESET_REGISTRY,
};
