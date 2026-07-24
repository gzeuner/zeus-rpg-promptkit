'use strict';

/**
 * Community search foundation (ZPI-05).
 *
 * Architectural target (ADR-010): Apache Lucene for lexical retrieval.
 * ZPI-05 ships a pure-JS Lucene-compatible inverted index under the standard
 * `lucene/` layout so Community stays offline, dependency-light, and
 * deterministic. A future Lucene binding can replace the engine without
 * changing the Search SPI or document schema.
 */

/** Search index schema version (independent of store/content). */
const SEARCH_SCHEMA_VERSION = 1;

/** Engine identity for the Community pure-JS lexical provider. */
const ENGINE_ID = 'zeus.community-lexical';
const ENGINE_VERSION = '1.0.0';

/** Analyzer identity used for tokenization and ranking contracts. */
const ANALYZER_ID = 'zeus.community-lexical.standard';
const ANALYZER_VERSION = '1.0.0';

/** Document kinds indexed by default. */
const DOC_KINDS = Object.freeze([
  'source-unit',
  'symbol',
  'relationship',
  'evidence',
  'summary',
  'diagnostic',
]);

/** Default result bounds. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

const SEARCH_LAYOUT = Object.freeze({
  MANIFEST: 'search-manifest.json',
  DOCS: 'docs.json',
  POSTINGS: 'postings.json',
  GENERATION: 'generation.json',
  QUARANTINE_MARKER: 'CORRUPT',
});

module.exports = {
  SEARCH_SCHEMA_VERSION,
  ENGINE_ID,
  ENGINE_VERSION,
  ANALYZER_ID,
  ANALYZER_VERSION,
  DOC_KINDS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  SEARCH_LAYOUT,
};
