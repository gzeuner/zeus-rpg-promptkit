'use strict';

/**
 * ZPI-12 Project Intelligence benchmarks (evidence, not production claims).
 * Measures synthetic local corpus indexing / incremental / retrieval cost.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createSnapshotEngine,
  createProjectRetriever,
  probeNodeSqlite,
} = require('../src/projectIntelligence');
const { estimateTokens } = require('../src/ai/tokenEstimator');

const HAS_SQLITE = probeNodeSqlite().available;
const FILE_COUNT = 40;

function tempDir(label = 'zpi-bench') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
}

function writeCorpus(srcDir, count) {
  fs.mkdirSync(srcDir, { recursive: true });
  for (let i = 0; i < count; i += 1) {
    const name = i === 0 ? 'ROOTPGM' : `MOD${String(i).padStart(3, '0')}`;
    const next = i < count - 1 ? `MOD${String(i + 1).padStart(3, '0')}` : null;
    const body = [
      '**free',
      `// ${name} synthetic benchmark unit`,
      next ? `// calls ${next}` : '// leaf',
      `dcl-s work${i} char(10);`,
      '',
    ].join('\n');
    fs.writeFileSync(path.join(srcDir, `${name}.rpgle`), body, 'utf8');
  }
}

function dirSizeBytes(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const p = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else total += fs.statSync(p).size;
    }
  }
  return total;
}

function equalityView(engine) {
  return engine.projectEqualityView(engine.getCurrentSnapshot().snapshotId);
}

test(
  'ZPI benchmark: full rebuild, incremental, retrieval, equality (evidence)',
  { skip: !HAS_SQLITE },
  () => {
    const root = tempDir();
    const src = path.join(root, 'src');
    const knowledgeRoot = path.join(root, 'pk');
    writeCorpus(src, FILE_COUNT);
    const trustedRoots = [{ rootId: 'root-src', path: src }];
    const projectId = 'zpi-bench';

    const metrics = {
      fileCount: FILE_COUNT,
      fullRebuildMs: null,
      incrementalMs: null,
      queryMs: null,
      contextMs: null,
      sourceUnits: null,
      symbols: null,
      storeBytes: null,
      searchBytes: null,
      contentBytes: null,
      totalMatched: null,
      fullSourceTokens: null,
      contextUsedTokens: null,
      estimatedTokenSavingsPercent: null,
      fullVsIncrementalEqual: false,
    };

    try {
      const engine = createSnapshotEngine({
        knowledgeRoot,
        projectId,
        trustedRoots,
      });
      try {
        const t0 = Date.now();
        const full = engine.fullRebuild();
        metrics.fullRebuildMs = Date.now() - t0;
        assert.equal(full.published, true);
        assert.equal(full.counts.sourceUnits, FILE_COUNT);
        metrics.sourceUnits = full.counts.sourceUnits;
        metrics.symbols = full.counts.symbols;
        assert.ok(metrics.symbols >= FILE_COUNT);

        // Bound: synthetic 40-file corpus must stay interactive locally (evidence threshold).
        assert.ok(
          metrics.fullRebuildMs < 60_000,
          `full rebuild too slow for synthetic corpus: ${metrics.fullRebuildMs}ms`
        );

        const viewFull = equalityView(engine);

        // Touch one leaf file for incremental
        const leaf = path.join(src, `MOD${String(FILE_COUNT - 1).padStart(3, '0')}.rpgle`);
        fs.writeFileSync(leaf, '**free\n// leaf updated for incremental\n', 'utf8');
        const t1 = Date.now();
        const incr = engine.incrementalUpdate();
        metrics.incrementalMs = Date.now() - t1;
        assert.ok(
          incr.published || incr.mode === 'incremental-noop' || incr.mode === 'incremental'
        );
        assert.ok(
          metrics.incrementalMs < 60_000,
          `incremental too slow: ${metrics.incrementalMs}ms`
        );

        // Equality path: second project full rebuild of final tree
        const rootB = tempDir('zpi-bench-eq');
        const srcB = path.join(rootB, 'src');
        const pkB = path.join(rootB, 'pk');
        // copy final tree
        fs.cpSync(src, srcB, { recursive: true });
        const engB = createSnapshotEngine({
          knowledgeRoot: pkB,
          projectId,
          trustedRoots: [{ rootId: 'root-src', path: srcB }],
        });
        try {
          engB.fullRebuild();
          const viewIncr = equalityView(engine);
          const viewB = equalityView(engB);
          assert.deepEqual(viewIncr.units, viewB.units);
          assert.deepEqual(viewIncr.symbols, viewB.symbols);
          metrics.fullVsIncrementalEqual = true;
          // full path from first full should differ only by the leaf change from original full
          assert.notDeepEqual(viewFull.units, viewIncr.units);
        } finally {
          engB.close();
          fs.rmSync(rootB, { recursive: true, force: true });
        }
      } finally {
        engine.close();
      }

      metrics.storeBytes =
        dirSizeBytes(path.join(knowledgeRoot, 'store')) || dirSizeBytes(knowledgeRoot);
      metrics.searchBytes = dirSizeBytes(path.join(knowledgeRoot, 'lucene'));
      metrics.contentBytes = dirSizeBytes(path.join(knowledgeRoot, 'content'));
      assert.ok(metrics.storeBytes > 0 || dirSizeBytes(knowledgeRoot) > 0);
      assert.ok(metrics.searchBytes >= 0);

      const retriever = createProjectRetriever({
        knowledgeRoot,
        projectId,
        trustedRoots,
        readOnly: true,
      });
      try {
        const fullSourceText = fs
          .readdirSync(src)
          .filter(name => name.endsWith('.rpgle'))
          .sort()
          .map(name => fs.readFileSync(path.join(src, name), 'utf8'))
          .join('\n');
        metrics.fullSourceTokens = estimateTokens(fullSourceText);

        const tq = Date.now();
        const hits = retriever.retrieve({ query: 'ROOTPGM', limit: 20 });
        metrics.queryMs = Date.now() - tq;
        metrics.totalMatched = hits.totalMatched;
        assert.ok(Array.isArray(hits.hits));
        assert.ok(
          hits.hits.some(
            h =>
              String(h.docId || '').includes('ROOTPGM') ||
              String(h.title || h.text || '').includes('ROOTPGM') ||
              String(h.snippet || '').includes('ROOTPGM')
          ) || hits.totalMatched > 0,
          'expected retrieval to find ROOTPGM evidence'
        );
        assert.ok(metrics.queryMs < 15_000, `query too slow: ${metrics.queryMs}ms`);

        const tc = Date.now();
        const ctx = retriever.buildContextPackage({
          query: 'ROOTPGM',
          tokenBudget: 2000,
          expandHops: 1,
        });
        metrics.contextMs = Date.now() - tc;
        assert.ok(ctx.contextPackage);
        metrics.contextUsedTokens = ctx.metrics.usedTokens;
        metrics.estimatedTokenSavingsPercent =
          metrics.fullSourceTokens > 0
            ? Math.round((1 - metrics.contextUsedTokens / metrics.fullSourceTokens) * 1000) / 10
            : 0;
        assert.ok(
          metrics.contextUsedTokens <= 2000,
          `context package exceeded token budget: ${metrics.contextUsedTokens}`
        );
        assert.ok(
          metrics.contextUsedTokens < metrics.fullSourceTokens,
          `context package did not reduce the synthetic source context: ${metrics.contextUsedTokens} >= ${metrics.fullSourceTokens}`
        );
        assert.ok(metrics.contextMs < 15_000, `context assembly too slow: ${metrics.contextMs}ms`);
      } finally {
        retriever.close();
      }

      // Evidence log for closure reports (not a production SLA)
      process.stdout.write(
        `ZPI-12 benchmark metrics (evidence only): ${JSON.stringify(metrics, null, 2)}\n`
      );

      assert.equal(metrics.fullVsIncrementalEqual, true);
      assert.ok(Number.isFinite(metrics.fullRebuildMs));
      assert.ok(Number.isFinite(metrics.incrementalMs));
      assert.ok(Number.isFinite(metrics.queryMs));
      assert.ok(Number.isFinite(metrics.fullSourceTokens));
      assert.ok(Number.isFinite(metrics.contextUsedTokens));
      assert.ok(Number.isFinite(metrics.estimatedTokenSavingsPercent));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
);
