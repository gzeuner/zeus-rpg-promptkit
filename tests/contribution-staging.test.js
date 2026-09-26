'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { DERIVATION_CLASSES } = require('../src/projectIntelligence/constants');
const {
  writeContributionPackage,
} = require('../src/projectIntelligence/export/contributionPackage');
const {
  ContributionStagingError,
  STAGING_REASON_CODES,
  cleanupStagedContributions,
  getStagingPaths,
  pathSafeId,
  planStagingCleanup,
  readStagedContribution,
  stageContributionPackage,
  transitionStagedContribution,
} = require('../src/projectIntelligence/export/contributionStaging');

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
      trustZone: 'local',
      capability: 'knowledge-contribution',
      disclosure: 'private',
    },
    privacyReport: { status: 'passed' },
    qualityReport: { status: 'passed' },
    payload: { fact: 'structured observation', value: 1 },
    ...overrides,
  };
}

function validationPolicy() {
  return {
    currentSnapshot: BASE_SNAPSHOT,
    expectedBaseSnapshot: BASE_SNAPSHOT,
    requiredContractVersions: { 'knowledge.contribution': '1' },
    allowedTrustZones: ['local'],
    allowedCapabilities: ['knowledge-contribution'],
    allowedDisclosure: ['private'],
  };
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fkx-staging-'));
}

function sourcePackage(root, overrides = {}) {
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  writeContributionPackage({
    packageDir: source,
    ...contributionOptions(overrides),
  });
  return source;
}

function stageOptions(stagingRoot, packageDir, overrides = {}) {
  return {
    stagingRoot,
    packageDir,
    policy: validationPolicy(),
    actor: 'actor-001',
    now: '2026-09-26T10:00:00.000Z',
    ...overrides,
  };
}

function cleanupRoot(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test('stores canonical package bytes below its content hash', () => {
  const root = tempRoot();
  try {
    const packageDir = sourcePackage(root);
    const result = stageContributionPackage(stageOptions(path.join(root, 'staging'), packageDir));
    const paths = getStagingPaths(path.join(root, 'staging'));
    const stagedPackage = path.join(paths.root, result.packagePath);
    const stagedRecord = path.join(paths.root, result.recordPath);

    assert.equal(result.ok, true);
    assert.equal(result.operation, 'staged');
    assert.equal(result.idempotent, false);
    assert.equal(result.publication, false);
    assert.equal(path.basename(stagedPackage), result.packageHash);
    assert.match(path.basename(stagedRecord), /^id-[a-f0-9]{64}\.json$/);
    assert.deepEqual(fs.readdirSync(stagedPackage).sort(), ['manifest.json', 'payload.json']);
    assert.equal(fs.existsSync(paths.lock), false);
    assert.equal(
      fs.readdirSync(paths.packages).some(name => name.startsWith('.tmp-')),
      false
    );
  } finally {
    cleanupRoot(root);
  }
});

test('repeating the same package is idempotent and a different identity conflicts', () => {
  const root = tempRoot();
  try {
    const stagingRoot = path.join(root, 'staging');
    const firstPackage = sourcePackage(root, { payload: { fact: 'first', value: 1 } });
    const first = stageContributionPackage(stageOptions(stagingRoot, firstPackage));
    const repeated = stageContributionPackage(stageOptions(stagingRoot, firstPackage));
    assert.equal(repeated.operation, 'idempotent');
    assert.equal(repeated.idempotent, true);
    assert.equal(repeated.historyLength, 1);

    const secondPackage = path.join(root, 'source-2');
    fs.mkdirSync(secondPackage);
    writeContributionPackage({
      packageDir: secondPackage,
      ...contributionOptions({ payload: { fact: 'second', value: 2 } }),
    });
    assert.throws(
      () => stageContributionPackage(stageOptions(stagingRoot, secondPackage)),
      error =>
        error instanceof ContributionStagingError && error.code === STAGING_REASON_CODES.CONFLICT
    );
    const stored = readStagedContribution({ stagingRoot, contributionId: first.contributionId });
    assert.equal(stored.packageHash, first.packageHash);
    assert.equal(stored.record.history.length, 1);
  } finally {
    cleanupRoot(root);
  }
});

test('records controlled lifecycle transitions without publication', () => {
  const root = tempRoot();
  try {
    const stagingRoot = path.join(root, 'staging');
    const packageDir = sourcePackage(root);
    const staged = stageContributionPackage(stageOptions(stagingRoot, packageDir));
    const accepted = transitionStagedContribution({
      stagingRoot,
      contributionId: staged.contributionId,
      targetStatus: 'accepted',
      actor: 'actor-002',
      reasonCode: 'FKX.REVIEW_ACCEPTED',
      now: '2026-09-26T10:01:00.000Z',
    });
    const superseded = transitionStagedContribution({
      stagingRoot,
      contributionId: staged.contributionId,
      targetStatus: 'superseded',
      actor: 'actor-003',
      reasonCode: 'FKX.REPLACED',
      now: '2026-09-26T10:02:00.000Z',
    });

    assert.equal(accepted.status, 'accepted');
    assert.equal(superseded.status, 'superseded');
    assert.equal(superseded.publication, false);
    assert.deepEqual(
      readStagedContribution({
        stagingRoot,
        contributionId: staged.contributionId,
      }).record.history.map(entry => entry.status),
      ['proposed', 'accepted', 'superseded']
    );
    assert.throws(
      () =>
        transitionStagedContribution({
          stagingRoot,
          contributionId: staged.contributionId,
          targetStatus: 'proposed',
        }),
      error =>
        error instanceof ContributionStagingError &&
        error.code === STAGING_REASON_CODES.LIFECYCLE_REJECTED
    );
    assert.equal(fs.existsSync(path.join(stagingRoot, 'published')), false);
  } finally {
    cleanupRoot(root);
  }
});

test('detects damaged package bytes and writer conflicts', () => {
  const root = tempRoot();
  try {
    const stagingRoot = path.join(root, 'staging');
    const packageDir = sourcePackage(root);
    const staged = stageContributionPackage(stageOptions(stagingRoot, packageDir));
    const packagePath = path.join(stagingRoot, staged.packagePath, 'payload.json');
    fs.writeFileSync(packagePath, '{"value":9}\n', 'utf8');
    assert.throws(
      () => readStagedContribution({ stagingRoot, contributionId: staged.contributionId }),
      error =>
        error instanceof ContributionStagingError &&
        error.code === STAGING_REASON_CODES.PACKAGE_CORRUPT
    );

    const lockPath = getStagingPaths(stagingRoot).lock;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, '{}\n', 'utf8');
    assert.throws(
      () => stageContributionPackage(stageOptions(stagingRoot, packageDir)),
      error =>
        error instanceof ContributionStagingError &&
        error.code === STAGING_REASON_CODES.WRITER_CONFLICT
    );
  } finally {
    cleanupRoot(root);
  }
});

test('cleanup requires a dry-run plan and explicit permission', () => {
  const root = tempRoot();
  try {
    const stagingRoot = path.join(root, 'staging');
    const packageDir = sourcePackage(root);
    const staged = stageContributionPackage(stageOptions(stagingRoot, packageDir));
    transitionStagedContribution({
      stagingRoot,
      contributionId: staged.contributionId,
      targetStatus: 'rejected',
      actor: 'actor-002',
      now: '2026-09-26T10:03:00.000Z',
    });
    const plan = planStagingCleanup({
      stagingRoot,
      olderThan: '2026-09-27T00:00:00.000Z',
    });
    assert.equal(plan.dryRun, true);
    assert.equal(plan.candidates.length, 1);
    assert.throws(
      () => cleanupStagedContributions({ stagingRoot, plan }),
      error =>
        error instanceof ContributionStagingError &&
        error.code === STAGING_REASON_CODES.CLEANUP_PERMISSION_REQUIRED
    );

    const cleaned = cleanupStagedContributions({ stagingRoot, plan, permission: true });
    assert.equal(cleaned.ok, true);
    assert.equal(cleaned.publication, false);
    assert.equal(cleaned.deleted.length, 1);
    assert.equal(readStagedContribution, readStagedContribution);
    assert.throws(
      () => readStagedContribution({ stagingRoot, contributionId: staged.contributionId }),
      error => error instanceof ContributionStagingError
    );
  } finally {
    cleanupRoot(root);
  }
});

test('path-safe identifiers are deterministic and do not expose separators', () => {
  const value = pathSafeId('instance-001:contribution-001');
  assert.equal(value, pathSafeId('instance-001:contribution-001'));
  assert.match(value, /^id-[a-f0-9]{64}$/);
  assert.equal(value.includes('/'), false);
  assert.equal(value.includes('\\'), false);
});
