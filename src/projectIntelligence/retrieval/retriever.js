'use strict';

const { openProjectKnowledgeStore } = require('../store/createStore');
const { openContentStoreFromKnowledgeRoot } = require('../content/contentStore');
const { createSearchProvider } = require('../search/searchProvider');
const { fail, REASON_CODES, KnowledgeStoreError } = require('../store/errors');
const { validateProjectIntelligenceContract, CONTRACT_IDS } = require('../validate');
const {
  DEFAULT_RETRIEVAL_LIMIT,
  DEFAULT_EXPAND_HOPS,
  DEFAULT_TOKEN_BUDGET,
  RETRIEVER_ID,
  RETRIEVER_VERSION,
  POLICY_ID,
  POLICY_VERSION,
} = require('./constants');
const { assembleContextPackage } = require('./contextAssembler');
const { normalizeTokenBudget } = require('./tokenBudget');

/**
 * Hybrid lexical + graph retriever for published project knowledge (ZPI-08).
 */
function createProjectRetriever(options = {}) {
  const { knowledgeRoot, projectId, trustedRoots = [], readOnly = true } = options;
  if (!knowledgeRoot) {
    fail(REASON_CODES.PATH_UNSAFE, 'knowledgeRoot is required');
  }

  const store = openProjectKnowledgeStore({
    rootPath: knowledgeRoot,
    projectId,
    readOnly,
  });
  const resolvedProjectId = projectId || store.projectId;

  let content = null;
  try {
    content = openContentStoreFromKnowledgeRoot(knowledgeRoot, {
      trustedRoots: trustedRoots.map(r => ({ rootId: r.rootId, path: r.path })),
      readOnly: true,
    });
  } catch {
    content = null;
  }

  let search;
  try {
    search = createSearchProvider({
      knowledgeRoot,
      projectId: resolvedProjectId,
      readOnly: true,
    });
  } catch (err) {
    store.close();
    throw err;
  }

  let closed = false;

  function assertOpen() {
    if (closed) fail(REASON_CODES.STORE_UNAVAILABLE, 'retriever is closed');
  }

  function resolveSnapshotId(snapshotId) {
    if (snapshotId) {
      const snap = store.getSnapshot(resolvedProjectId, snapshotId);
      if (snap.status !== 'published') {
        fail(REASON_CODES.SNAPSHOT_NOT_PUBLISHED, 'snapshot is not published');
      }
      return snap;
    }
    return store.getCurrentSnapshot(resolvedProjectId);
  }

  /**
   * Lexical retrieval against published snapshot index (filtered by snapshotId).
   */
  function retrieve({ query, snapshotId, filters = {}, limit } = {}) {
    assertOpen();
    if (typeof query !== 'string' || !query.trim()) {
      fail(REASON_CODES.SCHEMA_INVALID, 'query is required');
    }
    const snap = resolveSnapshotId(snapshotId);
    const result = search.search({
      query,
      limit: limit == null ? DEFAULT_RETRIEVAL_LIMIT : limit,
      filters: {
        ...filters,
        projectId: resolvedProjectId,
        snapshotId: snap.snapshotId,
      },
    });
    return {
      ...result,
      projectId: resolvedProjectId,
      snapshotId: snap.snapshotId,
      retrieverId: RETRIEVER_ID,
      retrieverVersion: RETRIEVER_VERSION,
    };
  }

  /**
   * Build a bounded context package (contract-valid).
   */
  function buildContextPackage(request = {}) {
    assertOpen();
    const {
      query,
      snapshotId,
      filters,
      limit,
      tokenBudget = DEFAULT_TOKEN_BUDGET,
      expandHops = DEFAULT_EXPAND_HOPS,
      includeBodies = true,
    } = request;

    const snap = resolveSnapshotId(snapshotId);
    const lexical = retrieve({
      query,
      snapshotId: snap.snapshotId,
      filters,
      limit,
    });

    const symbols = store.listSymbols(resolvedProjectId, snap.snapshotId);
    const relationships = store.listRelationships(resolvedProjectId, snap.snapshotId);
    const evidenceMeta = listEvidence(store, resolvedProjectId, snap.snapshotId);

    const assembled = assembleContextPackage({
      projectId: resolvedProjectId,
      snapshotId: snap.snapshotId,
      query,
      lexicalResult: lexical,
      symbols,
      relationships,
      evidenceMeta,
      contentStore: content,
      tokenBudget: normalizeTokenBudget(tokenBudget),
      expandHops,
      includeBodies,
    });

    const validation = validateProjectIntelligenceContract(
      CONTRACT_IDS.CONTEXT_PACKAGE,
      assembled.contextPackage
    );
    if (!validation.ok) {
      fail(REASON_CODES.SCHEMA_INVALID, 'assembled context package failed contract validation', {
        errors: validation.errors,
      });
    }

    return {
      ok: true,
      contextPackage: assembled.contextPackage,
      metrics: assembled.metrics,
      retrieval: {
        totalMatched: lexical.totalMatched,
        hitCount: (lexical.hits || []).length,
        omitted: lexical.omitted,
      },
      policy: { policyId: POLICY_ID, policyVersion: POLICY_VERSION },
      verification: assembled.verification,
    };
  }

  function listEvidence(storeHandle, pid, sid) {
    if (storeHandle._store && storeHandle._store._db) {
      try {
        const rows = storeHandle._store._db.all(
          `SELECT payload_json FROM evidence_meta
           WHERE project_id = @project_id AND snapshot_id = @snapshot_id
           ORDER BY evidence_id ASC`,
          { project_id: pid, snapshot_id: sid }
        );
        return rows.map(r => JSON.parse(r.payload_json));
      } catch {
        return [];
      }
    }
    return [];
  }

  function getStatus() {
    return {
      projectId: resolvedProjectId,
      knowledgeRoot,
      closed,
      retrieverId: RETRIEVER_ID,
      retrieverVersion: RETRIEVER_VERSION,
      policyId: POLICY_ID,
      hasContentStore: Boolean(content),
    };
  }

  function close() {
    if (closed) return;
    closed = true;
    try {
      search.close();
    } catch {
      // ignore
    }
    try {
      store.close();
    } catch {
      // ignore
    }
  }

  return {
    retrieve,
    buildContextPackage,
    getStatus,
    close,
    // hooks
    _store: store,
    _search: search,
  };
}

module.exports = {
  createProjectRetriever,
  KnowledgeStoreError,
};
