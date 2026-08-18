'use strict';

const CONTRACT_IDS = require('./contractIds');
const {
  DERIVATION_CLASSES,
  SNAPSHOT_STATUSES,
  ANALYZER_RUN_STATUSES,
  EVIDENCE_CLASSES,
  DIAGNOSTIC_SEVERITIES,
  SYMBOL_KINDS,
  RELATIONSHIP_TYPES,
  SAFETY_LEVELS,
  REASON_CODES,
  DEFAULT_LIMITS,
} = require('./constants');
const h = require('./helpers');

const DERIVATION_VALUES = Object.values(DERIVATION_CLASSES);
const REASON_CODE_VALUES = Object.values(REASON_CODES);

function header(errors, value, expectedKind, expectedContractId) {
  if (!h.requireObject(errors, value, '')) return false;
  h.requireSchemaVersion(errors, value.schemaVersion, 1);
  h.requireKind(errors, value.kind, expectedKind);
  h.requireContractId(errors, value.contractId, expectedContractId);
  return true;
}

function requireProjectSnapshotIds(errors, value) {
  h.requireNonEmptyString(errors, value.projectId, '/projectId');
  h.requireNonEmptyString(errors, value.snapshotId, '/snapshotId');
}

function validateSafety(errors, safety, basePath = '/safety') {
  if (safety == null) return;
  if (!h.requireObject(errors, safety, basePath)) return;
  if (safety.level != null) {
    h.requireClosedEnum(errors, safety.level, `${basePath}/level`, SAFETY_LEVELS, 'safety level');
  }
  if (safety.localOnly != null && typeof safety.localOnly !== 'boolean') {
    h.push(errors, `${basePath}/localOnly`, 'localOnly must be a boolean when present');
  }
  if (safety.sideEffects != null && !Array.isArray(safety.sideEffects)) {
    h.push(errors, `${basePath}/sideEffects`, 'sideEffects must be an array when present');
  }
}

function requireDerivationClass(errors, value, path = '/derivationClass') {
  return h.requireClosedEnum(errors, value, path, DERIVATION_VALUES, 'derivationClass');
}

/**
 * VERIFIED facts must cite at least one evidence reference (ADR-011).
 */
function enforceVerifiedEvidence(errors, derivationClass, evidenceReferences, path) {
  if (derivationClass !== DERIVATION_CLASSES.VERIFIED) return;
  if (!Array.isArray(evidenceReferences) || evidenceReferences.length === 0) {
    h.push(errors, path, 'VERIFIED requires one or more evidenceReferences');
  }
}

// ---------------------------------------------------------------------------
// Entity schemas
// ---------------------------------------------------------------------------

function projectSchema(value) {
  const errors = [];
  if (!header(errors, value, 'project-knowledge-project', CONTRACT_IDS.PROJECT)) return errors;

  h.requireNonEmptyString(errors, value.projectId, '/projectId');
  h.optionalString(errors, value.displayName, '/displayName');

  if (!h.requireArray(errors, value.trustedRoots, '/trustedRoots', { maxItems: 64 })) {
    return errors;
  }
  value.trustedRoots.forEach((root, i) => {
    const base = `/trustedRoots/${i}`;
    if (!h.requireObject(errors, root, base)) return;
    h.requireNonEmptyString(errors, root.rootId, `${base}/rootId`);
    if (root.systemAlias != null) {
      h.optionalString(errors, root.systemAlias, `${base}/systemAlias`, { maxChars: 128 });
      if (typeof root.systemAlias === 'string' && /[\\/\u0000-\u001f]/.test(root.systemAlias)) {
        h.push(
          errors,
          `${base}/systemAlias`,
          'systemAlias must not contain a path or control character'
        );
      }
    }
    // Local-only stores may keep host paths; export contracts must redact separately.
    if (root.canonicalPath != null) {
      h.optionalString(errors, root.canonicalPath, `${base}/canonicalPath`, {
        maxChars: DEFAULT_LIMITS.maxPathChars,
      });
    }
    if (root.relativeLabel != null) {
      h.requireSafeRelativePath(errors, root.relativeLabel, `${base}/relativeLabel`);
    }
  });

  if (value.schemaBindings != null) {
    if (h.requireObject(errors, value.schemaBindings, '/schemaBindings')) {
      h.optionalNonNegativeInteger(
        errors,
        value.schemaBindings.storeSchemaVersion,
        '/schemaBindings/storeSchemaVersion'
      );
      h.optionalNonNegativeInteger(
        errors,
        value.schemaBindings.searchSchemaVersion,
        '/schemaBindings/searchSchemaVersion'
      );
      h.optionalNonNegativeInteger(
        errors,
        value.schemaBindings.artifactSchemaVersion,
        '/schemaBindings/artifactSchemaVersion'
      );
    }
  }

  validateSafety(errors, value.safety);
  return errors;
}

function snapshotSchema(value) {
  const errors = [];
  if (!header(errors, value, 'project-knowledge-snapshot', CONTRACT_IDS.SNAPSHOT)) return errors;

  requireProjectSnapshotIds(errors, value);
  h.requireClosedEnum(errors, value.status, '/status', Object.values(SNAPSHOT_STATUSES), 'status');
  h.requireContentHash(errors, value.sourceInventoryHash, '/sourceInventoryHash');
  h.requirePositiveInteger(errors, value.storeSchemaVersion, '/storeSchemaVersion');
  h.requirePositiveInteger(errors, value.searchSchemaVersion, '/searchSchemaVersion');
  h.requirePositiveInteger(errors, value.artifactSchemaVersion, '/artifactSchemaVersion');

  if (value.isCurrent != null && typeof value.isCurrent !== 'boolean') {
    h.push(errors, '/isCurrent', 'isCurrent must be a boolean when present');
  }
  if (value.contentAddressing != null) {
    if (h.requireObject(errors, value.contentAddressing, '/contentAddressing')) {
      h.requireHashAlgorithm(
        errors,
        value.contentAddressing.algorithm,
        '/contentAddressing/algorithm'
      );
    }
  }
  if (value.analyzerRunIds != null) {
    if (h.optionalArray(errors, value.analyzerRunIds, '/analyzerRunIds')) {
      value.analyzerRunIds.forEach((id, i) => {
        h.requireNonEmptyString(errors, id, `/analyzerRunIds/${i}`);
      });
    }
  }
  h.optionalString(errors, value.publishedAt, '/publishedAt', { maxChars: 64 });
  validateSafety(errors, value.safety);
  return errors;
}

function sourceUnitSchema(value) {
  const errors = [];
  if (!header(errors, value, 'project-knowledge-source-unit', CONTRACT_IDS.SOURCE_UNIT)) {
    return errors;
  }

  requireProjectSnapshotIds(errors, value);
  h.requireNonEmptyString(errors, value.sourceUnitId, '/sourceUnitId');
  h.requireSafeRelativePath(errors, value.relativePath, '/relativePath');
  h.requireContentHash(errors, value.contentHash, '/contentHash');
  h.requireNonEmptyString(errors, value.trustedRootId, '/trustedRootId');
  h.optionalString(errors, value.language, '/language', { maxChars: 64 });
  h.optionalString(errors, value.mediaType, '/mediaType', { maxChars: 128 });
  h.optionalNonNegativeInteger(errors, value.sizeBytes, '/sizeBytes');
  h.requireHashAlgorithm(errors, value.hashAlgorithm, '/hashAlgorithm');
  if (value.rawBytesHash != null) h.requireContentHash(errors, value.rawBytesHash, '/rawBytesHash');
  if (value.provenanceHash != null)
    h.requireContentHash(errors, value.provenanceHash, '/provenanceHash');
  if (value.importObservationHash != null) {
    h.requireContentHash(errors, value.importObservationHash, '/importObservationHash');
  }
  if (value.origin != null && h.requireObject(errors, value.origin, '/origin')) {
    const allowedOriginKeys = new Set([
      'systemAlias',
      'sourceLib',
      'sourceFile',
      'member',
      'memberPath',
      'fetchedAt',
      'sourceType',
    ]);
    for (const key of Object.keys(value.origin)) {
      if (!allowedOriginKeys.has(key)) {
        h.push(errors, `/origin/${key}`, 'origin contains an unsupported or sensitive field');
      }
    }
    for (const key of ['systemAlias', 'sourceLib', 'sourceFile', 'member', 'sourceType']) {
      h.optionalString(errors, value.origin[key], `/origin/${key}`, { maxChars: 128 });
      if (
        typeof value.origin[key] === 'string' &&
        value.origin[key] &&
        !/^[A-Za-z0-9_$#@.\-]+$/.test(value.origin[key])
      ) {
        h.push(errors, `/origin/${key}`, `${key} contains unsupported characters`);
      }
    }
    h.optionalString(errors, value.origin.memberPath, '/origin/memberPath', { maxChars: 512 });
    if (
      typeof value.origin.memberPath === 'string' &&
      value.origin.memberPath &&
      !/^\/QSYS\.LIB\/[A-Z0-9_$#@.\-]+\.LIB\/[A-Z0-9_$#@.\-]+\.FILE\/[A-Z0-9_$#@.\-]+\.MBR$/.test(
        value.origin.memberPath
      )
    ) {
      h.push(errors, '/origin/memberPath', 'memberPath must be a canonical IBM i member path');
    }
    h.optionalString(errors, value.origin.fetchedAt, '/origin/fetchedAt', { maxChars: 64 });
    if (
      typeof value.origin.fetchedAt === 'string' &&
      value.origin.fetchedAt &&
      Number.isNaN(Date.parse(value.origin.fetchedAt))
    ) {
      h.push(errors, '/origin/fetchedAt', 'fetchedAt must be an ISO timestamp');
    }
  }
  if (value.importedCopyIntegrity != null) {
    if (h.requireObject(errors, value.importedCopyIntegrity, '/importedCopyIntegrity')) {
      for (const key of Object.keys(value.importedCopyIntegrity)) {
        if (!['status', 'reason'].includes(key)) {
          h.push(
            errors,
            `/importedCopyIntegrity/${key}`,
            'importedCopyIntegrity contains an unsupported field'
          );
        }
      }
      h.requireClosedEnum(
        errors,
        value.importedCopyIntegrity.status,
        '/importedCopyIntegrity/status',
        ['fresh', 'stale', 'unknown'],
        'importedCopyIntegrity.status'
      );
      h.optionalString(
        errors,
        value.importedCopyIntegrity.reason,
        '/importedCopyIntegrity/reason',
        { maxChars: 128 }
      );
    }
  }
  return errors;
}

function sourceSpanSchema(value) {
  const errors = [];
  if (!header(errors, value, 'project-knowledge-source-span', CONTRACT_IDS.SOURCE_SPAN)) {
    return errors;
  }

  requireProjectSnapshotIds(errors, value);
  h.requireNonEmptyString(errors, value.spanId, '/spanId');
  h.requireNonEmptyString(errors, value.sourceUnitId, '/sourceUnitId');
  h.requireContentHash(errors, value.contentHash, '/contentHash');
  h.validateLinePosition(errors, value.start, '/start', { required: true });
  h.validateLinePosition(errors, value.end, '/end', { required: true });
  return errors;
}

function symbolSchema(value) {
  const errors = [];
  if (!header(errors, value, 'project-knowledge-symbol', CONTRACT_IDS.SYMBOL)) return errors;

  requireProjectSnapshotIds(errors, value);
  h.requireNonEmptyString(errors, value.symbolId, '/symbolId');
  h.requireNonEmptyString(errors, value.name, '/name', { maxChars: DEFAULT_LIMITS.maxNameChars });
  h.requireClosedEnum(errors, value.symbolKind, '/symbolKind', SYMBOL_KINDS, 'symbolKind');

  h.validateProvenance(errors, value.provenance);
  if (value.provenance && typeof value.provenance === 'object') {
    requireDerivationClass(errors, value.provenance.derivationClass, '/provenance/derivationClass');
  }

  if (value.evidenceReferences != null) {
    if (
      h.optionalArray(errors, value.evidenceReferences, '/evidenceReferences', {
        maxItems: DEFAULT_LIMITS.maxEvidenceRefs,
      })
    ) {
      value.evidenceReferences.forEach((ref, i) => {
        h.validateEvidenceReference(errors, ref, `/evidenceReferences/${i}`);
      });
    }
  }
  if (value.sourceSpanIds != null) {
    if (h.optionalArray(errors, value.sourceSpanIds, '/sourceSpanIds')) {
      value.sourceSpanIds.forEach((id, i) => {
        h.requireNonEmptyString(errors, id, `/sourceSpanIds/${i}`);
      });
    }
  }

  const derivation =
    value.provenance && typeof value.provenance === 'object'
      ? value.provenance.derivationClass
      : null;
  enforceVerifiedEvidence(errors, derivation, value.evidenceReferences, '/evidenceReferences');

  h.optionalString(errors, value.confidence, '/confidence', { maxChars: 64 });
  return errors;
}

function relationshipSchema(value) {
  const errors = [];
  if (!header(errors, value, 'project-knowledge-relationship', CONTRACT_IDS.RELATIONSHIP)) {
    return errors;
  }

  requireProjectSnapshotIds(errors, value);
  h.requireNonEmptyString(errors, value.relationshipId, '/relationshipId');
  h.requireClosedEnum(
    errors,
    value.relationshipType,
    '/relationshipType',
    RELATIONSHIP_TYPES,
    'relationshipType'
  );
  h.requireNonEmptyString(errors, value.fromSymbolId, '/fromSymbolId');
  h.requireNonEmptyString(errors, value.toSymbolId, '/toSymbolId');

  h.validateProvenance(errors, value.provenance);
  if (value.provenance && typeof value.provenance === 'object') {
    requireDerivationClass(errors, value.provenance.derivationClass, '/provenance/derivationClass');
  }

  if (value.evidenceReferences != null) {
    if (
      h.optionalArray(errors, value.evidenceReferences, '/evidenceReferences', {
        maxItems: DEFAULT_LIMITS.maxEvidenceRefs,
      })
    ) {
      value.evidenceReferences.forEach((ref, i) => {
        h.validateEvidenceReference(errors, ref, `/evidenceReferences/${i}`);
      });
    }
  }

  const derivation =
    value.provenance && typeof value.provenance === 'object'
      ? value.provenance.derivationClass
      : null;
  enforceVerifiedEvidence(errors, derivation, value.evidenceReferences, '/evidenceReferences');

  h.optionalString(errors, value.confidence, '/confidence', { maxChars: 64 });
  return errors;
}

function analyzerRunSchema(value) {
  const errors = [];
  if (!header(errors, value, 'project-knowledge-analyzer-run', CONTRACT_IDS.ANALYZER_RUN)) {
    return errors;
  }

  requireProjectSnapshotIds(errors, value);
  h.requireNonEmptyString(errors, value.analyzerRunId, '/analyzerRunId');
  h.requireNonEmptyString(errors, value.analyzerId, '/analyzerId');
  h.requireNonEmptyString(errors, value.analyzerVersion, '/analyzerVersion');
  h.requireContentHash(errors, value.inputInventoryHash, '/inputInventoryHash');
  h.requireClosedEnum(
    errors,
    value.status,
    '/status',
    Object.values(ANALYZER_RUN_STATUSES),
    'status'
  );
  h.optionalString(errors, value.startedAt, '/startedAt', { maxChars: 64 });
  h.optionalString(errors, value.completedAt, '/completedAt', { maxChars: 64 });
  return errors;
}

function evidenceSchema(value) {
  const errors = [];
  if (!header(errors, value, 'project-knowledge-evidence', CONTRACT_IDS.EVIDENCE)) return errors;

  requireProjectSnapshotIds(errors, value);
  h.requireNonEmptyString(errors, value.evidenceId, '/evidenceId');
  h.requireNonEmptyString(errors, value.sourceUnitId, '/sourceUnitId');
  h.requireContentHash(errors, value.contentHash, '/contentHash');
  h.requireClosedEnum(
    errors,
    value.evidenceClass,
    '/evidenceClass',
    Object.values(EVIDENCE_CLASSES),
    'evidenceClass'
  );
  h.requireNonEmptyString(errors, value.trustedRootId, '/trustedRootId');

  if (value.sourceSpanIds != null) {
    if (h.optionalArray(errors, value.sourceSpanIds, '/sourceSpanIds')) {
      value.sourceSpanIds.forEach((id, i) => {
        h.requireNonEmptyString(errors, id, `/sourceSpanIds/${i}`);
      });
    }
  }
  // Source evidence provenance subset
  h.optionalString(errors, value.relativePath, '/relativePath', {
    maxChars: DEFAULT_LIMITS.maxPathChars,
  });
  if (value.relativePath != null) {
    h.requireSafeRelativePath(errors, value.relativePath, '/relativePath');
  }
  return errors;
}

function summarySchema(value) {
  const errors = [];
  if (!header(errors, value, 'project-knowledge-summary', CONTRACT_IDS.SUMMARY)) return errors;

  requireProjectSnapshotIds(errors, value);
  h.requireNonEmptyString(errors, value.summaryId, '/summaryId');
  h.requireNonEmptyString(errors, value.text, '/text', {
    maxChars: DEFAULT_LIMITS.maxSummaryChars,
  });

  // Summaries are derived aids, never canonical source evidence (ADR-011 / ADR-013).
  if (value.sourceOfTruth !== false) {
    h.push(errors, '/sourceOfTruth', 'sourceOfTruth must be false for summaries');
  }
  if (value.advisory != null && value.advisory !== true) {
    h.push(errors, '/advisory', 'advisory must be true when present for summaries');
  }

  requireDerivationClass(errors, value.derivationClass);
  if (value.derivationClass === DERIVATION_CLASSES.VERIFIED) {
    h.push(errors, '/derivationClass', 'summaries cannot be VERIFIED');
  }

  if (
    h.requireArray(errors, value.evidenceReferences, '/evidenceReferences', {
      maxItems: DEFAULT_LIMITS.maxEvidenceRefs,
    })
  ) {
    value.evidenceReferences.forEach((ref, i) => {
      h.validateEvidenceReference(errors, ref, `/evidenceReferences/${i}`);
    });
  }
  return errors;
}

function diagnosticSchema(value) {
  const errors = [];
  if (!header(errors, value, 'project-knowledge-diagnostic', CONTRACT_IDS.DIAGNOSTIC)) {
    return errors;
  }

  h.requireNonEmptyString(errors, value.projectId, '/projectId');
  h.optionalString(errors, value.snapshotId, '/snapshotId');
  h.requireNonEmptyString(errors, value.diagnosticId, '/diagnosticId');
  h.requireClosedEnum(
    errors,
    value.severity,
    '/severity',
    Object.values(DIAGNOSTIC_SEVERITIES),
    'severity'
  );
  h.requireClosedEnum(errors, value.reasonCode, '/reasonCode', REASON_CODE_VALUES, 'reasonCode');
  h.requireNonEmptyString(errors, value.message, '/message', {
    maxChars: DEFAULT_LIMITS.maxMessageChars,
  });

  if (value.relatedIds != null) {
    if (h.optionalArray(errors, value.relatedIds, '/relatedIds')) {
      value.relatedIds.forEach((id, i) => {
        h.requireNonEmptyString(errors, id, `/relatedIds/${i}`);
      });
    }
  }
  return errors;
}

function contextPackageSchema(value) {
  const errors = [];
  if (!header(errors, value, 'project-knowledge-context-package', CONTRACT_IDS.CONTEXT_PACKAGE)) {
    return errors;
  }

  requireProjectSnapshotIds(errors, value);
  h.requireNonEmptyString(errors, value.packageId, '/packageId');
  h.requireNonEmptyString(errors, value.policyId, '/policyId');
  h.requireNonEmptyString(errors, value.policyVersion, '/policyVersion');

  if (value.sourceOfTruth !== false) {
    h.push(errors, '/sourceOfTruth', 'sourceOfTruth must be false for context packages');
  }
  if (value.advisory != null && value.advisory !== true) {
    h.push(errors, '/advisory', 'advisory must be true when present for context packages');
  }
  if (typeof value.tokenBudget !== 'number' || value.tokenBudget <= 0) {
    h.push(errors, '/tokenBudget', 'positive tokenBudget is required');
  }

  if (h.requireArray(errors, value.selected, '/selected')) {
    value.selected.forEach((item, i) => {
      const base = `/selected/${i}`;
      if (!h.requireObject(errors, item, base)) return;
      h.requireNonEmptyString(errors, item.id, `${base}/id`);
      h.optionalString(errors, item.kind, `${base}/kind`);
      if (item.reasons != null && !Array.isArray(item.reasons)) {
        h.push(errors, `${base}/reasons`, 'reasons must be an array when present');
      }
    });
  }

  if (
    h.requireArray(errors, value.omissions, '/omissions', {
      maxItems: DEFAULT_LIMITS.maxOmissions,
    })
  ) {
    value.omissions.forEach((item, i) => {
      const base = `/omissions/${i}`;
      if (!h.requireObject(errors, item, base)) return;
      h.requireClosedEnum(
        errors,
        item.reasonCode,
        `${base}/reasonCode`,
        REASON_CODE_VALUES,
        'reasonCode'
      );
      h.optionalString(errors, item.description, `${base}/description`, {
        maxChars: DEFAULT_LIMITS.maxMessageChars,
      });
      h.optionalString(errors, item.entityId, `${base}/entityId`);
    });
  }

  if (
    h.requireArray(errors, value.evidenceReferences, '/evidenceReferences', {
      maxItems: DEFAULT_LIMITS.maxEvidenceRefs,
    })
  ) {
    value.evidenceReferences.forEach((ref, i) => {
      h.validateEvidenceReference(errors, ref, `/evidenceReferences/${i}`);
    });
  }

  if (value.nonClaims != null && !Array.isArray(value.nonClaims)) {
    h.push(errors, '/nonClaims', 'nonClaims must be an array when present');
  }
  return errors;
}

function operationResultSchema(value) {
  const errors = [];
  if (!header(errors, value, 'project-knowledge-operation-result', CONTRACT_IDS.OPERATION_RESULT)) {
    return errors;
  }

  h.requireBoolean(errors, value.ok, '/ok');
  if (value.ok === false) {
    h.requireClosedEnum(errors, value.reasonCode, '/reasonCode', REASON_CODE_VALUES, 'reasonCode');
    h.requireNonEmptyString(errors, value.message, '/message', {
      maxChars: DEFAULT_LIMITS.maxMessageChars,
    });
  } else if (value.reasonCode != null) {
    h.requireClosedEnum(errors, value.reasonCode, '/reasonCode', REASON_CODE_VALUES, 'reasonCode');
  }
  h.optionalString(errors, value.projectId, '/projectId');
  h.optionalString(errors, value.snapshotId, '/snapshotId');
  h.optionalString(errors, value.operation, '/operation', { maxChars: 128 });
  if (value.diagnostics != null) {
    if (h.optionalArray(errors, value.diagnostics, '/diagnostics')) {
      value.diagnostics.forEach((d, i) => {
        const base = `/diagnostics/${i}`;
        if (!h.requireObject(errors, d, base)) return;
        h.requireNonEmptyString(errors, d.diagnosticId, `${base}/diagnosticId`);
        h.requireClosedEnum(
          errors,
          d.severity,
          `${base}/severity`,
          Object.values(DIAGNOSTIC_SEVERITIES),
          'severity'
        );
        h.requireClosedEnum(
          errors,
          d.reasonCode,
          `${base}/reasonCode`,
          REASON_CODE_VALUES,
          'reasonCode'
        );
        h.requireNonEmptyString(errors, d.message, `${base}/message`, {
          maxChars: DEFAULT_LIMITS.maxMessageChars,
        });
      });
    }
  }
  return errors;
}

const PROJECT_INTELLIGENCE_SCHEMAS = Object.freeze({
  [CONTRACT_IDS.PROJECT]: { version: 1, schema: projectSchema },
  [CONTRACT_IDS.SNAPSHOT]: { version: 1, schema: snapshotSchema },
  [CONTRACT_IDS.SOURCE_UNIT]: { version: 1, schema: sourceUnitSchema },
  [CONTRACT_IDS.SOURCE_SPAN]: { version: 1, schema: sourceSpanSchema },
  [CONTRACT_IDS.SYMBOL]: { version: 1, schema: symbolSchema },
  [CONTRACT_IDS.RELATIONSHIP]: { version: 1, schema: relationshipSchema },
  [CONTRACT_IDS.ANALYZER_RUN]: { version: 1, schema: analyzerRunSchema },
  [CONTRACT_IDS.EVIDENCE]: { version: 1, schema: evidenceSchema },
  [CONTRACT_IDS.SUMMARY]: { version: 1, schema: summarySchema },
  [CONTRACT_IDS.DIAGNOSTIC]: { version: 1, schema: diagnosticSchema },
  [CONTRACT_IDS.CONTEXT_PACKAGE]: { version: 1, schema: contextPackageSchema },
  [CONTRACT_IDS.OPERATION_RESULT]: { version: 1, schema: operationResultSchema },
});

module.exports = {
  CONTRACT_IDS,
  PROJECT_INTELLIGENCE_SCHEMAS,
  projectSchema,
  snapshotSchema,
  sourceUnitSchema,
  sourceSpanSchema,
  symbolSchema,
  relationshipSchema,
  analyzerRunSchema,
  evidenceSchema,
  summarySchema,
  diagnosticSchema,
  contextPackageSchema,
  operationResultSchema,
};
