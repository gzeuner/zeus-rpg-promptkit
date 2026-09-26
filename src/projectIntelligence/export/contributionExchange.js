'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  canonicalJson,
  openContributionPackage,
  writeContributionPackage,
} = require('./contributionPackage');
const { validateContributionPackage } = require('./contributionValidation');

const EXCHANGE_SCHEMA = 'knowledge.contribution.exchange@1';
const EXCHANGE_KIND = 'knowledge-contribution-exchange';
const EXCHANGE_LAYOUT = Object.freeze({
  packageDirectory: 'package',
  receiptFile: 'receipt.json',
});
const EXCHANGE_REASON_CODES = Object.freeze({
  EXCHANGE_INVALID: 'FKX.EXCHANGE_INVALID',
  RECEIPT_INVALID: 'FKX.RECEIPT_INVALID',
  RECEIPT_HASH_MISMATCH: 'FKX.RECEIPT_HASH_MISMATCH',
  PACKAGE_MISMATCH: 'FKX.EXCHANGE_PACKAGE_MISMATCH',
  VALIDATION_FAILED: 'FKX.EXCHANGE_VALIDATION_FAILED',
  ACCEPTANCE_REQUIRED: 'FKX.ACCEPTANCE_REQUIRED',
  BASE_SNAPSHOT_STALE: 'FKX.EXCHANGE_BASE_SNAPSHOT_STALE',
  PATH_UNSAFE: 'FKX.EXCHANGE_PATH_UNSAFE',
  WRITE_CONFLICT: 'FKX.EXCHANGE_WRITE_CONFLICT',
  REPLAY: 'FKX.EXCHANGE_REPLAY',
});

const RECEIPT_FIELDS = Object.freeze([
  'kind',
  'schema',
  'contributionId',
  'packageHash',
  'baseSnapshot',
  'targetSnapshot',
  'decision',
  'review',
  'acceptedAt',
  'publication',
  'localOnly',
  'canPublish',
  'receiptId',
  'receiptHash',
]);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

class ContributionExchangeError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ContributionExchangeError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new ContributionExchangeError(code, message, details);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function requireAbsoluteDirectory(value, field) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    fail(EXCHANGE_REASON_CODES.PATH_UNSAFE, `${field} must be an absolute path`);
  }
  return value;
}

function requireIdentifier(value, field) {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value.trim())) {
    fail(EXCHANGE_REASON_CODES.RECEIPT_INVALID, `${field} is invalid`);
  }
  return value.trim();
}

function requireSha256(value, field) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    fail(EXCHANGE_REASON_CODES.RECEIPT_INVALID, `${field} must be lowercase sha256 hex`);
  }
  return value;
}

function normalizeSnapshot(value, field) {
  if (!isPlainObject(value)) fail(EXCHANGE_REASON_CODES.RECEIPT_INVALID, `${field} is required`);
  const keys = Object.keys(value);
  if (keys.some(key => !['snapshotId', 'contentHash'].includes(key))) {
    fail(EXCHANGE_REASON_CODES.RECEIPT_INVALID, `${field} contains unsupported fields`);
  }
  const snapshot = { snapshotId: requireIdentifier(value.snapshotId, `${field}.snapshotId`) };
  if (value.contentHash !== undefined) {
    snapshot.contentHash = requireSha256(value.contentHash, `${field}.contentHash`);
  }
  return snapshot;
}

function sameSnapshot(left, right) {
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  if (left.snapshotId !== right.snapshotId) return false;
  return left.contentHash === undefined || right.contentHash === undefined
    ? true
    : left.contentHash === right.contentHash;
}

function requireTimestamp(value, field) {
  const timestamp = value === undefined ? new Date().toISOString() : String(value).trim();
  if (!ISO_TIMESTAMP_PATTERN.test(timestamp) || Number.isNaN(Date.parse(timestamp))) {
    fail(EXCHANGE_REASON_CODES.RECEIPT_INVALID, `${field} must be an ISO UTC timestamp`);
  }
  return timestamp;
}

function requireReviewerHash(value) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    fail(
      EXCHANGE_REASON_CODES.RECEIPT_INVALID,
      'reviewerIdHash must be a lowercase sha256 hash; raw reviewer identities are not accepted'
    );
  }
  return value;
}

function normalizePackage(value) {
  if (typeof value === 'string') return openContributionPackage({ packageDir: value });
  if (!isPlainObject(value) || !isPlainObject(value.manifest) || !isPlainObject(value.payload)) {
    fail(EXCHANGE_REASON_CODES.PACKAGE_MISMATCH, 'a contribution package is required');
  }
  return value;
}

function packageIdentity(contribution) {
  const manifest = contribution.manifest;
  if (!isPlainObject(manifest))
    fail(EXCHANGE_REASON_CODES.PACKAGE_MISMATCH, 'package manifest missing');
  return {
    contributionId: requireIdentifier(manifest.contributionId, 'package.contributionId'),
    packageHash: requireSha256(manifest.packageHash, 'package.packageHash'),
    baseSnapshot: normalizeSnapshot(manifest.baseSnapshot, 'package.baseSnapshot'),
  };
}

function normalizeReceiptCore({
  package: packageInput,
  decision,
  reviewerIdHash,
  reviewId,
  targetSnapshot,
  acceptedAt,
}) {
  const contribution = normalizePackage(packageInput);
  const identity = packageIdentity(contribution);
  if (decision !== 'accepted') {
    fail(
      EXCHANGE_REASON_CODES.ACCEPTANCE_REQUIRED,
      'only accepted contributions may enter an exchange'
    );
  }
  const target = normalizeSnapshot(targetSnapshot, 'targetSnapshot');
  if (target.snapshotId === identity.baseSnapshot.snapshotId) {
    fail(EXCHANGE_REASON_CODES.RECEIPT_INVALID, 'targetSnapshot must differ from baseSnapshot');
  }
  const core = {
    kind: EXCHANGE_KIND,
    schema: EXCHANGE_SCHEMA,
    contributionId: identity.contributionId,
    packageHash: identity.packageHash,
    baseSnapshot: identity.baseSnapshot,
    targetSnapshot: target,
    decision: 'accepted',
    review: {
      reviewId: requireIdentifier(reviewId, 'reviewId'),
      reviewerIdHash: requireReviewerHash(reviewerIdHash),
    },
    acceptedAt: requireTimestamp(acceptedAt, 'acceptedAt'),
    publication: false,
    localOnly: true,
    canPublish: false,
  };
  return { contribution, core };
}

function buildReceipt(core) {
  const receiptHash = sha256Hex(`${canonicalJson(core)}\n`);
  const receipt = {
    ...core,
    receiptId: `receipt-${receiptHash}`,
    receiptHash,
  };
  return {
    receipt,
    receiptHash,
    receiptId: receipt.receiptId,
    body: `${canonicalJson(receipt)}\n`,
  };
}

function createContributionAcceptanceReceipt(options = {}) {
  if (!isPlainObject(options)) fail(EXCHANGE_REASON_CODES.RECEIPT_INVALID, 'options are invalid');
  const { contribution, core } = normalizeReceiptCore(options);
  const validation = validateContributionPackage({
    package: contribution,
    policy: { requireFreshness: false },
  });
  if (!validation.ok) {
    fail(EXCHANGE_REASON_CODES.VALIDATION_FAILED, 'contribution package failed validation', {
      reasonCodes: validation.reasonCodes,
    });
  }
  const built = buildReceipt(core);
  return deepFreeze({
    ok: true,
    kind: EXCHANGE_KIND,
    schema: EXCHANGE_SCHEMA,
    receipt: built.receipt,
    receiptId: built.receiptId,
    receiptHash: built.receiptHash,
    publication: false,
    localOnly: true,
    canPublish: false,
  });
}

function assertRegularDirectory(directory, field) {
  if (!fs.existsSync(directory))
    fail(EXCHANGE_REASON_CODES.EXCHANGE_INVALID, `${field} is missing`);
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory())
    fail(EXCHANGE_REASON_CODES.EXCHANGE_INVALID, `${field} must be a directory`);
}

function assertRegularFile(file, field) {
  if (!fs.existsSync(file)) fail(EXCHANGE_REASON_CODES.EXCHANGE_INVALID, `${field} is missing`);
  const stat = fs.lstatSync(file);
  if (!stat.isFile())
    fail(EXCHANGE_REASON_CODES.EXCHANGE_INVALID, `${field} must be a regular file`);
}

function assertExchangeShape(exchangeDir) {
  requireAbsoluteDirectory(exchangeDir, 'exchangeDir');
  assertRegularDirectory(exchangeDir, 'exchangeDir');
  const entries = fs.readdirSync(exchangeDir).sort();
  const expected = [EXCHANGE_LAYOUT.packageDirectory, EXCHANGE_LAYOUT.receiptFile].sort();
  if (
    entries.length !== expected.length ||
    entries.some((entry, index) => entry !== expected[index])
  ) {
    fail(EXCHANGE_REASON_CODES.EXCHANGE_INVALID, 'exchange directory contains unsupported entries');
  }
  assertRegularDirectory(
    path.join(exchangeDir, EXCHANGE_LAYOUT.packageDirectory),
    'package directory'
  );
  assertRegularFile(path.join(exchangeDir, EXCHANGE_LAYOUT.receiptFile), 'receipt file');
}

function assertNoSymlinkAncestors(directory) {
  let cursor = path.resolve(directory);
  while (true) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) {
      fail(EXCHANGE_REASON_CODES.PATH_UNSAFE, 'exchange path contains a symbolic link');
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}

function readCanonicalJson(file, field) {
  assertRegularFile(file, field);
  const body = fs.readFileSync(file, 'utf8');
  if (body.charCodeAt(0) === 0xfeff || body.includes('\r')) {
    fail(EXCHANGE_REASON_CODES.EXCHANGE_INVALID, `${field} must use UTF-8 without BOM or CRLF`);
  }
  try {
    const parsed = JSON.parse(body);
    if (`${canonicalJson(parsed)}\n` !== body) {
      fail(EXCHANGE_REASON_CODES.EXCHANGE_INVALID, `${field} is not canonical JSON`);
    }
    return parsed;
  } catch (error) {
    if (error instanceof ContributionExchangeError) throw error;
    fail(EXCHANGE_REASON_CODES.EXCHANGE_INVALID, `${field} is unreadable`);
  }
}

function verifyReceipt(receipt, contribution) {
  if (!isPlainObject(receipt)) fail(EXCHANGE_REASON_CODES.RECEIPT_INVALID, 'receipt is invalid');
  if (Object.keys(receipt).some(key => !RECEIPT_FIELDS.includes(key))) {
    fail(EXCHANGE_REASON_CODES.RECEIPT_INVALID, 'receipt contains unsupported fields');
  }
  const identity = packageIdentity(contribution);
  const expectedCore = {
    kind: receipt.kind,
    schema: receipt.schema,
    contributionId: receipt.contributionId,
    packageHash: receipt.packageHash,
    baseSnapshot: receipt.baseSnapshot,
    targetSnapshot: receipt.targetSnapshot,
    decision: receipt.decision,
    review: receipt.review,
    acceptedAt: receipt.acceptedAt,
    publication: receipt.publication,
    localOnly: receipt.localOnly,
    canPublish: receipt.canPublish,
  };
  const expectedHash = sha256Hex(`${canonicalJson(expectedCore)}\n`);
  if (receipt.kind !== EXCHANGE_KIND || receipt.schema !== EXCHANGE_SCHEMA) {
    fail(EXCHANGE_REASON_CODES.RECEIPT_INVALID, 'receipt schema is unsupported');
  }
  if (receipt.receiptHash !== expectedHash || receipt.receiptId !== `receipt-${expectedHash}`) {
    fail(EXCHANGE_REASON_CODES.RECEIPT_HASH_MISMATCH, 'receipt hash does not match its content');
  }
  if (
    receipt.contributionId !== identity.contributionId ||
    receipt.packageHash !== identity.packageHash
  ) {
    fail(EXCHANGE_REASON_CODES.PACKAGE_MISMATCH, 'receipt is bound to a different package');
  }
  if (!sameSnapshot(receipt.baseSnapshot, identity.baseSnapshot)) {
    fail(EXCHANGE_REASON_CODES.PACKAGE_MISMATCH, 'receipt base snapshot differs from package');
  }
  if (
    receipt.decision !== 'accepted' ||
    receipt.publication !== false ||
    receipt.localOnly !== true ||
    receipt.canPublish !== false
  ) {
    fail(
      EXCHANGE_REASON_CODES.ACCEPTANCE_REQUIRED,
      'receipt does not represent a local accepted exchange'
    );
  }
  if (
    !isPlainObject(receipt.review) ||
    Object.keys(receipt.review).sort().join('|') !== 'reviewId|reviewerIdHash'
  ) {
    fail(EXCHANGE_REASON_CODES.RECEIPT_INVALID, 'review identity is invalid');
  }
  requireIdentifier(receipt.review.reviewId, 'receipt.review.reviewId');
  requireReviewerHash(receipt.review.reviewerIdHash);
  requireTimestamp(receipt.acceptedAt, 'receipt.acceptedAt');
  normalizeSnapshot(receipt.baseSnapshot, 'receipt.baseSnapshot');
  const target = normalizeSnapshot(receipt.targetSnapshot, 'receipt.targetSnapshot');
  if (target.snapshotId === receipt.baseSnapshot.snapshotId) {
    fail(EXCHANGE_REASON_CODES.RECEIPT_INVALID, 'receipt target snapshot is not distinct');
  }
  return receipt;
}

function openContributionExchange(options = {}) {
  if (!isPlainObject(options)) fail(EXCHANGE_REASON_CODES.EXCHANGE_INVALID, 'options are invalid');
  const exchangeDir = requireAbsoluteDirectory(options.exchangeDir, 'exchangeDir');
  assertNoSymlinkAncestors(exchangeDir);
  assertExchangeShape(exchangeDir);
  const contribution = openContributionPackage({
    packageDir: path.join(exchangeDir, EXCHANGE_LAYOUT.packageDirectory),
  });
  const receipt = readCanonicalJson(
    path.join(exchangeDir, EXCHANGE_LAYOUT.receiptFile),
    EXCHANGE_LAYOUT.receiptFile
  );
  verifyReceipt(receipt, contribution);
  if (
    options.currentSnapshot !== undefined &&
    !sameSnapshot(receipt.baseSnapshot, options.currentSnapshot)
  ) {
    fail(EXCHANGE_REASON_CODES.BASE_SNAPSHOT_STALE, 'exchange base snapshot is stale');
  }
  const validation =
    options.currentSnapshot === undefined
      ? null
      : validateContributionPackage({
          package: contribution,
          policy: { ...(options.validationPolicy || {}), currentSnapshot: options.currentSnapshot },
        });
  if (validation && !validation.ok) {
    fail(EXCHANGE_REASON_CODES.VALIDATION_FAILED, 'exchange package failed validation', {
      reasonCodes: validation.reasonCodes,
    });
  }
  return deepFreeze({
    ok: true,
    kind: EXCHANGE_KIND,
    schema: EXCHANGE_SCHEMA,
    exchangeDir,
    package: contribution,
    receipt,
    receiptId: receipt.receiptId,
    receiptHash: receipt.receiptHash,
    validation,
    publication: false,
    localOnly: true,
    canPublish: false,
    readOnly: true,
  });
}

function writeTextAtomic(file, body) {
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(temporary, body, 'utf8');
    fs.renameSync(temporary, file);
  } catch (error) {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch {
      // Best-effort cleanup only.
    }
    throw error;
  }
}

function removeTemporary(directory) {
  try {
    if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup only.
  }
}

function writeContributionExchange(options = {}) {
  if (!isPlainObject(options)) fail(EXCHANGE_REASON_CODES.EXCHANGE_INVALID, 'options are invalid');
  const exchangeDir = requireAbsoluteDirectory(options.exchangeDir, 'exchangeDir');
  assertNoSymlinkAncestors(exchangeDir);
  const currentSnapshot = normalizeSnapshot(options.currentSnapshot, 'currentSnapshot');
  if (options.decision !== undefined && options.decision !== 'accepted') {
    fail(
      EXCHANGE_REASON_CODES.ACCEPTANCE_REQUIRED,
      'only accepted contributions may enter an exchange'
    );
  }
  const contribution = normalizePackage(options.packageDir || options.package);
  const validation = validateContributionPackage({
    package: contribution,
    policy: { ...(options.validationPolicy || {}), currentSnapshot },
  });
  if (!validation.ok) {
    const stale = validation.reasonCodes.includes('FKX.FRESHNESS_STALE');
    fail(
      stale ? EXCHANGE_REASON_CODES.BASE_SNAPSHOT_STALE : EXCHANGE_REASON_CODES.VALIDATION_FAILED,
      'contribution package is not eligible for exchange',
      { reasonCodes: validation.reasonCodes }
    );
  }
  const receiptResult = createContributionAcceptanceReceipt({
    package: contribution,
    decision: 'accepted',
    reviewerIdHash: options.reviewerIdHash,
    reviewId: options.reviewId,
    targetSnapshot: options.targetSnapshot,
    acceptedAt: options.acceptedAt,
  });
  const existing = fs.existsSync(exchangeDir);
  if (existing) {
    try {
      const opened = openContributionExchange({ exchangeDir });
      if (opened.receiptHash === receiptResult.receiptHash) {
        return deepFreeze({
          ...opened,
          validation,
          idempotent: true,
          readOnly: false,
        });
      }
      fail(EXCHANGE_REASON_CODES.REPLAY, 'exchange directory already contains another receipt');
    } catch (error) {
      if (
        error instanceof ContributionExchangeError &&
        error.code === EXCHANGE_REASON_CODES.REPLAY
      ) {
        throw error;
      }
      fail(
        EXCHANGE_REASON_CODES.WRITE_CONFLICT,
        'exchange directory exists but is not the same exchange'
      );
    }
  }

  const parent = path.dirname(exchangeDir);
  fs.mkdirSync(parent, { recursive: true });
  const temporary = `${exchangeDir}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.mkdirSync(temporary);
    const packageTarget = path.join(temporary, EXCHANGE_LAYOUT.packageDirectory);
    const manifest = contribution.manifest;
    writeContributionPackage({
      packageDir: packageTarget,
      ...manifest,
      payload: contribution.payload,
    });
    writeTextAtomic(
      path.join(temporary, EXCHANGE_LAYOUT.receiptFile),
      `${canonicalJson(receiptResult.receipt)}\n`
    );
    fs.renameSync(temporary, exchangeDir);
  } catch (error) {
    removeTemporary(temporary);
    if (error instanceof ContributionExchangeError) throw error;
    if (error && (error.code === 'EEXIST' || error.code === 'EPERM')) {
      try {
        const opened = openContributionExchange({ exchangeDir });
        if (opened.receiptHash === receiptResult.receiptHash) {
          return deepFreeze({ ...opened, validation, idempotent: true, readOnly: false });
        }
      } catch {
        // Fall through to a stable conflict error.
      }
      fail(EXCHANGE_REASON_CODES.WRITE_CONFLICT, 'exchange directory appeared during atomic write');
    }
    throw error;
  }

  return deepFreeze({
    ok: true,
    kind: EXCHANGE_KIND,
    schema: EXCHANGE_SCHEMA,
    exchangeDir,
    package: contribution,
    receipt: receiptResult.receipt,
    receiptId: receiptResult.receiptId,
    receiptHash: receiptResult.receiptHash,
    validation,
    idempotent: false,
    publication: false,
    localOnly: true,
    canPublish: false,
    readOnly: false,
  });
}

module.exports = {
  EXCHANGE_SCHEMA,
  EXCHANGE_KIND,
  EXCHANGE_LAYOUT,
  EXCHANGE_REASON_CODES,
  ContributionExchangeError,
  createContributionAcceptanceReceipt,
  writeContributionExchange,
  openContributionExchange,
};
