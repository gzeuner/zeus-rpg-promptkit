/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
'use strict';

const crypto = require('node:crypto');
const { validateTechnicalEvidenceAcceptanceCheck } = require('./technicalEvidenceBundle');

const TECHNICAL_EVIDENCE_ACCEPTANCE_HISTORY_SCHEMA_VERSION = 1;
const TECHNICAL_EVIDENCE_ACCEPTANCE_HISTORY_CONTRACT_ID =
  'zeus.technical-evidence-acceptance-history';
const DEFAULT_ACCEPTANCE_HISTORY_ENTRIES = 10;
const MAX_ACCEPTANCE_HISTORY_ENTRIES = 32;

class TechnicalEvidenceAcceptanceHistoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TechnicalEvidenceAcceptanceHistoryError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new TechnicalEvidenceAcceptanceHistoryError(code, message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFingerprint(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, stableValue(value[key])])
  );
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function digest(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function normalizeMaxEntries(value) {
  const maxEntries =
    value === undefined || value === null ? DEFAULT_ACCEPTANCE_HISTORY_ENTRIES : Number(value);
  if (
    !Number.isInteger(maxEntries) ||
    maxEntries < 1 ||
    maxEntries > MAX_ACCEPTANCE_HISTORY_ENTRIES
  )
    fail(
      'TECHNICAL_EVIDENCE_ACCEPTANCE_HISTORY_LIMIT_INVALID',
      'acceptance history limit is invalid'
    );
  return maxEntries;
}

function normalizeRecordedAt(value) {
  const normalized = value === undefined || value === null ? new Date() : new Date(value);
  if (Number.isNaN(normalized.getTime()))
    fail(
      'TECHNICAL_EVIDENCE_ACCEPTANCE_HISTORY_TIMESTAMP_INVALID',
      'acceptance history timestamp is invalid'
    );
  return normalized.toISOString();
}

function entryFingerprint(entry) {
  return `entry:${digest({
    recordedAt: entry.recordedAt,
    acceptanceId: entry.acceptanceId,
    acceptanceFingerprint: entry.acceptanceFingerprint,
    bundleFingerprint: entry.bundleFingerprint,
    identity: entry.identity,
    status: entry.status,
    gatePassed: entry.gatePassed,
    blockers: entry.blockers,
  }).slice(0, 32)}`;
}

function historyFingerprint(history) {
  return `history:${digest({
    schemaVersion: history.schemaVersion,
    retention: history.retention,
    entries: history.entries,
    latest: history.latest,
    status: history.status,
  }).slice(0, 32)}`;
}

function buildEntry(acceptance, recordedAt) {
  const entry = {
    recordedAt,
    acceptanceId: acceptance.acceptanceId,
    acceptanceFingerprint: acceptance.acceptanceFingerprint,
    bundleFingerprint: acceptance.bundleFingerprint,
    identity: {
      contextFingerprint: acceptance.identity.contextFingerprint,
      promptFingerprint: acceptance.identity.promptFingerprint,
    },
    status: acceptance.status,
    gatePassed: acceptance.gatePassed,
    blockers: [...acceptance.blockers].sort(),
    entryId: null,
  };
  entry.entryId = entryFingerprint(entry);
  return entry;
}

function validateEntry(entry) {
  const errors = [];
  if (!isObject(entry)) return ['history entry must be an object'];
  if (!/^entry:[a-f0-9]{32}$/i.test(entry.entryId || '')) errors.push('entryId is invalid');
  if (typeof entry.recordedAt !== 'string' || Number.isNaN(new Date(entry.recordedAt).getTime()))
    errors.push('recordedAt is invalid');
  if (!/^acceptance:[a-f0-9]{32}$/i.test(entry.acceptanceId || ''))
    errors.push('acceptanceId is invalid');
  if (entry.acceptanceFingerprint !== entry.acceptanceId)
    errors.push('acceptance fingerprints must match');
  if (!/^bundle:[a-f0-9]{32}$/i.test(entry.bundleFingerprint || ''))
    errors.push('bundleFingerprint is invalid');
  if (!isObject(entry.identity)) errors.push('identity is required');
  else {
    if (!isFingerprint(entry.identity.contextFingerprint))
      errors.push('context fingerprint is invalid');
    if (!isFingerprint(entry.identity.promptFingerprint))
      errors.push('prompt fingerprint is invalid');
  }
  if (!['accepted', 'blocked'].includes(entry.status)) errors.push('status is invalid');
  if (entry.gatePassed !== (entry.status === 'accepted'))
    errors.push('gatePassed does not match status');
  if (!Array.isArray(entry.blockers) || entry.blockers.some(item => typeof item !== 'string'))
    errors.push('blockers are invalid');
  if (errors.length === 0 && entryFingerprint(entry) !== entry.entryId)
    errors.push('entry fingerprint does not match content');
  return errors;
}

function buildTechnicalEvidenceAcceptanceHistory({ current, previous, asOf, maxEntries } = {}) {
  if (validateTechnicalEvidenceAcceptanceCheck(current).length > 0)
    fail('TECHNICAL_EVIDENCE_ACCEPTANCE_HISTORY_CURRENT_INVALID', 'acceptance check is invalid');
  if (previous && validateTechnicalEvidenceAcceptanceHistory(previous).length > 0)
    fail('TECHNICAL_EVIDENCE_ACCEPTANCE_HISTORY_PREVIOUS_INVALID', 'acceptance history is invalid');

  const limit = normalizeMaxEntries(maxEntries);
  const recordedAt = normalizeRecordedAt(asOf);
  const entries = [...(previous?.entries || []), buildEntry(current, recordedAt)];
  const dropped = Math.max(0, entries.length - limit);
  const retainedEntries = entries.slice(-limit);
  const truncatedCount = (previous?.retention?.truncatedCount || 0) + dropped;
  const latestEntry = retainedEntries[retainedEntries.length - 1];
  const history = {
    schemaVersion: TECHNICAL_EVIDENCE_ACCEPTANCE_HISTORY_SCHEMA_VERSION,
    kind: 'zeus-technical-evidence-acceptance-history',
    contractId: TECHNICAL_EVIDENCE_ACCEPTANCE_HISTORY_CONTRACT_ID,
    contractVersion: TECHNICAL_EVIDENCE_ACCEPTANCE_HISTORY_SCHEMA_VERSION,
    readOnly: true,
    localOnly: true,
    status: 'recorded',
    retention: {
      maxEntries: limit,
      retainedEntries: retainedEntries.length,
      truncatedCount,
      truncation: 'oldest-first',
    },
    entries: retainedEntries,
    latest: {
      entryId: latestEntry.entryId,
      acceptanceId: latestEntry.acceptanceId,
      bundleFingerprint: latestEntry.bundleFingerprint,
      identity: latestEntry.identity,
      status: latestEntry.status,
      gatePassed: latestEntry.gatePassed,
      blockers: latestEntry.blockers,
      recordedAt: latestEntry.recordedAt,
    },
    externalPublicationAllowed: false,
    providerHandoffAllowed: false,
    automaticPromotion: false,
    promotionAllowed: false,
    historyId: null,
    historyFingerprint: null,
    nextSafeStep: latestEntry.gatePassed
      ? 'Keep this bounded local history with the exact acceptance artifacts; it is not external approval.'
      : 'Resolve the latest local blockers before relying on the acceptance history.',
  };
  history.historyFingerprint = historyFingerprint(history);
  history.historyId = history.historyFingerprint;
  return history;
}

function validateTechnicalEvidenceAcceptanceHistory(value) {
  const errors = [];
  if (!isObject(value)) return ['acceptance history must be an object'];
  if (value.schemaVersion !== TECHNICAL_EVIDENCE_ACCEPTANCE_HISTORY_SCHEMA_VERSION)
    errors.push('schemaVersion is unsupported');
  if (value.kind !== 'zeus-technical-evidence-acceptance-history') errors.push('kind is invalid');
  if (value.contractId !== TECHNICAL_EVIDENCE_ACCEPTANCE_HISTORY_CONTRACT_ID)
    errors.push('contractId is invalid');
  if (value.readOnly !== true || value.localOnly !== true)
    errors.push('acceptance history must be local-only and read-only');
  if (value.status !== 'recorded') errors.push('status is invalid');
  if (!isObject(value.retention)) errors.push('retention is required');
  else {
    if (
      !Number.isInteger(value.retention.maxEntries) ||
      value.retention.maxEntries < 1 ||
      value.retention.maxEntries > MAX_ACCEPTANCE_HISTORY_ENTRIES
    )
      errors.push('retention.maxEntries is invalid');
    if (
      !Number.isInteger(value.retention.retainedEntries) ||
      value.retention.retainedEntries < 1 ||
      value.retention.retainedEntries > value.retention.maxEntries
    )
      errors.push('retention.retainedEntries is invalid');
    if (!Number.isInteger(value.retention.truncatedCount) || value.retention.truncatedCount < 0)
      errors.push('retention.truncatedCount is invalid');
    if (value.retention.truncation !== 'oldest-first')
      errors.push('retention.truncation is invalid');
  }
  if (!Array.isArray(value.entries) || value.entries.length === 0)
    errors.push('entries are required');
  else {
    if (value.retention?.retainedEntries !== value.entries.length)
      errors.push('retention count does not match entries');
    for (const entry of value.entries) errors.push(...validateEntry(entry));
  }
  if (!isObject(value.latest)) errors.push('latest is required');
  else {
    const latestEntry = value.entries?.[value.entries.length - 1];
    if (latestEntry) {
      for (const field of [
        'entryId',
        'acceptanceId',
        'bundleFingerprint',
        'identity',
        'status',
        'gatePassed',
        'blockers',
        'recordedAt',
      ]) {
        if (stableStringify(value.latest[field]) !== stableStringify(latestEntry[field]))
          errors.push('latest entry does not match history');
      }
    }
  }
  for (const field of [
    'externalPublicationAllowed',
    'providerHandoffAllowed',
    'automaticPromotion',
    'promotionAllowed',
  ]) {
    if (value[field] !== false) errors.push(`${field} must be false`);
  }
  if (!/^history:[a-f0-9]{32}$/i.test(value.historyId || '')) errors.push('historyId is invalid');
  if (value.historyFingerprint !== value.historyId) errors.push('history fingerprints must match');
  if (errors.length === 0 && historyFingerprint(value) !== value.historyFingerprint)
    errors.push('history fingerprint does not match content');
  return errors;
}

module.exports = {
  DEFAULT_ACCEPTANCE_HISTORY_ENTRIES,
  MAX_ACCEPTANCE_HISTORY_ENTRIES,
  TECHNICAL_EVIDENCE_ACCEPTANCE_HISTORY_CONTRACT_ID,
  TECHNICAL_EVIDENCE_ACCEPTANCE_HISTORY_SCHEMA_VERSION,
  TechnicalEvidenceAcceptanceHistoryError,
  buildTechnicalEvidenceAcceptanceHistory,
  validateTechnicalEvidenceAcceptanceHistory,
};
