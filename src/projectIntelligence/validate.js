'use strict';

const { createSchemaRegistry } = require('../core/contracts/schemaRegistry');
const { normalizeValidationErrors } = require('../core/contracts/errors');
const { PROJECT_INTELLIGENCE_SCHEMAS, CONTRACT_IDS } = require('./contracts');
const { REASON_CODES, REASON_CODE_MESSAGES } = require('./constants');

/**
 * Register all Project Intelligence schemas into a schema registry.
 */
function registerProjectIntelligenceSchemas(registry) {
  if (!registry || typeof registry.register !== 'function') {
    throw new Error('schema registry is required');
  }
  for (const [id, { version, schema }] of Object.entries(PROJECT_INTELLIGENCE_SCHEMAS)) {
    registry.register({ id, version, schema });
  }
  return registry;
}

/**
 * Create a schema registry preloaded with ZPI contracts only.
 */
function createProjectIntelligenceRegistry() {
  const registry = createSchemaRegistry();
  registerProjectIntelligenceSchemas(registry);
  return registry;
}

/**
 * Validate a value against a named ZPI contract.
 * @returns {{ ok: true, value } | { ok: false, errors: Array, reasonCode: string, message: string }}
 */
function validateProjectIntelligenceContract(contractId, value, options = {}) {
  const version = options.version == null ? 1 : options.version;
  const registry = options.registry || createProjectIntelligenceRegistry();

  if (!PROJECT_INTELLIGENCE_SCHEMAS[contractId] && !registry.hasContract(contractId, version)) {
    return {
      ok: false,
      errors: normalizeValidationErrors([
        { path: '', message: `Unknown project intelligence contract: ${contractId}` },
      ]),
      reasonCode: REASON_CODES.SCHEMA_VERSION_UNSUPPORTED,
      message: REASON_CODE_MESSAGES[REASON_CODES.SCHEMA_VERSION_UNSUPPORTED],
    };
  }

  const result = registry.validate(contractId, version, value);
  if (result.ok) {
    return { ok: true, value: result.value };
  }

  const hasVersionError = (result.errors || []).some(
    e => e.path === '/schemaVersion' || /unsupported version/i.test(e.message || '')
  );
  const reasonCode = hasVersionError
    ? REASON_CODES.SCHEMA_VERSION_UNSUPPORTED
    : REASON_CODES.SCHEMA_INVALID;

  return {
    ok: false,
    errors: result.errors,
    reasonCode,
    message: REASON_CODE_MESSAGES[reasonCode],
  };
}

/**
 * Map of contract key -> validate helper for convenience.
 */
function createValidators(registry = createProjectIntelligenceRegistry()) {
  const out = {};
  for (const id of Object.keys(PROJECT_INTELLIGENCE_SCHEMAS)) {
    const key = id.replace(/^zeus\.project-knowledge-/, '').replace(/-/g, '_');
    out[key] = value => validateProjectIntelligenceContract(id, value, { registry });
  }
  return out;
}

module.exports = {
  CONTRACT_IDS,
  registerProjectIntelligenceSchemas,
  createProjectIntelligenceRegistry,
  validateProjectIntelligenceContract,
  createValidators,
};
