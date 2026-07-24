'use strict';

const fs = require('fs');
const path = require('path');
const { LAYOUT } = require('./constants');
const { fail, REASON_CODES } = require('./errors');

/**
 * Resolve and validate a project-knowledge root directory.
 * Absolute path required after resolve; must not contain `..` segments after normalize.
 */
function resolveKnowledgeRoot(rootPath) {
  if (typeof rootPath !== 'string' || !rootPath.trim()) {
    fail(REASON_CODES.PATH_UNSAFE, 'knowledge root path is required');
  }
  const resolved = path.resolve(rootPath);
  const normalized = path.normalize(resolved);
  if (normalized.includes(`..${path.sep}`) || normalized.endsWith('..')) {
    fail(REASON_CODES.PATH_TRAVERSAL, 'knowledge root path must not contain parent traversal');
  }
  return normalized;
}

function knowledgePaths(rootPath) {
  const root = resolveKnowledgeRoot(rootPath);
  return Object.freeze({
    root,
    manifest: path.join(root, LAYOUT.MANIFEST),
    sqlite: path.join(root, LAYOUT.SQLITE),
    locksDir: path.join(root, LAYOUT.LOCKS_DIR),
    writerLock: path.join(root, LAYOUT.WRITER_LOCK),
    contentDir: path.join(root, LAYOUT.CONTENT_DIR),
    luceneDir: path.join(root, LAYOUT.LUCENE_DIR),
    snapshotsDir: path.join(root, LAYOUT.SNAPSHOTS_DIR),
    reportsDir: path.join(root, LAYOUT.REPORTS_DIR),
    quarantineDir: path.join(root, LAYOUT.QUARANTINE_DIR),
  });
}

function ensureLayoutDirs(rootPath, { createContent = true } = {}) {
  const paths = knowledgePaths(rootPath);
  fs.mkdirSync(paths.root, { recursive: true });
  fs.mkdirSync(paths.locksDir, { recursive: true });
  fs.mkdirSync(paths.snapshotsDir, { recursive: true });
  fs.mkdirSync(paths.reportsDir, { recursive: true });
  fs.mkdirSync(paths.quarantineDir, { recursive: true });
  if (createContent) {
    fs.mkdirSync(paths.contentDir, { recursive: true });
    fs.mkdirSync(paths.luceneDir, { recursive: true });
  }
  return paths;
}

function readManifest(rootPath) {
  const { manifest } = knowledgePaths(rootPath);
  if (!fs.existsSync(manifest)) return null;
  try {
    const raw = fs.readFileSync(manifest, 'utf8');
    return JSON.parse(raw);
  } catch {
    fail(REASON_CODES.STORE_CORRUPT, 'project knowledge manifest is unreadable');
  }
}

function writeManifestAtomic(rootPath, manifest) {
  const paths = knowledgePaths(rootPath);
  fs.mkdirSync(paths.root, { recursive: true });
  const tmp = `${paths.manifest}.tmp-${process.pid}`;
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(tmp, body, 'utf8');
  fs.renameSync(tmp, paths.manifest);
}

module.exports = {
  resolveKnowledgeRoot,
  knowledgePaths,
  ensureLayoutDirs,
  readManifest,
  writeManifestAtomic,
};
