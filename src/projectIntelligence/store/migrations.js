'use strict';

const { STORE_SCHEMA_VERSION } = require('./constants');

/**
 * Ordered, deterministic SQLite migrations for Community project knowledge.
 * Each migration is pure SQL. Applied once; unknown future versions fail closed.
 */
const MIGRATIONS = Object.freeze([
  {
    id: 1,
    name: 'initial-store-v1',
    sql: `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT,
  trusted_roots_json TEXT NOT NULL,
  schema_bindings_json TEXT,
  safety_json TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS snapshots (
  project_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  status TEXT NOT NULL,
  source_inventory_hash TEXT NOT NULL,
  store_schema_version INTEGER NOT NULL,
  search_schema_version INTEGER NOT NULL,
  artifact_schema_version INTEGER NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0,
  content_addressing_json TEXT,
  analyzer_run_ids_json TEXT,
  published_at TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT,
  PRIMARY KEY (project_id, snapshot_id)
);

CREATE TABLE IF NOT EXISTS current_pointer (
  project_id TEXT PRIMARY KEY NOT NULL,
  snapshot_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id, snapshot_id) REFERENCES snapshots(project_id, snapshot_id)
);

CREATE TABLE IF NOT EXISTS source_units (
  project_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  source_unit_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  trusted_root_id TEXT NOT NULL,
  language TEXT,
  media_type TEXT,
  size_bytes INTEGER,
  hash_algorithm TEXT,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (project_id, snapshot_id, source_unit_id)
);

CREATE TABLE IF NOT EXISTS analyzer_runs (
  project_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  analyzer_run_id TEXT NOT NULL,
  analyzer_id TEXT NOT NULL,
  analyzer_version TEXT NOT NULL,
  input_inventory_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (project_id, snapshot_id, analyzer_run_id)
);

CREATE TABLE IF NOT EXISTS symbols (
  project_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  symbol_id TEXT NOT NULL,
  name TEXT NOT NULL,
  symbol_kind TEXT NOT NULL,
  derivation_class TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (project_id, snapshot_id, symbol_id)
);

CREATE TABLE IF NOT EXISTS relationships (
  project_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  relationship_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  from_symbol_id TEXT NOT NULL,
  to_symbol_id TEXT NOT NULL,
  derivation_class TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (project_id, snapshot_id, relationship_id)
);

CREATE TABLE IF NOT EXISTS evidence_meta (
  project_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  source_unit_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  evidence_class TEXT NOT NULL,
  trusted_root_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (project_id, snapshot_id, evidence_id)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_project_status
  ON snapshots(project_id, status);
CREATE INDEX IF NOT EXISTS idx_source_units_hash
  ON source_units(project_id, snapshot_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_symbols_name
  ON symbols(project_id, snapshot_id, name);
CREATE INDEX IF NOT EXISTS idx_relationships_from
  ON relationships(project_id, snapshot_id, from_symbol_id);
CREATE INDEX IF NOT EXISTS idx_relationships_to
  ON relationships(project_id, snapshot_id, to_symbol_id);
`,
  },
]);

function listMigrationIds() {
  return MIGRATIONS.map(m => m.id);
}

function maxMigrationId() {
  return MIGRATIONS.reduce((max, m) => Math.max(max, m.id), 0);
}

function assertCompatibleSchemaVersion(version) {
  const v = Number(version);
  if (!Number.isInteger(v) || v < 1) {
    return { ok: false, reason: 'invalid' };
  }
  if (v > STORE_SCHEMA_VERSION) {
    return { ok: false, reason: 'future' };
  }
  if (v < STORE_SCHEMA_VERSION) {
    return { ok: false, reason: 'migration-required' };
  }
  return { ok: true };
}

module.exports = {
  MIGRATIONS,
  listMigrationIds,
  maxMigrationId,
  assertCompatibleSchemaVersion,
  STORE_SCHEMA_VERSION,
};
