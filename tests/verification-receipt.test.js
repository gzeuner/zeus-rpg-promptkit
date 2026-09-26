'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  REQUIRED_GATES,
  VERIFICATION_RECEIPT_REASON_CODES,
  VerificationReceiptError,
  createVerificationReceipt,
  validateVerificationReceipt,
} = require('../src/projectIntelligence/export/verificationReceipt');
const publicApi = require('../src/projectIntelligence');

function receiptOptions(overrides = {}) {
  return {
    git: { head: '0c5b142', worktreeStatus: 'dirty' },
    packageVersions: { core: 'v1', contribution: 'v1', bridge: 'v1' },
    gates: {
      ...Object.fromEntries(REQUIRED_GATES.map(gate => [gate, 'passed'])),
      'full-test': {
        status: 'baseline-warning',
        reasonCode: 'BASELINE_TEST_WARNING',
        message: 'three expected platform skips remain visible',
      },
    },
    testSummary: {
      focused: { total: 8, passed: 8, failed: 0, skipped: 0 },
      contract: { total: 384, passed: 381, failed: 0, skipped: 3 },
      smoke: { total: 9, passed: 9, failed: 0, skipped: 0 },
      corpus: { total: 1, passed: 1, failed: 0, skipped: 0 },
      unit: { total: 1005, passed: 1005, failed: 0, skipped: 0 },
    },
    fixtureHashes: { 'fixture-a': 'a'.repeat(64) },
    warnings: [
      {
        id: 'workspace-dirty',
        severity: 'warning',
        owner: 'local',
        reasonCode: 'WORKTREE_DIRTY',
        nextAction: 'review-local-changes',
      },
    ],
    openDecisions: [
      {
        id: 'snapshot-publication',
        status: 'deferred',
        owner: 'local',
        reasonCode: 'PUBLICATION_DEFERRED',
        nextAction: 'retain-deferred-boundary',
      },
    ],
    recordedAt: '2026-09-26T12:30:00.000Z',
    workspaceFingerprint: 'b'.repeat(64),
    remoteActions: false,
    sourceMutation: false,
    providerInvocation: false,
    publication: false,
    ...overrides,
  };
}

function assertReceiptError(callback, code) {
  assert.throws(
    callback,
    error => error instanceof VerificationReceiptError && error.code === code
  );
}

test('creates a deterministic local verification receipt with visible warnings', () => {
  const first = createVerificationReceipt(receiptOptions());
  const second = createVerificationReceipt(receiptOptions());

  assert.equal(first.status, 'passed-with-warnings');
  assert.equal(first.kind, 'verification-receipt');
  assert.equal(first.localOnly, true);
  assert.equal(first.readOnly, true);
  assert.equal(first.publication, false);
  assert.equal(first.remoteActions, false);
  assert.equal(first.sourceMutation, false);
  assert.equal(first.providerInvocation, false);
  assert.equal(first.receiptHash, second.receiptHash);
  assert.deepEqual(validateVerificationReceipt(first), []);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(JSON.stringify(first).includes('C:\\'), false);
  assert.equal(JSON.stringify(first).includes('source text'), false);
});

test('creates a passed receipt when all gates are green and the worktree is clean', () => {
  const options = receiptOptions({
    git: { head: '0c5b142', worktreeStatus: 'clean' },
    gates: Object.fromEntries(REQUIRED_GATES.map(gate => [gate, 'passed'])),
    warnings: [],
    openDecisions: [],
  });
  const receipt = createVerificationReceipt(options);

  assert.equal(receipt.status, 'passed');
  assert.deepEqual(receipt.warnings, []);
  assert.deepEqual(receipt.openDecisions, []);
  assert.deepEqual(validateVerificationReceipt(receipt), []);
});

test('requires every gate, green test summaries and a dirty-worktree warning', () => {
  const missingGate = { ...receiptOptions(), gates: { ...receiptOptions().gates } };
  delete missingGate.gates['full-test'];
  assertReceiptError(
    () => createVerificationReceipt(missingGate),
    VERIFICATION_RECEIPT_REASON_CODES.GATE_MISSING
  );

  assertReceiptError(
    () =>
      createVerificationReceipt({
        ...receiptOptions(),
        testSummary: {
          full: { total: 2, passed: 1, failed: 1, skipped: 0 },
        },
      }),
    VERIFICATION_RECEIPT_REASON_CODES.SUMMARY_INVALID
  );

  assertReceiptError(
    () => createVerificationReceipt({ ...receiptOptions(), warnings: [] }),
    VERIFICATION_RECEIPT_REASON_CODES.WARNING_INVALID
  );
  assertReceiptError(
    () =>
      createVerificationReceipt({
        ...receiptOptions(),
        recordedAt: '2026-02-30T12:30:00.000Z',
      }),
    VERIFICATION_RECEIPT_REASON_CODES.INPUT_INVALID
  );
});

test('rejects remote, mutation, provider and publication flags', () => {
  for (const field of ['remoteActions', 'sourceMutation', 'providerInvocation', 'publication']) {
    assertReceiptError(
      () => createVerificationReceipt({ ...receiptOptions(), [field]: true }),
      VERIFICATION_RECEIPT_REASON_CODES.LOCALITY_INVALID
    );
  }
});

test('detects receipt tampering and unsafe notices', () => {
  const receipt = createVerificationReceipt(receiptOptions());
  assert.equal(
    validateVerificationReceipt({ ...receipt, status: 'passed' }).includes(
      VERIFICATION_RECEIPT_REASON_CODES.STATUS_INVALID
    ),
    true
  );
  assert.equal(
    validateVerificationReceipt({ ...receipt, receiptHash: 'c'.repeat(64) }).includes(
      VERIFICATION_RECEIPT_REASON_CODES.HASH_INVALID
    ),
    true
  );
  assertReceiptError(
    () =>
      createVerificationReceipt({
        ...receiptOptions(),
        warnings: [
          {
            ...receiptOptions().warnings[0],
            message: 'https://outside.invalid/source',
          },
        ],
      }),
    VERIFICATION_RECEIPT_REASON_CODES.INPUT_INVALID
  );
});

test('exposes the verification receipt through the public API', () => {
  assert.equal(publicApi.createVerificationReceipt, createVerificationReceipt);
  assert.equal(publicApi.validateVerificationReceipt, validateVerificationReceipt);
});
