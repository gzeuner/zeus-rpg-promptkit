'use strict';

/**
 * Minimal semver utilities for moduleApi ranges used by module descriptors.
 * Supports forms: "1.0.0", ">=1.0.0 <2.0.0", "^1.2.3", "~1.2.3".
 * Fail closed on unparseable input.
 */

function parseVersion(raw) {
  const m = String(raw || '')
    .trim()
    .match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
  };
}

function cmp(a, b) {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

function satisfiesComparator(version, op, bound) {
  const c = cmp(version, bound);
  switch (op) {
    case '>=':
      return c >= 0;
    case '>':
      return c > 0;
    case '<=':
      return c <= 0;
    case '<':
      return c < 0;
    case '=':
    case '==':
      return c === 0;
    default:
      return false;
  }
}

function expandCaret(v) {
  if (v.major > 0) return { low: v, high: { major: v.major + 1, minor: 0, patch: 0 } };
  if (v.minor > 0) return { low: v, high: { major: 0, minor: v.minor + 1, patch: 0 } };
  return { low: v, high: { major: 0, minor: 0, patch: v.patch + 1 } };
}

function expandTilde(v) {
  return { low: v, high: { major: v.major, minor: v.minor + 1, patch: 0 } };
}

/**
 * @param {string} versionStr
 * @param {string} rangeStr
 */
function satisfies(versionStr, rangeStr) {
  const version = parseVersion(versionStr);
  const range = String(rangeStr || '').trim();
  if (!version || !range) return false;

  if (/^\d+\.\d+\.\d+/.test(range) && !/[\s^~<>]/.test(range)) {
    const exact = parseVersion(range);
    return exact ? cmp(version, exact) === 0 : false;
  }

  if (range.startsWith('^')) {
    const base = parseVersion(range.slice(1));
    if (!base) return false;
    const { low, high } = expandCaret(base);
    return cmp(version, low) >= 0 && cmp(version, high) < 0;
  }
  if (range.startsWith('~')) {
    const base = parseVersion(range.slice(1));
    if (!base) return false;
    const { low, high } = expandTilde(base);
    return cmp(version, low) >= 0 && cmp(version, high) < 0;
  }

  const tokens = range.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const m = token.match(/^(>=|>|<=|<|=|==)?\s*(\d+\.\d+\.\d+(?:[-+].*)?)$/);
    if (!m) return false;
    const op = m[1] || '=';
    const bound = parseVersion(m[2]);
    if (!bound || !satisfiesComparator(version, op, bound)) return false;
  }
  return true;
}

module.exports = {
  parseVersion,
  satisfies,
};
