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
};
