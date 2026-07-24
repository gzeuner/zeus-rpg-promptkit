'use strict';

const { ANALYZER_ID, ANALYZER_VERSION } = require('./constants');

/**
 * Standard Community lexical analyzer.
 * - lowercase
 * - split on non-alphanumeric (unicode letters/digits kept)
 * - drop empty tokens
 * Deterministic; no stemming/stopword lists in v1 (stable ranking).
 */
function analyzeText(text) {
  if (text == null) return [];
  const raw = String(text).toLowerCase();
  const tokens = raw.split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
  return tokens;
}

function analyzerIdentity() {
  return {
    analyzerId: ANALYZER_ID,
    analyzerVersion: ANALYZER_VERSION,
  };
}

/**
 * Build searchable bag of tokens from a document body + selected fields.
 */
function tokenizeDocument(doc) {
  const parts = [];
  if (doc.title) parts.push(String(doc.title));
  if (doc.body) parts.push(String(doc.body));
  if (doc.fields && typeof doc.fields === 'object') {
    for (const key of Object.keys(doc.fields).sort()) {
      const value = doc.fields[key];
      if (value == null) continue;
      if (typeof value === 'string' || typeof value === 'number') {
        parts.push(String(value));
      }
    }
  }
  return analyzeText(parts.join('\n'));
}

module.exports = {
  analyzeText,
  analyzerIdentity,
  tokenizeDocument,
};
