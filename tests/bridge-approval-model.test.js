const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildApprovalRecord,
  validateApprovalForAction,
  writeApprovalArtifacts,
} = require('../src/bridge/bridgeApprovalModel');

function buildPlan() {
  return {
    planId: 'plan-1234567890ab',
    planHash: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    program: 'ORDERPGM',
    profileName: 'default',
    targetType: 'source-member',
    remoteTarget: {
      targetType: 'source-member',
      library: 'APPLIB',
      sourceFile: 'QRPGLESRC',
      member: 'ORDERPGM',
    },
    localSourcePath: './workspace/ORDERPGM.rpgle.txt',
    beforeHash: 'before-hash',
    afterHash: 'after-hash',
  };
}

test('buildApprovalRecord emits safe approval metadata', () => {
  const approval = buildApprovalRecord({
    program: 'orderpgm',
    profileName: 'default',
    plan: buildPlan(),
    approvedActions: ['stage', 'apply'],
    approvedBy: 'operator.user',
    approvalNote: 'Reviewed by operator.',
  });

  assert.equal(approval.kind, 'bridge-approval-record');
  assert.equal(approval.schemaVersion, 1);
  assert.equal(approval.program, 'ORDERPGM');
  assert.equal(approval.profileName, 'default');
  assert.equal(approval.planId, 'plan-1234567890ab');
  assert.equal(approval.planHash, buildPlan().planHash);
  assert.deepEqual(approval.approvedActions, ['apply', 'stage']);
});

test('validateApprovalForAction accepts matching approval', () => {
  const approval = buildApprovalRecord({
    program: 'ORDERPGM',
    profileName: 'default',
    plan: buildPlan(),
    approvedActions: ['compile-run'],
    approvedBy: 'operator.user',
    expiresAt: '2099-01-01T00:00:00.000Z',
  });

  const result = validateApprovalForAction({
    approval,
    requiredAction: 'compile-run',
    expectedProgram: 'ORDERPGM',
    expectedProfileName: 'default',
    expectedPlanId: buildPlan().planId,
    expectedPlanHash: buildPlan().planHash,
    now: '2026-05-10T12:00:00.000Z',
  });

  assert.equal(result.valid, true);
});

test('validateApprovalForAction rejects missing approval', () => {
  assert.throws(
    () => validateApprovalForAction({
      approval: null,
      requiredAction: 'stage',
      expectedProgram: 'ORDERPGM',
      expectedProfileName: 'default',
      expectedPlanId: buildPlan().planId,
      expectedPlanHash: buildPlan().planHash,
    }),
    /Approval artifact is missing/,
  );
});

test('validateApprovalForAction rejects wrong program', () => {
  const approval = buildApprovalRecord({
    program: 'INVOICEPGM',
    profileName: 'default',
    plan: {
      ...buildPlan(),
      program: 'INVOICEPGM',
    },
    approvedActions: ['stage'],
    approvedBy: 'operator.user',
  });

  assert.throws(
    () => validateApprovalForAction({
      approval,
      requiredAction: 'stage',
      expectedProgram: 'ORDERPGM',
      expectedProfileName: 'default',
      expectedPlanId: buildPlan().planId,
      expectedPlanHash: buildPlan().planHash,
    }),
    /program does not match/,
  );
});

test('validateApprovalForAction rejects wrong action', () => {
  const approval = buildApprovalRecord({
    program: 'ORDERPGM',
    profileName: 'default',
    plan: buildPlan(),
    approvedActions: ['stage'],
    approvedBy: 'operator.user',
  });

  assert.throws(
    () => validateApprovalForAction({
      approval,
      requiredAction: 'apply',
      expectedProgram: 'ORDERPGM',
      expectedProfileName: 'default',
      expectedPlanId: buildPlan().planId,
      expectedPlanHash: buildPlan().planHash,
    }),
    /required action: apply/,
  );
});

test('validateApprovalForAction rejects wrong plan identity', () => {
  const approval = buildApprovalRecord({
    program: 'ORDERPGM',
    profileName: 'default',
    plan: buildPlan(),
    approvedActions: ['apply'],
    approvedBy: 'operator.user',
  });

  assert.throws(
    () => validateApprovalForAction({
      approval,
      requiredAction: 'apply',
      expectedProgram: 'ORDERPGM',
      expectedProfileName: 'default',
      expectedPlanId: 'plan-other',
      expectedPlanHash: buildPlan().planHash,
    }),
    /planId does not match/,
  );
});

test('validateApprovalForAction rejects expired approval', () => {
  const approval = buildApprovalRecord({
    program: 'ORDERPGM',
    profileName: 'default',
    plan: buildPlan(),
    approvedActions: ['apply'],
    approvedBy: 'operator.user',
    expiresAt: '2026-01-01T00:00:00.000Z',
  });

  assert.throws(
    () => validateApprovalForAction({
      approval,
      requiredAction: 'apply',
      expectedProgram: 'ORDERPGM',
      expectedProfileName: 'default',
      expectedPlanId: buildPlan().planId,
      expectedPlanHash: buildPlan().planHash,
      now: '2026-05-10T12:00:00.000Z',
    }),
    /Approval has expired/,
  );
});

test('writeApprovalArtifacts masks secrets in persisted approval output', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-bridge-approval-'));
  try {
    const approval = buildApprovalRecord({
      program: 'ORDERPGM',
      profileName: 'default',
      plan: buildPlan(),
      approvedActions: ['stage'],
      approvedBy: 'operator.user',
      approvalNote: 'token=abc123 password=secret',
    });
    const result = writeApprovalArtifacts({
      outputRoot: tempRoot,
      program: 'ORDERPGM',
      approval,
    });
    const persisted = JSON.parse(fs.readFileSync(result.jsonPath, 'utf8'));
    assert.match(persisted.approvalNote, /\[REDACTED\]/);
    assert.doesNotMatch(persisted.approvalNote, /\babc123\b/);
    assert.doesNotMatch(persisted.approvalNote, /\bsecret\b/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
