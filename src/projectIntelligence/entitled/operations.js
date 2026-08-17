'use strict';

const path = require('path');
const { createSnapshotEngine, openSnapshotEngine, createProjectRetriever, expandNeighborhood } = {
  ...require('../engine'),
  ...require('../retrieval'),
};

const { REASON_CODES } = require('../../entitlement/reasonCodes');
const { NON_CLAIMS, NON_CLAIM_MESSAGES, DEFAULT_RESOURCE_POLICY } = require('./constants');
const { validateTrustedRoots } = require('./trustedRoots');
const { evaluateResourcePolicy } = require('./resourcePolicy');

function redact(value) {
  return String(value || '')
    .replace(/[A-Za-z]:\\[^\s"']+/g, '<redacted-path>')
    .replace(/\/(?:Users|home)\/[^\s"']+/g, '<redacted-path>')
    .replace(/(password|secret|token|license)\s*[:=]\s*\S+/gi, '$1=<redacted>');
}

function claimsEnvelope(extra = {}) {
  return {
    commercial: true,
    advisory: true,
    claims: { ...NON_CLAIMS },
    nonClaims: [...NON_CLAIM_MESSAGES],
    ...extra,
  };
}

function failOp(reasonCode, message, extra = {}) {
  return claimsEnvelope({
    ok: false,
    reasonCode,
    message: redact(message),
    ...extra,
  });
}

function okOp(payload = {}) {
  return claimsEnvelope({
    ok: true,
    reasonCode: REASON_CODES.AVAILABLE,
    ...payload,
  });
}

function requireString(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    return `${name} is required`;
  }
  return null;
}

function requireAbsolutePath(value, name) {
  const err = requireString(value, name);
  if (err) return err;
  if (!path.isAbsolute(value)) return `${name} must be an absolute path`;
  return null;
}

function resolvePolicy(ctx = {}) {
  return ctx.resourcePolicy || DEFAULT_RESOURCE_POLICY;
}

/**
 * Shared preflight for ops: validates trusted roots + resource policy.
 * Absolute host paths are never returned.
 */
function preflightRootsAndPolicy(input, resourcePolicy) {
  const policyEval = evaluateResourcePolicy(
    {
      trustedRoots: input.trustedRoots,
      tokenBudget: input.tokenBudget,
      retrievalLimit: input.limit || input.retrievalLimit,
    },
    resourcePolicy
  );
  if (!policyEval.ok) {
    return failOp(policyEval.reasonCode, policyEval.message);
  }
  const roots = validateTrustedRoots(input.trustedRoots || [], { maxRoots: 16 });
  if (!roots.ok) {
    return failOp(roots.reasonCode, roots.message);
  }
  return { ok: true, policy: policyEval.policy, rootCount: roots.rootCount };
}

function resolveTrustedRootsForEngine(input) {
  // Engine needs absolute paths; public results never echo them.
  return (input.trustedRoots || []).map(r => ({
    rootId: String(r.rootId).trim(),
    path: path.resolve(String(r.path).trim()),
  }));
}

function stripAbsolutePathsDeep(value, depth = 0) {
  if (depth > 12) return null;
  if (value == null) return value;
  if (typeof value === 'string') return redact(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(v => stripAbsolutePathsDeep(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'path' || k === 'absolutePath' || k === 'realPath' || k === 'dbPath') {
        out[k] = typeof v === 'string' ? '<redacted-path>' : null;
        continue;
      }
      if (k === '_store' || k === '_search' || k === '_db' || k === '_canonicalBytes') continue;
      out[k] = stripAbsolutePathsDeep(v, depth + 1);
    }
    return out;
  }
  return null;
}

function closeQuietly(handle) {
  if (!handle) return;
  try {
    handle.close();
  } catch {
    // ignore close failures
  }
}

/**
 * Create commercial project-knowledge workspace.
 */
function createProjectKnowledge(input = {}, ctx = {}) {
  const knowledgeRootErr = requireAbsolutePath(input.knowledgeRoot, 'knowledgeRoot');
  if (knowledgeRootErr) return failOp(REASON_CODES.POLICY_DENIED, knowledgeRootErr);
  const projectIdErr = requireString(input.projectId, 'projectId');
  if (projectIdErr) return failOp(REASON_CODES.POLICY_DENIED, projectIdErr);

  const resourcePolicy = resolvePolicy(ctx);
  const pre = preflightRootsAndPolicy(input, resourcePolicy);
  if (!pre.ok) return pre;

  let engine;
  try {
    engine = createSnapshotEngine({
      knowledgeRoot: path.resolve(input.knowledgeRoot),
      projectId: String(input.projectId).trim(),
      displayName: input.displayName,
      trustedRoots: resolveTrustedRootsForEngine(input),
    });
    const status = engine.getStatus();
    return okOp({
      operation: 'create-project',
      projectId: status.projectId,
      knowledgeRootSet: true,
    });
  } catch (err) {
    return failOp(
      (err && err.reasonCode) || REASON_CODES.POLICY_DENIED,
      (err && err.message) || 'create project failed'
    );
  } finally {
    closeQuietly(engine);
  }
}

function fullIndex(input = {}, ctx = {}) {
  const knowledgeRootErr = requireAbsolutePath(input.knowledgeRoot, 'knowledgeRoot');
  if (knowledgeRootErr) return failOp(REASON_CODES.POLICY_DENIED, knowledgeRootErr);
  const projectIdErr = requireString(input.projectId, 'projectId');
  if (projectIdErr) return failOp(REASON_CODES.POLICY_DENIED, projectIdErr);

  const resourcePolicy = resolvePolicy(ctx);
  const pre = preflightRootsAndPolicy(input, resourcePolicy);
  if (!pre.ok) return pre;

  let engine;
  try {
    engine = openSnapshotEngine({
      knowledgeRoot: path.resolve(input.knowledgeRoot),
      projectId: String(input.projectId).trim(),
      trustedRoots: resolveTrustedRootsForEngine(input),
      readOnly: false,
    });
    const result = engine.fullRebuild();
    if (
      result.counts &&
      result.counts.sourceUnits > Number(resourcePolicy.maxSourceUnitsPerProject)
    ) {
      return failOp(
        REASON_CODES.POLICY_DENIED,
        'Source unit count exceeds commercial resource policy maximum.'
      );
    }
    return okOp({
      operation: 'full-index',
      published: Boolean(result.published),
      mode: result.mode,
      snapshotId: result.snapshot && result.snapshot.snapshotId,
      sourceInventoryHash: result.snapshot && result.snapshot.sourceInventoryHash,
      counts: result.counts,
      analyzer: result.analyzer,
    });
  } catch (err) {
    return failOp(
      (err && err.reasonCode) || REASON_CODES.POLICY_DENIED,
      (err && err.message) || 'full index failed'
    );
  } finally {
    closeQuietly(engine);
  }
}

function incrementalUpdate(input = {}, ctx = {}) {
  const knowledgeRootErr = requireAbsolutePath(input.knowledgeRoot, 'knowledgeRoot');
  if (knowledgeRootErr) return failOp(REASON_CODES.POLICY_DENIED, knowledgeRootErr);
  const projectIdErr = requireString(input.projectId, 'projectId');
  if (projectIdErr) return failOp(REASON_CODES.POLICY_DENIED, projectIdErr);

  const resourcePolicy = resolvePolicy(ctx);
  const pre = preflightRootsAndPolicy(input, resourcePolicy);
  if (!pre.ok) return pre;

  let engine;
  try {
    engine = openSnapshotEngine({
      knowledgeRoot: path.resolve(input.knowledgeRoot),
      projectId: String(input.projectId).trim(),
      trustedRoots: resolveTrustedRootsForEngine(input),
      readOnly: false,
    });
    const result = engine.incrementalUpdate();
    return okOp({
      operation: 'incremental-update',
      published: Boolean(result.published),
      mode: result.mode,
      snapshotId: result.snapshot && result.snapshot.snapshotId,
      sourceInventoryHash: result.snapshot && result.snapshot.sourceInventoryHash,
      counts: result.counts,
      diff: result.diff
        ? {
            counts: result.diff.counts,
            isNoOp: result.diff.isNoOp,
          }
        : null,
      analyzer: result.analyzer,
    });
  } catch (err) {
    return failOp(
      (err && err.reasonCode) || REASON_CODES.POLICY_DENIED,
      (err && err.message) || 'incremental update failed'
    );
  } finally {
    closeQuietly(engine);
  }
}

function queryKnowledge(input = {}, ctx = {}) {
  const knowledgeRootErr = requireAbsolutePath(input.knowledgeRoot, 'knowledgeRoot');
  if (knowledgeRootErr) return failOp(REASON_CODES.POLICY_DENIED, knowledgeRootErr);
  const projectIdErr = requireString(input.projectId, 'projectId');
  if (projectIdErr) return failOp(REASON_CODES.POLICY_DENIED, projectIdErr);
  const queryErr = requireString(input.query, 'query');
  if (queryErr) return failOp(REASON_CODES.POLICY_DENIED, queryErr);

  const resourcePolicy = resolvePolicy(ctx);
  const limit = input.limit == null ? 20 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1) {
    return failOp(REASON_CODES.POLICY_DENIED, 'limit must be a positive integer');
  }
  if (limit > Number(resourcePolicy.maxRetrievalLimit)) {
    return failOp(REASON_CODES.POLICY_DENIED, 'limit exceeds commercial resource policy maximum');
  }

  const pre = preflightRootsAndPolicy(input, resourcePolicy);
  if (!pre.ok) return pre;

  let retriever;
  try {
    retriever = createProjectRetriever({
      knowledgeRoot: path.resolve(input.knowledgeRoot),
      projectId: String(input.projectId).trim(),
      trustedRoots: resolveTrustedRootsForEngine(input),
      readOnly: true,
    });
    const result = retriever.retrieve({
      query: String(input.query).trim(),
      snapshotId: input.snapshotId,
      limit,
      filters: input.filters,
    });
    return okOp({
      operation: 'query',
      projectId: result.projectId,
      snapshotId: result.snapshotId,
      totalMatched: result.totalMatched,
      omitted: result.omitted,
      hits: stripAbsolutePathsDeep(result.hits || []),
    });
  } catch (err) {
    return failOp(
      (err && err.reasonCode) || REASON_CODES.POLICY_DENIED,
      (err && err.message) || 'query failed'
    );
  } finally {
    closeQuietly(retriever);
  }
}

function impactAnalysis(input = {}, ctx = {}) {
  // Impact = query + graph neighborhood expansion (commercial orchestration over Community graph)
  const base = queryKnowledge({ ...input, limit: input.limit || 20 }, ctx);
  if (!base.ok) return base;

  let engine;
  try {
    engine = openSnapshotEngine({
      knowledgeRoot: path.resolve(input.knowledgeRoot),
      projectId: String(input.projectId).trim(),
      trustedRoots: resolveTrustedRootsForEngine(input),
      readOnly: true,
    });
    const snap = engine.getCurrentSnapshot();
    const symbols = engine._store.listSymbols(input.projectId, snap.snapshotId);
    const relationships = engine._store.listRelationships(input.projectId, snap.snapshotId);
    const seedIds = (base.hits || [])
      .map(h => {
        const id = h.docId || '';
        if (id.startsWith('doc:symbol:')) return id.slice('doc:symbol:'.length);
        return null;
      })
      .filter(Boolean);
    // Also seed by name match on query token
    const q = String(input.query || '')
      .toUpperCase()
      .split(/\s+/)
      .filter(Boolean);
    for (const s of symbols) {
      if (q.includes(String(s.name || '').toUpperCase())) seedIds.push(s.symbolId);
    }
    const hops = input.expandHops == null ? 1 : Number(input.expandHops);
    const neighborhood = expandNeighborhood(
      Array.from(new Set(seedIds)).sort(),
      relationships,
      Number.isFinite(hops) ? hops : 1
    );
    const symbolById = new Map(symbols.map(s => [s.symbolId, s]));
    const impacted = neighborhood.nodes.map(id => {
      const s = symbolById.get(id);
      return {
        symbolId: id,
        name: s ? s.name : id,
        symbolKind: s ? s.symbolKind : 'UNKNOWN',
      };
    });
    return okOp({
      operation: 'impact-analysis',
      projectId: String(input.projectId).trim(),
      snapshotId: snap.snapshotId,
      seeds: Array.from(new Set(seedIds)).sort(),
      impactedSymbols: impacted,
      relationships: stripAbsolutePathsDeep(neighborhood.edges),
      hitCount: (base.hits || []).length,
    });
  } catch (err) {
    return failOp(
      (err && err.reasonCode) || REASON_CODES.POLICY_DENIED,
      (err && err.message) || 'impact analysis failed'
    );
  } finally {
    closeQuietly(engine);
  }
}

function buildContextPackage(input = {}, ctx = {}) {
  const knowledgeRootErr = requireAbsolutePath(input.knowledgeRoot, 'knowledgeRoot');
  if (knowledgeRootErr) return failOp(REASON_CODES.POLICY_DENIED, knowledgeRootErr);
  const projectIdErr = requireString(input.projectId, 'projectId');
  if (projectIdErr) return failOp(REASON_CODES.POLICY_DENIED, projectIdErr);
  const queryErr = requireString(input.query, 'query');
  if (queryErr) return failOp(REASON_CODES.POLICY_DENIED, queryErr);

  const resourcePolicy = resolvePolicy(ctx);
  const tokenBudget = input.tokenBudget == null ? 4000 : Number(input.tokenBudget);
  if (!Number.isFinite(tokenBudget) || tokenBudget <= 0) {
    return failOp(REASON_CODES.POLICY_DENIED, 'tokenBudget must be positive');
  }
  if (tokenBudget > Number(resourcePolicy.maxContextTokenBudget)) {
    return failOp(
      REASON_CODES.POLICY_DENIED,
      'tokenBudget exceeds commercial resource policy maximum'
    );
  }

  const pre = preflightRootsAndPolicy(input, resourcePolicy);
  if (!pre.ok) return pre;

  let retriever;
  try {
    retriever = createProjectRetriever({
      knowledgeRoot: path.resolve(input.knowledgeRoot),
      projectId: String(input.projectId).trim(),
      trustedRoots: resolveTrustedRootsForEngine(input),
      readOnly: true,
    });
    const result = retriever.buildContextPackage({
      query: String(input.query).trim(),
      snapshotId: input.snapshotId,
      tokenBudget,
      expandHops: input.expandHops == null ? 1 : input.expandHops,
      includeBodies: input.includeBodies !== false,
      limit: input.limit,
    });
    return okOp({
      operation: 'build-context-package',
      contextPackage: stripAbsolutePathsDeep(result.contextPackage),
      metrics: result.metrics,
      retrieval: stripAbsolutePathsDeep(result.retrieval),
      policy: result.policy,
    });
  } catch (err) {
    return failOp(
      (err && err.reasonCode) || REASON_CODES.POLICY_DENIED,
      (err && err.message) || 'build context package failed'
    );
  } finally {
    closeQuietly(retriever);
  }
}

function inspectSnapshot(input = {}, ctx = {}) {
  const knowledgeRootErr = requireAbsolutePath(input.knowledgeRoot, 'knowledgeRoot');
  if (knowledgeRootErr) return failOp(REASON_CODES.POLICY_DENIED, knowledgeRootErr);
  const projectIdErr = requireString(input.projectId, 'projectId');
  if (projectIdErr) return failOp(REASON_CODES.POLICY_DENIED, projectIdErr);

  const resourcePolicy = resolvePolicy(ctx);
  const pre = preflightRootsAndPolicy(input, resourcePolicy);
  if (!pre.ok) return pre;

  let engine;
  try {
    engine = openSnapshotEngine({
      knowledgeRoot: path.resolve(input.knowledgeRoot),
      projectId: String(input.projectId).trim(),
      trustedRoots: resolveTrustedRootsForEngine(input),
      readOnly: true,
    });
    const projectId = String(input.projectId).trim();
    const snap = input.snapshotId
      ? engine._store.getSnapshot(projectId, input.snapshotId)
      : engine.getCurrentSnapshot();
    if (!snap) {
      return failOp(REASON_CODES.POLICY_DENIED, 'snapshot not found');
    }
    const units = engine._store.listSourceUnits(projectId, snap.snapshotId);
    const symbols = engine._store.listSymbols(projectId, snap.snapshotId);
    const relationships = engine._store.listRelationships(projectId, snap.snapshotId);
    return okOp({
      operation: 'inspect-snapshot',
      snapshot: {
        snapshotId: snap.snapshotId,
        status: snap.status,
        isCurrent: Boolean(snap.isCurrent),
        sourceInventoryHash: snap.sourceInventoryHash,
        storeSchemaVersion: snap.storeSchemaVersion,
        searchSchemaVersion: snap.searchSchemaVersion,
        artifactSchemaVersion: snap.artifactSchemaVersion,
      },
      counts: {
        sourceUnits: units.length,
        symbols: symbols.length,
        relationships: relationships.length,
      },
    });
  } catch (err) {
    return failOp(
      (err && err.reasonCode) || REASON_CODES.POLICY_DENIED,
      (err && err.message) || 'inspect snapshot failed'
    );
  } finally {
    closeQuietly(engine);
  }
}

function verifyIntegrity(input = {}, ctx = {}) {
  const knowledgeRootErr = requireAbsolutePath(input.knowledgeRoot, 'knowledgeRoot');
  if (knowledgeRootErr) return failOp(REASON_CODES.POLICY_DENIED, knowledgeRootErr);
  const projectIdErr = requireString(input.projectId, 'projectId');
  if (projectIdErr) return failOp(REASON_CODES.POLICY_DENIED, projectIdErr);

  const resourcePolicy = resolvePolicy(ctx);
  const pre = preflightRootsAndPolicy(input, resourcePolicy);
  if (!pre.ok) return pre;

  let engine;
  let retriever;
  try {
    engine = openSnapshotEngine({
      knowledgeRoot: path.resolve(input.knowledgeRoot),
      projectId: String(input.projectId).trim(),
      trustedRoots: resolveTrustedRootsForEngine(input),
      readOnly: true,
    });
    const storeIntegrity = engine._store.checkIntegrity();
    let stale = null;
    try {
      engine.assertCurrentNotStale();
      stale = { ok: true };
    } catch (err) {
      stale = {
        ok: false,
        reasonCode: (err && err.reasonCode) || null,
        message: redact((err && err.message) || 'stale check failed'),
      };
    }
    let searchIntegrity = { ok: null };
    try {
      retriever = createProjectRetriever({
        knowledgeRoot: path.resolve(input.knowledgeRoot),
        projectId: String(input.projectId).trim(),
        trustedRoots: resolveTrustedRootsForEngine(input),
        readOnly: true,
      });
      if (retriever._search && typeof retriever._search.checkIntegrity === 'function') {
        searchIntegrity = retriever._search.checkIntegrity();
      }
    } catch (err) {
      searchIntegrity = {
        ok: false,
        reasonCode: (err && err.reasonCode) || null,
        message: redact((err && err.message) || 'search integrity failed'),
      };
    }

    return okOp({
      operation: 'verify-integrity',
      store: stripAbsolutePathsDeep(storeIntegrity),
      currentSnapshotFreshness: stale,
      search: stripAbsolutePathsDeep(searchIntegrity),
      overallOk: storeIntegrity.ok === true,
    });
  } catch (err) {
    return failOp(
      (err && err.reasonCode) || REASON_CODES.POLICY_DENIED,
      (err && err.message) || 'verify integrity failed'
    );
  } finally {
    closeQuietly(retriever);
    closeQuietly(engine);
  }
}

module.exports = {
  createProjectKnowledge,
  fullIndex,
  incrementalUpdate,
  queryKnowledge,
  impactAnalysis,
  buildContextPackage,
  inspectSnapshot,
  verifyIntegrity,
  claimsEnvelope,
  failOp,
  okOp,
  stripAbsolutePathsDeep,
  redact,
};
