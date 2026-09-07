'use strict';

const { createJsonOutput } = require('../helpers/jsonOutput');
const { buildCliAgentBootstrapPayload } = require('../../agent/agentBootstrap');
const { buildCliAgentPreflightPayload } = require('../../agent/agentPreflight');
const { buildCliAgentPromptPayload } = require('../../agent/agentPrompt');
const { withAgentResponseContract } = require('../../agent/agentResponseContract');
const { buildCliWorkflowSuggestion } = require('../../agent/workflowSuggestion');
const {
  AGENT_EVALUATION_SCHEMA_VERSION,
  evaluateAgentResponse,
  listAgentEvaluationScenarios,
  readAgentResponseFile,
} = require('../../agent/agentEvaluation');
const {
  appendAgentExperience,
  listAgentExperience,
  suggestAgentExperience,
  summarizeAgentExperience,
} = require('../../agent/agentExperience');
const {
  buildAgentFeedback,
  resolveFeedbackArtifactPath,
  writeAgentFeedbackArtifact,
} = require('../../agent/agentFeedback');

function printHelp() {
  console.log('Agent commands:');
  console.log('  zeus agent bootstrap [--json]');
  console.log(
    '  zeus agent preflight [--goal "<goal>"] [--profile <name>] [--program <name>] [--source <path>] [--out <path>] [--json]'
  );
  console.log(
    '  zeus agent prompt --goal "<goal>" [--profile <name>] [--environment <name>] [--program <name>] [--source <path>] [--out <path>] [--json]'
  );
  console.log(
    '  zeus agent suggest --goal "<goal>" [--profile <name>] [--program <name>] [--source <path>] [--out <path>] [--json]'
  );
  console.log(
    '  zeus agent log --outcome <success|partial|failed|blocked> --command "<safe-command>" [options] [--json]'
  );
  console.log('  zeus agent log list [--limit <n>] [--out <relative-jsonl>] [--json]');
  console.log('  zeus agent log summary [--out <relative-jsonl>] [--json]');
  console.log('  zeus agent log suggest --goal "<goal>" [--limit <n>] [--json]');
  console.log('  zeus agent evaluate --list [--json]');
  console.log('  zeus agent evaluate --scenario <id> --response-file <relative-path> [--json]');
  console.log(
    '  zeus agent feedback [--scenario <id> --response-file <relative-path>] [--out <.zeus/file.json>] [--json]'
  );
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

function printPreflightHuman(payload) {
  console.log('Zeus CLI agent preflight');
  console.log(`Package: ${payload.packageVersion}`);
  console.log(`Workspace: ${payload.workspace.root}`);
  console.log(`Profile: ${payload.effectiveProfile || '(not set)'}`);
  console.log(`Context: ${payload.checks.workingContext.status}`);
  console.log(`Profiles: ${payload.profileInventory.status} (${payload.profileInventory.count})`);
  console.log(`Experience: ${payload.experience.exists ? payload.experience.eventCount : 'empty'}`);
  console.log(`Safety: ${payload.safety.level}; read-only=${payload.readOnly}`);
  console.log('Next commands:');
  for (const command of payload.nextCommands) console.log(`  ${command}`);
  if (payload.suggestion) {
    console.log(`Suggested route: ${payload.suggestion.plan}`);
    for (const step of payload.suggestion.steps) {
      console.log(`  ${step.order}. [${step.safety}] ${step.command}`);
    }
  }
}

function printPromptHuman(payload) {
  console.log('Zeus AI session prompt (copy/paste)');
  console.log('Warnings:');
  for (const warning of payload.warnings) console.log(`  - ${warning}`);
  console.log('');
  console.log(payload.prompt);
}

function highestSafetyLevel(steps = []) {
  const levels = ['S0', 'S1', 'S2', 'S3', 'S4'];
  return steps.reduce((highest, step) => {
    const level = String(step?.safety || 'S0').toUpperCase();
    return levels.indexOf(level) > levels.indexOf(highest) ? level : highest;
  }, 'S0');
}

function finishAgentPayload(payload, options = {}) {
  return withAgentResponseContract(payload, options);
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

function printExperienceSummaryHuman(payload) {
  console.log(`Experience summary: ${payload.path}`);
  console.log(`Events: ${payload.eventCount}`);
  console.log(`Outcomes: ${JSON.stringify(payload.summary.byOutcome)}`);
  for (const item of payload.intelligence.recurringFailures) {
    console.log(`- recurring ${item.failureCode}: ${item.count}`);
  }
  for (const lesson of payload.intelligence.reusableLessons) {
    console.log(`- lesson [${lesson.failureCode}] ${lesson.lesson}`);
  }
}

function printExperienceSuggestionsHuman(payload) {
  console.log(`Experience suggestions for: ${payload.goal}`);
  if (payload.suggestions.length === 0) {
    console.log('No matching sanitized lessons found.');
    return;
  }
  for (const suggestion of payload.suggestions) {
    console.log(`- [${suggestion.failureCode}] ${suggestion.lesson || suggestion.workaround}`);
    if (suggestion.workaround) console.log(`  Workaround: ${suggestion.workaround}`);
    if (suggestion.nextSafeStep) console.log(`  Next safe step: ${suggestion.nextSafeStep}`);
  }
}

function printEvaluationHuman(payload) {
  if (payload.operation === 'evaluate-list') {
    console.log('Agent evaluation scenarios:');
    for (const scenario of payload.scenarios) {
      console.log(
        `- ${scenario.id}: ${scenario.goal} (minimum ${scenario.minimumScore}, ${scenario.requiredSafety})`
      );
    }
    return;
  }
  console.log(`Agent response evaluation: ${payload.scenario.id}`);
  console.log(
    `Score: ${payload.score}/${payload.threshold} threshold (${payload.passed ? 'PASS' : 'NEEDS WORK'})`
  );
  for (const [dimension, score] of Object.entries(payload.dimensions)) {
    console.log(`- ${dimension}: ${score}/20`);
  }
  for (const finding of payload.findings) console.log(`Finding: ${finding}`);
}

function printFeedbackHuman(payload) {
  console.log('Agent feedback-to-contract report');
  console.log(`Experience events: ${payload.experience.eventCount}`);
  console.log(`Review required: ${payload.review.required ? 'yes' : 'no'}`);
  for (const change of payload.candidateChanges) {
    console.log(
      `- candidate [${change.failureCode}] ${change.proposedChange} (regression: ${change.regressionScenario || 'new scenario'})`
    );
  }
  for (const finding of payload.evaluationFindings) {
    console.log(
      `- evaluation [${finding.scenario}/${finding.dimension}] ${finding.proposedChange}`
    );
  }
  if (payload.feedbackArtifact) console.log(`Artifact: ${payload.feedbackArtifact}`);
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
    const rawPayload = buildCliAgentBootstrapPayload();
    const payload = finishAgentPayload(rawPayload, {
      nextCommands: rawPayload.startHere,
      evidenceSources: ['agent contract', 'command metadata', 'failure playbook'],
      artifacts: [
        'docs/tool-catalog.md',
        'docs/ai/cli-agent-guide.md',
        'docs/ai/agent-failure-playbook.md',
      ],
    });
    if (json.isJsonMode) json.print(payload);
    else printBootstrapHuman(payload);
    return payload;
  }

  if (subcommand === 'preflight') {
    const options = {
      cwd: process.cwd(),
      goal: args.goal || args.description || null,
      profile: args.profile || null,
      program: args.program || args.member || null,
      source: args.source || args['source-root'] || null,
      out: args.out || args.output || null,
      experienceLimit: args.limit,
    };
    const rawPayload = buildCliAgentPreflightPayload(options);
    const payload = finishAgentPayload(rawPayload, {
      context: rawPayload.context,
      profile: rawPayload.effectiveProfile,
      program: options.program,
      source: options.source,
      out: options.out,
      evidenceSources: ['working context', 'profile inventory', 'agent experience'],
      artifacts: [
        rawPayload.checks.workingContext.status === 'configured'
          ? '.zeus/working-context.json'
          : null,
        rawPayload.experience.exists ? rawPayload.experience.path : null,
      ],
    });
    if (json.isJsonMode) json.print(payload);
    else printPreflightHuman(payload);
    return payload;
  }

  if (subcommand === 'prompt') {
    const options = {
      cwd: process.cwd(),
      goal: args.goal || args.description || '',
      profile: args.profile || null,
      environment: args.environment || '',
      program: args.program || args.member || null,
      source: args.source || args['source-root'] || null,
      out: args.out || args.output || null,
    };
    const rawPayload = buildCliAgentPromptPayload(options);
    const payload = finishAgentPayload(rawPayload, {
      context: rawPayload.preflight.context,
      profile: rawPayload.metadata.effectiveProfile,
      program: options.program,
      source: options.source,
      out: options.out,
      evidenceSources: ['session prompt template', 'preflight metadata', 'agent experience'],
      artifacts: ['docs/ai/session-prompt.md'],
    });
    if (json.isJsonMode) json.print(payload);
    else printPromptHuman(payload);
    return payload;
  }

  if (subcommand === 'suggest') {
    const goal = String(args.goal || args.description || '').trim();
    if (!goal) {
      const error = new Error('Missing required option: --goal "<goal>"');
      error.code = 'TOOL_INVALID_ARGUMENTS';
      throw error;
    }

    const rawPayload = buildCliWorkflowSuggestion({
      goal,
      profile: args.profile || null,
      program: args.program || args.member || null,
      source: args.source || args['source-root'] || null,
      out: args.out || args.output || null,
    });
    const payload = finishAgentPayload(rawPayload, {
      safetyLevel: highestSafetyLevel(rawPayload.steps),
      approvalRequired: rawPayload.steps.some(step => ['S3', 'S4'].includes(step.safety)),
      sideEffects: ['planning-only'],
      profile: args.profile || null,
      program: args.program || args.member || null,
      source: args.source || args['source-root'] || null,
      out: args.out || args.output || null,
      evidenceSources: ['workflow suggestion metadata'],
    });
    if (json.isJsonMode) json.print(payload);
    else printSuggestionHuman(payload);
    return payload;
  }

  if (subcommand === 'evaluate') {
    const action = String(positional[1] || '')
      .trim()
      .toLowerCase();
    if (args.list === true || action === 'list') {
      const rawPayload = {
        ok: true,
        operation: 'evaluate-list',
        service: 'zeus-rpg-promptkit',
        schemaVersion: AGENT_EVALUATION_SCHEMA_VERSION,
        transport: 'cli',
        canonicalSurface: 'cli',
        mcpOptional: true,
        readOnly: true,
        executionStarted: false,
        scenarios: listAgentEvaluationScenarios(),
      };
      const payload = finishAgentPayload(rawPayload, {
        evidenceSources: ['agent evaluation corpus'],
        artifacts: ['docs/ai/agent-evaluation-corpus.json'],
        nextCommands: [
          'node cli/zeus.js agent evaluate --scenario <id> --response-file <relative-path> --json',
        ],
      });
      if (json.isJsonMode) json.print(payload);
      else printEvaluationHuman(payload);
      return payload;
    }

    const scenarioId = String(args.scenario || args.id || '').trim();
    if (!scenarioId) {
      const error = new Error('Missing required option: --scenario <id> (or use --list)');
      error.code = 'TOOL_INVALID_ARGUMENTS';
      throw error;
    }
    const response = readAgentResponseFile({
      cwd: process.cwd(),
      responseFile: args['response-file'] || args.response,
    });
    const result = evaluateAgentResponse({ scenarioId, responseText: response.text });
    const rawPayload = {
      ...result,
      responseFile: response.displayPath,
      responseSizeBytes: response.sizeBytes,
      warnings: result.passed
        ? []
        : [
            'The response did not meet the scenario threshold; improve it before relying on the route.',
          ],
    };
    const payload = finishAgentPayload(rawPayload, {
      status: result.passed ? 'ready' : 'needs-attention',
      evidenceSources: ['agent evaluation corpus', response.displayPath],
      artifacts: ['docs/ai/agent-evaluation-corpus.json', response.displayPath],
      nextCommands: [
        result.passed
          ? 'node cli/zeus.js agent log --outcome success --command "agent evaluate" --json'
          : 'node cli/zeus.js agent evaluate --scenario <id> --response-file <relative-path> --json',
      ],
    });
    if (json.isJsonMode) json.print(payload);
    else printEvaluationHuman(payload);
    return payload;
  }

  if (subcommand === 'feedback') {
    const scenarioId = String(args.scenario || args.id || '').trim();
    const responseFile = String(args['response-file'] || args.response || '').trim();
    if (Boolean(scenarioId) !== Boolean(responseFile)) {
      const error = new Error(
        'scenario and response-file must be supplied together for evaluation feedback.'
      );
      error.code = 'TOOL_INVALID_ARGUMENTS';
      throw error;
    }
    let response = null;
    if (scenarioId && responseFile) {
      response = readAgentResponseFile({ cwd: process.cwd(), responseFile });
    }
    const outputPath = args.out
      ? resolveFeedbackArtifactPath({ cwd: process.cwd(), out: args.out }).relativePath
      : null;
    const rawPayload = {
      ...buildAgentFeedback({
        cwd: process.cwd(),
        goal: args.goal || args.description || null,
        scenarioId: scenarioId || null,
        responseText: response ? response.text : null,
        experienceLog: args['experience-log'] || undefined,
        limit: args.limit,
      }),
      readOnly: !outputPath,
    };
    const payload = finishAgentPayload(rawPayload, {
      status: rawPayload.review.required ? 'needs-attention' : 'ready',
      sideEffects: outputPath ? ['local-read', 'local-artifact-write'] : ['local-read'],
      evidenceSources: [
        'local experience log',
        'agent evaluation corpus',
        response ? response.displayPath : null,
      ],
      artifacts: [
        rawPayload.source.evaluationCorpus,
        rawPayload.source.experienceExists ? rawPayload.source.experienceLog : null,
        response ? response.displayPath : null,
        outputPath,
      ],
      nextCommands: [
        rawPayload.review.required
          ? 'Review candidate changes and add a sanitized regression fixture.'
          : 'node cli/zeus.js agent log --outcome success --command "agent feedback" --json',
      ],
    });
    if (outputPath) {
      payload.feedbackArtifact = outputPath;
      writeAgentFeedbackArtifact(payload, {
        cwd: process.cwd(),
        out: outputPath,
      });
    }
    if (json.isJsonMode) json.print(payload);
    else printFeedbackHuman(payload);
    return payload;
  }

  if (subcommand === 'log') {
    const action = String(positional[1] || 'record')
      .trim()
      .toLowerCase();
    const options = { cwd: process.cwd(), out: args.out || args.output || undefined };

    if (action === 'summary') {
      const rawPayload = summarizeAgentExperience({ ...options, limit: args.limit });
      const payload = finishAgentPayload(rawPayload, {
        evidenceSources: ['local experience log'],
        artifacts: rawPayload.exists ? [rawPayload.path] : [],
        nextCommands: ['node cli/zeus.js agent log suggest --goal "<goal>" --json'],
      });
      if (json.isJsonMode) json.print(payload);
      else printExperienceSummaryHuman(payload);
      return payload;
    }

    if (action === 'suggest') {
      const goal = String(args.goal || args.description || '').trim();
      if (!goal) {
        const error = new Error('Missing required option: --goal "<goal>"');
        error.code = 'TOOL_INVALID_ARGUMENTS';
        throw error;
      }
      const rawPayload = suggestAgentExperience({ ...options, goal, limit: args.limit });
      const payload = finishAgentPayload(rawPayload, {
        profile: args.profile || null,
        program: args.program || args.member || null,
        evidenceSources: ['local experience log'],
        artifacts: rawPayload.exists ? [rawPayload.path] : [],
        nextCommands: ['node cli/zeus.js agent log summary --json'],
      });
      if (json.isJsonMode) json.print(payload);
      else printExperienceSuggestionsHuman(payload);
      return payload;
    }

    if (action === 'list' || action === 'show') {
      const rawPayload = listAgentExperience({ ...options, limit: args.limit });
      const payload = finishAgentPayload(rawPayload, {
        evidenceSources: ['local experience log'],
        artifacts: rawPayload.exists ? [rawPayload.path] : [],
        nextCommands: [
          'node cli/zeus.js agent log --outcome <outcome> --command "<safe-command>" --json',
        ],
      });
      if (json.isJsonMode) json.print(payload);
      else printExperienceListHuman(payload);
      return payload;
    }

    if (action !== 'record') {
      const error = new Error(`Unknown agent log action: ${action}`);
      error.code = 'TOOL_INVALID_ARGUMENTS';
      throw error;
    }

    const rawPayload = appendAgentExperience(
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
    const payload = finishAgentPayload(rawPayload, {
      profile: rawPayload.event.profile,
      program: rawPayload.event.program,
      evidenceSources: ['local experience log'],
      artifacts: [rawPayload.path],
      nextCommands: ['node cli/zeus.js agent log list --json'],
    });
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
