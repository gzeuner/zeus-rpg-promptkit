'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createSnapshotEngine,
  createProjectRetriever,
  expandNeighborhood,
  allocateBudgetSlices,
  packBucket,
  seedIdsFromHits,
  validateProjectIntelligenceContract,
  CONTRACT_IDS,
  REASON_CODES,
  probeNodeSqlite,
} = require('../src/projectIntelligence');

const HAS_SQLITE = probeNodeSqlite().available;
const FIXTURE_ORDER = path.join(__dirname, 'fixtures', 'v1-smoke', 'src', 'ORDERPGM.rpgle');
const FIXTURE_INV = path.join(__dirname, 'fixtures', 'v1-smoke', 'src', 'INVPGM.rpgle');

function tempDir(label = 'zpi-ret') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
}

function buildProject() {
  const root = tempDir();
  const src = path.join(root, 'src');
  const knowledgeRoot = path.join(root, 'pk');
  fs.mkdirSync(src, { recursive: true });
  fs.copyFileSync(FIXTURE_ORDER, path.join(src, 'ORDERPGM.rpgle'));
  fs.copyFileSync(FIXTURE_INV, path.join(src, 'INVPGM.rpgle'));
  const engine = createSnapshotEngine({
    knowledgeRoot,
    projectId: 'proj-ret',
    trustedRoots: [{ rootId: 'root-src', path: src }],
  });
  engine.fullRebuild();
  engine.close();
  return { knowledgeRoot, src };
}

test('budget slices sum to total and pack reports omissions', () => {
  const { total, slices } = allocateBudgetSlices(1000);
  assert.equal(total, 1000);
  const sum = Object.values(slices).reduce((a, b) => a + b, 0);
  assert.equal(sum, 1000);

  const items = [
    { id: 'a', kind: 'x', text: 'x'.repeat(400) },
    { id: 'b', kind: 'x', text: 'y'.repeat(400) },
    { id: 'c', kind: 'x', text: 'z'.repeat(400) },
  ];
  const packed = packBucket(items, 50, REASON_CODES.TOKEN_BUDGET_EXCEEDED);
  assert.ok(packed.omitted.length >= 1);
  assert.ok(packed.omitted.every(o => o.reasonCode === REASON_CODES.TOKEN_BUDGET_EXCEEDED));
});

test('graph expansion is deterministic and hop-bounded', () => {
  const rels = [
    { relationshipId: 'r1', fromSymbolId: 'A', toSymbolId: 'B', relationshipType: 'PROGRAM_CALL' },
    { relationshipId: 'r2', fromSymbolId: 'B', toSymbolId: 'C', relationshipType: 'PROGRAM_CALL' },
    { relationshipId: 'r3', fromSymbolId: 'C', toSymbolId: 'D', relationshipType: 'PROGRAM_CALL' },
  ];
  const one = expandNeighborhood(['A'], rels, 1);
  assert.deepEqual(one.nodes, ['A', 'B']);
  const two = expandNeighborhood(['A'], rels, 2);
  assert.deepEqual(two.nodes, ['A', 'B', 'C']);
  assert.deepEqual(expandNeighborhood(['A'], rels, 1).nodes, one.nodes);
});

test('seedIdsFromHits extracts symbol ids', () => {
  const seeds = seedIdsFromHits([
    { docId: 'doc:symbol:sym:program:x', kind: 'symbol', score: 1 },
    { docId: 'doc:unit:su:1', kind: 'source-unit', score: 1 },
  ]);
  assert.deepEqual(seeds, ['sym:program:x']);
});

test(
  'retrieve + buildContextPackage: contract valid, omissions, source recall',
  { skip: !HAS_SQLITE },
  () => {
    const { knowledgeRoot, src } = buildProject();
    const retriever = createProjectRetriever({
      knowledgeRoot,
      projectId: 'proj-ret',
      trustedRoots: [{ rootId: 'root-src', path: src }],
      readOnly: true,
    });
    try {
      const lexical = retriever.retrieve({ query: 'ORDERPGM INVPGM', limit: 10 });
      assert.ok(lexical.hits.length >= 1);
      assert.equal(lexical.projectId, 'proj-ret');
      assert.ok(lexical.snapshotId);

      // Tight budget forces omissions
      const pkg = retriever.buildContextPackage({
        query: 'ORDERPGM',
        tokenBudget: 120,
        expandHops: 1,
        includeBodies: true,
        limit: 20,
      });
      assert.equal(pkg.ok, true);
      const validation = validateProjectIntelligenceContract(
        CONTRACT_IDS.CONTEXT_PACKAGE,
        pkg.contextPackage
      );
      assert.equal(validation.ok, true, JSON.stringify(validation.errors));
      assert.equal(pkg.contextPackage.sourceOfTruth, false);
      assert.equal(pkg.contextPackage.advisory, true);
      assert.ok(Array.isArray(pkg.contextPackage.omissions));
      assert.ok(pkg.contextPackage.selected.length >= 1);
      assert.ok(pkg.metrics.usedTokens <= pkg.metrics.tokenBudget);

      // Source recall: query ORDERPGM should select at least one related entity
      const ids = pkg.contextPackage.selected.map(s => s.id).join(' ');
      assert.ok(
        /ORDERPGM|order|INVPGM|sym:|doc:/i.test(ids),
        `expected source-related selection, got ${ids}`
      );

      // Evidence references present when sources selected
      assert.ok(Array.isArray(pkg.contextPackage.evidenceReferences));

      // Deterministic package id for same query
      const pkg2 = retriever.buildContextPackage({
        query: 'ORDERPGM',
        tokenBudget: 120,
        expandHops: 1,
        includeBodies: true,
        limit: 20,
      });
      assert.equal(pkg.contextPackage.packageId, pkg2.contextPackage.packageId);
      assert.deepEqual(
        pkg.contextPackage.selected.map(s => s.id),
        pkg2.contextPackage.selected.map(s => s.id)
      );
    } finally {
      retriever.close();
    }
  }
);

test('token reduction metric is reported', { skip: !HAS_SQLITE }, () => {
  const { knowledgeRoot, src } = buildProject();
  const retriever = createProjectRetriever({
    knowledgeRoot,
    projectId: 'proj-ret',
    trustedRoots: [{ rootId: 'root-src', path: src }],
  });
  try {
    const large = retriever.buildContextPackage({
      query: 'ORDERPGM',
      tokenBudget: 8000,
      expandHops: 1,
      includeBodies: true,
    });
    const small = retriever.buildContextPackage({
      query: 'ORDERPGM',
      tokenBudget: 80,
      expandHops: 1,
      includeBodies: true,
    });
    assert.ok(small.metrics.usedTokens <= large.metrics.usedTokens);
    assert.ok(small.contextPackage.omissions.length >= large.contextPackage.omissions.length);
  } finally {
    retriever.close();
  }
});

test('stale/non-published snapshot id fails closed', { skip: !HAS_SQLITE }, () => {
  const { knowledgeRoot, src } = buildProject();
  const retriever = createProjectRetriever({
    knowledgeRoot,
    projectId: 'proj-ret',
    trustedRoots: [{ rootId: 'root-src', path: src }],
  });
  try {
    assert.throws(
      () => retriever.retrieve({ query: 'x', snapshotId: 'snap-does-not-exist' }),
      err => Boolean(err && err.reasonCode)
    );
  } finally {
    retriever.close();
  }
});
