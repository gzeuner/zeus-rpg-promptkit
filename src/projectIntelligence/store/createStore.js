'use strict';

const fs = require('fs');
const { STORE_SCHEMA_VERSION, STORE_MODES, META_KEYS } = require('./constants');
const { ensureLayoutDirs, knowledgePaths, readManifest, writeManifestAtomic } = require('./layout');
const { acquireWriterLock, inspectWriterLock } = require('./writerLock');
const { createSqliteKnowledgeStore } = require('./sqliteKnowledgeStore');
const { probeNodeSqlite, DRIVER_ID } = require('./sqliteDriver');
const { fail, REASON_CODES, KnowledgeStoreError } = require('./errors');

/**
 * Create a new project-knowledge store on disk.
 * Acquires the writer lock for the lifetime of the returned handle.
 */
function createProjectKnowledgeStore({ rootPath, projectId, displayName, trustedRoots } = {}) {
  if (typeof projectId !== 'string' || !projectId.trim()) {
    fail(REASON_CODES.PROJECT_ID_INVALID, 'projectId is required');
  }
  if (!probeNodeSqlite().available) {
    fail(
      REASON_CODES.STORE_UNAVAILABLE,
      'SQLite driver unavailable (requires Node.js node:sqlite / DatabaseSync)'
    );
  }

  const paths = ensureLayoutDirs(rootPath);
  if (fs.existsSync(paths.sqlite) || fs.existsSync(paths.manifest)) {
    fail(REASON_CODES.STORE_UNAVAILABLE, 'project knowledge store already exists at root');
  }

  const lock = acquireWriterLock(paths.writerLock, { owner: `create:${projectId}` });
  let store;
  try {
    store = createSqliteKnowledgeStore({
      dbPath: paths.sqlite,
      projectId,
      readOnly: false,
    });

    const project = {
      schemaVersion: 1,
      kind: 'project-knowledge-project',
      contractId: 'zeus.project-knowledge-project',
      projectId,
      displayName: displayName || projectId,
      trustedRoots: trustedRoots || [{ rootId: 'root-default', relativeLabel: 'src' }],
      schemaBindings: {
        storeSchemaVersion: STORE_SCHEMA_VERSION,
        searchSchemaVersion: 1,
        artifactSchemaVersion: 1,
      },
      safety: { level: 'S1', localOnly: true },
    };
    store.putProject(project);

    writeManifestAtomic(paths.root, {
      schemaVersion: 1,
      kind: 'project-knowledge-manifest',
      projectId,
      storeSchemaVersion: STORE_SCHEMA_VERSION,
      driver: DRIVER_ID,
      createdAt: new Date().toISOString(),
      layout: {
        sqlite: 'knowledge.sqlite',
        content: 'content/',
        lucene: 'lucene/',
        locks: 'locks/',
      },
    });
  } catch (err) {
    try {
      lock.release();
    } catch {
      // ignore
    }
    if (store) {
      try {
        store.close();
      } catch {
        // ignore
      }
    }
    if (err instanceof KnowledgeStoreError) throw err;
    fail(REASON_CODES.STORE_UNAVAILABLE, 'failed to create project knowledge store', {
      message: err && err.message ? String(err.message) : undefined,
    });
  }

  return wrapHandle({ store, lock, paths, mode: STORE_MODES.CREATE, projectId });
}

/**
 * Open an existing project-knowledge store.
 */
function openProjectKnowledgeStore({ rootPath, projectId, readOnly = false } = {}) {
  const paths = knowledgePaths(rootPath);
  if (!fs.existsSync(paths.sqlite)) {
    fail(REASON_CODES.STORE_UNAVAILABLE, 'project knowledge sqlite file not found');
  }

  const manifest = readManifest(paths.root);
  const resolvedProjectId = projectId || (manifest && manifest.projectId) || null;
  if (!resolvedProjectId) {
    fail(
      REASON_CODES.PROJECT_ID_INVALID,
      'projectId is required when manifest is missing projectId'
    );
  }
  if (manifest && manifest.projectId && projectId && manifest.projectId !== projectId) {
    fail(REASON_CODES.PROJECT_ID_INVALID, 'projectId does not match store manifest');
  }
  if (manifest && manifest.storeSchemaVersion != null) {
    const v = Number(manifest.storeSchemaVersion);
    if (Number.isInteger(v) && v > STORE_SCHEMA_VERSION) {
      fail(
        REASON_CODES.MIGRATION_UNSUPPORTED,
        'manifest requires unsupported future store schema',
        {
          version: v,
        }
      );
    }
  }

  if (!probeNodeSqlite().available) {
    fail(
      REASON_CODES.STORE_UNAVAILABLE,
      'SQLite driver unavailable (requires Node.js node:sqlite / DatabaseSync)'
    );
  }

  let lock = null;
  if (!readOnly) {
    lock = acquireWriterLock(paths.writerLock, { owner: `open:${resolvedProjectId}` });
  }

  let store;
  try {
    store = createSqliteKnowledgeStore({
      dbPath: paths.sqlite,
      projectId: resolvedProjectId,
      readOnly,
    });
    // Touch project existence for writable opens.
    if (!readOnly) {
      store.getProject(resolvedProjectId);
    }
  } catch (err) {
    if (lock) {
      try {
        lock.release();
      } catch {
        // ignore
      }
    }
    if (store) {
      try {
        store.close();
      } catch {
        // ignore
      }
    }
    if (err instanceof KnowledgeStoreError) throw err;
    fail(REASON_CODES.STORE_UNAVAILABLE, 'failed to open project knowledge store', {
      message: err && err.message ? String(err.message) : undefined,
    });
  }

  return wrapHandle({
    store,
    lock,
    paths,
    mode: readOnly ? STORE_MODES.READ_ONLY : STORE_MODES.OPEN,
    projectId: resolvedProjectId,
  });
}

function wrapHandle({ store, lock, paths, mode, projectId }) {
  let closed = false;

  function close() {
    if (closed) return;
    closed = true;
    try {
      store.close();
    } finally {
      if (lock) {
        try {
          lock.release();
        } catch {
          // ignore release races in tests
        }
      }
    }
  }

  return {
    projectId,
    mode,
    paths,
    lock: lock ? { token: lock.token, acquiredAt: lock.acquiredAt, path: lock.lockPath } : null,
    getStatus: () => store.getStatus(),
    checkIntegrity: () => store.checkIntegrity(),
    withTransaction: fn => store.withTransaction(fn),
    putProject: p => store.putProject(p),
    getProject: id => store.getProject(id),
    putSnapshot: s => store.putSnapshot(s),
    getSnapshot: (pid, sid) => store.getSnapshot(pid, sid),
    listSnapshots: pid => store.listSnapshots(pid),
    publishSnapshot: (pid, sid, opts) => store.publishSnapshot(pid, sid, opts),
    getCurrentSnapshot: pid => store.getCurrentSnapshot(pid),
    putSourceUnit: u => store.putSourceUnit(u),
    listSourceUnits: (pid, sid) => store.listSourceUnits(pid, sid),
    putSymbol: s => store.putSymbol(s),
    listSymbols: (pid, sid) => store.listSymbols(pid, sid),
    putRelationship: r => store.putRelationship(r),
    listRelationships: (pid, sid) => store.listRelationships(pid, sid),
    putAnalyzerRun: r => store.putAnalyzerRun(r),
    putEvidenceMeta: e => store.putEvidenceMeta(e),
    seal: () => store.seal(),
    close,
    // test hooks
    _store: store,
    _inspectLock: () => inspectWriterLock(paths.writerLock),
  };
}

module.exports = {
  createProjectKnowledgeStore,
  openProjectKnowledgeStore,
  STORE_MODES,
  META_KEYS,
};
