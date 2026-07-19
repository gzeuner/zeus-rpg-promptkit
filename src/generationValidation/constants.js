'use strict';

/**
 * Generation Validation Foundation (Iteration 29) — status and diagnostic vocabulary.
 *
 * Status meanings (Community safety baseline, not correctness/compile claims):
 * - invalid: candidate fails schema/contract structure
 * - denied: safety/policy rejects the candidate
 * - validation-failed: one or more blocking validator diagnostics
 * - unsupported: required local check cannot run for the declared artifact kind
 * - internal-validator-failure: a validator threw or returned unusable output
 * - review-ready: all required checks passed; still not compiled, approved, or deployable
 */

const STATUS = Object.freeze({
  INVALID: 'invalid',
  DENIED: 'denied',
  VALIDATION_FAILED: 'validation-failed',
  UNSUPPORTED: 'unsupported',
  INTERNAL_VALIDATOR_FAILURE: 'internal-validator-failure',
  REVIEW_READY: 'review-ready',
});

const SEVERITY = Object.freeze({
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  BLOCKING: 'blocking',
});

const FILE_ACTIONS = Object.freeze(['create', 'modify', 'delete', 'rename']);

const ALLOWED_FILE_EXTENSIONS = Object.freeze([
  '.rpgle',
  '.sqlrpgle',
  '.rpg',
  '.clle',
  '.clp',
  '.pf',
  '.lf',
  '.dspf',
  '.prtf',
  '.sql',
  '.bnd',
  '.txt',
  '.md',
  '.json',
]);

const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 32,
  maxContentBytes: 256 * 1024,
  maxTotalContentBytes: 1024 * 1024,
  maxTaskSummaryChars: 4000,
  maxRationaleChars: 4000,
});

const DIAGNOSTIC_IDS = Object.freeze({
  SCHEMA_INVALID: 'GENVAL.SCHEMA_INVALID',
  CONTRACT_VERSION_UNSUPPORTED: 'GENVAL.CONTRACT_VERSION_UNSUPPORTED',
  PATH_UNSAFE: 'GENVAL.PATH_UNSAFE',
  PATH_OUTSIDE_WORKSPACE: 'GENVAL.PATH_OUTSIDE_WORKSPACE',
  PATH_OUTSIDE_SCOPE: 'GENVAL.PATH_OUTSIDE_SCOPE',
  FILE_TYPE_DENIED: 'GENVAL.FILE_TYPE_DENIED',
  CONTENT_TOO_LARGE: 'GENVAL.CONTENT_TOO_LARGE',
  TOTAL_CONTENT_TOO_LARGE: 'GENVAL.TOTAL_CONTENT_TOO_LARGE',
  TOO_MANY_FILES: 'GENVAL.TOO_MANY_FILES',
  DUPLICATE_TARGET: 'GENVAL.DUPLICATE_TARGET',
  UNDECLARED_FILE: 'GENVAL.UNDECLARED_FILE',
  EVIDENCE_MISSING: 'GENVAL.EVIDENCE_MISSING',
  EVIDENCE_UNKNOWN: 'GENVAL.EVIDENCE_UNKNOWN',
  EVIDENCE_TYPE_MISMATCH: 'GENVAL.EVIDENCE_TYPE_MISMATCH',
  POLICY_DENIED: 'GENVAL.POLICY_DENIED',
  SCOPE_EXPANSION: 'GENVAL.SCOPE_EXPANSION',
  STATIC_PARSE_UNSUPPORTED: 'GENVAL.STATIC_PARSE_UNSUPPORTED',
  STATIC_PARSE_FAILED: 'GENVAL.STATIC_PARSE_FAILED',
  VALIDATOR_INTERNAL: 'GENVAL.VALIDATOR_INTERNAL',
  VALIDATOR_MISSING: 'GENVAL.VALIDATOR_MISSING',
  SECRET_LIKE_CONTENT: 'GENVAL.SECRET_LIKE_CONTENT',
});

module.exports = {
  STATUS,
  SEVERITY,
  FILE_ACTIONS,
  ALLOWED_FILE_EXTENSIONS,
  DEFAULT_LIMITS,
  DIAGNOSTIC_IDS,
};
