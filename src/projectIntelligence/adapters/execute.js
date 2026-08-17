'use strict';

const { OPERATION_CAPABILITY_MAP, PUBLIC_OPERATIONS } = require('./capabilityCatalog');
const { discoverProjectIntelligenceCapabilities } = require('./discovery');
const { REASON_CODES } = require('../constants');

function normalizeOperation(operation) {
  const key = String(operation || '')
    .trim()
    .toLowerCase();
  return key;
}

function resolveCapabilityId(operation) {
  const key = normalizeOperation(operation);
  return OPERATION_CAPABILITY_MAP[key] || null;
}

/**
 * Execute a Project Intelligence operation via capability registry (thin adapter).
 * Fail closed when capability is absent — no external code is loaded here.
 *
 * @param {object} options
 * @param {object} options.capabilities capability registry
 * @param {string} options.operation public operation key
 * @param {object} [options.input]
 * @param {object} [options.context]
 */
async function executeProjectIntelligenceOperation(options = {}) {
  const capabilities = options.capabilities;
  const operation = normalizeOperation(options.operation);
  const input = options.input && typeof options.input === 'object' ? options.input : {};
  const context = options.context && typeof options.context === 'object' ? options.context : {};

  if (operation === 'discover' || operation === 'help' || operation === 'list') {
    return {
      ok: true,
      operation: 'discover',
      builtIn: true,
      commercial: true,
      result: discoverProjectIntelligenceCapabilities(capabilities),
    };
  }

  const capabilityId = resolveCapabilityId(operation);
  if (!capabilityId) {
    return {
      ok: false,
      operation: operation || null,
      builtIn: true,
      commercial: true,
      reasonCode: REASON_CODES.OPERATION_UNAVAILABLE,
      message: `Unknown project-knowledge operation: ${operation || '(empty)'}. Use discover/list for available operations.`,
      knownOperations: PUBLIC_OPERATIONS.map(o => o.operation),
    };
  }

  if (!capabilities || typeof capabilities.get !== 'function') {
    return {
      ok: false,
      operation,
      capabilityId,
      builtIn: true,
      commercial: true,
      reasonCode: REASON_CODES.CAPABILITY_UNAVAILABLE,
      message:
        'No capability registry provided. Integrated Project Intelligence is not registered.',
    };
  }

  const desc = capabilities.get(capabilityId);
  if (!desc) {
    return {
      ok: false,
      operation,
      capabilityId,
      builtIn: true,
      commercial: true,
      reasonCode: REASON_CODES.CAPABILITY_UNAVAILABLE,
      message: `Capability ${capabilityId} is not registered. Explicitly register the integrated module with a valid entitlement.`,
    };
  }

  if (typeof capabilities.execute !== 'function') {
    return {
      ok: false,
      operation,
      capabilityId,
      builtIn: true,
      commercial: true,
      reasonCode: REASON_CODES.CAPABILITY_UNAVAILABLE,
      message: 'Capability registry does not support execute.',
    };
  }

  const exec = await capabilities.execute(capabilityId, context, input);
  if (!exec || exec.ok !== true) {
    return {
      ok: false,
      operation,
      capabilityId,
      builtIn: true,
      commercial: true,
      reasonCode: (exec && exec.error && exec.error.code) || REASON_CODES.OPERATION_UNAVAILABLE,
      message:
        (exec && exec.error && exec.error.message) || `Capability ${capabilityId} execution failed`,
      result: exec || null,
    };
  }

  // Capability handler may return { ok:false, reasonCode } for entitlement denial
  const payload = exec.result;
  if (payload && payload.ok === false) {
    return {
      ok: false,
      operation,
      capabilityId,
      builtIn: true,
      commercial: true,
      reasonCode: payload.reasonCode || REASON_CODES.ENTITLEMENT_REQUIRED,
      message: payload.message || 'Operation denied by integrated capability handler',
      result: payload,
    };
  }

  return {
    ok: true,
    operation,
    capabilityId,
    builtIn: true,
    commercial: true,
    result: payload,
  };
}

module.exports = {
  executeProjectIntelligenceOperation,
  resolveCapabilityId,
  normalizeOperation,
};
