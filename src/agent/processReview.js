'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { redactAgentText } = require('./agentExperience');
const { validateWorkspacePath } = require('../generationValidation/pathSafety');

const PROCESS_REVIEW_SCHEMA_VERSION = 1;
const DEFAULT_PROCESS_REVIEW_RECEIPT = '.zeus/process-review-receipt.json';
const DEFAULT_REVIEW_FRESH_DAYS = 30;
const DEFAULT_REVIEW_RETENTION_DAYS = 90;
const MAX_REVIEW_BYTES = 256 * 1024;
const MAX_REVIEW_POLICY_DAYS = 3650;
const REVIEW_POLICIES = Object.freeze(['off', 'advisory', 'required']);
const REVIEW_DECISIONS = Object.freeze(['approve', 'reject', 'defer']);

function reviewError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonicalValue(value[key])])
    );
  }
  return value;
}

function text(value, maxLength = 160) {
  const normalized = redactAgentText(value).trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function requireText(value, label, maxLength = 160) {
  const normalized = text(value, maxLength);
  if (!normalized) throw reviewError('PROCESS_REVIEW_VALUE_REQUIRED', `${label} is required.`);
  return normalized;
}

function readJsonFile(location, label) {
  if (!fs.existsSync(location)) {
    throw reviewError('PROCESS_REVIEW_INPUT_MISSING', `${label} does not exist.`);
  }
  const stats = fs.statSync(location);
  if (!stats.isFile() || stats.size > MAX_REVIEW_BYTES) {
    throw reviewError(
      'PROCESS_REVIEW_INPUT_INVALID',
      `${label} must be a regular JSON file no larger than ${MAX_REVIEW_BYTES} bytes.`
    );
  }
  try {
    return JSON.parse(fs.readFileSync(location, 'utf8'));
  } catch {
    throw reviewError('PROCESS_REVIEW_INPUT_INVALID', `${label} is not valid JSON.`);
  }
}

function resolveReviewPath({ cwd = process.cwd(), input, label }) {
  const raw = String(input || '').trim();
  if (!raw) throw reviewError('PROCESS_REVIEW_PATH_REQUIRED', `${label} is required.`);
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

function resolveProcessReviewArtifactPath({
  cwd = process.cwd(),
  out = DEFAULT_PROCESS_REVIEW_RECEIPT,
} = {}) {
  return resolveReviewPath({ cwd, input: out, label: '--out' });
}

function readReviewResult({ cwd = process.cwd(), result }) {
  const location = resolveReviewPath({ cwd, input: result, label: '--result' });
  const value = readJsonFile(location.absolutePath, 'Process result');
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw reviewError('PROCESS_REVIEW_RESULT_INVALID', 'Process result must be a JSON object.');
  }
  const isAdvisoryEvaluation =
    value.kind === 'project-knowledge-process-evaluation-result' &&
    value.sourceOfTruth === false &&
    value.advisory === true;
  if (value.readOnly !== true && !isAdvisoryEvaluation) {
    throw reviewError(
      'PROCESS_REVIEW_RESULT_UNSAFE',
      'Process result must explicitly declare readOnly=true or use the advisory evaluation contract.'
    );
  }
  if (value.automaticPromotion != null && value.automaticPromotion !== false) {
    throw reviewError(
      'PROCESS_REVIEW_RESULT_UNSAFE',
      'Process result must keep automatic promotion disabled.'
    );
  }
  if (value.promotionAllowed != null && value.promotionAllowed !== false) {
    throw reviewError(
      'PROCESS_REVIEW_RESULT_UNSAFE',
      'Process result must keep promotion disabled.'
    );
  }
  return { location, value };
}

function catalogFingerprintFor(value) {
  const explicit = text(value.catalogFingerprint, 100);
  if (explicit) return explicit.toLowerCase();
  const derived = {
    projectId: text(value.projectId),
    snapshotId: text(value.snapshotId),
    freshness: value.freshness || null,
    evidenceReferences: Array.isArray(value.evidenceReferences) ? value.evidenceReferences : [],
  };
  return `catalog:${stableHash(JSON.stringify(canonicalValue(derived))).slice(0, 16)}`;
}

function corpusIdentity(value) {
  const corpus = value.corpus && typeof value.corpus === 'object' ? value.corpus : {};
  return {
    corpusId: text(corpus.corpusId || value.corpusId),
    corpusVersion: text(corpus.corpusVersion || value.corpusVersion),
  };
}

function fingerprintPayload(value) {
  const clone = { ...value };
  for (const key of ['review', 'artifact', 'receipt', 'receiptId', 'receiptFingerprint']) {
    delete clone[key];
  }
  return canonicalValue(clone);
}

function resultIdentity(value) {
  const corpus = corpusIdentity(value);
  const evaluationId = text(value.evaluationId || value.evaluationFingerprint, 120);
  if (!evaluationId) {
    throw reviewError(
      'PROCESS_REVIEW_RESULT_INVALID',
      'Process result must contain an evaluationId for review binding.'
    );
  }
  const catalogFingerprint = catalogFingerprintFor(value);
  return {
    corpusId: corpus.corpusId,
    corpusVersion: corpus.corpusVersion,
    catalogFingerprint,
    evaluationId,
    resultFingerprint: `result:${stableHash(JSON.stringify(fingerprintPayload(value))).slice(0, 16)}`,
  };
}

function parsePolicyDays(value, label, fallback) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_REVIEW_POLICY_DAYS) {
    throw reviewError(
      'PROCESS_REVIEW_POLICY_INVALID',
      `${label} must be an integer between 1 and ${MAX_REVIEW_POLICY_DAYS}.`
    );
  }
  return parsed;
}

function normalizePolicy({ asOf, freshDays, retentionDays } = {}) {
  const inspectedAt = asOf == null || asOf === '' ? new Date() : new Date(String(asOf));
  if (Number.isNaN(inspectedAt.getTime())) {
    throw reviewError('PROCESS_REVIEW_AS_OF_INVALID', '--as-of must be a valid ISO timestamp.');
  }
  const freshWithinDays = parsePolicyDays(freshDays, '--fresh-days', DEFAULT_REVIEW_FRESH_DAYS);
  const retentionAfterDays = parsePolicyDays(
    retentionDays,
    '--retention-days',
    DEFAULT_REVIEW_RETENTION_DAYS
  );
  if (freshWithinDays >= retentionAfterDays) {
    throw reviewError(
      'PROCESS_REVIEW_POLICY_INVALID',
      '--fresh-days must be lower than --retention-days.'
    );
  }
  return {
    asOf: inspectedAt.toISOString(),
    asOfMs: inspectedAt.getTime(),
    freshWithinDays,
    retentionAfterDays,
  };
}

function classifyFreshness(reviewedAt, policy) {
  const reviewedAtMs = new Date(reviewedAt).getTime();
  if (Number.isNaN(reviewedAtMs)) return { status: 'invalid', ageDays: null };
  const ageMs = policy.asOfMs - reviewedAtMs;
  if (ageMs < 0) return { status: 'future', ageDays: 0 };
  const ageDays = Math.floor(ageMs / 86_400_000);
  return {
    status:
      ageDays <= policy.freshWithinDays
        ? 'fresh'
        : ageDays <= policy.retentionAfterDays
          ? 'aging'
          : 'historical',
    ageDays,
  };
}

function reviewerHash(reviewer) {
  return `reviewer:${stableHash(requireText(reviewer, '--reviewer', 200)).slice(0, 16)}`;
}

function receiptFingerprint({ identity, decision, reviewerHashValue, reviewedAt, policy }) {
  return `receipt:${stableHash(
    JSON.stringify(
      canonicalValue({
        identity,
        decision,
        reviewerHash: reviewerHashValue,
        reviewedAt,
        policy: {
          freshWithinDays: policy.freshWithinDays,
          retentionAfterDays: policy.retentionAfterDays,
        },
      })
    )
  ).slice(0, 16)}`;
}

function normalizeDecision(value) {
  const decision = String(value || '')
    .trim()
    .toLowerCase();
  if (!REVIEW_DECISIONS.includes(decision)) {
    throw reviewError(
      'PROCESS_REVIEW_DECISION_INVALID',
      `--decision must be one of: ${REVIEW_DECISIONS.join(', ')}.`
    );
  }
  return decision;
}

function buildProcessReviewRecord({
  cwd = process.cwd(),
  result,
  decision,
  reviewer,
  reviewedAt,
  freshDays,
  retentionDays,
} = {}) {
  const resultInput = readReviewResult({ cwd, result });
  const identity = resultIdentity(resultInput.value);
  const normalizedDecision = normalizeDecision(decision);
  const reviewerHashValue = reviewerHash(reviewer);
  const reviewedDate =
    reviewedAt == null || reviewedAt === '' ? new Date() : new Date(String(reviewedAt));
  if (Number.isNaN(reviewedDate.getTime())) {
    throw reviewError(
      'PROCESS_REVIEW_TIMESTAMP_INVALID',
      '--reviewed-at must be a valid ISO timestamp.'
    );
  }
  const policy = normalizePolicy({ reviewedAt, freshDays, retentionDays });
  const normalizedReviewedAt = reviewedDate.toISOString();
  const fingerprint = receiptFingerprint({
    identity,
    decision: normalizedDecision,
    reviewerHashValue,
    reviewedAt: normalizedReviewedAt,
    policy,
  });
  return {
    ok: true,
    operation: 'review record',
    kind: 'process-review-receipt',
    schemaVersion: PROCESS_REVIEW_SCHEMA_VERSION,
    readOnly: true,
    receiptId: fingerprint,
    receiptFingerprint: fingerprint,
    resultPath: resultInput.location.relativePath,
    identity,
    decision: normalizedDecision,
    reviewerHash: reviewerHashValue,
    reviewedAt: normalizedReviewedAt,
    policy: {
      freshWithinDays: policy.freshWithinDays,
      retentionAfterDays: policy.retentionAfterDays,
    },
    automaticPromotion: false,
    promotionAllowed: false,
    automaticDeployment: false,
    deploymentAllowed: false,
    nextSafeStep:
      normalizedDecision === 'approve'
        ? 'Use process review check with an explicit policy before treating this result as reviewed.'
        : 'Resolve the review decision and record a new receipt for the exact result identity.',
  };
}

function identityMismatches(expected, actual) {
  return [
    ['corpusId', 'CORPUS_ID_MISMATCH'],
    ['corpusVersion', 'CORPUS_VERSION_MISMATCH'],
    ['catalogFingerprint', 'CATALOG_FINGERPRINT_MISMATCH'],
    ['evaluationId', 'EVALUATION_ID_MISMATCH'],
    ['resultFingerprint', 'RESULT_FINGERPRINT_MISMATCH'],
  ]
    .filter(([field]) => (expected[field] || null) !== (actual[field] || null))
    .map(([, code]) => code);
}

function readReceipt({ cwd, receipt }) {
  const location = resolveReviewPath({ cwd, input: receipt, label: '--receipt' });
  let value;
  try {
    value = readJsonFile(location.absolutePath, 'Review receipt');
  } catch (error) {
    if (error.code === 'PROCESS_REVIEW_INPUT_MISSING') {
      return { location, value: null, status: 'missing', blockers: ['REVIEW_RECEIPT_MISSING'] };
    }
    return { location, value: null, status: 'invalid', blockers: ['REVIEW_RECEIPT_INVALID'] };
  }
  return { location, value, status: 'loaded', blockers: [] };
}

function checkReceiptShape(value, expectedIdentity, policy) {
  const blockers = [];
  if (
    !value ||
    value.kind !== 'process-review-receipt' ||
    value.schemaVersion !== PROCESS_REVIEW_SCHEMA_VERSION ||
    value.readOnly !== true
  ) {
    blockers.push('REVIEW_RECEIPT_INVALID');
    return blockers;
  }
  if (value.automaticPromotion !== false || value.promotionAllowed !== false) {
    blockers.push('REVIEW_RECEIPT_UNSAFE');
  }
  blockers.push(...identityMismatches(expectedIdentity, value.identity || {}));
  if (!REVIEW_DECISIONS.includes(value.decision)) blockers.push('REVIEW_DECISION_INVALID');
  if (!/^reviewer:[a-f0-9]{16}$/i.test(String(value.reviewerHash || ''))) {
    blockers.push('REVIEWER_HASH_INVALID');
  }
  const reviewedAt = new Date(String(value.reviewedAt || ''));
  if (Number.isNaN(reviewedAt.getTime())) blockers.push('REVIEW_TIMESTAMP_INVALID');
  const recordedPolicy = value.policy || {};
  const receiptPolicy = {
    freshWithinDays: Number(recordedPolicy.freshWithinDays),
    retentionAfterDays: Number(recordedPolicy.retentionAfterDays),
  };
  if (
    !Number.isInteger(receiptPolicy.freshWithinDays) ||
    !Number.isInteger(receiptPolicy.retentionAfterDays)
  ) {
    blockers.push('REVIEW_POLICY_INVALID');
  }
  const expectedFingerprint = receiptFingerprint({
    identity: expectedIdentity,
    decision: value.decision,
    reviewerHashValue: value.reviewerHash,
    reviewedAt: Number.isNaN(reviewedAt.getTime()) ? '' : reviewedAt.toISOString(),
    policy: {
      freshWithinDays: receiptPolicy.freshWithinDays,
      retentionAfterDays: receiptPolicy.retentionAfterDays,
    },
  });
  if (value.receiptId !== expectedFingerprint || value.receiptFingerprint !== expectedFingerprint) {
    blockers.push('REVIEW_RECEIPT_FINGERPRINT_MISMATCH');
  }
  if (!Number.isNaN(reviewedAt.getTime())) {
    const freshness = classifyFreshness(reviewedAt.toISOString(), policy);
    if (freshness.status === 'future') blockers.push('REVIEW_TIMESTAMP_IN_FUTURE');
    if (freshness.status === 'aging' || freshness.status === 'historical') {
      blockers.push('REVIEW_EXPIRED');
    }
  }
  if (value.decision !== 'approve') blockers.push('REVIEW_NOT_APPROVED');
  return [...new Set(blockers)];
}

function checkProcessReview({
  cwd = process.cwd(),
  result,
  receipt,
  policy = 'off',
  asOf,
  freshDays,
  retentionDays,
} = {}) {
  const normalizedPolicy = String(policy || 'off')
    .trim()
    .toLowerCase();
  if (!REVIEW_POLICIES.includes(normalizedPolicy)) {
    throw reviewError(
      'PROCESS_REVIEW_POLICY_INVALID',
      `--policy must be one of: ${REVIEW_POLICIES.join(', ')}.`
    );
  }
  const resultInput = readReviewResult({ cwd, result });
  const identity = resultIdentity(resultInput.value);
  const reviewPolicy = normalizePolicy({ asOf, freshDays, retentionDays });
  const receiptInput = readReceipt({ cwd, receipt });
  let blockers = receiptInput.blockers.slice();
  if (receiptInput.status === 'loaded') {
    blockers = checkReceiptShape(receiptInput.value, identity, reviewPolicy);
  }
  const valid = blockers.length === 0;
  const gatePassed = normalizedPolicy !== 'required' || valid;
  const status =
    normalizedPolicy === 'off'
      ? 'not-required'
      : valid
        ? 'approved'
        : normalizedPolicy === 'advisory'
          ? 'warning'
          : 'blocked';
  return {
    ok: true,
    operation: 'review check',
    kind: 'process-review-check-result',
    schemaVersion: PROCESS_REVIEW_SCHEMA_VERSION,
    readOnly: true,
    status,
    policy: normalizedPolicy,
    gatePassed,
    reviewRequired: normalizedPolicy === 'required',
    resultPath: resultInput.location.relativePath,
    receiptPath: receiptInput.location.relativePath,
    identity,
    receipt: {
      status: receiptInput.status,
      receiptId: receiptInput.value?.receiptId || null,
      decision: receiptInput.value?.decision || null,
      reviewerHash: receiptInput.value?.reviewerHash || null,
      reviewedAt: receiptInput.value?.reviewedAt || null,
      freshness: receiptInput.value?.reviewedAt
        ? classifyFreshness(receiptInput.value.reviewedAt, reviewPolicy)
        : null,
    },
    blockers,
    warnings: normalizedPolicy === 'advisory' ? blockers : [],
    configuredFreshWithinDays: reviewPolicy.freshWithinDays,
    configuredRetentionAfterDays: reviewPolicy.retentionAfterDays,
    automaticPromotion: false,
    promotionAllowed: false,
    automaticDeployment: false,
    deploymentAllowed: false,
    nextSafeStep: valid
      ? 'Keep the receipt with the exact result artifact and rerun the check after any result, catalog, corpus, or evaluation change.'
      : normalizedPolicy === 'required'
        ? 'Record a fresh approved receipt for the exact result identity, then rerun process review check.'
        : 'Treat the result as unreviewed until a matching fresh approved receipt is recorded.',
  };
}

function writeProcessReviewReceipt(payload, options = {}) {
  const location = resolveProcessReviewArtifactPath(options);
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
  DEFAULT_PROCESS_REVIEW_RECEIPT,
  DEFAULT_REVIEW_FRESH_DAYS,
  DEFAULT_REVIEW_RETENTION_DAYS,
  PROCESS_REVIEW_SCHEMA_VERSION,
  REVIEW_POLICIES,
  REVIEW_DECISIONS,
  buildProcessReviewRecord,
  buildProcessReviewReceipt: buildProcessReviewRecord,
  checkProcessReview,
  resolveProcessReviewArtifactPath,
  resultIdentity,
  writeProcessReviewReceipt,
};
