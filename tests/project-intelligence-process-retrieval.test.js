'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const zpi = require('../src/projectIntelligence');

function catalogFixture() {
  const alpha = zpi.fixtures.businessProcess({
    processId: 'process:order-flow',
    processVersionId: 'process:order-flow:v1',
    name: 'Order processing flow',
    entryPoints: [{ id: 'PROGRAM:ORDERPGM', kind: 'program', name: 'ORDERPGM' }],
    claimIds: ['claim:order-flow:1'],
    relationshipIds: ['relationship:order-flow:1'],
  });
  const alphaVersion = zpi.fixtures.processVersion({
    processId: alpha.processId,
    processVersionId: alpha.processVersionId,
    title: alpha.name,
    stepIds: ['step:order-flow:1'],
    claimIds: alpha.claimIds,
    relationshipIds: alpha.relationshipIds,
    interfaces: [{ id: 'interface:order-api', kind: 'interface', name: 'ORDER-API' }],
  });
  const alphaStep = zpi.fixtures.processStep({
    processId: alpha.processId,
    processVersionId: alpha.processVersionId,
    stepId: 'step:order-flow:1',
    title: 'Read ORDERPGM input',
    technicalRefs: ['PROGRAM:ORDERPGM'],
  });
  const alphaClaim = zpi.fixtures.processClaim({
    processId: alpha.processId,
    processVersionId: alpha.processVersionId,
    claimId: 'claim:order-flow:1',
    text: 'ORDERPGM reads the incoming order.',
    supportingRefs: ['PROGRAM:ORDERPGM'],
  });
  const alphaRelationship = zpi.fixtures.processRelationship({
    processId: alpha.processId,
    processVersionId: alpha.processVersionId,
    relationshipId: 'relationship:order-flow:1',
    fromId: alpha.processVersionId,
    toId: alphaStep.stepId,
  });

  const reviewed = zpi.fixtures.businessProcess({
    processId: 'process:order-review',
    processVersionId: 'process:order-review:v1',
    name: 'Order review flow',
    status: 'reviewed',
    confidence: 'high',
    entryPoints: [{ id: 'PROGRAM:REVIEWPGM', kind: 'program', name: 'REVIEWPGM' }],
  });
  const reviewedVersion = zpi.fixtures.processVersion({
    processId: reviewed.processId,
    processVersionId: reviewed.processVersionId,
    title: reviewed.name,
    status: 'reviewed',
    confidence: 'high',
    review: { reviewerId: 'reviewer-1', approved: true, reviewedAt: '2026-09-08T12:00:00.000Z' },
  });

  return {
    schemaVersion: 1,
    kind: 'process-candidate-catalog',
    projectId: 'proj-demo',
    snapshotId: 'snap-001',
    freshness: { status: 'published', checkedAt: '2026-09-08T12:00:00.000Z' },
    candidates: [
      {
        process: alpha,
        version: alphaVersion,
        steps: [alphaStep],
        claims: [alphaClaim],
        relationships: [alphaRelationship],
      },
      { process: reviewed, version: reviewedVersion, steps: [], claims: [], relationships: [] },
    ],
  };
}

test('process list and describe preserve deterministic lifecycle and freshness metadata', () => {
  const catalog = catalogFixture();
  const listed = zpi.listProcesses(catalog);
  assert.deepEqual(
    listed.processes.map(process => process.processId),
    ['process:order-flow', 'process:order-review']
  );
  assert.equal(listed.freshness.status, 'published');

  const described = zpi.describeProcess(catalog, 'process:order-flow');
  assert.equal(described.ok, true);
  assert.equal(described.version.processVersionId, 'process:order-flow:v1');
  assert.equal(described.steps[0].technicalRefs[0], 'PROGRAM:ORDERPGM');
  assert.equal(described.evidenceReferences[0].id, 'ev-1');
});

test('process query ranks an exact technical identifier ahead of a derived summary', () => {
  const result = zpi.queryProcesses(catalogFixture(), 'PROGRAM:ORDERPGM');
  assert.equal(result.matches[0].id, 'process:order-flow');
  assert.equal(result.matches[0].exactIdentifier, true);
  assert.equal(result.status, 'candidate');
  assert.equal(result.sourceOfTruth, false);
  assert.equal(result.advisory, true);
  const validation = zpi.validateProjectIntelligenceContract(
    zpi.CONTRACT_IDS.PROCESS_QUERY_RESULT,
    result
  );
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test('process query makes a no-match and unknown freshness explicit', () => {
  const catalog = catalogFixture();
  delete catalog.freshness;
  const result = zpi.queryProcesses(catalog, 'unmapped interface ZZ');
  assert.equal(result.status, 'unknown');
  assert.equal(result.confidence, 'unknown');
  assert.equal(result.matches.length, 0);
  assert.equal(result.freshness.status, 'unknown');
  assert.ok(result.unknowns.some(value => /not represented/i.test(value)));
  assert.ok(result.evidenceReferences.some(value => value.kind === 'derived-reference'));
});

test('impact and diff remain bounded and deterministic', () => {
  const catalog = catalogFixture();
  const impact = zpi.impactProcess(catalog, 'process:order-flow');
  assert.deepEqual(impact.affectedElements.steps, ['step:order-flow:1']);
  assert.equal(impact.relationships.length, 1);

  const noBaseline = zpi.diffProcess(catalog, 'process:order-flow');
  assert.equal(noBaseline.status, 'unknown');
  assert.equal(noBaseline.reason, 'no-baseline-version-in-catalog');

  const withBaseline = {
    ...catalog,
    versions: [
      ...catalog.candidates.map(candidate => candidate.version),
      zpi.fixtures.processVersion({
        processId: 'process:order-flow',
        processVersionId: 'process:order-flow:v0',
        title: 'Order processing flow baseline',
      }),
    ],
  };
  const diff = zpi.diffProcess(withBaseline, 'process:order-flow');
  assert.equal(diff.baselineVersionId, 'process:order-flow:v0');
  assert.equal(diff.changes.version.changed, true);
});

test('process catalog paths are workspace-relative and CLI emits machine-readable retrieval', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-process-retrieval-'));
  const catalogPath = path.join(tempRoot, 'catalog.json');
  fs.writeFileSync(catalogPath, JSON.stringify(catalogFixture()), 'utf8');
  assert.throws(
    () => zpi.resolveProcessCatalogPath('../catalog.json', tempRoot),
    error => error.code === 'PROCESS_CATALOG_PATH_UNSAFE'
  );

  const cliPath = path.resolve(__dirname, '..', 'cli', 'zeus.js');
  const run = spawnSync(
    process.execPath,
    [
      cliPath,
      'process',
      'query',
      '--catalog',
      'catalog.json',
      '--question',
      'Was macht ORDER-API?',
      '--json',
    ],
    { cwd: tempRoot, encoding: 'utf8' }
  );
  assert.equal(run.status, 0, run.stderr);
  const output = JSON.parse(run.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.operation, 'query');
  assert.equal(output.result.matches[0].id, 'process:order-flow');
});
