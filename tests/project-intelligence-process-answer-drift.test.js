'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const {
  buildProcessAnswerDrift,
  writeProcessAnswerDriftArtifact,
} = require('../src/agent/processAnswerDrift');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'cli', 'zeus.js');

function createWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-process-answer-drift-'));
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

function writeResult(workspace, name, value) {
  const location = path.join(workspace, '.zeus', name);
  fs.writeFileSync(location, `${JSON.stringify(value)}\n`);
  return `.zeus/${name}`;
}

test('drift report stays stable for an unchanged approved baseline', () => {
  const workspace = createWorkspace();
  try {
    const baseline = writeResult(workspace, 'baseline.json', regressionResult());
    const current = writeResult(workspace, 'current.json', regressionResult());
    const result = buildProcessAnswerDrift({ cwd: workspace, baseline, current });
    assert.equal(result.status, 'stable');
    assert.deepEqual(result.blockers, []);
    assert.equal(result.comparison.sameCatalog, true);
    assert.equal(result.metrics.unchangedScenarioCount, 1);
    assert.equal(result.automaticPromotion, false);
    assert.equal(result.promotionAllowed, false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('drift report exposes bounded categories without private result content', () => {
  const workspace = createWorkspace();
  try {
    const baseline = writeResult(workspace, 'baseline.json', regressionResult());
    const current = writeResult(
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
      })
    );
    const result = buildProcessAnswerDrift({ cwd: workspace, baseline, current });
    assert.equal(result.status, 'drift');
    assert.ok(result.blockers.includes('CATALOG_DRIFT'));
    assert.ok(result.blockers.includes('REGRESSION_INTRODUCED'));
    assert.ok(result.blockers.includes('EVIDENCE_LOSS'));
    assert.ok(result.blockers.includes('FRESHNESS_DRIFT'));
    assert.ok(result.blockers.includes('STATUS_DRIFT'));
    assert.ok(result.blockers.includes('PROCESS_MATCH_DRIFT'));
    assert.ok(result.blockers.includes('ANSWER_CONTRACT_DRIFT'));
    assert.equal(result.drift[0].scenarioKey, 'scenario:805d5649b9e962e6');
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /dispatch-interface-answer/);
    assert.doesNotMatch(serialized, /question|answer text|process:private/i);
    assert.doesNotMatch(serialized, new RegExp(workspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(result.nextCommand.includes('process regression-check'), true);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('drift-check CLI writes a bounded .zeus artifact and rejects unsafe inputs', () => {
  const workspace = createWorkspace();
  try {
    const baseline = writeResult(workspace, 'baseline.json', regressionResult());
    const current = writeResult(workspace, 'current.json', regressionResult());
    const run = spawnSync(
      process.execPath,
      [
        CLI,
        'process',
        'drift-check',
        '--baseline',
        baseline,
        '--current',
        current,
        '--out',
        '.zeus/drift.json',
        '--json',
      ],
      { cwd: workspace, encoding: 'utf8' }
    );
    assert.equal(run.status, 0, run.stderr);
    const payload = JSON.parse(run.stdout);
    assert.equal(payload.result.operation, 'drift-check');
    assert.equal(payload.result.status, 'stable');
    assert.equal(fs.existsSync(path.join(workspace, '.zeus', 'drift.json')), true);
    assert.throws(
      () => writeProcessAnswerDriftArtifact({}, { cwd: workspace, out: '../outside.json' }),
      error => error.code === 'PATH_OUTSIDE_WORKSPACE'
    );
    assert.throws(
      () => buildProcessAnswerDrift({ cwd: workspace, baseline: '../outside.json', current }),
      error => error.code === 'PATH_OUTSIDE_WORKSPACE'
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
