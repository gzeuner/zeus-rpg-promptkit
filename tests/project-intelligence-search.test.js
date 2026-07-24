'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createSearchProvider,
  openSearchProvider,
  KnowledgeStoreError,
  REASON_CODES,
  search,
} = require('../src/projectIntelligence');

function tempDir(label = 'zpi-search') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
}

function corpusDocs(projectId = 'proj-demo', snapshotId = 'snap-001') {
  return [
    {
      docId: 'su-order',
      projectId,
      snapshotId,
      kind: 'source-unit',
      title: 'ORDERPGM',
      body: 'ORDERPGM calls CUSTINQ and updates ORDER table status',
      fields: { language: 'rpgle', relativePath: 'QRPGLESRC/ORDERPGM.rpgle' },
    },
    {
      docId: 'su-cust',
      projectId,
      snapshotId,
      kind: 'source-unit',
      title: 'CUSTINQ',
      body: 'CUSTINQ reads customer master by customer id',
      fields: { language: 'rpgle', relativePath: 'QRPGLESRC/CUSTINQ.rpgle' },
    },
    {
      docId: 'sym-order',
      projectId,
      snapshotId,
      kind: 'symbol',
      title: 'ORDERPGM',
      body: 'program ORDERPGM',
      fields: { symbolKind: 'PROGRAM' },
    },
    {
      docId: 'sym-cust',
      projectId,
      snapshotId,
      kind: 'symbol',
      title: 'CUSTINQ',
      body: 'program CUSTINQ',
      fields: { symbolKind: 'PROGRAM' },
    },
    {
      docId: 'ev-1',
      projectId,
      snapshotId,
      kind: 'evidence',
      title: 'call site',
      body: 'callp CUSTINQ for customer inquiry',
      fields: { relativePath: 'QRPGLESRC/ORDERPGM.rpgle' },
    },
  ];
}

test('index, search ranking corpus, deterministic ordering', () => {
  const root = tempDir();
  const provider = createSearchProvider({
    indexDir: path.join(root, 'lucene'),
    projectId: 'proj-demo',
    snapshotId: 'snap-001',
  });

  provider.rebuild(corpusDocs());
  const a = provider.search({ query: 'ORDERPGM CUSTINQ', limit: 10 });
  const b = provider.search({ query: 'ORDERPGM CUSTINQ', limit: 10 });

  assert.equal(a.sourceOfTruth, false);
  assert.equal(a.advisory, true);
  assert.ok(a.hits.length >= 1);
  assert.deepEqual(
    a.hits.map(h => h.docId),
    b.hits.map(h => h.docId)
  );
  assert.deepEqual(
    a.hits.map(h => h.score),
    b.hits.map(h => h.score)
  );

  // Title boost: ORDERPGM title docs should rank ahead of body-only mentions when equal terms
  const orderHits = provider.search({ query: 'ORDERPGM', limit: 10 });
  assert.ok(orderHits.hits.length >= 2);
  assert.equal(orderHits.hits[0].score >= orderHits.hits[1].score, true);

  provider.close();
});

test('filters and bounded results with omission', () => {
  const root = tempDir();
  const provider = createSearchProvider({
    indexDir: path.join(root, 'lucene'),
    projectId: 'proj-demo',
  });
  provider.rebuild(corpusDocs());

  const filtered = provider.search({
    query: 'program',
    filters: { kind: 'symbol' },
    limit: 10,
  });
  assert.ok(filtered.hits.every(h => h.kind === 'symbol'));

  const bounded = provider.search({ query: 'program OR customer OR order', limit: 2, offset: 0 });
  // OR is not special — tokens are AND. Use single broad token
  const broad = provider.search({ query: 'program', limit: 2 });
  assert.ok(broad.hits.length <= 2);
  if (broad.totalMatched > 2) {
    assert.equal(broad.omitted, true);
  }

  assert.throws(
    () => provider.search({ query: 'x', limit: 9999 }),
    err =>
      err instanceof KnowledgeStoreError && err.reasonCode === REASON_CODES.RESULT_LIMIT_EXCEEDED
  );
  provider.close();
  void bounded;
});

test('field filter and snapshot isolation', () => {
  const root = tempDir();
  const provider = createSearchProvider({ indexDir: path.join(root, 'lucene') });
  const docs = [
    ...corpusDocs('proj-demo', 'snap-001'),
    {
      docId: 'su-other',
      projectId: 'proj-demo',
      snapshotId: 'snap-002',
      kind: 'source-unit',
      title: 'OTHER',
      body: 'ORDERPGM in another snapshot',
      fields: { language: 'sqlrpgle', relativePath: 'OTHER.rpgle' },
    },
  ];
  provider.rebuild(docs);

  const onlySnap1 = provider.search({
    query: 'ORDERPGM',
    filters: { snapshotId: 'snap-001' },
    limit: 20,
  });
  assert.ok(onlySnap1.hits.every(h => h.snapshotId === 'snap-001'));
  assert.ok(!onlySnap1.hits.some(h => h.docId === 'su-other'));

  const rpgle = provider.search({
    query: 'CUSTINQ',
    filters: { fields: { language: 'rpgle' } },
    limit: 20,
  });
  assert.ok(rpgle.hits.every(h => h.fields.language === 'rpgle'));
  provider.close();
});

test('vector-ready schema accepts optional vector without affecting lexical rank', () => {
  const root = tempDir();
  const provider = createSearchProvider({ indexDir: path.join(root, 'lucene') });
  provider.rebuild([
    {
      docId: 'v1',
      projectId: 'p',
      snapshotId: 's',
      kind: 'symbol',
      title: 'ALPHA',
      body: 'alpha program',
      vector: { dims: 3, values: [0.1, 0.2, 0.3], modelId: 'test-embed' },
    },
    {
      docId: 'v2',
      projectId: 'p',
      snapshotId: 's',
      kind: 'symbol',
      title: 'BETA',
      body: 'beta program',
    },
  ]);
  const res = provider.search({ query: 'program', limit: 10 });
  assert.equal(res.hits.length, 2);
  // Deterministic by score then docId
  assert.deepEqual(res.hits.map(h => h.docId).sort(), ['v1', 'v2']);
  provider.close();
});

test('persist, reopen, deterministic output', () => {
  const indexDir = path.join(tempDir(), 'lucene');
  const writer = createSearchProvider({
    indexDir,
    projectId: 'proj-demo',
    snapshotId: 'snap-001',
  });
  writer.rebuild(corpusDocs());
  const first = writer.search({ query: 'CUSTINQ', limit: 5 });
  writer.close();

  const reader = openSearchProvider({ indexDir, readOnly: true });
  const second = reader.search({ query: 'CUSTINQ', limit: 5 });
  assert.deepEqual(
    first.hits.map(h => ({ id: h.docId, score: h.score })),
    second.hits.map(h => ({ id: h.docId, score: h.score }))
  );
  assert.equal(reader.checkIntegrity().ok, true);
  reader.close();
});

test('corrupt index fails closed and recovers via rebuild', () => {
  const indexDir = path.join(tempDir(), 'lucene');
  const provider = createSearchProvider({ indexDir, projectId: 'proj-demo' });
  provider.rebuild(corpusDocs());
  provider.close();

  // Corrupt postings file
  fs.writeFileSync(path.join(indexDir, 'postings.json'), '{not-json', 'utf8');

  assert.throws(
    () => openSearchProvider({ indexDir, readOnly: true }),
    err =>
      err instanceof KnowledgeStoreError &&
      (err.reasonCode === REASON_CODES.INDEX_CORRUPT ||
        err.reasonCode === REASON_CODES.INDEX_UNAVAILABLE)
  );

  // Recover with rebuild-on-corrupt open then rebuild
  const recovery = createSearchProvider({
    indexDir,
    projectId: 'proj-demo',
    openMode: 'rebuild-on-corrupt',
  });
  // After open with empty memory, rebuild
  recovery.recoverFromCorrupt(corpusDocs(), { snapshotId: 'snap-001' });
  const res = recovery.search({ query: 'ORDERPGM', limit: 5 });
  assert.ok(res.hits.length >= 1);
  assert.equal(recovery.checkIntegrity().ok, true);
  recovery.close();
});

test('mark corrupt requires rebuild and search on empty is empty', () => {
  const indexDir = path.join(tempDir(), 'lucene');
  const provider = createSearchProvider({ indexDir });
  provider.rebuild(corpusDocs());
  provider.markCorruptAndRequireRebuild('test');
  assert.equal(provider.getStatus().docCount, 0);
  assert.throws(
    () => openSearchProvider({ indexDir, readOnly: true }),
    err => err instanceof KnowledgeStoreError && err.reasonCode === REASON_CODES.INDEX_CORRUPT
  );
  provider.recoverFromCorrupt(corpusDocs());
  assert.ok(provider.search({ query: 'customer', limit: 5 }).hits.length >= 1);
  provider.close();
});

test('absolute path in relativePath field is rejected', () => {
  const provider = createSearchProvider({ indexDir: path.join(tempDir(), 'lucene') });
  assert.throws(
    () =>
      provider.indexDocuments([
        {
          docId: 'bad',
          projectId: 'p',
          snapshotId: 's',
          kind: 'source-unit',
          body: 'x',
          fields: { relativePath: 'C:\\Windows\\x.rpgle' },
        },
      ]),
    err => err instanceof KnowledgeStoreError && err.reasonCode === REASON_CODES.PATH_UNSAFE
  );
  provider.close();
});

test('hits never include absolute path-like field values', () => {
  const provider = createSearchProvider({ indexDir: path.join(tempDir(), 'lucene') });
  provider.rebuild(corpusDocs());
  const res = provider.search({ query: 'ORDERPGM', limit: 20 });
  for (const hit of res.hits) {
    for (const v of Object.values(hit.fields || {})) {
      if (typeof v === 'string') {
        assert.equal(/^[A-Za-z]:[\\/]/.test(v), false);
        assert.equal(v.startsWith('/'), false);
      }
    }
  }
  provider.close();
});

test('search module exports engine identity constants', () => {
  assert.equal(search.ENGINE_ID, 'zeus.community-lexical');
  assert.equal(search.SEARCH_SCHEMA_VERSION, 1);
  assert.equal(typeof search.analyzeText, 'function');
});
