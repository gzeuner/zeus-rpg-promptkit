'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { inspectCaseIndex } = require('../src/agent/caseIndex');
const { buildCliAgentPreflightPayload } = require('../src/agent/agentPreflight');

test('case index reports document freshness and a bounded read-only plan', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-case-index-'));
  try {
    const output = path.join(cwd, 'case');
    fs.mkdirSync(output);
    const content = Buffer.from('# TC-001 Verify local analysis\n');
    fs.writeFileSync(path.join(output, 'test-plan.md'), content);
    fs.writeFileSync(
      path.join(output, 'case-index.json'),
      JSON.stringify({
        schemaVersion: 1,
        kind: 'case-index',
        caseId: 'local-analysis',
        primaryDocument: 'test-plan.md',
        documents: [
          {
            path: 'test-plan.md',
            role: 'test-plan',
            status: 'current',
            sha256: crypto.createHash('sha256').update(content).digest('hex'),
          },
        ],
        validations: [],
        evidence: [],
      })
    );

    const result = inspectCaseIndex({ cwd, out: 'case' });
    assert.equal(result.status, 'ready');
    assert.equal(result.documents[0].freshness, 'verified');
    assert.deepEqual(result.documents[0].caseIds, ['TC-001']);
    assert.equal(result.readPlan.length, 1);
    assert.equal(result.executionStarted, false);
    assert.equal(result.approvalGranted, false);

    const preflight = buildCliAgentPreflightPayload({ cwd, out: 'case', goal: 'Review test plan' });
    assert.equal(preflight.taskOrientation.task, 'Review test plan');
    assert.equal(preflight.taskOrientation.caseReadPlan.length, 1);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('case index marks changed documents stale and rejects unsafe contracts', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-case-index-'));
  try {
    const output = path.join(cwd, 'case');
    fs.mkdirSync(output);
    fs.writeFileSync(path.join(output, 'test-plan.md'), '# TC-001\nchanged\n');
    const indexPath = path.join(output, 'case-index.json');
    const index = {
      schemaVersion: 1,
      kind: 'case-index',
      caseId: 'case-1',
      primaryDocument: 'test-plan.md',
      documents: [
        { path: 'test-plan.md', role: 'test-plan', status: 'current', sha256: '0'.repeat(64) },
      ],
      validations: [],
      evidence: [],
    };
    fs.writeFileSync(indexPath, JSON.stringify(index));
    const stale = inspectCaseIndex({ cwd, out: 'case' });
    assert.equal(stale.documents[0].freshness, 'stale');
    assert.equal(stale.status, 'needs-attention');

    index.documents[0].path = '../outside.md';
    fs.writeFileSync(indexPath, JSON.stringify(index));
    assert.equal(inspectCaseIndex({ cwd, out: 'case' }).status, 'invalid');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
