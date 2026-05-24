'use strict';

const FINAL_KNOWLEDGE_SCHEMA_VERSION = '1.0.0';
const CONFIDENCE_LEVELS = new Set(['high', 'medium', 'low', 'unknown']);
const PRIVACY_ASSESSMENT_STATUS = new Set(['passed', 'needs-review', 'failed']);
const ALLOWED_PATTERN_KINDS = Object.freeze([
  'ui.grid',
  'ui.button',
  'ui.toolbar',
  'ui.form',
  'ui.panel',
  'ui.dialog',
  'ui.selection',
  'ui.validation',
  'ui.navigation',
  'program.crud',
  'program.lookup',
  'program.batch',
  'program.report',
  'data.table-access',
  'data.join-pattern',
  'workflow.prompt-confirm-action',
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function normalizeString(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function validatePatternElement(element, index) {
  const errors = [];
  if (!isPlainObject(element)) {
    errors.push(`patterns[${index}].elements[] entry must be an object`);
    return errors;
  }
  if (typeof element.role !== 'string' || element.role.trim().length === 0) {
    errors.push(`patterns[${index}].elements[].role must be a non-empty string`);
  }
  if (typeof element.intent !== 'string' || element.intent.trim().length === 0) {
    errors.push(`patterns[${index}].elements[].intent must be a non-empty string`);
  }
  if (!isStringArray(element.layoutHints || [])) {
    errors.push(`patterns[${index}].elements[].layoutHints must be a string array when provided`);
  }
  if (!isStringArray(element.behaviorHints || [])) {
    errors.push(`patterns[${index}].elements[].behaviorHints must be a string array when provided`);
  }
  return errors;
}

function validatePattern(pattern, index) {
  const errors = [];
  if (!isPlainObject(pattern)) {
    errors.push(`patterns[${index}] must be an object`);
    return errors;
  }

  if (typeof pattern.id !== 'string' || pattern.id.trim().length === 0) {
    errors.push(`patterns[${index}].id must be a non-empty string`);
  }
  if (typeof pattern.kind !== 'string' || !ALLOWED_PATTERN_KINDS.includes(pattern.kind)) {
    errors.push(`patterns[${index}].kind must be one of the allowed project-neutral kinds`);
  }
  if (typeof pattern.domain !== 'string' || pattern.domain.trim().length === 0) {
    errors.push(`patterns[${index}].domain must be a non-empty string`);
  }
  if (!isStringArray(pattern.technology)) {
    errors.push(`patterns[${index}].technology must be a string array`);
  }
  if (!isStringArray(pattern.features)) {
    errors.push(`patterns[${index}].features must be a string array`);
  }
  if (!Array.isArray(pattern.elements)) {
    errors.push(`patterns[${index}].elements must be an array`);
  } else {
    pattern.elements.forEach((element) => {
      errors.push(...validatePatternElement(element, index));
    });
  }

  if (!isPlainObject(pattern.confidence)) {
    errors.push(`patterns[${index}].confidence must be an object`);
  } else {
    const level = String(pattern.confidence.level || '').trim().toLowerCase();
    if (!CONFIDENCE_LEVELS.has(level)) {
      errors.push(`patterns[${index}].confidence.level must be one of high|medium|low|unknown`);
    }
    if (typeof pattern.confidence.score !== 'number' || Number.isNaN(pattern.confidence.score)) {
      errors.push(`patterns[${index}].confidence.score must be a number`);
    }
  }

  if (!isPlainObject(pattern.evidenceSummary)) {
    errors.push(`patterns[${index}].evidenceSummary must be an object`);
  }
  if (!isPlainObject(pattern.privacyAssessment)) {
    errors.push(`patterns[${index}].privacyAssessment must be an object`);
  } else {
    const status = String(pattern.privacyAssessment.status || '').trim().toLowerCase();
    if (!PRIVACY_ASSESSMENT_STATUS.has(status)) {
      errors.push(`patterns[${index}].privacyAssessment.status must be passed|needs-review|failed`);
    }
  }
  if (!isStringArray(pattern.limitations)) {
    errors.push(`patterns[${index}].limitations must be a string array`);
  }

  return errors;
}

function validateFinalKnowledgeCatalog(candidate) {
  const errors = [];
  if (!isPlainObject(candidate)) {
    return {
      valid: false,
      errors: ['catalog must be an object'],
    };
  }

  if (typeof candidate.schemaVersion !== 'string' || candidate.schemaVersion.trim().length === 0) {
    errors.push('schemaVersion must be a non-empty string');
  }
  if (typeof candidate.generatedAt !== 'string' || candidate.generatedAt.trim().length === 0) {
    errors.push('generatedAt must be a non-empty string');
  }
  if (!isPlainObject(candidate.generator)) {
    errors.push('generator must be an object');
  } else {
    if (typeof candidate.generator.name !== 'string' || candidate.generator.name.trim().length === 0) {
      errors.push('generator.name must be a non-empty string');
    }
    if (typeof candidate.generator.version !== 'string' || candidate.generator.version.trim().length === 0) {
      errors.push('generator.version must be a non-empty string');
    }
  }
  if (typeof candidate.privacyMode !== 'string' || candidate.privacyMode.trim().length === 0) {
    errors.push('privacyMode must be a non-empty string');
  }
  if (typeof candidate.taxonomyVersion !== 'string' || candidate.taxonomyVersion.trim().length === 0) {
    errors.push('taxonomyVersion must be a non-empty string');
  }
  if (!Array.isArray(candidate.patterns)) {
    errors.push('patterns must be an array');
  } else {
    candidate.patterns.forEach((pattern, index) => {
      errors.push(...validatePattern(pattern, index));
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function createFinalKnowledgeCatalog(input = {}) {
  return {
    schemaVersion: normalizeString(input.schemaVersion, FINAL_KNOWLEDGE_SCHEMA_VERSION),
    generatedAt: normalizeString(input.generatedAt, new Date().toISOString()),
    generator: {
      name: normalizeString(input.generatorName, 'zeus-rpg-promptkit'),
      version: normalizeString(input.generatorVersion, '0.0.0'),
    },
    privacyMode: normalizeString(input.privacyMode, 'strict'),
    taxonomyVersion: normalizeString(input.taxonomyVersion, 'draft-1'),
    patterns: Array.isArray(input.patterns) ? input.patterns : [],
  };
}

module.exports = {
  ALLOWED_PATTERN_KINDS,
  FINAL_KNOWLEDGE_SCHEMA_VERSION,
  createFinalKnowledgeCatalog,
  validateFinalKnowledgeCatalog,
};
