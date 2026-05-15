/*
Copyright 2026 Zeus PromptKit Contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
const { DEFAULT_TEST_DATA_LIMIT } = require('../db2/testDataExportService');
const { DEFAULT_CONTEXT_OPTIMIZER_OPTIONS } = require('../ai/contextOptimizer');
const { DEFAULT_SOURCE_FILES, DEFAULT_TRANSPORT } = require('../fetch/fetchService');
const { DEFAULT_STREAM_FILE_CCSID } = require('../fetch/ifsExporter');
const { DEFAULT_ANALYSIS_LIMITS } = require('../analyze/analysisLimits');
const {
  ALLOWED_BRIDGE_MODES,
  ALLOWED_FETCH_TRANSPORTS,
  ALLOWED_WORKFLOW_STEPS,
  ALLOWED_WORK_COPY_EXTENSIONS,
  DEFAULT_EXTENSIONS,
  DEFAULT_TOKEN_BUDGET,
  DEFAULT_WORKFLOW_ANALYZE_MODES,
  DEFAULT_WORKFLOW_STEPS,
  DEFAULT_WORK_COPY,
  GLOBAL_PROFILE_KEYS,
  TOKEN_BUDGET_KEY_ALIASES,
} = require('./runtimeConfigDefaults');
const {
  validateAnalyzeConfig,
  validateBundleConfig,
  validateFetchConfig,
  validateProfiles: validateProfilesConfig,
} = require('./runtimeConfigValidation');
const {
  describeProfilesLocation,
  getProfilesMetadata,
  loadProfiles: loadProfilesWithMetadata,
  resolveProfilesConfigPaths,
} = require('./runtimeConfigProfiles');
const {
  readWorkflowConfig: readWorkflowConfigModule,
  resolveWorkflowPresetConfig: resolveWorkflowPresetConfigModule,
} = require('./runtimeConfigWorkflow');
const { mergeConfigLayers } = require('./runtimeConfigCore');
const {
  applyDbEnvOverrides,
  parseBoolean,
  parseCsv,
  resolveEnvPlaceholdersDeep,
} = require('./runtimeConfigEnv');
const {
  buildAnalyzeConnectionRoles: buildAnalyzeConnectionRolesModule,
  resolveAnalyzeConfig: resolveAnalyzeConfigModule,
  resolveAnalyzeDbConfig: resolveAnalyzeDbConfigModule,
  resolveAnalyzeDbRoleConfigs: resolveAnalyzeDbRoleConfigsModule,
  resolveBundleConfig: resolveBundleConfigModule,
  resolveFetchConfig: resolveFetchConfigModule,
} = require('./runtimeConfigResolver');

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

function loadProfiles(options = {}) {
  return loadProfilesWithMetadata({
    ...options,
    mergeConfigLayers,
    validateProfiles: validateProfilesConfig,
  });
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

function readWorkflowConfig(profiles, profile, env) {
  return readWorkflowConfigModule(profiles, profile, env, {
    mergeConfigLayers,
    resolveEnvPlaceholdersDeep,
  });
}

function resolveWorkflowPresetConfig(profiles, profile, presetName, env = process.env) {
  return resolveWorkflowPresetConfigModule(profiles, profile, presetName, env, {
    readWorkflowConfig,
    describeProfilesLocation,
  });
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

function isEnvPlaceholder(value) {
  return typeof value === 'string' && /^\$\{env:[^}]+\}$/.test(value.trim());
}

function resolveAnalyzeDbRoleConfigs(profile, env) {
  return resolveAnalyzeDbRoleConfigsModule(profile, env, {
    applyDbEnvOverrides,
    mergeConfigLayers,
    resolveEnvPlaceholdersDeep,
  });
}

function buildAnalyzeConnectionRoles(profile, analyzeDbRoles) {
  return buildAnalyzeConnectionRolesModule(profile, analyzeDbRoles);
}

function resolveAnalyzeDbConfig(config, role = 'metadata') {
  return resolveAnalyzeDbConfigModule(config, role);
}

function resolveAnalyzeConfig(args, { cwd = process.cwd(), env = process.env } = {}) {
  return resolveAnalyzeConfigModule(args, { cwd, env }, {
    DEFAULT_EXTENSIONS,
    buildAnalyzeConnectionRoles,
    loadProfiles,
    parseCsv,
    readAnalysisLimitConfig,
    readContextOptimizerConfig,
    readTestDataConfig,
    readTokenBudgetConfig,
    resolveAnalyzeDbRoleConfigs,
    resolveProfile,
    validateAnalyzeConfig,
  });
}

function resolveFetchConfig(args, { cwd = process.cwd(), env = process.env } = {}) {
  return resolveFetchConfigModule(args, { cwd, env }, {
    DEFAULT_SOURCE_FILES,
    DEFAULT_STREAM_FILE_CCSID,
    DEFAULT_TRANSPORT,
    loadProfiles,
    parseBoolean,
    parseCsv,
    resolveEnvPlaceholdersDeep,
    resolveProfile,
    validateFetchConfig,
  });
}

function resolveBundleConfig(args, { cwd = process.cwd(), env = process.env } = {}) {
  return resolveBundleConfigModule(args, { cwd, env }, {
    loadProfiles,
    resolveProfile,
    validateBundleConfig,
  });
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
  validateProfiles: validateProfilesConfig,
};
