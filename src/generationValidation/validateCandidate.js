'use strict';

const { createSchemaRegistry } = require('../core/contracts/schemaRegistry');
const { CONTRACT_IDS: CORE_CONTRACT_IDS, INITIAL_SCHEMAS } = require('../core/contracts/schemas');
const { CONTRACT_IDS, GENERATION_SCHEMAS } = require('./contracts');
const { STATUS, SEVERITY } = require('./constants');
const { createValidatorRegistry } = require('./validatorRegistry');
const { createBuiltInValidators } = require('./builtInValidators');
const { extractDeclaredFiles } = require('./extractDeclaredFiles');
const {
  buildReviewDiff,
  buildValidationReport,
  writeReviewArtifacts,
} = require('./reviewArtifacts');

function createDefaultSchemaRegistry() {
  const registry = createSchemaRegistry({ allowRegistrationAfterUse: true });
  for (const [id, def] of Object.entries(INITIAL_SCHEMAS)) {
    registry.register({ id, version: def.version, schema: def.schema });
  }
  for (const [id, def] of Object.entries(GENERATION_SCHEMAS)) {
    try {
      registry.register({ id, version: def.version, schema: def.schema });
    } catch {
      // already registered via INITIAL_SCHEMAS
    }
  }
  return registry;
}

function createDefaultValidatorRegistry(options = {}) {
  const registry = createValidatorRegistry({
    requiredIds: [
      'schema',
      'contract-version',
      'workspace-path',
      'file-type',
      'size-limits',
      'duplicate-target',
      'scope',
      'evidence-reference',
      'policy',
    ],
  });
  for (const validator of createBuiltInValidators(options)) {
    registry.register(validator);
  }
  return registry;
}

function deriveStatus(diagnostics) {
  const list = Array.isArray(diagnostics) ? diagnostics : [];
  const has = idPrefix => list.some(d => String(d.id).startsWith(idPrefix) || d.id === idPrefix);
  if (list.some(d => d.id === 'GENVAL.VALIDATOR_INTERNAL')) {
    return STATUS.INTERNAL_VALIDATOR_FAILURE;
  }
  if (list.some(d => d.id === 'GENVAL.POLICY_DENIED' || d.id === 'GENVAL.SECRET_LIKE_CONTENT')) {
    return STATUS.DENIED;
  }
  if (
    list.some(
      d => d.id === 'GENVAL.SCHEMA_INVALID' || d.id === 'GENVAL.CONTRACT_VERSION_UNSUPPORTED'
    )
  ) {
    return STATUS.INVALID;
  }
  if (
    list.some(d => d.id === 'GENVAL.STATIC_PARSE_UNSUPPORTED' && d.severity === SEVERITY.BLOCKING)
  ) {
    return STATUS.UNSUPPORTED;
  }
  if (
    list.some(
      d =>
        d.severity === SEVERITY.BLOCKING ||
        d.severity === SEVERITY.ERROR ||
        d.id === 'GENVAL.VALIDATOR_MISSING'
    )
  ) {
    return STATUS.VALIDATION_FAILED;
  }
  void has;
  return STATUS.REVIEW_READY;
}

/**
 * Validate a generation candidate offline.
 * Never mutates the source workspace.
 */
async function validateGenerationCandidate(candidate, options = {}) {
  const schemaRegistry = options.schemaRegistry || createDefaultSchemaRegistry();
  const validatorRegistry =
    options.validatorRegistry || createDefaultValidatorRegistry(options.validatorOptions || {});

  // Early schema probe for structured invalid without running everything? Still run all required validators.
  const context = {
    candidate,
    workspaceRoot: options.workspaceRoot || null,
    allowedRelativeRoots: options.allowedRelativeRoots || ['.'],
    declaredScopePaths: options.declaredScopePaths || null,
    evidenceStore: options.evidenceStore || {},
    policy: options.policy || null,
    schemaRegistry,
  };

  const { diagnostics } = await validatorRegistry.runAll(context);
  const status = deriveStatus(diagnostics);
  const extractedFiles = extractDeclaredFiles(candidate);
  const evidenceChecked = Array.isArray(candidate && candidate.evidenceReferences)
    ? candidate.evidenceReferences.map(ref => ({
        id: ref.id,
        kind: ref.kind,
        known: Boolean(options.evidenceStore && options.evidenceStore[ref.id]),
      }))
    : [];

  const report = buildValidationReport({
    candidate,
    status,
    diagnostics,
    extractedFiles,
    evidenceChecked,
    policy: options.policy,
  });

  // Cross-check report against its own schema when registry is available.
  const reportValidation = schemaRegistry.validate(
    CONTRACT_IDS.GENERATION_VALIDATION_REPORT,
    1,
    report
  );
  if (!reportValidation.ok) {
    report.status = STATUS.INTERNAL_VALIDATOR_FAILURE;
    report.reviewReady = false;
    report.diagnostics = [
      ...report.diagnostics,
      {
        id: 'GENVAL.VALIDATOR_INTERNAL',
        severity: SEVERITY.BLOCKING,
        validatorId: 'report-schema',
        validatorVersion: 1,
        path: null,
        message: 'Validation report failed its own schema contract',
      },
    ];
    report.summary = `status=${report.status}; reviewReady=false; report-schema-invalid`;
  }

  const reviewDiff = buildReviewDiff(extractedFiles);
  let written = { written: false, files: [] };
  if (options.reviewArtifactRoot) {
    written = writeReviewArtifacts({
      reviewArtifactRoot: options.reviewArtifactRoot,
      sourceWorkspaceRoot: options.workspaceRoot || null,
      report,
      reviewDiff,
      candidateId: candidate && candidate.candidateId,
    });
  }

  return {
    status: report.status,
    reviewReady: report.reviewReady === true && report.status === STATUS.REVIEW_READY,
    report,
    reviewDiff,
    extractedFiles,
    artifacts: written,
    // Explicit non-claims for consumers and docs parity.
    claims: Object.freeze({
      structurallyValidated: report.reviewReady === true,
      compiled: false,
      functionallyCorrect: false,
      ibmITested: false,
      approved: false,
      deployable: false,
      sourceWorkspaceMutated: false,
    }),
  };
}

module.exports = {
  validateGenerationCandidate,
  createDefaultValidatorRegistry,
  createDefaultSchemaRegistry,
  deriveStatus,
  // re-export for tests
  CORE_CONTRACT_IDS,
};
