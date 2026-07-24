'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CONTENT_HASH_ALGORITHM, CONTENT_LAYOUT, DEFAULT_MAX_OBJECT_BYTES } = require('./constants');
const { sha256Hex, requireContentHash, contentObjectRelativePath } = require('./hash');
const { canonicalizeContent, canonicalizeRelativePath } = require('./normalize');
const { createTrustedRootRegistry } = require('./trustedRoots');
const { describeContentGarbageCollection, runContentGarbageCollection } = require('./gcDesign');
const { fail, REASON_CODES, KnowledgeStoreError } = require('../store/errors');
const { resolveKnowledgeRoot, knowledgePaths, ensureLayoutDirs } = require('../store/layout');

function ensureContentLayout(contentRoot) {
  const root = path.resolve(contentRoot);
  const objectsDir = path.join(root, CONTENT_LAYOUT.OBJECTS_DIR);
  const tmpDir = path.join(root, CONTENT_LAYOUT.TMP_DIR);
  fs.mkdirSync(objectsDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  return { root, objectsDir, tmpDir, manifest: path.join(root, CONTENT_LAYOUT.MANIFEST) };
}

function objectAbsolutePath(objectsDir, contentHash) {
  const rel = contentObjectRelativePath(contentHash);
  return path.join(objectsDir, ...rel.split('/'));
}

function writeFileAtomic(targetPath, bytes) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`);
  try {
    fs.writeFileSync(tmp, bytes);
    // Best-effort durability
    try {
      const fd = fs.openSync(tmp, 'r+');
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      // fsync may be unavailable on some FS; atomic rename still applies
    }
    fs.renameSync(tmp, targetPath);
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
    throw err;
  }
}

/**
 * Create or open a content-addressed store under a content directory.
 *
 * @param {object} options
 * @param {string} [options.contentDir] absolute/relative content directory
 * @param {string} [options.knowledgeRoot] project-knowledge root (uses layout.contentDir)
 * @param {Array<{rootId:string,path:string}>} [options.trustedRoots]
 * @param {boolean} [options.readOnly]
 * @param {number} [options.maxObjectBytes]
 */
function createContentStore(options = {}) {
  const readOnly = Boolean(options.readOnly);
  const maxObjectBytes =
    options.maxObjectBytes == null ? DEFAULT_MAX_OBJECT_BYTES : Number(options.maxObjectBytes);
  if (!Number.isInteger(maxObjectBytes) || maxObjectBytes < 1) {
    fail(REASON_CODES.SCHEMA_INVALID, 'maxObjectBytes must be a positive integer');
  }

  let contentRoot;
  if (options.contentDir) {
    contentRoot = path.resolve(options.contentDir);
  } else if (options.knowledgeRoot) {
    const paths = knowledgePaths(options.knowledgeRoot);
    contentRoot = paths.contentDir;
  } else {
    fail(REASON_CODES.PATH_UNSAFE, 'contentDir or knowledgeRoot is required');
  }

  if (!readOnly) {
    ensureContentLayout(contentRoot);
  } else if (!fs.existsSync(contentRoot)) {
    fail(REASON_CODES.CONTENT_NOT_FOUND, 'content store directory does not exist');
  }

  const layout = ensureContentLayout(contentRoot);
  const trustedRoots = createTrustedRootRegistry(options.trustedRoots || []);

  if (!readOnly) {
    const manifest = {
      schemaVersion: 1,
      kind: 'project-knowledge-content-manifest',
      hashAlgorithm: CONTENT_HASH_ALGORITHM,
      layout: {
        objects: CONTENT_LAYOUT.OBJECTS_DIR,
        tmp: CONTENT_LAYOUT.TMP_DIR,
      },
      updatedAt: new Date().toISOString(),
    };
    writeFileAtomic(layout.manifest, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'));
  }

  function assertWritable() {
    if (readOnly) {
      fail(REASON_CODES.STORE_UNAVAILABLE, 'content store is read-only');
    }
  }

  function has(contentHash) {
    const hash = requireContentHash(contentHash);
    return fs.existsSync(objectAbsolutePath(layout.objectsDir, hash));
  }

  function stat(contentHash) {
    const hash = requireContentHash(contentHash);
    const abs = objectAbsolutePath(layout.objectsDir, hash);
    if (!fs.existsSync(abs)) {
      fail(REASON_CODES.CONTENT_NOT_FOUND, 'content object was not found');
    }
    const st = fs.statSync(abs);
    return {
      contentHash: hash,
      sizeBytes: st.size,
      algorithm: CONTENT_HASH_ALGORITHM,
      path: abs,
    };
  }

  function getBytes(contentHash) {
    const hash = requireContentHash(contentHash);
    const abs = objectAbsolutePath(layout.objectsDir, hash);
    if (!fs.existsSync(abs)) {
      fail(REASON_CODES.CONTENT_NOT_FOUND, 'content object was not found');
    }
    const bytes = fs.readFileSync(abs);
    const actual = sha256Hex(bytes);
    if (actual !== hash) {
      fail(REASON_CODES.CONTENT_HASH_MISMATCH, 'stored content hash does not match payload');
    }
    return bytes;
  }

  /**
   * Verify object exists and hash matches bytes on disk.
   */
  function verify(contentHash) {
    try {
      const hash = requireContentHash(contentHash);
      const abs = objectAbsolutePath(layout.objectsDir, hash);
      if (!fs.existsSync(abs)) {
        return { ok: false, reasonCode: REASON_CODES.CONTENT_NOT_FOUND };
      }
      const bytes = fs.readFileSync(abs);
      const actual = sha256Hex(bytes);
      if (actual !== hash) {
        return { ok: false, reasonCode: REASON_CODES.CONTENT_HASH_MISMATCH };
      }
      return { ok: true, reasonCode: null, sizeBytes: bytes.length };
    } catch (err) {
      if (err instanceof KnowledgeStoreError) {
        return { ok: false, reasonCode: err.reasonCode };
      }
      return { ok: false, reasonCode: REASON_CODES.CONTENT_CORRUPT };
    }
  }

  /**
   * Put raw bytes/string after optional canonicalization.
   * Deduplicates by content hash (second put is a no-op write).
   */
  function put(input, putOptions = {}) {
    assertWritable();
    const mode = putOptions.mode === 'text' ? 'text' : 'binary';
    const { bytes, normalized } = canonicalizeContent(input, {
      mode,
      strictUtf8: putOptions.strictUtf8,
    });

    if (bytes.length > maxObjectBytes) {
      fail(REASON_CODES.SOURCE_TOO_LARGE, 'content object exceeds configured size limit', {
        sizeBytes: bytes.length,
        maxObjectBytes,
      });
    }

    const contentHash = sha256Hex(bytes);
    const target = objectAbsolutePath(layout.objectsDir, contentHash);

    if (fs.existsSync(target)) {
      // Deduplicate: verify existing object matches
      const existing = fs.readFileSync(target);
      const existingHash = sha256Hex(existing);
      if (existingHash !== contentHash) {
        fail(REASON_CODES.CONTENT_CORRUPT, 'existing content object failed hash verification');
      }
      return {
        contentHash,
        sizeBytes: existing.length,
        deduplicated: true,
        normalized,
        mode,
        algorithm: CONTENT_HASH_ALGORITHM,
      };
    }

    try {
      writeFileAtomic(target, bytes);
    } catch (err) {
      fail(REASON_CODES.CONTENT_CORRUPT, 'failed to write content object atomically', {
        message: err && err.message ? String(err.message) : undefined,
      });
    }

    // Post-write verify
    const check = verify(contentHash);
    if (!check.ok) {
      fail(
        check.reasonCode || REASON_CODES.CONTENT_HASH_MISMATCH,
        'post-write content verification failed'
      );
    }

    return {
      contentHash,
      sizeBytes: bytes.length,
      deduplicated: false,
      normalized,
      mode,
      algorithm: CONTENT_HASH_ALGORITHM,
    };
  }

  /**
   * Put a file under a trusted root (path-controlled ingestion).
   */
  function putFile(rootId, relativePath, putOptions = {}) {
    assertWritable();
    if (trustedRoots.size() === 0) {
      fail(REASON_CODES.UNTRUSTED_ROOT, 'no trusted roots configured for path ingestion');
    }
    const resolved = trustedRoots.resolveUnderRoot(rootId, relativePath);
    if (!fs.existsSync(resolved.realPath)) {
      fail(REASON_CODES.CONTENT_NOT_FOUND, 'source file was not found under trusted root');
    }
    let st;
    try {
      st = fs.lstatSync(resolved.absolutePath);
    } catch {
      st = fs.lstatSync(resolved.realPath);
    }
    if (st.isSymbolicLink()) {
      // Ensure real path still inside root (already checked); reject dangling weirdness
      if (!fs.statSync(resolved.realPath).isFile()) {
        fail(REASON_CODES.PATH_UNSAFE, 'source path must be a regular file');
      }
    } else if (!st.isFile()) {
      fail(REASON_CODES.PATH_UNSAFE, 'source path must be a regular file');
    }

    const bytes = fs.readFileSync(resolved.realPath);
    const mode =
      putOptions.mode === 'text' ? 'text' : putOptions.mode === 'binary' ? 'binary' : 'text';
    const result = put(bytes, { ...putOptions, mode });
    return {
      ...result,
      rootId,
      relativePath: resolved.relativePath,
    };
  }

  /**
   * Put from absolute path that must fall under trusted rootId.
   */
  function putAbsoluteFile(rootId, absolutePath, putOptions = {}) {
    assertWritable();
    if (trustedRoots.size() === 0) {
      fail(REASON_CODES.UNTRUSTED_ROOT, 'no trusted roots configured for path ingestion');
    }
    const resolved = trustedRoots.resolveAbsolute(rootId, absolutePath);
    if (!fs.existsSync(resolved.realPath) || !fs.statSync(resolved.realPath).isFile()) {
      fail(REASON_CODES.CONTENT_NOT_FOUND, 'source file was not found under trusted root');
    }
    const bytes = fs.readFileSync(resolved.realPath);
    const mode = putOptions.mode === 'binary' ? 'binary' : 'text';
    const result = put(bytes, { ...putOptions, mode });
    const rel =
      !resolved.relativePath || resolved.relativePath === '.'
        ? path.basename(resolved.realPath)
        : resolved.relativePath;
    return {
      ...result,
      rootId,
      relativePath: canonicalizeRelativePath(rel),
    };
  }

  function getStatus() {
    return {
      contentRoot: layout.root,
      readOnly,
      hashAlgorithm: CONTENT_HASH_ALGORITHM,
      maxObjectBytes,
      trustedRootCount: trustedRoots.size(),
      garbageCollection: describeContentGarbageCollection(),
    };
  }

  return {
    getStatus,
    has,
    stat,
    getBytes,
    verify,
    put,
    putFile,
    putAbsoluteFile,
    trustedRoots,
    // GC design only
    describeGarbageCollection: describeContentGarbageCollection,
    runGarbageCollection: runContentGarbageCollection,
    // paths for tests
    _layout: layout,
  };
}

/**
 * Open content store from a project-knowledge root using standard layout.
 */
function openContentStoreFromKnowledgeRoot(knowledgeRoot, options = {}) {
  const root = resolveKnowledgeRoot(knowledgeRoot);
  if (!options.readOnly) {
    ensureLayoutDirs(root);
  }
  return createContentStore({
    knowledgeRoot: root,
    trustedRoots: options.trustedRoots,
    readOnly: options.readOnly,
    maxObjectBytes: options.maxObjectBytes,
  });
}

module.exports = {
  createContentStore,
  openContentStoreFromKnowledgeRoot,
  ensureContentLayout,
  writeFileAtomic,
  objectAbsolutePath,
};
