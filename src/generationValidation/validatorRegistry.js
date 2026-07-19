'use strict';

const { SEVERITY, DIAGNOSTIC_IDS } = require('./constants');

/**
 * Dedicated Generation Validator Registry.
 * Separate from Capability Registry and Provider Registry.
 * Deterministic order by explicit `order` then id.
 */
function createValidatorRegistry(options = {}) {
  const byId = new Map();
  let sealed = false;
  const requiredIds = Array.isArray(options.requiredIds) ? [...options.requiredIds] : [];

  function register(descriptor) {
    if (sealed) {
      throw new Error('validator registry is sealed; registration after seal is not allowed');
    }
    if (!descriptor || typeof descriptor !== 'object') {
      throw new Error('validator descriptor must be an object');
    }
    const id = String(descriptor.id || '').trim();
    if (!id) throw new Error('validator id is required');
    if (byId.has(id)) throw new Error(`duplicate validator id: ${id}`);
    const version = Number(descriptor.version);
    if (!Number.isInteger(version) || version < 1) {
      throw new Error('validator version must be a positive integer');
    }
    if (typeof descriptor.validate !== 'function') {
      throw new Error(`validator ${id} must provide validate(context)`);
    }
    const order = Number.isFinite(Number(descriptor.order)) ? Number(descriptor.order) : 100;
    byId.set(id, {
      id,
      version,
      title: descriptor.title ? String(descriptor.title) : id,
      description: descriptor.description ? String(descriptor.description) : '',
      order,
      blocking: descriptor.blocking !== false,
      validate: descriptor.validate,
    });
  }

  function list() {
    return [...byId.values()]
      .map(v => ({
        id: v.id,
        version: v.version,
        title: v.title,
        description: v.description,
        order: v.order,
        blocking: v.blocking,
      }))
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }

  function seal() {
    sealed = true;
  }

  function isSealed() {
    return sealed;
  }

  /**
   * Run validators in deterministic order with isolation.
   * A thrown validator becomes an internal-validator-failure diagnostic and does not
   * skip remaining required validators.
   */
  async function runAll(context) {
    const missingRequired = requiredIds.filter(id => !byId.has(id));
    const diagnostics = [];
    for (const id of missingRequired) {
      diagnostics.push({
        id: DIAGNOSTIC_IDS.VALIDATOR_MISSING,
        severity: SEVERITY.BLOCKING,
        validatorId: 'registry',
        validatorVersion: 1,
        path: null,
        message: `Required validator is not registered: ${id}`,
      });
    }

    const ordered = [...byId.values()].sort(
      (a, b) => a.order - b.order || a.id.localeCompare(b.id)
    );
    for (const validator of ordered) {
      try {
        const result = await validator.validate(context);
        const items = Array.isArray(result)
          ? result
          : result && Array.isArray(result.diagnostics)
            ? result.diagnostics
            : [];
        for (const item of items) {
          if (!item || typeof item !== 'object') continue;
          diagnostics.push({
            id: String(item.id || DIAGNOSTIC_IDS.VALIDATOR_INTERNAL),
            severity: String(item.severity || SEVERITY.ERROR),
            validatorId: validator.id,
            validatorVersion: validator.version,
            path: item.path == null ? null : String(item.path),
            message: String(item.message || 'validator reported an issue'),
          });
        }
      } catch (error) {
        diagnostics.push({
          id: DIAGNOSTIC_IDS.VALIDATOR_INTERNAL,
          severity: SEVERITY.BLOCKING,
          validatorId: validator.id,
          validatorVersion: validator.version,
          path: null,
          message: 'Validator failed internally; raw exception details are redacted.',
        });
        // Keep iterating — remaining required checks still run.
        void error;
      }
    }

    diagnostics.sort((a, b) => {
      const bySev = severityRank(a.severity) - severityRank(b.severity);
      if (bySev !== 0) return bySev;
      const byIdCmp = a.id.localeCompare(b.id);
      if (byIdCmp !== 0) return byIdCmp;
      return String(a.path || '').localeCompare(String(b.path || ''));
    });

    return { diagnostics };
  }

  return {
    register,
    list,
    seal,
    isSealed,
    runAll,
    has: id => byId.has(id),
  };
}

function severityRank(severity) {
  switch (String(severity)) {
    case SEVERITY.BLOCKING:
      return 0;
    case SEVERITY.ERROR:
      return 1;
    case SEVERITY.WARNING:
      return 2;
    default:
      return 3;
  }
}

module.exports = {
  createValidatorRegistry,
};
