/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/

const path = require('path');
const CONTRACT_IDS = require('./contractIds');

/**
 * Normalized Artifact Reference contract (package 03).
 *
 * This is the canonical shape for describing generated or referenced artifacts
 * across analyze manifests, bundles, safe-sharing, etc.
 *
 * All paths must be relative and workspace-safe (no absolute paths, no .. traversal).
 */

const DEFAULT_CHECKSUM_ALGORITHM = 'sha256';

/**
 * Build a normalized artifact reference.
 * @param {object} params
 * @param {string} params.path - relative path within the output/program dir
 * @param {string} [params.kind]
 * @param {number} [params.sizeBytes]
 * @param {string} [params.sha256]
 * @param {string} [params.mediaType]
 * @param {string} [params.producer] - e.g. 'analyze', 'bundle', capability id
 * @param {string} [params.schema] - contract reference e.g. 'zeus.artifact-reference@1'
 * @param {string} [params.safeSharing] - 'none' | 'redacted' | 'sanitized'
 * @param {string} [params.createdAt]
 * @param {string} [params.semanticRole]
 * @returns {object} normalized artifact reference
 */
function buildArtifactReference({
  path: relPath,
  kind,
  sizeBytes,
  sha256,
  mediaType,
  producer,
  schema = `${CONTRACT_IDS.ARTIFACT_REFERENCE}@1`,
  safeSharing = 'none',
  createdAt,
  semanticRole,
} = {}) {
  if (!relPath || typeof relPath !== 'string') {
    throw new Error('artifact reference requires a path');
  }

  // Enforce relative, safe path
  const normalizedPath = relPath.split(path.sep).join('/').replace(/^\.\/+/, '');
  if (normalizedPath.startsWith('/') || normalizedPath.includes('..')) {
    throw new Error(`unsafe artifact path: ${relPath}`);
  }

  const ref = {
    path: normalizedPath,
    kind: kind || inferKind(normalizedPath),
    sizeBytes: typeof sizeBytes === 'number' ? sizeBytes : null,
    checksum: sha256 ? { algorithm: DEFAULT_CHECKSUM_ALGORITHM, value: sha256 } : null,
    mediaType: mediaType || null,
    producer: producer || null,
    schema,
    safeSharing,
    createdAt: createdAt || null,
    semanticRole: semanticRole || null,
    // Legacy flat fields for compatibility with existing consumers/tests (package 03 enrichment)
    sha256: sha256 || null,
    exists: true, // default; callers override if needed
  };

  // Remove nulls for cleaner output
  Object.keys(ref).forEach((k) => {
    if (ref[k] === null) delete ref[k];
  });

  return ref;
}

function inferKind(fileName) {
  const lower = String(fileName || '').toLowerCase();
  const ext = path.extname(lower);
  if (ext === '.json') return 'json';
  if (ext === '.md') return 'markdown';
  if (ext === '.mmd') return 'mermaid';
  if (ext === '.html') return 'html';
  return ext ? ext.slice(1) : 'unknown';
}

module.exports = {
  buildArtifactReference,
  CONTRACT_ID: CONTRACT_IDS.ARTIFACT_REFERENCE,
  VERSION: 1,
};
