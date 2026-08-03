'use strict';

const { DEFAULT_MCP_SAFE_TOOL_NAMES } = require('./mcpPolicy');

const BASE_STEPS = Object.freeze([
  { tool: 'zeus.agent.bootstrap', purpose: 'Load the live agent contract.', safety: 'S0' },
  { tool: 'zeus.help', purpose: 'Confirm live help and available next steps.', safety: 'S0' },
  { tool: 'zeus.doctor', purpose: 'Check profile and runtime readiness.', safety: 'S0' },
]);

const GOAL_PLANS = Object.freeze([
  {
    id: 'project-knowledge',
    matches: ['project knowledge', 'project-knowledge', 'knowledge base', 'knowledgebase'],
    steps: [
      {
        tool: 'zeus.project-knowledge.discover',
        purpose: 'Detect Project Intelligence availability.',
        safety: 'S0',
      },
      {
        tool: 'zeus.project-knowledge.status',
        purpose: 'Inspect registered Project Intelligence status.',
        safety: 'S0',
      },
      {
        tool: 'zeus.project-knowledge.query',
        purpose: 'Query indexed project knowledge when explicitly enabled.',
        safety: 'S2',
        approvalRequired: true,
      },
    ],
  },
  {
    id: 'security',
    matches: ['security', 'secure', 'vulnerability', 'injection'],
    steps: [
      { tool: 'zeus.analyze', purpose: 'Generate source-backed security evidence.', safety: 'S1' },
      {
        tool: 'zeus.assess-risk',
        purpose: 'Assess risks in the generated canonical analysis.',
        safety: 'S1',
      },
      {
        tool: 'zeus.generate-checklist',
        purpose: 'Create a review checklist from findings.',
        safety: 'S1',
      },
    ],
  },
  {
    id: 'test-generation',
    matches: ['test', 'tests', 'coverage', 'regression', 'fixture'],
    steps: [
      { tool: 'zeus.analyze', purpose: 'Generate evidence for test planning.', safety: 'S1' },
      {
        tool: 'zeus.generate-test',
        purpose: 'Generate test scenarios from evidence.',
        safety: 'S1',
      },
      { tool: 'zeus.qa', purpose: 'Review generated QA artifacts.', safety: 'S1' },
    ],
  },
  {
    id: 'risk-review',
    matches: ['risk', 'impact', 'dependency', 'blast radius', 'defect'],
    steps: [
      { tool: 'zeus.analyze', purpose: 'Generate dependency and source evidence.', safety: 'S1' },
      {
        tool: 'zeus.impact',
        purpose: 'Trace impact from the analyzed dependency graph.',
        safety: 'S1',
      },
      { tool: 'zeus.assess-risk', purpose: 'Assess change and operational risks.', safety: 'S1' },
    ],
  },
  {
    id: 'architecture-review',
    matches: ['architecture', 'modernization', 'modernisation', 'refactor', 'design'],
    steps: [
      { tool: 'zeus.analyze', purpose: 'Generate structure-first source evidence.', safety: 'S1' },
      {
        tool: 'zeus.workflow',
        purpose: 'Run the selected architecture or modernization preset.',
        safety: 'S1',
      },
      { tool: 'zeus.bundle', purpose: 'Package review artifacts for sharing.', safety: 'S1' },
    ],
  },
]);

function inferGoal(goal) {
  const normalized = String(goal || '')
    .trim()
    .toLowerCase();
  return (
    GOAL_PLANS.find(plan => plan.matches.some(match => normalized.includes(match))) || {
      id: 'local-analysis',
      steps: [
        {
          tool: 'zeus.resources',
          purpose: 'Inspect the resolved local resource model.',
          safety: 'S0',
        },
        {
          tool: 'zeus.search-source',
          purpose: 'Explore local source before selecting a program.',
          safety: 'S1',
        },
        {
          tool: 'zeus.analyze',
          purpose: 'Generate bounded, source-backed analysis artifacts.',
          safety: 'S1',
        },
      ],
    }
  );
}

function buildWorkflowSuggestion({ goal, profile = null } = {}) {
  const plan = inferGoal(goal);
  const steps = [...BASE_STEPS, ...plan.steps].map((step, index) => ({
    order: index + 1,
    tool: step.tool,
    purpose: step.purpose,
    safety: step.safety,
    approvalRequired: Boolean(step.approvalRequired),
    defaultAllowlisted: DEFAULT_MCP_SAFE_TOOL_NAMES.includes(step.tool),
  }));
  return {
    ok: true,
    service: 'zeus-rpg-promptkit',
    schemaVersion: 1,
    goal: String(goal || '').trim(),
    profile: profile ? String(profile).trim() : null,
    plan: plan.id,
    readOnly: true,
    executionStarted: false,
    steps,
    notes: [
      'This is a suggestion only; no tool was executed.',
      'Use tools/list or zeus.help to verify the live surface before calling a step.',
      'A step marked approvalRequired must not be called without explicit operator approval and allowlisting.',
    ],
    next: steps[0].tool,
  };
}

module.exports = { buildWorkflowSuggestion, inferGoal };
