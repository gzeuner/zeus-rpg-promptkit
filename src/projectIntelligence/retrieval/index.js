'use strict';

/**
 * Retrieval and context assembly (ZPI-08).
 */

const constants = require('./constants');
const tokenBudget = require('./tokenBudget');
const graphExpansion = require('./graphExpansion');
const sourceVerification = require('./sourceVerification');
const contextAssembler = require('./contextAssembler');
const retriever = require('./retriever');

module.exports = {
  ...constants,
  normalizeTokenBudget: tokenBudget.normalizeTokenBudget,
  allocateBudgetSlices: tokenBudget.allocateBudgetSlices,
  packBucket: tokenBudget.packBucket,
  estimateItemTokens: tokenBudget.estimateItemTokens,
  expandNeighborhood: graphExpansion.expandNeighborhood,
  seedIdsFromHits: graphExpansion.seedIdsFromHits,
  buildAdjacency: graphExpansion.buildAdjacency,
  verifySourceEvidence: sourceVerification.verifySourceEvidence,
  assembleContextPackage: contextAssembler.assembleContextPackage,
  createProjectRetriever: retriever.createProjectRetriever,
};
