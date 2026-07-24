'use strict';

const { DOC_KINDS } = require('./constants');
const { fail, REASON_CODES } = require('../store/errors');
const { isSha256Hex } = require('../helpers');

/**
 * Vector-ready optional embedding field.
 * Not used for ranking in Community v1 lexical baseline.
 * @typedef {{ dims: number, values?: number[], modelId?: string }} VectorField
 */

/**
 * Normalize and validate a search document.
 * Fail-closed on missing identity or unknown kinds.
 */
function normalizeSearchDocument(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail(REASON_CODES.SCHEMA_INVALID, 'search document must be an object');
  }
  if (typeof raw.docId !== 'string' || !raw.docId.trim()) {
    fail(REASON_CODES.SCHEMA_INVALID, 'docId is required');
  }
  if (typeof raw.projectId !== 'string' || !raw.projectId.trim()) {
    fail(REASON_CODES.SCHEMA_INVALID, 'projectId is required');
  }
  if (typeof raw.snapshotId !== 'string' || !raw.snapshotId.trim()) {
    fail(REASON_CODES.SCHEMA_INVALID, 'snapshotId is required');
  }
  if (typeof raw.kind !== 'string' || !DOC_KINDS.includes(raw.kind)) {
    fail(REASON_CODES.UNKNOWN_ENUM_VALUE, 'document kind is unknown or missing');
  }
  if (raw.body != null && typeof raw.body !== 'string') {
    fail(REASON_CODES.SCHEMA_INVALID, 'body must be a string when present');
  }
  if (raw.title != null && typeof raw.title !== 'string') {
    fail(REASON_CODES.SCHEMA_INVALID, 'title must be a string when present');
  }

  const fields = {};
  if (raw.fields != null) {
    if (typeof raw.fields !== 'object' || Array.isArray(raw.fields)) {
      fail(REASON_CODES.SCHEMA_INVALID, 'fields must be an object when present');
    }
    for (const [k, v] of Object.entries(raw.fields)) {
      if (v == null) continue;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        fields[k] = v;
      } else {
        fail(REASON_CODES.SCHEMA_INVALID, `fields.${k} must be a scalar`);
      }
    }
  }

  let vector = null;
  if (raw.vector != null) {
    if (typeof raw.vector !== 'object' || Array.isArray(raw.vector)) {
      fail(REASON_CODES.SCHEMA_INVALID, 'vector must be an object when present');
    }
    const dims = Number(raw.vector.dims);
    if (!Number.isInteger(dims) || dims < 1) {
      fail(REASON_CODES.SCHEMA_INVALID, 'vector.dims must be a positive integer');
    }
    if (raw.vector.values != null) {
      if (!Array.isArray(raw.vector.values) || raw.vector.values.length !== dims) {
        fail(REASON_CODES.SCHEMA_INVALID, 'vector.values length must equal dims');
      }
      for (const n of raw.vector.values) {
        if (typeof n !== 'number' || !Number.isFinite(n)) {
          fail(REASON_CODES.SCHEMA_INVALID, 'vector.values must be finite numbers');
        }
      }
    }
    vector = {
      dims,
      values: raw.vector.values ? raw.vector.values.map(Number) : undefined,
      modelId: raw.vector.modelId ? String(raw.vector.modelId) : undefined,
    };
  }

  if (raw.contentHash != null && !isSha256Hex(raw.contentHash)) {
    fail(
      REASON_CODES.CONTENT_HASH_MISMATCH,
      'contentHash must be lowercase sha256 hex when present'
    );
  }

  // Reject absolute host paths in indexed metadata (no path leakage in hits).
  if (fields.relativePath != null) {
    const p = String(fields.relativePath);
    if (p.startsWith('/') || p.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(p) || p.includes('..')) {
      fail(REASON_CODES.PATH_UNSAFE, 'fields.relativePath must be a safe relative path');
    }
  }

  return {
    docId: raw.docId.trim(),
    projectId: raw.projectId.trim(),
    snapshotId: raw.snapshotId.trim(),
    kind: raw.kind,
    title: raw.title ? String(raw.title) : '',
    body: raw.body ? String(raw.body) : '',
    fields,
    contentHash: raw.contentHash || null,
    vector,
  };
}

module.exports = {
  normalizeSearchDocument,
  DOC_KINDS,
};
