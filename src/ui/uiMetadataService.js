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
const {
  COMMAND_CATEGORIES,
  listCommandUiMetadata,
} = require('../cli/commandMetadata');
const { buildGuidedConfigurationPayload } = require('./guidedConfigWizardModel');

const UI_METADATA_SCHEMA_VERSION = 1;

const WORKFLOW_CARD_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'configure',
    title: 'Setup',
    description: 'Review profile, environment overrides, connection targets, and readiness before using other workflows.',
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
    description: 'Run the existing local-only analyze pipeline against an already configured workspace source root.',
    category: 'analyze',
    primaryActionLabel: 'Analyze Workspace',
    availability: 'advanced',
    enabledInShell: true,
    uiTarget: 'analyze-workspace',
    area: 'advanced',
    explanation: 'Available as an advanced local-only tool after Setup is ready. It is optional and does not fetch remote sources.',
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
    description: 'Inspect generated reports, artifacts, and grouped read-only report views after analysis output exists.',
    category: 'review',
    primaryActionLabel: 'Open Reports',
    availability: 'production-ready',
    enabledInShell: true,
    uiTarget: 'reports',
    area: 'secondary',
    explanation: 'Read-only report overview, Graph, DB2/Test Data, Prompt Compare, and artifact review are supported now.',
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

const PROFILE_WIZARD_METADATA = Object.freeze({
  schemaVersion: 1,
  mode: 'local-only-profile-wizard',
  localOnlyTarget: './config/local-only/profiles.json',
  purpose: 'Create or update local-only profiles and environment routing without exposing secrets in browser responses.',
  principles: Object.freeze([
    'Never mark config-derived candidates as remotely discovered.',
    'Keep secret material in environment variables and only emit placeholders into saved profile content.',
    'Treat local-only overlays as the safe handoff point before any future remote read-only discovery.',
  ]),
  steps: Object.freeze([
    Object.freeze({
      id: 'identity',
      title: 'Name The Profile',
      description: 'Set the profile name, comment, and base profile extensions for the local-only overlay.',
      statusWhenMissing: 'needs-profile-input',
    }),
    Object.freeze({
      id: 'workspace',
      title: 'Confirm Workspace Paths',
      description: 'Review source, output, and analysis registry paths so the CLI handoff stays aligned.',
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
      description: 'Define the source library, optional IFS directory, files, members, and transport.',
      statusWhenMissing: 'needs-scope',
    }),
    Object.freeze({
      id: 'managed-environments',
      title: 'Manage Local Environments',
      description: 'Create placeholder-based environment definitions that stay local-only and secret-free.',
      statusWhenMissing: 'needs-profile-input',
    }),
    Object.freeze({
      id: 'preview-save',
      title: 'Preview And Save',
      description: 'Validate the draft, inspect the safe CLI preview, and save only to config/local-only.',
      statusWhenMissing: 'preview-ready',
    }),
  ]),
});

function deriveWorkflowCards(commandEntries = listCommandUiMetadata()) {
  return WORKFLOW_CARD_DEFINITIONS.map((definition) => {
    const matchingCommands = commandEntries.filter((entry) => entry.category === definition.category);
    const firstCommand = matchingCommands[0] || null;
    const availability = definition.availability || 'coming-later';
    const status = availability === 'production-ready'
      ? 'Available now'
      : (availability === 'advanced' ? 'Advanced tool' : 'Coming later');
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
      recommendedNext: firstCommand && firstCommand.recommendedNextCommands && firstCommand.recommendedNextCommands[0]
        ? firstCommand.recommendedNextCommands[0]
        : null,
      commandCount: matchingCommands.length,
      commands: matchingCommands.map((entry) => ({
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
    guidedConfiguration: buildGuidedConfigurationPayload({
      configFields: listConfigUiFields({ includeSensitive: true }),
    }),
    profileWizard: PROFILE_WIZARD_METADATA,
    commands: {
      categories: COMMAND_CATEGORIES,
      entries: commandEntries,
    },
    workflowCards: deriveWorkflowCards(commandEntries),
  };
}

module.exports = {
  UI_METADATA_SCHEMA_VERSION,
  PROFILE_WIZARD_METADATA,
  buildUiMetadataPayload,
  deriveWorkflowCards,
};
