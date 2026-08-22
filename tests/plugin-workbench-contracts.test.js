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

const assert = require('assert');
const test = require('node:test');

const {
  applyPluginAllowlist,
  buildPluginCatalog,
  buildLivePluginCatalog,
  normalizePluginDescriptor,
  summarizePluginCatalog,
  validatePluginCatalog,
} = require('../src/ui/pluginWorkbenchContracts');

const descriptors = [
  {
    kind: 'theme',
    id: 'quiet-light',
    label: 'Quiet Light',
    tags: ['ui', 'ui'],
  },
  {
    kind: 'command',
    id: 'read-context',
    capabilities: ['scope', 'evidence', 'scope'],
  },
  { kind: 'role', id: 'developer', requires: ['evidence'] },
  { kind: 'workflow', id: 'evidence-review', requires: ['read-context'] },
];

test('normalizes plugin metadata without enabling execution', () => {
  const plugin = normalizePluginDescriptor(descriptors[0]);
  assert.deepEqual(plugin.tags, ['ui']);
  assert.equal(plugin.execution, 'declarative-only');
  assert.equal(plugin.telemetry, 'disabled');
  assert.equal(normalizePluginDescriptor({ kind: 'command', id: 'Invalid ID' }), null);
});

test('builds a deterministic, deduplicated catalog across all neutral kinds', () => {
  const catalog = buildPluginCatalog([...descriptors, descriptors[1], null]);
  assert.deepEqual(
    catalog.plugins.map(plugin => `${plugin.kind}:${plugin.id}`),
    ['command:read-context', 'workflow:evidence-review', 'role:developer', 'theme:quiet-light']
  );
  assert.deepEqual(validatePluginCatalog(catalog), []);
  assert.equal(catalog.localOnly, true);
  assert.equal(catalog.executable, false);
});

test('allowlist returns only explicitly selected plugins and remains deterministic', () => {
  const catalog = buildPluginCatalog(descriptors);
  const filtered = applyPluginAllowlist(catalog, ['theme:quiet-light', 'developer', 'developer']);
  assert.deepEqual(
    filtered.plugins.map(plugin => plugin.id),
    ['developer', 'quiet-light']
  );
  assert.deepEqual(summarizePluginCatalog(filtered), {
    schemaVersion: 1,
    total: 2,
    byKind: { command: 0, workflow: 0, role: 1, theme: 1 },
    allowlistKeys: ['role:developer', 'theme:quiet-light'],
  });
});

test('builds the live catalog from command, workflow, role, and theme metadata', () => {
  const catalog = buildLivePluginCatalog({
    commands: [{ name: 'doctor', title: 'Doctor', summary: 'Check readiness', category: 'setup' }],
    workflows: [{ id: 'configure', title: 'Setup', description: 'Configure locally' }],
    roles: [{ id: 'developer', label: 'Developer', description: 'Build safely' }],
    themes: [{ id: 'local-default', label: 'Local Default', description: 'Neutral theme' }],
  });
  assert.deepEqual(
    catalog.plugins.map(plugin => plugin.allowlistKey),
    ['command:doctor', 'workflow:configure', 'role:developer', 'theme:local-default']
  );
  assert.deepEqual(validatePluginCatalog(catalog), []);
  assert.equal(catalog.executable, false);
  assert.equal(catalog.telemetry, 'disabled');
  const workflowRun = buildLivePluginCatalog({
    commands: [{ name: 'workflow run', title: 'Workflow Run' }],
  });
  assert.equal(workflowRun.plugins[0].id, 'workflow-run');
  assert.equal(workflowRun.plugins[0].allowlistKey, 'command:workflow-run');
  const filtered = buildLivePluginCatalog({
    commands: [{ name: 'doctor' }, { name: 'analyze' }],
    allowlist: ['command:doctor'],
  });
  assert.deepEqual(
    filtered.plugins.map(plugin => plugin.id),
    ['doctor']
  );
});

test('catalog validation rejects execution and telemetry claims', () => {
  const catalog = buildPluginCatalog(descriptors);
  const invalid = {
    ...catalog,
    plugins: [{ ...catalog.plugins[0], execution: 'run-code', telemetry: 'enabled' }],
  };
  assert.deepEqual(validatePluginCatalog(invalid), [
    'command:read-context may not execute',
    'command:read-context may not emit telemetry',
  ]);
});
