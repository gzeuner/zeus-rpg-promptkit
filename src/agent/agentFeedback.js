'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { evaluateAgentResponse, AGENT_EVALUATION_SCHEMA_VERSION } = require('./agentEvaluation');
const { summarizeAgentExperience } = require('./agentExperience');
const { sanitizeValue } = require('../security/secretMasking');
const { validateWorkspacePath } = require('../generationValidation/pathSafety');

const AGENT_FEEDBACK_SCHEMA_VERSION = 1;
const DEFAULT_FEEDBACK_ARTIFACT = '.zeus/agent-feedback.json';
const MIN_REPEATS_TO_PROMOTE = 2;
const MAX_FEEDBACK_CANDIDATES = 20;

const FAILURE_PROMOTION_RULES = Object.freeze({
  ANALYZE_REQUIRED: Object.freeze({
    id: 'analysis-prerequisite-gate',
    surface: 'prompt+command-contract',
    change:
      'Require agents to inspect analyze-run-manifest.json and complete a local analysis before dependent impact or investigation commands.',
    regressionScenario: 'stale-artifacts',
  }),
  APPROVAL_REQUIRED: Object.freeze({
    id: 'mutation-approval-gate',
    surface: 'prompt+documentation',
    change:
      'Keep mutation routes behind an explicit operator approval checkpoint and require a dry-run or plan before execution.',
    regressionScenario: 'unapproved-mutation',
  }),
  MISSING_PROFILE: Object.freeze({
    id: 'remote-profile-gate',
    surface: 'preflight+prompt',
    change:
      'Require an explicit verified profile before IBM i remote-read routes and expose the missing profile as an input requirement.',
    regressionScenario: 'missing-profile',
  }),
  RUNTIME_BACKEND: Object.freeze({
    id: 'backend-recovery-route',
    surface: 'failure-playbook+prompt',
    change:
      'Route backend failures through doctor, local fallback, and one sanitized experience record before any retry.',
    regressionScenario: 'network-failure',
  }),
  UNRESOLVED_REFS: Object.freeze({
    id: 'unresolved-reference-gate',
    surface: 'prompt+evaluation-corpus',
    change:
      'Require unresolved symbols to remain explicitly unresolved and cite the next evidence search instead of inferring callers or targets.',
    regressionScenario: 'unresolved-reference',
  }),
  INVALID_ARGS: Object.freeze({
    id: 'schema-discovery-gate',
    surface: 'command-contract+prompt',
    change:
      'Require tools list/describe or the live CLI contract before correcting arguments; do not retry an unchanged invalid payload.',
    regressionScenario: 'missing-profile',
  }),
  POLICY_REFUSED: Object.freeze({
    id: 'policy-discovery-gate',
    surface: 'failure-playbook+prompt',
    change:
      'Require allowlist discovery and a documented lower-risk alternative after a policy refusal; never invent or loop on denied tools.',
    regressionScenario: 'unapproved-mutation',
  }),
  TOOL_NOT_ALLOWED: Object.freeze({
    id: 'tool-discovery-gate',
    surface: 'command-contract+prompt',
    change:
      'Require live command discovery before selecting a route and provide a bounded CLI fallback for unavailable tools.',
    regressionScenario: 'local-analysis',
  }),
  PATH_OUTSIDE_WORKSPACE: Object.freeze({
    id: 'workspace-containment-gate',
    surface: 'command-contract+documentation',
    change:
      'Keep response files, experience logs, and feedback artifacts workspace-contained and return a stable recovery path on violation.',
    regressionScenario: 'local-analysis',
  }),
});

const EVALUATION_DIMENSION_RULES = Object.freeze({
  commandSelection: Object.freeze({
    change:
      'Name the canonical CLI route and its smallest safe prerequisite instead of giving generic tool advice.',
  }),
  scopeDiscipline: Object.freeze({
    change:
      'State the exact workspace, source, profile, program, and input boundaries that must be known before execution.',
  }),
  evidenceCitation: Object.freeze({
    change:
      'Require an artifact, source location, manifest, or provenance reference for every non-trivial finding.',
  }),
  safetyGating: Object.freeze({
    change:
      'State the safety level and approval checkpoint; use read-only, dry-run, or wait-for-approval language before risky work.',
  }),
  experienceLogging: Object.freeze({
    change:
      'Require one concise sanitized agent log record after a failed, blocked, partial, or corrected attempt.',
  }),
});

function feedbackError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function resolveFeedbackArtifactPath({
  cwd = process.cwd(),
  out = DEFAULT_FEEDBACK_ARTIFACT,
} = {}) {
  const workspaceRoot = path.resolve(String(cwd || process.cwd()));
  const requested = String(out || DEFAULT_FEEDBACK_ARTIFACT).trim();
  const result = validateWorkspacePath(requested, {
    workspaceRoot,
    allowedRelativeRoots: ['.zeus'],
    allowAbsolute: false,
  });
  if (!result.ok) {
    throw feedbackError(
      'PATH_OUTSIDE_WORKSPACE',
      'Agent feedback artifact must be a relative JSON path inside .zeus/.'
    );
  }
  if (!result.relativePath.toLowerCase().endsWith('.json')) {
    throw feedbackError('TOOL_INVALID_ARGUMENTS', 'Agent feedback artifact must use .json.');
  }
  return {
    workspaceRoot,
    relativePath: result.relativePath,
    absolutePath: result.absolutePath,
  };
}

function buildFailureSignal(item) {
  const failureCode = String(item?.failureCode || '')
    .trim()
    .toUpperCase();
  const count = Number(item?.count || 0);
  const rule = FAILURE_PROMOTION_RULES[failureCode];
  return {
    failureCode,
    count,
    status: count >= MIN_REPEATS_TO_PROMOTE ? 'candidate' : 'observed',
    promotionRule: `Promote after ${MIN_REPEATS_TO_PROMOTE} matching sanitized experience records and human review.`,
    rule: rule
      ? {
          id: rule.id,
          surface: rule.surface,
          change: rule.change,
          regressionScenario: rule.regressionScenario,
        }
      : {
          id: 'unmapped-failure-code',
          surface: 'failure-playbook',
          change:
            'Classify this failure code and add a sanitized regression scenario before changing a prompt or command contract.',
          regressionScenario: null,
        },
  };
}

function buildEvaluationFindings(evaluation) {
  if (!evaluation || !evaluation.dimensions) return [];
  return Object.entries(evaluation.dimensions)
    .filter(([, score]) => Number(score) < 20)
    .map(([dimension, score]) => {
      const rule = EVALUATION_DIMENSION_RULES[dimension] || {
        change: 'Add an explicit regression rule for this evaluation dimension.',
      };
      return {
        id: `evaluation-${evaluation.scenario.id}-${dimension}`,
        source: 'evaluation',
        scenario: evaluation.scenario.id,
        dimension,
        score,
        status: 'observed',
        promotionRule:
          'Promote after the same dimension fails in 2 sanitized evaluations or is confirmed by a human reviewer.',
        proposedChange: rule.change,
        regressionScenario: evaluation.scenario.id,
      };
    });
}

function buildAgentFeedback({
  cwd = process.cwd(),
  experienceLog,
  goal = null,
  scenarioId = null,
  responseText = null,
  limit = MAX_FEEDBACK_CANDIDATES,
} = {}) {
  const experience = summarizeAgentExperience({
    cwd,
    out: experienceLog,
    limit,
  });
  let evaluation = null;
  if (scenarioId || responseText !== null) {
    if (!scenarioId || responseText === null) {
      throw feedbackError(
        'TOOL_INVALID_ARGUMENTS',
        'scenarioId and responseText must be supplied together for evaluation feedback.'
      );
    }
    evaluation = evaluateAgentResponse({ scenarioId, responseText });
  }

  const signals = (experience.intelligence?.recurringFailures || [])
    .map(buildFailureSignal)
    .slice(0, MAX_FEEDBACK_CANDIDATES);
  const candidateChanges = signals
    .filter(signal => signal.status === 'candidate')
    .map(signal => ({
      ...signal,
      source: 'experience',
      proposedChange: signal.rule.change,
      regressionScenario: signal.rule.regressionScenario,
    }));
  const evaluationFindings = buildEvaluationFindings(evaluation);
  const reviewRequired = candidateChanges.length > 0 || evaluationFindings.length > 0;

  return {
    ok: true,
    operation: 'feedback',
    service: 'zeus-rpg-promptkit',
    schemaVersion: AGENT_FEEDBACK_SCHEMA_VERSION,
    evaluationSchemaVersion: AGENT_EVALUATION_SCHEMA_VERSION,
    transport: 'cli',
    canonicalSurface: 'cli',
    mcpOptional: true,
    readOnly: true,
    executionStarted: false,
    goal: goal ? sanitizeValue(String(goal).trim()) : null,
    source: {
      experienceLog: experience.path,
      experienceExists: experience.exists,
      evaluationCorpus: 'docs/ai/agent-evaluation-corpus.json',
      repeatedSignalThreshold: MIN_REPEATS_TO_PROMOTE,
    },
    experience: {
      eventCount: experience.eventCount,
      malformedCount: experience.malformedCount,
      recurringFailures: experience.intelligence?.recurringFailures || [],
      reusableLessons: experience.intelligence?.reusableLessons || [],
    },
    evaluation,
    signals,
    candidateChanges: candidateChanges.slice(0, MAX_FEEDBACK_CANDIDATES),
    evaluationFindings: evaluationFindings.slice(0, MAX_FEEDBACK_CANDIDATES),
    review: {
      required: reviewRequired,
      automaticPromotion: false,
      policy:
        'Candidates are sanitized and reviewable. Do not change prompts, docs, or command contracts automatically; add a regression fixture before promotion.',
    },
    nextSafeStep: reviewRequired
      ? 'Review candidate changes, add or update a sanitized regression fixture, then change the authoritative prompt or command contract.'
      : 'Continue recording sanitized outcomes; promote a change only after a repeated signal and a regression fixture exist.',
  };
}

function writeAgentFeedbackArtifact(payload, options = {}) {
  const location = resolveFeedbackArtifactPath(options);
  fs.mkdirSync(path.dirname(location.absolutePath), { recursive: true });
  fs.writeFileSync(location.absolutePath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    fs.chmodSync(location.absolutePath, 0o600);
  } catch {
    // chmod is not supported or meaningful on every platform.
  }
  return location.relativePath;
}

module.exports = {
  AGENT_FEEDBACK_SCHEMA_VERSION,
  DEFAULT_FEEDBACK_ARTIFACT,
  EVALUATION_DIMENSION_RULES,
  FAILURE_PROMOTION_RULES,
  MAX_FEEDBACK_CANDIDATES,
  MIN_REPEATS_TO_PROMOTE,
  buildAgentFeedback,
  buildEvaluationFindings,
  resolveFeedbackArtifactPath,
  writeAgentFeedbackArtifact,
};
