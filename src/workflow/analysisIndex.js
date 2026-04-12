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
const { validatePromptApplicability } = require('../prompt/promptBuilder');
const { listWorkflowModes, normalizeWorkflowModeName } = require('./workflowModeRegistry');
const { cloneReviewWorkflow } = require('./reviewWorkflowMetadata');

const ANALYSIS_INDEX_SCHEMA_VERSION = 1;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueSortedStrings(values) {
  return Array.from(new Set(asArray(values).map((value) => String(value || '').trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

function inferArtifactKind(fileName) {
  const lowerName = String(fileName || '').toLowerCase();
  if (lowerName.endsWith('.json')) return 'json';
  if (lowerName.endsWith('.md')) return 'markdown';
  if (lowerName.endsWith('.mmd')) return 'mermaid';
  if (lowerName.endsWith('.html')) return 'html';
  return 'unknown';
}

function buildArtifactRefs(primaryArtifacts, generatedFiles) {
  const generated = new Set(uniqueSortedStrings(generatedFiles));
  return uniqueSortedStrings(primaryArtifacts).map((artifactPath) => ({
    path: artifactPath,
    kind: inferArtifactKind(artifactPath),
    generated: generated.has(artifactPath),
  }));
}

function resolveWorkflowProjection(aiKnowledge, workflowKey) {
  if (!aiKnowledge || !aiKnowledge.workflows || !workflowKey) {
    return null;
  }
  return aiKnowledge.workflows[workflowKey] || null;
}

function buildPromptEntries(mode, aiKnowledge, generatedFiles) {
  const generated = new Set(uniqueSortedStrings(generatedFiles));
  return asArray(mode.promptTemplates).map((templateName) => {
    const contract = getPromptContract(templateName);
    const applicability = validatePromptApplicability(templateName, aiKnowledge);
    return {
      name: contract.name,
      workflow: contract.workflow,
      version: contract.version,
      outputFile: contract.outputFileName,
      generated: generated.has(contract.outputFileName),
      applicable: applicability.applicable,
      failures: applicability.failures,
    };
  });
}

function buildEvidenceSummary(mode, aiKnowledge, context) {
  const promptContract = asArray(mode.promptTemplates)[0]
    ? getPromptContract(mode.promptTemplates[0])
    : null;
  const workflow = resolveWorkflowProjection(aiKnowledge, promptContract && promptContract.workflow);

  if (workflow) {
    return {
      workflow: workflow.name || promptContract.workflow,
      tableCount: asArray(workflow.tables).length,
      programCallCount: asArray(workflow.programCalls).length,
      copyMemberCount: asArray(workflow.copyMembers).length,
      sqlStatementCount: asArray(workflow.sqlStatements).length,
      nativeFileCount: asArray(workflow.nativeFiles).length,
      evidenceHighlightCount: asArray(workflow.evidenceHighlights).length,
      riskMarkers: uniqueSortedStrings(workflow.riskMarkers),
      uncertaintyMarkers: uniqueSortedStrings(workflow.uncertaintyMarkers),
    };
  }

  return {
    workflow: null,
    tableCount: Number(context && context.summary && context.summary.tableCount) || 0,
    programCallCount: Number(context && context.summary && context.summary.programCallCount) || 0,
    copyMemberCount: Number(context && context.summary && context.summary.copyMemberCount) || 0,
    sqlStatementCount: Number(context && context.summary && context.summary.sqlStatementCount) || 0,
    nativeFileCount: Number(context && context.summary && context.summary.nativeFileCount) || 0,
    evidenceHighlightCount: 0,
    riskMarkers: uniqueSortedStrings(aiKnowledge && aiKnowledge.riskMarkers),
    uncertaintyMarkers: uniqueSortedStrings(aiKnowledge && aiKnowledge.uncertaintyMarkers),
  };
}

function buildNextActions(mode, program) {
  const programName = String(program || '').trim().toUpperCase();

  switch (mode.name) {
    case 'architecture':
      return [
        'Open architecture-report.md to review the semantic architecture summary.',
        'Inspect dependency-graph.md and program-call-tree.md to trace structural edges.',
        'Use ai_prompt_documentation.md when you need an AI-assisted architecture walkthrough.',
      ];
    case 'documentation':
      return [
        'Open report.md for the broad run summary and ai_prompt_documentation.md for prompt-ready documentation.',
        'Cross-check canonical-analysis.json when a documentation statement needs source-backed evidence.',
      ];
    case 'error-analysis':
      return [
        'Start with ai_prompt_error_analysis.md and compare it with report.md risk notes.',
        'Validate the highest-ranked evidence highlights against canonical-analysis.json before concluding root cause.',
      ];
    case 'defect-analysis':
      return [
        'Review ai_prompt_defect_analysis.md for defect hypotheses and ai_prompt_error_analysis.md for supporting evidence.',
        'Trace the cited evidence highlights back to source files before proposing a fix.',
      ];
    case 'modernization':
      return [
        'Open ai_prompt_modernization.md to review candidates, blockers, and suggested first steps.',
        'Use architecture-report.md and canonical-analysis.json to validate extraction boundaries and integration risks.',
      ];
    case 'refactoring':
      return [
        'Open ai_prompt_refactoring_plan.md for the smallest safe change slices and validation steps.',
        'Use ai_prompt_architecture_review.md and dependency-graph.md to confirm the proposed scope is actually isolated.',
      ];
    case 'test-generation':
      return [
        'Open ai_prompt_test_generation.md to review scenarios, fixture hints, and assertion ideas.',
        'Cross-check the suggested tests against report.md and ai_prompt_documentation.md before implementing them.',
      ];
    case 'impact':
      return [
        `Run zeus impact --target <name> --program ${programName} to compute reverse dependency blast radius.`,
        'Inspect program-call-tree.json and dependency-graph.json before choosing the impact target.',
      ];
    default:
      return [];
  }
}

function buildTask(mode, aiKnowledge, context, generatedFiles, selectedMode) {
  const promptEntries = buildPromptEntries(mode, aiKnowledge, generatedFiles);
  return {
    id: mode.name,
    title: mode.title,
    description: mode.description,
    selected: normalizeWorkflowModeName(selectedMode) === mode.name,
    autoOptimizeContext: Boolean(mode.autoOptimizeContext),
    prompts: promptEntries,
    artifacts: buildArtifactRefs(mode.primaryArtifacts, generatedFiles),
    reviewWorkflow: cloneReviewWorkflow(mode.reviewWorkflow),
    evidenceSummary: buildEvidenceSummary(mode, aiKnowledge, context),
    nextActions: buildNextActions(mode, context && context.program),
  };
}

function buildGuidedModeSummary(modes, selectedMode) {
  return modes.map((mode) => ({
    name: mode.name,
    title: mode.title,
    description: mode.description,
    autoOptimizeContext: Boolean(mode.autoOptimizeContext),
    promptTemplates: [...mode.promptTemplates],
    reviewWorkflow: cloneReviewWorkflow(mode.reviewWorkflow),
    selected: normalizeWorkflowModeName(selectedMode) === mode.name,
  }));
}

function buildSelectedPresetSummary(selectedPreset) {
  if (!selectedPreset || typeof selectedPreset !== 'object') {
    return null;
  }

  return {
    name: selectedPreset.name || null,
    title: selectedPreset.title || null,
    description: selectedPreset.description || null,
    analyzeMode: selectedPreset.analyzeMode || null,
    promptTemplates: Array.isArray(selectedPreset.promptTemplates)
      ? [...selectedPreset.promptTemplates]
      : [],
    workflowKeys: Array.isArray(selectedPreset.workflowKeys)
      ? [...selectedPreset.workflowKeys]
      : [],
    bundleArtifacts: Array.isArray(selectedPreset.bundleArtifacts)
      ? [...selectedPreset.bundleArtifacts]
      : [],
    reviewWorkflow: cloneReviewWorkflow(selectedPreset.reviewWorkflow),
  };
}

function buildAnalysisIndex({
  canonicalAnalysis,
  context,
  aiKnowledge,
  generatedFiles,
  selectedMode = null,
  derivedModeSettings = null,
  selectedPreset = null,
}) {
  const modes = listWorkflowModes();
  const tasks = modes.map((mode) => buildTask(mode, aiKnowledge, context, generatedFiles, selectedMode));
  const selectedPresetSummary = buildSelectedPresetSummary(selectedPreset);

  return {
    schemaVersion: ANALYSIS_INDEX_SCHEMA_VERSION,
    kind: 'analysis-task-index',
    generatedAt: canonicalAnalysis.generatedAt,
    program: canonicalAnalysis.rootProgram,
    sourceRoot: canonicalAnalysis.sourceRoot,
    selectedMode: selectedMode ? normalizeWorkflowModeName(selectedMode) : null,
    derivedModeSettings: derivedModeSettings || null,
    selectedPreset: selectedPresetSummary,
    summary: {
      taskCount: tasks.length,
      selectedTaskCount: tasks.filter((task) => task.selected).length,
      generatedArtifactCount: uniqueSortedStrings(generatedFiles).length,
      applicablePromptCount: tasks.reduce((count, task) => count + task.prompts.filter((prompt) => prompt.applicable).length, 0),
      selectedPresetCount: selectedPresetSummary ? 1 : 0,
    },
    guidedModes: buildGuidedModeSummary(modes, selectedMode),
    tasks,
  };
}

module.exports = {
  ANALYSIS_INDEX_SCHEMA_VERSION,
  buildAnalysisIndex,
};
