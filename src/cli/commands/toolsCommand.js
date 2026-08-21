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

const { renderAsciiTable } = require('../helpers/asciiTable');
const { createJsonOutput } = require('../helpers/jsonOutput');
const {
  buildToolsDescribePayload,
  buildToolsListPayload,
  listCommandHelpEntries,
} = require('../commandHelp');
const { buildAiOrientation, renderAiOrientationMarkdown } = require('../../docs/aiOrientation');

function printHelp() {
  console.log('Tools commands:');
  console.log('  zeus tools list [--json]                 # list stable command-help records');
  console.log('  zeus tools describe <name> [--json]      # describe one command');
  console.log('  zeus tools guide [--json]                # AI-first orientation and decision map');
  console.log('');
  console.log('Notes:');
  console.log('  - CLI help records are shared with MCP zeus.help.');
  console.log('  - Use --json for machine-readable output.');
  console.log('  - Command names are canonical CLI names; aliases are shown in each record.');
}

function renderListTable(commands) {
  const rows = commands.map(entry => [
    entry.cliName,
    entry.safety || '',
    entry.scope || '',
    entry.mcpName || '',
    entry.subcommands.length > 0 ? entry.subcommands.join(', ') : '',
    entry.recommendedNextCommands.length > 0 ? entry.recommendedNextCommands.join(', ') : '',
  ]);
  return renderAsciiTable(['CLI', 'Safety', 'Scope', 'MCP', 'Subcommands', 'Next'], rows);
}

function printDescribeHuman(help) {
  console.log(`Command: ${help.command}`);
  console.log(`CLI names: ${help.cliNames.join(', ')}`);
  console.log(`MCP names: ${help.mcpNames.length > 0 ? help.mcpNames.join(', ') : '(none)'}`);
  console.log(`Safety: ${help.safety || '(unknown)'}`);
  console.log(`Scope: ${help.scope || '(unknown)'}`);
  console.log(`Purpose: ${help.purpose || '(none)'}`);
  console.log(`Example: ${help.example || '(none)'}`);
  console.log(
    `Subcommands/actions: ${help.subcommands.length > 0 ? help.subcommands.join(', ') : '(none)'}`
  );
  console.log(
    `Recommended next: ${
      help.recommendedNextCommands.length > 0 ? help.recommendedNextCommands.join(', ') : '(none)'
    }`
  );
}

async function runTools(args = {}) {
  const positional = Array.isArray(args._) ? args._ : [];
  const subcommand = String(positional[0] || 'help')
    .trim()
    .toLowerCase();
  const json = createJsonOutput(args);

  if (!subcommand || subcommand === 'help' || args.help === true || args.h === true) {
    printHelp();
    return { ok: true, operation: 'help' };
  }

  if (subcommand === 'list') {
    const payload = buildToolsListPayload();
    if (json.isJsonMode) {
      json.print(payload);
    } else {
      console.log(renderListTable(payload.commands));
    }
    return payload;
  }

  if (subcommand === 'describe') {
    const commandName = String(positional[1] || '').trim();
    if (!commandName) {
      const error = new Error('Missing required command name for tools describe.');
      error.code = 'TOOL_INVALID_ARGUMENTS';
      throw error;
    }
    const payload = buildToolsDescribePayload(commandName);
    if (json.isJsonMode) {
      json.print(payload);
    } else {
      printDescribeHuman(payload.help);
    }
    return payload;
  }

  if (subcommand === 'guide') {
    const payload = buildAiOrientation();
    if (json.isJsonMode) {
      json.print(payload);
    } else {
      console.log(renderAiOrientationMarkdown(payload));
    }
    return payload;
  }

  const error = new Error(`Unknown tools subcommand: ${subcommand}`);
  error.code = 'TOOL_INVALID_ARGUMENTS';
  throw error;
}

module.exports = {
  printHelp,
  runTools,
};
