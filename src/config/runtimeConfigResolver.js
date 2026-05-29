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

  // Auflösungsreihenfolge für sourceLib verfolgen, damit beim Überschreiben durch
  // eine ENV-Variable eine Warnung ausgegeben werden kann.
  const cliSourceLib = args['source-library'] || args['source-lib'];
  const envSourceLib = env.ZEUS_FETCH_SOURCE_LIBRARY || env.ZEUS_FETCH_SOURCE_LIB;
  const profileSourceLib = fetchProfile.sourceLibrary || fetchProfile.sourceLib;
  const sourceLibrary = cliSourceLib || envSourceLib || profileSourceLib;

  // Wenn ENV-Variable das Profil überschreibt (und kein CLI-Arg gesetzt), Warnung merken.
  // fetchCommand.js greift auf config.sourceLibEnvOverride zu und zeigt den Hinweis an.
  const sourceLibEnvOverride = (
    !cliSourceLib
    && envSourceLib
    && profileSourceLib
    && String(envSourceLib).toUpperCase() !== String(profileSourceLib).toUpperCase()
  )
    ? { envValue: String(envSourceLib).toUpperCase(), profileValue: String(profileSourceLib).toUpperCase() }
    : null;

  const sourceFiles = args['source-files']
    || args.files
    || env.ZEUS_FETCH_SOURCE_FILES
    || env.ZEUS_FETCH_FILES
    || fetchProfile.sourceFiles
    || fetchProfile.files;

  const resolved = {
    host: args.host || env.ZEUS_FETCH_HOST || fetchProfile.host,
    user: args.user || env.ZEUS_FETCH_USER || fetchProfile.user,
    password: args.password || env.ZEUS_FETCH_PASSWORD || fetchProfile.password,
    sourceLib: String(sourceLibrary || '').toUpperCase(),
    sourceLibrary: String(sourceLibrary || '').toUpperCase(),
    sourceLibEnvOverride,
    ifsDir: args['ifs-dir'] || env.ZEUS_FETCH_IFS_DIR || fetchProfile.ifsDir,
    out: args.out || env.ZEUS_FETCH_OUT || fetchProfile.out || './rpg_sources',
    port: Number.parseInt(
      String(args.port || env.ZEUS_FETCH_PORT || fetchProfile.port || 22).trim(),
      10,
    ),
    files: parseCsv(sourceFiles, [...DEFAULT_SOURCE_FILES], (item) => item.toUpperCase()),
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
    networkType: String(args['network-type'] || env.ZEUS_FETCH_NETWORK_TYPE || fetchProfile.networkType || '').trim().toLowerCase(),
    preferTransport: String(args['prefer-transport'] || env.ZEUS_FETCH_PREFER_TRANSPORT || fetchProfile.preferTransport || '').trim().toLowerCase(),
    diagnoseTransport: parseBoolean(
      args['diagnose-transport'] !== undefined
        ? args['diagnose-transport']
        : (env.ZEUS_FETCH_DIAGNOSE_TRANSPORT !== undefined ? env.ZEUS_FETCH_DIAGNOSE_TRANSPORT : fetchProfile.diagnoseTransport),
      false,
    ),
    encrypted: parseBoolean(
      args.encrypted !== undefined
        ? args.encrypted
        : (env.ZEUS_FETCH_ENCRYPTED !== undefined ? env.ZEUS_FETCH_ENCRYPTED : fetchProfile.encrypted),
      true,
    ),
    transportTimeoutMs: Number.parseInt(
      String(args['transport-timeout-ms'] || env.ZEUS_FETCH_TRANSPORT_TIMEOUT_MS || fetchProfile.transportTimeoutMs || 30000).trim(),
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
