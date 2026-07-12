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
 * Central plaintext secret detector for Secrets-Hygiene.
 * Used by doctor and prepared for reuse in secret status, onboarding, etc.
 */

const fs = require('fs');
const path = require('path');

const SECRET_KEYS = /PASSWORD|SECRET|TOKEN|PWD|KEY/i;

// Treat ${env:FOO} and general ${...} placeholders (used in profiles.json) as non-plaintext.
const PLACEHOLDER_RE = /^\$\{[^}]+\}$/;

function isPlaceholder(value) {
  const s = String(value || '').trim();
  return PLACEHOLDER_RE.test(s);
}

function findPlaintextInObject(obj, path = '') {
  const results = [];
  if (typeof obj !== 'object' || obj === null) return results;

  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (
      typeof value === 'string' &&
      SECRET_KEYS.test(key) &&
      value.trim() &&
      !value.startsWith('enc:v1:') &&
      !isPlaceholder(value)
    ) {
      results.push(currentPath);
    } else if (typeof value === 'object') {
      results.push(...findPlaintextInObject(value, currentPath));
    }
  }
  return results;
}

/**
 * Scan .env files (and optionally profiles) for plaintext secrets.
 * Can also scan a provided env object for currently loaded plaintext secrets.
 * Returns list of {key, file, source, hasValue}
 */
function detectPlaintextSecrets({
  cwd = process.cwd(),
  configDir,
  envFiles = [],
  env = {},
  checkProfiles = false,
} = {}) {
  const findings = [];
  const seenKeys = new Set();

  const filesToScan = [...envFiles];

  if (filesToScan.length === 0) {
    const base = configDir ? path.resolve(cwd, configDir) : path.join(cwd, 'config');
    const searchDirs = [path.join(base, 'local-only'), base, cwd];
    const seen = new Set();
    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue;
      let entries = [];
      try {
        entries = fs.readdirSync(dir);
      } catch (_) {
        continue;
      }
      for (const entry of entries) {
        // Match .env, .env.local, .env.<name>.local, .env.ders.local etc.
        if (entry === '.env' || (entry.startsWith('.env') && entry.endsWith('.local'))) {
          const full = path.join(dir, entry);
          const norm = path.resolve(full);
          if (!seen.has(norm) && fs.existsSync(full)) {
            seen.add(norm);
            filesToScan.push(full);
          }
        }
      }
    }
  }

  for (const filePath of filesToScan) {
    if (!filePath || !fs.existsSync(filePath)) continue;
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match) continue;
        const key = match[1];
        let value = match[2]
          .trim()
          .replace(/\s+#.*$/, '')
          .trim();
        if (
          SECRET_KEYS.test(key) &&
          value &&
          !value.startsWith('enc:v1:') &&
          !isPlaceholder(value)
        ) {
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            findings.push({
              key,
              file: path.relative(cwd, filePath).replace(/\\/g, '/') || filePath,
              source: 'file',
              hasValue: value.length > 0,
            });
          }
        }
      }
    } catch (_) {}
  }

  // Scan currently loaded env for plaintext (e.g. already exported in shell or auto-loaded)
  if (env && typeof env === 'object') {
    for (const [key, val] of Object.entries(env)) {
      if (
        SECRET_KEYS.test(key) &&
        val &&
        typeof val === 'string' &&
        val.trim() &&
        !val.startsWith('enc:v1:') &&
        !isPlaceholder(val)
      ) {
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          findings.push({
            key,
            file: '(current environment)',
            source: 'env',
            hasValue: true,
          });
        }
      }
    }
  }

  if (checkProfiles) {
    const profCandidates = [
      path.join(cwd, configDir || 'config', 'local-only', 'profiles.json'),
      path.join(cwd, configDir || 'config', 'profiles.json'),
    ];
    for (const p of profCandidates) {
      if (!fs.existsSync(p)) continue;
      try {
        const content = fs.readFileSync(p, 'utf8');
        const profiles = JSON.parse(content);

        // Recursively search for direct plaintext secret values in profiles
        const found = findPlaintextInObject(profiles);
        if (found.length > 0) {
          findings.push({
            key: found.join(', '),
            file: path.relative(cwd, p).replace(/\\/g, '/') || p,
            source: 'profile',
            hasValue: true,
          });
        } else if (SECRET_KEYS.test(content) && !/enc:v1:/.test(content) && !/\$\{/.test(content)) {
          // Fallback rough check (avoid flagging profiles that only use placeholders)
          findings.push({
            key: 'possible-plaintext-secret',
            file: path.relative(cwd, p).replace(/\\/g, '/') || p,
            source: 'profile',
            hasValue: true,
          });
        }
      } catch (_) {}
    }
  }

  return findings;
}

module.exports = {
  detectPlaintextSecrets,
  SECRET_KEYS,
  isPlaceholder,
  PLACEHOLDER_RE,
};
