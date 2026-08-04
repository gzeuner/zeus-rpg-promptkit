'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createSnapshotEngine,
  createProjectRetriever,
  materializeCorpus,
  probeNodeSqlite,
} = require('../src/projectIntelligence');

const HAS_SQLITE = probeNodeSqlite().available;
const CORPUS_ID = 'mini-multi-program-rpg';
const PROJECT_ID = 'multi-program-recall';
const BUDGETS = [800, 2000];

const GOLDEN_CASES = [
  { query: 'ValidateOrder', expectedSources: ['ORDERPGM.rpgle', 'VALIDATE.rpgle'] },
  { query: 'ORDERHDR', expectedSources: ['ORDERHDR.sql', 'WRITEORD.rpgle'] },
  { query: 'LoadCustomer', expectedSources: ['CUSTINQ.rpgle', 'LOADCUST.rpgle'] },
];

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
}

function packageIds(packageResult) {
  return packageResult.contextPackage.selected.map(item => item.id);
}

function packageEvidence(packageResult) {
  return packageResult.contextPackage.evidenceReferences.map(item => item.id);
}

function containsSource(ids, fileName) {
  return ids.some(id => String(id).includes(fileName));
}

test(
  'multi-program corpus preserves cross-program source recall under bounded budgets',
  { skip: !HAS_SQLITE },
  () => {
    const root = tempDir('zpi-multi-recall');
    const sourceRoot = path.join(root, 'src');
    const knowledgeRoot = path.join(root, 'knowledge');
    materializeCorpus(CORPUS_ID, sourceRoot);

    const trustedRoots = [{ rootId: 'synthetic-src', path: sourceRoot }];
    const engine = createSnapshotEngine({
      knowledgeRoot,
      projectId: PROJECT_ID,
      trustedRoots,
    });

    try {
      const rebuild = engine.fullRebuild();
      assert.equal(rebuild.published, true);
      assert.equal(rebuild.counts.sourceUnits, 6);
    } finally {
      engine.close();
    }

    const retriever = createProjectRetriever({
      knowledgeRoot,
      projectId: PROJECT_ID,
      trustedRoots,
    });

    try {
      for (const golden of GOLDEN_CASES) {
        const retrieval = retriever.retrieve({ query: golden.query, limit: 10 });
        assert.ok(retrieval.hits.length > 0, `expected hits for ${golden.query}`);

        for (const budget of BUDGETS) {
          const assembled = retriever.buildContextPackage({
            query: golden.query,
            tokenBudget: budget,
            expandHops: 1,
          });
          const selected = packageIds(assembled);
          const evidence = packageEvidence(assembled);
          const available = [...selected, ...evidence];

          assert.ok(assembled.metrics.usedTokens <= budget);
          for (const source of golden.expectedSources) {
            assert.ok(
              containsSource(available, source),
              `${golden.query} at ${budget} tokens omitted expected source ${source}`
            );
          }
        }
      }
    } finally {
      retriever.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
);

test(
  'multi-program context packages remain deterministic across repeated assembly',
  { skip: !HAS_SQLITE },
  () => {
    const root = tempDir('zpi-multi-determinism');
    const sourceRoot = path.join(root, 'src');
    const knowledgeRoot = path.join(root, 'knowledge');
    materializeCorpus(CORPUS_ID, sourceRoot);

    const trustedRoots = [{ rootId: 'synthetic-src', path: sourceRoot }];
    const engine = createSnapshotEngine({
      knowledgeRoot,
      projectId: PROJECT_ID,
      trustedRoots,
    });
    engine.fullRebuild();
    engine.close();

    const retriever = createProjectRetriever({
      knowledgeRoot,
      projectId: PROJECT_ID,
      trustedRoots,
    });

    try {
      const first = retriever.buildContextPackage({
        query: 'ORDERHDR',
        tokenBudget: 800,
        expandHops: 1,
      });
      const second = retriever.buildContextPackage({
        query: 'ORDERHDR',
        tokenBudget: 800,
        expandHops: 1,
      });

      assert.equal(first.contextPackage.packageId, second.contextPackage.packageId);
      assert.deepEqual(packageIds(first), packageIds(second));
      assert.deepEqual(first.contextPackage.omissions, second.contextPackage.omissions);
      assert.deepEqual(packageEvidence(first), packageEvidence(second));
    } finally {
      retriever.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
);
