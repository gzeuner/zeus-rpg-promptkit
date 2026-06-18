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
const path = require('path');

const {
  describeProfilesLocation,
  getProfilesMetadata,
  loadProfiles,
  resolveProfile,
  resolveProfilesConfigPaths,
  validateProfiles,
} = require('../config/runtimeConfig');
const { buildSafeCliPreview } = require('./guidedConfigWizardModel');

const PROFILE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const SYSTEM_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;
const ENV_VAR_NAME_PATTERN = /^[A-Z0-9_]+$/;
const MIXIN_PROFILE_PREFIX = '_';
const GLOBAL_PROFILE_KEYS = new Set(['contextOptimizer', 'testData', 'analysisLimits', 'presets']);
const MANAGED_ENVIRONMENT_PROFILE_KEY = '_gui-environments';
const MANAGED_ENVIRONMENT_PROFILE_COMMENT = 'GUI-managed local-only environment catalog.';
const PROFILE_WIZARD_STEP_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'identity', description: 'Set the profile name, comment, and base profile extensions.', statusWhenMissing: 'needs-profile-input' }),
  Object.freeze({ id: 'workspace', description: 'Review source, output, and analysis registry paths.', statusWhenMissing: 'needs-profile-input' }),
  Object.freeze({ id: 'environment-routing', description: 'Bind DB and fetch roles to known system keys.', statusWhenMissing: 'needs-scope' }),
  Object.freeze({ id: 'fetch-scope', description: 'Define source library, IFS directory, file, member, and transport scope.', statusWhenMissing: 'needs-scope' }),
  Object.freeze({ id: 'managed-environments', description: 'Create local-only managed environment placeholders.', statusWhenMissing: 'needs-profile-input' }),
  Object.freeze({ id: 'preview-save', description: 'Validate and save the local-only overlay.', statusWhenMissing: 'preview-ready' }),
]);

class ProfileWizardError extends Error {
  constructor(message, statusCode = 400, details = null) {
    super(message);
    this.name = 'ProfileWizardError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMixinProfile(profileName) {
  return typeof profileName === 'string' && profileName.startsWith(MIXIN_PROFILE_PREFIX);
}

function mergeConfigLayers(baseValue, overrideValue) {
  if (overrideValue === undefined) {
    if (Array.isArray(baseValue)) return [...baseValue];
    if (isPlainObject(baseValue)) {
      return Object.fromEntries(Object.entries(baseValue).map(([key, value]) => [key, mergeConfigLayers(value, undefined)]));
    }
    return baseValue;
  }

  if (Array.isArray(overrideValue)) {
    return [...overrideValue];
  }

  if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
    const keys = new Set([...Object.keys(baseValue), ...Object.keys(overrideValue)]);
    const merged = {};
    for (const key of keys) {
      merged[key] = mergeConfigLayers(baseValue[key], overrideValue[key]);
    }
    return merged;
  }

  if (isPlainObject(overrideValue)) {
    return Object.fromEntries(Object.entries(overrideValue).map(([key, value]) => [key, mergeConfigLayers(undefined, value)]));
  }

  return overrideValue;
}

function sanitizeWorkspacePathForUi(value, cwd) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return null;
  }

  if (!path.isAbsolute(trimmed)) {
    return trimmed.replace(/\\/g, '/');
  }

  const relative = path.relative(cwd, trimmed);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return '(configured outside project root)';
  }

  const normalized = relative.split(path.sep).join('/');
  return normalized.startsWith('.') ? normalized : `./${normalized}`;
}

function uniqueTrimmedStrings(values, { uppercase = false } = {}) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .map((entry) => (uppercase ? entry.toUpperCase() : entry))));
}

function normalizeEnvReference(varName) {
  const trimmed = String(varName || '').trim().toUpperCase();
  if (!trimmed) {
    return '';
  }
  if (!ENV_VAR_NAME_PATTERN.test(trimmed)) {
    throw new ProfileWizardError(`Invalid environment variable name: ${varName}`, 400, {
      diagnostics: [{
        code: 'INVALID_ENV_VAR_NAME',
        severity: 'error',
        stepId: 'managed-environments',
        fieldPath: 'managedEnvironments',
        message: `Invalid environment variable name: ${varName}`,
      }],
    });
  }
  return trimmed;
}

function normalizeProfileName(value, fieldName = 'profileName') {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw new ProfileWizardError(`${fieldName} is required`, 400, {
      diagnostics: [{
        code: 'REQUIRED_FIELD',
        severity: 'error',
        stepId: fieldName === 'profileName' ? 'identity' : 'environment-routing',
        fieldPath: fieldName,
        message: `${fieldName} is required`,
      }],
    });
  }
  if (trimmed.includes('..') || !PROFILE_NAME_PATTERN.test(trimmed)) {
    throw new ProfileWizardError(`${fieldName} contains unsupported characters`, 400, {
      diagnostics: [{
        code: 'UNSUPPORTED_CHARACTERS',
        severity: 'error',
        stepId: fieldName === 'profileName' ? 'identity' : 'environment-routing',
        fieldPath: fieldName,
        message: `${fieldName} contains unsupported characters`,
      }],
    });
  }
  return trimmed;
}

function normalizeOptionalProfileName(value, fieldName) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.includes('..') || !PROFILE_NAME_PATTERN.test(trimmed)) {
    throw new ProfileWizardError(`${fieldName} contains unsupported characters`, 400);
  }
  return trimmed;
}

function normalizeBoolean(value) {
  return Boolean(value);
}

function normalizeCsvList(value, { uppercase = false } = {}) {
  return uniqueTrimmedStrings(String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean), { uppercase });
}

function extractComment(value) {
  const trimmed = String(value || '').trim();
  return trimmed || '';
}

function summarizeSystemDefinition(systemKey, definition = {}, sourceProfile) {
  const aliases = uniqueTrimmedStrings(definition.aliases);
  const hostValue = String(definition.host || '').trim();
  const userValue = String(definition.user || '').trim();
  const passwordValue = String(definition.password || '').trim();
  const hostEnvRef = hostValue.match(/^\$\{env:([A-Z0-9_]+)\}$/);
  const userEnvRef = userValue.match(/^\$\{env:([A-Z0-9_]+)\}$/);
  const passwordEnvRef = passwordValue.match(/^\$\{env:([A-Z0-9_]+)\}$/);

  return {
    key: systemKey,
    sourceProfile,
    managedByGui: sourceProfile === MANAGED_ENVIRONMENT_PROFILE_KEY,
    displayName: String(definition.displayName || '').trim() || systemKey,
    systemName: String(definition.systemName || '').trim() || '',
    aliasCount: aliases.length,
    aliases,
    hostMode: hostEnvRef ? 'env-reference' : (hostValue ? 'configured' : 'missing'),
    hostEnvVar: hostEnvRef ? hostEnvRef[1] : '',
    userMode: userEnvRef ? 'env-reference' : (userValue ? 'configured' : 'missing'),
    userEnvVar: userEnvRef ? userEnvRef[1] : '',
    passwordMode: passwordEnvRef ? 'env-reference' : (passwordValue ? 'env-reference-required' : 'missing'),
    passwordEnvVar: passwordEnvRef ? passwordEnvRef[1] : '',
    defaultLibrary: String(definition.defaultLibrary || '').trim().toUpperCase(),
    defaultSchema: String(definition.defaultSchema || '').trim().toUpperCase(),
  };
}

function summarizeProfileEntry(profileName, profile = {}) {
  const extendsList = Array.isArray(profile.extends)
    ? uniqueTrimmedStrings(profile.extends)
    : uniqueTrimmedStrings(profile.extends ? [profile.extends] : []);
  const fetch = isPlainObject(profile.fetch) ? profile.fetch : null;
  const workflow = isPlainObject(profile.workflow) ? profile.workflow : null;
  const db = isPlainObject(profile.db) ? profile.db : null;
  const dbRoles = isPlainObject(profile.dbRoles) ? profile.dbRoles : null;
  return {
    name: profileName,
    mixin: isMixinProfile(profileName),
    comment: extractComment(profile._comment),
    extends: extendsList,
    usesManagedEnvironmentSet: extendsList.includes(MANAGED_ENVIRONMENT_PROFILE_KEY),
    productionSystem: Boolean(profile.productionSystem),
    hasLocalSourceRoot: Boolean(String(profile.sourceRoot || '').trim()),
    hasOutputRoot: Boolean(String(profile.outputRoot || '').trim()),
    hasFetch: Boolean(fetch),
    hasWorkflow: Boolean(workflow),
    hasDb: Boolean(db),
    fetchSourceLibrary: String(fetch && (fetch.sourceLibrary || fetch.sourceLib) || '').trim().toUpperCase(),
    fetchSourceFileCount: uniqueTrimmedStrings(fetch && (fetch.sourceFiles || fetch.files), { uppercase: true }).length,
    workflowMemberCount: uniqueTrimmedStrings(workflow && workflow.members, { uppercase: true }).length,
    dbSystemKey: String(db && db.system || '').trim(),
    metadataSystemKey: String(dbRoles && dbRoles.metadata && dbRoles.metadata.system || '').trim(),
    testDataSystemKey: String(dbRoles && dbRoles.testData && dbRoles.testData.system || '').trim(),
    fetchSystemKey: String(fetch && fetch.system || '').trim(),
  };
}

function buildWizardHandoffCommands(profileName) {
  const safeProfileName = String(profileName || '').trim() || 'dev';
  return [
    {
      id: 'doctor',
      title: 'Check readiness',
      command: `zeus doctor --profile ${safeProfileName}`,
    },
    {
      id: 'fetch',
      title: 'Fetch selected source scope',
      command: `zeus fetch --profile ${safeProfileName}`,
    },
    {
      id: 'analyze',
      title: 'Analyze workspace',
      command: `zeus analyze --profile ${safeProfileName} --program ORDERPGM`,
    },
  ];
}

function buildEmptyDraft() {
  return {
    profileName: '',
    comment: '',
    extends: ['default-shared'],
    sourceRoot: './workspace/source',
    outputRoot: './workspace/output',
    analysesRegistryPath: './analysis/_registry.json',
    productionSystem: false,
    environmentBindings: {
      defaultDbSystem: '',
      metadataSystem: '',
      testDataSystem: '',
      fetchSystem: '',
    },
    fetch: {
      enabled: true,
      sourceLibrary: '',
      ifsDir: '',
      out: './rpg_sources',
      files: ['QRPGLESRC', 'QCLSRC', 'QDDSSRC'],
      members: [],
      transport: 'auto',
    },
    managedEnvironments: [],
  };
}

function normalizeManagedEnvironmentDraft(entry, index) {
  if (!isPlainObject(entry)) {
    throw new ProfileWizardError(`managedEnvironments[${index}] must be an object`, 400);
  }

  const key = normalizeOptionalProfileName(entry.key, `managedEnvironments[${index}].key`);
  if (!key) {
    throw new ProfileWizardError(`managedEnvironments[${index}].key is required`, 400, {
      diagnostics: [{
        code: 'REQUIRED_FIELD',
        severity: 'error',
        stepId: 'managed-environments',
        fieldPath: `managedEnvironments[${index}].key`,
        message: `managedEnvironments[${index}].key is required`,
      }],
    });
  }
  if (!SYSTEM_KEY_PATTERN.test(key)) {
    throw new ProfileWizardError(`managedEnvironments[${index}].key contains unsupported characters`, 400, {
      diagnostics: [{
        code: 'UNSUPPORTED_CHARACTERS',
        severity: 'error',
        stepId: 'managed-environments',
        fieldPath: `managedEnvironments[${index}].key`,
        message: `managedEnvironments[${index}].key contains unsupported characters`,
      }],
    });
  }

  return {
    key,
    displayName: String(entry.displayName || '').trim(),
    systemName: String(entry.systemName || '').trim(),
    aliases: normalizeCsvList(entry.aliases),
    hostEnvVar: normalizeEnvReference(entry.hostEnvVar),
    userEnvVar: normalizeEnvReference(entry.userEnvVar),
    passwordEnvVar: normalizeEnvReference(entry.passwordEnvVar),
    defaultLibrary: String(entry.defaultLibrary || '').trim().toUpperCase(),
    defaultSchema: String(entry.defaultSchema || '').trim().toUpperCase(),
  };
}

function normalizeProfileWizardDraft(payload) {
  if (!isPlainObject(payload)) {
    throw new ProfileWizardError('Expected JSON object payload', 400);
  }

  const profileName = normalizeProfileName(payload.profileName);
  const extendsList = Array.isArray(payload.extends)
    ? uniqueTrimmedStrings(payload.extends)
    : normalizeCsvList(payload.extends);
  const environmentBindings = isPlainObject(payload.environmentBindings) ? payload.environmentBindings : {};
  const fetch = isPlainObject(payload.fetch) ? payload.fetch : {};

  const managedEnvironments = (Array.isArray(payload.managedEnvironments) ? payload.managedEnvironments : [])
    .map((entry, index) => normalizeManagedEnvironmentDraft(entry, index));
  const managedEnvironmentKeys = new Set();
  for (const entry of managedEnvironments) {
    if (managedEnvironmentKeys.has(entry.key)) {
      throw new ProfileWizardError(`Duplicate managed environment key: ${entry.key}`, 400, {
        diagnostics: [{
          code: 'DUPLICATE_MANAGED_ENVIRONMENT_KEY',
          severity: 'error',
          stepId: 'managed-environments',
          fieldPath: 'managedEnvironments',
          message: `Duplicate managed environment key: ${entry.key}`,
        }],
      });
    }
    managedEnvironmentKeys.add(entry.key);
  }

  return {
    profileName,
    comment: extractComment(payload.comment),
    extends: extendsList,
    sourceRoot: String(payload.sourceRoot || '').trim(),
    outputRoot: String(payload.outputRoot || '').trim(),
    analysesRegistryPath: String(payload.analysesRegistryPath || '').trim(),
    productionSystem: normalizeBoolean(payload.productionSystem),
    environmentBindings: {
      defaultDbSystem: normalizeOptionalProfileName(environmentBindings.defaultDbSystem, 'environmentBindings.defaultDbSystem'),
      metadataSystem: normalizeOptionalProfileName(environmentBindings.metadataSystem, 'environmentBindings.metadataSystem'),
      testDataSystem: normalizeOptionalProfileName(environmentBindings.testDataSystem, 'environmentBindings.testDataSystem'),
      fetchSystem: normalizeOptionalProfileName(environmentBindings.fetchSystem, 'environmentBindings.fetchSystem'),
    },
    fetch: {
      enabled: fetch.enabled === undefined ? true : normalizeBoolean(fetch.enabled),
      sourceLibrary: String(fetch.sourceLibrary || '').trim().toUpperCase(),
      ifsDir: String(fetch.ifsDir || '').trim(),
      out: String(fetch.out || '').trim(),
      files: Array.isArray(fetch.files) ? uniqueTrimmedStrings(fetch.files, { uppercase: true }) : normalizeCsvList(fetch.files, { uppercase: true }),
      members: Array.isArray(fetch.members) ? uniqueTrimmedStrings(fetch.members, { uppercase: true }) : normalizeCsvList(fetch.members, { uppercase: true }),
      transport: String(fetch.transport || '').trim().toLowerCase(),
    },
    managedEnvironments,
  };
}

function buildManagedEnvironmentProfile(draft) {
  const systems = {};
  for (const entry of draft.managedEnvironments) {
    systems[entry.key] = {
      displayName: entry.displayName || undefined,
      systemName: entry.systemName || undefined,
      aliases: entry.aliases.length > 0 ? entry.aliases : undefined,
      host: entry.hostEnvVar ? `\${env:${entry.hostEnvVar}}` : undefined,
      user: entry.userEnvVar ? `\${env:${entry.userEnvVar}}` : undefined,
      password: entry.passwordEnvVar ? `\${env:${entry.passwordEnvVar}}` : undefined,
      defaultLibrary: entry.defaultLibrary || undefined,
      defaultSchema: entry.defaultSchema || undefined,
    };
  }

  if (Object.keys(systems).length === 0) {
    return null;
  }

  return {
    _comment: MANAGED_ENVIRONMENT_PROFILE_COMMENT,
    systems,
  };
}

function buildProfileFromDraft(draft) {
  const profile = {};
  if (draft.comment) profile._comment = draft.comment;
  if (draft.extends.length > 0) profile.extends = draft.extends;
  if (draft.sourceRoot) profile.sourceRoot = draft.sourceRoot;
  if (draft.outputRoot) profile.outputRoot = draft.outputRoot;
  if (draft.analysesRegistryPath) profile.analysesRegistryPath = draft.analysesRegistryPath;
  if (draft.productionSystem) profile.productionSystem = true;

  if (draft.environmentBindings.defaultDbSystem) {
    profile.db = { system: draft.environmentBindings.defaultDbSystem };
  }

  const dbRoles = {};
  if (draft.environmentBindings.metadataSystem) {
    dbRoles.metadata = { system: draft.environmentBindings.metadataSystem };
  }
  if (draft.environmentBindings.testDataSystem) {
    dbRoles.testData = { system: draft.environmentBindings.testDataSystem };
  }
  if (Object.keys(dbRoles).length > 0) {
    profile.dbRoles = dbRoles;
  }

  if (draft.fetch.enabled || draft.environmentBindings.fetchSystem || draft.fetch.sourceLibrary || draft.fetch.files.length > 0 || draft.fetch.members.length > 0) {
    const fetch = {};
    if (draft.environmentBindings.fetchSystem) {
      fetch.system = draft.environmentBindings.fetchSystem;
    }
    if (draft.fetch.sourceLibrary) {
      fetch.sourceLibrary = draft.fetch.sourceLibrary;
    }
    if (draft.fetch.ifsDir) {
      fetch.ifsDir = draft.fetch.ifsDir;
    }
    if (draft.fetch.out) {
      fetch.out = draft.fetch.out;
    }
    if (draft.fetch.files.length > 0) {
      fetch.files = draft.fetch.files;
    }
    if (draft.fetch.members.length > 0) {
      fetch.members = draft.fetch.members;
    }
    if (draft.fetch.transport) {
      fetch.transport = draft.fetch.transport;
    }
    profile.fetch = fetch;
  }

  return profile;
}

function mergePreviewProfiles(baseProfiles, draft) {
  let nextProfiles = mergeConfigLayers(baseProfiles, {});
  const managedEnvironmentProfile = buildManagedEnvironmentProfile(draft);
  if (managedEnvironmentProfile) {
    nextProfiles[MANAGED_ENVIRONMENT_PROFILE_KEY] = managedEnvironmentProfile;
  }
  if (draft.extends.includes(MANAGED_ENVIRONMENT_PROFILE_KEY) && !managedEnvironmentProfile && !nextProfiles[MANAGED_ENVIRONMENT_PROFILE_KEY]) {
    throw new ProfileWizardError('The draft extends the GUI-managed environment catalog, but no managed environments are defined yet.', 400);
  }
  nextProfiles[draft.profileName] = buildProfileFromDraft(draft);
  return nextProfiles;
}

function extractManagedEnvironmentDraft(profilesRoot) {
  const entry = isPlainObject(profilesRoot && profilesRoot[MANAGED_ENVIRONMENT_PROFILE_KEY])
    ? profilesRoot[MANAGED_ENVIRONMENT_PROFILE_KEY]
    : null;
  const systems = isPlainObject(entry && entry.systems) ? entry.systems : {};
  return Object.entries(systems).map(([key, definition]) => {
    const summary = summarizeSystemDefinition(key, definition, MANAGED_ENVIRONMENT_PROFILE_KEY);
    return {
      key,
      displayName: summary.displayName === key ? '' : summary.displayName,
      systemName: summary.systemName,
      aliases: summary.aliases.join(', '),
      hostEnvVar: summary.hostEnvVar,
      userEnvVar: summary.userEnvVar,
      passwordEnvVar: summary.passwordEnvVar,
      defaultLibrary: summary.defaultLibrary,
      defaultSchema: summary.defaultSchema,
    };
  }).sort((left, right) => left.key.localeCompare(right.key));
}

function buildDraftFromProfile(profileName, profilesRoot) {
  const entry = isPlainObject(profilesRoot && profilesRoot[profileName]) ? profilesRoot[profileName] : {};
  const fetch = isPlainObject(entry.fetch) ? entry.fetch : {};
  const db = isPlainObject(entry.db) ? entry.db : {};
  const dbRoles = isPlainObject(entry.dbRoles) ? entry.dbRoles : {};

  return {
    profileName,
    comment: extractComment(entry._comment),
    extends: Array.isArray(entry.extends)
      ? uniqueTrimmedStrings(entry.extends)
      : uniqueTrimmedStrings(entry.extends ? [entry.extends] : []),
    sourceRoot: String(entry.sourceRoot || '').trim(),
    outputRoot: String(entry.outputRoot || '').trim(),
    analysesRegistryPath: String(entry.analysesRegistryPath || '').trim(),
    productionSystem: Boolean(entry.productionSystem),
    environmentBindings: {
      defaultDbSystem: String(db.system || '').trim(),
      metadataSystem: String(dbRoles.metadata && dbRoles.metadata.system || '').trim(),
      testDataSystem: String(dbRoles.testData && dbRoles.testData.system || '').trim(),
      fetchSystem: String(fetch.system || '').trim(),
    },
    fetch: {
      enabled: Boolean(fetch && Object.keys(fetch).length > 0),
      sourceLibrary: String(fetch.sourceLibrary || fetch.sourceLib || '').trim().toUpperCase(),
      ifsDir: String(fetch.ifsDir || '').trim(),
      out: String(fetch.out || '').trim(),
      files: uniqueTrimmedStrings(fetch.sourceFiles || fetch.files, { uppercase: true }),
      members: uniqueTrimmedStrings(fetch.members, { uppercase: true }),
      transport: String(fetch.transport || '').trim().toLowerCase(),
    },
    managedEnvironments: extractManagedEnvironmentDraft(profilesRoot),
  };
}

function readLocalOnlyProfilesFile(fsModule, localOnlyPath) {
  if (!fsModule.existsSync(localOnlyPath)) {
    return {};
  }
  const raw = fsModule.readFileSync(localOnlyPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!isPlainObject(parsed)) {
    throw new ProfileWizardError('Local-only profiles file must contain a JSON object root.', 500);
  }
  return parsed;
}

function summarizeAllSystems(profilesRoot = {}) {
  const summaries = [];
  for (const [profileName, entry] of Object.entries(profilesRoot)) {
    if (!isPlainObject(entry) || !isPlainObject(entry.systems)) {
      continue;
    }
    for (const [systemKey, definition] of Object.entries(entry.systems)) {
      summaries.push(summarizeSystemDefinition(systemKey, definition, profileName));
    }
  }
  return summaries.sort((left, right) => {
    if (left.managedByGui !== right.managedByGui) {
      return left.managedByGui ? -1 : 1;
    }
    return left.key.localeCompare(right.key);
  });
}

function summarizeProfilesForWizard(mergedProfiles, localOnlyProfiles) {
  return Object.entries(mergedProfiles)
    .filter(([name]) => !GLOBAL_PROFILE_KEYS.has(name))
    .map(([name, profile]) => {
      const summary = summarizeProfileEntry(name, profile);
      const savedInLocalOnly = Object.prototype.hasOwnProperty.call(localOnlyProfiles, name);
      return {
        ...summary,
        sourceKind: savedInLocalOnly ? 'local-only' : 'shared',
        savedInLocalOnly,
        deleteAllowed: savedInLocalOnly && !summary.mixin,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function listManagedEnvironmentDependents(profilesRoot = {}, { excludeProfileName = '' } = {}) {
  return Object.entries(profilesRoot)
    .filter(([profileName, entry]) => (
      profileName !== MANAGED_ENVIRONMENT_PROFILE_KEY
      && profileName !== excludeProfileName
      && !GLOBAL_PROFILE_KEYS.has(profileName)
      && isPlainObject(entry)
      && summarizeProfileEntry(profileName, entry).usesManagedEnvironmentSet
    ))
    .map(([profileName]) => profileName)
    .sort((left, right) => left.localeCompare(right));
}

function createDraftDiagnostic({
  code,
  severity = 'warn',
  stepId,
  fieldPath,
  message,
}) {
  return {
    code,
    severity,
    stepId,
    fieldPath,
    message,
  };
}

function buildDraftDiagnostics({
  draft,
  mergedProfiles,
}) {
  const diagnostics = [];
  const knownSystems = new Set(summarizeAllSystems(mergedProfiles).map((entry) => entry.key));
  const add = (entry) => diagnostics.push(createDraftDiagnostic(entry));

  if (!draft.sourceRoot) {
    add({
      code: 'REQUIRED_FIELD',
      severity: 'error',
      stepId: 'workspace',
      fieldPath: 'sourceRoot',
      message: 'Source Root is required for a complete CLI handoff.',
    });
  }
  if (!draft.outputRoot) {
    add({
      code: 'REQUIRED_FIELD',
      severity: 'error',
      stepId: 'workspace',
      fieldPath: 'outputRoot',
      message: 'Output Root is required for a complete CLI handoff.',
    });
  }
  if (!draft.analysesRegistryPath) {
    add({
      code: 'RECOMMENDED_FIELD',
      severity: 'warn',
      stepId: 'workspace',
      fieldPath: 'analysesRegistryPath',
      message: 'Analyses Registry is recommended so Analyze Workspace can reuse a consistent local registry file.',
    });
  }

  const bindingEntries = [
    ['environmentBindings.defaultDbSystem', draft.environmentBindings.defaultDbSystem],
    ['environmentBindings.metadataSystem', draft.environmentBindings.metadataSystem],
    ['environmentBindings.testDataSystem', draft.environmentBindings.testDataSystem],
    ['environmentBindings.fetchSystem', draft.environmentBindings.fetchSystem],
  ];
  const selectedBindingCount = bindingEntries.filter(([, value]) => String(value || '').trim()).length;
  if (selectedBindingCount === 0) {
    add({
      code: 'NO_ENVIRONMENT_BINDINGS',
      severity: 'warn',
      stepId: 'environment-routing',
      fieldPath: 'environmentBindings.defaultDbSystem',
      message: 'No environment roles are selected yet.',
    });
  }
  for (const [fieldPath, value] of bindingEntries) {
    const normalized = String(value || '').trim();
    if (normalized && !knownSystems.has(normalized)) {
      add({
        code: 'UNKNOWN_ENVIRONMENT_KEY',
        severity: 'warn',
        stepId: 'environment-routing',
        fieldPath,
        message: `Unknown environment key: ${normalized}`,
      });
    }
  }

  if (draft.fetch.enabled !== false) {
    if (!draft.fetch.sourceLibrary && !draft.fetch.ifsDir) {
      add({
        code: 'FETCH_SCOPE_INCOMPLETE',
        severity: 'error',
        stepId: 'fetch-scope',
        fieldPath: 'fetch.sourceLibrary',
        message: 'Set either Source Library or IFS Directory before using fetch in this profile.',
      });
    }
    if (draft.fetch.files.length === 0 && draft.fetch.members.length === 0) {
      add({
        code: 'FETCH_FILTERS_RECOMMENDED',
        severity: 'warn',
        stepId: 'fetch-scope',
        fieldPath: 'fetch.files',
        message: 'No Source Files or Members are selected yet. Review whether an unbounded fetch scope is intended.',
      });
    }
  }

  if (draft.extends.includes(MANAGED_ENVIRONMENT_PROFILE_KEY) && draft.managedEnvironments.length === 0) {
    add({
      code: 'MANAGED_ENVIRONMENTS_REQUIRED',
      severity: 'error',
      stepId: 'managed-environments',
      fieldPath: 'managedEnvironments',
      message: 'This draft extends _gui-environments but currently defines no managed environments.',
    });
  }
  for (const [index, entry] of draft.managedEnvironments.entries()) {
    if (!entry.hostEnvVar) {
      add({
        code: 'ENV_REFERENCE_RECOMMENDED',
        severity: 'warn',
        stepId: 'managed-environments',
        fieldPath: `managedEnvironments[${index}].hostEnvVar`,
        message: `Managed environment "${entry.key}" is missing a host env-variable placeholder.`,
      });
    }
    if (!entry.userEnvVar) {
      add({
        code: 'ENV_REFERENCE_RECOMMENDED',
        severity: 'warn',
        stepId: 'managed-environments',
        fieldPath: `managedEnvironments[${index}].userEnvVar`,
        message: `Managed environment "${entry.key}" is missing a user env-variable placeholder.`,
      });
    }
    if (!entry.passwordEnvVar) {
      add({
        code: 'ENV_REFERENCE_RECOMMENDED',
        severity: 'warn',
        stepId: 'managed-environments',
        fieldPath: `managedEnvironments[${index}].passwordEnvVar`,
        message: `Managed environment "${entry.key}" is missing a password env-variable placeholder.`,
      });
    }
  }

  return diagnostics;
}

function buildStepValidation(stepDefinitions, diagnostics, previewValid) {
  return stepDefinitions.map((step) => {
    const stepDiagnostics = diagnostics.filter((entry) => entry.stepId === step.id);
    const blockingDiagnostics = stepDiagnostics.filter((entry) => entry.severity === 'error');
    const top = blockingDiagnostics[0] || stepDiagnostics[0] || null;
    if (step.id === 'preview-save') {
      return {
        id: step.id,
        status: blockingDiagnostics.length > 0
          ? 'needs-profile-input'
          : (previewValid ? 'save-ready' : 'preview-ready'),
        diagnosticCount: stepDiagnostics.length,
        message: blockingDiagnostics.length > 0
          ? 'Resolve blocking draft diagnostics before saving.'
          : (previewValid ? 'Preview validated successfully.' : 'Run Preview Draft to refresh backend validation.'),
      };
    }
    return {
      id: step.id,
      status: blockingDiagnostics.length > 0
        ? (step.statusWhenMissing || 'needs-profile-input')
        : (stepDiagnostics.length > 0 ? 'review' : 'ready'),
      diagnosticCount: stepDiagnostics.length,
      message: top ? top.message : step.description,
    };
  });
}

function buildDraftConflicts({
  draft,
  mergedProfiles,
  localOnlyProfiles,
}) {
  const conflicts = [];
  const existingProfile = isPlainObject(mergedProfiles[draft.profileName]) ? mergedProfiles[draft.profileName] : null;
  const savedInLocalOnly = Object.prototype.hasOwnProperty.call(localOnlyProfiles, draft.profileName);
  if (existingProfile && !savedInLocalOnly) {
    conflicts.push({
      code: 'PROFILE_SHADOWS_SHARED',
      severity: 'warn',
      message: `Saving this draft will shadow the shared profile "${draft.profileName}" inside config/local-only/profiles.json.`,
    });
  }

  const externalSystems = summarizeAllSystems(mergedProfiles)
    .filter((entry) => !entry.managedByGui);
  const externalSystemMap = new Map(externalSystems.map((entry) => [entry.key, entry]));
  for (const entry of draft.managedEnvironments) {
    const collision = externalSystemMap.get(entry.key);
    if (collision) {
      conflicts.push({
        code: 'MANAGED_ENVIRONMENT_SHADOWS_SHARED',
        severity: 'warn',
        message: `Managed environment "${entry.key}" already exists in shared profile "${collision.sourceProfile}" and would be shadowed by the GUI-managed catalog.`,
      });
    }
  }

  const dependentProfiles = listManagedEnvironmentDependents(mergedProfiles, {
    excludeProfileName: draft.profileName,
  });
  if (draft.managedEnvironments.length > 0 && dependentProfiles.length > 0) {
    conflicts.push({
      code: 'MANAGED_ENVIRONMENT_UPDATES_AFFECT_OTHER_PROFILES',
      severity: 'warn',
      message: `Updating the GUI-managed environment catalog can affect these profiles too: ${dependentProfiles.join(', ')}.`,
    });
  }
  if (draft.managedEnvironments.length === 0 && Object.prototype.hasOwnProperty.call(localOnlyProfiles, MANAGED_ENVIRONMENT_PROFILE_KEY)) {
    conflicts.push({
      code: 'MANAGED_ENVIRONMENT_CATALOG_UNCHANGED',
      severity: 'info',
      message: 'This draft does not include managed environment edits. The existing local-only GUI environment catalog will be kept unchanged.',
    });
  }

  return conflicts;
}

function createProfileWizardService({
  cwd = process.cwd(),
  env = process.env,
  fsModule = fs,
} = {}) {
  function resolveStoragePaths() {
    const configPaths = resolveProfilesConfigPaths({ cwd, env, args: {} });
    const localOnlyPath = path.join(configPaths.configDir, 'local-only', 'profiles.json');
    return {
      configDir: configPaths.configDir,
      localOnlyPath,
      safeLocalOnlyPath: sanitizeWorkspacePathForUi(localOnlyPath, cwd),
    };
  }

  function loadMergedProfilesOrThrow() {
    return loadProfiles({
      cwd,
      env,
      mergeConfigLayers,
      validateProfiles,
    });
  }

  function loadLocalOnlyProfiles() {
    const storage = resolveStoragePaths();
    return {
      storage,
      localOnlyProfiles: readLocalOnlyProfilesFile(fsModule, storage.localOnlyPath),
    };
  }

  function getState() {
    const mergedProfiles = loadMergedProfilesOrThrow();
    const metadata = getProfilesMetadata(mergedProfiles);
    const { storage, localOnlyProfiles } = loadLocalOnlyProfiles();
    const safeSourcePath = sanitizeWorkspacePathForUi(metadata && metadata.profilePath, cwd);

    return {
      schemaVersion: 1,
      mode: 'local-only-profile-wizard',
      source: {
        loadedFrom: safeSourcePath || '(no profile file found yet)',
        localOnlyTarget: storage.safeLocalOnlyPath || './config/local-only/profiles.json',
        description: describeProfilesLocation(mergedProfiles),
      },
      managedEnvironmentProfileKey: MANAGED_ENVIRONMENT_PROFILE_KEY,
      profiles: summarizeProfilesForWizard(mergedProfiles, localOnlyProfiles),
      systems: summarizeAllSystems(mergedProfiles),
      managedEnvironmentUsage: {
        dependentProfiles: listManagedEnvironmentDependents(mergedProfiles),
      },
      draft: buildEmptyDraft(),
      managedEnvironmentDraft: extractManagedEnvironmentDraft(localOnlyProfiles),
    };
  }

  function previewDraft(rawPayload) {
    const mergedProfiles = loadMergedProfilesOrThrow();
    const { localOnlyProfiles } = loadLocalOnlyProfiles();
    const draft = normalizeProfileWizardDraft(rawPayload);
    const previewProfiles = mergePreviewProfiles(mergedProfiles, draft);
    validateProfiles(previewProfiles);
    resolveProfile(previewProfiles, draft.profileName, { env });

    const profilePreview = buildProfileFromDraft(draft);
    const environmentPreview = buildManagedEnvironmentProfile(draft);
    const conflicts = buildDraftConflicts({
      draft,
      mergedProfiles,
      localOnlyProfiles,
    });
    const diagnostics = buildDraftDiagnostics({
      draft,
      mergedProfiles,
    });
    const allDiagnostics = [...diagnostics, ...conflicts.map((entry) => ({
      code: entry.code,
      severity: entry.severity,
      stepId: entry.code.startsWith('MANAGED_ENVIRONMENT') ? 'managed-environments' : 'preview-save',
      fieldPath: entry.code.startsWith('MANAGED_ENVIRONMENT') ? 'managedEnvironments' : 'profileName',
      message: entry.message,
    }))];
    const stepValidation = buildStepValidation(PROFILE_WIZARD_STEP_DEFINITIONS, allDiagnostics, true);

    return {
      schemaVersion: 1,
      valid: true,
      draft,
      profilePreview,
      managedEnvironmentProfilePreview: environmentPreview,
      safeCliPreview: buildSafeCliPreview({
        profileName: draft.profileName,
        intentId: 'onboarding',
        sourceRoot: draft.sourceRoot,
        outputRoot: draft.outputRoot,
      }),
      handoffCommands: buildWizardHandoffCommands(draft.profileName),
      conflicts,
      diagnostics: allDiagnostics,
      stepValidation,
      notes: [
        'This preview validates local profile structure only and does not run doctor, fetch, or remote checks.',
        environmentPreview
          ? 'Managed environments are emitted with environment-variable placeholders instead of secret values.'
          : 'No managed environment catalog changes are included in this preview.',
        conflicts.length > 0
          ? 'Review the shadowing warnings before saving this local-only overlay.'
          : 'No shared profile or shared system shadowing was detected for this draft.',
      ],
    };
  }

  function saveDraft(rawPayload) {
    const draft = normalizeProfileWizardDraft(rawPayload);
    const preview = previewDraft(rawPayload);
    const { storage, localOnlyProfiles } = loadLocalOnlyProfiles();
    const nextLocalOnlyProfiles = mergeConfigLayers(localOnlyProfiles, {});
    const managedEnvironmentProfile = buildManagedEnvironmentProfile(draft);

    nextLocalOnlyProfiles[draft.profileName] = buildProfileFromDraft(draft);
    if (managedEnvironmentProfile) {
      nextLocalOnlyProfiles[MANAGED_ENVIRONMENT_PROFILE_KEY] = managedEnvironmentProfile;
    }

    validateProfiles(mergeConfigLayers(loadMergedProfilesOrThrow(), nextLocalOnlyProfiles));

    fsModule.mkdirSync(path.dirname(storage.localOnlyPath), { recursive: true });
    fsModule.writeFileSync(storage.localOnlyPath, `${JSON.stringify(nextLocalOnlyProfiles, null, 2)}\n`, 'utf8');

    return {
      schemaVersion: 1,
      saved: true,
      profileName: draft.profileName,
      localOnlyTarget: storage.safeLocalOnlyPath || './config/local-only/profiles.json',
      preview,
    };
  }

  function readProfileDraft(profileName) {
    const mergedProfiles = loadMergedProfilesOrThrow();
    const { localOnlyProfiles } = loadLocalOnlyProfiles();
    const normalizedName = normalizeProfileName(profileName, 'profileName');
    if (!isPlainObject(mergedProfiles[normalizedName])) {
      throw new ProfileWizardError(`Unknown profile: ${normalizedName}`, 404);
    }
    const savedInLocalOnly = Object.prototype.hasOwnProperty.call(localOnlyProfiles, normalizedName);
    return {
      schemaVersion: 1,
      profileName: normalizedName,
      sourceKind: savedInLocalOnly ? 'local-only' : 'shared',
      deleteAllowed: savedInLocalOnly,
      draft: buildDraftFromProfile(normalizedName, mergedProfiles),
    };
  }

  function deleteProfile(profileName) {
    const normalizedName = normalizeProfileName(profileName, 'profileName');
    if (normalizedName === MANAGED_ENVIRONMENT_PROFILE_KEY) {
      throw new ProfileWizardError('The GUI-managed environment catalog cannot be deleted through the profile delete route.', 400);
    }

    const { storage, localOnlyProfiles } = loadLocalOnlyProfiles();
    if (!Object.prototype.hasOwnProperty.call(localOnlyProfiles, normalizedName)) {
      throw new ProfileWizardError(`Only local-only profiles can be deleted here: ${normalizedName}`, 404);
    }

    const nextLocalOnlyProfiles = mergeConfigLayers(localOnlyProfiles, {});
    delete nextLocalOnlyProfiles[normalizedName];

    fsModule.mkdirSync(path.dirname(storage.localOnlyPath), { recursive: true });
    fsModule.writeFileSync(storage.localOnlyPath, `${JSON.stringify(nextLocalOnlyProfiles, null, 2)}\n`, 'utf8');

    return {
      schemaVersion: 1,
      deleted: true,
      profileName: normalizedName,
      localOnlyTarget: storage.safeLocalOnlyPath || './config/local-only/profiles.json',
      notes: [
        `Deleted local-only profile "${normalizedName}" from the GUI overlay.`,
        'If a shared profile with the same name exists, it will become visible again after the next reload.',
      ],
    };
  }

  return {
    deleteProfile,
    getState,
    previewDraft,
    readProfileDraft,
    saveDraft,
  };
}

module.exports = {
  MANAGED_ENVIRONMENT_PROFILE_KEY,
  ProfileWizardError,
  buildEmptyDraft,
  buildManagedEnvironmentProfile,
  buildProfileFromDraft,
  createProfileWizardService,
  normalizeProfileWizardDraft,
  summarizeProfileEntry,
  summarizeSystemDefinition,
};
