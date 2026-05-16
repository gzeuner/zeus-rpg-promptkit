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
} = require('../../config/runtimeConfig');
const {
  ensureJavaSourcesCompiled,
  listJavaSourceFiles,
  listClasspathJarEntries,
  resolveJavaPaths,
} = require('../../java/javaRuntime');
const { isDbConfigured, resolveDefaultSchema } = require('../../db2/db2Config');
const { runReadOnlyDb2Query } = require('../../db2/readOnlyQueryService');
const { getIbmiOsVersion } = require('../../db2/ibmiPlatformInfo');
const { renderAsciiTable } = require('../helpers/asciiTable');

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
  const usesUrl = isSet(env[`${envPrefix}_URL`]);
  addEnvCheck(checks, {
    name: `${envPrefix}_URL`,
    expected: true,
    envValue: env[`${envPrefix}_URL`],
    fallbackValue: fallbackConfig && fallbackConfig.url,
    required: false,
    hint: 'jdbc:as400://mein-ibmi-host;naming=system;libraries=APPDATA',
  });
  addEnvCheck(checks, {
    name: `${envPrefix}_HOST`,
    expected: true,
    envValue: env[`${envPrefix}_HOST`],
    fallbackValue: fallbackConfig && fallbackConfig.host,
    required: !usesUrl,
    hint: 'mein-ibmi-host',
  });
  addEnvCheck(checks, {
    name: `${envPrefix}_USER`,
    expected: true,
    envValue: env[`${envPrefix}_USER`],
    fallbackValue: fallbackConfig && fallbackConfig.user,
    required: true,
    hint: 'MEINUSER',
  });
  addEnvCheck(checks, {
    name: `${envPrefix}_PASSWORD`,
    expected: true,
    envValue: env[`${envPrefix}_PASSWORD`],
    fallbackValue: fallbackConfig && fallbackConfig.password,
    required: true,
    hint: 'mein-passwort',
  });
  addEnvCheck(checks, {
    name: `${envPrefix}_DEFAULT_LIBRARY`,
    expected: true,
    envValue: env[`${envPrefix}_DEFAULT_LIBRARY`],
    fallbackValue: fallbackConfig && fallbackConfig.defaultLibrary,
    required: false,
    hint: requiredLabelPrefix || 'APPDATA',
  });
  addEnvCheck(checks, {
    name: `${envPrefix}_DEFAULT_SCHEMA`,
    expected: true,
    envValue: env[`${envPrefix}_DEFAULT_SCHEMA`],
    fallbackValue: fallbackConfig && fallbackConfig.defaultSchema,
    required: false,
    hint: requiredLabelPrefix || 'APPDATA',
  });
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
      requiredLabelPrefix: 'APPDATA',
    });
  }

  if (profileHasMetadataDb) {
    addDbEnvironmentChecks(checks, {
      env,
      envPrefix: 'ZEUS_METADATA_DB',
      fallbackConfig: analyzeConfig && analyzeConfig.dbRoles ? analyzeConfig.dbRoles.metadata : {},
      requiredLabelPrefix: 'APPDATA',
    });
  }

  if (profileHasTestDataDb) {
    addDbEnvironmentChecks(checks, {
      env,
      envPrefix: 'ZEUS_TESTDATA_DB',
      fallbackConfig: analyzeConfig && analyzeConfig.dbRoles ? analyzeConfig.dbRoles.testData : {},
      requiredLabelPrefix: 'APPDATA',
    });
  }

  if (profileHasFetch) {
    addEnvCheck(checks, {
      name: 'ZEUS_FETCH_HOST',
      expected: true,
      envValue: env.ZEUS_FETCH_HOST,
      fallbackValue: fetchProfile.host,
      required: true,
      hint: 'mein-ibmi-host',
    });
    addEnvCheck(checks, {
      name: 'ZEUS_FETCH_USER',
      expected: true,
      envValue: env.ZEUS_FETCH_USER,
      fallbackValue: fetchProfile.user,
      required: true,
      hint: 'MEINUSER',
    });
    addEnvCheck(checks, {
      name: 'ZEUS_FETCH_PASSWORD',
      expected: true,
      envValue: env.ZEUS_FETCH_PASSWORD,
      fallbackValue: fetchProfile.password,
      required: true,
      hint: 'mein-passwort',
    });
    addEnvCheck(checks, {
      name: 'ZEUS_FETCH_SOURCE_LIB',
      expected: true,
      envValue: env.ZEUS_FETCH_SOURCE_LIB,
      fallbackValue: fetchProfile.sourceLib,
      required: true,
      hint: 'SOURCEN',
    });
    addEnvCheck(checks, {
      name: 'ZEUS_FETCH_IFS_DIR',
      expected: true,
      envValue: env.ZEUS_FETCH_IFS_DIR,
      fallbackValue: fetchProfile.ifsDir,
      required: true,
      hint: '/home/zeus/rpg_sources',
    });
    addEnvCheck(checks, {
      name: 'ZEUS_FETCH_OUT',
      expected: true,
      envValue: env.ZEUS_FETCH_OUT,
      fallbackValue: fetchProfile.out,
      required: true,
      hint: 'C:/Projekte/ticket/zeus-fetch',
    });
  }

  addEnvCheck(checks, {
    name: 'ZEUS_OUTPUT_ROOT',
    expected: true,
    envValue: env.ZEUS_OUTPUT_ROOT,
    fallbackValue: profile && profile.outputRoot,
    required: false,
    hint: 'C:/Projekte/ticket/zeus-output',
  });
  addEnvCheck(checks, {
    name: 'ZEUS_SOURCE_ROOT',
    expected: true,
    envValue: env.ZEUS_SOURCE_ROOT,
    fallbackValue: profile && profile.sourceRoot,
    required: false,
    hint: 'C:/Projekte/ticket/zeus-source',
  });

  return checks;
}

function runDoctorChecks(args, { cwd = process.cwd(), env = process.env } = {}) {
  const checks = [];
  let hasCriticalFailure = false;
  let resolvedAnalyzeConfig = null;
  let resolvedFetchConfig = null;
  let resolvedProfile = null;

  if (!args.profile || !String(args.profile).trim()) {
    throw new Error('Missing required option: --profile <name>');
  }

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
    checks.push({
      name: 'Config/Profile',
      status: 'FAIL',
      details: error.message,
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
  } else {
    try {
      const metadataDbConfig = resolveAnalyzeDbConfig(resolvedAnalyzeConfig, 'metadata');
      runReadOnlyDb2Query({
        dbConfig: metadataDbConfig,
        query: 'SELECT 1 AS HEALTHCHECK FROM SYSIBM.SYSDUMMY1',
        maxRows: 1,
      });
      checks.push({
        name: 'JDBC Metadata',
        status: 'PASS',
        details: `Read-only query succeeded${resolveDefaultSchema(metadataDbConfig) ? ` (default schema ${resolveDefaultSchema(metadataDbConfig)})` : ''}.`,
      });
    } catch (error) {
      hasCriticalFailure = true;
      checks.push({
        name: 'JDBC Metadata',
        status: 'FAIL',
        details: error.message,
      });
    }
  }

  // IBM i OS-Version Check
  if (resolvedAnalyzeConfig && isDbConfigured(resolveAnalyzeDbConfig(resolvedAnalyzeConfig, 'metadata'))) {
    try {
      const metadataDbConfig = resolveAnalyzeDbConfig(resolvedAnalyzeConfig, 'metadata');
      const versionInfo = getIbmiOsVersion(metadataDbConfig);
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

  const hasExplicitTestDataRole = Boolean(
    (resolvedProfile && resolvedProfile.dbRoles && resolvedProfile.dbRoles.testData)
    || env.ZEUS_TESTDATA_DB_HOST
    || env.ZEUS_TESTDATA_DB_URL
    || env.ZEUS_TESTDATA_DB_USER
    || env.ZEUS_TESTDATA_DB_PASSWORD !== undefined,
  );

  if (resolvedAnalyzeConfig && hasExplicitTestDataRole) {
    const testDataDbConfig = resolveAnalyzeDbConfig(resolvedAnalyzeConfig, 'testData');
    if (!isDbConfigured(testDataDbConfig)) {
      checks.push({
        name: 'JDBC Test Data',
        status: 'SKIP',
        details: 'Test-data DB2 credentials are not fully configured.',
      });
    } else {
      try {
        runReadOnlyDb2Query({
          dbConfig: testDataDbConfig,
          query: 'SELECT 1 AS HEALTHCHECK FROM SYSIBM.SYSDUMMY1',
          maxRows: 1,
        });
        checks.push({
          name: 'JDBC Test Data',
          status: 'PASS',
          details: `Read-only query succeeded${resolveDefaultSchema(testDataDbConfig) ? ` (default schema ${resolveDefaultSchema(testDataDbConfig)})` : ''}.`,
        });
      } catch (error) {
        hasCriticalFailure = true;
        checks.push({
          name: 'JDBC Test Data',
          status: 'FAIL',
          details: error.message,
        });
      }
    }
  }

  return {
    checks,
    hasCriticalFailure,
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
      const dbConfig = resolvedAnalyzeConfig && resolvedAnalyzeConfig.db;
      const jdbcUrl = dbConfig ? buildJdbcUrl(dbConfig, resolveDefaultSchema(dbConfig)) : '(nicht konfiguriert)';
      resolvedChecks.push({ name: 'db.host', status: 'INFO', details: (dbConfig && dbConfig.host) || '(leer)' });
      resolvedChecks.push({ name: 'db.user', status: 'INFO', details: (dbConfig && dbConfig.user) || '(leer)' });
      resolvedChecks.push({ name: 'db.defaultLibrary', status: 'INFO', details: (dbConfig && dbConfig.defaultLibrary) || '(leer)' });
      resolvedChecks.push({ name: 'JDBC URL', status: 'INFO', details: jdbcUrl });

      // CURRENT_SERVER Sanity-Check
      const { isDbConfigured } = require('../../db2/db2Config');
      const { runReadOnlyDb2Query } = require('../../db2/readOnlyQueryService');
      const { getIbmiOsVersion } = require('../../db2/ibmiPlatformInfo');
      if (dbConfig && isDbConfigured(dbConfig)) {
        try {
          const serverResult = runReadOnlyDb2Query({
            dbConfig,
            query: 'SELECT CURRENT_SERVER AS SYS FROM SYSIBM.SYSDUMMY1',
            maxRows: 1,
          });
          const currentServer = serverResult.rows && serverResult.rows[0] && (serverResult.rows[0].SYS || serverResult.rows[0].sys || Object.values(serverResult.rows[0])[0]);
          const configuredHost = String(dbConfig.host || '').toUpperCase();
          const reportedServer = String(currentServer || '').trim().toUpperCase();
          const mismatch = configuredHost && reportedServer && configuredHost !== reportedServer;
          resolvedChecks.push({
            name: 'CURRENT_SERVER',
            status: mismatch ? 'WARN' : 'PASS',
            details: mismatch
              ? `System meldet "${reportedServer}" — konfiguriert ist "${configuredHost}". Prüfe ob der Hostname korrekt ist!`
              : `${reportedServer} ✓`,
          });
        } catch (err) {
          resolvedChecks.push({ name: 'CURRENT_SERVER', status: 'WARN', details: `Konnte nicht abgefragt werden: ${err.message}` });
        }

        // IBM i OS-Version anzeigen
        try {
          const versionInfo = getIbmiOsVersion(dbConfig);
          resolvedChecks.push({
            name: 'IBM i OS-Version',
            status: 'INFO',
            details: versionInfo.versionString,
          });
        } catch (_err) {
          resolvedChecks.push({ name: 'IBM i OS-Version', status: 'WARN', details: 'Nicht ermittelbar' });
        }
      }

      // productionSystem-Warnung
      const profObj = resolvedProfile || {};
      if (profObj.productionSystem) {
        resolvedChecks.push({ name: 'Produktionssystem', status: 'WARN', details: 'Dieses Profil ist als productionSystem=true markiert!' });
      }
    } catch (err) {
      resolvedChecks.push({ name: 'show-resolved', status: 'FAIL', details: err.message });
    }

    console.log('\n--- Aufgelöste Verbindung ---');
    console.log(renderAsciiTable(
      ['Status', 'Parameter', 'Wert'],
      resolvedChecks.map((c) => [formatStatus(c.status), c.name, c.details]),
    ));
  }

  console.log(renderAsciiTable(
    ['Status', 'Check', 'Details'],
    result.checks.map((check) => [formatStatus(check.status), check.name, check.details]),
  ));

  if (result.hasCriticalFailure) {
    process.exit(1);
  }
}

module.exports = {
  buildEnvironmentChecks,
  runDoctor,
  runDoctorChecks,
};
