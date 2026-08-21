/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
'use strict';

const {
  COMMAND_CATALOG_CONTRACTS,
  COMMAND_METADATA,
  COMMAND_ORDER,
} = require('../docs/toolCatalogMetadata');
const { getCommandUiMetadata } = require('./commandMetadata');
const {
  DISCOVER_MCP_TOOL,
  PUBLIC_OPERATIONS,
  KNOWLEDGE_FIRST_MCP_TOOLS,
} = require('../projectIntelligence/adapters');

const SERVICE_NAME = 'zeus-rpg-promptkit';
const SCHEMA_VERSION = 1;

const FAMILY_MCP_NAMES = Object.freeze({
  context: Object.freeze(['zeus.context.get', 'zeus.context.set']),
  investigate: Object.freeze([
    'zeus.investigation.start',
    'zeus.investigation.focus',
    'zeus.investigation.search',
    'zeus.investigation.generate-prompt',
  ]),
  'project-knowledge': Object.freeze([
    DISCOVER_MCP_TOOL,
    ...Object.values(KNOWLEDGE_FIRST_MCP_TOOLS),
    ...PUBLIC_OPERATIONS.map(operation => operation.mcpTool),
  ]),
});

const FAMILY_RECOMMENDED_NEXT = Object.freeze({
  'project-knowledge': Object.freeze([
    'project-knowledge check',
    'project-knowledge lookup',
    'project-knowledge locate',
    'project-knowledge sync',
    'project-knowledge discover',
    'project-knowledge status',
  ]),
});

function normalizeCommandName(name) {
  const normalized = String(name || '')
    .trim()
    .toLowerCase();
  if (!normalized) return '';

  for (const [canonicalName, contract] of Object.entries(COMMAND_CATALOG_CONTRACTS)) {
    if (canonicalName === normalized) {
      return canonicalName;
    }
    if (Array.isArray(contract.aliases) && contract.aliases.includes(normalized)) {
      return canonicalName;
    }
  }

  return normalized;
}

function getMcpNamesForCommand(commandName, contract) {
  if (FAMILY_MCP_NAMES[commandName]) {
    return [...FAMILY_MCP_NAMES[commandName]];
  }

  if (!contract || !contract.availability || contract.availability.mcp !== true) {
    return [];
  }

  if (commandName.includes(' ')) {
    return [];
  }

  const directName = `zeus.${commandName.replace(/:/g, '-')}`;
  return [directName];
}

function getRecommendedNextCommands(commandName, uiMeta) {
  if (uiMeta && Array.isArray(uiMeta.recommendedNextCommands)) {
    return [...uiMeta.recommendedNextCommands];
  }
  if (FAMILY_RECOMMENDED_NEXT[commandName]) {
    return [...FAMILY_RECOMMENDED_NEXT[commandName]];
  }
  return [];
}

function buildCommandHelpEntry(commandName) {
  const normalizedName = normalizeCommandName(commandName);
  const contract = COMMAND_CATALOG_CONTRACTS[normalizedName] || null;
  if (!contract) {
    return null;
  }

  const catalogMeta = COMMAND_METADATA[normalizedName] || null;
  const uiMeta = getCommandUiMetadata(normalizedName);
  const mcpNames = getMcpNamesForCommand(normalizedName, contract);
  const cliNames = [normalizedName, ...(Array.isArray(contract.aliases) ? contract.aliases : [])];
  const example = catalogMeta && catalogMeta.example ? String(catalogMeta.example) : '';
  const examples = example ? [example] : [];
  const recommendedNextCommands = getRecommendedNextCommands(normalizedName, uiMeta);
  const subcommands =
    catalogMeta && Array.isArray(catalogMeta.subcommands)
      ? [...new Set(catalogMeta.subcommands.map(value => String(value).trim()).filter(Boolean))]
      : [];

  return Object.freeze({
    command: normalizedName,
    cliName: normalizedName,
    cliNames: Object.freeze([...new Set(cliNames)]),
    mcpName: mcpNames.length > 0 ? mcpNames[0] : null,
    mcpNames: Object.freeze(mcpNames),
    safety: catalogMeta && catalogMeta.safety ? String(catalogMeta.safety) : null,
    scope: catalogMeta && catalogMeta.scope ? String(catalogMeta.scope) : null,
    status: contract.status || null,
    sideEffects: Object.freeze(
      Array.isArray(contract.sideEffects) ? [...contract.sideEffects] : []
    ),
    purpose:
      (catalogMeta && catalogMeta.purpose ? String(catalogMeta.purpose) : '') ||
      (uiMeta && uiMeta.summary ? String(uiMeta.summary) : null),
    summary:
      (uiMeta && uiMeta.summary ? String(uiMeta.summary) : '') ||
      (catalogMeta && catalogMeta.purpose ? String(catalogMeta.purpose) : null),
    example: example || null,
    examples: Object.freeze(examples),
    subcommands: Object.freeze(subcommands),
    recommendedNextCommands: Object.freeze(recommendedNextCommands),
  });
}

function listCommandHelpEntries() {
  return COMMAND_ORDER.map(name => buildCommandHelpEntry(name)).filter(Boolean);
}

function buildToolsListPayload() {
  const commands = listCommandHelpEntries();
  return {
    ok: true,
    service: SERVICE_NAME,
    schemaVersion: SCHEMA_VERSION,
    mode: 'list',
    commands,
    totalCommands: commands.length,
    defaultCommand: 'tools describe <name>',
  };
}

function buildToolsDescribePayload(commandName) {
  const help = buildCommandHelpEntry(commandName);
  if (!help) {
    const error = new Error(
      `Unknown tools command "${String(commandName || '').trim()}". Use tools list to see available commands.`
    );
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  return {
    ok: true,
    service: SERVICE_NAME,
    schemaVersion: SCHEMA_VERSION,
    mode: 'describe',
    command: help.command,
    help,
  };
}

module.exports = {
  SCHEMA_VERSION,
  SERVICE_NAME,
  buildCommandHelpEntry,
  buildToolsDescribePayload,
  buildToolsListPayload,
  listCommandHelpEntries,
  normalizeCommandName,
};
