'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { redactAgentText } = require('./agentExperience');
const { validateWorkspacePath } = require('../generationValidation/pathSafety');

const PROCESS_ANSWER_DRIFT_SCHEMA_VERSION = 1;
const DEFAULT_PROCESS_ANSWER_DRIFT_ARTIFACT = '.zeus/process-answer-drift.json';
const MAX_RESULT_BYTES = 512 * 1024;
const MAX_SCENARIOS = 100;
const MAX_BLOCKERS = 20;

function driftError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function uniqueBounded(values, limit = MAX_BLOCKERS) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map(value => redactAgentText(value).trim())
        .filter(Boolean)
    ),
  ].slice(0, limit);
}

function readJsonFile(location, label) {
  if (!fs.existsSync(location)) {
    throw driftError('PROCESS_ANSWER_DRIFT_INPUT_MISSING', `${label} does not exist.`);
  }
  const stats = fs.statSync(location);
  if (!stats.isFile() || stats.size > MAX_RESULT_BYTES) {
    throw driftError(
      'PROCESS_ANSWER_DRIFT_INPUT_INVALID',
      `${label} must be a regular JSON file no larger than ${MAX_RESULT_BYTES} bytes.`
    );
  }
  try {
    return JSON.parse(fs.readFileSync(location, 'utf8'));
  } catch {
    throw driftError('PROCESS_ANSWER_DRIFT_INPUT_INVALID', `${label} is not valid JSON.`);
  }
}

function resolveRegressionResultPath({ cwd, input, label }) {
  const raw = String(input || '').trim();
  if (!raw) throw driftError('PROCESS_ANSWER_DRIFT_INPUT_REQUIRED', `${label} is required.`);
  const location = validateWorkspacePath(raw, {
    workspaceRoot: path.resolve(String(cwd || process.cwd())),
    allowedRelativeRoots: ['.zeus'],
    allowAbsolute: false,
  });
  if (!location.ok || !location.relativePath.toLowerCase().endsWith('.json')) {
    throw driftError(
      'PATH_OUTSIDE_WORKSPACE',
      `${label} must be a relative JSON path inside .zeus/.`
    );
  }
  return location;
}

function normalizeScenario(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw driftError(
      'PROCESS_ANSWER_DRIFT_INPUT_INVALID',
      `Scenario result ${index + 1} must be an object.`
    );
  }
  const id = redactAgentText(value.id).trim();
  if (!id || id.length > 160) {
    throw driftError(
      'PROCESS_ANSWER_DRIFT_INPUT_INVALID',
      `Scenario result ${index + 1} requires a bounded id.`
    );
  }
  if (!['pass', 'fail'].includes(value.status)) {
    throw driftError(
      'PROCESS_ANSWER_DRIFT_INPUT_INVALID',
      `Scenario ${id} has an unsupported status.`
    );
  }
  const integerFields = ['matchedProcessCount', 'evidenceCount'];
  for (const field of integerFields) {
    if (!Number.isInteger(value[field]) || value[field] < 0 || value[field] > 1000) {
      throw driftError(
        'PROCESS_ANSWER_DRIFT_INPUT_INVALID',
        `Scenario ${id} has an invalid ${field}.`
      );
    }
  }
  return {
    id,
    key: `scenario:${stableHash(id).slice(0, 16)}`,
    status: value.status,
    matchedProcessCount: value.matchedProcessCount,
    returnedStatus: redactAgentText(value.returnedStatus).trim() || 'unknown',
    returnedFreshness: redactAgentText(value.returnedFreshness).trim() || 'unknown',
    evidenceCount: value.evidenceCount,
    blockers: uniqueBounded(value.blockers),
  };
}

function normalizeRegressionResult(value, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.kind !== 'process-answer-regression-result' ||
    value.schemaVersion !== PROCESS_ANSWER_DRIFT_SCHEMA_VERSION ||
    value.readOnly !== true ||
    value.automaticPromotion !== false ||
    value.promotionAllowed !== false
  ) {
    throw driftError(
      'PROCESS_ANSWER_DRIFT_INPUT_UNSAFE',
      `${label} must be a read-only version 1 process-answer regression result with promotion disabled.`
    );
  }
  const corpus = value.corpus;
  if (
    !corpus ||
    typeof corpus !== 'object' ||
    !redactAgentText(corpus.corpusId).trim() ||
    !redactAgentText(corpus.corpusVersion).trim()
  ) {
    throw driftError(
      'PROCESS_ANSWER_DRIFT_INPUT_INVALID',
      `${label} must contain a bounded corpus identity.`
    );
  }
  const catalogFingerprint = redactAgentText(value.catalogFingerprint).trim();
  const evaluationId = redactAgentText(value.evaluationId).trim();
  if (!/^catalog:[a-f0-9]{16}$/i.test(catalogFingerprint)) {
    throw driftError(
      'PROCESS_ANSWER_DRIFT_INPUT_INVALID',
      `${label} has an invalid catalog fingerprint.`
    );
  }
  if (!/^process-answer-evaluation:[a-f0-9]{16}$/i.test(evaluationId)) {
    throw driftError(
      'PROCESS_ANSWER_DRIFT_INPUT_INVALID',
      `${label} has an invalid evaluation ID.`
    );
  }
  if (!Array.isArray(value.scenarios) || value.scenarios.length > MAX_SCENARIOS) {
    throw driftError(
      'PROCESS_ANSWER_DRIFT_INPUT_INVALID',
      `${label} must contain at most ${MAX_SCENARIOS} scenario results.`
    );
  }
  const scenarios = value.scenarios.map(normalizeScenario);
  const keys = new Set();
  for (const scenario of scenarios) {
    if (keys.has(scenario.key)) {
      throw driftError(
        'PROCESS_ANSWER_DRIFT_INPUT_INVALID',
        `${label} contains duplicate scenario IDs.`
      );
    }
    keys.add(scenario.key);
  }
  const reviewStatus = redactAgentText(value.review && value.review.status).trim() || 'unknown';
  return {
    corpus: {
      corpusId: redactAgentText(corpus.corpusId).trim(),
      corpusVersion: redactAgentText(corpus.corpusVersion).trim(),
    },
    catalogFingerprint: catalogFingerprint.toLowerCase(),
    evaluationId: evaluationId.toLowerCase(),
    reviewStatus,
    scenarios,
  };
}

function readProcessAnswerRegressionResult(filePath, options = {}) {
  const location = resolveRegressionResultPath({
    cwd: options.cwd || process.cwd(),
    input: filePath,
    label: options.label || 'Regression result',
  });
  return normalizeRegressionResult(
    readJsonFile(location.absolutePath, options.label || 'Regression result'),
    options.label || 'Regression result'
  );
}

function addChange(changes, kind, baseline, current) {
  changes.push({ kind, baseline, current });
}

function compareScenario(baseline, current) {
  const changes = [];
  if (baseline.status !== current.status) {
    addChange(
      changes,
      current.status === 'fail' ? 'REGRESSION_INTRODUCED' : 'REGRESSION_RESOLVED',
      baseline.status,
      current.status
    );
  }
  if (baseline.matchedProcessCount !== current.matchedProcessCount) {
    addChange(
      changes,
      'PROCESS_MATCH_DRIFT',
      baseline.matchedProcessCount,
      current.matchedProcessCount
    );
  }
  if (baseline.returnedStatus !== current.returnedStatus) {
    addChange(changes, 'STATUS_DRIFT', baseline.returnedStatus, current.returnedStatus);
  }
  if (baseline.returnedFreshness !== current.returnedFreshness) {
    addChange(changes, 'FRESHNESS_DRIFT', baseline.returnedFreshness, current.returnedFreshness);
  }
  if (baseline.evidenceCount !== current.evidenceCount) {
    addChange(
      changes,
      current.evidenceCount < baseline.evidenceCount ? 'EVIDENCE_LOSS' : 'EVIDENCE_GAIN',
      baseline.evidenceCount,
      current.evidenceCount
    );
  }
  if (JSON.stringify(baseline.blockers) !== JSON.stringify(current.blockers)) {
    addChange(changes, 'ANSWER_CONTRACT_DRIFT', baseline.blockers, current.blockers);
  }
  return changes;
}

function buildProcessAnswerDrift({ cwd = process.cwd(), baseline, current } = {}) {
  const baselinePath = resolveRegressionResultPath({
    cwd,
    input: baseline,
    label: '--baseline',
  });
  const currentPath = resolveRegressionResultPath({
    cwd,
    input: current,
    label: '--current',
  });
  const before = normalizeRegressionResult(
    readJsonFile(baselinePath.absolutePath, 'Baseline regression result'),
    'Baseline regression result'
  );
  const after = normalizeRegressionResult(
    readJsonFile(currentPath.absolutePath, 'Current regression result'),
    'Current regression result'
  );
  const blockers = new Set();
  const drift = [];
  if (
    before.corpus.corpusId !== after.corpus.corpusId ||
    before.corpus.corpusVersion !== after.corpus.corpusVersion
  ) {
    blockers.add('CORPUS_DRIFT');
  }
  if (before.catalogFingerprint !== after.catalogFingerprint) blockers.add('CATALOG_DRIFT');
  if (
    before.evaluationId === after.evaluationId &&
    before.catalogFingerprint !== after.catalogFingerprint
  ) {
    blockers.add('EVALUATION_ID_REUSE');
  }
  if (before.reviewStatus !== after.reviewStatus) blockers.add('REVIEW_STATUS_DRIFT');
  if (after.reviewStatus !== 'approved') blockers.add('CURRENT_REVIEW_PENDING');

  const baselineByKey = new Map(before.scenarios.map(scenario => [scenario.key, scenario]));
  const currentByKey = new Map(after.scenarios.map(scenario => [scenario.key, scenario]));
  const keys = [...new Set([...baselineByKey.keys(), ...currentByKey.keys()])].sort();
  let introduced = 0;
  let resolved = 0;
  let unchanged = 0;
  let evidenceLoss = 0;
  let evidenceGain = 0;
  let freshnessChanges = 0;
  let statusChanges = 0;
  let processMatchChanges = 0;
  let answerContractChanges = 0;
  for (const key of keys) {
    const previous = baselineByKey.get(key);
    const next = currentByKey.get(key);
    if (!previous) {
      blockers.add('SCENARIO_SET_CHANGED');
      drift.push({ scenarioKey: key, changes: [{ kind: 'SCENARIO_ADDED' }] });
      continue;
    }
    if (!next) {
      blockers.add('SCENARIO_SET_CHANGED');
      drift.push({ scenarioKey: key, changes: [{ kind: 'SCENARIO_REMOVED' }] });
      continue;
    }
    const changes = compareScenario(previous, next);
    if (changes.length === 0) {
      unchanged += 1;
      continue;
    }
    for (const change of changes) {
      if (change.kind === 'REGRESSION_INTRODUCED') {
        introduced += 1;
        blockers.add('REGRESSION_INTRODUCED');
      } else if (change.kind === 'REGRESSION_RESOLVED') {
        resolved += 1;
      } else if (change.kind === 'EVIDENCE_LOSS') {
        evidenceLoss += 1;
        blockers.add('EVIDENCE_LOSS');
      } else if (change.kind === 'EVIDENCE_GAIN') {
        evidenceGain += 1;
      } else if (change.kind === 'FRESHNESS_DRIFT') {
        freshnessChanges += 1;
        blockers.add('FRESHNESS_DRIFT');
      } else if (change.kind === 'STATUS_DRIFT') {
        statusChanges += 1;
        blockers.add('STATUS_DRIFT');
      } else if (change.kind === 'PROCESS_MATCH_DRIFT') {
        processMatchChanges += 1;
        blockers.add('PROCESS_MATCH_DRIFT');
      } else if (change.kind === 'ANSWER_CONTRACT_DRIFT') {
        answerContractChanges += 1;
        blockers.add('ANSWER_CONTRACT_DRIFT');
      }
    }
    drift.push({ scenarioKey: key, changes });
  }
  if (
    before.catalogFingerprint === after.catalogFingerprint &&
    before.evaluationId !== after.evaluationId
  ) {
    blockers.add('EVALUATION_REPRODUCIBILITY_DRIFT');
  }
  const blockerList = [...blockers].sort();
  const driftDetected =
    drift.length > 0 ||
    before.catalogFingerprint !== after.catalogFingerprint ||
    before.corpus.corpusId !== after.corpus.corpusId ||
    before.corpus.corpusVersion !== after.corpus.corpusVersion ||
    before.evaluationId !== after.evaluationId ||
    before.reviewStatus !== after.reviewStatus;
  const status = driftDetected
    ? 'drift'
    : after.reviewStatus === 'approved'
      ? 'stable'
      : 'needs-review';
  return {
    ok: true,
    operation: 'drift-check',
    kind: 'process-answer-drift-result',
    schemaVersion: PROCESS_ANSWER_DRIFT_SCHEMA_VERSION,
    readOnly: true,
    status,
    baseline: {
      artifactPath: baselinePath.relativePath,
      corpus: before.corpus,
      catalogFingerprint: before.catalogFingerprint,
      evaluationId: before.evaluationId,
      reviewStatus: before.reviewStatus,
    },
    current: {
      artifactPath: currentPath.relativePath,
      corpus: after.corpus,
      catalogFingerprint: after.catalogFingerprint,
      evaluationId: after.evaluationId,
      reviewStatus: after.reviewStatus,
    },
    comparison: {
      sameCorpus:
        before.corpus.corpusId === after.corpus.corpusId &&
        before.corpus.corpusVersion === after.corpus.corpusVersion,
      sameCatalog: before.catalogFingerprint === after.catalogFingerprint,
      sameEvaluation: before.evaluationId === after.evaluationId,
    },
    metrics: {
      baselineScenarioCount: before.scenarios.length,
      currentScenarioCount: after.scenarios.length,
      comparedScenarioCount: before.scenarios.filter(scenario => currentByKey.has(scenario.key))
        .length,
      unchangedScenarioCount: unchanged,
      introducedRegressionCount: introduced,
      resolvedRegressionCount: resolved,
      evidenceLossCount: evidenceLoss,
      evidenceGainCount: evidenceGain,
      freshnessChangeCount: freshnessChanges,
      statusChangeCount: statusChanges,
      processMatchChangeCount: processMatchChanges,
      answerContractChangeCount: answerContractChanges,
    },
    drift,
    blockers: blockerList,
    nextSafeStep: driftDetected
      ? 'Inspect the bounded drift categories, correct or review the authoritative catalog or retrieval contract, then rerun regression-check and drift-check.'
      : after.reviewStatus !== 'approved'
        ? 'Have a domain owner review the current regression result before treating the baseline as approved.'
        : 'Keep the current catalog and regression baseline; rerun drift-check after the next explicit catalog or prompt change.',
    nextCommand:
      'node cli/zeus.js process regression-check --catalog <relative-path> --corpus <relative-path> --out .zeus/process-answer-regression.json --json',
    automaticPromotion: false,
    promotionAllowed: false,
  };
}

function resolveProcessAnswerDriftArtifactPath({
  cwd = process.cwd(),
  out = DEFAULT_PROCESS_ANSWER_DRIFT_ARTIFACT,
} = {}) {
  const location = validateWorkspacePath(String(out || DEFAULT_PROCESS_ANSWER_DRIFT_ARTIFACT), {
    workspaceRoot: path.resolve(String(cwd || process.cwd())),
    allowedRelativeRoots: ['.zeus'],
    allowAbsolute: false,
  });
  if (!location.ok || !location.relativePath.toLowerCase().endsWith('.json')) {
    throw driftError(
      'PATH_OUTSIDE_WORKSPACE',
      'Drift result must be a relative JSON path inside .zeus/.'
    );
  }
  return location;
}

function writeProcessAnswerDriftArtifact(payload, options = {}) {
  const location = resolveProcessAnswerDriftArtifactPath(options);
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
  DEFAULT_PROCESS_ANSWER_DRIFT_ARTIFACT,
  PROCESS_ANSWER_DRIFT_SCHEMA_VERSION,
  buildProcessAnswerDrift,
  readProcessAnswerRegressionResult,
  resolveProcessAnswerDriftArtifactPath,
  writeProcessAnswerDriftArtifact,
};
