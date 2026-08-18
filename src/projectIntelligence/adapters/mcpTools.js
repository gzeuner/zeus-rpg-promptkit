'use strict';

const path = require('path');

const {
  PUBLIC_OPERATIONS,
  MCP_TOOL_TO_OPERATION,
  DISCOVER_MCP_TOOL,
} = require('./capabilityCatalog');
const { executeProjectIntelligenceOperation } = require('./execute');
const { discoverProjectIntelligenceCapabilities } = require('./discovery');
const { createKnowledgeFirstService } = require('../knowledgeFirst');
const { realpathSafe, isInsideRoot } = require('../content/trustedRoots');
const { KnowledgeStoreError, REASON_CODES } = require('../store/errors');

const KNOWLEDGE_FIRST_MCP_TOOLS = Object.freeze({
  check: 'zeus.project-knowledge.check',
  sync: 'zeus.project-knowledge.sync',
  lookup: 'zeus.project-knowledge.lookup',
});

const COMMUNITY_FALLBACK_TOOLS = Object.freeze([
  'zeus.help',
  'zeus.analyze',
  'zeus.search-source',
  'zeus.field-search',
  'zeus.impact',
]);

const REQUIRED_INPUTS = Object.freeze({
  status: [],
  'inspect-policy': ['knowledgeRoot', 'projectId', 'trustedRoots'],
  'create-project': ['knowledgeRoot', 'projectId', 'trustedRoots'],
  'full-index': ['knowledgeRoot', 'projectId', 'trustedRoots'],
  'incremental-update': ['knowledgeRoot', 'projectId', 'trustedRoots'],
  query: ['knowledgeRoot', 'projectId', 'trustedRoots', 'query'],
  'impact-analysis': ['knowledgeRoot', 'projectId', 'trustedRoots', 'query'],
  'build-context-package': ['knowledgeRoot', 'projectId', 'trustedRoots', 'query'],
  'inspect-snapshot': ['knowledgeRoot', 'projectId', 'trustedRoots'],
  'verify-integrity': ['knowledgeRoot', 'projectId', 'trustedRoots'],
});

const COMMON_INPUT_PROPS = Object.freeze({
  knowledgeRoot: {
    type: 'string',
    description: 'Absolute path to the project-knowledge root directory.',
  },
  projectId: {
    type: 'string',
    description: 'Stable project id.',
  },
  trustedRoots: {
    type: 'array',
    description:
      'Explicit trusted roots [{rootId, path}]. Absolute paths only; never harvested implicitly.',
    items: {
      type: 'object',
      properties: {
        rootId: { type: 'string' },
        path: { type: 'string' },
        systemAlias: { type: 'string' },
      },
      required: ['rootId', 'path'],
      additionalProperties: false,
    },
  },
  query: { type: 'string', description: 'Lexical/query string for query/impact/context ops.' },
  limit: { type: 'integer', minimum: 1, description: 'Retrieval hit limit.' },
  tokenBudget: { type: 'integer', minimum: 1, description: 'Context package token budget.' },
  snapshotId: { type: 'string', description: 'Optional snapshot id (defaults to current).' },
  expandHops: {
    type: 'integer',
    minimum: 0,
    description: 'Graph expansion hops for impact/context.',
  },
  displayName: { type: 'string', description: 'Optional display name for create-project.' },
});

function assertKnowledgeFirstMcpPaths(input = {}, context = {}) {
  const workspaceRoot = realpathSafe(path.resolve(context.cwd || process.cwd()));
  const candidates = [input.knowledgeRoot]
    .concat(
      Array.isArray(input.trustedRoots) ? input.trustedRoots.map(root => root && root.path) : []
    )
    .filter(value => typeof value === 'string' && value.trim());

  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) {
      throw new KnowledgeStoreError(
        REASON_CODES.PATH_UNSAFE,
        'Knowledge-First MCP paths must be absolute'
      );
    }
    const resolved = realpathSafe(path.resolve(candidate));
    if (!isInsideRoot(workspaceRoot, resolved)) {
      throw new KnowledgeStoreError(
        REASON_CODES.PATH_ESCAPE,
        'Knowledge-First MCP path is outside the workspace'
      );
    }
  }
}

function listProjectKnowledgeMcpTools() {
  const tools = [
    {
      name: DISCOVER_MCP_TOOL,
      description:
        'Discover integrated Project Intelligence capability presence (absent/present). Thin public adapter; no external code.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
    },
  ];

  tools.push(
    {
      name: KNOWLEDGE_FIRST_MCP_TOOLS.check,
      description:
        'Community-neutral read-only Knowledge First freshness check. The published source-backed snapshot is authoritative evidence; unknown/stale state is never served as current knowledge.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['knowledgeRoot', 'projectId'],
        properties: { ...COMMON_INPUT_PROPS },
      },
      _communityKnowledgeFirst: true,
    },
    {
      name: KNOWLEDGE_FIRST_MCP_TOOLS.sync,
      description:
        'Explicit Community-local Knowledge First sync. Writes the SQLite-backed snapshot using the initial full-build or existing incremental path; never default-allowlisted.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['knowledgeRoot', 'projectId', 'trustedRoots'],
        properties: {
          ...COMMON_INPUT_PROPS,
          mode: { type: 'string', enum: ['full', 'incremental'] },
        },
      },
      _communityKnowledgeFirst: true,
    },
    {
      name: KNOWLEDGE_FIRST_MCP_TOOLS.lookup,
      description:
        'Community-neutral read-only Knowledge First lookup. Checks freshness before retrieval and returns source locations, evidence/provenance, relationships, and explicit snapshot authority metadata.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['knowledgeRoot', 'projectId', 'query'],
        properties: { ...COMMON_INPUT_PROPS },
      },
      _communityKnowledgeFirst: true,
    }
  );

  for (const op of PUBLIC_OPERATIONS) {
    tools.push({
      name: op.mcpTool,
      description: `Project Intelligence ${op.operation} via ${op.capabilityId}; side effects: ${op.sideEffects.join(', ')}. Fails closed when the entitled integrated module is absent. Use zeus.project-knowledge.discover first.`,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: REQUIRED_INPUTS[op.operation] || [],
        properties: { ...COMMON_INPUT_PROPS },
      },
      _capabilityId: op.capabilityId,
      _projectKnowledgeOperation: op.operation,
    });
  }
  return tools;
}

function isProjectKnowledgeMcpTool(name) {
  return (
    name === DISCOVER_MCP_TOOL ||
    Object.values(KNOWLEDGE_FIRST_MCP_TOOLS).includes(name) ||
    Object.prototype.hasOwnProperty.call(MCP_TOOL_TO_OPERATION, name)
  );
}

/**
 * Execute a project-knowledge MCP tool via capability registry (injected or from context).
 */
async function executeProjectKnowledgeMcpTool(name, args = {}, context = {}) {
  const capabilities =
    (context && context.capabilities) ||
    (context && context.zeus && context.zeus.capabilities) ||
    null;

  if (name === DISCOVER_MCP_TOOL) {
    return {
      ok: true,
      tool: name,
      builtIn: true,
      commercial: true,
      discovery: discoverProjectIntelligenceCapabilities(capabilities),
    };
  }

  const knowledgeFirstOperation = Object.entries(KNOWLEDGE_FIRST_MCP_TOOLS).find(
    ([, toolName]) => toolName === name
  );
  if (knowledgeFirstOperation) {
    try {
      assertKnowledgeFirstMcpPaths(args || {}, context || {});
      const service = createKnowledgeFirstService(args || {});
      const [operation] = knowledgeFirstOperation;
      const result =
        operation === 'check'
          ? service.check()
          : operation === 'sync'
            ? service.sync({ mode: args && args.mode })
            : service.lookup({ query: args && args.query, limit: args && args.limit });
      return { tool: name, ...result };
    } catch (err) {
      return {
        tool: name,
        ok: false,
        operation: knowledgeFirstOperation[0],
        service: 'zeus.community.knowledge-first',
        reasonCode: (err && err.reasonCode) || 'ZPI.INTERNAL_ERROR',
        message: 'Knowledge-First operation failed',
      };
    }
  }

  const operation = MCP_TOOL_TO_OPERATION[name];
  if (!operation) {
    const err = new Error(`Unknown project-knowledge MCP tool: ${name}`);
    err.code = 'TOOL_NOT_FOUND';
    throw err;
  }

  const outcome = await executeProjectIntelligenceOperation({
    capabilities,
    operation,
    input: args || {},
    context: context || {},
  });

  return {
    tool: name,
    ...outcome,
    ...(!outcome.ok
      ? {
          suggestedTools: [...COMMUNITY_FALLBACK_TOOLS],
          suggestionReason:
            'Integrated Project Intelligence is unavailable; continue with neutral Community analysis tools.',
        }
      : {}),
  };
}

/** Safe default allowlist: discovery + status only (read-only surface). */
const PROJECT_KNOWLEDGE_SAFE_MCP_TOOLS = Object.freeze([
  DISCOVER_MCP_TOOL,
  'zeus.project-knowledge.status',
  KNOWLEDGE_FIRST_MCP_TOOLS.check,
  KNOWLEDGE_FIRST_MCP_TOOLS.lookup,
]);

module.exports = {
  listProjectKnowledgeMcpTools,
  isProjectKnowledgeMcpTool,
  executeProjectKnowledgeMcpTool,
  PROJECT_KNOWLEDGE_SAFE_MCP_TOOLS,
  COMMUNITY_FALLBACK_TOOLS,
  REQUIRED_INPUTS,
  KNOWLEDGE_FIRST_MCP_TOOLS,
  assertKnowledgeFirstMcpPaths,
};
