'use strict';

const { canonicalJson, sha256Hex } = require('./contributionPackage');

const VERIFICATION_RECEIPT_SCHEMA = 'knowledge.verification.receipt@1';
const VERIFICATION_RECEIPT_KIND = 'verification-receipt';
const VERIFICATION_RECEIPT_REASON_CODES = Object.freeze({
  INPUT_INVALID: 'FKX.RECEIPT_INPUT_INVALID',
  GATE_MISSING: 'FKX.RECEIPT_GATE_MISSING',
  GATE_FAILED: 'FKX.RECEIPT_GATE_FAILED',
  SUMMARY_INVALID: 'FKX.RECEIPT_SUMMARY_INVALID',
  HASH_INVALID: 'FKX.RECEIPT_HASH_INVALID',
  STATUS_INVALID: 'FKX.RECEIPT_STATUS_INVALID',
  LOCALITY_INVALID: 'FKX.RECEIPT_LOCALITY_INVALID',
  WARNING_INVALID: 'FKX.RECEIPT_WARNING_INVALID',
  DECISION_INVALID: 'FKX.RECEIPT_DECISION_INVALID',
});

const REQUIRED_GATES = Object.freeze([
  'focused-tests',
  'lint',
  'typecheck-core',
  'docs-check',
  'tracked-fixtures',
  'format-check',
  'diff-check',
  'test-discovery',
  'full-test',
]);
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const HEAD_PATTERN = /^[a-f0-9]{7,64}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const GATE_STATUSES = Object.freeze(['passed', 'baseline-warning']);
const RECEIPT_INPUT_FIELDS = Object.freeze([
  'git',
  'packageVersions',
  'gates',
  'testSummary',
  'fixtureHashes',
  'warnings',
  'openDecisions',
  'recordedAt',
  'workspaceFingerprint',
  'remoteActions',
  'sourceMutation',
  'providerInvocation',
  'publication',
]);

class VerificationReceiptError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VerificationReceiptError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new VerificationReceiptError(code, message);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function requireObject(value, field) {
  if (!isPlainObject(value))
    fail(VERIFICATION_RECEIPT_REASON_CODES.INPUT_INVALID, `${field} is required`);
  return value;
}

function requireIdentifier(value, field) {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value.trim())) {
    fail(VERIFICATION_RECEIPT_REASON_CODES.INPUT_INVALID, `${field} is invalid`);
  }
  return value.trim();
}

function requireText(value, field) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > 256) {
    fail(VERIFICATION_RECEIPT_REASON_CODES.INPUT_INVALID, `${field} is invalid`);
  }
  return value.trim();
}

function requireCode(value, field) {
  if (typeof value !== 'string' || !/^[A-Z][A-Z0-9_.-]{0,63}$/.test(value.trim())) {
    fail(VERIFICATION_RECEIPT_REASON_CODES.INPUT_INVALID, `${field} is invalid`);
  }
  return value.trim();
}

function requireHash(value, field) {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    fail(VERIFICATION_RECEIPT_REASON_CODES.HASH_INVALID, `${field} must be lowercase sha256 hex`);
  }
  return value;
}

function requireTimestamp(value) {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) {
    fail(
      VERIFICATION_RECEIPT_REASON_CODES.INPUT_INVALID,
      'recordedAt must be an ISO UTC timestamp'
    );
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    fail(
      VERIFICATION_RECEIPT_REASON_CODES.INPUT_INVALID,
      'recordedAt must be an ISO UTC timestamp'
    );
  }
  const canonical = parsed.toISOString();
  const expected = value.includes('.') ? canonical : canonical.replace('.000Z', 'Z');
  if (value !== expected) {
    fail(
      VERIFICATION_RECEIPT_REASON_CODES.INPUT_INVALID,
      'recordedAt must be a canonical ISO UTC timestamp'
    );
  }
  return value;
}

function cloneSafe(value, field) {
  try {
    return JSON.parse(canonicalJson(value, { rejectSensitiveKeys: true }));
  } catch {
    fail(VERIFICATION_RECEIPT_REASON_CODES.INPUT_INVALID, `${field} contains unsafe data`);
  }
}

function assertAllowedFields(value, fields, field) {
  const unknown = Object.keys(value).filter(key => !fields.includes(key));
  if (unknown.length) {
    fail(VERIFICATION_RECEIPT_REASON_CODES.INPUT_INVALID, `${field} contains unsupported fields`);
  }
}

function normalizeGit(value) {
  const git = requireObject(value, 'git');
  assertAllowedFields(git, ['head', 'worktreeStatus'], 'git');
  if (typeof git.head !== 'string' || !HEAD_PATTERN.test(git.head)) {
    fail(VERIFICATION_RECEIPT_REASON_CODES.INPUT_INVALID, 'git.head is invalid');
  }
  if (!['clean', 'dirty'].includes(git.worktreeStatus)) {
    fail(VERIFICATION_RECEIPT_REASON_CODES.INPUT_INVALID, 'git.worktreeStatus is invalid');
  }
  return { head: git.head, worktreeStatus: git.worktreeStatus };
}

function normalizePackageVersions(value) {
  const versions = requireObject(value, 'packageVersions');
  if (Object.keys(versions).length === 0) {
    fail(VERIFICATION_RECEIPT_REASON_CODES.INPUT_INVALID, 'packageVersions must not be empty');
  }
  const result = {};
  for (const key of Object.keys(versions).sort()) {
    result[requireIdentifier(key, 'packageVersions key')] = requireIdentifier(
      versions[key],
      `packageVersions.${key}`
    );
  }
  return result;
}

function normalizeGates(value) {
  const gates = requireObject(value, 'gates');
  assertAllowedFields(gates, REQUIRED_GATES, 'gates');
  const result = {};
  for (const gate of REQUIRED_GATES) {
    const entry = gates[gate];
    if (entry === undefined) {
      fail(VERIFICATION_RECEIPT_REASON_CODES.GATE_MISSING, `${gate} gate is missing`);
    }
    if (entry === 'passed') {
      result[gate] = { status: 'passed' };
      continue;
    }
    if (!isPlainObject(entry) || !GATE_STATUSES.includes(entry.status)) {
      fail(VERIFICATION_RECEIPT_REASON_CODES.GATE_FAILED, `${gate} gate is not accepted`);
    }
    assertAllowedFields(entry, ['status', 'reasonCode', 'message'], `gates.${gate}`);
    if (
      entry.status === 'passed' &&
      (entry.reasonCode !== undefined || entry.message !== undefined)
    ) {
      fail(VERIFICATION_RECEIPT_REASON_CODES.GATE_FAILED, `${gate} passed gate has warning data`);
    }
    if (entry.status === 'baseline-warning') {
      if (
        typeof entry.reasonCode !== 'string' ||
        !/^[A-Z][A-Z0-9_.-]{0,63}$/.test(entry.reasonCode)
      ) {
        fail(VERIFICATION_RECEIPT_REASON_CODES.GATE_FAILED, `${gate} warning reason is invalid`);
      }
      if (
        typeof entry.message !== 'string' ||
        !entry.message.trim() ||
        Buffer.byteLength(entry.message, 'utf8') > 256
      ) {
        fail(VERIFICATION_RECEIPT_REASON_CODES.GATE_FAILED, `${gate} warning message is required`);
      }
    }
    result[gate] = cloneSafe(entry, `gates.${gate}`);
  }
  return result;
}

function normalizeTestSummary(value) {
  const summary = requireObject(value, 'testSummary');
  if (Object.keys(summary).length === 0) {
    fail(VERIFICATION_RECEIPT_REASON_CODES.SUMMARY_INVALID, 'testSummary must not be empty');
  }
  const result = {};
  for (const key of Object.keys(summary).sort()) {
    requireIdentifier(key, 'testSummary key');
    const entry = requireObject(summary[key], `testSummary.${key}`);
    assertAllowedFields(entry, ['total', 'passed', 'failed', 'skipped'], `testSummary.${key}`);
    for (const field of ['total', 'passed', 'failed', 'skipped']) {
      if (!Number.isInteger(entry[field]) || entry[field] < 0) {
        fail(VERIFICATION_RECEIPT_REASON_CODES.SUMMARY_INVALID, `${key}.${field} is invalid`);
      }
    }
    if (entry.passed + entry.failed + entry.skipped !== entry.total || entry.failed !== 0) {
      fail(VERIFICATION_RECEIPT_REASON_CODES.SUMMARY_INVALID, `${key} test summary is not green`);
    }
    result[key] = {
      total: entry.total,
      passed: entry.passed,
      failed: entry.failed,
      skipped: entry.skipped,
    };
  }
  return result;
}

function normalizeFixtureHashes(value) {
  const hashes = requireObject(value, 'fixtureHashes');
  const result = {};
  for (const key of Object.keys(hashes).sort()) {
    result[requireIdentifier(key, 'fixtureHashes key')] = requireHash(
      hashes[key],
      `fixtureHashes.${key}`
    );
  }
  return result;
}

function normalizeNoticeList(value, field, decision) {
  if (!Array.isArray(value))
    fail(
      decision
        ? VERIFICATION_RECEIPT_REASON_CODES.DECISION_INVALID
        : VERIFICATION_RECEIPT_REASON_CODES.WARNING_INVALID,
      `${field} must be an array`
    );
  if (value.length > 32)
    fail(
      decision
        ? VERIFICATION_RECEIPT_REASON_CODES.DECISION_INVALID
        : VERIFICATION_RECEIPT_REASON_CODES.WARNING_INVALID,
      `${field} is too large`
    );
  return value.map((entry, index) => {
    const item = requireObject(entry, `${field}.${index}`);
    const required = decision
      ? ['id', 'status', 'owner', 'reasonCode', 'nextAction']
      : ['id', 'severity', 'owner', 'reasonCode', 'nextAction'];
    assertAllowedFields(item, required.concat(decision ? [] : ['message']), `${field}.${index}`);
    for (const key of required) {
      if (key === 'nextAction') requireText(item[key], `${field}.${index}.${key}`);
      else if (key === 'reasonCode') requireCode(item[key], `${field}.${index}.${key}`);
      else requireIdentifier(item[key], `${field}.${index}.${key}`);
    }
    if (decision && !['deferred', 'accepted'].includes(item.status)) {
      fail(
        VERIFICATION_RECEIPT_REASON_CODES.DECISION_INVALID,
        `${field}.${index}.status is invalid`
      );
    }
    if (!decision && !['info', 'warning'].includes(item.severity)) {
      fail(
        VERIFICATION_RECEIPT_REASON_CODES.WARNING_INVALID,
        `${field}.${index}.severity is invalid`
      );
    }
    if (
      !decision &&
      item.message !== undefined &&
      (typeof item.message !== 'string' ||
        !item.message.trim() ||
        Buffer.byteLength(item.message, 'utf8') > 256)
    ) {
      fail(
        VERIFICATION_RECEIPT_REASON_CODES.WARNING_INVALID,
        `${field}.${index}.message is invalid`
      );
    }
    return cloneSafe(item, `${field}.${index}`);
  });
}

function normalizeOptions(options) {
  const input = requireObject(options, 'options');
  assertAllowedFields(input, RECEIPT_INPUT_FIELDS, 'options');
  const normalized = {
    git: normalizeGit(input.git),
    packageVersions: normalizePackageVersions(input.packageVersions),
    gates: normalizeGates(input.gates),
    testSummary: normalizeTestSummary(input.testSummary),
    fixtureHashes: normalizeFixtureHashes(input.fixtureHashes),
    warnings: normalizeNoticeList(input.warnings, 'warnings', false),
    openDecisions: normalizeNoticeList(input.openDecisions, 'openDecisions', true),
    recordedAt: requireTimestamp(input.recordedAt),
    workspaceFingerprint: requireHash(input.workspaceFingerprint, 'workspaceFingerprint'),
  };
  for (const field of ['remoteActions', 'sourceMutation', 'providerInvocation', 'publication']) {
    if (input[field] !== false) {
      fail(VERIFICATION_RECEIPT_REASON_CODES.LOCALITY_INVALID, `${field} must be false`);
    }
    normalized[field] = false;
  }
  if (
    normalized.git.worktreeStatus === 'dirty' &&
    !normalized.warnings.some(item => item.reasonCode === 'WORKTREE_DIRTY')
  ) {
    fail(
      VERIFICATION_RECEIPT_REASON_CODES.WARNING_INVALID,
      'dirty worktree requires WORKTREE_DIRTY warning'
    );
  }
  return normalized;
}

function buildCore(normalized) {
  const hasWarning = Object.values(normalized.gates).some(
    entry => entry.status === 'baseline-warning'
  );
  return {
    kind: VERIFICATION_RECEIPT_KIND,
    schema: VERIFICATION_RECEIPT_SCHEMA,
    status:
      hasWarning || normalized.warnings.length || normalized.openDecisions.length
        ? 'passed-with-warnings'
        : 'passed',
    localOnly: true,
    readOnly: true,
    publication: false,
    git: normalized.git,
    packageVersions: normalized.packageVersions,
    gates: normalized.gates,
    testSummary: normalized.testSummary,
    fixtureHashes: normalized.fixtureHashes,
    warnings: normalized.warnings,
    openDecisions: normalized.openDecisions,
    recordedAt: normalized.recordedAt,
    workspaceFingerprint: normalized.workspaceFingerprint,
    remoteActions: false,
    sourceMutation: false,
    providerInvocation: false,
  };
}

function createVerificationReceipt(options = {}) {
  const normalized = normalizeOptions(options);
  const core = buildCore(normalized);
  const receiptHash = sha256Hex(`${canonicalJson(core, { rejectSensitiveKeys: true })}\n`);
  return deepFreeze({ ...core, receiptHash });
}

function validateVerificationReceipt(receipt) {
  try {
    requireObject(receipt, 'receipt');
    assertAllowedFields(
      receipt,
      [
        'kind',
        'schema',
        'status',
        'localOnly',
        'readOnly',
        'publication',
        'git',
        'packageVersions',
        'gates',
        'testSummary',
        'fixtureHashes',
        'warnings',
        'openDecisions',
        'recordedAt',
        'workspaceFingerprint',
        'remoteActions',
        'sourceMutation',
        'providerInvocation',
        'receiptHash',
      ],
      'receipt'
    );
    if (
      receipt.kind !== VERIFICATION_RECEIPT_KIND ||
      receipt.schema !== VERIFICATION_RECEIPT_SCHEMA ||
      receipt.localOnly !== true ||
      receipt.readOnly !== true ||
      receipt.publication !== false ||
      receipt.remoteActions !== false ||
      receipt.sourceMutation !== false ||
      receipt.providerInvocation !== false
    ) {
      return [VERIFICATION_RECEIPT_REASON_CODES.LOCALITY_INVALID];
    }
    if (receipt.receiptHash === undefined || !HASH_PATTERN.test(receipt.receiptHash)) {
      return [VERIFICATION_RECEIPT_REASON_CODES.HASH_INVALID];
    }
    const claimedStatus = receipt.status;
    const input = Object.fromEntries(RECEIPT_INPUT_FIELDS.map(field => [field, receipt[field]]));
    const expected = createVerificationReceipt(input);
    if (expected.status !== claimedStatus)
      return [VERIFICATION_RECEIPT_REASON_CODES.STATUS_INVALID];
    if (expected.receiptHash !== receipt.receiptHash)
      return [VERIFICATION_RECEIPT_REASON_CODES.HASH_INVALID];
    return [];
  } catch (error) {
    return [
      error instanceof VerificationReceiptError
        ? error.code
        : VERIFICATION_RECEIPT_REASON_CODES.INPUT_INVALID,
    ];
  }
}

module.exports = {
  REQUIRED_GATES,
  VERIFICATION_RECEIPT_SCHEMA,
  VERIFICATION_RECEIPT_KIND,
  VERIFICATION_RECEIPT_REASON_CODES,
  VerificationReceiptError,
  createVerificationReceipt,
  validateVerificationReceipt,
};
