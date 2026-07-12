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
const { resolveSecretValue } = require('../security/secretVault');

const RUNTIME_CONFIG_METADATA_KEY = Symbol('zeus.runtimeConfigMetadata');

const DB_FIELD_SPECS = Object.freeze([
  Object.freeze({
    id: 'url',
    keys: Object.freeze(['url']),
    envSuffixes: Object.freeze(['URL']),
    warnOnConflict: true,
  }),
  Object.freeze({
    id: 'host',
    keys: Object.freeze(['host']),
    envSuffixes: Object.freeze(['HOST']),
    warnOnConflict: true,
  }),
  Object.freeze({
    id: 'user',
    keys: Object.freeze(['user']),
    envSuffixes: Object.freeze(['USER']),
    warnOnConflict: false,
  }),
  Object.freeze({
    id: 'password',
    keys: Object.freeze(['password']),
    envSuffixes: Object.freeze(['PASSWORD']),
    secret: true,
    warnOnConflict: false,
  }),
  Object.freeze({
    id: 'defaultSchema',
    keys: Object.freeze(['defaultSchema', 'defaultLibrary', 'schema', 'library']),
    envSuffixes: Object.freeze(['DEFAULT_SCHEMA', 'DEFAULT_LIBRARY', 'SCHEMA', 'LIBRARY']),
    writeKey: 'defaultSchema',
    warnOnConflict: false,
  }),
]);

function createRuntimeConfigMetadata(scope, prefix) {
  return {
    kind: 'db-runtime-config',
    scope,
    prefix,
    fields: {},
    warnings: [],
  };
}

function cloneRuntimeConfigMetadata(metadata, scope, prefix) {
  const base =
    metadata && typeof metadata === 'object'
      ? metadata
      : createRuntimeConfigMetadata(scope, prefix);

  return {
    kind: 'db-runtime-config',
    scope: base.scope || scope,
    prefix: base.prefix || prefix,
    fields: Object.fromEntries(
      Object.entries(base.fields || {}).map(([key, value]) => [key, value ? { ...value } : value])
    ),
    warnings: Array.isArray(base.warnings) ? base.warnings.map(warning => ({ ...warning })) : [],
  };
}

function attachRuntimeConfigMetadata(target, metadata) {
  if (!target || typeof target !== 'object') {
    return target;
  }
  Object.defineProperty(target, RUNTIME_CONFIG_METADATA_KEY, {
    value: metadata,
    enumerable: false,
    configurable: true,
    writable: false,
  });
  return target;
}

function getRuntimeConfigMetadata(target) {
  if (!target || typeof target !== 'object') {
    return null;
  }
  return target[RUNTIME_CONFIG_METADATA_KEY] || null;
}

function extractEnvPlaceholder(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const match = value.trim().match(/^\$\{env:([A-Z0-9_]+)\}$/i);
  return match ? String(match[1]).toUpperCase() : '';
}

function normalizeComparableValue(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function valuesConflict(left, right) {
  return normalizeComparableValue(left) !== normalizeComparableValue(right);
}

function hasOwn(config, key) {
  return Boolean(config) && Object.prototype.hasOwnProperty.call(config, key);
}

function getPresentFieldEntry(config, spec) {
  if (!config || typeof config !== 'object') {
    return null;
  }
  for (const key of spec.keys) {
    if (hasOwn(config, key)) {
      return {
        key,
        value: config[key],
      };
    }
  }
  return null;
}

function getEnvOverride(env, prefix, spec) {
  for (const suffix of spec.envSuffixes) {
    const envKey = `${prefix}_${suffix}`;
    if (suffix === 'PASSWORD') {
      if (Object.prototype.hasOwnProperty.call(env, envKey)) {
        return { envKey, value: resolveSecretValue(env[envKey], { env }) };
      }
      continue;
    }
    if (env[envKey]) {
      return { envKey, value: resolveSecretValue(env[envKey], { env }) };
    }
  }
  return null;
}

function applyProfileFieldOrigins(metadata, rawProfileConfig, resolvedProfileConfig, scopeLabel) {
  for (const spec of DB_FIELD_SPECS) {
    const rawEntry = getPresentFieldEntry(rawProfileConfig, spec);
    if (!rawEntry) {
      continue;
    }
    const resolvedEntry = getPresentFieldEntry(resolvedProfileConfig, spec);
    const placeholderEnvKey = extractEnvPlaceholder(rawEntry.value);
    metadata.fields[spec.id] = {
      origin: placeholderEnvKey ? 'profile-env-placeholder' : 'profile',
      value: resolvedEntry ? resolvedEntry.value : rawEntry.value,
      profileField: scopeLabel ? `${scopeLabel}.${rawEntry.key}` : rawEntry.key,
      placeholderEnvKey,
      secret: Boolean(spec.secret),
    };
  }
}

function applyEnvOverridesWithMetadata(resolvedConfig, metadata, env, prefix) {
  for (const spec of DB_FIELD_SPECS) {
    const override = getEnvOverride(env, prefix, spec);
    if (!override) {
      continue;
    }

    const previous = metadata.fields[spec.id] || null;
    const delegatedByProfile =
      previous &&
      previous.origin === 'profile-env-placeholder' &&
      previous.placeholderEnvKey === override.envKey;

    resolvedConfig[spec.writeKey || spec.keys[0]] = override.value;

    if (
      previous &&
      previous.origin === 'profile' &&
      spec.warnOnConflict &&
      valuesConflict(previous.value, override.value)
    ) {
      metadata.warnings.push({
        kind: 'env-profile-conflict',
        scope: metadata.scope,
        field: spec.id,
        envKey: override.envKey,
        envValue: override.value,
        profileField: previous.profileField || spec.keys[0],
        profileValue: previous.value,
      });
    }

    metadata.fields[spec.id] = {
      origin: delegatedByProfile ? 'profile-env-placeholder' : 'env',
      value: override.value,
      envKey: override.envKey,
      profileField: previous ? previous.profileField || '' : '',
      placeholderEnvKey: delegatedByProfile ? previous.placeholderEnvKey : '',
      secret: Boolean(spec.secret),
    };
  }
}

function buildResolvedDbConfig({
  baseConfig = null,
  baseMetadata = null,
  profileConfig = null,
  rawProfileConfig = null,
  env = process.env,
  prefix = 'ZEUS_DB',
  scope = 'db',
  mergeConfigLayers = null,
} = {}) {
  const merged =
    typeof mergeConfigLayers === 'function'
      ? mergeConfigLayers(baseConfig || {}, profileConfig || undefined)
      : { ...(baseConfig || {}), ...(profileConfig || {}) };
  const metadata = cloneRuntimeConfigMetadata(baseMetadata, scope, prefix);

  applyProfileFieldOrigins(metadata, rawProfileConfig, profileConfig, scope);
  applyEnvOverridesWithMetadata(merged, metadata, env, prefix);

  if (Object.keys(merged).length === 0) {
    return null;
  }

  return attachRuntimeConfigMetadata(merged, metadata);
}

module.exports = {
  attachRuntimeConfigMetadata,
  buildResolvedDbConfig,
  getRuntimeConfigMetadata,
};
