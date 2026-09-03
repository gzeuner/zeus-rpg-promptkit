'use strict';

const { createJsonOutput } = require('../helpers/jsonOutput');
const { buildCliAgentBootstrapPayload } = require('../../agent/agentBootstrap');
const { buildCliWorkflowSuggestion } = require('../../agent/workflowSuggestion');

function printHelp() {
  console.log('Agent commands:');
  console.log('  zeus agent bootstrap [--json]');
  console.log(
    '  zeus agent suggest --goal "<goal>" [--profile <name>] [--program <name>] [--source <path>] [--out <path>] [--json]'
  );
  console.log('');
  console.log('The CLI is the canonical agent surface. MCP is optional.');
  console.log('No agent command executes work unless an explicit work command is called.');
}

function printBootstrapHuman(payload) {
  console.log('Zeus CLI agent bootstrap');
  console.log(`Package: ${payload.packageVersion}`);
  console.log('Canonical surface: CLI');
  console.log('MCP: optional');
  console.log('Start here:');
  for (const command of payload.startHere) console.log(`  ${command}`);
  console.log('');
  console.log('Intent map:');
  for (const entry of payload.intentMap) {
    console.log(`  ${entry.intent}: ${entry.commands.join(', ')}`);
  }
}

function printSuggestionHuman(payload) {
  console.log(`Workflow suggestion: ${payload.plan}`);
  console.log('No command was executed.');
  for (const step of payload.steps) {
    console.log(`${step.order}. [${step.safety}] ${step.command}`);
    console.log(`   ${step.purpose}`);
  }
}

async function runAgent(args = {}) {
  const positional = Array.isArray(args._) ? args._ : [];
  const subcommand = String(positional[0] || 'bootstrap')
    .trim()
    .toLowerCase();
  const json = createJsonOutput(args);

  if (!subcommand || subcommand === 'help' || args.help === true || args.h === true) {
    printHelp();
    return { ok: true, operation: 'help' };
  }

  if (subcommand === 'bootstrap') {
    const payload = buildCliAgentBootstrapPayload();
    if (json.isJsonMode) json.print(payload);
    else printBootstrapHuman(payload);
    return payload;
  }

  if (subcommand === 'suggest') {
    const goal = String(args.goal || args.description || '').trim();
    if (!goal) {
      const error = new Error('Missing required option: --goal "<goal>"');
      error.code = 'TOOL_INVALID_ARGUMENTS';
      throw error;
    }

    const payload = buildCliWorkflowSuggestion({
      goal,
      profile: args.profile || null,
      program: args.program || args.member || null,
      source: args.source || args['source-root'] || null,
      out: args.out || args.output || null,
    });
    if (json.isJsonMode) json.print(payload);
    else printSuggestionHuman(payload);
    return payload;
  }

  const error = new Error(`Unknown agent subcommand: ${subcommand}`);
  error.code = 'TOOL_INVALID_ARGUMENTS';
  throw error;
}

module.exports = {
  printHelp,
  runAgent,
};
