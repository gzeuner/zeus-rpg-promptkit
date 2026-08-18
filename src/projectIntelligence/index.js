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
 * Track C: portable snapshot export packaging, offline corpora, embeddings default off.
 *
 * Entitled operations are integrated through the same public registrar. CLI/MCP thin adapters: ZPI-11.
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
const knowledgeFirst = require('./knowledgeFirst');
const adapters = require('./adapters');
const portableExport = require('./export');
const corpora = require('./corpora');
const entitled = require('./entitled');

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

  // Community-neutral first point to check for source-backed legacy knowledge.
  knowledgeFirst,
  createKnowledgeFirstService: knowledgeFirst.createKnowledgeFirstService,
  inspectKnowledgeFirst: knowledgeFirst.inspectKnowledgeFirst,
  syncKnowledgeFirst: knowledgeFirst.syncKnowledgeFirst,
  lookupKnowledgeFirst: knowledgeFirst.lookupKnowledgeFirst,

  // CLI/MCP thin adapters (ZPI-11) — capability present/absent only
  adapters,
  discoverProjectIntelligenceCapabilities: adapters.discoverProjectIntelligenceCapabilities,
  executeProjectIntelligenceOperation: adapters.executeProjectIntelligenceOperation,
  listProjectKnowledgeMcpTools: adapters.listProjectKnowledgeMcpTools,
  COMMERCIAL_CAPABILITY_IDS: adapters.COMMERCIAL_CAPABILITY_IDS,
  PUBLIC_OPERATIONS: adapters.PUBLIC_OPERATIONS,

  // Track C — portable export packaging
  export: portableExport,
  PORTABLE_PACKAGE_SCHEMA: portableExport.PORTABLE_PACKAGE_SCHEMA,
  PORTABLE_PACKAGE_KIND: portableExport.PORTABLE_PACKAGE_KIND,
  exportPortableSnapshotPackage: portableExport.exportPortableSnapshotPackage,
  openPortableSnapshotPackage: portableExport.openPortableSnapshotPackage,

  // Track C — offline corpora fixtures
  corpora,
  listCorpora: corpora.listCorpora,
  getCorpus: corpora.getCorpus,
  materializeCorpus: corpora.materializeCorpus,

  // Track C — embeddings policy (default off)
  EMBEDDINGS_DEFAULT_ENABLED: search.EMBEDDINGS_DEFAULT_ENABLED,
  resolveEmbeddingPolicy: search.resolveEmbeddingPolicy,

  // Unified optional operations. These reuse the Community engines above and
  // add explicit entitlement/resource-policy checks without replacing the
  // Community contract and storage APIs.
  entitled,
  entitledProjectIntelligence: entitled,
  registerProjectIntelligenceModule: entitled.registerProjectIntelligenceModule,
  buildDescriptor: entitled.buildDescriptor,
  createProjectKnowledge: entitled.createProjectKnowledge,
  fullIndex: entitled.fullIndex,
  incrementalUpdate: entitled.incrementalUpdate,
  queryKnowledge: entitled.queryKnowledge,
  impactAnalysis: entitled.impactAnalysis,
  buildContextPackage: entitled.buildContextPackage,
  inspectSnapshot: entitled.inspectSnapshot,
  verifyIntegrity: entitled.verifyIntegrity,
  validateTrustedRoots: entitled.validateTrustedRoots,
  evaluateResourcePolicy: entitled.evaluateResourcePolicy,
  cloneDefaultResourcePolicy: entitled.cloneDefaultResourcePolicy,
  ENTITLED_MODULE_ID: entitled.MODULE_ID,
  ENTITLED_MODULE_VERSION: entitled.MODULE_VERSION,
  ENTITLED_CAPABILITY_IDS: entitled.CAPABILITY_IDS,
  ENTITLED_NON_CLAIMS: entitled.NON_CLAIMS,
  ENTITLED_NON_CLAIM_MESSAGES: entitled.NON_CLAIM_MESSAGES,
  ENTITLED_DEFAULT_RESOURCE_POLICY: entitled.DEFAULT_RESOURCE_POLICY,
};
