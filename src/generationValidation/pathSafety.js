'use strict';

const path = require('path');
const fs = require('fs');

const WINDOWS_RESERVED = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

/**
 * Normalize a candidate relative path for comparison (posix separators, no leading ./).
 */
function normalizeRelativePath(input) {
  return String(input || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/');
}

function hasControlOrNul(value) {
  return /[\u0000-\u001f\u007f]/.test(String(value || ''));
}

function isUncPath(value) {
  return /^[\\/]{2}/.test(String(value || ''));
}

function isWindowsDrivePath(value) {
  return /^[A-Za-z]:[\\/]/.test(String(value || ''));
}

function hasWindowsReservedName(relativePosix) {
  const parts = relativePosix.split('/').filter(Boolean);
  return parts.some(part => {
    const base = part.split('.')[0].toUpperCase();
    return WINDOWS_RESERVED.has(base);
  });
}

/**
 * Validate that a declared target path is workspace-relative and inside allowed roots.
 * Uses path.resolve + relative containment — never prefix-only matching.
 *
 * @returns {{ ok: true, relativePath: string, absolutePath: string } | { ok: false, code: string, message: string }}
 */
function validateWorkspacePath(rawPath, options = {}) {
  const { workspaceRoot, allowedRelativeRoots = ['.'], allowAbsolute = false } = options;

  if (rawPath == null || typeof rawPath !== 'string' || !rawPath.trim()) {
    return { ok: false, code: 'empty', message: 'path is required' };
  }
  if (hasControlOrNul(rawPath)) {
    return { ok: false, code: 'control', message: 'path contains control characters or NUL' };
  }
  if (isUncPath(rawPath)) {
    return { ok: false, code: 'unc', message: 'UNC paths are not allowed' };
  }
  if (isWindowsDrivePath(rawPath)) {
    return { ok: false, code: 'drive', message: 'Windows drive-absolute paths are not allowed' };
  }
  if (rawPath.startsWith('/') || rawPath.startsWith('\\')) {
    if (!allowAbsolute) {
      return { ok: false, code: 'absolute', message: 'absolute paths are not allowed' };
    }
  }

  const posix = normalizeRelativePath(rawPath);
  if (!posix || posix === '.' || posix === '..') {
    return { ok: false, code: 'empty', message: 'path is empty after normalization' };
  }
  if (posix.split('/').includes('..')) {
    return { ok: false, code: 'traversal', message: 'parent traversal is not allowed' };
  }
  if (hasWindowsReservedName(posix)) {
    return { ok: false, code: 'reserved', message: 'Windows reserved device name is not allowed' };
  }

  if (!workspaceRoot || typeof workspaceRoot !== 'string') {
    // Structural path rules only (no filesystem bind).
    return { ok: true, relativePath: posix, absolutePath: null };
  }

  let realRoot;
  try {
    realRoot = fs.realpathSync.native
      ? fs.realpathSync.native(path.resolve(workspaceRoot))
      : fs.realpathSync(path.resolve(workspaceRoot));
  } catch {
    realRoot = path.resolve(workspaceRoot);
  }

  const candidateAbs = path.resolve(realRoot, ...posix.split('/'));
  const relativeToRoot = path.relative(realRoot, candidateAbs);
  if (
    relativeToRoot.startsWith('..') ||
    path.isAbsolute(relativeToRoot) ||
    relativeToRoot.includes(`..${path.sep}`) ||
    relativeToRoot === '..'
  ) {
    return {
      ok: false,
      code: 'outside-workspace',
      message: 'resolved path escapes the authorized workspace root',
    };
  }

  // Symlink escape: if the path exists, re-resolve and re-check containment.
  try {
    if (fs.existsSync(candidateAbs)) {
      const realCandidate = fs.realpathSync.native
        ? fs.realpathSync.native(candidateAbs)
        : fs.realpathSync(candidateAbs);
      const rel2 = path.relative(realRoot, realCandidate);
      if (rel2.startsWith('..') || path.isAbsolute(rel2)) {
        return {
          ok: false,
          code: 'symlink-escape',
          message: 'resolved path escapes workspace via symlink',
        };
      }
    }
  } catch {
    // Non-existent targets are fine for proposed creates; ignore resolve errors.
  }

  const allowed = (Array.isArray(allowedRelativeRoots) ? allowedRelativeRoots : ['.'])
    .map(normalizeRelativePath)
    .filter(Boolean);
  const inScope = allowed.some(root => {
    if (root === '.' || root === '') return true;
    return posix === root || posix.startsWith(`${root}/`);
  });
  if (!inScope) {
    return {
      ok: false,
      code: 'outside-scope',
      message: 'path is outside the authorized relative scope roots',
    };
  }

  return {
    ok: true,
    relativePath: posix,
    absolutePath: candidateAbs,
  };
}

function caseFoldKey(relativePosix) {
  return normalizeRelativePath(relativePosix).toLowerCase();
}

module.exports = {
  normalizeRelativePath,
  validateWorkspacePath,
  caseFoldKey,
  hasControlOrNul,
  isUncPath,
  isWindowsDrivePath,
};
