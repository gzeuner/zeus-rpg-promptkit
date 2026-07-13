'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  schemaVersion: 'repository-control-config/v1',
  repository: 'gzeuner/zeus-rpg-promptkit',
  defaultBranch: 'main',
  requiredChecks: {
    pullRequest: [],
    main: [],
  },
  optionalChecks: [],
  allowedSkippedChecks: [],
  policies: {
    branchMustContainMain: true,
    directMainCommit: 'warning',
    unresolvedReviewThreads: 'block',
    changesRequested: 'block',
    draftPullRequest: 'block',
    mergedBranchRetentionDays: 0,
    releaseVersionMismatch: 'warning',
    prBehindMain: 'block',
  },
  polling: {
    defaultPollSeconds: 15,
    minPollSeconds: 5,
    maxPollSeconds: 60,
    defaultTimeoutSeconds: 1800,
    maxTimeoutSeconds: 7200,
  },
};

function loadConfig(configPath) {
  const resolved = path.resolve(configPath);
  let raw;
  try {
    raw = fs.readFileSync(resolved, 'utf8');
  } catch (e) {
    // Fall back to defaults if config missing (still functional)
    return { ...DEFAULT_CONFIG, _source: 'defaults', _configPath: resolved };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error(`Invalid JSON in repository control config: ${resolved}`);
    process.exit(64);
  }

  // Basic validation / merge with defaults
  const merged = {
    ...DEFAULT_CONFIG,
    ...parsed,
    requiredChecks: {
      ...DEFAULT_CONFIG.requiredChecks,
      ...(parsed.requiredChecks || {}),
    },
    policies: {
      ...DEFAULT_CONFIG.policies,
      ...(parsed.policies || {}),
    },
    polling: {
      ...DEFAULT_CONFIG.polling,
      ...(parsed.polling || {}),
    },
    _source: 'file',
    _configPath: resolved,
  };

  return merged;
}

module.exports = {
  loadConfig,
  DEFAULTS: {
    pollSeconds: DEFAULT_CONFIG.polling.defaultPollSeconds,
    timeoutSeconds: DEFAULT_CONFIG.polling.defaultTimeoutSeconds,
  },
};
