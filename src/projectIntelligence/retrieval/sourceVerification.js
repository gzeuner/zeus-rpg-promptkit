'use strict';

const { REASON_CODES } = require('../store/errors');

/**
 * Verify content-addressed evidence for selected items.
 * Fail-soft per item: returns verification records; does not throw on single miss
 * (caller decides whether to omit). Whole-store unavailability throws from content API.
 *
 * @param {object} contentStore createContentStore handle or null
 * @param {Array<{ id: string, contentHash?: string }>} items
 */
function verifySourceEvidence(contentStore, items) {
  const results = [];
  for (const item of items || []) {
    const hash = item.contentHash;
    if (!hash) {
      results.push({
        id: item.id,
        ok: false,
        reasonCode: REASON_CODES.EVIDENCE_MISSING,
        message: 'no contentHash on item',
      });
      continue;
    }
    if (!contentStore) {
      results.push({
        id: item.id,
        ok: false,
        reasonCode: REASON_CODES.CONTENT_NOT_FOUND,
        message: 'content store not available',
      });
      continue;
    }
    try {
      const check = contentStore.verify(hash);
      if (!check.ok) {
        results.push({
          id: item.id,
          ok: false,
          reasonCode: check.reasonCode || REASON_CODES.CONTENT_HASH_MISMATCH,
          message: 'content verification failed',
        });
      } else {
        results.push({
          id: item.id,
          ok: true,
          reasonCode: null,
          sizeBytes: check.sizeBytes,
          contentHash: hash,
        });
      }
    } catch (err) {
      results.push({
        id: item.id,
        ok: false,
        reasonCode: (err && err.reasonCode) || REASON_CODES.CONTENT_NOT_FOUND,
        message: (err && err.message) || 'content verification error',
      });
    }
  }
  return results;
}

/**
 * Load verified body snippets (bounded) for packaging.
 */
function loadVerifiedBodies(contentStore, items, { maxChars = 2000 } = {}) {
  const bodies = new Map();
  if (!contentStore) return bodies;
  for (const item of items || []) {
    if (!item.contentHash) continue;
    try {
      const bytes = contentStore.getBytes(item.contentHash);
      let text = bytes.toString('utf8');
      if (text.length > maxChars) {
        text = `${text.slice(0, maxChars)}\n/* … truncated for context budget … */\n`;
      }
      bodies.set(item.id, text);
    } catch {
      // leave missing; verification already reported
    }
  }
  return bodies;
}

module.exports = {
  verifySourceEvidence,
  loadVerifiedBodies,
};
