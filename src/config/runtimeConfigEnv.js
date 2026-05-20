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
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
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

module.exports = {
  applyDbEnvOverrides,
  parseBoolean,
  parseCsv,
  resolveEnvPlaceholdersDeep,
};
