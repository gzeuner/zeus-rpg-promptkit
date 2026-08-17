'use strict';

const path = require('path');
const fs = require('fs');
const { REASON_CODES } = require('../../entitlement/reasonCodes');

/**
 * Commercial trusted-root policy helpers (ZPI-09).
 * Does not scan the workspace. Validates explicit root declarations only.
 */

function redactPath(value) {
  return String(value || '')
    .replace(/[A-Za-z]:\\[^\s]+/g, '<redacted-path>')
    .replace(/\/(?:Users|home)\/[^\s]+/g, '<redacted-path>');
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Normalize and validate an explicit trusted-roots array.
 * Fail closed if missing, empty, non-absolute, non-directory, or traversal-like.
 */
function validateTrustedRoots(trustedRoots, options = {}) {
  const maxRoots = options.maxRoots == null ? 16 : Number(options.maxRoots);
  if (!Array.isArray(trustedRoots) || trustedRoots.length === 0) {
    return {
      ok: false,
      reasonCode: REASON_CODES.POLICY_DENIED,
      message: 'Explicit trustedRoots are required (no implicit workspace harvest).',
      roots: [],
    };
  }
  if (trustedRoots.length > maxRoots) {
    return {
      ok: false,
      reasonCode: REASON_CODES.POLICY_DENIED,
      message: 'Too many trusted roots for commercial resource policy.',
      roots: [],
    };
  }

  const normalized = [];
  const seen = new Set();
  for (let i = 0; i < trustedRoots.length; i += 1) {
    const entry = trustedRoots[i];
    if (!isPlainObject(entry)) {
      return {
        ok: false,
        reasonCode: REASON_CODES.POLICY_DENIED,
        message: 'Each trusted root must be an object with rootId and path.',
        roots: [],
      };
    }
    const rootId = typeof entry.rootId === 'string' ? entry.rootId.trim() : '';
    const rawPath = typeof entry.path === 'string' ? entry.path.trim() : '';
    if (!rootId || !rawPath) {
      return {
        ok: false,
        reasonCode: REASON_CODES.POLICY_DENIED,
        message: 'trusted root rootId and path are required.',
        roots: [],
      };
    }
    if (seen.has(rootId)) {
      return {
        ok: false,
        reasonCode: REASON_CODES.POLICY_DENIED,
        message: 'Duplicate trusted rootId is not allowed.',
        roots: [],
      };
    }
    seen.add(rootId);

    if (!path.isAbsolute(rawPath)) {
      return {
        ok: false,
        reasonCode: REASON_CODES.POLICY_DENIED,
        message: 'Trusted root path must be absolute.',
        roots: [],
      };
    }
    const resolved = path.resolve(rawPath);
    if (resolved.includes(`${path.sep}..${path.sep}`) || resolved.endsWith(`${path.sep}..`)) {
      return {
        ok: false,
        reasonCode: REASON_CODES.POLICY_DENIED,
        message: 'Trusted root path must not contain parent traversal.',
        roots: [],
      };
    }
    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch {
      return {
        ok: false,
        reasonCode: REASON_CODES.POLICY_DENIED,
        message: 'Trusted root path is not accessible.',
        roots: [],
      };
    }
    if (!stat.isDirectory()) {
      return {
        ok: false,
        reasonCode: REASON_CODES.POLICY_DENIED,
        message: 'Trusted root path must be a directory.',
        roots: [],
      };
    }
    normalized.push({
      rootId,
      // Never return absolute host paths in public-facing inspect results
      pathPresent: true,
      pathKind: 'directory',
    });
  }

  return {
    ok: true,
    reasonCode: REASON_CODES.AVAILABLE,
    message: null,
    roots: normalized,
    rootCount: normalized.length,
  };
}

module.exports = {
  validateTrustedRoots,
  redactPath,
};
