'use strict';

const crypto = require('node:crypto');
const { STATUS_RANK, SEVERITY_RANK, LIMITS } = require('./constants');

// Community generation contracts use these top-level JSON Pointer fields in
// diagnostics. An arbitrary leading slash is not sufficient to distinguish a
// JSON Pointer from an absolute POSIX path, so keep this allow-list narrow.
const CONTRACT_JSON_POINTER_ROOTS = new Set([
  'schemaVersion',
  'kind',
  'contract',
  'contractId',
  'contractVersion',
  'candidateId',
  'taskSummary',
  'evidenceReferences',
  'assumptions',
  'uncertainties',
  'proposedFiles',
  'correlationId',
  'status',
  'reviewReady',
  'diagnostics',
  'evidenceChecked',
  'policy',
  'summary',
  'notes',
]);
const CONTRACT_JSON_POINTER_ARRAY_FIELDS = new Map([
  ['proposedFiles', new Set(['path', 'action', 'language', 'content', 'rationale'])],
  ['evidenceReferences', new Set(['id', 'kind', 'contract', 'path'])],
  ['evidenceChecked', new Set(['id', 'kind', 'contract', 'path'])],
  [
    'diagnostics',
    new Set(['id', 'severity', 'validatorId', 'validatorVersion', 'path', 'message']),
  ],
  ['assumptions', new Set()],
  ['uncertainties', new Set()],
  ['notes', new Set()],
]);

/**
 * Redact secret-like and path-like material from diagnostic text.
 * Shared redaction for requests, history, and artifacts.
 * No secret sentinel, license material, private endpoint, or local absolute path survives.
 */
function redactText(value) {
  return (
    String(value || '')
      .replace(
        /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
        '<redacted-key>'
      )
      .replace(
        /(["'])(password|passwd|pwd|secret|token|api[_-]?key|authorization|auth|credential|license|private[_-]?key|signing[_-]?key|bearer|cookie)\1\s*:\s*(["'])[^"'\r\n]*\3/gi,
        '$1$2$1:$3<redacted>$3'
      )
      .replace(
        /\b(password|passwd|pwd|secret|token|api[_-]?key|authorization|auth|credential|license|private[_-]?key|signing[_-]?key|bearer|cookie)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
        '$1=<redacted>'
      )
      .replace(/\bbearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'bearer <redacted>')
      .replace(/\b(?:endpoint|url|uri|host)\s*[:=]\s*\S+/gi, '$1=<redacted>')
      .replace(/https?:\/\/[^\s"'<>]+/gi, '<redacted-endpoint>')
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '<redacted-email>')
      .replace(/(["'])[A-Za-z]:[\\/][^\r\n]*?\1/g, '<redacted-path>')
      .replace(/(["'])\\\\[^\r\n]*?\1/g, '<redacted-unc>')
      .replace(/[A-Za-z]:[\\/][^\r\n,;]+/g, '<redacted-path>')
      .replace(/(["'])\/(?:[^"'\r\n]+)\1/g, '<redacted-path>')
      .replace(/\/(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+/g, '<redacted-path>')
      .replace(/\\\\[^\r\n,;]+/g, '<redacted-unc>')
      // Long opaque material, but preserve pure hex digests (e.g. SHA-256 content fingerprints).
      .replace(/\b(?![a-f0-9]{64}\b)[A-Za-z0-9+/_-]{40,}={0,2}\b/g, '<redacted-material>')
      .replace(/\bSENTINEL_[A-Z0-9_]+\b/g, '<redacted-sentinel>')
  );
}

function collapseWhitespace(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeMessage(message) {
  const redacted = redactText(message);
  const collapsed = collapseWhitespace(redacted);
  if (collapsed.length <= LIMITS.maxNormalizedMessageChars) return collapsed;
  return collapsed.slice(0, LIMITS.maxNormalizedMessageChars);
}

function normalizePath(pathValue) {
  if (pathValue == null || pathValue === '') return '';
  const raw = String(pathValue).trim();
  if (/^(?:file:\/\/|[A-Za-z]:[\\/]|\\\\|\/)/i.test(raw)) {
    return redactedPathToken(raw);
  }
  return raw
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/')
    .trim();
}

function redactedPathToken(rawPath) {
  const digest = crypto.createHash('sha256').update(String(rawPath), 'utf8').digest('hex');
  return `<redacted-path:${digest}>`;
}

function isContractJsonPointer(raw) {
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return false;
  const segments = raw.slice(1).split('/');
  if (segments.length === 0 || !CONTRACT_JSON_POINTER_ROOTS.has(segments[0])) return false;
  if (segments.length === 1) return true;
  if (segments[0] === 'policy') {
    return segments.length === 2 && (segments[1] === 'denied' || segments[1] === 'reason');
  }
  const fields = CONTRACT_JSON_POINTER_ARRAY_FIELDS.get(segments[0]);
  if (!fields || !/^(?:0|[1-9][0-9]*|-)$/.test(segments[1])) return false;
  if (segments.length === 2) return true;
  return segments.length === 3 && fields.has(segments[2]);
}

/**
 * Sanitize a diagnostic path without collapsing Community JSON Pointers.
 * Clear filesystem absolutes are replaced by deterministic, non-reversible
 * tokens so distinct diagnostics cannot acquire identical fingerprints.
 */
function sanitizeDiagnosticPath(pathValue) {
  if (pathValue == null || pathValue === '') return '';
  let raw;
  try {
    raw = String(pathValue).trim();
  } catch {
    return '<redacted-path:invalid>';
  }
  if (isContractJsonPointer(raw)) return raw;
  return normalizePath(raw);
}

function severityRank(severity) {
  const key = String(severity || 'info');
  return Object.prototype.hasOwnProperty.call(SEVERITY_RANK, key) ? SEVERITY_RANK[key] : 3;
}

function statusRank(status) {
  const key = String(status || 'invalid');
  return Object.prototype.hasOwnProperty.call(STATUS_RANK, key) ? STATUS_RANK[key] : 99;
}

/**
 * Canonical diagnostic key after redaction/bounds:
 * severityRank|id|validatorId|validatorVersion|normalizedPath|normalizedMessage
 */
function toCanonicalEntry(diagnostic) {
  const severity = String(diagnostic && diagnostic.severity ? diagnostic.severity : 'info');
  const id = String(diagnostic && diagnostic.id ? diagnostic.id : 'UNKNOWN');
  const validatorId = String(
    diagnostic && diagnostic.validatorId ? diagnostic.validatorId : 'unknown'
  );
  const validatorVersion = Number(diagnostic && diagnostic.validatorVersion);
  const version = Number.isInteger(validatorVersion) && validatorVersion > 0 ? validatorVersion : 1;
  const pathNorm = sanitizeDiagnosticPath(diagnostic && diagnostic.path);
  const message = normalizeMessage(diagnostic && diagnostic.message);
  const key = `${severityRank(severity)}|${id}|${validatorId}|${version}|${pathNorm}|${message}`;
  return {
    severityRank: severityRank(severity),
    id,
    validatorId,
    validatorVersion: version,
    normalizedPath: pathNorm,
    normalizedMessage: message,
    key,
  };
}

function compareCanonical(a, b) {
  return (
    a.severityRank - b.severityRank ||
    a.id.localeCompare(b.id) ||
    a.validatorId.localeCompare(b.validatorId) ||
    a.validatorVersion - b.validatorVersion ||
    a.normalizedPath.localeCompare(b.normalizedPath) ||
    a.normalizedMessage.localeCompare(b.normalizedMessage)
  );
}

/**
 * Build sorted canonical diagnostic records and SHA-256 fingerprint of the JSON array.
 */
function canonicalizeDiagnostics(diagnostics) {
  const list = Array.isArray(diagnostics) ? diagnostics : [];
  if (list.length > LIMITS.maxDiagnostics) {
    return {
      ok: false,
      code: 'DIAGNOSTICS_LIMIT_EXCEEDED',
      canonical: [],
      fingerprint: null,
    };
  }
  const canonical = list.map(toCanonicalEntry).sort(compareCanonical);
  const payload = canonical.map(entry => ({
    severityRank: entry.severityRank,
    id: entry.id,
    validatorId: entry.validatorId,
    validatorVersion: entry.validatorVersion,
    normalizedPath: entry.normalizedPath,
    normalizedMessage: entry.normalizedMessage,
  }));
  const json = JSON.stringify(payload);
  const fingerprint = crypto.createHash('sha256').update(json, 'utf8').digest('hex');
  return { ok: true, canonical: payload, fingerprint, json };
}

/**
 * Quality vector: [statusRank, blockingCount, errorCount, warningCount, infoCount, totalDiagnosticCount]
 * Lower is better. Do not use fingerprint alone as semantic improvement.
 */
function buildQualityVector(status, diagnostics) {
  const list = Array.isArray(diagnostics) ? diagnostics : [];
  let blockingCount = 0;
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  for (const d of list) {
    const severity = String(d && d.severity ? d.severity : 'info');
    if (severity === 'blocking') blockingCount += 1;
    else if (severity === 'error') errorCount += 1;
    else if (severity === 'warning') warningCount += 1;
    else infoCount += 1;
  }
  return Object.freeze([
    statusRank(status),
    blockingCount,
    errorCount,
    warningCount,
    infoCount,
    list.length,
  ]);
}

/**
 * Compare quality vectors lexicographically. Negative => next is better.
 */
function compareQualityVectors(previous, next) {
  const a = previous || [];
  const b = next || [];
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const left = Number(a[i] || 0);
    const right = Number(b[i] || 0);
    if (left < right) return -1; // previous better / next worse
    if (left > right) return 1; // next better
  }
  return 0;
}

/**
 * Decide stop disposition between consecutive attempts.
 * @returns {{ kind: 'identical'|'worsening'|'changed-not-improved'|'improved'|'same-ready' }}
 */
function classifyProgress({ previousFingerprint, nextFingerprint, previousVector, nextVector }) {
  if (previousFingerprint && nextFingerprint && previousFingerprint === nextFingerprint) {
    return { kind: 'identical' };
  }
  const cmp = compareQualityVectors(previousVector, nextVector);
  if (cmp < 0) {
    // previous better than next => worsening
    return { kind: 'worsening' };
  }
  if (cmp === 0) {
    if (previousFingerprint !== nextFingerprint) {
      return { kind: 'changed-not-improved' };
    }
    return { kind: 'identical' };
  }
  return { kind: 'improved' };
}

module.exports = {
  redactText,
  normalizeMessage,
  normalizePath,
  sanitizeDiagnosticPath,
  severityRank,
  statusRank,
  toCanonicalEntry,
  canonicalizeDiagnostics,
  buildQualityVector,
  compareQualityVectors,
  classifyProgress,
};
