'use strict';

/**
 * Zeus Project Intelligence — Community contracts, store, content, search (ZPI-02..05).
 *
 * ZPI-02: contracts, reason codes, validators, fixtures, contract test kit.
 * ZPI-03: KnowledgeStore SPI + SQLite metadata provider, locks, migrations.
 * ZPI-04: content-addressed store, trusted roots, path controls (GC design-only).
 * ZPI-05: Search SPI + Community lexical provider (Lucene layout/schema).
 * ZPI-06: Snapshot + incremental update engine (diff, invalidation, atomic publish).
 * ZPI-07: RPG/IBM i analyzer baseline (parser adapters, spans, unresolved model).
 * ZPI-08: Retrieval + context assembly (hybrid lexical/graph, token budgets).
 *
 * Commercial module registration is external (ZPI-09/10). CLI/MCP thin adapters: ZPI-11.
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
const search = require('./search');
const engine = require('./engine');
const analyzers = require('./analyzers');
const retrieval = require('./retrieval');
const adapters = require('./adapters');

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

  // Search (ZPI-05)
  search,
  createSearchProvider: search.createSearchProvider,
  openSearchProvider: search.openSearchProvider,

  // Snapshot engine (ZPI-06)
  engine,
  createSnapshotEngine: engine.createSnapshotEngine,
  openSnapshotEngine: engine.openSnapshotEngine,
  createBaselineAnalyzer: engine.createBaselineAnalyzer,
  planInventoryDiff: engine.planInventoryDiff,
  planInvalidation: engine.planInvalidation,
  buildSourceInventory: engine.buildSourceInventory,

  // RPG/IBM i analyzer (ZPI-07)
  analyzers,
  createRpgAnalyzer: analyzers.createRpgAnalyzer,

  // Retrieval / context (ZPI-08)
  retrieval,
  createProjectRetriever: retrieval.createProjectRetriever,
  assembleContextPackage: retrieval.assembleContextPackage,
  expandNeighborhood: retrieval.expandNeighborhood,
  seedIdsFromHits: retrieval.seedIdsFromHits,
  allocateBudgetSlices: retrieval.allocateBudgetSlices,
  packBucket: retrieval.packBucket,

  // CLI/MCP thin adapters (ZPI-11) — capability present/absent only
  adapters,
  discoverProjectIntelligenceCapabilities: adapters.discoverProjectIntelligenceCapabilities,
  executeProjectIntelligenceOperation: adapters.executeProjectIntelligenceOperation,
  listProjectKnowledgeMcpTools: adapters.listProjectKnowledgeMcpTools,
  COMMERCIAL_CAPABILITY_IDS: adapters.COMMERCIAL_CAPABILITY_IDS,
  PUBLIC_OPERATIONS: adapters.PUBLIC_OPERATIONS,
};
