'use strict';

const { canonicalJson } = require('./contributionPackage');
const { openContributionExchange } = require('./contributionExchange');

const PUBLICATION_SCHEMA = 'knowledge.contribution.publication@1';
const PUBLICATION_KIND = 'knowledge-contribution-publication';
const PUBLICATION_REASON_CODES = Object.freeze({
  PUBLICATION_INVALID: 'FKX.PUBLICATION_INVALID',
  PUBLISHER_UNSAFE: 'FKX.PUBLICATION_PUBLISHER_UNSAFE',
  FINGERPRINT_REQUIRED: 'FKX.PUBLICATION_FINGERPRINT_REQUIRED',
  BASE_SNAPSHOT_STALE: 'FKX.PUBLICATION_BASE_SNAPSHOT_STALE',
  TARGET_SNAPSHOT_MISMATCH: 'FKX.PUBLICATION_TARGET_SNAPSHOT_MISMATCH',
  REPLAY: 'FKX.PUBLICATION_REPLAY',
  PUBLICATION_FAILED: 'FKX.PUBLICATION_FAILED',
  ATOMICITY_VIOLATION: 'FKX.PUBLICATION_ATOMICITY_VIOLATION',
  POINTER_MISMATCH: 'FKX.PUBLICATION_POINTER_MISMATCH',
  HISTORY_INVALID: 'FKX.PUBLICATION_HISTORY_INVALID',
});

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

class ContributionPublicationError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ContributionPublicationError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new ContributionPublicationError(code, message, details);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireIdentifier(value, field) {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value.trim())) {
    fail(PUBLICATION_REASON_CODES.PUBLICATION_INVALID, `${field} is invalid`);
  }
  return value.trim();
}

function requireSha256(value, field) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    fail(PUBLICATION_REASON_CODES.PUBLICATION_INVALID, `${field} must be lowercase sha256 hex`);
  }
  return value;
}

function requireFingerprint(value, field) {
  if (!isPlainObject(value)) {
    fail(PUBLICATION_REASON_CODES.FINGERPRINT_REQUIRED, `${field} is required`);
  }
  const keys = Object.keys(value);
  if (keys.some(key => !['snapshotId', 'contentHash'].includes(key))) {
    fail(PUBLICATION_REASON_CODES.PUBLICATION_INVALID, `${field} contains unsupported fields`);
  }
  if (value.contentHash === undefined) {
    fail(PUBLICATION_REASON_CODES.FINGERPRINT_REQUIRED, `${field}.contentHash is required`);
  }
  return {
    snapshotId: requireIdentifier(value.snapshotId, `${field}.snapshotId`),
    contentHash: requireSha256(value.contentHash, `${field}.contentHash`),
  };
}

function exactSnapshot(left, right) {
  return (
    isPlainObject(left) &&
    isPlainObject(right) &&
    left.snapshotId === right.snapshotId &&
    left.contentHash === right.contentHash
  );
}

function cloneJson(value, field) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch {
    fail(PUBLICATION_REASON_CODES.PUBLICATION_INVALID, `${field} is not canonical JSON data`);
  }
}

function requireTimestamp(value, field) {
  const timestamp = value === undefined ? new Date().toISOString() : String(value).trim();
  if (!ISO_TIMESTAMP_PATTERN.test(timestamp) || Number.isNaN(Date.parse(timestamp))) {
    fail(PUBLICATION_REASON_CODES.PUBLICATION_INVALID, `${field} must be an ISO UTC timestamp`);
  }
  return timestamp;
}

function assertPublisher(publisher) {
  if (!isPlainObject(publisher)) {
    fail(PUBLICATION_REASON_CODES.PUBLISHER_UNSAFE, 'a local snapshot publisher is required');
  }
  const requiredFunctions = ['getCurrentSnapshot', 'getPublication', 'publishAtomic'];
  if (requiredFunctions.some(name => typeof publisher[name] !== 'function')) {
    fail(
      PUBLICATION_REASON_CODES.PUBLISHER_UNSAFE,
      'publisher must expose current, replay and atomic publication functions'
    );
  }
  if (publisher.localOnly !== true || publisher.atomic !== true) {
    fail(
      PUBLICATION_REASON_CODES.PUBLISHER_UNSAFE,
      'publisher must explicitly declare local-only atomic publication'
    );
  }
  if (
    publisher.remoteWrite !== false ||
    publisher.network !== false ||
    publisher.providerInvoked !== false
  ) {
    fail(
      PUBLICATION_REASON_CODES.PUBLISHER_UNSAFE,
      'publisher must explicitly disable remote, network and provider effects'
    );
  }
}

function normalizeReplayRecord(value, receipt) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) {
    fail(PUBLICATION_REASON_CODES.REPLAY, 'stored publication record is invalid');
  }
  if (
    value.receiptHash !== receipt.receiptHash ||
    value.packageHash !== receipt.packageHash ||
    value.publicationId !== `publication-${receipt.receiptHash}` ||
    value.status !== 'published'
  ) {
    fail(PUBLICATION_REASON_CODES.REPLAY, 'stored publication record conflicts with the receipt');
  }
  const targetSnapshot = requireFingerprint(value.targetSnapshot, 'stored targetSnapshot');
  if (!exactSnapshot(targetSnapshot, receipt.targetSnapshot)) {
    fail(PUBLICATION_REASON_CODES.REPLAY, 'stored publication target conflicts with the receipt');
  }
  const history = normalizeHistory(
    value.history,
    requireFingerprint(receipt.baseSnapshot, 'receipt.baseSnapshot'),
    targetSnapshot
  );
  const normalized = cloneJson(value, 'stored publication record');
  normalized.targetSnapshot = targetSnapshot;
  normalized.history = history;
  if (value.publishedAt !== undefined) {
    normalized.publishedAt = requireTimestamp(value.publishedAt, 'stored publishedAt');
  }
  return normalized;
}

function normalizeHistory(value, baseSnapshot, targetSnapshot) {
  if (!isPlainObject(value)) {
    fail(PUBLICATION_REASON_CODES.HISTORY_INVALID, 'publication history is required');
  }
  const historyId = requireIdentifier(value.historyId, 'history.historyId');
  const previousSnapshot = requireFingerprint(value.previousSnapshot, 'history.previousSnapshot');
  const publishedSnapshot = requireFingerprint(
    value.publishedSnapshot,
    'history.publishedSnapshot'
  );
  if (!exactSnapshot(previousSnapshot, baseSnapshot)) {
    fail(
      PUBLICATION_REASON_CODES.HISTORY_INVALID,
      'history previous snapshot is not the receipt base'
    );
  }
  if (!exactSnapshot(publishedSnapshot, targetSnapshot)) {
    fail(
      PUBLICATION_REASON_CODES.HISTORY_INVALID,
      'history published snapshot is not the receipt target'
    );
  }
  if (!isPlainObject(value.rollback) || value.rollback.available !== true) {
    fail(PUBLICATION_REASON_CODES.HISTORY_INVALID, 'rollback evidence is required');
  }
  const rollbackTarget = requireFingerprint(
    value.rollback.targetSnapshot,
    'history.rollback.targetSnapshot'
  );
  if (!exactSnapshot(rollbackTarget, baseSnapshot)) {
    fail(PUBLICATION_REASON_CODES.HISTORY_INVALID, 'rollback target must be the previous snapshot');
  }
  return {
    historyId,
    previousSnapshot,
    publishedSnapshot,
    rollback: { available: true, targetSnapshot: rollbackTarget },
  };
}

function normalizePublicationResult(value, receipt, baseSnapshot, targetSnapshot) {
  if (!isPlainObject(value)) {
    fail(PUBLICATION_REASON_CODES.PUBLICATION_FAILED, 'publisher returned no publication result');
  }
  const publishedSnapshot = requireFingerprint(value.snapshot, 'publication.snapshot');
  if (!exactSnapshot(publishedSnapshot, targetSnapshot)) {
    fail(
      PUBLICATION_REASON_CODES.TARGET_SNAPSHOT_MISMATCH,
      'publisher returned the wrong target snapshot'
    );
  }
  const history = normalizeHistory(value.history, baseSnapshot, targetSnapshot);
  const record = {
    kind: PUBLICATION_KIND,
    schema: PUBLICATION_SCHEMA,
    publicationId: `publication-${receipt.receiptHash}`,
    receiptHash: receipt.receiptHash,
    packageHash: receipt.packageHash,
    status: 'published',
    targetSnapshot: publishedSnapshot,
    history,
  };
  return { record: cloneJson(record, 'publication record'), history };
}

function publicationResult({ receipt, record, history, idempotent, publishedAt }) {
  return Object.freeze({
    ok: true,
    kind: PUBLICATION_KIND,
    schema: PUBLICATION_SCHEMA,
    publicationId: record.publicationId,
    receiptId: receipt.receiptId,
    receiptHash: receipt.receiptHash,
    packageHash: receipt.packageHash,
    snapshot: record.targetSnapshot,
    history,
    publishedAt,
    publication: true,
    localOnly: true,
    canPublish: false,
    idempotent,
    readOnly: false,
  });
}

/**
 * Publish an already written accepted exchange through an explicitly local,
 * atomic snapshot writer. The writer owns domain-specific materialization;
 * this boundary owns receipt binding, replay protection and fail-closed checks.
 */
function publishContributionExchange(options = {}) {
  if (!isPlainObject(options)) {
    fail(PUBLICATION_REASON_CODES.PUBLICATION_INVALID, 'options are invalid');
  }
  assertPublisher(options.snapshotPublisher);
  if (typeof options.exchangeDir !== 'string') {
    fail(PUBLICATION_REASON_CODES.PUBLICATION_INVALID, 'exchangeDir is required');
  }

  const opened = openContributionExchange({ exchangeDir: options.exchangeDir });
  const receipt = opened.receipt;
  const baseSnapshot = requireFingerprint(receipt.baseSnapshot, 'receipt.baseSnapshot');
  const targetSnapshot = requireFingerprint(receipt.targetSnapshot, 'receipt.targetSnapshot');

  const publicationId = `publication-${receipt.receiptHash}`;
  const existing = normalizeReplayRecord(
    options.snapshotPublisher.getPublication(receipt.receiptHash),
    receipt
  );
  if (existing) {
    const replayCurrent = requireFingerprint(
      options.snapshotPublisher.getCurrentSnapshot(),
      'publisher.currentSnapshot'
    );
    if (!exactSnapshot(replayCurrent, targetSnapshot)) {
      fail(PUBLICATION_REASON_CODES.REPLAY, 'replayed publication is no longer the current target');
    }
    return publicationResult({
      receipt,
      record: existing,
      history: existing.history,
      publishedAt: existing.publishedAt || null,
      idempotent: true,
    });
  }

  const current = requireFingerprint(
    options.snapshotPublisher.getCurrentSnapshot(),
    'publisher.currentSnapshot'
  );
  if (!exactSnapshot(current, baseSnapshot)) {
    fail(PUBLICATION_REASON_CODES.BASE_SNAPSHOT_STALE, 'publisher current snapshot is stale');
  }

  const publishedAt = requireTimestamp(options.publishedAt, 'publishedAt');
  let rawResult;
  try {
    rawResult = options.snapshotPublisher.publishAtomic({
      package: opened.package,
      receipt: cloneJson(receipt, 'receipt'),
      baseSnapshot,
      targetSnapshot,
      publicationId,
      publishedAt,
    });
    if (rawResult && typeof rawResult.then === 'function') {
      fail(PUBLICATION_REASON_CODES.PUBLISHER_UNSAFE, 'asynchronous publishers are not supported');
    }
  } catch (error) {
    let after;
    try {
      after = requireFingerprint(
        options.snapshotPublisher.getCurrentSnapshot(),
        'publisher.currentSnapshot'
      );
    } catch {
      after = null;
    }
    if (after && !exactSnapshot(after, baseSnapshot)) {
      fail(
        PUBLICATION_REASON_CODES.ATOMICITY_VIOLATION,
        'publisher changed the current snapshot after a failed publication'
      );
    }
    if (error instanceof ContributionPublicationError) throw error;
    fail(PUBLICATION_REASON_CODES.PUBLICATION_FAILED, 'atomic publication failed');
  }

  const normalized = normalizePublicationResult(rawResult, receipt, baseSnapshot, targetSnapshot);
  const after = requireFingerprint(
    options.snapshotPublisher.getCurrentSnapshot(),
    'publisher.currentSnapshot'
  );
  if (!exactSnapshot(after, targetSnapshot)) {
    fail(PUBLICATION_REASON_CODES.POINTER_MISMATCH, 'publisher current snapshot is not the target');
  }

  const stored = normalizeReplayRecord(
    options.snapshotPublisher.getPublication(receipt.receiptHash),
    receipt
  );
  if (!stored || stored.publicationId !== publicationId) {
    fail(PUBLICATION_REASON_CODES.REPLAY, 'publisher did not persist the publication record');
  }
  return publicationResult({
    receipt,
    record: stored,
    history: normalized.history,
    publishedAt,
    idempotent: false,
  });
}

module.exports = {
  PUBLICATION_SCHEMA,
  PUBLICATION_KIND,
  PUBLICATION_REASON_CODES,
  ContributionPublicationError,
  publishContributionExchange,
};
