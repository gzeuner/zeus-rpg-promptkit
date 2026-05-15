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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

// rawConfig = original profile config before env-placeholder expansion.
// Env-var overrides always win over profile values (env = deployment-specific, profile = defaults).
// This enables multi-machine setups: e.g. ZEUS_METADATA_DB_HOST=SYS_PROD overrides a profile
// that defaults to SYS_TEST, without changing the profile file.
function applyDbEnvOverrides(dbConfig, env, prefix = 'ZEUS_DB', rawConfig = null) {
  const merged = { ...(dbConfig || {}) };
  const schemaOverride = env[`${prefix}_DEFAULT_SCHEMA`] || env[`${prefix}_DEFAULT_LIBRARY`] || env[`${prefix}_SCHEMA`] || env[`${prefix}_LIBRARY`];

  // Env-vars take precedence over profile values (including literal values).
  // This supports dynamic multi-machine routing at runtime.
  if (env[`${prefix}_HOST`]) merged.host = env[`${prefix}_HOST`];
  if (env[`${prefix}_URL`])  merged.url  = env[`${prefix}_URL`];
  if (env[`${prefix}_USER`]) merged.user = env[`${prefix}_USER`];
  if (env[`${prefix}_PASSWORD`] !== undefined) merged.password = env[`${prefix}_PASSWORD`];
  if (schemaOverride) merged.defaultSchema = schemaOverride;

  return Object.keys(merged).length > 0 ? merged : null;
}

function resolveAnalyzeDbRoleConfigs(profile, env) {
  const rawDb = profile && profile.db ? profile.db : null;
  const baseDbConfig = applyDbEnvOverrides(
    rawDb ? resolveEnvPlaceholdersDeep(rawDb, env) : null,
    env,
    'ZEUS_DB',
    rawDb,
  );
  const rawRoleConfigs = profile && profile.dbRoles ? profile.dbRoles : {};
  const roleConfigs = resolveEnvPlaceholdersDeep(rawRoleConfigs, env);
  const rawMetadata = rawRoleConfigs && rawRoleConfigs.metadata ? rawRoleConfigs.metadata : null;
  const metadataDb = applyDbEnvOverrides(
    mergeConfigLayers(baseDbConfig || {}, roleConfigs && roleConfigs.metadata ? roleConfigs.metadata : undefined),
    env,
    'ZEUS_METADATA_DB',
    rawMetadata || rawDb,
  );
  const rawTestData = rawRoleConfigs && rawRoleConfigs.testData ? rawRoleConfigs.testData : null;
  const testDataDb = applyDbEnvOverrides(
    mergeConfigLayers(metadataDb || baseDbConfig || {}, roleConfigs && roleConfigs.testData ? roleConfigs.testData : undefined),
    env,
    'ZEUS_TESTDATA_DB',
    rawTestData || rawMetadata || rawDb,
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
  const sourceLibrary = args['source-library']
    || args['source-lib']
    || env.ZEUS_FETCH_SOURCE_LIBRARY
    || env.ZEUS_FETCH_SOURCE_LIB
    || fetchProfile.sourceLibrary
    || fetchProfile.sourceLib;
  const sourceFiles = args['source-files']
    || args.files
    || env.ZEUS_FETCH_SOURCE_FILES
    || env.ZEUS_FETCH_FILES
    || fetchProfile.sourceFiles
    || fetchProfile.files;

  const resolved = {
    host: args.host || fetchProfile.host || env.ZEUS_FETCH_HOST,
    user: args.user || fetchProfile.user || env.ZEUS_FETCH_USER,
    password: args.password || env.ZEUS_FETCH_PASSWORD || fetchProfile.password,
    sourceLib: String(sourceLibrary || '').toUpperCase(),
    sourceLibrary: String(sourceLibrary || '').toUpperCase(),
    ifsDir: args['ifs-dir'] || fetchProfile.ifsDir || env.ZEUS_FETCH_IFS_DIR,
    out: args.out || fetchProfile.out || env.ZEUS_FETCH_OUT || './rpg_sources',
    files: parseCsv(sourceFiles, [...DEFAULT_SOURCE_FILES], (item) => item.toUpperCase()),
    members: parseCsv(args.members || fetchProfile.members || env.ZEUS_FETCH_MEMBERS, [], (item) => item.toUpperCase()),
    replace: parseBoolean(
      args.replace !== undefined ? args.replace : (env.ZEUS_FETCH_REPLACE !== undefined ? env.ZEUS_FETCH_REPLACE : fetchProfile.replace),
      true,
    ),
    streamFileCcsid: Number.parseInt(
      String(
        args['streamfile-ccsid']
        || fetchProfile.streamFileCcsid
        || env.ZEUS_FETCH_STREAMFILE_CCSID
        || DEFAULT_STREAM_FILE_CCSID,
      ).trim(),
      10,
    ),
    transport: String(args.transport || fetchProfile.transport || env.ZEUS_FETCH_TRANSPORT || DEFAULT_TRANSPORT).toLowerCase(),
    networkType: String(args['network-type'] || fetchProfile.networkType || env.ZEUS_FETCH_NETWORK_TYPE || '').trim().toLowerCase(),
    preferTransport: String(args['prefer-transport'] || fetchProfile.preferTransport || env.ZEUS_FETCH_PREFER_TRANSPORT || '').trim().toLowerCase(),
    diagnoseTransport: parseBoolean(
      args['diagnose-transport'] !== undefined
        ? args['diagnose-transport']
        : (fetchProfile.diagnoseTransport !== undefined ? fetchProfile.diagnoseTransport : env.ZEUS_FETCH_DIAGNOSE_TRANSPORT),
      false,
    ),
    encrypted: parseBoolean(
      args.encrypted !== undefined
        ? args.encrypted
        : (fetchProfile.encrypted !== undefined ? fetchProfile.encrypted : env.ZEUS_FETCH_ENCRYPTED),
      true,
    ),
    transportTimeoutMs: Number.parseInt(
      String(args['transport-timeout-ms'] || fetchProfile.transportTimeoutMs || env.ZEUS_FETCH_TRANSPORT_TIMEOUT_MS || 30000).trim(),
      10,
    ),
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
  validateProfiles: validateProfilesConfig,
};
