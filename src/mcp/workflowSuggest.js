'use strict';

const { DEFAULT_MCP_SAFE_TOOL_NAMES } = require('./mcpPolicy');

const BASE_STEPS = Object.freeze([
  {
    tool: 'zeus.agent.bootstrap',
    purpose: 'Load the live agent contract.',
    safety: 'S0',
    checkpoint: 'bootstrap-loaded',
  },
  {
    tool: 'zeus.help',
    purpose: 'Confirm live help and available next steps.',
    safety: 'S0',
    checkpoint: 'help-confirmed',
  },
  {
    tool: 'zeus.doctor',
    purpose: 'Check profile and runtime readiness.',
    safety: 'S0',
    checkpoint: 'doctor-ok',
    onFailure: {
      code: 'MISSING_PROFILE',
      recover: 'Fix profile/env wiring, re-run doctor, then continue.',
    },
  },
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
        checkpoint: 'pi-presence',
        onFailure: {
          code: 'PI_ABSENT',
          recover: 'Fall back to Community analyze/search-source/impact tools.',
        },
      },
      {
        tool: 'zeus.project-knowledge.status',
        purpose: 'Inspect registered Project Intelligence status.',
        safety: 'S0',
        checkpoint: 'pi-presence',
        onFailure: {
          code: 'PI_ABSENT',
          recover: 'Skip status; use Community tools instead.',
        },
      },
      {
        tool: 'zeus.project-knowledge.query',
        purpose: 'Query indexed project knowledge when explicitly enabled.',
        safety: 'S2',
        approvalRequired: true,
        checkpoint: 'pi-query-approval',
        onFailure: {
          code: 'APPROVAL_REQUIRED',
          recover: 'Wait for explicit operator approval and allowlisting before querying.',
        },
      },
    ],
  },
  {
    id: 'security',
    matches: ['security', 'secure', 'vulnerability', 'injection'],
    steps: [
      {
        tool: 'zeus.analyze',
        purpose: 'Generate source-backed security evidence.',
        safety: 'S1',
        checkpoint: 'artifacts-present',
        onFailure: {
          code: 'ANALYZE_REQUIRED',
          recover: 'Provide --source and re-run analyze before risk tools.',
        },
      },
      {
        tool: 'zeus.assess-risk',
        purpose: 'Assess risks in the generated canonical analysis.',
        safety: 'S1',
        checkpoint: 'artifacts-present',
        onFailure: {
          code: 'ANALYZE_REQUIRED',
          recover: 'Ensure analyze completed successfully first.',
        },
      },
      {
        tool: 'zeus.generate-checklist',
        purpose: 'Create a review checklist from findings.',
        safety: 'S1',
        checkpoint: 'artifacts-present',
      },
    ],
  },
  {
    id: 'test-generation',
    matches: ['test', 'tests', 'coverage', 'regression', 'fixture'],
    steps: [
      {
        tool: 'zeus.analyze',
        purpose: 'Generate evidence for test planning.',
        safety: 'S1',
        checkpoint: 'artifacts-present',
        onFailure: {
          code: 'ANALYZE_REQUIRED',
          recover: 'Provide --source and re-run analyze before generate-test.',
        },
      },
      {
        tool: 'zeus.generate-test',
        purpose: 'Generate test scenarios from evidence.',
        safety: 'S1',
        checkpoint: 'artifacts-present',
      },
      { tool: 'zeus.qa', purpose: 'Review generated QA artifacts.', safety: 'S1' },
    ],
  },
  {
    id: 'risk-review',
    matches: ['risk', 'impact', 'dependency', 'blast radius', 'defect'],
    steps: [
      {
        tool: 'zeus.analyze',
        purpose: 'Generate dependency and source evidence.',
        safety: 'S1',
        checkpoint: 'artifacts-present',
        onFailure: {
          code: 'ANALYZE_REQUIRED',
          recover: 'Provide --source and re-run analyze before impact.',
        },
      },
      {
        tool: 'zeus.impact',
        purpose: 'Trace impact from the analyzed dependency graph.',
        safety: 'S1',
        checkpoint: 'artifacts-present',
        onFailure: {
          code: 'ANALYZE_REQUIRED',
          recover: 'Ensure analyze graph artifacts exist.',
        },
      },
      {
        tool: 'zeus.assess-risk',
        purpose: 'Assess change and operational risks.',
        safety: 'S1',
        checkpoint: 'artifacts-present',
      },
    ],
  },
  {
    id: 'architecture-review',
    matches: ['architecture', 'modernization', 'modernisation', 'refactor', 'design'],
    steps: [
      {
        tool: 'zeus.analyze',
        purpose: 'Generate structure-first source evidence.',
        safety: 'S1',
        checkpoint: 'artifacts-present',
        onFailure: {
          code: 'ANALYZE_REQUIRED',
          recover: 'Provide --source and re-run analyze before workflow/bundle.',
        },
      },
      {
        tool: 'zeus.workflow',
        purpose: 'Run the selected architecture or modernization preset.',
        safety: 'S1',
        checkpoint: 'artifacts-present',
      },
      {
        tool: 'zeus.bundle',
        purpose: 'Package review artifacts for sharing.',
        safety: 'S1',
        checkpoint: 'artifacts-present',
      },
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
          checkpoint: 'doctor-ok',
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
          checkpoint: 'artifacts-present',
          onFailure: {
            code: 'ANALYZE_REQUIRED',
            recover: 'Provide --source and re-run analyze.',
          },
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
    checkpoint: step.checkpoint || null,
    onFailure: step.onFailure
      ? {
          code: step.onFailure.code,
          recover: step.onFailure.recover,
        }
      : null,
  }));

  const checkpointIds = [];
  const checkpoints = [];
  for (const step of steps) {
    if (step.checkpoint && !checkpointIds.includes(step.checkpoint)) {
      checkpointIds.push(step.checkpoint);
      checkpoints.push({
        id: step.checkpoint,
        afterStep: step.order,
        tool: step.tool,
        gate:
          step.checkpoint === 'doctor-ok'
            ? 'Profile and runtime must be healthy before continuing.'
            : step.checkpoint === 'artifacts-present'
              ? 'Analyze (or equivalent) artifacts must exist before dependent tools.'
              : step.checkpoint === 'operator-approval' || step.checkpoint === 'pi-query-approval'
                ? 'Explicit operator approval required before this step.'
                : step.checkpoint === 'pi-presence'
                  ? 'Project Intelligence must be present; otherwise use Community fallbacks.'
                  : 'Confirm step success before continuing.',
        onFailure: step.onFailure,
      });
    }
  }

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
    checkpoints,
    notes: [
      'This is a suggestion only; no tool was executed.',
      'Use tools/list or zeus.help to verify the live surface before calling a step.',
      'A step marked approvalRequired must not be called without explicit operator approval and allowlisting.',
      'Honor checkpoints before continuing; on failure match onFailure.code to the agent failure playbook.',
    ],
    next: steps[0].tool,
  };
}

module.exports = { buildWorkflowSuggestion, inferGoal };
