'use strict';

const {
  SEARCH_SCHEMA_VERSION,
  ENGINE_ID,
  ENGINE_VERSION,
  ANALYZER_ID,
  ANALYZER_VERSION,
} = require('./constants');
const { analyzerIdentity } = require('./analyzer');
const { createInvertedIndex } = require('./invertedIndex');
const {
  resolveIndexDir,
  loadIndexFiles,
  persistIndex,
  markCorrupt,
  exists,
  indexPaths,
} = require('./fileIndexStore');
const { fail, REASON_CODES, KnowledgeStoreError } = require('../store/errors');
const { resolveEmbeddingPolicy } = require('./embeddingPolicy');

/**
 * Create a Community lexical search provider (ZPI-05).
 *
 * Lucene-compatible SPI surface under the project `lucene/` layout.
 * Engine is pure-JS inverted index with deterministic ranking.
 * Embeddings default off (Track C / ADR-010).
 */
function createSearchProvider(options = {}) {
  const readOnly = Boolean(options.readOnly);
  const indexDir = resolveIndexDir(options);
  const projectId = options.projectId || null;
  let snapshotId = options.snapshotId || null;
  let generation = 1;
  let closed = false;
  const embeddingPolicy = resolveEmbeddingPolicy(options);

  const index = createInvertedIndex({ embeddingPolicy, ...options });

  // Load existing if present
  if (exists(indexDir)) {
    try {
      const loaded = loadIndexFiles(indexDir);
      index.load({ docs: loaded.docs, postings: loaded.postings });
      snapshotId = loaded.manifest.snapshotId || snapshotId;
      generation = Number(loaded.manifest.generation) || 1;
    } catch (err) {
      if (options.openMode === 'rebuild-on-corrupt') {
        index.clear();
        generation = 1;
      } else if (err instanceof KnowledgeStoreError) {
        throw err;
      } else {
        fail(REASON_CODES.INDEX_CORRUPT, 'failed to open search index');
      }
    }
  } else if (readOnly) {
    fail(REASON_CODES.INDEX_UNAVAILABLE, 'search index does not exist');
  }

  function assertOpen() {
    if (closed) fail(REASON_CODES.STORE_UNAVAILABLE, 'search provider is closed');
  }

  function assertWritable() {
    assertOpen();
    if (readOnly) fail(REASON_CODES.STORE_UNAVAILABLE, 'search index is read-only');
  }

  function indexDocuments(docs) {
    assertWritable();
    return index.addDocuments(docs);
  }

  function commit({ snapshotId: snap } = {}) {
    assertWritable();
    if (snap) snapshotId = snap;
    generation += 1;
    const serialized = index.serialize();
    const manifest = persistIndex(indexDir, {
      docs: serialized.docs,
      postings: serialized.postings,
      projectId,
      snapshotId,
      generation,
    });
    return {
      ok: true,
      generation,
      docCount: index.size(),
      manifest,
    };
  }

  /**
   * Full rebuild: replace index contents atomically via rewrite + commit.
   */
  function rebuild(docs, rebuildOptions = {}) {
    assertWritable();
    if (!Array.isArray(docs)) {
      fail(REASON_CODES.SCHEMA_INVALID, 'rebuild requires a documents array');
    }
    index.clear();
    index.addDocuments(docs);
    if (rebuildOptions.snapshotId) snapshotId = rebuildOptions.snapshotId;
    generation += 1;
    const serialized = index.serialize();
    const manifest = persistIndex(indexDir, {
      docs: serialized.docs,
      postings: serialized.postings,
      projectId,
      snapshotId,
      generation,
    });
    return {
      ok: true,
      rebuilt: true,
      generation,
      docCount: index.size(),
      manifest,
    };
  }

  function search(request = {}) {
    assertOpen();
    try {
      const result = index.search(request);
      return {
        schemaVersion: 1,
        kind: 'project-knowledge-search-result',
        engineId: ENGINE_ID,
        engineVersion: ENGINE_VERSION,
        analyzerId: ANALYZER_ID,
        analyzerVersion: ANALYZER_VERSION,
        searchSchemaVersion: SEARCH_SCHEMA_VERSION,
        projectId,
        snapshotId,
        query: request.query,
        filters: request.filters || {},
        hits: result.hits,
        totalMatched: result.totalMatched,
        limit: result.limit,
        offset: result.offset,
        omitted: result.omitted,
        queryTokens: result.queryTokens,
        // Rankings are derived aids, not source evidence
        sourceOfTruth: false,
        advisory: true,
      };
    } catch (err) {
      if (err instanceof KnowledgeStoreError) throw err;
      fail(REASON_CODES.RETRIEVAL_FAILED, 'search operation failed');
    }
  }

  function checkIntegrity() {
    assertOpen();
    try {
      if (!exists(indexDir)) {
        return { ok: false, reasonCode: REASON_CODES.INDEX_UNAVAILABLE, messages: ['missing'] };
      }
      const loaded = loadIndexFiles(indexDir);
      // Re-verify in-memory vs disk doc counts
      if (loaded.docs.length !== index.size()) {
        return {
          ok: false,
          reasonCode: REASON_CODES.INDEX_CORRUPT,
          messages: ['doc count mismatch between memory and disk'],
        };
      }
      // Spot-check: every doc has docId
      for (const d of loaded.docs) {
        if (!d.docId) {
          return {
            ok: false,
            reasonCode: REASON_CODES.INDEX_CORRUPT,
            messages: ['doc missing docId'],
          };
        }
      }
      return {
        ok: true,
        reasonCode: null,
        messages: ['ok'],
        docCount: index.size(),
        generation,
      };
    } catch (err) {
      if (err instanceof KnowledgeStoreError) {
        return { ok: false, reasonCode: err.reasonCode, messages: [err.message] };
      }
      return {
        ok: false,
        reasonCode: REASON_CODES.INDEX_CORRUPT,
        messages: ['integrity check failed'],
      };
    }
  }

  /**
   * Mark index corrupt and clear memory. Call rebuild() to recover.
   */
  function markCorruptAndRequireRebuild(reason) {
    assertWritable();
    markCorrupt(indexDir, reason || 'manual corrupt mark');
    index.clear();
    return { ok: true, reasonCode: REASON_CODES.INDEX_REBUILD_REQUIRED };
  }

  /**
   * Recover from corrupt index by rebuild with provided documents.
   */
  function recoverFromCorrupt(docs, recoverOptions = {}) {
    assertWritable();
    return rebuild(docs, recoverOptions);
  }

  function getStatus() {
    return {
      indexDir,
      readOnly,
      projectId,
      snapshotId,
      generation,
      docCount: index.size(),
      engineId: ENGINE_ID,
      engineVersion: ENGINE_VERSION,
      analyzer: analyzerIdentity(),
      searchSchemaVersion: SEARCH_SCHEMA_VERSION,
      embeddingPolicy: {
        enabled: embeddingPolicy.enabled,
        useForRanking: embeddingPolicy.useForRanking,
        reasonCode: embeddingPolicy.reasonCode,
      },
      closed,
    };
  }

  function close() {
    closed = true;
  }

  return {
    // SPI
    indexDocuments,
    commit,
    rebuild,
    search,
    checkIntegrity,
    markCorruptAndRequireRebuild,
    recoverFromCorrupt,
    getStatus,
    close,
    embeddingPolicy,
    // identity helpers
    ENGINE_ID,
    SEARCH_SCHEMA_VERSION,
    _index: index,
    _paths: indexPaths(indexDir),
  };
}

function openSearchProvider(options = {}) {
  return createSearchProvider({ ...options, openMode: options.openMode || 'strict' });
}

module.exports = {
  createSearchProvider,
  openSearchProvider,
};
