'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { redactAgentText } = require('./agentExperience');
const { validateWorkspacePath } = require('../generationValidation/pathSafety');

const PROCESS_ANSWER_REVIEW_SCHEMA_VERSION = 1;
const DEFAULT_PROCESS_ANSWER_REVIEW_ARTIFACT = '.zeus/process-answer-review.json';
const DEFAULT_PROCESS_ANSWER_REVIEW_SUMMARY_ARTIFACT = '.zeus/process-answer-review-summary.json';
const DEFAULT_PROCESS_ANSWER_REVIEW_RETENTION_ARTIFACT =
  '.zeus/process-answer-review-retention.json';
const DEFAULT_REVIEW_FRESHNESS_DAYS = 30;
const DEFAULT_REVIEW_RETENTION_DAYS = 90;
const MAX_REVIEW_POLICY_DAYS = 3650;
const MAX_DRIFT_BYTES = 512 * 1024;
const MAX_HISTORY_BYTES = 256 * 1024;
const MAX_ENTRIES = 100;
const MAX_EXPLANATIONS = 20;

const DECISIONS = new Set(['approve', 'reject', 'defer']);
const RATIONALE_CODES = new Set([
  'CATALOG_CONFIRMED',
  'CATALOG_CHANGE_REQUIRED',
  'EVIDENCE_REVIEW_REQUIRED',
  'FRESHNESS_REVIEW_REQUIRED',
  'REGRESSION_ACCEPTED',
  'REGRESSION_BLOCKED',
  'REPRODUCIBILITY_RECHECK',
  'SCENARIO_SCOPE_CHANGED',
  'UNSPECIFIED',
]);

const EXPLANATION_DEFINITIONS = Object.freeze({
  ANSWER_CONTRACT_DRIFT: {
    severity: 'high',
    title: 'Answer contract changed',
    summary: 'The bounded set of answer blockers changed for one or more scenarios.',
    whyItMatters:
      'A response may still look plausible while no longer meeting its declared answer contract.',
    safeNextStep:
      'Inspect the retrieval contract and rerun regression-check for the affected catalog.',
  },
  CATALOG_DRIFT: {
    severity: 'high',
    title: 'Catalog revision changed',
    summary: 'The baseline and current results refer to different catalog fingerprints.',
    whyItMatters: 'The comparison cannot be interpreted as a pure prompt or evaluator change.',
    safeNextStep:
      'Review the catalog change, then rerun regression-check and drift-check against the intended baseline.',
  },
  CORPUS_DRIFT: {
    severity: 'high',
    title: 'Regression corpus changed',
    summary: 'The corpus identity or version differs between the two results.',
    whyItMatters:
      'Scenario expectations may have changed, so pass/fail movement is not directly comparable.',
    safeNextStep:
      'Confirm the corpus version and compare only results bound to the same sanitized corpus.',
  },
  CURRENT_REVIEW_PENDING: {
    severity: 'medium',
    title: 'Current result is awaiting review',
    summary: 'The current regression result has no matching approved reviewer decision.',
    whyItMatters: 'The result may guide review but is not an approved baseline or change decision.',
    safeNextStep:
      'Have a domain owner record an explicit sanitized decision for this exact drift fingerprint.',
  },
  EVALUATION_ID_REUSE: {
    severity: 'high',
    title: 'Evaluation identity was reused',
    summary: 'The same evaluation ID appears with a different catalog fingerprint.',
    whyItMatters:
      'A supposedly unique evaluation identity cannot safely identify the current evidence.',
    safeNextStep:
      'Regenerate the regression result with a fresh evaluation ID before reviewing the drift.',
  },
  EVALUATION_REPRODUCIBILITY_DRIFT: {
    severity: 'high',
    title: 'Evaluation reproducibility changed',
    summary: 'The same catalog and corpus produced different evaluation identities.',
    whyItMatters: 'The result is not reproducible enough to support a reliable change decision.',
    safeNextStep:
      'Re-run the identical catalog/corpus pair and inspect deterministic evaluator inputs.',
  },
  EVIDENCE_GAIN: {
    severity: 'info',
    title: 'Evidence coverage increased',
    summary: 'The current result contains more bounded evidence references for some scenarios.',
    whyItMatters:
      'The answer may be better supported, but the gain still needs a reviewer check for relevance.',
    safeNextStep:
      'Confirm the additional evidence is authoritative and rerun the review gate if needed.',
  },
  EVIDENCE_LOSS: {
    severity: 'high',
    title: 'Evidence coverage decreased',
    summary: 'The current result contains fewer bounded evidence references for some scenarios.',
    whyItMatters: 'A previously supported answer may no longer be sufficiently traceable.',
    safeNextStep: 'Inspect the evidence path and restore or explicitly review the missing support.',
  },
  FRESHNESS_DRIFT: {
    severity: 'medium',
    title: 'Freshness changed',
    summary: 'The returned freshness classification changed for one or more scenarios.',
    whyItMatters: 'An answer may now be stale or may have crossed a freshness boundary.',
    safeNextStep: 'Check the source snapshot and rerun the freshness-bound regression gate.',
  },
  PROCESS_MATCH_DRIFT: {
    severity: 'medium',
    title: 'Process match count changed',
    summary: 'The number of matched processes changed for one or more scenarios.',
    whyItMatters:
      'Retrieval scope or ambiguity may have changed even though response content is not visible here.',
    safeNextStep:
      'Inspect deterministic retrieval ranking and glossary scope before accepting the change.',
  },
  REGRESSION_INTRODUCED: {
    severity: 'high',
    title: 'Regression introduced',
    summary: 'At least one scenario changed from pass to fail.',
    whyItMatters: 'A previously satisfied answer expectation is no longer satisfied.',
    safeNextStep: 'Correct the catalog, retrieval rule, or contract, then rerun regression-check.',
  },
  REGRESSION_RESOLVED: {
    severity: 'info',
    title: 'Regression resolved',
    summary: 'At least one scenario changed from fail to pass.',
    whyItMatters: 'The result improved, but the correction still needs evidence-backed review.',
    safeNextStep:
      'Confirm the fix with the same corpus and record the reviewer decision if accepted.',
  },
  REVIEW_STATUS_DRIFT: {
    severity: 'medium',
    title: 'Review status changed',
    summary: 'The reviewer status differs between baseline and current result.',
    whyItMatters: 'Approval context changed independently of the scenario metrics.',
    safeNextStep:
      'Review the current decision artifact and ensure it matches the exact evaluation identity.',
  },
  REVIEW_HISTORY_CONFLICT: {
    severity: 'high',
    title: 'Review decisions conflict',
    summary: 'Different reviewer decisions exist for the same drift identity.',
    whyItMatters:
      'The latest decision is not sufficient evidence until the earlier conflicting review is understood.',
    safeNextStep:
      'Compare the bounded decision timestamps and rationale codes, then record one explicit follow-up decision.',
  },
  REVIEW_DECISION_STALE: {
    severity: 'medium',
    title: 'Earlier review decision is superseded',
    summary:
      'An older opposing decision was superseded by a later decision for the same drift identity.',
    whyItMatters:
      'A stale approval or rejection can mislead an agent if it is treated as the current review outcome.',
    safeNextStep:
      'Use only the latest bounded decision after resolving the review conflict and keep the history together.',
  },
  SCENARIO_SET_CHANGED: {
    severity: 'high',
    title: 'Scenario set changed',
    summary: 'Scenarios were added or removed between the two results.',
    whyItMatters: 'Coverage changed, so aggregate comparisons are incomplete.',
    safeNextStep: 'Confirm the intended corpus version before drawing conclusions from the drift.',
  },
  STATUS_DRIFT: {
    severity: 'medium',
    title: 'Process status changed',
    summary: 'The returned lifecycle status changed for one or more scenarios.',
    whyItMatters: 'An answer may now rely on a different lifecycle state than the baseline.',
    safeNextStep: 'Review the process lifecycle transition and its supporting evidence.',
  },
});

const SEVERITY_RANK = Object.freeze({ high: 0, medium: 1, info: 2 });

function reviewError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function boundedText(value, label, maxLength = 160) {
  const text = redactAgentText(value).trim();
  if (!text || text.length > maxLength) {
    throw reviewError('PROCESS_ANSWER_REVIEW_INPUT_INVALID', `${label} must be bounded text.`);
  }
  return text;
}

function readJsonFile(location, label, maxBytes) {
  if (!fs.existsSync(location)) {
    throw reviewError('PROCESS_ANSWER_REVIEW_INPUT_MISSING', `${label} does not exist.`);
  }
  const stats = fs.statSync(location);
  if (!stats.isFile() || stats.size > maxBytes) {
    throw reviewError(
      'PROCESS_ANSWER_REVIEW_INPUT_INVALID',
      `${label} must be a regular JSON file no larger than ${maxBytes} bytes.`
    );
  }
  try {
    return JSON.parse(fs.readFileSync(location, 'utf8'));
  } catch {
    throw reviewError('PROCESS_ANSWER_REVIEW_INPUT_INVALID', `${label} is not valid JSON.`);
  }
}

function resolveJsonPath({ cwd, input, label, required = true }) {
  const raw = String(input || '').trim();
  if (!raw) {
    if (!required) return null;
    throw reviewError('PROCESS_ANSWER_REVIEW_INPUT_REQUIRED', `${label} is required.`);
  }
  const location = validateWorkspacePath(raw, {
    workspaceRoot: path.resolve(String(cwd || process.cwd())),
    allowedRelativeRoots: ['.zeus'],
    allowAbsolute: false,
  });
  if (!location.ok || !location.relativePath.toLowerCase().endsWith('.json')) {
    throw reviewError(
      'PATH_OUTSIDE_WORKSPACE',
      `${label} must be a relative JSON path inside .zeus/.`
    );
  }
  return location;
}

function normalizeIdentity(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw reviewError('PROCESS_ANSWER_REVIEW_INPUT_INVALID', `${label} identity is required.`);
  }
  const corpus = value.corpus;
  if (!corpus || typeof corpus !== 'object' || Array.isArray(corpus)) {
    throw reviewError(
      'PROCESS_ANSWER_REVIEW_INPUT_INVALID',
      `${label} corpus identity is required.`
    );
  }
  const corpusId = boundedText(corpus.corpusId, `${label} corpusId`);
  const corpusVersion = boundedText(corpus.corpusVersion, `${label} corpusVersion`);
  const catalogFingerprint = boundedText(
    value.catalogFingerprint,
    `${label} catalogFingerprint`
  ).toLowerCase();
  const evaluationId = boundedText(value.evaluationId, `${label} evaluationId`).toLowerCase();
  if (!/^catalog:[a-f0-9]{16}$/.test(catalogFingerprint)) {
    throw reviewError(
      'PROCESS_ANSWER_REVIEW_INPUT_INVALID',
      `${label} has an invalid catalog fingerprint.`
    );
  }
  if (!/^process-answer-evaluation:[a-f0-9]{16}$/.test(evaluationId)) {
    throw reviewError(
      'PROCESS_ANSWER_REVIEW_INPUT_INVALID',
      `${label} has an invalid evaluation ID.`
    );
  }
  return { corpusId, corpusVersion, catalogFingerprint, evaluationId };
}

function normalizeDrift(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.kind !== 'process-answer-drift-result' ||
    value.schemaVersion !== PROCESS_ANSWER_REVIEW_SCHEMA_VERSION ||
    value.readOnly !== true ||
    value.automaticPromotion !== false ||
    value.promotionAllowed !== false
  ) {
    throw reviewError(
      'PROCESS_ANSWER_REVIEW_INPUT_UNSAFE',
      'Drift input must be a read-only version 1 process-answer-drift-result with promotion disabled.'
    );
  }
  if (!['stable', 'drift', 'needs-review'].includes(value.status)) {
    throw reviewError(
      'PROCESS_ANSWER_REVIEW_INPUT_INVALID',
      'Drift input has an unsupported status.'
    );
  }
  const baseline = normalizeIdentity(value.baseline, 'Baseline');
  const current = normalizeIdentity(value.current, 'Current');
  if (!Array.isArray(value.blockers) || value.blockers.length > 20) {
    throw reviewError('PROCESS_ANSWER_REVIEW_INPUT_INVALID', 'Drift input has too many blockers.');
  }
  const blockers = [
    ...new Set(value.blockers.map(code => boundedText(code, 'Blocker', 80))),
  ].sort();
  if (!blockers.every(code => /^[A-Z][A-Z0-9_]{1,79}$/.test(code))) {
    throw reviewError(
      'PROCESS_ANSWER_REVIEW_INPUT_INVALID',
      'Drift blockers must be stable codes.'
    );
  }
  const metrics = {};
  if (!value.metrics || typeof value.metrics !== 'object' || Array.isArray(value.metrics)) {
    throw reviewError('PROCESS_ANSWER_REVIEW_INPUT_INVALID', 'Drift metrics are required.');
  }
  for (const [key, raw] of Object.entries(value.metrics)) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(key) || !Number.isInteger(raw) || raw < 0 || raw > 10000) {
      throw reviewError(
        'PROCESS_ANSWER_REVIEW_INPUT_INVALID',
        'Drift metrics must be bounded integers.'
      );
    }
    metrics[key] = raw;
  }
  if (!Array.isArray(value.drift) || value.drift.length > 100) {
    throw reviewError(
      'PROCESS_ANSWER_REVIEW_INPUT_INVALID',
      'Drift details must be a bounded array.'
    );
  }
  const drift = value.drift.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw reviewError(
        'PROCESS_ANSWER_REVIEW_INPUT_INVALID',
        `Drift entry ${index + 1} is invalid.`
      );
    }
    const scenarioKey = boundedText(entry.scenarioKey, 'Scenario key', 40);
    if (!/^scenario:[a-f0-9]{16}$/.test(scenarioKey)) {
      throw reviewError(
        'PROCESS_ANSWER_REVIEW_INPUT_INVALID',
        'Drift scenario keys must be hashed.'
      );
    }
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    if (changes.length > 20) {
      throw reviewError(
        'PROCESS_ANSWER_REVIEW_INPUT_INVALID',
        'A drift entry has too many changes.'
      );
    }
    const changeKinds = changes.map(change =>
      boundedText(change && change.kind, 'Change kind', 80)
    );
    if (!changeKinds.every(kind => /^[A-Z][A-Z0-9_]{1,79}$/.test(kind))) {
      throw reviewError(
        'PROCESS_ANSWER_REVIEW_INPUT_INVALID',
        'Drift change kinds must be stable codes.'
      );
    }
    return { scenarioKey, changeKinds: [...new Set(changeKinds)].sort() };
  });
  return {
    status: value.status,
    baseline,
    current,
    blockers,
    metrics,
    drift,
  };
}

function normalizeHistory(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.kind !== 'process-answer-review-history' ||
    value.schemaVersion !== PROCESS_ANSWER_REVIEW_SCHEMA_VERSION ||
    value.sanitized !== true ||
    value.containsCredentials !== false ||
    value.containsPrivateProjectIdentifiers !== false
  ) {
    throw reviewError(
      'PROCESS_ANSWER_REVIEW_HISTORY_UNSAFE',
      'Review history must be a sanitized version 1 process-answer-review-history with credential and private-identifier flags set to false.'
    );
  }
  if (!Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES) {
    throw reviewError(
      'PROCESS_ANSWER_REVIEW_HISTORY_INVALID',
      `Review history may contain at most ${MAX_ENTRIES} entries.`
    );
  }
  const ids = new Set();
  const entries = value.entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw reviewError(
        'PROCESS_ANSWER_REVIEW_HISTORY_INVALID',
        `Review entry ${index + 1} is invalid.`
      );
    }
    const decisionId = boundedText(entry.decisionId, 'Decision ID', 40);
    const driftId = boundedText(entry.driftId, 'Drift ID', 40);
    if (!/^decision:[a-f0-9]{16}$/.test(decisionId) || !/^drift:[a-f0-9]{16}$/.test(driftId)) {
      throw reviewError(
        'PROCESS_ANSWER_REVIEW_HISTORY_INVALID',
        'Decision and drift IDs must be hashed identifiers.'
      );
    }
    if (ids.has(decisionId)) {
      throw reviewError(
        'PROCESS_ANSWER_REVIEW_HISTORY_INVALID',
        `Duplicate decision ID: ${decisionId}.`
      );
    }
    ids.add(decisionId);
    if (!DECISIONS.has(entry.decision)) {
      throw reviewError(
        'PROCESS_ANSWER_REVIEW_HISTORY_INVALID',
        `Review entry ${decisionId} has an unsupported decision.`
      );
    }
    const reviewerId = boundedText(entry.reviewerId, 'Reviewer ID', 160);
    const reviewedAt = new Date(String(entry.reviewedAt || ''));
    if (Number.isNaN(reviewedAt.getTime())) {
      throw reviewError(
        'PROCESS_ANSWER_REVIEW_HISTORY_INVALID',
        `Review entry ${decisionId} has an invalid timestamp.`
      );
    }
    const rationaleCode = String(entry.rationaleCode || 'UNSPECIFIED')
      .trim()
      .toUpperCase();
    if (!RATIONALE_CODES.has(rationaleCode)) {
      throw reviewError(
        'PROCESS_ANSWER_REVIEW_HISTORY_INVALID',
        `Review entry ${decisionId} has an unsupported rationale code.`
      );
    }
    return {
      decisionId,
      driftId,
      decision: entry.decision,
      reviewerHash: `reviewer:${stableHash(reviewerId).slice(0, 16)}`,
      reviewedAt: reviewedAt.toISOString(),
      rationaleCode,
    };
  });
  return entries.sort((left, right) =>
    `${left.reviewedAt}:${left.decisionId}`.localeCompare(`${right.reviewedAt}:${right.decisionId}`)
  );
}

function driftIdFor(drift) {
  return `drift:${stableHash(
    JSON.stringify({
      status: drift.status,
      baseline: drift.baseline,
      current: drift.current,
      blockers: drift.blockers,
      metrics: drift.metrics,
      drift: drift.drift,
    })
  ).slice(0, 16)}`;
}

function countFor(code, drift, approval) {
  const metricMap = {
    REGRESSION_INTRODUCED: 'introducedRegressionCount',
    REGRESSION_RESOLVED: 'resolvedRegressionCount',
    EVIDENCE_LOSS: 'evidenceLossCount',
    EVIDENCE_GAIN: 'evidenceGainCount',
    FRESHNESS_DRIFT: 'freshnessChangeCount',
    STATUS_DRIFT: 'statusChangeCount',
    PROCESS_MATCH_DRIFT: 'processMatchChangeCount',
    ANSWER_CONTRACT_DRIFT: 'answerContractChangeCount',
  };
  if (metricMap[code]) return drift.metrics[metricMap[code]] || 0;
  if (code === 'SCENARIO_SET_CHANGED') {
    return drift.drift.filter(
      entry =>
        entry.changeKinds.includes('SCENARIO_ADDED') ||
        entry.changeKinds.includes('SCENARIO_REMOVED')
    ).length;
  }
  if (code === 'REVIEW_HISTORY_CONFLICT') {
    return approval.consistency.conflictingDecisionCount;
  }
  if (code === 'REVIEW_DECISION_STALE') {
    return approval.consistency.staleDecisionCount;
  }
  return 1;
}

function buildExplanations(drift, approval) {
  const historyCodes = approval.consistency.findings || [];
  return [...new Set([...drift.blockers, ...historyCodes])]
    .filter(code => EXPLANATION_DEFINITIONS[code])
    .sort((left, right) => {
      const severity =
        SEVERITY_RANK[EXPLANATION_DEFINITIONS[left].severity] -
        SEVERITY_RANK[EXPLANATION_DEFINITIONS[right].severity];
      return severity || left.localeCompare(right);
    })
    .slice(0, MAX_EXPLANATIONS)
    .map(code => {
      const definition = EXPLANATION_DEFINITIONS[code];
      return {
        code,
        severity: definition.severity,
        title: definition.title,
        count: countFor(code, drift, approval),
        summary: definition.summary,
        whyItMatters: definition.whyItMatters,
        safeNextStep: definition.safeNextStep,
      };
    });
}

function lastDecisionFor(matches) {
  const last = matches.length > 0 ? matches[matches.length - 1] : null;
  return last
    ? {
        decisionId: last.decisionId,
        decision: last.decision,
        reviewerHash: last.reviewerHash,
        reviewedAt: last.reviewedAt,
        rationaleCode: last.rationaleCode,
      }
    : null;
}

function resolveHistoryConsistency(matches, historyProvided = false) {
  const last = matches.length > 0 ? matches[matches.length - 1] : null;
  const statusByDecision = { approve: 'approved', reject: 'rejected', defer: 'deferred' };
  const decisionKinds = [...new Set(matches.map(entry => entry.decision))].sort();
  const conflictingDecisionCount = decisionKinds.length;
  const staleDecisionCount = last
    ? matches.slice(0, -1).filter(entry => entry.decision !== last.decision).length
    : 0;
  const findings = [];
  if (conflictingDecisionCount > 1) findings.push('REVIEW_HISTORY_CONFLICT');
  if (staleDecisionCount > 0) findings.push('REVIEW_DECISION_STALE');
  return {
    status: last ? statusByDecision[last.decision] : 'pending',
    matchedDecisionCount: matches.length,
    consistency: {
      status:
        conflictingDecisionCount > 1
          ? 'contradictory'
          : matches.length > 0
            ? 'consistent'
            : historyProvided
              ? 'no-matching-decision'
              : 'not-provided',
      decisionKinds,
      conflictingDecisionCount,
      staleDecisionCount,
      findings,
      latestDecisionIsExplainable: Boolean(
        last && last.decision && last.reviewedAt && last.rationaleCode
      ),
    },
    lastDecision: lastDecisionFor(matches),
  };
}

function resolveApproval(driftId, history, historyPath) {
  const matches = (history || []).filter(entry => entry.driftId === driftId);
  const resolved = resolveHistoryConsistency(matches, Boolean(historyPath));
  return {
    historyPath,
    ...resolved,
    decisionIsNotPromotion: true,
  };
}

function buildProcessAnswerReviewSummary({ cwd = process.cwd(), history } = {}) {
  const historyLocation = resolveJsonPath({ cwd, input: history, label: '--history' });
  const normalizedHistory = normalizeHistory(
    readJsonFile(historyLocation.absolutePath, 'Process-answer review history', MAX_HISTORY_BYTES)
  );
  const byDriftId = new Map();
  for (const entry of normalizedHistory) {
    const entries = byDriftId.get(entry.driftId) || [];
    entries.push(entry);
    byDriftId.set(entry.driftId, entries);
  }
  const driftIdentities = [...byDriftId.keys()].sort().map(driftId => {
    const resolved = resolveHistoryConsistency(byDriftId.get(driftId));
    return {
      driftId,
      status: resolved.status,
      matchedDecisionCount: resolved.matchedDecisionCount,
      consistency: resolved.consistency,
      lastDecision: resolved.lastDecision,
    };
  });
  const unresolved = driftIdentities.filter(identity => identity.consistency.findings.length > 0);
  const decisionCounts = { approve: 0, defer: 0, reject: 0 };
  for (const entry of normalizedHistory) decisionCounts[entry.decision] += 1;
  const findingCounts = ['REVIEW_HISTORY_CONFLICT', 'REVIEW_DECISION_STALE']
    .map(code => ({
      code,
      driftCount: unresolved.filter(identity => identity.consistency.findings.includes(code))
        .length,
      decisionCount: unresolved.reduce(
        (total, identity) =>
          total +
          (identity.consistency.findings.includes(code)
            ? code === 'REVIEW_DECISION_STALE'
              ? identity.consistency.staleDecisionCount
              : identity.consistency.conflictingDecisionCount
            : 0),
        0
      ),
    }))
    .filter(finding => finding.driftCount > 0);
  const status =
    unresolved.length > 0 ? 'needs-review' : normalizedHistory.length > 0 ? 'stable' : 'pending';
  return {
    ok: true,
    operation: 'drift-review-summary',
    kind: 'process-answer-review-summary-result',
    schemaVersion: PROCESS_ANSWER_REVIEW_SCHEMA_VERSION,
    readOnly: true,
    status,
    historyPath: historyLocation.relativePath,
    metrics: {
      historyEntryCount: normalizedHistory.length,
      driftIdentityCount: driftIdentities.length,
      unresolvedDriftCount: unresolved.length,
      conflictingDriftCount:
        findingCounts.find(finding => finding.code === 'REVIEW_HISTORY_CONFLICT')?.driftCount || 0,
      staleDecisionCount: driftIdentities.reduce(
        (total, identity) => total + identity.consistency.staleDecisionCount,
        0
      ),
      decisionCounts,
    },
    findings: findingCounts,
    unresolved,
    driftIdentities,
    nextSafeStep:
      unresolved.length > 0
        ? 'Resolve the bounded conflicts for the listed drift identities, then rerun drift-review for the affected artifacts.'
        : normalizedHistory.length === 0
          ? 'Record a sanitized decision for an exact drift identity before relying on review history.'
          : 'Use the exact drift-review projection for a specific comparison before accepting a decision; review history never promotes knowledge automatically.',
    nextCommand:
      'node cli/zeus.js process drift-review-summary --history .zeus/process-answer-review-history.json --out .zeus/process-answer-review-summary.json --json',
    automaticPromotion: false,
    promotionAllowed: false,
  };
}

function parseReviewPolicyDays(value, label, fallback) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_REVIEW_POLICY_DAYS) {
    throw reviewError(
      'PROCESS_ANSWER_REVIEW_POLICY_INVALID',
      `${label} must be an integer between 1 and ${MAX_REVIEW_POLICY_DAYS}.`
    );
  }
  return parsed;
}

function normalizeReviewPolicy({ asOf, freshDays, retentionDays } = {}) {
  const reviewedAt = asOf == null || asOf === '' ? new Date() : new Date(String(asOf));
  if (Number.isNaN(reviewedAt.getTime())) {
    throw reviewError(
      'PROCESS_ANSWER_REVIEW_AS_OF_INVALID',
      'Review-history --as-of must be a valid ISO timestamp.'
    );
  }
  const freshnessDays = parseReviewPolicyDays(
    freshDays,
    'Review-history --fresh-days',
    DEFAULT_REVIEW_FRESHNESS_DAYS
  );
  const retentionAfterDays = parseReviewPolicyDays(
    retentionDays,
    'Review-history --retention-days',
    DEFAULT_REVIEW_RETENTION_DAYS
  );
  if (freshnessDays >= retentionAfterDays) {
    throw reviewError(
      'PROCESS_ANSWER_REVIEW_POLICY_INVALID',
      'Review-history --fresh-days must be lower than --retention-days.'
    );
  }
  return {
    asOf: reviewedAt.toISOString(),
    asOfMs: reviewedAt.getTime(),
    freshDays: freshnessDays,
    retentionDays: retentionAfterDays,
  };
}

function classifyReviewFreshness(reviewedAt, policy) {
  const reviewedAtMs = new Date(reviewedAt).getTime();
  const ageMs = policy.asOfMs - reviewedAtMs;
  if (ageMs < 0) {
    return { status: 'future', ageDays: 0, reviewedAt };
  }
  const ageDays = Math.floor(ageMs / 86_400_000);
  return {
    status:
      ageDays <= policy.freshDays
        ? 'fresh'
        : ageDays <= policy.retentionDays
          ? 'aging'
          : 'historical',
    ageDays,
    reviewedAt,
  };
}

function buildProcessAnswerReviewRetention({
  cwd = process.cwd(),
  history,
  asOf,
  freshDays,
  retentionDays,
} = {}) {
  const historyLocation = resolveJsonPath({ cwd, input: history, label: '--history' });
  const normalizedHistory = normalizeHistory(
    readJsonFile(historyLocation.absolutePath, 'Process-answer review history', MAX_HISTORY_BYTES)
  );
  const policy = normalizeReviewPolicy({ asOf, freshDays, retentionDays });
  const byDriftId = new Map();
  for (const entry of normalizedHistory) {
    const entries = byDriftId.get(entry.driftId) || [];
    entries.push(entry);
    byDriftId.set(entry.driftId, entries);
  }

  const identities = [...byDriftId.keys()].sort().map(driftId => {
    const entries = byDriftId.get(driftId);
    const latest = entries[entries.length - 1];
    const latestFreshness = classifyReviewFreshness(latest.reviewedAt, policy);
    const entryFreshness = entries.map(entry => ({
      decisionId: entry.decisionId,
      freshness: classifyReviewFreshness(entry.reviewedAt, policy),
    }));
    const retentionCandidateDecisionIds = entryFreshness
      .filter(
        item => item.freshness.status === 'historical' && item.decisionId !== latest.decisionId
      )
      .map(item => item.decisionId);
    return {
      driftId,
      historyEntryCount: entries.length,
      latestDecision: lastDecisionFor(entries),
      latestFreshness,
      freshnessCounts: entryFreshness.reduce(
        (counts, item) => ({
          ...counts,
          [item.freshness.status]: counts[item.freshness.status] + 1,
        }),
        { fresh: 0, aging: 0, historical: 0, future: 0 }
      ),
      retention: {
        status:
          latestFreshness.status === 'future'
            ? 'review-required'
            : latestFreshness.status === 'historical'
              ? 'review-required'
              : retentionCandidateDecisionIds.length > 0
                ? 'candidate'
                : 'none',
        candidateDecisionIds: retentionCandidateDecisionIds,
      },
    };
  });

  const retentionCandidates = identities
    .flatMap(identity =>
      identity.retention.candidateDecisionIds.length > 0
        ? [
            {
              driftId: identity.driftId,
              decisionIds: identity.retention.candidateDecisionIds,
              reasonCode: 'REVIEW_HISTORY_RETENTION_CANDIDATE',
            },
          ]
        : []
    )
    .slice(0, MAX_ENTRIES);
  const reviewRequired = identities
    .filter(identity => identity.retention.status === 'review-required')
    .map(identity => ({
      driftId: identity.driftId,
      latestDecision: identity.latestDecision,
      latestFreshness: identity.latestFreshness,
      reasonCode:
        identity.latestFreshness.status === 'future'
          ? 'REVIEW_TIMESTAMP_IN_FUTURE'
          : 'REVIEW_HISTORY_LATEST_HISTORICAL',
    }));
  const freshnessCounts = normalizedHistory.reduce(
    (counts, entry) => {
      const status = classifyReviewFreshness(entry.reviewedAt, policy).status;
      counts[status] += 1;
      return counts;
    },
    { fresh: 0, aging: 0, historical: 0, future: 0 }
  );
  const status =
    reviewRequired.length > 0 || retentionCandidates.length > 0
      ? 'needs-review'
      : normalizedHistory.length > 0
        ? 'stable'
        : 'pending';
  return {
    ok: true,
    operation: 'drift-review-retention',
    kind: 'process-answer-review-retention-result',
    schemaVersion: PROCESS_ANSWER_REVIEW_SCHEMA_VERSION,
    readOnly: true,
    status,
    historyPath: historyLocation.relativePath,
    policy: {
      asOf: policy.asOf,
      freshWithinDays: policy.freshDays,
      retentionAfterDays: policy.retentionDays,
    },
    metrics: {
      historyEntryCount: normalizedHistory.length,
      driftIdentityCount: identities.length,
      freshDecisionCount: freshnessCounts.fresh,
      agingDecisionCount: freshnessCounts.aging,
      historicalDecisionCount: freshnessCounts.historical,
      futureDecisionCount: freshnessCounts.future,
      retentionCandidateCount: retentionCandidates.reduce(
        (total, candidate) => total + candidate.decisionIds.length,
        0
      ),
      reviewRequiredDriftCount: reviewRequired.length,
    },
    freshnessCounts,
    identities,
    retentionCandidates,
    reviewRequired,
    nextSafeStep:
      reviewRequired.length > 0
        ? 'Review historical or future-dated latest decisions before relying on them; do not delete the history automatically.'
        : retentionCandidates.length > 0
          ? 'Review the listed superseded decision IDs and archive or delete them only through an explicit local policy-approved action.'
          : normalizedHistory.length === 0
            ? 'Record a sanitized decision for an exact drift identity before relying on review history.'
            : 'Review history is within the configured freshness and retention window; keep the bounded record together with its drift artifacts.',
    nextCommand:
      'node cli/zeus.js process drift-review-retention --history .zeus/process-answer-review-history.json --json',
    automaticPromotion: false,
    promotionAllowed: false,
    automaticDeletion: false,
    deletionAllowed: false,
  };
}

function buildProcessAnswerReview({ cwd = process.cwd(), drift, history } = {}) {
  const driftLocation = resolveJsonPath({ cwd, input: drift, label: '--drift' });
  const historyLocation = resolveJsonPath({
    cwd,
    input: history,
    label: '--history',
    required: false,
  });
  const normalizedDrift = normalizeDrift(
    readJsonFile(driftLocation.absolutePath, 'Process-answer drift report', MAX_DRIFT_BYTES)
  );
  const normalizedHistory = historyLocation
    ? normalizeHistory(
        readJsonFile(
          historyLocation.absolutePath,
          'Process-answer review history',
          MAX_HISTORY_BYTES
        )
      )
    : null;
  const driftId = driftIdFor(normalizedDrift);
  const approval = resolveApproval(
    driftId,
    normalizedHistory,
    historyLocation ? historyLocation.relativePath : null
  );
  const explanations = buildExplanations(normalizedDrift, approval);
  const historyNeedsReview = approval.consistency.findings.length > 0;
  const status =
    approval.status === 'approved' && !historyNeedsReview
      ? 'reviewed'
      : normalizedDrift.status === 'stable' && explanations.length === 0
        ? 'stable'
        : 'needs-review';
  return {
    ok: true,
    operation: 'drift-review',
    kind: 'process-answer-review-result',
    schemaVersion: PROCESS_ANSWER_REVIEW_SCHEMA_VERSION,
    readOnly: true,
    status,
    driftStatus: normalizedDrift.status,
    driftId,
    identity: {
      baseline: normalizedDrift.baseline,
      current: normalizedDrift.current,
      sameCatalog:
        normalizedDrift.baseline.catalogFingerprint === normalizedDrift.current.catalogFingerprint,
      sameCorpus:
        normalizedDrift.baseline.corpusId === normalizedDrift.current.corpusId &&
        normalizedDrift.baseline.corpusVersion === normalizedDrift.current.corpusVersion,
    },
    metrics: normalizedDrift.metrics,
    explanations,
    approval,
    nextSafeStep: historyNeedsReview
      ? 'Resolve the bounded review-history conflict, confirm the latest rationale, and rerun drift-review; no decision promotes knowledge automatically.'
      : explanations.length > 0
        ? 'Review the bounded explanations, verify the authoritative catalog and evidence, then rerun regression-check and drift-check after any explicit change.'
        : approval.status === 'pending'
          ? 'Record a matching sanitized reviewer decision if this comparison is ready to be accepted; approval never promotes knowledge automatically.'
          : 'Keep the reviewed artifacts together and rerun drift-review after the next explicit catalog, prompt, or corpus change.',
    nextCommand:
      'node cli/zeus.js process drift-review --drift .zeus/process-answer-drift.json --history .zeus/process-answer-review-history.json --out .zeus/process-answer-review.json --json',
    automaticPromotion: false,
    promotionAllowed: false,
  };
}

function resolveProcessAnswerReviewArtifactPath({
  cwd = process.cwd(),
  out = DEFAULT_PROCESS_ANSWER_REVIEW_ARTIFACT,
} = {}) {
  return resolveJsonPath({ cwd, input: out, label: '--out' });
}

function resolveProcessAnswerReviewSummaryArtifactPath({
  cwd = process.cwd(),
  out = DEFAULT_PROCESS_ANSWER_REVIEW_SUMMARY_ARTIFACT,
} = {}) {
  return resolveJsonPath({ cwd, input: out, label: '--out' });
}

function resolveProcessAnswerReviewRetentionArtifactPath({
  cwd = process.cwd(),
  out = DEFAULT_PROCESS_ANSWER_REVIEW_RETENTION_ARTIFACT,
} = {}) {
  return resolveJsonPath({ cwd, input: out, label: '--out' });
}

function writeProcessAnswerReviewArtifact(payload, options = {}) {
  const location = resolveProcessAnswerReviewArtifactPath(options);
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

function writeProcessAnswerReviewSummaryArtifact(payload, options = {}) {
  const location = resolveProcessAnswerReviewSummaryArtifactPath(options);
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

function writeProcessAnswerReviewRetentionArtifact(payload, options = {}) {
  const location = resolveProcessAnswerReviewRetentionArtifactPath(options);
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
  DEFAULT_PROCESS_ANSWER_REVIEW_ARTIFACT,
  DEFAULT_PROCESS_ANSWER_REVIEW_SUMMARY_ARTIFACT,
  DEFAULT_PROCESS_ANSWER_REVIEW_RETENTION_ARTIFACT,
  PROCESS_ANSWER_REVIEW_SCHEMA_VERSION,
  buildProcessAnswerReview,
  buildProcessAnswerReviewSummary,
  buildProcessAnswerReviewRetention,
  resolveProcessAnswerReviewArtifactPath,
  resolveProcessAnswerReviewSummaryArtifactPath,
  resolveProcessAnswerReviewRetentionArtifactPath,
  writeProcessAnswerReviewArtifact,
  writeProcessAnswerReviewSummaryArtifact,
  writeProcessAnswerReviewRetentionArtifact,
};
