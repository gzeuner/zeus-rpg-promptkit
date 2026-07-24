'use strict';

/**
 * Explicit commercial module loader for host/CLI/MCP wiring (ADR-006).
 *
 * Community never ships paid handlers. The host may pass an explicit package
 * name or filesystem path; this loader requires that package and calls its
 * public `registerWithZeus(zeus, options)` entry if present.
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

/**
 * Build entitlement options from explicit CLI/env paths (no secret defaults).
 */
function buildEntitlementOptions(options = {}, env = process.env) {
  const entitlement = {
    ...(options.entitlement && typeof options.entitlement === 'object' ? options.entitlement : {}),
  };

  if (options.licenseDocument != null) {
    entitlement.licenseDocument = options.licenseDocument;
  } else {
    const licPath =
      options.licenseDocumentPath ||
      env.ZEUS_LICENSE_DOCUMENT_PATH ||
      env.ZEUS_COMMERCIAL_LICENSE_PATH;
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
      env.ZEUS_COMMERCIAL_PUBLIC_KEY_PATH;
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
        'No commercial module configured. Set --commercial-module or ZEUS_COMMERCIAL_MODULE to an explicit package name or path.',
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
 * Resolve commercial module spec from options / args / env (explicit only).
 */
function resolveCommercialModuleConfig(options = {}, env = process.env) {
  const fromOptions =
    options.modulePath ||
    options.module ||
    options.commercialModule ||
    (options.args && (options.args['commercial-module'] || options.args.commercialModule));
  const fromEnv = env.ZEUS_COMMERCIAL_MODULE || env.ZEUS_COMMERCIAL_MODULE_PATH;
  const spec = fromOptions != null && fromOptions !== true ? String(fromOptions) : fromEnv;
  const modulesRaw =
    options.modules ||
    (options.args && options.args['commercial-modules']) ||
    env.ZEUS_COMMERCIAL_MODULES;
  let modules;
  if (Array.isArray(modulesRaw)) {
    modules = modulesRaw.map(String);
  } else if (typeof modulesRaw === 'string' && modulesRaw.trim()) {
    modules = modulesRaw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }
  return {
    spec: spec && String(spec).trim() ? String(spec).trim() : null,
    modules,
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
  const { spec, modules } = resolveCommercialModuleConfig(options, env);
  if (!spec) {
    return {
      ok: true,
      loaded: false,
      reasonCode: LOADER_REASON_CODES.NOT_CONFIGURED,
      message:
        'Commercial module not configured (optional). Community engines and capabilities remain available.',
      modules: [],
    };
  }

  const loaded = requireCommercialPackage(spec, options);
  if (!loaded.ok) return loaded;

  const commercial = loaded.module;
  if (typeof commercial.registerWithZeus !== 'function') {
    return {
      ok: false,
      loaded: true,
      reasonCode: LOADER_REASON_CODES.ENTRY_MISSING,
      message:
        'Commercial package must export registerWithZeus(zeus, options). No paid handlers are loaded from Community.',
      resolved: loaded.resolved,
    };
  }

  try {
    const entitlement = buildEntitlementOptions(options, env);
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
    };
  } catch (err) {
    return {
      ok: false,
      loaded: true,
      reasonCode: LOADER_REASON_CODES.REGISTER_FAILED,
      message: redactMessage((err && err.message) || 'Commercial module registration threw'),
      resolved: loaded.resolved,
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
  resolveModuleSpec,
  resolveCommercialModuleConfig,
  buildEntitlementOptions,
  requireCommercialPackage,
  registerCommercialModules,
  createHostZeus,
  redactMessage,
};
