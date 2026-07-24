'use strict';

const {
  PUBLIC_OPERATIONS,
  MCP_TOOL_TO_OPERATION,
  DISCOVER_MCP_TOOL,
} = require('./capabilityCatalog');
const { executeProjectIntelligenceOperation } = require('./execute');
const { discoverProjectIntelligenceCapabilities } = require('./discovery');

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

function listProjectKnowledgeMcpTools() {
  const tools = [
    {
      name: DISCOVER_MCP_TOOL,
      description:
        'Discover commercial Project Intelligence capability presence (absent/present). Thin Community adapter; no paid code.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
    },
  ];

  for (const op of PUBLIC_OPERATIONS) {
    tools.push({
      name: op.mcpTool,
      description: `Project Intelligence ${op.operation} (commercial capability ${op.capabilityId}). Fails closed when module is not registered.`,
      inputSchema: {
        type: 'object',
        additionalProperties: true,
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
    name === DISCOVER_MCP_TOOL || Object.prototype.hasOwnProperty.call(MCP_TOOL_TO_OPERATION, name)
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
      commercial: true,
      discovery: discoverProjectIntelligenceCapabilities(capabilities),
    };
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
  };
}

/** Safe default allowlist: discovery + status only (read-only surface). */
const PROJECT_KNOWLEDGE_SAFE_MCP_TOOLS = Object.freeze([
  DISCOVER_MCP_TOOL,
  'zeus.project-knowledge.status',
]);

module.exports = {
  listProjectKnowledgeMcpTools,
  isProjectKnowledgeMcpTool,
  executeProjectKnowledgeMcpTool,
  PROJECT_KNOWLEDGE_SAFE_MCP_TOOLS,
};
