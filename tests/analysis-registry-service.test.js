const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  acquireRegistryLock,
  getRegistryLockPath,
  listWorkspaces,
  readWorkspaceById,
  registerWorkspace,
  resolveRegistryPath,
  touchWorkspace,
  unregisterWorkspace,
  withRegistryLock,
} = require('../src/workspace/analysisRegistryService');

function waitForChildOutput(child, marker) {
  return new Promise((resolve, reject) => {
    let output = '';
    const onData = chunk => {
      output += chunk.toString();
      if (output.includes(marker)) {
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.once('error', reject);
    child.once('exit', code => {
      if (!output.includes(marker)) {
        reject(new Error(`Lock holder exited before signaling readiness: ${code}`));
      }
    });
  });
}

function waitForChildExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code !== 0) {
        reject(new Error(`Lock holder exited unexpectedly: ${code || signal}`));
        return;
      }
      resolve();
    });
  });
}

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
  assert.doesNotMatch(
    rawRegistryJson,
    new RegExp(workspacePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  );

  assert.equal(unregisterWorkspace(registryPath, 'workspace_a'), true);
  assert.equal(unregisterWorkspace(registryPath, 'workspace_a'), false);
  assert.equal(listWorkspaces(registryPath).length, 0);
});

test('registry mutations serialize across processes and preserve both writers', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-registry-lock-'));
  const workspaceA = path.join(tempRoot, 'workspace-a');
  const workspaceB = path.join(tempRoot, 'workspace-b');
  fs.mkdirSync(workspaceA, { recursive: true });
  fs.mkdirSync(workspaceB, { recursive: true });
  const registryPath = path.join(tempRoot, '_registry.json');

  registerWorkspace(registryPath, { id: 'workspace_a', path: workspaceA });

  const servicePath = path.resolve(__dirname, '../src/workspace/analysisRegistryService.js');
  const holder = spawn(
    process.execPath,
    [
      '-e',
      [
        'const { withRegistryLock } = require(process.argv[2]);',
        'withRegistryLock(process.argv[1], () => {',
        "  process.stdout.write('LOCKED\\n');",
        '  const until = Date.now() + Number(process.argv[3]);',
        '  while (Date.now() < until) {}',
        '});',
      ].join('\n'),
      registryPath,
      servicePath,
      '250',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const holderExit = waitForChildExit(holder);
  await waitForChildOutput(holder, 'LOCKED');

  const startedAt = Date.now();
  registerWorkspace(
    registryPath,
    { id: 'workspace_b', path: workspaceB },
    { waitMs: 2_000, retryMs: 5 }
  );
  const waitedMs = Date.now() - startedAt;

  await holderExit;
  assert.ok(waitedMs >= 150, `expected the writer to wait for the lock, waited ${waitedMs}ms`);
  assert.deepEqual(
    listWorkspaces(registryPath)
      .map(entry => entry.id)
      .sort(),
    ['workspace_a', 'workspace_b']
  );
  assert.equal(fs.existsSync(getRegistryLockPath(registryPath)), false);
});

test('busy registry returns a stable recovery code and releases locks after failures', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-registry-busy-'));
  const registryPath = path.join(tempRoot, '_registry.json');
  const heldLock = acquireRegistryLock(registryPath);

  try {
    assert.throws(
      () => withRegistryLock(registryPath, () => undefined, { waitMs: 5, retryMs: 1 }),
      error => error && error.code === 'REGISTRY_BUSY'
    );
  } finally {
    heldLock.release();
  }

  assert.throws(
    () =>
      withRegistryLock(registryPath, () => {
        throw new Error('operation failed');
      }),
    /operation failed/
  );
  assert.equal(fs.existsSync(getRegistryLockPath(registryPath)), false);
});

test('dead lock owners can be reclaimed after the configured stale threshold', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-registry-stale-'));
  const registryPath = path.join(tempRoot, '_registry.json');
  const lockPath = getRegistryLockPath(registryPath);
  fs.mkdirSync(lockPath, { recursive: true });
  fs.writeFileSync(
    path.join(lockPath, 'owner.json'),
    JSON.stringify({ pid: 2_147_483_647, acquiredAt: new Date(0).toISOString() })
  );
  const old = new Date(Date.now() - 5_000);
  fs.utimesSync(lockPath, old, old);

  const result = withRegistryLock(registryPath, () => 'reclaimed', {
    waitMs: 500,
    retryMs: 1,
    staleMs: 1,
  });

  assert.equal(result, 'reclaimed');
  assert.equal(fs.existsSync(lockPath), false);
});
