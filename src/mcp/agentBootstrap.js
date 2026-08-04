'use strict';

const fs = require('fs');
const path = require('path');
const { DEFAULT_MCP_SAFE_TOOL_NAMES } = require('./mcpPolicy');
const { discoverProjectIntelligenceCapabilities } = require('../projectIntelligence/adapters');
const { buildAgentFailurePlaybook } = require('./agentFailurePlaybook');

const PACKAGE_JSON_PATH = path.resolve(__dirname, '..', '..', 'package.json');

function readPackageVersion() {
  try {
    const parsed = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
    return String(parsed.version || '').trim() || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function resolveCapabilities(context = {}) {
  if (context && context.capabilities) {
    return context.capabilities;
  }

  try {
    const api = require('../api/zeusApi');
    return api.capabilities || (api.zeus && api.zeus.capabilities) || null;
  } catch {
    return null;
  }
}

function buildProjectIntelligenceSnapshot(context = {}) {
  const discovery = discoverProjectIntelligenceCapabilities(resolveCapabilities(context));
  return {
    moduleId: discovery.moduleId,
    commercial: discovery.commercial,
    present: discovery.present,
    presentCount: discovery.presentCount,
    totalOperations: discovery.totalOperations,
    operations: Array.isArray(discovery.operations)
      ? discovery.operations.map(operation => ({
          operation: operation.operation,
          capabilityId: operation.capabilityId,
          mcpTool: operation.mcpTool,
          sideEffects: Array.isArray(operation.sideEffects) ? [...operation.sideEffects] : [],
          present: Boolean(operation.present),
          availability: operation.availability ? { ...operation.availability } : null,
        }))
      : [],
    capabilityIds: Array.isArray(discovery.capabilityIds) ? [...discovery.capabilityIds] : [],
    reasonCode: discovery.reasonCode,
    message: discovery.message,
    communityEnginesAvailable: Boolean(discovery.communityEnginesAvailable),
    nonClaims: Array.isArray(discovery.nonClaims) ? [...discovery.nonClaims] : [],
  };
}

function buildAgentBootstrapPayload(context = {}) {
  const projectIntelligenceSnapshot = buildProjectIntelligenceSnapshot(context);
  const failurePlaybook = buildAgentFailurePlaybook({ compact: true });

  return {
    ok: true,
    service: 'zeus-rpg-promptkit',
    schemaVersion: 1,
    packageVersion: readPackageVersion(),
    who: ['ai-agent', 'human-operator'],
    whatToDo: 'Use the live bootstrap payload to start without hunting markdown for tool names.',
    safetyRules: [
      'Default to read-only behavior on IBM i and DB2.',
      'Require explicit approval before any S3 or S4 action, mutation, or bridge/apply style operation.',
      'Do not invent tool or command names.',
      'Prefer tools/list or zeus.help before markdown docs when you need live tool names.',
      'Project-knowledge index/query/write ops are not on the default allowlist; discover/status only are default.',
    ],
    defaultTools: [...DEFAULT_MCP_SAFE_TOOL_NAMES],
    recommendedSequence: [
      'zeus.agent.bootstrap',
      'zeus.help',
      'zeus.workflow.suggest',
      'zeus.doctor',
      'zeus.profiles',
      'zeus.project-knowledge.discover',
      'zeus.resources',
      'zeus.discover-environment',
      'zeus.analyze',
      'zeus.workflow',
    ],
    piDiscoverySnapshot: projectIntelligenceSnapshot,
    failurePlaybook,
    communityFallbacks: [
      'If commercial Project Intelligence is absent, use analyze, search-source, field-search, impact, bundle, and other Community tools instead.',
      'If you do not know a tool name, use tools/list or zeus.help; do not guess.',
      'If a project-knowledge operation other than discover/status fails, the commercial module is absent or not allowlisted.',
      'On failure, match the situation to failurePlaybook codes and follow the recovery nextTools; do not invent results.',
    ],
    parityHints: [
      'zeus.agent.bootstrap and zeus://metadata/agent-bootstrap.json must stay in sync.',
      'tools/list is the live source of truth for allowlisted MCP tools; docs are secondary.',
      'The default allowlist CSV in docs/mcp/operator-guide.md must match DEFAULT_MCP_SAFE_TOOL_NAMES.',
      'failurePlaybook codes are stable; full entries live at zeus://metadata/agent-failure-playbook.json.',
    ],
    next: 'help',
  };
}

module.exports = {
  buildAgentBootstrapPayload,
  readPackageVersion,
};
