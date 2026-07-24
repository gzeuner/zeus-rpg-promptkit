'use strict';

const path = require('path');
const { DERIVATION_CLASSES, ANALYZER_RUN_STATUSES, EVIDENCE_CLASSES } = require('../constants');
const CONTRACT_IDS = require('../contractIds');

const ANALYZER_ID = 'zeus.baseline-inventory-analyzer';
const ANALYZER_VERSION = '1.0.0';

/**
 * Deterministic Community baseline analyzer (placeholder until ZPI-07 RPG extractors).
 *
 * For each source unit:
 * - one PROGRAM/symbol derived from basename
 * - one evidence meta row
 * - optional CALL relationship if body text contains another unit basename (case-insensitive)
 *
 * Output is fully determined by unit paths, hashes, and canonical body text.
 */
function createBaselineAnalyzer(options = {}) {
  const analyzerId = options.analyzerId || ANALYZER_ID;
  const analyzerVersion = options.analyzerVersion || ANALYZER_VERSION;

  function analyze({ projectId, snapshotId, units, bodiesByHash = {} }) {
    const symbols = [];
    const relationships = [];
    const evidence = [];
    const basenameToSymbolId = new Map();

    const sorted = [...units].sort((a, b) => a.sourceUnitId.localeCompare(b.sourceUnitId));

    for (const unit of sorted) {
      const base = path.basename(unit.relativePath, path.extname(unit.relativePath));
      const symbolId = `sym:${unit.sourceUnitId}`;
      basenameToSymbolId.set(base.toUpperCase(), symbolId);

      const provenance = {
        projectId,
        snapshotId,
        sourceHash: unit.contentHash,
        analyzerId,
        analyzerVersion,
        derivationClass: DERIVATION_CLASSES.VERIFIED,
        sourceUnitId: unit.sourceUnitId,
      };

      symbols.push({
        schemaVersion: 1,
        kind: 'project-knowledge-symbol',
        contractId: CONTRACT_IDS.SYMBOL,
        projectId,
        snapshotId,
        symbolId,
        name: base.toUpperCase(),
        symbolKind: 'PROGRAM',
        provenance,
        evidenceReferences: [{ id: `ev:${unit.sourceUnitId}`, kind: 'source' }],
        sourceSpanIds: [],
        confidence: 'high',
        _sourceUnitId: unit.sourceUnitId,
      });

      evidence.push({
        schemaVersion: 1,
        kind: 'project-knowledge-evidence',
        contractId: CONTRACT_IDS.EVIDENCE,
        projectId,
        snapshotId,
        evidenceId: `ev:${unit.sourceUnitId}`,
        sourceUnitId: unit.sourceUnitId,
        contentHash: unit.contentHash,
        evidenceClass: EVIDENCE_CLASSES.SOURCE,
        trustedRootId: unit.trustedRootId,
        relativePath: unit.relativePath,
        sourceSpanIds: [],
      });
    }

    // Relationships: if body mentions another program basename as whole word
    for (const unit of sorted) {
      const body = bodiesByHash[unit.contentHash] || '';
      const fromId = `sym:${unit.sourceUnitId}`;
      const upper = String(body).toUpperCase();
      for (const [base, toId] of basenameToSymbolId) {
        if (toId === fromId) continue;
        // Simple deterministic mention check
        if (upper.includes(base)) {
          relationships.push({
            schemaVersion: 1,
            kind: 'project-knowledge-relationship',
            contractId: CONTRACT_IDS.RELATIONSHIP,
            projectId,
            snapshotId,
            relationshipId: `rel:${fromId}->${toId}`,
            relationshipType: 'PROGRAM_CALL',
            fromSymbolId: fromId,
            toSymbolId: toId,
            provenance: {
              projectId,
              snapshotId,
              sourceHash: unit.contentHash,
              analyzerId,
              analyzerVersion,
              derivationClass: DERIVATION_CLASSES.INFERRED,
              sourceUnitId: unit.sourceUnitId,
            },
            evidenceReferences: [{ id: `ev:${unit.sourceUnitId}`, kind: 'source' }],
            confidence: 'medium',
            _sourceUnitId: unit.sourceUnitId,
          });
        }
      }
    }

    relationships.sort((a, b) => a.relationshipId.localeCompare(b.relationshipId));
    symbols.sort((a, b) => a.symbolId.localeCompare(b.symbolId));
    evidence.sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));

    const analyzerRun = {
      schemaVersion: 1,
      kind: 'project-knowledge-analyzer-run',
      contractId: CONTRACT_IDS.ANALYZER_RUN,
      projectId,
      snapshotId,
      analyzerRunId: `run:${analyzerId}:${snapshotId}`,
      analyzerId,
      analyzerVersion,
      inputInventoryHash: '', // filled by engine
      status: ANALYZER_RUN_STATUSES.SUCCEEDED,
    };

    return {
      analyzerRun,
      symbols,
      relationships,
      evidence,
      analyzerId,
      analyzerVersion,
    };
  }

  return {
    analyzerId,
    analyzerVersion,
    analyze,
  };
}

module.exports = {
  ANALYZER_ID,
  ANALYZER_VERSION,
  createBaselineAnalyzer,
};
