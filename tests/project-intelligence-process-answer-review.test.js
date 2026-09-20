'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { buildProcessAnswerDrift } = require('../src/agent/processAnswerDrift');
const {
  buildProcessAnswerReview,
  buildProcessAnswerReviewSummary,
  writeProcessAnswerReviewArtifact,
} = require('../src/agent/processAnswerReview');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'cli', 'zeus.js');

function createWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-process-answer-review-'));
  fs.mkdirSync(path.join(workspace, '.zeus'), { recursive: true });
  return workspace;
}

function regressionResult(overrides = {}) {
  return {
    ok: true,
    operation: 'regression-check',
    kind: 'process-answer-regression-result',
    schemaVersion: 1,
    readOnly: true,
    automaticPromotion: false,
    promotionAllowed: false,
    corpus: { corpusId: 'neutral-process-answers', corpusVersion: '1.0.0' },
    catalogFingerprint: 'catalog:1111111111111111',
    evaluationId: 'process-answer-evaluation:aaaaaaaaaaaaaaaa',
    review: { status: 'approved' },
    scenarios: [
      {
        id: 'dispatch-interface-answer',
        status: 'pass',
        matchedProcessCount: 1,
        returnedStatus: 'reviewed',
        returnedFreshness: 'published',
        evidenceCount: 2,
        blockers: [],
      },
    ],
    ...overrides,
  };
}

function writeJson(workspace, name, value) {
  const location = path.join(workspace, '.zeus', name);
  fs.writeFileSync(location, `${JSON.stringify(value)}\n`);
  return `.zeus/${name}`;
}

function driftFixture(workspace, overrides = {}) {
  const baseline = writeJson(workspace, 'baseline.json', regressionResult());
  const current = writeJson(
    workspace,
    'current.json',
    regressionResult({
      catalogFingerprint: 'catalog:2222222222222222',
      evaluationId: 'process-answer-evaluation:bbbbbbbbbbbbbbbb',
      review: { status: 'missing' },
      scenarios: [
        {
          id: 'dispatch-interface-answer',
          status: 'fail',
          matchedProcessCount: 0,
          returnedStatus: 'candidate',
          returnedFreshness: 'stale',
          evidenceCount: 0,
          blockers: ['EVIDENCE_MISSING'],
        },
      ],
      ...overrides,
    })
  );
  return buildProcessAnswerDrift({ cwd: workspace, baseline, current });
}

test('review projection remains stable and pending without drift', () => {
  const workspace = createWorkspace();
  try {
    const baseline = writeJson(workspace, 'baseline.json', regressionResult());
    const current = writeJson(workspace, 'current.json', regressionResult());
    const drift = writeJson(
      workspace,
      'drift.json',
      buildProcessAnswerDrift({ cwd: workspace, baseline, current })
    );
    const result = buildProcessAnswerReview({ cwd: workspace, drift });
    assert.equal(result.status, 'stable');
    assert.equal(result.driftStatus, 'stable');
    assert.deepEqual(result.explanations, []);
    assert.equal(result.approval.status, 'pending');
    assert.equal(result.approval.decisionIsNotPromotion, true);
    assert.equal(result.automaticPromotion, false);
    assert.equal(result.promotionAllowed, false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('review projection explains bounded drift without exposing private result content', () => {
  const workspace = createWorkspace();
  try {
    const drift = driftFixture(workspace);
    const driftPath = writeJson(workspace, 'drift.json', drift);
    const result = buildProcessAnswerReview({ cwd: workspace, drift: driftPath });
    assert.equal(result.status, 'needs-review');
    assert.ok(result.explanations.some(item => item.code === 'REGRESSION_INTRODUCED'));
    assert.ok(result.explanations.some(item => item.code === 'EVIDENCE_LOSS'));
    assert.equal(result.explanations[0].severity, 'high');
    assert.match(result.driftId, /^drift:[a-f0-9]{16}$/);
    assert.equal(
      result.explanations.every(item => item.count >= 1),
      true
    );
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /dispatch-interface-answer/);
    assert.doesNotMatch(serialized, /question|answer text|process:private/i);
    assert.doesNotMatch(serialized, new RegExp(workspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('review history links only to the exact drift and hashes reviewer identity', () => {
  const workspace = createWorkspace();
  try {
    const drift = driftFixture(workspace);
    const driftPath = writeJson(workspace, 'drift.json', drift);
    const pending = buildProcessAnswerReview({ cwd: workspace, drift: driftPath });
    const historyPath = writeJson(workspace, 'history.json', {
      schemaVersion: 1,
      kind: 'process-answer-review-history',
      sanitized: true,
      containsCredentials: false,
      containsPrivateProjectIdentifiers: false,
      entries: [
        {
          decisionId: 'decision:3333333333333333',
          driftId: pending.driftId,
          decision: 'approve',
          reviewerId: 'domain-reviewer',
          reviewedAt: '2026-09-20T12:30:00.000Z',
          rationaleCode: 'EVIDENCE_REVIEW_REQUIRED',
          notes: 'This free text must never appear in the report.',
        },
        {
          decisionId: 'decision:4444444444444444',
          driftId: 'drift:4444444444444444',
          decision: 'reject',
          reviewerId: 'other-reviewer',
          reviewedAt: '2026-09-20T12:31:00.000Z',
        },
      ],
    });
    const result = buildProcessAnswerReview({
      cwd: workspace,
      drift: driftPath,
      history: historyPath,
    });
    assert.equal(result.status, 'reviewed');
    assert.equal(result.approval.status, 'approved');
    assert.equal(result.approval.matchedDecisionCount, 1);
    assert.match(result.approval.lastDecision.reviewerHash, /^reviewer:[a-f0-9]{16}$/);
    assert.doesNotMatch(JSON.stringify(result), /domain-reviewer|free text/);
    assert.equal(result.approval.decisionIsNotPromotion, true);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('review history flags contradictory decisions and keeps the latest decision explainable', () => {
  const workspace = createWorkspace();
  try {
    const drift = driftFixture(workspace);
    const driftPath = writeJson(workspace, 'drift.json', drift);
    const pending = buildProcessAnswerReview({ cwd: workspace, drift: driftPath });
    const historyPath = writeJson(workspace, 'history.json', {
      schemaVersion: 1,
      kind: 'process-answer-review-history',
      sanitized: true,
      containsCredentials: false,
      containsPrivateProjectIdentifiers: false,
      entries: [
        {
          decisionId: 'decision:5555555555555555',
          driftId: pending.driftId,
          decision: 'approve',
          reviewerId: 'first-reviewer',
          reviewedAt: '2026-09-20T12:30:00.000Z',
          rationaleCode: 'CATALOG_CONFIRMED',
        },
        {
          decisionId: 'decision:6666666666666666',
          driftId: pending.driftId,
          decision: 'reject',
          reviewerId: 'second-reviewer',
          reviewedAt: '2026-09-20T12:31:00.000Z',
          rationaleCode: 'EVIDENCE_REVIEW_REQUIRED',
        },
      ],
    });
    const result = buildProcessAnswerReview({
      cwd: workspace,
      drift: driftPath,
      history: historyPath,
    });
    assert.equal(result.status, 'needs-review');
    assert.equal(result.approval.status, 'rejected');
    assert.equal(result.approval.consistency.status, 'contradictory');
    assert.deepEqual(result.approval.consistency.decisionKinds, ['approve', 'reject']);
    assert.equal(result.approval.consistency.conflictingDecisionCount, 2);
    assert.equal(result.approval.consistency.staleDecisionCount, 1);
    assert.equal(result.approval.consistency.latestDecisionIsExplainable, true);
    assert.deepEqual(result.approval.consistency.findings, [
      'REVIEW_HISTORY_CONFLICT',
      'REVIEW_DECISION_STALE',
    ]);
    assert.equal(result.approval.lastDecision.decision, 'reject');
    assert.equal(
      result.explanations.some(item => item.code === 'REVIEW_HISTORY_CONFLICT'),
      true
    );
    assert.equal(
      result.explanations.some(item => item.code === 'REVIEW_DECISION_STALE'),
      true
    );
    assert.doesNotMatch(JSON.stringify(result), /first-reviewer|second-reviewer/);
    assert.equal(result.automaticPromotion, false);
    assert.equal(result.promotionAllowed, false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('review history summary finds unresolved drift identities without private content', () => {
  const workspace = createWorkspace();
  try {
    const drift = driftFixture(workspace);
    const driftPath = writeJson(workspace, 'drift.json', drift);
    const pending = buildProcessAnswerReview({ cwd: workspace, drift: driftPath });
    const historyPath = writeJson(workspace, 'history.json', {
      schemaVersion: 1,
      kind: 'process-answer-review-history',
      sanitized: true,
      containsCredentials: false,
      containsPrivateProjectIdentifiers: false,
      entries: [
        {
          decisionId: 'decision:7777777777777777',
          driftId: pending.driftId,
          decision: 'approve',
          reviewerId: 'first-reviewer',
          reviewedAt: '2026-09-20T12:30:00.000Z',
          rationaleCode: 'CATALOG_CONFIRMED',
        },
        {
          decisionId: 'decision:8888888888888888',
          driftId: pending.driftId,
          decision: 'reject',
          reviewerId: 'second-reviewer',
          reviewedAt: '2026-09-20T12:31:00.000Z',
          rationaleCode: 'EVIDENCE_REVIEW_REQUIRED',
        },
        {
          decisionId: 'decision:9999999999999999',
          driftId: 'drift:9999999999999999',
          decision: 'approve',
          reviewerId: 'stable-reviewer',
          reviewedAt: '2026-09-20T12:32:00.000Z',
          rationaleCode: 'CATALOG_CONFIRMED',
        },
      ],
    });
    const result = buildProcessAnswerReviewSummary({ cwd: workspace, history: historyPath });
    assert.equal(result.status, 'needs-review');
    assert.equal(result.metrics.historyEntryCount, 3);
    assert.equal(result.metrics.driftIdentityCount, 2);
    assert.equal(result.metrics.unresolvedDriftCount, 1);
    assert.equal(result.metrics.conflictingDriftCount, 1);
    assert.equal(result.metrics.staleDecisionCount, 1);
    assert.deepEqual(result.metrics.decisionCounts, { approve: 2, defer: 0, reject: 1 });
    assert.equal(result.unresolved.length, 1);
    assert.equal(result.unresolved[0].lastDecision.decision, 'reject');
    assert.equal(result.unresolved[0].consistency.latestDecisionIsExplainable, true);
    assert.deepEqual(
      result.findings.map(finding => finding.code),
      ['REVIEW_HISTORY_CONFLICT', 'REVIEW_DECISION_STALE']
    );
    assert.doesNotMatch(JSON.stringify(result), /first-reviewer|second-reviewer|stable-reviewer/);
    assert.doesNotMatch(JSON.stringify(result), /dispatch-interface-answer|process:private/);
    assert.equal(result.automaticPromotion, false);
    assert.equal(result.promotionAllowed, false);

    const run = spawnSync(
      process.execPath,
      [
        CLI,
        'process',
        'drift-review-summary',
        '--history',
        historyPath,
        '--out',
        '.zeus/summary.json',
        '--json',
      ],
      { cwd: workspace, encoding: 'utf8' }
    );
    assert.equal(run.status, 0, run.stderr);
    const payload = JSON.parse(run.stdout);
    assert.equal(payload.result.operation, 'drift-review-summary');
    assert.equal(payload.result.metrics.unresolvedDriftCount, 1);
    assert.equal(fs.existsSync(path.join(workspace, '.zeus', 'summary.json')), true);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('drift-review CLI writes bounded output and rejects unsafe history', () => {
  const workspace = createWorkspace();
  try {
    const drift = driftFixture(workspace);
    const driftPath = writeJson(workspace, 'drift.json', drift);
    const run = spawnSync(
      process.execPath,
      [
        CLI,
        'process',
        'drift-review',
        '--drift',
        driftPath,
        '--out',
        '.zeus/review.json',
        '--json',
      ],
      { cwd: workspace, encoding: 'utf8' }
    );
    assert.equal(run.status, 0, run.stderr);
    const payload = JSON.parse(run.stdout);
    assert.equal(payload.result.operation, 'drift-review');
    assert.equal(payload.result.status, 'needs-review');
    assert.equal(fs.existsSync(path.join(workspace, '.zeus', 'review.json')), true);
    assert.throws(
      () => writeProcessAnswerReviewArtifact({}, { cwd: workspace, out: '../outside.json' }),
      error => error.code === 'PATH_OUTSIDE_WORKSPACE'
    );
    const unsafeHistory = writeJson(workspace, 'unsafe-history.json', {
      schemaVersion: 1,
      kind: 'process-answer-review-history',
      sanitized: false,
      containsCredentials: false,
      containsPrivateProjectIdentifiers: false,
      entries: [],
    });
    assert.throws(
      () => buildProcessAnswerReview({ cwd: workspace, drift: driftPath, history: unsafeHistory }),
      error => error.code === 'PROCESS_ANSWER_REVIEW_HISTORY_UNSAFE'
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
