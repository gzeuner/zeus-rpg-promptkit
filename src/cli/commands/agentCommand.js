'use strict';

const { createJsonOutput } = require('../helpers/jsonOutput');
const { buildCliAgentBootstrapPayload } = require('../../agent/agentBootstrap');
const { buildCliWorkflowSuggestion } = require('../../agent/workflowSuggestion');
const { appendAgentExperience, listAgentExperience } = require('../../agent/agentExperience');

function printHelp() {
  console.log('Agent commands:');
  console.log('  zeus agent bootstrap [--json]');
  console.log(
    '  zeus agent suggest --goal "<goal>" [--profile <name>] [--program <name>] [--source <path>] [--out <path>] [--json]'
  );
  console.log(
    '  zeus agent log --outcome <success|partial|failed|blocked> --command "<safe-command>" [options] [--json]'
  );
  console.log('  zeus agent log list [--limit <n>] [--out <relative-jsonl>] [--json]');
  console.log('');
  console.log('The CLI is the canonical agent surface. MCP is optional.');
  console.log('Agent bootstrap and log commands do not execute work or contact remote systems.');
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

function printExperienceRecordHuman(payload) {
  console.log(`Experience recorded: ${payload.event.eventId}`);
  console.log(`Outcome: ${payload.event.outcome}`);
  console.log(`Failure code: ${payload.event.failureCode}`);
  console.log(`Log: ${payload.path}`);
}

function printExperienceListHuman(payload) {
  console.log(`Experience log: ${payload.path}`);
  console.log(`Events: ${payload.eventCount}`);
  for (const event of payload.events) {
    console.log(
      `- ${event.recordedAt} ${event.outcome} ${event.failureCode}: ${event.lesson || event.symptom || event.command}`
    );
  }
  if (payload.summary.recurringFailureCodes.length > 0) {
    console.log('Recurring failure codes:');
    for (const item of payload.summary.recurringFailureCodes) {
      console.log(`  ${item.failureCode}: ${item.count}`);
    }
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

  if (subcommand === 'log') {
    const action = String(positional[1] || 'record')
      .trim()
      .toLowerCase();
    const options = { cwd: process.cwd(), out: args.out || args.output || undefined };

    if (action === 'list' || action === 'show') {
      const payload = listAgentExperience({ ...options, limit: args.limit });
      if (json.isJsonMode) json.print(payload);
      else printExperienceListHuman(payload);
      return payload;
    }

    if (action !== 'record') {
      const error = new Error(`Unknown agent log action: ${action}`);
      error.code = 'TOOL_INVALID_ARGUMENTS';
      throw error;
    }

    const payload = appendAgentExperience(
      {
        event: args.event,
        outcome: args.outcome,
        command: args.command,
        failureCode: args['failure-code'] || args.failureCode,
        goal: args.goal,
        symptom: args.symptom,
        workaround: args.workaround,
        lesson: args.lesson,
        nextStep: args['next-step'] || args.nextStep,
        sessionId: args['session-id'] || args.sessionId,
        profile: args.profile,
        program: args.program || args.member,
        tag: args.tag || args.tags,
      },
      options
    );
    if (json.isJsonMode) json.print(payload);
    else printExperienceRecordHuman(payload);
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
