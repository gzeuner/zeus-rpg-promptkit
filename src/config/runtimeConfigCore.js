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

const {
  attachConnectionTargetMetadata,
  buildConnectionTargetMetadata,
} = require('./connectionTargetMetadata');

/**
 * Löst `systems`-Referenzen in einem Profil auf.
 *
 * Wenn ein Profil einen `systems`-Block definiert, können `db`, `dbRoles.*`
 * und `fetch` statt konkreter Verbindungsparameter eine Referenz der Form
 * `{ "system": "<name>", ...overrides }` enthalten.
 *
 * Beispiel:
 *   systems: { test: { host: "DERSMT1", ... }, prod: { host: "DERSMP1", ... } }
 *   dbRoles.metadata: { "system": "prod" }
 *   → dbRoles.metadata wird zur vollständigen prod-Verbindung aufgelöst
 *
 * Overrides innerhalb der Referenz (neben `system`) werden auf die System-Basis
 * aufgesetzt, z. B. { "system": "prod", "defaultSchema": "SONDERLIB" }.
 *
 * Idempotent: Profile ohne `systems`-Block werden unverändert zurückgegeben.
 */
function resolveSystemReferences(profile) {
  const systems = profile && profile.systems;
  if (!systems || !isPlainObject(systems)) return profile;

  function resolveRef(obj) {
    if (!obj || !isPlainObject(obj) || typeof obj.system !== 'string') return obj;
    const sysName = obj.system;
    const sysDef = systems[sysName];
    if (!sysDef) {
      throw new Error(
        `Profil referenziert unbekanntes System "${sysName}". Verfügbare Systeme: ${Object.keys(systems).join(', ')}`,
      );
    }
    const { system: _removed, ...overrides } = obj;
    // Leere Strings und null aus dem Override-Set entfernen: diese entstehen durch
    // env-Placeholder-Expansion nicht gesetzter Variablen aus geerbten Profil-Blöcken
    // (z. B. default-shared) und sollen die System-Definition nicht überschreiben.
    const cleanOverrides = Object.fromEntries(
      Object.entries(overrides).filter(([, v]) => v !== null && v !== undefined && v !== ''),
    );
    const {
      displayName: _displayName,
      systemName: _systemName,
      aliases: _aliases,
      ...systemConnectionFields
    } = sysDef;
    const resolved = { ...systemConnectionFields, ...cleanOverrides };
    return attachConnectionTargetMetadata(resolved, buildConnectionTargetMetadata({
      systemKey: sysName,
      systemDefinition: sysDef,
      resolvedConfig: resolved,
    }));
  }

  const result = { ...profile };
  if (result.db) result.db = resolveRef(result.db);
  if (result.dbRoles && isPlainObject(result.dbRoles)) {
    result.dbRoles = Object.fromEntries(
      Object.entries(result.dbRoles).map(([role, cfg]) => [role, resolveRef(cfg)]),
    );
  }
  if (result.fetch && isPlainObject(result.fetch) && typeof result.fetch.system === 'string') {
    result.fetch = resolveRef(result.fetch);
  }
  return result;
}

function mergeConfigLayers(baseValue, overrideValue) {
  if (overrideValue === undefined) {
    if (Array.isArray(baseValue)) return [...baseValue];
    if (isPlainObject(baseValue)) {
      return Object.fromEntries(Object.entries(baseValue).map(([key, value]) => [key, mergeConfigLayers(value, undefined)]));
    }
    return baseValue;
  }

  if (Array.isArray(overrideValue)) {
    return [...overrideValue];
  }

  if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
    const keys = new Set([...Object.keys(baseValue), ...Object.keys(overrideValue)]);
    const merged = {};
    for (const key of keys) {
      merged[key] = mergeConfigLayers(baseValue[key], overrideValue[key]);
    }
    return merged;
  }

  if (isPlainObject(overrideValue)) {
    return Object.fromEntries(Object.entries(overrideValue).map(([key, value]) => [key, mergeConfigLayers(undefined, value)]));
  }

  return overrideValue;
}

module.exports = {
  mergeConfigLayers,
  resolveSystemReferences,
};
