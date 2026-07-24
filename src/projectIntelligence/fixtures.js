'use strict';

/**
 * Synthetic fixtures for ZPI contract tests only.
 * No real customer paths, hostnames, or source content.
 */

const CONTRACT_IDS = require('./contractIds');
const {
  DERIVATION_CLASSES,
  SNAPSHOT_STATUSES,
  ANALYZER_RUN_STATUSES,
  EVIDENCE_CLASSES,
  DIAGNOSTIC_SEVERITIES,
  REASON_CODES,
} = require('./constants');

const HASH_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HASH_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function provenance(overrides = {}) {
  return {
    projectId: 'proj-demo',
    snapshotId: 'snap-001',
    sourceHash: HASH_A,
    analyzerId: 'zeus.rpg-baseline',
    analyzerVersion: '1.0.0',
    derivationClass: DERIVATION_CLASSES.INFERRED,
    ...overrides,
  };
}

function project(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'project-knowledge-project',
    contractId: CONTRACT_IDS.PROJECT,
    projectId: 'proj-demo',
    displayName: 'Synthetic demo project',
    trustedRoots: [
      {
        rootId: 'root-src',
        relativeLabel: 'QRPGLESRC',
      },
    ],
    schemaBindings: {
      storeSchemaVersion: 1,
      searchSchemaVersion: 1,
      artifactSchemaVersion: 1,
    },
    safety: { level: 'S1', localOnly: true },
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'project-knowledge-snapshot',
    contractId: CONTRACT_IDS.SNAPSHOT,
    projectId: 'proj-demo',
    snapshotId: 'snap-001',
    status: SNAPSHOT_STATUSES.PUBLISHED,
    isCurrent: true,
    sourceInventoryHash: HASH_B,
    storeSchemaVersion: 1,
    searchSchemaVersion: 1,
    artifactSchemaVersion: 1,
    contentAddressing: { algorithm: 'sha256' },
    analyzerRunIds: ['run-001'],
    publishedAt: '2026-07-22T12:00:00.000Z',
    ...overrides,
  };
}

function sourceUnit(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'project-knowledge-source-unit',
    contractId: CONTRACT_IDS.SOURCE_UNIT,
    projectId: 'proj-demo',
    snapshotId: 'snap-001',
    sourceUnitId: 'su-orderpgm',
    relativePath: 'QRPGLESRC/ORDERPGM.rpgle',
    contentHash: HASH_A,
    trustedRootId: 'root-src',
    language: 'rpgle',
    sizeBytes: 128,
    hashAlgorithm: 'sha256',
    ...overrides,
  };
}

function sourceSpan(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'project-knowledge-source-span',
    contractId: CONTRACT_IDS.SOURCE_SPAN,
    projectId: 'proj-demo',
    snapshotId: 'snap-001',
    spanId: 'span-1',
    sourceUnitId: 'su-orderpgm',
    contentHash: HASH_A,
    start: { line: 10, column: 1 },
    end: { line: 20, column: 1 },
    ...overrides,
  };
}

function symbol(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'project-knowledge-symbol',
    contractId: CONTRACT_IDS.SYMBOL,
    projectId: 'proj-demo',
    snapshotId: 'snap-001',
    symbolId: 'sym-orderpgm',
    name: 'ORDERPGM',
    symbolKind: 'PROGRAM',
    provenance: provenance({ derivationClass: DERIVATION_CLASSES.VERIFIED }),
    evidenceReferences: [{ id: 'ev-1', kind: 'source' }],
    sourceSpanIds: ['span-1'],
    confidence: 'high',
    ...overrides,
  };
}

function relationship(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'project-knowledge-relationship',
    contractId: CONTRACT_IDS.RELATIONSHIP,
    projectId: 'proj-demo',
    snapshotId: 'snap-001',
    relationshipId: 'rel-1',
    relationshipType: 'PROGRAM_CALL',
    fromSymbolId: 'sym-orderpgm',
    toSymbolId: 'sym-custinq',
    provenance: provenance({ derivationClass: DERIVATION_CLASSES.INFERRED }),
    evidenceReferences: [{ id: 'ev-1', kind: 'source' }],
    ...overrides,
  };
}

function analyzerRun(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'project-knowledge-analyzer-run',
    contractId: CONTRACT_IDS.ANALYZER_RUN,
    projectId: 'proj-demo',
    snapshotId: 'snap-001',
    analyzerRunId: 'run-001',
    analyzerId: 'zeus.rpg-baseline',
    analyzerVersion: '1.0.0',
    inputInventoryHash: HASH_B,
    status: ANALYZER_RUN_STATUSES.SUCCEEDED,
    startedAt: '2026-07-22T11:59:00.000Z',
    completedAt: '2026-07-22T12:00:00.000Z',
    ...overrides,
  };
}

function evidence(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'project-knowledge-evidence',
    contractId: CONTRACT_IDS.EVIDENCE,
    projectId: 'proj-demo',
    snapshotId: 'snap-001',
    evidenceId: 'ev-1',
    sourceUnitId: 'su-orderpgm',
    contentHash: HASH_A,
    evidenceClass: EVIDENCE_CLASSES.SOURCE,
    trustedRootId: 'root-src',
    relativePath: 'QRPGLESRC/ORDERPGM.rpgle',
    sourceSpanIds: ['span-1'],
    ...overrides,
  };
}

function summary(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'project-knowledge-summary',
    contractId: CONTRACT_IDS.SUMMARY,
    projectId: 'proj-demo',
    snapshotId: 'snap-001',
    summaryId: 'sum-1',
    text: 'ORDERPGM appears to call CUSTINQ (inferred).',
    sourceOfTruth: false,
    advisory: true,
    derivationClass: DERIVATION_CLASSES.INFERRED,
    evidenceReferences: [{ id: 'ev-1', kind: 'source' }],
    ...overrides,
  };
}

function diagnostic(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'project-knowledge-diagnostic',
    contractId: CONTRACT_IDS.DIAGNOSTIC,
    projectId: 'proj-demo',
    snapshotId: 'snap-001',
    diagnosticId: 'diag-1',
    severity: DIAGNOSTIC_SEVERITIES.WARNING,
    reasonCode: REASON_CODES.OMISSION_REPORTED,
    message: 'Token budget excluded secondary copy members',
    relatedIds: ['su-copy1'],
    ...overrides,
  };
}

function contextPackage(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'project-knowledge-context-package',
    contractId: CONTRACT_IDS.CONTEXT_PACKAGE,
    projectId: 'proj-demo',
    snapshotId: 'snap-001',
    packageId: 'ctx-1',
    policyId: 'zeus.community-default-context',
    policyVersion: '1.0.0',
    sourceOfTruth: false,
    advisory: true,
    tokenBudget: 4000,
    selected: [
      {
        id: 'sym-orderpgm',
        kind: 'symbol',
        reasons: ['query-target'],
      },
    ],
    omissions: [
      {
        reasonCode: REASON_CODES.TOKEN_BUDGET_EXCEEDED,
        description: 'Secondary neighborhood omitted',
        entityId: 'sym-other',
      },
    ],
    evidenceReferences: [{ id: 'ev-1', kind: 'source' }],
    nonClaims: ['Not a compile result', 'Not source of truth'],
    ...overrides,
  };
}

function operationResultOk(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'project-knowledge-operation-result',
    contractId: CONTRACT_IDS.OPERATION_RESULT,
    ok: true,
    projectId: 'proj-demo',
    snapshotId: 'snap-001',
    operation: 'inspect-snapshot',
    ...overrides,
  };
}

function operationResultFail(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'project-knowledge-operation-result',
    contractId: CONTRACT_IDS.OPERATION_RESULT,
    ok: false,
    reasonCode: REASON_CODES.SNAPSHOT_NOT_CURRENT,
    message: 'Snapshot is not the current published pointer',
    projectId: 'proj-demo',
    snapshotId: 'snap-000',
    operation: 'query',
    ...overrides,
  };
}

module.exports = {
  HASH_A,
  HASH_B,
  provenance,
  project,
  snapshot,
  sourceUnit,
  sourceSpan,
  symbol,
  relationship,
  analyzerRun,
  evidence,
  summary,
  diagnostic,
  contextPackage,
  operationResultOk,
  operationResultFail,
};
