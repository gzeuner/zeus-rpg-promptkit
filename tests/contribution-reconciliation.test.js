'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { DERIVATION_CLASSES } = require('../src/projectIntelligence/constants');
const {
  createContributionPackage,
} = require('../src/projectIntelligence/export/contributionPackage');
const {
  CONTRIBUTION_RECONCILIATION_SCHEMA,
  reconcileContribution,
} = require('../src/projectIntelligence/export/contributionReconciliation');

const BASE_SNAPSHOT = Object.freeze({
  snapshotId: 'snapshot-001',
  contentHash: 'a'.repeat(64),
});

function contributionOptions(overrides = {}) {
  return {
    contributionId: 'instance-001:contribution-001',
    originInstanceId: 'instance-001',
    baseSnapshot: BASE_SNAPSHOT,
    contractVersions: { 'knowledge.contribution': '1' },
    derivationClass: DERIVATION_CLASSES.INFERRED,
    evidenceReferences: [{ id: 'evidence-001', contract: 'evidence@1' }],
    provenance: {
      collector: 'local-adapter',
      collectedAt: '2026-09-25T10:00:00.000Z',
    },
    privacyReport: { status: 'passed' },
    qualityReport: { status: 'passed' },
    payload: { facts: { item: { state: 'ready' } } },
    ...overrides,
  };
}

function createPackage(overrides = {}) {
  return createContributionPackage(contributionOptions(overrides));
}

function reconcile(contribution, overrides = {}) {
  return reconcileContribution({
    package: contribution,
    currentSnapshot: BASE_SNAPSHOT,
    targetFacts: { item: { state: 'ready' } },
    ...overrides,
  });
}

test('produces deterministic duplicate findings and a manual rejection proposal', () => {
  const contribution = createPackage();
  const options = {
    existingContributions: [
      {
        contributionId: contribution.contributionId,
        packageHash: contribution.manifest.packageHash,
      },
    ],
    validationPolicy: {
      knownContributionIds: [contribution.contributionId],
    },
  };

  const first = reconcile(contribution, options);
  const second = reconcile(contribution, options);

  assert.deepEqual(first, second);
  assert.equal(first.schema, CONTRIBUTION_RECONCILIATION_SCHEMA);
  assert.equal(first.findings[0].type, 'DUPLICATE');
  assert.match(first.findings[0].findingId, /^finding-[a-f0-9]{64}$/);
  assert.equal(first.proposals[0].action, 'reject');
  assert.equal(first.proposals[0].automatic, false);
  assert.equal(first.validation.ok, false);
});

test('reports stale input without replacing the current snapshot', () => {
  const contribution = createPackage({
    baseSnapshot: { snapshotId: 'snapshot-000', contentHash: 'b'.repeat(64) },
  });
  const result = reconcile(contribution);

  assert.ok(result.findings.some(finding => finding.type === 'STALE'));
  assert.equal(result.proposals[0].action, 'reject');
  assert.equal(result.findings.find(finding => finding.type === 'STALE').decision, null);
  assert.equal(result.validationPassed, false);
});

test('keeps semantic conflicts reviewable with evidence and provenance', () => {
  const contribution = createPackage({
    payload: { facts: { item: { state: 'changed' } } },
  });
  const result = reconcile(contribution);
  const finding = result.findings.find(entry => entry.type === 'SEMANTIC_CONFLICT');

  assert.ok(finding);
  assert.deepEqual(finding.evidenceReferences, contribution.manifest.evidenceReferences);
  assert.deepEqual(finding.provenance, contribution.manifest.provenance);
  assert.deepEqual(finding.decisionHistory, []);
  assert.equal(result.proposals[0].action, 'reject');
  assert.equal(result.proposals[0].automatic, false);
});

test('returns no-change with an explicit manual acceptance proposal', () => {
  const result = reconcile(createPackage());

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].type, 'NO_CHANGE');
  assert.equal(result.proposals[0].action, 'accept');
  assert.equal(result.proposals[0].status, 'proposed');
  assert.equal(result.proposals[0].automatic, false);
  assert.equal(result.validationPassed, true);
});

test('prepares supersede without mutating package, facts, or existing status', () => {
  const contribution = createPackage({ contributionId: 'instance-001:contribution-002' });
  const existingContributions = [
    {
      contributionId: 'instance-001:contribution-001',
      packageHash: 'c'.repeat(64),
      status: 'accepted',
    },
  ];
  const packageBefore = JSON.stringify({
    manifest: contribution.manifest,
    payload: contribution.payload,
  });
  const existingBefore = JSON.stringify(existingContributions);

  const result = reconcile(contribution, {
    existingContributions,
    supersedesContributionId: 'instance-001:contribution-001',
  });

  assert.ok(result.findings.some(entry => entry.type === 'SUPERSEDE'));
  assert.equal(result.proposals[0].action, 'supersede');
  assert.equal(result.proposals[0].automatic, false);
  assert.equal(
    JSON.stringify({ manifest: contribution.manifest, payload: contribution.payload }),
    packageBefore
  );
  assert.equal(JSON.stringify(existingContributions), existingBefore);
});

test('exposes validation and remains read-only for invalid package integrity', () => {
  const contribution = createPackage();
  const invalid = {
    ...contribution,
    manifest: { ...contribution.manifest, packageHash: 'd'.repeat(64) },
  };
  const result = reconcile(invalid);

  assert.equal(result.ok, true);
  assert.equal(result.validation.ok, false);
  assert.equal(result.validationPassed, false);
  assert.equal(result.proposals[0].automatic, false);
  assert.equal(contribution.manifest.packageHash, contribution.hashes.packageHash);
});
