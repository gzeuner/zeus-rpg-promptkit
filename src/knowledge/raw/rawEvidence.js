'use strict';

const RAW_EVIDENCE_SCHEMA_VERSION = '0.1.0';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function createRawEvidenceEnvelope(input = {}) {
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  return {
    layer: 'raw',
    schemaVersion: RAW_EVIDENCE_SCHEMA_VERSION,
    generatedAt: normalizeString(input.generatedAt, new Date().toISOString()),
    generator: {
      name: normalizeString(input.generatorName, 'zeus-rpg-promptkit'),
      version: normalizeString(input.generatorVersion, '0.0.0'),
    },
    sourceClass: normalizeString(input.sourceClass, 'unknown'),
    sensitive: true,
    evidence,
  };
}

function isRawEvidenceEnvelope(value) {
  return (
    isPlainObject(value) &&
    value.layer === 'raw' &&
    typeof value.schemaVersion === 'string' &&
    value.sensitive === true
  );
}

module.exports = {
  RAW_EVIDENCE_SCHEMA_VERSION,
  createRawEvidenceEnvelope,
  isRawEvidenceEnvelope,
};
