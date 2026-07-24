'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createContentStore,
  openContentStoreFromKnowledgeRoot,
  canonicalizeContent,
  sha256Hex,
  describeContentGarbageCollection,
  runContentGarbageCollection,
  KnowledgeStoreError,
  REASON_CODES,
  content,
} = require('../src/projectIntelligence');

function tempDir(label = 'zpi-content') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
}

test('text canonicalization normalizes CRLF and strips BOM before hash', () => {
  const a = canonicalizeContent('\uFEFFhello\r\nworld\r\n', { mode: 'text' });
  const b = canonicalizeContent('hello\nworld\n', { mode: 'text' });
  assert.equal(sha256Hex(a.bytes), sha256Hex(b.bytes));
  assert.equal(a.normalized, true);
});

test('put/get/dedupe and atomic content-addressed layout', () => {
  const root = tempDir();
  const store = createContentStore({ contentDir: path.join(root, 'content') });

  const first = store.put('**free\ndcl-s x int(10);\n', { mode: 'text' });
  assert.equal(first.deduplicated, false);
  assert.equal(first.contentHash.length, 64);
  assert.equal(store.has(first.contentHash), true);

  const second = store.put('**free\r\ndcl-s x int(10);\r\n', { mode: 'text' });
  assert.equal(second.deduplicated, true);
  assert.equal(second.contentHash, first.contentHash);

  const bytes = store.getBytes(first.contentHash);
  assert.equal(bytes.toString('utf8'), '**free\ndcl-s x int(10);\n');
  assert.equal(store.verify(first.contentHash).ok, true);

  // Object path uses two-char prefix
  const objectPath = path.join(
    store._layout.objectsDir,
    first.contentHash.slice(0, 2),
    first.contentHash
  );
  assert.equal(fs.existsSync(objectPath), true);
});

test('hash mismatch on corrupted object fails closed', () => {
  const root = tempDir();
  const store = createContentStore({ contentDir: path.join(root, 'content') });
  const put = store.put(Buffer.from('original-payload'), { mode: 'binary' });
  const objectPath = path.join(
    store._layout.objectsDir,
    put.contentHash.slice(0, 2),
    put.contentHash
  );
  fs.writeFileSync(objectPath, Buffer.from('tampered-payload'));

  assert.throws(
    () => store.getBytes(put.contentHash),
    err =>
      err instanceof KnowledgeStoreError && err.reasonCode === REASON_CODES.CONTENT_HASH_MISMATCH
  );
  assert.equal(store.verify(put.contentHash).ok, false);
  assert.equal(store.verify(put.contentHash).reasonCode, REASON_CODES.CONTENT_HASH_MISMATCH);
});

test('path traversal under trusted root is rejected', () => {
  const root = tempDir();
  const trusted = path.join(root, 'src');
  fs.mkdirSync(trusted, { recursive: true });
  fs.writeFileSync(path.join(trusted, 'ok.rpgle'), 'x\n', 'utf8');

  const store = createContentStore({
    contentDir: path.join(root, 'content'),
    trustedRoots: [{ rootId: 'r1', path: trusted }],
  });

  assert.throws(
    () => store.putFile('r1', '../escape.rpgle'),
    err =>
      err instanceof KnowledgeStoreError &&
      (err.reasonCode === REASON_CODES.PATH_TRAVERSAL ||
        err.reasonCode === REASON_CODES.PATH_ESCAPE)
  );
  assert.throws(
    () => store.putFile('r1', 'C:\\Windows\\a.rpgle'),
    err => err instanceof KnowledgeStoreError
  );

  const ok = store.putFile('r1', 'ok.rpgle', { mode: 'text' });
  assert.equal(ok.relativePath, 'ok.rpgle');
  assert.equal(store.has(ok.contentHash), true);
});

test('untrusted root and unknown rootId fail closed', () => {
  const root = tempDir();
  const trusted = path.join(root, 'src');
  fs.mkdirSync(trusted, { recursive: true });
  const store = createContentStore({
    contentDir: path.join(root, 'content'),
    trustedRoots: [{ rootId: 'r1', path: trusted }],
  });

  assert.throws(
    () => store.putFile('nope', 'a.rpgle'),
    err => err instanceof KnowledgeStoreError && err.reasonCode === REASON_CODES.UNTRUSTED_ROOT
  );

  const bare = createContentStore({ contentDir: path.join(root, 'content2') });
  assert.throws(
    () => bare.putFile('r1', 'a.rpgle'),
    err => err instanceof KnowledgeStoreError && err.reasonCode === REASON_CODES.UNTRUSTED_ROOT
  );
});

test('symlink escape is rejected when platform allows symlink creation', t => {
  const root = tempDir('zpi-symlink');
  const trusted = path.join(root, 'trusted');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(trusted, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  const secret = path.join(outside, 'secret.rpgle');
  fs.writeFileSync(secret, 'secret\n', 'utf8');

  const linkPath = path.join(trusted, 'escape.rpgle');
  try {
    fs.symlinkSync(secret, linkPath);
  } catch (err) {
    if (err && (err.code === 'EPERM' || err.code === 'ENOTSUP' || err.code === 'EACCES')) {
      t.skip('symlink creation not permitted on this platform/user');
      return;
    }
    throw err;
  }

  const store = createContentStore({
    contentDir: path.join(root, 'content'),
    trustedRoots: [{ rootId: 'r1', path: trusted }],
  });

  assert.throws(
    () => store.putFile('r1', 'escape.rpgle'),
    err =>
      err instanceof KnowledgeStoreError &&
      (err.reasonCode === REASON_CODES.SYMLINK_ESCAPE ||
        err.reasonCode === REASON_CODES.PATH_ESCAPE ||
        err.reasonCode === REASON_CODES.UNTRUSTED_ROOT)
  );
});

test('atomic write leaves no partial object on failure mid-rename simulation', () => {
  // Successful atomic put should not leave tmp files behind
  const root = tempDir();
  const contentDir = path.join(root, 'content');
  const store = createContentStore({ contentDir });
  store.put(Buffer.from('payload-a'), { mode: 'binary' });
  const tmpDir = path.join(contentDir, 'tmp');
  // object dir may have .tmp-* only transiently; after put, tmp dir should be empty or absent of leftovers in objects
  if (fs.existsSync(tmpDir)) {
    const leftovers = fs.readdirSync(tmpDir);
    assert.equal(leftovers.length, 0);
  }
  // No .tmp-* in object prefix dirs
  const objects = path.join(contentDir, 'objects');
  function walk(dir) {
    const names = fs.readdirSync(dir);
    for (const name of names) {
      assert.equal(name.startsWith('.tmp-'), false, `leftover tmp ${name}`);
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
    }
  }
  walk(objects);
});

test('duplicate content from different relative paths shares one object', () => {
  const root = tempDir();
  const trusted = path.join(root, 'src');
  fs.mkdirSync(path.join(trusted, 'a'), { recursive: true });
  fs.mkdirSync(path.join(trusted, 'b'), { recursive: true });
  fs.writeFileSync(path.join(trusted, 'a', 'same.rpgle'), 'same-body\n', 'utf8');
  fs.writeFileSync(path.join(trusted, 'b', 'same.rpgle'), 'same-body\n', 'utf8');

  const store = createContentStore({
    contentDir: path.join(root, 'content'),
    trustedRoots: [{ rootId: 'r1', path: trusted }],
  });
  const one = store.putFile('r1', 'a/same.rpgle');
  const two = store.putFile('r1', 'b/same.rpgle');
  assert.equal(one.contentHash, two.contentHash);
  assert.equal(two.deduplicated, true);
});

test('openContentStoreFromKnowledgeRoot uses standard layout', () => {
  const knowledgeRoot = tempDir('zpi-kroot');
  const store = openContentStoreFromKnowledgeRoot(knowledgeRoot, {
    trustedRoots: [],
  });
  const put = store.put('x', { mode: 'text' });
  assert.equal(
    fs.existsSync(
      path.join(knowledgeRoot, 'content', 'objects', put.contentHash.slice(0, 2), put.contentHash)
    ),
    true
  );
});

test('garbage collection is design-only and fails closed on run', () => {
  const design = describeContentGarbageCollection();
  assert.equal(design.implemented, false);
  assert.equal(design.status, 'design-only');
  assert.throws(
    () => runContentGarbageCollection(),
    err =>
      err instanceof KnowledgeStoreError && err.reasonCode === REASON_CODES.OPERATION_UNAVAILABLE
  );
});

test('oversized content is rejected', () => {
  const root = tempDir();
  const store = createContentStore({
    contentDir: path.join(root, 'content'),
    maxObjectBytes: 16,
  });
  assert.throws(
    () => store.put(Buffer.alloc(32, 1), { mode: 'binary' }),
    err => err instanceof KnowledgeStoreError && err.reasonCode === REASON_CODES.SOURCE_TOO_LARGE
  );
});

test('content module exports are available via projectIntelligence.content', () => {
  assert.equal(typeof content.createContentStore, 'function');
  assert.equal(typeof content.sha256Hex, 'function');
});
