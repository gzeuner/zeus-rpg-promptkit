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
const {
  ALLOWED_BRIDGE_MODES,
  ALLOWED_FETCH_TRANSPORTS,
  ALLOWED_WORKFLOW_STEPS,
  ALLOWED_WORK_COPY_EXTENSIONS,
  GLOBAL_PROFILE_KEYS,
} = require('./runtimeConfigDefaults');

function failValidation(message) {
  throw new Error(`Invalid configuration: ${message}`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertOptionalString(value, label) {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string') {
    failValidation(`${label} must be a string`);
  }
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    failValidation(`${label} must be an array of strings`);
  }
}

function assertOptionalStringOrStringArray(value, label) {
  if (value === undefined || value === null) return;
  if (typeof value === 'string') return;
  assertStringArray(value, label);
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    failValidation(`${label} must be a positive integer`);
  }
}

function validateContextOptimizerConfig(value, label) {
  if (!isPlainObject(value)) {
    failValidation(`${label} must be an object`);
  }

  for (const [key, fieldValue] of Object.entries(value)) {
    if (fieldValue === undefined || fieldValue === null) continue;
    if (key === 'workflowTokenBudgets') {
      if (!isPlainObject(fieldValue)) {
        failValidation(`${label}.workflowTokenBudgets must be an object`);
      }
      for (const [workflowKey, workflowBudget] of Object.entries(fieldValue)) {
        assertPositiveInteger(workflowBudget, `${label}.workflowTokenBudgets.${workflowKey}`);
      }
      continue;
    }
    assertPositiveInteger(fieldValue, `${label}.${key}`);
  }
}

function validateAnalysisLimitsConfig(value, label) {
  if (!isPlainObject(value)) {
    failValidation(`${label} must be an object`);
  }

  for (const [key, fieldValue] of Object.entries(value)) {
    if (fieldValue === undefined || fieldValue === null) continue;
    assertPositiveInteger(fieldValue, `${label}.${key}`);
  }
}

function validateMaskRule(rule, label) {
  if (!isPlainObject(rule)) {
    failValidation(`${label} must be an object`);
  }
  assertOptionalString(rule.schema, `${label}.schema`);
  assertOptionalString(rule.table, `${label}.table`);
  if (rule.columns !== undefined) {
    assertStringArray(rule.columns, `${label}.columns`);
  }
  assertOptionalString(rule.value, `${label}.value`);

  if (!rule.table && !rule.schema) {
    failValidation(`${label} must define at least one of .table or .schema`);
  }
  if (!Array.isArray(rule.columns) || rule.columns.length === 0) {
    failValidation(`${label}.columns must be a non-empty array of strings`);
  }
}

function validateTestDataConfig(value, label) {
  if (!isPlainObject(value)) {
    failValidation(`${label} must be an object`);
  }
  if (value.limit !== undefined) {
    assertPositiveInteger(value.limit, `${label}.limit`);
  }
  if (value.maskColumns !== undefined) {
    assertStringArray(value.maskColumns, `${label}.maskColumns`);
  }
  if (value.allowTables !== undefined) {
    assertStringArray(value.allowTables, `${label}.allowTables`);
  }
  if (value.denyTables !== undefined) {
    assertStringArray(value.denyTables, `${label}.denyTables`);
  }
  if (value.maskRules !== undefined) {
    if (!Array.isArray(value.maskRules)) {
      failValidation(`${label}.maskRules must be an array`);
    }
    value.maskRules.forEach((rule, index) => validateMaskRule(rule, `${label}.maskRules[${index}]`));
  }
}

function validateDbConfig(value, label) {
  if (!isPlainObject(value)) {
    failValidation(`${label} must be an object`);
  }
  assertOptionalString(value.host, `${label}.host`);
  assertOptionalString(value.url, `${label}.url`);
  assertOptionalString(value.user, `${label}.user`);
  assertOptionalString(value.password, `${label}.password`);
  assertOptionalString(value.defaultSchema, `${label}.defaultSchema`);
  assertOptionalString(value.defaultLibrary, `${label}.defaultLibrary`);
  assertOptionalString(value.schema, `${label}.schema`);
  assertOptionalString(value.library, `${label}.library`);
  if (value.schemaPreference !== undefined) {
    assertStringArray(value.schemaPreference, `${label}.schemaPreference`);
  }
}

function validateDbRoleConfig(value, label) {
  if (!isPlainObject(value)) {
    failValidation(`${label} must be an object`);
  }

  for (const [key, roleConfig] of Object.entries(value)) {
    if (key !== 'metadata' && key !== 'testData') {
      failValidation(`${label}.${key} is not supported; valid roles are metadata and testData`);
    }
    if (roleConfig === undefined || roleConfig === null) {
      continue;
    }
    validateDbConfig(roleConfig, `${label}.${key}`);
  }
}

function validateFetchProfile(value, label) {
  if (!isPlainObject(value)) {
    failValidation(`${label} must be an object`);
  }
  assertOptionalString(value.host, `${label}.host`);
  assertOptionalString(value.user, `${label}.user`);
  assertOptionalString(value.password, `${label}.password`);
  assertOptionalString(value.sourceLib, `${label}.sourceLib`);
  assertOptionalString(value.sourceLibrary, `${label}.sourceLibrary`);
  assertOptionalString(value.ifsDir, `${label}.ifsDir`);
  assertOptionalString(value.out, `${label}.out`);
  if (value.files !== undefined) {
    assertStringArray(value.files, `${label}.files`);
  }
  if (value.sourceFiles !== undefined) {
    assertStringArray(value.sourceFiles, `${label}.sourceFiles`);
  }
  if (value.members !== undefined) {
    assertStringArray(value.members, `${label}.members`);
  }
  if (value.replace !== undefined && typeof value.replace !== 'boolean') {
    failValidation(`${label}.replace must be a boolean`);
  }
  if (value.streamFileCcsid !== undefined) {
    assertPositiveInteger(value.streamFileCcsid, `${label}.streamFileCcsid`);
  }
  if (value.transport !== undefined) {
    assertOptionalString(value.transport, `${label}.transport`);
    const normalized = String(value.transport).trim().toLowerCase();
    if (normalized && !ALLOWED_FETCH_TRANSPORTS.has(normalized)) {
      failValidation(`${label}.transport must be one of: auto, sftp, jt400, ftp`);
    }
  }
  if (value.networkType !== undefined) {
    assertOptionalString(value.networkType, `${label}.networkType`);
    const normalized = String(value.networkType).trim().toLowerCase();
    if (normalized && normalized !== 'local' && normalized !== 'internet') {
      failValidation(`${label}.networkType must be one of: local, internet`);
    }
  }
  if (value.preferTransport !== undefined) {
    assertOptionalString(value.preferTransport, `${label}.preferTransport`);
    const normalized = String(value.preferTransport).trim().toLowerCase();
    if (normalized && !ALLOWED_FETCH_TRANSPORTS.has(normalized)) {
      failValidation(`${label}.preferTransport must be one of: auto, sftp, jt400, ftp`);
    }
  }
  if (value.transportTimeoutMs !== undefined) {
    assertPositiveInteger(value.transportTimeoutMs, `${label}.transportTimeoutMs`);
  }
}

function validateWorkCopyConfig(value, label) {
  if (!isPlainObject(value)) {
    failValidation(`${label} must be an object`);
  }
  assertOptionalString(value.root, `${label}.root`);
  if (value.extension !== undefined) {
    assertOptionalString(value.extension, `${label}.extension`);
    const normalized = String(value.extension).trim().toLowerCase();
    if (normalized && !ALLOWED_WORK_COPY_EXTENSIONS.has(normalized)) {
      failValidation(`${label}.extension must be one of: txt, original, suffixed`);
    }
  }
}

function validateTokenBudgetConfig(value, label) {
  if (!isPlainObject(value)) {
    failValidation(`${label} must be an object`);
  }
  for (const [key, budget] of Object.entries(value)) {
    assertPositiveInteger(budget, `${label}.${key}`);
  }
}

function validateWorkflowTableConfig(value, label) {
  if (!isPlainObject(value)) {
    failValidation(`${label} must be an object`);
  }
  assertOptionalString(value.schema, `${label}.schema`);
  assertOptionalString(value.table, `${label}.table`);
  assertOptionalString(value.filter, `${label}.filter`);
  if (!value.table || !String(value.table).trim()) {
    failValidation(`${label}.table must be a non-empty string`);
  }
}

function validateWorkflowImpactConfig(value, label) {
  if (!isPlainObject(value)) {
    failValidation(`${label} must be an object`);
  }
  assertOptionalString(value.target, `${label}.target`);
  assertOptionalString(value.field, `${label}.field`);
  assertOptionalString(value.program, `${label}.program`);
  assertOptionalString(value.member, `${label}.member`);
  if (!value.target && !value.field) {
    failValidation(`${label} must define at least one of .target or .field`);
  }
}

function validateWorkflowPresetDefinition(value, label) {
  if (!isPlainObject(value)) {
    failValidation(`${label} must be an object`);
  }
  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    failValidation(`${label}.steps must be a non-empty array`);
  }
  for (const step of value.steps) {
    const normalized = String(step || '').trim().toLowerCase();
    if (!ALLOWED_WORKFLOW_STEPS.has(normalized)) {
      failValidation(`${label}.steps contains an unsupported value: ${step}`);
    }
  }
  if (value.members !== undefined) {
    assertStringArray(value.members, `${label}.members`);
  }
  if (value.analyzeModes !== undefined) {
    assertStringArray(value.analyzeModes, `${label}.analyzeModes`);
  }
  if (value.tables !== undefined) {
    if (!Array.isArray(value.tables)) {
      failValidation(`${label}.tables must be an array`);
    }
    value.tables.forEach((entry, index) => validateWorkflowTableConfig(entry, `${label}.tables[${index}]`));
  }
  if (value.impact !== undefined) {
    if (!Array.isArray(value.impact)) {
      failValidation(`${label}.impact must be an array`);
    }
    value.impact.forEach((entry, index) => validateWorkflowImpactConfig(entry, `${label}.impact[${index}]`));
  }
  if (value.continueOnError !== undefined && typeof value.continueOnError !== 'boolean') {
    failValidation(`${label}.continueOnError must be a boolean`);
  }
}

function validateWorkflowPresetCollection(value, label) {
  if (!isPlainObject(value)) {
    failValidation(`${label} must be an object`);
  }
  for (const [key, preset] of Object.entries(value)) {
    validateWorkflowPresetDefinition(preset, `${label}.${key}`);
  }
}

function validateWorkflowConfig(value, label) {
  if (!isPlainObject(value)) {
    failValidation(`${label} must be an object`);
  }
  assertOptionalString(value.outputRoot, `${label}.outputRoot`);
  assertOptionalString(value.defaultPreset, `${label}.defaultPreset`);
  if (value.members !== undefined) {
    assertStringArray(value.members, `${label}.members`);
  }
  if (value.analyzeModes !== undefined) {
    assertStringArray(value.analyzeModes, `${label}.analyzeModes`);
  }
  if (value.tables !== undefined) {
    if (!Array.isArray(value.tables)) {
      failValidation(`${label}.tables must be an array`);
    }
    value.tables.forEach((entry, index) => validateWorkflowTableConfig(entry, `${label}.tables[${index}]`));
  }
  if (value.impact !== undefined) {
    if (!Array.isArray(value.impact)) {
      failValidation(`${label}.impact must be an array`);
    }
    value.impact.forEach((entry, index) => validateWorkflowImpactConfig(entry, `${label}.impact[${index}]`));
  }
  if (value.continueOnError !== undefined && typeof value.continueOnError !== 'boolean') {
    failValidation(`${label}.continueOnError must be a boolean`);
  }
  if (value.presets !== undefined) {
    validateWorkflowPresetCollection(value.presets, `${label}.presets`);
  }
}

function validateBridgeProfile(value, label) {
  if (!isPlainObject(value)) {
    failValidation(`${label} must be an object`);
  }
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
    failValidation(`${label}.enabled must be a boolean`);
  }
  if (value.mode !== undefined) {
    assertOptionalString(value.mode, `${label}.mode`);
    const normalized = String(value.mode || '').trim().toLowerCase();
    if (normalized && !ALLOWED_BRIDGE_MODES.has(normalized)) {
      failValidation(`${label}.mode must be one of: plan-only, plan-stage-apply, plan-stage-apply-compile`);
    }
  }
  if (value.requireConfirmation !== undefined && typeof value.requireConfirmation !== 'boolean') {
    failValidation(`${label}.requireConfirmation must be a boolean`);
  }
  if (value.allowAutoApprove !== undefined && typeof value.allowAutoApprove !== 'boolean') {
    failValidation(`${label}.allowAutoApprove must be a boolean`);
  }
  if (value.auditLog !== undefined && typeof value.auditLog !== 'boolean') {
    failValidation(`${label}.auditLog must be a boolean`);
  }
  if (value.allowedTargets !== undefined) {
    if (!isPlainObject(value.allowedTargets)) {
      failValidation(`${label}.allowedTargets must be an object`);
    }
    if (value.allowedTargets.libraries !== undefined) {
      assertStringArray(value.allowedTargets.libraries, `${label}.allowedTargets.libraries`);
    }
    if (value.allowedTargets.sourceFiles !== undefined) {
      assertStringArray(value.allowedTargets.sourceFiles, `${label}.allowedTargets.sourceFiles`);
    }
    if (value.allowedTargets.ifsPaths !== undefined) {
      assertStringArray(value.allowedTargets.ifsPaths, `${label}.allowedTargets.ifsPaths`);
    }
  }
  if (value.staging !== undefined) {
    if (!isPlainObject(value.staging)) {
      failValidation(`${label}.staging must be an object`);
    }
    if (value.staging.enabled !== undefined && typeof value.staging.enabled !== 'boolean') {
      failValidation(`${label}.staging.enabled must be a boolean`);
    }
    assertOptionalString(value.staging.library, `${label}.staging.library`);
    assertOptionalString(value.staging.sourceFile, `${label}.staging.sourceFile`);
    assertOptionalString(value.staging.ifsPath, `${label}.staging.ifsPath`);
  }
  if (value.compile !== undefined) {
    if (!isPlainObject(value.compile)) {
      failValidation(`${label}.compile must be an object`);
    }
    if (value.compile.enabled !== undefined && typeof value.compile.enabled !== 'boolean') {
      failValidation(`${label}.compile.enabled must be a boolean`);
    }
    if (value.compile.allowedTemplates !== undefined) {
      assertStringArray(value.compile.allowedTemplates, `${label}.compile.allowedTemplates`);
    }
    if (value.compile.requirePlan !== undefined && typeof value.compile.requirePlan !== 'boolean') {
      failValidation(`${label}.compile.requirePlan must be a boolean`);
    }
    if (value.compile.requireApproval !== undefined && typeof value.compile.requireApproval !== 'boolean') {
      failValidation(`${label}.compile.requireApproval must be a boolean`);
    }
  }
}

function validateNamedProfile(profile, label) {
  if (!isPlainObject(profile)) {
    failValidation(`${label} must be an object`);
  }
  assertOptionalStringOrStringArray(profile.extends, `${label}.extends`);
  assertOptionalString(profile.sourceRoot, `${label}.sourceRoot`);
  assertOptionalString(profile.outputRoot, `${label}.outputRoot`);
  if (profile.extensions !== undefined) {
    assertStringArray(profile.extensions, `${label}.extensions`);
  }
  if (profile.contextOptimizer !== undefined) {
    validateContextOptimizerConfig(profile.contextOptimizer, `${label}.contextOptimizer`);
  }
  if (profile.analysisLimits !== undefined) {
    validateAnalysisLimitsConfig(profile.analysisLimits, `${label}.analysisLimits`);
  }
  if (profile.testData !== undefined) {
    validateTestDataConfig(profile.testData, `${label}.testData`);
  }
  if (profile.db !== undefined) {
    validateDbConfig(profile.db, `${label}.db`);
  }
  if (profile.dbRoles !== undefined) {
    validateDbRoleConfig(profile.dbRoles, `${label}.dbRoles`);
  }
  if (profile.fetch !== undefined) {
    validateFetchProfile(profile.fetch, `${label}.fetch`);
  }
  if (profile.workCopy !== undefined) {
    validateWorkCopyConfig(profile.workCopy, `${label}.workCopy`);
  }
  if (profile.tokenBudget !== undefined) {
    validateTokenBudgetConfig(profile.tokenBudget, `${label}.tokenBudget`);
  }
  if (profile.workflow !== undefined) {
    validateWorkflowConfig(profile.workflow, `${label}.workflow`);
  }
  if (profile.presets !== undefined) {
    validateWorkflowPresetCollection(profile.presets, `${label}.presets`);
  }
  if (profile.bridge !== undefined) {
    validateBridgeProfile(profile.bridge, `${label}.bridge`);
  }
}

function validateProfiles(profiles) {
  if (!isPlainObject(profiles)) {
    failValidation('profiles root must be an object');
  }

  if (profiles.contextOptimizer !== undefined) {
    validateContextOptimizerConfig(profiles.contextOptimizer, 'contextOptimizer');
  }
  if (profiles.testData !== undefined) {
    validateTestDataConfig(profiles.testData, 'testData');
  }
  if (profiles.analysisLimits !== undefined) {
    validateAnalysisLimitsConfig(profiles.analysisLimits, 'analysisLimits');
  }
  if (profiles.presets !== undefined) {
    validateWorkflowPresetCollection(profiles.presets, 'presets');
  }

  for (const [key, value] of Object.entries(profiles)) {
    if (GLOBAL_PROFILE_KEYS.has(key)) continue;
    validateNamedProfile(value, `profile "${key}"`);
  }
}

function validateAnalyzeConfig(config) {
  if (config.sourceRoot !== undefined && config.sourceRoot !== null && typeof config.sourceRoot !== 'string') {
    failValidation('analyze.sourceRoot must be a string');
  }
  assertOptionalString(config.outputRoot, 'analyze.outputRoot');
  assertStringArray(config.extensions, 'analyze.extensions');
  if (config.ibmi !== null && config.ibmi !== undefined) {
    assertOptionalString(config.ibmi.host, 'analyze.ibmi.host');
    assertOptionalString(config.ibmi.user, 'analyze.ibmi.user');
    assertOptionalString(config.ibmi.password, 'analyze.ibmi.password');
  }
  if (config.contextOptimizer) {
    validateContextOptimizerConfig(config.contextOptimizer, 'analyze.contextOptimizer');
  }
  if (config.analysisLimits) {
    validateAnalysisLimitsConfig(config.analysisLimits, 'analyze.analysisLimits');
  }
  if (config.testData) {
    validateTestDataConfig(config.testData, 'analyze.testData');
  }
  if (config.db !== null && config.db !== undefined) {
    validateDbConfig(config.db, 'analyze.db');
  }
  if (config.dbRoles && typeof config.dbRoles === 'object') {
    validateDbRoleConfig(config.dbRoles, 'analyze.dbRoles');
  }
}

function validateFetchConfig(config) {
  assertOptionalString(config.host, 'fetch.host');
  assertOptionalString(config.user, 'fetch.user');
  assertOptionalString(config.password, 'fetch.password');
  assertOptionalString(config.sourceLib, 'fetch.sourceLib');
  assertOptionalString(config.sourceLibrary, 'fetch.sourceLibrary');
  assertOptionalString(config.ifsDir, 'fetch.ifsDir');
  assertOptionalString(config.out, 'fetch.out');
  assertStringArray(config.files, 'fetch.files');
  assertStringArray(config.members, 'fetch.members');
  if (typeof config.replace !== 'boolean') {
    failValidation('fetch.replace must be a boolean');
  }
  assertPositiveInteger(config.streamFileCcsid, 'fetch.streamFileCcsid');
  assertOptionalString(config.transport, 'fetch.transport');
  if (!ALLOWED_FETCH_TRANSPORTS.has(config.transport)) {
    failValidation('fetch.transport must be one of: auto, sftp, jt400, ftp');
  }
}

function validateBundleConfig(config) {
  assertOptionalString(config.sourceOutputRoot, 'bundle.sourceOutputRoot');
  assertOptionalString(config.bundleOutputRoot, 'bundle.bundleOutputRoot');
}

module.exports = {
  validateAnalyzeConfig,
  validateBundleConfig,
  validateFetchConfig,
  validateProfiles,
};
