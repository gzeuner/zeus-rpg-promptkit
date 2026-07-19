'use strict';

const { CAPABILITY_SIDE_EFFECTS } = require('../core/safetyMetadata');

const DESCRIPTOR_VERSION = 'zeus.module-descriptor/v1';
const MODULE_API_VERSION = '1.0.0';
const MODULE_STATUS_KIND = 'module-status';

const EDITIONS = Object.freeze(['community', 'professional', 'enterprise']);
const ENTITLEMENT_MODES = Object.freeze(['none', 'module-managed']);

const AVAILABILITY = Object.freeze({
  AVAILABLE: 'available',
  DEGRADED: 'degraded',
  UNAVAILABLE: 'unavailable',
});

/**
 * Fixed redacted public reason codes (ADR-006 + Iteration 30).
 * Core never invents entitlement outcomes; it may only surface codes supplied
 * by an external trusted module or produced by core compatibility checks.
 */
const REASON_CODES = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  NOT_INSTALLED: 'NOT_INSTALLED',
  INCOMPATIBLE_CORE: 'INCOMPATIBLE_CORE',
  DESCRIPTOR_INVALID: 'DESCRIPTOR_INVALID',
  REGISTRATION_FAILED: 'REGISTRATION_FAILED',
  RUNTIME_UNAVAILABLE: 'RUNTIME_UNAVAILABLE',
  POLICY_DENIED: 'POLICY_DENIED',
  ENTITLEMENT_REQUIRED: 'ENTITLEMENT_REQUIRED',
  ENTITLEMENT_EXPIRED: 'ENTITLEMENT_EXPIRED',
  ENTITLEMENT_INVALID: 'ENTITLEMENT_INVALID',
  // ADR-006 aliases kept for documentation parity
  MODULE_API_INCOMPATIBLE: 'MODULE_API_INCOMPATIBLE',
  DUPLICATE_MODULE_ID: 'DUPLICATE_MODULE_ID',
  CAPABILITY_CONFLICT: 'CAPABILITY_CONFLICT',
  RUNTIME_FEATURE_MISSING: 'RUNTIME_FEATURE_MISSING',
  ENTITLEMENT_UNAVAILABLE: 'ENTITLEMENT_UNAVAILABLE',
  MODULE_POLICY_DENIED: 'MODULE_POLICY_DENIED',
  MODULE_INITIALIZATION_FAILED: 'MODULE_INITIALIZATION_FAILED',
  MODULE_DISABLED: 'MODULE_DISABLED',
  MODULE_UNAVAILABLE: 'MODULE_UNAVAILABLE',
});

const LIFECYCLE = Object.freeze({
  DECLARED: 'declared',
  VALIDATING: 'validating',
  REGISTERED: 'registered',
  REJECTED: 'rejected',
});

const RUNTIME_FEATURE_ALLOWLIST = Object.freeze([
  'local-filesystem',
  'local-process',
  'node-crypto',
  'offline-only',
]);

const SAFETY_LEVELS = Object.freeze(['S0', 'S1', 'S2', 'S3', 'S4']);

module.exports = {
  DESCRIPTOR_VERSION,
  MODULE_API_VERSION,
  MODULE_STATUS_KIND,
  EDITIONS,
  ENTITLEMENT_MODES,
  AVAILABILITY,
  REASON_CODES,
  LIFECYCLE,
  RUNTIME_FEATURE_ALLOWLIST,
  SAFETY_LEVELS,
  CAPABILITY_SIDE_EFFECTS,
};
