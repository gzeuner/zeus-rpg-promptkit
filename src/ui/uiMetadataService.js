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

const {
  CONFIG_UI_METADATA_VERSION,
  CONFIG_UI_SECTIONS,
  listConfigUiFields,
} = require('../config/configUiMetadata');
const { COMMAND_CATEGORIES, listCommandUiMetadata } = require('../cli/commandMetadata');
const { listMcpTools } = require('../mcp/mcpTools');
const {
  AI_SESSION_GOAL_MAX_LENGTH,
  AI_SESSION_PROMPT_TEMPLATE_PATH,
} = require('./aiSessionPromptService');
const { buildGuidedConfigurationPayload } = require('./guidedConfigWizardModel');

const UI_METADATA_SCHEMA_VERSION = 1;

const WORKFLOW_CARD_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'configure',
    title: 'Setup',
    description:
      'Review profile, environment overrides, connection targets, and readiness before using other workflows.',
    category: 'configure',
    primaryActionLabel: 'Open Setup',
    availability: 'production-ready',
    enabledInShell: true,
    uiTarget: 'configure',
    area: 'primary',
    explanation: 'Setup is the first supported browser flow.',
  }),
  Object.freeze({
    id: 'fetch-sources',
    title: 'Fetch Sources',
    description: 'Prepare source evidence from IBM i libraries and members.',
    category: 'fetch',
    primaryActionLabel: 'Coming Later',
    availability: 'coming-later',
    enabledInShell: false,
    uiTarget: null,
    area: 'advanced',
    explanation: 'Remote fetch is not a supported browser action in this iteration.',
  }),
  Object.freeze({
    id: 'analyze-workspace',
    title: 'Analyze Workspace',
    description:
      'Run the existing local-only analyze pipeline against an already configured workspace source root.',
    category: 'analyze',
    primaryActionLabel: 'Analyze Workspace',
    availability: 'advanced',
    enabledInShell: true,
    uiTarget: 'analyze-workspace',
    area: 'advanced',
    explanation:
      'Available as an advanced local-only tool after Setup is ready. It is optional and does not fetch remote sources.',
  }),
  Object.freeze({
    id: 'query-db2',
    title: 'Query DB2',
    description: 'Run read-only DB2 checks and query workflows.',
    category: 'query',
    primaryActionLabel: 'Coming Later',
    availability: 'coming-later',
    enabledInShell: false,
    uiTarget: null,
    area: 'advanced',
    explanation: 'DB2 query execution is not exposed as a browser action here.',
  }),
  Object.freeze({
    id: 'review-reports',
    title: 'Reports',
    description:
      'Inspect generated reports, artifacts, and grouped read-only report views after analysis output exists.',
    category: 'review',
    primaryActionLabel: 'Open Reports',
    availability: 'production-ready',
    enabledInShell: true,
    uiTarget: 'reports',
    area: 'secondary',
    explanation:
      'Read-only report overview, Graph, DB2/Test Data, Prompt Compare, and artifact review are supported now.',
  }),
  Object.freeze({
    id: 'generate-ai-context',
    title: 'Generate AI Context',
    description: 'Bundle and refine artifacts for AI-ready context workflows.',
    category: 'context',
    primaryActionLabel: 'Coming Later',
    availability: 'coming-later',
    enabledInShell: false,
    uiTarget: null,
    area: 'advanced',
    explanation: 'AI context generation is intentionally out of scope for this browser iteration.',
  }),
]);

const AI_WORKBENCH_ROLE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'developer',
    label: 'Developer',
    description:
      'Locate sources, understand dependencies, inspect evidence, and prepare safe changes.',
    commands: ['context', 'search-source', 'fetch-member', 'analyze', 'diff', 'generate-test'],
    preferredActions: ['locate-source', 'analyze-workspace', 'review-evidence'],
  }),
  Object.freeze({
    id: 'architect',
    label: 'Architect',
    description:
      'Build a system map, trace impact, and turn legacy relationships into reviewable evidence.',
    commands: ['context', 'xref', 'trace', 'impact', 'assess-risk', 'bundle'],
    preferredActions: ['review-evidence', 'trace-impact', 'bundle-context'],
  }),
  Object.freeze({
    id: 'tester',
    label: 'Tester',
    description:
      'Validate assumptions, compare journal evidence, and create reproducible test work.',
    commands: [
      'context',
      'test-run',
      'journal-row-diff',
      'qa',
      'generate-checklist',
      'generate-test',
    ],
    preferredActions: ['refresh-evidence', 'journal-review', 'review-evidence'],
  }),
  Object.freeze({
    id: 'product-owner',
    label: 'Product Owner',
    description:
      'Ask outcome-focused questions and review impact, risk, and evidence in plain language.',
    commands: ['context', 'investigate', 'impact', 'assess-risk', 'bundle'],
    preferredActions: ['orient', 'trace-impact', 'bundle-context'],
  }),
]);

const AI_WORKBENCH_ACTION_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'orient',
    label: 'Orient me',
    description: 'Show the current setup, available runs, and the safest next step.',
    target: 'configure',
    keywords: ['start', 'setup', 'doctor', 'orient', 'readiness'],
    safety: 'S0',
  }),
  Object.freeze({
    id: 'locate-source',
    label: 'Locate a source',
    description: 'Make the exact system, library, source file, and member scope explicit.',
    target: 'configure',
    keywords: ['source', 'member', 'library', 'file', 'locate', 'context'],
    safety: 'S1',
  }),
  Object.freeze({
    id: 'refresh-evidence',
    label: 'Refresh evidence',
    description: 'Open the local analysis path and review what is currently available.',
    target: 'refresh',
    keywords: ['refresh', 'fetch', 'update', 'freshness', 'evidence'],
    safety: 'S1',
  }),
  Object.freeze({
    id: 'analyze-workspace',
    label: 'Analyze workspace',
    description: 'Run the existing local-only analysis flow after the profile is ready.',
    target: 'analyze-workspace',
    keywords: ['analyze', 'understand', 'program', 'workspace'],
    safety: 'S2',
  }),
  Object.freeze({
    id: 'review-evidence',
    label: 'Review evidence',
    description: 'Inspect reports, artifacts, graph relationships, and prompt outputs.',
    target: 'reports',
    keywords: ['review', 'report', 'artifact', 'graph', 'evidence'],
    safety: 'S0',
    requiresRun: true,
  }),
  Object.freeze({
    id: 'trace-impact',
    label: 'Trace impact',
    description: 'Open the evidence views used to follow program and data relationships.',
    target: 'graph',
    keywords: ['impact', 'trace', 'dependency', 'architecture', 'relationship'],
    safety: 'S0',
    requiresRun: true,
  }),
  Object.freeze({
    id: 'journal-review',
    label: 'Review journal evidence',
    description: 'Open the read-only evidence area for journal and data-focused review.',
    target: 'db2',
    keywords: ['journal', 'row', 'data', 'test', 'diff'],
    safety: 'S0',
    requiresRun: true,
  }),
  Object.freeze({
    id: 'bundle-context',
    label: 'Prepare AI context',
    description: 'Review the prompt and evidence area before creating a shareable context bundle.',
    target: 'workbench',
    keywords: ['context', 'prompt', 'bundle', 'share', 'ai'],
    safety: 'S1',
  }),
]);

function buildAiWorkbenchMetadata(commandEntries = listCommandUiMetadata()) {
  const commandNames = new Set(commandEntries.map(entry => entry.name));
  return {
    schemaVersion: 1,
    title: 'AI Workbench',
    summary:
      'A task-oriented cockpit for finding the right Zeus action while keeping system, source, evidence, and freshness visible.',
    keyboardShortcut: 'Ctrl/Cmd+K',
    safetyNote:
      'The palette navigates to safe, allowlisted local UI actions. It never executes arbitrary browser commands.',
    contextFields: [
      { id: 'system', label: 'System', empty: 'not bound' },
      { id: 'library', label: 'Library', empty: 'not bound' },
      { id: 'source', label: 'Source / member', empty: 'not bound' },
      { id: 'freshness', label: 'Evidence', empty: 'not loaded' },
    ],
    roles: AI_WORKBENCH_ROLE_DEFINITIONS.map(role => ({
      ...role,
      commands: role.commands.filter(command => commandNames.has(command)),
    })),
    actions: AI_WORKBENCH_ACTION_DEFINITIONS,
  };
}

const PROFILE_WIZARD_METADATA = Object.freeze({
  schemaVersion: 1,
  mode: 'local-only-profile-wizard',
  localOnlyTarget: './config/local-only/profiles.json',
  purpose:
    'Create or update local-only profiles and environment routing without exposing secrets in browser responses.',
  principles: Object.freeze([
    'Never mark config-derived candidates as remotely discovered.',
    'Keep secret material in environment variables and only emit placeholders into saved profile content.',
    'Treat local-only overlays as the safe handoff point before any future remote read-only discovery.',
  ]),
  steps: Object.freeze([
    Object.freeze({
      id: 'identity',
      title: 'Name The Profile',
      description:
        'Set the profile name, comment, and base profile extensions for the local-only overlay.',
      statusWhenMissing: 'needs-profile-input',
    }),
    Object.freeze({
      id: 'workspace',
      title: 'Confirm Workspace Paths',
      description:
        'Review source, output, and analysis registry paths so the CLI handoff stays aligned.',
      statusWhenMissing: 'needs-profile-input',
    }),
    Object.freeze({
      id: 'environment-routing',
      title: 'Route Environment Roles',
      description: 'Bind default DB, metadata, test-data, and fetch roles to known system keys.',
      statusWhenMissing: 'needs-scope',
    }),
    Object.freeze({
      id: 'fetch-scope',
      title: 'Scope Source Fetch',
      description:
        'Define the source library, optional IFS directory, files, members, and transport.',
      statusWhenMissing: 'needs-scope',
    }),
    Object.freeze({
      id: 'managed-environments',
      title: 'Manage Local Environments',
      description:
        'Create placeholder-based environment definitions that stay local-only and secret-free.',
      statusWhenMissing: 'needs-profile-input',
    }),
    Object.freeze({
      id: 'preview-save',
      title: 'Preview And Save',
      description:
        'Validate the draft, inspect the safe CLI preview, and save only to config/local-only.',
      statusWhenMissing: 'preview-ready',
    }),
  ]),
});

function buildSetupMetadata() {
  return {
    schemaVersion: 1,
    title: 'Setup',
    summary: 'Use Setup as the primary local onboarding path before Reports or Advanced / Tools.',
    primaryAction: {
      label: 'Check Readiness',
      actionPath: '/api/ui-actions/doctor',
    },
    steps: [
      {
        id: 'choose-profile',
        title: 'Choose Or Create A Profile',
        description:
          'Review shared profiles or prepare a local-only overlay before running Doctor.',
      },
      {
        id: 'preview-save',
        title: 'Preview And Save Locally',
        description: 'Preview local-only changes and save them before relying on them in Doctor.',
      },
      {
        id: 'doctor',
        title: 'Run Zeus Doctor',
        description:
          'Validate the effective runtime config after CLI, env, and profile precedence are applied.',
      },
    ],
    precedenceRules: [
      'CLI overrides env.',
      'Env overrides profile.',
      'Profile overrides defaults.',
    ],
    boundaryNotes: [
      'This screen only edits local-only config and placeholder-based environment routing.',
      'It does not expose secrets and it does not connect to IBM i or DB2 here.',
    ],
    recommendedNextTokens: [
      'setup focus',
      'doctor uses effective config',
      'warnings do not auto-abort',
    ],
    doctorStatusGuidance: {
      ready:
        'Setup looks ready. Continue to Reports when output exists, or use Advanced / Tools if you need local-only analysis or prompt work.',
      warning:
        'Review the warning cards below. Env vars may be changing the effective target even when the saved profile looks correct.',
      failed: 'Resolve the failed doctor checks before moving on.',
      error: 'Review the readiness error, then try Check Readiness again.',
      running: 'Wait for Check Readiness to finish.',
    },
  };
}

function buildAiSessionStarterMetadata() {
  const mcpTools = listMcpTools();
  const starterToolNames = [
    'zeus.doctor',
    'zeus.search-source',
    'zeus.analyze',
    'zeus.workflow',
    'zeus.query-table',
    'zeus.query-sql',
    'zeus.bundle',
  ].filter(name => mcpTools.some(tool => tool && tool.name === name));

  return {
    schemaVersion: 1,
    title: 'Start AI Session',
    templateSource: AI_SESSION_PROMPT_TEMPLATE_PATH,
    actionPath: '/api/ui-actions/generate-ai-session-prompt',
    goalMaxLength: AI_SESSION_GOAL_MAX_LENGTH,
    authoritativeCatalogPath: 'docs/tool-catalog.md',
    envLoading: {
      powerShell: {
        label: 'Windows PowerShell',
        command: '. .\\config\\load-env.ps1 -Environment <environment>',
      },
      bash: {
        label: 'Bash',
        command: 'source ./config/load-env.sh <environment>',
      },
    },
    reminders: [
      'Environment variables are shell-scoped. The Local UI cannot load env vars into an already-open terminal session.',
      'The Local UI server only sees env vars that were present when it started.',
      'Run Doctor first to validate the effective runtime config before asking an AI assistant to do deeper work.',
      'Do not paste credentials, secret env values, or full credential-bearing JDBC URLs into the goal.',
    ],
    capabilityGuidance: {
      starterCommands: [
        'doctor',
        'profiles',
        'search-source',
        'analyze',
        'workflow run',
        'query-table',
        'query-sql',
        'impact',
        'bundle',
      ],
      approvalRequiredCommands: [
        'write-sql',
        'upsert',
        'upsert-sql',
        'insert',
        'update',
        'delete',
        'bridge',
      ],
      mcp: {
        available: mcpTools.length > 0,
        toolCount: mcpTools.length,
        starterTools: starterToolNames,
        note: 'Use allowlisted Zeus MCP tools if the AI client exposes them. Do not invent Zeus MCP tool names or unsupported capabilities.',
      },
    },
  };
}

function deriveWorkflowCards(commandEntries = listCommandUiMetadata()) {
  return WORKFLOW_CARD_DEFINITIONS.map(definition => {
    const matchingCommands = commandEntries.filter(entry => entry.category === definition.category);
    const firstCommand = matchingCommands[0] || null;
    const availability = definition.availability || 'coming-later';
    const status =
      availability === 'production-ready'
        ? 'Available now'
        : availability === 'advanced'
          ? 'Advanced tool'
          : 'Coming later';
    return {
      id: definition.id,
      title: definition.title,
      description: definition.description,
      category: definition.category,
      badge: definition.category,
      status,
      primaryActionLabel: definition.primaryActionLabel,
      availability,
      enabledInShell: definition.enabledInShell !== false,
      uiTarget: definition.uiTarget || null,
      area: definition.area || 'advanced',
      explanation: definition.explanation || '',
      recommendedNext:
        firstCommand &&
        firstCommand.recommendedNextCommands &&
        firstCommand.recommendedNextCommands[0]
          ? firstCommand.recommendedNextCommands[0]
          : null,
      commandCount: matchingCommands.length,
      commands: matchingCommands.map(entry => ({
        name: entry.name,
        title: entry.title,
        summary: entry.summary,
      })),
    };
  });
}

function buildUiMetadataPayload() {
  const commandEntries = listCommandUiMetadata();
  return {
    schemaVersion: UI_METADATA_SCHEMA_VERSION,
    uiMode: 'metadata-workflow-shell',
    config: {
      version: CONFIG_UI_METADATA_VERSION,
      readOnly: true,
      sections: CONFIG_UI_SECTIONS,
      fields: listConfigUiFields({ includeSensitive: true }),
    },
    setup: buildSetupMetadata(),
    guidedConfiguration: buildGuidedConfigurationPayload({
      configFields: listConfigUiFields({ includeSensitive: true }),
    }),
    aiSessionStarter: buildAiSessionStarterMetadata(),
    profileWizard: PROFILE_WIZARD_METADATA,
    commands: {
      categories: COMMAND_CATEGORIES,
      entries: commandEntries,
    },
    workflowCards: deriveWorkflowCards(commandEntries),
    aiWorkbench: buildAiWorkbenchMetadata(commandEntries),
  };
}

module.exports = {
  UI_METADATA_SCHEMA_VERSION,
  PROFILE_WIZARD_METADATA,
  buildUiMetadataPayload,
  deriveWorkflowCards,
  buildAiWorkbenchMetadata,
};
