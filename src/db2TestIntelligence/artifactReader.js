'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  ARTIFACT_FILES,
  REASON_CODES,
  LIMITS,
  RESULT_CONTRACT_ID,
  RESULT_CONTRACT_VERSION,
  RESULT_CONTRACT_REF,
} = require('./constants');
const { sha256Buffer } = require('./util');
const { resolveReal, isInsideOrEqual, sanitizeRunId } = require('./paths');
const { validateVectorSet, validateManifest } = require('./validate');
const { exportMarkdown, exportFramework } = require('./exporters');

function fail(code, message) {
  return {
    ok: false,
    reasonCode: code,
    message: String(message),
  };
}

function lstatSafe(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

/**
 * Entitlement-free filesystem reader.
 * Accepts trusted root + relative run ID only.
 * Run ID must already be the exact canonical sanitized single segment
 * (writer returns sanitizeRunId result). Any non-identity spelling is rejected —
 * never silently maps to a different on-disk directory.
 * Enforces containment, pre-read sizes, rejects symlinks/traversal/absolute/UNC.
 * Validates exact contract/version/manifest hashes and missing/extra files.
 * Never generates or rewrites artifacts on disk.
 */
function readArtifacts(trustedRoot, runId) {
  if (!trustedRoot || typeof trustedRoot !== 'string') {
    return fail(REASON_CODES.ARTIFACT_PATH_INVALID, 'Trusted artifact root is required.');
  }
  if (typeof runId !== 'string' || !runId) {
    return fail(REASON_CODES.ARTIFACT_PATH_INVALID, 'Run id is required.');
  }

  // Reject absolute / UNC / traversal / separators in runId
  const normalized = runId.replace(/\\/g, '/');
  if (
    path.isAbsolute(runId) ||
    path.isAbsolute(normalized) ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.startsWith('//') ||
    normalized.includes('..') ||
    normalized.includes('/') ||
    normalized === '.' ||
    normalized === '..' ||
    /[\u0000-\u001f\u007f]/.test(runId)
  ) {
    return fail(REASON_CODES.ARTIFACT_PATH_INVALID, 'Run id must be a single relative segment.');
  }

  // Exact identity with the writer's sanitizeRunId output — no aliasing.
  const canonical = sanitizeRunId(runId);
  if (canonical !== runId) {
    return fail(
      REASON_CODES.ARTIFACT_PATH_INVALID,
      'Run id must be the exact canonical sanitized segment.'
    );
  }
  const runSegment = runId;

  let realRoot;
  try {
    const st = lstatSafe(trustedRoot);
    if (!st || !st.isDirectory()) {
      return fail(REASON_CODES.ARTIFACT_READ_FAILED, 'Trusted root is not a directory.');
    }
    if (st.isSymbolicLink()) {
      return fail(REASON_CODES.ARTIFACT_PATH_INVALID, 'Trusted root must not be a symlink.');
    }
    realRoot = resolveReal(trustedRoot);
  } catch {
    return fail(REASON_CODES.ARTIFACT_READ_FAILED, 'Trusted root resolution failed.');
  }

  const runDir = path.join(realRoot, runSegment);
  const runStat = lstatSafe(runDir);
  if (!runStat) {
    return fail(REASON_CODES.ARTIFACT_READ_FAILED, 'Artifact run directory not found.');
  }
  if (runStat.isSymbolicLink()) {
    return fail(REASON_CODES.ARTIFACT_PATH_INVALID, 'Run directory symlink rejected.');
  }
  if (!runStat.isDirectory()) {
    return fail(REASON_CODES.ARTIFACT_READ_FAILED, 'Run path is not a directory.');
  }

  let realRun;
  try {
    realRun = resolveReal(runDir);
  } catch {
    return fail(REASON_CODES.ARTIFACT_PATH_INVALID, 'Run directory resolution failed.');
  }
  if (!isInsideOrEqual(realRoot, realRun)) {
    return fail(REASON_CODES.ARTIFACT_PATH_INVALID, 'Run directory escapes trusted root.');
  }

  // Read directory entries — reject symlinks among children
  let names;
  try {
    names = fs.readdirSync(realRun);
  } catch {
    return fail(REASON_CODES.ARTIFACT_READ_FAILED, 'Unable to list artifact directory.');
  }
  names.sort();

  const onDisk = new Map();
  for (const name of names) {
    if (name === '.' || name === '..') continue;
    const full = path.join(realRun, name);
    const st = lstatSafe(full);
    if (!st) continue;
    if (st.isSymbolicLink()) {
      return fail(REASON_CODES.ARTIFACT_PATH_INVALID, 'Symlink inside artifact set rejected.');
    }
    if (!st.isFile()) {
      return fail(REASON_CODES.ARTIFACT_TAMPERED, 'Unexpected non-file entry in artifact set.');
    }
    // Pre-read size bound
    if (st.size > LIMITS.maxCanonicalJsonBytes && name.endsWith('.json')) {
      // still allow manifest small — apply per-type below after known
    }
    if (st.size > LIMITS.maxAggregateArtifactBytes) {
      return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Artifact file exceeds aggregate bound.');
    }
    onDisk.set(name, { path: full, size: st.size });
  }

  if (!onDisk.has(ARTIFACT_FILES.MANIFEST)) {
    return fail(REASON_CODES.ARTIFACT_INCOMPLETE, 'manifest.json is missing.');
  }

  // Load manifest with size guard
  const manMeta = onDisk.get(ARTIFACT_FILES.MANIFEST);
  if (manMeta.size > 1024 * 1024) {
    return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Manifest exceeds size bound.');
  }
  let manifestRaw;
  let manifest;
  try {
    manifestRaw = fs.readFileSync(manMeta.path, 'utf8');
    manifest = JSON.parse(manifestRaw);
  } catch {
    return fail(REASON_CODES.ARTIFACT_TAMPERED, 'Manifest is unreadable.');
  }

  // Strict portable manifest schema (kind, contractRef, runId, required Markdown, etc.)
  const manCheck = validateManifest(manifest);
  if (!manCheck.ok) {
    // Map schema failures on-disk to tamper/incomplete vocabulary for readers.
    if (manCheck.reasonCode === REASON_CODES.BOUNDS_EXCEEDED) {
      return manCheck;
    }
    return fail(
      REASON_CODES.ARTIFACT_TAMPERED,
      manCheck.message || 'Manifest failed portable contract validation.'
    );
  }
  if (manifest.runId !== runSegment) {
    return fail(REASON_CODES.ARTIFACT_TAMPERED, 'Manifest runId mismatch.');
  }

  // Expected files = strict manifest artifacts + manifest.json
  const expected = new Set([ARTIFACT_FILES.MANIFEST]);
  for (const entry of manifest.artifacts) {
    expected.add(entry.path);
  }
  // Hard require canonical + Markdown on disk regardless of tamper attempts.
  if (!expected.has(ARTIFACT_FILES.CANONICAL) || !expected.has(ARTIFACT_FILES.MARKDOWN)) {
    return fail(REASON_CODES.ARTIFACT_TAMPERED, 'Manifest content set is incomplete.');
  }

  // Missing / extra
  for (const name of expected) {
    if (!onDisk.has(name)) {
      return fail(REASON_CODES.ARTIFACT_INCOMPLETE, 'Listed artifact file is missing.');
    }
  }
  for (const name of onDisk.keys()) {
    if (!expected.has(name)) {
      return fail(REASON_CODES.ARTIFACT_TAMPERED, 'Extra file present in artifact set.');
    }
  }
  if (!onDisk.has(ARTIFACT_FILES.MARKDOWN)) {
    return fail(REASON_CODES.ARTIFACT_INCOMPLETE, 'Markdown projection is missing.');
  }
  if (!onDisk.has(ARTIFACT_FILES.CANONICAL)) {
    return fail(REASON_CODES.ARTIFACT_INCOMPLETE, 'Canonical vector set is missing.');
  }

  // Hash verification for each listed artifact
  const files = {};
  let aggregate = 0;
  for (const entry of manifest.artifacts) {
    const meta = onDisk.get(entry.path);
    if (meta.size !== entry.sizeBytes) {
      return fail(REASON_CODES.ARTIFACT_TAMPERED, 'Artifact size does not match manifest.');
    }
    if (meta.size > LIMITS.maxCanonicalJsonBytes && entry.path === ARTIFACT_FILES.CANONICAL) {
      return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Canonical artifact exceeds size bound.');
    }
    if (meta.size > LIMITS.maxMarkdownBytes && entry.path === ARTIFACT_FILES.MARKDOWN) {
      return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Markdown artifact exceeds size bound.');
    }
    if (
      meta.size > LIMITS.maxFrameworkOutputBytes &&
      (entry.path === ARTIFACT_FILES.JUNIT || entry.path === ARTIFACT_FILES.ROBOT)
    ) {
      return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Framework artifact exceeds size bound.');
    }
    aggregate += meta.size;
    if (aggregate > LIMITS.maxAggregateArtifactBytes) {
      return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Aggregate artifact size exceeded.');
    }
    let buf;
    try {
      buf = fs.readFileSync(meta.path);
    } catch {
      return fail(REASON_CODES.ARTIFACT_READ_FAILED, 'Unable to read artifact file.');
    }
    const hash = sha256Buffer(buf);
    if (hash !== entry.sha256) {
      return fail(REASON_CODES.ARTIFACT_TAMPERED, 'Artifact hash does not match manifest.');
    }
    files[entry.path] = buf.toString('utf8');
  }

  // Parse + validate canonical
  let vectorSet;
  try {
    vectorSet = JSON.parse(files[ARTIFACT_FILES.CANONICAL]);
  } catch {
    return fail(REASON_CODES.ARTIFACT_TAMPERED, 'Canonical JSON is invalid.');
  }
  if (
    vectorSet.contractId !== RESULT_CONTRACT_ID ||
    vectorSet.contractVersion !== RESULT_CONTRACT_VERSION ||
    vectorSet.contractRef !== RESULT_CONTRACT_REF
  ) {
    return fail(REASON_CODES.ARTIFACT_TAMPERED, 'Canonical contract identity mismatch.');
  }
  const vsCheck = validateVectorSet(vectorSet, { rawText: files[ARTIFACT_FILES.CANONICAL] });
  if (!vsCheck.ok) {
    if (vsCheck.reasonCode === REASON_CODES.BOUNDS_EXCEEDED) return vsCheck;
    return fail(
      REASON_CODES.ARTIFACT_TAMPERED,
      vsCheck.message || 'Canonical vector set is invalid.'
    );
  }

  return {
    ok: true,
    reasonCode: REASON_CODES.OK,
    runId: runSegment,
    directory: realRun,
    manifest,
    vectorSet,
    files,
  };
}

/**
 * Pure re-export projections from an already-read vector set (no disk writes).
 */
function projectExports(vectorSet, frameworks = []) {
  const out = {};
  const md = exportMarkdown(vectorSet);
  if (!md.ok) return md;
  out.markdown = md.text;
  for (const fw of frameworks) {
    const exported = exportFramework(vectorSet, fw);
    if (!exported.ok) return exported;
    out[fw] = exported.text;
  }
  return { ok: true, exports: out };
}

module.exports = {
  readArtifacts,
  projectExports,
};
