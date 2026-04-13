/*
Copyright 2026 Guido Zeuner

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { version: toolVersion } = require('../../package.json');

const DEFAULT_CACHE_NAMESPACE = 'source-scans';

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function hashFileContent(filePath) {
  return hashContent(fs.readFileSync(filePath));
}

function buildCacheKey(filePath, options) {
  const absolutePath = path.resolve(String(filePath || ''));
  const stats = fs.statSync(absolutePath);
  const contentHash = hashFileContent(absolutePath);
  const version = String(options && options.toolVersion ? options.toolVersion : toolVersion || '0').trim();
  return {
    absolutePath,
    contentHash,
    fingerprint: `${version}:${contentHash}`,
    sizeBytes: stats.size,
    mtimeMs: Math.trunc(stats.mtimeMs),
    toolVersion: version,
  };
}

function resolveCacheFile(cacheDir, fingerprint) {
  return path.join(cacheDir, `${fingerprint}.json`);
}

function ensureCacheDir(cacheDir) {
  if (!cacheDir) {
    return;
  }
  fs.mkdirSync(cacheDir, { recursive: true });
}

function readPersistentEntry(cacheDir, fingerprint) {
  if (!cacheDir) {
    return null;
  }
  const cacheFile = resolveCacheFile(cacheDir, fingerprint);
  if (!fs.existsSync(cacheFile)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || parsed.fingerprint !== fingerprint) {
      return null;
    }
    return parsed;
  } catch (_) {
    return null;
  }
}

function writePersistentEntry(cacheDir, fingerprint, absolutePath, result, metadata) {
  if (!cacheDir) {
    return;
  }
  ensureCacheDir(cacheDir);
  const cacheFile = resolveCacheFile(cacheDir, fingerprint);
  const payload = {
    schemaVersion: 1,
    kind: 'zeus-source-scan-cache-entry',
    fingerprint,
    filePath: absolutePath,
    storedAt: new Date().toISOString(),
    metadata: metadata || {},
    result,
  };
  fs.writeFileSync(cacheFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function createSourceScanCache(options = {}) {
  const entries = new Map();
  const pathFingerprints = new Map();
  const stats = {
    requests: 0,
    memoryHits: 0,
    persistentHits: 0,
    hits: 0,
    misses: 0,
    invalidations: 0,
    writes: 0,
  };
  const cacheDir = options.cacheDir
    ? path.resolve(String(options.cacheDir))
    : null;

  return {
    getOrScan(filePath, scanFn) {
      const key = buildCacheKey(filePath, options);
      const previousFingerprint = pathFingerprints.get(key.absolutePath) || null;
      stats.requests += 1;

      if (previousFingerprint && previousFingerprint !== key.fingerprint) {
        stats.invalidations += 1;
      }

      if (entries.has(key.fingerprint)) {
        stats.memoryHits += 1;
        stats.hits += 1;
        pathFingerprints.set(key.absolutePath, key.fingerprint);
        return entries.get(key.fingerprint);
      }

      const persistentEntry = readPersistentEntry(cacheDir, key.fingerprint);
      if (persistentEntry && persistentEntry.result) {
        entries.set(key.fingerprint, persistentEntry.result);
        pathFingerprints.set(key.absolutePath, key.fingerprint);
        stats.persistentHits += 1;
        stats.hits += 1;
        return persistentEntry.result;
      }

      const result = scanFn(key.absolutePath);
      entries.set(key.fingerprint, result);
      pathFingerprints.set(key.absolutePath, key.fingerprint);
      writePersistentEntry(cacheDir, key.fingerprint, key.absolutePath, result, {
        sizeBytes: key.sizeBytes,
        mtimeMs: key.mtimeMs,
        contentHash: key.contentHash,
        toolVersion: key.toolVersion,
      });
      stats.misses += 1;
      if (cacheDir) {
        stats.writes += 1;
      }
      return result;
    },
    getStats() {
      return {
        requests: stats.requests,
        hits: stats.hits,
        memoryHits: stats.memoryHits,
        persistentHits: stats.persistentHits,
        misses: stats.misses,
        invalidations: stats.invalidations,
        writes: stats.writes,
        entryCount: entries.size,
        cacheDir,
      };
    },
  };
}

function resolveDefaultSourceScanCacheDir(outputRoot) {
  if (!outputRoot) {
    return null;
  }
  return path.join(path.resolve(outputRoot), '.zeus-cache', DEFAULT_CACHE_NAMESPACE);
}

module.exports = {
  createSourceScanCache,
  resolveDefaultSourceScanCacheDir,
};
