'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  CONTRIBUTION_STATUSES,
  canonicalJson,
  openContributionPackage,
  sha256Hex,
} = require('./contributionPackage');
const { validateContributionPackage } = require('./contributionValidation');

const STAGING_KIND = 'knowledge-contribution-staging';
const STAGING_SCHEMA = 'knowledge.contribution-staging@1';
const STAGING_LAYOUT = Object.freeze({
  packages: 'packages',
  records: 'records',
  locks: 'locks',
  lock: path.join('locks', 'staging.lock'),
});
const STAGING_REASON_CODES = Object.freeze({
  STAGED: 'FKX.STAGE_ACCEPTED',
  IDEMPOTENT: 'FKX.STAGE_IDEMPOTENT',
  VALIDATION_FAILED: 'FKX.STAGE_VALIDATION_FAILED',
  CONFLICT: 'FKX.STAGE_CONFLICT',
  PACKAGE_CORRUPT: 'FKX.STAGED_PACKAGE_CORRUPT',
  RECORD_CORRUPT: 'FKX.STAGING_RECORD_CORRUPT',
  WRITER_CONFLICT: 'FKX.STAGING_WRITER_CONFLICT',
  LOCK_FAILED: 'FKX.STAGING_LOCK_FAILED',
  LIFECYCLE_REJECTED: 'FKX.STAGE_LIFECYCLE_REJECTED',
  TRANSITIONED: 'FKX.STAGE_TRANSITIONED',
  CLEANUP_DRY_RUN_REQUIRED: 'FKX.CLEANUP_DRY_RUN_REQUIRED',
  CLEANUP_PERMISSION_REQUIRED: 'FKX.CLEANUP_PERMISSION_REQUIRED',
  CLEANUP_PLAN_INVALID: 'FKX.CLEANUP_PLAN_INVALID',
  CLEANUP_PLAN_STALE: 'FKX.CLEANUP_PLAN_STALE',
  CLEANUP_COMPLETED: 'FKX.CLEANUP_COMPLETED',
});
const STAGING_STATUSES = Object.freeze([...CONTRIBUTION_STATUSES]);
const LIFECYCLE_TRANSITIONS = Object.freeze({
  proposed: Object.freeze(['accepted', 'rejected', 'superseded']),
  accepted: Object.freeze(['superseded']),
  rejected: Object.freeze([]),
  superseded: Object.freeze([]),
});
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REASON_CODE_PATTERN = /^FKX\.[A-Z0-9_.-]+$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

class ContributionStagingError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ContributionStagingError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details = undefined) {
  throw new ContributionStagingError(code, message, details);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireAbsoluteDirectory(value, field = 'stagingRoot') {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    fail('FKX.PATH_UNSAFE', `${field} must be an absolute path`);
  }
  return path.resolve(value);
}

function resolveStagingRoot(options = {}) {
  return requireAbsoluteDirectory(
    options.stagingRoot || options.root || options.directory,
    'stagingRoot'
  );
}

function getStagingPaths(stagingRoot) {
  const root = requireAbsoluteDirectory(stagingRoot);
  const paths = {
    root,
    packages: path.join(root, STAGING_LAYOUT.packages),
    records: path.join(root, STAGING_LAYOUT.records),
    locks: path.join(root, STAGING_LAYOUT.locks),
    lock: path.join(root, STAGING_LAYOUT.lock),
  };
  for (const value of Object.values(paths)) {
    const relative = path.relative(root, value);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      fail('FKX.PATH_UNSAFE', 'staging path escaped its root');
    }
  }
  return Object.freeze(paths);
}

function isSha256(value) {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function pathSafeId(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('FKX.PATH_UNSAFE', 'identifier is required');
  }
  const normalized = value.trim();
  if (CONTROL_CHARACTER_PATTERN.test(normalized)) {
    fail('FKX.PATH_UNSAFE', 'identifier contains a control character');
  }
  return `id-${sha256Hex(normalized)}`;
}

function relativePath(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const value = path.relative(resolvedRoot, resolvedTarget);
  if (!value || value.startsWith('..') || path.isAbsolute(value)) {
    fail('FKX.PATH_UNSAFE', 'staging path is outside the staging root');
  }
  return value.split(path.sep).join('/');
}

function safeText(value, field, fallback) {
  const normalized = value === undefined ? fallback : value;
  if (typeof normalized !== 'string' || normalized.trim() === '') {
    fail('FKX.STAGING_RECORD_CORRUPT', `${field} is required`);
  }
  const result = normalized.trim();
  if (CONTROL_CHARACTER_PATTERN.test(result) || result.includes('\n') || result.includes('\r')) {
    fail('FKX.STAGING_RECORD_CORRUPT', `${field} contains unsupported characters`);
  }
  return result;
}

function normalizeReasonCode(value, fallback) {
  const result = safeText(value, 'reasonCode', fallback);
  if (!REASON_CODE_PATTERN.test(result)) {
    fail('FKX.STAGING_RECORD_CORRUPT', 'reasonCode is invalid');
  }
  return result;
}

function normalizeTimestamp(value, field = 'at') {
  const candidate = value === undefined ? new Date() : value;
  const date = candidate instanceof Date ? candidate : new Date(candidate);
  if (!Number.isFinite(date.getTime())) fail('FKX.STAGING_RECORD_CORRUPT', `${field} is invalid`);
  return date.toISOString();
}

function timestampValue(options, field = 'now') {
  const value = typeof options[field] === 'function' ? options[field]() : options[field];
  return normalizeTimestamp(value, field);
}

function packageFiles(contribution) {
  if (!isPlainObject(contribution) || !isPlainObject(contribution.manifest)) {
    fail(STAGING_REASON_CODES.PACKAGE_CORRUPT, 'contribution package is invalid');
  }
  if (!isPlainObject(contribution.payload)) {
    fail(STAGING_REASON_CODES.PACKAGE_CORRUPT, 'contribution payload is invalid');
  }
  const payload = `${canonicalJson(contribution.payload)}\n`;
  const manifest = `${canonicalJson(contribution.manifest)}\n`;
  const packageHash = contribution.manifest.packageHash;
  const payloadHash = sha256Hex(payload);
  const { manifestHash, packageHash: manifestPackageHash, ...manifestCore } = contribution.manifest;
  const expectedManifestHash = sha256Hex(`${canonicalJson(manifestCore)}\n`);
  const expectedPackageHash = sha256Hex(`${expectedManifestHash}:${payloadHash}`);
  if (
    !isSha256(packageHash) ||
    packageHash !== manifestPackageHash ||
    contribution.manifest.files?.['payload.json'] !== payloadHash ||
    manifestHash !== expectedManifestHash ||
    packageHash !== expectedPackageHash
  ) {
    fail(STAGING_REASON_CODES.PACKAGE_CORRUPT, 'contribution package hash is invalid');
  }
  if (!manifest.endsWith('\n')) {
    fail(STAGING_REASON_CODES.PACKAGE_CORRUPT, 'contribution package bytes are invalid');
  }
  return Object.freeze({
    manifest,
    payload,
    packageHash,
    contributionId: contribution.manifest.contributionId,
  });
}

function readJsonFile(filePath, code, message) {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile()) fail(code, message);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error instanceof ContributionStagingError) throw error;
    fail(code, message);
  }
}

function writeAtomic(filePath, body) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporaryPath, 'wx');
    fs.writeFileSync(descriptor, body, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // The descriptor is closed during recovery when necessary.
      }
    }
    try {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    } catch {
      // Temporary files do not affect the committed state.
    }
    throw error;
  }
}

function writePackageAtomically(paths, files) {
  const packagePath = path.join(paths.packages, files.packageHash);
  const temporaryPath = path.join(
    paths.packages,
    `.tmp-${files.packageHash}-${process.pid}-${crypto.randomBytes(8).toString('hex')}`
  );
  fs.mkdirSync(paths.packages, { recursive: true });
  if (fs.existsSync(packagePath)) {
    try {
      const opened = openContributionPackage({ packageDir: packagePath });
      if (
        opened.contributionId !== files.contributionId ||
        opened.hashes.packageHash !== files.packageHash
      ) {
        fail(STAGING_REASON_CODES.PACKAGE_CORRUPT, 'staged package identity does not match');
      }
      return { path: packagePath, created: false };
    } catch (error) {
      if (error instanceof ContributionStagingError) throw error;
      fail(STAGING_REASON_CODES.PACKAGE_CORRUPT, 'staged package bytes are invalid');
    }
  }

  try {
    fs.mkdirSync(temporaryPath);
    writeAtomic(path.join(temporaryPath, 'manifest.json'), files.manifest);
    writeAtomic(path.join(temporaryPath, 'payload.json'), files.payload);
    fs.renameSync(temporaryPath, packagePath);
    return { path: packagePath, created: true };
  } catch (error) {
    try {
      if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { recursive: true, force: true });
    } catch {
      // Temporary package cleanup is best effort.
    }
    if (error instanceof ContributionStagingError) throw error;
    fail(STAGING_REASON_CODES.PACKAGE_CORRUPT, 'staged package could not be written', {
      cause: error.code,
    });
  }
}

function recordPath(paths, contributionId) {
  return path.join(paths.records, `${pathSafeId(contributionId)}.json`);
}

function validateHistory(history, packageHash) {
  if (!Array.isArray(history) || history.length === 0) return false;
  return history.every(entry => {
    return (
      isPlainObject(entry) &&
      Object.keys(entry).every(key =>
        ['status', 'actor', 'at', 'packageHash', 'reasonCode'].includes(key)
      ) &&
      STAGING_STATUSES.includes(entry.status) &&
      typeof entry.actor === 'string' &&
      entry.actor.length > 0 &&
      typeof entry.at === 'string' &&
      isSha256(entry.packageHash) &&
      entry.packageHash === packageHash &&
      typeof entry.reasonCode === 'string' &&
      REASON_CODE_PATTERN.test(entry.reasonCode)
    );
  });
}

function parseRecord(filePath, paths) {
  const record = readJsonFile(
    filePath,
    STAGING_REASON_CODES.RECORD_CORRUPT,
    'staging record is unreadable'
  );
  let canonical;
  try {
    canonical = `${canonicalJson(record)}\n`;
  } catch {
    fail(STAGING_REASON_CODES.RECORD_CORRUPT, 'staging record is not canonical JSON');
  }
  try {
    if (fs.readFileSync(filePath, 'utf8') !== canonical) {
      fail(STAGING_REASON_CODES.RECORD_CORRUPT, 'staging record is not canonical JSON');
    }
  } catch (error) {
    if (error instanceof ContributionStagingError) throw error;
    fail(STAGING_REASON_CODES.RECORD_CORRUPT, 'staging record is unreadable');
  }
  const expectedKeys = [
    'kind',
    'schema',
    'contributionId',
    'contributionKey',
    'packageHash',
    'packagePath',
    'packageStatus',
    'status',
    'history',
    'stagedAt',
    'updatedAt',
    'publication',
  ];
  const valid =
    isPlainObject(record) &&
    Object.keys(record).length === expectedKeys.length &&
    expectedKeys.every(key => Object.prototype.hasOwnProperty.call(record, key)) &&
    record.kind === STAGING_KIND &&
    record.schema === STAGING_SCHEMA &&
    typeof record.contributionId === 'string' &&
    record.contributionId.length > 0 &&
    record.contributionKey === pathSafeId(record.contributionId) &&
    isSha256(record.packageHash) &&
    record.packagePath ===
      relativePath(paths.root, path.join(paths.packages, record.packageHash)) &&
    STAGING_STATUSES.includes(record.packageStatus) &&
    STAGING_STATUSES.includes(record.status) &&
    validateHistory(record.history, record.packageHash) &&
    typeof record.stagedAt === 'string' &&
    typeof record.updatedAt === 'string' &&
    record.publication === 'none';
  if (!valid) fail(STAGING_REASON_CODES.RECORD_CORRUPT, 'staging record is invalid');
  const expectedRecordPath = recordPath(paths, record.contributionId);
  if (path.resolve(filePath) !== path.resolve(expectedRecordPath)) {
    fail(STAGING_REASON_CODES.RECORD_CORRUPT, 'staging record path is invalid');
  }
  return Object.freeze(record);
}

function readRecordAt(filePath, paths) {
  if (!fs.existsSync(filePath)) return null;
  return parseRecord(filePath, paths);
}

function findRecord(paths, { contributionId, packageHash } = {}) {
  if (contributionId !== undefined) {
    const direct = readRecordAt(recordPath(paths, contributionId), paths);
    if (direct) return { record: direct, path: recordPath(paths, contributionId) };
  }
  if (!fs.existsSync(paths.records)) return null;
  const entries = fs
    .readdirSync(paths.records)
    .filter(entry => entry.endsWith('.json'))
    .sort();
  for (const entry of entries) {
    const filePath = path.join(paths.records, entry);
    const record = readRecordAt(filePath, paths);
    if (
      record &&
      (contributionId === undefined || record.contributionId === contributionId) &&
      (packageHash === undefined || record.packageHash === packageHash)
    ) {
      return { record, path: filePath };
    }
  }
  return null;
}

function readStagedPackage(paths, record) {
  const packagePath = path.join(paths.packages, record.packageHash);
  try {
    const contribution = openContributionPackage({ packageDir: packagePath });
    if (
      contribution.contributionId !== record.contributionId ||
      contribution.hashes.packageHash !== record.packageHash
    ) {
      fail(STAGING_REASON_CODES.PACKAGE_CORRUPT, 'staged package identity does not match');
    }
    return contribution;
  } catch (error) {
    if (error instanceof ContributionStagingError) throw error;
    fail(STAGING_REASON_CODES.PACKAGE_CORRUPT, 'staged package bytes are invalid');
  }
}

function acquireWriterScope(paths) {
  fs.mkdirSync(paths.root, { recursive: true });
  fs.mkdirSync(paths.packages, { recursive: true });
  fs.mkdirSync(paths.records, { recursive: true });
  fs.mkdirSync(paths.locks, { recursive: true });
  const token = crypto.randomBytes(12).toString('hex');
  let descriptor;
  try {
    descriptor = fs.openSync(paths.lock, 'wx');
    fs.writeFileSync(
      descriptor,
      `${canonicalJson({ token, pid: process.pid, acquiredAt: new Date().toISOString() })}\n`,
      'utf8'
    );
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // The descriptor is closed during recovery when necessary.
      }
    }
    if (error && error.code === 'EEXIST') {
      fail(STAGING_REASON_CODES.WRITER_CONFLICT, 'staging writer scope is already held');
    }
    fail(STAGING_REASON_CODES.LOCK_FAILED, 'staging writer scope could not be acquired', {
      cause: error && error.code,
    });
  }

  return {
    release() {
      let current;
      try {
        current = JSON.parse(fs.readFileSync(paths.lock, 'utf8'));
      } catch {
        fail(STAGING_REASON_CODES.LOCK_FAILED, 'staging writer scope is unreadable');
      }
      if (current.token !== token)
        fail(STAGING_REASON_CODES.LOCK_FAILED, 'staging writer token mismatch');
      fs.unlinkSync(paths.lock);
    },
  };
}

function withWriterScope(paths, callback) {
  const lock = acquireWriterScope(paths);
  try {
    return callback();
  } finally {
    lock.release();
  }
}

function loadCandidate(options) {
  const hasDirectory = typeof options.packageDir === 'string';
  const source = options.package || options.contribution;
  if (!hasDirectory && !isPlainObject(source)) {
    fail(STAGING_REASON_CODES.PACKAGE_CORRUPT, 'packageDir or package is required');
  }
  const validationInput = hasDirectory
    ? { packageDir: options.packageDir, policy: options.policy }
    : { package: source, policy: options.policy };
  const validation = validateContributionPackage(validationInput);
  if (!validation.canStage) {
    fail(STAGING_REASON_CODES.VALIDATION_FAILED, 'contribution package is not staging-ready', {
      reasonCodes: validation.reasonCodes,
      validation,
    });
  }
  const contribution = hasDirectory
    ? openContributionPackage({ packageDir: options.packageDir })
    : source;
  const files = packageFiles(contribution);
  return Object.freeze({ contribution, files, validation });
}

function buildHistoryEntry(status, packageHash, options, fallbackReason) {
  return Object.freeze({
    status,
    actor: safeText(options.actor, 'actor', 'local-actor'),
    at: timestampValue(options),
    packageHash,
    reasonCode: normalizeReasonCode(options.reasonCode, fallbackReason),
  });
}

function buildRecord(paths, files, options) {
  const event = buildHistoryEntry(
    files.contributionStatus,
    files.packageHash,
    options,
    STAGING_REASON_CODES.STAGED
  );
  const at = event.at;
  return Object.freeze({
    kind: STAGING_KIND,
    schema: STAGING_SCHEMA,
    contributionId: files.contributionId,
    contributionKey: pathSafeId(files.contributionId),
    packageHash: files.packageHash,
    packagePath: relativePath(paths.root, path.join(paths.packages, files.packageHash)),
    packageStatus: files.contributionStatus,
    status: files.contributionStatus,
    history: Object.freeze([event]),
    stagedAt: at,
    updatedAt: at,
    publication: 'none',
  });
}

function serializeRecord(record) {
  return `${canonicalJson(record)}\n`;
}

function resultFor(record, paths, validation, operation, idempotent = false) {
  return Object.freeze({
    ok: true,
    operation,
    idempotent,
    contributionId: record.contributionId,
    packageHash: record.packageHash,
    status: record.status,
    lifecycleStatus: record.status,
    historyLength: record.history.length,
    recordPath: relativePath(paths.root, recordPath(paths, record.contributionId)),
    packagePath: record.packagePath,
    publication: false,
    validation,
  });
}

function stageContributionPackage(options = {}) {
  if (!isPlainObject(options)) fail(STAGING_REASON_CODES.PACKAGE_CORRUPT, 'options are invalid');
  const paths = getStagingPaths(resolveStagingRoot(options));
  const candidate = loadCandidate(options);
  const contributionStatus = candidate.contribution.manifest.status;
  const files = Object.freeze({ ...candidate.files, contributionStatus });

  return withWriterScope(paths, () => {
    const existing = findRecord(paths, { contributionId: files.contributionId });
    if (existing && existing.record.packageHash !== files.packageHash) {
      fail(
        STAGING_REASON_CODES.CONFLICT,
        'contribution identity already points to another package',
        {
          contributionId: files.contributionId,
          existingPackageHash: existing.record.packageHash,
          packageHash: files.packageHash,
        }
      );
    }
    if (existing) {
      readStagedPackage(paths, existing.record);
      return resultFor(existing.record, paths, candidate.validation, 'idempotent', true);
    }

    const packageResult = writePackageAtomically(paths, files);
    const record = buildRecord(paths, files, options);
    const target = recordPath(paths, record.contributionId);
    writeAtomic(target, serializeRecord(record));
    return Object.freeze({
      ...resultFor(record, paths, candidate.validation, 'staged', false),
      packageCreated: packageResult.created,
    });
  });
}

function resolveRecordForRead(paths, options) {
  if (!isPlainObject(options)) fail(STAGING_REASON_CODES.RECORD_CORRUPT, 'options are invalid');
  const found = findRecord(paths, {
    contributionId: options.contributionId,
    packageHash: options.packageHash,
  });
  if (!found) fail(STAGING_REASON_CODES.RECORD_CORRUPT, 'staged contribution was not found');
  return found;
}

function readStagedContribution(options = {}) {
  const paths = getStagingPaths(resolveStagingRoot(options));
  const found = resolveRecordForRead(paths, options);
  const contribution = readStagedPackage(paths, found.record);
  return Object.freeze({
    ok: true,
    contributionId: found.record.contributionId,
    packageHash: found.record.packageHash,
    status: found.record.status,
    lifecycleStatus: found.record.status,
    record: found.record,
    package: contribution,
    recordPath: relativePath(paths.root, found.path),
    packagePath: found.record.packagePath,
    publication: false,
  });
}

function transitionStagedContribution(options = {}) {
  if (!isPlainObject(options)) fail(STAGING_REASON_CODES.RECORD_CORRUPT, 'options are invalid');
  const paths = getStagingPaths(resolveStagingRoot(options));
  const targetStatus = options.targetStatus || options.status;
  if (!STAGING_STATUSES.includes(targetStatus)) {
    fail(STAGING_REASON_CODES.LIFECYCLE_REJECTED, 'target status is unsupported');
  }

  return withWriterScope(paths, () => {
    const found = resolveRecordForRead(paths, options);
    const current = found.record;
    readStagedPackage(paths, current);
    if (current.status === targetStatus) {
      return Object.freeze({
        ...resultFor(current, paths, undefined, 'idempotent-transition', true),
        reasonCode: STAGING_REASON_CODES.IDEMPOTENT,
      });
    }
    if (!LIFECYCLE_TRANSITIONS[current.status].includes(targetStatus)) {
      fail(STAGING_REASON_CODES.LIFECYCLE_REJECTED, 'lifecycle transition is not permitted', {
        from: current.status,
        to: targetStatus,
      });
    }
    const event = buildHistoryEntry(
      targetStatus,
      current.packageHash,
      options,
      STAGING_REASON_CODES.TRANSITIONED
    );
    const next = Object.freeze({
      ...current,
      status: targetStatus,
      history: Object.freeze([...current.history, event]),
      updatedAt: event.at,
      publication: 'none',
    });
    writeAtomic(found.path, serializeRecord(next));
    return Object.freeze({
      ...resultFor(next, paths, undefined, 'transitioned', false),
      reasonCode: STAGING_REASON_CODES.TRANSITIONED,
    });
  });
}

function listStagedContributions(options = {}) {
  const paths = getStagingPaths(resolveStagingRoot(options));
  if (!fs.existsSync(paths.records)) return Object.freeze([]);
  const records = fs
    .readdirSync(paths.records)
    .filter(entry => entry.endsWith('.json'))
    .sort()
    .map(entry => parseRecord(path.join(paths.records, entry), paths));
  return Object.freeze(records);
}

function cleanupCutoff(options) {
  if (options.olderThan !== undefined) return normalizeTimestamp(options.olderThan, 'olderThan');
  if (options.before !== undefined) return normalizeTimestamp(options.before, 'before');
  if (options.maxAgeMs !== undefined) {
    if (!Number.isFinite(options.maxAgeMs) || options.maxAgeMs < 0) {
      fail(STAGING_REASON_CODES.CLEANUP_PLAN_INVALID, 'maxAgeMs is invalid');
    }
    return new Date(Date.now() - options.maxAgeMs).toISOString();
  }
  return new Date().toISOString();
}

function cleanupStatuses(value) {
  const statuses = value === undefined ? ['rejected', 'superseded'] : value;
  if (!Array.isArray(statuses) || statuses.length === 0) {
    fail(STAGING_REASON_CODES.CLEANUP_PLAN_INVALID, 'cleanup statuses are invalid');
  }
  const normalized = [...new Set(statuses)];
  if (normalized.some(status => !STAGING_STATUSES.includes(status))) {
    fail(STAGING_REASON_CODES.CLEANUP_PLAN_INVALID, 'cleanup status is unsupported');
  }
  return normalized.sort();
}

function buildCleanupPlan(options = {}) {
  const paths = getStagingPaths(resolveStagingRoot(options));
  const cutoff = cleanupCutoff(options);
  const statuses = cleanupStatuses(options.statuses);
  const cutoffMs = Date.parse(cutoff);
  const candidates = listStagedContributions({ stagingRoot: paths.root })
    .filter(record => statuses.includes(record.status) && Date.parse(record.updatedAt) <= cutoffMs)
    .map(record => ({
      contributionId: record.contributionId,
      packageHash: record.packageHash,
      status: record.status,
      recordPath: recordPath(paths, record.contributionId),
      packagePath: path.join(paths.packages, record.packageHash),
    }))
    .map(candidate => ({
      ...candidate,
      recordPath: relativePath(paths.root, candidate.recordPath),
      packagePath: relativePath(paths.root, candidate.packagePath),
    }));
  const identity = { kind: STAGING_KIND, schema: STAGING_SCHEMA, cutoff, statuses, candidates };
  return Object.freeze({
    kind: STAGING_KIND,
    schema: STAGING_SCHEMA,
    dryRun: true,
    generatedAt: new Date().toISOString(),
    cutoff,
    statuses: Object.freeze(statuses),
    candidates: Object.freeze(candidates),
    planHash: sha256Hex(`${canonicalJson(identity)}\n`),
  });
}

function planStagingCleanup(options = {}) {
  return buildCleanupPlan(options);
}

function cleanupStagedContributions(options = {}) {
  if (!isPlainObject(options))
    fail(STAGING_REASON_CODES.CLEANUP_PLAN_INVALID, 'options are invalid');
  if (options.dryRun === true && options.plan === undefined) {
    return buildCleanupPlan(options);
  }
  const plan = options.plan;
  if (!isPlainObject(plan) || plan.dryRun !== true || !isSha256(plan.planHash)) {
    fail(STAGING_REASON_CODES.CLEANUP_DRY_RUN_REQUIRED, 'a dry-run cleanup plan is required');
  }
  if (options.permission !== true && options.allowDelete !== true) {
    fail(
      STAGING_REASON_CODES.CLEANUP_PERMISSION_REQUIRED,
      'explicit cleanup permission is required'
    );
  }
  const paths = getStagingPaths(resolveStagingRoot(options));
  return withWriterScope(paths, () => {
    const currentPlan = buildCleanupPlan({
      stagingRoot: paths.root,
      olderThan: plan.cutoff,
      statuses: plan.statuses,
    });
    if (currentPlan.planHash !== plan.planHash) {
      fail(STAGING_REASON_CODES.CLEANUP_PLAN_STALE, 'cleanup plan no longer matches staged state');
    }
    const deleted = [];
    for (const candidate of currentPlan.candidates) {
      const found = findRecord(paths, { contributionId: candidate.contributionId });
      if (!found || found.record.packageHash !== candidate.packageHash) {
        fail(STAGING_REASON_CODES.CLEANUP_PLAN_STALE, 'cleanup candidate changed');
      }
      const packagePath = path.join(paths.packages, candidate.packageHash);
      const recordFile = recordPath(paths, candidate.contributionId);
      fs.rmSync(packagePath, { recursive: true, force: false });
      fs.unlinkSync(recordFile);
      deleted.push({
        contributionId: candidate.contributionId,
        packageHash: candidate.packageHash,
      });
    }
    return Object.freeze({
      ok: true,
      reasonCode: STAGING_REASON_CODES.CLEANUP_COMPLETED,
      deleted: Object.freeze(deleted),
      planHash: plan.planHash,
      publication: false,
    });
  });
}

function cleanupStaging(options = {}) {
  return cleanupStagedContributions(options);
}

module.exports = {
  STAGING_KIND,
  STAGING_SCHEMA,
  STAGING_LAYOUT,
  STAGING_REASON_CODES,
  STAGING_STATUSES,
  LIFECYCLE_TRANSITIONS,
  ContributionStagingError,
  pathSafeId,
  toPathSafeId: pathSafeId,
  getStagingPaths,
  stageContributionPackage,
  readStagedContribution,
  inspectStagedContribution: readStagedContribution,
  transitionStagedContribution,
  listStagedContributions,
  planStagingCleanup,
  cleanupStagedContributions,
  cleanupStaging,
};
