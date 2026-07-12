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
  ALLOWED_WORKFLOW_STEPS,
  DEFAULT_WORKFLOW_ANALYZE_MODES,
} = require('./runtimeConfigDefaults');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeWorkflowStepList(steps) {
  return Array.from(
    new Set(
      (steps || [])
        .map(entry =>
          String(entry || '')
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    )
  ).filter(entry => ALLOWED_WORKFLOW_STEPS.has(entry));
}

function normalizeWorkflowMemberList(values) {
  return Array.from(
    new Set(
      (values || [])
        .map(entry =>
          String(entry || '')
            .trim()
            .toUpperCase()
        )
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
}

function normalizeWorkflowAnalyzeModes(values) {
  const normalized = Array.from(
    new Set((values || []).map(entry => String(entry || '').trim()).filter(Boolean))
  );
  return normalized.length > 0 ? normalized : [...DEFAULT_WORKFLOW_ANALYZE_MODES];
}

function normalizeWorkflowTables(values) {
  return (Array.isArray(values) ? values : [])
    .map(entry => ({
      schema: entry && entry.schema ? String(entry.schema).trim().toUpperCase() : '',
      table: entry && entry.table ? String(entry.table).trim().toUpperCase() : '',
      filter: entry && entry.filter ? String(entry.filter).trim().toUpperCase() : '',
    }))
    .filter(entry => entry.table);
}

function normalizeWorkflowImpact(values) {
  return (Array.isArray(values) ? values : [])
    .map(entry => ({
      target: entry && entry.target ? String(entry.target).trim().toUpperCase() : '',
      field: entry && entry.field ? String(entry.field).trim().toUpperCase() : '',
      program: entry && entry.program ? String(entry.program).trim().toUpperCase() : '',
      member: entry && entry.member ? String(entry.member).trim().toUpperCase() : '',
    }))
    .filter(entry => entry.target || entry.field);
}

function normalizeWorkflowPresetMap(value, { mergeConfigLayers, resolveEnvPlaceholdersDeep }) {
  if (!isPlainObject(value)) {
    return {};
  }
  const entries = Object.entries(value).map(([name, preset]) => {
    const normalizedName = String(name || '').trim();
    return [
      normalizedName,
      {
        name: normalizedName,
        steps: normalizeWorkflowStepList(preset && preset.steps),
        members: normalizeWorkflowMemberList(preset && preset.members),
        analyzeModes: normalizeWorkflowAnalyzeModes(preset && preset.analyzeModes),
        tables: normalizeWorkflowTables(preset && preset.tables),
        impact: normalizeWorkflowImpact(preset && preset.impact),
        continueOnError: Boolean(preset && preset.continueOnError),
      },
    ];
  });
  return Object.fromEntries(entries.filter(([name, preset]) => name && preset.steps.length > 0));
}

function readWorkflowConfig(
  profiles,
  profile,
  env,
  { mergeConfigLayers, resolveEnvPlaceholdersDeep } = {}
) {
  const globalPresets =
    profiles && typeof profiles.presets === 'object'
      ? resolveEnvPlaceholdersDeep(profiles.presets, env)
      : {};
  const profilePresets =
    profile && typeof profile.presets === 'object'
      ? resolveEnvPlaceholdersDeep(profile.presets, env)
      : {};
  const workflowConfig =
    profile && typeof profile.workflow === 'object'
      ? resolveEnvPlaceholdersDeep(profile.workflow, env)
      : {};
  const workflowPresets =
    workflowConfig && typeof workflowConfig.presets === 'object' ? workflowConfig.presets : {};

  return {
    outputRoot: workflowConfig.outputRoot || (profile && profile.outputRoot) || 'analysis',
    defaultPreset: String(workflowConfig.defaultPreset || '').trim(),
    continueOnError: Boolean(workflowConfig.continueOnError),
    members: normalizeWorkflowMemberList(workflowConfig.members),
    analyzeModes: normalizeWorkflowAnalyzeModes(workflowConfig.analyzeModes),
    tables: normalizeWorkflowTables(workflowConfig.tables),
    impact: normalizeWorkflowImpact(workflowConfig.impact),
    presets: normalizeWorkflowPresetMap(
      mergeConfigLayers(mergeConfigLayers(globalPresets, profilePresets), workflowPresets),
      {
        mergeConfigLayers,
        resolveEnvPlaceholdersDeep,
      }
    ),
  };
}

function resolveWorkflowPresetConfig(
  profiles,
  profile,
  presetName,
  env = process.env,
  { readWorkflowConfig, describeProfilesLocation } = {}
) {
  const workflowConfig = readWorkflowConfig(profiles, profile, env);
  if (!presetName) {
    return null;
  }
  const key = String(presetName).trim();
  const preset = workflowConfig.presets[key];
  if (!preset) {
    throw new Error(
      `Workflow preset "${presetName}" not found in ${describeProfilesLocation(profiles)}`
    );
  }
  return preset;
}

module.exports = {
  readWorkflowConfig,
  resolveWorkflowPresetConfig,
};
