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
const { getRuntimeConfigMetadata } = require('../../config/dbRuntimeConfigDiagnostics');

function getDbRuntimeConflictWarnings(dbConfig) {
  const metadata = getRuntimeConfigMetadata(dbConfig);
  return Array.isArray(metadata && metadata.warnings)
    ? metadata.warnings.filter((warning) => warning && warning.kind === 'env-profile-conflict')
    : [];
}

function printDbRuntimeConflictWarnings(dbConfig, {
  writeLine = (line) => console.warn(line),
} = {}) {
  const warnings = getDbRuntimeConflictWarnings(dbConfig);
  if (warnings.length === 0) {
    return warnings;
  }

  writeLine('[WARN] Runtime config mismatch detected: environment overrides the selected profile target.');
  for (const warning of warnings) {
    writeLine(
      `[WARN] ${warning.envKey}="${warning.envValue}" overrides ${warning.profileField}="${warning.profileValue}". `
      + 'Verify the target system before running DB commands.',
    );
  }
  writeLine('[WARN] Tip: run `zeus doctor --profile <name> --show-resolved` for resolved origins.');
  return warnings;
}

function summarizeTargetValue(path, value) {
  const normalizedPath = String(path || '').trim().toLowerCase();
  const normalizedValue = String(value === undefined || value === null ? '' : value).trim();
  if (!normalizedValue) {
    return '';
  }

  if (!normalizedPath.endsWith('.url')) {
    return normalizedValue;
  }

  const jdbcPrefix = normalizedValue.match(/^jdbc:as400:\/\/([^;]+)/i);
  if (jdbcPrefix && jdbcPrefix[1]) {
    const authority = String(jdbcPrefix[1]).trim();
    const withoutCredentials = authority.includes('@')
      ? authority.slice(authority.lastIndexOf('@') + 1)
      : authority;
    const host = withoutCredentials.split(/[/:?#]/)[0];
    if (host) {
      return host;
    }
  }
  return '(redacted jdbc url)';
}

function buildEnvProfileConflictMessage({
  profile,
  path,
  profileValue,
  envVar,
  effectiveValue,
}) {
  const profileLabel = String(profile || '').trim() || 'selected profile';
  const pathLabel = String(path || '').trim() || 'db target';
  const environmentLabel = String(envVar || '').trim() || 'environment override';
  const profileValueLabel = String(profileValue || '').trim();
  const effectiveValueLabel = String(effectiveValue || '').trim();

  const profileText = profileValueLabel
    ? `"${profileValueLabel}"`
    : 'a configured target';
  const effectiveText = effectiveValueLabel
    ? `"${effectiveValueLabel}"`
    : 'a runtime override';

  return `Profile "${profileLabel}" declares ${pathLabel}=${profileText}, but ${environmentLabel} overrides it with ${effectiveText}. Env vars have precedence.`;
}

function buildDbRuntimeConflictDiagnostics(dbConfig, {
  profile = '',
} = {}) {
  const warnings = getDbRuntimeConflictWarnings(dbConfig);
  const seen = new Set();
  const diagnostics = [];

  for (const warning of warnings) {
    const scope = String(warning && warning.scope || 'db').trim() || 'db';
    const field = String(warning && warning.field || '').trim() || 'host';
    const path = `${scope}.${field}`;
    const profileValue = summarizeTargetValue(path, warning && warning.profileValue);
    const effectiveValue = summarizeTargetValue(path, warning && warning.envValue);
    const envVar = String(warning && warning.envKey || '').trim();
    const key = ['ENV_PROFILE_CONFLICT', path, envVar, effectiveValue].join('|');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    diagnostics.push({
      code: 'ENV_PROFILE_CONFLICT',
      severity: 'WARN',
      path,
      profile: String(profile || '').trim(),
      profileValue,
      envVar,
      effectiveValue,
      message: buildEnvProfileConflictMessage({
        profile,
        path,
        profileValue,
        envVar,
        effectiveValue,
      }),
    });
  }

  return diagnostics;
}

module.exports = {
  buildDbRuntimeConflictDiagnostics,
  buildEnvProfileConflictMessage,
  getDbRuntimeConflictWarnings,
  printDbRuntimeConflictWarnings,
  summarizeTargetValue,
};
