'use strict';

/**
 * Portable snapshot export packaging (Track C / ADR-011 export-disclosure).
 *
 * Builds a redacted, offline package of a published snapshot for transfer or
 * archival. Host absolute paths are never written. Package 09 / live IBM i are
 * out of scope.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { openSnapshotEngine } = require('../engine/snapshotEngine');
const { fail, REASON_CODES } = require('../store/errors');
const { SNAPSHOT_STATUSES } = require('../constants');
const { resolveEmbeddingPolicy, shouldRetainVectorField } = require('../search/embeddingPolicy');

const PORTABLE_PACKAGE_SCHEMA = 'zeus.project-knowledge-portable-snapshot@1';
const PORTABLE_PACKAGE_KIND = 'project-knowledge-portable-snapshot';

function sha256OfFile(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function sha256OfString(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function redactString(value) {
  return String(value || '')
    .replace(/[A-Za-z]:\\[^\s"']+/g, '<redacted-path>')
    .replace(/\/(?:Users|home)\/[^\s"']+/g, '<redacted-path>');
}

function stripAbsolutePathsDeep(value, depth = 0) {
  if (depth > 14) return null;
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(v => stripAbsolutePathsDeep(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (
        k === 'path' ||
        k === 'absolutePath' ||
        k === 'realPath' ||
        k === 'dbPath' ||
        k === 'knowledgeRoot'
      ) {
        out[k] = typeof v === 'string' ? '<redacted-path>' : null;
        continue;
      }
      if (String(k).startsWith('_')) continue;
      out[k] = stripAbsolutePathsDeep(v, depth + 1);
    }
    return out;
  }
  return null;
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body = `${JSON.stringify(value, null, 2)}\n`;
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, body, 'utf8');
  fs.renameSync(tmp, filePath);
  return sha256OfString(body);
}

function assertNoHostPathLeak(serialized) {
  if (/[A-Za-z]:\\/.test(serialized) || /\/(?:Users|home)\//.test(serialized)) {
    fail(REASON_CODES.EXPORT_DENIED, 'portable export refused: host path leakage detected');
  }
}

/**
 * Export a published snapshot to a portable directory package.
 *
 * @param {object} options
 * @param {string} options.knowledgeRoot absolute knowledge root
 * @param {string} options.projectId
 * @param {string} options.outputDir absolute destination directory (created)
 * @param {string} [options.snapshotId] defaults to current published snapshot
 * @param {object[]} [options.trustedRoots] required when opening engine needs them
 * @param {boolean} [options.includeSearchDocs=true]
 * @param {boolean} [options.includeVectors=false] vectors only when embeddings policy allows
 * @returns {object} export result (no absolute paths)
 */
function exportPortableSnapshotPackage(options = {}) {
  const knowledgeRoot = options.knowledgeRoot;
  const projectId = options.projectId;
  const outputDir = options.outputDir;
  if (typeof knowledgeRoot !== 'string' || !path.isAbsolute(knowledgeRoot)) {
    fail(REASON_CODES.PATH_UNSAFE, 'knowledgeRoot must be an absolute path');
  }
  if (typeof projectId !== 'string' || !projectId.trim()) {
    fail(REASON_CODES.PROJECT_ID_INVALID, 'projectId is required');
  }
  if (typeof outputDir !== 'string' || !path.isAbsolute(outputDir)) {
    fail(REASON_CODES.PATH_UNSAFE, 'outputDir must be an absolute path');
  }

  const embeddingPolicy = resolveEmbeddingPolicy(options);
  const includeSearchDocs = options.includeSearchDocs !== false;
  const includeVectors =
    options.includeVectors === true && shouldRetainVectorField(embeddingPolicy);

  let engine;
  try {
    engine = openSnapshotEngine({
      knowledgeRoot,
      projectId: projectId.trim(),
      trustedRoots: options.trustedRoots || [],
      readOnly: true,
    });

    const current = engine.getCurrentSnapshot();
    if (!current) {
      fail(REASON_CODES.SNAPSHOT_NOT_FOUND, 'no current published snapshot');
    }
    const snapshotId = options.snapshotId ? String(options.snapshotId).trim() : current.snapshotId;
    if (current.snapshotId !== snapshotId) {
      // Allow exporting non-current only if store can still list it
      const listed = engine._store.getSnapshot(projectId.trim(), snapshotId);
      if (!listed) {
        fail(REASON_CODES.SNAPSHOT_NOT_FOUND, 'snapshot not found');
      }
      if (listed.status !== SNAPSHOT_STATUSES.PUBLISHED && listed.status !== 'published') {
        fail(REASON_CODES.SNAPSHOT_NOT_PUBLISHED, 'only published snapshots may be exported');
      }
    }

    const equalityView = engine.projectEqualityView(snapshotId);
    const project = engine._store.getProject
      ? engine._store.getProject(projectId.trim())
      : { projectId: projectId.trim() };
    const snapshot =
      (engine._store.getSnapshot && engine._store.getSnapshot(projectId.trim(), snapshotId)) ||
      current;

    fs.mkdirSync(outputDir, { recursive: true });
    const files = {};

    files['project.json'] = writeJsonAtomic(
      path.join(outputDir, 'project.json'),
      stripAbsolutePathsDeep({
        projectId: projectId.trim(),
        displayName: project && project.displayName,
        schemaVersion: project && project.schemaVersion,
      })
    );
    files['snapshot.json'] = writeJsonAtomic(
      path.join(outputDir, 'snapshot.json'),
      stripAbsolutePathsDeep({
        projectId: projectId.trim(),
        snapshotId,
        status: snapshot.status || SNAPSHOT_STATUSES.PUBLISHED,
        sourceInventoryHash: snapshot.sourceInventoryHash,
        publishedAt: snapshot.publishedAt,
        createdAt: snapshot.createdAt,
      })
    );
    files['equality-view.json'] = writeJsonAtomic(
      path.join(outputDir, 'equality-view.json'),
      stripAbsolutePathsDeep(equalityView)
    );

    let searchDocCount = 0;
    if (includeSearchDocs) {
      const luceneDocsPath = path.join(knowledgeRoot, 'lucene', 'docs.json');
      if (fs.existsSync(luceneDocsPath)) {
        let docs;
        try {
          docs = JSON.parse(fs.readFileSync(luceneDocsPath, 'utf8'));
        } catch {
          fail(REASON_CODES.INDEX_CORRUPT, 'search docs unreadable for export');
        }
        if (!Array.isArray(docs)) {
          fail(REASON_CODES.INDEX_CORRUPT, 'search docs must be an array');
        }
        const portableDocs = docs
          .filter(d => d && d.projectId === projectId.trim() && d.snapshotId === snapshotId)
          .map(d => {
            const copy = stripAbsolutePathsDeep({ ...d });
            if (!includeVectors) delete copy.vector;
            delete copy.termFreqs;
            delete copy.titleTokens;
            return copy;
          });
        searchDocCount = portableDocs.length;
        fs.mkdirSync(path.join(outputDir, 'search'), { recursive: true });
        files['search/docs.json'] = writeJsonAtomic(
          path.join(outputDir, 'search', 'docs.json'),
          portableDocs
        );
      }
    }

    const nonClaims = Object.freeze([
      'Not source of truth — preserved source evidence remains authoritative',
      'Portable package is advisory and offline-only',
      'Absolute host paths are redacted',
      'Embeddings default off; vectors included only when explicitly opted in',
      'Package 09 / live IBM i not included',
    ]);

    const manifest = {
      kind: PORTABLE_PACKAGE_KIND,
      schema: PORTABLE_PACKAGE_SCHEMA,
      projectId: projectId.trim(),
      snapshotId,
      createdAt: new Date().toISOString(),
      sourceOfTruth: false,
      advisory: true,
      offlineOnly: true,
      embeddings: {
        included: includeVectors,
        policyReasonCode: embeddingPolicy.reasonCode,
        useForRanking: false,
      },
      counts: {
        sourceUnits: equalityView.units.length,
        symbols: equalityView.symbols.length,
        relationships: equalityView.relationships.length,
        searchDocs: searchDocCount,
      },
      files,
      nonClaims: [...nonClaims],
    };

    const manifestBody = `${JSON.stringify(manifest, null, 2)}\n`;
    assertNoHostPathLeak(manifestBody);
    for (const rel of Object.keys(files)) {
      const part = fs.readFileSync(path.join(outputDir, rel), 'utf8');
      assertNoHostPathLeak(part);
    }
    writeJsonAtomic(path.join(outputDir, 'portable-manifest.json'), manifest);

    return stripAbsolutePathsDeep({
      ok: true,
      kind: PORTABLE_PACKAGE_KIND,
      schema: PORTABLE_PACKAGE_SCHEMA,
      projectId: projectId.trim(),
      snapshotId,
      counts: manifest.counts,
      embeddings: manifest.embeddings,
      files: Object.keys(files).concat(['portable-manifest.json']).sort(),
      nonClaims: [...nonClaims],
    });
  } finally {
    if (engine) {
      try {
        engine.close();
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Open and validate a portable snapshot package (read-only inspect).
 *
 * @param {object} options
 * @param {string} options.packageDir absolute path to package directory
 * @returns {object}
 */
function openPortableSnapshotPackage(options = {}) {
  const packageDir = options.packageDir;
  if (typeof packageDir !== 'string' || !path.isAbsolute(packageDir)) {
    fail(REASON_CODES.PATH_UNSAFE, 'packageDir must be an absolute path');
  }
  const manifestPath = path.join(packageDir, 'portable-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    fail(REASON_CODES.EXPORT_DENIED, 'portable-manifest.json missing');
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    fail(REASON_CODES.EXPORT_DENIED, 'portable-manifest.json unreadable');
  }
  if (!manifest || manifest.schema !== PORTABLE_PACKAGE_SCHEMA) {
    fail(REASON_CODES.SCHEMA_VERSION_UNSUPPORTED, 'unsupported portable package schema');
  }
  if (manifest.sourceOfTruth === true) {
    fail(REASON_CODES.CANONICALITY_VIOLATION, 'portable packages must not claim sourceOfTruth');
  }

  const files = manifest.files || {};
  for (const [rel, expectedHash] of Object.entries(files)) {
    const abs = path.join(packageDir, rel);
    if (!fs.existsSync(abs)) {
      fail(REASON_CODES.EXPORT_DENIED, `package part missing: ${rel}`);
    }
    const actual = sha256OfFile(abs);
    // expectedHash from writeJsonAtomic is hash of body including trailing newline
    if (expectedHash && actual !== expectedHash) {
      // recompute from string write path — accept either file hash match
      const body = fs.readFileSync(abs, 'utf8');
      if (sha256OfString(body) !== expectedHash && actual !== expectedHash) {
        fail(REASON_CODES.CONTENT_HASH_MISMATCH, `package part hash mismatch: ${rel}`);
      }
    }
    assertNoHostPathLeak(fs.readFileSync(abs, 'utf8'));
  }

  const equalityView = JSON.parse(
    fs.readFileSync(path.join(packageDir, 'equality-view.json'), 'utf8')
  );
  let searchDocs = null;
  const searchPath = path.join(packageDir, 'search', 'docs.json');
  if (fs.existsSync(searchPath)) {
    searchDocs = JSON.parse(fs.readFileSync(searchPath, 'utf8'));
  }

  return stripAbsolutePathsDeep({
    ok: true,
    kind: PORTABLE_PACKAGE_KIND,
    schema: PORTABLE_PACKAGE_SCHEMA,
    projectId: manifest.projectId,
    snapshotId: manifest.snapshotId,
    counts: manifest.counts,
    embeddings: manifest.embeddings,
    equalityView,
    searchDocCount: Array.isArray(searchDocs) ? searchDocs.length : 0,
    nonClaims: manifest.nonClaims || [],
    sourceOfTruth: false,
    advisory: true,
  });
}

module.exports = {
  PORTABLE_PACKAGE_SCHEMA,
  PORTABLE_PACKAGE_KIND,
  exportPortableSnapshotPackage,
  openPortableSnapshotPackage,
  stripAbsolutePathsDeep,
};
