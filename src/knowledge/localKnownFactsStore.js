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
const { randomUUID } = require('crypto');
const { version: toolVersion } = require('../../package.json');

const LOCAL_KNOWN_FACTS_SCHEMA_VERSION = 1;
const LOCAL_KNOWN_FACTS_KIND = 'zeus-local-known-facts';
const DEFAULT_TTL_DAYS = 30;
const SECRET_FIELD_PATTERN =
  /(password|passwd|secret|token|api[_-]?key|access[_-]?key|credential|connection[_-]?string|dsn|private[_-]?key)/i;
const SECRET_VALUE_PATTERN =
  /\b(?:pwd|password|secret|token|api[_-]?key|authorization|bearer)\s*[:=]/i;

function normalizeString(value, fallback = '') {
  const normalized = String(value === undefined || value === null ? '' : value).trim();
  return normalized || fallback;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(entry => normalizeString(entry)).filter(Boolean))).sort(
    (a, b) => a.localeCompare(b)
  );
}

function normalizeProfileName(profileName) {
  const normalized = normalizeString(profileName);
  if (!normalized) {
    throw new Error('Known facts profile name is required.');
  }
  return normalized;
}

function sanitizeProfileSegment(profileName) {
  const segment = normalizeProfileName(profileName)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/(^-|-$)/g, '');
  if (!segment) {
    throw new Error('Known facts profile name must contain at least one safe path character.');
  }
  return segment;
}

function normalizeKnownFactsStorePath(profileName, { cwd = process.cwd(), storePath = '' } = {}) {
  const provided = normalizeString(storePath);
  if (provided) {
    return path.resolve(cwd, provided);
  }
  return path.resolve(
    cwd,
    'config',
    'local-only',
    'known-facts',
    `${sanitizeProfileSegment(profileName)}.json`
  );
}

function ensureStoreDirectory(storePath) {
  fs.mkdirSync(path.dirname(path.resolve(storePath)), { recursive: true });
}

function normalizeTtlDays(value) {
  const ttlDays = Number(value);
  return Number.isInteger(ttlDays) && ttlDays > 0 ? ttlDays : DEFAULT_TTL_DAYS;
}

function normalizeTimestamp(value, fallback = null) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return fallback;
  }
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid timestamp: ${normalized}`);
  }
  return new Date(timestamp).toISOString();
}

function resolveExpiresAt(updatedAt, ttlDays) {
  const timestamp = Date.parse(String(updatedAt || ''));
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp + normalizeTtlDays(ttlDays) * 24 * 60 * 60 * 1000).toISOString();
}

function normalizeConfidence(value) {
  const normalized = normalizeString(value).toUpperCase();
  if (!normalized) return null;
  if (!['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'].includes(normalized)) {
    throw new Error(`Unsupported known fact confidence: ${normalized}`);
  }
  return normalized;
}

function assertSafeText(label, value) {
  const fieldLabel = normalizeString(label);
  const text = normalizeString(value);
  if (!text) return;
  if (
    SECRET_FIELD_PATTERN.test(fieldLabel) ||
    SECRET_FIELD_PATTERN.test(text) ||
    SECRET_VALUE_PATTERN.test(text) ||
    /:\/\/[^/\s:@]+:[^/\s@]+@/.test(text)
  ) {
    throw new Error(`Known facts must not store secrets: ${fieldLabel || 'value'}`);
  }
}

function createFactId(subject, attribute) {
  const base =
    `${normalizeString(subject)}-${normalizeString(attribute)}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 48) || 'known-fact';
  return `${base}-${randomUUID().split('-')[0]}`;
}

function sanitizeFact(input, nowIso) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Known fact entries must be objects.');
  }

  const subject = normalizeString(input.subject);
  const attribute = normalizeString(input.attribute || input.predicate);
  const value = normalizeString(input.value);
  if (!subject) {
    throw new Error('Known fact subject is required.');
  }
  if (!attribute) {
    throw new Error('Known fact attribute is required.');
  }
  if (!value) {
    throw new Error('Known fact value is required.');
  }

  const source = normalizeString(input.source);
  const notes = normalizeString(input.notes);
  const tags = normalizeStringArray(input.tags);
  const uncertainty = normalizeStringArray(input.uncertainty);
  const confidence = normalizeConfidence(input.confidence);
  const observedAt = normalizeTimestamp(input.observedAt, nowIso);
  const expiresAt = normalizeTimestamp(input.expiresAt, null);
  const id = normalizeString(input.id, createFactId(subject, attribute));

  assertSafeText('id', id);
  assertSafeText('subject', subject);
  assertSafeText('attribute', attribute);
  assertSafeText('value', value);
  assertSafeText('source', source);
  assertSafeText('notes', notes);
  for (const tag of tags) {
    assertSafeText('tag', tag);
  }

  return {
    id,
    subject,
    attribute,
    value,
    confidence,
    uncertainty,
    source: source || null,
    notes: notes || null,
    observedAt,
    expiresAt,
    tags,
  };
}

function buildEmptyKnownFactsStore(profileName, options = {}) {
  return {
    schemaVersion: LOCAL_KNOWN_FACTS_SCHEMA_VERSION,
    kind: LOCAL_KNOWN_FACTS_KIND,
    mode: 'local-only',
    profile: normalizeProfileName(profileName),
    versionMarker: {
      toolVersion,
      updatedAt: null,
      expiresAt: null,
      ttlDays: normalizeTtlDays(options.ttlDays),
    },
    facts: [],
  };
}

function buildStorePayload(profileName, input = {}, options = {}) {
  const nowIso = normalizeTimestamp(options.now, new Date().toISOString());
  const ttlDays = normalizeTtlDays(
    (input.versionMarker && input.versionMarker.ttlDays) || options.ttlDays
  );
  const updatedAt = normalizeTimestamp(
    input.versionMarker && input.versionMarker.updatedAt,
    nowIso
  );
  const expiresAt = normalizeTimestamp(
    input.versionMarker && input.versionMarker.expiresAt,
    resolveExpiresAt(updatedAt, ttlDays)
  );
  const facts = Array.isArray(input.facts)
    ? input.facts.map(entry => sanitizeFact(entry, updatedAt))
    : [];

  return {
    schemaVersion: LOCAL_KNOWN_FACTS_SCHEMA_VERSION,
    kind: LOCAL_KNOWN_FACTS_KIND,
    mode: 'local-only',
    profile: normalizeProfileName(profileName),
    versionMarker: {
      toolVersion: normalizeString(
        input.versionMarker && input.versionMarker.toolVersion,
        toolVersion
      ),
      updatedAt,
      expiresAt,
      ttlDays,
    },
    facts,
  };
}

function readKnownFactsStore(profileName, options = {}) {
  const storePath = normalizeKnownFactsStorePath(profileName, options);
  if (!fs.existsSync(storePath)) {
    return {
      path: storePath,
      status: 'missing',
      expired: false,
      store: buildEmptyKnownFactsStore(profileName, options),
    };
  }

  const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid known facts payload: ${storePath}`);
  }
  if (!Array.isArray(parsed.facts)) {
    throw new Error(`Invalid known facts facts array: ${storePath}`);
  }

  const store = buildStorePayload(profileName, parsed, options);
  const nowIso = normalizeTimestamp(options.now, new Date().toISOString());
  const expired = Boolean(
    store.versionMarker.expiresAt && Date.parse(store.versionMarker.expiresAt) <= Date.parse(nowIso)
  );

  return {
    path: storePath,
    status: expired ? 'expired' : 'ready',
    expired,
    store,
  };
}

function writeKnownFactsStore(profileName, input = {}, options = {}) {
  const storePath = normalizeKnownFactsStorePath(profileName, options);
  const store = buildStorePayload(profileName, input, options);
  ensureStoreDirectory(storePath);
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  const nowIso = normalizeTimestamp(options.now, new Date().toISOString());

  const expired = Boolean(
    store.versionMarker.expiresAt && Date.parse(store.versionMarker.expiresAt) <= Date.parse(nowIso)
  );

  return {
    path: storePath,
    status: expired ? 'expired' : 'ready',
    expired,
    store,
  };
}

module.exports = {
  DEFAULT_TTL_DAYS,
  LOCAL_KNOWN_FACTS_KIND,
  LOCAL_KNOWN_FACTS_SCHEMA_VERSION,
  buildEmptyKnownFactsStore,
  normalizeKnownFactsStorePath,
  readKnownFactsStore,
  writeKnownFactsStore,
};
