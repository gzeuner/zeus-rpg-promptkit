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
const fs = require('fs');
const os = require('os');
const path = require('path');

const REGISTRY_SCHEMA_VERSION = 1;
const WORKSPACE_ID_PATTERN = /^[a-z0-9_-]+$/;
const WORKSPACE_PATH_ENCODING = 'base64utf8';
const REGISTRY_LOCK_SUFFIX = '.lock';
const DEFAULT_REGISTRY_LOCK_WAIT_MS = 10_000;
const DEFAULT_REGISTRY_LOCK_RETRY_MS = 25;
const DEFAULT_REGISTRY_LOCK_STALE_MS = 30_000;

function normalizeWorkspaceId(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function encodeWorkspacePath(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64');
}

function decodeWorkspacePath(value, encoding = '') {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (
    String(encoding || '')
      .trim()
      .toLowerCase() === WORKSPACE_PATH_ENCODING
  ) {
    return Buffer.from(raw, 'base64').toString('utf8');
  }
  return raw;
}

function deriveWorkspaceId(input) {
  const normalized = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalized) {
    throw new Error('Workspace id cannot be derived from the provided value. Use --id.');
  }
  return normalized;
}

function validateWorkspaceId(value) {
  const normalized = normalizeWorkspaceId(value);
  if (!normalized) {
    throw new Error('Workspace id is required.');
  }
  if (!WORKSPACE_ID_PATTERN.test(normalized)) {
    throw new Error(`Invalid workspace id: ${value}. Allowed pattern: ${WORKSPACE_ID_PATTERN}`);
  }
  return normalized;
}

function resolveRegistryPath(config = {}) {
  const explicit = config.registryPath || config.registry || config.registryFile;
  const env = config.env || process.env;
  const profile = config.profile || null;

  const candidate =
    explicit ||
    (env && env.ZEUS_ANALYSES_REGISTRY) ||
    (profile && profile.analysesRegistryPath) ||
    path.join(os.homedir(), '.zeus', 'analyses-registry.json');

  return path.resolve(config.cwd || process.cwd(), String(candidate));
}

function createEmptyRegistry() {
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    registeredAt: new Date().toISOString(),
    workspaces: [],
  };
}

function normalizeWorkspaceEntry(entry = {}) {
  const now = new Date().toISOString();
  const outputDir = String(entry.outputDir || 'output').trim() || 'output';
  const sourceDir = String(entry.sourceDir || 'rpg_sources').trim() || 'rpg_sources';
  const decodedPath = decodeWorkspacePath(entry.path, entry.pathEncoding);

  return {
    id: validateWorkspaceId(entry.id),
    name: String(entry.name || '').trim() || String(entry.id || '').trim(),
    description: String(entry.description || '').trim() || '',
    system: String(entry.system || '').trim() || '',
    library: String(entry.library || '').trim() || '',
    profile: String(entry.profile || '').trim() || '',
    path: path.resolve(String(decodedPath || '')),
    outputDir,
    sourceDir,
    tags: Array.isArray(entry.tags)
      ? Array.from(new Set(entry.tags.map(tag => String(tag || '').trim()).filter(Boolean))).sort(
          (a, b) => a.localeCompare(b)
        )
      : [],
    registeredAt: String(entry.registeredAt || now),
    lastAccessedAt: String(entry.lastAccessedAt || now),
  };
}

function validateRegistryPath(registryPath) {
  const resolved = path.resolve(String(registryPath || ''));
  if (!resolved) {
    throw new Error('Registry path is required.');
  }
  if (path.extname(resolved).toLowerCase() !== '.json') {
    throw new Error('Registry path must point to a .json file.');
  }
  return resolved;
}

function normalizeDuration(value, fallback, name, minimum) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    throw new Error(`Invalid registry lock option: ${name} must be a number >= ${minimum}.`);
  }
  return Math.floor(parsed);
}

function resolveRegistryLockOptions(options = {}) {
  const source = options && typeof options === 'object' ? options : {};
  return {
    waitMs: normalizeDuration(source.waitMs, DEFAULT_REGISTRY_LOCK_WAIT_MS, 'waitMs', 0),
    retryMs: normalizeDuration(source.retryMs, DEFAULT_REGISTRY_LOCK_RETRY_MS, 'retryMs', 1),
    staleMs: normalizeDuration(source.staleMs, DEFAULT_REGISTRY_LOCK_STALE_MS, 'staleMs', 1),
  };
}

function sleepSync(milliseconds) {
  if (milliseconds <= 0) {
    return;
  }
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, milliseconds);
}

function getRegistryLockPath(registryPath) {
  return `${validateRegistryPath(registryPath)}${REGISTRY_LOCK_SUFFIX}`;
}

function readRegistryLockOwner(lockPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8'));
    if (!Number.isInteger(parsed.pid) || parsed.pid <= 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code !== 'ESRCH';
  }
}

function tryReclaimStaleRegistryLock(lockPath, staleMs) {
  let stats;
  try {
    stats = fs.statSync(lockPath);
  } catch {
    return false;
  }

  if (!stats.isDirectory() || Date.now() - stats.mtimeMs < staleMs) {
    return false;
  }

  const owner = readRegistryLockOwner(lockPath);
  if (!owner || isProcessAlive(owner.pid)) {
    return false;
  }

  const reclaimPath = `${lockPath}.stale-${process.pid}-${Date.now()}`;
  try {
    fs.renameSync(lockPath, reclaimPath);
    fs.rmSync(reclaimPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return true;
    }
    try {
      fs.rmSync(reclaimPath, { recursive: true, force: true });
    } catch {
      // Another contender may have reclaimed the same lock directory.
    }
    return false;
  }
}

function acquireRegistryLock(registryPath, options = {}) {
  const resolvedPath = validateRegistryPath(registryPath);
  const lockPath = getRegistryLockPath(resolvedPath);
  const { waitMs, retryMs, staleMs } = resolveRegistryLockOptions(options);
  const startedAt = Date.now();

  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

  while (true) {
    try {
      fs.mkdirSync(lockPath);
      try {
        fs.writeFileSync(
          path.join(lockPath, 'owner.json'),
          `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`,
          { encoding: 'utf8', flag: 'wx' }
        );
      } catch (error) {
        fs.rmSync(lockPath, { recursive: true, force: true });
        throw error;
      }

      let released = false;
      return {
        path: lockPath,
        release() {
          if (released) {
            return;
          }
          released = true;
          fs.rmSync(lockPath, { recursive: true, force: true });
        },
      };
    } catch (error) {
      if (!error || error.code !== 'EEXIST') {
        throw error;
      }
    }

    if (tryReclaimStaleRegistryLock(lockPath, staleMs)) {
      continue;
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed >= waitMs) {
      const busyError = new Error(
        'Analysis registry is busy because another process is updating it. Retry the command.'
      );
      busyError.code = 'REGISTRY_BUSY';
      throw busyError;
    }

    sleepSync(Math.min(retryMs, waitMs - elapsed));
  }
}

function withRegistryLock(registryPath, operation, options = {}) {
  if (typeof operation !== 'function') {
    throw new TypeError('Registry lock operation must be a function.');
  }

  const lock = acquireRegistryLock(registryPath, options);
  try {
    return operation();
  } finally {
    lock.release();
  }
}

function readRegistry(registryPath) {
  const resolvedPath = validateRegistryPath(registryPath);
  if (!fs.existsSync(resolvedPath)) {
    return createEmptyRegistry();
  }

  const parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  const workspaces = Array.isArray(parsed.workspaces)
    ? parsed.workspaces.map(entry => normalizeWorkspaceEntry(entry))
    : [];

  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    registeredAt: String(parsed.registeredAt || new Date().toISOString()),
    workspaces,
  };
}

function writeRegistry(registryPath, data) {
  const resolvedPath = validateRegistryPath(registryPath);
  const directory = path.dirname(resolvedPath);
  fs.mkdirSync(directory, { recursive: true });

  const payload = {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    registeredAt: String(data && data.registeredAt ? data.registeredAt : new Date().toISOString()),
    workspaces: Array.isArray(data && data.workspaces)
      ? data.workspaces.map(entry => {
          const normalized = normalizeWorkspaceEntry(entry);
          return {
            ...normalized,
            path: encodeWorkspacePath(normalized.path),
            pathEncoding: WORKSPACE_PATH_ENCODING,
          };
        })
      : [],
  };

  const tempPath = `${resolvedPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, resolvedPath);
  return payload;
}

function registerWorkspace(registryPath, workspaceEntry, options = {}) {
  const normalized = normalizeWorkspaceEntry(workspaceEntry);

  if (
    !normalized.path ||
    !fs.existsSync(normalized.path) ||
    !fs.statSync(normalized.path).isDirectory()
  ) {
    throw new Error(`Workspace path not found: ${normalized.path}`);
  }

  return withRegistryLock(
    registryPath,
    () => {
      const registry = readRegistry(registryPath);
      const byIdIndex = registry.workspaces.findIndex(entry => entry.id === normalized.id);
      const byPathIndex = registry.workspaces.findIndex(entry => entry.path === normalized.path);
      const existingIndex = byIdIndex !== -1 ? byIdIndex : byPathIndex;

      if (existingIndex >= 0) {
        const existing = registry.workspaces[existingIndex];
        registry.workspaces[existingIndex] = {
          ...existing,
          ...normalized,
          registeredAt: existing.registeredAt || normalized.registeredAt,
          lastAccessedAt: new Date().toISOString(),
        };
      } else {
        registry.workspaces.push(normalized);
      }

      writeRegistry(registryPath, registry);
      return normalized;
    },
    options
  );
}

function unregisterWorkspace(registryPath, workspaceId, options = {}) {
  const normalizedId = validateWorkspaceId(workspaceId);
  return withRegistryLock(
    registryPath,
    () => {
      const registry = readRegistry(registryPath);
      const previousCount = registry.workspaces.length;
      registry.workspaces = registry.workspaces.filter(entry => entry.id !== normalizedId);
      if (registry.workspaces.length === previousCount) {
        return false;
      }
      writeRegistry(registryPath, registry);
      return true;
    },
    options
  );
}

function listWorkspaces(registryPath) {
  const registry = readRegistry(registryPath);
  return [...registry.workspaces].sort((left, right) => {
    const leftTime = Date.parse(left.lastAccessedAt || left.registeredAt || '') || 0;
    const rightTime = Date.parse(right.lastAccessedAt || right.registeredAt || '') || 0;
    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }
    return String(left.id || '').localeCompare(String(right.id || ''));
  });
}

function touchWorkspace(registryPath, workspaceId, options = {}) {
  const normalizedId = validateWorkspaceId(workspaceId);
  return withRegistryLock(
    registryPath,
    () => {
      const registry = readRegistry(registryPath);
      const workspace = registry.workspaces.find(entry => entry.id === normalizedId);
      if (!workspace) {
        throw new Error(`Workspace not found: ${normalizedId}`);
      }
      workspace.lastAccessedAt = new Date().toISOString();
      writeRegistry(registryPath, registry);
      return workspace;
    },
    options
  );
}

function readWorkspaceById(registryPath, workspaceId) {
  const normalizedId = validateWorkspaceId(workspaceId);
  return listWorkspaces(registryPath).find(entry => entry.id === normalizedId) || null;
}

module.exports = {
  REGISTRY_SCHEMA_VERSION,
  REGISTRY_LOCK_SUFFIX,
  DEFAULT_REGISTRY_LOCK_WAIT_MS,
  DEFAULT_REGISTRY_LOCK_RETRY_MS,
  DEFAULT_REGISTRY_LOCK_STALE_MS,
  WORKSPACE_PATH_ENCODING,
  WORKSPACE_ID_PATTERN,
  decodeWorkspacePath,
  deriveWorkspaceId,
  encodeWorkspacePath,
  acquireRegistryLock,
  getRegistryLockPath,
  listWorkspaces,
  normalizeWorkspaceEntry,
  readRegistry,
  readWorkspaceById,
  registerWorkspace,
  resolveRegistryPath,
  touchWorkspace,
  unregisterWorkspace,
  validateWorkspaceId,
  withRegistryLock,
  writeRegistry,
};
