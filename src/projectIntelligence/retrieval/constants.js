'use strict';

const POLICY_ID = 'zeus.community-default-context';
const POLICY_VERSION = '1.0.0';
const RETRIEVER_ID = 'zeus.community-hybrid-retriever';
const RETRIEVER_VERSION = '1.0.0';

/** Default total token budget for a context package. */
const DEFAULT_TOKEN_BUDGET = 4000;

/** Default lexical hit limit before graph expansion. */
const DEFAULT_RETRIEVAL_LIMIT = 20;

/** Default graph expansion hops from seed hits. */
const DEFAULT_EXPAND_HOPS = 1;

/**
 * Budget slice weights (must sum to 1.0).
 * Architecture: summary / graph / source evidence / diagnostics / unresolved.
 */
const BUDGET_WEIGHTS = Object.freeze({
  summary: 0.1,
  graph: 0.25,
  source: 0.45,
  diagnostics: 0.1,
  unresolved: 0.1,
});

const BUDGET_BUCKETS = Object.freeze(Object.keys(BUDGET_WEIGHTS));

module.exports = {
  POLICY_ID,
  POLICY_VERSION,
  RETRIEVER_ID,
  RETRIEVER_VERSION,
  DEFAULT_TOKEN_BUDGET,
  DEFAULT_RETRIEVAL_LIMIT,
  DEFAULT_EXPAND_HOPS,
  BUDGET_WEIGHTS,
  BUDGET_BUCKETS,
};
