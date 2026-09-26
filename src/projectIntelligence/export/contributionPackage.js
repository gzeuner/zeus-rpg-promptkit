'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DERIVATION_CLASSES } = require('../constants');
const { isSha256Hex } = require('../helpers');

const CONTRIBUTION_PACKAGE_SCHEMA = 'knowledge.contribution@1';
const CONTRIBUTION_PACKAGE_KIND = 'knowledge-contribution';
const CONTRIBUTION_PACKAGE_FILES = Object.freeze({
  manifest: 'manifest.json',
  payload: 'payload.json',
});
const CONTRIBUTION_PACKAGE_MAX_FILE_BYTES = 4 * 1024 * 1024;
const CONTRIBUTION_STATUSES = Object.freeze(['proposed', 'accepted', 'rejected', 'superseded']);
const CONTRIBUTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CONTRACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SENSITIVE_KEY_PATTERN =
  /(?:password|passwd|pwd|secret|token|api[_-]?key|authorization|credential|private[_-]?key|access[_-]?key|cookie)/i;
const RAW_SOURCE_KEY_PATTERN =
  /^(?:raw|raw[_-]?(?:source|content|text|data)|source[_-]?(?:text|content|code|data)|credentials?)$/i;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]|^\\\\/;
const UNIX_ABSOLUTE_PATH_PATTERN = /^\//;
const URI_PATH_PATTERN = /^(?:file|unc):\/\//i;
const PATH_LIKE_KEY_PATTERN =
  /^(?:path|file|filename|sourcepath|relativepath|absolutepath|realpath|host|hostname|url|uri)$/i;
const PROMPT_OR_MODEL_KEY_PATTERN =
  /^(?:prompt|rawprompt|inputtext|outputtext|response|rawresponse|modeloutput|completion|bytes)$/i;
const AUTHORITY_KEY_PATTERN = /^(?:sourceoftruth|advisory)$/i;
const SECRET_VALUE_PATTERN =
  /\b(?:password|passwd|pwd|secret|token|api[_-]?key|authorization|credential)\s*[:=]/i;
const PRIVATE_KEY_VALUE_PATTERN = /-----BEGIN [^-]*PRIVATE KEY-----/i;
const DISCLOSURE_VALUE_PATTERN =
  /(?:https?:\/\/|file:\/\/|jdbc:|(?:^|[\s"'(])\.\.(?:[\\/]|$)|(?:^|[\s"'(])(?:[A-Za-z]:[\\/]|\\\\|\/[A-Za-z0-9_.-]+[\\/]))/i;

class ContributionPackageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ContributionPackageError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ContributionPackageError(code, message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isAbsolutePath(value) {
  return (
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(value) ||
    UNIX_ABSOLUTE_PATH_PATTERN.test(value) ||
    URI_PATH_PATTERN.test(value)
  );
}

function assertSafeKey(key, valuePath, rejectSensitiveKeys) {
  if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
    fail('JSON_VALUE_INVALID', `${valuePath}/${key} is not allowed`);
  }
  if (!rejectSensitiveKeys) return;
  if (
    SENSITIVE_KEY_PATTERN.test(key) ||
    RAW_SOURCE_KEY_PATTERN.test(key) ||
    PATH_LIKE_KEY_PATTERN.test(key) ||
    PROMPT_OR_MODEL_KEY_PATTERN.test(key) ||
    AUTHORITY_KEY_PATTERN.test(key)
  ) {
    fail('PAYLOAD_UNSAFE', `${valuePath}/${key} is not allowed in a contribution package`);
  }
}

function assertJsonValue(value, valuePath, { rejectSensitiveKeys = false } = {}) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    if (typeof value === 'string' && isAbsolutePath(value)) {
      fail('PAYLOAD_UNSAFE', `${valuePath} must not contain an absolute path`);
    }
    if (
      typeof value === 'string' &&
      rejectSensitiveKeys &&
      (SECRET_VALUE_PATTERN.test(value) ||
        PRIVATE_KEY_VALUE_PATTERN.test(value) ||
        DISCLOSURE_VALUE_PATTERN.test(value))
    ) {
      fail('PAYLOAD_UNSAFE', `${valuePath} contains a disallowed disclosure pattern`);
    }
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('JSON_VALUE_INVALID', `${valuePath} must contain finite numbers`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        fail('JSON_VALUE_INVALID', `${valuePath}/${index} must not be sparse`);
      }
      assertJsonValue(value[index], `${valuePath}/${index}`, { rejectSensitiveKeys });
    }
    return;
  }
  if (!isPlainObject(value)) {
    fail('JSON_VALUE_INVALID', `${valuePath} must contain plain JSON data`);
  }
  for (const key of Object.keys(value)) {
    assertSafeKey(key, valuePath, rejectSensitiveKeys);
    assertJsonValue(value[key], `${valuePath}/${key}`, { rejectSensitiveKeys });
  }
}

function canonicalJson(value, options = {}) {
  assertJsonValue(value, '$', options);
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(entry => canonicalJson(entry, options)).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key], options)}`)
    .join(',')}}`;
}

function canonicalizeContribution(value) {
  return canonicalJson(value);
}

function cloneJsonValue(value, options = {}) {
  return JSON.parse(canonicalJson(value, options));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    fail('CONTRIBUTION_INVALID', `${field} is required`);
  }
  if (isAbsolutePath(value.trim())) {
    fail('PAYLOAD_UNSAFE', `${field} must not be an absolute path`);
  }
  return value.trim();
}

function requireIdentifier(value, field) {
  const normalized = requireString(value, field);
  if (!CONTRIBUTION_ID_PATTERN.test(normalized)) {
    fail('CONTRIBUTION_INVALID', `${field} has an invalid identifier`);
  }
  return normalized;
}

function normalizeBaseSnapshot(value) {
  if (!isPlainObject(value)) fail('CONTRIBUTION_INVALID', 'baseSnapshot is required');
  if (Object.keys(value).some(key => !['snapshotId', 'contentHash'].includes(key))) {
    fail('CONTRIBUTION_INVALID', 'baseSnapshot contains unsupported fields');
  }
  const snapshot = { snapshotId: requireString(value.snapshotId, 'baseSnapshot.snapshotId') };
  if (value.contentHash !== undefined) {
    if (!isSha256Hex(value.contentHash)) {
      fail('CONTRIBUTION_INVALID', 'baseSnapshot.contentHash must be lowercase sha256 hex');
    }
    snapshot.contentHash = value.contentHash;
  }
  return snapshot;
}

function normalizeContractVersions(value) {
  if (!isPlainObject(value) || Object.keys(value).length === 0) {
    fail('CONTRIBUTION_INVALID', 'contractVersions must be a non-empty object');
  }
  const versions = {};
  for (const key of Object.keys(value).sort()) {
    if (!CONTRACT_ID_PATTERN.test(key)) {
      fail('CONTRIBUTION_INVALID', 'contractVersions contains an invalid contract name');
    }
    versions[key] = requireString(value[key], `contractVersions.${key}`);
  }
  return versions;
}

function normalizeEvidenceReferences(value, derivationClass) {
  if (!Array.isArray(value)) fail('CONTRIBUTION_INVALID', 'evidenceReferences must be an array');
  if (derivationClass === DERIVATION_CLASSES.VERIFIED && value.length === 0) {
    fail('VERIFIED_EVIDENCE_REQUIRED', 'VERIFIED contributions require evidenceReferences');
  }
  return value.map((reference, index) => {
    if (
      !isPlainObject(reference) ||
      Object.keys(reference).some(key => !['id', 'contract'].includes(key))
    ) {
      fail('CONTRIBUTION_INVALID', `evidenceReferences/${index} is invalid`);
    }
    return {
      id: requireString(reference.id, `evidenceReferences/${index}.id`),
      contract: requireString(reference.contract, `evidenceReferences/${index}.contract`),
    };
  });
}

function normalizeReport(value, field) {
  if (!isPlainObject(value)) fail('CONTRIBUTION_INVALID', `${field} is required`);
  return cloneJsonValue(value, { rejectSensitiveKeys: true });
}

function createContributionPackage(options = {}) {
  if (!isPlainObject(options)) fail('CONTRIBUTION_INVALID', 'options must be a plain object');
  if (options.advisory !== undefined && options.advisory !== true) {
    fail('CONTRIBUTION_INVALID', 'advisory must be true');
  }
  if (options.sourceOfTruth !== undefined && options.sourceOfTruth !== false) {
    fail('CONTRIBUTION_INVALID', 'sourceOfTruth must be false');
  }

  const contributionId = requireIdentifier(options.contributionId, 'contributionId');
  const originInstanceId = requireIdentifier(options.originInstanceId, 'originInstanceId');
  const baseSnapshot = normalizeBaseSnapshot(options.baseSnapshot);
  const contractVersions = normalizeContractVersions(options.contractVersions);
  const derivationClass = requireString(options.derivationClass, 'derivationClass');
  if (!Object.values(DERIVATION_CLASSES).includes(derivationClass)) {
    fail('CONTRIBUTION_INVALID', 'derivationClass is unsupported');
  }
  const status =
    options.status === undefined ? 'proposed' : requireString(options.status, 'status');
  if (!CONTRIBUTION_STATUSES.includes(status)) {
    fail('CONTRIBUTION_INVALID', 'status is unsupported');
  }

  const payloadInput = options.payload;
  if (!isPlainObject(payloadInput)) fail('CONTRIBUTION_INVALID', 'payload must be a plain object');
  const payload = cloneJsonValue(payloadInput, { rejectSensitiveKeys: true });

  const evidenceReferences = normalizeEvidenceReferences(
    options.evidenceReferences === undefined ? [] : options.evidenceReferences,
    derivationClass
  );
  const provenance = normalizeReport(options.provenance, 'provenance');
  const privacyReport = normalizeReport(options.privacyReport, 'privacyReport');
  const qualityReport = normalizeReport(options.qualityReport, 'qualityReport');

  const payloadBody = `${canonicalJson(payload, { rejectSensitiveKeys: true })}\n`;
  const payloadHash = sha256Hex(payloadBody);
  const manifestCore = {
    kind: CONTRIBUTION_PACKAGE_KIND,
    schema: CONTRIBUTION_PACKAGE_SCHEMA,
    contributionId,
    originInstanceId,
    baseSnapshot,
    contractVersions,
    derivationClass,
    evidenceReferences,
    provenance,
    privacyReport,
    qualityReport,
    status,
    advisory: true,
    sourceOfTruth: false,
    files: { [CONTRIBUTION_PACKAGE_FILES.payload]: payloadHash },
  };
  if (options.createdAt !== undefined) {
    manifestCore.createdAt = requireString(options.createdAt, 'createdAt');
  }

  const manifestHash = sha256Hex(`${canonicalJson(manifestCore)}\n`);
  const packageHash = sha256Hex(`${manifestHash}:${payloadHash}`);
  const manifest = { ...manifestCore, manifestHash, packageHash };
  const manifestBody = `${canonicalJson(manifest)}\n`;

  return Object.freeze({
    ok: true,
    kind: CONTRIBUTION_PACKAGE_KIND,
    schema: CONTRIBUTION_PACKAGE_SCHEMA,
    contributionId,
    payload: deepFreeze(payload),
    manifest: deepFreeze(manifest),
    hashes: Object.freeze({ payloadHash, manifestHash, packageHash }),
    files: Object.freeze({
      [CONTRIBUTION_PACKAGE_FILES.manifest]: manifestBody,
      [CONTRIBUTION_PACKAGE_FILES.payload]: payloadBody,
    }),
  });
}

function requireAbsoluteDirectory(packageDir) {
  if (typeof packageDir !== 'string' || !path.isAbsolute(packageDir)) {
    fail('PACKAGE_PATH_UNSAFE', 'packageDir must be an absolute path');
  }
  return packageDir;
}

function assertPackageDirectoryShape(packageDir, { allowMissing = false } = {}) {
  if (!fs.existsSync(packageDir)) {
    if (allowMissing) return;
    fail('PACKAGE_INVALID', 'package directory is missing');
  }
  const packageStat = fs.lstatSync(packageDir);
  if (!packageStat.isDirectory()) {
    fail('PACKAGE_INVALID', 'package path must be a directory');
  }
  const entries = fs.readdirSync(packageDir).sort();
  const allowed = [CONTRIBUTION_PACKAGE_FILES.manifest, CONTRIBUTION_PACKAGE_FILES.payload].sort();
  if (entries.some(entry => !allowed.includes(entry))) {
    fail('PACKAGE_INVALID', 'package directory contains unsupported files');
  }
  for (const entry of entries) {
    const entryPath = path.join(packageDir, entry);
    const entryStat = fs.lstatSync(entryPath);
    if (!entryStat.isFile()) fail('PACKAGE_INVALID', `${entry} must be a regular file`);
    if (entryStat.size > CONTRIBUTION_PACKAGE_MAX_FILE_BYTES) {
      fail('PACKAGE_INVALID', `${entry} exceeds the package file size limit`);
    }
  }
}

function writeAtomic(filePath, body) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(temporaryPath, body, 'utf8');
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    } catch {
      // Best-effort cleanup only.
    }
    throw error;
  }
}

function writeContributionPackage(options = {}) {
  const packageDir = requireAbsoluteDirectory(options.packageDir);
  const contribution = createContributionPackage(options);
  fs.mkdirSync(packageDir, { recursive: true });
  assertPackageDirectoryShape(packageDir);
  writeAtomic(
    path.join(packageDir, CONTRIBUTION_PACKAGE_FILES.payload),
    contribution.files[CONTRIBUTION_PACKAGE_FILES.payload]
  );
  writeAtomic(
    path.join(packageDir, CONTRIBUTION_PACKAGE_FILES.manifest),
    contribution.files[CONTRIBUTION_PACKAGE_FILES.manifest]
  );
  return Object.freeze({
    ok: true,
    kind: contribution.kind,
    schema: contribution.schema,
    contributionId: contribution.contributionId,
    hashes: contribution.hashes,
    files: [CONTRIBUTION_PACKAGE_FILES.manifest, CONTRIBUTION_PACKAGE_FILES.payload],
  });
}

function readJson(filePath, field) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    fail('PACKAGE_INVALID', `${field} is unreadable`);
  }
}

function openContributionPackage(options = {}) {
  const packageDir = requireAbsoluteDirectory(options.packageDir);
  assertPackageDirectoryShape(packageDir);
  const manifestPath = path.join(packageDir, CONTRIBUTION_PACKAGE_FILES.manifest);
  const payloadPath = path.join(packageDir, CONTRIBUTION_PACKAGE_FILES.payload);
  const manifest = readJson(manifestPath, CONTRIBUTION_PACKAGE_FILES.manifest);
  const payload = readJson(payloadPath, CONTRIBUTION_PACKAGE_FILES.payload);

  if (
    manifest.kind !== CONTRIBUTION_PACKAGE_KIND ||
    manifest.schema !== CONTRIBUTION_PACKAGE_SCHEMA
  ) {
    fail('SCHEMA_UNSUPPORTED', 'unsupported contribution package schema');
  }

  const expected = createContributionPackage({ ...manifest, payload });
  const manifestBody = fs.readFileSync(manifestPath, 'utf8');
  const payloadBody = fs.readFileSync(payloadPath, 'utf8');
  if (payloadBody !== expected.files[CONTRIBUTION_PACKAGE_FILES.payload]) {
    fail('CONTENT_HASH_MISMATCH', 'payload.json is not canonically serialized or has changed');
  }
  if (manifestBody !== expected.files[CONTRIBUTION_PACKAGE_FILES.manifest]) {
    fail('CONTENT_HASH_MISMATCH', 'manifest.json is not canonically serialized or has changed');
  }

  return Object.freeze({
    ok: true,
    kind: expected.kind,
    schema: expected.schema,
    contributionId: expected.contributionId,
    payload: expected.payload,
    manifest: expected.manifest,
    hashes: expected.hashes,
  });
}

module.exports = {
  CONTRIBUTION_PACKAGE_SCHEMA,
  CONTRIBUTION_PACKAGE_KIND,
  CONTRIBUTION_PACKAGE_FILES,
  CONTRIBUTION_PACKAGE_MAX_FILE_BYTES,
  CONTRIBUTION_STATUSES,
  ContributionPackageError,
  canonicalJson,
  canonicalizeContribution,
  cloneJsonValue,
  sha256Hex,
  createContributionPackage,
  writeContributionPackage,
  openContributionPackage,
};
