'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { exportAttemptHistory, validateAttemptHistory } = require('./attemptHistory');
const { sanitizeValidationReport, sanitizeValue } = require('./sanitize');

const ARTIFACT_WRITE_FAILED = Object.freeze({
  code: 'ARTIFACT_WRITE_FAILED',
  message: 'Review artifact write failed; details redacted.',
});

function sha256Text(text) {
  return crypto
    .createHash('sha256')
    .update(String(text || ''), 'utf8')
    .digest('hex');
}

function resolveReal(p) {
  const abs = path.resolve(p);
  try {
    if (fs.realpathSync.native) return fs.realpathSync.native(abs);
    return fs.realpathSync(abs);
  } catch {
    // Windows may canonicalize an existing parent through an 8.3 path while the
    // requested child does not exist yet. Resolve that parent and append the
    // missing suffix so containment checks compare the same canonical namespace.
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
 * Ensure review root is explicit and outside the source workspace (canonical paths).
 */
function assertReviewRootOutsideWorkspace(reviewArtifactRoot, sourceWorkspaceRoot) {
  if (!reviewArtifactRoot || typeof reviewArtifactRoot !== 'string') {
    const error = new Error('reviewArtifactRoot is required and must be explicit');
    error.code = 'ARTIFACT_PATH_INVALID';
    throw error;
  }
  const absReview = resolveReal(reviewArtifactRoot);
  if (sourceWorkspaceRoot) {
    const absSource = resolveReal(sourceWorkspaceRoot);
    if (isInsideOrEqual(absSource, absReview)) {
      const error = new Error('reviewArtifactRoot must not be inside the source workspace');
      error.code = 'ARTIFACT_PATH_INVALID';
      throw error;
    }
  }
  return absReview;
}

/**
 * Sanitize runId so '.', '..', empty, or traversal segments never escape the review root.
 */
function sanitizeRunId(runId) {
  let raw = String(runId == null ? 'run' : runId);
  // Strip path separators first
  raw = raw.replace(/[\\/]+/g, '_');
  let s = raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  if (!s || s === '.' || s === '..' || /^\.+$/.test(s)) {
    if (raw === '..' || s === '..') s = 'run-dotdot';
    else if (raw === '.' || s === '.') s = 'run-dot';
    else s = 'run-default';
  }
  // Prefix reserved/dangerous names so they cannot collapse to review root
  if (s === '.' || s === '..' || s === '...' || !s) {
    s = `run-${s || 'safe'}`;
  }
  // Never allow leading dots-only segments after sanitize
  if (/^\.+$/.test(s)) s = `run-${s.length}`;
  return s;
}

/**
 * Ensure a target path resolves inside the review root (no symlink escape into workspace).
 */
function assertPathInsideReviewRoot(targetPath, absReviewRoot, sourceWorkspaceRoot) {
  const absTarget = path.resolve(targetPath);
  // If path exists, re-resolve real path (junctions/symlinks).
  let realTarget = absTarget;
  try {
    if (fs.existsSync(absTarget)) {
      realTarget = resolveReal(absTarget);
    }
  } catch {
    const error = new Error('artifact path resolution failed');
    error.code = 'ARTIFACT_PATH_INVALID';
    throw error;
  }
  const realReview = resolveReal(absReviewRoot);
  if (!isInsideOrEqual(realReview, realTarget)) {
    const error = new Error('artifact path escapes review root');
    error.code = 'ARTIFACT_PATH_INVALID';
    throw error;
  }
  if (sourceWorkspaceRoot) {
    const realSource = resolveReal(sourceWorkspaceRoot);
    if (isInsideOrEqual(realSource, realTarget)) {
      const error = new Error('artifact path resolves into source workspace');
      error.code = 'ARTIFACT_PATH_INVALID';
      throw error;
    }
  }
  return realTarget;
}

function writeJsonFile(filePath, value) {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(filePath, json, 'utf8');
  return {
    json,
    sha256: sha256Text(json),
    sizeBytes: Buffer.byteLength(json, 'utf8'),
  };
}

/**
 * Write complete human-review artifact set under the explicit review root.
 * Never mutates the source workspace. Never writes raw unsanitized reports.
 * Failures return { written:false, error } — never throws secret/path-bearing errors to callers
 * when used via the safe wrapper; internal throws are mapped.
 */
function writeAssuranceReviewArtifacts({
  reviewArtifactRoot,
  sourceWorkspaceRoot,
  runId,
  history,
  reports = [],
  finalCandidate = null,
  reviewDiff = null,
}) {
  try {
    const absReview = assertReviewRootOutsideWorkspace(reviewArtifactRoot, sourceWorkspaceRoot);
    // Ensure review root exists as a real directory first.
    fs.mkdirSync(absReview, { recursive: true });
    const realReview = resolveReal(absReview);
    if (sourceWorkspaceRoot) {
      const realSource = resolveReal(sourceWorkspaceRoot);
      if (isInsideOrEqual(realSource, realReview)) {
        return {
          written: false,
          files: [],
          error: { ...ARTIFACT_WRITE_FAILED },
        };
      }
    }

    const safeRunId = sanitizeRunId(runId);
    const dir = path.join(realReview, safeRunId);

    // Pre-existing symlink/junction under runId must not redirect into the workspace.
    if (fs.existsSync(dir)) {
      try {
        assertPathInsideReviewRoot(dir, realReview, sourceWorkspaceRoot);
      } catch {
        return {
          written: false,
          files: [],
          error: { ...ARTIFACT_WRITE_FAILED },
        };
      }
      // If it's a symlink, refuse when real path is outside review root (already checked).
    }

    fs.mkdirSync(dir, { recursive: true });
    // Re-check after create (handles race / junction replace).
    assertPathInsideReviewRoot(dir, realReview, sourceWorkspaceRoot);

    // Portable history — never require entitlement/provider to read.
    let portable;
    try {
      portable = exportAttemptHistory(history);
    } catch {
      // History must already be compact; fall back to validated clone if possible.
      const check = validateAttemptHistory(history);
      if (!check.ok) {
        return {
          written: false,
          files: [],
          error: { ...ARTIFACT_WRITE_FAILED },
        };
      }
      portable = JSON.parse(JSON.stringify(history));
    }

    const artifactEntries = [];
    const written = [];

    function addArtifact(relName, absPath, meta) {
      written.push(absPath);
      artifactEntries.push({
        path: path.posix.join(safeRunId, relName),
        sha256: meta.sha256,
        sizeBytes: meta.sizeBytes,
      });
    }

    const historyPath = path.join(dir, 'attempt-history.json');
    assertPathInsideReviewRoot(historyPath, realReview, sourceWorkspaceRoot);
    addArtifact('attempt-history.json', historyPath, writeJsonFile(historyPath, portable));

    // Sanitized per-attempt validation reports
    if (Array.isArray(portable.attempts) && portable.attempts.length) {
      portable.attempts.forEach((attempt, index) => {
        const report = attempt.validationReport
          ? sanitizeValidationReport(attempt.validationReport)
          : sanitizeValidationReport(reports[index] || null);
        const name = `validation-report-attempt-${index}.json`;
        const reportPath = path.join(dir, name);
        assertPathInsideReviewRoot(reportPath, realReview, sourceWorkspaceRoot);
        addArtifact(name, reportPath, writeJsonFile(reportPath, report));
      });
    }

    // Sanitized final candidate (full review projection; advisory only)
    if (finalCandidate != null) {
      const safeFinal = sanitizeValue(finalCandidate) || {};
      const finalPath = path.join(dir, 'final-candidate.json');
      assertPathInsideReviewRoot(finalPath, realReview, sourceWorkspaceRoot);
      addArtifact('final-candidate.json', finalPath, writeJsonFile(finalPath, safeFinal));
    }

    // Public reviewDiff for the final validation
    if (reviewDiff != null) {
      const safeDiff = sanitizeValue(reviewDiff) || {
        schemaVersion: 1,
        kind: 'generation-review-diff',
        files: [],
      };
      const diffPath = path.join(dir, 'review-diff.json');
      assertPathInsideReviewRoot(diffPath, realReview, sourceWorkspaceRoot);
      addArtifact('review-diff.json', diffPath, writeJsonFile(diffPath, safeDiff));
    }

    // Manifest lists every content artifact with SHA-256/size. It is written once and
    // is not self-listed (avoids unstable self-hash). manifest.json is still on disk.
    const manifest = {
      schemaVersion: 1,
      kind: 'generation-assurance-review-manifest',
      runId: safeRunId,
      nonClaims: {
        compiled: false,
        approved: false,
        deployable: false,
        workspaceMutated: false,
      },
      notes: [
        'Artifacts are advisory human-review only.',
        'No entitlement or provider is required to read or export these files.',
        'Candidates are never applied to the source workspace.',
        'manifest.json is present beside the listed artifacts.',
      ],
      artifacts: artifactEntries,
    };
    const manifestPath = path.join(dir, 'manifest.json');
    assertPathInsideReviewRoot(manifestPath, realReview, sourceWorkspaceRoot);
    writeJsonFile(manifestPath, manifest);
    written.push(manifestPath);

    return {
      written: true,
      root: realReview,
      directory: dir,
      runId: safeRunId,
      files: written,
      manifest,
    };
  } catch {
    return {
      written: false,
      files: [],
      error: { ...ARTIFACT_WRITE_FAILED },
    };
  }
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
    names.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of names) {
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        walk(full, rel);
      } else if (ent.isFile()) {
        const buf = fs.readFileSync(full);
        entries.push({
          path: rel.replace(/\\/g, '/'),
          sha256: crypto.createHash('sha256').update(buf).digest('hex'),
          size: buf.length,
        });
      }
    }
  }

  walk(abs, '');
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return {
    entries,
    fingerprint: sha256Text(JSON.stringify(entries)),
  };
}

module.exports = {
  ARTIFACT_WRITE_FAILED,
  assertReviewRootOutsideWorkspace,
  sanitizeRunId,
  assertPathInsideReviewRoot,
  writeAssuranceReviewArtifacts,
  hashWorkspaceTree,
  sha256Text,
};
