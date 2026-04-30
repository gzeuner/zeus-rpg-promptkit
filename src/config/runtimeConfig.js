/*
Copyright 2026 Guido Zeuner

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
const fs = require('fs');
const path = require('path');
const { DEFAULT_TEST_DATA_LIMIT } = require('../db2/testDataExportService');
const { DEFAULT_CONTEXT_OPTIMIZER_OPTIONS } = require('../ai/contextOptimizer');
const { DEFAULT_SOURCE_FILES, DEFAULT_TRANSPORT } = require('../fetch/fetchService');
const { DEFAULT_STREAM_FILE_CCSID } = require('../fetch/ifsExporter');
const { DEFAULT_ANALYSIS_LIMITS } = require('../analyze/analysisLimits');

const DEFAULT_EXTENSIONS = ['.rpg', '.rpgle', '.sqlrpgle', '.rpgile', '.bnd', '.binder', '.bndsrc', '.clp', '.clle', '.dds', '.dspf', '.prtf', '.pf', '.lf'];
const ALLOWED_FETCH_TRANSPORTS = new Set(['auto', 'sftp', 'jt400', 'ftp']);
const ALLOWED_WORK_COPY_EXTENSIONS = new Set(['txt', 'original', 'suffixed']);
const ALLOWED_WORKFLOW_STEPS = new Set(['fetch', 'copy', 'analyze', 'impact', 'query-table', 'report']);
const GLOBAL_PROFILE_KEYS = new Set(['contextOptimizer', 'testData', 'analysisLimits', 'presets']);
const PROFILES_METADATA_KEY = Symbol('zeusProfilesMetadata');
const DEFAULT_WORK_COPY = Object.freeze({
  root: 'source/',
  extension: 'txt',
});
const DEFAULT_TOKEN_BUDGET = 2200;
const DEFAULT_WORKFLOW_STEPS = Object.freeze(['fetch', 'copy', 'analyze', 'report']);
const DEFAULT_WORKFLOW_ANALYZE_MODES = Object.freeze(['documentation', 'defect-analysis']);
const TOKEN_BUDGET_KEY_ALIASES = Object.freeze({
  documentation: 'documentation',
  'error-analysis': 'errorAnalysis',
  erroranalysis: 'errorAnalysis',
  errorAnalysis: 'errorAnalysis',
  'defect-analysis': 'defectAnalysis',
  defectanalysis: 'defectAnalysis',
  defectAnalysis: 'defectAnalysis',
});

function failValidation(message) {
  throw new Error(`Invalid configuration: ${message}`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertOptionalString(value, label) {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string') {
    failValidation(`${label} must be a string`);
  }
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    failValidation(`${label} must be an array of strings`);
  }
}

function assertOptionalStringOrStringArray(value, label) {
  if (value === undefined || value === null) return;
  if (typeof value === 'string') return;
  assertStringArray(value, label);
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    failValidation(`${label} must be a positive integer`);
  }
}

function normalizeTokenBudgetKey(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  return TOKEN_BUDGET_KEY_ALIASES[raw] || TOKEN_BUDGET_KEY_ALIASES[raw.toLowerCase()] || raw;
}

function normalizeExtendsList(value) {
  if (value === undefined || value === null) {
    return [];
  }
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return [];
}

function validateContextOptimizerConfig(value, label) {
  if (!isPlainObject(value)) {
    failValidation(`${label} must be an object`);
  }

  for (const [key, fieldValue] of Object.entries(value)) {
    if (fieldValue === undefined || fieldValue === null) continue;
    if (key === 'workflowTokenBudgets') {
      if (!isPlainObject(fieldValue)) {
        failValidation(`${label}.workflowTokenBudgets must be an object`);
      }
      for (const [workflowKey, workflowBudget] of Object.entries(fieldValue)) {
        assertPositiveInteger(workflowBudget, `${label}.workflowTokenBudgets.${workflowKey}`);
      }
      continue;
    }
    assertPositiveInteger(fieldValue, `${label}.${key}`);
  }
}

function validateAnalysisLimitsConfig(value, label) {
  if (!isPlainObject(value)) {
    failValidation(`${label} must be an object`);
  }

  for (const [key, fieldValue] of Object.entries(value)) {
    if (fieldValue === undefined || fieldValue === null) continue;
    assertPositiveInteger(fieldValue, `${label}.${key}`);
  }
}

function validateMaskRule(rule, label) {
  if (!isPlainObject(rule)) {
    failValidation(`${label} must be an object`);
  }
  assertOptionalString(rule.schema, `${label}.schema`);
  assertOptionalString(rule.table, `${label}.table`);
  if (rule.columns !== undefined) {
    assertStringArray(rule.columns, `${label}.columns`);
  }
  assertOptionalString(rule.value, `${label}.value`);

  if (!rule.table && !rule.schema) {
    failValidation(`${label} must define at least one of .table or .schema`);
  }
  if (!Array.isArray(rule.columns) || rule.columns.length === 0) {
    failValidation(`${label}.columns must be a non-empty array of strings`);
  }
}

function validateTestDataConfig(value, label) {
  if (!isPlainObject(value)) {
    failValidation(`${label} must be an object`);
  }
  if (value.limit !== undefined) {
    assertPositiveInteger(value.limit, `${label}.limit`);
  }
  if (value.maskColumns !== undefined) {
    assertStringArray(value.maskColumns, `${label}.maskColumns`);
  }
  if (value.allowTables !== undefined) {
    assertStringArray(value.allowTables, `${label}.allowTables`);
  }
  if (value.denyTables !== undefined) {
    assertStringArray(value.denyTables, `${label}.denyTables`);
  }
  if (value.maskRules !== undefined) {
    if (!Array.isArray(value.maskRules)) {
      failValidation(`${label}.maskRules must be an array`);
    }
    value.maskRules.forEach((rule, index) => validateMaskRule(rule, `${label}.maskRules[${index}]`));
  }
}

function validateDbConfig(value, label) {
  if (!isPlainObject(value)) {
    failValidation(`${label} must be an object`);
  }
  assertOptionalString(value.host, `${label}.host`);
  assertOptionalString(value.url, `${label}.url`);
  assertOptionalString(value.user, `${label}.user`);
  assertOptionalString(value.password, `${label}.password`);
  assertOptionalString(value.defaultSchema, `${label}.defaultSchema`);
  assertOptionalString(value.defaultLibrary, `${label}.defaultLibrary`);
  assertOptionalString(value.schema, `${label}.schema`);
  assertOptionalString(value.library, `${label}.library`);
}

function validateDbRoleConfig(value, label) {
  if (!isPlainObject(value)) {
    failValidation(`${label} must be an object`);
  }

  for (const [key, roleConfig] of Object.entries(value)) {
    if (key !== 'metadata' && key !== 'testData') {
      failValidation(`${label}.${key} is not supported; valid roles are metadata and testData`);
    }
    if (roleConfig === undefined || roleConfig === null) {
      continue;
    }
    validateDbConfig(roleConfig, `${label}.${key}`);
  }
}

function validateFetchProfile(value, label) {
  if (!isPlainObject(value)) {
    failValidation(`${label} must be an object`);
  }
  assertOptionalString(value.host, `${label}.host`);
  assertOptionalString(value.user, `${label}.user`);
  assertOptionalString(value.password, `${label}.password`);
  assertOptionalString(value.sourceLib, `${label}.sourceLib`);
  assertOptionalString(value.ifsDir, `${label}.ifsDir`);
  assertOptionalString(value.out, `${label}.out`);
  if (value.files !== undefined) {
    assertStringArray(value.files, `${label}.files`);
  }
  if (value.members !== undefined) {
    assertStringArray(value.members, `${label}.members`);
  }
  if (value.replace !== undefined && typeof value.replace !== 'boolean') {
    failValidation(`${label}.replace must be a boolean`);
  }
  if (value.streamFileCcsid !== undefined) {
    assertPositiveInteger(value.streamFileCcsid, `${label}.streamFileCcsid`);
  }
  if (value.transport !== undefined) {
    assertOptionalString(value.transport, `${label}.transport`);
    const normalized = String(value.transport).trim().toLowerCase();
    if (normalized && !ALLOWED_FETCH_TRANSPORTS.has(normalized)) {
      failValidation(`${label}.transport must be one of: auto, sftp, jt400, ftp`);
    }
  }
}

function validateWorkCopyConfig(value, label) {
  if (!isPlainObject(value)) {
    failValidation(`${label} must be an object`);
  }
  assertOptionalString(value.root, `${label}.root`);
  if (value.extension !== undefined) {
    assertOptionalString(value.extension, `${label}.extension`);
    const normalized = String(value.extension).trim().toLowerCase();
    if (normalized && !ALLOWED_WORK_COPY_EXTENSIONS.has(normalized)) {
      failValidation(`${label}.extension must be one of: txt, original, suffixed`);
    }
  }
}

function validateTokenBudgetConfig(value, label) {
  if (!isPlainObject(value)) {
    failValidation(`${label} must be an object`);
  }
  for (const [key, budget] of Object.entries(value)) {
    assertPositiveInteger(budget, `${label}.${key}`);
  }
}

function validateWorkflowTableConfig(value, label) {
  if (!isPlainObject(value)) {
    failValidation(`${label} must be an object`);
  }
  assertOptionalString(value.schema, `${label}.schema`);
  assertOptionalString(value.table, `${label}.table`);
  assertOptionalString(value.filter, `${label}.filter`);
  if (!value.table || !String(value.table).trim()) {
    failValidation(`${label}.table must be a non-empty string`);
  }
}

function validateWorkflowImpactConfig(value, label) {
  if (!isPlainObject(value)) {
    failValidation(`${label} must be an object`);
  }
  assertOptionalString(value.target, `${label}.target`);
  assertOptionalString(value.field, `${label}.field`);
  assertOptionalString(value.program, `${label}.program`);
  assertOptionalString(value.member, `${label}.member`);
  if (!value.target && !value.field) {
    failValidation(`${label} must define at least one of .target or .field`);
  }
}

function validateWorkflowPresetDefinition(value, label) {
  if (!isPlainObject(value)) {
    failValidation(`${label} must be an object`);
  }
  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    failValidation(`${label}.steps must be a non-empty array`);
  }
  for (const step of value.steps) {
    const normalized = String(step || '').trim().toLowerCase();
    if (!ALLOWED_WORKFLOW_STEPS.has(normalized)) {
      failValidation(`${label}.steps contains an unsupported value: ${step}`);
    }
  }
  if (value.members !== undefined) {
    assertStringArray(value.members, `${label}.members`);
  }
  if (value.analyzeModes !== undefined) {
    assertStringArray(value.analyzeModes, `${label}.analyzeModes`);
  }
  if (value.tables !== undefined) {
    if (!Array.isArray(value.tables)) {
      failValidation(`${label}.tables must be an array`);
    }
    value.tables.forEach((entry, index) => validateWorkflowTableConfig(entry, `${label}.tables[${index}]`));
  }
  if (value.impact !== undefined) {
    if (!Array.isArray(value.impact)) {
      failValidation(`${label}.impact must be an array`);
    }
    value.impact.forEach((entry, index) => validateWorkflowImpactConfig(entry, `${label}.impact[${index}]`));
  }
  if (value.continueOnError !== undefined && typeof value.continueOnError !== 'boolean') {
    failValidation(`${label}.continueOnError must be a boolean`);
  }
}

function validateWorkflowPresetCollection(value, label) {
  if (!isPlainObject(value)) {
    failValidation(`${label} must be an object`);
  }
  for (const [key, preset] of Object.entries(value)) {
    validateWorkflowPresetDefinition(preset, `${label}.${key}`);
  }
}

function validateWorkflowConfig(value, label) {
  if (!isPlainObject(value)) {
    failValidation(`${label} must be an object`);
  }
  assertOptionalString(value.outputRoot, `${label}.outputRoot`);
  assertOptionalString(value.defaultPreset, `${label}.defaultPreset`);
  if (value.members !== undefined) {
    assertStringArray(value.members, `${label}.members`);
  }
  if (value.analyzeModes !== undefined) {
    assertStringArray(value.analyzeModes, `${label}.analyzeModes`);
  }
  if (value.tables !== undefined) {
    if (!Array.isArray(value.tables)) {
      failValidation(`${label}.tables must be an array`);
    }
    value.tables.forEach((entry, index) => validateWorkflowTableConfig(entry, `${label}.tables[${index}]`));
  }
  if (value.impact !== undefined) {
    if (!Array.isArray(value.impact)) {
      failValidation(`${label}.impact must be an array`);
    }
    value.impact.forEach((entry, index) => validateWorkflowImpactConfig(entry, `${label}.impact[${index}]`));
  }
  if (value.continueOnError !== undefined && typeof value.continueOnError !== 'boolean') {
    failValidation(`${label}.continueOnError must be a boolean`);
  }
  if (value.presets !== undefined) {
    validateWorkflowPresetCollection(value.presets, `${label}.presets`);
  }
}

function validateNamedProfile(profile, label) {
  if (!isPlainObject(profile)) {
    failValidation(`${label} must be an object`);
  }
  assertOptionalStringOrStringArray(profile.extends, `${label}.extends`);
  assertOptionalString(profile.sourceRoot, `${label}.sourceRoot`);
  assertOptionalString(profile.outputRoot, `${label}.outputRoot`);
  if (profile.extensions !== undefined) {
    assertStringArray(profile.extensions, `${label}.extensions`);
  }
  if (profile.contextOptimizer !== undefined) {
    validateContextOptimizerConfig(profile.contextOptimizer, `${label}.contextOptimizer`);
  }
  if (profile.analysisLimits !== undefined) {
    validateAnalysisLimitsConfig(profile.analysisLimits, `${label}.analysisLimits`);
  }
  if (profile.testData !== undefined) {
    validateTestDataConfig(profile.testData, `${label}.testData`);
  }
  if (profile.db !== undefined) {
    validateDbConfig(profile.db, `${label}.db`);
  }
  if (profile.dbRoles !== undefined) {
    validateDbRoleConfig(profile.dbRoles, `${label}.dbRoles`);
  }
  if (profile.fetch !== undefined) {
    validateFetchProfile(profile.fetch, `${label}.fetch`);
  }
  if (profile.workCopy !== undefined) {
    validateWorkCopyConfig(profile.workCopy, `${label}.workCopy`);
  }
  if (profile.tokenBudget !== undefined) {
    validateTokenBudgetConfig(profile.tokenBudget, `${label}.tokenBudget`);
  }
  if (profile.workflow !== undefined) {
    validateWorkflowConfig(profile.workflow, `${label}.workflow`);
  }
  if (profile.presets !== undefined) {
    validateWorkflowPresetCollection(profile.presets, `${label}.presets`);
  }
}

function validateProfiles(profiles) {
  if (!isPlainObject(profiles)) {
    failValidation('profiles root must be an object');
  }

  if (profiles.contextOptimizer !== undefined) {
    validateContextOptimizerConfig(profiles.contextOptimizer, 'contextOptimizer');
  }
  if (profiles.testData !== undefined) {
    validateTestDataConfig(profiles.testData, 'testData');
  }
  if (profiles.analysisLimits !== undefined) {
    validateAnalysisLimitsConfig(profiles.analysisLimits, 'analysisLimits');
  }
  if (profiles.presets !== undefined) {
    validateWorkflowPresetCollection(profiles.presets, 'presets');
  }

  for (const [key, value] of Object.entries(profiles)) {
    if (GLOBAL_PROFILE_KEYS.has(key)) continue;
    validateNamedProfile(value, `profile "${key}"`);
  }
}

function validateAnalyzeConfig(config) {
  if (config.sourceRoot !== undefined && config.sourceRoot !== null && typeof config.sourceRoot !== 'string') {
    failValidation('analyze.sourceRoot must be a string');
  }
  assertOptionalString(config.outputRoot, 'analyze.outputRoot');
  assertStringArray(config.extensions, 'analyze.extensions');
  if (config.ibmi !== null && config.ibmi !== undefined) {
    assertOptionalString(config.ibmi.host, 'analyze.ibmi.host');
    assertOptionalString(config.ibmi.user, 'analyze.ibmi.user');
    assertOptionalString(config.ibmi.password, 'analyze.ibmi.password');
  }
  if (config.contextOptimizer) {
    validateContextOptimizerConfig(config.contextOptimizer, 'analyze.contextOptimizer');
  }
  if (config.analysisLimits) {
    validateAnalysisLimitsConfig(config.analysisLimits, 'analyze.analysisLimits');
  }
  if (config.testData) {
    validateTestDataConfig(config.testData, 'analyze.testData');
  }
  if (config.db !== null && config.db !== undefined) {
    validateDbConfig(config.db, 'analyze.db');
  }
  if (config.dbRoles && typeof config.dbRoles === 'object') {
    validateDbRoleConfig(config.dbRoles, 'analyze.dbRoles');
  }
}

function validateFetchConfig(config) {
  assertOptionalString(config.host, 'fetch.host');
  assertOptionalString(config.user, 'fetch.user');
  assertOptionalString(config.password, 'fetch.password');
  assertOptionalString(config.sourceLib, 'fetch.sourceLib');
  assertOptionalString(config.ifsDir, 'fetch.ifsDir');
  assertOptionalString(config.out, 'fetch.out');
  assertStringArray(config.files, 'fetch.files');
  assertStringArray(config.members, 'fetch.members');
  if (typeof config.replace !== 'boolean') {
    failValidation('fetch.replace must be a boolean');
  }
  assertPositiveInteger(config.streamFileCcsid, 'fetch.streamFileCcsid');
  assertOptionalString(config.transport, 'fetch.transport');
  if (!ALLOWED_FETCH_TRANSPORTS.has(config.transport)) {
    failValidation('fetch.transport must be one of: auto, sftp, jt400, ftp');
  }
}

function validateBundleConfig(config) {
  assertOptionalString(config.sourceOutputRoot, 'bundle.sourceOutputRoot');
  assertOptionalString(config.bundleOutputRoot, 'bundle.bundleOutputRoot');
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === true) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
}

function parseCsv(value, fallback, transform = (item) => item) {
  if (!value) return fallback;
  if (Array.isArray(value)) {
    return value.map((item) => transform(String(item).trim())).filter(Boolean);
  }
  return String(value)
    .split(',')
    .map((item) => transform(item.trim()))
    .filter(Boolean);
}

function mergeConfigLayers(baseValue, overrideValue) {
  if (overrideValue === undefined) {
    if (Array.isArray(baseValue)) return [...baseValue];
    if (isPlainObject(baseValue)) {
      return Object.fromEntries(Object.entries(baseValue).map(([key, value]) => [key, mergeConfigLayers(value, undefined)]));
    }
    return baseValue;
  }

  if (Array.isArray(overrideValue)) {
    return [...overrideValue];
  }

  if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
    const keys = new Set([...Object.keys(baseValue), ...Object.keys(overrideValue)]);
    const merged = {};
    for (const key of keys) {
      merged[key] = mergeConfigLayers(baseValue[key], overrideValue[key]);
    }
    return merged;
  }

  if (isPlainObject(overrideValue)) {
    return Object.fromEntries(Object.entries(overrideValue).map(([key, value]) => [key, mergeConfigLayers(undefined, value)]));
  }

  return overrideValue;
}

function resolveEnvPlaceholdersDeep(value, env) {
  if (typeof value === 'string') {
    return value.replace(/\$\{env:([A-Z0-9_]+)\}/gi, (_, key) => {
      const envValue = env[key];
      return envValue === undefined || envValue === null ? '' : String(envValue);
    });
  }
  if (Array.isArray(value)) {
    return value.map((entry) => resolveEnvPlaceholdersDeep(entry, env));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, resolveEnvPlaceholdersDeep(entry, env)]),
    );
  }
  return value;
}

function attachProfilesMetadata(profiles, metadata) {
  Object.defineProperty(profiles, PROFILES_METADATA_KEY, {
    value: metadata,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return profiles;
}

function getProfilesMetadata(profiles) {
  if (!profiles || typeof profiles !== 'object') {
    return null;
  }
  return profiles[PROFILES_METADATA_KEY] || null;
}

function resolveProfilesConfigPaths({ args = {}, cwd = process.cwd(), env = process.env } = {}) {
  const cliConfig = args && args.config !== undefined && args.config !== null && args.config !== true
    ? String(args.config).trim()
    : '';
  const envConfig = env.ZEUS_CONFIG_DIR ? String(env.ZEUS_CONFIG_DIR).trim() : '';
  const rawLocation = cliConfig || envConfig;
  const source = cliConfig
    ? 'cli'
    : (envConfig ? 'env' : 'default');
  const explicitLocation = source !== 'default';
  const resolvedLocation = rawLocation
    ? path.resolve(cwd, rawLocation)
    : path.resolve(cwd, 'config');
  const looksLikeJsonFile = resolvedLocation.toLowerCase().endsWith('.json');

  if (looksLikeJsonFile) {
    return {
      source,
      explicitLocation,
      configDir: path.dirname(resolvedLocation),
      preferredPath: resolvedLocation,
      fallbackPath: null,
      attemptedPaths: [resolvedLocation],
      description: resolvedLocation,
    };
  }

  const preferredPath = path.join(resolvedLocation, 'profiles.json');
  const fallbackPath = path.join(resolvedLocation, 'profiles.example.json');
  return {
    source,
    explicitLocation,
    configDir: resolvedLocation,
    preferredPath,
    fallbackPath,
    attemptedPaths: explicitLocation
      ? [preferredPath, fallbackPath]
      : [preferredPath, fallbackPath],
    description: resolvedLocation,
  };
}

function loadProfiles({ cwd = process.cwd(), env = process.env, args = {}, fsModule = fs } = {}) {
  const configPaths = resolveProfilesConfigPaths({ args, cwd, env });
  const candidatePaths = [configPaths.preferredPath, configPaths.fallbackPath].filter(Boolean);
  const profilePath = candidatePaths.find((candidate) => fsModule.existsSync(candidate)) || null;

  if (!profilePath) {
    return attachProfilesMetadata({}, {
      ...configPaths,
      profilePath: null,
      sourceFileLabel: candidatePaths.join(' or '),
    });
  }

  try {
    const raw = fsModule.readFileSync(profilePath, 'utf8');
    const parsed = JSON.parse(raw);
    const profiles = parsed && typeof parsed === 'object' ? parsed : {};
    validateProfiles(profiles);
    return attachProfilesMetadata(profiles, {
      ...configPaths,
      profilePath,
      sourceFileLabel: profilePath,
    });
  } catch (error) {
    throw new Error(`Failed to load profiles from ${profilePath}: ${error.message}`);
  }
}

function describeProfilesLocation(profiles) {
  const metadata = getProfilesMetadata(profiles);
  if (!metadata) {
    return 'config/profiles.json or config/profiles.example.json';
  }
  if (metadata.profilePath) {
    return metadata.profilePath;
  }
  return (metadata.attemptedPaths || []).join(' or ') || metadata.description || 'config/profiles.json';
}

function resolveProfile(profiles, profileName, options = {}) {
  const { env = process.env, stack = [] } = options;
  if (!profileName) {
    return null;
  }

  if (stack.includes(profileName)) {
    throw new Error(`Profile "${profileName}" has a cyclic inheritance chain: ${[...stack, profileName].join(' -> ')}`);
  }

  const profile = profiles[profileName];
  if (!profile || GLOBAL_PROFILE_KEYS.has(profileName)) {
    throw new Error(`Profile "${profileName}" not found in ${describeProfilesLocation(profiles)}`);
  }

  const parents = normalizeExtendsList(profile.extends);
  const inherited = parents.reduce((merged, parentName) => mergeConfigLayers(
    merged,
    resolveProfile(profiles, parentName, {
      env,
      stack: [...stack, profileName],
    }),
  ), {});
  const resolved = mergeConfigLayers(inherited, profile);
  delete resolved.extends;
  return resolveEnvPlaceholdersDeep(resolved, env);
}

function readWorkCopyConfig(profile, env) {
  const profileConfig = profile && typeof profile.workCopy === 'object'
    ? resolveEnvPlaceholdersDeep(profile.workCopy, env)
    : {};

  return {
    root: profileConfig.root || DEFAULT_WORK_COPY.root,
    extension: String(profileConfig.extension || DEFAULT_WORK_COPY.extension).trim().toLowerCase(),
  };
}

function readTokenBudgetConfig(profile, env) {
  const profileConfig = profile && typeof profile.tokenBudget === 'object'
    ? resolveEnvPlaceholdersDeep(profile.tokenBudget, env)
    : {};
  const resolved = {};

  for (const [key, value] of Object.entries(profileConfig)) {
    const normalizedKey = normalizeTokenBudgetKey(key);
    if (!normalizedKey) {
      continue;
    }
    resolved[normalizedKey] = Number(value);
  }

  return resolved;
}

function normalizeWorkflowStepList(steps) {
  return Array.from(new Set((steps || [])
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean)))
    .filter((entry) => ALLOWED_WORKFLOW_STEPS.has(entry));
}

function normalizeWorkflowMemberList(values) {
  return Array.from(new Set((values || [])
    .map((entry) => String(entry || '').trim().toUpperCase())
    .filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

function normalizeWorkflowAnalyzeModes(values) {
  const normalized = Array.from(new Set((values || [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)));
  return normalized.length > 0 ? normalized : [...DEFAULT_WORKFLOW_ANALYZE_MODES];
}

function normalizeWorkflowTables(values) {
  return (Array.isArray(values) ? values : [])
    .map((entry) => ({
      schema: entry && entry.schema ? String(entry.schema).trim().toUpperCase() : '',
      table: entry && entry.table ? String(entry.table).trim().toUpperCase() : '',
      filter: entry && entry.filter ? String(entry.filter).trim().toUpperCase() : '',
    }))
    .filter((entry) => entry.table);
}

function normalizeWorkflowImpact(values) {
  return (Array.isArray(values) ? values : [])
    .map((entry) => ({
      target: entry && entry.target ? String(entry.target).trim().toUpperCase() : '',
      field: entry && entry.field ? String(entry.field).trim().toUpperCase() : '',
      program: entry && entry.program ? String(entry.program).trim().toUpperCase() : '',
      member: entry && entry.member ? String(entry.member).trim().toUpperCase() : '',
    }))
    .filter((entry) => entry.target || entry.field);
}

function normalizeWorkflowPresetMap(value) {
  if (!isPlainObject(value)) {
    return {};
  }
  const entries = Object.entries(value).map(([name, preset]) => {
    const normalizedName = String(name || '').trim();
    return [normalizedName, {
      name: normalizedName,
      steps: normalizeWorkflowStepList(preset && preset.steps),
      members: normalizeWorkflowMemberList(preset && preset.members),
      analyzeModes: normalizeWorkflowAnalyzeModes(preset && preset.analyzeModes),
      tables: normalizeWorkflowTables(preset && preset.tables),
      impact: normalizeWorkflowImpact(preset && preset.impact),
      continueOnError: Boolean(preset && preset.continueOnError),
    }];
  });
  return Object.fromEntries(entries.filter(([name, preset]) => name && preset.steps.length > 0));
}

function readWorkflowConfig(profiles, profile, env) {
  const globalPresets = profiles && typeof profiles.presets === 'object'
    ? resolveEnvPlaceholdersDeep(profiles.presets, env)
    : {};
  const profilePresets = profile && typeof profile.presets === 'object'
    ? resolveEnvPlaceholdersDeep(profile.presets, env)
    : {};
  const workflowConfig = profile && typeof profile.workflow === 'object'
    ? resolveEnvPlaceholdersDeep(profile.workflow, env)
    : {};
  const workflowPresets = workflowConfig && typeof workflowConfig.presets === 'object'
    ? workflowConfig.presets
    : {};

  return {
    outputRoot: workflowConfig.outputRoot || (profile && profile.outputRoot) || 'analysis',
    defaultPreset: String(workflowConfig.defaultPreset || '').trim(),
    continueOnError: Boolean(workflowConfig.continueOnError),
    members: normalizeWorkflowMemberList(workflowConfig.members),
    analyzeModes: normalizeWorkflowAnalyzeModes(workflowConfig.analyzeModes),
    tables: normalizeWorkflowTables(workflowConfig.tables),
    impact: normalizeWorkflowImpact(workflowConfig.impact),
    presets: normalizeWorkflowPresetMap(mergeConfigLayers(
      mergeConfigLayers(globalPresets, profilePresets),
      workflowPresets,
    )),
  };
}

function resolveWorkflowPresetConfig(profiles, profile, presetName, env = process.env) {
  const workflowConfig = readWorkflowConfig(profiles, profile, env);
  if (!presetName) {
    return null;
  }
  const key = String(presetName).trim();
  const preset = workflowConfig.presets[key];
  if (!preset) {
    throw new Error(`Workflow preset "${presetName}" not found in ${describeProfilesLocation(profiles)}`);
  }
  return preset;
}

function readContextOptimizerConfig(profiles, profile, env) {
  const globalConfig = profiles && typeof profiles.contextOptimizer === 'object'
    ? resolveEnvPlaceholdersDeep(profiles.contextOptimizer, env)
    : {};
  const profileConfig = profile && typeof profile.contextOptimizer === 'object'
    ? resolveEnvPlaceholdersDeep(profile.contextOptimizer, env)
    : {};

  return {
    ...DEFAULT_CONTEXT_OPTIMIZER_OPTIONS,
    ...globalConfig,
    ...profileConfig,
    workflowTokenBudgets: {
      ...(DEFAULT_CONTEXT_OPTIMIZER_OPTIONS.workflowTokenBudgets || {}),
      ...((globalConfig && globalConfig.workflowTokenBudgets) || {}),
      ...((profileConfig && profileConfig.workflowTokenBudgets) || {}),
    },
  };
}

function readAnalysisLimitConfig(profiles, profile, env) {
  const globalConfig = profiles && typeof profiles.analysisLimits === 'object'
    ? resolveEnvPlaceholdersDeep(profiles.analysisLimits, env)
    : {};
  const profileConfig = profile && typeof profile.analysisLimits === 'object'
    ? resolveEnvPlaceholdersDeep(profile.analysisLimits, env)
    : {};

  return {
    ...DEFAULT_ANALYSIS_LIMITS,
    ...globalConfig,
    ...profileConfig,
  };
}

function readTestDataConfig(profiles, profile, env) {
  const globalConfig = profiles && typeof profiles.testData === 'object'
    ? resolveEnvPlaceholdersDeep(profiles.testData, env)
    : {};
  const profileConfig = profile && typeof profile.testData === 'object'
    ? resolveEnvPlaceholdersDeep(profile.testData, env)
    : {};

  return {
    limit: DEFAULT_TEST_DATA_LIMIT,
    maskColumns: [],
    allowTables: [],
    denyTables: [],
    maskRules: [],
    ...globalConfig,
    ...profileConfig,
  };
}

function applyDbEnvOverrides(dbConfig, env, prefix = 'ZEUS_DB') {
  const merged = { ...(dbConfig || {}) };
  const schemaOverride = env[`${prefix}_DEFAULT_SCHEMA`] || env[`${prefix}_DEFAULT_LIBRARY`] || env[`${prefix}_SCHEMA`] || env[`${prefix}_LIBRARY`];

  if (env[`${prefix}_HOST`]) merged.host = env[`${prefix}_HOST`];
  if (env[`${prefix}_URL`]) merged.url = env[`${prefix}_URL`];
  if (env[`${prefix}_USER`]) merged.user = env[`${prefix}_USER`];
  if (env[`${prefix}_PASSWORD`] !== undefined) merged.password = env[`${prefix}_PASSWORD`];
  if (schemaOverride) merged.defaultSchema = schemaOverride;

  return Object.keys(merged).length > 0 ? merged : null;
}

function resolveAnalyzeDbRoleConfigs(profile, env) {
  const baseDbConfig = applyDbEnvOverrides(
    profile && profile.db ? resolveEnvPlaceholdersDeep(profile.db, env) : null,
    env,
    'ZEUS_DB',
  );
  const roleConfigs = profile && profile.dbRoles ? resolveEnvPlaceholdersDeep(profile.dbRoles, env) : {};
  const metadataDb = applyDbEnvOverrides(
    mergeConfigLayers(baseDbConfig || {}, roleConfigs && roleConfigs.metadata ? roleConfigs.metadata : undefined),
    env,
    'ZEUS_METADATA_DB',
  );
  const testDataDb = applyDbEnvOverrides(
    mergeConfigLayers(metadataDb || baseDbConfig || {}, roleConfigs && roleConfigs.testData ? roleConfigs.testData : undefined),
    env,
    'ZEUS_TESTDATA_DB',
  );

  return {
    metadata: metadataDb,
    testData: testDataDb,
  };
}

function buildAnalyzeConnectionRoles(profile, analyzeDbRoles) {
  const hasFetchProfile = Boolean(profile && profile.fetch);
  return {
    source: {
      kind: hasFetchProfile ? 'fetch' : 'local',
      profileKey: hasFetchProfile ? 'fetch' : 'sourceRoot',
    },
    metadata: {
      kind: 'db2',
      profileKey: profile && profile.dbRoles && profile.dbRoles.metadata ? 'dbRoles.metadata' : 'db',
      dbConfig: analyzeDbRoles.metadata,
    },
    testData: {
      kind: 'db2',
      profileKey: profile && profile.dbRoles && profile.dbRoles.testData
        ? 'dbRoles.testData'
        : (profile && profile.dbRoles && profile.dbRoles.metadata ? 'dbRoles.metadata' : 'db'),
      dbConfig: analyzeDbRoles.testData,
    },
  };
}

function resolveAnalyzeDbConfig(config, role = 'metadata') {
  if (!config || typeof config !== 'object') {
    return null;
  }
  if (role === 'testData' && config.dbRoles && config.dbRoles.testData) {
    return config.dbRoles.testData;
  }
  if (config.dbRoles && config.dbRoles.metadata) {
    return config.dbRoles.metadata;
  }
  return config.db || null;
}

function resolveAnalyzeConfig(args, { cwd = process.cwd(), env = process.env } = {}) {
  const profiles = loadProfiles({ cwd, env, args });
  const profile = resolveProfile(profiles, args.profile, { env });
  const fetchProfile = profile ? (profile.fetch || {}) : {};
  const analyzeDbRoles = resolveAnalyzeDbRoleConfigs(profile, env);

  const extensions = args.extensions
    ? parseCsv(args.extensions, DEFAULT_EXTENSIONS)
    : ((profile && profile.extensions) || DEFAULT_EXTENSIONS);

  const resolved = {
    sourceRoot: args.source || (profile && profile.sourceRoot),
    outputRoot: args.out || args.output || (profile && profile.outputRoot) || 'output',
    extensions,
    db: analyzeDbRoles.metadata,
    dbRoles: analyzeDbRoles,
    connections: buildAnalyzeConnectionRoles(profile, analyzeDbRoles),
    ibmi: {
      host: args.host || env.ZEUS_FETCH_HOST || fetchProfile.host || null,
      user: args.user || env.ZEUS_FETCH_USER || fetchProfile.user || null,
      password: args.password || env.ZEUS_FETCH_PASSWORD || fetchProfile.password || null,
    },
    contextOptimizer: readContextOptimizerConfig(profiles, profile, env),
    analysisLimits: readAnalysisLimitConfig(profiles, profile, env),
    testData: readTestDataConfig(profiles, profile, env),
    tokenBudget: readTokenBudgetConfig(profile, env),
  };
  validateAnalyzeConfig(resolved);
  return resolved;
}

function resolveFetchConfig(args, { cwd = process.cwd(), env = process.env } = {}) {
  const profiles = loadProfiles({ cwd, env, args });
  const profile = resolveProfile(profiles, args.profile, { env });
  const fetchProfile = profile ? resolveEnvPlaceholdersDeep(profile.fetch || profile, env) : {};

  const resolved = {
    host: args.host || env.ZEUS_FETCH_HOST || fetchProfile.host,
    user: args.user || env.ZEUS_FETCH_USER || fetchProfile.user,
    password: args.password || env.ZEUS_FETCH_PASSWORD || fetchProfile.password,
    sourceLib: String(args['source-lib'] || env.ZEUS_FETCH_SOURCE_LIB || fetchProfile.sourceLib || '').toUpperCase(),
    ifsDir: args['ifs-dir'] || env.ZEUS_FETCH_IFS_DIR || fetchProfile.ifsDir,
    out: args.out || env.ZEUS_FETCH_OUT || fetchProfile.out || './rpg_sources',
    files: parseCsv(args.files || env.ZEUS_FETCH_FILES || fetchProfile.files, [...DEFAULT_SOURCE_FILES], (item) => item.toUpperCase()),
    members: parseCsv(args.members || env.ZEUS_FETCH_MEMBERS || fetchProfile.members, [], (item) => item.toUpperCase()),
    replace: parseBoolean(
      args.replace !== undefined ? args.replace : (env.ZEUS_FETCH_REPLACE !== undefined ? env.ZEUS_FETCH_REPLACE : fetchProfile.replace),
      true,
    ),
    streamFileCcsid: Number.parseInt(
      String(
        args['streamfile-ccsid']
        || env.ZEUS_FETCH_STREAMFILE_CCSID
        || fetchProfile.streamFileCcsid
        || DEFAULT_STREAM_FILE_CCSID,
      ).trim(),
      10,
    ),
    transport: String(args.transport || env.ZEUS_FETCH_TRANSPORT || fetchProfile.transport || DEFAULT_TRANSPORT).toLowerCase(),
  };
  validateFetchConfig(resolved);
  return resolved;
}

function resolveBundleConfig(args, { cwd = process.cwd(), env = process.env } = {}) {
  const profiles = loadProfiles({ cwd, env, args });
  const profile = resolveProfile(profiles, args.profile, { env });

  const resolved = {
    sourceOutputRoot: args['source-output-root'] || (profile && profile.outputRoot) || 'output',
    bundleOutputRoot: args.output || args.out || 'bundles',
  };
  validateBundleConfig(resolved);
  return resolved;
}

module.exports = {
  DEFAULT_EXTENSIONS,
  ALLOWED_FETCH_TRANSPORTS,
  ALLOWED_WORK_COPY_EXTENSIONS,
  ALLOWED_WORKFLOW_STEPS,
  DEFAULT_ANALYSIS_LIMITS,
  DEFAULT_TOKEN_BUDGET,
  DEFAULT_WORK_COPY,
  DEFAULT_WORKFLOW_ANALYZE_MODES,
  DEFAULT_WORKFLOW_STEPS,
  describeProfilesLocation,
  getProfilesMetadata,
  loadProfiles,
  normalizeTokenBudgetKey,
  resolveAnalyzeDbConfig,
  readWorkflowConfig,
  readTokenBudgetConfig,
  readWorkCopyConfig,
  resolveAnalyzeConfig,
  resolveBundleConfig,
  resolveFetchConfig,
  resolveWorkflowPresetConfig,
  resolveProfilesConfigPaths,
  resolveProfile,
  validateProfiles,
};
