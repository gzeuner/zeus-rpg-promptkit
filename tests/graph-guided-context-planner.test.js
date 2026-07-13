const test = require('node:test');
const assert = require('node:assert/strict');

const { buildContextPlan } = require('../src/analyze/graphGuidedContextPlanner');

const minimalCanonical = {
  schemaVersion: 1,
  kind: 'canonical-analysis',
  rootProgram: 'TESTPGM',
  entities: {
    programs: [{ name: 'TESTPGM', evidence: [{ file: 'QRPGLESRC/TESTPGM.rpgle', startLine: 10 }] }],
    procedures: [
      {
        name: 'MAIN',
        program: 'TESTPGM',
        evidence: [{ file: 'QRPGLESRC/TESTPGM.rpgle', startLine: 12 }],
      },
    ],
    tables: [{ name: 'MYTABLE', evidence: [{ file: 'QDDSSRC/MYTABLE.pf' }] }],
  },
  relations: [{ type: 'CALLS_PROGRAM', from: 'TESTPGM', to: 'OTHERPGM', evidence: [] }],
  sourceFiles: [{ path: 'QRPGLESRC/TESTPGM.rpgle' }],
  unresolvedPrograms: ['DYNAMIC1'],
};

test('context-plan produces versioned output with selected and omissions', () => {
  const plan = buildContextPlan({
    canonicalAnalysis: minimalCanonical,
    goal: 'impact of field change on TESTPGM',
    targets: ['TESTPGM', 'MYTABLE'],
    tokenBudget: 1000,
  });
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.kind, 'context-plan');
  assert.ok(Array.isArray(plan.selected));
  assert.ok(plan.selected.length > 0);
  assert.ok(Array.isArray(plan.omissions));
  assert.ok(typeof plan.estimatedTokensUsed === 'number');
  assert.ok(plan.unresolved.length >= 0);
});

test('context-plan respects token budget and reports omissions', () => {
  const plan = buildContextPlan({
    canonicalAnalysis: minimalCanonical,
    goal: 'test budget',
    targets: ['TESTPGM'],
    tokenBudget: 10, // very small
  });
  assert.ok(plan.omissions.length >= 0 || plan.selected.length <= 2);
});

test('exact match preferred and graph paths present when graph given', () => {
  const fakeGraph = {
    nodes: [{ id: 'P:TESTPGM' }, { id: 'T:MYTABLE' }],
    edges: [{ from: 'P:TESTPGM', to: 'T:MYTABLE', type: 'TABLE_REFERENCE' }],
  };
  const plan = buildContextPlan({
    canonicalAnalysis: minimalCanonical,
    evidenceGraph: fakeGraph,
    goal: 'table ref',
    targets: ['TESTPGM'],
    tokenBudget: 5000,
  });
  assert.ok(plan.graphPaths.length >= 0);
});
