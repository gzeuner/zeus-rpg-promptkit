'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { DERIVATION_CLASSES } = require('../src/projectIntelligence/constants');
const {
  PUBLICATION_REASON_CODES,
  ContributionPublicationError,
  createContributionPackage,
  publishContributionExchange,
  writeContributionExchange,
} = require('../src/projectIntelligence/export');

const BASE_SNAPSHOT = Object.freeze({
  snapshotId: 'snapshot-001',
  contentHash: 'a'.repeat(64),
});
const TARGET_SNAPSHOT = Object.freeze({
  snapshotId: 'snapshot-002',
  contentHash: 'b'.repeat(64),
});

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'contribution-publication-'));
}

function createPackage() {
  return createContributionPackage({
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
    payload: { fact: 'structured observation' },
  });
}

function createExchange(root, overrides = {}) {
  const packageDir = path.join(root, 'package');
  const exchangeDir = path.join(root, 'exchange');
  const contribution = createPackage();
  writeContributionExchange({
    exchangeDir,
    package: contribution,
    currentSnapshot: BASE_SNAPSHOT,
    reviewerIdHash: 'c'.repeat(64),
    reviewId: 'review-001',
    targetSnapshot: TARGET_SNAPSHOT,
    acceptedAt: '2026-09-26T10:00:00.000Z',
    ...overrides,
  });
  return { exchangeDir, packageDir, contribution };
}

function createPublisher({ currentSnapshot = BASE_SNAPSHOT, mode = 'normal' } = {}) {
  let current = { ...currentSnapshot };
  let calls = 0;
  const records = new Map();
  const publisher = {
    localOnly: true,
    atomic: true,
    remoteWrite: false,
    network: false,
    providerInvoked: false,
    getCurrentSnapshot: () => ({ ...current }),
    getPublication: receiptHash => records.get(receiptHash) || null,
    publishAtomic: input => {
      calls += 1;
      if (mode === 'fail') throw new Error('writer failure');
      if (mode === 'mutate-then-fail') {
        current = { ...input.targetSnapshot };
        throw new Error('writer failure after pointer mutation');
      }
      const history = {
        historyId: `history-${input.receipt.receiptHash.slice(0, 16)}`,
        previousSnapshot: { ...input.baseSnapshot },
        publishedSnapshot: { ...input.targetSnapshot },
        rollback: {
          available: true,
          targetSnapshot: { ...input.baseSnapshot },
        },
      };
      current = { ...input.targetSnapshot };
      records.set(input.receipt.receiptHash, {
        kind: 'knowledge-contribution-publication',
        schema: 'knowledge.contribution.publication@1',
        publicationId: input.publicationId,
        receiptHash: input.receipt.receiptHash,
        packageHash: input.receipt.packageHash,
        status: 'published',
        targetSnapshot: { ...input.targetSnapshot },
        history,
        publishedAt: input.publishedAt,
      });
      return { snapshot: { ...input.targetSnapshot }, history };
    },
    get calls() {
      return calls;
    },
  };
  return publisher;
}

function assertPublicationError(callback, code) {
  assert.throws(
    callback,
    error => error instanceof ContributionPublicationError && error.code === code
  );
}

test('publishes only through a local atomic writer and replays idempotently', () => {
  const root = tempRoot();
  try {
    const { exchangeDir } = createExchange(root);
    const publisher = createPublisher();
    const first = publishContributionExchange({
      exchangeDir,
      snapshotPublisher: publisher,
      publishedAt: '2026-09-26T10:05:00.000Z',
    });
    const second = publishContributionExchange({ exchangeDir, snapshotPublisher: publisher });

    assert.equal(first.publication, true);
    assert.equal(first.localOnly, true);
    assert.equal(first.canPublish, false);
    assert.equal(first.idempotent, false);
    assert.deepEqual(first.snapshot, TARGET_SNAPSHOT);
    assert.equal(first.history.rollback.available, true);
    assert.equal(second.idempotent, true);
    assert.equal(second.receiptHash, first.receiptHash);
    assert.equal(publisher.calls, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stale bases, missing fingerprints and unsafe writers fail before mutation', () => {
  const root = tempRoot();
  try {
    const { exchangeDir } = createExchange(root);
    const stalePublisher = createPublisher({
      currentSnapshot: { snapshotId: 'snapshot-000', contentHash: 'd'.repeat(64) },
    });
    assertPublicationError(
      () => publishContributionExchange({ exchangeDir, snapshotPublisher: stalePublisher }),
      PUBLICATION_REASON_CODES.BASE_SNAPSHOT_STALE
    );
    assert.equal(stalePublisher.calls, 0);

    const unsafePublisher = createPublisher();
    unsafePublisher.network = true;
    assertPublicationError(
      () => publishContributionExchange({ exchangeDir, snapshotPublisher: unsafePublisher }),
      PUBLICATION_REASON_CODES.PUBLISHER_UNSAFE
    );
    assert.equal(unsafePublisher.calls, 0);

    const noFingerprint = createPublisher({
      currentSnapshot: { snapshotId: BASE_SNAPSHOT.snapshotId },
    });
    assertPublicationError(
      () => publishContributionExchange({ exchangeDir, snapshotPublisher: noFingerprint }),
      PUBLICATION_REASON_CODES.FINGERPRINT_REQUIRED
    );
    assert.equal(noFingerprint.calls, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('writer failure preserves the base pointer and detects atomicity violations', () => {
  const root = tempRoot();
  try {
    const { exchangeDir } = createExchange(root);
    const failing = createPublisher({ mode: 'fail' });
    assertPublicationError(
      () => publishContributionExchange({ exchangeDir, snapshotPublisher: failing }),
      PUBLICATION_REASON_CODES.PUBLICATION_FAILED
    );
    assert.deepEqual(failing.getCurrentSnapshot(), BASE_SNAPSHOT);

    const mutating = createPublisher({ mode: 'mutate-then-fail' });
    assertPublicationError(
      () => publishContributionExchange({ exchangeDir, snapshotPublisher: mutating }),
      PUBLICATION_REASON_CODES.ATOMICITY_VIOLATION
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('target and history identity must match the receipt', () => {
  const root = tempRoot();
  try {
    const { exchangeDir } = createExchange(root);
    const wrongTarget = createPublisher();
    wrongTarget.publishAtomic = input => ({
      snapshot: { snapshotId: 'snapshot-003', contentHash: 'e'.repeat(64) },
      history: {
        historyId: 'history-wrong',
        previousSnapshot: input.baseSnapshot,
        publishedSnapshot: { snapshotId: 'snapshot-003', contentHash: 'e'.repeat(64) },
        rollback: { available: true, targetSnapshot: input.baseSnapshot },
      },
    });
    assertPublicationError(
      () => publishContributionExchange({ exchangeDir, snapshotPublisher: wrongTarget }),
      PUBLICATION_REASON_CODES.TARGET_SNAPSHOT_MISMATCH
    );

    const wrongHistory = createPublisher();
    wrongHistory.publishAtomic = input => ({
      snapshot: input.targetSnapshot,
      history: {
        historyId: 'history-wrong',
        previousSnapshot: { snapshotId: 'snapshot-000', contentHash: 'd'.repeat(64) },
        publishedSnapshot: input.targetSnapshot,
        rollback: { available: true, targetSnapshot: input.baseSnapshot },
      },
    });
    assertPublicationError(
      () => publishContributionExchange({ exchangeDir, snapshotPublisher: wrongHistory }),
      PUBLICATION_REASON_CODES.HISTORY_INVALID
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('replay records are revalidated for rollback evidence', () => {
  const root = tempRoot();
  try {
    const { exchangeDir } = createExchange(root);
    const publisher = createPublisher();
    const first = publishContributionExchange({ exchangeDir, snapshotPublisher: publisher });
    const record = publisher.getPublication(first.receiptHash);
    record.history.rollback.available = false;

    assertPublicationError(
      () => publishContributionExchange({ exchangeDir, snapshotPublisher: publisher }),
      PUBLICATION_REASON_CODES.HISTORY_INVALID
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('publication is exposed through the top-level API', () => {
  const api = require('../src/projectIntelligence');
  assert.equal(api.publishContributionExchange, publishContributionExchange);
  assert.equal(api.PUBLICATION_REASON_CODES.REPLAY, PUBLICATION_REASON_CODES.REPLAY);
});
