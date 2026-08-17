'use strict';

const {
  COMPILE_EVIDENCE_CONTRACT,
  DIFF_EVIDENCE_CONTRACT,
  LIMITS,
  NON_CLAIMS,
  PINNED_COMMUNITY_SHA,
  REASON_CODES,
} = require('./constants');
const { canonicalize, hashCanonical } = require('./plan');

function fail(reasonCode, message) {
  return { ok: false, reasonCode, message };
}

function buildCompileEvidence({
  plan,
  confirmationTokenFingerprint,
  diagnostics,
  objectOutcomes,
  cleanup,
  mode,
}) {
  if (!plan || !plan.planHash) {
    return fail(REASON_CODES.INPUT_INVALID, 'plan is required for evidence.');
  }
  const body = {
    schemaVersion: 1,
    kind: 'ibmi-compile-evidence',
    contractRef: COMPILE_EVIDENCE_CONTRACT,
    communitySha: PINNED_COMMUNITY_SHA,
    planHash: plan.planHash,
    confirmationTokenFingerprint: confirmationTokenFingerprint || null,
    mode,
    target: plan.target,
    templates: [plan.templateId],
    diagnostics: Array.isArray(diagnostics) ? diagnostics : [],
    objectOutcomes: Array.isArray(objectOutcomes) ? objectOutcomes : [],
    cleanup: cleanup || { completed: false, residuals: [] },
    claims: { ...NON_CLAIMS },
  };
  const json = canonicalize(body);
  if (Buffer.byteLength(json, 'utf8') > LIMITS.maxEvidenceJsonBytes) {
    return fail(REASON_CODES.INPUT_INVALID, 'evidence exceeds size bound.');
  }
  const evidenceHash = hashCanonical(body);
  return {
    ok: true,
    evidence: Object.freeze({ ...body, evidenceHash }),
    evidenceHash,
  };
}

function buildDiffEvidence({
  planHash,
  confirmationTokenFingerprint,
  baseline,
  candidate,
  differences,
  inventoryHash,
  mode,
}) {
  const body = {
    schemaVersion: 1,
    kind: 'ibmi-diff-evidence',
    contractRef: DIFF_EVIDENCE_CONTRACT,
    communitySha: PINNED_COMMUNITY_SHA,
    planHash: planHash || null,
    confirmationTokenFingerprint: confirmationTokenFingerprint || null,
    mode,
    inventoryHash: inventoryHash || null,
    baseline: baseline || null,
    candidate: candidate || null,
    differences: Array.isArray(differences) ? differences : [],
    claims: { ...NON_CLAIMS, approvalBlocked: differences && differences.length > 0 },
  };
  const evidenceHash = hashCanonical(body);
  return {
    ok: true,
    evidence: Object.freeze({ ...body, evidenceHash }),
    evidenceHash,
  };
}

module.exports = {
  buildCompileEvidence,
  buildDiffEvidence,
};
