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
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  getProfilesMetadata,
  loadProfiles,
  resolveAnalyzeDbConfig,
  resolveAnalyzeConfig,
  resolveFetchConfig,
  resolveProfile,
  resolveProfilesConfigPaths,
} = require('../../config/runtimeConfig');
const {
  describeConnectionTarget,
  listConnectionTargetNames,
  matchesConnectionTargetName,
} = require('../../config/connectionTargetMetadata');
const { getRuntimeConfigMetadata } = require('../../config/dbRuntimeConfigDiagnostics');
const { discoverEnvFiles } = require('../../config/envFileLoader');
const { createJsonOutput } = require('../helpers/jsonOutput');
const {
  ensureJavaSourcesCompiled,
  listJavaSourceFiles,
  listClasspathJarEntries,
  resolveJavaPaths,
} = require('../../java/javaRuntime');
const { executeClCommandRaw } = require('../../fetch/jt400CommandRunner');
const { isDbConfigured, resolveDefaultSchema } = require('../../db2/db2Config');
const { runReadOnlyDb2Query } = require('../../db2/readOnlyQueryService');
const { getIbmiOsVersion } = require('../../db2/ibmiPlatformInfo');
const { renderAsciiTable } = require('../helpers/asciiTable');
const { resolveKeyMaterial, KEY_ENV_VAR, KEY_FILE_RELATIVE } = require('../../security/secretVault');
const { detectPlaintextSecrets } = require('../../security/plaintextSecretDetector');
const {
  buildDbRuntimeConflictDiagnostics,
  getDbRuntimeConflictWarnings,
} = require('../helpers/runtimeConfigWarnings');

function formatStatus(status) {
  if (status === 'PASS') return '[PASS]';
  if (status === 'FAIL') return '[FAIL]';
  if (status === 'WARN') return '[WARN]';
  if (status === 'INFO') return '[INFO]';
  return '[SKIP]';
}

function toDisplayPath(cwd, filePath) {
  const relative = path.relative(cwd, filePath);
  return relative && !relative.startsWith('..') ? relative.replace(/\\/g, '/') : filePath;
}

function extractJavaVersion(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || 'unknown';
}

function isSet(value) {
  return value !== undefined && value !== null && String(value).trim().length > 0;
}

function buildSetHint(name, value) {
  return `set ${name}=${value}`;
}

// Prueft das Secret-Vault-Setup: ist ein Schluessel verfuegbar und werden ueberhaupt
// verschluesselte Werte (enc:v1:...) verwendet? Meldet FAIL, wenn verschluesselte
// Werte vorliegen, aber kein Schluessel gefunden wird.
function appendSecretVaultChecks(checks, { env = process.env } = {}) {
  const keyInfo = resolveKeyMaterial({ env });
  const encryptedEnvVars = Object.keys(env || {})
    .filter((name) => typeof env[name] === 'string' && env[name].startsWith('enc:v1:'));

  if (encryptedEnvVars.length === 0) {
    checks.push({
      name: 'Secret Vault',
      status: 'INFO',
      details: keyInfo
        ? `Schluessel verfuegbar (${keyInfo.source}); aktuell keine verschluesselten Env-Werte.`
        : `Kein Schluessel gesetzt. Optional: Passwoerter mit "zeus secret encrypt" verschluesseln (${KEY_ENV_VAR} oder ${KEY_FILE_RELATIVE}).`,
    });
    return;
  }

  if (keyInfo) {
    checks.push({
      name: 'Secret Vault',
      status: 'PASS',
      details: `${encryptedEnvVars.length} verschluesselte(r) Env-Wert(e); Schluessel: ${keyInfo.source}.`,
    });
    return;
  }

  checks.push({
    name: 'Secret Vault',
    status: 'FAIL',
    details: `${encryptedEnvVars.join(', ')} sind verschluesselt (enc:v1:), aber kein Schluessel gefunden. `
      + `Setze ${KEY_ENV_VAR} oder lege ${KEY_FILE_RELATIVE} an (zeus secret init-key).`,
  });
}

/**
 * Scans discovered .env files for likely plaintext credentials.
 * Warns users to migrate to Secret Vault (enc:v1:...).
 */
function appendPlaintextSecretWarnings(checks, { env = process.env, cwd = process.cwd(), configDir, discovery } = {}) {
  try {
    const envFiles = (discovery && Array.isArray(discovery.files) ? discovery.files.map(f => f.path) : []);
    const findings = detectPlaintextSecrets({ cwd, configDir, envFiles, env, checkProfiles: true });

    if (findings.length > 0) {
      const examples = findings.slice(0, 2).map((s) => `${s.key} (${s.source})`).join(', ');
      checks.push({
        name: 'Secret Hygiene',
        status: 'WARN',
        details: `${findings.length} Klartext-Credential(s) gefunden (z. B. ${examples}). ` +
          `Klartext-Passwörter sind unsicher. Mit --strict als Fehler behandeln (Exit 1). ` +
          `Migriere mit "zeus secret encrypt" oder "zeus secret migrate". ` +
          `Siehe docs/quickstart/secrets-and-overrides.md (auch "secret check --warn-only").`,
      });
    }
  } catch (_) {
    // non-fatal
  }
}

function addEnvCheck(checks, { name, expected = true, envValue, fallbackValue = '', required = true, hint }) {
  if (!expected) {
    return;
  }

  if (isSet(envValue)) {
    checks.push({
      name,
      status: 'PASS',
      details: `${name} gesetzt`,
    });
    return;
  }

  if (isSet(fallbackValue)) {
    checks.push({
      name,
      status: required ? 'WARN' : 'WARN',
      details: `${name} nicht gesetzt → Profil liefert Fallback (${buildSetHint(name, hint)})`,
    });
    return;
  }

  checks.push({
    name,
    status: required ? 'FAIL' : 'WARN',
    details: `${name} nicht gesetzt -> ${buildSetHint(name, hint)}`,
  });
}

function addDbEnvironmentChecks(checks, {
  env,
  envPrefix,
  fallbackConfig,
  requiredLabelPrefix,
}) {
  const urlValue = env[`${envPrefix}_URL`];
  const hostValue = env[`${envPrefix}_HOST`];
  const fallbackUrl = fallbackConfig && fallbackConfig.url;
  const fallbackHost = fallbackConfig && fallbackConfig.host;
  const hasUrl = isSet(urlValue) || isSet(fallbackUrl);
  const hasHost = isSet(hostValue) || isSet(fallbackHost);

  if (hasUrl) {
    addEnvCheck(checks, {
      name: `${envPrefix}_URL`,
      expected: true,
      envValue: urlValue,
      fallbackValue: fallbackUrl,
      required: false,
      hint: 'jdbc:as400://primary-system;naming=system;libraries=DEMO',
    });
  }

  addEnvCheck(checks, {
    name: `${envPrefix}_HOST`,
    expected: !hasUrl || hasHost,
    envValue: hostValue,
    fallbackValue: fallbackHost,
    required: !hasUrl,
    hint: 'primary-system',
  });
  addEnvCheck(checks, {
    name: `${envPrefix}_USER`,
    expected: true,
    envValue: env[`${envPrefix}_USER`],
    fallbackValue: fallbackConfig && fallbackConfig.user,
    required: true,
    hint: 'YOUR_IBM_I_USER',
  });
  addEnvCheck(checks, {
    name: `${envPrefix}_PASSWORD`,
    expected: true,
    envValue: env[`${envPrefix}_PASSWORD`],
    fallbackValue: fallbackConfig && fallbackConfig.password,
    required: true,
    hint: 'YOUR_IBM_I_PASSWORD',
  });
  addEnvCheck(checks, {
    name: `${envPrefix}_DEFAULT_LIBRARY`,
    expected: true,
    envValue: env[`${envPrefix}_DEFAULT_LIBRARY`],
    fallbackValue: fallbackConfig && fallbackConfig.defaultLibrary,
    required: false,
    hint: requiredLabelPrefix || 'DEMO',
  });
  addEnvCheck(checks, {
    name: `${envPrefix}_DEFAULT_SCHEMA`,
    expected: true,
    envValue: env[`${envPrefix}_DEFAULT_SCHEMA`],
    fallbackValue: fallbackConfig && fallbackConfig.defaultSchema,
    required: false,
    hint: requiredLabelPrefix || 'DEMO',
  });
}

function formatResolvedValue(value, { secret = false } = {}) {
  if (!isSet(value)) {
    return '(leer)';
  }
  if (secret) {
    return '(gesetzt)';
  }
  return String(value);
}

function formatOrigin(metadataField) {
  if (!metadataField) {
    return '';
  }
  if (metadataField.origin === 'env') {
    return metadataField.envKey ? `env: ${metadataField.envKey}` : 'env';
  }
  if (metadataField.origin === 'profile-env-placeholder') {
    if (metadataField.profileField && metadataField.placeholderEnvKey) {
      return `profile placeholder: ${metadataField.profileField} -> ${metadataField.placeholderEnvKey}`;
    }
    return 'profile env placeholder';
  }
  if (metadataField.origin === 'profile') {
    return metadataField.profileField ? `profile: ${metadataField.profileField}` : 'profile';
  }
  return String(metadataField.origin || '');
}

function appendDbRuntimeConflictChecks(checks, dbConfig, label = 'DB Runtime Override') {
  for (const warning of getDbRuntimeConflictWarnings(dbConfig)) {
    checks.push({
      name: label,
      status: 'WARN',
      details: `${warning.envKey}="${warning.envValue}" überschreibt ${warning.profileField}="${warning.profileValue}".`,
    });
  }
}

function appendResolvedDbChecks(checks, namePrefix, dbConfig, { buildJdbcUrl, resolveDefaultSchema } = {}) {
  const metadata = getRuntimeConfigMetadata(dbConfig);
  const warningsByField = new Set(
    getDbRuntimeConflictWarnings(dbConfig).map((warning) => warning.field),
  );
  const fields = [
    { key: 'url', label: 'url', secret: false },
    { key: 'host', label: 'host', secret: false },
    { key: 'user', label: 'user', secret: false },
    { key: 'password', label: 'password', secret: true },
    { key: 'defaultSchema', label: 'defaultSchema', secret: false },
  ];

  for (const field of fields) {
    const fieldMetadata = metadata && metadata.fields ? metadata.fields[field.key] : null;
    const value = field.key === 'defaultSchema'
      ? (dbConfig && (dbConfig.defaultSchema || dbConfig.defaultLibrary || dbConfig.schema || dbConfig.library))
      : (dbConfig && dbConfig[field.key]);
    checks.push({
      name: `${namePrefix}.${field.label}`,
      status: warningsByField.has(field.key) ? 'WARN' : 'INFO',
      value: formatResolvedValue(value, { secret: field.secret }),
      origin: formatOrigin(fieldMetadata),
    });
  }

  checks.push({
    name: `${namePrefix}.jdbcUrl`,
    status: 'INFO',
    value: dbConfig ? buildJdbcUrl(dbConfig, resolveDefaultSchema(dbConfig)) || '(leer)' : '(nicht konfiguriert)',
    origin: 'derived',
  });
  checks.push({
    name: `${namePrefix}.target`,
    status: 'INFO',
    value: describeConnectionTarget(dbConfig),
    origin: 'system-ref',
  });
  const acceptedNames = listConnectionTargetNames(dbConfig);
  if (acceptedNames.length > 0) {
    checks.push({
      name: `${namePrefix}.acceptedNames`,
      status: 'INFO',
      value: acceptedNames.join(', '),
      origin: 'derived',
    });
  }
}

function appendResolvedFetchChecks(checks, fetchConfig) {
  if (!fetchConfig || typeof fetchConfig !== 'object') {
    return;
  }

  const fields = [
    { key: 'host', secret: false },
    { key: 'user', secret: false },
    { key: 'password', secret: true },
    { key: 'sourceLib', secret: false },
    { key: 'ifsDir', secret: false },
    { key: 'out', secret: false },
    { key: 'transport', secret: false },
  ];

  for (const field of fields) {
    checks.push({
      name: `fetch.${field.key}`,
      status: 'INFO',
      value: formatResolvedValue(fetchConfig[field.key], { secret: field.secret }),
      origin: '',
    });
  }

  checks.push({
    name: 'fetch.target',
    status: 'INFO',
    value: describeConnectionTarget(fetchConfig),
    origin: 'system-ref',
  });

  const acceptedNames = listConnectionTargetNames(fetchConfig);
  if (acceptedNames.length > 0) {
    checks.push({
      name: 'fetch.acceptedNames',
      status: 'INFO',
      value: acceptedNames.join(', '),
      origin: 'derived',
    });
  }
}

function hasExplicitTestDataRole(profile, env) {
  return Boolean(
    (profile && profile.dbRoles && profile.dbRoles.testData)
    || env.ZEUS_TESTDATA_DB_HOST
    || env.ZEUS_TESTDATA_DB_URL
    || env.ZEUS_TESTDATA_DB_USER
    || env.ZEUS_TESTDATA_DB_PASSWORD !== undefined,
  );
}

function buildEnvironmentChecks({ profile, analyzeConfig, fetchConfig, env }) {
  const checks = [];
  const profileHasDb = Boolean(profile && profile.db);
  const profileHasMetadataDb = Boolean(profile && profile.dbRoles && profile.dbRoles.metadata);
  const profileHasTestDataDb = Boolean(profile && profile.dbRoles && profile.dbRoles.testData);
  const profileHasFetch = Boolean(profile && profile.fetch);
  const dbProfile = profile && profile.db ? profile.db : {};
  const fetchProfile = profile && profile.fetch ? profile.fetch : {};

  if (profileHasDb) {
    addDbEnvironmentChecks(checks, {
      env,
      envPrefix: 'ZEUS_DB',
      fallbackConfig: dbProfile,
      requiredLabelPrefix: 'DEMO',
    });
  }

  if (profileHasMetadataDb) {
    addDbEnvironmentChecks(checks, {
      env,
      envPrefix: 'ZEUS_METADATA_DB',
      fallbackConfig: analyzeConfig && analyzeConfig.dbRoles ? analyzeConfig.dbRoles.metadata : {},
      requiredLabelPrefix: 'DEMO',
    });
  }

  if (profileHasTestDataDb) {
    addDbEnvironmentChecks(checks, {
      env,
      envPrefix: 'ZEUS_TESTDATA_DB',
      fallbackConfig: analyzeConfig && analyzeConfig.dbRoles ? analyzeConfig.dbRoles.testData : {},
      requiredLabelPrefix: 'DEMO',
    });
  }

  if (profileHasFetch) {
    const fetchFallback = fetchConfig || fetchProfile;
    addEnvCheck(checks, {
      name: 'ZEUS_FETCH_HOST',
      expected: true,
      envValue: env.ZEUS_FETCH_HOST,
      fallbackValue: fetchFallback.host,
      required: true,
      hint: 'primary-system',
    });
    addEnvCheck(checks, {
      name: 'ZEUS_FETCH_USER',
      expected: true,
      envValue: env.ZEUS_FETCH_USER,
      fallbackValue: fetchFallback.user,
      required: true,
      hint: 'YOUR_IBM_I_USER',
    });
    addEnvCheck(checks, {
      name: 'ZEUS_FETCH_PASSWORD',
      expected: true,
      envValue: env.ZEUS_FETCH_PASSWORD,
      fallbackValue: fetchFallback.password,
      required: true,
      hint: 'YOUR_IBM_I_PASSWORD',
    });
    addEnvCheck(checks, {
      name: 'ZEUS_FETCH_SOURCE_LIB|ZEUS_FETCH_SOURCE_LIBRARY',
      expected: true,
      envValue: env.ZEUS_FETCH_SOURCE_LIB || env.ZEUS_FETCH_SOURCE_LIBRARY,
      fallbackValue: fetchFallback.sourceLib || fetchFallback.sourceLibrary,
      required: true,
      hint: 'FETCH_SOURCE',
    });
    addEnvCheck(checks, {
      name: 'ZEUS_FETCH_IFS_DIR',
      expected: true,
      envValue: env.ZEUS_FETCH_IFS_DIR,
      fallbackValue: fetchFallback.ifsDir,
      required: true,
      hint: '/ifs/source-export/example',
    });
    addEnvCheck(checks, {
      name: 'ZEUS_FETCH_OUT',
      expected: true,
      envValue: env.ZEUS_FETCH_OUT,
      fallbackValue: fetchFallback.out,
      required: true,
      hint: './fetched-source/demo',
    });
  }

  addEnvCheck(checks, {
    name: 'ZEUS_OUTPUT_ROOT',
    expected: true,
    envValue: env.ZEUS_OUTPUT_ROOT,
    fallbackValue: profile && profile.outputRoot,
    required: false,
    hint: './workspace/output',
  });
  addEnvCheck(checks, {
    name: 'ZEUS_SOURCE_ROOT',
    expected: true,
    envValue: env.ZEUS_SOURCE_ROOT,
    fallbackValue: profile && profile.sourceRoot,
    required: false,
    hint: './workspace/source',
  });
  addEnvCheck(checks, {
    name: 'ZEUS_ANALYSES_REGISTRY',
    expected: true,
    envValue: env.ZEUS_ANALYSES_REGISTRY,
    fallbackValue: profile && profile.analysesRegistryPath,
    required: false,
    hint: './analysis/_registry.json',
  });

  return checks;
}

function buildProbeRow({ system, profile, functionName, status, details }) {
  return {
    system,
    profile,
    functionName,
    status,
    details,
  };
}

function runDoctorChecks(args, { cwd = process.cwd(), env = process.env, services = {} } = {}) {
  const checks = [];
  const diagnostics = [];
  const probeRows = [];
  let hasCriticalFailure = false;
  const strict = args.strict === true || String(args.strict || '').toLowerCase() === 'true';
  let resolvedAnalyzeConfig = null;
  let resolvedFetchConfig = null;
  let resolvedProfile = null;
  const probeEnabled = Boolean(args.probe);
  const runReadOnlyDb2QueryFn = services.runReadOnlyDb2Query || runReadOnlyDb2Query;
  const executeClCommandRawFn = services.executeClCommandRaw || executeClCommandRaw;
  const getIbmiOsVersionFn = services.getIbmiOsVersion || getIbmiOsVersion;

  if (!args.profile || !String(args.profile).trim()) {
    throw new Error('Missing required option: --profile <name>');
  }

  try {
    const environment = (typeof args.env === 'string' && args.env.trim())
      || (typeof args.environment === 'string' && args.environment.trim())
      || (env.ZEUS_ENV && String(env.ZEUS_ENV).trim())
      || 'default';
    const configDir = (typeof args.config === 'string' && args.config.trim())
      ? args.config.trim()
      : undefined;
    const discovery = discoverEnvFiles({ cwd, configDir, environment });
    if (discovery.files.length > 0) {
      const fileLabel = discovery.files
        .map((file) => `${path.relative(cwd, file.path).replace(/\\/g, '/')} (${file.role})`)
        .join(', ');
      checks.push({
        name: 'Env Auto-Discovery',
        status: 'INFO',
        details: `${discovery.files.length} .env-Datei(en) gefunden: ${fileLabel}. Werte werden automatisch geladen, ohne bereits gesetzte Variablen zu ueberschreiben.`,
      });
    } else {
      const searchedDirs = discovery.searchDirs
        .map((dir) => path.relative(cwd, dir).replace(/\\/g, '/') || '.')
        .join(', ');
      checks.push({
        name: 'Env Auto-Discovery',
        status: 'INFO',
        details: `Keine .env-Datei automatisch gefunden (gesucht in: ${searchedDirs}). Profil-Platzhalter benoetigen ggf. manuelles Laden via load-env.ps1/.sh.`,
      });
    }
  } catch { /* Env-Discovery ist optional — Fehler nicht kritisch */ }

  try {
    const profiles = loadProfiles({ cwd, env, args });
    resolvedProfile = resolveProfile(profiles, args.profile, { env });
    resolvedAnalyzeConfig = resolveAnalyzeConfig(args, { cwd, env });
    resolvedFetchConfig = resolvedProfile && resolvedProfile.fetch ? resolveFetchConfig(args, { cwd, env }) : null;
    const metadata = getProfilesMetadata(profiles);
    checks.push({
      name: 'Config/Profile',
      status: 'PASS',
      details: `Loaded profile "${args.profile}" from ${(metadata && metadata.sourceFileLabel) || 'config/local-only/profiles.json'}`,
    });
  } catch (error) {
    hasCriticalFailure = true;
    let profileFailDetails = error.message;
    try {
      const configPaths = resolveProfilesConfigPaths({ args, cwd, env });
      const searchedPaths = (configPaths.attemptedPaths || [
        configPaths.preferredPath,
        configPaths.secondaryPath,
        configPaths.fallbackPath,
      ]).filter(Boolean);
      if (searchedPaths.length > 0) {
        const pathList = searchedPaths
          .map((p, i) => `  ${i + 1}. ${path.relative(cwd, p).replace(/\\/g, '/')}`)          .join('\n');
        profileFailDetails = `${error.message}\nGesuchte Pfade:\n${pathList}\nTipp: config/local-only/profiles.json anlegen (basierend auf config/profiles.example.json)`;
      }
    } catch { /* Pfad-Auflösung optional — Fehler ignorieren */ }
    checks.push({
      name: 'Config/Profile',
      status: 'FAIL',
      details: profileFailDetails,
    });
  }

  const envChecks = buildEnvironmentChecks({
    profile: resolvedProfile,
    analyzeConfig: resolvedAnalyzeConfig,
    fetchConfig: resolvedFetchConfig,
    env,
  });
  checks.push(...envChecks);
  if (envChecks.some((entry) => entry.status === 'FAIL')) {
    hasCriticalFailure = true;
  }
  appendSecretVaultChecks(checks, { env });
  appendPlaintextSecretWarnings(checks, { env, cwd });

  if (strict) {
    const hygiene = checks.find(c => c.name === 'Secret Hygiene');
    if (hygiene && hygiene.status === 'WARN') {
      hasCriticalFailure = true;
    }
  }
  if (resolvedAnalyzeConfig) {
    const metadataDbConfig = resolveAnalyzeDbConfig(resolvedAnalyzeConfig, 'metadata');
    const testDataDbConfig = resolveAnalyzeDbConfig(resolvedAnalyzeConfig, 'testData');
    appendDbRuntimeConflictChecks(checks, metadataDbConfig);
    diagnostics.push(...buildDbRuntimeConflictDiagnostics(metadataDbConfig, {
      profile: args.profile,
    }));
    if (hasExplicitTestDataRole(resolvedProfile, env)) {
      appendDbRuntimeConflictChecks(checks, testDataDbConfig, 'DB Runtime Override (testData)');
      diagnostics.push(...buildDbRuntimeConflictDiagnostics(testDataDbConfig, {
        profile: args.profile,
      }));
    }
  }
  if (resolvedFetchConfig && resolvedFetchConfig.hostEnvOverride) {
    checks.push({
      name: 'Fetch Runtime Override (host)',
      status: 'WARN',
      details: `ZEUS_FETCH_HOST="${resolvedFetchConfig.hostEnvOverride.envValue}" überschreibt fetch.host="${resolvedFetchConfig.hostEnvOverride.profileValue}".`,
    });
  }
  if (resolvedFetchConfig && resolvedFetchConfig.sourceLibEnvOverride) {
    checks.push({
      name: 'Fetch Runtime Override (sourceLib)',
      status: 'WARN',
      details: `ZEUS_FETCH_SOURCE_LIB="${resolvedFetchConfig.sourceLibEnvOverride.envValue}" überschreibt fetch.sourceLib="${resolvedFetchConfig.sourceLibEnvOverride.profileValue}".`,
    });
  }

  const javaResult = spawnSync('java', ['-version'], {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (javaResult.error || javaResult.status !== 0) {
    hasCriticalFailure = true;
    checks.push({
      name: 'Java',
      status: 'FAIL',
      details: javaResult.error ? javaResult.error.message : (javaResult.stderr || javaResult.stdout || 'java -version failed').trim(),
    });
  } else {
    checks.push({
      name: 'Java',
      status: 'PASS',
      details: extractJavaVersion(javaResult.stderr || javaResult.stdout),
    });
  }

  try {
    const javaPaths = resolveJavaPaths({ cwd });
    const sourceFiles = listJavaSourceFiles(javaPaths.sourceDir);
    const jarEntries = listClasspathJarEntries(javaPaths);
    const binJars = jarEntries.filter((entry) => path.dirname(entry) === javaPaths.binDir);
    const libJars = jarEntries.filter((entry) => path.dirname(entry) === javaPaths.libDir);
    ensureJavaSourcesCompiled({ cwd, verbose: false });

    checks.push({
      name: 'Classpath',
      status: 'PASS',
      details: [
        `sourceDir=${toDisplayPath(cwd, javaPaths.sourceDir)}`,
        `sourceFiles=${sourceFiles.length}`,
        `binDir=${toDisplayPath(cwd, javaPaths.binDir)}`,
        `binJars=${binJars.length}`,
        `libDir=${toDisplayPath(cwd, javaPaths.libDir)}`,
        `libJars=${libJars.length}`,
      ].join(', '),
    });
  } catch (error) {
    hasCriticalFailure = true;
    checks.push({
      name: 'Classpath',
      status: 'FAIL',
      details: error.message,
    });
  }

  // npm-Abhängigkeiten prüfen: Pakete, die erst bei Verwendung benötigt werden,
  // aber nach einem frischen Clone fehlen können.
  const NPM_OPTIONAL_MODULES = [
    { name: 'ssh2-sftp-client', hint: 'Wird für SFTP-Transport benötigt.' },
  ];
  for (const mod of NPM_OPTIONAL_MODULES) {
    try {
      require.resolve(mod.name, { paths: [cwd] });
      checks.push({ name: `npm: ${mod.name}`, status: 'PASS', details: 'Installiert.' });
    } catch {
      checks.push({
        name: `npm: ${mod.name}`,
        status: 'WARN',
        details: `Nicht installiert. ${mod.hint} → npm install`,
      });
    }
  }

  if (!probeEnabled) {
    checks.push({
      name: 'Probe Mode',
      status: 'INFO',
      details: 'Live smoke tests are disabled. Run doctor with --probe to execute read-only remote checks.',
    });
  }

  if (resolvedFetchConfig) {
    if (!probeEnabled) {
      checks.push({
        name: 'Fetch Probe',
        status: 'SKIP',
        details: 'Skipped because --probe was not requested.',
      });
    } else {
      try {
        const fetchProbe = executeClCommandRawFn({
          host: resolvedFetchConfig.host,
          user: resolvedFetchConfig.user,
          password: resolvedFetchConfig.password,
          command: 'CHKOBJ OBJ(QSYS/QSYS) OBJTYPE(*LIB)',
          verbose: false,
          runtime: {
            skipConnectionGuard: true,
          },
        });
        if (!fetchProbe.ok) {
          throw new Error(fetchProbe.messages.join('; ') || fetchProbe.stderr || 'IBM i fetch probe failed.');
        }
        checks.push({
          name: 'Fetch Probe',
          status: 'PASS',
          details: `IBM i fetch login succeeded (${describeConnectionTarget(resolvedFetchConfig)}).`,
        });
        probeRows.push(buildProbeRow({
          system: describeConnectionTarget(resolvedFetchConfig),
          profile: args.profile,
          functionName: 'fetch',
          status: 'OK',
          details: `Read-only CL probe succeeded; configured stream file CCSID ${resolvedFetchConfig.streamFileCcsid || 'unknown'}.`,
        }));
      } catch (error) {
        hasCriticalFailure = true;
        checks.push({
          name: 'Fetch Probe',
          status: 'FAIL',
          details: error.message,
        });
        probeRows.push(buildProbeRow({
          system: describeConnectionTarget(resolvedFetchConfig),
          profile: args.profile,
          functionName: 'fetch',
          status: 'FAIL',
          details: error.message,
        }));
      }
    }
  }

  if (!resolvedAnalyzeConfig) {
    checks.push({
      name: 'JDBC',
      status: 'SKIP',
      details: 'Skipped because config/profile validation already failed.',
    });
  } else if (!isDbConfigured(resolveAnalyzeDbConfig(resolvedAnalyzeConfig, 'metadata'))) {
    checks.push({
      name: 'JDBC Metadata',
      status: 'SKIP',
      details: 'DB2 credentials are not fully configured.',
    });
  } else if (!probeEnabled) {
    checks.push({
      name: 'JDBC Metadata',
      status: 'SKIP',
      details: 'Skipped because --probe was not requested.',
    });
  } else {
    try {
      const metadataDbConfig = resolveAnalyzeDbConfig(resolvedAnalyzeConfig, 'metadata');
      runReadOnlyDb2QueryFn({
        dbConfig: metadataDbConfig,
        query: 'SELECT 1 AS HEALTHCHECK FROM SYSIBM.SYSDUMMY1',
        maxRows: 1,
        runtime: {
          scopeLabel: 'doctor metadata probe connection',
        },
      });
      checks.push({
        name: 'JDBC Metadata',
        status: 'PASS',
        details: `Read-only query succeeded${resolveDefaultSchema(metadataDbConfig) ? ` (default schema ${resolveDefaultSchema(metadataDbConfig)})` : ''}.`,
      });
      probeRows.push(buildProbeRow({
        system: describeConnectionTarget(metadataDbConfig),
        profile: args.profile,
        functionName: 'metadata-db',
        status: 'OK',
        details: `SELECT 1 succeeded${resolveDefaultSchema(metadataDbConfig) ? `; default schema ${resolveDefaultSchema(metadataDbConfig)}` : ''}.`,
      }));
    } catch (error) {
      hasCriticalFailure = true;
      checks.push({
        name: 'JDBC Metadata',
        status: 'FAIL',
        details: error.message,
      });
      const metadataDbConfig = resolveAnalyzeDbConfig(resolvedAnalyzeConfig, 'metadata');
      probeRows.push(buildProbeRow({
        system: describeConnectionTarget(metadataDbConfig),
        profile: args.profile,
        functionName: 'metadata-db',
        status: 'FAIL',
        details: error.message,
      }));
    }
  }

  // IBM i OS-Version Check
  if (probeEnabled && resolvedAnalyzeConfig && isDbConfigured(resolveAnalyzeDbConfig(resolvedAnalyzeConfig, 'metadata'))) {
    try {
      const metadataDbConfig = resolveAnalyzeDbConfig(resolvedAnalyzeConfig, 'metadata');
      const versionInfo = getIbmiOsVersionFn(metadataDbConfig);
      checks.push({
        name: 'IBM i OS-Version',
        status: versionInfo.versionString !== 'UNKNOWN' ? 'PASS' : 'WARN',
        details: versionInfo.versionString !== 'UNKNOWN'
          ? `${versionInfo.versionString} (ermittelt via QSYS2.SYSTEM_STATUS_INFO)`
          : 'OS-Version konnte nicht ermittelt werden — Catalog-Queries ohne Versions-Awareness.',
      });
    } catch (_err) {
      checks.push({
        name: 'IBM i OS-Version',
        status: 'WARN',
        details: 'OS-Version konnte nicht abgefragt werden.',
      });
    }
  }

  // Journal-Status Check für runtimeContext-Tabellen
  if (
    probeEnabled
    &&
    resolvedAnalyzeConfig
    && isDbConfigured(resolveAnalyzeDbConfig(resolvedAnalyzeConfig, 'metadata'))
    && resolvedProfile
    && resolvedProfile.runtimeContext
    && Array.isArray(resolvedProfile.runtimeContext.journaledTables)
    && resolvedProfile.runtimeContext.journaledTables.length > 0
  ) {
    const { queryJournalStatus } = require('../../db2/ibmiPlatformInfo');
    const metadataDbConfig = resolveAnalyzeDbConfig(resolvedAnalyzeConfig, 'metadata');
    for (const tableSpec of resolvedProfile.runtimeContext.journaledTables) {
      const [schema, tableName] = String(tableSpec).split('.').map((s) => s.trim().toUpperCase());
      if (!schema || !tableName) continue;
      try {
        const journalInfo = queryJournalStatus({ schema, tableName, dbConfig: metadataDbConfig });
        if (journalInfo === null) {
          checks.push({
            name: `Journal: ${schema}.${tableName}`,
            status: 'WARN',
            details: 'Tabelle nicht gefunden oder OBJECT_STATISTICS nicht verfügbar.',
          });
        } else if (!journalInfo.journaled) {
          checks.push({
            name: `Journal: ${schema}.${tableName}`,
            status: 'FAIL',
            details: `Tabelle NICHT journalisiert! Programme mit COMMIT/ROLLBACK bekommen SQLSTATE 55019. Fix: STRJRNPF FILE(${schema}/${tableName}) JRN(<JRN>) IMAGES(*AFTER)`,
          });
        } else {
          checks.push({
            name: `Journal: ${schema}.${tableName}`,
            status: 'PASS',
            details: `Journalisiert: ${journalInfo.journalLibrary}/${journalInfo.journalName} (${journalInfo.journalImages || '*AFTER'})`,
          });
        }
      } catch (_err) {
        checks.push({
          name: `Journal: ${schema}.${tableName}`,
          status: 'WARN',
          details: `Journal-Status konnte nicht geprüft werden: ${_err.message}`,
        });
      }
    }
  }

  if (resolvedAnalyzeConfig && hasExplicitTestDataRole(resolvedProfile, env)) {
    const testDataDbConfig = resolveAnalyzeDbConfig(resolvedAnalyzeConfig, 'testData');
    if (!isDbConfigured(testDataDbConfig)) {
      checks.push({
        name: 'JDBC Test Data',
        status: 'SKIP',
        details: 'Test-data DB2 credentials are not fully configured.',
      });
    } else if (!probeEnabled) {
      checks.push({
        name: 'JDBC Test Data',
        status: 'SKIP',
        details: 'Skipped because --probe was not requested.',
      });
    } else {
      try {
        runReadOnlyDb2QueryFn({
          dbConfig: testDataDbConfig,
          query: 'SELECT 1 AS HEALTHCHECK FROM SYSIBM.SYSDUMMY1',
          maxRows: 1,
          runtime: {
            scopeLabel: 'doctor test-data probe connection',
          },
        });
        checks.push({
          name: 'JDBC Test Data',
          status: 'PASS',
          details: `Read-only query succeeded${resolveDefaultSchema(testDataDbConfig) ? ` (default schema ${resolveDefaultSchema(testDataDbConfig)})` : ''}.`,
        });
        probeRows.push(buildProbeRow({
          system: describeConnectionTarget(testDataDbConfig),
          profile: args.profile,
          functionName: 'testdata-db',
          status: 'OK',
          details: `SELECT 1 succeeded${resolveDefaultSchema(testDataDbConfig) ? `; default schema ${resolveDefaultSchema(testDataDbConfig)}` : ''}.`,
        }));
      } catch (error) {
        hasCriticalFailure = true;
        checks.push({
          name: 'JDBC Test Data',
          status: 'FAIL',
          details: error.message,
        });
        probeRows.push(buildProbeRow({
          system: describeConnectionTarget(testDataDbConfig),
          profile: args.profile,
          functionName: 'testdata-db',
          status: 'FAIL',
          details: error.message,
        }));
      }
    }
  }

  return {
    checks,
    diagnostics,
    hasCriticalFailure,
    probeRows,
  };
}

async function runDoctor(args) {
  const result = runDoctorChecks(args);

  if (args['show-resolved']) {
    const cwd = process.cwd();
    const env = process.env;
    let resolvedChecks = [];
    try {
      const { resolveProfile, loadProfiles, resolveAnalyzeConfig, resolveAnalyzeDbConfig } = require('../../config/runtimeConfig');
      const { buildJdbcUrl, resolveDefaultSchema } = require('../../db2/db2Config');
      const profiles = loadProfiles({ cwd, env, args });
      const resolvedProfile = resolveProfile(profiles, args.profile, { env });
      const resolvedAnalyzeConfig = resolveAnalyzeConfig(args, { cwd, env });
      const resolvedFetchConfig = resolvedProfile && resolvedProfile.fetch ? resolveFetchConfig(args, { cwd, env }) : null;
      const metadataDbConfig = resolveAnalyzeDbConfig(resolvedAnalyzeConfig, 'metadata');
      const testDataDbConfig = resolveAnalyzeDbConfig(resolvedAnalyzeConfig, 'testData');
      appendResolvedDbChecks(resolvedChecks, 'db', metadataDbConfig, { buildJdbcUrl, resolveDefaultSchema });
      if (testDataDbConfig && testDataDbConfig !== metadataDbConfig) {
        appendResolvedDbChecks(resolvedChecks, 'testDataDb', testDataDbConfig, { buildJdbcUrl, resolveDefaultSchema });
      }
      appendResolvedFetchChecks(resolvedChecks, resolvedFetchConfig);

      // CURRENT_SERVER Sanity-Check
      const { isDbConfigured } = require('../../db2/db2Config');
      const { runReadOnlyDb2Query } = require('../../db2/readOnlyQueryService');
      const { getIbmiOsVersion } = require('../../db2/ibmiPlatformInfo');
      if (args.probe && metadataDbConfig && isDbConfigured(metadataDbConfig)) {
        try {
          const serverResult = runReadOnlyDb2Query({
            dbConfig: metadataDbConfig,
            query: 'SELECT CURRENT_SERVER AS SYS FROM SYSIBM.SYSDUMMY1',
            maxRows: 1,
            runtime: {
              scopeLabel: 'doctor show-resolved probe connection',
            },
          });
          const currentServer = serverResult.rows && serverResult.rows[0] && (serverResult.rows[0].SYS || serverResult.rows[0].sys || Object.values(serverResult.rows[0])[0]);
          const configuredHost = String(metadataDbConfig.host || metadataDbConfig.url || '').toUpperCase();
          const reportedServer = String(currentServer || '').trim().toUpperCase();
          const targetMatched = matchesConnectionTargetName(metadataDbConfig, reportedServer);
          const hasExplicitNames = listConnectionTargetNames(metadataDbConfig).length > 0;
          const mismatch = reportedServer && (hasExplicitNames ? !targetMatched : (configuredHost && configuredHost !== reportedServer));
          resolvedChecks.push({
            name: 'CURRENT_SERVER',
            status: mismatch ? 'WARN' : 'PASS',
            value: mismatch
              ? `System meldet "${reportedServer}" — erwartet wird ${describeConnectionTarget(metadataDbConfig)}. Prüfe Alias-/Target-Konfiguration.`
              : `${reportedServer} ✓`,
            origin: '',
          });
        } catch (err) {
          resolvedChecks.push({ name: 'CURRENT_SERVER', status: 'WARN', value: `Konnte nicht abgefragt werden: ${err.message}`, origin: '' });
        }

        // IBM i OS-Version anzeigen
        try {
          const versionInfo = getIbmiOsVersion(metadataDbConfig);
          resolvedChecks.push({
            name: 'IBM i OS-Version',
            status: 'INFO',
            value: versionInfo.versionString,
            origin: '',
          });
        } catch (_err) {
          resolvedChecks.push({ name: 'IBM i OS-Version', status: 'WARN', value: 'Nicht ermittelbar', origin: '' });
        }
      } else if (!args.probe) {
        resolvedChecks.push({
          name: 'CURRENT_SERVER',
          status: 'INFO',
          value: 'Nicht abgefragt. Fuer Live-Abgleich doctor --probe verwenden.',
          origin: '',
        });
      }

      // productionSystem-Warnung
      const profObj = resolvedProfile || {};
      if (profObj.productionSystem) {
        resolvedChecks.push({ name: 'Produktionssystem', status: 'WARN', value: 'Dieses Profil ist als productionSystem=true markiert!', origin: '' });
      }

      // Systems-Block anzeigen (wenn vorhanden)
      if (profObj.systems && typeof profObj.systems === 'object') {
        const systemNames = Object.keys(profObj.systems);
        resolvedChecks.push({
          name: 'systems (Def.)',
          status: 'INFO',
          value: systemNames.map((s) => {
            const sys = profObj.systems[s];
            const aliases = Array.isArray(sys.aliases) && sys.aliases.length > 0 ? ` aliases=${sys.aliases.join(',')}` : '';
            const systemName = sys.systemName ? ` name=${sys.systemName}` : '';
            return `${s}: ${sys.displayName || sys.host || '?'}${systemName}${aliases}`;
          }).join(' | '),
          origin: '',
        });
        // Welche Rollen auf welches System zeigen
        const roleMap = {};
        if (profObj.db) roleMap.db = describeConnectionTarget(profObj.db);
        if (profObj.dbRoles) {
          for (const [role, cfg] of Object.entries(profObj.dbRoles)) {
            if (cfg) roleMap[`dbRoles.${role}`] = describeConnectionTarget(cfg);
          }
        }
        if (profObj.fetch) roleMap.fetch = describeConnectionTarget(profObj.fetch);
        if (Object.keys(roleMap).length > 0) {
          resolvedChecks.push({
            name: 'systems (Routing)',
            status: 'INFO',
            value: Object.entries(roleMap).map(([role, target]) => `${role}→${target}`).join(' | '),
            origin: '',
          });
        }
      }

    } catch (err) {
      resolvedChecks.push({ name: 'show-resolved', status: 'FAIL', value: err.message, origin: '' });
    }

    console.log('\n--- Aufgelöste Verbindung ---');
    console.log(renderAsciiTable(
      ['Status', 'Parameter', 'Wert', 'Origin'],
      resolvedChecks.map((c) => [formatStatus(c.status), c.name, c.value || '', c.origin || '']),
    ));
  }

  console.log(renderAsciiTable(
    ['Status', 'Check', 'Details'],
    result.checks.map((check) => [formatStatus(check.status), check.name, check.details]),
  ));

  if (args.probe && result.probeRows.length > 0) {
    console.log('\n--- Probe Matrix ---');
    console.log(renderAsciiTable(
      ['System', 'Profile', 'Function', 'Status', 'Hint'],
      result.probeRows.map((row) => [row.system, row.profile, row.functionName, row.status, row.details]),
      { maxCellWidth: 50 },
    ));
  }

  const json = createJsonOutput(args);
  if (json.isJsonMode) {
    json.print({
      checks: result.checks,
      probeRows: result.probeRows || [],
      hasCriticalFailure: result.hasCriticalFailure,
    });
    if (result.hasCriticalFailure) {
      process.exit(1);
    }
    return;
  }

  if (result.hasCriticalFailure) {
    process.exit(1);
  }
}

module.exports = {
  buildEnvironmentChecks,
  buildProbeRow,
  runDoctor,
  runDoctorChecks,
};
