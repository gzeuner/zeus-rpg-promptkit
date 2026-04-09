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
const { getPromptContract } = require('../prompt/promptRegistry');
const { resolvePromptTemplates } = require('../prompt/promptBuilder');

const WORKFLOW_MODE_REGISTRY = Object.freeze({
  architecture: Object.freeze({
    name: 'architecture',
    title: 'Architecture Review',
    description: 'Focus on dependency structure, semantic relationships, and architecture-facing documentation artifacts.',
    promptTemplates: Object.freeze(['documentation']),
    autoOptimizeContext: true,
    primaryArtifacts: Object.freeze([
      'analysis-index.json',
      'canonical-analysis.json',
      'architecture-report.md',
      'dependency-graph.md',
      'program-call-tree.md',
      'ai_prompt_documentation.md',
    ]),
  }),
  documentation: Object.freeze({
    name: 'documentation',
    title: 'Documentation',
    description: 'Generate prompt-ready technical documentation grounded in the canonical and AI projections.',
    promptTemplates: Object.freeze(['documentation']),
    autoOptimizeContext: true,
    primaryArtifacts: Object.freeze([
      'analysis-index.json',
      'ai-knowledge.json',
      'report.md',
      'ai_prompt_documentation.md',
    ]),
  }),
  'error-analysis': Object.freeze({
    name: 'error-analysis',
    title: 'Error Analysis',
    description: 'Prioritize risky SQL, error paths, and operational failure signals for troubleshooting.',
    promptTemplates: Object.freeze(['error-analysis']),
    autoOptimizeContext: true,
    primaryArtifacts: Object.freeze([
      'analysis-index.json',
      'ai-knowledge.json',
      'report.md',
      'ai_prompt_error_analysis.md',
    ]),
  }),
  'defect-analysis': Object.freeze({
    name: 'defect-analysis',
    title: 'Defect Analysis',
    description: 'Package evidence for defect hypotheses, trigger conditions, and verification steps.',
    promptTemplates: Object.freeze(['error-analysis', 'defect-analysis']),
    autoOptimizeContext: true,
    primaryArtifacts: Object.freeze([
      'analysis-index.json',
      'ai-knowledge.json',
      'report.md',
      'ai_prompt_error_analysis.md',
      'ai_prompt_defect_analysis.md',
    ]),
  }),
  modernization: Object.freeze({
    name: 'modernization',
    title: 'Modernization',
    description: 'Highlight extraction boundaries, change blockers, and evidence-backed modernization candidates.',
    promptTemplates: Object.freeze(['documentation', 'modernization']),
    autoOptimizeContext: true,
    primaryArtifacts: Object.freeze([
      'analysis-index.json',
      'canonical-analysis.json',
      'architecture-report.md',
      'ai_prompt_documentation.md',
      'ai_prompt_modernization.md',
    ]),
  }),
  impact: Object.freeze({
    name: 'impact',
    title: 'Impact Investigation',
    description: 'Prepare graph artifacts and next-step guidance for reverse dependency and blast-radius analysis.',
    promptTemplates: Object.freeze([]),
    autoOptimizeContext: false,
    primaryArtifacts: Object.freeze([
      'analysis-index.json',
      'canonical-analysis.json',
      'dependency-graph.json',
      'program-call-tree.json',
      'architecture-report.md',
    ]),
  }),
});

function normalizeWorkflowModeName(value) {
  return String(value || '').trim().toLowerCase();
}

function getWorkflowMode(modeName) {
  const normalized = normalizeWorkflowModeName(modeName);
  const mode = WORKFLOW_MODE_REGISTRY[normalized];
  if (!mode) {
    throw new Error(`Unknown analyze workflow mode: ${modeName}`);
  }
  return mode;
}

function listWorkflowModes() {
  return Object.values(WORKFLOW_MODE_REGISTRY);
}

function resolveWorkflowModeSettings(modeName) {
  if (!modeName) {
    return null;
  }

  const mode = getWorkflowMode(modeName);
  const promptTemplates = resolvePromptTemplates(mode.promptTemplates);
  const workflowKeys = Array.from(new Set(promptTemplates
    .map((templateName) => getPromptContract(templateName).workflow)
    .filter(Boolean)));

  return {
    name: mode.name,
    title: mode.title,
    description: mode.description,
    autoOptimizeContext: Boolean(mode.autoOptimizeContext),
    promptTemplates,
    workflowKeys,
    primaryArtifacts: [...mode.primaryArtifacts],
  };
}

module.exports = {
  getWorkflowMode,
  listWorkflowModes,
  normalizeWorkflowModeName,
  resolveWorkflowModeSettings,
  WORKFLOW_MODE_REGISTRY,
};
