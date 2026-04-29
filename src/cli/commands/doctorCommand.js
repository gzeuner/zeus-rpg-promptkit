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

function runDoctorChecks(args, { cwd = process.cwd(), env = process.env } = {}) {
  const checks = [];
  let hasCriticalFailure = false;
  let resolvedAnalyzeConfig = null;

  if (!args.profile || !String(args.profile).trim()) {
    throw new Error('Missing required option: --profile <name>');
  }

  try {
    const profiles = loadProfiles({ cwd, env, args });
    resolveProfile(profiles, args.profile, { env });
    resolvedAnalyzeConfig = resolveAnalyzeConfig(args, { cwd, env });
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
  runDoctor,
  runDoctorChecks,
};
