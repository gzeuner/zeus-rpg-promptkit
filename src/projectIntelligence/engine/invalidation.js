'use strict';

/**
 * Invalidation planner for incremental snapshot builds.
 *
 * Community baseline (ZPI-06):
 * - Source units that are deleted or changed invalidate all derived facts
 *   whose primary sourceHash / sourceUnitId matches.
 * - Unchanged source units keep their derived symbols, relationships, evidence.
 * - Relationships are kept only if both endpoints remain in the kept symbol set
 *   (conservative transitive invalidation).
 */

/**
 * @param {object} diff from planInventoryDiff
 * @param {object} previousFacts
 * @param {Array} previousFacts.symbols
 * @param {Array} previousFacts.relationships
 * @param {Array} previousFacts.evidence
 */
function planInvalidation(diff, previousFacts = {}) {
  const invalidatedSourceUnitIds = new Set();
  for (const u of diff.deleted || []) {
    invalidatedSourceUnitIds.add(u.sourceUnitId);
  }
  for (const entry of diff.changed || []) {
    if (!entry.contentChanged) continue;
    invalidatedSourceUnitIds.add(entry.previous.sourceUnitId);
    // next id may differ only if path identity scheme changed; still invalidate previous
    if (entry.next && entry.next.sourceUnitId !== entry.previous.sourceUnitId) {
      invalidatedSourceUnitIds.add(entry.next.sourceUnitId);
    }
  }

  const keptSourceUnitIds = new Set();
  for (const entry of diff.unchanged || []) {
    keptSourceUnitIds.add(entry.previous.sourceUnitId);
  }
  for (const entry of diff.changed || []) {
    if (!entry.contentChanged) keptSourceUnitIds.add(entry.previous.sourceUnitId);
  }

  const prevSymbols = Array.isArray(previousFacts.symbols) ? previousFacts.symbols : [];
  const prevRelationships = Array.isArray(previousFacts.relationships)
    ? previousFacts.relationships
    : [];
  const prevEvidence = Array.isArray(previousFacts.evidence) ? previousFacts.evidence : [];

  const keptSymbols = [];
  const invalidatedSymbols = [];
  for (const sym of prevSymbols) {
    const srcIds = extractSourceUnitIds(sym);
    if (srcIds.some(id => invalidatedSourceUnitIds.has(id))) {
      invalidatedSymbols.push(sym);
    } else if (srcIds.length === 0 || srcIds.every(id => keptSourceUnitIds.has(id))) {
      keptSymbols.push(sym);
    } else {
      invalidatedSymbols.push(sym);
    }
  }

  const keptSymbolIds = new Set(keptSymbols.map(s => s.symbolId));

  const keptRelationships = [];
  const invalidatedRelationships = [];
  for (const rel of prevRelationships) {
    const endpointsOk = keptSymbolIds.has(rel.fromSymbolId) && keptSymbolIds.has(rel.toSymbolId);
    const srcIds = extractSourceUnitIds(rel);
    const sourceOk =
      srcIds.length === 0 ||
      (srcIds.every(id => !invalidatedSourceUnitIds.has(id)) &&
        srcIds.every(id => keptSourceUnitIds.has(id)));
    if (endpointsOk && sourceOk) {
      keptRelationships.push(rel);
    } else {
      invalidatedRelationships.push(rel);
    }
  }

  const keptEvidence = [];
  const invalidatedEvidence = [];
  for (const ev of prevEvidence) {
    if (invalidatedSourceUnitIds.has(ev.sourceUnitId)) {
      invalidatedEvidence.push(ev);
    } else if (keptSourceUnitIds.has(ev.sourceUnitId)) {
      keptEvidence.push(ev);
    } else {
      invalidatedEvidence.push(ev);
    }
  }

  return {
    invalidatedSourceUnitIds: Array.from(invalidatedSourceUnitIds).sort(),
    keptSourceUnitIds: Array.from(keptSourceUnitIds).sort(),
    kept: {
      symbols: keptSymbols,
      relationships: keptRelationships,
      evidence: keptEvidence,
    },
    invalidated: {
      symbols: invalidatedSymbols,
      relationships: invalidatedRelationships,
      evidence: invalidatedEvidence,
    },
  };
}

function extractSourceUnitIds(entity) {
  const ids = new Set();
  if (entity && entity.sourceUnitId) ids.add(entity.sourceUnitId);
  if (entity && Array.isArray(entity.sourceSpanIds)) {
    // no reverse map in baseline; ignore spans
  }
  if (entity && Array.isArray(entity.evidenceReferences)) {
    // evidence refs are ids not source units
  }
  // Convention: symbolId/relationship provenance may embed path in fields
  if (entity && entity.fields && entity.fields.sourceUnitId) {
    ids.add(entity.fields.sourceUnitId);
  }
  // Baseline analyzer tags sourceUnitId on symbols
  if (entity && entity._sourceUnitId) ids.add(entity._sourceUnitId);
  if (entity && entity.provenance && entity.provenance.sourceUnitId) {
    ids.add(entity.provenance.sourceUnitId);
  }
  // Derive from evidenceReferences kind source-unit
  if (entity && Array.isArray(entity.evidenceReferences)) {
    for (const ref of entity.evidenceReferences) {
      if (ref && ref.kind === 'source-unit' && ref.id) ids.add(ref.id);
    }
  }
  return Array.from(ids);
}

module.exports = {
  planInvalidation,
  extractSourceUnitIds,
};
