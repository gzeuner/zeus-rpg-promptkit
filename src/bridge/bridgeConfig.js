/*
Copyright 2026 Zeus PromptKit Contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
const { BRIDGE_DEFAULTS, BRIDGE_MODES } = require('./bridgeDefaults');

const OBJECT_NAME_PATTERN = /^[A-Z][A-Z0-9_$#@]{0,9}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeBoolean(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }
  return Boolean(value);
}

function normalizeStringArray(value, { uppercase = false } = {}) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('Bridge configuration expects an array value.');
  }
  return Array.from(new Set(value
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .map((entry) => uppercase ? entry.toUpperCase() : entry)))
    .sort((left, right) => left.localeCompare(right));
}

function validateObjectNameList(values, label) {
  for (const entry of values) {
    if (!OBJECT_NAME_PATTERN.test(entry)) {
      throw new Error(`Invalid bridge ${label} entry: ${entry}`);
    }
  }
}

function normalizeBridgeConfig(profile) {
  const bridge = isPlainObject(profile && profile.bridge) ? profile.bridge : {};

  const mode = String(bridge.mode || BRIDGE_DEFAULTS.mode).trim().toLowerCase();
  if (!BRIDGE_MODES.includes(mode)) {
    throw new Error(`Invalid bridge.mode: ${bridge.mode}`);
  }

  const allowedTargetsRaw = isPlainObject(bridge.allowedTargets) ? bridge.allowedTargets : {};
  const libraries = normalizeStringArray(allowedTargetsRaw.libraries, { uppercase: true });
  const sourceFiles = normalizeStringArray(allowedTargetsRaw.sourceFiles, { uppercase: true });
  const ifsPaths = normalizeStringArray(allowedTargetsRaw.ifsPaths, { uppercase: false });
  validateObjectNameList(libraries, 'allowedTargets.libraries');
  validateObjectNameList(sourceFiles, 'allowedTargets.sourceFiles');
  if (ifsPaths.some((entry) => !entry.startsWith('/'))) {
    throw new Error('Invalid bridge.allowedTargets.ifsPaths entry: expected absolute IFS path.');
  }

  const stagingRaw = isPlainObject(bridge.staging) ? bridge.staging : {};
  const compileRaw = isPlainObject(bridge.compile) ? bridge.compile : {};
  const compileTemplates = normalizeStringArray(compileRaw.allowedTemplates, { uppercase: false });

  return {
    enabled: normalizeBoolean(bridge.enabled, BRIDGE_DEFAULTS.enabled),
    mode,
    requireConfirmation: normalizeBoolean(bridge.requireConfirmation, BRIDGE_DEFAULTS.requireConfirmation),
    allowAutoApprove: normalizeBoolean(bridge.allowAutoApprove, BRIDGE_DEFAULTS.allowAutoApprove),
    auditLog: normalizeBoolean(bridge.auditLog, BRIDGE_DEFAULTS.auditLog),
    allowedTargets: {
      libraries,
      sourceFiles,
      ifsPaths,
    },
    staging: {
      enabled: normalizeBoolean(stagingRaw.enabled, BRIDGE_DEFAULTS.staging.enabled),
      library: String(stagingRaw.library || '').trim().toUpperCase(),
      sourceFile: String(stagingRaw.sourceFile || '').trim().toUpperCase(),
      ifsPath: String(stagingRaw.ifsPath || '').trim(),
    },
    compile: {
      enabled: normalizeBoolean(compileRaw.enabled, BRIDGE_DEFAULTS.compile.enabled),
      allowedTemplates: compileTemplates,
      requirePlan: normalizeBoolean(compileRaw.requirePlan, BRIDGE_DEFAULTS.compile.requirePlan),
      requireApproval: normalizeBoolean(compileRaw.requireApproval, BRIDGE_DEFAULTS.compile.requireApproval),
    },
  };
}

module.exports = {
  normalizeBridgeConfig,
  OBJECT_NAME_PATTERN,
};
