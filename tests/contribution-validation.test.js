'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { DERIVATION_CLASSES } = require('../src/projectIntelligence/constants');
const {
  createContributionPackage,
  writeContributionPackage,
} = require('../src/projectIntelligence/export/contributionPackage');
const {
  CONTRIBUTION_GATE_CODES,
  GATE_ORDER,
  validateContributionPackage,
} = require('../src/projectIntelligence/export/contributionValidation');

const BASE_SNAPSHOT = Object.freeze({
  snapshotId: 'snapshot-001',
  contentHash: 'a'.repeat(64),
});

function contributionOptions(overrides = {}) {
  return {
    contributionId: 'instance-a:contribution-001',
    originInstanceId: 'instance-a',
    baseSnapshot: BASE_SNAPSHOT,
    contractVersions: {
      'knowledge.contribution': '1',
    },
    derivationClass: DERIVATION_CLASSES.INFERRED,
    evidenceReferences: [{ id: 'evidence-001', contract: 'evidence@1' }],
    provenance: {
      collector: 'local-adapter',
      collectedAt: '2026-09-25T10:00:00.000Z',
      trustZone: 'local',
      capability: 'knowledge-contribution',
      disclosure: 'private',
    },
    privacyReport: { status: 'passed', redacted: false },
    qualityReport: { status: 'passed' },
    payload: { fact: 'structured observation', sourceId: 'source-001' },
    ...overrides,
  };
}

function policy(overrides = {}) {
  return {
    currentSnapshot: BASE_SNAPSHOT,
    expectedBaseSnapshot: BASE_SNAPSHOT,
    requiredContractVersions: { 'knowledge.contribution': '1' },
    allowedTrustZones: ['local'],
    allowedCapabilities: ['knowledge-contribution'],
    allowedDisclosure: ['private'],
    ...overrides,
  };
}

function tempPackageDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'contribution-validation-'));
}

function withPackage(options, callback) {
  const packageDir = tempPackageDir();
  try {
    writeContributionPackage({ packageDir, ...options });
    return callback(packageDir);
  } finally {
    fs.rmSync(packageDir, { recursive: true, force: true });
  }
}

test('validates deterministically in the fixed gate order', () => {
  const options = contributionOptions();
  const first = withPackage(options, packageDir =>
    validateContributionPackage({ packageDir, policy: policy() })
  );
  const second = withPackage(options, packageDir =>
    validateContributionPackage({ packageDir, policy: policy() })
  );

  assert.equal(first.ok, true);
  assert.equal(first.status, 'passed');
  assert.equal(first.canStage, true);
  assert.equal(first.canPublish, false);
  assert.deepEqual(first.reasonCodes, []);
  assert.deepEqual(
    first.gates.map(gate => gate.id),
    GATE_ORDER
  );
  assert.deepEqual(first.gates, second.gates);
  assert.equal(first.inputFingerprint, second.inputFingerprint);
  assert.equal(first.readOnly, true);
});

test('rejects integrity, schema, version and base-snapshot failures', () => {
  const contribution = createContributionPackage(contributionOptions());
  const invalid = validateContributionPackage({
    package: {
      ...contribution,
      schema: 'knowledge.contribution@2',
      manifest: {
        ...contribution.manifest,
        baseSnapshot: { snapshotId: 'snapshot-002', contentHash: 'b'.repeat(64) },
      },
    },
    policy: policy({
      expectedBaseSnapshot: { snapshotId: 'snapshot-003', contentHash: 'c'.repeat(64) },
      requiredContractVersions: { 'knowledge.contribution': '2' },
    }),
  });

  assert.equal(invalid.ok, false);
  assert.equal(invalid.status, 'failed');
  assert.equal(invalid.canStage, false);
  assert.equal(invalid.canPublish, false);
  assert.ok(invalid.reasonCodes.includes(CONTRIBUTION_GATE_CODES.PACKAGE_INVALID));
  assert.ok(invalid.reasonCodes.includes(CONTRIBUTION_GATE_CODES.SCHEMA_UNSUPPORTED));
  assert.ok(invalid.reasonCodes.includes(CONTRIBUTION_GATE_CODES.CONTRACT_VERSION_MISMATCH));
  assert.ok(invalid.reasonCodes.includes(CONTRIBUTION_GATE_CODES.BASE_SNAPSHOT_MISMATCH));
});

test('rejects freshness, provenance, evidence, privacy and policy failures', () => {
  const options = contributionOptions({
    provenance: { collector: '', collectedAt: '', trustZone: 'remote', capability: 'other' },
    privacyReport: { status: 'failed' },
  });
  const result = withPackage(options, packageDir =>
    validateContributionPackage({
      packageDir,
      policy: policy({
        currentSnapshot: { snapshotId: 'snapshot-002', contentHash: 'b'.repeat(64) },
      }),
    })
  );

  assert.equal(result.canStage, false);
  assert.ok(result.reasonCodes.includes(CONTRIBUTION_GATE_CODES.FRESHNESS_STALE));
  assert.ok(result.reasonCodes.includes(CONTRIBUTION_GATE_CODES.PROVENANCE_INVALID));
  assert.ok(result.reasonCodes.includes(CONTRIBUTION_GATE_CODES.PRIVACY_FAILED));
  assert.ok(result.reasonCodes.includes(CONTRIBUTION_GATE_CODES.TRUST_ZONE_DENIED));
  assert.ok(result.reasonCodes.includes(CONTRIBUTION_GATE_CODES.CAPABILITY_DENIED));

  const contribution = createContributionPackage(contributionOptions());
  const missingEvidence = validateContributionPackage({
    package: {
      ...contribution,
      manifest: {
        ...contribution.manifest,
        derivationClass: DERIVATION_CLASSES.VERIFIED,
        evidenceReferences: [],
      },
    },
    policy: policy(),
  });
  assert.ok(missingEvidence.reasonCodes.includes(CONTRIBUTION_GATE_CODES.EVIDENCE_REQUIRED));
});

test('rejects unsafe disclosure paths, duplicates and rejected lifecycle states', () => {
  const contribution = createContributionPackage(contributionOptions());
  const unsafe = validateContributionPackage({
    package: {
      ...contribution,
      manifest: {
        ...contribution.manifest,
        provenance: {
          ...contribution.manifest.provenance,
          sourcePath: 'C:\\private\\input.txt',
        },
        status: 'rejected',
      },
    },
    policy: policy({
      knownContributionIds: [contribution.contributionId],
      allowedDisclosure: ['restricted'],
    }),
  });

  assert.equal(unsafe.canStage, false);
  assert.ok(unsafe.reasonCodes.includes(CONTRIBUTION_GATE_CODES.PACKAGE_INVALID));
  assert.ok(unsafe.reasonCodes.includes(CONTRIBUTION_GATE_CODES.PATH_UNSAFE));
  assert.ok(unsafe.reasonCodes.includes(CONTRIBUTION_GATE_CODES.DISCLOSURE_DENIED));
  assert.ok(unsafe.reasonCodes.includes(CONTRIBUTION_GATE_CODES.DUPLICATE_CONTRIBUTION));
  assert.ok(unsafe.reasonCodes.includes(CONTRIBUTION_GATE_CODES.LIFECYCLE_REJECTED));
});

test('provider-derived output remains advisory and proposed', () => {
  const contribution = createContributionPackage(
    contributionOptions({
      provenance: {
        collector: 'local-adapter',
        collectedAt: '2026-09-25T10:00:00.000Z',
        trustZone: 'local',
        capability: 'knowledge-contribution',
        disclosure: 'private',
        providerId: 'provider-001',
      },
      status: 'accepted',
    })
  );
  const result = validateContributionPackage({
    package: contribution,
    policy: policy(),
  });

  assert.equal(result.canStage, false);
  assert.ok(result.reasonCodes.includes(CONTRIBUTION_GATE_CODES.EVIDENCE_REQUIRED));
  assert.ok(result.reasonCodes.includes(CONTRIBUTION_GATE_CODES.LIFECYCLE_REJECTED));
});

test('invalid input fails closed without writing state', () => {
  const result = validateContributionPackage({ package: null, policy: policy() });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'failed');
  assert.equal(result.canStage, false);
  assert.equal(result.canPublish, false);
  assert.deepEqual(result.reasonCodes, [CONTRIBUTION_GATE_CODES.PACKAGE_INVALID]);
});
