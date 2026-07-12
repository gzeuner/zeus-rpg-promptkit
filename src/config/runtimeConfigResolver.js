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
  attachConnectionTargetMetadata,
  buildConnectionTargetMetadata,
  cloneConnectionTargetMetadata,
  describeConnectionTarget,
  getConnectionTargetMetadata,
  listConnectionTargetNames,
} = require('./connectionTargetMetadata');
const { resolveSecretValue } = require('../security/secretVault');

function selectFetchSystemOverride(profile, rawProfile, systemName) {
  const selectedSystem = String(systemName || '').trim();
  if (!selectedSystem) {
    return {
      config: null,
      rawConfig: null,
      metadata: null,
    };
  }

  const systems =
    profile && profile.systems && typeof profile.systems === 'object' ? profile.systems : {};
  const rawSystems =
    rawProfile && rawProfile.systems && typeof rawProfile.systems === 'object'
      ? rawProfile.systems
      : {};
  const normalizeSystemName = value =>
    String(value || '')
      .trim()
      .toUpperCase();
  const requestedName = normalizeSystemName(selectedSystem);
  const selectedSystemKey = Object.keys(systems).find(key => {
    const candidate = systems[key];
    if (!candidate || typeof candidate !== 'object') {
      return false;
    }
    const acceptedNames = [
      key,
      candidate.systemName,
      ...(Array.isArray(candidate.aliases) ? candidate.aliases : []),
    ]
      .map(normalizeSystemName)
      .filter(Boolean);
    return acceptedNames.includes(requestedName);
  });

  const systemConfig = selectedSystemKey ? systems[selectedSystemKey] : null;
  if (!systemConfig || typeof systemConfig !== 'object') {
    throw new Error(
      `Fetch system "${selectedSystem}" not found in profile systems. ` +
        `Available systems: ${Object.keys(systems).join(', ') || '(none)'}`
    );
  }

  const rawSystemConfig = rawSystems[selectedSystemKey] || systemConfig;
  const {
    displayName: _displayName,
    systemName: _systemName,
    aliases: _aliases,
    resources: _resources,
    ...connectionFields
  } = systemConfig;

  return {
    config: connectionFields,
    rawConfig: rawSystemConfig,
    metadata: buildConnectionTargetMetadata({
      systemKey: selectedSystemKey,
      systemDefinition: systemConfig,
      resolvedConfig: connectionFields,
      source: 'cli-system-override',
    }),
  };
}

function resolveAnalyzeDbRoleConfigs(
  profile,
  env,
  {
    applyDbEnvOverrides,
    getRuntimeConfigMetadata,
    mergeConfigLayers,
    rawProfile = null,
    resolveEnvPlaceholdersDeep,
  } = {}
) {
  const rawDb =
    rawProfile && rawProfile.db ? rawProfile.db : profile && profile.db ? profile.db : null;
  const resolvedDb = rawDb ? resolveEnvPlaceholdersDeep(rawDb, env) : null;
  const rawDbTargetMetadata = getConnectionTargetMetadata(rawDb);
  const baseDbConfig = applyDbEnvOverrides(resolvedDb, env, 'ZEUS_DB', rawDb, {
    scope: 'db',
    mergeConfigLayers,
  });
  attachConnectionTargetMetadata(baseDbConfig, cloneConnectionTargetMetadata(rawDbTargetMetadata));
  const rawRoleConfigs = rawProfile && rawProfile.dbRoles ? rawProfile.dbRoles : {};
  const roleConfigs = resolveEnvPlaceholdersDeep(rawRoleConfigs, env);
  const rawMetadata = rawRoleConfigs && rawRoleConfigs.metadata ? rawRoleConfigs.metadata : null;
  const rawMetadataTargetMetadata = getConnectionTargetMetadata(rawMetadata) || rawDbTargetMetadata;
  const metadataDb = applyDbEnvOverrides(
    mergeConfigLayers(
      baseDbConfig || {},
      roleConfigs && roleConfigs.metadata ? roleConfigs.metadata : undefined
    ),
    env,
    'ZEUS_METADATA_DB',
    rawMetadata,
    {
      baseMetadata: getRuntimeConfigMetadata(baseDbConfig),
      baseConfig: baseDbConfig,
      scope: 'dbRoles.metadata',
      mergeConfigLayers,
    }
  );
  attachConnectionTargetMetadata(
    metadataDb,
    cloneConnectionTargetMetadata(rawMetadataTargetMetadata)
  );
  const rawTestData = rawRoleConfigs && rawRoleConfigs.testData ? rawRoleConfigs.testData : null;
  const rawTestDataTargetMetadata =
    getConnectionTargetMetadata(rawTestData) || rawMetadataTargetMetadata || rawDbTargetMetadata;
  const testDataDb = applyDbEnvOverrides(
    mergeConfigLayers(
      metadataDb || baseDbConfig || {},
      roleConfigs && roleConfigs.testData ? roleConfigs.testData : undefined
    ),
    env,
    'ZEUS_TESTDATA_DB',
    rawTestData,
    {
      baseMetadata: getRuntimeConfigMetadata(metadataDb || baseDbConfig),
      baseConfig: metadataDb || baseDbConfig,
      scope: 'dbRoles.testData',
      mergeConfigLayers,
    }
  );
  attachConnectionTargetMetadata(
    testDataDb,
    cloneConnectionTargetMetadata(rawTestDataTargetMetadata)
  );

  return {
    metadata: metadataDb,
    testData: testDataDb,
  };
}

function buildAnalyzeConnectionRoles(profile, analyzeDbRoles) {
  const hasFetchProfile = Boolean(profile && profile.fetch);
  const fetchTarget = hasFetchProfile ? profile.fetch : null;
  return {
    source: {
      kind: hasFetchProfile ? 'fetch' : 'local',
      profileKey: hasFetchProfile ? 'fetch' : 'sourceRoot',
      target: hasFetchProfile ? describeConnectionTarget(fetchTarget) : 'local workspace',
      acceptedNames: hasFetchProfile ? listConnectionTargetNames(fetchTarget) : [],
    },
    metadata: {
      kind: 'db2',
      profileKey:
        profile && profile.dbRoles && profile.dbRoles.metadata ? 'dbRoles.metadata' : 'db',
      dbConfig: analyzeDbRoles.metadata,
      target: describeConnectionTarget(analyzeDbRoles.metadata),
      acceptedNames: listConnectionTargetNames(analyzeDbRoles.metadata),
    },
    testData: {
      kind: 'db2',
      profileKey:
        profile && profile.dbRoles && profile.dbRoles.testData
          ? 'dbRoles.testData'
          : profile && profile.dbRoles && profile.dbRoles.metadata
            ? 'dbRoles.metadata'
            : 'db',
      dbConfig: analyzeDbRoles.testData,
      target: describeConnectionTarget(analyzeDbRoles.testData),
      acceptedNames: listConnectionTargetNames(analyzeDbRoles.testData),
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

// Uebersteuert defaultSchema/defaultLibrary aller aufgeloesten DB-Rollen mit den
// CLI-Werten (falls gesetzt). Mutiert die uebergebenen Rollen-Objekte in place.
function applyAnalyzeResourceOverrides(analyzeDbRoles, { schema = null, library = null } = {}) {
  if (!analyzeDbRoles || (!schema && !library)) {
    return analyzeDbRoles;
  }
  for (const role of ['metadata', 'testData']) {
    const dbConfig = analyzeDbRoles[role];
    if (dbConfig && typeof dbConfig === 'object') {
      if (schema) {
        dbConfig.defaultSchema = schema;
      }
      if (library) {
        dbConfig.defaultLibrary = library;
      }
    }
  }
  return analyzeDbRoles;
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
  } = {}
) {
  const profiles = loadProfiles({ cwd, env, args });
  const profile = resolveProfile(profiles, args.profile, { env });
  const rawProfile = resolveProfile(profiles, args.profile, {
    env,
    expandEnvPlaceholders: false,
  });
  const fetchProfile = profile ? profile.fetch || {} : {};
  const analyzeDbRoles = resolveAnalyzeDbRoleConfigs(profile, env, { rawProfile });

  const extensions = args.extensions
    ? parseCsv(args.extensions, DEFAULT_EXTENSIONS)
    : (profile && profile.extensions) || DEFAULT_EXTENSIONS;

  // CLI-Overrides fuer Bibliothek/Schema: erlauben, den Profilwert jederzeit gezielt
  // zu uebersteuern (z. B. `analyze --schema DATA_X --library APPLIB`), ohne das
  // Profil zu aendern. args haben Vorrang vor Profil/Env-Werten der DB-Rollen.
  const cliSchema =
    typeof args.schema === 'string' && args.schema.trim() ? args.schema.trim().toUpperCase() : null;
  const cliLibrary =
    typeof args.library === 'string' && args.library.trim()
      ? args.library.trim().toUpperCase()
      : typeof args.lib === 'string' && args.lib.trim()
        ? args.lib.trim().toUpperCase()
        : null;
  applyAnalyzeResourceOverrides(analyzeDbRoles, { schema: cliSchema, library: cliLibrary });

  const resolved = {
    sourceRoot: args.source || args['source-root'] || (profile && profile.sourceRoot),
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
  } = {}
) {
  const profiles = loadProfiles({ cwd, env, args });
  const profile = resolveProfile(profiles, args.profile, { env });
  const rawProfile = resolveProfile(profiles, args.profile, {
    env,
    expandEnvPlaceholders: false,
  });
  const fetchProfile = profile ? resolveEnvPlaceholdersDeep(profile.fetch || profile, env) : {};
  const rawFetchProfile = rawProfile ? rawProfile.fetch || rawProfile : {};
  const fetchSystemOverride = selectFetchSystemOverride(profile, rawProfile, args.system);
  const rawFetchTargetMetadata =
    fetchSystemOverride.metadata || getConnectionTargetMetadata(rawFetchProfile);
  const cliHost = args.host;
  const envHost = env.ZEUS_FETCH_HOST;
  const profileHost =
    (fetchSystemOverride.config && fetchSystemOverride.config.host) || fetchProfile.host;

  // Auflösungsreihenfolge für sourceLib verfolgen, damit beim Überschreiben durch
  // eine ENV-Variable eine Warnung ausgegeben werden kann.
  const cliSourceLib = args['source-library'] || args['source-lib'];
  const envSourceLib = env.ZEUS_FETCH_SOURCE_LIBRARY || env.ZEUS_FETCH_SOURCE_LIB;
  const profileSourceLib = fetchProfile.sourceLibrary || fetchProfile.sourceLib;
  const sourceLibrary = cliSourceLib || envSourceLib || profileSourceLib;

  // Wenn ENV-Variable das Profil überschreibt (und kein CLI-Arg gesetzt), Warnung merken.
  // fetchCommand.js greift auf config.sourceLibEnvOverride zu und zeigt den Hinweis an.
  const sourceLibEnvOverride =
    !cliSourceLib &&
    envSourceLib &&
    profileSourceLib &&
    String(envSourceLib).toUpperCase() !== String(profileSourceLib).toUpperCase()
      ? {
          envValue: String(envSourceLib).toUpperCase(),
          profileValue: String(profileSourceLib).toUpperCase(),
        }
      : null;
  const hostEnvOverride =
    !cliHost &&
    !fetchSystemOverride.config &&
    envHost &&
    profileHost &&
    String(envHost).trim().toUpperCase() !== String(profileHost).trim().toUpperCase()
      ? { envValue: String(envHost).trim(), profileValue: String(profileHost).trim() }
      : null;

  const sourceFiles =
    args['source-files'] ||
    args.files ||
    env.ZEUS_FETCH_SOURCE_FILES ||
    env.ZEUS_FETCH_FILES ||
    fetchProfile.sourceFiles ||
    fetchProfile.files;

  const resolved = {
    host:
      args.host ||
      (fetchSystemOverride.config && fetchSystemOverride.config.host) ||
      env.ZEUS_FETCH_HOST ||
      fetchProfile.host,
    user:
      args.user ||
      (fetchSystemOverride.config && fetchSystemOverride.config.user) ||
      env.ZEUS_FETCH_USER ||
      fetchProfile.user,
    password: resolveSecretValue(
      args.password ||
        (fetchSystemOverride.config && fetchSystemOverride.config.password) ||
        env.ZEUS_FETCH_PASSWORD ||
        fetchProfile.password,
      { env }
    ),
    sourceLib: String(sourceLibrary || '').toUpperCase(),
    sourceLibrary: String(sourceLibrary || '').toUpperCase(),
    hostEnvOverride,
    sourceLibEnvOverride,
    ifsDir: args['ifs-dir'] || env.ZEUS_FETCH_IFS_DIR || fetchProfile.ifsDir,
    out: args.out || env.ZEUS_FETCH_OUT || fetchProfile.out || './rpg_sources',
    port: Number.parseInt(
      String(args.port || env.ZEUS_FETCH_PORT || fetchProfile.port || 22).trim(),
      10
    ),
    files: parseCsv(sourceFiles, [...DEFAULT_SOURCE_FILES], item => item.toUpperCase()),
    members: parseCsv(
      args.members || args.member || env.ZEUS_FETCH_MEMBERS || fetchProfile.members,
      [],
      item => item.toUpperCase()
    ),
    replace: parseBoolean(
      args.replace !== undefined
        ? args.replace
        : env.ZEUS_FETCH_REPLACE !== undefined
          ? env.ZEUS_FETCH_REPLACE
          : fetchProfile.replace,
      true
    ),
    streamFileCcsid: Number.parseInt(
      String(
        args['streamfile-ccsid'] ||
          env.ZEUS_FETCH_STREAMFILE_CCSID ||
          fetchProfile.streamFileCcsid ||
          DEFAULT_STREAM_FILE_CCSID
      ).trim(),
      10
    ),
    transport: String(
      args.transport || env.ZEUS_FETCH_TRANSPORT || fetchProfile.transport || DEFAULT_TRANSPORT
    ).toLowerCase(),
    networkType: String(
      args['network-type'] || env.ZEUS_FETCH_NETWORK_TYPE || fetchProfile.networkType || ''
    )
      .trim()
      .toLowerCase(),
    preferTransport: String(
      args['prefer-transport'] ||
        env.ZEUS_FETCH_PREFER_TRANSPORT ||
        fetchProfile.preferTransport ||
        ''
    )
      .trim()
      .toLowerCase(),
    diagnoseTransport: parseBoolean(
      args['diagnose-transport'] !== undefined
        ? args['diagnose-transport']
        : env.ZEUS_FETCH_DIAGNOSE_TRANSPORT !== undefined
          ? env.ZEUS_FETCH_DIAGNOSE_TRANSPORT
          : fetchProfile.diagnoseTransport,
      false
    ),
    encrypted: parseBoolean(
      args.encrypted !== undefined
        ? args.encrypted
        : env.ZEUS_FETCH_ENCRYPTED !== undefined
          ? env.ZEUS_FETCH_ENCRYPTED
          : fetchProfile.encrypted,
      true
    ),
    transportTimeoutMs: Number.parseInt(
      String(
        args['transport-timeout-ms'] ||
          env.ZEUS_FETCH_TRANSPORT_TIMEOUT_MS ||
          fetchProfile.transportTimeoutMs ||
          30000
      ).trim(),
      10
    ),
  };
  attachConnectionTargetMetadata(resolved, cloneConnectionTargetMetadata(rawFetchTargetMetadata));
  validateFetchConfig(resolved);
  return resolved;
}

function resolveBundleConfig(
  args,
  { cwd = process.cwd(), env = process.env } = {},
  { loadProfiles, resolveProfile, validateBundleConfig } = {}
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
