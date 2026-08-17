'use strict';

/**
 * Generation Assurance vocabulary for the unified public package.
 * Uses Community generation-candidate@1 and validation-report contracts only.
 */

const CONTRACT_ID = 'zeus-pro.generation-assurance-attempt-history';
const CONTRACT_VERSION = 1;
const CONTRACT_REF = `${CONTRACT_ID}@${CONTRACT_VERSION}`;

const MODULE_ID = 'zeus-pro.generation-assurance';
const CAPABILITY_ID = 'zeus-pro.generation-assurance.run';
const MODULE_VERSION = '0.1.0';

/** Closed stop codes — no open-ended product vocabulary. */
const STOP_CODES = Object.freeze({
  REVIEW_READY: 'REVIEW_READY',
  INITIAL_NOT_REPAIRABLE: 'INITIAL_NOT_REPAIRABLE',
  ENTITLEMENT_DENIED: 'ENTITLEMENT_DENIED',
  PROVIDER_POLICY_DENIED: 'PROVIDER_POLICY_DENIED',
  PROVIDER_FAILED: 'PROVIDER_FAILED',
  PROVIDER_OUTPUT_INVALID: 'PROVIDER_OUTPUT_INVALID',
  SCOPE_EXPANSION: 'SCOPE_EXPANSION',
  POLICY_DENIED: 'POLICY_DENIED',
  VALIDATOR_INTERNAL_FAILURE: 'VALIDATOR_INTERNAL_FAILURE',
  DIAGNOSTICS_LIMIT_EXCEEDED: 'DIAGNOSTICS_LIMIT_EXCEEDED',
  IDENTICAL_DIAGNOSTICS: 'IDENTICAL_DIAGNOSTICS',
  CHANGED_NOT_IMPROVED: 'CHANGED_NOT_IMPROVED',
  WORSENING_RESULT: 'WORSENING_RESULT',
  MAX_ATTEMPTS: 'MAX_ATTEMPTS',
  CANCELLED: 'CANCELLED',
});

/** Lower is better. review-ready is best. */
const STATUS_RANK = Object.freeze({
  'review-ready': 0,
  'validation-failed': 1,
  unsupported: 2,
  invalid: 3,
  'internal-validator-failure': 4,
  denied: 5,
});

const SEVERITY_RANK = Object.freeze({
  blocking: 0,
  error: 1,
  warning: 2,
  info: 3,
});

const LIMITS = Object.freeze({
  maxAttempts: 3, // indices 0..2 inclusive
  maxProviderInvocations: 2, // attempts 1 and 2 only
  maxDiagnostics: 256,
  maxNormalizedMessageChars: 500,
  maxTaskSummaryChars: 4000,
  maxContentBytesPerFile: 256 * 1024,
  maxTotalContentBytes: 1024 * 1024,
  maxFiles: 32,
  maxAuthorizedLocations: 64,
  maxEvidenceReferences: 64,
  maxProviderOutputBytes: 128 * 1024,
  // Worst-case history keeps both the sanitized report and canonical projection:
  // 3 attempts * 256 diagnostics * 2 projections * 500 Unicode chars (up to
  // 4 UTF-8 bytes each) is ~3 MiB before bounded candidate/report metadata.
  maxHistoryJsonBytes: 8 * 1024 * 1024,
  maxCorrelationIdChars: 128,
});

const DISPOSITIONS = Object.freeze({
  BASELINE: 'baseline',
  PROVIDER_REPAIR: 'provider-repair',
  STOPPED: 'stopped',
});

const NON_CLAIMS = Object.freeze({
  compiled: false,
  approved: false,
  deployable: false,
  workspaceMutated: false,
  functionallyCorrect: false,
  ibmITested: false,
});

module.exports = {
  CONTRACT_ID,
  CONTRACT_VERSION,
  CONTRACT_REF,
  MODULE_ID,
  CAPABILITY_ID,
  MODULE_VERSION,
  STOP_CODES,
  STATUS_RANK,
  SEVERITY_RANK,
  LIMITS,
  DISPOSITIONS,
  NON_CLAIMS,
};
