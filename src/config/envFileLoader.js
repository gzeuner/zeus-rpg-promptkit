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
 * Node-native auto-discovery and loading of `.env` files.
 *
 * Goal: remove the friction of having to manually dot-source
 * `config/load-env.ps1` / `config/load-env.sh` before every Zeus command.
 *
 * Design rules (security-first, predictable):
 *   - Already-present process env vars ALWAYS win. Values explicitly exported
 *     in the shell are never overwritten (non-destructive by default).
 *   - The same locations that hold `profiles.json` are searched for env files,
 *     including `config/local-only/` — closing the gap where credentials live
 *     in `local-only/` but the shell scripts only looked in `config/`.
 *   - Among discovered files, the environment-specific file overrides the base
 *     file (same layering as the shell scripts: base first, environment last).
 *   - Secret VALUES are never returned or logged. Only variable NAMES surface.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ENV_VAR_LINE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
const SECRET_NAME_PATTERN = /PASSWORD|SECRET|TOKEN|CREDENTIAL|PWD/i;

/**
 * Parse `.env` file content into an ordered list of { key, value } entries.
 * Comment handling mirrors the existing shell loaders:
 *   - full-line comments (`#...`) are skipped
 *   - inline comments are stripped only when the `#` is preceded by whitespace,
 *     so values that legitimately contain `#` (e.g. some passwords) survive.
 * No quote stripping is performed (consistent with load-env.ps1 / load-env.sh).
 */
function parseEnvFileContent(content) {
  const entries = [];
  const lines = String(content || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const withoutInlineComment = rawLine.replace(/\s+#.*$/, '').trim();
    const match = withoutInlineComment.match(ENV_VAR_LINE);
    if (!match) {
      continue;
    }
    entries.push({ key: match[1], value: match[2] });
  }
  return entries;
}

function isSecretName(name) {
  return SECRET_NAME_PATTERN.test(String(name || ''));
}

/**
 * Determine the env-file search directories in priority order.
 * Earlier directories win when the same file name exists in several places.
 */
function resolveEnvSearchDirs({ cwd = process.cwd(), configDir } = {}) {
  const baseConfigDir = configDir
    ? path.resolve(cwd, configDir)
    : path.resolve(cwd, 'config');
  const dirs = [
    path.join(baseConfigDir, 'local-only'),
    baseConfigDir,
    cwd,
  ];
  // De-duplicate while preserving order (cwd may equal configDir in odd setups).
  return dirs.filter((dir, index) => dirs.indexOf(dir) === index);
}

function resolveEnvFileNames(environment) {
  const normalized = environment && String(environment).trim()
    ? String(environment).trim()
    : null;
  const names = [{ name: '.env.local', role: 'base' }];
  if (normalized && normalized !== 'default') {
    names.push({ name: `.env.${normalized}.local`, role: 'environment' });
  }
  return names;
}

/**
 * Discover concrete env-file paths. The base file and (optional) environment
 * file are each resolved against the search directories; the first existing
 * match per file name wins.
 */
function discoverEnvFiles({ cwd = process.cwd(), configDir, environment, fsModule = fs } = {}) {
  const searchDirs = resolveEnvSearchDirs({ cwd, configDir });
  const fileNames = resolveEnvFileNames(environment);
  const discovered = [];
  for (const { name, role } of fileNames) {
    for (const dir of searchDirs) {
      const candidate = path.join(dir, name);
      if (fsModule.existsSync(candidate)) {
        discovered.push({ path: candidate, role, name });
        break;
      }
    }
  }
  return { searchDirs, files: discovered };
}

/**
 * Auto-load discovered env files into the target env object.
 *
 * @returns summary object (NO secret values, only variable names).
 */
function autoLoadEnvFiles({
  cwd = process.cwd(),
  env = process.env,
  configDir,
  environment,
  override = false,
  fsModule = fs,
} = {}) {
  const { searchDirs, files } = discoverEnvFiles({ cwd, configDir, environment, fsModule });

  // Snapshot of keys already present BEFORE this pass. Shell-exported values
  // (or anything already in the environment) take precedence and are preserved.
  const preexistingKeys = new Set(Object.keys(env));

  // Merge file layers in discovery order (base first, environment last) so the
  // environment-specific file overrides the base file among the files.
  const mergedFromFiles = new Map();
  const fileSummaries = [];
  for (const file of files) {
    let content = '';
    try {
      content = fsModule.readFileSync(file.path, 'utf8');
    } catch (error) {
      fileSummaries.push({
        path: file.path,
        role: file.role,
        error: error.message,
        variables: [],
      });
      continue;
    }
    const entries = parseEnvFileContent(content);
    const variables = [];
    for (const { key, value } of entries) {
      mergedFromFiles.set(key, value);
      variables.push(key);
    }
    fileSummaries.push({ path: file.path, role: file.role, variables });
  }

  const applied = [];
  const skippedPreexisting = [];
  for (const [key, value] of mergedFromFiles.entries()) {
    const alreadyPresent = preexistingKeys.has(key);
    if (alreadyPresent && !override) {
      skippedPreexisting.push(key);
      continue;
    }
    env[key] = value;
    applied.push(key);
  }

  return {
    loaded: applied.length > 0,
    environment: environment && String(environment).trim() && String(environment).trim() !== 'default'
      ? String(environment).trim()
      : null,
    searchDirs,
    files: fileSummaries,
    applied,
    appliedSecretCount: applied.filter(isSecretName).length,
    skippedPreexisting,
  };
}

module.exports = {
  autoLoadEnvFiles,
  discoverEnvFiles,
  parseEnvFileContent,
  resolveEnvSearchDirs,
  resolveEnvFileNames,
  isSecretName,
};
