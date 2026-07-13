'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_SCHEMA = 'repository-control-config/v1';
const POLICY_LEVELS = new Set(['ignore', 'warning', 'block']);
const DEFAULTS = Object.freeze({ pollSeconds: 15, timeoutSeconds: 1800 });

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
    this.code = 'INVALID_CONFIG';
  }
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function permittedRoots(cwd = process.cwd()) {
  return [fs.realpathSync(cwd), fs.realpathSync(os.tmpdir())];
}

function assertNoSymlinkComponents(target, stopAt) {
  const relative = path.relative(stopAt, target);
  if (relative === '') return;
  let cursor = stopAt;
  for (const part of relative.split(path.sep)) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) continue;
    if (fs.lstatSync(cursor).isSymbolicLink()) {
      throw new ConfigError(`Path must not contain symbolic links: ${target}`);
    }
  }
}

function resolveSafePath(input, { cwd = process.cwd(), purpose = 'path', mustExist = false } = {}) {
  if (typeof input !== 'string' || input.trim() === '' || input.includes('\0')) {
    throw new ConfigError(`${purpose} must be a non-empty path`);
  }
  const normalizedInput = path.normalize(input);
  if (!path.isAbsolute(input) && normalizedInput.split(path.sep).includes('..')) {
    throw new ConfigError(`${purpose} must not contain parent traversal`);
  }
  const resolved = path.resolve(cwd, input);
  const roots = permittedRoots(cwd);
  const root = roots.find(candidate => isInside(candidate, resolved));
  if (!root)
    throw new ConfigError(`${purpose} must remain inside the repository or temporary directory`);

  assertNoSymlinkComponents(resolved, root);
  if (mustExist) {
    let stat;
    try {
      stat = fs.lstatSync(resolved);
    } catch (error) {
      throw new ConfigError(`${purpose} is missing or unreadable: ${resolved}`);
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new ConfigError(`${purpose} must be a regular file: ${resolved}`);
    }
    try {
      fs.accessSync(resolved, fs.constants.R_OK);
    } catch (_) {
      throw new ConfigError(`${purpose} is not readable: ${resolved}`);
    }
  } else {
    const parent = path.dirname(resolved);
    let existing = parent;
    while (!fs.existsSync(existing)) {
      const next = path.dirname(existing);
      if (next === existing) break;
      existing = next;
    }
    const realExisting = fs.realpathSync(existing);
    if (!roots.some(candidate => isInside(candidate, realExisting))) {
      throw new ConfigError(`${purpose} parent escapes an allowed root through a symbolic link`);
    }
  }
  return resolved;
}

function requireStringArray(value, label, { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) {
    throw new ConfigError(`${label} must be ${nonEmpty ? 'a non-empty' : 'an'} array`);
  }
  if (value.some(item => typeof item !== 'string' || item.trim() === '')) {
    throw new ConfigError(`${label} must contain only non-empty strings`);
  }
  if (new Set(value).size !== value.length) throw new ConfigError(`${label} contains duplicates`);
  return value;
}

function validatePolicy(value, label) {
  if (!POLICY_LEVELS.has(value))
    throw new ConfigError(`${label} must be ignore, warning, or block`);
}

function validateConfig(config, source) {
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw new ConfigError('Configuration must be an object');
  if (config.schemaVersion !== CONFIG_SCHEMA)
    throw new ConfigError(`Unsupported config schemaVersion in ${source}`);
  if (!/^[^/\s]+\/[^/\s]+$/.test(String(config.repository || '')))
    throw new ConfigError('repository must be owner/name');
  if (!/^[A-Za-z0-9._/-]+$/.test(String(config.defaultBranch || '')))
    throw new ConfigError('defaultBranch is invalid');
  if (!config.requiredChecks || typeof config.requiredChecks !== 'object')
    throw new ConfigError('requiredChecks is required');
  const pr = requireStringArray(config.requiredChecks.pullRequest, 'requiredChecks.pullRequest', {
    nonEmpty: true,
  });
  const main = requireStringArray(config.requiredChecks.main, 'requiredChecks.main', {
    nonEmpty: true,
  });
  requireStringArray(config.optionalChecks || [], 'optionalChecks');
  requireStringArray(config.allowedSkippedChecks || [], 'allowedSkippedChecks');

  if (!config.checkConclusions || typeof config.checkConclusions !== 'object')
    throw new ConfigError('checkConclusions is required');
  for (const scope of ['pullRequest', 'main']) {
    const entries = config.checkConclusions[scope];
    if (!entries || typeof entries !== 'object' || Array.isArray(entries))
      throw new ConfigError(`checkConclusions.${scope} is required`);
    const expected = scope === 'pullRequest' ? pr : main;
    for (const name of expected) {
      const allowed = requireStringArray(entries[name], `checkConclusions.${scope}.${name}`, {
        nonEmpty: true,
      });
      if (!allowed.every(value => ['success', 'neutral', 'skipped'].includes(value)))
        throw new ConfigError(`Invalid allowed conclusion for ${name}`);
    }
  }

  const policies = config.policies;
  if (!policies || typeof policies !== 'object') throw new ConfigError('policies is required');
  for (const name of [
    'directMainCommit',
    'unresolvedReviewThreads',
    'changesRequested',
    'draftPullRequest',
    'releaseVersionMismatch',
    'prBehindMain',
    'mergeability',
    'mergeState',
  ]) {
    validatePolicy(policies[name], `policies.${name}`);
  }
  if (typeof policies.branchMustContainMain !== 'boolean')
    throw new ConfigError('policies.branchMustContainMain must be boolean');
  if (
    !Number.isInteger(policies.mergedBranchRetentionDays) ||
    policies.mergedBranchRetentionDays < 0
  )
    throw new ConfigError('policies.mergedBranchRetentionDays must be a non-negative integer');

  const polling = config.polling;
  if (!polling || typeof polling !== 'object') throw new ConfigError('polling is required');
  for (const key of [
    'defaultPollSeconds',
    'minPollSeconds',
    'maxPollSeconds',
    'defaultTimeoutSeconds',
    'maxTimeoutSeconds',
  ]) {
    if (!Number.isInteger(polling[key]) || polling[key] <= 0)
      throw new ConfigError(`polling.${key} must be a positive integer`);
  }
  if (
    polling.minPollSeconds > polling.defaultPollSeconds ||
    polling.defaultPollSeconds > polling.maxPollSeconds
  )
    throw new ConfigError('default poll interval is outside configured bounds');
  if (polling.defaultTimeoutSeconds > polling.maxTimeoutSeconds)
    throw new ConfigError('default timeout exceeds maximum');
  return config;
}

function loadConfig(configPath, options = {}) {
  const resolved = resolveSafePath(configPath, {
    ...options,
    purpose: 'configuration path',
    mustExist: true,
  });
  let raw;
  try {
    raw = fs.readFileSync(resolved, 'utf8');
  } catch (_) {
    throw new ConfigError(`Configuration is missing or unreadable: ${resolved}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    throw new ConfigError(`Configuration is not valid JSON: ${resolved}`);
  }
  const config = validateConfig(parsed, resolved);
  return { ...config, _source: 'file', _configPath: resolved };
}

module.exports = {
  CONFIG_SCHEMA,
  ConfigError,
  DEFAULTS,
  loadConfig,
  resolveSafePath,
  validateConfig,
};
