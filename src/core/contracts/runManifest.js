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

const CONTRACT_IDS = require('./contractIds');
const { buildArtifactReference } = require('./artifactReference');

/**
 * Shared builder for versioned run manifests (analyze, bundle, workflow, etc.).
 * Uses the schema registry for validation (package 02 + 03).
 */

const RUN_MANIFEST_CONTRACT_ID = CONTRACT_IDS.RUN_MANIFEST;
const RUN_MANIFEST_VERSION = 1;

/**
 * Build a normalized run manifest header + common structure.
 */
function buildRunManifestBase({
  tool = { name: 'zeus-rpg-promptkit' },
  command,
  run = {},
  inputs = {},
  artifacts = [],
  ...rest
} = {}) {
  const manifest = {
    schemaVersion: RUN_MANIFEST_VERSION,
    contract: `${RUN_MANIFEST_CONTRACT_ID}@${RUN_MANIFEST_VERSION}`,
    tool: {
      name: tool.name || 'zeus-rpg-promptkit',
      command: command || tool.command || null,
    },
    run: {
      status: run.status || 'unknown',
      startedAt: run.startedAt || null,
      completedAt: run.completedAt || null,
      durationMs: typeof run.durationMs === 'number' ? run.durationMs : null,
      cwd: run.cwd || null,
      outputDir: run.outputDir || run.outputProgramDir || null,
      reproducible: !!run.reproducible,
      ... (run.failure ? { failure: run.failure } : {}),
    },
    inputs: sanitizeInputs(inputs),
    artifacts: Array.isArray(artifacts)
      ? artifacts.map((a) => (a && a.path ? buildArtifactReference(a) : a))
      : [],
    ...rest,
  };

  return manifest;
}

function sanitizeInputs(inputs = {}) {
  // Redact any credential-like things at build time (defense in depth)
  const clone = JSON.parse(JSON.stringify(inputs || {}));
  const redactKeys = ['password', 'token', 'secret', 'key', 'credential'];
  function walk(obj) {
    if (!obj || typeof obj !== 'object') return;
    for (const k of Object.keys(obj)) {
      if (redactKeys.some((rk) => k.toLowerCase().includes(rk))) {
        obj[k] = '[REDACTED]';
      } else if (typeof obj[k] === 'object') {
        walk(obj[k]);
      }
    }
  }
  walk(clone);
  return clone;
}

module.exports = {
  buildRunManifestBase,
  CONTRACT_ID: RUN_MANIFEST_CONTRACT_ID,
  VERSION: RUN_MANIFEST_VERSION,
};
