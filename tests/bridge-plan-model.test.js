const test = require('node:test');
const assert = require('node:assert/strict');

const { buildChangePlan } = require('../src/bridge/bridgePlanModel');

test('buildChangePlan emits safe metadata contract', () => {
  const plan = buildChangePlan({
    program: 'orderpgm',
    profileName: 'default',
    localSourcePath: './workspace/ORDERPGM.rpgle.txt',
    targetType: 'source-member',
    target: {
      targetType: 'source-member',
      library: 'APPLIB',
      sourceFile: 'QRPGLESRC',
      member: 'ORDERPGM',
      memberType: 'RPGLE',
    },
    beforeHash: 'before-hash',
    afterHash: 'after-hash',
    diffSummary: '3 lines changed',
    riskLevel: 'MEDIUM',
    requiredApprovals: ['operator-review'],
    warnings: ['review pending'],
  });

  assert.equal(plan.kind, 'bridge-change-plan');
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.program, 'ORDERPGM');
  assert.equal(plan.remoteTarget.library, 'APPLIB');
  assert.equal(plan.beforeHash, 'before-hash');
  assert.equal(plan.afterHash, 'after-hash');
  assert.equal(plan.riskLevel, 'MEDIUM');
  assert.deepEqual(plan.requiredApprovals, ['operator-review']);
});
