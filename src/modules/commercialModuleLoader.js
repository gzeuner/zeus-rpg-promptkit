'use strict';

/**
 * Explicit commercial module loader for host/CLI/MCP wiring (ADR-006).
 *
 * Community never ships paid handlers. The host may pass an explicit package
 * name or filesystem path; this loader requires that package and calls its
 * public `registerWithZeus(zeus, options)` entry if present.
 *
 * Operator sources (highest precedence first):
 * 1. CLI / API options (`--commercial-module`, modulePath, …)
 * 2. process env (`ZEUS_COMMERCIAL_MODULE`, license path envs)
 * 3. explicit profile field `profile.commercial` when `--profile` is set
 *
 * Not a marketplace, directory scan, or automatic discovery surface.
 */

const fs = require('fs');
const path = require('path');

const LOADER_REASON_CODES = Object.freeze({
  NOT_CONFIGURED: 'COMMERCIAL_MODULE_NOT_CONFIGURED',
  PATH_INVALID: 'COMMERCIAL_MODULE_PATH_INVALID',
  LOAD_FAILED: 'COMMERCIAL_MODULE_LOAD_FAILED',
  ENTRY_MISSING: 'COMMERCIAL_MODULE_REGISTER_ENTRY_MISSING',
  REGISTER_FAILED: 'COMMERCIAL_MODULE_REGISTER_FAILED',
  ZEUS_REQUIRED: 'COMMERCIAL_MODULE_ZEUS_REQUIRED',
  PROFILE_INVALID: 'COMMERCIAL_MODULE_PROFILE_INVALID',
});

const COMMERCIAL_CONFIG_SOURCES = Object.freeze({
  OPTIONS: 'options',
  ENV: 'env',
  PROFILE: 'profile',
  NONE: 'none',
});

function redactMessage(value) {
  return String(value || '')
    .replace(/[A-Za-z]:\\[^\s"']+/g, '<redacted-path>')
    .replace(/\/(?:Users|home)\/[^\s"']+/g, '<redacted-path>')
    .replace(/(password|secret|token|license)\s*[:=]\s*\S+/gi, '$1=<redacted>');
}

function resolveModuleSpec(spec) {
  if (typeof spec !== 'string' || !spec.trim()) return null;
  const raw = spec.trim();
  if (path.isAbsolute(raw)) {
    return { kind: 'path', target: path.resolve(raw) };
  }
  // Relative path (operator-provided)
  if (raw.startsWith('.') || raw.includes('/') || raw.includes('\\')) {
    return { kind: 'path', target: path.resolve(process.cwd(), raw) };
  }
  // Node package name (must already be installed/resolvable by the host)
  return { kind: 'package', target: raw };
}

function readJsonFile(filePath, label) {
  const abs = path.resolve(filePath);
  const text = fs.readFileSync(abs, 'utf8');
  try {
    return JSON.parse(text);
  } catch (err) {
    const error = new Error(`${label} is not valid JSON: ${redactMessage(err.message)}`);
    error.code = LOADER_REASON_CODES.PATH_INVALID;
    throw error;
  }
}

function normalizeModulesList(modulesRaw) {
  if (Array.isArray(modulesRaw)) {
    return modulesRaw
      .map(String)
      .map(s => s.trim())
      .filter(Boolean);
  }
  if (typeof modulesRaw === 'string' && modulesRaw.trim()) {
    return modulesRaw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }
  return undefined;
}

/**
 * Extract explicit commercial wiring from a resolved profile object.
 * Only the dedicated `commercial` object is read — no discovery.
 *
 * @param {object|null|undefined} profile
 * @returns {{ module: string|null, modules: string[]|undefined, licenseDocumentPath: string|null, publicKeyPath: string|null }}
 */
function extractCommercialFromProfile(profile) {
  const empty = {
    module: null,
    modules: undefined,
    licenseDocumentPath: null,
    publicKeyPath: null,
  };
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return empty;
  }
  const commercial = profile.commercial;
  if (commercial == null) return empty;
  if (typeof commercial !== 'object' || Array.isArray(commercial)) {
    const error = new Error(
      'profile.commercial must be an object with explicit module / path fields (no auto-discovery).'
    );
    error.code = LOADER_REASON_CODES.PROFILE_INVALID;
    throw error;
  }

  const moduleRaw =
    commercial.module != null
      ? commercial.module
      : commercial.modulePath != null
        ? commercial.modulePath
        : commercial.package != null
          ? commercial.package
          : null;
  const module =
    moduleRaw != null && moduleRaw !== true && String(moduleRaw).trim()
      ? String(moduleRaw).trim()
      : null;

  const licenseDocumentPath =
    commercial.licenseDocumentPath != null && String(commercial.licenseDocumentPath).trim()
      ? String(commercial.licenseDocumentPath).trim()
      : commercial.licensePath != null && String(commercial.licensePath).trim()
        ? String(commercial.licensePath).trim()
        : null;
  const publicKeyPath =
    commercial.publicKeyPath != null && String(commercial.publicKeyPath).trim()
      ? String(commercial.publicKeyPath).trim()
      : commercial.publicKeyPemPath != null && String(commercial.publicKeyPemPath).trim()
        ? String(commercial.publicKeyPemPath).trim()
        : null;

  return {
    module,
    modules: normalizeModulesList(commercial.modules),
    licenseDocumentPath,
    publicKeyPath,
  };
}

/**
 * Load and resolve a named profile for commercial fields only.
 * Failures are returned as soft data so Community-only commands still work
 * when commercial is not required; callers that need hard fail use the code.
 */
function loadProfileCommercialConfig(options = {}, env = process.env) {
  if (options.profile && typeof options.profile === 'object' && !Array.isArray(options.profile)) {
    return {
      ok: true,
      source: COMMERCIAL_CONFIG_SOURCES.PROFILE,
      commercial: extractCommercialFromProfile(options.profile),
      profileName: options.profileName || null,
    };
  }

  const profileNameRaw =
    options.profileName || (options.args && (options.args.profile || options.args.p)) || null;
  if (profileNameRaw == null || profileNameRaw === true) {
    return {
      ok: true,
      source: COMMERCIAL_CONFIG_SOURCES.NONE,
      commercial: null,
      profileName: null,
    };
  }
  const profileName = String(profileNameRaw).trim();
  if (!profileName) {
    return {
      ok: true,
      source: COMMERCIAL_CONFIG_SOURCES.NONE,
      commercial: null,
      profileName: null,
    };
  }

  try {
    const runtimeConfig = options.loadProfiles
      ? { loadProfiles: options.loadProfiles, resolveProfile: options.resolveProfile }
      : require('../config/runtimeConfig');
    const loadProfiles = options.loadProfiles || runtimeConfig.loadProfiles;
    const resolveProfile = options.resolveProfile || runtimeConfig.resolveProfile;
    const cwd = options.cwd || process.cwd();
    const profiles = loadProfiles({ cwd, env, args: options.args || {} });
    const profile = resolveProfile(profiles, profileName, { env });
    return {
      ok: true,
      source: COMMERCIAL_CONFIG_SOURCES.PROFILE,
      commercial: extractCommercialFromProfile(profile),
      profileName,
    };
  } catch (err) {
    return {
      ok: false,
      source: COMMERCIAL_CONFIG_SOURCES.PROFILE,
      commercial: null,
      profileName,
      reasonCode: err && err.code ? err.code : LOADER_REASON_CODES.PROFILE_INVALID,
      message: redactMessage((err && err.message) || 'Failed to resolve profile commercial config'),
    };
  }
}

/**
 * Build entitlement options from explicit CLI/env/profile paths (no secret defaults).
 */
function buildEntitlementOptions(options = {}, env = process.env, profileCommercial = null) {
  const entitlement = {
    ...(options.entitlement && typeof options.entitlement === 'object' ? options.entitlement : {}),
  };

  if (options.licenseDocument != null) {
    entitlement.licenseDocument = options.licenseDocument;
  } else {
    const licPath =
      options.licenseDocumentPath ||
      env.ZEUS_LICENSE_DOCUMENT_PATH ||
      env.ZEUS_COMMERCIAL_LICENSE_PATH ||
      (profileCommercial && profileCommercial.licenseDocumentPath) ||
      null;
    if (licPath) {
      entitlement.licenseDocument = readJsonFile(String(licPath), 'license document');
    }
  }

  if (options.publicKeyPem != null) {
    entitlement.publicKeyPem = options.publicKeyPem;
  } else {
    const keyPath =
      options.publicKeyPath ||
      env.ZEUS_LICENSE_PUBLIC_KEY_PATH ||
      env.ZEUS_COMMERCIAL_PUBLIC_KEY_PATH ||
      (profileCommercial && profileCommercial.publicKeyPath) ||
      null;
    if (keyPath) {
      entitlement.publicKeyPem = fs.readFileSync(path.resolve(String(keyPath)), 'utf8');
    }
  }

  if (options.now != null) entitlement.now = options.now;
  if (options.expectedProductId != null) entitlement.expectedProductId = options.expectedProductId;
  if (options.expectedEdition != null) entitlement.expectedEdition = options.expectedEdition;
  if (options.organizationScope != null) entitlement.organizationScope = options.organizationScope;

  return entitlement;
}

function requireCommercialPackage(spec, _options = {}) {
  const resolved = resolveModuleSpec(spec);
  if (!resolved) {
    return {
      ok: false,
      loaded: false,
      reasonCode: LOADER_REASON_CODES.NOT_CONFIGURED,
      message:
        'No commercial module configured. Set --commercial-module, ZEUS_COMMERCIAL_MODULE, or profile.commercial.module to an explicit package name or path.',
    };
  }

  try {
    if (resolved.kind === 'path') {
      if (!fs.existsSync(resolved.target)) {
        return {
          ok: false,
          loaded: false,
          reasonCode: LOADER_REASON_CODES.PATH_INVALID,
          message: 'Commercial module path does not exist.',
          resolved: '<redacted-path>',
        };
      }
    }
    // Dynamic require of operator-trusted package only (explicit path/name).
    const mod = require(resolved.target);
    if (!mod || typeof mod !== 'object') {
      return {
        ok: false,
        loaded: false,
        reasonCode: LOADER_REASON_CODES.LOAD_FAILED,
        message: 'Commercial module export is not an object.',
      };
    }
    return {
      ok: true,
      loaded: true,
      module: mod,
      resolvedKind: resolved.kind,
      // never echo absolute host paths
      resolved: resolved.kind === 'package' ? resolved.target : '<redacted-path>',
    };
  } catch (err) {
    return {
      ok: false,
      loaded: false,
      reasonCode: LOADER_REASON_CODES.LOAD_FAILED,
      message: redactMessage((err && err.message) || 'Failed to load commercial module'),
    };
  }
}

/**
 * Resolve commercial module spec from options / args / env / profile (explicit only).
 *
 * Precedence: CLI/API options → env → profile.commercial
 */
function resolveCommercialModuleConfig(options = {}, env = process.env) {
  const profileLoad = loadProfileCommercialConfig(options, env);
  const profileCommercial =
    profileLoad.ok && profileLoad.commercial ? profileLoad.commercial : null;

  const fromOptions =
    options.modulePath ||
    options.module ||
    options.commercialModule ||
    (options.args && (options.args['commercial-module'] || options.args.commercialModule));
  const fromEnv = env.ZEUS_COMMERCIAL_MODULE || env.ZEUS_COMMERCIAL_MODULE_PATH;
  const fromProfile = profileCommercial && profileCommercial.module;

  let spec = null;
  let specSource = COMMERCIAL_CONFIG_SOURCES.NONE;
  if (fromOptions != null && fromOptions !== true && String(fromOptions).trim()) {
    spec = String(fromOptions).trim();
    specSource = COMMERCIAL_CONFIG_SOURCES.OPTIONS;
  } else if (fromEnv != null && String(fromEnv).trim()) {
    spec = String(fromEnv).trim();
    specSource = COMMERCIAL_CONFIG_SOURCES.ENV;
  } else if (fromProfile) {
    spec = fromProfile;
    specSource = COMMERCIAL_CONFIG_SOURCES.PROFILE;
  }

  const modulesRaw =
    options.modules ||
    (options.args && options.args['commercial-modules']) ||
    env.ZEUS_COMMERCIAL_MODULES ||
    (profileCommercial && profileCommercial.modules);
  const modules = normalizeModulesList(modulesRaw);

  return {
    spec: spec && String(spec).trim() ? String(spec).trim() : null,
    modules,
    specSource,
    profileName: profileLoad.profileName || null,
    profileCommercial,
    profileLoadOk: profileLoad.ok !== false,
    profileLoadError: profileLoad.ok === false ? profileLoad : null,
  };
}

/**
 * Load commercial package and call registerWithZeus when configured.
 *
 * @param {object} zeus createZeus() instance
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function registerCommercialModules(zeus, options = {}) {
  if (!zeus || typeof zeus !== 'object' || !zeus.modules) {
    return {
      ok: false,
      loaded: false,
      reasonCode: LOADER_REASON_CODES.ZEUS_REQUIRED,
      message: 'createZeus() instance with modules registrar is required.',
    };
  }

  const env = options.env || process.env;
  const resolved = resolveCommercialModuleConfig(options, env);
  const { spec, modules, specSource, profileName, profileCommercial, profileLoadError } = resolved;

  // Profile was requested but failed to resolve, and no higher-precedence module was set.
  if (!spec && profileLoadError) {
    return {
      ok: false,
      loaded: false,
      reasonCode: profileLoadError.reasonCode || LOADER_REASON_CODES.PROFILE_INVALID,
      message: profileLoadError.message || 'Failed to resolve profile commercial config',
      profileName: profileLoadError.profileName || profileName,
      configSource: COMMERCIAL_CONFIG_SOURCES.PROFILE,
    };
  }

  if (!spec) {
    return {
      ok: true,
      loaded: false,
      reasonCode: LOADER_REASON_CODES.NOT_CONFIGURED,
      message:
        'Commercial module not configured (optional). Set --commercial-module, ZEUS_COMMERCIAL_MODULE, or profile.commercial.module. Community engines and capabilities remain available.',
      modules: [],
      configSource: COMMERCIAL_CONFIG_SOURCES.NONE,
      profileName,
    };
  }

  const loaded = requireCommercialPackage(spec, options);
  if (!loaded.ok) {
    return {
      ...loaded,
      configSource: specSource,
      profileName,
    };
  }

  const commercial = loaded.module;
  if (typeof commercial.registerWithZeus !== 'function') {
    return {
      ok: false,
      loaded: true,
      reasonCode: LOADER_REASON_CODES.ENTRY_MISSING,
      message:
        'Commercial package must export registerWithZeus(zeus, options). No paid handlers are loaded from Community.',
      resolved: loaded.resolved,
      configSource: specSource,
      profileName,
    };
  }

  try {
    const entitlement = buildEntitlementOptions(options, env, profileCommercial);
    const registration = await commercial.registerWithZeus(zeus, {
      ...entitlement,
      modules,
      resourcePolicyOverrides: options.resourcePolicyOverrides,
    });
    const ok = registration == null || registration.ok !== false;
    return {
      ok,
      loaded: true,
      reasonCode: ok ? null : LOADER_REASON_CODES.REGISTER_FAILED,
      message: ok
        ? 'Commercial module registration completed.'
        : redactMessage(
            (registration && registration.message) || 'Commercial module registration failed.'
          ),
      resolved: loaded.resolved,
      registration,
      configSource: specSource,
      profileName,
    };
  } catch (err) {
    return {
      ok: false,
      loaded: true,
      reasonCode: LOADER_REASON_CODES.REGISTER_FAILED,
      message: redactMessage((err && err.message) || 'Commercial module registration threw'),
      resolved: loaded.resolved,
      configSource: specSource,
      profileName,
    };
  }
}

/**
 * Create a Zeus host instance and optionally register commercial modules.
 */
async function createHostZeus(options = {}) {
  const { createZeus } = require('../api/zeusApi');
  const create = options.createZeus || createZeus;
  const zeus = create();
  const commercial = await registerCommercialModules(zeus, options);
  return { zeus, commercial };
}

module.exports = {
  LOADER_REASON_CODES,
  COMMERCIAL_CONFIG_SOURCES,
  resolveModuleSpec,
  resolveCommercialModuleConfig,
  extractCommercialFromProfile,
  loadProfileCommercialConfig,
  buildEntitlementOptions,
  requireCommercialPackage,
  registerCommercialModules,
  createHostZeus,
  redactMessage,
};
