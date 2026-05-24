'use strict';

const SANITIZED_CANDIDATE_SCHEMA_VERSION = '0.1.0';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function createSanitizedCandidateEnvelope(input = {}) {
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  return {
    layer: 'sanitized',
    schemaVersion: SANITIZED_CANDIDATE_SCHEMA_VERSION,
    generatedAt: normalizeString(input.generatedAt, new Date().toISOString()),
    generator: {
      name: normalizeString(input.generatorName, 'zeus-rpg-promptkit'),
      version: normalizeString(input.generatorVersion, '0.0.0'),
    },
    sourceClass: normalizeString(input.sourceClass, 'unknown'),
    sensitive: true,
    candidates,
    reviewRequired: true,
  };
}

function isSanitizedCandidateEnvelope(value) {
  return isPlainObject(value)
    && value.layer === 'sanitized'
    && typeof value.schemaVersion === 'string'
    && value.sensitive === true;
}

module.exports = {
  SANITIZED_CANDIDATE_SCHEMA_VERSION,
  createSanitizedCandidateEnvelope,
  isSanitizedCandidateEnvelope,
};
