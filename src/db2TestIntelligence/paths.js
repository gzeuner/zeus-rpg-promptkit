'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { LIMITS } = require('./constants');

function resolveReal(p) {
  const abs = path.resolve(p);
  try {
    if (fs.realpathSync.native) return fs.realpathSync.native(abs);
    return fs.realpathSync(abs);
  } catch {
    const suffix = [];
    let current = abs;
    while (!fs.existsSync(current)) {
      const parent = path.dirname(current);
      if (parent === current) return abs;
      suffix.unshift(path.basename(current));
      current = parent;
    }
    try {
      const realParent = fs.realpathSync.native
        ? fs.realpathSync.native(current)
        : fs.realpathSync(current);
      return path.join(realParent, ...suffix);
    } catch {
      return abs;
    }
  }
}

function isInsideOrEqual(parentAbs, childAbs) {
  const rel = path.relative(parentAbs, childAbs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Sanitize runId so '.', '..', empty, separators, or traversal never escape the artifact root.
 */
function sanitizeRunId(runId) {
  let raw = String(runId == null ? 'run' : runId);
  raw = raw.replace(/[\\/]+/g, '_');
  let s = raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, LIMITS.maxRunIdChars);
  // Neutralize any ".." appearance so path APIs never treat the segment as traversal.
  s = s.replace(/\.\./g, 'dotdot');
  if (!s || s === '.' || s === '..' || /^\.+$/.test(s)) {
    if (raw === '..' || s === '..' || raw.includes('..')) s = 'run-dotdot';
    else if (raw === '.' || s === '.') s = 'run-dot';
    else s = 'run-default';
  }
  if (/^\.+$/.test(s)) s = `run-${s.length}`;
  // Never allow a leading dot-only or empty segment after cleanup
  if (!s || s === '.' || s === '..') s = 'run-default';
  return s;
}

/**
 * Reject absolute, UNC, drive-letter, traversal, and empty relative segments.
 */
function assertSafeRelativeRunId(runId) {
  if (typeof runId !== 'string' || !runId) {
    return { ok: false, message: 'run id is required' };
  }
  if (runId.includes('\0') || /[\u0000-\u001f\u007f]/.test(runId)) {
    return { ok: false, message: 'run id contains control characters' };
  }
  const normalized = runId.replace(/\\/g, '/');
  if (
    path.isAbsolute(runId) ||
    path.isAbsolute(normalized) ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.startsWith('//') ||
    normalized.startsWith('\\\\') ||
    normalized.includes('..') ||
    normalized.includes('/') ||
    normalized === '.' ||
    normalized === '..'
  ) {
    return { ok: false, message: 'run id must be a single relative segment' };
  }
  const safe = sanitizeRunId(runId);
  if (safe !== runId && runId !== safe) {
    // Writer accepts unsanitized and rewrites; reader requires already-safe id
    // matching on-disk directory name produced by sanitizeRunId.
  }
  return { ok: true, runId: safe };
}

function assertArtifactRootOutsideWorkspace(artifactRoot, workspaceRoot) {
  if (!artifactRoot || typeof artifactRoot !== 'string') {
    const error = new Error('artifactRoot is required and must be explicit');
    error.code = 'ARTIFACT_PATH_INVALID';
    throw error;
  }
  const absArtifact = resolveReal(artifactRoot);
  if (workspaceRoot) {
    const absSource = resolveReal(workspaceRoot);
    if (isInsideOrEqual(absSource, absArtifact)) {
      const error = new Error('artifactRoot must not be inside the source workspace');
      error.code = 'ARTIFACT_PATH_INVALID';
      throw error;
    }
  }
  return absArtifact;
}

function assertPathInsideRoot(targetPath, absRoot, workspaceRoot) {
  const absTarget = path.resolve(targetPath);
  let realTarget = absTarget;
  try {
    if (fs.existsSync(absTarget)) {
      const st = fs.lstatSync(absTarget);
      if (st.isSymbolicLink()) {
        const error = new Error('symlink rejected');
        error.code = 'ARTIFACT_PATH_INVALID';
        throw error;
      }
      realTarget = resolveReal(absTarget);
    }
  } catch (err) {
    if (err && err.code === 'ARTIFACT_PATH_INVALID') throw err;
    const error = new Error('artifact path resolution failed');
    error.code = 'ARTIFACT_PATH_INVALID';
    throw error;
  }
  const realRoot = resolveReal(absRoot);
  if (!isInsideOrEqual(realRoot, realTarget)) {
    const error = new Error('path escapes artifact root');
    error.code = 'ARTIFACT_PATH_INVALID';
    throw error;
  }
  if (workspaceRoot) {
    const realSource = resolveReal(workspaceRoot);
    if (isInsideOrEqual(realSource, realTarget)) {
      const error = new Error('path resolves into source workspace');
      error.code = 'ARTIFACT_PATH_INVALID';
      throw error;
    }
  }
  return realTarget;
}

/**
 * Hash every regular file under a directory for byte-identity workspace checks.
 */
function hashWorkspaceTree(rootDir) {
  const abs = path.resolve(rootDir);
  const entries = [];

  function walk(current, relBase) {
    let names;
    try {
      names = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    names.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const ent of names) {
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        walk(full, rel);
      } else if (ent.isFile()) {
        const buf = fs.readFileSync(full);
        entries.push({
          path: rel.replace(/\\/g, '/'),
          sha256: require('node:crypto').createHash('sha256').update(buf).digest('hex'),
          size: buf.length,
        });
      }
    }
  }

  walk(abs, '');
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const fingerprint = require('node:crypto')
    .createHash('sha256')
    .update(JSON.stringify(entries), 'utf8')
    .digest('hex');
  return { entries, fingerprint };
}

module.exports = {
  resolveReal,
  isInsideOrEqual,
  sanitizeRunId,
  assertSafeRelativeRunId,
  assertArtifactRootOutsideWorkspace,
  assertPathInsideRoot,
  hashWorkspaceTree,
};
