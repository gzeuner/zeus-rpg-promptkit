'use strict';

const { FILE_ACTIONS, DEFAULT_LIMITS } = require('./constants');

const CONTRACT_IDS = Object.freeze({
  GENERATION_CANDIDATE: 'zeus.generation-candidate',
  GENERATION_VALIDATION_REPORT: 'zeus.generation-validation-report',
  EXTERNAL_LINTER_ADAPTER: 'zeus.external-linter-adapter',
});

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function push(errors, path, message) {
  errors.push({ path, message });
}

/**
 * generation-candidate/v1
 * Structured AI/local generation proposal. Advisory only — never evidence.
 */
function generationCandidateSchema(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    push(errors, '', 'expected an object');
    return errors;
  }
  if (Number(value.schemaVersion) !== 1) {
    push(errors, '/schemaVersion', 'expected 1');
  }
  if (value.kind != null && value.kind !== 'generation-candidate') {
    push(errors, '/kind', 'kind must be "generation-candidate" when present');
  }
  if (typeof value.candidateId !== 'string' || !value.candidateId.trim()) {
    push(errors, '/candidateId', 'candidateId is required');
  }
  if (typeof value.taskSummary !== 'string' || !value.taskSummary.trim()) {
    push(errors, '/taskSummary', 'taskSummary is required');
  } else if (value.taskSummary.length > DEFAULT_LIMITS.maxTaskSummaryChars) {
    push(errors, '/taskSummary', 'taskSummary exceeds size limit');
  }
  if (!Array.isArray(value.evidenceReferences)) {
    push(errors, '/evidenceReferences', 'evidenceReferences must be an array');
  } else {
    value.evidenceReferences.forEach((ref, i) => {
      if (!isPlainObject(ref)) {
        push(errors, `/evidenceReferences/${i}`, 'reference must be an object');
        return;
      }
      if (typeof ref.id !== 'string' || !ref.id.trim()) {
        push(errors, `/evidenceReferences/${i}/id`, 'id is required');
      }
      if (typeof ref.kind !== 'string' || !ref.kind.trim()) {
        push(errors, `/evidenceReferences/${i}/kind`, 'kind is required');
      }
      if (ref.path != null && typeof ref.path !== 'string') {
        push(errors, `/evidenceReferences/${i}/path`, 'path must be a string when present');
      }
    });
  }
  if (value.assumptions != null && !Array.isArray(value.assumptions)) {
    push(errors, '/assumptions', 'assumptions must be an array when present');
  }
  if (value.uncertainties != null && !Array.isArray(value.uncertainties)) {
    push(errors, '/uncertainties', 'uncertainties must be an array when present');
  }
  if (!Array.isArray(value.proposedFiles)) {
    push(errors, '/proposedFiles', 'proposedFiles must be an array');
  } else {
    if (value.proposedFiles.length > DEFAULT_LIMITS.maxFiles) {
      push(errors, '/proposedFiles', 'too many proposed files');
    }
    value.proposedFiles.forEach((file, i) => {
      const base = `/proposedFiles/${i}`;
      if (!isPlainObject(file)) {
        push(errors, base, 'file entry must be an object');
        return;
      }
      if (typeof file.path !== 'string' || !file.path.trim()) {
        push(errors, `${base}/path`, 'path is required');
      }
      if (file.action != null && !FILE_ACTIONS.includes(String(file.action))) {
        push(errors, `${base}/action`, `action must be one of ${FILE_ACTIONS.join(', ')}`);
      }
      if (file.language != null && typeof file.language !== 'string') {
        push(errors, `${base}/language`, 'language must be a string when present');
      }
      if (file.content != null && typeof file.content !== 'string') {
        push(errors, `${base}/content`, 'content must be a string when present');
      }
      if (file.action !== 'delete' && (file.content == null || typeof file.content !== 'string')) {
        push(errors, `${base}/content`, 'content is required unless action is delete');
      }
      if (file.rationale != null && typeof file.rationale !== 'string') {
        push(errors, `${base}/rationale`, 'rationale must be a string when present');
      }
      if (
        typeof file.rationale === 'string' &&
        file.rationale.length > DEFAULT_LIMITS.maxRationaleChars
      ) {
        push(errors, `${base}/rationale`, 'rationale exceeds size limit');
      }
    });
  }
  if (value.validationPlan != null && !isPlainObject(value.validationPlan)) {
    push(errors, '/validationPlan', 'validationPlan must be an object when present');
  }
  if (value.providerIdentity != null) {
    if (!isPlainObject(value.providerIdentity)) {
      push(errors, '/providerIdentity', 'providerIdentity must be an object when present');
    } else {
      if (
        value.providerIdentity.providerId != null &&
        typeof value.providerIdentity.providerId !== 'string'
      ) {
        push(errors, '/providerIdentity/providerId', 'must be a string');
      }
      if (
        value.providerIdentity.model != null &&
        typeof value.providerIdentity.model !== 'string'
      ) {
        push(errors, '/providerIdentity/model', 'must be a string');
      }
    }
  }
  if (value.correlationId != null && typeof value.correlationId !== 'string') {
    push(errors, '/correlationId', 'correlationId must be a string when present');
  }
  // Chain-of-thought must not be required or stored as a first-class field.
  if (value.chainOfThought != null || value.hiddenReasoning != null) {
    push(errors, '', 'hidden reasoning / chain-of-thought fields are not allowed');
  }
  return errors;
}

/**
 * generation-validation-report/v1
 */
function generationValidationReportSchema(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    push(errors, '', 'expected an object');
    return errors;
  }
  if (Number(value.schemaVersion) !== 1) {
    push(errors, '/schemaVersion', 'expected 1');
  }
  if (value.kind != null && value.kind !== 'generation-validation-report') {
    push(errors, '/kind', 'kind must be "generation-validation-report" when present');
  }
  if (typeof value.candidateId !== 'string' || !value.candidateId.trim()) {
    push(errors, '/candidateId', 'candidateId is required');
  }
  if (typeof value.status !== 'string' || !value.status.trim()) {
    push(errors, '/status', 'status is required');
  }
  if (typeof value.reviewReady !== 'boolean') {
    push(errors, '/reviewReady', 'reviewReady boolean is required');
  }
  if (!Array.isArray(value.diagnostics)) {
    push(errors, '/diagnostics', 'diagnostics must be an array');
  } else {
    value.diagnostics.forEach((d, i) => {
      const base = `/diagnostics/${i}`;
      if (!isPlainObject(d)) {
        push(errors, base, 'diagnostic must be an object');
        return;
      }
      if (typeof d.id !== 'string' || !d.id.trim()) {
        push(errors, `${base}/id`, 'id is required');
      }
      if (typeof d.severity !== 'string' || !d.severity.trim()) {
        push(errors, `${base}/severity`, 'severity is required');
      }
      if (typeof d.message !== 'string') {
        push(errors, `${base}/message`, 'message is required');
      }
      if (typeof d.validatorId !== 'string' || !d.validatorId.trim()) {
        push(errors, `${base}/validatorId`, 'validatorId is required');
      }
    });
  }
  if (value.summary != null && typeof value.summary !== 'string') {
    push(errors, '/summary', 'summary must be a string when present');
  }
  if (value.policy != null && !isPlainObject(value.policy)) {
    push(errors, '/policy', 'policy must be an object when present');
  }
  return errors;
}

/**
 * Neutral optional external linter adapter descriptor (no network default).
 */
function externalLinterAdapterSchema(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    push(errors, '', 'expected an object');
    return errors;
  }
  if (Number(value.schemaVersion) !== 1) {
    push(errors, '/schemaVersion', 'expected 1');
  }
  if (typeof value.id !== 'string' || !value.id.trim()) {
    push(errors, '/id', 'id is required');
  }
  if (value.requiresNetwork === true) {
    push(
      errors,
      '/requiresNetwork',
      'network-dependent linters are not allowed in Community default'
    );
  }
  if (value.requiresCompiler === true) {
    push(errors, '/requiresCompiler', 'compiler-backed linters are out of Community scope');
  }
  return errors;
}

const GENERATION_SCHEMAS = Object.freeze({
  [CONTRACT_IDS.GENERATION_CANDIDATE]: {
    version: 1,
    schema: generationCandidateSchema,
  },
  [CONTRACT_IDS.GENERATION_VALIDATION_REPORT]: {
    version: 1,
    schema: generationValidationReportSchema,
  },
  [CONTRACT_IDS.EXTERNAL_LINTER_ADAPTER]: {
    version: 1,
    schema: externalLinterAdapterSchema,
  },
});

module.exports = {
  CONTRACT_IDS,
  GENERATION_SCHEMAS,
  generationCandidateSchema,
  generationValidationReportSchema,
  externalLinterAdapterSchema,
};
