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

const DEFAULT_EXTENSIONS = ['.rpg', '.rpgle', '.sqlrpgle', '.rpgile', '.bnd', '.binder', '.bndsrc', '.clp', '.clle', '.dds', '.dspf', '.prtf', '.pf', '.lf'];
const ALLOWED_FETCH_TRANSPORTS = new Set(['auto', 'sftp', 'jt400', 'ftp']);

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

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    failValidation(`${label} must be a positive integer`);
  }
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

function validateNamedProfile(profile, label) {
  if (!isPlainObject(profile)) {
    failValidation(`${label} must be an object`);
  }
  assertOptionalString(profile.sourceRoot, `${label}.sourceRoot`);
  assertOptionalString(profile.outputRoot, `${label}.outputRoot`);
  if (profile.extensions !== undefined) {
    assertStringArray(profile.extensions, `${label}.extensions`);
  }
  if (profile.contextOptimizer !== undefined) {
    validateContextOptimizerConfig(profile.contextOptimizer, `${label}.contextOptimizer`);
  }
  if (profile.testData !== undefined) {
    validateTestDataConfig(profile.testData, `${label}.testData`);
  }
  if (profile.db !== undefined) {
    validateDbConfig(profile.db, `${label}.db`);
  }
  if (profile.fetch !== undefined) {
    validateFetchProfile(profile.fetch, `${label}.fetch`);
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

  for (const [key, value] of Object.entries(profiles)) {
    if (key === 'contextOptimizer' || key === 'testData') continue;
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
  if (config.testData) {
    validateTestDataConfig(config.testData, 'analyze.testData');
  }
  if (config.db !== null && config.db !== undefined) {
    validateDbConfig(config.db, 'analyze.db');
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

function loadProfiles({ cwd = process.cwd(), fsModule = fs } = {}) {
  const configDir = path.resolve(cwd, 'config');
  const preferredPath = path.join(configDir, 'profiles.json');
  const fallbackPath = path.join(configDir, 'profiles.example.json');
  const profilePath = fsModule.existsSync(preferredPath) ? preferredPath : fallbackPath;

  if (!fsModule.existsSync(profilePath)) {
    return {};
  }

  const raw = fsModule.readFileSync(profilePath, 'utf8');
  const parsed = JSON.parse(raw);
  const profiles = parsed && typeof parsed === 'object' ? parsed : {};
  validateProfiles(profiles);
  return profiles;
}

function resolveProfile(profiles, profileName) {
  if (!profileName) {
    return null;
  }

  const profile = profiles[profileName];
  if (!profile) {
    throw new Error(`Profile "${profileName}" not found in config/profiles.json or config/profiles.example.json`);
  }

  return profile;
}

function readContextOptimizerConfig(profiles, profile) {
  const globalConfig = profiles && typeof profiles.contextOptimizer === 'object'
    ? profiles.contextOptimizer
    : {};
  const profileConfig = profile && typeof profile.contextOptimizer === 'object'
    ? profile.contextOptimizer
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

function readTestDataConfig(profiles, profile) {
  const globalConfig = profiles && typeof profiles.testData === 'object'
    ? profiles.testData
    : {};
  const profileConfig = profile && typeof profile.testData === 'object'
    ? profile.testData
    : {};

  return {
    limit: DEFAULT_TEST_DATA_LIMIT,
    maskColumns: [],
    ...globalConfig,
    ...profileConfig,
  };
}

function applyDbEnvOverrides(dbConfig, env) {
  const merged = { ...(dbConfig || {}) };
  const schemaOverride = env.ZEUS_DB_DEFAULT_SCHEMA || env.ZEUS_DB_DEFAULT_LIBRARY || env.ZEUS_DB_SCHEMA || env.ZEUS_DB_LIBRARY;

  if (env.ZEUS_DB_HOST) merged.host = env.ZEUS_DB_HOST;
  if (env.ZEUS_DB_URL) merged.url = env.ZEUS_DB_URL;
  if (env.ZEUS_DB_USER) merged.user = env.ZEUS_DB_USER;
  if (env.ZEUS_DB_PASSWORD !== undefined) merged.password = env.ZEUS_DB_PASSWORD;
  if (schemaOverride) merged.defaultSchema = schemaOverride;

  return Object.keys(merged).length > 0 ? merged : null;
}

function resolveAnalyzeConfig(args, { cwd = process.cwd(), env = process.env } = {}) {
  const profiles = loadProfiles({ cwd });
  const profile = resolveProfile(profiles, args.profile);
  const fetchProfile = profile ? (profile.fetch || {}) : {};

  const extensions = args.extensions
    ? parseCsv(args.extensions, DEFAULT_EXTENSIONS)
    : ((profile && profile.extensions) || DEFAULT_EXTENSIONS);

  const resolved = {
    sourceRoot: args.source || (profile && profile.sourceRoot),
    outputRoot: args.out || args.output || (profile && profile.outputRoot) || 'output',
    extensions,
    db: applyDbEnvOverrides((profile && profile.db) || null, env),
    ibmi: {
      host: args.host || env.ZEUS_FETCH_HOST || fetchProfile.host || null,
      user: args.user || env.ZEUS_FETCH_USER || fetchProfile.user || null,
      password: args.password || env.ZEUS_FETCH_PASSWORD || fetchProfile.password || null,
    },
    contextOptimizer: readContextOptimizerConfig(profiles, profile),
    testData: readTestDataConfig(profiles, profile),
  };
  validateAnalyzeConfig(resolved);
  return resolved;
}

function resolveFetchConfig(args, { cwd = process.cwd(), env = process.env } = {}) {
  const profiles = loadProfiles({ cwd });
  const profile = resolveProfile(profiles, args.profile);
  const fetchProfile = profile ? (profile.fetch || profile) : {};

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

function resolveBundleConfig(args, { cwd = process.cwd() } = {}) {
  const profiles = loadProfiles({ cwd });
  const profile = resolveProfile(profiles, args.profile);

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
  loadProfiles,
  resolveAnalyzeConfig,
  resolveFetchConfig,
  resolveBundleConfig,
  validateProfiles,
};
