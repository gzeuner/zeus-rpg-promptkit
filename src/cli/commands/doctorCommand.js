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
const { spawnSync } = require('child_process');
const {
  getProfilesMetadata,
  loadProfiles,
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
const { renderAsciiTable } = require('../helpers/asciiTable');

function formatStatus(status) {
  if (status === 'PASS') return '[PASS]';
  if (status === 'FAIL') return '[FAIL]';
  if (status === 'WARN') return '[WARN]';
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

function buildEnvironmentChecks({ profile, analyzeConfig, fetchConfig, env }) {
  const checks = [];
  const profileHasDb = Boolean(profile && profile.db);
  const profileHasFetch = Boolean(profile && profile.fetch);
  const dbUsesUrl = isSet(env.ZEUS_DB_URL);
  const dbProfile = profile && profile.db ? profile.db : {};
  const fetchProfile = profile && profile.fetch ? profile.fetch : {};

  if (profileHasDb) {
    addEnvCheck(checks, {
      name: 'ZEUS_DB_URL',
      expected: true,
      envValue: env.ZEUS_DB_URL,
      fallbackValue: dbProfile.url,
      required: false,
      hint: 'jdbc:as400://mein-ibmi-host;naming=system;libraries=DATEIEN',
    });
    addEnvCheck(checks, {
      name: 'ZEUS_DB_HOST',
      expected: true,
      envValue: env.ZEUS_DB_HOST,
      fallbackValue: dbProfile.host,
      required: !dbUsesUrl,
      hint: 'mein-ibmi-host',
    });
    addEnvCheck(checks, {
      name: 'ZEUS_DB_USER',
      expected: true,
      envValue: env.ZEUS_DB_USER,
      fallbackValue: dbProfile.user,
      required: true,
      hint: 'MEINUSER',
    });
    addEnvCheck(checks, {
      name: 'ZEUS_DB_PASSWORD',
      expected: true,
      envValue: env.ZEUS_DB_PASSWORD,
      fallbackValue: dbProfile.password,
      required: true,
      hint: 'mein-passwort',
    });
    addEnvCheck(checks, {
      name: 'ZEUS_DB_DEFAULT_LIBRARY',
      expected: true,
      envValue: env.ZEUS_DB_DEFAULT_LIBRARY,
      fallbackValue: dbProfile.defaultLibrary,
      required: false,
      hint: 'DATEIEN',
    });
    addEnvCheck(checks, {
      name: 'ZEUS_DB_DEFAULT_SCHEMA',
      expected: true,
      envValue: env.ZEUS_DB_DEFAULT_SCHEMA,
      fallbackValue: dbProfile.defaultSchema,
      required: false,
      hint: 'DATEIEN',
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
      details: `Loaded profile "${args.profile}" from ${(metadata && metadata.sourceFileLabel) || 'config/profiles.json'}`,
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
  } else if (!isDbConfigured(resolvedAnalyzeConfig.db)) {
    checks.push({
      name: 'JDBC',
      status: 'SKIP',
      details: 'DB2 credentials are not fully configured.',
    });
  } else {
    try {
      runReadOnlyDb2Query({
        dbConfig: resolvedAnalyzeConfig.db,
        query: 'SELECT 1 AS HEALTHCHECK FROM SYSIBM.SYSDUMMY1',
        maxRows: 1,
      });
      checks.push({
        name: 'JDBC',
        status: 'PASS',
        details: `Read-only query succeeded${resolveDefaultSchema(resolvedAnalyzeConfig.db) ? ` (default schema ${resolveDefaultSchema(resolvedAnalyzeConfig.db)})` : ''}.`,
      });
    } catch (error) {
      hasCriticalFailure = true;
      checks.push({
        name: 'JDBC',
        status: 'FAIL',
        details: error.message,
      });
    }
  }

  return {
    checks,
    hasCriticalFailure,
  };
}

async function runDoctor(args) {
  const result = runDoctorChecks(args);
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
