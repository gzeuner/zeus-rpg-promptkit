'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const zpi = require('../src/projectIntelligence');

function catalogFixture() {
  const process = zpi.fixtures.businessProcess({
    processId: 'process:shipment-flow',
    processVersionId: 'process:shipment-flow:v1',
    name: 'Shipment preparation flow',
    entryPoints: [{ id: 'PROGRAM:SHIPMENT', kind: 'program', name: 'SHIPMENT' }],
    claimIds: ['claim:shipment-flow:1'],
    relationshipIds: ['relationship:shipment-flow:1'],
  });
  const version = zpi.fixtures.processVersion({
    processId: process.processId,
    processVersionId: process.processVersionId,
    title: process.name,
    stepIds: ['step:shipment-flow:1', 'step:shipment-flow:2', 'step:shipment-flow:3'],
    claims: undefined,
    claimIds: process.claimIds,
    relationshipIds: process.relationshipIds,
    actors: [{ id: 'role:warehouse', kind: 'actor', name: 'Warehouse operator' }],
    systems: [{ id: 'system:shipping', kind: 'system', name: 'Shipping application' }],
    interfaces: [{ id: 'interface:dispatch', kind: 'interface', name: 'Dispatch interface' }],
    dataObjects: [{ id: 'data:shipment', kind: 'data', name: 'Shipment record' }],
    decisions: [{ id: 'decision:ready', kind: 'decision', name: 'Ready to dispatch' }],
    exceptions: [{ id: 'exception:blocked', kind: 'exception', name: 'Dispatch blocked' }],
    description: {
      trigger: 'A shipment is ready for preparation.',
      goal: 'Prepare the shipment for dispatch.',
      openQuestions: ['Which owner confirms the dispatch rule?'],
    },
  });
  return {
    schemaVersion: 1,
    kind: 'process-candidate-catalog',
    projectId: 'proj-demo',
    snapshotId: 'snap-001',
    sourceHash: 'a'.repeat(64),
    freshness: { status: 'published', snapshotId: 'snap-001', sourceHash: 'a'.repeat(64) },
    candidates: [
      {
        process,
        version,
        steps: [
          zpi.fixtures.processStep({
            processId: process.processId,
            processVersionId: process.processVersionId,
            stepId: 'step:shipment-flow:1',
            sequence: 1,
            stepKind: 'action',
            title: 'Read shipment record',
            technicalRefs: ['PROGRAM:SHIPMENT'],
          }),
          zpi.fixtures.processStep({
            processId: process.processId,
            processVersionId: process.processVersionId,
            stepId: 'step:shipment-flow:2',
            sequence: 2,
            stepKind: 'decision',
            title: 'Check dispatch readiness',
            technicalRefs: ['PROGRAM:SHIPMENT'],
          }),
          zpi.fixtures.processStep({
            processId: process.processId,
            processVersionId: process.processVersionId,
            stepId: 'step:shipment-flow:3',
            sequence: 3,
            stepKind: 'outcome',
            title: 'Dispatch shipment',
            technicalRefs: ['interface:dispatch'],
          }),
        ],
        claims: [
          zpi.fixtures.processClaim({
            processId: process.processId,
            processVersionId: process.processVersionId,
            claimId: 'claim:shipment-flow:1',
            text: 'The flow checks whether a shipment is ready.',
            supportingRefs: ['PROGRAM:SHIPMENT'],
          }),
        ],
        relationships: [
          zpi.fixtures.processRelationship({
            processId: process.processId,
            processVersionId: process.processVersionId,
            relationshipId: 'relationship:shipment-flow:1',
            fromId: process.processVersionId,
            toId: 'step:shipment-flow:1',
          }),
        ],
      },
    ],
  };
}

test('role views expose bounded projections and remain contract-valid', () => {
  const catalog = catalogFixture();
  for (const role of ['product-owner', 'architect', 'developer', 'tester']) {
    const view = zpi.buildProcessRoleView(catalog, 'process:shipment-flow', role);
    assert.equal(view.ok, true);
    assert.equal(view.role, role);
    assert.equal(view.sourceOfTruth, false);
    assert.equal(
      zpi.validateProjectIntelligenceContract(zpi.CONTRACT_IDS.PROCESS_ROLE_VIEW, view).ok,
      true
    );
  }
  assert.equal(
    zpi.buildProcessRoleView(catalog, 'process:shipment-flow', 'unknown').reasonCode,
    'PROCESS_ROLE_UNSUPPORTED'
  );
});

test('chat adapter uses the same evidence-backed query without network or persistence', () => {
  const result = zpi.chatProcess(catalogFixture(), 'PROGRAM:SHIPMENT');
  assert.equal(result.operation, 'chat');
  assert.equal(result.adapter, 'local-read-only');
  assert.equal(result.matches[0].id, 'process:shipment-flow');
  assert.equal(result.sourceOfTruth, false);
});

test('freshness compares current source identity and impact remains conservative', () => {
  const catalog = catalogFixture();
  assert.equal(
    zpi.assessProcessFreshness(catalog, { currentSnapshotId: 'snap-001' }).status,
    'published'
  );
  const stale = zpi.queryProcesses(catalog, 'PROGRAM:SHIPMENT', {
    currentSourceHash: 'b'.repeat(64),
  });
  assert.equal(stale.freshness.status, 'stale');
  assert.ok(stale.unknowns.some(value => /freshness is stale/i.test(value)));
  const impact = zpi.impactProcess(catalog, 'process:shipment-flow', {
    currentSnapshotId: 'snap-002',
  });
  assert.equal(impact.freshnessImpact.requiresReanalysis, true);
  assert.equal(impact.freshnessImpact.scope, 'whole-process-version');
});

test('deterministic process evaluation reports scenario and coverage findings', () => {
  const catalog = catalogFixture();
  const result = zpi.evaluateProcessCatalog(catalog, [
    {
      id: 'scenario:shipment',
      question: 'What does PROGRAM:SHIPMENT do?',
      expectedProcessIds: ['process:shipment-flow'],
    },
  ]);
  assert.equal(result.status, 'needs-review');
  assert.equal(result.metrics.processCount, 1);
  assert.equal(result.scenarios[0].status, 'pass');
  assert.equal(result.scenarios[0].matchedProcessIds[0], 'process:shipment-flow');
  assert.equal(
    zpi.validateProjectIntelligenceContract(zpi.CONTRACT_IDS.PROCESS_EVALUATION_RESULT, result).ok,
    true
  );
});

test('CLI exposes view, chat, evaluation, and current-source freshness options', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-process-agent-'));
  fs.writeFileSync(path.join(tempRoot, 'catalog.json'), JSON.stringify(catalogFixture()), 'utf8');
  fs.writeFileSync(
    path.join(tempRoot, 'scenarios.json'),
    JSON.stringify([{ id: 'scenario:shipment', question: 'PROGRAM:SHIPMENT' }]),
    'utf8'
  );
  const cliPath = path.resolve(__dirname, '..', 'cli', 'zeus.js');
  const run = args =>
    require('child_process').spawnSync(process.execPath, [cliPath, ...args], {
      cwd: tempRoot,
      encoding: 'utf8',
    });
  const view = run([
    'process',
    'view',
    '--catalog',
    'catalog.json',
    '--id',
    'process:shipment-flow',
    '--role',
    'tester',
    '--json',
  ]);
  assert.equal(view.status, 0, view.stderr);
  assert.equal(JSON.parse(view.stdout).result.role, 'tester');
  const chat = run([
    'process',
    'chat',
    '--catalog',
    'catalog.json',
    '--question',
    'PROGRAM:SHIPMENT',
    '--current-snapshot-id',
    'snap-002',
    '--json',
  ]);
  assert.equal(chat.status, 0, chat.stderr);
  assert.equal(JSON.parse(chat.stdout).result.freshness.status, 'stale');
  const evaluation = run([
    'process',
    'evaluate',
    '--catalog',
    'catalog.json',
    '--scenarios',
    'scenarios.json',
    '--json',
  ]);
  assert.equal(evaluation.status, 0, evaluation.stderr);
  assert.equal(JSON.parse(evaluation.stdout).result.scenarios[0].status, 'pass');
});
