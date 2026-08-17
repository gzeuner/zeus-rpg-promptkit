'use strict';

/**
 * Db2 Test Intelligence vocabulary for the unified public package.
 * Private request/result contracts; never a public Community PR surface.
 */

const REQUEST_CONTRACT_ID = 'zeus-pro.db2-test-intelligence-request';
const REQUEST_CONTRACT_VERSION = 1;
const REQUEST_CONTRACT_REF = `${REQUEST_CONTRACT_ID}@${REQUEST_CONTRACT_VERSION}`;

const RESULT_CONTRACT_ID = 'zeus-pro.db2-test-vector-set';
const RESULT_CONTRACT_VERSION = 1;
const RESULT_CONTRACT_REF = `${RESULT_CONTRACT_ID}@${RESULT_CONTRACT_VERSION}`;

const MODULE_ID = 'zeus-pro.db2-test-intelligence';
const CAPABILITY_ID = 'zeus-pro.db2-test-intelligence.generate';
const MODULE_VERSION = '0.1.0';

/** Exact pinned Community merge commit this commercial module is reviewed against. */
const PINNED_COMMUNITY_SHA = '84822a68309f123c43e848c7ed2158853364fd46';

/** Max chars materialized for CHAR/VARCHAR boundary vectors (exact declared length). */
const MAX_STRING_MATERIALIZE_CHARS = 256;

/** Closed capability/result reason codes — never raw errors, paths, licenses, or stacks. */
const REASON_CODES = Object.freeze({
  OK: 'OK',
  ENTITLEMENT_DENIED: 'ENTITLEMENT_DENIED',
  INPUT_INVALID: 'INPUT_INVALID',
  BOUNDS_EXCEEDED: 'BOUNDS_EXCEEDED',
  SEMANTIC_OVERFLOW: 'SEMANTIC_OVERFLOW',
  ARTIFACT_WRITE_FAILED: 'ARTIFACT_WRITE_FAILED',
  ARTIFACT_PATH_INVALID: 'ARTIFACT_PATH_INVALID',
  ARTIFACT_COLLISION: 'ARTIFACT_COLLISION',
  ARTIFACT_READ_FAILED: 'ARTIFACT_READ_FAILED',
  ARTIFACT_TAMPERED: 'ARTIFACT_TAMPERED',
  ARTIFACT_INCOMPLETE: 'ARTIFACT_INCOMPLETE',
  INTERNAL_FAILURE: 'INTERNAL_FAILURE',
});

const SUPPORT_STATUS = Object.freeze({
  SUPPORTED: 'supported',
  UNSUPPORTED: 'unsupported',
  MISSING_EVIDENCE: 'missing-evidence',
  UNKNOWN_BUSINESS_VALIDITY: 'unknown-business-validity',
});

const GAP_KINDS = Object.freeze({
  MISSING_DEFAULT: 'missing-default',
  MISSING_CHECK: 'missing-check',
  UNSUPPORTED_CHECK: 'unsupported-check',
  MISSING_UNIQUE: 'missing-unique',
  MISSING_COMPOSITE_KEY: 'missing-composite-key',
  UNSUPPORTED_CCSID: 'unsupported-ccsid',
  UNSUPPORTED_COLLATION: 'unsupported-collation',
  UNKNOWN_BUSINESS: 'unknown-business-behavior',
  UNSUPPORTED_TYPE: 'unsupported-type',
  LIMIT_EXCEEDED: 'limit-exceeded',
  MISSING_EVIDENCE: 'missing-evidence',
  UNSUPPORTED_LITERAL: 'unsupported-literal',
  MATERIALIZATION_LIMIT: 'materialization-limit',
  UNKNOWN_COLUMN: 'unknown-column',
  INVALID_DECIMAL_META: 'invalid-decimal-metadata',
  TEMPORAL_PRECISION: 'temporal-precision-unknown',
  MALFORMED_FK: 'malformed-foreign-key',
});

const VECTOR_CATEGORIES = Object.freeze({
  NULLABILITY: 'nullability',
  STRING_LENGTH: 'string-length',
  DECIMAL_BOUNDARY: 'decimal-boundary',
  TEMPORAL_BOUNDARY: 'temporal-boundary',
  PRIMARY_KEY: 'primary-key',
  FOREIGN_KEY: 'foreign-key',
  UNIQUE_KEY: 'unique-key',
  CHECK_CONSTRAINT: 'check-constraint',
  CODE_CONDITION: 'code-condition',
  MANUAL_RULE: 'manual-rule',
  TYPE_BOUNDARY: 'type-boundary',
  GAP: 'gap',
});

const EXPECTED_OUTCOMES = Object.freeze({
  ACCEPT: 'accept',
  REJECT: 'reject',
  UNKNOWN: 'unknown',
});

const PROVENANCE_KINDS = Object.freeze({
  CATALOG: 'catalog',
  CODE: 'code',
  MANUAL: 'manual',
  DERIVED: 'derived',
});

const NON_CLAIMS = Object.freeze({
  databaseExecuted: false,
  programExecuted: false,
  compiled: false,
  productionValidated: false,
  businessCorrect: false,
});

/** Hard bounds — +1 must fail before expensive work. Lower is allowed with justification. */
const LIMITS = Object.freeze({
  maxRawInputBytes: 2 * 1024 * 1024,
  maxTraversalDepth: 16,
  maxPropertyVisits: 50_000,
  maxTables: 64,
  maxColumnsPerTable: 256,
  maxConstraintsTotal: 1024,
  maxCodeConditions: 512,
  maxManualRules: 256,
  maxIdentifierChars: 256,
  maxExpressionUtf8Bytes: 4096,
  maxRationaleUtf8Bytes: 4096,
  maxParserTokens: 512,
  maxParserNesting: 8,
  maxInListSize: 64,
  maxVectors: 4096,
  maxProvenanceReasonsPerVector: 32,
  maxDiagnostics: 512,
  maxGaps: 512,
  maxCanonicalJsonBytes: 8 * 1024 * 1024,
  maxMarkdownBytes: 8 * 1024 * 1024,
  maxFrameworkOutputBytes: 8 * 1024 * 1024,
  maxAggregateArtifactBytes: 16 * 1024 * 1024,
  maxRunIdChars: 80,
  maxManualLiteralChars: 128,
  maxSourceEvidencePerTable: 64,
  maxAdapterIdChars: 128,
  maxAdapterVersionChars: 64,
  maxStringMaterializeChars: MAX_STRING_MATERIALIZE_CHARS,
});

const ARTIFACT_FILES = Object.freeze({
  CANONICAL: 'db2-test-vector-set.json',
  MARKDOWN: 'db2-test-vectors.md',
  JUNIT: 'db2-test-vectors.junit.xml',
  ROBOT: 'db2-test-vectors.robot',
  MANIFEST: 'manifest.json',
});

const FRAMEWORK_IDS = Object.freeze(['junit-xml', 'robot-framework']);

const MANIFEST_KIND = 'db2-test-intelligence-artifact-manifest';

/** Own-data property names that look like row/sample/customer payload surfaces. */
const FORBIDDEN_ROW_LIKE_KEYS = Object.freeze([
  'rows',
  'row',
  'sample',
  'samples',
  'sampleRows',
  'sampleData',
  'rowData',
  'records',
  'record',
  'resultSet',
  'resultset',
  'dataRows',
  'customer',
  'customers',
  'person',
  'persons',
  'people',
  'account',
  'accounts',
  'organization',
  'organizations',
  'org',
  'orgs',
  'customerId',
  'accountNumber',
  'ssn',
  'email',
  'phone',
]);

const DANGEROUS_KEYS = Object.freeze(['__proto__', 'prototype', 'constructor']);

module.exports = {
  REQUEST_CONTRACT_ID,
  REQUEST_CONTRACT_VERSION,
  REQUEST_CONTRACT_REF,
  RESULT_CONTRACT_ID,
  RESULT_CONTRACT_VERSION,
  RESULT_CONTRACT_REF,
  MODULE_ID,
  CAPABILITY_ID,
  MODULE_VERSION,
  PINNED_COMMUNITY_SHA,
  MAX_STRING_MATERIALIZE_CHARS,
  REASON_CODES,
  SUPPORT_STATUS,
  GAP_KINDS,
  VECTOR_CATEGORIES,
  EXPECTED_OUTCOMES,
  PROVENANCE_KINDS,
  NON_CLAIMS,
  LIMITS,
  ARTIFACT_FILES,
  FRAMEWORK_IDS,
  MANIFEST_KIND,
  FORBIDDEN_ROW_LIKE_KEYS,
  DANGEROUS_KEYS,
};
