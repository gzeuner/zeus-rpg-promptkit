'use strict';

const fs = require('fs');
const path = require('path');
const { COMMAND_METADATA, COMMAND_ORDER } = require('../docs/toolCatalogMetadata');
const { buildCommandHelpEntry } = require('../cli/commandHelp');
const { listMcpTools, MCP_TOOL_TO_CAPABILITY } = require('./mcpTools');
const { DEFAULT_MCP_SAFE_TOOL_NAMES } = require('./mcpPolicy');
const { buildAgentBootstrapPayload } = require('./agentBootstrap');
const { buildAgentFailurePlaybook } = require('./agentFailurePlaybook');
const { listWorkflowPresets } = require('../workflow/workflowPresetRegistry');
const { listPromptContracts } = require('../prompt/promptRegistry');
const { listAnalysisRuns, readAnalysisRun, readArtifactContent } = require('../ui/localUiDataApi');

const RESOURCE_DEFINITIONS = Object.freeze([
  Object.freeze({
    uri: 'zeus://docs/tool-catalog.md',
    name: 'Tool Catalog',
    description: 'Human-oriented catalog of CLI commands, MCP tools and capabilities.',
    mimeType: 'text/markdown',
    filePath: 'docs/tool-catalog.md',
  }),
  Object.freeze({
    uri: 'zeus://docs/tool-catalog.json',
    name: 'Tool Catalog (JSON)',
    description: 'Machine-readable tool catalog projection.',
    mimeType: 'application/json',
    filePath: 'docs/tool-catalog.json',
  }),
  Object.freeze({
    uri: 'zeus://docs/cli/reference.md',
    name: 'CLI Reference',
    description: 'CLI command reference documentation.',
    mimeType: 'text/markdown',
    filePath: 'docs/cli/reference.md',
  }),
  Object.freeze({
    uri: 'zeus://docs/ai/session-prompt.md',
    name: 'AI Session Prompt',
    description: 'Default session prompt template for AI agents working with Zeus.',
    mimeType: 'text/markdown',
    filePath: 'docs/ai/session-prompt.md',
  }),
  Object.freeze({
    uri: 'zeus://docs/mcp/operator-guide.md',
    name: 'MCP Operator Guide',
    description: 'Operator guide for running and hardening the MCP server.',
    mimeType: 'text/markdown',
    filePath: 'docs/mcp/operator-guide.md',
  }),
  Object.freeze({
    uri: 'zeus://docs/quickstart/onboarding-new-ibm-i.md',
    name: 'Onboarding Guide for New IBM i Systems',
    description:
      'Step-by-step guide to connect to a fresh AS/400 / IBM i / Power system, discover sources, PGM/table objects, metadata, and data.',
    mimeType: 'text/markdown',
    filePath: 'docs/quickstart/onboarding-new-ibm-i.md',
  }),
  Object.freeze({
    uri: 'zeus://docs/ai/rpg-agent-guidance.md',
    name: 'RPG Agent Guidance',
    description:
      'Project-neutral RPG/ILE patterns, modernization notes, BIFs, indicators, and agent rules for safe code proposals.',
    mimeType: 'text/markdown',
    filePath: 'docs/ai/rpg-agent-guidance.md',
  }),
  Object.freeze({
    uri: 'zeus://docs/sql/system-environment-discovery.sql',
    name: 'IBM i Environment Discovery SQL',
    description:
      'Ready-to-use read-only queries for source libraries, tables, objects, columns, keys, and catalog exploration.',
    mimeType: 'text/plain',
    filePath: 'docs/sql/system-environment-discovery.sql',
  }),
  Object.freeze({
    uri: 'zeus://metadata/command-catalog.json',
    name: 'Command Catalog Metadata',
    description: 'Structured CLI command metadata with safety levels and examples.',
    mimeType: 'application/json',
    generator: buildCommandCatalogResource,
  }),
  Object.freeze({
    uri: 'zeus://metadata/agent-bootstrap.json',
    name: 'Agent Bootstrap',
    description: 'Structured bootstrap payload for AI agents.',
    mimeType: 'application/json',
    generator: buildAgentBootstrapPayload,
  }),
  Object.freeze({
    uri: 'zeus://metadata/agent-failure-playbook.json',
    name: 'Agent Failure Playbook',
    description:
      'Stable failure reason codes with Do / Don\'t / nextTools recovery guidance for AI agents.',
    mimeType: 'application/json',
    generator: () => buildAgentFailurePlaybook({ compact: false }),
  }),
  Object.freeze({
    uri: 'zeus://docs/ai/agent-failure-playbook.md',
    name: 'Agent Failure Playbook (Markdown)',
    description:
      'Human-readable agent failure recovery playbook covering policy refusal, missing profile, unresolved refs, and related codes.',
    mimeType: 'text/markdown',
    filePath: 'docs/ai/agent-failure-playbook.md',
  }),
  Object.freeze({
    uri: 'zeus://metadata/surface-parity.json',
    name: 'Surface Parity',
    description: 'Versioned CLI/MCP/capability surface parity projection for agents and guards.',
    mimeType: 'application/json',
    generator: buildSurfaceParityResource,
  }),
  Object.freeze({
    uri: 'zeus://metadata/mcp-tools.json',
    name: 'MCP Tool Inventory',
    description:
      'Structured inventory of currently registered MCP tools and default allowlist posture.',
    mimeType: 'application/json',
    generator: buildMcpToolsResource,
  }),
  Object.freeze({
    uri: 'zeus://metadata/workflow-presets.json',
    name: 'Workflow Presets',
    description: 'Structured workflow preset metadata for review and automation.',
    mimeType: 'application/json',
    generator: buildWorkflowPresetResource,
  }),
  Object.freeze({
    uri: 'zeus://metadata/prompt-contracts.json',
    name: 'Prompt Contracts',
    description: 'Structured prompt template contracts and budget metadata.',
    mimeType: 'application/json',
    generator: buildPromptContractsResource,
  }),
  Object.freeze({
    uri: 'zeus://onboarding/checklist.json',
    name: 'Onboarding Checklist',
    description:
      'Structured, agent-friendly checklist for first connection to a new IBM i system (sources, objects, metadata, data).',
    mimeType: 'application/json',
    generator: buildOnboardingChecklistResource,
  }),
  Object.freeze({
    uri: 'zeus://metadata/project-intelligence.json',
    name: 'Project Intelligence Capability Discovery',
    description:
      'Thin Community catalog of commercial Project Intelligence operations with present/absent status (no paid code).',
    mimeType: 'application/json',
    generator: buildProjectIntelligenceDiscoveryResource,
  }),
]);
