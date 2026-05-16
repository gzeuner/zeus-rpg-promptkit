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
function resolveAnalyzeDbRoleConfigs(
  profile,
  env,
  {
    applyDbEnvOverrides,
    mergeConfigLayers,
    resolveEnvPlaceholdersDeep,
  } = {},
) {
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

function resolveAnalyzeConfig(
  args,
  { cwd = process.cwd(), env = process.env } = {},
  {
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
  } = {},
) {
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

function resolveFetchConfig(
  args,
  { cwd = process.cwd(), env = process.env } = {},
  {
    DEFAULT_SOURCE_FILES,
    DEFAULT_STREAM_FILE_CCSID,
    DEFAULT_TRANSPORT,
    loadProfiles,
    parseBoolean,
    parseCsv,
    resolveEnvPlaceholdersDeep,
    resolveProfile,
    validateFetchConfig,
  } = {},
) {
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

function resolveBundleConfig(
  args,
  { cwd = process.cwd(), env = process.env } = {},
  {
    loadProfiles,
    resolveProfile,
    validateBundleConfig,
  } = {},
) {
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
  buildAnalyzeConnectionRoles,
  resolveAnalyzeConfig,
  resolveAnalyzeDbConfig,
  resolveAnalyzeDbRoleConfigs,
  resolveBundleConfig,
  resolveFetchConfig,
};
