'use strict';

const crypto = require('crypto');
const { createProjectKnowledgeStore, openProjectKnowledgeStore } = require('../store/createStore');
const { openContentStoreFromKnowledgeRoot } = require('../content/contentStore');
const { createSearchProvider } = require('../search/searchProvider');
const { STORE_SCHEMA_VERSION } = require('../store/constants');
const { SEARCH_SCHEMA_VERSION } = require('../search/constants');
const { SNAPSHOT_STATUSES } = require('../constants');
const CONTRACT_IDS = require('../contractIds');
const { fail, REASON_CODES, KnowledgeStoreError } = require('../store/errors');
const { probeNodeSqlite } = require('../store/sqliteDriver');
const { buildSourceInventory } = require('./inventory');
const { planInventoryDiff } = require('./diffPlanner');
const { planInvalidation } = require('./invalidation');
const { createRpgAnalyzer } = require('../analyzers');

const ARTIFACT_SCHEMA_VERSION = 1;

function isoNow() {
  return new Date().toISOString();
}

function stripInternal(entity) {
  if (!entity || typeof entity !== 'object') return entity;
  const copy = { ...entity };
  delete copy._canonicalBytes;
  delete copy._sourceUnitId;
  if (copy.provenance && copy.provenance.sourceUnitId) {
    // keep sourceUnitId in provenance for invalidation round-trips (allowed extra field)
  }
  return copy;
}

function rewriteSnapshotIds(entities, projectId, snapshotId, mapFn) {
  return entities.map(e => {
    const next = mapFn ? mapFn({ ...e }) : { ...e };
    next.projectId = projectId;
    next.snapshotId = snapshotId;
    if (next.provenance) {
      next.provenance = { ...next.provenance, projectId, snapshotId };
    }
    return stripInternal(next);
  });
}

/**
 * Create a new project knowledge workspace + snapshot engine.
 */
function createSnapshotEngine(options = {}) {
  if (!probeNodeSqlite().available) {
    fail(
      REASON_CODES.STORE_UNAVAILABLE,
      'SQLite driver unavailable (requires Node.js node:sqlite / DatabaseSync)'
    );
  }
  const { knowledgeRoot, projectId, displayName, trustedRoots, analyzer } = options;
  if (!knowledgeRoot || !projectId) {
    fail(REASON_CODES.PROJECT_ID_INVALID, 'knowledgeRoot and projectId are required');
  }
  if (!Array.isArray(trustedRoots) || trustedRoots.length === 0) {
    fail(REASON_CODES.UNTRUSTED_ROOT, 'trustedRoots are required');
  }

  const store = createProjectKnowledgeStore({
    rootPath: knowledgeRoot,
    projectId,
    displayName,
    trustedRoots: trustedRoots.map(r => ({
      rootId: r.rootId,
      relativeLabel: r.relativeLabel || r.rootId,
      // store contract allows relativeLabel; absolute path is engine-only
    })),
  });

  return wrapEngine({
    store,
    knowledgeRoot,
    projectId,
    trustedRoots,
    analyzer: analyzer || createRpgAnalyzer(),
    readOnly: false,
  });
}

/**
 * Open existing workspace.
 */
function openSnapshotEngine(options = {}) {
  if (!probeNodeSqlite().available) {
    fail(
      REASON_CODES.STORE_UNAVAILABLE,
      'SQLite driver unavailable (requires Node.js node:sqlite / DatabaseSync)'
    );
  }
  const { knowledgeRoot, projectId, trustedRoots, analyzer, readOnly = false } = options;
  if (!knowledgeRoot) {
    fail(REASON_CODES.PATH_UNSAFE, 'knowledgeRoot is required');
  }
  const store = openProjectKnowledgeStore({
    rootPath: knowledgeRoot,
    projectId,
    readOnly,
  });
  const project = store.getProject();
  return wrapEngine({
    store,
    knowledgeRoot,
    projectId: project.projectId,
    trustedRoots: trustedRoots || [],
    analyzer: analyzer || createRpgAnalyzer(),
    readOnly,
  });
}

function wrapEngine({ store, knowledgeRoot, projectId, trustedRoots, analyzer, readOnly }) {
  let closed = false;

  function assertOpen() {
    if (closed) fail(REASON_CODES.STORE_UNAVAILABLE, 'snapshot engine is closed');
  }

  function assertWritable() {
    assertOpen();
    if (readOnly) fail(REASON_CODES.STORE_UNAVAILABLE, 'snapshot engine is read-only');
  }

  function openContent(ro = readOnly) {
    return openContentStoreFromKnowledgeRoot(knowledgeRoot, {
      trustedRoots: trustedRoots.map(r => ({ rootId: r.rootId, path: r.path })),
      readOnly: ro,
    });
  }

  function openSearch(ro = readOnly) {
    return createSearchProvider({
      knowledgeRoot,
      projectId,
      readOnly: ro,
      openMode: 'rebuild-on-corrupt',
    });
  }

  /**
   * Read current published snapshot or fail closed.
   */
  function getCurrentSnapshot() {
    assertOpen();
    return store.getCurrentSnapshot(projectId);
  }

  /**
   * Refuse serving when live inventory no longer matches published inventory hash.
   */
  function assertCurrentNotStale() {
    assertOpen();
    const current = store.getCurrentSnapshot(projectId);
    if (!trustedRoots.length) {
      return { ok: true, current };
    }
    const live = buildSourceInventory({ trustedRoots });
    if (live.inventoryHash !== current.sourceInventoryHash) {
      fail(
        REASON_CODES.SNAPSHOT_STALE,
        'published snapshot inventory is stale relative to sources'
      );
    }
    return { ok: true, current, inventoryHash: live.inventoryHash };
  }

  function loadPreviousFacts(snapshotId) {
    return {
      units: store.listSourceUnits(projectId, snapshotId),
      symbols: store.listSymbols(projectId, snapshotId),
      relationships: store.listRelationships(projectId, snapshotId),
      // evidence listing via private query - use list if available
      evidence: listEvidence(store, projectId, snapshotId),
    };
  }

  function listEvidence(storeHandle, pid, sid) {
    // Store API may not expose listEvidence — use internal db if present
    if (storeHandle._store && storeHandle._store._db) {
      const rows = storeHandle._store._db.all(
        `SELECT payload_json FROM evidence_meta
         WHERE project_id = @project_id AND snapshot_id = @snapshot_id
         ORDER BY evidence_id ASC`,
        { project_id: pid, snapshot_id: sid }
      );
      return rows.map(r => JSON.parse(r.payload_json));
    }
    return [];
  }

  /**
   * Full rebuild from trusted roots.
   */
  function fullRebuild(rebuildOptions = {}) {
    assertWritable();
    const inv = buildSourceInventory({
      trustedRoots,
      extensions: rebuildOptions.extensions,
    });
    return publishFromPlan({
      mode: 'full',
      inventory: inv,
      unitsToAnalyze: inv.units,
      keptFacts: { symbols: [], relationships: [], evidence: [] },
      diff: planInventoryDiff([], inv.units),
    });
  }

  /**
   * Incremental update: reuse facts for unchanged units, re-analyze added/changed.
   * Falls back to full rebuild when no current snapshot exists.
   */
  function incrementalUpdate(updateOptions = {}) {
    assertWritable();
    const inv = buildSourceInventory({
      trustedRoots,
      extensions: updateOptions.extensions,
    });

    let previousUnits = [];
    let previousFacts = { symbols: [], relationships: [], evidence: [] };
    let hasCurrent = false;
    try {
      const current = store.getCurrentSnapshot(projectId);
      hasCurrent = true;
      previousFacts = loadPreviousFacts(current.snapshotId);
      previousUnits = previousFacts.units;
    } catch (err) {
      const noCurrent =
        err instanceof KnowledgeStoreError &&
        (err.reasonCode === REASON_CODES.SNAPSHOT_NOT_CURRENT ||
          err.reasonCode === REASON_CODES.CURRENT_POINTER_MISMATCH ||
          err.reasonCode === REASON_CODES.SNAPSHOT_NOT_FOUND);
      if (!noCurrent) throw err;
      return publishFromPlan({
        mode: 'full',
        inventory: inv,
        unitsToAnalyze: inv.units,
        keptFacts: { symbols: [], relationships: [], evidence: [] },
        diff: planInventoryDiff([], inv.units),
      });
    }

    const diff = planInventoryDiff(previousUnits, inv.units);
    if (diff.isNoOp && hasCurrent) {
      const current = store.getCurrentSnapshot(projectId);
      return {
        ok: true,
        mode: 'incremental-noop',
        snapshot: current,
        diff,
        published: false,
      };
    }

    const invalidation = planInvalidation(diff, previousFacts);
    const unitsToAnalyze = [...diff.added, ...diff.changed.map(c => c.next)].sort((a, b) =>
      a.sourceUnitId.localeCompare(b.sourceUnitId)
    );

    return publishFromPlan({
      mode: 'incremental',
      inventory: inv,
      unitsToAnalyze,
      keptFacts: invalidation.kept,
      diff,
      invalidation,
    });
  }

  /**
   * Core atomic publish path for full and incremental.
   */
  function publishFromPlan({ mode, inventory, unitsToAnalyze, keptFacts, diff, invalidation }) {
    const snapshotId = `snap-${inventory.inventoryHash.slice(0, 16)}`;
    const analyzerRunId = `run:${analyzer.analyzerId}:${snapshotId}`;
    const content = openContent();
    const search = openSearch(false);

    // Idempotent: if this inventory already published as current, no-op
    try {
      const current = store.getCurrentSnapshot(projectId);
      if (
        current.snapshotId === snapshotId &&
        current.sourceInventoryHash === inventory.inventoryHash
      ) {
        content; // silence
        search.close();
        return {
          ok: true,
          mode: `${mode}-noop`,
          snapshot: current,
          diff,
          published: false,
        };
      }
    } catch {
      // no current
    }

    const bodiesByHash = {};
    try {
      // 1) Content store: put canonical bytes for units that need analysis + all next units
      for (const unit of inventory.units) {
        if (unit._canonicalBytes) {
          content.put(unit._canonicalBytes, { mode: 'binary' });
          bodiesByHash[unit.contentHash] = unit._canonicalBytes.toString('utf8');
        }
      }

      // 2) Analyze changed/added units
      const analysis = analyzer.analyze({
        projectId,
        snapshotId,
        units: unitsToAnalyze.map(u => stripInternal({ ...u })),
        bodiesByHash,
      });
      analysis.analyzerRun.analyzerRunId = analyzerRunId;
      analysis.analyzerRun.inputInventoryHash = inventory.inventoryHash;
      analysis.analyzerRun.snapshotId = snapshotId;
      analysis.analyzerRun.projectId = projectId;

      // 3) Merge kept + new derived facts; rewrite snapshot ids on kept
      const newSymbols = analysis.symbols;
      const newRelationships = analysis.relationships;
      const newEvidence = analysis.evidence;

      const symbols = [
        ...rewriteSnapshotIds(keptFacts.symbols || [], projectId, snapshotId),
        ...newSymbols.map(stripInternal),
      ].sort((a, b) => a.symbolId.localeCompare(b.symbolId));

      const relationships = [
        ...rewriteSnapshotIds(keptFacts.relationships || [], projectId, snapshotId),
        ...newRelationships.map(stripInternal),
      ].sort((a, b) => a.relationshipId.localeCompare(b.relationshipId));

      const evidence = [
        ...rewriteSnapshotIds(keptFacts.evidence || [], projectId, snapshotId),
        ...newEvidence.map(stripInternal),
      ].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));

      // Dedupe by id (prefer new)
      const dedupeBy = (arr, key) => {
        const map = new Map();
        for (const item of arr) map.set(item[key], item);
        return Array.from(map.values()).sort((a, b) =>
          String(a[key]).localeCompare(String(b[key]))
        );
      };
      const finalSymbols = dedupeBy(symbols, 'symbolId');
      const finalRelationships = dedupeBy(relationships, 'relationshipId');
      const finalEvidence = dedupeBy(evidence, 'evidenceId');

      // 4) Building snapshot metadata
      const building = {
        schemaVersion: 1,
        kind: 'project-knowledge-snapshot',
        contractId: CONTRACT_IDS.SNAPSHOT,
        projectId,
        snapshotId,
        status: SNAPSHOT_STATUSES.BUILDING,
        isCurrent: false,
        sourceInventoryHash: inventory.inventoryHash,
        storeSchemaVersion: STORE_SCHEMA_VERSION,
        searchSchemaVersion: SEARCH_SCHEMA_VERSION,
        artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
        contentAddressing: { algorithm: 'sha256' },
        analyzerRunIds: [analyzerRunId],
      };

      // Atomic store transaction for metadata writes + publish pointer.
      // Search index is rebuilt only after pointer advances so a failed publish
      // cannot leave search ahead of the current snapshot.
      store.withTransaction(() => {
        store.putSnapshot(building);

        for (const unit of inventory.units) {
          store.putSourceUnit({
            schemaVersion: 1,
            kind: 'project-knowledge-source-unit',
            contractId: CONTRACT_IDS.SOURCE_UNIT,
            projectId,
            snapshotId,
            sourceUnitId: unit.sourceUnitId,
            relativePath: unit.relativePath,
            contentHash: unit.contentHash,
            trustedRootId: unit.trustedRootId,
            language: unit.language,
            sizeBytes: unit.sizeBytes,
            hashAlgorithm: 'sha256',
          });
        }

        store.putAnalyzerRun(analysis.analyzerRun);

        for (const s of finalSymbols) store.putSymbol(s);
        for (const r of finalRelationships) store.putRelationship(r);
        for (const e of finalEvidence) store.putEvidenceMeta(e);

        // Atomic pointer advance (last store step)
        store.publishSnapshot(projectId, snapshotId, { publishedAt: isoNow() });
      });

      const searchDocs = buildSearchDocuments({
        projectId,
        snapshotId,
        units: inventory.units,
        symbols: finalSymbols,
        evidence: finalEvidence,
        bodiesByHash,
      });
      search.rebuild(searchDocs, { snapshotId });

      const published = store.getCurrentSnapshot(projectId);
      search.close();

      return {
        ok: true,
        mode,
        published: true,
        snapshot: published,
        diff,
        invalidation: invalidation || null,
        counts: {
          sourceUnits: inventory.units.length,
          symbols: finalSymbols.length,
          relationships: finalRelationships.length,
          evidence: finalEvidence.length,
        },
        analyzer: {
          analyzerId: analyzer.analyzerId,
          analyzerVersion: analyzer.analyzerVersion,
          analyzerRunId,
        },
      };
    } catch (err) {
      try {
        search.close();
      } catch {
        // ignore
      }
      // Failed publish must not leave a new current pointer — publishSnapshot is last step.
      if (err instanceof KnowledgeStoreError) throw err;
      fail(REASON_CODES.PUBLISH_INCOMPLETE, 'snapshot publish failed', {
        message: err && err.message ? String(err.message) : undefined,
      });
    }
  }

  function buildSearchDocuments({
    projectId: pid,
    snapshotId: sid,
    units,
    symbols,
    evidence,
    bodiesByHash,
  }) {
    const docs = [];
    for (const u of units) {
      docs.push({
        docId: `doc:unit:${u.sourceUnitId}`,
        projectId: pid,
        snapshotId: sid,
        kind: 'source-unit',
        title: u.relativePath.split('/').pop(),
        body: bodiesByHash[u.contentHash] || '',
        fields: {
          language: u.language,
          relativePath: u.relativePath,
        },
        contentHash: u.contentHash,
      });
    }
    for (const s of symbols) {
      docs.push({
        docId: `doc:symbol:${s.symbolId}`,
        projectId: pid,
        snapshotId: sid,
        kind: 'symbol',
        title: s.name,
        body: `${s.name} ${s.symbolKind}`,
        fields: { symbolKind: s.symbolKind },
      });
    }
    for (const e of evidence) {
      docs.push({
        docId: `doc:evidence:${e.evidenceId}`,
        projectId: pid,
        snapshotId: sid,
        kind: 'evidence',
        title: e.relativePath || e.evidenceId,
        body: e.relativePath || '',
        fields: { relativePath: e.relativePath || '' },
        contentHash: e.contentHash,
      });
    }
    return docs;
  }

  /**
   * Compare full rebuild vs incremental path semantics for tests.
   * Returns normalized equality projection (ids + hashes only).
   */
  function projectEqualityView(snapshotId) {
    const units = store.listSourceUnits(projectId, snapshotId).map(u => ({
      sourceUnitId: u.sourceUnitId,
      contentHash: u.contentHash,
      relativePath: u.relativePath,
    }));
    const symbols = store.listSymbols(projectId, snapshotId).map(s => ({
      symbolId: s.symbolId,
      name: s.name,
      symbolKind: s.symbolKind,
      sourceHash: s.provenance && s.provenance.sourceHash,
    }));
    const relationships = store.listRelationships(projectId, snapshotId).map(r => ({
      relationshipId: r.relationshipId,
      fromSymbolId: r.fromSymbolId,
      toSymbolId: r.toSymbolId,
      relationshipType: r.relationshipType,
    }));
    units.sort((a, b) => a.sourceUnitId.localeCompare(b.sourceUnitId));
    symbols.sort((a, b) => a.symbolId.localeCompare(b.symbolId));
    relationships.sort((a, b) => a.relationshipId.localeCompare(b.relationshipId));
    return { units, symbols, relationships };
  }

  function close() {
    if (closed) return;
    closed = true;
    store.close();
  }

  function getStatus() {
    return {
      projectId,
      knowledgeRoot,
      readOnly,
      closed,
      store: store.getStatus(),
    };
  }

  return {
    projectId,
    knowledgeRoot,
    fullRebuild,
    incrementalUpdate,
    getCurrentSnapshot,
    assertCurrentNotStale,
    projectEqualityView,
    getStatus,
    close,
    // test/diagnostic hooks
    _store: store,
    _planDiff: planInventoryDiff,
    _buildInventory: () => buildSourceInventory({ trustedRoots }),
  };
}

/** Stable random id helper if needed by callers */
function newId(prefix) {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

module.exports = {
  createSnapshotEngine,
  openSnapshotEngine,
  newId,
};
