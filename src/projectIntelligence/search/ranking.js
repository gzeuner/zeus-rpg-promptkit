'use strict';

/**
 * Deterministic lexical ranking for Community v1.
 *
 * score = sum over query terms of:
 *   tf component: 1 + ln(tf)
 *   idf component: ln(1 + N / df)
 *   field boost: title match * 2.0 (if term appears in title tokens)
 *
 * Tie-break (stable): higher score, then docId ascending, then kind ascending.
 * Scores are advisory; ordered docIds are the contract.
 */

function ln(n) {
  return Math.log(n);
}

/**
 * @param {object} params
 * @param {string[]} params.queryTokens
 * @param {Map<string, number>} params.termFreqs term -> tf in doc
 * @param {Map<string, number>} params.docFreqs term -> df
 * @param {number} params.docCount
 * @param {Set<string>} params.titleTokenSet
 */
function scoreDocument({ queryTokens, termFreqs, docFreqs, docCount, titleTokenSet }) {
  let score = 0;
  const N = Math.max(1, docCount);
  for (const term of queryTokens) {
    const tf = termFreqs.get(term) || 0;
    if (tf <= 0) continue;
    const df = Math.max(1, docFreqs.get(term) || 1);
    const tfWeight = 1 + ln(tf);
    const idf = ln(1 + N / df);
    let termScore = tfWeight * idf;
    if (titleTokenSet && titleTokenSet.has(term)) {
      termScore *= 2.0;
    }
    score += termScore;
  }
  // Round to stable precision for cross-platform float noise
  return Math.round(score * 1e6) / 1e6;
}

function compareHits(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (a.docId < b.docId) return -1;
  if (a.docId > b.docId) return 1;
  if (a.kind < b.kind) return -1;
  if (a.kind > b.kind) return 1;
  return 0;
}

module.exports = {
  scoreDocument,
  compareHits,
};
