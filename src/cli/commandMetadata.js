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

const COMMAND_CATEGORIES = Object.freeze([
  Object.freeze({ id: 'configure', label: 'Configure', order: 10 }),
  Object.freeze({ id: 'fetch', label: 'Fetch Sources', order: 20 }),
  Object.freeze({ id: 'analyze', label: 'Analyze Workspace', order: 30 }),
  Object.freeze({ id: 'query', label: 'Query DB2', order: 40 }),
  Object.freeze({ id: 'review', label: 'Review Reports', order: 50 }),
  Object.freeze({ id: 'context', label: 'Generate AI Context', order: 60 }),
]);

const COMMAND_UI_METADATA = Object.freeze([
  Object.freeze({
    name: 'profiles',
    title: 'Profiles Overview',
    summary: 'List available profiles and show masked connection defaults.',
    category: 'configure',
    primaryUseCase: 'Discover profile names and configuration readiness before running commands.',
    requiredCapabilities: Object.freeze([]),
    commonOptions: Object.freeze(['--profile', '--show-env']),
    advancedOptions: Object.freeze(['--config']),
    outputArtifacts: Object.freeze(['stdout profile summary']),
    recommendedNextCommands: Object.freeze(['doctor']),
  }),
  Object.freeze({
    name: 'doctor',
    title: 'Environment Doctor',
    summary: 'Validate runtime wiring, Java, and DB/fetch environment contracts.',
    category: 'configure',
    primaryUseCase: 'Pre-flight safety check before fetch/query/analyze workflows.',
    requiredCapabilities: Object.freeze(['db2', 'fetch', 'workspace']),
    commonOptions: Object.freeze(['--profile']),
    advancedOptions: Object.freeze(['--probe', '--show-resolved', '--config']),
    outputArtifacts: Object.freeze(['stdout table of checks']),
    recommendedNextCommands: Object.freeze(['fetch', 'resolve-object', 'query-table', 'analyze']),
  }),
  Object.freeze({
    name: 'fetch',
    title: 'Fetch Sources',
    summary: 'Fetch IBM i source files/members into local workspace paths.',
    category: 'fetch',
    primaryUseCase: 'Refresh source evidence before local analysis.',
    requiredCapabilities: Object.freeze(['fetch']),
    commonOptions: Object.freeze(['--profile', '--source-lib', '--out']),
    advancedOptions: Object.freeze(['--transport', '--prefer-transport', '--diagnose-transport', '--members', '--config']),
    outputArtifacts: Object.freeze(['fetched source tree', 'fetch logs']),
    recommendedNextCommands: Object.freeze(['copy-to-workspace', 'analyze']),
  }),
  Object.freeze({
    name: 'fetch-member',
    title: 'Fetch Specific Members',
    summary: 'Fetch selected members from a source file.',
    category: 'fetch',
    primaryUseCase: 'Targeted refresh for one or a few members.',
    requiredCapabilities: Object.freeze(['fetch']),
    commonOptions: Object.freeze(['--profile', '--lib', '--member']),
    advancedOptions: Object.freeze(['--file', '--out', '--config']),
    outputArtifacts: Object.freeze(['selected fetched member files']),
    recommendedNextCommands: Object.freeze(['diff', 'analyze']),
  }),
  Object.freeze({
    name: 'copy-to-workspace',
    title: 'Copy To Workspace',
    summary: 'Copy fetched members to normalized workspace paths.',
    category: 'fetch',
    primaryUseCase: 'Prepare source layout for iterative analysis and diffs.',
    requiredCapabilities: Object.freeze(['workspace']),
    commonOptions: Object.freeze(['--profile', '--members']),
    advancedOptions: Object.freeze(['--force', '--config']),
    outputArtifacts: Object.freeze(['workspace source files']),
    recommendedNextCommands: Object.freeze(['analyze', 'diff']),
  }),
  Object.freeze({
    name: 'diff',
    title: 'Workspace Diff',
    summary: 'Compare local workspace members against IBM i source members.',
    category: 'review',
    primaryUseCase: 'Review local changes and fetched baseline differences.',
    requiredCapabilities: Object.freeze(['fetch', 'workspace']),
    commonOptions: Object.freeze(['--profile', '--member']),
    advancedOptions: Object.freeze(['--config']),
    outputArtifacts: Object.freeze(['stdout diff summary', 'workspace diff artifacts']),
    recommendedNextCommands: Object.freeze(['analyze', 'bundle']),
  }),
  Object.freeze({
    name: 'analyze',
    title: 'Analyze Workspace',
    summary: 'Analyze RPG/CL/DDS and emit structured evidence artifacts.',
    category: 'analyze',
    primaryUseCase: 'Generate architecture/dependency findings and prompts.',
    requiredCapabilities: Object.freeze(['workspace']),
    commonOptions: Object.freeze(['--profile', '--source', '--program', '--out']),
    advancedOptions: Object.freeze(['--mode', '--extensions', '--optimize-context', '--dense [lite|full|ultra]', '--test-data-limit', '--safe-sharing', '--with-known-facts', '--known-facts-profile', '--known-facts-path', '--config']),
    outputArtifacts: Object.freeze([
      'report.md',
      'architecture-report.md',
      'canonical-analysis.json',
      'ai-knowledge.json',
      'dependency-graph.mmd',
    ]),
    recommendedNextCommands: Object.freeze(['serve', 'bundle', 'impact']),
  }),
  Object.freeze({
    name: 'impact',
    title: 'Impact Analysis',
    summary: 'Build reverse-impact evidence for target programs or fields.',
    category: 'analyze',
    primaryUseCase: 'Estimate change blast radius before implementation.',
    requiredCapabilities: Object.freeze(['workspace']),
    commonOptions: Object.freeze(['--target', '--field', '--profile']),
    advancedOptions: Object.freeze(['--program', '--member', '--source', '--out', '--config']),
    outputArtifacts: Object.freeze(['impact summary in analysis output']),
    recommendedNextCommands: Object.freeze(['bundle', 'serve']),
  }),
  Object.freeze({
    name: 'workflow run',
    title: 'Workflow Run',
    summary: 'Execute profile-defined workflow presets step-by-step.',
    category: 'analyze',
    primaryUseCase: 'Run repeatable workflow presets with progressive steps.',
    requiredCapabilities: Object.freeze(['workflow', 'workspace']),
    commonOptions: Object.freeze(['--profile']),
    advancedOptions: Object.freeze(['--preset', '--out', '--continue-on-error', '--dense [lite|full|ultra]', '--config']),
    outputArtifacts: Object.freeze(['workflow-run-manifest.json', 'analysis output artifacts']),
    recommendedNextCommands: Object.freeze(['serve', 'bundle']),
  }),
  Object.freeze({
    name: 'investigate',
    title: 'Investigation Session',
    summary: 'Start or continue a focused, stateful investigation on previous analysis results.',
    category: 'analyze',
    primaryUseCase: 'Interactive, scoped deep-dives instead of full re-runs. Great for agents and humans.',
    requiredCapabilities: Object.freeze(['workspace']),
    commonOptions: Object.freeze(['--program', '--profile']),
    advancedOptions: Object.freeze(['--out', '--goal', '--list', '--config']),
    outputArtifacts: Object.freeze(['.investigations/<session-id>/session.json']),
    recommendedNextCommands: Object.freeze(['serve', 'analyze']),
  }),
  Object.freeze({
    name: 'query-table',
    title: 'Query Table Metadata',
    summary: 'Run read-only table metadata lookup against DB2.',
    category: 'query',
    primaryUseCase: 'Inspect schema/table info used by analysis and impact checks.',
    requiredCapabilities: Object.freeze(['db2']),
    commonOptions: Object.freeze(['--profile', '--table']),
    advancedOptions: Object.freeze(['--schema', '--filter', '--save', '--config']),
    outputArtifacts: Object.freeze(['stdout table', 'optional csv/json export']),
    recommendedNextCommands: Object.freeze(['resolve-object', 'query-sql', 'analyze']),
  }),
  Object.freeze({
    name: 'resolve-object',
    title: 'Resolve Object Names',
    summary: 'Resolve SQL and system table names across schemas with optional column checks.',
    category: 'query',
    primaryUseCase: 'Find the exact IBM i table object before querying, validating joins, or writing SQL.',
    requiredCapabilities: Object.freeze(['db2']),
    commonOptions: Object.freeze(['--profile', '--table']),
    advancedOptions: Object.freeze(['--schema', '--require-column', '--include-row-count', '--config']),
    outputArtifacts: Object.freeze(['stdout resolution table']),
    recommendedNextCommands: Object.freeze(['query-table', 'query-sql', 'analyze']),
  }),
  Object.freeze({
    name: 'query-sql',
    title: 'Query SQL',
    summary: 'Run read-only SQL queries (SELECT/WITH).',
    category: 'query',
    primaryUseCase: 'Validate assumptions against live DB2 metadata/data safely.',
    requiredCapabilities: Object.freeze(['db2']),
    commonOptions: Object.freeze(['--profile', '--sql']),
    advancedOptions: Object.freeze(['--file', '--default-schema', '--liblist', '--max-rows', '--output', '--save', '--config']),
    outputArtifacts: Object.freeze(['stdout table/csv/json', 'optional saved output']),
    recommendedNextCommands: Object.freeze(['analyze', 'impact']),
  }),
  Object.freeze({
    name: 'serve',
    title: 'Review Reports',
    summary: 'Start local browser UI for analysis artifacts and workflow output.',
    category: 'review',
    primaryUseCase: 'Review and navigate evidence without opening files manually.',
    requiredCapabilities: Object.freeze(['workspace']),
    commonOptions: Object.freeze(['--source-output-root']),
    advancedOptions: Object.freeze(['--profile', '--host', '--port', '--config']),
    outputArtifacts: Object.freeze(['local web UI session']),
    recommendedNextCommands: Object.freeze(['bundle']),
  }),
  Object.freeze({
    name: 'bundle',
    title: 'Generate AI Context Bundle',
    summary: 'Package analysis artifacts for sharing and AI session setup.',
    category: 'context',
    primaryUseCase: 'Create review-ready and assistant-ready artifact bundles.',
    requiredCapabilities: Object.freeze(['workspace']),
    commonOptions: Object.freeze(['--program', '--profile']),
    advancedOptions: Object.freeze(['--output', '--source-output-root', '--include-json', '--include-md', '--safe-sharing', '--config']),
    outputArtifacts: Object.freeze(['zip bundle', 'bundle-manifest.json']),
    recommendedNextCommands: Object.freeze(['serve']),
  }),
]);

function validateCommandUiMetadata(entries = COMMAND_UI_METADATA, categories = COMMAND_CATEGORIES) {
  const errors = [];
  const categoryIds = new Set(categories.map((entry) => entry.id));
  const names = new Set();

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      errors.push('each command metadata entry must be an object');
      continue;
    }
    if (!entry.name || typeof entry.name !== 'string') {
      errors.push('entry.name must be a non-empty string');
      continue;
    }
    if (names.has(entry.name)) {
      errors.push(`duplicate command metadata name: ${entry.name}`);
    }
    names.add(entry.name);
    if (!categoryIds.has(entry.category)) {
      errors.push(`command "${entry.name}" has unknown category "${entry.category}"`);
    }
    if (!Array.isArray(entry.commonOptions) || !Array.isArray(entry.advancedOptions)) {
      errors.push(`command "${entry.name}" must define commonOptions and advancedOptions arrays`);
    }
    if (!Array.isArray(entry.outputArtifacts) || entry.outputArtifacts.length === 0) {
      errors.push(`command "${entry.name}" must define at least one output artifact`);
    }
    if (!Array.isArray(entry.recommendedNextCommands)) {
      errors.push(`command "${entry.name}" must define recommendedNextCommands`);
    }
  }

  return errors;
}

function listCommandUiMetadata({ category = null } = {}) {
  return COMMAND_UI_METADATA.filter((entry) => (category ? entry.category === category : true));
}

function getCommandUiMetadata(name) {
  return COMMAND_UI_METADATA.find((entry) => entry.name === name) || null;
}

const COMMAND_UI_METADATA_ERRORS = Object.freeze(validateCommandUiMetadata());
if (COMMAND_UI_METADATA_ERRORS.length > 0) {
  throw new Error(`Invalid command metadata: ${COMMAND_UI_METADATA_ERRORS.join('; ')}`);
}

module.exports = {
  COMMAND_CATEGORIES,
  COMMAND_UI_METADATA,
  COMMAND_UI_METADATA_ERRORS,
  getCommandUiMetadata,
  listCommandUiMetadata,
  validateCommandUiMetadata,
};
