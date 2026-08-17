'use strict';

const constants = require('./constants');
const canonicalDiagnostics = require('./canonicalDiagnostics');
const attemptHistory = require('./attemptHistory');
const organizationProfiles = require('./organizationProfiles');
const advancedValidators = require('./advancedValidators');
const providerBridge = require('./providerBridge');
const reviewArtifacts = require('./reviewArtifacts');
const evidence = require('./evidence');
const contentBounds = require('./contentBounds');
const sanitize = require('./sanitize');
const {
  MODULE_ID,
  CAPABILITY_ID,
  buildDescriptor,
  registerGenerationAssuranceModule,
} = require('./register');

module.exports = {
  // Vocabulary
  CONTRACT_ID: constants.CONTRACT_ID,
  CONTRACT_VERSION: constants.CONTRACT_VERSION,
  CONTRACT_REF: constants.CONTRACT_REF,
  STOP_CODES: constants.STOP_CODES,
  STATUS_RANK: constants.STATUS_RANK,
  LIMITS: constants.LIMITS,
  DISPOSITIONS: constants.DISPOSITIONS,
  NON_CLAIMS: constants.NON_CLAIMS,
  // Canonical diagnostics
  redactText: canonicalDiagnostics.redactText,
  canonicalizeDiagnostics: canonicalDiagnostics.canonicalizeDiagnostics,
  buildQualityVector: canonicalDiagnostics.buildQualityVector,
  compareQualityVectors: canonicalDiagnostics.compareQualityVectors,
  classifyProgress: canonicalDiagnostics.classifyProgress,
  // Attempt history contract
  buildAttemptRecord: attemptHistory.buildAttemptRecord,
  buildAttemptHistory: attemptHistory.buildAttemptHistory,
  validateAttemptHistory: attemptHistory.validateAttemptHistory,
  exportAttemptHistory: attemptHistory.exportAttemptHistory,
  // Organization profiles (local data only)
  resolveOrganizationProfile: organizationProfiles.resolveOrganizationProfile,
  ALLOWED_PROFILE_KEYS: organizationProfiles.ALLOWED_PROFILE_KEYS,
  // Advanced validators (additive only)
  ADVANCED_PACK_ID: advancedValidators.ADVANCED_PACK_ID,
  KNOWN_ADVANCED_PACK_IDS: advancedValidators.KNOWN_ADVANCED_PACK_IDS,
  resolveAdvancedValidatorIds: advancedValidators.resolveAdvancedValidatorIds,
  createAdvancedValidators: advancedValidators.createAdvancedValidators,
  createAssuranceValidatorRegistry: advancedValidators.createAssuranceValidatorRegistry,
  // Provider bridge / snapshots
  snapshotCandidate: providerBridge.snapshotCandidate,
  snapshotCandidateForHistory: providerBridge.snapshotCandidateForHistory,
  snapshotCandidateFull: providerBridge.snapshotCandidateFull,
  buildProviderRequest: providerBridge.buildProviderRequest,
  extractCandidateFromProviderResponse: providerBridge.extractCandidateFromProviderResponse,
  // Evidence provenance
  evidenceReferencesEqual: evidence.evidenceReferencesEqual,
  assertEvidenceProvenancePreserved: evidence.assertEvidenceProvenancePreserved,
  // Content bounds
  assertCandidateContentBounds: contentBounds.assertCandidateContentBounds,
  // Sanitize
  sanitizeValue: sanitize.sanitizeValue,
  sanitizeValidationReport: sanitize.sanitizeValidationReport,
  // Review artifacts
  writeAssuranceReviewArtifacts: reviewArtifacts.writeAssuranceReviewArtifacts,
  hashWorkspaceTree: reviewArtifacts.hashWorkspaceTree,
  sanitizeRunId: reviewArtifacts.sanitizeRunId,
  // Module registration
  MODULE_ID,
  CAPABILITY_ID,
  buildDescriptor,
  registerGenerationAssuranceModule,
};
