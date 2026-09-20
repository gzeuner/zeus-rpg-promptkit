'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const zpi = require('../src/projectIntelligence');
const {
  buildProcessAnswerRegression,
  writeProcessAnswerRegressionArtifact,
} = require('../src/agent/processAnswerRegression');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'cli', 'zeus.js');

function createTempWorkspace(prefix = 'zeus-process-answer-regression-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function catalogFixture() {
  const process = zpi.fixtures.businessProcess({
    processId: 'process:dispatch-flow',
    processVersionId: 'process:dispatch-flow:v1',
    name: 'Dispatch process',
    status: 'reviewed',
    confidence: 'high',
    entryPoints: [{ id: 'PROGRAM:DISPATCH', kind: 'program', name: 'DISPATCH' }],
    claimIds: ['claim:dispatch-flow:1'],
    relationshipIds: [],
  });
  const version = zpi.fixtures.processVersion({
    processId: process.processId,
    processVersionId: process.processVersionId,
    title: process.name,
    status: 'reviewed',
    confidence: 'high',
    interfaces: [{ id: 'interface:dispatch-api', kind: 'interface', name: 'DISPATCH-API' }],
    stepIds: [],
    claimIds: process.claimIds,
    relationshipIds: process.relationshipIds,
    review: {
      reviewerId: 'domain-reviewer',
      approved: true,
      reviewedAt: '2026-09-20T12:00:00.000Z',
    },
  });
  const claim = zpi.fixtures.processClaim({
    processId: process.processId,
    processVersionId: process.processVersionId,
    claimId: 'claim:dispatch-flow:1',
    text: 'The dispatch process routes the dispatch interface.',
    supportingRefs: ['PROGRAM:DISPATCH'],
  });
  return {
    schemaVersion: 1,
    kind: 'process-candidate-catalog',
    projectId: 'proj-neutral',
    snapshotId: 'snap-neutral-001',
    freshness: { status: 'published', checkedAt: '2026-09-20T12:00:00.000Z' },
    candidates: [{ process, version, steps: [], claims: [claim], relationships: [] }],
  };
}

function corpusFixture() {
  return {
    schemaVersion: 1,
    kind: 'process-answer-regression-corpus',
    corpusId: 'neutral-process-answers',
    corpusVersion: '1.0.0',
    sanitized: true,
    containsCredentials: false,
    containsPrivateProjectIdentifiers: false,
    scenarios: [
      {
        id: 'dispatch-interface-answer',
        question: 'What does DISPATCH-API do?',
        expectedProcessIds: ['process:dispatch-flow'],
        expectedStatus: 'reviewed',
        requiredAnswerTerms: ['dispatch process'],
        requiredEvidenceKinds: ['derived-reference'],
        requireEvidence: true,
        maxFreshness: 'published',
      },
    ],
  };
}

test('regression gate binds an explicit reviewer decision to one evaluation', () => {
  const workspace = createTempWorkspace();
  const corpusPath = path.join(workspace, 'corpus.json');
  fs.writeFileSync(corpusPath, `${JSON.stringify(corpusFixture())}\n`);

  const beforeReview = buildProcessAnswerRegression({
    cwd: workspace,
    catalog: catalogFixture(),
    corpus: 'corpus.json',
  });
  assert.equal(beforeReview.status, 'needs-review');
  assert.equal(beforeReview.evaluationStatus, 'pass');
  assert.equal(beforeReview.review.status, 'missing');
  assert.deepEqual(beforeReview.scenarios[0].blockers, []);
  assert.equal(beforeReview.automaticPromotion, false);
  assert.equal(beforeReview.promotionAllowed, false);

  const decisionPath = path.join(workspace, '.zeus', 'review.json');
  fs.mkdirSync(path.dirname(decisionPath), { recursive: true });
  fs.writeFileSync(
    decisionPath,
    `${JSON.stringify({
      schemaVersion: 1,
      kind: 'process-answer-review-decision',
      corpusId: beforeReview.corpus.corpusId,
      corpusVersion: beforeReview.corpus.corpusVersion,
      catalogFingerprint: beforeReview.catalogFingerprint,
      evaluationId: beforeReview.evaluationId,
      reviewerId: 'domain-reviewer',
      approved: true,
      decision: 'approve',
      reviewedAt: '2026-09-20T12:30:00.000Z',
      rationale: 'Reviewed the evidence-backed process answer.',
      sanitized: true,
      containsCredentials: false,
      containsPrivateProjectIdentifiers: false,
    })}\n`
  );

  const approved = buildProcessAnswerRegression({
    cwd: workspace,
    catalog: catalogFixture(),
    corpus: 'corpus.json',
    decision: '.zeus/review.json',
  });
  assert.equal(approved.status, 'pass');
  assert.equal(approved.review.status, 'approved');
  assert.equal(approved.review.approved, true);
  assert.equal(approved.review.authoritativeChangeStillExplicit, true);
  assert.deepEqual(approved.blockers, []);
});

test('regression gate reports answer drift and does not accept a stale decision', () => {
  const workspace = createTempWorkspace();
  const corpus = corpusFixture();
  corpus.scenarios[0].requiredAnswerTerms = ['term-not-in-answer'];
  const corpusPath = path.join(workspace, 'corpus.json');
  fs.writeFileSync(corpusPath, `${JSON.stringify(corpus)}\n`);
  const result = buildProcessAnswerRegression({
    cwd: workspace,
    catalog: catalogFixture(),
    corpus: 'corpus.json',
  });
  assert.equal(result.status, 'fail');
  assert.equal(result.evaluationStatus, 'fail');
  assert.ok(result.blockers.includes('REGRESSION_SCENARIO_FAILED'));
  assert.ok(result.scenarios[0].blockers.includes('ANSWER_TERM_MISSING'));

  const decisionPath = path.join(workspace, '.zeus', 'review.json');
  fs.mkdirSync(path.dirname(decisionPath), { recursive: true });
  fs.writeFileSync(
    decisionPath,
    `${JSON.stringify({
      schemaVersion: 1,
      kind: 'process-answer-review-decision',
      corpusId: result.corpus.corpusId,
      corpusVersion: result.corpus.corpusVersion,
      catalogFingerprint: result.catalogFingerprint,
      evaluationId: result.evaluationId,
      reviewerId: 'domain-reviewer',
      approved: true,
      decision: 'approve',
      reviewedAt: '2026-09-20T12:30:00.000Z',
      sanitized: true,
      containsCredentials: false,
      containsPrivateProjectIdentifiers: false,
    })}\n`
  );
  const blocked = buildProcessAnswerRegression({
    cwd: workspace,
    catalog: catalogFixture(),
    corpus: 'corpus.json',
    decision: '.zeus/review.json',
  });
  assert.equal(blocked.status, 'fail');
  assert.equal(blocked.review.status, 'approved');
  assert.ok(blocked.blockers.includes('REGRESSION_SCENARIO_FAILED'));
});

test('regression-check CLI writes only a bounded .zeus artifact', () => {
  const workspace = createTempWorkspace();
  fs.writeFileSync(path.join(workspace, 'catalog.json'), `${JSON.stringify(catalogFixture())}\n`);
  fs.writeFileSync(path.join(workspace, 'corpus.json'), `${JSON.stringify(corpusFixture())}\n`);
  const run = spawnSync(
    process.execPath,
    [
      CLI,
      'process',
      'regression-check',
      '--catalog',
      'catalog.json',
      '--corpus',
      'corpus.json',
      '--out',
      '.zeus/process-answer-regression.json',
      '--json',
    ],
    { cwd: workspace, encoding: 'utf8' }
  );
  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.result.operation, 'regression-check');
  assert.equal(payload.result.review.status, 'missing');
  assert.equal(fs.existsSync(path.join(workspace, '.zeus/process-answer-regression.json')), true);
  assert.throws(
    () => writeProcessAnswerRegressionArtifact({}, { cwd: workspace, out: '../outside.json' }),
    error => error.code === 'PATH_OUTSIDE_WORKSPACE'
  );
});
