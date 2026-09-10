'use strict';

const CONTRACT_IDS = require('../contractIds');
const {
  DERIVATION_CLASSES,
  PROCESS_STATUSES,
  PROCESS_CONFIDENCE,
  GLOSSARY_SCOPE_TYPES,
  PROCESS_RELATIONSHIP_TYPES,
  DEFAULT_LIMITS,
} = require('../constants');
const h = require('../helpers');

const PROCESS_STATUS_VALUES = Object.values(PROCESS_STATUSES);
const DERIVATION_VALUES = Object.values(DERIVATION_CLASSES);
const PROCESS_STEP_KINDS = [
  'trigger',
  'action',
  'decision',
  'interface',
  'data',
  'exception',
  'outcome',
];
const PROCESS_CLAIM_TYPES = ['technical-observation', 'business-interpretation', 'open-question'];

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

function requireStatus(errors, value, path = '/status') {
  return h.requireClosedEnum(errors, value, path, PROCESS_STATUS_VALUES, 'status');
}

function requireDerivation(errors, value, path = '/derivationClass') {
  return h.requireClosedEnum(errors, value, path, DERIVATION_VALUES, 'derivationClass');
}

function requireConfidence(errors, value, path = '/confidence') {
  return h.requireClosedEnum(errors, value, path, PROCESS_CONFIDENCE, 'confidence');
}

function requireStringArray(errors, value, path, { required = false } = {}) {
  if (value == null) {
    if (required) h.push(errors, path, 'array is required');
    return false;
  }
  if (!h.requireArray(errors, value, path)) return false;
  value.forEach((item, i) => h.requireNonEmptyString(errors, item, `${path}/${i}`));
  return true;
}

function requireEvidenceReferences(errors, value, path = '/evidenceReferences') {
  if (!h.requireArray(errors, value, path, { maxItems: DEFAULT_LIMITS.maxEvidenceRefs })) {
    return false;
  }
  if (value.length === 0) h.push(errors, path, 'at least one evidence reference is required');
  value.forEach((ref, i) => h.validateEvidenceReference(errors, ref, `${path}/${i}`));
  return true;
}

function enforceVerifiedEvidence(errors, derivationClass, evidenceReferences, path) {
  if (
    derivationClass === DERIVATION_CLASSES.VERIFIED &&
    (!Array.isArray(evidenceReferences) || evidenceReferences.length === 0)
  ) {
    h.push(errors, path, 'VERIFIED requires one or more evidenceReferences');
  }
}

function validateProvenanceAndEvidence(errors, value) {
  h.validateProvenance(errors, value.provenance);
  const derivation = value.provenance && value.provenance.derivationClass;
  requireDerivation(errors, derivation, '/provenance/derivationClass');
  requireEvidenceReferences(errors, value.evidenceReferences);
  enforceVerifiedEvidence(errors, derivation, value.evidenceReferences, '/evidenceReferences');
}

function validateRefCollection(errors, value, path, { required = false } = {}) {
  if (value == null) {
    if (required) h.push(errors, path, 'array is required');
    return;
  }
  if (!h.requireArray(errors, value, path)) return;
  value.forEach((item, i) => {
    const base = `${path}/${i}`;
    if (!h.requireObject(errors, item, base)) return;
    h.requireNonEmptyString(errors, item.id, `${base}/id`);
    h.optionalString(errors, item.kind, `${base}/kind`);
    h.optionalString(errors, item.name, `${base}/name`);
    if (item.evidenceReferences != null) {
      requireEvidenceReferences(errors, item.evidenceReferences, `${base}/evidenceReferences`);
    }
  });
}

function validateDescription(errors, value) {
  if (value == null) return;
  if (!h.requireObject(errors, value, '/description')) return;
  for (const field of ['trigger', 'goal']) {
    h.optionalString(errors, value[field], `/description/${field}`, {
      maxChars: DEFAULT_LIMITS.maxSummaryChars,
    });
  }
  for (const field of [
    'steps',
    'decisions',
    'interfaces',
    'data',
    'exceptions',
    'roles',
    'evidence',
    'uncertainty',
    'openQuestions',
  ]) {
    if (value[field] != null && !Array.isArray(value[field])) {
      h.push(errors, `/description/${field}`, 'must be an array when present');
    }
  }
}

function reviewSchema(errors, value, status) {
  if (status !== PROCESS_STATUSES.REVIEWED && status !== PROCESS_STATUSES.PUBLISHED) {
    if (value != null) h.requireObject(errors, value, '/review');
    return;
  }
  if (!h.requireObject(errors, value, '/review')) return;
  h.requireNonEmptyString(errors, value.reviewerId, '/review/reviewerId');
  h.requireBoolean(errors, value.approved, '/review/approved');
  if (value.approved !== true) {
    h.push(errors, '/review/approved', 'reviewed and published versions require approval');
  }
  h.optionalString(errors, value.reviewedAt, '/review/reviewedAt', { maxChars: 64 });
  if (typeof value.reviewedAt === 'string' && Number.isNaN(Date.parse(value.reviewedAt))) {
    h.push(errors, '/review/reviewedAt', 'reviewedAt must be an ISO timestamp');
  }
  if (value.changedFields != null) {
    requireStringArray(errors, value.changedFields, '/review/changedFields');
  }
}

function businessProcessSchema(value) {
  const errors = [];
  if (!header(errors, value, 'project-knowledge-business-process', CONTRACT_IDS.BUSINESS_PROCESS))
    return errors;
  requireProjectSnapshotIds(errors, value);
  h.requireNonEmptyString(errors, value.processId, '/processId');
  h.requireNonEmptyString(errors, value.processVersionId, '/processVersionId');
  h.requireNonEmptyString(errors, value.name, '/name', { maxChars: DEFAULT_LIMITS.maxNameChars });
  requireStatus(errors, value.status);
  requireConfidence(errors, value.confidence);
  validateProvenanceAndEvidence(errors, value);
  validateRefCollection(errors, value.entryPoints, '/entryPoints');
  requireStringArray(errors, value.claimIds, '/claimIds', { required: true });
  requireStringArray(errors, value.relationshipIds, '/relationshipIds', { required: true });
  requireStringArray(errors, value.unknowns, '/unknowns');
  return errors;
}

function processVersionSchema(value) {
  const errors = [];
  if (!header(errors, value, 'project-knowledge-process-version', CONTRACT_IDS.PROCESS_VERSION))
    return errors;
  requireProjectSnapshotIds(errors, value);
  h.requireNonEmptyString(errors, value.processId, '/processId');
  h.requireNonEmptyString(errors, value.processVersionId, '/processVersionId');
  h.requireNonEmptyString(errors, value.title, '/title', { maxChars: DEFAULT_LIMITS.maxNameChars });
  requireStatus(errors, value.status);
  requireConfidence(errors, value.confidence);
  validateProvenanceAndEvidence(errors, value);
  requireStringArray(errors, value.stepIds, '/stepIds', { required: true });
  requireStringArray(errors, value.claimIds, '/claimIds', { required: true });
  requireStringArray(errors, value.relationshipIds, '/relationshipIds', { required: true });
  validateRefCollection(errors, value.actors, '/actors');
  validateRefCollection(errors, value.systems, '/systems');
  validateRefCollection(errors, value.interfaces, '/interfaces');
  validateRefCollection(errors, value.dataObjects, '/dataObjects');
  validateRefCollection(errors, value.decisions, '/decisions');
  validateRefCollection(errors, value.exceptions, '/exceptions');
  validateDescription(errors, value.description);
  requireStringArray(errors, value.uncertainty, '/uncertainty');
  requireStringArray(errors, value.openQuestions, '/openQuestions');
  reviewSchema(errors, value.review, value.status);
  if (value.status === PROCESS_STATUSES.PUBLISHED) {
    h.requireNonEmptyString(errors, value.publishedAt, '/publishedAt');
    if (typeof value.publishedAt === 'string' && Number.isNaN(Date.parse(value.publishedAt))) {
      h.push(errors, '/publishedAt', 'publishedAt must be an ISO timestamp');
    }
  }
  return errors;
}

function processStepSchema(value) {
  const errors = [];
  if (!header(errors, value, 'project-knowledge-process-step', CONTRACT_IDS.PROCESS_STEP))
    return errors;
  requireProjectSnapshotIds(errors, value);
  h.requireNonEmptyString(errors, value.processId, '/processId');
  h.requireNonEmptyString(errors, value.processVersionId, '/processVersionId');
  h.requireNonEmptyString(errors, value.stepId, '/stepId');
  h.requirePositiveInteger(errors, value.sequence, '/sequence');
  h.requireClosedEnum(errors, value.stepKind, '/stepKind', PROCESS_STEP_KINDS, 'stepKind');
  h.requireNonEmptyString(errors, value.title, '/title', { maxChars: DEFAULT_LIMITS.maxNameChars });
  h.optionalString(errors, value.description, '/description', {
    maxChars: DEFAULT_LIMITS.maxSummaryChars,
  });
  requireStatus(errors, value.status);
  requireDerivation(errors, value.derivationClass);
  requireConfidence(errors, value.confidence);
  requireEvidenceReferences(errors, value.evidenceReferences);
  enforceVerifiedEvidence(
    errors,
    value.derivationClass,
    value.evidenceReferences,
    '/evidenceReferences'
  );
  requireStringArray(errors, value.technicalRefs, '/technicalRefs');
  return errors;
}

function processClaimSchema(value) {
  const errors = [];
  if (!header(errors, value, 'project-knowledge-process-claim', CONTRACT_IDS.PROCESS_CLAIM))
    return errors;
  requireProjectSnapshotIds(errors, value);
  h.requireNonEmptyString(errors, value.processId, '/processId');
  h.requireNonEmptyString(errors, value.processVersionId, '/processVersionId');
  h.requireNonEmptyString(errors, value.claimId, '/claimId');
  h.requireClosedEnum(errors, value.claimType, '/claimType', PROCESS_CLAIM_TYPES, 'claimType');
  h.requireNonEmptyString(errors, value.text, '/text', {
    maxChars: DEFAULT_LIMITS.maxSummaryChars,
  });
  requireStatus(errors, value.status);
  requireDerivation(errors, value.derivationClass);
  requireConfidence(errors, value.confidence);
  validateProvenanceAndEvidence(errors, value);
  requireStringArray(errors, value.supportingRefs, '/supportingRefs');
  return errors;
}

function processRelationshipSchema(value) {
  const errors = [];
  if (
    !header(
      errors,
      value,
      'project-knowledge-process-relationship',
      CONTRACT_IDS.PROCESS_RELATIONSHIP
    )
  )
    return errors;
  requireProjectSnapshotIds(errors, value);
  h.requireNonEmptyString(errors, value.processId, '/processId');
  h.requireNonEmptyString(errors, value.processVersionId, '/processVersionId');
  h.requireNonEmptyString(errors, value.relationshipId, '/relationshipId');
  h.requireClosedEnum(
    errors,
    value.relationshipType,
    '/relationshipType',
    PROCESS_RELATIONSHIP_TYPES,
    'relationshipType'
  );
  h.requireNonEmptyString(errors, value.fromId, '/fromId');
  h.requireNonEmptyString(errors, value.toId, '/toId');
  requireStatus(errors, value.status);
  requireDerivation(errors, value.derivationClass);
  requireConfidence(errors, value.confidence);
  validateProvenanceAndEvidence(errors, value);
  return errors;
}

function glossaryEntrySchema(value) {
  const errors = [];
  if (!header(errors, value, 'project-knowledge-glossary-entry', CONTRACT_IDS.GLOSSARY_ENTRY))
    return errors;
  requireProjectSnapshotIds(errors, value);
  h.requireNonEmptyString(errors, value.entryId, '/entryId');
  h.requireNonEmptyString(errors, value.term, '/term', { maxChars: DEFAULT_LIMITS.maxNameChars });
  h.requireNonEmptyString(errors, value.definition, '/definition', {
    maxChars: DEFAULT_LIMITS.maxSummaryChars,
  });
  requireStatus(errors, value.status);
  requireDerivation(errors, value.derivationClass);
  requireConfidence(errors, value.confidence);
  validateProvenanceAndEvidence(errors, value);
  requireStringArray(errors, value.aliases, '/aliases');
  requireStringArray(errors, value.relatedProcessIds, '/relatedProcessIds');
  if (value.scopeType != null) {
    h.requireClosedEnum(errors, value.scopeType, '/scopeType', GLOSSARY_SCOPE_TYPES, 'scopeType');
  }
  if (value.scopeId != null) {
    h.requireNonEmptyString(errors, value.scopeId, '/scopeId');
  }
  if (value.scopeType === 'global' && value.scopeId != null) {
    h.push(errors, '/scopeId', 'global glossary entries must not carry a scopeId');
  }
  if (value.scopeType && value.scopeType !== 'global' && value.scopeId == null) {
    h.push(errors, '/scopeId', 'scoped glossary entries require a scopeId');
  }
  h.optionalString(errors, value.domain, '/domain');
  h.optionalString(errors, value.notes, '/notes', { maxChars: DEFAULT_LIMITS.maxSummaryChars });
  requireStringArray(errors, value.technicalRefs, '/technicalRefs');
  validateRefCollection(errors, value.relatedEntityRefs, '/relatedEntityRefs');
  return errors;
}

function processQueryResultSchema(value) {
  const errors = [];
  if (
    !header(
      errors,
      value,
      'project-knowledge-process-query-result',
      CONTRACT_IDS.PROCESS_QUERY_RESULT
    )
  )
    return errors;
  requireProjectSnapshotIds(errors, value);
  h.requireNonEmptyString(errors, value.queryId, '/queryId');
  h.requireNonEmptyString(errors, value.question, '/question', {
    maxChars: DEFAULT_LIMITS.maxSummaryChars,
  });
  h.requireNonEmptyString(errors, value.answer, '/answer', {
    maxChars: DEFAULT_LIMITS.maxSummaryChars,
  });
  requireStatus(errors, value.status);
  requireConfidence(errors, value.confidence);
  requireEvidenceReferences(errors, value.evidenceReferences);
  requireStringArray(errors, value.unknowns, '/unknowns');
  requireStringArray(errors, value.nextQuestions, '/nextQuestions');
  if (value.matches != null) validateRefCollection(errors, value.matches, '/matches');
  if (value.sourceOfTruth !== false) {
    h.push(errors, '/sourceOfTruth', 'sourceOfTruth must be false for query results');
  }
  if (value.advisory !== true) {
    h.push(errors, '/advisory', 'advisory must be true for query results');
  }
  return errors;
}

function requireFreshness(errors, value) {
  if (!h.requireObject(errors, value, '/freshness')) return;
  h.requireNonEmptyString(errors, value.status, '/freshness/status');
  if (value.snapshotId != null) h.optionalString(errors, value.snapshotId, '/freshness/snapshotId');
  if (value.currentSnapshotId != null) {
    h.optionalString(errors, value.currentSnapshotId, '/freshness/currentSnapshotId');
  }
  if (value.sourceHash != null) h.optionalString(errors, value.sourceHash, '/freshness/sourceHash');
  if (value.currentSourceHash != null) {
    h.optionalString(errors, value.currentSourceHash, '/freshness/currentSourceHash');
  }
  if (value.reason != null) h.optionalString(errors, value.reason, '/freshness/reason');
}

function processRoleViewSchema(value) {
  const errors = [];
  if (!header(errors, value, 'project-knowledge-process-role-view', CONTRACT_IDS.PROCESS_ROLE_VIEW))
    return errors;
  requireProjectSnapshotIds(errors, value);
  h.requireNonEmptyString(errors, value.processId, '/processId');
  h.requireNonEmptyString(errors, value.processVersionId, '/processVersionId');
  h.requireClosedEnum(
    errors,
    value.role,
    '/role',
    ['product-owner', 'architect', 'developer', 'tester'],
    'role'
  );
  requireStatus(errors, value.status);
  requireConfidence(errors, value.confidence);
  requireFreshness(errors, value.freshness);
  h.requireObject(errors, value.view, '/view');
  requireEvidenceReferences(errors, value.evidenceReferences);
  requireStringArray(errors, value.unknowns, '/unknowns');
  requireStringArray(errors, value.nextQuestions, '/nextQuestions');
  if (value.sourceOfTruth !== false)
    h.push(errors, '/sourceOfTruth', 'sourceOfTruth must be false');
  if (value.advisory !== true) h.push(errors, '/advisory', 'advisory must be true');
  return errors;
}

function processEvaluationResultSchema(value) {
  const errors = [];
  if (
    !header(
      errors,
      value,
      'project-knowledge-process-evaluation-result',
      CONTRACT_IDS.PROCESS_EVALUATION_RESULT
    )
  )
    return errors;
  requireProjectSnapshotIds(errors, value);
  h.requireNonEmptyString(errors, value.evaluationId, '/evaluationId');
  h.requireClosedEnum(errors, value.status, '/status', ['pass', 'needs-review', 'fail'], 'status');
  requireFreshness(errors, value.freshness);
  h.requireObject(errors, value.metrics, '/metrics');
  requireStringArray(errors, value.findings, '/findings');
  if (!h.requireArray(errors, value.scenarios, '/scenarios')) return errors;
  value.scenarios.forEach((scenario, index) => {
    const base = `/scenarios/${index}`;
    if (!h.requireObject(errors, scenario, base)) return;
    h.requireNonEmptyString(errors, scenario.id, `${base}/id`);
    h.requireClosedEnum(
      errors,
      scenario.status,
      `${base}/status`,
      ['pass', 'needs-review', 'fail'],
      'scenario status'
    );
    requireStringArray(errors, scenario.matchedProcessIds, `${base}/matchedProcessIds`);
    requireStringArray(errors, scenario.unknowns, `${base}/unknowns`);
  });
  requireEvidenceReferences(errors, value.evidenceReferences);
  if (value.sourceOfTruth !== false)
    h.push(errors, '/sourceOfTruth', 'sourceOfTruth must be false');
  if (value.advisory !== true) h.push(errors, '/advisory', 'advisory must be true');
  return errors;
}

module.exports = {
  businessProcessSchema,
  processVersionSchema,
  processStepSchema,
  processClaimSchema,
  processRelationshipSchema,
  glossaryEntrySchema,
  processQueryResultSchema,
  processRoleViewSchema,
  processEvaluationResultSchema,
};
