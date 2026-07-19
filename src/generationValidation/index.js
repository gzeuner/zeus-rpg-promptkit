'use strict';

const constants = require('./constants');
const contracts = require('./contracts');
const { createValidatorRegistry } = require('./validatorRegistry');
const { createBuiltInValidators } = require('./builtInValidators');
const { extractDeclaredFiles } = require('./extractDeclaredFiles');
const { validateWorkspacePath, normalizeRelativePath } = require('./pathSafety');
const {
  validateGenerationCandidate,
  createDefaultValidatorRegistry,
  createDefaultSchemaRegistry,
} = require('./validateCandidate');
const {
  buildReviewDiff,
  buildValidationReport,
  writeReviewArtifacts,
} = require('./reviewArtifacts');

module.exports = {
  ...constants,
  CONTRACT_IDS: contracts.CONTRACT_IDS,
  GENERATION_SCHEMAS: contracts.GENERATION_SCHEMAS,
  generationCandidateSchema: contracts.generationCandidateSchema,
  generationValidationReportSchema: contracts.generationValidationReportSchema,
  externalLinterAdapterSchema: contracts.externalLinterAdapterSchema,
  createValidatorRegistry,
  createBuiltInValidators,
  extractDeclaredFiles,
  validateWorkspacePath,
  normalizeRelativePath,
  validateGenerationCandidate,
  createDefaultValidatorRegistry,
  createDefaultSchemaRegistry,
  buildReviewDiff,
  buildValidationReport,
  writeReviewArtifacts,
};
