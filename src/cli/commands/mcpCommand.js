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

const { createMcpServer } = require('../../mcp/mcpServer');
const { listMcpTools } = require('../../mcp/mcpTools');

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (value === true) {
    return true;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  return fallback;
}

function parseAllowlistedTools(value, knownToolNames = null) {
  if (value === undefined || value === null) {
    return null;
  }
  if (value === true) {
    throw new Error('Invalid --allow-tools value: expected comma-separated tool names.');
  }

  const parsed = String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (parsed.length === 0) {
    throw new Error('Invalid --allow-tools value: provide at least one tool name.');
  }

  const unique = Array.from(new Set(parsed));
  const known = Array.isArray(knownToolNames) ? knownToolNames : [];
  const knownSet = new Set(known);
  const unknown = unique.filter((entry) => !knownSet.has(entry));
  if (unknown.length > 0) {
    const knownList = known.join(', ');
    throw new Error(
      `Invalid --allow-tools value: unknown tool name(s): ${unknown.join(', ')}. Known tools: ${knownList}`,
    );
  }

  return unique;
}

function printMcpHelp() {
  console.log('MCP commands:');
  console.log('  zeus mcp serve [--stdio true|false] [--allow-tools <name1,name2>] [--verbose]');
  console.log('');
  console.log('Notes:');
  console.log('  - Without --allow-tools, MCP exposes the safe default surface (see DEFAULT_MCP_SAFE_TOOL_NAMES in policy: health, doctor, profiles, analyze, search, queries, review tools, etc.).');
  console.log('  - Use --allow-tools to further restrict or customize (e.g. for minimal agent exposure). Dangerous tools (write-sql, bridge) are never in defaults.');
  console.log('  - Runs local-only over stdio transport.');
  console.log('  - Local path inputs are workspace-bounded, including absolute paths.');
  console.log('  - Cursor-enabled tools return opaque versioned nextCursor tokens; legacy numeric cursor input is rejected and no longer supported.');
}

async function runMcp(args = {}, dependencies = {}) {
  try {
    const createServer = dependencies.createMcpServer || createMcpServer;
    const cwd = dependencies.cwd || process.cwd();
    const subcommand = String((Array.isArray(args._) && args._[0]) || 'serve').trim().toLowerCase();
    if (!subcommand || subcommand === 'help') {
      printMcpHelp();
      return;
    }
    if (subcommand !== 'serve') {
      throw new Error(`Unknown mcp subcommand: ${subcommand}`);
    }

    const stdio = parseBoolean(args.stdio, true);
    if (!stdio) {
      throw new Error('Only stdio transport is supported in the MCP MVP.');
    }

    const knownToolNames = listMcpTools().map((tool) => tool.name);
    const allowlistedTools = parseAllowlistedTools(args['allow-tools'], knownToolNames);
    if (Object.prototype.hasOwnProperty.call(args, 'legacy-cursor-fallback')) {
      throw new Error('The --legacy-cursor-fallback option was removed. Numeric cursors are no longer supported; use opaque cursor tokens.');
    }
    const verbose = parseBoolean(args.verbose, false);
    const server = createServer({
      cwd,
      ...(Array.isArray(allowlistedTools) ? { allowlistedTools } : {}),
    });
    server.startStdio();

    if (verbose) {
      console.error('[mcp] zeus MCP server started (stdio mode)');
      if (Array.isArray(allowlistedTools)) {
        console.error(`[mcp] allowlisted tools: ${allowlistedTools.join(', ')}`);
      }
    }
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}

module.exports = {
  parseAllowlistedTools,
  printMcpHelp,
  runMcp,
};
