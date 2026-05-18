const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  listWorkspaces,
  readWorkspaceById,
  registerWorkspace,
  resolveRegistryPath,
  touchWorkspace,
  unregisterWorkspace,
} = require('../src/workspace/analysisRegistryService');

test('resolveRegistryPath respects precedence explicit > env > profile > default', () => {
  const explicit = resolveRegistryPath({
    registryPath: './tmp/custom.json',
    cwd: '/tmp',
    env: { ZEUS_ANALYSES_REGISTRY: '/tmp/env.json' },
    profile: { analysesRegistryPath: '/tmp/profile.json' },
  });
  assert.equal(explicit, path.resolve('/tmp', './tmp/custom.json'));

  const fromEnv = resolveRegistryPath({
    cwd: '/tmp',
    env: { ZEUS_ANALYSES_REGISTRY: '/tmp/env.json' },
    profile: { analysesRegistryPath: '/tmp/profile.json' },
  });
  assert.equal(fromEnv, path.resolve('/tmp/env.json'));

  const fromProfile = resolveRegistryPath({
    cwd: '/tmp',
    env: {},
    profile: { analysesRegistryPath: '/tmp/profile.json' },
  });
  assert.equal(fromProfile, path.resolve('/tmp/profile.json'));
});

test('register/list/touch/unregister workspace lifecycle works with persisted registry', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-registry-'));
  const workspacePath = path.join(tempRoot, 'workspace-a');
  fs.mkdirSync(workspacePath, { recursive: true });

  const registryPath = path.join(tempRoot, '_registry.json');

  registerWorkspace(registryPath, {
    id: 'workspace_a',
    name: 'Workspace A',
    path: workspacePath,
    outputDir: 'output',
    sourceDir: 'rpg_sources',
  });

  const listed = listWorkspaces(registryPath);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, 'workspace_a');
  assert.equal(path.resolve(listed[0].path), path.resolve(workspacePath));

  const beforeTouch = listed[0].lastAccessedAt;
  const touched = touchWorkspace(registryPath, 'workspace_a');
  assert.equal(touched.id, 'workspace_a');
  assert.ok(Date.parse(touched.lastAccessedAt) >= Date.parse(beforeTouch));

  const found = readWorkspaceById(registryPath, 'workspace_a');
  assert.equal(found.id, 'workspace_a');
  const rawRegistryJson = fs.readFileSync(registryPath, 'utf8');
  assert.doesNotMatch(rawRegistryJson, new RegExp(workspacePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.equal(unregisterWorkspace(registryPath, 'workspace_a'), true);
  assert.equal(unregisterWorkspace(registryPath, 'workspace_a'), false);
  assert.equal(listWorkspaces(registryPath).length, 0);
});
