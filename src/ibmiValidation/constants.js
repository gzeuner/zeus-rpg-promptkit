'use strict';

/**
 * Owner-gated IBM i S4 validation vocabulary. Live access remains disabled by default.
 * Live IBM i contact is off by default and remains blocked without a complete
 * owner activation pack. Community core is never modified.
 */

const PINNED_COMMUNITY_SHA = '84822a68309f123c43e848c7ed2158853364fd46';

const MODULE_ID = 'zeus-enterprise.ibmi-compile-validation';
const CAPABILITY_ID = 'zeus-enterprise.ibmi-compile-validation.run';
const DIFF_CAPABILITY_ID = 'zeus-enterprise.ibmi-differential-execution.run';
const MODULE_VERSION = '0.1.0';

const COMPILE_EVIDENCE_CONTRACT = 'zeus-enterprise.ibmi-compile-evidence@1';
const DIFF_EVIDENCE_CONTRACT = 'zeus-enterprise.ibmi-diff-evidence@1';

/** Closed compile template vocabulary (aligned with Community bridge IDs). */
const ALLOWED_TEMPLATES = Object.freeze(['crtbndrpg', 'crtrpgmod', 'crtclpgm', 'crtsqlrpgi']);

/** Closed operations — no free-form CL, no model-issued commands. */
const ALLOWED_OPERATIONS = Object.freeze([
  'preflight',
  'stage-source',
  'compile',
  'capture-diagnostics',
  'cleanup',
  'diff-execute-baseline',
  'diff-execute-candidate',
  'diff-compare',
  'snapshot',
  'restore',
]);

/** Profile id reserved for controlled PUB400 synthetic validation. */
const PUB400_PROFILE_ID = 'pub-400';
const PUB400_HOST_LABEL = 'PUB400.COM';

const REASON_CODES = Object.freeze({
  OWNER_GATE_INCOMPLETE: 'OWNER_GATE_INCOMPLETE',
  LIVE_DISABLED: 'LIVE_DISABLED',
  PROFILE_DENIED: 'PROFILE_DENIED',
  TARGET_DENIED: 'TARGET_DENIED',
  OBJECT_EXISTS_REFUSED: 'OBJECT_EXISTS_REFUSED',
  TEMPLATE_DENIED: 'TEMPLATE_DENIED',
  COMMAND_DENIED: 'COMMAND_DENIED',
  OPERATION_DENIED: 'OPERATION_DENIED',
  NAME_INVALID: 'NAME_INVALID',
  CONFIRMATION_INVALID: 'CONFIRMATION_INVALID',
  REDACTION_FAILED: 'REDACTION_FAILED',
  CLEANUP_RESIDUAL: 'CLEANUP_RESIDUAL',
  ENTITLEMENT_DENIED: 'ENTITLEMENT_DENIED',
  INPUT_INVALID: 'INPUT_INVALID',
  TIMEOUT: 'TIMEOUT',
  TRANSPORT_DENIED: 'TRANSPORT_DENIED',
  APPROVAL_BLOCKED: 'APPROVAL_BLOCKED',
  OUTPUT_MISMATCH: 'OUTPUT_MISMATCH',
  SIDE_EFFECT_EXTRA: 'SIDE_EFFECT_EXTRA',
  SIDE_EFFECT_MISSING: 'SIDE_EFFECT_MISSING',
  INVENTORY_VIOLATION: 'INVENTORY_VIOLATION',
  NONDETERMINISM_SUSPECTED: 'NONDETERMINISM_SUSPECTED',
  OK: 'OK',
});

const MODES = Object.freeze({
  OFFLINE: 'offline',
  DRY_RUN: 'dry-run',
  LIVE: 'live',
});

const LIMITS = Object.freeze({
  maxSources: 16,
  maxSourceBytes: 64 * 1024,
  maxDiagnostics: 256,
  maxDiagnosticMessageChars: 500,
  maxPlanJsonBytes: 256 * 1024,
  maxEvidenceJsonBytes: 1024 * 1024,
  defaultTimeoutMs: 30_000,
  maxTimeoutMs: 120_000,
  maxLibraries: 8,
  maxObjects: 32,
  maxCleanupSteps: 64,
  maxSideEffectClasses: 16,
});

const NON_CLAIMS = Object.freeze({
  deployed: false,
  productionValidated: false,
  businessCorrect: false,
  autonomous: false,
  credentialsBundled: false,
});

const OBJECT_NAME_PATTERN = /^[A-Z][A-Z0-9_$#@]{0,9}$/;

module.exports = {
  PINNED_COMMUNITY_SHA,
  MODULE_ID,
  CAPABILITY_ID,
  DIFF_CAPABILITY_ID,
  MODULE_VERSION,
  COMPILE_EVIDENCE_CONTRACT,
  DIFF_EVIDENCE_CONTRACT,
  ALLOWED_TEMPLATES,
  ALLOWED_OPERATIONS,
  PUB400_PROFILE_ID,
  PUB400_HOST_LABEL,
  REASON_CODES,
  MODES,
  LIMITS,
  NON_CLAIMS,
  OBJECT_NAME_PATTERN,
};
