'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createSnapshotEngine,
  openSnapshotEngine,
  planInventoryDiff,
  planInvalidation,
  buildSourceInventory,
  KnowledgeStoreError,
  REASON_CODES,
  probeNodeSqlite,
} = require('../src/projectIntelligence');

const HAS_SQLITE = probeNodeSqlite().available;

function tempDir(label = 'zpi-engine') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
}

function writeTree(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf8');
  }
}

function roots(srcDir) {
  return [{ rootId: 'root-src', path: srcDir }];
}

test('diff planner classifies add/change/delete/unchanged', () => {
  const prev = [
    {
      sourceUnitId: 'su:r:a.rpgle',
      trustedRootId: 'r',
      relativePath: 'a.rpgle',
      contentHash: 'a'.repeat(64),
      sizeBytes: 1,
    },
    {
      sourceUnitId: 'su:r:b.rpgle',
      trustedRootId: 'r',
      relativePath: 'b.rpgle',
      contentHash: 'b'.repeat(64),
      sizeBytes: 1,
    },
  ];
  const next = [
    {
      sourceUnitId: 'su:r:b.rpgle',
      trustedRootId: 'r',
      relativePath: 'b.rpgle',
      contentHash: 'c'.repeat(64),
      sizeBytes: 2,
    },
    {
      sourceUnitId: 'su:r:c.rpgle',
      trustedRootId: 'r',
      relativePath: 'c.rpgle',
      contentHash: 'd'.repeat(64),
      sizeBytes: 1,
    },
  ];
  const diff = planInventoryDiff(prev, next);
  assert.equal(diff.deleted.length, 1);
  assert.equal(diff.deleted[0].relativePath, 'a.rpgle');
  assert.equal(diff.changed.length, 1);
  assert.equal(diff.changed[0].next.relativePath, 'b.rpgle');
  assert.equal(diff.added.length, 1);
  assert.equal(diff.added[0].relativePath, 'c.rpgle');
  assert.equal(diff.unchanged.length, 0);
});

test('invalidation drops derived facts for changed sources and keeps endpoints-safe relationships', () => {
  const diff = planInventoryDiff(
    [
      {
        sourceUnitId: 'su:1',
        trustedRootId: 'r',
        relativePath: 'a.rpgle',
        contentHash: 'a'.repeat(64),
        sizeBytes: 1,
      },
      {
        sourceUnitId: 'su:2',
        trustedRootId: 'r',
        relativePath: 'b.rpgle',
        contentHash: 'b'.repeat(64),
        sizeBytes: 1,
      },
    ],
    [
      {
        sourceUnitId: 'su:1',
        trustedRootId: 'r',
        relativePath: 'a.rpgle',
        contentHash: 'z'.repeat(64),
        sizeBytes: 1,
      },
      {
        sourceUnitId: 'su:2',
        trustedRootId: 'r',
        relativePath: 'b.rpgle',
        contentHash: 'b'.repeat(64),
        sizeBytes: 1,
      },
    ]
  );
  const prev = {
    symbols: [
      { symbolId: 'sym:su:1', _sourceUnitId: 'su:1', provenance: { sourceUnitId: 'su:1' } },
      { symbolId: 'sym:su:2', _sourceUnitId: 'su:2', provenance: { sourceUnitId: 'su:2' } },
    ],
    relationships: [
      {
        relationshipId: 'rel:1',
        fromSymbolId: 'sym:su:1',
        toSymbolId: 'sym:su:2',
        provenance: { sourceUnitId: 'su:1' },
      },
      {
        relationshipId: 'rel:2',
        fromSymbolId: 'sym:su:2',
        toSymbolId: 'sym:su:2',
        provenance: { sourceUnitId: 'su:2' },
      },
    ],
    evidence: [
      { evidenceId: 'ev:1', sourceUnitId: 'su:1' },
      { evidenceId: 'ev:2', sourceUnitId: 'su:2' },
    ],
  };
  const plan = planInvalidation(diff, prev);
  assert.ok(plan.invalidatedSourceUnitIds.includes('su:1'));
  assert.equal(plan.kept.symbols.length, 1);
  assert.equal(plan.kept.symbols[0].symbolId, 'sym:su:2');
  assert.equal(plan.kept.evidence.length, 1);
  // rel:1 invalidated because from endpoint/source changed; rel:2 kept
  assert.equal(
    plan.kept.relationships.some(r => r.relationshipId === 'rel:2'),
    true
  );
  assert.equal(
    plan.kept.relationships.some(r => r.relationshipId === 'rel:1'),
    false
  );
});

test('full rebuild publishes current snapshot and serves inventory', { skip: !HAS_SQLITE }, () => {
  const root = tempDir();
  const src = path.join(root, 'src');
  const knowledgeRoot = path.join(root, 'pk');
  writeTree(src, {
    'ORDERPGM.rpgle': '**free\n// ORDERPGM calls CUSTINQ\n',
    'CUSTINQ.rpgle': '**free\n// CUSTINQ\n',
  });

  const engine = createSnapshotEngine({
    knowledgeRoot,
    projectId: 'proj-demo',
    trustedRoots: roots(src),
  });
  try {
    const result = engine.fullRebuild();
    assert.equal(result.ok, true);
    assert.equal(result.published, true);
    assert.equal(result.snapshot.status, 'published');
    assert.equal(result.counts.sourceUnits, 2);
    assert.ok(result.counts.symbols >= 2);

    const current = engine.getCurrentSnapshot();
    assert.equal(current.snapshotId, result.snapshot.snapshotId);
    engine.assertCurrentNotStale();
  } finally {
    engine.close();
  }
});

test('full vs incremental converge on same equality projection', { skip: !HAS_SQLITE }, () => {
  const mk = files => {
    const root = tempDir();
    const src = path.join(root, 'src');
    const knowledgeRoot = path.join(root, 'pk');
    writeTree(src, files);
    return { root, src, knowledgeRoot };
  };

  const finalFiles = {
    'ORDERPGM.rpgle': '**free\n// ORDERPGM calls CUSTINQ\n',
    'CUSTINQ.rpgle': '**free\n// CUSTINQ customer\n',
    'HELPER.rpgle': '**free\n// HELPER\n',
  };

  // Path A: full rebuild of final
  const a = mk(finalFiles);
  const engA = createSnapshotEngine({
    knowledgeRoot: a.knowledgeRoot,
    projectId: 'proj-demo',
    trustedRoots: roots(a.src),
  });
  engA.fullRebuild();
  const viewA = engA.projectEqualityView(engA.getCurrentSnapshot().snapshotId);
  engA.close();

  // Path B: full of subset, then incremental add HELPER
  const b = mk({
    'ORDERPGM.rpgle': finalFiles['ORDERPGM.rpgle'],
    'CUSTINQ.rpgle': finalFiles['CUSTINQ.rpgle'],
  });
  const engB = createSnapshotEngine({
    knowledgeRoot: b.knowledgeRoot,
    projectId: 'proj-demo',
    trustedRoots: roots(b.src),
  });
  engB.fullRebuild();
  writeTree(b.src, { 'HELPER.rpgle': finalFiles['HELPER.rpgle'] });
  const inc = engB.incrementalUpdate();
  assert.equal(inc.mode === 'incremental' || inc.mode === 'incremental-noop', true);
  assert.ok(inc.diff.counts.added >= 1);
  const viewB = engB.projectEqualityView(engB.getCurrentSnapshot().snapshotId);
  engB.close();

  assert.deepEqual(viewA.units, viewB.units);
  assert.deepEqual(viewA.symbols, viewB.symbols);
  assert.deepEqual(viewA.relationships, viewB.relationships);
});

test('stale snapshot refusal when sources change', { skip: !HAS_SQLITE }, () => {
  const root = tempDir();
  const src = path.join(root, 'src');
  const knowledgeRoot = path.join(root, 'pk');
  writeTree(src, { 'A.rpgle': '**free\n// A\n' });
  const engine = createSnapshotEngine({
    knowledgeRoot,
    projectId: 'proj-demo',
    trustedRoots: roots(src),
  });
  try {
    engine.fullRebuild();
    fs.writeFileSync(path.join(src, 'A.rpgle'), '**free\n// A changed\n', 'utf8');
    assert.throws(
      () => engine.assertCurrentNotStale(),
      err => err instanceof KnowledgeStoreError && err.reasonCode === REASON_CODES.SNAPSHOT_STALE
    );
  } finally {
    engine.close();
  }
});

test('parallel writer rejected', { skip: !HAS_SQLITE }, () => {
  const root = tempDir();
  const src = path.join(root, 'src');
  const knowledgeRoot = path.join(root, 'pk');
  writeTree(src, { 'A.rpgle': 'x\n' });
  const a = createSnapshotEngine({
    knowledgeRoot,
    projectId: 'proj-demo',
    trustedRoots: roots(src),
  });
  try {
    assert.throws(
      () =>
        openSnapshotEngine({
          knowledgeRoot,
          projectId: 'proj-demo',
          trustedRoots: roots(src),
          readOnly: false,
        }),
      err => err instanceof KnowledgeStoreError && err.reasonCode === REASON_CODES.WRITER_CONFLICT
    );
  } finally {
    a.close();
  }
});

test('transaction rollback keeps previous current pointer', { skip: !HAS_SQLITE }, () => {
  const root = tempDir();
  const src = path.join(root, 'src');
  const knowledgeRoot = path.join(root, 'pk');
  writeTree(src, { 'A.rpgle': '**free\n// A\n' });
  const engine = createSnapshotEngine({
    knowledgeRoot,
    projectId: 'proj-demo',
    trustedRoots: roots(src),
  });
  try {
    const first = engine.fullRebuild();
    const firstId = first.snapshot.snapshotId;

    // Force failure inside store transaction by sealing then trying write via put on closed path:
    // Simulate crash: throw from withTransaction after mutating by monkey-patching putSymbol
    const store = engine._store;
    const original = store.putSymbol;
    store.putSymbol = () => {
      throw new Error('simulated crash during publish');
    };
    writeTree(src, { 'B.rpgle': '**free\n// B\n' });
    assert.throws(
      () => engine.incrementalUpdate(),
      /simulated crash|publish failed|transaction failed/i
    );
    store.putSymbol = original;

    const current = engine.getCurrentSnapshot();
    assert.equal(current.snapshotId, firstId);
  } finally {
    engine.close();
  }
});

test('incremental no-op when sources unchanged', { skip: !HAS_SQLITE }, () => {
  const root = tempDir();
  const src = path.join(root, 'src');
  const knowledgeRoot = path.join(root, 'pk');
  writeTree(src, { 'A.rpgle': '**free\n// A\n' });
  const engine = createSnapshotEngine({
    knowledgeRoot,
    projectId: 'proj-demo',
    trustedRoots: roots(src),
  });
  try {
    engine.fullRebuild();
    const again = engine.incrementalUpdate();
    assert.ok(
      again.mode === 'incremental-noop' || again.mode === 'full-noop' || again.published === false
    );
  } finally {
    engine.close();
  }
});

test('buildSourceInventory is deterministic', () => {
  const root = tempDir();
  const src = path.join(root, 'src');
  writeTree(src, {
    'b/X.rpgle': 'one\r\n',
    'a/Y.rpgle': '\uFEFFtwo\n',
  });
  const a = buildSourceInventory({ trustedRoots: roots(src) });
  const b = buildSourceInventory({ trustedRoots: roots(src) });
  assert.equal(a.inventoryHash, b.inventoryHash);
  assert.equal(a.unitCount, 2);
  assert.deepEqual(
    a.units.map(u => u.relativePath),
    b.units.map(u => u.relativePath)
  );
});
