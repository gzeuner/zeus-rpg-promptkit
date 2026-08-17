'use strict';

/**
 * Conservative synthetic-literal policy for manual/code expression values.
 * Technical identifiers (e.g. column CUSTOMER_ID) are never inspected here —
 * only literal payloads from the CHECK/manual parser.
 *
 * Trust boundary residual: callers must set literalsAreSynthetic:true for any
 * rule that contains a literal of any kind. That declaration is an attestation
 * the engine cannot independently prove for arbitrary neutral values; it is
 * mandatory together with the closed lexical string policy below.
 */

const SENSITIVE_RE = Object.freeze([
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/, // controls except TAB
  /\r|\n/, // CR/LF
  /\bREAL[-_]/i,
  /\bCUSTOMER\b/i,
  /\bPERSON\b/i,
  /\bACCOUNT\b/i,
  /\bORGANIZATION\b/i,
  /\bORG\b/i,
  /@/, // email-like
  /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/, // SSN-like
  /\b\+?\d[\d\s().-]{7,}\d\b/, // phone-like
  // Compact obvious customer/account/person/org tokens (no raw echo on reject).
  /\bCUST[-_]?\d/i,
  /\bACCT[-_]?\d/i,
  /\bACCOUNT[-_]?\d/i,
  /\bPERSON[-_]?\d/i,
  /\bORG(?:ANIZATION)?[-_]?\d/i,
]);

/** Literal kinds produced by the conservative CHECK/manual parser. */
const AST_LITERAL_KINDS = Object.freeze(
  new Set(['string', 'number', 'date', 'time', 'timestamp', 'null'])
);

/**
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function assessStringLiteral(value) {
  if (typeof value !== 'string') {
    return { ok: false, reason: 'non-string-literal' };
  }
  if (value.length > 128) {
    return { ok: false, reason: 'literal-oversize' };
  }
  for (let i = 0; i < SENSITIVE_RE.length; i += 1) {
    if (SENSITIVE_RE[i].test(value)) {
      return { ok: false, reason: 'literal-policy' };
    }
  }
  return { ok: true };
}

/**
 * Scan derived assignment map for string literals (sensitive-content policy).
 */
function scanAssignmentsForLiterals(assignments) {
  const keys = Object.keys(assignments || {});
  for (let i = 0; i < keys.length; i += 1) {
    const v = assignments[keys[i]];
    if (v == null) continue;
    if (typeof v === 'object' && v.kind === 'string') {
      const check = assessStringLiteral(v.value);
      if (!check.ok) return check;
    }
  }
  return { ok: true };
}

/**
 * Detect whether a parsed AST contains any literal of any supported kind
 * (numeric, string, DATE, TIME, TIMESTAMP, NULL) including list/between leaves.
 */
function astHasAnyLiteral(ast) {
  if (!ast || typeof ast !== 'object') return false;
  if (ast.type === 'literal') {
    if (ast.kind == null || AST_LITERAL_KINDS.has(ast.kind)) return true;
  }
  const keys = Object.keys(ast);
  for (let i = 0; i < keys.length; i += 1) {
    const child = ast[keys[i]];
    if (Array.isArray(child)) {
      for (let j = 0; j < child.length; j += 1) {
        if (astHasAnyLiteral(child[j])) return true;
      }
    } else if (child && typeof child === 'object') {
      if (astHasAnyLiteral(child)) return true;
    }
  }
  return false;
}

module.exports = {
  assessStringLiteral,
  scanAssignmentsForLiterals,
  astHasAnyLiteral,
  /** @deprecated alias — prefer astHasAnyLiteral */
  astHasStringLiteral: astHasAnyLiteral,
  AST_LITERAL_KINDS,
};
