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

const UI_METADATA_SCHEMA_VERSION = 1;

const WORKFLOW_CARD_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'configure',
    title: 'Configure',
    description: 'Review profile, connection, and workspace metadata before running workflows.',
    category: 'configure',
    primaryActionLabel: 'Check Readiness',
  }),
  Object.freeze({
    id: 'fetch-sources',
    title: 'Fetch Sources',
    description: 'Prepare source evidence from IBM i libraries and members.',
    category: 'fetch',
    primaryActionLabel: 'Prepare Fetch Inputs',
  }),
  Object.freeze({
    id: 'analyze-workspace',
    title: 'Analyze Workspace',
    description: 'Run analysis and generate evidence artifacts for graph, DB2, and prompts.',
    category: 'analyze',
    primaryActionLabel: 'Review Analyze Commands',
  }),
  Object.freeze({
    id: 'query-db2',
    title: 'Query DB2',
    description: 'Run read-only DB2 checks and query workflows.',
    category: 'query',
    primaryActionLabel: 'Review Query Commands',
  }),
  Object.freeze({
    id: 'review-reports',
    title: 'Review Reports',
    description: 'Inspect generated reports, artifacts, and run summaries.',
    category: 'review',
    primaryActionLabel: 'Open Report Views',
  }),
  Object.freeze({
    id: 'generate-ai-context',
    title: 'Generate AI Context',
    description: 'Bundle and refine artifacts for AI-ready context workflows.',
    category: 'context',
    primaryActionLabel: 'Open Context Tools',
  }),
]);

function deriveWorkflowCards(commandEntries = listCommandUiMetadata()) {
  return WORKFLOW_CARD_DEFINITIONS.map((definition) => {
    const matchingCommands = commandEntries.filter((entry) => entry.category === definition.category);
    const firstCommand = matchingCommands[0] || null;
    return {
      id: definition.id,
      title: definition.title,
      description: definition.description,
      category: definition.category,
      badge: definition.category,
      status: 'Not checked yet',
      primaryActionLabel: definition.primaryActionLabel,
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
    commands: {
      categories: COMMAND_CATEGORIES,
      entries: commandEntries,
    },
    workflowCards: deriveWorkflowCards(commandEntries),
  };
}

module.exports = {
  UI_METADATA_SCHEMA_VERSION,
  buildUiMetadataPayload,
  deriveWorkflowCards,
};
