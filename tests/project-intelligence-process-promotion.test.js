'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const {
  buildProcessImprovementReport,
  recordProcessExperience,
  writeProcessImprovementArtifact,
} = require('../src/agent/processExperience');
const {
  buildProcessPromotionReadiness,
  writeProcessPromotionArtifact,
} = require('../src/agent/processPromotion');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'cli', 'zeus.js');

function createTempWorkspace(prefix = 'zeus-process-promotion-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: { ...process.env, ZEUS_CONNECTION_MASTER_KEY: undefined },
    encoding: 'utf8',
  });
}

function createSingleSignalReport(cwd, catalog) {
  recordProcessExperience({
    cwd,
    question: 'Which process owns the dispatch interface?',
    outcome: 'ambiguous',
    catalog,
    glossaryTerm: 'dispatch interface',
  });
  const report = buildProcessImprovementReport({ cwd });
  writeProcessImprovementArtifact(report, { cwd, out: '.zeus/process-improvements.json' });
  return report;
}

test('promotion readiness combines sanitized signals across catalogs without auto-promotion', () => {
  const workspace = createTempWorkspace();
  const catalogA = createTempWorkspace('zeus-catalog-a-');
  const catalogB = createTempWorkspace('zeus-catalog-b-');
  const reportA = createSingleSignalReport(catalogA, 'catalog-a');
  const reportB = createSingleSignalReport(catalogB, 'catalog-b');
  fs.mkdirSync(path.join(workspace, '.zeus'), { recursive: true });
  fs.copyFileSync(
    path.join(catalogA, '.zeus', 'process-improvements.json'),
    path.join(workspace, '.zeus', 'catalog-a.json')
  );
  fs.copyFileSync(
    path.join(catalogB, '.zeus', 'process-improvements.json'),
    path.join(workspace, '.zeus', 'catalog-b.json')
  );
  const candidateId = reportA.candidates[0].candidateId;
  fs.writeFileSync(
    path.join(workspace, '.zeus', 'dispatch-fixture.json'),
    `${JSON.stringify({
      kind: 'process-regression-fixture',
      fixtureId: 'dispatch-ambiguity',
      candidateIds: [candidateId],
      sanitized: true,
      containsCredentials: false,
      containsPrivateProjectIdentifiers: false,
    })}\n`
  );

  const readiness = buildProcessPromotionReadiness({
    cwd: workspace,
    candidatePaths: ['.zeus/catalog-a.json', '.zeus/catalog-b.json'],
    fixturePaths: ['.zeus/dispatch-fixture.json'],
  });
  assert.equal(readiness.kind, 'process-promotion-readiness');
  assert.equal(readiness.automaticPromotion, false);
  assert.equal(readiness.promotionAllowed, false);
  assert.equal(readiness.review.readyForHumanReview, 1);
  assert.equal(readiness.candidates[0].status, 'ready-for-human-review');
  assert.equal(readiness.candidates[0].catalogCount, 2);
  assert.deepEqual(readiness.candidates[0].blockers, []);
  assert.doesNotMatch(
    JSON.stringify(readiness.candidates[0].catalogFingerprints),
    /catalog-a|catalog-b/
  );
  assert.equal(reportB.candidates[0].candidateId, candidateId);
});

test('promotion readiness reports explicit blockers when evidence or fixture is missing', () => {
  const workspace = createTempWorkspace();
  createSingleSignalReport(workspace, 'catalog-only');
  const readiness = buildProcessPromotionReadiness({
    cwd: workspace,
    candidatePaths: ['.zeus/process-improvements.json'],
  });
  assert.equal(readiness.candidates[0].status, 'not-ready');
  assert.deepEqual(readiness.candidates[0].blockers, [
    'INSUFFICIENT_SANITIZED_SIGNALS',
    'CROSS_CATALOG_CONFIRMATION_MISSING',
    'SANITIZED_REGRESSION_FIXTURE_MISSING',
  ]);
});

test('promotion-check CLI accepts repeated inputs and writes a local readiness artifact', () => {
  const workspace = createTempWorkspace();
  createSingleSignalReport(workspace, 'catalog-one');
  const candidate = JSON.parse(
    fs.readFileSync(path.join(workspace, '.zeus', 'process-improvements.json'), 'utf8')
  );
  fs.copyFileSync(
    path.join(workspace, '.zeus', 'process-improvements.json'),
    path.join(workspace, '.zeus', 'second-catalog.json')
  );
  fs.writeFileSync(
    path.join(workspace, '.zeus', 'fixture.json'),
    `${JSON.stringify({
      kind: 'process-regression-fixture',
      fixtureId: 'dispatch-fixture',
      candidateIds: [candidate.candidates[0].candidateId],
      sanitized: true,
      containsCredentials: false,
      containsPrivateProjectIdentifiers: false,
    })}\n`
  );
  const result = runCli(workspace, [
    'process',
    'promotion-check',
    '--candidate',
    '.zeus/process-improvements.json',
    '--candidate',
    '.zeus/second-catalog.json',
    '--fixture',
    '.zeus/fixture.json',
    '--out',
    '.zeus/process-promotion-readiness.json',
    '--json',
  ]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.result.operation, 'promotion-check');
  assert.equal(payload.result.promotionAllowed, false);
  assert.equal(fs.existsSync(path.join(workspace, '.zeus/process-promotion-readiness.json')), true);
});

test('promotion artifacts remain workspace-contained', () => {
  const workspace = createTempWorkspace();
  assert.throws(
    () =>
      buildProcessPromotionReadiness({
        cwd: workspace,
        candidatePaths: ['../outside.json'],
      }),
    error => error.code === 'PATH_OUTSIDE_WORKSPACE'
  );
  assert.throws(
    () => writeProcessPromotionArtifact({}, { cwd: workspace, out: '../outside.json' }),
    error => error.code === 'PATH_OUTSIDE_WORKSPACE'
  );
});
