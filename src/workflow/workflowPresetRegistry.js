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
const { cloneReviewWorkflow, freezeReviewWorkflow } = require('./reviewWorkflowMetadata');

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
      'ai_prompt_architecture_review.md',
    ]),
    reviewWorkflow: freezeReviewWorkflow({
      intendedAudience: [
        'IBM i architects',
        'Platform maintainers',
        'Reviewers who need a shareable architecture bundle',
      ],
      keyQuestionsAnswered: [
        'Which structural artifacts should reviewers inspect first?',
        'What dependencies and unresolved edges define the architecture conversation?',
        'Which outputs are safe to share as a focused architecture packet?',
      ],
      expectedDecisions: [
        'Decide whether the current dependency picture is sufficient for planned change work.',
        'Choose the next subsystem, interface, or unresolved edge for deeper analysis.',
      ],
      interpretationGuidance: [
        'Review architecture-report.md alongside dependency and call-tree artifacts; each file answers a different part of the structure question.',
        'Treat missing local source or ambiguous call resolution as explicit limitations in the review packet.',
      ],
      requiredInputs: [
        'A local IBM i source tree and root program selection.',
        'Canonical analysis, AI knowledge projection, and generated graph artifacts.',
        'Documentation prompt output for architecture narrative support.',
      ],
      recommendedOutputs: [
        { path: 'architecture-report.md', purpose: 'Primary narrative used in architecture review discussion.' },
        { path: 'dependency-graph.md', purpose: 'Readable dependency map for the root program.' },
        { path: 'program-call-tree.md', purpose: 'Readable cross-program dependency path summary.' },
        { path: 'architecture.html', purpose: 'Interactive graph view for live review sessions.' },
        { path: 'ai_prompt_documentation.md', purpose: 'AI-assisted explanation of the architecture packet.' },
        { path: 'ai_prompt_architecture_review.md', purpose: 'Architecture-specific prompt for structural review and follow-up questions.' },
      ],
    }),
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
      'ai_prompt_architecture_review.md',
      'ai_prompt_modernization.md',
    ]),
    reviewWorkflow: freezeReviewWorkflow({
      intendedAudience: [
        'Modernization leads',
        'IBM i architects',
        'Developers planning extraction, refactoring, or migration work',
      ],
      keyQuestionsAnswered: [
        'Which modernization candidates look viable now?',
        'Which dependencies, native file behaviors, or SQL patterns block safe extraction?',
        'Which outputs should be shared to support a modernization readiness review?',
      ],
      expectedDecisions: [
        'Choose a pilot modernization target or pause until blockers are resolved.',
        'Decide which dependency or data concerns need follow-up before committing to change.',
      ],
      interpretationGuidance: [
        'Use ai_prompt_modernization.md as the synthesis layer, then verify proposed seams against canonical-analysis.json and architecture-report.md.',
        'Treat unresolved calls, dynamic SQL, and mutating file usage as blockers until reviewed explicitly.',
      ],
      requiredInputs: [
        'A local IBM i source tree and root program selection.',
        'Canonical analysis, AI knowledge projection, modernization prompt output, and architecture artifacts.',
        'Shareable bundle outputs that preserve evidence-backed context for review.',
      ],
      recommendedOutputs: [
        { path: 'ai_prompt_modernization.md', purpose: 'Primary modernization review prompt for blockers, seams, and candidates.' },
        { path: 'architecture-report.md', purpose: 'Narrative architecture evidence for modernization discussions.' },
        { path: 'program-call-tree.md', purpose: 'Call-chain context for change-boundary reasoning.' },
        { path: 'ai_prompt_documentation.md', purpose: 'Supporting documentation prompt for reviewer orientation.' },
        { path: 'ai_prompt_architecture_review.md', purpose: 'Supporting architecture prompt for reviewing structural blockers and seams.' },
      ],
    }),
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
    reviewWorkflow: freezeReviewWorkflow({
      intendedAudience: [
        'New engineers',
        'Technical leads onboarding maintainers',
        'Reviewers who need a concise orientation bundle',
      ],
      keyQuestionsAnswered: [
        'Which artifacts explain the program quickly without opening every generated file?',
        'What business and technical context is most important for a new maintainer first?',
        'Which outputs form a shareable onboarding packet?',
      ],
      expectedDecisions: [
        'Decide whether onboarding context is sufficient or deeper architecture review is needed.',
        'Choose the next artifact or subsystem a new maintainer should study.',
      ],
      interpretationGuidance: [
        'Start with report.md and ai_prompt_documentation.md, then use architecture-report.md for structural follow-up.',
        'Treat this bundle as orientation material, not a substitute for risk or modernization review.',
      ],
      requiredInputs: [
        'A local IBM i source tree and root program selection.',
        'Documentation-oriented AI knowledge projection and human-readable reports.',
        'A bundle targeted at fast sharing and orientation.',
      ],
      recommendedOutputs: [
        { path: 'report.md', purpose: 'Broad program summary for quick reading.' },
        { path: 'architecture-report.md', purpose: 'Architecture context for follow-up onboarding conversations.' },
        { path: 'ai_prompt_documentation.md', purpose: 'AI-assisted onboarding and explanation prompt.' },
      ],
    }),
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
    reviewWorkflow: freezeReviewWorkflow({
      intendedAudience: [
        'Release owners',
        'Technical leads reviewing dependency risk',
        'Developers assessing blast radius before change',
      ],
      keyQuestionsAnswered: [
        'Which dependencies, SQL paths, or defect hypotheses represent the highest change risk?',
        'What evidence should reviewers inspect before approving a risky change?',
        'Which outputs make the dependency-risk review bundle shareable without extra assembly?',
      ],
      expectedDecisions: [
        'Approve, defer, or further investigate a change based on dependency risk.',
        'Choose the next validation step for the highest-risk dependency path or defect hypothesis.',
      ],
      interpretationGuidance: [
        'Use ai_prompt_defect_analysis.md for decision framing and ai_prompt_error_analysis.md for the supporting evidence trail.',
        'Treat dependency graphs as blast-radius indicators that still need source-backed validation for production decisions.',
      ],
      requiredInputs: [
        'A local IBM i source tree and root program selection.',
        'Risk-oriented AI knowledge projection, prompt outputs, and dependency graph artifacts.',
        'A shareable bundle that keeps risk evidence and graph context together.',
      ],
      recommendedOutputs: [
        { path: 'ai_prompt_defect_analysis.md', purpose: 'Primary dependency-risk review prompt with hypotheses and decisions.' },
        { path: 'ai_prompt_error_analysis.md', purpose: 'Supporting risk evidence prompt for suspicious SQL and error paths.' },
        { path: 'dependency-graph.md', purpose: 'Readable dependency structure for review discussion.' },
        { path: 'program-call-tree.md', purpose: 'Readable cross-program blast-radius context.' },
      ],
    }),
  }),
  'refactoring-review': Object.freeze({
    name: 'refactoring-review',
    title: 'Refactoring Review',
    description: 'Bundle architecture and refactoring prompts with dependency evidence for small-scope change planning.',
    analyzeMode: 'refactoring',
    bundleArtifacts: Object.freeze([
      'analyze-run-manifest.json',
      'analysis-index.json',
      'canonical-analysis.json',
      'ai-knowledge.json',
      'architecture-report.md',
      'dependency-graph.md',
      'ai_prompt_architecture_review.md',
      'ai_prompt_refactoring_plan.md',
    ]),
    reviewWorkflow: freezeReviewWorkflow({
      intendedAudience: [
        'Developers planning low-risk refactors',
        'Technical leads reviewing sequencing and blockers',
        'Reviewers validating the first change slice before implementation',
      ],
      keyQuestionsAnswered: [
        'Which refactoring slice is small enough to start now?',
        'Which dependencies or IBM i behaviors constrain sequencing?',
        'Which outputs should be shared before approving the first change?',
      ],
      expectedDecisions: [
        'Choose the first refactoring slice and its validation plan.',
        'Decide whether more investigation is needed before changing code.',
      ],
      interpretationGuidance: [
        'Use ai_prompt_refactoring_plan.md for change sequencing and ai_prompt_architecture_review.md for boundary checks.',
        'Keep scope narrow when unresolved calls, dynamic SQL, or mutating file I/O remain in the evidence set.',
      ],
      requiredInputs: [
        'A local IBM i source tree and root program selection.',
        'Canonical analysis, dependency artifacts, and the refactoring-focused prompt packs.',
        'A shareable bundle that keeps architecture context and refactoring guidance together.',
      ],
      recommendedOutputs: [
        { path: 'ai_prompt_refactoring_plan.md', purpose: 'Primary refactoring guidance with sequencing and safety checks.' },
        { path: 'ai_prompt_architecture_review.md', purpose: 'Supporting architecture prompt for boundary validation.' },
        { path: 'dependency-graph.md', purpose: 'Readable dependency map used to constrain change scope.' },
      ],
    }),
  }),
  'test-generation-review': Object.freeze({
    name: 'test-generation-review',
    title: 'Test Generation Review',
    description: 'Bundle documentation and test-generation prompts with evidence for scenario and fixture planning.',
    analyzeMode: 'test-generation',
    bundleArtifacts: Object.freeze([
      'analyze-run-manifest.json',
      'analysis-index.json',
      'ai-knowledge.json',
      'report.md',
      'ai_prompt_documentation.md',
      'ai_prompt_test_generation.md',
    ]),
    reviewWorkflow: freezeReviewWorkflow({
      intendedAudience: [
        'Developers adding regression coverage',
        'QA engineers translating IBM i logic into tests',
        'Reviewers planning fixtures and assertion strategy',
      ],
      keyQuestionsAnswered: [
        'Which scenarios deserve the first automated tests?',
        'Which tables, SQL paths, or dependencies shape fixture design?',
        'Which outputs make the test-planning packet shareable?',
      ],
      expectedDecisions: [
        'Choose the first test scenarios and fixture boundaries to implement.',
        'Decide whether more runtime or catalog evidence is needed before writing tests.',
      ],
      interpretationGuidance: [
        'Use ai_prompt_test_generation.md for scenarios and assertions, then confirm assumptions against report.md and ai_prompt_documentation.md.',
        'Treat extracted sample rows and diagnostic outputs as setup hints, not complete runtime coverage.',
      ],
      requiredInputs: [
        'A local IBM i source tree and root program selection.',
        'Prompt-ready AI knowledge projection with tables, SQL, and evidence highlights.',
        'A shareable bundle targeted at test-scenario and fixture planning.',
      ],
      recommendedOutputs: [
        { path: 'ai_prompt_test_generation.md', purpose: 'Primary prompt for scenario, fixture, and assertion planning.' },
        { path: 'ai_prompt_documentation.md', purpose: 'Supporting prompt for program context and flow.' },
        { path: 'report.md', purpose: 'Human-readable summary for validating proposed coverage.' },
      ],
    }),
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
    reviewWorkflow: cloneReviewWorkflow(preset.reviewWorkflow),
  };
}

module.exports = {
  getWorkflowPreset,
  listWorkflowPresets,
  normalizeWorkflowPresetName,
  resolveWorkflowPresetSettings,
  WORKFLOW_PRESET_REGISTRY,
};
