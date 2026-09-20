'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { redactAgentText } = require('./agentExperience');
const { validateWorkspacePath } = require('../generationValidation/pathSafety');
const { queryProcesses, resolveCatalogPath } = require('../projectIntelligence/process/retrieval');

const PROCESS_ANSWER_REGRESSION_SCHEMA_VERSION = 1;
const DEFAULT_PROCESS_ANSWER_REGRESSION_ARTIFACT = '.zeus/process-answer-regression.json';
const MAX_CORPUS_BYTES = 2 * 1024 * 1024;
const MAX_DECISION_BYTES = 256 * 1024;
const MAX_SCENARIOS = 100;
const MAX_TERMS = 20;

const FRESHNESS_RANK = Object.freeze({
  fresh: 4,
  published: 4,
  reviewed: 3,
  candidate: 2,
  stale: 1,
  unknown: 0,
});
const PROCESS_STATUSES = new Set(['candidate', 'reviewed', 'published', 'stale', 'unknown']);

function regressionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function canonicalValue(value) {
  if (Array.isArray(value)) {
    return value
      .map(canonicalValue)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonicalValue(value[key])])
    );
  }
  return value;
}

function normalizeText(value) {
  return String(value == null ? '' : value)
    .normalize('NFKC')
    .toLocaleLowerCase('de-DE')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function uniqueStrings(values, limit = MAX_TERMS) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map(value => redactAgentText(value).trim())
        .filter(Boolean)
    ),
  ].slice(0, limit);
}

function readJsonFile(location, label, maxBytes) {
  if (!fs.existsSync(location)) {
    throw regressionError('PROCESS_ANSWER_REGRESSION_INPUT_MISSING', `${label} does not exist.`);
  }
  const stats = fs.statSync(location);
  if (!stats.isFile() || stats.size > maxBytes) {
    throw regressionError(
      'PROCESS_ANSWER_REGRESSION_INPUT_INVALID',
      `${label} must be a regular JSON file no larger than ${maxBytes} bytes.`
    );
  }
  try {
    return JSON.parse(fs.readFileSync(location, 'utf8'));
  } catch {
    throw regressionError('PROCESS_ANSWER_REGRESSION_INPUT_INVALID', `${label} is not valid JSON.`);
  }
}

function normalizeScenario(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw regressionError(
      'PROCESS_ANSWER_CORPUS_INVALID',
      `Regression scenario ${index + 1} must be an object.`
    );
  }
  const id = redactAgentText(value.id || value.scenarioId);
  const question = redactAgentText(value.question);
  if (!id || !question) {
    throw regressionError(
      'PROCESS_ANSWER_CORPUS_INVALID',
      `Regression scenario ${index + 1} requires id and question.`
    );
  }
  const expectedStatus = value.expectedStatus == null ? null : String(value.expectedStatus).trim();
  if (expectedStatus && !PROCESS_STATUSES.has(expectedStatus)) {
    throw regressionError(
      'PROCESS_ANSWER_CORPUS_INVALID',
      `Regression scenario ${id} has an unsupported expectedStatus.`
    );
  }
  const maxFreshness = String(value.maxFreshness || 'published')
    .trim()
    .toLowerCase();
  if (FRESHNESS_RANK[maxFreshness] == null) {
    throw regressionError(
      'PROCESS_ANSWER_CORPUS_INVALID',
      `Regression scenario ${id} has an unsupported maxFreshness.`
    );
  }
  return {
    id,
    question,
    expectedProcessIds: uniqueStrings(value.expectedProcessIds, 20),
    expectedStatus,
    requiredAnswerTerms: uniqueStrings(value.requiredAnswerTerms, MAX_TERMS),
    requireEvidence: value.requireEvidence !== false,
    requiredEvidenceKinds: uniqueStrings(value.requiredEvidenceKinds, MAX_TERMS),
    maxFreshness,
    limit: Number.isInteger(value.limit) ? Math.max(1, Math.min(20, value.limit)) : 5,
  };
}

function normalizeCorpus(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.kind !== 'process-answer-regression-corpus' ||
    value.schemaVersion !== PROCESS_ANSWER_REGRESSION_SCHEMA_VERSION
  ) {
    throw regressionError(
      'PROCESS_ANSWER_CORPUS_INVALID',
      'The corpus must be a version 1 process-answer-regression-corpus.'
    );
  }
  const corpusId = redactAgentText(value.corpusId || value.id);
  const corpusVersion = redactAgentText(value.corpusVersion || value.revision);
  if (!corpusId || !corpusVersion) {
    throw regressionError(
      'PROCESS_ANSWER_CORPUS_INVALID',
      'The corpus requires corpusId and corpusVersion.'
    );
  }
  if (
    value.sanitized !== true ||
    value.containsCredentials !== false ||
    value.containsPrivateProjectIdentifiers !== false
  ) {
    throw regressionError(
      'PROCESS_ANSWER_CORPUS_UNSAFE',
      'The corpus must explicitly declare sanitized=true, containsCredentials=false, and containsPrivateProjectIdentifiers=false.'
    );
  }
  if (!Array.isArray(value.scenarios) || value.scenarios.length === 0) {
    throw regressionError('PROCESS_ANSWER_CORPUS_INVALID', 'The corpus must contain scenarios.');
  }
  if (value.scenarios.length > MAX_SCENARIOS) {
    throw regressionError(
      'PROCESS_ANSWER_CORPUS_INVALID',
      `The corpus may contain at most ${MAX_SCENARIOS} scenarios.`
    );
  }
  const scenarios = value.scenarios.map(normalizeScenario);
  const ids = new Set();
  for (const scenario of scenarios) {
    if (ids.has(scenario.id)) {
      throw regressionError(
        'PROCESS_ANSWER_CORPUS_INVALID',
        `Duplicate scenario id: ${scenario.id}.`
      );
    }
    ids.add(scenario.id);
  }
  return {
    schemaVersion: PROCESS_ANSWER_REGRESSION_SCHEMA_VERSION,
    kind: 'process-answer-regression-corpus',
    corpusId,
    corpusVersion,
    sanitized: true,
    containsCredentials: false,
    containsPrivateProjectIdentifiers: false,
    scenarios,
  };
}

function readProcessAnswerRegressionCorpus(filePath, options = {}) {
  const raw = String(filePath || '').trim();
  if (!raw) {
    throw regressionError('PROCESS_ANSWER_CORPUS_REQUIRED', '--corpus is required.');
  }
  const resolved = resolveCatalogPath(raw, options.cwd || process.cwd());
  if (!resolved.toLowerCase().endsWith('.json')) {
    throw regressionError('PROCESS_ANSWER_CORPUS_INVALID', '--corpus must be a JSON file.');
  }
  return normalizeCorpus(
    readJsonFile(resolved, 'Process-answer regression corpus', MAX_CORPUS_BYTES)
  );
}

function catalogFingerprint(catalog) {
  return `catalog:${stableHash(JSON.stringify(canonicalValue(catalog))).slice(0, 16)}`;
}

function evaluateScenario(catalog, scenario) {
  const query = queryProcesses(catalog, scenario.question, { limit: scenario.limit });
  const matchedProcessIds = query.matches.map(match => match.id);
  const expectedProcessesSatisfied =
    scenario.expectedProcessIds.length === 0
      ? matchedProcessIds.length > 0
      : scenario.expectedProcessIds.every(id => matchedProcessIds.includes(id));
  const expectedStatusSatisfied =
    !scenario.expectedStatus || query.status === scenario.expectedStatus;
  const evidenceSatisfied = !scenario.requireEvidence || query.evidenceReferences.length > 0;
  const evidenceKindsSatisfied = scenario.requiredEvidenceKinds.every(kind =>
    query.evidenceReferences.some(reference => reference.kind === kind)
  );
  const answerText = normalizeText(query.answer);
  const answerTermsSatisfied = scenario.requiredAnswerTerms.every(term =>
    answerText.includes(normalizeText(term))
  );
  const freshnessSatisfied =
    (FRESHNESS_RANK[query.freshness.status] || 0) >= FRESHNESS_RANK[scenario.maxFreshness];
  const blockers = [];
  if (!expectedProcessesSatisfied) blockers.push('EXPECTED_PROCESS_MISSING');
  if (!expectedStatusSatisfied) blockers.push('EXPECTED_STATUS_MISMATCH');
  if (!evidenceSatisfied) blockers.push('EVIDENCE_MISSING');
  if (!evidenceKindsSatisfied) blockers.push('EVIDENCE_KIND_MISSING');
  if (!answerTermsSatisfied) blockers.push('ANSWER_TERM_MISSING');
  if (!freshnessSatisfied) blockers.push('FRESHNESS_BELOW_THRESHOLD');
  return {
    id: scenario.id,
    status: blockers.length === 0 ? 'pass' : 'fail',
    matchedProcessCount: matchedProcessIds.length,
    matchedProcessIds,
    returnedStatus: query.status,
    returnedFreshness: query.freshness.status,
    evidenceCount: query.evidenceReferences.length,
    blockers,
  };
}

function resolveDecisionPath({ cwd, input }) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const location = validateWorkspacePath(raw, {
    workspaceRoot: path.resolve(String(cwd || process.cwd())),
    allowedRelativeRoots: ['.zeus'],
    allowAbsolute: false,
  });
  if (!location.ok || !location.relativePath.toLowerCase().endsWith('.json')) {
    throw regressionError(
      'PATH_OUTSIDE_WORKSPACE',
      'Reviewer decision must be a relative JSON path inside .zeus/.'
    );
  }
  return location;
}

function inspectDecision({ cwd, input, corpus, fingerprint, evaluationId }) {
  const location = resolveDecisionPath({ cwd, input });
  if (!location) {
    return {
      path: null,
      status: 'missing',
      reviewerId: null,
      approved: false,
      blockers: ['REVIEW_DECISION_MISSING'],
    };
  }
  let decision;
  try {
    decision = readJsonFile(
      location.absolutePath,
      'Process-answer reviewer decision',
      MAX_DECISION_BYTES
    );
  } catch {
    return {
      path: location.relativePath,
      status: 'invalid',
      reviewerId: null,
      approved: false,
      blockers: ['REVIEW_DECISION_INVALID'],
    };
  }
  const blockers = [];
  if (
    !decision ||
    decision.kind !== 'process-answer-review-decision' ||
    decision.schemaVersion !== PROCESS_ANSWER_REGRESSION_SCHEMA_VERSION
  ) {
    blockers.push('REVIEW_DECISION_INVALID');
  }
  if (decision && decision.corpusId !== corpus.corpusId) blockers.push('CORPUS_ID_MISMATCH');
  if (decision && decision.corpusVersion !== corpus.corpusVersion)
    blockers.push('CORPUS_VERSION_MISMATCH');
  if (decision && decision.catalogFingerprint !== fingerprint)
    blockers.push('CATALOG_FINGERPRINT_MISMATCH');
  if (decision && decision.evaluationId !== evaluationId) blockers.push('EVALUATION_ID_MISMATCH');
  if (decision && decision.sanitized !== true) blockers.push('REVIEW_DECISION_NOT_SANITIZED');
  if (decision && decision.containsCredentials !== false)
    blockers.push('REVIEW_DECISION_CREDENTIAL_FLAG');
  if (decision && decision.containsPrivateProjectIdentifiers !== false)
    blockers.push('REVIEW_DECISION_PRIVATE_IDENTIFIER_FLAG');
  if (!decision || !redactAgentText(decision.reviewerId)) blockers.push('REVIEWER_ID_MISSING');
  if (decision && decision.approved !== true) blockers.push('REVIEW_NOT_APPROVED');
  if (decision && decision.decision !== 'approve') blockers.push('REVIEW_NOT_APPROVED');
  if (decision && (!decision.reviewedAt || Number.isNaN(Date.parse(String(decision.reviewedAt))))) {
    blockers.push('REVIEW_TIMESTAMP_INVALID');
  }
  const uniqueBlockers = [...new Set(blockers)];
  return {
    path: location.relativePath,
    status: uniqueBlockers.length === 0 ? 'approved' : 'blocked',
    reviewerId: redactAgentText(decision && decision.reviewerId) || null,
    approved: decision && decision.approved === true,
    reviewedAt:
      decision && decision.reviewedAt && !Number.isNaN(Date.parse(String(decision.reviewedAt)))
        ? new Date(String(decision.reviewedAt)).toISOString()
        : null,
    blockers: uniqueBlockers,
  };
}

function buildProcessAnswerRegression({ cwd = process.cwd(), catalog, corpus, decision } = {}) {
  if (!catalog || typeof catalog !== 'object') {
    throw regressionError('PROCESS_CATALOG_REQUIRED', 'A process catalog object is required.');
  }
  const normalizedCorpus =
    typeof corpus === 'string'
      ? readProcessAnswerRegressionCorpus(corpus, { cwd })
      : normalizeCorpus(corpus);
  const fingerprint = catalogFingerprint(catalog);
  const scenarios = normalizedCorpus.scenarios.map(scenario => evaluateScenario(catalog, scenario));
  const failedScenarios = scenarios.filter(scenario => scenario.status === 'fail').length;
  const evaluationId = `process-answer-evaluation:${stableHash(
    JSON.stringify({
      corpusId: normalizedCorpus.corpusId,
      corpusVersion: normalizedCorpus.corpusVersion,
      catalogFingerprint: fingerprint,
      scenarios: scenarios.map(scenario => ({
        id: scenario.id,
        status: scenario.status,
        matchedProcessIds: scenario.matchedProcessIds,
        returnedStatus: scenario.returnedStatus,
        returnedFreshness: scenario.returnedFreshness,
      })),
    })
  ).slice(0, 16)}`;
  const review = inspectDecision({
    cwd,
    input: decision,
    corpus: normalizedCorpus,
    fingerprint,
    evaluationId,
  });
  const blockers = [...new Set(scenarios.flatMap(scenario => scenario.blockers))];
  if (failedScenarios > 0) blockers.unshift('REGRESSION_SCENARIO_FAILED');
  blockers.push(...review.blockers);
  const uniqueBlockers = [...new Set(blockers)];
  const evaluationStatus = failedScenarios === 0 ? 'pass' : 'fail';
  const status =
    evaluationStatus === 'fail' ? 'fail' : review.status === 'approved' ? 'pass' : 'needs-review';
  return {
    ok: true,
    operation: 'regression-check',
    kind: 'process-answer-regression-result',
    schemaVersion: PROCESS_ANSWER_REGRESSION_SCHEMA_VERSION,
    readOnly: true,
    status,
    evaluationStatus,
    corpus: {
      corpusId: normalizedCorpus.corpusId,
      corpusVersion: normalizedCorpus.corpusVersion,
      scenarioCount: normalizedCorpus.scenarios.length,
    },
    catalogFingerprint: fingerprint,
    evaluationId,
    metrics: {
      scenarioCount: scenarios.length,
      passedScenarioCount: scenarios.length - failedScenarios,
      failedScenarioCount: failedScenarios,
    },
    scenarios: scenarios.map(scenario => ({
      id: scenario.id,
      status: scenario.status,
      matchedProcessCount: scenario.matchedProcessCount,
      returnedStatus: scenario.returnedStatus,
      returnedFreshness: scenario.returnedFreshness,
      evidenceCount: scenario.evidenceCount,
      blockers: scenario.blockers,
    })),
    review: {
      required: true,
      status: review.status,
      decisionPath: review.path,
      reviewerId: review.reviewerId,
      reviewedAt: review.reviewedAt || null,
      approved: review.approved,
      blockers: review.blockers,
      automaticPromotion: false,
      promotionAllowed: false,
      authoritativeChangeStillExplicit: true,
    },
    blockers: uniqueBlockers,
    nextSafeStep:
      evaluationStatus === 'fail'
        ? 'Correct the catalog, corpus, or retrieval contract for the failed scenarios, then rerun process regression-check.'
        : review.status !== 'approved'
          ? 'Have a domain owner review the passing scenarios and write a matching sanitized .zeus reviewer decision, then rerun process regression-check.'
          : 'Apply the smallest explicit authoritative catalog or prompt change outside this read-only command, record the rationale, and rerun the regression check.',
    automaticPromotion: false,
    promotionAllowed: false,
  };
}

function resolveProcessAnswerRegressionArtifactPath({
  cwd = process.cwd(),
  out = DEFAULT_PROCESS_ANSWER_REGRESSION_ARTIFACT,
} = {}) {
  const location = validateWorkspacePath(
    String(out || DEFAULT_PROCESS_ANSWER_REGRESSION_ARTIFACT),
    {
      workspaceRoot: path.resolve(String(cwd || process.cwd())),
      allowedRelativeRoots: ['.zeus'],
      allowAbsolute: false,
    }
  );
  if (!location.ok || !location.relativePath.toLowerCase().endsWith('.json')) {
    throw regressionError(
      'PATH_OUTSIDE_WORKSPACE',
      'Regression result must be a relative JSON path inside .zeus/.'
    );
  }
  return location;
}

function writeProcessAnswerRegressionArtifact(payload, options = {}) {
  const location = resolveProcessAnswerRegressionArtifactPath(options);
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
  DEFAULT_PROCESS_ANSWER_REGRESSION_ARTIFACT,
  PROCESS_ANSWER_REGRESSION_SCHEMA_VERSION,
  buildProcessAnswerRegression,
  catalogFingerprint,
  normalizeCorpus,
  readProcessAnswerRegressionCorpus,
  resolveProcessAnswerRegressionArtifactPath,
  writeProcessAnswerRegressionArtifact,
};
