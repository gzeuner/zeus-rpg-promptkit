'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createProjectRetriever,
  createSnapshotEngine,
  probeNodeSqlite,
} = require('../src/projectIntelligence');

const HAS_SQLITE = probeNodeSqlite().available;
const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'v1-smoke', 'src');
const GOLDEN_CASES = [
  { query: 'ORDER_ID CUSTOMER_ID', source: 'ORDERPGM.rpgle' },
  { query: 'STATUS INVOICE', source: 'INVPGM.rpgle' },
  { query: 'ORDERS', topHit: 'ORDERS', source: 'ORDERPGM.rpgle' },
];
const RECALL_BUDGETS = [800, 2000];
const TIGHT_BUDGET = 400;

function buildGoldenProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zpi-retrieval-quality-'));
  const src = path.join(root, 'src');
  const knowledgeRoot = path.join(root, 'pk');
  fs.mkdirSync(src, { recursive: true });
  for (const name of ['ORDERPGM.rpgle', 'INVPGM.rpgle']) {
    fs.copyFileSync(path.join(FIXTURE_ROOT, name), path.join(src, name));
  }
  const engine = createSnapshotEngine({
    knowledgeRoot,
    projectId: 'zpi-quality-golden',
    trustedRoots: [{ rootId: 'golden-src', path: src }],
  });
  const rebuild = engine.fullRebuild();
  engine.close();
  assert.equal(rebuild.published, true);
  return { root, src, knowledgeRoot };
}

function createRetriever(project) {
  return createProjectRetriever({
    knowledgeRoot: project.knowledgeRoot,
    projectId: 'zpi-quality-golden',
    trustedRoots: [{ rootId: 'golden-src', path: project.src }],
    readOnly: true,
  });
}

function selectedContainsSource(contextPackage, sourceName) {
  return contextPackage.selected.some(entry => entry.id.includes(sourceName));
}

test(
  'retrieval quality gate: golden queries recall the expected source at bounded budgets',
  { skip: !HAS_SQLITE },
  () => {
    const project = buildGoldenProject();
    const retriever = createRetriever(project);
    try {
      for (const golden of GOLDEN_CASES) {
        const lexical = retriever.retrieve({ query: golden.query, limit: 10 });
        assert.ok(lexical.hits.length > 0, `no hits for golden query: ${golden.query}`);
        assert.equal(
          lexical.hits[0].title,
          golden.topHit || golden.source,
          `unstable or unexpected top hit for ${golden.query}`
        );

        for (const tokenBudget of RECALL_BUDGETS) {
          const result = retriever.buildContextPackage({
            query: golden.query,
            tokenBudget,
            expandHops: 1,
            includeBodies: true,
            limit: 10,
          });
          assert.equal(result.ok, true);
          assert.ok(result.metrics.usedTokens <= tokenBudget);
          assert.equal(
            selectedContainsSource(result.contextPackage, golden.source),
            true,
            `context recall lost ${golden.source} for ${golden.query} at ${tokenBudget} tokens`
          );
          assert.ok(
            result.contextPackage.evidenceReferences.some(reference =>
              reference.id.includes(golden.source)
            ),
            `missing evidence reference for ${golden.source} at ${tokenBudget} tokens`
          );
        }
      }
    } finally {
      retriever.close();
      fs.rmSync(project.root, { recursive: true, force: true });
    }
  }
);

test(
  'retrieval quality gate: tight budgets omit relevant sources explicitly and deterministically',
  { skip: !HAS_SQLITE },
  () => {
    const project = buildGoldenProject();
    const retriever = createRetriever(project);
    try {
      const first = retriever.buildContextPackage({
        query: 'ORDER_ID CUSTOMER_ID',
        tokenBudget: TIGHT_BUDGET,
        expandHops: 1,
        includeBodies: true,
        limit: 10,
      });
      const second = retriever.buildContextPackage({
        query: 'ORDER_ID CUSTOMER_ID',
        tokenBudget: TIGHT_BUDGET,
        expandHops: 1,
        includeBodies: true,
        limit: 10,
      });

      assert.equal(first.ok, true);
      assert.equal(first.metrics.usedTokens <= TIGHT_BUDGET, true);
      assert.equal(selectedContainsSource(first.contextPackage, 'ORDERPGM.rpgle'), false);
      const sourceOmission = first.contextPackage.omissions.find(omission =>
        omission.entityId.includes('ORDERPGM.rpgle')
      );
      assert.ok(sourceOmission, 'expected a deterministic omission for the relevant source');
      assert.equal(sourceOmission.reasonCode, 'ZPI.TOKEN_BUDGET_EXCEEDED');
      assert.deepEqual(first.contextPackage.omissions, second.contextPackage.omissions);
      assert.deepEqual(first.contextPackage.selected, second.contextPackage.selected);
      assert.equal(first.contextPackage.packageId, second.contextPackage.packageId);
    } finally {
      retriever.close();
      fs.rmSync(project.root, { recursive: true, force: true });
    }
  }
);
