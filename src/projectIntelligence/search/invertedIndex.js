'use strict';

const { analyzeText, tokenizeDocument } = require('./analyzer');
const { scoreDocument, compareHits } = require('./ranking');
const { normalizeSearchDocument } = require('./documentSchema');
const { DEFAULT_LIMIT, MAX_LIMIT } = require('./constants');
const { fail, REASON_CODES } = require('../store/errors');
const { resolveEmbeddingPolicy, shouldRetainVectorField } = require('./embeddingPolicy');

/**
 * In-memory inverted index (serializable).
 * @param {object} [options]
 * @param {object} [options.embeddingPolicy] resolved embedding policy (default: disabled)
 */
function createInvertedIndex(options = {}) {
  /** @type {Map<string, object>} */
  const docs = new Map();
  /** @type {Map<string, Map<string, number>>} term -> docId -> tf */
  const postings = new Map();
  const embeddingPolicy = options.embeddingPolicy || resolveEmbeddingPolicy(options);

  function clear() {
    docs.clear();
    postings.clear();
  }

  function addDocument(rawDoc) {
    const doc = normalizeSearchDocument(rawDoc);
    // Embeddings default off: strip vector payloads unless storage is explicitly enabled.
    // Community ranking remains lexical-only even when vectors are retained (ADR-010).
    if (!shouldRetainVectorField(embeddingPolicy)) {
      delete doc.vector;
    }
    // Replace existing
    if (docs.has(doc.docId)) {
      removeDocument(doc.docId);
    }
    const tokens = tokenizeDocument(doc);
    const titleTokens = new Set(analyzeText(doc.title || ''));
    const termFreqs = new Map();
    for (const t of tokens) {
      termFreqs.set(t, (termFreqs.get(t) || 0) + 1);
    }
    docs.set(doc.docId, {
      ...doc,
      termFreqs: Object.fromEntries(termFreqs),
      titleTokens: Array.from(titleTokens).sort(),
      tokenCount: tokens.length,
    });
    for (const [term, tf] of termFreqs) {
      if (!postings.has(term)) postings.set(term, new Map());
      postings.get(term).set(doc.docId, tf);
    }
    return doc.docId;
  }

  function removeDocument(docId) {
    const existing = docs.get(docId);
    if (!existing) return false;
    const terms = Object.keys(existing.termFreqs || {});
    for (const term of terms) {
      const map = postings.get(term);
      if (!map) continue;
      map.delete(docId);
      if (map.size === 0) postings.delete(term);
    }
    docs.delete(docId);
    return true;
  }

  function addDocuments(rawDocs) {
    if (!Array.isArray(rawDocs)) {
      fail(REASON_CODES.SCHEMA_INVALID, 'documents must be an array');
    }
    const ids = [];
    for (const d of rawDocs) {
      ids.push(addDocument(d));
    }
    return ids;
  }

  function matchesFilters(doc, filters = {}) {
    if (!filters || typeof filters !== 'object') return true;
    if (filters.projectId != null && doc.projectId !== filters.projectId) return false;
    if (filters.snapshotId != null && doc.snapshotId !== filters.snapshotId) return false;
    if (filters.kind != null) {
      const kinds = Array.isArray(filters.kind) ? filters.kind : [filters.kind];
      if (!kinds.includes(doc.kind)) return false;
    }
    if (filters.fields && typeof filters.fields === 'object') {
      for (const [k, v] of Object.entries(filters.fields)) {
        if (doc.fields[k] !== v) return false;
      }
    }
    return true;
  }

  /**
   * Lexical search with filters, bounds, and deterministic ordering.
   */
  function search({ query, filters = {}, limit, offset } = {}) {
    if (typeof query !== 'string' || !query.trim()) {
      fail(REASON_CODES.SCHEMA_INVALID, 'query string is required');
    }
    const queryTokens = analyzeText(query);
    if (queryTokens.length === 0) {
      return {
        hits: [],
        totalMatched: 0,
        limit: normalizeLimit(limit),
        offset: normalizeOffset(offset),
        omitted: false,
        queryTokens: [],
      };
    }

    const lim = normalizeLimit(limit);
    const off = normalizeOffset(offset);
    const docCount = docs.size;

    // Candidate set: intersection of postings for AND semantics
    let candidateIds = null;
    const docFreqs = new Map();
    for (const term of queryTokens) {
      const map = postings.get(term);
      docFreqs.set(term, map ? map.size : 0);
      const ids = map ? new Set(map.keys()) : new Set();
      if (candidateIds == null) {
        candidateIds = ids;
      } else {
        const next = new Set();
        for (const id of candidateIds) {
          if (ids.has(id)) next.add(id);
        }
        candidateIds = next;
      }
    }
    if (!candidateIds || candidateIds.size === 0) {
      return {
        hits: [],
        totalMatched: 0,
        limit: lim,
        offset: off,
        omitted: false,
        queryTokens,
      };
    }

    const hits = [];
    for (const docId of candidateIds) {
      const doc = docs.get(docId);
      if (!doc || !matchesFilters(doc, filters)) continue;
      const termFreqs = new Map(Object.entries(doc.termFreqs || {}));
      const titleTokenSet = new Set(doc.titleTokens || []);
      const score = scoreDocument({
        queryTokens,
        termFreqs,
        docFreqs,
        docCount,
        titleTokenSet,
      });
      if (score <= 0) continue;
      hits.push({
        docId: doc.docId,
        projectId: doc.projectId,
        snapshotId: doc.snapshotId,
        kind: doc.kind,
        score,
        title: doc.title || '',
        // Snippets are redacted of absolute paths — only relative field when present
        fields: sanitizeHitFields(doc.fields),
        contentHash: doc.contentHash,
      });
    }

    hits.sort(compareHits);
    const totalMatched = hits.length;
    const page = hits.slice(off, off + lim);
    return {
      hits: page,
      totalMatched,
      limit: lim,
      offset: off,
      omitted: off + lim < totalMatched,
      queryTokens,
    };
  }

  function serialize() {
    const docList = Array.from(docs.values()).map(d => ({
      docId: d.docId,
      projectId: d.projectId,
      snapshotId: d.snapshotId,
      kind: d.kind,
      title: d.title,
      body: d.body,
      fields: d.fields,
      contentHash: d.contentHash,
      vector: d.vector,
      termFreqs: d.termFreqs,
      titleTokens: d.titleTokens,
      tokenCount: d.tokenCount,
    }));
    docList.sort((a, b) => a.docId.localeCompare(b.docId));

    const postingsObj = {};
    const terms = Array.from(postings.keys()).sort();
    for (const term of terms) {
      const map = postings.get(term);
      const entries = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      postingsObj[term] = Object.fromEntries(entries);
    }
    return { docs: docList, postings: postingsObj };
  }

  function load(serialized) {
    clear();
    if (!serialized || typeof serialized !== 'object') {
      fail(REASON_CODES.INDEX_CORRUPT, 'serialized index is invalid');
    }
    const docList = Array.isArray(serialized.docs) ? serialized.docs : [];
    for (const d of docList) {
      docs.set(d.docId, {
        docId: d.docId,
        projectId: d.projectId,
        snapshotId: d.snapshotId,
        kind: d.kind,
        title: d.title || '',
        body: d.body || '',
        fields: d.fields || {},
        contentHash: d.contentHash || null,
        vector: d.vector || null,
        termFreqs: d.termFreqs || {},
        titleTokens: d.titleTokens || [],
        tokenCount: d.tokenCount || 0,
      });
    }
    const postingsObj =
      serialized.postings && typeof serialized.postings === 'object' ? serialized.postings : {};
    for (const [term, mapObj] of Object.entries(postingsObj)) {
      const map = new Map();
      for (const [docId, tf] of Object.entries(mapObj || {})) {
        map.set(docId, Number(tf) || 0);
      }
      postings.set(term, map);
    }
  }

  function size() {
    return docs.size;
  }

  function getDoc(docId) {
    return docs.get(docId) || null;
  }

  return {
    clear,
    addDocument,
    addDocuments,
    removeDocument,
    search,
    serialize,
    load,
    size,
    getDoc,
  };
}

function normalizeLimit(limit) {
  if (limit == null) return DEFAULT_LIMIT;
  const n = Number(limit);
  if (!Number.isInteger(n) || n < 1) {
    fail(REASON_CODES.SCHEMA_INVALID, 'limit must be a positive integer');
  }
  if (n > MAX_LIMIT) {
    fail(REASON_CODES.RESULT_LIMIT_EXCEEDED, `limit exceeds max ${MAX_LIMIT}`);
  }
  return n;
}

function normalizeOffset(offset) {
  if (offset == null) return 0;
  const n = Number(offset);
  if (!Number.isInteger(n) || n < 0) {
    fail(REASON_CODES.SCHEMA_INVALID, 'offset must be a non-negative integer');
  }
  return n;
}

function sanitizeHitFields(fields) {
  if (!fields || typeof fields !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string') {
      // Never surface absolute-looking paths
      if (v.startsWith('/') || /^[A-Za-z]:[\\/]/.test(v) || v.startsWith('\\\\')) continue;
      out[k] = v;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    }
  }
  return out;
}

module.exports = {
  createInvertedIndex,
};
