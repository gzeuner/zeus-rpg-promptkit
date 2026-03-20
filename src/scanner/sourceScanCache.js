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
const fs = require('fs');
const path = require('path');

function fingerprintFile(filePath) {
  const absolutePath = path.resolve(String(filePath || ''));
  const stats = fs.statSync(absolutePath);
  return `${stats.size}:${Math.trunc(stats.mtimeMs)}`;
}

function createSourceScanCache() {
  const entries = new Map();
  const stats = {
    requests: 0,
    hits: 0,
    misses: 0,
    invalidations: 0,
  };

  return {
    getOrScan(filePath, scanFn) {
      const absolutePath = path.resolve(String(filePath || ''));
      const fingerprint = fingerprintFile(absolutePath);
      const existing = entries.get(absolutePath);
      stats.requests += 1;

      if (existing && existing.fingerprint === fingerprint) {
        stats.hits += 1;
        return existing.result;
      }

      if (existing && existing.fingerprint !== fingerprint) {
        stats.invalidations += 1;
      }

      const result = scanFn(absolutePath);
      entries.set(absolutePath, {
        fingerprint,
        result,
      });
      stats.misses += 1;
      return result;
    },
    getStats() {
      return {
        requests: stats.requests,
        hits: stats.hits,
        misses: stats.misses,
        invalidations: stats.invalidations,
        entryCount: entries.size,
      };
    },
  };
}

module.exports = {
  createSourceScanCache,
};
