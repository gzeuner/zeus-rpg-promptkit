'use strict';

/**
 * Public subpath: zeus-rpg-promptkit/db2-test-intelligence
 *
 * Entitlement-free artifact validation/reading and pure deterministic projection helpers.
 * Does NOT export the generation engine, parser, registration, path sanitizers,
 * or low-level hash/canonical primitives.
 *
 * Registration is root-only: registerDb2TestIntelligenceModule from package root.
 */

const constants = require('./constants');
const { validateVectorSet, validateManifest } = require('./validate');
const { readArtifacts, projectExports } = require('./artifactReader');
const {
  exportMarkdown,
  exportJunitXml,
  exportRobotFramework,
  exportFramework,
} = require('./exporters');

module.exports = {
  // Contract / vocabulary needed by validators and portable consumers
  REQUEST_CONTRACT_REF: constants.REQUEST_CONTRACT_REF,
  RESULT_CONTRACT_REF: constants.RESULT_CONTRACT_REF,
  RESULT_CONTRACT_ID: constants.RESULT_CONTRACT_ID,
  RESULT_CONTRACT_VERSION: constants.RESULT_CONTRACT_VERSION,
  REASON_CODES: constants.REASON_CODES,
  NON_CLAIMS: constants.NON_CLAIMS,
  LIMITS: constants.LIMITS,
  ARTIFACT_FILES: constants.ARTIFACT_FILES,
  FRAMEWORK_IDS: constants.FRAMEWORK_IDS,
  SUPPORT_STATUS: constants.SUPPORT_STATUS,
  // Entitlement-free validation / reading / pure projections
  validateVectorSet,
  validateManifest,
  readArtifacts,
  projectExports,
  exportMarkdown,
  exportJunitXml,
  exportRobotFramework,
  exportFramework,
};
