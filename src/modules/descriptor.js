'use strict';

const {
  DESCRIPTOR_VERSION,
  EDITIONS,
  ENTITLEMENT_MODES,
  RUNTIME_FEATURE_ALLOWLIST,
  SAFETY_LEVELS,
} = require('./constants');
const { parseVersion } = require('./semverRange');

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function redactSecrets(text) {
  return String(text || '')
    .replace(/[A-Za-z]:\\[^\s]+/g, '<redacted-path>')
    .replace(/\/(?:Users|home)\/[^\s]+/g, '<redacted-path>')
    .replace(/(password|secret|token|api[_-]?key|license)\s*[:=]\s*\S+/gi, '$1=<redacted>');
}

/**
 * Validate and normalize a module descriptor v1.
 * Returns { ok:true, descriptor } or { ok:false, errors:[{path,message}] }.
 * Core never enforces commercial licenses from edition/entitlement.mode.
 */
function normalizeModuleDescriptor(raw) {
  const errors = [];
  if (!isPlainObject(raw)) {
    return { ok: false, errors: [{ path: '', message: 'descriptor must be an object' }] };
  }

  // Forbidden material in public descriptors
  for (const key of ['privateKey', 'signingKey', 'licenseKey', 'customerId', 'secret']) {
    if (raw[key] != null) {
      errors.push({ path: `/${key}`, message: 'secrets and license material are not allowed' });
    }
  }

  if (raw.descriptorVersion !== DESCRIPTOR_VERSION) {
    errors.push({
      path: '/descriptorVersion',
      message: `expected ${DESCRIPTOR_VERSION}`,
    });
  }

  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id || !/^[a-z][a-z0-9.-]*\.[a-z0-9.-]+$/i.test(id)) {
    errors.push({
      path: '/id',
      message: 'id must be a stable non-empty namespaced module id (e.g. vendor.module)',
    });
  }
  if (id.includes('..') || id.includes('/') || id.includes('\\')) {
    errors.push({ path: '/id', message: 'id must not encode paths' });
  }

  const version = typeof raw.version === 'string' ? raw.version.trim() : '';
  if (!parseVersion(version)) {
    errors.push({ path: '/version', message: 'version must be a semver string' });
  }

  const edition = typeof raw.edition === 'string' ? raw.edition.trim().toLowerCase() : '';
  if (!EDITIONS.includes(edition)) {
    errors.push({
      path: '/edition',
      message: `edition must be one of ${EDITIONS.join(', ')} (display classification only)`,
    });
  }

  if (!isPlainObject(raw.compatibility) || typeof raw.compatibility.moduleApi !== 'string') {
    errors.push({
      path: '/compatibility/moduleApi',
      message: 'compatibility.moduleApi range is required',
    });
  }

  if (!Array.isArray(raw.capabilities) || raw.capabilities.length === 0) {
    errors.push({ path: '/capabilities', message: 'capabilities must be a non-empty array' });
  } else {
    raw.capabilities.forEach((cap, i) => {
      if (!isPlainObject(cap)) {
        errors.push({ path: `/capabilities/${i}`, message: 'capability must be an object' });
        return;
      }
      if (typeof cap.id !== 'string' || !cap.id.trim()) {
        errors.push({ path: `/capabilities/${i}/id`, message: 'capability id is required' });
      }
      if (!Number.isInteger(Number(cap.version)) || Number(cap.version) < 1) {
        errors.push({
          path: `/capabilities/${i}/version`,
          message: 'capability version must be a positive integer',
        });
      }
    });
  }

  if (!isPlainObject(raw.safety)) {
    errors.push({ path: '/safety', message: 'safety metadata is required' });
  } else {
    if (!SAFETY_LEVELS.includes(String(raw.safety.level || ''))) {
      errors.push({ path: '/safety/level', message: 'safety.level must be S0-S4' });
    }
    if (!Array.isArray(raw.safety.sideEffects) || raw.safety.sideEffects.length === 0) {
      errors.push({
        path: '/safety/sideEffects',
        message: 'safety.sideEffects must be a non-empty array',
      });
    }
  }

  if (!isPlainObject(raw.runtime) || !Array.isArray(raw.runtime.requiredFeatures)) {
    errors.push({
      path: '/runtime/requiredFeatures',
      message: 'runtime.requiredFeatures array is required (may be empty)',
    });
  } else {
    raw.runtime.requiredFeatures.forEach((feat, i) => {
      if (typeof feat !== 'string' || !RUNTIME_FEATURE_ALLOWLIST.includes(feat)) {
        errors.push({
          path: `/runtime/requiredFeatures/${i}`,
          message: `feature must be one of: ${RUNTIME_FEATURE_ALLOWLIST.join(', ')}`,
        });
      }
    });
  }

  let entitlementMode = 'none';
  if (raw.entitlement != null) {
    if (!isPlainObject(raw.entitlement)) {
      errors.push({ path: '/entitlement', message: 'entitlement must be an object when present' });
    } else {
      entitlementMode = typeof raw.entitlement.mode === 'string' ? raw.entitlement.mode.trim() : '';
      if (!ENTITLEMENT_MODES.includes(entitlementMode)) {
        errors.push({
          path: '/entitlement/mode',
          message: 'entitlement.mode must be none or module-managed (display only in core)',
        });
      }
      if (raw.entitlement.key != null || raw.entitlement.signature != null) {
        errors.push({
          path: '/entitlement',
          message: 'license material must not appear in descriptors',
        });
      }
    }
  }

  if (raw.docs != null && !isPlainObject(raw.docs)) {
    errors.push({ path: '/docs', message: 'docs must be an object when present' });
  }

  if (errors.length) return { ok: false, errors };

  const capabilities = raw.capabilities
    .map(cap => ({ id: String(cap.id).trim(), version: Number(cap.version) }))
    .sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version);

  // Duplicate capability ids in one module
  const seen = new Set();
  for (const cap of capabilities) {
    if (seen.has(cap.id)) {
      return {
        ok: false,
        errors: [{ path: '/capabilities', message: `duplicate capability id: ${cap.id}` }],
      };
    }
    seen.add(cap.id);
  }

  const descriptor = {
    descriptorVersion: DESCRIPTOR_VERSION,
    id,
    version,
    edition,
    compatibility: {
      moduleApi: String(raw.compatibility.moduleApi).trim(),
    },
    capabilities,
    safety: {
      level: String(raw.safety.level),
      sideEffects: [...raw.safety.sideEffects].map(String).sort(),
    },
    runtime: {
      requiredFeatures: [...raw.runtime.requiredFeatures].map(String).sort(),
    },
    entitlement: {
      mode: entitlementMode,
    },
    docs: {
      title:
        raw.docs && typeof raw.docs.title === 'string' && raw.docs.title.trim()
          ? redactSecrets(raw.docs.title.trim())
          : id,
      reference:
        raw.docs && typeof raw.docs.reference === 'string' ? String(raw.docs.reference) : null,
    },
  };
  if (!descriptor.docs.reference) delete descriptor.docs.reference;

  return { ok: true, descriptor };
}

function moduleDescriptorSchema(value) {
  const result = normalizeModuleDescriptor(value);
  if (result.ok) return [];
  return result.errors;
}

module.exports = {
  normalizeModuleDescriptor,
  moduleDescriptorSchema,
  redactSecrets,
};
