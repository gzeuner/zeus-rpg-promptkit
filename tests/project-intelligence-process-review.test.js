'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const {
  buildProcessReviewRecord,
  checkProcessReview,
  writeProcessReviewReceipt,
} = require('../src/agent/processReview');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'cli', 'zeus.js');

function createWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-process-review-'));
  fs.mkdirSync(path.join(workspace, '.zeus'), { recursive: true });
  return workspace;
}

function writeJson(workspace, name, value) {
  const location = path.join(workspace, '.zeus', name);
  fs.writeFileSync(location, `${JSON.stringify(value)}\n`);
  return `.zeus/${name}`;
}

function resultFixture() {
  return {
    ok: true,
    kind: 'process-answer-regression-result',
    schemaVersion: 1,
    readOnly: true,
    automaticPromotion: false,
    promotionAllowed: false,
    corpus: { corpusId: 'sanitized-corpus', corpusVersion: '1.0.0' },
    catalogFingerprint: 'catalog:1111111111111111',
    evaluationId: 'process-answer-evaluation:aaaaaaaaaaaaaaaa',
    status: 'pass',
    scenarios: [{ id: 'scenario-one', status: 'pass', evidenceCount: 1 }],
  };
}

test('process review receipt binds the exact result identity and hides reviewer identity', () => {
  const workspace = createWorkspace();
  try {
    const resultPath = writeJson(workspace, 'result.json', resultFixture());
    const receipt = buildProcessReviewRecord({
      cwd: workspace,
      result: resultPath,
      decision: 'approve',
      reviewer: 'domain-reviewer',
      reviewedAt: '2026-09-20T12:00:00.000Z',
    });
    const receiptPath = writeProcessReviewReceipt(receipt, {
      cwd: workspace,
      out: '.zeus/review.json',
    });
    assert.equal(receiptPath, '.zeus/review.json');
    assert.match(receipt.receiptId, /^receipt:[a-f0-9]{16}$/);
    assert.match(receipt.reviewerHash, /^reviewer:[a-f0-9]{16}$/);
    assert.doesNotMatch(JSON.stringify(receipt), /domain-reviewer/);
    assert.equal(receipt.identity.corpusId, 'sanitized-corpus');
    assert.equal(receipt.identity.catalogFingerprint, 'catalog:1111111111111111');

    const checked = checkProcessReview({
      cwd: workspace,
      result: resultPath,
      receipt: receiptPath,
      policy: 'required',
      asOf: '2026-09-21T00:00:00.000Z',
    });
    assert.equal(checked.status, 'approved');
    assert.equal(checked.gatePassed, true);
    assert.deepEqual(checked.blockers, []);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('required review blocks missing or stale receipts while advisory remains successful', () => {
  const workspace = createWorkspace();
  try {
    const resultPath = writeJson(workspace, 'result.json', resultFixture());
    const missing = checkProcessReview({
      cwd: workspace,
      result: resultPath,
      receipt: '.zeus/missing.json',
      policy: 'required',
    });
    assert.equal(missing.status, 'blocked');
    assert.equal(missing.gatePassed, false);
    assert.deepEqual(missing.blockers, ['REVIEW_RECEIPT_MISSING']);

    const receipt = buildProcessReviewRecord({
      cwd: workspace,
      result: resultPath,
      decision: 'approve',
      reviewer: 'domain-reviewer',
      reviewedAt: '2026-08-01T00:00:00.000Z',
    });
    const receiptPath = writeProcessReviewReceipt(receipt, {
      cwd: workspace,
      out: '.zeus/review.json',
    });
    const advisory = checkProcessReview({
      cwd: workspace,
      result: resultPath,
      receipt: receiptPath,
      policy: 'advisory',
      asOf: '2026-09-21T00:00:00.000Z',
    });
    assert.equal(advisory.status, 'warning');
    assert.equal(advisory.gatePassed, true);
    assert.ok(advisory.blockers.includes('REVIEW_EXPIRED'));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('review CLI returns a non-zero result only for a failed required gate', () => {
  const workspace = createWorkspace();
  try {
    const resultPath = writeJson(workspace, 'result.json', resultFixture());
    const run = spawnSync(
      process.execPath,
      [
        CLI,
        'process',
        'review',
        'check',
        '--result',
        resultPath,
        '--receipt',
        '.zeus/missing.json',
        '--policy',
        'required',
        '--json',
      ],
      { cwd: workspace, encoding: 'utf8' }
    );
    assert.equal(run.status, 2, run.stderr);
    const payload = JSON.parse(run.stdout);
    assert.equal(payload.result.status, 'blocked');
    assert.equal(payload.result.gatePassed, false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('review inputs and outputs remain bounded to .zeus', () => {
  const workspace = createWorkspace();
  try {
    assert.throws(
      () =>
        buildProcessReviewRecord({
          cwd: workspace,
          result: '../result.json',
          decision: 'approve',
          reviewer: 'reviewer',
        }),
      error => error.code === 'PATH_OUTSIDE_WORKSPACE'
    );
    assert.throws(
      () => writeProcessReviewReceipt({ ok: true }, { cwd: workspace, out: '../outside.json' }),
      error => error.code === 'PATH_OUTSIDE_WORKSPACE'
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('review accepts the existing advisory process-evaluation contract', () => {
  const workspace = createWorkspace();
  try {
    const resultPath = writeJson(workspace, 'evaluation.json', {
      ok: true,
      kind: 'project-knowledge-process-evaluation-result',
      schemaVersion: 1,
      projectId: 'project-a',
      snapshotId: 'snapshot-a',
      evaluationId: 'evaluation:aaaaaaaaaaaaaaaa',
      sourceOfTruth: false,
      advisory: true,
      freshness: { status: 'fresh' },
    });
    const receipt = buildProcessReviewRecord({
      cwd: workspace,
      result: resultPath,
      decision: 'approve',
      reviewer: 'reviewer',
    });
    assert.match(receipt.identity.catalogFingerprint, /^catalog:[a-f0-9]{16}$/);
    assert.equal(receipt.identity.corpusId, null);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
