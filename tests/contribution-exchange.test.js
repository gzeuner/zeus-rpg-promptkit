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
  EXCHANGE_REASON_CODES,
  createContributionAcceptanceReceipt,
  openContributionExchange,
  writeContributionExchange,
  ContributionExchangeError,
} = require('../src/projectIntelligence/export/contributionExchange');

const BASE_SNAPSHOT = Object.freeze({
  snapshotId: 'snapshot-001',
  contentHash: 'a'.repeat(64),
});
const TARGET_SNAPSHOT = Object.freeze({
  snapshotId: 'snapshot-002',
  contentHash: 'b'.repeat(64),
});
const REVIEWER_HASH = 'c'.repeat(64);

function contributionOptions(overrides = {}) {
  return {
    contributionId: 'instance-a:contribution-001',
    originInstanceId: 'instance-a',
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
    payload: { fact: 'structured observation', sourceId: 'source-001' },
    ...overrides,
  };
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'contribution-exchange-'));
}

function validPackage() {
  return createContributionPackage(contributionOptions());
}

function writeInputPackage(root, contribution = validPackage()) {
  const packageDir = path.join(root, 'input-package');
  writeContributionPackage({
    packageDir,
    ...contribution.manifest,
    payload: contribution.payload,
  });
  return packageDir;
}

function exchangeOptions(root, overrides = {}) {
  const contribution = validPackage();
  const packageDir = writeInputPackage(root, contribution);
  return {
    exchangeDir: path.join(root, 'exchange'),
    packageDir,
    currentSnapshot: BASE_SNAPSHOT,
    reviewerIdHash: REVIEWER_HASH,
    reviewId: 'review-001',
    targetSnapshot: TARGET_SNAPSHOT,
    acceptedAt: '2026-09-26T10:00:00.000Z',
    ...overrides,
  };
}

test('acceptance receipt binds package, snapshots and hashed review identity', () => {
  const contribution = validPackage();
  const result = createContributionAcceptanceReceipt({
    package: contribution,
    decision: 'accepted',
    reviewerIdHash: REVIEWER_HASH,
    reviewId: 'review-001',
    targetSnapshot: TARGET_SNAPSHOT,
    acceptedAt: '2026-09-26T10:00:00.000Z',
  });

  assert.equal(result.receipt.packageHash, contribution.manifest.packageHash);
  assert.deepEqual(result.receipt.baseSnapshot, BASE_SNAPSHOT);
  assert.deepEqual(result.receipt.targetSnapshot, TARGET_SNAPSHOT);
  assert.equal(result.receipt.review.reviewId, 'review-001');
  assert.equal(result.receipt.review.reviewerIdHash, REVIEWER_HASH);
  assert.equal(result.receipt.decision, 'accepted');
  assert.equal(result.receipt.publication, false);
  assert.equal(result.receipt.canPublish, false);
  assert.equal(result.localOnly, true);
});

test('raw reviewer identity and non-accepted decisions are rejected', () => {
  const contribution = validPackage();
  assert.throws(
    () =>
      createContributionAcceptanceReceipt({
        package: contribution,
        decision: 'accepted',
        reviewerIdHash: 'reviewer-a',
        reviewId: 'review-001',
        targetSnapshot: TARGET_SNAPSHOT,
      }),
    error =>
      error instanceof ContributionExchangeError &&
      error.code === EXCHANGE_REASON_CODES.RECEIPT_INVALID
  );
  assert.throws(
    () =>
      createContributionAcceptanceReceipt({
        package: contribution,
        decision: 'rejected',
        reviewerIdHash: REVIEWER_HASH,
        reviewId: 'review-001',
        targetSnapshot: TARGET_SNAPSHOT,
      }),
    error =>
      error instanceof ContributionExchangeError &&
      error.code === EXCHANGE_REASON_CODES.ACCEPTANCE_REQUIRED
  );
});

test('write and open roundtrip is atomic, local-only and publication-free', () => {
  const root = tempRoot();
  try {
    const options = exchangeOptions(root);
    const written = writeContributionExchange(options);
    const opened = openContributionExchange({ exchangeDir: options.exchangeDir });

    assert.equal(written.ok, true);
    assert.equal(written.publication, false);
    assert.equal(written.canPublish, false);
    assert.equal(written.localOnly, true);
    assert.equal(opened.receiptHash, written.receiptHash);
    assert.deepEqual(opened.package.payload, validPackage().payload);
    assert.deepEqual(fs.readdirSync(options.exchangeDir).sort(), ['package', 'receipt.json']);
    assert.deepEqual(fs.readdirSync(path.join(options.exchangeDir, 'package')).sort(), [
      'manifest.json',
      'payload.json',
    ]);
    assert.equal(fs.existsSync(path.join(root, 'staging')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('repeating the same exchange is idempotent and a different receipt is a conflict', () => {
  const root = tempRoot();
  try {
    const options = exchangeOptions(root);
    const first = writeContributionExchange(options);
    const second = writeContributionExchange(options);
    assert.equal(first.idempotent, false);
    assert.equal(second.idempotent, true);
    assert.equal(second.receiptHash, first.receiptHash);

    assert.throws(
      () =>
        writeContributionExchange({
          ...options,
          reviewId: 'review-002',
        }),
      error =>
        error instanceof ContributionExchangeError && error.code === EXCHANGE_REASON_CODES.REPLAY
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stale base snapshots and failed validation block exchange', () => {
  const root = tempRoot();
  try {
    const stale = exchangeOptions(root, {
      currentSnapshot: { snapshotId: 'snapshot-000', contentHash: 'd'.repeat(64) },
    });
    assert.throws(
      () => writeContributionExchange(stale),
      error =>
        error instanceof ContributionExchangeError &&
        error.code === EXCHANGE_REASON_CODES.BASE_SNAPSHOT_STALE
    );

    const invalid = exchangeOptions(root, {
      exchangeDir: path.join(root, 'invalid-exchange'),
    });
    invalid.packageDir = writeInputPackage(
      path.join(root, 'invalid-input'),
      createContributionPackage(contributionOptions({ privacyReport: { status: 'failed' } }))
    );
    assert.throws(
      () => writeContributionExchange(invalid),
      error =>
        error instanceof ContributionExchangeError &&
        error.code === EXCHANGE_REASON_CODES.VALIDATION_FAILED
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tampering, extra files and non-canonical receipt data fail closed', () => {
  const root = tempRoot();
  try {
    const options = exchangeOptions(root);
    writeContributionExchange(options);
    const receiptPath = path.join(options.exchangeDir, 'receipt.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    receipt.reviewId = 'tampered';
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, 'utf8');
    assert.throws(
      () => openContributionExchange({ exchangeDir: options.exchangeDir }),
      error =>
        error instanceof ContributionExchangeError &&
        [
          EXCHANGE_REASON_CODES.RECEIPT_HASH_MISMATCH,
          EXCHANGE_REASON_CODES.EXCHANGE_INVALID,
          EXCHANGE_REASON_CODES.RECEIPT_INVALID,
        ].includes(error.code)
    );

    fs.rmSync(options.exchangeDir, { recursive: true, force: true });
    writeContributionExchange(options);
    fs.writeFileSync(path.join(options.exchangeDir, 'extra.json'), '{}\n', 'utf8');
    assert.throws(
      () => openContributionExchange({ exchangeDir: options.exchangeDir }),
      error =>
        error instanceof ContributionExchangeError &&
        error.code === EXCHANGE_REASON_CODES.EXCHANGE_INVALID
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
