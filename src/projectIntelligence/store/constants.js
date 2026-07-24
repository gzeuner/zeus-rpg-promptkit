'use strict';

/** Community SQLite metadata schema version (independent of search/content). */
const STORE_SCHEMA_VERSION = 1;

/** Relative layout under a project-knowledge root (ADR layout). */
const LAYOUT = Object.freeze({
  MANIFEST: 'manifest.json',
  SQLITE: 'knowledge.sqlite',
  LOCKS_DIR: 'locks',
  WRITER_LOCK: 'locks/writer.lock',
  CONTENT_DIR: 'content',
  LUCENE_DIR: 'lucene',
  SNAPSHOTS_DIR: 'snapshots',
  REPORTS_DIR: 'reports',
  QUARANTINE_DIR: 'quarantine',
});

const STORE_MODES = Object.freeze({
  CREATE: 'create',
  OPEN: 'open',
  READ_ONLY: 'readOnly',
});

const STORE_STATES = Object.freeze({
  CLOSED: 'closed',
  OPEN: 'open',
  SEALED: 'sealed',
});

/** Default stale writer-lock age (30 minutes). */
const DEFAULT_STALE_LOCK_MS = 30 * 60 * 1000;

const META_KEYS = Object.freeze({
  STORE_SCHEMA_VERSION: 'storeSchemaVersion',
  CREATED_AT: 'createdAt',
  OPENED_AT: 'openedAt',
  SEALED_AT: 'sealedAt',
  PROJECT_ID: 'projectId',
  DRIVER: 'driver',
  INTEGRITY_EPOCH: 'integrityEpoch',
});

module.exports = {
  STORE_SCHEMA_VERSION,
  LAYOUT,
  STORE_MODES,
  STORE_STATES,
  DEFAULT_STALE_LOCK_MS,
  META_KEYS,
};
