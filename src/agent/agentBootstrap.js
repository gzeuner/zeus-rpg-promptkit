'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildAgentFailurePlaybook } = require('../mcp/agentFailurePlaybook');

const PACKAGE_JSON_PATH = path.resolve(__dirname, '..', '..', 'package.json');

function readPackageVersion() {
  try {
    const parsed = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
    return String(parsed.version || '').trim() || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const INTENT_MAP = Object.freeze([
  Object.freeze({
    intent: 'understand a program',
    commands: Object.freeze(['analyze', 'workflow --preset onboarding']),
    firstStep: 'Analyze local source and inspect report.md plus architecture-report.md.',
  }),
  Object.freeze({
    intent: 'find change impact or dependencies',
    commands: Object.freeze(['impact', 'trace', 'xref', 'investigate']),
    firstStep: 'Ensure analyze artifacts exist before running dependent investigation commands.',
  }),
  Object.freeze({
    intent: 'investigate an error or defect',
    commands: Object.freeze([
      'investigate',
      'search-source',
      'field-search',
      'joblog',
      'spool-read',
    ]),
    firstStep:
      'Start with local evidence; use joblog or spool-read only when a verified IBM i profile is required.',
  }),
  Object.freeze({
    intent: 'plan modernization or refactoring',
    commands: Object.freeze([
      'workflow --preset modernization-review',
      'workflow --preset refactoring-review',
    ]),
    firstStep: 'Generate structure and dependency evidence before proposing code changes.',
  }),
  Object.freeze({
    intent: 'plan tests or review readiness',
    commands: Object.freeze(['generate-test', 'qa', 'generate-checklist', 'assess-risk']),
    firstStep: 'Use the existing analysis run as the evidence base.',
  }),
  Object.freeze({
    intent: 'share review-ready evidence',
    commands: Object.freeze(['bundle --safe-sharing']),
    firstStep: 'Verify artifact contents and use safe-sharing before external distribution.',
  }),
  Object.freeze({
    intent: 'learn from prior failures or workarounds',
    commands: Object.freeze(['agent log list', 'agent log']),
    firstStep:
      'Read recent records before retrying and record one sanitized event after the attempt.',
  }),
]);

const RECOMMENDED_SEQUENCE = Object.freeze([
  Object.freeze({
    command: 'node cli/zeus.js agent bootstrap --json',
    purpose: 'Load the transport-neutral CLI agent contract.',
    safety: 'S0',
  }),
  Object.freeze({
    command: 'node cli/zeus.js agent log list --json',
    purpose: 'Read prior safe lessons before repeating a failed or blocked attempt.',
    safety: 'S0',
  }),
  Object.freeze({
    command: 'node cli/zeus.js tools list --json',
    purpose: 'Discover the installed command surface and current command metadata.',
    safety: 'S0',
  }),
  Object.freeze({
    command: 'node cli/zeus.js context show --json',
    purpose: 'Make the local working scope visible before using source or metadata.',
    safety: 'S0',
  }),
  Object.freeze({
    command: 'node cli/zeus.js doctor --profile <profile> --show-resolved',
    purpose:
      'Validate runtime and remote configuration when a profile or IBM i evidence is needed.',
    safety: 'S0',
  }),
  Object.freeze({
    command:
      'node cli/zeus.js analyze --source <source-root> --program <program> --out <output-root> --optimize-context',
    purpose: 'Create the first local, source-backed evidence run.',
    safety: 'S1',
  }),
  Object.freeze({
    command: 'node cli/zeus.js impact --target <target> --program <program> --out <output-root>',
    purpose: 'Deepen evidence for a change or dependency question after analysis.',
    safety: 'S1',
  }),
  Object.freeze({
    command:
      'node cli/zeus.js bundle --program <program> --source-output-root <output-root> --include-md --include-json --safe-sharing',
    purpose: 'Package evidence for human review or external sharing.',
    safety: 'S1',
  }),
]);

function buildCliAgentBootstrapPayload() {
  return {
    ok: true,
    service: 'zeus-rpg-promptkit',
    schemaVersion: 1,
    packageVersion: readPackageVersion(),
    transport: 'cli',
    canonicalSurface: 'cli',
    mcpOptional: true,
    whatToDo:
      'Use the CLI bootstrap and command catalog to select a bounded, evidence-first workflow. Read prior experience before retries and record bounded lessons after failures. Do not hunt markdown for command names.',
    startHere: [
      'node cli/zeus.js agent bootstrap --json',
      'node cli/zeus.js agent log list --json',
      'node cli/zeus.js tools list --json',
      'node cli/zeus.js context show --json',
    ],
    discovery: {
      list: 'node cli/zeus.js tools list --json',
      describe: 'node cli/zeus.js tools describe <command> --json',
      workflowSuggestion:
        'node cli/zeus.js agent suggest --goal "<goal>" --profile <profile> --program <program> --json',
    },
    safetyRules: [
      'Default to local read-only inspection and local artifact generation.',
      'Treat IBM i and DB2 access as remote-read and require a verified profile/runtime.',
      'Require explicit user approval before every S3 or S4 action, mutation, or apply-style operation.',
      'Do not invent commands, profiles, systems, libraries, tables, callers, or resolved references.',
      'Keep credentials, environment dumps, and credential-bearing URLs out of prompts and artifacts.',
      'State the exact command, scope, safety level, and expected artifact before non-trivial execution.',
    ],
    scopeRouting: [
      {
        case: 'Existing analysis output is available',
        action: 'Inspect the run manifest and reports before starting another analyze run.',
      },
      {
        case: 'Local source is available',
        action:
          'Run analyze or an appropriate workflow preset; a live IBM i connection is not required.',
      },
      {
        case: 'Existing IBM i spool output is needed',
        action:
          'Run doctor first, then use the bounded read-only spool-read command with the exact job and spool identity.',
      },
      {
        case: 'Source must be refreshed from IBM i',
        action: 'Run doctor first and request explicit approval before fetch or fetch-member.',
      },
      {
        case: 'The IBM i system is new or unknown',
        action: 'Use onboarding or discover-environment; never guess libraries or schemas.',
      },
    ],
    recommendedSequence: RECOMMENDED_SEQUENCE,
    intentMap: INTENT_MAP,
    artifacts: {
      primary: ['report.md', 'architecture-report.md', 'analyze-run-manifest.json'],
      deeperEvidence: [
        'canonical-analysis.json',
        'ai-knowledge.json',
        'dependency-graph.mmd',
        'program-call-tree.md',
      ],
      promptFiles: 'ai_prompt_*.md',
      sharing: 'bundle-manifest.json and safe-sharing/',
      rule: 'Every finding must cite an artifact path and evidence id or source location when available.',
    },
    experienceLog: {
      purpose:
        'Keep a local append-only record of failed, blocked, partial, and corrected attempts so future agents can avoid repeating known mistakes.',
      storage: '.zeus/agent-experience.jsonl',
      record:
        'node cli/zeus.js agent log --outcome failed --command "<safe-command>" --failure-code <CODE> --symptom "<what happened>" --workaround "<what helped>" --lesson "<reusable lesson>" --next-step "<next safe command>" --json',
      list: 'node cli/zeus.js agent log list --json',
      recordWhen: ['failed', 'blocked', 'partial', 'successful workaround or confirmed correction'],
      required: ['outcome', 'command'],
      privacy: [
        'Only sanitized structured fields are written; raw stdout, stderr, environment dumps, and credentials are not accepted as log payloads.',
        'The default log is local and ignored by Git under .zeus/. Use a reviewable artifact only when its contents are explicitly safe to share.',
      ],
      loop: [
        'Read recent records before retrying a failed command.',
        'Record one concise event after a failure, block, or workaround.',
        'Use recurring failure codes and lessons to improve prompts, docs, or command contracts.',
      ],
    },
    failurePlaybook: buildAgentFailurePlaybook({ compact: true }),
    fallback:
      'If a command is unavailable, use tools list/describe and choose a documented lower-risk alternative.',
    docs: {
      catalog: 'docs/tool-catalog.md',
      cliAgentGuide: 'docs/ai/cli-agent-guide.md',
      sessionPrompt: 'docs/ai/session-prompt.md',
      failurePlaybook: 'docs/ai/agent-failure-playbook.md',
      spoolRead: 'docs/cli/spool-read.md',
    },
    next: 'tools list',
  };
}

module.exports = {
  INTENT_MAP,
  RECOMMENDED_SEQUENCE,
  buildCliAgentBootstrapPayload,
  readPackageVersion,
};
