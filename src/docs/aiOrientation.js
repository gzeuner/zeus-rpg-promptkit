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

const { listCommandHelpEntries } = require('../cli/commandHelp');

const ORIENTATION_SCHEMA_VERSION = 1;

const WORKING_CONTEXT_FIELDS = Object.freeze([
  'active',
  'system',
  'sourceLibrary',
  'sourceFile',
  'member',
  'sourceRoot',
  'metadataSystem',
  'metadataSchema',
  'dataSystem',
  'dataSchema',
]);

const AI_INTENTS = Object.freeze([
  Object.freeze({
    intent: 'orient',
    question: 'How do I understand the current Zeus session and available capabilities?',
    cli: ['tools guide --json', 'context show --json', 'doctor --profile <name> --show-resolved'],
    mcp: ['zeus.agent.bootstrap', 'tools/list', 'zeus.help', 'zeus.context.get'],
  }),
  Object.freeze({
    intent: 'locate',
    question: 'Where is the source, metadata, object, or data I need?',
    cli: [
      'context show --json',
      'project-knowledge check --knowledge-root <path> --project-id <id> --json',
      'project-knowledge locate --knowledge-root <path> --project-id <id> --json',
      'search-source --source-root <path> --search-term <term>',
      'discover-environment --profile <name> --json',
    ],
    mcp: [
      'zeus.context.get',
      'zeus.project-knowledge.check',
      'zeus.project-knowledge.locate',
      'zeus.project-knowledge.lookup',
      'zeus.discover-environment',
    ],
  }),
  Object.freeze({
    intent: 'refresh',
    question: 'Could the local source or knowledge snapshot be stale?',
    cli: [
      'project-knowledge check --knowledge-root <path> --project-id <id> --json',
      'fetch-member --profile <name> --lib <library> --member <member>',
      'fetch --profile <name> --system <system>',
      'project-knowledge sync --knowledge-root <path> --project-id <id> --trusted-roots <json> --json',
    ],
    mcp: [
      'zeus.project-knowledge.check',
      'zeus.fetch-member',
      'zeus.fetch',
      'zeus.project-knowledge.sync',
    ],
  }),
  Object.freeze({
    intent: 'understand',
    question: 'How does this legacy application work?',
    cli: [
      'analyze --source <path> --program <name> --out <path> --reproducible',
      'workflow --preset <name> --source <path> --program <name>',
      'investigate --program <name> --goal "<question>"',
      'search-source --source-root <path> --search-term <term>',
      'field-search --profile <name> --field <name> --mode all',
    ],
    mcp: [
      'zeus.analyze',
      'zeus.workflow',
      'zeus.investigation.start',
      'zeus.investigation.search',
      'zeus.field-search',
    ],
  }),
  Object.freeze({
    intent: 'validate',
    question: 'What is affected, risky, or still uncertain?',
    cli: [
      'impact --target <name> --program <name> --source <path>',
      'assess-risk --program <name>',
      'generate-test --program <name>',
      'generate-checklist --program <name>',
      'qa --input <analysis-output> --format markdown',
      'bundle --program <name> --source-output-root <path> --safe-sharing',
    ],
    mcp: [
      'zeus.impact',
      'zeus.assess-risk',
      'zeus.generate-test',
      'zeus.generate-checklist',
      'zeus.qa',
      'zeus.bundle',
    ],
  }),
  Object.freeze({
    intent: 'remote-read',
    question: 'Which IBM i / DB2 evidence can I read safely?',
    cli: [
      'resolve-object --profile <name> --table <name> --json',
      'inspect-object --profile <name> --lib <library> --name <object> --type <type>',
      'query-table --profile <name> --table <name> --schema <schema> --json',
      'query-sql --profile <name> --sql "SELECT ..." --json',
      'joblog --profile <name> --json',
    ],
    mcp: [
      'zeus.resolve-object',
      'zeus.inspect-object',
      'zeus.query-table',
      'zeus.query-sql',
      'zeus.joblog',
    ],
  }),
  Object.freeze({
    intent: 'change',
    question: 'How do I prepare or execute a change?',
    cli: [
      'generate-checklist --program <name>',
      'test-run start --profile <name> ...',
      'write-sql --profile <name> --sql "..." --dry-run',
      'update|delete|insert --profile <name> ... --confirm',
      'bridge plan --profile <name> ...',
    ],
    mcp: [
      'zeus.test-run',
      'zeus.write-sql',
      'zeus.insert',
      'zeus.update',
      'zeus.delete',
      'zeus.bridge',
    ],
  }),
]);

const SAFETY_CHECKPOINTS = Object.freeze([
  'S0: local read-only; safe default for orientation and inspection.',
  'S1: local artifact/config write; show the output target and preserve provenance.',
  'S2: remote IBM i/DB2 read-only; state the exact system and scope before execution.',
  'S3: controlled remote write; require explicit user approval and show the exact command first.',
  'S4: bridge/apply/compile; operator-gated and never implicit.',
]);

function buildAiOrientation() {
  const commands = listCommandHelpEntries().map(entry => ({
    command: entry.command,
    cliNames: [...entry.cliNames],
    mcpNames: [...entry.mcpNames],
    safety: entry.safety,
    scope: entry.scope,
    purpose: entry.purpose,
    subcommands: [...(entry.subcommands || [])],
  }));

  return {
    ok: true,
    service: 'zeus-rpg-promptkit',
    schemaVersion: ORIENTATION_SCHEMA_VERSION,
    purpose:
      'A CLI/MCP-first, evidence-first map for an AI agent entering an unfamiliar Zeus RPG PromptKit session.',
    firstPoint: {
      cli: 'node cli/zeus.js tools guide --json',
      mcp: 'zeus.agent.bootstrap',
      then: [
        'zeus.context.get / zeus context show --json',
        'zeus.doctor / zeus doctor --profile <name> --show-resolved',
        'zeus.help / zeus tools list --json',
      ],
    },
    operatingModel: [
      'CLI and MCP are the primary product surfaces; the local viewer is optional.',
      'Evidence comes before conclusions: locate, check freshness, read, analyze, then report provenance.',
      'Never infer a system, library, source file, member, schema, or data scope from a filename alone.',
      'Explicit command/tool arguments override the working context and must be echoed in the result.',
      'Credentials remain in the local runtime configuration and never belong in prompts, logs, artifacts, or responses.',
    ],
    workingContext: {
      fields: [...WORKING_CONTEXT_FIELDS],
      inspectCli: 'node cli/zeus.js context show --json',
      changeCli:
        'node cli/zeus.js context set --profile <name> --system <name> --source-library <library> --source-file <file> --member <member> --json',
      inspectMcp: 'zeus.context.get',
      changeMcp: 'zeus.context.set',
      resultRule:
        'Every source, metadata, or data operation should state the effective system and location in its rationale or result.',
    },
    intents: AI_INTENTS.map(intent => ({
      intent: intent.intent,
      question: intent.question,
      cli: [...intent.cli],
      mcp: [...intent.mcp],
    })),
    safetyCheckpoints: [...SAFETY_CHECKPOINTS],
    responseContract: [
      'goal: restate the requested investigation or change',
      'context: system, library/schema, source file, member, path, and data scope',
      'evidence: commands/tools used, freshness result, and artifact references',
      'finding: distinguish observed facts, inference, and unknowns',
      'next: one recommended next command/tool with safety level and approval requirement',
    ],
    commands,
    documentation: {
      cliCatalog: 'docs/tool-catalog.md',
      cliReference: 'docs/cli/reference.md',
      sessionPrompt: 'docs/ai/session-prompt.md',
      failurePlaybook: 'docs/ai/agent-failure-playbook.md',
      mcpOperatorGuide: 'docs/mcp/operator-guide.md',
    },
  };
}

function renderAiOrientationMarkdown(orientation = buildAiOrientation()) {
  const lines = [
    '<!-- Stable orientation guide. Live command details come from `zeus tools guide --json`. -->',
    '',
    '# Zeus RPG PromptKit — AI Start Here',
    '',
    orientation.purpose,
    '',
    '## First point to check',
    '',
    `- CLI: \`${orientation.firstPoint.cli}\``,
    `- MCP: \`${orientation.firstPoint.mcp}\``,
    '',
    'Then inspect the working context, validate the runtime, and ask the live help surface for exact names:',
    '',
    ...orientation.firstPoint.then.map(step => `- ${step}`),
    '',
    '## Working location is explicit',
    '',
    'Before reading source, metadata, or data, state the effective system, library/schema, source file, member, and scope. Use `context show` / `zeus.context.get`; use `context set` / `zeus.context.set` when the location is wrong or unset.',
    '',
    '## Evidence-first loop',
    '',
    '1. Locate the source or knowledge snapshot.',
    '2. Check freshness before retrieval or analysis.',
    '3. Fetch only when approved and needed.',
    '4. Analyze locally and deepen with focused evidence tools.',
    '5. Report provenance, uncertainty, and the next safe action.',
    '',
    '## Safety',
    '',
    ...orientation.safetyCheckpoints.map(checkpoint => `- ${checkpoint}`),
    '',
    '## References',
    '',
    `- [Tool catalog](../tool-catalog.md)`,
    `- [CLI reference](../cli/reference.md)`,
    `- [AI session prompt](session-prompt.md)`,
    `- [Failure playbook](agent-failure-playbook.md)`,
    `- [MCP operator guide](../mcp/operator-guide.md)`,
    '',
  ];
  return lines.join('\n');
}

module.exports = {
  AI_INTENTS,
  ORIENTATION_SCHEMA_VERSION,
  SAFETY_CHECKPOINTS,
  WORKING_CONTEXT_FIELDS,
  buildAiOrientation,
  renderAiOrientationMarkdown,
};
