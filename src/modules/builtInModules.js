'use strict';

/**
 * Host entry for the unified built-in capability modules.
 * Registers selected entitled modules against a createZeus() instance.
 *
 * Module selection (Track D packaging):
 * 1. options.modules — explicit list (highest precedence)
 * 2. options.surface / options.productSurface — professional | enterprise preset
 * 3. default — project-intelligence only (backward compatible)
 *
 * Known keys: project-intelligence | generation-assurance |
 * db2-test-intelligence | ibmi-validation
 *
 * Package 09 (ibmi-validation) may be included in the enterprise surface but
 * liveAccessAuthorized remains disabled by default — no Package 09 reopen.
 */

const { registerGenerationAssuranceModule } = require('../generationAssurance');
const { registerDb2TestIntelligenceModule } = require('../db2TestIntelligence/register');
const { registerIbmiCompileValidationModule } = require('../ibmiValidation');
const { registerProjectIntelligenceModule } = require('../projectIntelligence/entitled');
const { MODULE_SURFACE_ENTRIES, resolveModuleKeysForRegistration } = require('./productSurface');

const KNOWN_MODULES = Object.freeze(MODULE_SURFACE_ENTRIES.map(e => e.key));

function normalizeModuleList(modules) {
  // Back-compat helper: empty/absent → default PI-only (same as resolve with no surface)
  if (!Array.isArray(modules) || modules.length === 0) {
    return ['project-intelligence'];
  }
  const list = [...new Set(modules.map(m => String(m).trim().toLowerCase()).filter(Boolean))];
  for (const id of list) {
    if (!KNOWN_MODULES.includes(id)) {
      const err = new Error(
        `Unknown built-in module key: ${id}. Known: ${KNOWN_MODULES.join(', ')}`
      );
      err.code = 'UNKNOWN_BUILT_IN_MODULE';
      throw err;
    }
  }
  return list;
}

function resolveSelectedModules(options = {}) {
  const resolved = resolveModuleKeysForRegistration(options);
  for (const id of resolved.modules) {
    if (!KNOWN_MODULES.includes(id)) {
      const err = new Error(
        `Unknown built-in module key: ${id}. Known: ${KNOWN_MODULES.join(', ')}`
      );
      err.code = 'UNKNOWN_BUILT_IN_MODULE';
      throw err;
    }
  }
  return resolved;
}

function entitlementOptions(options = {}) {
  return {
    licenseDocument: options.licenseDocument,
    publicKeyPem: options.publicKeyPem,
    now: options.now,
    expectedProductId: options.expectedProductId,
    expectedEdition: options.expectedEdition,
    organizationScope: options.organizationScope,
  };
}

/**
 * @param {object} zeus createZeus() host
 * @param {object} [options]
 * @returns {Promise<{ ok: boolean, modules: object, message?: string }>}
 */
async function registerWithZeus(zeus, options = {}) {
  if (!zeus || !zeus.modules || typeof zeus.modules.registerModule !== 'function') {
    return {
      ok: false,
      modules: {},
      message: 'zeus.modules registrar is required',
    };
  }

  let selection;
  try {
    selection = resolveSelectedModules(options);
  } catch (err) {
    return { ok: false, modules: {}, message: err.message, reasonCode: err.code };
  }

  const selected = selection.modules;
  const ent = entitlementOptions(options);
  const results = {};
  let allOk = true;

  for (const key of selected) {
    let entry;
    if (key === 'project-intelligence') {
      entry = await registerProjectIntelligenceModule(zeus.modules, {
        ...ent,
        resourcePolicyOverrides: options.resourcePolicyOverrides,
      });
    } else if (key === 'generation-assurance') {
      entry = await registerGenerationAssuranceModule(zeus.modules, {
        ...ent,
        ...options.generationAssurance,
      });
    } else if (key === 'db2-test-intelligence') {
      entry = await registerDb2TestIntelligenceModule(zeus.modules, {
        ...ent,
        ...options.db2TestIntelligence,
      });
    } else if (key === 'ibmi-validation') {
      entry = await registerIbmiCompileValidationModule(zeus.modules, {
        ...ent,
        ...options.ibmiValidation,
      });
    }
    results[key] = entry;
    if (!entry || entry.ok === false) {
      allOk = false;
    }
  }

  return {
    ok: allOk,
    modules: results,
    selected,
    surface: selection.surface,
    selectionSource: selection.source,
    message: allOk
      ? 'Built-in modules registered.'
      : 'One or more built-in modules failed registration (entitlement or descriptor).',
  };
}

module.exports = {
  registerWithZeus,
  KNOWN_MODULES,
  KNOWN_COMMERCIAL_MODULES: KNOWN_MODULES,
  normalizeModuleList,
  resolveSelectedModules,
};
