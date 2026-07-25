'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createSnapshotEngine,
  createSearchProvider,
  exportPortableSnapshotPackage,
  openPortableSnapshotPackage,
  listCorpora,
  materializeCorpus,
  resolveEmbeddingPolicy,
  EMBEDDINGS_DEFAULT_ENABLED,
  PORTABLE_PACKAGE_SCHEMA,
  probeNodeSqlite,
} = require('../src/projectIntelligence');

const HAS_SQLITE = probeNodeSqlite().available;

function tempDir(label = 'zpi-c') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
}

test('embeddings are disabled by default and ranking never uses them', () => {
  assert.equal(EMBEDDINGS_DEFAULT_ENABLED, false);
  const policy = resolveEmbeddingPolicy({});
  assert.equal(policy.enabled, false);
  assert.equal(policy.useForRanking, false);

  const enabled = resolveEmbeddingPolicy({ enableEmbeddings: true });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.useForRanking, false);

  const index = createSearchProvider({
    indexDir: path.join(tempDir('emb'), 'lucene'),
    projectId: 'p1',
    snapshotId: 's1',
  });
  assert.equal(index.embeddingPolicy.enabled, false);
  index.indexDocuments([
    {
      docId: 'd1',
      projectId: 'p1',
      snapshotId: 's1',
      kind: 'source-unit',
      title: 'ORDERPGM',
      body: 'order validate write',
      vector: { dims: 2, values: [0.1, 0.9], modelId: 'test' },
    },
  ]);
  const hits = index.search({ query: 'order' });
  assert.ok(hits.hits.length >= 1);
  // stored document should not retain vector when embeddings default off
  const serialized = index._index.serialize();
  const doc = serialized.docs.find(d => d.docId === 'd1');
  assert.ok(doc);
  assert.equal(doc.vector == null || doc.vector === null, true);
  index.close();
});

test('listCorpora and materialize mini multi-program corpus', () => {
  const listed = listCorpora();
  assert.ok(listed.some(c => c.id === 'mini-multi-program-rpg'));
  const root = tempDir('corpus');
  const result = materializeCorpus('mini-multi-program-rpg', root);
  assert.equal(result.fileCount, 6);
  assert.ok(fs.existsSync(path.join(result.root, 'QRPGLESRC', 'ORDERPGM.rpgle')));
  assert.ok(fs.existsSync(path.join(result.root, 'QSQLSRC', 'ORDERHDR.sql')));
});

test('portable snapshot export package is redacted and openable', { skip: !HAS_SQLITE }, () => {
  const root = tempDir('export');
  const src = path.join(root, 'src');
  const knowledgeRoot = path.join(root, 'pk');
  const exportDir = path.join(root, 'portable');
  materializeCorpus('mini-multi-program-rpg', src);

  const engine = createSnapshotEngine({
    knowledgeRoot,
    projectId: 'export-demo',
    displayName: 'Export demo',
    trustedRoots: [{ rootId: 'src', path: src }],
  });
  const rebuild = engine.fullRebuild();
  assert.equal(rebuild.published, true);
  const snapshotId = rebuild.snapshot.snapshotId;
  engine.close();

  const exported = exportPortableSnapshotPackage({
    knowledgeRoot,
    projectId: 'export-demo',
    outputDir: exportDir,
    trustedRoots: [{ rootId: 'src', path: src }],
  });
  assert.equal(exported.ok, true);
  assert.equal(exported.schema, PORTABLE_PACKAGE_SCHEMA);
  assert.equal(exported.snapshotId, snapshotId);
  assert.ok(exported.counts.sourceUnits >= 1);
  assert.equal(exported.embeddings.included, false);
  assert.equal(exported.embeddings.useForRanking, false);
  const leak = JSON.stringify(exported);
  assert.equal(/[A-Za-z]:\\/.test(leak), false);
  assert.equal(/\/Users\//.test(leak), false);

  const opened = openPortableSnapshotPackage({ packageDir: exportDir });
  assert.equal(opened.ok, true);
  assert.equal(opened.projectId, 'export-demo');
  assert.equal(opened.snapshotId, snapshotId);
  assert.ok(opened.equalityView.units.length >= 1);
  assert.equal(opened.sourceOfTruth, false);
  assert.equal(JSON.stringify(opened).includes(src), false);
});

test('portable export fails closed when knowledge root missing', { skip: !HAS_SQLITE }, () => {
  assert.throws(
    () =>
      exportPortableSnapshotPackage({
        knowledgeRoot: path.join(tempDir('missing'), 'nope'),
        projectId: 'x',
        outputDir: path.join(tempDir('out'), 'pkg'),
      }),
    err => Boolean(err && (err.reasonCode || err.message))
  );
});
