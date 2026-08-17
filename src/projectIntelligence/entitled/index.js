'use strict';

/**
 * Public commercial Project Intelligence surface (ZPI-09/10).
 * Registration, policy helpers, and entitled operation functions.
 * Ops are also exposed as capabilities via registerProjectIntelligenceModule.
 */

const register = require('./register');
const constants = require('./constants');
const trustedRoots = require('./trustedRoots');
const resourcePolicy = require('./resourcePolicy');
const operations = require('./operations');

module.exports = {
  MODULE_ID: constants.MODULE_ID,
  MODULE_VERSION: constants.MODULE_VERSION,
  CAPABILITY_IDS: constants.CAPABILITY_IDS,
  NON_CLAIMS: constants.NON_CLAIMS,
  NON_CLAIM_MESSAGES: constants.NON_CLAIM_MESSAGES,
  DEFAULT_RESOURCE_POLICY: constants.DEFAULT_RESOURCE_POLICY,
  buildDescriptor: register.buildDescriptor,
  registerProjectIntelligenceModule: register.registerProjectIntelligenceModule,
  validateTrustedRoots: trustedRoots.validateTrustedRoots,
  evaluateResourcePolicy: resourcePolicy.evaluateResourcePolicy,
  cloneDefaultResourcePolicy: resourcePolicy.cloneDefaultResourcePolicy,
  // ZPI-10 operation surface (also registered as capabilities)
  createProjectKnowledge: operations.createProjectKnowledge,
  fullIndex: operations.fullIndex,
  incrementalUpdate: operations.incrementalUpdate,
  queryKnowledge: operations.queryKnowledge,
  impactAnalysis: operations.impactAnalysis,
  buildContextPackage: operations.buildContextPackage,
  inspectSnapshot: operations.inspectSnapshot,
  verifyIntegrity: operations.verifyIntegrity,
};
