'use strict';

const path = require('path');
const { DERIVATION_CLASSES, ANALYZER_RUN_STATUSES, EVIDENCE_CLASSES } = require('../constants');
const CONTRACT_IDS = require('../contractIds');
const { ANALYZER_ID, ANALYZER_VERSION } = require('./constants');
const { parseSourceUnit, LANGUAGE_FAMILIES } = require('./parserAdapters');
const { collectSpansFromEvidenceList } = require('./spans');

function normalizeName(name) {
  return String(name || '')
    .trim()
    .toUpperCase();
}

function unitProgramName(unit) {
  return normalizeName(
    path.basename(unit.relativePath || '', path.extname(unit.relativePath || ''))
  );
}

function makeProvenance({
  projectId,
  snapshotId,
  contentHash,
  analyzerId,
  analyzerVersion,
  derivationClass,
  sourceUnitId,
}) {
  return {
    projectId,
    snapshotId,
    sourceHash: contentHash,
    analyzerId,
    analyzerVersion,
    derivationClass,
    sourceUnitId,
  };
}

/**
 * Deterministic RPG/IBM i knowledge analyzer (ZPI-07).
 *
 * Wraps Community scanners as parser adapters and projects results into
 * versioned ZPI symbols, relationships, evidence, and source spans.
 * Unresolved calls become UNRESOLVED_SYMBOL targets with explicit relationships.
 */
function createRpgAnalyzer(options = {}) {
  const analyzerId = options.analyzerId || ANALYZER_ID;
  const analyzerVersion = options.analyzerVersion || ANALYZER_VERSION;

  function analyze({ projectId, snapshotId, units, bodiesByHash = {} }) {
    const symbols = [];
    const relationships = [];
    const evidence = [];
    const sourceSpans = [];
    const unresolved = [];

    const sortedUnits = [...(units || [])].sort((a, b) =>
      a.sourceUnitId.localeCompare(b.sourceUnitId)
    );

    /** @type {Map<string, string>} program/module name -> symbolId */
    const knownPrograms = new Map();
    /** @type {Map<string, string>} procedure name -> symbolId (local exports) */
    const knownProcedures = new Map();

    // Pass 1: declare unit-level PROGRAM symbols and scan
    const scans = [];
    for (const unit of sortedUnits) {
      const body = bodiesByHash[unit.contentHash] || '';
      const { family, scan } = parseSourceUnit(unit, body);
      const programName = unitProgramName(unit);
      const programSymbolId = `sym:program:${unit.sourceUnitId}`;
      knownPrograms.set(programName, programSymbolId);

      const unitEvidenceId = `ev:${unit.sourceUnitId}:unit`;
      evidence.push({
        schemaVersion: 1,
        kind: 'project-knowledge-evidence',
        contractId: CONTRACT_IDS.EVIDENCE,
        projectId,
        snapshotId,
        evidenceId: unitEvidenceId,
        sourceUnitId: unit.sourceUnitId,
        contentHash: unit.contentHash,
        evidenceClass: EVIDENCE_CLASSES.SOURCE,
        trustedRootId: unit.trustedRootId,
        relativePath: unit.relativePath,
        sourceSpanIds: [],
      });

      symbols.push({
        schemaVersion: 1,
        kind: 'project-knowledge-symbol',
        contractId: CONTRACT_IDS.SYMBOL,
        projectId,
        snapshotId,
        symbolId: programSymbolId,
        name: programName,
        symbolKind:
          family === LANGUAGE_FAMILIES.CL
            ? 'PROGRAM'
            : family === LANGUAGE_FAMILIES.BND
              ? 'SERVICE_PROGRAM'
              : 'PROGRAM',
        provenance: makeProvenance({
          projectId,
          snapshotId,
          contentHash: unit.contentHash,
          analyzerId,
          analyzerVersion,
          derivationClass: DERIVATION_CLASSES.VERIFIED,
          sourceUnitId: unit.sourceUnitId,
        }),
        evidenceReferences: [{ id: unitEvidenceId, kind: 'source' }],
        sourceSpanIds: [],
        confidence: 'high',
        _sourceUnitId: unit.sourceUnitId,
      });

      scans.push({ unit, family, scan, programName, programSymbolId, unitEvidenceId });
    }

    // Pass 2: project scan entities and resolve references
    for (const entry of scans) {
      const { unit, scan, programName, programSymbolId, unitEvidenceId } = entry;
      const ctx = {
        projectId,
        snapshotId,
        sourceUnitId: unit.sourceUnitId,
        contentHash: unit.contentHash,
      };

      // Procedures
      for (const proc of scan.procedures || []) {
        const name = normalizeName(proc.name);
        if (!name) continue;
        const symbolId = `sym:proc:${unit.sourceUnitId}:${name}`;
        knownProcedures.set(`${programName}::${name}`, symbolId);
        knownProcedures.set(name, symbolId);
        const { spans, ids } = collectSpansFromEvidenceList(ctx, proc.evidence || []);
        sourceSpans.push(...spans);
        const evId = `ev:proc:${unit.sourceUnitId}:${name}`;
        evidence.push({
          schemaVersion: 1,
          kind: 'project-knowledge-evidence',
          contractId: CONTRACT_IDS.EVIDENCE,
          projectId,
          snapshotId,
          evidenceId: evId,
          sourceUnitId: unit.sourceUnitId,
          contentHash: unit.contentHash,
          evidenceClass: EVIDENCE_CLASSES.SOURCE,
          trustedRootId: unit.trustedRootId,
          relativePath: unit.relativePath,
          sourceSpanIds: ids,
        });
        symbols.push({
          schemaVersion: 1,
          kind: 'project-knowledge-symbol',
          contractId: CONTRACT_IDS.SYMBOL,
          projectId,
          snapshotId,
          symbolId,
          name,
          symbolKind: 'PROCEDURE',
          provenance: makeProvenance({
            projectId,
            snapshotId,
            contentHash: unit.contentHash,
            analyzerId,
            analyzerVersion,
            derivationClass: DERIVATION_CLASSES.VERIFIED,
            sourceUnitId: unit.sourceUnitId,
          }),
          evidenceReferences: [
            { id: evId, kind: 'source' },
            { id: unitEvidenceId, kind: 'source' },
          ],
          sourceSpanIds: ids,
          confidence: 'high',
          _sourceUnitId: unit.sourceUnitId,
        });
      }

      // Prototypes
      for (const proto of scan.prototypes || []) {
        const name = normalizeName(proto.name);
        if (!name) continue;
        const symbolId = `sym:proto:${unit.sourceUnitId}:${name}`;
        const { spans, ids } = collectSpansFromEvidenceList(ctx, proto.evidence || []);
        sourceSpans.push(...spans);
        symbols.push({
          schemaVersion: 1,
          kind: 'project-knowledge-symbol',
          contractId: CONTRACT_IDS.SYMBOL,
          projectId,
          snapshotId,
          symbolId,
          name,
          symbolKind: 'PROTOTYPE',
          provenance: makeProvenance({
            projectId,
            snapshotId,
            contentHash: unit.contentHash,
            analyzerId,
            analyzerVersion,
            derivationClass: DERIVATION_CLASSES.VERIFIED,
            sourceUnitId: unit.sourceUnitId,
          }),
          evidenceReferences: [{ id: unitEvidenceId, kind: 'source' }],
          sourceSpanIds: ids,
          confidence: 'high',
          _sourceUnitId: unit.sourceUnitId,
        });
      }

      // Data structures
      for (const ds of scan.dataStructures || []) {
        const name = normalizeName(ds.name);
        if (!name) continue;
        const symbolId = `sym:ds:${unit.sourceUnitId}:${name}`;
        const { spans, ids } = collectSpansFromEvidenceList(ctx, ds.evidence || []);
        sourceSpans.push(...spans);
        symbols.push({
          schemaVersion: 1,
          kind: 'project-knowledge-symbol',
          contractId: CONTRACT_IDS.SYMBOL,
          projectId,
          snapshotId,
          symbolId,
          name,
          symbolKind: 'DATA_STRUCTURE',
          provenance: makeProvenance({
            projectId,
            snapshotId,
            contentHash: unit.contentHash,
            analyzerId,
            analyzerVersion,
            derivationClass: DERIVATION_CLASSES.VERIFIED,
            sourceUnitId: unit.sourceUnitId,
          }),
          evidenceReferences: [{ id: unitEvidenceId, kind: 'source' }],
          sourceSpanIds: ids,
          confidence: 'medium',
          _sourceUnitId: unit.sourceUnitId,
        });
      }

      // Native files / tables
      for (const file of [...(scan.nativeFiles || []), ...(scan.tables || [])]) {
        const name = normalizeName(file.name);
        if (!name) continue;
        const symbolId = `sym:file:${name}`;
        const { spans, ids } = collectSpansFromEvidenceList(ctx, file.evidence || []);
        sourceSpans.push(...spans);
        if (!symbols.some(s => s.symbolId === symbolId)) {
          symbols.push({
            schemaVersion: 1,
            kind: 'project-knowledge-symbol',
            contractId: CONTRACT_IDS.SYMBOL,
            projectId,
            snapshotId,
            symbolId,
            name,
            symbolKind: 'FILE',
            provenance: makeProvenance({
              projectId,
              snapshotId,
              contentHash: unit.contentHash,
              analyzerId,
              analyzerVersion,
              derivationClass: DERIVATION_CLASSES.INFERRED,
              sourceUnitId: unit.sourceUnitId,
            }),
            evidenceReferences: [{ id: unitEvidenceId, kind: 'source' }],
            sourceSpanIds: ids,
            confidence: 'medium',
            _sourceUnitId: unit.sourceUnitId,
          });
        }
        relationships.push({
          schemaVersion: 1,
          kind: 'project-knowledge-relationship',
          contractId: CONTRACT_IDS.RELATIONSHIP,
          projectId,
          snapshotId,
          relationshipId: `rel:file:${programSymbolId}:${name}`,
          relationshipType: 'FILE_READ',
          fromSymbolId: programSymbolId,
          toSymbolId: symbolId,
          provenance: makeProvenance({
            projectId,
            snapshotId,
            contentHash: unit.contentHash,
            analyzerId,
            analyzerVersion,
            derivationClass: DERIVATION_CLASSES.INFERRED,
            sourceUnitId: unit.sourceUnitId,
          }),
          evidenceReferences: [{ id: unitEvidenceId, kind: 'source' }],
          confidence: 'medium',
          _sourceUnitId: unit.sourceUnitId,
        });
      }

      // SQL tables from statements
      for (const sql of scan.sqlStatements || []) {
        for (const table of sql.tables || []) {
          const name = normalizeName(table);
          if (!name) continue;
          const symbolId = `sym:table:${name}`;
          const { spans, ids } = collectSpansFromEvidenceList(ctx, sql.evidence || []);
          sourceSpans.push(...spans);
          if (!symbols.some(s => s.symbolId === symbolId)) {
            symbols.push({
              schemaVersion: 1,
              kind: 'project-knowledge-symbol',
              contractId: CONTRACT_IDS.SYMBOL,
              projectId,
              snapshotId,
              symbolId,
              name,
              symbolKind: 'TABLE',
              provenance: makeProvenance({
                projectId,
                snapshotId,
                contentHash: unit.contentHash,
                analyzerId,
                analyzerVersion,
                derivationClass: DERIVATION_CLASSES.INFERRED,
                sourceUnitId: unit.sourceUnitId,
              }),
              evidenceReferences: [{ id: unitEvidenceId, kind: 'source' }],
              sourceSpanIds: ids,
              confidence: sql.unresolved ? 'low' : 'medium',
              _sourceUnitId: unit.sourceUnitId,
            });
          }
          relationships.push({
            schemaVersion: 1,
            kind: 'project-knowledge-relationship',
            contractId: CONTRACT_IDS.RELATIONSHIP,
            projectId,
            snapshotId,
            relationshipId: `rel:sql:${programSymbolId}:${name}:${sql.type || 'SQL'}`,
            relationshipType: 'SQL_REFERENCE',
            fromSymbolId: programSymbolId,
            toSymbolId: symbolId,
            provenance: makeProvenance({
              projectId,
              snapshotId,
              contentHash: unit.contentHash,
              analyzerId,
              analyzerVersion,
              derivationClass: DERIVATION_CLASSES.INFERRED,
              sourceUnitId: unit.sourceUnitId,
            }),
            evidenceReferences: [{ id: unitEvidenceId, kind: 'source' }],
            confidence: sql.unresolved ? 'low' : 'medium',
            _sourceUnitId: unit.sourceUnitId,
          });
        }
      }

      // Copy / include
      for (const copy of scan.copyMembers || []) {
        const name = normalizeName(copy.name);
        if (!name) continue;
        const symbolId = `sym:copy:${name}`;
        const { spans, ids } = collectSpansFromEvidenceList(ctx, copy.evidence || []);
        sourceSpans.push(...spans);
        if (!symbols.some(s => s.symbolId === symbolId)) {
          symbols.push({
            schemaVersion: 1,
            kind: 'project-knowledge-symbol',
            contractId: CONTRACT_IDS.SYMBOL,
            projectId,
            snapshotId,
            symbolId,
            name,
            symbolKind: 'COPY_MEMBER',
            provenance: makeProvenance({
              projectId,
              snapshotId,
              contentHash: unit.contentHash,
              analyzerId,
              analyzerVersion,
              derivationClass: DERIVATION_CLASSES.VERIFIED,
              sourceUnitId: unit.sourceUnitId,
            }),
            evidenceReferences: [{ id: unitEvidenceId, kind: 'source' }],
            sourceSpanIds: ids,
            confidence: 'high',
            _sourceUnitId: unit.sourceUnitId,
          });
        }
        relationships.push({
          schemaVersion: 1,
          kind: 'project-knowledge-relationship',
          contractId: CONTRACT_IDS.RELATIONSHIP,
          projectId,
          snapshotId,
          relationshipId: `rel:copy:${programSymbolId}:${name}`,
          relationshipType: 'COPY_INCLUDE',
          fromSymbolId: programSymbolId,
          toSymbolId: symbolId,
          provenance: makeProvenance({
            projectId,
            snapshotId,
            contentHash: unit.contentHash,
            analyzerId,
            analyzerVersion,
            derivationClass: DERIVATION_CLASSES.VERIFIED,
            sourceUnitId: unit.sourceUnitId,
          }),
          evidenceReferences: [{ id: unitEvidenceId, kind: 'source' }],
          confidence: 'high',
          _sourceUnitId: unit.sourceUnitId,
        });
      }

      // Program calls
      for (const call of scan.calls || []) {
        const target = normalizeName(call.name);
        if (!target) continue;
        const { spans, ids } = collectSpansFromEvidenceList(ctx, call.evidence || []);
        sourceSpans.push(...spans);
        let toSymbolId = knownPrograms.get(target);
        let relationshipType = 'PROGRAM_CALL';
        let derivationClass = DERIVATION_CLASSES.INFERRED;
        if (!toSymbolId) {
          toSymbolId = `sym:unresolved:program:${target}`;
          relationshipType = 'DYNAMIC_UNRESOLVED_CALL';
          derivationClass = DERIVATION_CLASSES.UNRESOLVED;
          if (!symbols.some(s => s.symbolId === toSymbolId)) {
            symbols.push({
              schemaVersion: 1,
              kind: 'project-knowledge-symbol',
              contractId: CONTRACT_IDS.SYMBOL,
              projectId,
              snapshotId,
              symbolId: toSymbolId,
              name: target,
              symbolKind: 'UNRESOLVED_SYMBOL',
              provenance: makeProvenance({
                projectId,
                snapshotId,
                contentHash: unit.contentHash,
                analyzerId,
                analyzerVersion,
                derivationClass: DERIVATION_CLASSES.UNRESOLVED,
                sourceUnitId: unit.sourceUnitId,
              }),
              evidenceReferences: [{ id: unitEvidenceId, kind: 'source' }],
              sourceSpanIds: ids,
              confidence: 'low',
              _sourceUnitId: unit.sourceUnitId,
            });
          }
          unresolved.push({
            kind: 'PROGRAM_CALL',
            name: target,
            fromSymbolId: programSymbolId,
            sourceUnitId: unit.sourceUnitId,
            spanIds: ids,
          });
        }
        relationships.push({
          schemaVersion: 1,
          kind: 'project-knowledge-relationship',
          contractId: CONTRACT_IDS.RELATIONSHIP,
          projectId,
          snapshotId,
          relationshipId: `rel:call:${programSymbolId}:${target}`,
          relationshipType,
          fromSymbolId: programSymbolId,
          toSymbolId,
          provenance: makeProvenance({
            projectId,
            snapshotId,
            contentHash: unit.contentHash,
            analyzerId,
            analyzerVersion,
            derivationClass,
            sourceUnitId: unit.sourceUnitId,
          }),
          evidenceReferences: [{ id: unitEvidenceId, kind: 'source' }],
          confidence: toSymbolId.startsWith('sym:unresolved') ? 'low' : 'high',
          _sourceUnitId: unit.sourceUnitId,
        });
      }

      // Procedure calls
      for (const pcall of scan.procedureCalls || []) {
        const target = normalizeName(pcall.name);
        if (!target) continue;
        const { spans, ids } = collectSpansFromEvidenceList(ctx, pcall.evidence || []);
        sourceSpans.push(...spans);
        let toSymbolId =
          knownProcedures.get(`${programName}::${target}`) || knownProcedures.get(target);
        let relationshipType = 'BOUND_PROCEDURE_CALL';
        let derivationClass = DERIVATION_CLASSES.INFERRED;
        if (!toSymbolId || String(pcall.resolution).toUpperCase() === 'UNRESOLVED') {
          if (!toSymbolId) {
            toSymbolId = `sym:unresolved:proc:${target}`;
            relationshipType = 'DYNAMIC_UNRESOLVED_CALL';
            derivationClass = DERIVATION_CLASSES.UNRESOLVED;
            if (!symbols.some(s => s.symbolId === toSymbolId)) {
              symbols.push({
                schemaVersion: 1,
                kind: 'project-knowledge-symbol',
                contractId: CONTRACT_IDS.SYMBOL,
                projectId,
                snapshotId,
                symbolId: toSymbolId,
                name: target,
                symbolKind: 'UNRESOLVED_SYMBOL',
                provenance: makeProvenance({
                  projectId,
                  snapshotId,
                  contentHash: unit.contentHash,
                  analyzerId,
                  analyzerVersion,
                  derivationClass: DERIVATION_CLASSES.UNRESOLVED,
                  sourceUnitId: unit.sourceUnitId,
                }),
                evidenceReferences: [{ id: unitEvidenceId, kind: 'source' }],
                sourceSpanIds: ids,
                confidence: 'low',
                _sourceUnitId: unit.sourceUnitId,
              });
            }
            unresolved.push({
              kind: 'PROCEDURE_CALL',
              name: target,
              fromSymbolId: programSymbolId,
              sourceUnitId: unit.sourceUnitId,
              spanIds: ids,
              resolution: pcall.resolution || 'UNRESOLVED',
            });
          }
        }
        const fromId =
          pcall.ownerKind === 'PROCEDURE' && pcall.ownerName
            ? knownProcedures.get(`${programName}::${normalizeName(pcall.ownerName)}`) ||
              programSymbolId
            : programSymbolId;
        relationships.push({
          schemaVersion: 1,
          kind: 'project-knowledge-relationship',
          contractId: CONTRACT_IDS.RELATIONSHIP,
          projectId,
          snapshotId,
          relationshipId: `rel:pcall:${fromId}:${target}`,
          relationshipType,
          fromSymbolId: fromId,
          toSymbolId,
          provenance: makeProvenance({
            projectId,
            snapshotId,
            contentHash: unit.contentHash,
            analyzerId,
            analyzerVersion,
            derivationClass,
            sourceUnitId: unit.sourceUnitId,
          }),
          evidenceReferences: [{ id: unitEvidenceId, kind: 'source' }],
          confidence: derivationClass === DERIVATION_CLASSES.UNRESOLVED ? 'low' : 'medium',
          _sourceUnitId: unit.sourceUnitId,
        });
      }

      // Service programs / modules / binding directories
      for (const sp of scan.servicePrograms || []) {
        const name = normalizeName(sp.name);
        if (!name) continue;
        const symbolId = `sym:srvpgm:${name}`;
        if (!symbols.some(s => s.symbolId === symbolId)) {
          symbols.push({
            schemaVersion: 1,
            kind: 'project-knowledge-symbol',
            contractId: CONTRACT_IDS.SYMBOL,
            projectId,
            snapshotId,
            symbolId,
            name,
            symbolKind: 'SERVICE_PROGRAM',
            provenance: makeProvenance({
              projectId,
              snapshotId,
              contentHash: unit.contentHash,
              analyzerId,
              analyzerVersion,
              derivationClass: DERIVATION_CLASSES.INFERRED,
              sourceUnitId: unit.sourceUnitId,
            }),
            evidenceReferences: [{ id: unitEvidenceId, kind: 'source' }],
            sourceSpanIds: [],
            confidence: 'medium',
            _sourceUnitId: unit.sourceUnitId,
          });
        }
        relationships.push({
          schemaVersion: 1,
          kind: 'project-knowledge-relationship',
          contractId: CONTRACT_IDS.RELATIONSHIP,
          projectId,
          snapshotId,
          relationshipId: `rel:srv:${programSymbolId}:${name}`,
          relationshipType: 'SERVICE_PROGRAM_IMPORT',
          fromSymbolId: programSymbolId,
          toSymbolId: symbolId,
          provenance: makeProvenance({
            projectId,
            snapshotId,
            contentHash: unit.contentHash,
            analyzerId,
            analyzerVersion,
            derivationClass: DERIVATION_CLASSES.INFERRED,
            sourceUnitId: unit.sourceUnitId,
          }),
          evidenceReferences: [{ id: unitEvidenceId, kind: 'source' }],
          confidence: 'medium',
          _sourceUnitId: unit.sourceUnitId,
        });
      }
    }

    // Deterministic sort + dedupe
    const dedupe = (arr, key) => {
      const map = new Map();
      for (const item of arr) map.set(item[key], item);
      return Array.from(map.values()).sort((a, b) => String(a[key]).localeCompare(String(b[key])));
    };

    const finalSymbols = dedupe(symbols, 'symbolId');
    const finalRelationships = dedupe(relationships, 'relationshipId');
    const finalEvidence = dedupe(evidence, 'evidenceId');
    const finalSpans = dedupe(sourceSpans, 'spanId');
    unresolved.sort((a, b) => {
      const ka = `${a.kind}:${a.name}:${a.fromSymbolId}`;
      const kb = `${b.kind}:${b.name}:${b.fromSymbolId}`;
      return ka.localeCompare(kb);
    });

    const analyzerRun = {
      schemaVersion: 1,
      kind: 'project-knowledge-analyzer-run',
      contractId: CONTRACT_IDS.ANALYZER_RUN,
      projectId,
      snapshotId,
      analyzerRunId: `run:${analyzerId}:${snapshotId}`,
      analyzerId,
      analyzerVersion,
      inputInventoryHash: '',
      status: ANALYZER_RUN_STATUSES.SUCCEEDED,
    };

    return {
      analyzerRun,
      symbols: finalSymbols,
      relationships: finalRelationships,
      evidence: finalEvidence,
      sourceSpans: finalSpans,
      unresolved,
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
  createRpgAnalyzer,
  ANALYZER_ID,
  ANALYZER_VERSION,
};
