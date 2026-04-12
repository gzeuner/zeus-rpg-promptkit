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
const { cloneReviewWorkflow, freezeReviewWorkflow } = require('./reviewWorkflowMetadata');

const WORKFLOW_MODE_REGISTRY = Object.freeze({
  architecture: Object.freeze({
    name: 'architecture',
    title: 'Architecture Review',
    description: 'Focus on dependency structure, semantic relationships, and architecture-facing documentation artifacts.',
    promptTemplates: Object.freeze(['documentation', 'architecture-review']),
    autoOptimizeContext: true,
    primaryArtifacts: Object.freeze([
      'analysis-index.json',
      'canonical-analysis.json',
      'architecture-report.md',
      'dependency-graph.md',
      'program-call-tree.md',
      'ai_prompt_documentation.md',
      'ai_prompt_architecture_review.md',
    ]),
    reviewWorkflow: freezeReviewWorkflow({
      intendedAudience: [
        'IBM i architects',
        'Platform maintainers',
        'Engineers reviewing structural boundaries before change',
      ],
      keyQuestionsAnswered: [
        'What are the dominant program, table, and copy-member dependencies?',
        'Which unresolved edges or ambiguous calls still weaken the architecture picture?',
        'Which artifacts should anchor a structure-first architecture review?',
      ],
      expectedDecisions: [
        'Choose the next subsystem or dependency path for deeper review.',
        'Decide whether the current architecture evidence is sufficient for planned change work.',
      ],
      interpretationGuidance: [
        'Use architecture-report.md together with dependency and call-tree artifacts; summaries alone can hide structural context.',
        'Treat unresolved calls or ambiguous source resolution as follow-up work before making strong architecture claims.',
      ],
      requiredInputs: [
        'A local IBM i source tree and selected root program.',
        'Canonical semantic analysis, AI knowledge projection, and dependency graph artifacts.',
        'The documentation prompt contract for architecture-facing narrative output.',
      ],
      recommendedOutputs: [
        { path: 'architecture-report.md', purpose: 'Narrative architecture summary for review and sharing.' },
        { path: 'dependency-graph.md', purpose: 'Single-program dependency structure for quick inspection.' },
        { path: 'program-call-tree.md', purpose: 'Cross-program call chain view for boundary tracing.' },
        { path: 'ai_prompt_documentation.md', purpose: 'AI-assisted architecture walkthrough grounded in the workflow evidence.' },
      ],
    }),
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
    reviewWorkflow: freezeReviewWorkflow({
      intendedAudience: [
        'New engineers',
        'Technical writers',
        'Maintainers assembling onboarding or system orientation notes',
      ],
      keyQuestionsAnswered: [
        'What does the program do at a high level?',
        'Which tables, calls, and source-backed evidence matter most for onboarding?',
        'Which generated artifacts are most useful for documentation handoff?',
      ],
      expectedDecisions: [
        'Decide whether the generated documentation is sufficient for onboarding or needs deeper analysis.',
        'Choose the next artifact or subsystem to document in more detail.',
      ],
      interpretationGuidance: [
        'Prefer ai_prompt_documentation.md for narrative synthesis and use report.md or ai-knowledge.json to verify claims.',
        'Treat missing evidence highlights as a sign that the workflow is broad orientation, not a complete design review.',
      ],
      requiredInputs: [
        'A local IBM i source tree and selected root program.',
        'Prompt-ready AI knowledge projection with documentation workflow evidence.',
        'Report and prompt artifacts for narrative handoff.',
      ],
      recommendedOutputs: [
        { path: 'report.md', purpose: 'Broad run summary with source-backed counts and notes.' },
        { path: 'ai_prompt_documentation.md', purpose: 'Documentation-first prompt for onboarding or explanation.' },
        { path: 'ai-knowledge.json', purpose: 'Prompt-ready evidence projection for follow-up AI tasks.' },
      ],
    }),
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
    reviewWorkflow: freezeReviewWorkflow({
      intendedAudience: [
        'Incident responders',
        'Support engineers',
        'Developers triaging risky runtime behavior',
      ],
      keyQuestionsAnswered: [
        'Where are the highest-risk SQL, error-path, and evidence hotspots?',
        'Which uncertainty markers or weak handling paths need manual validation first?',
        'Which artifacts best support troubleshooting discussion?',
      ],
      expectedDecisions: [
        'Choose the highest-priority failure hypothesis to verify.',
        'Decide whether additional runtime evidence or DB2 context is needed before root-cause work.',
      ],
      interpretationGuidance: [
        'Start with the highest-ranked evidence highlights, then validate against canonical-analysis.json before concluding root cause.',
        'Treat dynamic or unresolved SQL markers as risk multipliers until verified against source or catalog evidence.',
      ],
      requiredInputs: [
        'A local IBM i source tree and selected root program.',
        'AI knowledge projection with errorAnalysis workflow evidence.',
        'Risk markers, SQL semantics, and ranked evidence highlights.',
      ],
      recommendedOutputs: [
        { path: 'ai_prompt_error_analysis.md', purpose: 'Prompt for structured troubleshooting and risk review.' },
        { path: 'report.md', purpose: 'Human-readable summary of analysis notes and operational risk signals.' },
        { path: 'ai-knowledge.json', purpose: 'Workflow-specific evidence used by error analysis prompts.' },
      ],
    }),
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
    reviewWorkflow: freezeReviewWorkflow({
      intendedAudience: [
        'Developers preparing a dependency or defect risk review',
        'Release owners',
        'Technical leads validating blast radius before change',
      ],
      keyQuestionsAnswered: [
        'Which defects or dependency paths are most likely to cause downstream impact?',
        'What source-backed evidence supports each risk hypothesis?',
        'Which artifacts should be shared with reviewers before a change decision?',
      ],
      expectedDecisions: [
        'Decide whether the change can proceed with current controls or needs more investigation.',
        'Choose the next verification step for the highest-risk dependency or defect path.',
      ],
      interpretationGuidance: [
        'Use error-analysis and defect-analysis prompts together; one surfaces risk signals and the other organizes decision-oriented hypotheses.',
        'Treat program-call and table dependencies as review inputs, not proof of production impact, until source evidence is checked.',
      ],
      requiredInputs: [
        'A local IBM i source tree and selected root program.',
        'AI knowledge projection with risk markers, SQL semantics, and ranked evidence.',
        'Dependency graph and program-call-tree artifacts for blast-radius review.',
      ],
      recommendedOutputs: [
        { path: 'ai_prompt_error_analysis.md', purpose: 'Evidence-oriented risk prompt for suspicious behavior and hotspots.' },
        { path: 'ai_prompt_defect_analysis.md', purpose: 'Decision-oriented defect and dependency risk prompt.' },
        { path: 'report.md', purpose: 'Human-readable summary to pair with prompt conclusions.' },
      ],
    }),
  }),
  modernization: Object.freeze({
    name: 'modernization',
    title: 'Modernization',
    description: 'Highlight extraction boundaries, change blockers, and evidence-backed modernization candidates.',
    promptTemplates: Object.freeze(['documentation', 'architecture-review', 'modernization']),
    autoOptimizeContext: true,
    primaryArtifacts: Object.freeze([
      'analysis-index.json',
      'canonical-analysis.json',
      'architecture-report.md',
      'ai_prompt_documentation.md',
      'ai_prompt_architecture_review.md',
      'ai_prompt_modernization.md',
    ]),
    reviewWorkflow: freezeReviewWorkflow({
      intendedAudience: [
        'Modernization leads',
        'IBM i architects',
        'Engineers planning extraction or refactoring work',
      ],
      keyQuestionsAnswered: [
        'Which change boundaries look safest to extract or rewrite first?',
        'What dependencies, native I/O patterns, or SQL semantics block clean modernization?',
        'Which artifacts best support a modernization readiness review?',
      ],
      expectedDecisions: [
        'Choose a pilot extraction candidate or defer until prerequisites are addressed.',
        'Decide which blockers require architecture, data, or integration follow-up before modernization work begins.',
      ],
      interpretationGuidance: [
        'Use ai_prompt_modernization.md for synthesis, then validate proposed seams against architecture-report.md and canonical-analysis.json.',
        'Treat unresolved calls, dynamic SQL, and mutating native file usage as modernization blockers until reviewed explicitly.',
      ],
      requiredInputs: [
        'A local IBM i source tree and selected root program.',
        'Canonical semantic analysis, AI knowledge projection, and modernization prompt contract.',
        'Architecture and dependency artifacts that expose extraction boundaries and risky integrations.',
      ],
      recommendedOutputs: [
        { path: 'ai_prompt_modernization.md', purpose: 'Opinionated modernization review prompt with blockers and candidates.' },
        { path: 'architecture-report.md', purpose: 'Architecture narrative for reviewing seams and dependencies.' },
        { path: 'canonical-analysis.json', purpose: 'Semantic source of truth for validating modernization claims.' },
        { path: 'ai_prompt_documentation.md', purpose: 'Supporting documentation prompt for reviewer context.' },
      ],
    }),
  }),
  refactoring: Object.freeze({
    name: 'refactoring',
    title: 'Refactoring',
    description: 'Focus on small safe change seams, dependency-aware sequencing, and verification guidance.',
    promptTemplates: Object.freeze(['architecture-review', 'refactoring-plan']),
    autoOptimizeContext: true,
    primaryArtifacts: Object.freeze([
      'analysis-index.json',
      'canonical-analysis.json',
      'architecture-report.md',
      'dependency-graph.md',
      'ai_prompt_architecture_review.md',
      'ai_prompt_refactoring_plan.md',
    ]),
    reviewWorkflow: freezeReviewWorkflow({
      intendedAudience: [
        'Developers planning local improvements',
        'Technical leads sequencing safer refactors',
        'Reviewers validating change boundaries before implementation',
      ],
      keyQuestionsAnswered: [
        'Which refactoring candidates are small enough to execute safely now?',
        'Which dependencies or IBM i behaviors constrain sequencing?',
        'Which evidence should reviewers inspect before approving the first change?',
      ],
      expectedDecisions: [
        'Choose the first refactoring slice and the verification plan around it.',
        'Decide whether blockers require more architecture or runtime investigation first.',
      ],
      interpretationGuidance: [
        'Prefer ai_prompt_refactoring_plan.md for sequencing guidance and ai_prompt_architecture_review.md for boundary validation.',
        'Treat mutating file I/O, unresolved calls, and dynamic SQL as indicators that refactoring scope should stay narrow until validated.',
      ],
      requiredInputs: [
        'A local IBM i source tree and selected root program.',
        'Canonical semantic analysis, architecture evidence, and dependency graph artifacts.',
        'Refactoring and architecture prompt packs grounded in the same shared context model.',
      ],
      recommendedOutputs: [
        { path: 'ai_prompt_refactoring_plan.md', purpose: 'Primary refactoring plan with sequencing and validation guidance.' },
        { path: 'ai_prompt_architecture_review.md', purpose: 'Supporting architecture prompt for boundary checks.' },
        { path: 'dependency-graph.md', purpose: 'Readable dependency structure used to limit change scope.' },
      ],
    }),
  }),
  'test-generation': Object.freeze({
    name: 'test-generation',
    title: 'Test Generation',
    description: 'Package scenario, data-setup, and assertion guidance for evidence-backed test planning.',
    promptTemplates: Object.freeze(['documentation', 'test-generation']),
    autoOptimizeContext: true,
    primaryArtifacts: Object.freeze([
      'analysis-index.json',
      'ai-knowledge.json',
      'report.md',
      'ai_prompt_documentation.md',
      'ai_prompt_test_generation.md',
    ]),
    reviewWorkflow: freezeReviewWorkflow({
      intendedAudience: [
        'Developers expanding regression coverage',
        'QA engineers translating IBM i behavior into test scenarios',
        'Reviewers planning fixtures and assertions before implementation',
      ],
      keyQuestionsAnswered: [
        'Which scenarios and edge cases deserve the first automated tests?',
        'Which dependencies, tables, or SQL paths drive fixture needs?',
        'Which generated artifacts best support evidence-backed test planning?',
      ],
      expectedDecisions: [
        'Choose the first test scenarios and fixture boundaries to implement.',
        'Decide whether additional data or diagnostic evidence is needed before writing tests.',
      ],
      interpretationGuidance: [
        'Use ai_prompt_test_generation.md for scenario design and ai_prompt_documentation.md for broader program context.',
        'Treat test-data and diagnostic-pack outputs as setup hints, not proof that runtime behavior is fully covered.',
      ],
      requiredInputs: [
        'A local IBM i source tree and selected root program.',
        'Prompt-ready AI knowledge projection with tables, SQL, evidence highlights, and optional diagnostic outputs.',
        'Documentation and test-generation prompt packs that consume the shared context model.',
      ],
      recommendedOutputs: [
        { path: 'ai_prompt_test_generation.md', purpose: 'Primary test-generation prompt with scenarios, fixtures, and assertions.' },
        { path: 'ai_prompt_documentation.md', purpose: 'Supporting documentation prompt for system context.' },
        { path: 'report.md', purpose: 'Human-readable summary for manual validation of the proposed tests.' },
      ],
    }),
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
    reviewWorkflow: freezeReviewWorkflow({
      intendedAudience: [
        'Maintainers estimating blast radius',
        'Release coordinators',
        'Engineers preparing follow-up impact analysis',
      ],
      keyQuestionsAnswered: [
        'Which generated artifacts should be reviewed before running a reverse dependency check?',
        'What structural signals define the likely blast radius for a target change?',
      ],
      expectedDecisions: [
        'Choose the impact target and next investigation command.',
        'Decide whether the available graph evidence is sufficient for a change review.',
      ],
      interpretationGuidance: [
        'Use this workflow as prework for zeus impact, not as a replacement for target-specific blast-radius analysis.',
        'Prefer program-call-tree.json and dependency-graph.json when choosing the target for reverse lookup.',
      ],
      requiredInputs: [
        'A local IBM i source tree and selected root program.',
        'Dependency graph and cross-program graph artifacts.',
        'Canonical analysis and architecture report for context before reverse impact review.',
      ],
      recommendedOutputs: [
        { path: 'dependency-graph.json', purpose: 'Machine-readable dependency structure for impact follow-up.' },
        { path: 'program-call-tree.json', purpose: 'Cross-program graph used by zeus impact.' },
        { path: 'architecture-report.md', purpose: 'Narrative context before selecting an impact target.' },
      ],
    }),
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
    reviewWorkflow: cloneReviewWorkflow(mode.reviewWorkflow),
  };
}

module.exports = {
  getWorkflowMode,
  listWorkflowModes,
  normalizeWorkflowModeName,
  resolveWorkflowModeSettings,
  WORKFLOW_MODE_REGISTRY,
};
