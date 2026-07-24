'use strict';

/**
 * Zeus Project Intelligence — Community contracts, store, and content (ZPI-02..04).
 *
 * ZPI-02: contracts, reason codes, validators, fixtures, contract test kit.
 * ZPI-03: KnowledgeStore SPI + SQLite metadata provider, locks, migrations.
 * ZPI-04: content-addressed store, trusted roots, path controls (GC design-only).
 *
 * Not included yet: Lucene, analyzers, CLI/MCP.
 */

const constants = require('./constants');
const CONTRACT_IDS = require('./contractIds');
const contracts = require('./contracts');
const helpers = require('./helpers');
const fixtures = require('./fixtures');
const validate = require('./validate');
const { runProjectIntelligenceContractTests } = require('./contractTestKit');
const store = require('./store');
const content = require('./content');

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

  // Content store (ZPI-04)
  content,
  createContentStore: content.createContentStore,
  openContentStoreFromKnowledgeRoot: content.openContentStoreFromKnowledgeRoot,
  canonicalizeContent: content.canonicalizeContent,
  sha256Hex: content.sha256Hex,
  describeContentGarbageCollection: content.describeContentGarbageCollection,
  runContentGarbageCollection: content.runContentGarbageCollection,
};
