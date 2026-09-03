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

const crypto = require('crypto');

const {
  RESOURCE_KINDS,
  loadWorkingContext,
  normalizeWorkingContext,
  setWorkingContext,
} = require('../context/workingContext');

const MAX_LENGTHS = Object.freeze({
  profile: 128,
  system: 128,
  library: 128,
  sourceFile: 128,
  member: 128,
  localRoot: 1024,
  path: 1024,
  ifsPath: 1024,
  schema: 128,
  table: 128,
  objectType: 128,
  objectName: 128,
});

const RESOURCE_FIELDS = Object.freeze({
  sourceCode: Object.freeze([
    'profile',
    'system',
    'library',
    'sourceFile',
    'member',
    'localRoot',
    'path',
    'ifsPath',
  ]),
  objects: Object.freeze(['profile', 'system', 'library', 'objectType', 'objectName']),
  metadata: Object.freeze(['profile', 'system', 'schema', 'table']),
  data: Object.freeze(['profile', 'system', 'schema', 'table']),
});

class WorkingContextWizardError extends Error {
  constructor(message, statusCode = 400, code = 'WORKING_CONTEXT_INVALID') {
    super(message);
    this.name = 'WorkingContextWizardError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkingContextWizardError(`${label} must be an object`);
  }
}

function normalizeText(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new WorkingContextWizardError(`${field} must be text`);
  }
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > MAX_LENGTHS[field]) {
    throw new WorkingContextWizardError(`${field} exceeds the maximum length`);
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) {
    throw new WorkingContextWizardError(`${field} contains unsupported control characters`);
  }
  return text;
}

function rejectUnknownKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter(key => !allowed.has(key));
  if (unknown.length) {
    throw new WorkingContextWizardError(
      `${label} contains unsupported field(s): ${unknown.join(', ')}`
    );
  }
}

function normalizeResourceDraft(kind, raw) {
  const input = raw === undefined ? {} : raw;
  assertPlainObject(input, `resources.${kind}`);
  const fields = RESOURCE_FIELDS[kind];
  rejectUnknownKeys(input, new Set(fields), `resources.${kind}`);
  return Object.fromEntries(fields.map(field => [field, normalizeText(input[field], field)]));
}

function normalizeDraft(rawDraft) {
  const draft = rawDraft && typeof rawDraft === 'object' ? rawDraft : {};
  assertPlainObject(draft, 'draft');
  const allowed = new Set(['activeKind', 'profile', 'resources']);
  rejectUnknownKeys(draft, allowed, 'draft');

  const activeKind =
    draft.activeKind === undefined ? 'sourceCode' : String(draft.activeKind).trim();
  if (!RESOURCE_KINDS.includes(activeKind)) {
    throw new WorkingContextWizardError(
      `draft.activeKind must be one of: ${RESOURCE_KINDS.join(', ')}`
    );
  }

  const resources = draft.resources === undefined ? {} : draft.resources;
  assertPlainObject(resources, 'draft.resources');
  rejectUnknownKeys(resources, new Set(RESOURCE_KINDS), 'draft.resources');

  return {
    activeKind,
    profile: normalizeText(draft.profile, 'profile'),
    resources: Object.fromEntries(
      RESOURCE_KINDS.map(kind => [kind, normalizeResourceDraft(kind, resources[kind])])
    ),
  };
}

function contextWithoutVolatileFields(context) {
  const normalized = normalizeWorkingContext(context);
  return {
    kind: normalized.kind,
    schemaVersion: normalized.schemaVersion,
    activeKind: normalized.activeKind,
    profile: normalized.profile,
    resources: normalized.resources,
  };
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function buildContextFromDraft(current, draft) {
  return normalizeWorkingContext({
    ...current,
    activeKind: draft.activeKind,
    profile: draft.profile,
    resources: draft.resources,
  });
}

function diffContexts(before, after) {
  const left = contextWithoutVolatileFields(before);
  const right = contextWithoutVolatileFields(after);
  const changes = [];
  if (left.activeKind !== right.activeKind) {
    changes.push({ field: 'activeKind', before: left.activeKind, after: right.activeKind });
  }
  if (left.profile !== right.profile) {
    changes.push({ field: 'profile', before: left.profile, after: right.profile });
  }
  for (const kind of RESOURCE_KINDS) {
    for (const field of RESOURCE_FIELDS[kind]) {
      const beforeValue = left.resources[kind][field];
      const afterValue = right.resources[kind][field];
      if (beforeValue !== afterValue) {
        changes.push({
          field: `${kind}.${field}`,
          before: beforeValue,
          after: afterValue,
        });
      }
    }
  }
  return changes;
}

function buildWarnings(context) {
  const active = context.resources[context.activeKind];
  const warnings = [];
  if (!context.profile && !active.profile) {
    warnings.push('No profile is selected; Doctor will need an explicit profile.');
  }
  if (context.activeKind === 'sourceCode') {
    const missing = ['system', 'library', 'sourceFile', 'member'].filter(field => !active[field]);
    if (missing.length) warnings.push(`Source scope is incomplete: ${missing.join(', ')}.`);
  }
  if (context.activeKind === 'metadata' || context.activeKind === 'data') {
    const missing = ['system', 'schema', 'table'].filter(field => !active[field]);
    if (missing.length) warnings.push(`Database scope is incomplete: ${missing.join(', ')}.`);
  }
  return warnings;
}

function publicContextSnapshot(context, { exists = true } = {}) {
  const normalized = normalizeWorkingContext(context);
  return {
    ...contextWithoutVolatileFields(normalized),
    updatedAt: normalized.updatedAt,
    lastChange: normalized.lastChange,
    active: {
      ...normalized.resources[normalized.activeKind],
      kind: normalized.activeKind,
    },
    exists,
    source: exists ? 'workspace-file' : 'default-empty-context',
    control: {
      explicitArgumentsOverrideContext: true,
      persistentState: 'workspace-local',
      containsCredentials: false,
      storage: '.zeus/working-context.json',
    },
  };
}

function createWorkingContextWizardService({ cwd = process.cwd() } = {}) {
  function currentSnapshot() {
    const loaded = loadWorkingContext({ cwd });
    return {
      context: loaded.context,
      snapshot: publicContextSnapshot(loaded.context, { exists: loaded.exists }),
      fingerprint: fingerprint(contextWithoutVolatileFields(loaded.context)),
    };
  }

  function previewDraft(payload = {}) {
    assertPlainObject(payload, 'request');
    rejectUnknownKeys(payload, new Set(['draft']), 'request');
    const draft = normalizeDraft(payload.draft);
    const current = currentSnapshot();
    const proposed = buildContextFromDraft(current.context, draft);
    const proposedPublic = publicContextSnapshot(proposed);
    return {
      action: 'working-context-preview',
      status: 'ready',
      draft,
      current: current.snapshot,
      proposed: proposedPublic,
      changes: diffContexts(current.context, proposed),
      warnings: buildWarnings(proposed),
      baseFingerprint: current.fingerprint,
      fingerprint: fingerprint(contextWithoutVolatileFields(proposed)),
      canSave: true,
      notes: [
        'Preview is local-only and does not change the working context.',
        'The saved context contains routing metadata only; credentials remain in the configured profile/environment stores.',
      ],
    };
  }

  function saveDraft(payload = {}) {
    assertPlainObject(payload, 'request');
    rejectUnknownKeys(
      payload,
      new Set(['draft', 'confirm', 'baseFingerprint', 'previewFingerprint']),
      'request'
    );
    if (payload.confirm !== true) {
      throw new WorkingContextWizardError(
        'Saving the working context requires explicit confirmation',
        400,
        'WORKING_CONTEXT_CONFIRMATION_REQUIRED'
      );
    }
    if (typeof payload.baseFingerprint !== 'string' || !payload.baseFingerprint.trim()) {
      throw new WorkingContextWizardError(
        'Save requires the fingerprint of the reviewed context',
        400,
        'WORKING_CONTEXT_BASE_FINGERPRINT_REQUIRED'
      );
    }
    if (typeof payload.previewFingerprint !== 'string' || !payload.previewFingerprint.trim()) {
      throw new WorkingContextWizardError(
        'Save requires a current preview fingerprint',
        400,
        'WORKING_CONTEXT_PREVIEW_REQUIRED'
      );
    }

    const draft = normalizeDraft(payload.draft);
    const current = currentSnapshot();
    if (current.fingerprint !== payload.baseFingerprint) {
      throw new WorkingContextWizardError(
        'The working context changed after preview; reload it and review the new diff',
        409,
        'WORKING_CONTEXT_CONFLICT'
      );
    }
    const proposed = buildContextFromDraft(current.context, draft);
    const proposedFingerprint = fingerprint(contextWithoutVolatileFields(proposed));
    if (proposedFingerprint !== payload.previewFingerprint) {
      throw new WorkingContextWizardError(
        'The working context draft differs from the reviewed preview',
        409,
        'WORKING_CONTEXT_PREVIEW_STALE'
      );
    }

    const result = setWorkingContext({
      cwd,
      actor: 'ui-operator',
      patch: {
        activeKind: proposed.activeKind,
        profile: proposed.profile,
        resources: proposed.resources,
      },
    });
    const saved = currentSnapshot();
    return {
      action: 'working-context-save',
      status: 'saved',
      context: saved.snapshot,
      changes: diffContexts(current.context, saved.context),
      warnings: buildWarnings(saved.context),
      fingerprint: saved.fingerprint,
      updatedAt: saved.context.updatedAt,
      notes: [
        'Working context saved locally. No profile, environment, credential, or remote-system data was changed.',
      ],
      storage:
        result && result.storagePath ? '.zeus/working-context.json' : '.zeus/working-context.json',
    };
  }

  return { currentSnapshot, normalizeDraft, previewDraft, saveDraft };
}

module.exports = {
  MAX_LENGTHS,
  RESOURCE_FIELDS,
  WorkingContextWizardError,
  createWorkingContextWizardService,
  normalizeDraft,
  diffContexts,
};
