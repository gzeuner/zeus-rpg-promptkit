'use strict';

/**
 * Entitlement-free portable artifact validation (descriptor-only).
 * Strict versioned schemas for vector-set and manifest contracts.
 */

const {
  RESULT_CONTRACT_ID,
  RESULT_CONTRACT_VERSION,
  RESULT_CONTRACT_REF,
  REASON_CODES,
  LIMITS,
  NON_CLAIMS,
  SUPPORT_STATUS,
  VECTOR_CATEGORIES,
  EXPECTED_OUTCOMES,
  PROVENANCE_KINDS,
  GAP_KINDS,
  ARTIFACT_FILES,
  MANIFEST_KIND,
  PINNED_COMMUNITY_SHA,
} = require('./constants');
const { utf8ByteLength, inspectUntrustedOwnProperties, inspectUntrustedArray } = require('./util');
const { sanitizeRunId } = require('./paths');
const { buildVectorId } = require('./generator');

const SUPPORT_SET = new Set(Object.values(SUPPORT_STATUS));
const CATEGORY_SET = new Set(Object.values(VECTOR_CATEGORIES));
const OUTCOME_SET = new Set(Object.values(EXPECTED_OUTCOMES));
const PROV_KIND_SET = new Set(Object.values(PROVENANCE_KINDS));
const GAP_KIND_SET = new Set(Object.values(GAP_KINDS));

const VECTOR_SET_TOP_KEYS = Object.freeze([
  'contractId',
  'contractVersion',
  'contractRef',
  'provenanceAnchor',
  'vectors',
  'qualityReport',
  'gaps',
  'diagnostics',
  'nonClaims',
  'notes',
]);

const PROVENANCE_ANCHOR_KEYS = Object.freeze([
  'communitySha',
  'adapterId',
  'adapterVersion',
  'evidenceArtifactSha256',
  'manualRulesSha256',
  'sourceFingerprint',
]);

const VECTOR_KEYS = Object.freeze([
  'id',
  'category',
  'table',
  'input',
  'expectation',
  'rationale',
  'provenance',
  'assumptions',
  'supportStatus',
]);

const EXPECTATION_KEYS = Object.freeze(['outcome', 'technical', 'business']);
const TABLE_REF_KEYS = Object.freeze(['schema', 'name']);
const INPUT_KEYS = Object.freeze(['assignments']);
const PROVENANCE_KEYS = Object.freeze(['kind', 'reason', 'source']);
const GAP_KEYS = Object.freeze(['kind', 'message', 'table', 'column', 'detail']);
const DIAG_KEYS = Object.freeze(['code', 'message']);
const QUALITY_KEYS = Object.freeze([
  'supported',
  'unsupported',
  'missingEvidence',
  'unknownBusinessValidity',
  'gapCount',
  'vectorCount',
]);
const ASSIGNMENT_VALUE_KEYS = Object.freeze(['kind', 'value']);
const ASSIGNMENT_KINDS = Object.freeze(
  new Set(['decimal-string', 'string', 'boolean', 'date', 'time', 'timestamp', 'number'])
);

const MANIFEST_TOP_KEYS = Object.freeze([
  'schemaVersion',
  'kind',
  'runId',
  'contractRef',
  'nonClaims',
  'notes',
  'artifacts',
]);
const MANIFEST_ARTIFACT_KEYS = Object.freeze(['path', 'sha256', 'sizeBytes']);
const CONTENT_ARTIFACT_PATHS = Object.freeze([
  ARTIFACT_FILES.CANONICAL,
  ARTIFACT_FILES.MARKDOWN,
  ARTIFACT_FILES.JUNIT,
  ARTIFACT_FILES.ROBOT,
]);
const CONTENT_PATH_SET = new Set(CONTENT_ARTIFACT_PATHS);

function fail(code, message) {
  return { ok: false, reasonCode: code, message: String(message) };
}

function readData(object, key) {
  if (object == null || typeof object !== 'object') {
    return { ok: false, reason: 'not-object' };
  }
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(object, key);
  } catch {
    return { ok: false, reason: 'descriptor-failed' };
  }
  if (!descriptor) return { ok: false, reason: 'missing' };
  if (typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
    return { ok: false, reason: 'accessor' };
  }
  if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
    return { ok: false, reason: 'no-value' };
  }
  return { ok: true, value: descriptor.value };
}

function requireData(object, key) {
  const r = readData(object, key);
  if (!r.ok) {
    return fail(
      REASON_CODES.INPUT_INVALID,
      'Portable artifact field is missing or not plain data.'
    );
  }
  return r;
}

function exactKeySet(inspectedKeys, allowedList) {
  if (inspectedKeys.length !== allowedList.length) return false;
  const allowed = new Set(allowedList);
  for (let i = 0; i < inspectedKeys.length; i += 1) {
    if (!allowed.has(inspectedKeys[i])) return false;
  }
  return true;
}

function _allowlistKeys(inspectedKeys, allowedList) {
  const allowed = new Set(allowedList);
  for (let i = 0; i < inspectedKeys.length; i += 1) {
    if (!allowed.has(inspectedKeys[i])) return false;
  }
  return true;
}

function inspectObjectStrict(value, label) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return fail(REASON_CODES.INPUT_INVALID, `${label} must be a plain object.`);
  }
  const insp = inspectUntrustedOwnProperties(value);
  if (!insp.ok) {
    return fail(REASON_CODES.INPUT_INVALID, insp.message || `${label} structure is invalid.`);
  }
  return { ok: true, keys: insp.keys, values: insp.values, object: value };
}

function requireNonNegativeInt(object, key) {
  const r = requireData(object, key);
  if (!r.ok) return r;
  if (!Number.isInteger(r.value) || r.value < 0) {
    return fail(REASON_CODES.INPUT_INVALID, `${key} must be a non-negative integer.`);
  }
  return r;
}

function validateNonClaims(object) {
  const insp = inspectObjectStrict(object, 'nonClaims');
  if (!insp.ok) return insp;
  const required = Object.keys(NON_CLAIMS);
  if (!exactKeySet(insp.keys, required)) {
    return fail(REASON_CODES.INPUT_INVALID, 'nonClaims schema is invalid.');
  }
  for (let i = 0; i < required.length; i += 1) {
    const key = required[i];
    const field = requireData(object, key);
    if (!field.ok || field.value !== false) {
      return fail(REASON_CODES.INPUT_INVALID, 'nonClaims must all be false.');
    }
  }
  return { ok: true };
}

function validateNotes(notesValue, maxItems) {
  const arr = inspectUntrustedArray(notesValue);
  if (!arr.ok) {
    return fail(REASON_CODES.INPUT_INVALID, 'notes must be a dense array.');
  }
  if (arr.length > maxItems) {
    return fail(REASON_CODES.BOUNDS_EXCEEDED, 'notes count exceeds bound.');
  }
  for (let i = 0; i < arr.length; i += 1) {
    const n = arr.elements[i];
    if (typeof n !== 'string' || n.length === 0 || n.length > 512) {
      return fail(REASON_CODES.INPUT_INVALID, 'notes entries are invalid.');
    }
  }
  return { ok: true, length: arr.length };
}

function validateAssignmentValue(value) {
  if (value === null) return { ok: true };
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return fail(REASON_CODES.INPUT_INVALID, 'Assignment value is invalid.');
  }
  const insp = inspectObjectStrict(value, 'assignment value');
  if (!insp.ok) return insp;
  if (!exactKeySet(insp.keys, ASSIGNMENT_VALUE_KEYS)) {
    return fail(REASON_CODES.INPUT_INVALID, 'Assignment value schema is invalid.');
  }
  const kind = requireData(value, 'kind');
  const val = requireData(value, 'value');
  if (!kind.ok || !val.ok) return fail(REASON_CODES.INPUT_INVALID, 'Assignment value is invalid.');
  if (typeof kind.value !== 'string' || !ASSIGNMENT_KINDS.has(kind.value)) {
    return fail(REASON_CODES.INPUT_INVALID, 'Assignment value kind is invalid.');
  }
  if (typeof val.value !== 'string' || val.value.length > 4096) {
    return fail(REASON_CODES.INPUT_INVALID, 'Assignment value payload is invalid.');
  }
  return { ok: true };
}

function validateAssignments(assignments) {
  const insp = inspectObjectStrict(assignments, 'assignments');
  if (!insp.ok) return insp;
  if (insp.keys.length > LIMITS.maxColumnsPerTable * LIMITS.maxTables) {
    return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Too many assignment keys.');
  }
  for (let i = 0; i < insp.keys.length; i += 1) {
    const key = insp.keys[i];
    if (typeof key !== 'string' || key.length === 0 || key.length > 1024) {
      return fail(REASON_CODES.INPUT_INVALID, 'Assignment key is invalid.');
    }
    const field = requireData(assignments, key);
    if (!field.ok) return fail(REASON_CODES.INPUT_INVALID, 'Assignment entry is unreadable.');
    const av = validateAssignmentValue(field.value);
    if (!av.ok) return av;
  }
  return { ok: true };
}

function validateProvenanceEntry(entry) {
  const insp = inspectObjectStrict(entry, 'provenance');
  if (!insp.ok) return insp;
  if (!exactKeySet(insp.keys, PROVENANCE_KEYS)) {
    return fail(REASON_CODES.INPUT_INVALID, 'Provenance entry schema is invalid.');
  }
  const kind = requireData(entry, 'kind');
  const reason = requireData(entry, 'reason');
  const source = requireData(entry, 'source');
  if (!kind.ok || !reason.ok || !source.ok) {
    return fail(REASON_CODES.INPUT_INVALID, 'Provenance entry is invalid.');
  }
  if (typeof kind.value !== 'string' || !PROV_KIND_SET.has(kind.value)) {
    return fail(REASON_CODES.INPUT_INVALID, 'Provenance kind is invalid.');
  }
  if (typeof reason.value !== 'string' || reason.value.length === 0 || reason.value.length > 512) {
    return fail(REASON_CODES.INPUT_INVALID, 'Provenance reason is invalid.');
  }
  if (source.value != null && (typeof source.value !== 'string' || source.value.length > 256)) {
    return fail(REASON_CODES.INPUT_INVALID, 'Provenance source is invalid.');
  }
  return { ok: true };
}

function validateGapEntry(entry) {
  const insp = inspectObjectStrict(entry, 'gap');
  if (!insp.ok) return insp;
  if (!exactKeySet(insp.keys, GAP_KEYS)) {
    return fail(REASON_CODES.INPUT_INVALID, 'Gap entry schema is invalid.');
  }
  const kind = requireData(entry, 'kind');
  const message = requireData(entry, 'message');
  const table = requireData(entry, 'table');
  const column = requireData(entry, 'column');
  const detail = requireData(entry, 'detail');
  if (!kind.ok || !message.ok || !table.ok || !column.ok || !detail.ok) {
    return fail(REASON_CODES.INPUT_INVALID, 'Gap entry is invalid.');
  }
  if (typeof kind.value !== 'string' || !GAP_KIND_SET.has(kind.value)) {
    return fail(REASON_CODES.INPUT_INVALID, 'Gap kind is invalid.');
  }
  if (
    typeof message.value !== 'string' ||
    message.value.length === 0 ||
    message.value.length > 512
  ) {
    return fail(REASON_CODES.INPUT_INVALID, 'Gap message is invalid.');
  }
  if (table.value != null && (typeof table.value !== 'string' || table.value.length > 1024)) {
    return fail(REASON_CODES.INPUT_INVALID, 'Gap table is invalid.');
  }
  if (column.value != null && (typeof column.value !== 'string' || column.value.length > 256)) {
    return fail(REASON_CODES.INPUT_INVALID, 'Gap column is invalid.');
  }
  if (detail.value != null && (typeof detail.value !== 'string' || detail.value.length > 256)) {
    return fail(REASON_CODES.INPUT_INVALID, 'Gap detail is invalid.');
  }
  return { ok: true };
}

function validateDiagnosticEntry(entry) {
  const insp = inspectObjectStrict(entry, 'diagnostic');
  if (!insp.ok) return insp;
  if (!exactKeySet(insp.keys, DIAG_KEYS)) {
    return fail(REASON_CODES.INPUT_INVALID, 'Diagnostic entry schema is invalid.');
  }
  const code = requireData(entry, 'code');
  const message = requireData(entry, 'message');
  if (!code.ok || !message.ok) {
    return fail(REASON_CODES.INPUT_INVALID, 'Diagnostic entry is invalid.');
  }
  if (typeof code.value !== 'string' || code.value.length === 0 || code.value.length > 128) {
    return fail(REASON_CODES.INPUT_INVALID, 'Diagnostic code is invalid.');
  }
  if (
    typeof message.value !== 'string' ||
    message.value.length === 0 ||
    message.value.length > 512
  ) {
    return fail(REASON_CODES.INPUT_INVALID, 'Diagnostic message is invalid.');
  }
  return { ok: true };
}

function validateTableRef(tableValue) {
  if (tableValue === null) return { ok: true, table: null };
  const insp = inspectObjectStrict(tableValue, 'vector.table');
  if (!insp.ok) return insp;
  if (!exactKeySet(insp.keys, TABLE_REF_KEYS)) {
    return fail(REASON_CODES.INPUT_INVALID, 'vector.table schema is invalid.');
  }
  const schema = requireData(tableValue, 'schema');
  const name = requireData(tableValue, 'name');
  if (!schema.ok || !name.ok) {
    return fail(REASON_CODES.INPUT_INVALID, 'vector.table is invalid.');
  }
  if (
    schema.value != null &&
    (typeof schema.value !== 'string' || schema.value.length > LIMITS.maxIdentifierChars)
  ) {
    return fail(REASON_CODES.INPUT_INVALID, 'vector.table.schema is invalid.');
  }
  if (
    typeof name.value !== 'string' ||
    name.value.length === 0 ||
    name.value.length > LIMITS.maxIdentifierChars
  ) {
    return fail(REASON_CODES.INPUT_INVALID, 'vector.table.name is invalid.');
  }
  return {
    ok: true,
    table: { schema: schema.value, name: name.value },
  };
}

/**
 * Strict portable validation of zeus-pro.db2-test-vector-set@1.
 * Descriptor-only; recomputes stable vector IDs from normalized identity.
 */
function validateVectorSet(value, options = {}) {
  const maxBytes = options.maxBytes || LIMITS.maxCanonicalJsonBytes;

  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return fail(REASON_CODES.INPUT_INVALID, 'Vector set must be an object.');
  }

  const topInsp = inspectUntrustedOwnProperties(value);
  if (!topInsp.ok) {
    return fail(REASON_CODES.INPUT_INVALID, topInsp.message || 'Vector set structure is invalid.');
  }
  if (!exactKeySet(topInsp.keys, VECTOR_SET_TOP_KEYS)) {
    return fail(REASON_CODES.INPUT_INVALID, 'Vector set top-level schema is invalid.');
  }

  if (typeof options.rawText === 'string') {
    if (utf8ByteLength(options.rawText) > maxBytes) {
      return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Vector set exceeds size bound.');
    }
  }

  const contractId = requireData(value, 'contractId');
  if (!contractId.ok || contractId.value !== RESULT_CONTRACT_ID) {
    return fail(REASON_CODES.INPUT_INVALID, 'Unsupported result contract id.');
  }
  const contractVersion = requireData(value, 'contractVersion');
  if (!contractVersion.ok || contractVersion.value !== RESULT_CONTRACT_VERSION) {
    return fail(REASON_CODES.INPUT_INVALID, 'Unsupported result contract version.');
  }
  const contractRef = requireData(value, 'contractRef');
  if (!contractRef.ok || contractRef.value !== RESULT_CONTRACT_REF) {
    return fail(REASON_CODES.INPUT_INVALID, 'Unsupported result contract ref.');
  }

  const vectorsRead = requireData(value, 'vectors');
  if (!vectorsRead.ok) return vectorsRead;
  const vectorsArr = inspectUntrustedArray(vectorsRead.value);
  if (!vectorsArr.ok) {
    return fail(REASON_CODES.INPUT_INVALID, 'vectors must be a dense array.');
  }
  if (vectorsArr.length > LIMITS.maxVectors) {
    return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Vector count exceeds bound.');
  }

  // provenanceAnchor (required technical provenance)
  const anchorRead = requireData(value, 'provenanceAnchor');
  if (!anchorRead.ok) return fail(REASON_CODES.INPUT_INVALID, 'provenanceAnchor is required.');
  const anchorInsp = inspectObjectStrict(anchorRead.value, 'provenanceAnchor');
  if (!anchorInsp.ok) return anchorInsp;
  if (!exactKeySet(anchorInsp.keys, PROVENANCE_ANCHOR_KEYS)) {
    // sourceFingerprint may be null but key must still be present on generated docs
    // Allow exact set only as generator always emits all keys.
    return fail(REASON_CODES.INPUT_INVALID, 'provenanceAnchor schema is invalid.');
  }
  const communitySha = requireData(anchorRead.value, 'communitySha');
  if (!communitySha.ok || communitySha.value !== PINNED_COMMUNITY_SHA) {
    return fail(REASON_CODES.INPUT_INVALID, 'provenanceAnchor.communitySha is invalid.');
  }
  const adapterId = requireData(anchorRead.value, 'adapterId');
  if (!adapterId.ok || typeof adapterId.value !== 'string' || !adapterId.value) {
    return fail(REASON_CODES.INPUT_INVALID, 'provenanceAnchor.adapterId is invalid.');
  }
  const adapterVersion = requireData(anchorRead.value, 'adapterVersion');
  if (!adapterVersion.ok || typeof adapterVersion.value !== 'string' || !adapterVersion.value) {
    return fail(REASON_CODES.INPUT_INVALID, 'provenanceAnchor.adapterVersion is invalid.');
  }
  const evidenceSha = requireData(anchorRead.value, 'evidenceArtifactSha256');
  if (
    !evidenceSha.ok ||
    typeof evidenceSha.value !== 'string' ||
    !/^[a-f0-9]{64}$/.test(evidenceSha.value)
  ) {
    return fail(REASON_CODES.INPUT_INVALID, 'provenanceAnchor.evidenceArtifactSha256 is invalid.');
  }
  const manualSha = requireData(anchorRead.value, 'manualRulesSha256');
  if (
    !manualSha.ok ||
    typeof manualSha.value !== 'string' ||
    !/^[a-f0-9]{64}$/.test(manualSha.value)
  ) {
    return fail(REASON_CODES.INPUT_INVALID, 'provenanceAnchor.manualRulesSha256 is invalid.');
  }
  const srcFp = requireData(anchorRead.value, 'sourceFingerprint');
  if (!srcFp.ok)
    return fail(REASON_CODES.INPUT_INVALID, 'provenanceAnchor.sourceFingerprint is invalid.');
  if (
    srcFp.value != null &&
    (typeof srcFp.value !== 'string' || !/^[a-f0-9]{64}$/.test(srcFp.value))
  ) {
    return fail(REASON_CODES.INPUT_INVALID, 'provenanceAnchor.sourceFingerprint is invalid.');
  }

  let supported = 0;
  let unsupportedVectors = 0;
  let missingEvidenceVectors = 0;
  let unknownBizVectors = 0;
  const seenIds = new Set();

  for (let i = 0; i < vectorsArr.length; i += 1) {
    const v = vectorsArr.elements[i];
    const vInsp = inspectObjectStrict(v, 'vector');
    if (!vInsp.ok) return vInsp;
    if (!exactKeySet(vInsp.keys, VECTOR_KEYS)) {
      return fail(REASON_CODES.INPUT_INVALID, 'Vector entry schema is invalid.');
    }

    const id = requireData(v, 'id');
    if (!id.ok || typeof id.value !== 'string' || !/^[a-f0-9]{32}$/.test(id.value)) {
      return fail(REASON_CODES.INPUT_INVALID, 'Vector id is invalid.');
    }
    if (seenIds.has(id.value)) {
      return fail(REASON_CODES.INPUT_INVALID, 'Duplicate vector id.');
    }
    seenIds.add(id.value);

    const category = requireData(v, 'category');
    if (!category.ok || typeof category.value !== 'string' || !CATEGORY_SET.has(category.value)) {
      return fail(REASON_CODES.INPUT_INVALID, 'Vector category is invalid.');
    }

    const supportStatus = requireData(v, 'supportStatus');
    if (!supportStatus.ok || !SUPPORT_SET.has(supportStatus.value)) {
      return fail(REASON_CODES.INPUT_INVALID, 'Vector supportStatus is invalid.');
    }
    if (supportStatus.value === SUPPORT_STATUS.SUPPORTED) supported += 1;
    else if (supportStatus.value === SUPPORT_STATUS.UNSUPPORTED) unsupportedVectors += 1;
    else if (supportStatus.value === SUPPORT_STATUS.MISSING_EVIDENCE) missingEvidenceVectors += 1;
    else if (supportStatus.value === SUPPORT_STATUS.UNKNOWN_BUSINESS_VALIDITY) {
      unknownBizVectors += 1;
    }

    const tableRead = requireData(v, 'table');
    if (!tableRead.ok) return fail(REASON_CODES.INPUT_INVALID, 'vector.table is invalid.');
    const tableCheck = validateTableRef(tableRead.value);
    if (!tableCheck.ok) return tableCheck;

    const expectation = requireData(v, 'expectation');
    if (!expectation.ok) return fail(REASON_CODES.INPUT_INVALID, 'Vector expectation is required.');
    const expInsp = inspectObjectStrict(expectation.value, 'expectation');
    if (!expInsp.ok) return expInsp;
    if (!exactKeySet(expInsp.keys, EXPECTATION_KEYS)) {
      return fail(REASON_CODES.INPUT_INVALID, 'Vector expectation schema is invalid.');
    }
    const outcome = requireData(expectation.value, 'outcome');
    const technical = requireData(expectation.value, 'technical');
    const business = requireData(expectation.value, 'business');
    if (!outcome.ok || !technical.ok || !business.ok) {
      return fail(REASON_CODES.INPUT_INVALID, 'Vector expectation is invalid.');
    }
    if (typeof outcome.value !== 'string' || !OUTCOME_SET.has(outcome.value)) {
      return fail(REASON_CODES.INPUT_INVALID, 'Vector expectation outcome is invalid.');
    }
    if (
      technical.value != null &&
      (typeof technical.value !== 'string' || technical.value.length > 256)
    ) {
      return fail(REASON_CODES.INPUT_INVALID, 'Vector expectation technical is invalid.');
    }
    if (business.value !== 'unknown') {
      return fail(REASON_CODES.INPUT_INVALID, 'Vector business validity must be unknown.');
    }

    const rationale = requireData(v, 'rationale');
    if (!rationale.ok || typeof rationale.value !== 'string') {
      return fail(REASON_CODES.INPUT_INVALID, 'Vector rationale is required.');
    }
    if (utf8ByteLength(rationale.value) > LIMITS.maxRationaleUtf8Bytes) {
      return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Vector rationale exceeds UTF-8 byte bound.');
    }

    const provenance = requireData(v, 'provenance');
    if (!provenance.ok) return fail(REASON_CODES.INPUT_INVALID, 'Vector provenance is invalid.');
    const provArr = inspectUntrustedArray(provenance.value);
    if (!provArr.ok || provArr.length > LIMITS.maxProvenanceReasonsPerVector) {
      return fail(REASON_CODES.INPUT_INVALID, 'Vector provenance is invalid.');
    }
    for (let p = 0; p < provArr.length; p += 1) {
      const pe = validateProvenanceEntry(provArr.elements[p]);
      if (!pe.ok) return pe;
    }

    const assumptions = requireData(v, 'assumptions');
    if (!assumptions.ok)
      return fail(REASON_CODES.INPUT_INVALID, 'Vector assumptions must be an array.');
    const assArr = inspectUntrustedArray(assumptions.value);
    if (!assArr.ok || assArr.length > 32) {
      return fail(REASON_CODES.INPUT_INVALID, 'Vector assumptions are invalid.');
    }
    for (let a = 0; a < assArr.length; a += 1) {
      if (typeof assArr.elements[a] !== 'string' || assArr.elements[a].length > 256) {
        return fail(REASON_CODES.INPUT_INVALID, 'Vector assumption exceeds bound.');
      }
    }

    const input = requireData(v, 'input');
    if (!input.ok) return fail(REASON_CODES.INPUT_INVALID, 'Vector input is required.');
    const inputInsp = inspectObjectStrict(input.value, 'vector.input');
    if (!inputInsp.ok) return inputInsp;
    if (!exactKeySet(inputInsp.keys, INPUT_KEYS)) {
      return fail(REASON_CODES.INPUT_INVALID, 'Vector input schema is invalid.');
    }
    const assignments = requireData(input.value, 'assignments');
    if (!assignments.ok)
      return fail(REASON_CODES.INPUT_INVALID, 'Vector input.assignments is required.');
    const asg = validateAssignments(assignments.value);
    if (!asg.ok) return asg;

    // Recompute stable ID from the same normalized identity used by generation.
    const recomputed = buildVectorId({
      category: category.value,
      table: tableCheck.table,
      assignments: assignments.value,
      expectation: {
        outcome: outcome.value,
        technical: technical.value,
      },
    });
    if (recomputed !== id.value) {
      return fail(REASON_CODES.INPUT_INVALID, 'Vector id does not match normalized identity.');
    }
  }

  const gapsRead = requireData(value, 'gaps');
  if (!gapsRead.ok) return fail(REASON_CODES.INPUT_INVALID, 'gaps are invalid.');
  const gapsArr = inspectUntrustedArray(gapsRead.value);
  if (!gapsArr.ok || gapsArr.length > LIMITS.maxGaps) {
    return fail(REASON_CODES.INPUT_INVALID, 'gaps are invalid.');
  }
  for (let i = 0; i < gapsArr.length; i += 1) {
    const ge = validateGapEntry(gapsArr.elements[i]);
    if (!ge.ok) return ge;
  }

  const diagRead = requireData(value, 'diagnostics');
  if (!diagRead.ok) return fail(REASON_CODES.INPUT_INVALID, 'diagnostics are invalid.');
  const diagArr = inspectUntrustedArray(diagRead.value);
  if (!diagArr.ok || diagArr.length > LIMITS.maxDiagnostics) {
    return fail(REASON_CODES.INPUT_INVALID, 'diagnostics are invalid.');
  }
  for (let i = 0; i < diagArr.length; i += 1) {
    const de = validateDiagnosticEntry(diagArr.elements[i]);
    if (!de.ok) return de;
  }

  const qualityReport = requireData(value, 'qualityReport');
  if (!qualityReport.ok) return fail(REASON_CODES.INPUT_INVALID, 'qualityReport is required.');
  const qrInsp = inspectObjectStrict(qualityReport.value, 'qualityReport');
  if (!qrInsp.ok) return qrInsp;
  if (!exactKeySet(qrInsp.keys, QUALITY_KEYS)) {
    return fail(REASON_CODES.INPUT_INVALID, 'qualityReport schema is invalid.');
  }
  const qSupported = requireNonNegativeInt(qualityReport.value, 'supported');
  const qUnsupported = requireNonNegativeInt(qualityReport.value, 'unsupported');
  const qMissing = requireNonNegativeInt(qualityReport.value, 'missingEvidence');
  const qUnknown = requireNonNegativeInt(qualityReport.value, 'unknownBusinessValidity');
  const qGaps = requireNonNegativeInt(qualityReport.value, 'gapCount');
  const qVectors = requireNonNegativeInt(qualityReport.value, 'vectorCount');
  if (
    !qSupported.ok ||
    !qUnsupported.ok ||
    !qMissing.ok ||
    !qUnknown.ok ||
    !qGaps.ok ||
    !qVectors.ok
  ) {
    return fail(REASON_CODES.INPUT_INVALID, 'qualityReport counts are invalid.');
  }

  // Recompute quality buckets: vectors by status + relevant gaps (matches generator).
  let unsupportedGaps = 0;
  let missingGaps = 0;
  let unknownBizGaps = 0;
  const unsupportedKinds = new Set([
    GAP_KINDS.UNSUPPORTED_CHECK,
    GAP_KINDS.UNSUPPORTED_LITERAL,
    GAP_KINDS.UNSUPPORTED_TYPE,
    GAP_KINDS.UNSUPPORTED_CCSID,
    GAP_KINDS.UNSUPPORTED_COLLATION,
    GAP_KINDS.LIMIT_EXCEEDED,
    GAP_KINDS.MATERIALIZATION_LIMIT,
    GAP_KINDS.UNKNOWN_COLUMN,
    GAP_KINDS.INVALID_DECIMAL_META,
    GAP_KINDS.MALFORMED_FK,
  ]);
  const missingKinds = new Set([
    GAP_KINDS.MISSING_DEFAULT,
    GAP_KINDS.MISSING_CHECK,
    GAP_KINDS.MISSING_UNIQUE,
    GAP_KINDS.MISSING_COMPOSITE_KEY,
    GAP_KINDS.MISSING_EVIDENCE,
    GAP_KINDS.TEMPORAL_PRECISION,
  ]);
  for (let i = 0; i < gapsArr.length; i += 1) {
    const kindRead = requireData(gapsArr.elements[i], 'kind');
    if (!kindRead.ok) continue;
    if (unsupportedKinds.has(kindRead.value)) unsupportedGaps += 1;
    else if (missingKinds.has(kindRead.value)) missingGaps += 1;
    else if (kindRead.value === GAP_KINDS.UNKNOWN_BUSINESS) unknownBizGaps += 1;
  }
  const expectedUnsupported = unsupportedVectors + unsupportedGaps;
  const expectedMissing = missingEvidenceVectors + missingGaps;
  const expectedUnknown = unknownBizVectors + unknownBizGaps;

  if (
    qSupported.value !== supported ||
    qUnsupported.value !== expectedUnsupported ||
    qMissing.value !== expectedMissing ||
    qUnknown.value !== expectedUnknown ||
    qGaps.value !== gapsArr.length ||
    qVectors.value !== vectorsArr.length
  ) {
    return fail(REASON_CODES.INPUT_INVALID, 'qualityReport counts do not match vectors/gaps.');
  }

  const ncRead = requireData(value, 'nonClaims');
  if (!ncRead.ok) return fail(REASON_CODES.INPUT_INVALID, 'nonClaims are required.');
  const nc = validateNonClaims(ncRead.value);
  if (!nc.ok) return nc;

  const notesRead = requireData(value, 'notes');
  if (!notesRead.ok) return fail(REASON_CODES.INPUT_INVALID, 'notes are required.');
  const notes = validateNotes(notesRead.value, 32);
  if (!notes.ok) return notes;

  return {
    ok: true,
    reasonCode: REASON_CODES.OK,
    contractRef: RESULT_CONTRACT_REF,
    vectorCount: vectorsArr.length,
  };
}

function validateManifestRunId(runId) {
  if (typeof runId !== 'string' || !runId) {
    return fail(REASON_CODES.INPUT_INVALID, 'Manifest runId is required.');
  }
  if (
    /[\u0000-\u001f\u007f]/.test(runId) ||
    runId.includes('/') ||
    runId.includes('\\') ||
    runId.includes('..')
  ) {
    return fail(REASON_CODES.INPUT_INVALID, 'Manifest runId must be a single relative segment.');
  }
  if (runId.length > LIMITS.maxRunIdChars) {
    return fail(REASON_CODES.INPUT_INVALID, 'Manifest runId exceeds bound.');
  }
  if (sanitizeRunId(runId) !== runId) {
    return fail(REASON_CODES.INPUT_INVALID, 'Manifest runId must be canonical sanitized form.');
  }
  return { ok: true };
}

/**
 * Strict portable validation of the artifact manifest.
 * Requires canonical + Markdown; optional JUnit/Robot at most once each.
 */
function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return fail(REASON_CODES.INPUT_INVALID, 'Manifest must be an object.');
  }
  const top = inspectUntrustedOwnProperties(manifest);
  if (!top.ok) {
    return fail(REASON_CODES.INPUT_INVALID, top.message || 'Manifest structure is invalid.');
  }
  if (!exactKeySet(top.keys, MANIFEST_TOP_KEYS)) {
    return fail(REASON_CODES.INPUT_INVALID, 'Manifest top-level schema is invalid.');
  }

  const schemaVersion = requireData(manifest, 'schemaVersion');
  if (!schemaVersion.ok || schemaVersion.value !== 1) {
    return fail(REASON_CODES.INPUT_INVALID, 'Unsupported manifest schema version.');
  }
  const kind = requireData(manifest, 'kind');
  if (!kind.ok || kind.value !== MANIFEST_KIND) {
    return fail(REASON_CODES.INPUT_INVALID, 'Manifest kind is invalid.');
  }
  const contractRef = requireData(manifest, 'contractRef');
  if (!contractRef.ok || contractRef.value !== RESULT_CONTRACT_REF) {
    return fail(REASON_CODES.INPUT_INVALID, 'Manifest contractRef is invalid.');
  }
  const runId = requireData(manifest, 'runId');
  if (!runId.ok) return fail(REASON_CODES.INPUT_INVALID, 'Manifest runId is required.');
  const runCheck = validateManifestRunId(runId.value);
  if (!runCheck.ok) return runCheck;

  const nc = requireData(manifest, 'nonClaims');
  if (!nc.ok) return fail(REASON_CODES.INPUT_INVALID, 'Manifest nonClaims are required.');
  const ncCheck = validateNonClaims(nc.value);
  if (!ncCheck.ok) return ncCheck;

  const notes = requireData(manifest, 'notes');
  if (!notes.ok) return fail(REASON_CODES.INPUT_INVALID, 'Manifest notes are required.');
  const notesCheck = validateNotes(notes.value, 16);
  if (!notesCheck.ok) return notesCheck;

  const arts = requireData(manifest, 'artifacts');
  if (!arts.ok) return fail(REASON_CODES.INPUT_INVALID, 'Manifest artifacts must be an array.');
  const artArr = inspectUntrustedArray(arts.value);
  if (!artArr.ok) {
    return fail(REASON_CODES.INPUT_INVALID, 'Manifest artifacts must be a dense array.');
  }
  // Required canonical+markdown (2) plus optional junit/robot (2) → max 4 content files.
  if (artArr.length < 2 || artArr.length > 4) {
    return fail(REASON_CODES.INPUT_INVALID, 'Manifest artifact count is invalid.');
  }

  let totalSize = 0;
  const seenPaths = new Set();
  for (let i = 0; i < artArr.length; i += 1) {
    const entry = artArr.elements[i];
    const eInsp = inspectObjectStrict(entry, 'manifest artifact');
    if (!eInsp.ok) return eInsp;
    if (!exactKeySet(eInsp.keys, MANIFEST_ARTIFACT_KEYS)) {
      return fail(REASON_CODES.INPUT_INVALID, 'Manifest artifact entry schema is invalid.');
    }
    const path = requireData(entry, 'path');
    if (!path.ok || typeof path.value !== 'string' || !path.value) {
      return fail(REASON_CODES.INPUT_INVALID, 'Manifest artifact path is required.');
    }
    if (
      path.value.includes('/') ||
      path.value.includes('\\') ||
      path.value.includes('..') ||
      path.value === ARTIFACT_FILES.MANIFEST ||
      !CONTENT_PATH_SET.has(path.value)
    ) {
      return fail(REASON_CODES.INPUT_INVALID, 'Manifest artifact path is invalid.');
    }
    if (seenPaths.has(path.value)) {
      return fail(REASON_CODES.INPUT_INVALID, 'Manifest artifact path is duplicated.');
    }
    seenPaths.add(path.value);

    const sha = requireData(entry, 'sha256');
    if (!sha.ok || typeof sha.value !== 'string' || !/^[a-f0-9]{64}$/.test(sha.value)) {
      return fail(REASON_CODES.INPUT_INVALID, 'Manifest artifact sha256 is invalid.');
    }
    const size = requireData(entry, 'sizeBytes');
    if (!size.ok || !Number.isInteger(size.value) || size.value < 0) {
      return fail(REASON_CODES.INPUT_INVALID, 'Manifest artifact sizeBytes is invalid.');
    }
    if (path.value === ARTIFACT_FILES.CANONICAL && size.value > LIMITS.maxCanonicalJsonBytes) {
      return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Manifest artifact size exceeds bound.');
    }
    if (path.value === ARTIFACT_FILES.MARKDOWN && size.value > LIMITS.maxMarkdownBytes) {
      return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Manifest artifact size exceeds bound.');
    }
    if (
      (path.value === ARTIFACT_FILES.JUNIT || path.value === ARTIFACT_FILES.ROBOT) &&
      size.value > LIMITS.maxFrameworkOutputBytes
    ) {
      return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Manifest artifact size exceeds bound.');
    }
    totalSize += size.value;
    if (totalSize > LIMITS.maxAggregateArtifactBytes) {
      return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Manifest aggregate size exceeds bound.');
    }
  }

  if (!seenPaths.has(ARTIFACT_FILES.CANONICAL)) {
    return fail(REASON_CODES.INPUT_INVALID, 'Manifest must list the canonical vector set.');
  }
  if (!seenPaths.has(ARTIFACT_FILES.MARKDOWN)) {
    return fail(REASON_CODES.INPUT_INVALID, 'Manifest must list the Markdown projection.');
  }

  return {
    ok: true,
    reasonCode: REASON_CODES.OK,
    runId: runId.value,
    paths: [...seenPaths],
  };
}

module.exports = {
  validateVectorSet,
  validateManifest,
};
