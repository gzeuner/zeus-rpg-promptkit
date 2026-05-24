'use strict';

const { validateFinalKnowledgeCatalog } = require('../final/finalKnowledgeCatalog');
const { isRawEvidenceEnvelope } = require('../raw/rawEvidence');
const { isSanitizedCandidateEnvelope } = require('../sanitized/sanitizedCandidate');
const { collectPrivacySignals } = require('./privacySignals');

function toMalformedReasons(errors) {
  if (!Array.isArray(errors) || errors.length === 0) {
    return [
      {
        code: 'MALFORMED_FINAL_CATALOG',
        message: 'Final catalog shape is invalid or incomplete.',
      },
    ];
  }
  return errors.map((detail) => ({
    code: 'MALFORMED_FINAL_CATALOG',
    message: `Final catalog shape is invalid: ${detail}`,
  }));
}

function evaluateFinalCatalogPrivacy(candidate) {
  const reasons = [];

  if (isRawEvidenceEnvelope(candidate)) {
    reasons.push({
      code: 'RAW_EVIDENCE_NOT_ALLOWED',
      message: 'Raw evidence envelopes are sensitive and cannot be treated as final catalog output.',
    });
    return { passed: false, reasons };
  }

  if (isSanitizedCandidateEnvelope(candidate)) {
    reasons.push({
      code: 'SANITIZED_NOT_FINAL',
      message: 'Sanitized intermediate data is not final-safe by default and must not be exposed as final knowledge.',
    });
    return { passed: false, reasons };
  }

  const validation = validateFinalKnowledgeCatalog(candidate);
  if (!validation.valid) {
    return {
      passed: false,
      reasons: toMalformedReasons(validation.errors),
    };
  }

  reasons.push(...collectPrivacySignals(candidate));

  return {
    passed: reasons.length === 0,
    reasons,
  };
}

module.exports = {
  evaluateFinalCatalogPrivacy,
};
