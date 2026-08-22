/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

const PLUGIN_CONTRACT_SCHEMA_VERSION = 1;
const PLUGIN_KINDS = Object.freeze(['command', 'workflow', 'role', 'theme']);
const PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

const KIND_ORDER = Object.freeze({ command: 0, workflow: 1, role: 2, theme: 3 });

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeList(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(normalizeText).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right)
  );
}

function normalizePluginDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) return null;
  const kind = normalizeText(descriptor.kind).toLowerCase();
  const id = normalizeText(descriptor.id).toLowerCase();
  if (!PLUGIN_KINDS.includes(kind) || !PLUGIN_ID_PATTERN.test(id)) return null;

  return Object.freeze({
    id,
    kind,
    label: normalizeText(descriptor.label) || id,
    description: normalizeText(descriptor.description),
    version: normalizeText(descriptor.version) || '1.0.0',
    capabilities: normalizeList(descriptor.capabilities),
    requires: normalizeList(descriptor.requires),
    tags: normalizeList(descriptor.tags),
    allowlistKey: normalizeText(descriptor.allowlistKey) || `${kind}:${id}`,
    execution: 'declarative-only',
    telemetry: 'disabled',
  });
}

function sortPluginDescriptors(descriptors) {
  return [...descriptors].sort(
    (left, right) =>
      (KIND_ORDER[left.kind] ?? Number.MAX_SAFE_INTEGER) -
        (KIND_ORDER[right.kind] ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id)
  );
}

function buildPluginCatalog(descriptors = []) {
  const unique = new Map();
  for (const descriptor of Array.isArray(descriptors) ? descriptors : []) {
    const normalized = normalizePluginDescriptor(descriptor);
    if (normalized) unique.set(`${normalized.kind}:${normalized.id}`, normalized);
  }
  const plugins = sortPluginDescriptors(unique.values());
  return Object.freeze({
    schemaVersion: PLUGIN_CONTRACT_SCHEMA_VERSION,
    localOnly: true,
    executable: false,
    telemetry: 'disabled',
    plugins: Object.freeze(plugins),
  });
}

function applyPluginAllowlist(catalog, allowlist = []) {
  const allowed = new Set(normalizeList(allowlist));
  const source = catalog && Array.isArray(catalog.plugins) ? catalog.plugins : [];
  return buildPluginCatalog(
    source.filter(plugin => allowed.has(plugin.id) || allowed.has(plugin.allowlistKey))
  );
}

function validatePluginCatalog(catalog) {
  const errors = [];
  if (!catalog || typeof catalog !== 'object') return ['catalog must be an object'];
  if (catalog.schemaVersion !== PLUGIN_CONTRACT_SCHEMA_VERSION)
    errors.push(`schemaVersion must be ${PLUGIN_CONTRACT_SCHEMA_VERSION}`);
  if (catalog.localOnly !== true) errors.push('localOnly must be true');
  if (catalog.executable !== false) errors.push('executable must be false');
  if (catalog.telemetry !== 'disabled') errors.push('telemetry must be disabled');
  if (!Array.isArray(catalog.plugins)) errors.push('plugins must be an array');

  const seen = new Set();
  for (const plugin of Array.isArray(catalog.plugins) ? catalog.plugins : []) {
    if (!plugin || !PLUGIN_KINDS.includes(plugin.kind) || !PLUGIN_ID_PATTERN.test(plugin.id || ''))
      errors.push('each plugin needs a valid kind and id');
    const key = plugin && `${plugin.kind}:${plugin.id}`;
    if (seen.has(key)) errors.push(`duplicate plugin: ${key}`);
    seen.add(key);
    if (plugin && plugin.execution !== 'declarative-only') errors.push(`${key} may not execute`);
    if (plugin && plugin.telemetry !== 'disabled') errors.push(`${key} may not emit telemetry`);
  }
  return errors;
}

function summarizePluginCatalog(catalog) {
  const plugins = catalog && Array.isArray(catalog.plugins) ? catalog.plugins : [];
  return {
    schemaVersion: PLUGIN_CONTRACT_SCHEMA_VERSION,
    total: plugins.length,
    byKind: Object.fromEntries(
      PLUGIN_KINDS.map(kind => [kind, plugins.filter(plugin => plugin.kind === kind).length])
    ),
    allowlistKeys: plugins
      .map(plugin => plugin.allowlistKey)
      .sort((left, right) => left.localeCompare(right)),
  };
}

module.exports = {
  PLUGIN_CONTRACT_SCHEMA_VERSION,
  PLUGIN_KINDS,
  applyPluginAllowlist,
  buildPluginCatalog,
  normalizePluginDescriptor,
  summarizePluginCatalog,
  validatePluginCatalog,
};
