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
const PROFILE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const ENV_REFERENCE_PATTERN = /^(?:\$\{env:[A-Z0-9_]+\}|[A-Z0-9_]+)$/;

const GUIDED_CONFIG_SCHEMA_VERSION = 1;

const SAFETY_LEVELS = Object.freeze([
  Object.freeze({
    id: 'S0',
    label: 'Local read-only',
    description: 'Inspect local workspace state without writing or contacting IBM i.',
  }),
  Object.freeze({
    id: 'S1',
    label: 'Local artifact generation',
    description: 'Create or update local artifacts only inside the workspace.',
  }),
  Object.freeze({
    id: 'S2',
    label: 'Remote read-only IBM i / DB2 access',
    description: 'Run read-only checks or discovery against IBM i or DB2.',
  }),
  Object.freeze({
    id: 'S3',
    label: 'Controlled write',
    description: 'Reserved for explicit future write flows. Not part of this wizard.',
  }),
  Object.freeze({
    id: 'S4',
    label: 'Operator-gated high-risk',
    description: 'Reserved for future high-risk capabilities. Not part of this wizard.',
  }),
]);

const PURPOSE_LABELS = Object.freeze([
  Object.freeze({ id: 'source', label: 'Source', description: 'Primary source members and source physical files.' }),
  Object.freeze({ id: 'data', label: 'Data', description: 'Business data libraries and runtime tables.' }),
  Object.freeze({ id: 'metadata', label: 'Metadata', description: 'DB2 metadata targets and discovery libraries.' }),
  Object.freeze({ id: 'runtime-objects', label: 'Runtime Objects', description: 'Programs, service programs, modules, commands, and related runtime objects.' }),
  Object.freeze({ id: 'test-data', label: 'Test Data', description: 'Libraries used for bounded test data reads only.' }),
  Object.freeze({ id: 'reference-data', label: 'Reference Data', description: 'Read-mostly lookup or reference libraries.' }),
  Object.freeze({ id: 'system-vendor-ignore', label: 'System/Vendor/Ignore', description: 'Vendor, system, or intentionally excluded areas.' }),
  Object.freeze({ id: 'rpg-sources', label: 'RPG Sources', description: 'Source locations that mainly contain RPG or RPGLE members.' }),
  Object.freeze({ id: 'cl-sources', label: 'CL Sources', description: 'Source locations that mainly contain CL members.' }),
  Object.freeze({ id: 'dds-sources', label: 'DDS Sources', description: 'Source locations for display, printer, or physical file DDS members.' }),
  Object.freeze({ id: 'sql-sources', label: 'SQL Sources', description: 'Source locations for SQL and SQLRPGLE members.' }),
  Object.freeze({ id: 'command-sources', label: 'Command Sources', description: 'Source locations for CMD source or command definitions.' }),
  Object.freeze({ id: 'service-program-sources', label: 'Service Program / Module Sources', description: 'Source locations for service program, binder, or module related members.' }),
  Object.freeze({ id: 'unknown', label: 'Unknown / User-defined', description: 'User-defined or not-yet-classified purpose.' }),
]);

const GUIDED_CONFIG_STEPS = Object.freeze([
  Object.freeze({
    id: 'workspace',
    title: 'Step 1: Workspace',
    shortTitle: 'Workspace',
    description: 'Confirm local workspace and output roots and explain what Zeus stores locally.',
    safetyLevel: 'S0',
    focusAreas: Object.freeze(['workspace']),
    fieldKeys: Object.freeze(['runtime.configPath', 'profile.sourceRoot', 'profile.outputRoot', 'profile.analysesRegistryPath']),
    status: 'foundation-ready',
  }),
  Object.freeze({
    id: 'system-profile',
    title: 'Step 2: System Profile',
    shortTitle: 'System Profile',
    description: 'Choose or validate an IBM i profile with masked resolved values and doctor readiness.',
    safetyLevel: 'S0',
    focusAreas: Object.freeze(['systemProfile']),
    fieldKeys: Object.freeze([
      'runtime.profile',
      'profile.systems',
      'profile.db.host',
      'profile.db.url',
      'profile.db.user',
      'profile.db.password',
      'profile.db.defaultSchema',
      'profile.dbRoles.metadata',
      'profile.dbRoles.testData',
      'profile.fetch.host',
      'profile.fetch.user',
      'profile.fetch.password',
    ]),
    status: 'foundation-ready',
  }),
  Object.freeze({
    id: 'source-discovery',
    title: 'Step 3: Source Discovery',
    shortTitle: 'Source Discovery',
    description: 'Capture likely source libraries and source physical files without auto-selecting everything.',
    safetyLevel: 'S2',
    focusAreas: Object.freeze(['sourceLocations']),
    fieldKeys: Object.freeze([
      'profile.fetch.sourceLibrary',
      'profile.fetch.sourceLib',
      'profile.fetch.sourceFiles',
      'profile.fetch.files',
      'profile.fetch.members',
      'profile.fetch.out',
    ]),
    discoveryActionIds: Object.freeze([
      'discover-source-libraries',
      'discover-source-physical-files',
      'discover-members',
    ]),
    status: 'foundation-ready',
  }),
  Object.freeze({
    id: 'data-metadata',
    title: 'Step 4: Data and Metadata Libraries',
    shortTitle: 'Data & Metadata',
    description: 'Classify data, metadata, reference, and excluded libraries before deeper scans.',
    safetyLevel: 'S2',
    focusAreas: Object.freeze(['dataLibraries', 'metadataLibraries']),
    fieldKeys: Object.freeze([
      'profile.db.defaultSchema',
      'profile.dbRoles.metadata',
      'profile.dbRoles.testData',
      'profile.workflow.tables',
    ]),
    discoveryActionIds: Object.freeze(['discover-db2-tables']),
    status: 'foundation-ready',
  }),
  Object.freeze({
    id: 'object-discovery',
    title: 'Step 5: Object Discovery',
    shortTitle: 'Object Discovery',
    description: 'Prepare read-only discovery of programs, service programs, modules, files, and commands.',
    safetyLevel: 'S2',
    focusAreas: Object.freeze(['objectLibraries']),
    fieldKeys: Object.freeze(['profile.systems', 'profile.workflow.members']),
    discoveryActionIds: Object.freeze(['discover-object-types']),
    status: 'stubbed-preview-only',
  }),
  Object.freeze({
    id: 'analysis-intent',
    title: 'Step 6: Analysis Intent',
    shortTitle: 'Intent',
    description: 'Map user intent to required, recommended, optional, and not-needed configuration areas.',
    safetyLevel: 'S1',
    focusAreas: Object.freeze(['analysisIntent']),
    fieldKeys: Object.freeze([
      'profile.workflow.members',
      'profile.workflow.tables',
      'profile.workflow.impact',
      'profile.workflow.reviewers',
    ]),
    status: 'foundation-ready',
  }),
  Object.freeze({
    id: 'review-save',
    title: 'Step 7: Review and Save',
    shortTitle: 'Review & Save',
    description: 'Preview read-only remote access, local writes, warnings, and safe CLI commands before saving locally.',
    safetyLevel: 'S1',
    focusAreas: Object.freeze(['review']),
    fieldKeys: Object.freeze(['profile.outputRoot', 'profile.analysesRegistryPath']),
    status: 'foundation-ready',
  }),
]);

const GUIDED_ANALYSIS_INTENTS = Object.freeze([
  Object.freeze({
    id: 'onboarding',
    title: 'Onboarding',
    description: 'Orient a new engineer quickly with safe defaults and broad context.',
    requiredAreas: Object.freeze(['workspace', 'systemProfile', 'sourceLocations', 'analysisIntent', 'review']),
    recommendedAreas: Object.freeze(['metadataLibraries', 'objectLibraries']),
    optionalAreas: Object.freeze(['dataLibraries']),
    preset: 'onboarding',
    rationale: 'Onboarding benefits from source context first and only lightweight metadata expansion.',
  }),
  Object.freeze({
    id: 'documentation-generation',
    title: 'Documentation Generation',
    description: 'Generate readable documentation and analysis artifacts from local or fetched sources.',
    requiredAreas: Object.freeze(['workspace', 'sourceLocations', 'analysisIntent', 'review']),
    recommendedAreas: Object.freeze(['metadataLibraries']),
    optionalAreas: Object.freeze(['systemProfile', 'dataLibraries']),
    analyzeMode: 'documentation',
    rationale: 'Documentation depends on source evidence first and can enrich with metadata when available.',
  }),
  Object.freeze({
    id: 'impact-analysis',
    title: 'Impact Analysis',
    description: 'Estimate blast radius and dependency chains before change work starts.',
    requiredAreas: Object.freeze(['workspace', 'sourceLocations', 'objectLibraries', 'analysisIntent', 'review']),
    recommendedAreas: Object.freeze(['systemProfile', 'metadataLibraries']),
    optionalAreas: Object.freeze(['dataLibraries']),
    analyzeMode: 'impact',
    rationale: 'Impact analysis should see runtime objects and source dependencies before deeper data reads.',
  }),
  Object.freeze({
    id: 'modernization-review',
    title: 'Modernization Review',
    description: 'Prepare architecture and change-boundary evidence for modernization decisions.',
    requiredAreas: Object.freeze(['workspace', 'sourceLocations', 'objectLibraries', 'analysisIntent', 'review']),
    recommendedAreas: Object.freeze(['systemProfile', 'metadataLibraries']),
    optionalAreas: Object.freeze(['dataLibraries']),
    preset: 'modernization-review',
    rationale: 'Modernization needs source and object boundaries more than live business data.',
  }),
  Object.freeze({
    id: 'security-access-review',
    title: 'Security / Access Review',
    description: 'Review access-sensitive sources and safe runtime/DB evidence without mutation.',
    requiredAreas: Object.freeze(['workspace', 'systemProfile', 'sourceLocations', 'metadataLibraries', 'analysisIntent', 'review']),
    recommendedAreas: Object.freeze(['objectLibraries', 'dataLibraries']),
    optionalAreas: Object.freeze([]),
    preset: 'security-review',
    rationale: 'Security review needs clear target visibility plus explicit remote read boundaries.',
  }),
  Object.freeze({
    id: 'db2-table-field-deep-dive',
    title: 'DB2 Table / Field Deep-dive',
    description: 'Investigate specific DB2 tables or fields with read-only metadata and source evidence.',
    requiredAreas: Object.freeze(['workspace', 'systemProfile', 'metadataLibraries', 'analysisIntent', 'review']),
    recommendedAreas: Object.freeze(['sourceLocations', 'dataLibraries']),
    optionalAreas: Object.freeze(['objectLibraries']),
    analyzeMode: 'documentation',
    rationale: 'DB2 deep-dives need remote metadata readiness and focused source linkage.',
  }),
  Object.freeze({
    id: 'call-graph-review',
    title: 'Call Graph / Dependency Review',
    description: 'Inspect program-to-program and source-to-table relationships.',
    requiredAreas: Object.freeze(['workspace', 'sourceLocations', 'objectLibraries', 'analysisIntent', 'review']),
    recommendedAreas: Object.freeze(['systemProfile']),
    optionalAreas: Object.freeze(['metadataLibraries', 'dataLibraries']),
    analyzeMode: 'architecture',
    rationale: 'Dependency review is source and object heavy; DB2 metadata is helpful but not always mandatory.',
  }),
  Object.freeze({
    id: 'test-generation',
    title: 'Test Generation',
    description: 'Prepare bounded evidence for safe test planning and scenario generation.',
    requiredAreas: Object.freeze(['workspace', 'sourceLocations', 'analysisIntent', 'review']),
    recommendedAreas: Object.freeze(['systemProfile', 'metadataLibraries', 'dataLibraries']),
    optionalAreas: Object.freeze(['objectLibraries']),
    preset: 'test-generation-review',
    rationale: 'Test generation starts with source and can enrich with metadata or sample data later.',
  }),
  Object.freeze({
    id: 'code-quality-refactoring-review',
    title: 'Code Quality / Refactoring Review',
    description: 'Surface refactoring seams, weak coupling points, and uncertainty markers.',
    requiredAreas: Object.freeze(['workspace', 'sourceLocations', 'analysisIntent', 'review']),
    recommendedAreas: Object.freeze(['objectLibraries', 'metadataLibraries']),
    optionalAreas: Object.freeze(['systemProfile', 'dataLibraries']),
    preset: 'refactoring-review',
    rationale: 'Refactoring review should stay source-first and safe, with optional remote enrichment.',
  }),
]);

const GUIDED_DISCOVERY_ACTIONS = Object.freeze([
  Object.freeze({
    id: 'discover-source-libraries',
    title: 'Discover Source Libraries',
    description: 'Preview source-library scope from the resolved runtime profile before any remote-read action is attempted.',
    safetyLevel: 'S2',
    status: 'config-preview-ready',
    scope: 'IBM i read-only',
    expensive: false,
    commandPreviewTemplates: Object.freeze([
      'node ./cli/zeus.js doctor --profile {{profile}} --probe --show-resolved',
    ]),
    notes: Object.freeze([
      'This preview stays local and only derives likely scope from the selected profile.',
      'Use doctor readiness first, then confirm the intended application library before any remote-read step.',
    ]),
  }),
  Object.freeze({
    id: 'discover-source-physical-files',
    title: 'Discover Source Physical Files',
    description: 'Preview source physical file scope from resolved fetch settings and Zeus defaults.',
    safetyLevel: 'S2',
    status: 'config-preview-ready',
    scope: 'IBM i read-only',
    expensive: false,
    commandPreviewTemplates: Object.freeze([]),
    notes: Object.freeze([
      'Common candidates include QRPGLESRC, QCLSRC, QDDSSRC, QSRVSRC, QSQLSRC, QCBLLESRC, and QCMDSRC.',
      'The GUI does not inventory IBM i here; it only previews the resolved fetch scope.',
    ]),
  }),
  Object.freeze({
    id: 'discover-members',
    title: 'Discover Members',
    description: 'Preview whether the current profile already defines a bounded member filter.',
    safetyLevel: 'S2',
    status: 'config-preview-ready',
    scope: 'IBM i read-only',
    expensive: true,
    commandPreviewTemplates: Object.freeze([
      'node ./cli/zeus.js fetch-member --profile {{profile}} --lib YOUR_LIB --file QRPGLESRC --member ORDERPGM',
    ]),
    notes: Object.freeze([
      'Explicit member or source-file scoping should come before broader discovery.',
      'Broader member discovery still needs a dedicated read-only backend before the GUI may execute it.',
    ]),
  }),
  Object.freeze({
    id: 'discover-db2-tables',
    title: 'Discover DB2 Tables / Views',
    description: 'Preview safe metadata-first discovery of DB2 tables and views.',
    safetyLevel: 'S2',
    status: 'stubbed-preview-only',
    scope: 'DB2 read-only',
    expensive: true,
    commandPreviewTemplates: Object.freeze([
      'node ./cli/zeus.js resolve-object --profile {{profile}} --table APP_TABLE_00',
      'node ./cli/zeus.js query-table --profile {{profile}} --table APP_TABLE_00 --schema APPDATA',
    ]),
    notes: Object.freeze([
      'Prefer metadata-only checks before reading any live sample data.',
      'Large libraries should be previewed and narrowed intentionally.',
    ]),
  }),
  Object.freeze({
    id: 'discover-object-types',
    title: 'Discover Object Types',
    description: 'Prepare a read-only object-library review for programs, service programs, modules, files, and commands.',
    safetyLevel: 'S2',
    status: 'stubbed-preview-only',
    scope: 'IBM i read-only',
    expensive: true,
    commandPreviewTemplates: Object.freeze([
      'node ./cli/zeus.js inspect-object --profile {{profile}} --lib APPLIB --name ORDERPGM --type *PGM',
    ]),
    notes: Object.freeze([
      'Future GUI discovery should prefer preview or plan mode before full scans.',
      'Do not add a generic scan-everything action without preview and explicit confirmation.',
    ]),
  }),
]);

const FIELD_RENDERING_HINTS = Object.freeze({
  'runtime.profile': Object.freeze({
    wizardStepId: 'system-profile',
    helpText: 'Use a short local profile alias. The GUI should orchestrate existing CLI/profile contracts instead of inventing a second profile system.',
    examples: Object.freeze(['dev', 'readonly-prod']),
    discoveryActionId: null,
  }),
  'runtime.configPath': Object.freeze({
    wizardStepId: 'workspace',
    helpText: 'Keep local-only configuration under config/local-only whenever possible.',
    examples: Object.freeze(['./config', './config/local-only/profiles.json']),
    discoveryActionId: null,
  }),
  'profile.sourceRoot': Object.freeze({
    wizardStepId: 'workspace',
    helpText: 'Required for local analyze and workflow runs. The browser should never push arbitrary filesystem paths into runtime execution.',
    examples: Object.freeze(['./workspace/source', './rpg_sources']),
    discoveryActionId: null,
  }),
  'profile.outputRoot': Object.freeze({
    wizardStepId: 'review-save',
    helpText: 'Generated artifacts stay local. Review this path before any UI-triggered analyze run.',
    examples: Object.freeze(['./workspace/output', './output']),
    discoveryActionId: null,
  }),
  'profile.db.host': Object.freeze({
    wizardStepId: 'system-profile',
    helpText: 'Prefer named systems and masked resolved previews over repeating hostnames manually.',
    examples: Object.freeze(['sysdev.example.local']),
    discoveryActionId: null,
  }),
  'profile.db.password': Object.freeze({
    wizardStepId: 'system-profile',
    helpText: 'Prefer environment-variable references. Plain passwords must not be echoed back into UI previews.',
    examples: Object.freeze(['${env:ZEUS_DB_PASSWORD}']),
    discoveryActionId: null,
  }),
  'profile.fetch.password': Object.freeze({
    wizardStepId: 'system-profile',
    helpText: 'Prefer environment-variable references for fetch credentials as well.',
    examples: Object.freeze(['${env:ZEUS_FETCH_PASSWORD}']),
    discoveryActionId: null,
  }),
  'profile.fetch.sourceLibrary': Object.freeze({
    wizardStepId: 'source-discovery',
    helpText: 'Treat source-library selection as guided scope selection, not as a dump-all default.',
    examples: Object.freeze(['QRPGLESRC']),
    discoveryActionId: 'discover-source-libraries',
  }),
  'profile.fetch.sourceLib': Object.freeze({
    wizardStepId: 'source-discovery',
    helpText: 'Legacy-compatible alias for sourceLibrary. Keep backward compatibility visible in the GUI.',
    examples: Object.freeze(['APPLIB']),
    discoveryActionId: 'discover-source-libraries',
  }),
  'profile.fetch.sourceFiles': Object.freeze({
    wizardStepId: 'source-discovery',
    helpText: 'Suggested source physical files should be accepted or edited intentionally, never auto-selected blindly.',
    examples: Object.freeze(['QRPGLESRC,QCLSRC,QDDSSRC']),
    discoveryActionId: 'discover-source-physical-files',
  }),
  'profile.fetch.files': Object.freeze({
    wizardStepId: 'source-discovery',
    helpText: 'Suggested source physical files should be accepted or edited intentionally, never auto-selected blindly.',
    examples: Object.freeze(['QRPGLESRC,QCLSRC,QDDSSRC']),
    discoveryActionId: 'discover-source-physical-files',
  }),
  'profile.fetch.members': Object.freeze({
    wizardStepId: 'source-discovery',
    helpText: 'Use explicit member filters for expensive or uncertain remote discovery.',
    examples: Object.freeze(['ORDERPGM,INVOICEPGM']),
    discoveryActionId: 'discover-members',
  }),
  'profile.workflow.tables': Object.freeze({
    wizardStepId: 'data-metadata',
    helpText: 'Use this as review scope, not as a secret-bearing data field.',
    examples: Object.freeze(['ORDERS,CUSTOMERS']),
    discoveryActionId: 'discover-db2-tables',
  }),
  'profile.workflow.members': Object.freeze({
    wizardStepId: 'object-discovery',
    helpText: 'Use explicit runtime members or programs when object discovery must stay bounded.',
    examples: Object.freeze(['ORDERPGM']),
    discoveryActionId: 'discover-object-types',
  }),
  'profile.workflow.impact': Object.freeze({
    wizardStepId: 'analysis-intent',
    helpText: 'Impact settings should explain why extra scope is needed before users enable it.',
    examples: Object.freeze(['HIGH']),
    discoveryActionId: null,
  }),
  'profile.workflow.reviewers': Object.freeze({
    wizardStepId: 'review-save',
    helpText: 'Use reviewer metadata to explain who should validate outputs, not to expose contacts or secrets.',
    examples: Object.freeze(['architecture-leads']),
    discoveryActionId: null,
  }),
});

function uniqueStrings(values) {
  return Array.from(new Set((values || []).map((entry) => String(entry || '').trim()).filter(Boolean)));
}

function toUppercaseList(values) {
  return uniqueStrings(values).map((entry) => entry.toUpperCase());
}

function getPurposeLabel(id) {
  return PURPOSE_LABELS.find((entry) => entry.id === id) || null;
}

function getGuidedConfigStep(stepId) {
  return GUIDED_CONFIG_STEPS.find((entry) => entry.id === stepId) || null;
}

function getGuidedAnalysisIntent(intentId) {
  return GUIDED_ANALYSIS_INTENTS.find((entry) => entry.id === intentId) || null;
}

function getGuidedDiscoveryAction(actionId) {
  return GUIDED_DISCOVERY_ACTIONS.find((entry) => entry.id === actionId) || null;
}

function inferFieldSafetyLevel(field) {
  const capabilities = Array.isArray(field && field.capabilities) ? field.capabilities : [];
  if (capabilities.includes('fetch') || capabilities.includes('query')) {
    return 'S2';
  }
  if (capabilities.includes('analyze') || capabilities.includes('workflow') || capabilities.includes('bundle') || capabilities.includes('serve')) {
    return 'S1';
  }
  return 'S0';
}

function inferWizardStepId(field) {
  const section = String(field && field.section || '').trim();
  if (section === 'profile' || section === 'db2') return 'system-profile';
  if (section === 'workspace') return 'workspace';
  if (section === 'fetch') return 'source-discovery';
  if (section === 'analysis') return 'analysis-intent';
  if (section === 'workflow') return 'review-save';
  return 'workspace';
}

function summarizeValidationRule(validation = {}) {
  if (!validation || typeof validation !== 'object') {
    return 'No extra validation metadata.';
  }

  const lines = [];
  if (validation.pattern) lines.push(`pattern ${validation.pattern}`);
  if (validation.startsWith) lines.push(`must start with ${validation.startsWith}`);
  if (validation.minLength) lines.push(`minimum length ${validation.minLength}`);
  if (validation.fileExtension) lines.push(`file extension ${validation.fileExtension}`);
  if (validation.writablePath) lines.push('must be writable');
  if (validation.mustExistForAnalyze) lines.push('must exist before analyze');
  if (validation.uppercaseRecommended) lines.push('uppercase recommended');
  if (validation.acceptsJsonFile) lines.push('accepts JSON file or directory');
  if (validation.allowEnvPlaceholder) lines.push('environment-variable placeholder allowed');
  if (validation.cliOnly) lines.push('CLI-only runtime option');
  if (validation.mutuallyExclusiveWith) lines.push(`mutually exclusive with ${validation.mutuallyExclusiveWith}`);
  if (Array.isArray(validation.allowedKeys) && validation.allowedKeys.length > 0) {
    lines.push(`allowed keys: ${validation.allowedKeys.join(', ')}`);
  }
  return lines.length > 0 ? lines.join('; ') : 'No extra validation metadata.';
}

function enrichConfigField(field) {
  const hint = FIELD_RENDERING_HINTS[field.key] || {};
  const examples = uniqueStrings([field.example, ...(hint.examples || [])]);
  return {
    ...field,
    helpText: hint.helpText || field.description,
    examples,
    secret: Boolean(field.sensitive),
    safetyLevel: hint.safetyLevel || inferFieldSafetyLevel(field),
    validationRule: summarizeValidationRule(field.validation),
    discoveryActionId: hint.discoveryActionId || null,
    wizardStepId: hint.wizardStepId || inferWizardStepId(field),
  };
}

function listGuidedConfigFields(configFields = []) {
  return (Array.isArray(configFields) ? configFields : []).map((field) => enrichConfigField(field));
}

function classifyIntentAreas(intentId) {
  const intent = getGuidedAnalysisIntent(intentId);
  if (!intent) {
    throw new Error(`Unknown guided analysis intent: ${intentId}`);
  }

  return GUIDED_CONFIG_STEPS.map((step) => {
    const classifications = [];
    if (step.focusAreas.some((entry) => intent.requiredAreas.includes(entry))) {
      classifications.push('required');
    }
    if (step.focusAreas.some((entry) => intent.recommendedAreas.includes(entry))) {
      classifications.push('recommended');
    }
    if (step.focusAreas.some((entry) => intent.optionalAreas.includes(entry))) {
      classifications.push('optional');
    }

    let classification = 'not-needed';
    if (classifications.includes('required')) classification = 'required';
    else if (classifications.includes('recommended')) classification = 'recommended';
    else if (classifications.includes('optional')) classification = 'optional';

    return {
      stepId: step.id,
      title: step.shortTitle,
      classification,
      rationale: intent.rationale,
    };
  });
}

function getNextGuidedConfigStepId(stepId) {
  const currentIndex = GUIDED_CONFIG_STEPS.findIndex((entry) => entry.id === stepId);
  if (currentIndex < 0) return GUIDED_CONFIG_STEPS[0].id;
  return GUIDED_CONFIG_STEPS[Math.min(currentIndex + 1, GUIDED_CONFIG_STEPS.length - 1)].id;
}

function getPreviousGuidedConfigStepId(stepId) {
  const currentIndex = GUIDED_CONFIG_STEPS.findIndex((entry) => entry.id === stepId);
  if (currentIndex < 0) return GUIDED_CONFIG_STEPS[0].id;
  return GUIDED_CONFIG_STEPS[Math.max(currentIndex - 1, 0)].id;
}

function buildCliPreviewTemplates(intentId) {
  const intent = getGuidedAnalysisIntent(intentId);
  if (!intent) {
    throw new Error(`Unknown guided analysis intent: ${intentId}`);
  }

  const commands = [
    'node ./cli/zeus.js doctor --profile {{profile}} --show-resolved',
  ];

  if (intent.requiredAreas.includes('sourceLocations')) {
    commands.push('node ./cli/zeus.js analyze --profile {{profile}} --source {{sourceRoot}} --program {{program}} --out {{outputRoot}}');
  }

  if (intent.preset) {
    commands.push(`node ./cli/zeus.js workflow --preset ${intent.preset} --profile {{profile}} --source {{sourceRoot}} --program {{program}} --out {{outputRoot}}`);
  } else if (intent.analyzeMode) {
    commands.push(`node ./cli/zeus.js analyze --profile {{profile}} --source {{sourceRoot}} --program {{program}} --out {{outputRoot}} --mode ${intent.analyzeMode}`);
  }

  return uniqueStrings(commands);
}

function renderCliPreviewTemplate(templateLines, {
  profile = 'dev',
  sourceRoot = './workspace/source',
  outputRoot = './workspace/output',
  program = 'ORDERPGM',
} = {}) {
  return (templateLines || []).map((line) => String(line || '')
    .replace(/\{\{profile\}\}/g, profile)
    .replace(/\{\{sourceRoot\}\}/g, sourceRoot)
    .replace(/\{\{outputRoot\}\}/g, outputRoot)
    .replace(/\{\{program\}\}/g, program));
}

function buildSafeCliPreview(draft = {}) {
  const normalized = validateGuidedConfigurationDraft(draft);
  const templateLines = buildCliPreviewTemplates(normalized.normalized.intentId);
  return {
    intentId: normalized.normalized.intentId,
    safetyLevels: uniqueStrings(['S0', 'S1', ...(normalized.normalized.requiresRemoteRead ? ['S2'] : [])]),
    commands: renderCliPreviewTemplate(templateLines, {
      profile: normalized.normalized.profileName || 'dev',
      sourceRoot: normalized.normalized.sourceRoot || './workspace/source',
      outputRoot: normalized.normalized.outputRoot || './workspace/output',
      program: normalized.normalized.program || 'ORDERPGM',
    }).filter((line) => !/password|secret|token/i.test(line)),
    warnings: normalized.warnings,
  };
}

function validateGuidedConfigurationDraft(draft = {}) {
  const sourceLocations = Array.isArray(draft.sourceLocations) ? draft.sourceLocations : [];
  const warnings = [];
  const errors = [];

  const profileName = String(draft.profileName || '').trim();
  const intentId = String(draft.intentId || 'onboarding').trim();
  const sourceRoot = String(draft.sourceRoot || '').trim();
  const outputRoot = String(draft.outputRoot || '').trim();
  const program = String(draft.program || '').trim() || 'ORDERPGM';
  const secretReference = String(draft.secretReference || '').trim();

  if (!profileName) {
    warnings.push('Profile name is missing; CLI previews use a safe default placeholder.');
  } else if (!PROFILE_NAME_PATTERN.test(profileName)) {
    errors.push('Profile name contains unsupported characters.');
  }

  if (!getGuidedAnalysisIntent(intentId)) {
    errors.push(`Unknown guided intent: ${intentId}`);
  }

  if (secretReference && !ENV_REFERENCE_PATTERN.test(secretReference)) {
    errors.push('Secrets must be referenced through environment variables or placeholders, not plain text.');
  }

  const normalizedSources = sourceLocations.map((entry) => ({
    library: String(entry && entry.library || '').trim().toUpperCase(),
    sourceFile: String(entry && entry.sourceFile || '').trim().toUpperCase(),
    purposeLabel: String(entry && entry.purposeLabel || 'unknown').trim(),
  }));

  for (const source of normalizedSources) {
    if (!getPurposeLabel(source.purposeLabel)) {
      errors.push(`Unknown purpose label: ${source.purposeLabel}`);
    }
  }

  if (sourceRoot && /^[A-Za-z]:\\|^\//.test(sourceRoot)) {
    warnings.push('Absolute workspace paths should be reviewed carefully in the GUI and kept inside allowed local boundaries.');
  }
  if (outputRoot && /^[A-Za-z]:\\|^\//.test(outputRoot)) {
    warnings.push('Absolute output paths should be reviewed carefully in the GUI and kept inside allowed local boundaries.');
  }

  const intent = getGuidedAnalysisIntent(intentId);
  const requiresRemoteRead = Boolean(intent && (
    intent.requiredAreas.includes('systemProfile')
    || intent.requiredAreas.includes('metadataLibraries')
    || intent.requiredAreas.includes('objectLibraries')
  ));

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalized: {
      profileName,
      intentId,
      sourceRoot,
      outputRoot,
      program,
      secretReference: secretReference ? '(env reference)' : '',
      sourceLocations: normalizedSources,
      requiresRemoteRead,
    },
  };
}

function buildConfigDerivedDiscoveryPreview(definition, profile, configContext = {}) {
  const sourceLibrary = String(configContext.sourceLibrary || '').trim().toUpperCase();
  const sourceFiles = toUppercaseList(configContext.sourceFiles || []);
  const members = toUppercaseList(configContext.members || []);
  const outputRoot = String(configContext.outputRoot || '').trim();
  const matchesDefaultSourceFiles = Boolean(configContext.matchesDefaultSourceFiles);
  const hasSourceLibOverride = Boolean(configContext.hasSourceLibOverride);
  const unavailableReason = String(configContext.error || '').trim();
  const basePreview = {
    actionId: definition.id,
    title: definition.title,
    implemented: true,
    readOnly: true,
    previewKind: 'config-derived-local-preview',
    safetyLevel: definition.safetyLevel,
    scope: definition.scope,
    expensive: Boolean(definition.expensive),
    commandPreview: renderCliPreviewTemplate(definition.commandPreviewTemplates, { profile }),
    notes: [
      'This preview is derived locally from the resolved runtime profile and does not contact IBM i or DB2.',
      ...definition.notes,
    ],
  };

  if (unavailableReason) {
    return {
      ...basePreview,
      status: 'needs-profile-input',
      summary: 'Profile-based preview is unavailable until the selected fetch profile resolves cleanly.',
      candidates: [],
      warnings: [unavailableReason],
    };
  }

  if (definition.id === 'discover-source-libraries') {
    const candidates = sourceLibrary
      ? [{
        value: sourceLibrary,
        kind: 'source-library',
        confidence: 'high',
        origin: hasSourceLibOverride ? 'resolved env override' : 'resolved fetch config',
        rationale: 'Current runtime profile already resolves a source library for fetch scope.',
      }]
      : [];
    const warnings = [];
    if (!sourceLibrary) {
      warnings.push('No source library resolves for the selected profile yet. Add fetch.sourceLibrary or fetch.sourceLib before remote discovery.');
    }
    if (hasSourceLibOverride) {
      warnings.push('An environment override currently changes the resolved source library for this preview.');
    }
    return {
      ...basePreview,
      status: sourceLibrary ? 'config-preview-ready' : 'needs-profile-input',
      summary: sourceLibrary
        ? 'The selected profile resolves a concrete source library candidate already.'
        : 'The selected profile does not resolve a source library yet.',
      candidates,
      warnings,
      resolvedScope: {
        sourceLibrary: sourceLibrary || '(not configured)',
        sourceFileCount: sourceFiles.length,
        memberFilterCount: members.length,
        outputRoot: outputRoot || '(not configured)',
      },
    };
  }

  if (definition.id === 'discover-source-physical-files') {
    const candidates = sourceFiles.map((value) => ({
      value,
      kind: 'source-file',
      confidence: matchesDefaultSourceFiles ? 'medium' : 'high',
      origin: matchesDefaultSourceFiles ? 'resolved fetch scope (matches Zeus defaults)' : 'resolved fetch config',
      rationale: matchesDefaultSourceFiles
        ? 'Resolved fetch scope currently matches the standard Zeus source-file set.'
        : 'Resolved fetch scope already narrows the source physical files.',
    }));
    const warnings = [];
    if (!sourceLibrary) {
      warnings.push('Confirm a source library before treating these source-file candidates as remote fetch scope.');
    }
    return {
      ...basePreview,
      status: candidates.length > 0 ? 'config-preview-ready' : 'needs-profile-input',
      summary: candidates.length > 0
        ? `The selected profile resolves ${candidates.length} source physical file candidate${candidates.length === 1 ? '' : 's'}.`
        : 'No source physical files resolve for the selected profile yet.',
      candidates,
      warnings,
      resolvedScope: {
        sourceLibrary: sourceLibrary || '(not configured)',
        sourceFileCount: candidates.length,
        memberFilterCount: members.length,
        outputRoot: outputRoot || '(not configured)',
      },
    };
  }

  const candidates = members.map((value) => ({
    value,
    kind: 'member',
    confidence: 'high',
    origin: 'resolved fetch config',
    rationale: 'Current runtime profile already defines an explicit bounded member filter.',
  }));
  const warnings = [];
  if (!candidates.length) {
    warnings.push('No member filter is configured yet. Keep member discovery bounded before attempting broader remote scans.');
  }
  if (!sourceLibrary) {
    warnings.push('Confirm the source library before running any member-level remote read.');
  }
  return {
    ...basePreview,
    status: candidates.length > 0 ? 'config-preview-ready' : 'needs-scope',
    summary: candidates.length > 0
      ? `The selected profile already limits fetch scope to ${candidates.length} member${candidates.length === 1 ? '' : 's'}.`
      : 'No explicit member filter resolves for the selected profile yet.',
    candidates,
    warnings,
    resolvedScope: {
      sourceLibrary: sourceLibrary || '(not configured)',
      sourceFileCount: sourceFiles.length,
      memberFilterCount: candidates.length,
      outputRoot: outputRoot || '(not configured)',
    },
  };
}

function buildDiscoveryActionPreview({ actionId, profile = 'dev', configContext = null } = {}) {
  const definition = getGuidedDiscoveryAction(actionId);
  if (!definition) {
    throw new Error(`Unknown discovery action: ${actionId}`);
  }
  if (!PROFILE_NAME_PATTERN.test(String(profile || '').trim())) {
    throw new Error('Profile name contains unsupported characters.');
  }

  if (configContext && (
    definition.id === 'discover-source-libraries'
    || definition.id === 'discover-source-physical-files'
    || definition.id === 'discover-members'
  )) {
    return buildConfigDerivedDiscoveryPreview(definition, profile, configContext);
  }

  return {
    actionId: definition.id,
    title: definition.title,
    status: 'not-ready',
    implemented: false,
    readOnly: true,
    safetyLevel: definition.safetyLevel,
    scope: definition.scope,
    expensive: Boolean(definition.expensive),
    commandPreview: renderCliPreviewTemplate(definition.commandPreviewTemplates, { profile }),
    notes: [
      'This GUI discovery action is currently a contract-first stub.',
      ...definition.notes,
    ],
  };
}

function buildGuidedConfigurationPayload({ configFields = [] } = {}) {
  const enrichedFields = listGuidedConfigFields(configFields);
  return {
    schemaVersion: GUIDED_CONFIG_SCHEMA_VERSION,
    nonGoals: Object.freeze([
      'No remote write behavior.',
      'No secret display or plain-password storage.',
      'No scan-everything button without preview.',
      'No MCP tool overexposure by default.',
    ]),
    safetyLevels: SAFETY_LEVELS,
    purposeLabels: PURPOSE_LABELS,
    steps: GUIDED_CONFIG_STEPS.map((step) => ({
      ...step,
      fields: enrichedFields.filter((field) => field.wizardStepId === step.id),
    })),
    intents: GUIDED_ANALYSIS_INTENTS.map((intent) => ({
      ...intent,
      classifications: classifyIntentAreas(intent.id),
      cliPreviewTemplate: buildCliPreviewTemplates(intent.id),
    })),
    discoveryActions: GUIDED_DISCOVERY_ACTIONS,
  };
}

module.exports = {
  GUIDED_ANALYSIS_INTENTS,
  GUIDED_CONFIG_SCHEMA_VERSION,
  GUIDED_CONFIG_STEPS,
  GUIDED_DISCOVERY_ACTIONS,
  PURPOSE_LABELS,
  SAFETY_LEVELS,
  buildDiscoveryActionPreview,
  buildGuidedConfigurationPayload,
  buildSafeCliPreview,
  classifyIntentAreas,
  getGuidedAnalysisIntent,
  getGuidedConfigStep,
  getGuidedDiscoveryAction,
  getNextGuidedConfigStepId,
  getPreviousGuidedConfigStepId,
  listGuidedConfigFields,
  validateGuidedConfigurationDraft,
};
