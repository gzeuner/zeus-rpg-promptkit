'use strict';

/**
 * Public Project Intelligence adapter vocabulary (ZPI-11).
 * Capability IDs are stable public contracts (ADR-009 / Decision 6).
 * Community owns thin adapters only; commercial modules register handlers.
 * No paid implementation lives in this file.
 */

const MODULE_ID = 'zeus-pro.project-intelligence';

/**
 * Commercial capability IDs (public identifiers only).
 * Present only when an entitled commercial module registers them.
 */
const COMMERCIAL_CAPABILITY_IDS = Object.freeze({
  STATUS: 'zeus-pro.project-intelligence.status',
  INSPECT_POLICY: 'zeus-pro.project-intelligence.inspect-policy',
  CREATE_PROJECT: 'zeus-pro.project-intelligence.create-project',
  FULL_INDEX: 'zeus-pro.project-intelligence.full-index',
  INCREMENTAL_UPDATE: 'zeus-pro.project-intelligence.incremental-update',
  QUERY: 'zeus-pro.project-intelligence.query',
  IMPACT_ANALYSIS: 'zeus-pro.project-intelligence.impact-analysis',
  BUILD_CONTEXT_PACKAGE: 'zeus-pro.project-intelligence.build-context-package',
  INSPECT_SNAPSHOT: 'zeus-pro.project-intelligence.inspect-snapshot',
  VERIFY_INTEGRITY: 'zeus-pro.project-intelligence.verify-integrity',
});

/** CLI/MCP operation keys → commercial capability ids */
const OPERATION_CAPABILITY_MAP = Object.freeze({
  status: COMMERCIAL_CAPABILITY_IDS.STATUS,
  'inspect-policy': COMMERCIAL_CAPABILITY_IDS.INSPECT_POLICY,
  create: COMMERCIAL_CAPABILITY_IDS.CREATE_PROJECT,
  'create-project': COMMERCIAL_CAPABILITY_IDS.CREATE_PROJECT,
  'full-index': COMMERCIAL_CAPABILITY_IDS.FULL_INDEX,
  index: COMMERCIAL_CAPABILITY_IDS.FULL_INDEX,
  'incremental-update': COMMERCIAL_CAPABILITY_IDS.INCREMENTAL_UPDATE,
  incremental: COMMERCIAL_CAPABILITY_IDS.INCREMENTAL_UPDATE,
  query: COMMERCIAL_CAPABILITY_IDS.QUERY,
  'impact-analysis': COMMERCIAL_CAPABILITY_IDS.IMPACT_ANALYSIS,
  impact: COMMERCIAL_CAPABILITY_IDS.IMPACT_ANALYSIS,
  'build-context-package': COMMERCIAL_CAPABILITY_IDS.BUILD_CONTEXT_PACKAGE,
  context: COMMERCIAL_CAPABILITY_IDS.BUILD_CONTEXT_PACKAGE,
  'inspect-snapshot': COMMERCIAL_CAPABILITY_IDS.INSPECT_SNAPSHOT,
  inspect: COMMERCIAL_CAPABILITY_IDS.INSPECT_SNAPSHOT,
  'verify-integrity': COMMERCIAL_CAPABILITY_IDS.VERIFY_INTEGRITY,
  verify: COMMERCIAL_CAPABILITY_IDS.VERIFY_INTEGRITY,
});

/** Canonical public operations (no aliases) for discovery catalogs */
const PUBLIC_OPERATIONS = Object.freeze([
  Object.freeze({
    operation: 'status',
    capabilityId: COMMERCIAL_CAPABILITY_IDS.STATUS,
    sideEffects: Object.freeze(['local-read']),
    mcpTool: 'zeus.project-knowledge.status',
  }),
  Object.freeze({
    operation: 'inspect-policy',
    capabilityId: COMMERCIAL_CAPABILITY_IDS.INSPECT_POLICY,
    sideEffects: Object.freeze(['local-read']),
    mcpTool: 'zeus.project-knowledge.inspect-policy',
  }),
  Object.freeze({
    operation: 'create-project',
    capabilityId: COMMERCIAL_CAPABILITY_IDS.CREATE_PROJECT,
    sideEffects: Object.freeze(['local-read', 'local-artifact-write']),
    mcpTool: 'zeus.project-knowledge.create-project',
  }),
  Object.freeze({
    operation: 'full-index',
    capabilityId: COMMERCIAL_CAPABILITY_IDS.FULL_INDEX,
    sideEffects: Object.freeze(['local-read', 'local-artifact-write']),
    mcpTool: 'zeus.project-knowledge.full-index',
  }),
  Object.freeze({
    operation: 'incremental-update',
    capabilityId: COMMERCIAL_CAPABILITY_IDS.INCREMENTAL_UPDATE,
    sideEffects: Object.freeze(['local-read', 'local-artifact-write']),
    mcpTool: 'zeus.project-knowledge.incremental-update',
  }),
  Object.freeze({
    operation: 'query',
    capabilityId: COMMERCIAL_CAPABILITY_IDS.QUERY,
    sideEffects: Object.freeze(['local-read']),
    mcpTool: 'zeus.project-knowledge.query',
  }),
  Object.freeze({
    operation: 'impact-analysis',
    capabilityId: COMMERCIAL_CAPABILITY_IDS.IMPACT_ANALYSIS,
    sideEffects: Object.freeze(['local-read']),
    mcpTool: 'zeus.project-knowledge.impact-analysis',
  }),
  Object.freeze({
    operation: 'build-context-package',
    capabilityId: COMMERCIAL_CAPABILITY_IDS.BUILD_CONTEXT_PACKAGE,
    sideEffects: Object.freeze(['local-read']),
    mcpTool: 'zeus.project-knowledge.build-context-package',
  }),
  Object.freeze({
    operation: 'inspect-snapshot',
    capabilityId: COMMERCIAL_CAPABILITY_IDS.INSPECT_SNAPSHOT,
    sideEffects: Object.freeze(['local-read']),
    mcpTool: 'zeus.project-knowledge.inspect-snapshot',
  }),
  Object.freeze({
    operation: 'verify-integrity',
    capabilityId: COMMERCIAL_CAPABILITY_IDS.VERIFY_INTEGRITY,
    sideEffects: Object.freeze(['local-read']),
    mcpTool: 'zeus.project-knowledge.verify-integrity',
  }),
]);

const MCP_TOOL_TO_OPERATION = Object.freeze(
  Object.fromEntries(PUBLIC_OPERATIONS.map(op => [op.mcpTool, op.operation]))
);

const DISCOVER_MCP_TOOL = 'zeus.project-knowledge.discover';

module.exports = {
  MODULE_ID,
  COMMERCIAL_CAPABILITY_IDS,
  OPERATION_CAPABILITY_MAP,
  PUBLIC_OPERATIONS,
  MCP_TOOL_TO_OPERATION,
  DISCOVER_MCP_TOOL,
};
