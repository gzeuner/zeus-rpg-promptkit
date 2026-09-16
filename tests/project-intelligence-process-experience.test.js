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
const { listAgentExperience } = require('../src/agent/agentExperience');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'cli', 'zeus.js');

function createTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-process-experience-'));
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: { ...process.env, ZEUS_CONNECTION_MASTER_KEY: undefined },
    encoding: 'utf8',
  });
}

test('process experience reuses the sanitized local agent log', () => {
  const cwd = createTempWorkspace();
  const result = recordProcessExperience({
    cwd,
    question: 'Was macht Schnittstelle SHIPMENT mit --token TOPSECRET?',
    outcome: 'ambiguous',
    processId: 'process:shipment-flow',
    glossaryTerm: 'SHIPMENT',
    correction: 'Use the scoped dispatch interface definition.',
    evidenceSummary: 'local process catalog evidence only',
  });

  assert.equal(result.ok, true);
  assert.equal(result.event.topic, 'process');
  assert.equal(result.event.processIssue, 'AMBIGUOUS');
  assert.equal(result.event.targetSurface, 'glossary-entry');
  assert.doesNotMatch(JSON.stringify(result), /TOPSECRET/);
  const listed = listAgentExperience({ cwd });
  assert.equal(listed.events.length, 1);
  assert.equal(listed.summary.process.total, 1);
  assert.equal(listed.summary.recurringFailureCodes.length, 0);
  assert.equal(listed.events[0].topic, 'process');
  assert.equal(
    listed.events[0].question,
    'Was macht Schnittstelle SHIPMENT mit --token [REDACTED]'
  );
  assert.equal(listed.events[0].processId, 'process:shipment-flow');
});

test('process improvement report groups repeated signals and stays review-only', () => {
  const cwd = createTempWorkspace();
  for (const correction of ['Confirm alias with owner', 'Confirm alias with architect']) {
    recordProcessExperience({
      cwd,
      question: 'What does legacy dispatch mean?',
      outcome: 'ambiguous',
      glossaryTerm: 'legacy dispatch',
      correction,
    });
  }
  recordProcessExperience({
    cwd,
    question: 'What is the current dispatch path?',
    outcome: 'stale',
    processId: 'process:shipment-flow',
  });

  const report = buildProcessImprovementReport({ cwd });
  assert.equal(report.operation, 'improvements');
  assert.equal(report.automaticPromotion, false);
  assert.equal(report.candidates.length, 2);
  assert.equal(report.candidates[0].status, 'candidate');
  assert.equal(report.candidates[0].targetSurface, 'glossary-entry');
  assert.equal(report.candidates[0].count, 2);
  assert.equal(report.candidates[0].review.requiresSanitizedRegressionFixture, true);
  assert.match(report.candidates[0].questionExamples[0], /legacy dispatch/);
});

test('process experience CLI records issues and writes a bounded candidate artifact', () => {
  const cwd = createTempWorkspace();
  for (let index = 0; index < 2; index += 1) {
    const record = runCli(cwd, [
      'process',
      'experience',
      '--question',
      'Which process owns the dispatch interface?',
      '--outcome',
      'incomplete',
      '--process-id',
      'process:dispatch',
      '--json',
    ]);
    assert.equal(record.status, 0, record.stderr);
  }
  const artifactPath = path.join(cwd, '.zeus', 'process-improvements.json');
  const report = runCli(cwd, [
    'process',
    'improvements',
    '--out',
    '.zeus/process-improvements.json',
    '--json',
  ]);
  assert.equal(report.status, 0, report.stderr);
  const payload = JSON.parse(report.stdout);
  assert.equal(payload.result.candidates[0].targetSurface, 'extraction-rule');
  assert.equal(payload.result.candidates[0].status, 'candidate');
  assert.equal(fs.existsSync(artifactPath), true);
  assert.equal(JSON.parse(fs.readFileSync(artifactPath, 'utf8')).automaticPromotion, false);
});

test('process improvement artifact remains workspace-contained', () => {
  const cwd = createTempWorkspace();
  const report = buildProcessImprovementReport({ cwd });
  assert.throws(
    () => writeProcessImprovementArtifact(report, { cwd, out: '../outside.json' }),
    error => error.code === 'PATH_OUTSIDE_WORKSPACE'
  );
});
