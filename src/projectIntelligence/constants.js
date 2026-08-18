'use strict';

/**
 * Zeus Project Intelligence (ZPI) — closed Community contract vocabulary.
 *
 * ZPI-02 freezes contracts, reason codes, and validators only.
 * No store, search, analyzer runtime, CLI, or MCP adapters live here.
 *
 * Package 09 remains closed: no live IBM i compile/execute behavior.
 */

/** Semantic version of the Community project-knowledge contract family. */
const CONTRACT_FAMILY_VERSION = 1;

/**
 * Fact / derivation classes (ADR-011).
 * VERIFIED requires current source-evidence references.
 */
const DERIVATION_CLASSES = Object.freeze({
  VERIFIED: 'VERIFIED',
  INFERRED: 'INFERRED',
  UNRESOLVED: 'UNRESOLVED',
  STALE: 'STALE',
  INVALIDATED: 'INVALIDATED',
});

/** Published-snapshot lifecycle statuses (ADR-012). */
const SNAPSHOT_STATUSES = Object.freeze({
  BUILDING: 'building',
  PUBLISHED: 'published',
  SUPERSEDED: 'superseded',
  INVALIDATED: 'invalidated',
  FAILED: 'failed',
});

/** Analyzer-run terminal statuses. */
const ANALYZER_RUN_STATUSES = Object.freeze({
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  PARTIAL: 'partial',
});

/** Evidence classes — only `source` may underpin VERIFIED facts. */
const EVIDENCE_CLASSES = Object.freeze({
  SOURCE: 'source',
  DERIVED_REFERENCE: 'derived-reference',
});

const DIAGNOSTIC_SEVERITIES = Object.freeze({
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  BLOCKING: 'blocking',
});

/**
 * Baseline symbol kinds for RPG/IBM i project knowledge.
 * Additive kinds may appear later; unknown kinds fail closed in v1 contracts.
 */
const SYMBOL_KINDS = Object.freeze([
  'PROGRAM',
  'MODULE',
  'PROCEDURE',
  'SUBROUTINE',
  'SERVICE_PROGRAM',
  'BINDING_DIRECTORY',
  'COPY_MEMBER',
  'INCLUDE',
  'PROTOTYPE',
  'DATA_STRUCTURE',
  'FILE',
  'TABLE',
  'VIEW',
  'FIELD',
  'CL_COMMAND',
  'SQL_OBJECT',
  'UNRESOLVED_SYMBOL',
]);

/**
 * Baseline relationship types.
 * Unknown types fail closed in v1 contracts.
 */
const RELATIONSHIP_TYPES = Object.freeze([
  'PROGRAM_CALL',
  'BOUND_PROCEDURE_CALL',
  'SUBROUTINE_CALL',
  'COPY_INCLUDE',
  'FILE_READ',
  'FILE_WRITE',
  'TABLE_REFERENCE',
  'FIELD_REFERENCE',
  'SQL_REFERENCE',
  'CL_CALL',
  'SERVICE_PROGRAM_EXPORT',
  'SERVICE_PROGRAM_IMPORT',
  'BINDING_CANDIDATE',
  'DYNAMIC_UNRESOLVED_CALL',
  'DEPENDS_ON',
]);

const CONTENT_HASH_ALGORITHMS = Object.freeze(['sha256']);

const SAFETY_LEVELS = Object.freeze(['S0', 'S1', 'S2', 'S3', 'S4']);

/**
 * Closed fail-closed reason-code catalog for project-intelligence operations.
 * Messages must remain redacted / free of secrets and host paths when surfaced.
 */
const REASON_CODES = Object.freeze({
  // Contract validation
  SCHEMA_INVALID: 'ZPI.SCHEMA_INVALID',
  SCHEMA_VERSION_UNSUPPORTED: 'ZPI.SCHEMA_VERSION_UNSUPPORTED',
  UNKNOWN_ENUM_VALUE: 'ZPI.UNKNOWN_ENUM_VALUE',
  PROVENANCE_INVALID: 'ZPI.PROVENANCE_INVALID',
  VERIFIED_WITHOUT_EVIDENCE: 'ZPI.VERIFIED_WITHOUT_EVIDENCE',
  CANONICALITY_VIOLATION: 'ZPI.CANONICALITY_VIOLATION',

  // Project / identity
  PROJECT_NOT_FOUND: 'ZPI.PROJECT_NOT_FOUND',
  PROJECT_ID_INVALID: 'ZPI.PROJECT_ID_INVALID',

  // Snapshot lifecycle
  SNAPSHOT_NOT_FOUND: 'ZPI.SNAPSHOT_NOT_FOUND',
  SNAPSHOT_NOT_PUBLISHED: 'ZPI.SNAPSHOT_NOT_PUBLISHED',
  SNAPSHOT_STALE: 'ZPI.SNAPSHOT_STALE',
  SNAPSHOT_NOT_CURRENT: 'ZPI.SNAPSHOT_NOT_CURRENT',
  SNAPSHOT_IMMUTABLE: 'ZPI.SNAPSHOT_IMMUTABLE',
  PUBLISH_INCOMPLETE: 'ZPI.PUBLISH_INCOMPLETE',
  CURRENT_POINTER_MISMATCH: 'ZPI.CURRENT_POINTER_MISMATCH',
  MIXED_GENERATION: 'ZPI.MIXED_GENERATION',

  // Migrations
  MIGRATION_REQUIRED: 'ZPI.MIGRATION_REQUIRED',
  MIGRATION_UNSUPPORTED: 'ZPI.MIGRATION_UNSUPPORTED',
  MIGRATION_FAILED: 'ZPI.MIGRATION_FAILED',

  // Store / concurrency
  STORE_UNAVAILABLE: 'ZPI.STORE_UNAVAILABLE',
  STORE_CORRUPT: 'ZPI.STORE_CORRUPT',
  STORE_LOCKED: 'ZPI.STORE_LOCKED',
  WRITER_CONFLICT: 'ZPI.WRITER_CONFLICT',
  TRANSACTION_FAILED: 'ZPI.TRANSACTION_FAILED',

  // Content store
  CONTENT_NOT_FOUND: 'ZPI.CONTENT_NOT_FOUND',
  CONTENT_HASH_MISMATCH: 'ZPI.CONTENT_HASH_MISMATCH',
  CONTENT_CORRUPT: 'ZPI.CONTENT_CORRUPT',
  SOURCE_NOT_FOUND: 'ZPI.SOURCE_NOT_FOUND',
  SOURCE_AMBIGUOUS: 'ZPI.SOURCE_AMBIGUOUS',

  // Path / trust
  UNTRUSTED_ROOT: 'ZPI.UNTRUSTED_ROOT',
  PATH_UNSAFE: 'ZPI.PATH_UNSAFE',
  PATH_TRAVERSAL: 'ZPI.PATH_TRAVERSAL',
  PATH_ESCAPE: 'ZPI.PATH_ESCAPE',
  SYMLINK_ESCAPE: 'ZPI.SYMLINK_ESCAPE',

  // Resource bounds
  SOURCE_TOO_LARGE: 'ZPI.SOURCE_TOO_LARGE',
  PROJECT_TOO_LARGE: 'ZPI.PROJECT_TOO_LARGE',
  RESULT_LIMIT_EXCEEDED: 'ZPI.RESULT_LIMIT_EXCEEDED',
  TOKEN_BUDGET_EXCEEDED: 'ZPI.TOKEN_BUDGET_EXCEEDED',

  // Search index
  INDEX_UNAVAILABLE: 'ZPI.INDEX_UNAVAILABLE',
  INDEX_CORRUPT: 'ZPI.INDEX_CORRUPT',
  INDEX_REBUILD_REQUIRED: 'ZPI.INDEX_REBUILD_REQUIRED',
  INDEX_SCHEMA_MISMATCH: 'ZPI.INDEX_SCHEMA_MISMATCH',

  // Retrieval / context
  EVIDENCE_MISSING: 'ZPI.EVIDENCE_MISSING',
  EVIDENCE_STALE: 'ZPI.EVIDENCE_STALE',
  RETRIEVAL_FAILED: 'ZPI.RETRIEVAL_FAILED',
  CONTEXT_ASSEMBLY_FAILED: 'ZPI.CONTEXT_ASSEMBLY_FAILED',
  OMISSION_REPORTED: 'ZPI.OMISSION_REPORTED',

  // Safety / export
  POLICY_DENIED: 'ZPI.POLICY_DENIED',
  EXPORT_DENIED: 'ZPI.EXPORT_DENIED',
  REDACTION_REQUIRED: 'ZPI.REDACTION_REQUIRED',
  SECRET_LIKE_CONTENT: 'ZPI.SECRET_LIKE_CONTENT',

  // Capability boundary (Community may surface absence without entitlement logic)
  CAPABILITY_UNAVAILABLE: 'ZPI.CAPABILITY_UNAVAILABLE',
  ENTITLEMENT_REQUIRED: 'ZPI.ENTITLEMENT_REQUIRED',

  // Generic fail-closed
  OPERATION_UNAVAILABLE: 'ZPI.OPERATION_UNAVAILABLE',
  INTERNAL_ERROR: 'ZPI.INTERNAL_ERROR',
});

/** Stable human-safe messages for public reason codes (no secrets/paths). */
const REASON_CODE_MESSAGES = Object.freeze({
  [REASON_CODES.SCHEMA_INVALID]: 'Project knowledge contract validation failed',
  [REASON_CODES.SCHEMA_VERSION_UNSUPPORTED]: 'Unsupported project knowledge schema version',
  [REASON_CODES.UNKNOWN_ENUM_VALUE]: 'Unknown closed enum value in project knowledge contract',
  [REASON_CODES.PROVENANCE_INVALID]: 'Provenance is missing required fields or is invalid',
  [REASON_CODES.VERIFIED_WITHOUT_EVIDENCE]: 'VERIFIED facts require current source evidence',
  [REASON_CODES.CANONICALITY_VIOLATION]:
    'Derived artifact must not claim source-of-truth authority',
  [REASON_CODES.PROJECT_NOT_FOUND]: 'Project was not found',
  [REASON_CODES.PROJECT_ID_INVALID]: 'Project identity is invalid',
  [REASON_CODES.SNAPSHOT_NOT_FOUND]: 'Snapshot was not found',
  [REASON_CODES.SNAPSHOT_NOT_PUBLISHED]: 'Snapshot is not published',
  [REASON_CODES.SNAPSHOT_STALE]: 'Snapshot is stale relative to current sources',
  [REASON_CODES.SNAPSHOT_NOT_CURRENT]: 'Snapshot is not the current published pointer',
  [REASON_CODES.SNAPSHOT_IMMUTABLE]: 'Published snapshots are immutable',
  [REASON_CODES.PUBLISH_INCOMPLETE]: 'Snapshot publish did not complete atomically',
  [REASON_CODES.CURRENT_POINTER_MISMATCH]: 'Current snapshot pointer is inconsistent',
  [REASON_CODES.MIXED_GENERATION]: 'Mixed-generation project knowledge state refused',
  [REASON_CODES.MIGRATION_REQUIRED]: 'Store migration is required before open',
  [REASON_CODES.MIGRATION_UNSUPPORTED]: 'Required migration version is unsupported',
  [REASON_CODES.MIGRATION_FAILED]: 'Store migration failed',
  [REASON_CODES.STORE_UNAVAILABLE]: 'Knowledge store is unavailable',
  [REASON_CODES.STORE_CORRUPT]: 'Knowledge store integrity check failed',
  [REASON_CODES.STORE_LOCKED]: 'Knowledge store is locked by another writer',
  [REASON_CODES.WRITER_CONFLICT]: 'Parallel writer rejected',
  [REASON_CODES.TRANSACTION_FAILED]: 'Knowledge store transaction failed',
  [REASON_CODES.CONTENT_NOT_FOUND]: 'Content-addressed evidence was not found',
  [REASON_CODES.CONTENT_HASH_MISMATCH]: 'Content hash does not match stored payload',
  [REASON_CODES.CONTENT_CORRUPT]: 'Content store integrity check failed',
  [REASON_CODES.SOURCE_NOT_FOUND]: 'No source unit matched the requested locator',
  [REASON_CODES.SOURCE_AMBIGUOUS]: 'Multiple source units matched the requested locator',
  [REASON_CODES.UNTRUSTED_ROOT]: 'Path is outside trusted roots',
  [REASON_CODES.PATH_UNSAFE]: 'Path is unsafe for project knowledge storage',
  [REASON_CODES.PATH_TRAVERSAL]: 'Path traversal is not allowed',
  [REASON_CODES.PATH_ESCAPE]: 'Path escapes the trusted root',
  [REASON_CODES.SYMLINK_ESCAPE]: 'Symlink or junction escape is not allowed',
  [REASON_CODES.SOURCE_TOO_LARGE]: 'Source unit exceeds configured size limits',
  [REASON_CODES.PROJECT_TOO_LARGE]: 'Project exceeds configured size limits',
  [REASON_CODES.RESULT_LIMIT_EXCEEDED]: 'Result set exceeds configured bounds',
  [REASON_CODES.TOKEN_BUDGET_EXCEEDED]: 'Context package exceeds token budget',
  [REASON_CODES.INDEX_UNAVAILABLE]: 'Search index is unavailable',
  [REASON_CODES.INDEX_CORRUPT]: 'Search index integrity check failed',
  [REASON_CODES.INDEX_REBUILD_REQUIRED]: 'Search index rebuild is required',
  [REASON_CODES.INDEX_SCHEMA_MISMATCH]: 'Search index schema version mismatch',
  [REASON_CODES.EVIDENCE_MISSING]: 'Required evidence reference is missing',
  [REASON_CODES.EVIDENCE_STALE]: 'Evidence no longer matches current snapshot',
  [REASON_CODES.RETRIEVAL_FAILED]: 'Retrieval operation failed',
  [REASON_CODES.CONTEXT_ASSEMBLY_FAILED]: 'Context package assembly failed',
  [REASON_CODES.OMISSION_REPORTED]: 'Material was omitted under explicit budget or policy',
  [REASON_CODES.POLICY_DENIED]: 'Project knowledge policy denied the operation',
  [REASON_CODES.EXPORT_DENIED]: 'Export or disclosure is denied by policy',
  [REASON_CODES.REDACTION_REQUIRED]: 'Redaction is required before disclosure',
  [REASON_CODES.SECRET_LIKE_CONTENT]: 'Secret-like content was refused',
  [REASON_CODES.CAPABILITY_UNAVAILABLE]: 'Project intelligence capability is unavailable',
  [REASON_CODES.ENTITLEMENT_REQUIRED]: 'Entitlement is required for this capability',
  [REASON_CODES.OPERATION_UNAVAILABLE]: 'Project intelligence operation is unavailable',
  [REASON_CODES.INTERNAL_ERROR]: 'Internal project intelligence error',
});

const DEFAULT_LIMITS = Object.freeze({
  maxIdChars: 256,
  maxNameChars: 512,
  maxPathChars: 2048,
  maxMessageChars: 4000,
  maxSummaryChars: 16000,
  maxArrayItems: 10000,
  maxEvidenceRefs: 1000,
  maxOmissions: 1000,
  sha256HexLength: 64,
});

module.exports = {
  CONTRACT_FAMILY_VERSION,
  DERIVATION_CLASSES,
  SNAPSHOT_STATUSES,
  ANALYZER_RUN_STATUSES,
  EVIDENCE_CLASSES,
  DIAGNOSTIC_SEVERITIES,
  SYMBOL_KINDS,
  RELATIONSHIP_TYPES,
  CONTENT_HASH_ALGORITHMS,
  SAFETY_LEVELS,
  REASON_CODES,
  REASON_CODE_MESSAGES,
  DEFAULT_LIMITS,
};
