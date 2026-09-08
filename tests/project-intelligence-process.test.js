'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const zpi = require('../src/projectIntelligence');
const { CONTRACT_IDS, DERIVATION_CLASSES, PROCESS_STATUSES } = zpi;

function graphFixture() {
  return {
    schemaVersion: 1,
    kind: 'evidence-graph',
    program: 'STARTPGM',
    nodes: [
      {
        id: 'PROGRAM:STARTPGM',
        type: 'PROGRAM',
        name: 'STARTPGM',
        locations: [{ file: 'src/STARTPGM.rpgle', startLine: 10, endLine: 12 }],
        confidence: 'HIGH',
      },
      {
        id: 'PROGRAM:WORKPGM',
        type: 'PROGRAM',
        name: 'WORKPGM',
        locations: [{ file: 'src/WORKPGM.rpgle', startLine: 20, endLine: 24 }],
        confidence: 'MEDIUM',
      },
      {
        id: 'TABLE:ORDERS',
        type: 'TABLE',
        name: 'ORDERS',
        locations: [{ file: 'src/WORKPGM.rpgle', startLine: 40, endLine: 40 }],
      },
      {
        id: 'UNRESOLVED_SYMBOL:MISSINGPGM',
        type: 'UNRESOLVED_SYMBOL',
        name: 'MISSINGPGM',
        locations: [],
      },
    ],
    edges: [
      {
        id: 'PROGRAM_CALL:PROGRAM:STARTPGM->PROGRAM:WORKPGM',
        type: 'PROGRAM_CALL',
        from: 'PROGRAM:STARTPGM',
        to: 'PROGRAM:WORKPGM',
        locations: [{ file: 'src/STARTPGM.rpgle', startLine: 15 }],
        confidence: 'HIGH',
      },
      {
        id: 'TABLE_REFERENCE:PROGRAM:WORKPGM->TABLE:ORDERS',
        type: 'TABLE_REFERENCE',
        from: 'PROGRAM:WORKPGM',
        to: 'TABLE:ORDERS',
        locations: [{ file: 'src/WORKPGM.rpgle', startLine: 40 }],
        confidence: 'MEDIUM',
      },
      {
        id: 'DYNAMIC_UNRESOLVED_CALL:PROGRAM:WORKPGM->UNRESOLVED_SYMBOL:MISSINGPGM',
        type: 'DYNAMIC_UNRESOLVED_CALL',
        from: 'PROGRAM:WORKPGM',
        to: 'UNRESOLVED_SYMBOL:MISSINGPGM',
        locations: [{ file: 'src/WORKPGM.rpgle', startLine: 60 }],
        confidence: 'LOW',
      },
    ],
  };
}

test('process contracts enforce evidence and explicit review state', () => {
  const valid = zpi.validateProjectIntelligenceContract(
    CONTRACT_IDS.PROCESS_CLAIM,
    zpi.fixtures.processClaim()
  );
  assert.equal(valid.ok, true, JSON.stringify(valid.errors));

  const missingEvidence = zpi.processClaimSchema(
    zpi.fixtures.processClaim({ evidenceReferences: [] })
  );
  assert.ok(missingEvidence.some(error => error.path === '/evidenceReferences'));

  const unapproved = zpi.processVersionSchema(
    zpi.fixtures.processVersion({
      status: PROCESS_STATUSES.REVIEWED,
      review: { reviewerId: 'reviewer-1', reviewedAt: '2026-09-08T12:00:00.000Z', approved: false },
    })
  );
  assert.ok(unapproved.some(error => error.path === '/review/approved'));
});

test('discovery is deterministic and preserves unresolved dependencies', () => {
  const first = zpi.discoverProcessCandidates(graphFixture(), {
    projectId: 'proj-demo',
    snapshotId: 'snap-001',
  });
  const second = zpi.discoverProcessCandidates(graphFixture(), {
    projectId: 'proj-demo',
    snapshotId: 'snap-001',
  });
  assert.deepEqual(first, second);
  assert.equal(first.summary.candidateCount, 1);
  assert.ok(first.candidates[0].process.unknowns.some(value => value.includes('MISSINGPGM')));
  assert.ok(
    first.diagnostics.some(diagnostic => diagnostic.reasonCode === 'ZPI.CAPABILITY_UNAVAILABLE')
  );
  assert.ok(first.evidenceCatalog.some(entry => entry.kind === 'source-location'));
  assert.equal(zpi.validateProcessCandidate(first.candidates[0]).ok, true);
});

test('description workflow stays candidate until explicit review and publish', () => {
  const catalog = zpi.discoverProcessCandidates(graphFixture(), {
    projectId: 'proj-demo',
    snapshotId: 'snap-001',
  });
  const described = zpi.buildProcessDescription(catalog.candidates[0]);
  assert.equal(described.version.status, PROCESS_STATUSES.CANDIDATE);
  assert.match(described.version.description.goal, /not established/i);
  assert.match(zpi.buildProcessDescriptionPrompt(catalog.candidates[0]), /Do not invent/i);

  const reviewed = zpi.reviewProcessDescription(described, {
    reviewerId: 'reviewer-1',
    reviewedAt: '2026-09-08T12:00:00.000Z',
    approved: true,
  });
  assert.equal(reviewed.version.status, PROCESS_STATUSES.REVIEWED);
  assert.equal(reviewed.version.review.approved, true);

  const published = zpi.publishProcessDescription(reviewed, {
    publishedAt: '2026-09-08T12:01:00.000Z',
  });
  assert.equal(published.version.status, PROCESS_STATUSES.PUBLISHED);
  assert.equal(published.process.status, PROCESS_STATUSES.PUBLISHED);
  assert.equal(zpi.validateProcessCandidate(published).ok, true);
});

test('verified process claims cannot omit evidence', () => {
  const errors = zpi.processClaimSchema(
    zpi.fixtures.processClaim({
      derivationClass: DERIVATION_CLASSES.VERIFIED,
      provenance: zpi.fixtures.processProvenance({ derivationClass: DERIVATION_CLASSES.VERIFIED }),
      evidenceReferences: [],
    })
  );
  assert.ok(errors.some(error => error.path === '/evidenceReferences'));
});
