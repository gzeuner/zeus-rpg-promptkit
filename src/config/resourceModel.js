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

/**
 * Resource model resolver.
 *
 * A "resource" describes WHERE a class of artefacts lives for a profile and
 * (optionally) on WHICH system. Four canonical resource kinds are supported so
 * that a single profile can cleanly separate the locations of:
 *
 *   - sourceCode : libraries + source physical files (QRPGLESRC, ...) + members + IFS paths
 *   - objects    : libraries holding compiled objects + object types (*PGM, *SRVPGM, ...)
 *   - metadata   : database schemas used for catalog / metadata reads
 *   - data       : database schemas used for business / sample data reads
 *
 * Each resource can reference a named entry from the profile `systems` block,
 * inherit system-level resource defaults, and override scope lists locally.
 *
 * The model is fully backward compatible: profiles WITHOUT a `resources` block
 * have an equivalent model derived from the legacy `fetch` / `db` / `dbRoles`
 * configuration, so single-system setups keep working unchanged.
 *
 * The resolved model is sanitized (never contains user/password/url secrets) and
 * is therefore safe to surface through the CLI and MCP tools.
 */

const {
  getConnectionTargetMetadata,
  listConnectionTargetNames,
  extractAuthorityName,
} = require('./connectionTargetMetadata');

const RESOURCE_KINDS = Object.freeze(['sourceCode', 'objects', 'metadata', 'data']);

const RESOURCE_KIND_FIELDS = Object.freeze({
  sourceCode: Object.freeze(['libraries', 'sourceFiles', 'members', 'ifsPaths']),
  objects: Object.freeze(['libraries', 'objectTypes']),
  metadata: Object.freeze(['schemas']),
  data: Object.freeze(['schemas']),
});

// Fields whose values are IBM i object names and are normalized to UPPERCASE.
const UPPERCASE_FIELDS = new Set(['libraries', 'sourceFiles', 'members', 'objectTypes', 'schemas']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeListValue(field, value) {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  const out = [];
  const seen = new Set();
  for (const entry of list) {
    if (entry === undefined || entry === null) continue;
    let text = String(entry).trim();
    if (!text) continue;
    if (UPPERCASE_FIELDS.has(field)) {
      text = text.toUpperCase();
    }
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function firstString(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

/**
 * Builds a sanitized connection target descriptor (no secrets) from a resolved
 * connection config object (with attached connection-target metadata) and/or a
 * raw system definition.
 */
function describeTarget(connectionConfig, systemDefinition) {
  const metadata = getConnectionTargetMetadata(connectionConfig);
  const names = connectionConfig ? listConnectionTargetNames(connectionConfig) : [];
  const host = firstString(
    extractAuthorityName(connectionConfig && connectionConfig.host),
    extractAuthorityName(connectionConfig && connectionConfig.url),
    extractAuthorityName(systemDefinition && systemDefinition.host),
    extractAuthorityName(systemDefinition && systemDefinition.url),
  );
  const systemKey = firstString(metadata && metadata.systemKey, systemDefinition && systemDefinition.systemName);
  const displayName = firstString(
    metadata && metadata.displayName,
    systemDefinition && systemDefinition.displayName,
    systemDefinition && systemDefinition.systemName,
    systemKey,
    host,
  );
  const systemName = firstString(metadata && metadata.systemName, systemDefinition && systemDefinition.systemName);
  return {
    systemKey: systemKey || '',
    displayName: displayName || '',
    systemName: systemName || '',
    host: host || '',
    names: Array.isArray(names) ? names.slice() : [],
    configured: Boolean(host || systemKey),
  };
}

function schemaListFromDbConfig(dbConfig) {
  if (!isPlainObject(dbConfig)) return [];
  return normalizeListValue('schemas', [
    dbConfig.defaultSchema,
    dbConfig.schema,
    ...(Array.isArray(dbConfig.schemaPreference) ? dbConfig.schemaPreference : []),
    dbConfig.defaultLibrary,
    dbConfig.library,
  ]);
}

/**
 * Derives a baseline resource model from the legacy fetch/db/dbRoles config so
 * that profiles without an explicit `resources` block still resolve sensibly.
 */
function deriveLegacyResources(profile) {
  const fetch = isPlainObject(profile.fetch) ? profile.fetch : {};
  const db = isPlainObject(profile.db) ? profile.db : {};
  const dbRoles = isPlainObject(profile.dbRoles) ? profile.dbRoles : {};
  const metadataDb = isPlainObject(dbRoles.metadata) ? dbRoles.metadata : db;
  const testDataDb = isPlainObject(dbRoles.testData) ? dbRoles.testData : metadataDb;

  const sourceTarget = describeTarget(Object.keys(fetch).length ? fetch : null, null);
  const objectsTarget = describeTarget(Object.keys(db).length ? db : (Object.keys(fetch).length ? fetch : null), null);
  const metadataTarget = describeTarget(Object.keys(metadataDb).length ? metadataDb : null, null);
  const dataTarget = describeTarget(Object.keys(testDataDb).length ? testDataDb : null, null);

  return {
    sourceCode: {
      target: sourceTarget,
      libraries: normalizeListValue('libraries', [fetch.sourceLib, fetch.sourceLibrary]),
      sourceFiles: normalizeListValue('sourceFiles', fetch.files || fetch.sourceFiles),
      members: normalizeListValue('members', fetch.members),
      ifsPaths: normalizeListValue('ifsPaths', fetch.ifsDir),
    },
    objects: {
      target: objectsTarget,
      libraries: normalizeListValue('libraries', [
        db.defaultLibrary,
        db.library,
        fetch.sourceLib,
        fetch.sourceLibrary,
      ]),
      objectTypes: [],
    },
    metadata: {
      target: metadataTarget,
      schemas: schemaListFromDbConfig(metadataDb),
    },
    data: {
      target: dataTarget,
      schemas: schemaListFromDbConfig(testDataDb),
    },
  };
}

function resolveSystemTarget(systems, systemKey) {
  if (!systemKey) return { target: null, definition: null };
  const definition = isPlainObject(systems) && isPlainObject(systems[systemKey]) ? systems[systemKey] : null;
  if (!definition) {
    return { target: { systemKey, displayName: systemKey, systemName: '', host: '', names: [], configured: false }, definition: null };
  }
  const described = describeTarget(definition, definition);
  // The model echoes the configured systems-block key (e.g. "test"), not the
  // SYSTEM-NAME, so that it round-trips with what the user wrote in `system:`.
  const target = {
    ...described,
    systemKey,
    displayName: firstString(definition.displayName, definition.systemName, systemKey),
  };
  return { target, definition };
}

function mergeScopeLists(kind, base, ...overlays) {
  const result = {};
  for (const field of RESOURCE_KIND_FIELDS[kind]) {
    let values = Array.isArray(base && base[field]) ? base[field].slice() : [];
    for (const overlay of overlays) {
      if (!overlay) continue;
      const overlayValues = normalizeListValue(field, overlay[field]);
      if (overlayValues.length > 0) {
        values = overlayValues;
      }
    }
    result[field] = normalizeListValue(field, values);
  }
  return result;
}

function resolveResourceKind(kind, { profile, systems, declaredResources, derived }) {
  const declared = isPlainObject(declaredResources[kind]) ? declaredResources[kind] : null;
  const derivedKind = derived[kind] || {};

  // Determine the system reference: explicit on the kind, else profile-level
  // default, else the system implied by the derived (legacy) target.
  const systemKey = firstString(
    declared && declared.system,
    declaredResources.system,
    derivedKind.target && derivedKind.target.systemKey,
  );

  const { target: systemTarget, definition: systemDefinition } = resolveSystemTarget(systems, systemKey);

  // System-level resource defaults (systems.<name>.resources.<kind>).
  const systemResources = isPlainObject(systemDefinition && systemDefinition.resources)
    ? systemDefinition.resources
    : {};
  const systemResourceKind = isPlainObject(systemResources[kind]) ? systemResources[kind] : null;

  // Precedence: derived scope < system-level resource < profile-level declared.
  const scope = mergeScopeLists(kind, derivedKind, systemResourceKind, declared);

  const target = systemTarget && systemTarget.configured
    ? systemTarget
    : (derivedKind.target || { systemKey: systemKey || '', displayName: systemKey || '', systemName: '', host: '', names: [], configured: false });

  return Object.freeze({
    kind,
    system: target.systemKey || systemKey || '',
    target: Object.freeze({ ...target, names: Object.freeze((target.names || []).slice()) }),
    ...Object.fromEntries(RESOURCE_KIND_FIELDS[kind].map((field) => [field, Object.freeze(scope[field])])),
    declared: Boolean(declared),
  });
}

function summarizeSystems(systems) {
  if (!isPlainObject(systems)) return [];
  return Object.keys(systems)
    .sort()
    .map((key) => {
      const definition = isPlainObject(systems[key]) ? systems[key] : {};
      const target = describeTarget(definition, definition);
      return Object.freeze({
        key,
        displayName: firstString(definition.displayName, definition.systemName, key),
        systemName: firstString(definition.systemName),
        host: target.host,
        aliases: Object.freeze(normalizeListValue('members', definition.aliases).map((a) => a)),
        hasResources: isPlainObject(definition.resources),
      });
    });
}

/**
 * Resolves the normalized resource model for a (already system-resolved) profile.
 *
 * @param {object} profile resolved profile object (systems block retained)
 * @param {object} [options]
 * @returns {object} sanitized resource model (no secrets)
 */
function resolveResourceModel(profile, options = {}) {
  void options;
  const safeProfile = isPlainObject(profile) ? profile : {};
  const systems = isPlainObject(safeProfile.systems) ? safeProfile.systems : {};
  const declaredResources = isPlainObject(safeProfile.resources) ? safeProfile.resources : {};
  const derived = deriveLegacyResources(safeProfile);

  const resources = {};
  for (const kind of RESOURCE_KINDS) {
    resources[kind] = resolveResourceKind(kind, { profile: safeProfile, systems, declaredResources, derived });
  }

  const systemKeysInUse = new Set();
  for (const kind of RESOURCE_KINDS) {
    const key = resources[kind].system;
    if (key) systemKeysInUse.add(key);
  }

  return Object.freeze({
    kind: 'resource-model',
    schemaVersion: 1,
    hasExplicitResources: Object.keys(declaredResources).length > 0,
    multiSystem: systemKeysInUse.size > 1 || Object.keys(systems).length > 1,
    systems: Object.freeze(summarizeSystems(systems)),
    systemsInUse: Object.freeze(Array.from(systemKeysInUse).sort()),
    resources: Object.freeze(resources),
  });
}

module.exports = {
  RESOURCE_KINDS,
  RESOURCE_KIND_FIELDS,
  resolveResourceModel,
  deriveLegacyResources,
  describeTarget,
  schemaListFromDbConfig,
  normalizeListValue,
};
