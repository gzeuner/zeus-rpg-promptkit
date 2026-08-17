'use strict';

/**
 * Public thin adapters for Project Intelligence (ZPI-11).
 * CLI/MCP surface with integrated capability present/absent behavior.
 * No external implementation is loaded from these adapters.
 */

const capabilityCatalog = require('./capabilityCatalog');
const discovery = require('./discovery');
const execute = require('./execute');
const mcpTools = require('./mcpTools');

module.exports = {
  MODULE_ID: capabilityCatalog.MODULE_ID,
  COMMERCIAL_CAPABILITY_IDS: capabilityCatalog.COMMERCIAL_CAPABILITY_IDS,
  BUILT_IN_CAPABILITY_IDS: capabilityCatalog.BUILT_IN_CAPABILITY_IDS,
  OPERATION_CAPABILITY_MAP: capabilityCatalog.OPERATION_CAPABILITY_MAP,
  PUBLIC_OPERATIONS: capabilityCatalog.PUBLIC_OPERATIONS,
  MCP_TOOL_TO_OPERATION: capabilityCatalog.MCP_TOOL_TO_OPERATION,
  DISCOVER_MCP_TOOL: capabilityCatalog.DISCOVER_MCP_TOOL,
  discoverProjectIntelligenceCapabilities: discovery.discoverProjectIntelligenceCapabilities,
  executeProjectIntelligenceOperation: execute.executeProjectIntelligenceOperation,
  resolveCapabilityId: execute.resolveCapabilityId,
  normalizeOperation: execute.normalizeOperation,
  listProjectKnowledgeMcpTools: mcpTools.listProjectKnowledgeMcpTools,
  isProjectKnowledgeMcpTool: mcpTools.isProjectKnowledgeMcpTool,
  executeProjectKnowledgeMcpTool: mcpTools.executeProjectKnowledgeMcpTool,
  PROJECT_KNOWLEDGE_SAFE_MCP_TOOLS: mcpTools.PROJECT_KNOWLEDGE_SAFE_MCP_TOOLS,
};
