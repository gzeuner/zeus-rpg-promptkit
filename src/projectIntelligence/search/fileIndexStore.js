'use strict';

const fs = require('fs');
const path = require('path');
const {
  SEARCH_SCHEMA_VERSION,
  ENGINE_ID,
  ENGINE_VERSION,
  ANALYZER_ID,
  ANALYZER_VERSION,
  SEARCH_LAYOUT,
} = require('./constants');
const { fail, REASON_CODES } = require('../store/errors');
const { knowledgePaths, resolveKnowledgeRoot } = require('../store/layout');

function resolveIndexDir(options = {}) {
  if (options.indexDir) {
    return path.resolve(options.indexDir);
  }
  if (options.knowledgeRoot) {
    const root = resolveKnowledgeRoot(options.knowledgeRoot);
    return knowledgePaths(root).luceneDir;
  }
  fail(REASON_CODES.PATH_UNSAFE, 'indexDir or knowledgeRoot is required');
}

function indexPaths(indexDir) {
  const root = path.resolve(indexDir);
  return {
    root,
    manifest: path.join(root, SEARCH_LAYOUT.MANIFEST),
    docs: path.join(root, SEARCH_LAYOUT.DOCS),
    postings: path.join(root, SEARCH_LAYOUT.POSTINGS),
    generation: path.join(root, SEARCH_LAYOUT.GENERATION),
    corruptMarker: path.join(root, SEARCH_LAYOUT.QUARANTINE_MARKER),
  };
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    fail(REASON_CODES.INDEX_CORRUPT, 'search index file is unreadable or invalid JSON');
  }
}

function writeManifest(indexDir, { projectId, snapshotId, docCount, generation }) {
  const paths = indexPaths(indexDir);
  const manifest = {
    schemaVersion: 1,
    kind: 'project-knowledge-search-manifest',
    searchSchemaVersion: SEARCH_SCHEMA_VERSION,
    engineId: ENGINE_ID,
    engineVersion: ENGINE_VERSION,
    analyzerId: ANALYZER_ID,
    analyzerVersion: ANALYZER_VERSION,
    projectId: projectId || null,
    snapshotId: snapshotId || null,
    docCount: docCount || 0,
    generation: generation || 1,
    updatedAt: new Date().toISOString(),
  };
  writeJsonAtomic(paths.manifest, manifest);
  return manifest;
}

function loadIndexFiles(indexDir) {
  const paths = indexPaths(indexDir);
  if (fs.existsSync(paths.corruptMarker)) {
    fail(REASON_CODES.INDEX_CORRUPT, 'search index is marked corrupt; rebuild required');
  }
  if (
    !fs.existsSync(paths.manifest) ||
    !fs.existsSync(paths.docs) ||
    !fs.existsSync(paths.postings)
  ) {
    fail(REASON_CODES.INDEX_UNAVAILABLE, 'search index files are missing');
  }
  const manifest = readJson(paths.manifest);
  if (Number(manifest.searchSchemaVersion) !== SEARCH_SCHEMA_VERSION) {
    if (Number(manifest.searchSchemaVersion) > SEARCH_SCHEMA_VERSION) {
      fail(REASON_CODES.INDEX_SCHEMA_MISMATCH, 'unsupported future search schema version');
    }
    fail(REASON_CODES.INDEX_REBUILD_REQUIRED, 'search schema migration/rebuild required');
  }
  if (manifest.engineId && manifest.engineId !== ENGINE_ID) {
    fail(REASON_CODES.INDEX_SCHEMA_MISMATCH, 'search engine identity mismatch');
  }
  const docs = readJson(paths.docs);
  const postings = readJson(paths.postings);
  if (!Array.isArray(docs)) {
    fail(REASON_CODES.INDEX_CORRUPT, 'docs index payload must be an array');
  }
  if (!postings || typeof postings !== 'object' || Array.isArray(postings)) {
    fail(REASON_CODES.INDEX_CORRUPT, 'postings index payload must be an object');
  }
  return { manifest, docs, postings, paths };
}

function persistIndex(indexDir, { docs, postings, projectId, snapshotId, generation }) {
  const paths = indexPaths(indexDir);
  fs.mkdirSync(paths.root, { recursive: true });
  // Remove corrupt marker on successful rebuild/write
  if (fs.existsSync(paths.corruptMarker)) {
    try {
      fs.unlinkSync(paths.corruptMarker);
    } catch {
      // ignore
    }
  }
  writeJsonAtomic(paths.docs, docs);
  writeJsonAtomic(paths.postings, postings);
  writeJsonAtomic(paths.generation, {
    generation: generation || 1,
    updatedAt: new Date().toISOString(),
  });
  return writeManifest(indexDir, {
    projectId,
    snapshotId,
    docCount: Array.isArray(docs) ? docs.length : 0,
    generation,
  });
}

function markCorrupt(indexDir, reason = 'integrity failure') {
  const paths = indexPaths(indexDir);
  fs.mkdirSync(paths.root, { recursive: true });
  fs.writeFileSync(
    paths.corruptMarker,
    `${JSON.stringify({ reason, markedAt: new Date().toISOString() })}\n`,
    'utf8'
  );
}

function exists(indexDir) {
  const paths = indexPaths(indexDir);
  return fs.existsSync(paths.manifest);
}

module.exports = {
  resolveIndexDir,
  indexPaths,
  writeJsonAtomic,
  loadIndexFiles,
  persistIndex,
  markCorrupt,
  exists,
  writeManifest,
};
