'use strict';

const { DEFAULT_LIMITS, CONTENT_HASH_ALGORITHMS } = require('./constants');

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function push(errors, path, message) {
  errors.push({ path, message });
}

function requireObject(errors, value, path = '') {
  if (!isPlainObject(value)) {
    push(errors, path, 'expected an object');
    return false;
  }
  return true;
}

function requireNonEmptyString(errors, value, path, { maxChars = DEFAULT_LIMITS.maxIdChars } = {}) {
  if (typeof value !== 'string' || !value.trim()) {
    push(errors, path, 'non-empty string is required');
    return false;
  }
  if (value.length > maxChars) {
    push(errors, path, `exceeds max length ${maxChars}`);
    return false;
  }
  return true;
}

function optionalString(errors, value, path, { maxChars = DEFAULT_LIMITS.maxNameChars } = {}) {
  if (value == null) return true;
  if (typeof value !== 'string') {
    push(errors, path, 'must be a string when present');
    return false;
  }
  if (value.length > maxChars) {
    push(errors, path, `exceeds max length ${maxChars}`);
    return false;
  }
  return true;
}

function requireClosedEnum(errors, value, path, allowed, label = 'value') {
  if (typeof value !== 'string' || !value.trim()) {
    push(errors, path, `${label} is required`);
    return false;
  }
  const set = Array.isArray(allowed) ? allowed : Object.values(allowed);
  if (!set.includes(value)) {
    push(errors, path, `${label} must be one of: ${set.join(', ')}`);
    return false;
  }
  return true;
}

function requireSchemaVersion(errors, value, expected = 1) {
  if (Number(value) !== expected) {
    push(errors, '/schemaVersion', `expected ${expected}, got ${value}`);
    return false;
  }
  return true;
}

function requireKind(errors, value, expectedKind) {
  if (value != null && value !== expectedKind) {
    push(errors, '/kind', `kind must be "${expectedKind}" when present`);
    return false;
  }
  return true;
}

function requireContractId(errors, value, expectedId) {
  if (value != null && value !== expectedId) {
    push(errors, '/contractId', `contractId must be "${expectedId}" when present`);
    return false;
  }
  return true;
}

/**
 * Relative project paths only. Absolute, drive, UNC, traversal, and control
 * characters are refused (fail-closed).
 */
function isSafeRelativePath(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  if (value.length > DEFAULT_LIMITS.maxPathChars) return false;
  if (value.includes('\0') || /[\u0001-\u001f]/.test(value)) return false;
  if (value.startsWith('/') || value.startsWith('\\')) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return false;
  if (value.startsWith('\\\\') || value.startsWith('//')) return false;
  const parts = value.split(/[\\/]+/);
  if (parts.some(part => part === '..')) return false;
  return true;
}

function requireSafeRelativePath(errors, value, path) {
  if (typeof value !== 'string' || !value.trim()) {
    push(errors, path, 'relative path is required');
    return false;
  }
  if (!isSafeRelativePath(value)) {
    push(errors, path, 'path must be relative and safe (no absolute, drive, UNC, or traversal)');
    return false;
  }
  return true;
}

function isSha256Hex(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function requireContentHash(errors, value, path) {
  if (!isSha256Hex(value)) {
    push(errors, path, 'content hash must be lowercase sha256 hex (64 chars)');
    return false;
  }
  return true;
}

function requirePositiveInteger(errors, value, path) {
  if (!Number.isInteger(value) || value < 1) {
    push(errors, path, 'positive integer is required');
    return false;
  }
  return true;
}

function optionalNonNegativeInteger(errors, value, path) {
  if (value == null) return true;
  if (!Number.isInteger(value) || value < 0) {
    push(errors, path, 'must be a non-negative integer when present');
    return false;
  }
  return true;
}

function requireArray(errors, value, path, { maxItems = DEFAULT_LIMITS.maxArrayItems } = {}) {
  if (!Array.isArray(value)) {
    push(errors, path, 'must be an array');
    return false;
  }
  if (value.length > maxItems) {
    push(errors, path, `exceeds max items ${maxItems}`);
    return false;
  }
  return true;
}

function optionalArray(errors, value, path, { maxItems = DEFAULT_LIMITS.maxArrayItems } = {}) {
  if (value == null) return true;
  return requireArray(errors, value, path, { maxItems });
}

function requireBoolean(errors, value, path) {
  if (typeof value !== 'boolean') {
    push(errors, path, 'boolean is required');
    return false;
  }
  return true;
}

function requireHashAlgorithm(errors, value, path) {
  if (value == null) return true;
  return requireClosedEnum(errors, value, path, CONTENT_HASH_ALGORITHMS, 'hash algorithm');
}

/**
 * Required derivation provenance (ADR-011).
 * sourceHash is the content hash of the primary source unit(s) used.
 */
function validateProvenance(errors, provenance, basePath = '/provenance') {
  if (!requireObject(errors, provenance, basePath)) return false;
  let ok = true;
  ok = requireNonEmptyString(errors, provenance.projectId, `${basePath}/projectId`) && ok;
  ok = requireNonEmptyString(errors, provenance.snapshotId, `${basePath}/snapshotId`) && ok;
  ok = requireContentHash(errors, provenance.sourceHash, `${basePath}/sourceHash`) && ok;
  ok = requireNonEmptyString(errors, provenance.analyzerId, `${basePath}/analyzerId`) && ok;
  ok =
    requireNonEmptyString(errors, provenance.analyzerVersion, `${basePath}/analyzerVersion`) && ok;
  if (typeof provenance.derivationClass !== 'string' || !provenance.derivationClass.trim()) {
    push(errors, `${basePath}/derivationClass`, 'derivationClass is required');
    ok = false;
  }
  return ok;
}

function validateEvidenceReference(errors, ref, basePath) {
  if (!requireObject(errors, ref, basePath)) return;
  requireNonEmptyString(errors, ref.id, `${basePath}/id`);
  if (ref.kind != null) {
    optionalString(errors, ref.kind, `${basePath}/kind`, { maxChars: DEFAULT_LIMITS.maxIdChars });
  }
  if (ref.contractId != null) {
    optionalString(errors, ref.contractId, `${basePath}/contractId`, {
      maxChars: DEFAULT_LIMITS.maxIdChars,
    });
  }
}

function validateLinePosition(errors, value, basePath, { required = true } = {}) {
  if (value == null) {
    if (required) push(errors, basePath, 'position object is required');
    return;
  }
  if (!requireObject(errors, value, basePath)) return;
  if (!Number.isInteger(value.line) || value.line < 1) {
    push(errors, `${basePath}/line`, 'line must be a positive integer');
  }
  optionalNonNegativeInteger(errors, value.column, `${basePath}/column`);
  optionalNonNegativeInteger(errors, value.offset, `${basePath}/offset`);
}

module.exports = {
  isPlainObject,
  push,
  requireObject,
  requireNonEmptyString,
  optionalString,
  requireClosedEnum,
  requireSchemaVersion,
  requireKind,
  requireContractId,
  isSafeRelativePath,
  requireSafeRelativePath,
  isSha256Hex,
  requireContentHash,
  requirePositiveInteger,
  optionalNonNegativeInteger,
  requireArray,
  optionalArray,
  requireBoolean,
  requireHashAlgorithm,
  validateProvenance,
  validateEvidenceReference,
  validateLinePosition,
};
