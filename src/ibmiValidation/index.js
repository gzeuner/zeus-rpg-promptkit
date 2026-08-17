'use strict';

const constants = require('./constants');
const ownerGate = require('./ownerGate');
const names = require('./names');
const operations = require('./operations');
const plan = require('./plan');
const redaction = require('./redaction');
const evidence = require('./evidence');
const cleanup = require('./cleanup');
const transport = require('./transport');
const engine = require('./engine');
const { buildDescriptor, registerIbmiCompileValidationModule } = require('./register');

module.exports = {
  // Vocabulary
  PINNED_COMMUNITY_SHA: constants.PINNED_COMMUNITY_SHA,
  MODULE_ID: constants.MODULE_ID,
  CAPABILITY_ID: constants.CAPABILITY_ID,
  DIFF_CAPABILITY_ID: constants.DIFF_CAPABILITY_ID,
  MODULE_VERSION: constants.MODULE_VERSION,
  COMPILE_EVIDENCE_CONTRACT: constants.COMPILE_EVIDENCE_CONTRACT,
  DIFF_EVIDENCE_CONTRACT: constants.DIFF_EVIDENCE_CONTRACT,
  ALLOWED_TEMPLATES: constants.ALLOWED_TEMPLATES,
  ALLOWED_OPERATIONS: constants.ALLOWED_OPERATIONS,
  PUB400_PROFILE_ID: constants.PUB400_PROFILE_ID,
  PUB400_HOST_LABEL: constants.PUB400_HOST_LABEL,
  REASON_CODES: constants.REASON_CODES,
  MODES: constants.MODES,
  LIMITS: constants.LIMITS,
  NON_CLAIMS: constants.NON_CLAIMS,
  // Gates / names / ops
  validateActivationPack: ownerGate.validateActivationPack,
  normalizeObjectName: names.normalizeObjectName,
  assertOwnedLibrary: names.assertOwnedLibrary,
  normalizeMemberRef: names.normalizeMemberRef,
  assertOperationAllowed: operations.assertOperationAllowed,
  assertTemplateAllowed: operations.assertTemplateAllowed,
  assertNoCommandText: operations.assertNoCommandText,
  // Plan / evidence
  buildCompilePlan: plan.buildCompilePlan,
  validateConfirmationToken: plan.validateConfirmationToken,
  fingerprintToken: plan.fingerprintToken,
  hashCanonical: plan.hashCanonical,
  redactText: redaction.redactText,
  redactDiagnostics: redaction.redactDiagnostics,
  buildCompileEvidence: evidence.buildCompileEvidence,
  buildDiffEvidence: evidence.buildDiffEvidence,
  runCleanupManifest: cleanup.runCleanupManifest,
  // Transport / engine
  createOfflineTransport: transport.createOfflineTransport,
  createLiveTransportDenied: transport.createLiveTransportDenied,
  resolveTransport: transport.resolveTransport,
  runCompileValidation: engine.runCompileValidation,
  runDifferentialExecution: engine.runDifferentialExecution,
  // Registration
  buildDescriptor,
  registerIbmiCompileValidationModule,
};
