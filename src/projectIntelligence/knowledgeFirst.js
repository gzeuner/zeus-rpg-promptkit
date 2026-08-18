'use strict';

const fs = require('fs');
const path = require('path');
const { createSnapshotEngine, openSnapshotEngine } = require('./engine');
const { createProjectRetriever } = require('./retrieval');
const { canonicalizeRelativePath } = require('./content/normalize');
const { KnowledgeStoreError, REASON_CODES } = require('./store/errors');

const KNOWLEDGE_FIRST_SCHEMA_VERSION = 1;
const SERVICE_ID = 'zeus.community.knowledge-first';

function requireAbsolute(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new KnowledgeStoreError(REASON_CODES.POLICY_DENIED, `${name} is required`);
  }
  if (!path.isAbsolute(value)) {
    throw new KnowledgeStoreError(REASON_CODES.PATH_UNSAFE, `${name} must be absolute`);
  }
  return path.resolve(value);
}

function normalizeRoots(trustedRoots) {
  if (trustedRoots == null) return [];
  if (!Array.isArray(trustedRoots)) {
    throw new KnowledgeStoreError(REASON_CODES.UNTRUSTED_ROOT, 'trustedRoots must be an array');
  }
  return trustedRoots.map((root, index) => {
    if (!root || typeof root !== 'object') {
      throw new KnowledgeStoreError(
        REASON_CODES.UNTRUSTED_ROOT,
        `trustedRoots[${index}] is invalid`
      );
    }
    if (typeof root.rootId !== 'string' || !root.rootId.trim()) {
      throw new KnowledgeStoreError(REASON_CODES.UNTRUSTED_ROOT, 'trusted root id is required');
    }
    return {
      rootId: root.rootId.trim(),
      path: requireAbsolute(root.path, `trustedRoots[${index}].path`),
      systemAlias:
        typeof root.systemAlias === 'string' && root.systemAlias.trim()
          ? root.systemAlias.trim()
          : root.rootId.trim(),
    };
  });
}

function sanitizePublic(value, depth = 0) {
  if (depth > 12 || value == null) return value == null ? value : null;
  if (typeof value === 'string') {
    return value
      .replace(/[A-Za-z]:\\[^\s"']+/g, '<redacted-path>')
      .replace(/\/(?:Users|home|private|var)\/[^\s"']+/g, '<redacted-path>');
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(entry => sanitizePublic(entry, depth + 1));
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key.startsWith('_')) continue;
    if (
      [
        'path',
        'absolutePath',
        'realPath',
        'dbPath',
        'knowledgeRoot',
        'host',
        'remotePath',
        'localDestination',
        'command',
        'stderr',
      ].includes(key) ||
      /(password|passwd|secret|token|apiKey|privateKey|credential)/i.test(key)
    ) {
      continue;
    }
    result[key] = sanitizePublic(entry, depth + 1);
  }
  return result;
}

function safeSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    snapshotId: snapshot.snapshotId,
    status: snapshot.status,
    isCurrent: Boolean(snapshot.isCurrent),
    sourceInventoryHash: snapshot.sourceInventoryHash,
    publishedAt: snapshot.publishedAt || null,
  };
}

function listEvidence(store, projectId, snapshotId) {
  if (!store || !store._store || !store._store._db) return [];
  try {
    const rows = store._store._db.all(
      `SELECT payload_json FROM evidence_meta
       WHERE project_id = @project_id AND snapshot_id = @snapshot_id
       ORDER BY evidence_id ASC`,
      { project_id: projectId, snapshot_id: snapshotId }
    );
    return rows.map(row => JSON.parse(row.payload_json));
  } catch {
    return [];
  }
}

function sourceLocation(unit) {
  if (!unit) return null;
  return sanitizePublic({
    trustedRootId: unit.trustedRootId,
    relativePath: unit.relativePath,
    sourceUnitId: unit.sourceUnitId,
    contentHash: unit.contentHash,
    rawBytesHash: unit.rawBytesHash || null,
    provenanceHash: unit.provenanceHash || null,
    importObservationHash: unit.importObservationHash || null,
    origin: unit.origin || null,
    importedCopyIntegrity: unit.importedCopyIntegrity || null,
  });
}

function sourceUnitIdFor(value) {
  return (
    (value && value.sourceUnitId) ||
    (value && value.provenance && value.provenance.sourceUnitId) ||
    (value && value._sourceUnitId) ||
    null
  );
}

const LOCATE_SELECTOR_KEYS = Object.freeze([
  'sourceUnitId',
  'trustedRootId',
  'relativePath',
  'systemAlias',
  'sourceLib',
  'sourceFile',
  'member',
  'memberPath',
  'sourceType',
]);

function normalizeLocateSelector(input = {}) {
  const candidate =
    input && input.selector && typeof input.selector === 'object' ? input.selector : input;
  const selector = {};
  for (const key of LOCATE_SELECTOR_KEYS) {
    if (candidate[key] === undefined || candidate[key] === null) continue;
    if (typeof candidate[key] !== 'string' || !candidate[key].trim()) {
      throw new KnowledgeStoreError(
        REASON_CODES.SCHEMA_INVALID,
        `${key} must be a non-empty string`
      );
    }
    const value = candidate[key].trim();
    if (key === 'relativePath') {
      selector[key] = canonicalizeRelativePath(value);
    } else if (key === 'memberPath') {
      selector[key] = value.replace(/\\/g, '/').toUpperCase();
      if (
        !/^\/QSYS\.LIB\/[A-Z0-9_$#@.\-]+\.LIB\/[A-Z0-9_$#@.\-]+\.FILE\/[A-Z0-9_$#@.\-]+\.MBR$/.test(
          selector[key]
        )
      ) {
        throw new KnowledgeStoreError(
          REASON_CODES.SCHEMA_INVALID,
          'memberPath must be a canonical IBM i member path'
        );
      }
    } else if (['systemAlias', 'sourceLib', 'sourceFile', 'member', 'sourceType'].includes(key)) {
      selector[key] = value.toUpperCase();
    } else {
      selector[key] = value;
    }
  }
  if (Object.keys(selector).length === 0) {
    throw new KnowledgeStoreError(
      REASON_CODES.SCHEMA_INVALID,
      `locate requires one of: ${LOCATE_SELECTOR_KEYS.join(', ')}`
    );
  }
  return selector;
}

function sourceLocator(unit) {
  const origin = unit && unit.origin ? unit.origin : {};
  return sanitizePublic({
    sourceUnitId: unit && unit.sourceUnitId,
    trustedRootId: unit && unit.trustedRootId,
    systemAlias: origin.systemAlias || null,
    relativePath: unit && unit.relativePath,
    sourceLib: origin.sourceLib || null,
    sourceFile: origin.sourceFile || null,
    member: origin.member || null,
    memberPath: origin.memberPath || null,
    sourceType: origin.sourceType || null,
    contentHash: unit && unit.contentHash,
  });
}

function locateMatches(units, selector) {
  return units.filter(unit => {
    const origin = unit.origin || {};
    for (const [key, expected] of Object.entries(selector)) {
      const actual =
        key === 'trustedRootId' || key === 'relativePath' || key === 'sourceUnitId'
          ? unit[key]
          : origin[key];
      if (actual == null || actual !== expected) return false;
    }
    return true;
  });
}

function publicFreshnessEnvelope(projectId, freshness, snapshot) {
  return {
    service: SERVICE_ID,
    schemaVersion: KNOWLEDGE_FIRST_SCHEMA_VERSION,
    projectId,
    snapshot: safeSnapshot(snapshot),
    freshness: sanitizePublic(freshness),
    authority: {
      evidenceCheckpoint: 'published-source-backed-snapshot',
      sourceOfTruth: false,
      advisory: true,
      retrieval: 'derived',
      sourceEvidence: 'authoritative only when located and content-hash matched',
    },
    freshnessScope: {
      local: 'trusted-roots-content-and-provenance-hash',
      remote: 'not-checked',
    },
    remoteFreshness: {
      status: 'unknown',
      reason: 'remote-not-checked',
      lastObservedAt:
        freshness && freshness.remoteFreshness ? freshness.remoteFreshness.lastObservedAt : null,
    },
  };
}

function createKnowledgeFirstService(options = {}) {
  const knowledgeRoot = requireAbsolute(options.knowledgeRoot, 'knowledgeRoot');
  if (typeof options.projectId !== 'string' || !options.projectId.trim()) {
    throw new KnowledgeStoreError(REASON_CODES.PROJECT_ID_INVALID, 'projectId is required');
  }
  const projectId = options.projectId.trim();
  const trustedRoots = normalizeRoots(options.trustedRoots);

  function engineOptions(readOnly) {
    return {
      knowledgeRoot,
      projectId,
      trustedRoots,
      readOnly,
    };
  }

  function inspect() {
    let engine;
    try {
      engine = openSnapshotEngine(engineOptions(true));
      const snapshot = (() => {
        try {
          return engine.getCurrentSnapshot();
        } catch {
          return null;
        }
      })();
      const freshness = engine.inspectFreshness();
      return {
        ok: true,
        operation: 'check',
        ...publicFreshnessEnvelope(projectId, freshness, snapshot),
        servable: Boolean(snapshot) && freshness.status === 'fresh',
      };
    } catch (err) {
      return {
        ok: false,
        operation: 'check',
        service: SERVICE_ID,
        schemaVersion: KNOWLEDGE_FIRST_SCHEMA_VERSION,
        projectId,
        reasonCode: (err && err.reasonCode) || REASON_CODES.STORE_UNAVAILABLE,
        message: 'Knowledge-First store is unavailable',
        freshness: {
          status: 'unknown',
          reasonCode: (err && err.reasonCode) || REASON_CODES.STORE_UNAVAILABLE,
        },
        servable: false,
      };
    } finally {
      if (engine) engine.close();
    }
  }

  function sync({ mode = 'incremental' } = {}) {
    if (!trustedRoots.length) {
      return {
        ok: false,
        operation: 'sync',
        service: SERVICE_ID,
        schemaVersion: KNOWLEDGE_FIRST_SCHEMA_VERSION,
        projectId,
        reasonCode: REASON_CODES.UNTRUSTED_ROOT,
        message: 'Explicit sync requires at least one trusted root',
        freshness: { status: 'unknown', reasonCode: REASON_CODES.UNTRUSTED_ROOT },
      };
    }
    if (mode !== 'incremental' && mode !== 'full') {
      throw new KnowledgeStoreError(
        REASON_CODES.POLICY_DENIED,
        'sync mode must be full or incremental'
      );
    }

    let engine;
    let created = false;
    try {
      const sqlitePath = path.join(knowledgeRoot, 'knowledge.sqlite');
      if (fs.existsSync(sqlitePath)) {
        engine = openSnapshotEngine(engineOptions(false));
      } else {
        engine = createSnapshotEngine({
          ...engineOptions(false),
          displayName: options.displayName,
        });
        created = true;
      }
      const result = mode === 'full' || created ? engine.fullRebuild() : engine.incrementalUpdate();
      const freshness = engine.inspectFreshness();
      return {
        ok: true,
        operation: 'sync',
        mode: result.mode,
        published: Boolean(result.published),
        ...publicFreshnessEnvelope(projectId, freshness, result.snapshot),
        counts: result.counts || null,
      };
    } catch (err) {
      return {
        ok: false,
        operation: 'sync',
        service: SERVICE_ID,
        schemaVersion: KNOWLEDGE_FIRST_SCHEMA_VERSION,
        projectId,
        reasonCode: (err && err.reasonCode) || REASON_CODES.PUBLISH_INCOMPLETE,
        message: 'Knowledge-First sync failed',
        freshness: { status: 'unknown', reasonCode: (err && err.reasonCode) || null },
      };
    } finally {
      if (engine) engine.close();
    }
  }

  function lookup({ query, limit } = {}) {
    if (typeof query !== 'string' || !query.trim()) {
      throw new KnowledgeStoreError(REASON_CODES.SCHEMA_INVALID, 'query is required');
    }
    let engine;
    let retriever;
    try {
      engine = openSnapshotEngine(engineOptions(true));
      const snapshot = engine.getCurrentSnapshot();
      const freshness = engine.inspectFreshness();
      const base = publicFreshnessEnvelope(projectId, freshness, snapshot);
      if (freshness.status !== 'fresh') {
        return {
          ok: false,
          operation: 'lookup',
          ...base,
          reasonCode: freshness.reasonCode || REASON_CODES.SNAPSHOT_STALE,
          message:
            freshness.status === 'unknown'
              ? 'Knowledge cannot be served because source freshness is unknown'
              : 'Knowledge cannot be served because the published snapshot is stale',
          servable: false,
        };
      }

      retriever = createProjectRetriever(engineOptions(true));
      const result = retriever.retrieve({ query: query.trim(), limit });
      const units = engine._store.listSourceUnits(projectId, snapshot.snapshotId);
      const symbols = engine._store.listSymbols(projectId, snapshot.snapshotId);
      const relationships = engine._store.listRelationships(projectId, snapshot.snapshotId);
      const evidence = listEvidence(engine._store, projectId, snapshot.snapshotId);
      const unitsById = new Map(units.map(unit => [unit.sourceUnitId, unit]));
      const symbolsById = new Map(symbols.map(symbol => [symbol.symbolId, symbol]));
      const evidenceById = new Map(evidence.map(item => [item.evidenceId, item]));

      const results = (result.hits || []).map(hit => {
        const docId = String(hit.docId || hit.id || '');
        let symbol = null;
        if (docId.startsWith('doc:symbol:')) symbol = symbolsById.get(docId.slice(11)) || null;
        const evidenceHit = docId.startsWith('doc:evidence:')
          ? evidenceById.get(docId.slice(13)) || null
          : null;
        const sourceUnitId =
          sourceUnitIdFor(symbol) ||
          sourceUnitIdFor(evidenceHit) ||
          (docId.startsWith('doc:unit:') ? docId.slice(9) : null);
        const location = sourceLocation(unitsById.get(sourceUnitId));
        const relatedSymbols = symbols.filter(item => sourceUnitIdFor(item) === sourceUnitId);
        const relatedSymbolIds = new Set(relatedSymbols.map(item => item.symbolId));
        if (symbol) relatedSymbolIds.add(symbol.symbolId);
        const relatedRelationships = relationships.filter(
          item => relatedSymbolIds.has(item.fromSymbolId) || relatedSymbolIds.has(item.toSymbolId)
        );
        const relatedEvidence = evidence.filter(
          item =>
            item.sourceUnitId === sourceUnitId ||
            relatedRelationships.some(rel =>
              (rel.evidenceReferences || []).some(ref => ref.id === item.evidenceId)
            )
        );
        return {
          match: sanitizePublic(hit),
          location,
          evidence: sanitizePublic(relatedEvidence),
          relationships: sanitizePublic(relatedRelationships),
          provenance: symbol ? sanitizePublic(symbol.provenance) : null,
        };
      });

      return {
        ok: true,
        operation: 'lookup',
        ...base,
        query: query.trim(),
        servable: true,
        totalMatched: result.totalMatched,
        omitted: result.omitted,
        results,
      };
    } finally {
      if (retriever) retriever.close();
      if (engine) engine.close();
    }
  }

  function locate(input = {}) {
    const selector = normalizeLocateSelector(input);
    const limit = Math.max(1, Math.min(100, Number.isInteger(input.limit) ? input.limit : 25));
    let engine;
    try {
      engine = openSnapshotEngine(engineOptions(true));
      const snapshot = engine.getCurrentSnapshot();
      const freshness = engine.inspectFreshness();
      const base = publicFreshnessEnvelope(projectId, freshness, snapshot);
      if (freshness.status !== 'fresh') {
        return {
          ok: false,
          operation: 'locate',
          ...base,
          selector: sanitizePublic(selector),
          reasonCode: freshness.reasonCode || REASON_CODES.SNAPSHOT_STALE,
          message:
            freshness.status === 'unknown'
              ? 'Source location cannot be resolved because source freshness is unknown'
              : 'Source location cannot be resolved because the published snapshot is stale',
          servable: false,
          found: false,
          ambiguous: false,
          selected: null,
          candidates: [],
        };
      }

      const units = engine._store.listSourceUnits(projectId, snapshot.snapshotId);
      const matches = locateMatches(units, selector);
      const candidates = matches.slice(0, limit).map(sourceLocator);
      const ambiguous = matches.length > 1;
      return {
        ok: true,
        operation: 'locate',
        ...base,
        selector: sanitizePublic(selector),
        servable: true,
        found: matches.length > 0,
        ambiguous,
        candidateCount: matches.length,
        omitted: Math.max(0, matches.length - candidates.length),
        selected: matches.length === 1 ? candidates[0] : null,
        candidates,
        reasonCode: !matches.length
          ? REASON_CODES.SOURCE_NOT_FOUND
          : ambiguous
            ? REASON_CODES.SOURCE_AMBIGUOUS
            : null,
      };
    } finally {
      if (engine) engine.close();
    }
  }

  return {
    inspect,
    check: inspect,
    sync,
    lookup,
    locate,
    query: lookup,
  };
}

function inspectKnowledgeFirst(options) {
  return createKnowledgeFirstService(options).inspect();
}

function syncKnowledgeFirst(options, syncOptions) {
  return createKnowledgeFirstService(options).sync(syncOptions);
}

function lookupKnowledgeFirst(options, queryOptions) {
  return createKnowledgeFirstService(options).lookup(queryOptions);
}

function locateKnowledgeFirst(options, locateOptions) {
  return createKnowledgeFirstService(options).locate(locateOptions);
}

module.exports = {
  KNOWLEDGE_FIRST_SCHEMA_VERSION,
  SERVICE_ID,
  createKnowledgeFirstService,
  inspectKnowledgeFirst,
  syncKnowledgeFirst,
  lookupKnowledgeFirst,
  locateKnowledgeFirst,
};
