'use strict';

const { LIMITS, REASON_CODES } = require('./constants');

/**
 * Redact secret-like and path-like material from compiler/joblog diagnostics.
 * Never retain credentials, connection strings, absolute paths, or emails.
 */
function redactText(value) {
  return String(value || '')
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      '<redacted-key>'
    )
    .replace(
      /\b(password|passwd|pwd|secret|token|api[_-]?key|authorization|auth|credential|license|private[_-]?key|signing[_-]?key|bearer|cookie)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1=<redacted>'
    )
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]+/gi, 'bearer <redacted>')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '<redacted-endpoint>')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '<redacted-email>')
    .replace(/[A-Za-z]:[\\/][^\r\n,;]+/g, '<redacted-path>')
    .replace(/\/(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+/g, '<redacted-path>')
    .replace(/\b(?![a-f0-9]{64}\b)[A-Za-z0-9+/_-]{40,}={0,2}\b/g, '<redacted-material>')
    .replace(/\bSENTINEL_[A-Z0-9_]+\b/g, '<redacted-sentinel>');
}

function collapseWhitespace(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeMessage(message) {
  const collapsed = collapseWhitespace(redactText(message));
  if (collapsed.length <= LIMITS.maxDiagnosticMessageChars) return collapsed;
  return collapsed.slice(0, LIMITS.maxDiagnosticMessageChars);
}

/**
 * Project raw diagnostics into a bounded, redacted, stable-ordered list.
 * Fails closed if redaction cannot be proven (empty after redaction of non-empty secret-only payload is ok).
 */
function redactDiagnostics(rawDiagnostics) {
  if (rawDiagnostics == null) {
    return { ok: true, diagnostics: [] };
  }
  if (!Array.isArray(rawDiagnostics)) {
    return {
      ok: false,
      reasonCode: REASON_CODES.REDACTION_FAILED,
      message: 'diagnostics must be an array.',
    };
  }
  if (rawDiagnostics.length > LIMITS.maxDiagnostics) {
    return {
      ok: false,
      reasonCode: REASON_CODES.REDACTION_FAILED,
      message: 'diagnostics exceed bounded limit.',
    };
  }

  const out = [];
  for (let index = 0; index < rawDiagnostics.length; index += 1) {
    const entry = rawDiagnostics[index];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return {
        ok: false,
        reasonCode: REASON_CODES.REDACTION_FAILED,
        message: 'diagnostic entry must be an object.',
      };
    }
    const severity = String(entry.severity || 'info').toLowerCase();
    const id = String(entry.id || `D${index + 1}`).slice(0, 64);
    const message = normalizeMessage(entry.message || entry.text || '');
    const source = normalizeMessage(entry.source || entry.member || '');
    // Fail closed if unredacted secret-like markers remain.
    const joined = `${message} ${source}`;
    if (
      /password\s*=\s*(?!<redacted>)\S+/i.test(joined) ||
      /BEGIN [A-Z ]*PRIVATE KEY/i.test(joined) ||
      /https?:\/\//i.test(joined)
    ) {
      return {
        ok: false,
        reasonCode: REASON_CODES.REDACTION_FAILED,
        message: 'diagnostic redaction failed closed.',
      };
    }
    out.push({
      id,
      severity: ['blocking', 'error', 'warning', 'info'].includes(severity) ? severity : 'info',
      message,
      source,
      line: Number.isInteger(entry.line) && entry.line > 0 ? entry.line : null,
    });
  }

  out.sort((a, b) => {
    const left = `${a.severity}|${a.id}|${a.source}|${a.line || 0}|${a.message}`;
    const right = `${b.severity}|${b.id}|${b.source}|${b.line || 0}|${b.message}`;
    return left.localeCompare(right);
  });

  return { ok: true, diagnostics: out };
}

module.exports = {
  redactText,
  normalizeMessage,
  redactDiagnostics,
};
