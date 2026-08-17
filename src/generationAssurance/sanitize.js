'use strict';

const { redactText, sanitizeDiagnosticPath } = require('./canonicalDiagnostics');
const { LIMITS } = require('./constants');

const SENSITIVE_KEY =
  /(?:password|passwd|pwd|secret|token|api[_-]?key|authorization|auth|credential|private[_-]?key|license|signing|endpoint|customer)/i;

function isPlainObject(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Recursively sanitize structured values for history, reports, results, and artifacts.
 * Redacts secrets, license material, absolute paths, and raw exception-like payloads.
 */
function sanitizeValue(value, depth = 0) {
  if (depth > 12) return null;
  if (value == null) return value;
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    return null;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 512).map(item => sanitizeValue(item, depth + 1));
  }
  if (!isPlainObject(value) && !(value && typeof value === 'object')) {
    return null;
  }
  // Defensive: only plain-data object projection
  const out = {};
  let keys;
  try {
    keys = Object.keys(value);
  } catch {
    return null;
  }
  keys.sort();
  for (const key of keys) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
    if (SENSITIVE_KEY.test(key)) {
      out[key] = '<redacted>';
      continue;
    }
    let child;
    try {
      child = value[key];
    } catch {
      out[key] = '<redacted>';
      continue;
    }
    // Drop raw Error objects / stack traces
    if (child instanceof Error) {
      out[key] = {
        name: redactText(child.name || 'Error'),
        message: 'redacted',
      };
      continue;
    }
    out[key] = sanitizeValue(child, depth + 1);
  }
  return out;
}

/**
 * Produce a safe validation-report projection (never raw).
 */
function sanitizeValidationReport(report) {
  if (!report || typeof report !== 'object') {
    return {
      schemaVersion: 1,
      kind: 'generation-validation-report',
      candidateId: '',
      status: 'invalid',
      reviewReady: false,
      diagnostics: [],
      summary: 'missing report',
    };
  }
  const sanitized = sanitizeValue(report) || {};
  let sourceDiagnostics = [];
  try {
    sourceDiagnostics = Array.isArray(report.diagnostics) ? report.diagnostics : [];
  } catch {
    sourceDiagnostics = [];
  }
  const diagnostics = Array.isArray(sanitized.diagnostics)
    ? sanitized.diagnostics.slice(0, LIMITS.maxDiagnostics).map((d, index) => {
        let sourcePath = d && d.path;
        try {
          if (sourceDiagnostics[index] && sourceDiagnostics[index].path != null) {
            sourcePath = sourceDiagnostics[index].path;
          }
        } catch {
          sourcePath = d && d.path;
        }
        return {
          id: String((d && d.id) || 'UNKNOWN'),
          severity: String((d && d.severity) || 'info'),
          validatorId: String((d && d.validatorId) || 'unknown'),
          validatorVersion:
            Number.isInteger(d && d.validatorVersion) && d.validatorVersion > 0
              ? d.validatorVersion
              : 1,
          path: sourcePath != null ? sanitizeDiagnosticPath(sourcePath) : null,
          message: redactText(String((d && d.message) || '')),
        };
      })
    : [];
  return {
    schemaVersion: 1,
    kind: 'generation-validation-report',
    contractId: sanitized.contractId || 'zeus.generation-validation-report',
    contractVersion: 1,
    candidateId: String(sanitized.candidateId || ''),
    status: String(sanitized.status || 'invalid'),
    reviewReady: sanitized.reviewReady === true,
    diagnostics,
    evidenceChecked: Array.isArray(sanitized.evidenceChecked)
      ? sanitized.evidenceChecked.slice(0, LIMITS.maxEvidenceReferences)
      : [],
    assumptions: Array.isArray(sanitized.assumptions) ? sanitized.assumptions.slice(0, 32) : [],
    uncertainties: Array.isArray(sanitized.uncertainties)
      ? sanitized.uncertainties.slice(0, 32)
      : [],
    policy:
      sanitized.policy && typeof sanitized.policy === 'object'
        ? sanitized.policy
        : { denied: false, reason: null },
    summary: redactText(String(sanitized.summary || '')),
    notes: Array.isArray(sanitized.notes)
      ? sanitized.notes.map(n => redactText(String(n))).slice(0, 16)
      : [
          'review-ready means structural/policy validation passed only.',
          'It does not mean compiled, functionally correct, IBM i tested, approved, or deployable.',
        ],
  };
}

/**
 * UTF-8 byte-accurate truncation (never mid-code-unit in the sense of invalid UTF-8 output).
 */
function truncateUtf8Bytes(text, maxBytes) {
  const input = String(text || '');
  const buf = Buffer.from(input, 'utf8');
  if (buf.length <= maxBytes) return input;
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
  return buf.slice(0, end).toString('utf8');
}

module.exports = {
  sanitizeValue,
  sanitizeValidationReport,
  truncateUtf8Bytes,
};
