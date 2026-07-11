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

/**
 * Basic header validator used by all initial shells.
 * Requires a numeric schemaVersion that matches the registered version.
 */
function basicHeaderValidator(expectedVersion) {
  return (value) => {
    const errors = [];
    if (value == null || typeof value !== 'object') {
      errors.push({ path: '', message: 'expected an object' });
      return errors;
    }
    const sv = value.schemaVersion;
    if (sv === undefined) {
      errors.push({ path: '/schemaVersion', message: 'schemaVersion is required' });
    } else if (Number(sv) !== expectedVersion) {
      errors.push({
        path: '/schemaVersion',
        message: `expected ${expectedVersion}, got ${sv}`,
      });
    }
    return errors;
  };
}

/**
 * Metadata-only shells for the contracts introduced in package 02.
 * These only enforce common header/identity fields for now.
 * Full structural schemas will be added by later packages.
 */

const evidenceModelSchema = basicHeaderValidator(1);

const runManifestSchema = (value) => {
  const errors = basicHeaderValidator(1)(value);
  if (value && typeof value === 'object') {
    if (!value.tool || typeof value.tool !== 'object') {
      errors.push({ path: '/tool', message: 'tool metadata object is required' });
    }
    if (typeof value.run !== 'object' || value.run === null) {
      errors.push({ path: '/run', message: 'run object is required' });
    }
    if (Array.isArray(value.artifacts)) {
      value.artifacts.forEach((a, i) => {
        if (a && typeof a.path === 'string' && (a.path.startsWith('/') || a.path.includes('..'))) {
          errors.push({ path: `/artifacts/${i}/path`, message: 'artifact path must be relative and safe' });
        }
      });
    }
  }
  return errors;
};

const artifactReferenceSchema = (value) => {
  const errors = basicHeaderValidator(1)(value);
  if (value && typeof value === 'object') {
    if (typeof value.path !== 'string' || !value.path) {
      errors.push({ path: '/path', message: 'path is required and must be a string' });
    }
    if (value.path && (value.path.startsWith('/') || value.path.includes('..'))) {
      errors.push({ path: '/path', message: 'path must be relative and safe (no absolute or traversal)' });
    }
  }
  return errors;
};

const investigationSessionSchema = (value) => {
  const errors = basicHeaderValidator(1)(value);
  if (!value || typeof value !== 'object') return errors;

  if (typeof value.id !== 'string' || !value.id) {
    errors.push({ path: '/id', message: 'id is required' });
  }
  if (typeof value.goal !== 'string') {
    errors.push({ path: '/goal', message: 'goal must be a string' });
  }
  if (!value.focus || typeof value.focus !== 'object') {
    errors.push({ path: '/focus', message: 'focus object is required' });
  }
  if (!Array.isArray(value.history)) {
    errors.push({ path: '/history', message: 'history must be an array' });
  }
  // Evidence vs interpretation separation hint (future strict)
  if (value.evidence && !Array.isArray(value.evidence)) {
    errors.push({ path: '/evidence', message: 'evidence should be an array if present' });
  }
  if (value.findings && !Array.isArray(value.findings)) {
    errors.push({ path: '/findings', message: 'findings should be an array if present' });
  }
  return errors;
};

const safetyPolicySchema = (value) => {
  const errors = basicHeaderValidator(1)(value);
  if (value && typeof value === 'object' && value.level != null) {
    const level = String(value.level);
    if (!['S0', 'S1', 'S2', 'S3', 'S4'].includes(level)) {
      errors.push({ path: '/level', message: 'level must be one of S0-S4' });
    }
  }
  return errors;
};

const INITIAL_SCHEMAS = Object.freeze({
  [CONTRACT_IDS.EVIDENCE_MODEL]: { version: 1, schema: evidenceModelSchema },
  [CONTRACT_IDS.RUN_MANIFEST]: { version: 1, schema: runManifestSchema },
  [CONTRACT_IDS.ARTIFACT_REFERENCE]: { version: 1, schema: artifactReferenceSchema },
  [CONTRACT_IDS.INVESTIGATION_SESSION]: { version: 1, schema: investigationSessionSchema },
  [CONTRACT_IDS.SAFETY_POLICY]: { version: 1, schema: safetyPolicySchema },
});

module.exports = {
  CONTRACT_IDS,
  INITIAL_SCHEMAS,
  basicHeaderValidator,
};
