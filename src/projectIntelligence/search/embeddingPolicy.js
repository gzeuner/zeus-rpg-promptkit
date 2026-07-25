'use strict';

/**
 * Optional vector embeddings policy for Project Intelligence search (Track C / ADR-010).
 *
 * Community v1 ranking is lexical-only. Vector fields on search documents are
 * schema-ready storage only. Embeddings stay disabled unless an operator
 * explicitly opts in — and even then Community ranking does not consume vectors
 * until a future approved embedding engine is wired.
 */

const EMBEDDINGS_DEFAULT_ENABLED = false;

const EMBEDDING_POLICY_REASON = Object.freeze({
  DISABLED_BY_DEFAULT: 'EMBEDDINGS_DISABLED_BY_DEFAULT',
  EXPLICITLY_DISABLED: 'EMBEDDINGS_EXPLICITLY_DISABLED',
  EXPLICITLY_ENABLED_STORAGE_ONLY: 'EMBEDDINGS_ENABLED_STORAGE_ONLY',
  COMMUNITY_RANKING_LEXICAL_ONLY: 'COMMUNITY_RANKING_LEXICAL_ONLY',
});

/**
 * Resolve embedding policy from operator options / env.
 *
 * @param {object} [options]
 * @param {boolean} [options.enableEmbeddings]
 * @param {boolean} [options.embeddings]
 * @param {object} [options.env]
 * @returns {{
 *   enabled: boolean,
 *   useForRanking: boolean,
 *   reasonCode: string,
 *   message: string
 * }}
 */
function resolveEmbeddingPolicy(options = {}) {
  const env = options.env || process.env;
  const envRaw = env && (env.ZEUS_PI_ENABLE_EMBEDDINGS || env.ZEUS_PROJECT_INTELLIGENCE_EMBEDDINGS);
  const envEnabled =
    envRaw != null &&
    !['0', 'false', 'no', 'off', ''].includes(String(envRaw).trim().toLowerCase());

  let explicit = null;
  if (options.enableEmbeddings != null) explicit = Boolean(options.enableEmbeddings);
  else if (options.embeddings != null) explicit = Boolean(options.embeddings);

  if (explicit === false) {
    return {
      enabled: false,
      useForRanking: false,
      reasonCode: EMBEDDING_POLICY_REASON.EXPLICITLY_DISABLED,
      message: 'Embeddings explicitly disabled by operator options.',
    };
  }

  if (explicit === true || envEnabled) {
    return {
      enabled: true,
      // Community lexical ranking never consumes vectors in v1 (ADR-010).
      useForRanking: false,
      reasonCode: EMBEDDING_POLICY_REASON.EXPLICITLY_ENABLED_STORAGE_ONLY,
      message:
        'Embeddings enabled for optional vector storage only; Community ranking remains lexical-only.',
    };
  }

  return {
    enabled: EMBEDDINGS_DEFAULT_ENABLED,
    useForRanking: false,
    reasonCode: EMBEDDING_POLICY_REASON.DISABLED_BY_DEFAULT,
    message:
      'Embeddings disabled by default (ADR-010). Set enableEmbeddings:true or ZEUS_PI_ENABLE_EMBEDDINGS=1 for storage-only opt-in.',
  };
}

/**
 * Whether vector payloads may be retained on indexed documents.
 * Ranking never uses them in Community v1.
 */
function shouldRetainVectorField(policy) {
  return Boolean(policy && policy.enabled);
}

/**
 * Community ranking must ignore vectors regardless of storage policy.
 */
function rankingUsesEmbeddings(policy) {
  return Boolean(policy && policy.useForRanking === true);
}

module.exports = {
  EMBEDDINGS_DEFAULT_ENABLED,
  EMBEDDING_POLICY_REASON,
  resolveEmbeddingPolicy,
  shouldRetainVectorField,
  rankingUsesEmbeddings,
};
