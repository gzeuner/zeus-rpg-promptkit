'use strict';

/**
 * Project Intelligence Search (ZPI-05).
 *
 * Search SPI + Community pure-JS lexical provider (Lucene layout/schema).
 */

const constants = require('./constants');
const analyzer = require('./analyzer');
const documentSchema = require('./documentSchema');
const ranking = require('./ranking');
const invertedIndex = require('./invertedIndex');
const fileIndexStore = require('./fileIndexStore');
const searchProvider = require('./searchProvider');
const embeddingPolicy = require('./embeddingPolicy');

module.exports = {
  ...constants,
  analyzeText: analyzer.analyzeText,
  analyzerIdentity: analyzer.analyzerIdentity,
  tokenizeDocument: analyzer.tokenizeDocument,
  normalizeSearchDocument: documentSchema.normalizeSearchDocument,
  scoreDocument: ranking.scoreDocument,
  compareHits: ranking.compareHits,
  createInvertedIndex: invertedIndex.createInvertedIndex,
  resolveIndexDir: fileIndexStore.resolveIndexDir,
  createSearchProvider: searchProvider.createSearchProvider,
  openSearchProvider: searchProvider.openSearchProvider,
  // Track C — embeddings default off
  EMBEDDINGS_DEFAULT_ENABLED: embeddingPolicy.EMBEDDINGS_DEFAULT_ENABLED,
  EMBEDDING_POLICY_REASON: embeddingPolicy.EMBEDDING_POLICY_REASON,
  resolveEmbeddingPolicy: embeddingPolicy.resolveEmbeddingPolicy,
  shouldRetainVectorField: embeddingPolicy.shouldRetainVectorField,
  rankingUsesEmbeddings: embeddingPolicy.rankingUsesEmbeddings,
};
