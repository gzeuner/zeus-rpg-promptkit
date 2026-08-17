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
'use strict';

const fs = require('fs');
const path = require('path');

const WORKING_CONTEXT_DIR = '.zeus';
const WORKING_CONTEXT_FILE = 'working-context.json';
const WORKING_CONTEXT_SCHEMA_VERSION = 1;
const RESOURCE_KINDS = Object.freeze(['sourceCode', 'objects', 'metadata', 'data']);

const RESOURCE_DEFAULTS = Object.freeze({
  sourceCode: Object.freeze({
    profile: null,
    system: null,
    library: null,
    sourceFile: null,
    member: null,
    localRoot: null,
    path: null,
    ifsPath: null,
  }),
  objects: Object.freeze({
    profile: null,
    system: null,
    library: null,
    objectType: null,
    objectName: null,
  }),
  metadata: Object.freeze({
    profile: null,
    system: null,
    schema: null,
    table: null,
  }),
  data: Object.freeze({
    profile: null,
    system: null,
    schema: null,
    table: null,
  }),
});

function textOrNull(value, { upper = false } = {}) {
  if (value === undefined || value === null || value === false) return null;
  const text = String(value).trim();
  if (!text) return null;
  return upper ? text.toUpperCase() : text;
}

function firstDefined(source, keys) {
  for (const key of keys) {
    if (source && Object.prototype.hasOwnProperty.call(source, key)) {
      return source[key];
    }
  }
  return undefined;
}

function normalizeResource(kind, input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const defaults = RESOURCE_DEFAULTS[kind] || {};
  const normalized = {};

  for (const field of Object.keys(defaults)) {
    const aliases = {
      profile: ['profile'],
      system: ['system', 'systemKey', 'systemName'],
      library: ['library', 'sourceLibrary', 'sourceLib'],
      sourceFile: ['sourceFile', 'file'],
      member: ['member'],
      localRoot: ['localRoot', 'sourceRoot', 'out'],
      path: ['path', 'localPath', 'relativePath'],
      ifsPath: ['ifsPath', 'ifsDir'],
      schema: ['schema', 'library'],
      table: ['table'],
      objectType: ['objectType'],
      objectName: ['objectName', 'name'],
    }[field] || [field];
    const value = firstDefined(source, aliases);
    normalized[field] = textOrNull(value, {
      upper: [
        'system',
        'library',
        'sourceFile',
        'member',
        'schema',
        'table',
        'objectType',
        'objectName',
      ].includes(field),
    });
  }

  return normalized;
}

function createDefaultWorkingContext() {
  return {
    kind: 'zeus-working-context',
    schemaVersion: WORKING_CONTEXT_SCHEMA_VERSION,
    activeKind: 'sourceCode',
    profile: null,
    updatedAt: null,
    resources: Object.fromEntries(
      RESOURCE_KINDS.map(kind => [kind, normalizeResource(kind, RESOURCE_DEFAULTS[kind])])
    ),
    lastChange: null,
  };
}

function normalizeWorkingContext(raw) {
  const base = createDefaultWorkingContext();
  const input = raw && typeof raw === 'object' ? raw : {};
  const activeKind = RESOURCE_KINDS.includes(input.activeKind) ? input.activeKind : base.activeKind;
  const resources = {};

  for (const kind of RESOURCE_KINDS) {
    resources[kind] = normalizeResource(kind, {
      ...base.resources[kind],
      ...(input.resources && input.resources[kind]),
    });
  }

  const profile = textOrNull(input.profile) || resources[activeKind].profile || null;
  return {
    kind: 'zeus-working-context',
    schemaVersion: WORKING_CONTEXT_SCHEMA_VERSION,
    activeKind,
    profile,
    updatedAt: textOrNull(input.updatedAt),
    resources,
    lastChange:
      input.lastChange && typeof input.lastChange === 'object'
        ? {
            at: textOrNull(input.lastChange.at),
            actor: textOrNull(input.lastChange.actor),
            fields: Array.isArray(input.lastChange.fields)
              ? input.lastChange.fields.map(value => String(value)).filter(Boolean)
              : [],
          }
        : null,
  };
}

function getWorkingContextPath(cwd = process.cwd()) {
  return path.resolve(cwd, WORKING_CONTEXT_DIR, WORKING_CONTEXT_FILE);
}

function loadWorkingContext({ cwd = process.cwd() } = {}) {
  const storagePath = getWorkingContextPath(cwd);
  let context = createDefaultWorkingContext();
  if (fs.existsSync(storagePath)) {
    try {
      context = normalizeWorkingContext(JSON.parse(fs.readFileSync(storagePath, 'utf8')));
    } catch (_) {
      context = createDefaultWorkingContext();
    }
  }
  return { context, storagePath, exists: fs.existsSync(storagePath) };
}

function writeWorkingContext({ cwd = process.cwd(), context }) {
  const storagePath = getWorkingContextPath(cwd);
  const normalized = normalizeWorkingContext(context);
  fs.mkdirSync(path.dirname(storagePath), { recursive: true });
  const temporaryPath = `${storagePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, storagePath);
  return { context: normalized, storagePath };
}

function setWorkingContext({ cwd = process.cwd(), patch = {}, actor = 'operator' } = {}) {
  const loaded = loadWorkingContext({ cwd });
  const current = loaded.context;
  const next = normalizeWorkingContext({
    ...current,
    ...patch,
    resources: {
      ...current.resources,
      ...(patch.resources || {}),
    },
  });
  const fields = [];
  if (patch.activeKind !== undefined) fields.push('activeKind');
  if (patch.profile !== undefined) fields.push('profile');
  for (const kind of RESOURCE_KINDS) {
    for (const field of Object.keys(RESOURCE_DEFAULTS[kind])) {
      if (patch.resources && patch.resources[kind] && patch.resources[kind][field] !== undefined) {
        fields.push(`${kind}.${field}`);
      }
    }
  }
  next.updatedAt = new Date().toISOString();
  next.lastChange = { at: next.updatedAt, actor: textOrNull(actor) || 'operator', fields };
  return writeWorkingContext({ cwd, context: next });
}

function clearWorkingContext({ cwd = process.cwd(), actor = 'operator' } = {}) {
  const now = new Date().toISOString();
  const context = createDefaultWorkingContext();
  context.updatedAt = now;
  context.lastChange = { at: now, actor: textOrNull(actor) || 'operator', fields: ['*'] };
  return writeWorkingContext({ cwd, context });
}

function getActiveResource(context) {
  const normalized = normalizeWorkingContext(context);
  return {
    kind: normalized.activeKind,
    profile: normalized.profile || normalized.resources[normalized.activeKind].profile || null,
    ...normalized.resources[normalized.activeKind],
  };
}

function buildWorkingContextView({ cwd = process.cwd(), includeStoragePath = false } = {}) {
  const loaded = loadWorkingContext({ cwd });
  const view = {
    ...loaded.context,
    active: getActiveResource(loaded.context),
    control: {
      explicitArgumentsOverrideContext: true,
      persistentState: 'workspace-local',
      containsCredentials: false,
      storage: '.zeus/working-context.json',
    },
  };
  if (includeStoragePath) view.storagePath = loaded.storagePath;
  return view;
}

function applyWorkingContextDefaults(args = {}, { cwd = process.cwd(), command = '' } = {}) {
  const current = normalizeWorkingContext(loadWorkingContext({ cwd }).context);
  const active = current.resources[current.activeKind] || {};
  const next = { ...args };
  const setIfMissing = (key, value) => {
    if (next[key] === undefined || next[key] === null || next[key] === '') {
      if (value !== undefined && value !== null && value !== '') next[key] = value;
    }
  };

  const profileResource =
    command === 'fetch' || command === 'fetch-member'
      ? current.resources.sourceCode
      : command === 'query-table' || command === 'query-sql'
        ? current.resources.metadata
        : active;
  const profile = profileResource.profile || current.profile || active.profile;
  if (['analyze', 'fetch', 'fetch-member', 'query-table', 'query-sql'].includes(command)) {
    setIfMissing('profile', profile);
  }

  if (command === 'analyze') {
    setIfMissing('source', current.resources.sourceCode.localRoot);
    setIfMissing('source-root', current.resources.sourceCode.localRoot);
    setIfMissing('member', current.resources.sourceCode.member);
    setIfMissing('program', current.resources.sourceCode.member);
  }

  if (command === 'fetch' || command === 'fetch-member') {
    const source = current.resources.sourceCode;
    setIfMissing('system', source.system);
    setIfMissing('source-lib', source.library);
    setIfMissing('source-library', source.library);
    setIfMissing('lib', source.library);
    setIfMissing('file', source.sourceFile);
    setIfMissing('source-file', source.sourceFile);
    setIfMissing('member', source.member);
    setIfMissing('out', source.localRoot);
  }

  if (command === 'query-table' || command === 'query-sql') {
    const metadata = current.resources.metadata;
    setIfMissing('schema', metadata.schema);
    setIfMissing('library', metadata.schema);
    setIfMissing('default-schema', metadata.schema);
    setIfMissing('table', metadata.table || current.resources.data.table);
  }

  return { args: next, context: buildWorkingContextView({ cwd }) };
}

module.exports = {
  WORKING_CONTEXT_DIR,
  WORKING_CONTEXT_FILE,
  WORKING_CONTEXT_SCHEMA_VERSION,
  RESOURCE_KINDS,
  createDefaultWorkingContext,
  normalizeWorkingContext,
  getWorkingContextPath,
  loadWorkingContext,
  writeWorkingContext,
  setWorkingContext,
  clearWorkingContext,
  getActiveResource,
  buildWorkingContextView,
  applyWorkingContextDefaults,
};
