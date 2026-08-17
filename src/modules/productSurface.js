'use strict';

/**
 * Unified product surface matrix (Track D packaging).
 *
 * Single source of truth for Professional vs Enterprise packaging:
 * - which module keys belong to which surface
 * - package export subpaths
 * - edition classification (runtime surface metadata only)
 * - safety / availability notes
 * - non-claims (Package 09 live remains closed by default)
 *
 * This module does not load paid handlers or perform entitlement checks.
 */

const SURFACE_IDS = Object.freeze(['professional', 'enterprise']);

/**
 * @typedef {object} ModuleSurfaceEntry
 * @property {string} key registerWithZeus module key
 * @property {string} moduleId descriptor module id
 * @property {'professional'|'enterprise'} edition ADR-006 edition classification
 * @property {string|null} packageExport package.json exports subpath (null = root-only helpers)
 * @property {string} safetyLevel aggregate safety level (descriptor)
 * @property {{ api: boolean, cli: boolean, mcp: boolean }} availability
 * @property {boolean} liveIbmiDefault whether live IBM i contact is on by default
 * @property {boolean} includedInProfessionalDefault default professional pack
 * @property {boolean} includedInEnterpriseDefault default enterprise pack
 * @property {string} summary short product summary
 * @property {string[]} nonClaims packaging non-claims (not exhaustive product legal text)
 */

/** @type {readonly ModuleSurfaceEntry[]} */
const MODULE_SURFACE_ENTRIES = Object.freeze([
  Object.freeze({
    key: 'project-intelligence',
    moduleId: 'zeus-pro.project-intelligence',
    edition: 'professional',
    packageExport: './project-intelligence',
    safetyLevel: 'S1',
    availability: Object.freeze({ api: true, cli: true, mcp: true }),
    liveIbmiDefault: false,
    includedInProfessionalDefault: true,
    includedInEnterpriseDefault: true,
    summary:
      'Entitled Project Intelligence ops over Community engines (create/index/query/impact/context).',
    nonClaims: Object.freeze([
      'Not source of truth',
      'No live IBM i / compile / deploy',
      'No implicit workspace harvest',
    ]),
  }),
  Object.freeze({
    key: 'generation-assurance',
    moduleId: 'zeus-pro.generation-assurance',
    edition: 'professional',
    packageExport: './generation-assurance',
    safetyLevel: 'S3',
    availability: Object.freeze({ api: true, cli: false, mcp: false }),
    liveIbmiDefault: false,
    includedInProfessionalDefault: true,
    includedInEnterpriseDefault: true,
    summary:
      'Bounded generation repair loop with offline entitlement recheck and public validators.',
    nonClaims: Object.freeze([
      'Never mutates source workspace',
      'review-ready is never compile readiness',
      'No unbounded AI loops',
    ]),
  }),
  Object.freeze({
    key: 'db2-test-intelligence',
    moduleId: 'zeus-pro.db2-test-intelligence',
    edition: 'professional',
    packageExport: './db2-test-intelligence',
    safetyLevel: 'S1',
    availability: Object.freeze({ api: true, cli: false, mcp: false }),
    liveIbmiDefault: false,
    includedInProfessionalDefault: true,
    includedInEnterpriseDefault: true,
    summary: 'Deterministic technical test-vector generation from caller-passed Db2 evidence.',
    nonClaims: Object.freeze([
      'Does not execute SQL against Db2',
      'Does not open network connections in product code paths under test',
    ]),
  }),
  Object.freeze({
    key: 'ibmi-validation',
    moduleId: 'zeus-enterprise.ibmi-compile-validation',
    edition: 'enterprise',
    packageExport: './ibmi-validation',
    safetyLevel: 'S4',
    availability: Object.freeze({ api: true, cli: false, mcp: false }),
    liveIbmiDefault: false,
    includedInProfessionalDefault: false,
    includedInEnterpriseDefault: true,
    summary:
      'Owner-gated IBM i compile/diff validation (Package 09). Offline module shipped; live default OFF.',
    nonClaims: Object.freeze([
      'Package 09 CLOSED as default product path',
      'liveAccessAuthorized default false',
      'Live execute / live differential require separate owner authorization',
      'CI never connects to IBM i',
    ]),
  }),
]);

const SURFACE_PRESETS = Object.freeze({
  professional: Object.freeze({
    id: 'professional',
    label: 'Professional',
    description:
      'Paid Professional modules: Project Intelligence, Generation Assurance, Db2 Test Intelligence. No Package 09 live IBM i path.',
    edition: 'professional',
    defaultModuleKeys: Object.freeze(
      MODULE_SURFACE_ENTRIES.filter(e => e.includedInProfessionalDefault).map(e => e.key)
    ),
  }),
  enterprise: Object.freeze({
    id: 'enterprise',
    label: 'Enterprise',
    description:
      'Professional pack plus owner-gated IBM i validation module. liveAccessAuthorized remains disabled by default.',
    edition: 'enterprise',
    defaultModuleKeys: Object.freeze(
      MODULE_SURFACE_ENTRIES.filter(e => e.includedInEnterpriseDefault).map(e => e.key)
    ),
  }),
});

const PACKAGING_NON_CLAIMS = Object.freeze([
  'This capability matrix describes the unified public package; entitlement is a runtime product policy, not a source-license restriction.',
  'Edition is ADR-006 classification metadata; core does not enforce licenses.',
  'Package 09 live IBM i is not a default product path.',
  'v0.2.0-beta.3 Community prerelease is not production certification.',
  'Project Knowledge is not source of truth.',
]);

function listModuleSurfaceEntries() {
  return MODULE_SURFACE_ENTRIES.slice();
}

function getModuleSurfaceEntry(key) {
  const normalized = String(key || '')
    .trim()
    .toLowerCase();
  return MODULE_SURFACE_ENTRIES.find(e => e.key === normalized) || null;
}

function listSurfacePresets() {
  return SURFACE_IDS.map(id => SURFACE_PRESETS[id]);
}

function getSurfacePreset(surfaceId) {
  const id = String(surfaceId || '')
    .trim()
    .toLowerCase();
  return SURFACE_PRESETS[id] || null;
}

/**
 * Resolve module keys for registration from explicit modules and/or surface preset.
 * Explicit modules always win. Surface default is used only when modules is empty/absent.
 *
 * @param {object} [options]
 * @param {string[]|string} [options.modules]
 * @param {string} [options.surface] professional | enterprise
 * @param {string} [options.productSurface] alias of surface
 * @returns {{ modules: string[], surface: string|null, source: 'modules'|'surface'|'default' }}
 */
function resolveModuleKeysForRegistration(options = {}) {
  const explicit = normalizeModulesInput(options.modules);
  if (explicit) {
    return { modules: explicit, surface: null, source: 'modules' };
  }

  const surfaceId = options.surface || options.productSurface || null;
  if (surfaceId != null && String(surfaceId).trim()) {
    const preset = getSurfacePreset(surfaceId);
    if (!preset) {
      const err = new Error(
        `Unknown built-in product surface: ${String(surfaceId)}. Known: ${SURFACE_IDS.join(', ')}`
      );
      err.code = 'UNKNOWN_BUILT_IN_SURFACE';
      throw err;
    }
    return {
      modules: preset.defaultModuleKeys.slice(),
      surface: preset.id,
      source: 'surface',
    };
  }

  // Backward-compatible default: project-intelligence only (pre-Track-D host behavior)
  return {
    modules: ['project-intelligence'],
    surface: null,
    source: 'default',
  };
}

function normalizeModulesInput(modules) {
  if (modules == null) return null;
  if (Array.isArray(modules)) {
    if (modules.length === 0) return null;
    return [...new Set(modules.map(m => String(m).trim().toLowerCase()).filter(Boolean))];
  }
  if (typeof modules === 'string' && modules.trim()) {
    return [
      ...new Set(
        modules
          .split(',')
          .map(s => s.trim().toLowerCase())
          .filter(Boolean)
      ),
    ];
  }
  return null;
}

/**
 * Portable JSON document for docs / packaging audits.
 */
function buildProductSurfaceMatrixDocument() {
  return Object.freeze({
    documentVersion: 'zeus-pro.product-surface-matrix/v1',
    surfaces: listSurfacePresets().map(s => ({
      id: s.id,
      label: s.label,
      description: s.description,
      edition: s.edition,
      defaultModuleKeys: s.defaultModuleKeys.slice(),
    })),
    modules: MODULE_SURFACE_ENTRIES.map(e => ({
      key: e.key,
      moduleId: e.moduleId,
      edition: e.edition,
      packageExport: e.packageExport,
      safetyLevel: e.safetyLevel,
      availability: { ...e.availability },
      liveIbmiDefault: e.liveIbmiDefault,
      includedInProfessionalDefault: e.includedInProfessionalDefault,
      includedInEnterpriseDefault: e.includedInEnterpriseDefault,
      summary: e.summary,
      nonClaims: e.nonClaims.slice(),
    })),
    packagingNonClaims: PACKAGING_NON_CLAIMS.slice(),
    knownModuleKeys: MODULE_SURFACE_ENTRIES.map(e => e.key),
  });
}

module.exports = {
  SURFACE_IDS,
  SURFACE_PRESETS,
  MODULE_SURFACE_ENTRIES,
  PACKAGING_NON_CLAIMS,
  listModuleSurfaceEntries,
  getModuleSurfaceEntry,
  listSurfacePresets,
  getSurfacePreset,
  resolveModuleKeysForRegistration,
  buildProductSurfaceMatrixDocument,
};
