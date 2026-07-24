'use strict';

/**
 * Zeus Project Intelligence — Community contracts (ZPI-02) and store (ZPI-03).
 *
 * ZPI-02: contracts, reason codes, validators, fixtures, contract test kit.
 * ZPI-03: KnowledgeStore SPI + SQLite metadata provider, locks, migrations.
 *
 * Not included yet: content store, Lucene, analyzers, CLI/MCP.
 */

const constants = require('./constants');
const CONTRACT_IDS = require('./contractIds');
const contracts = require('./contracts');
const helpers = require('./helpers');
const fixtures = require('./fixtures');
const validate = require('./validate');
const { runProjectIntelligenceContractTests } = require('./contractTestKit');
const store = require('./store');

module.exports = {
  // Vocabulary
  ...constants,
  CONTRACT_IDS,

  // Schemas
  PROJECT_INTELLIGENCE_SCHEMAS: contracts.PROJECT_INTELLIGENCE_SCHEMAS,
  projectSchema: contracts.projectSchema,
  snapshotSchema: contracts.snapshotSchema,
  sourceUnitSchema: contracts.sourceUnitSchema,
  sourceSpanSchema: contracts.sourceSpanSchema,
  symbolSchema: contracts.symbolSchema,
  relationshipSchema: contracts.relationshipSchema,
  analyzerRunSchema: contracts.analyzerRunSchema,
  evidenceSchema: contracts.evidenceSchema,
  summarySchema: contracts.summarySchema,
  diagnosticSchema: contracts.diagnosticSchema,
  contextPackageSchema: contracts.contextPackageSchema,
  operationResultSchema: contracts.operationResultSchema,

  // Helpers
  isSafeRelativePath: helpers.isSafeRelativePath,
  isSha256Hex: helpers.isSha256Hex,
  validateProvenance: helpers.validateProvenance,

  // Validation API
  registerProjectIntelligenceSchemas: validate.registerProjectIntelligenceSchemas,
  createProjectIntelligenceRegistry: validate.createProjectIntelligenceRegistry,
  validateProjectIntelligenceContract: validate.validateProjectIntelligenceContract,
  createValidators: validate.createValidators,

  // Fixtures + contract test kit
  fixtures,
  runProjectIntelligenceContractTests,

  // Knowledge store (ZPI-03)
  store,
  createProjectKnowledgeStore: store.createProjectKnowledgeStore,
  openProjectKnowledgeStore: store.openProjectKnowledgeStore,
  KnowledgeStoreError: store.KnowledgeStoreError,
  probeNodeSqlite: store.probeNodeSqlite,
};
