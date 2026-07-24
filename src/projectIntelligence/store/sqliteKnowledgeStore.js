'use strict';

const { STORE_SCHEMA_VERSION, STORE_STATES, META_KEYS } = require('./constants');
const { MIGRATIONS, assertCompatibleSchemaVersion } = require('./migrations');
const { openSqliteDatabase, DRIVER_ID } = require('./sqliteDriver');
const { fail, REASON_CODES, KnowledgeStoreError } = require('./errors');
const { SNAPSHOT_STATUSES } = require('../constants');
const { validateProjectIntelligenceContract, CONTRACT_IDS } = require('../validate');

function isoNow() {
  return new Date().toISOString();
}

function jsonString(value) {
  return JSON.stringify(value);
}

function jsonParse(value, fallback = null) {
  if (value == null || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    fail(REASON_CODES.STORE_CORRUPT, 'stored JSON payload is corrupt');
  }
}

function requireOpen(store) {
  if (store._state === STORE_STATES.CLOSED) {
    fail(REASON_CODES.STORE_UNAVAILABLE, 'knowledge store is closed');
  }
  if (store._state === STORE_STATES.SEALED && store._writeBlocked) {
    // reads still allowed when sealed
  }
}

function requireWritable(store) {
  requireOpen(store);
  if (store._readOnly || store._state === STORE_STATES.SEALED) {
    fail(REASON_CODES.SNAPSHOT_IMMUTABLE, 'knowledge store is not writable');
  }
}

function validateOrThrow(contractId, value) {
  const result = validateProjectIntelligenceContract(contractId, value);
  if (!result.ok) {
    fail(REASON_CODES.SCHEMA_INVALID, result.message, { errors: result.errors });
  }
  return result.value;
}

/**
 * Community SQLite KnowledgeStore (ZPI-03).
 * Metadata only — content blobs and Lucene indexes are later packages.
 */
function createSqliteKnowledgeStore({
  dbPath,
  projectId,
  readOnly = false,
  applyMigrations = true,
} = {}) {
  if (typeof projectId !== 'string' || !projectId.trim()) {
    fail(REASON_CODES.PROJECT_ID_INVALID, 'projectId is required');
  }

  const db = openSqliteDatabase(dbPath, { readOnly });
  const store = {
    _db: db,
    _projectId: projectId,
    _readOnly: Boolean(readOnly),
    _state: STORE_STATES.OPEN,
    _writeBlocked: Boolean(readOnly),
    _txDepth: 0,
  };

  function setMeta(key, value) {
    db.run(
      `INSERT INTO meta(key, value) VALUES (@key, @value)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      { key, value: String(value) }
    );
  }

  function getMeta(key) {
    const row = db.get('SELECT value FROM meta WHERE key = @key', { key });
    return row ? row.value : null;
  }

  function applyAllMigrations() {
    db.exec(MIGRATIONS[0].sql);
    // Ensure migrations table exists before reading.
    const applied = new Set(db.all('SELECT id FROM schema_migrations').map(r => Number(r.id)));
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.id)) continue;
      db.exec('BEGIN IMMEDIATE;');
      try {
        // Initial migration already executed above for table bootstrap;
        // re-running CREATE IF NOT EXISTS is safe for id 1.
        if (migration.id !== 1) {
          db.exec(migration.sql);
        }
        db.run(
          `INSERT INTO schema_migrations(id, name, applied_at)
           VALUES (@id, @name, @applied_at)`,
          { id: migration.id, name: migration.name, applied_at: isoNow() }
        );
        db.exec('COMMIT;');
      } catch (err) {
        db.rollback();
        fail(REASON_CODES.MIGRATION_FAILED, 'store migration failed', {
          migrationId: migration.id,
          message: err && err.message ? String(err.message) : undefined,
        });
      }
    }
    setMeta(META_KEYS.STORE_SCHEMA_VERSION, String(STORE_SCHEMA_VERSION));
    setMeta(META_KEYS.DRIVER, DRIVER_ID);
    if (!getMeta(META_KEYS.CREATED_AT)) {
      setMeta(META_KEYS.CREATED_AT, isoNow());
    }
    setMeta(META_KEYS.OPENED_AT, isoNow());
    setMeta(META_KEYS.PROJECT_ID, projectId);
  }

  function ensureBootstrapped() {
    if (readOnly) {
      // Minimal meta table check
      let version;
      try {
        version = getMeta(META_KEYS.STORE_SCHEMA_VERSION);
      } catch {
        fail(REASON_CODES.STORE_CORRUPT, 'store meta table missing or unreadable');
      }
      const compat = assertCompatibleSchemaVersion(version);
      if (!compat.ok) {
        if (compat.reason === 'future') {
          fail(REASON_CODES.MIGRATION_UNSUPPORTED, 'unknown future store schema version', {
            version,
          });
        }
        fail(REASON_CODES.MIGRATION_REQUIRED, 'store schema migration required', { version });
      }
      return;
    }

    if (applyMigrations) {
      applyAllMigrations();
    }

    const version = getMeta(META_KEYS.STORE_SCHEMA_VERSION);
    const compat = assertCompatibleSchemaVersion(version);
    if (!compat.ok) {
      if (compat.reason === 'future') {
        fail(REASON_CODES.MIGRATION_UNSUPPORTED, 'unknown future store schema version', {
          version,
        });
      }
      fail(REASON_CODES.MIGRATION_REQUIRED, 'store schema migration required', { version });
    }
  }

  // Bootstrap immediately.
  try {
    if (!readOnly) {
      // Create schema shell so getMeta works even on empty file.
      db.exec(`
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id INTEGER PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
      `);
    }
    ensureBootstrapped();
  } catch (err) {
    try {
      db.close();
    } catch {
      // ignore
    }
    if (err instanceof KnowledgeStoreError) throw err;
    fail(REASON_CODES.STORE_UNAVAILABLE, 'failed to bootstrap knowledge store', {
      message: err && err.message ? String(err.message) : undefined,
    });
  }

  function withTransaction(fn) {
    requireWritable(store);
    if (typeof fn !== 'function') {
      fail(REASON_CODES.OPERATION_UNAVAILABLE, 'transaction callback is required');
    }
    if (store._txDepth === 0) {
      db.begin();
    }
    store._txDepth += 1;
    try {
      const result = fn();
      store._txDepth -= 1;
      if (store._txDepth === 0) {
        db.commit();
      }
      return result;
    } catch (err) {
      store._txDepth = 0;
      db.rollback();
      if (err instanceof KnowledgeStoreError) throw err;
      fail(REASON_CODES.TRANSACTION_FAILED, 'knowledge store transaction failed', {
        message: err && err.message ? String(err.message) : undefined,
      });
    }
  }

  function putProject(project) {
    requireWritable(store);
    const value = validateOrThrow(CONTRACT_IDS.PROJECT, project);
    if (value.projectId !== store._projectId) {
      fail(REASON_CODES.PROJECT_ID_INVALID, 'projectId does not match store project');
    }
    const now = isoNow();
    db.run(
      `INSERT INTO projects(
         project_id, display_name, trusted_roots_json, schema_bindings_json,
         safety_json, payload_json, created_at, updated_at
       ) VALUES (
         @project_id, @display_name, @trusted_roots_json, @schema_bindings_json,
         @safety_json, @payload_json, @created_at, @updated_at
       )
       ON CONFLICT(project_id) DO UPDATE SET
         display_name = excluded.display_name,
         trusted_roots_json = excluded.trusted_roots_json,
         schema_bindings_json = excluded.schema_bindings_json,
         safety_json = excluded.safety_json,
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`,
      {
        project_id: value.projectId,
        display_name: value.displayName || null,
        trusted_roots_json: jsonString(value.trustedRoots || []),
        schema_bindings_json: value.schemaBindings ? jsonString(value.schemaBindings) : null,
        safety_json: value.safety ? jsonString(value.safety) : null,
        payload_json: jsonString(value),
        created_at: now,
        updated_at: now,
      }
    );
    return value;
  }

  function getProject(projectId = store._projectId) {
    requireOpen(store);
    const row = db.get('SELECT payload_json FROM projects WHERE project_id = @project_id', {
      project_id: projectId,
    });
    if (!row) {
      fail(REASON_CODES.PROJECT_NOT_FOUND, 'project was not found');
    }
    return jsonParse(row.payload_json);
  }

  function putSnapshot(snapshot) {
    requireWritable(store);
    const value = validateOrThrow(CONTRACT_IDS.SNAPSHOT, snapshot);
    if (value.projectId !== store._projectId) {
      fail(REASON_CODES.PROJECT_ID_INVALID, 'snapshot projectId does not match store project');
    }

    // Published snapshots are immutable once stored as published.
    const existing = db.get(
      `SELECT status, payload_json FROM snapshots
       WHERE project_id = @project_id AND snapshot_id = @snapshot_id`,
      { project_id: value.projectId, snapshot_id: value.snapshotId }
    );
    if (existing && existing.status === SNAPSHOT_STATUSES.PUBLISHED) {
      fail(REASON_CODES.SNAPSHOT_IMMUTABLE, 'published snapshots cannot be modified');
    }

    const now = isoNow();
    db.run(
      `INSERT INTO snapshots(
         project_id, snapshot_id, status, source_inventory_hash,
         store_schema_version, search_schema_version, artifact_schema_version,
         is_current, content_addressing_json, analyzer_run_ids_json,
         published_at, payload_json, created_at, updated_at
       ) VALUES (
         @project_id, @snapshot_id, @status, @source_inventory_hash,
         @store_schema_version, @search_schema_version, @artifact_schema_version,
         @is_current, @content_addressing_json, @analyzer_run_ids_json,
         @published_at, @payload_json, @created_at, @updated_at
       )
       ON CONFLICT(project_id, snapshot_id) DO UPDATE SET
         status = excluded.status,
         source_inventory_hash = excluded.source_inventory_hash,
         store_schema_version = excluded.store_schema_version,
         search_schema_version = excluded.search_schema_version,
         artifact_schema_version = excluded.artifact_schema_version,
         is_current = excluded.is_current,
         content_addressing_json = excluded.content_addressing_json,
         analyzer_run_ids_json = excluded.analyzer_run_ids_json,
         published_at = excluded.published_at,
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`,
      {
        project_id: value.projectId,
        snapshot_id: value.snapshotId,
        status: value.status,
        source_inventory_hash: value.sourceInventoryHash,
        store_schema_version: value.storeSchemaVersion,
        search_schema_version: value.searchSchemaVersion,
        artifact_schema_version: value.artifactSchemaVersion,
        is_current: value.isCurrent ? 1 : 0,
        content_addressing_json: value.contentAddressing
          ? jsonString(value.contentAddressing)
          : null,
        analyzer_run_ids_json: value.analyzerRunIds ? jsonString(value.analyzerRunIds) : null,
        published_at: value.publishedAt || null,
        payload_json: jsonString(value),
        created_at: now,
        updated_at: now,
      }
    );
    return value;
  }

  function getSnapshot(projectId, snapshotId) {
    requireOpen(store);
    const row = db.get(
      `SELECT payload_json FROM snapshots
       WHERE project_id = @project_id AND snapshot_id = @snapshot_id`,
      { project_id: projectId, snapshot_id: snapshotId }
    );
    if (!row) {
      fail(REASON_CODES.SNAPSHOT_NOT_FOUND, 'snapshot was not found');
    }
    return jsonParse(row.payload_json);
  }

  function listSnapshots(projectId = store._projectId) {
    requireOpen(store);
    return db
      .all(
        `SELECT payload_json FROM snapshots
         WHERE project_id = @project_id
         ORDER BY snapshot_id ASC`,
        { project_id: projectId }
      )
      .map(r => jsonParse(r.payload_json));
  }

  /**
   * Atomically publish a snapshot and advance the current pointer.
   * Only published snapshots may become current.
   */
  function publishSnapshot(projectId, snapshotId, { publishedAt } = {}) {
    requireWritable(store);
    return withTransaction(() => {
      const snap = getSnapshot(projectId, snapshotId);
      if (snap.status === SNAPSHOT_STATUSES.FAILED) {
        fail(REASON_CODES.PUBLISH_INCOMPLETE, 'failed snapshots cannot be published');
      }

      const when = publishedAt || isoNow();
      const next = {
        ...snap,
        status: SNAPSHOT_STATUSES.PUBLISHED,
        isCurrent: true,
        publishedAt: when,
      };
      validateOrThrow(CONTRACT_IDS.SNAPSHOT, next);

      // Supersede any previously published / current snapshots (payload rewrite in JS).
      const others = db.all(
        `SELECT snapshot_id, payload_json, status FROM snapshots
         WHERE project_id = @project_id AND snapshot_id != @snapshot_id`,
        { project_id: projectId, snapshot_id: snapshotId }
      );
      for (const row of others) {
        const payload = jsonParse(row.payload_json);
        if (!payload.isCurrent && payload.status !== SNAPSHOT_STATUSES.PUBLISHED) {
          continue;
        }
        payload.isCurrent = false;
        if (payload.status === SNAPSHOT_STATUSES.PUBLISHED) {
          payload.status = SNAPSHOT_STATUSES.SUPERSEDED;
        }
        db.run(
          `UPDATE snapshots
           SET status = @status, is_current = 0, payload_json = @payload_json, updated_at = @updated_at
           WHERE project_id = @project_id AND snapshot_id = @snapshot_id`,
          {
            project_id: projectId,
            snapshot_id: row.snapshot_id,
            status: payload.status,
            payload_json: jsonString(payload),
            updated_at: when,
          }
        );
      }

      // Bypass putSnapshot immutability: direct update of the snapshot being published.
      db.run(
        `UPDATE snapshots
         SET status = @status,
             is_current = 1,
             published_at = @published_at,
             payload_json = @payload_json,
             updated_at = @updated_at
         WHERE project_id = @project_id AND snapshot_id = @snapshot_id`,
        {
          project_id: projectId,
          snapshot_id: snapshotId,
          status: SNAPSHOT_STATUSES.PUBLISHED,
          published_at: when,
          payload_json: jsonString(next),
          updated_at: when,
        }
      );

      db.run(
        `INSERT INTO current_pointer(project_id, snapshot_id, updated_at)
         VALUES (@project_id, @snapshot_id, @updated_at)
         ON CONFLICT(project_id) DO UPDATE SET
           snapshot_id = excluded.snapshot_id,
           updated_at = excluded.updated_at`,
        { project_id: projectId, snapshot_id: snapshotId, updated_at: when }
      );

      return next;
    });
  }

  function getCurrentSnapshot(projectId = store._projectId) {
    requireOpen(store);
    const pointer = db.get(
      `SELECT snapshot_id FROM current_pointer WHERE project_id = @project_id`,
      { project_id: projectId }
    );
    if (!pointer) {
      fail(REASON_CODES.SNAPSHOT_NOT_CURRENT, 'no current snapshot pointer');
    }
    const snap = getSnapshot(projectId, pointer.snapshot_id);
    if (snap.status !== SNAPSHOT_STATUSES.PUBLISHED) {
      fail(
        REASON_CODES.CURRENT_POINTER_MISMATCH,
        'current pointer does not reference a published snapshot'
      );
    }
    return snap;
  }

  function putSourceUnit(unit) {
    requireWritable(store);
    const value = validateOrThrow(CONTRACT_IDS.SOURCE_UNIT, unit);
    if (value.projectId !== store._projectId) {
      fail(REASON_CODES.PROJECT_ID_INVALID);
    }
    db.run(
      `INSERT INTO source_units(
         project_id, snapshot_id, source_unit_id, relative_path, content_hash,
         trusted_root_id, language, media_type, size_bytes, hash_algorithm, payload_json
       ) VALUES (
         @project_id, @snapshot_id, @source_unit_id, @relative_path, @content_hash,
         @trusted_root_id, @language, @media_type, @size_bytes, @hash_algorithm, @payload_json
       )
       ON CONFLICT(project_id, snapshot_id, source_unit_id) DO UPDATE SET
         relative_path = excluded.relative_path,
         content_hash = excluded.content_hash,
         trusted_root_id = excluded.trusted_root_id,
         language = excluded.language,
         media_type = excluded.media_type,
         size_bytes = excluded.size_bytes,
         hash_algorithm = excluded.hash_algorithm,
         payload_json = excluded.payload_json`,
      {
        project_id: value.projectId,
        snapshot_id: value.snapshotId,
        source_unit_id: value.sourceUnitId,
        relative_path: value.relativePath,
        content_hash: value.contentHash,
        trusted_root_id: value.trustedRootId,
        language: value.language || null,
        media_type: value.mediaType || null,
        size_bytes: value.sizeBytes == null ? null : value.sizeBytes,
        hash_algorithm: value.hashAlgorithm || null,
        payload_json: jsonString(value),
      }
    );
    return value;
  }

  function listSourceUnits(projectId, snapshotId) {
    requireOpen(store);
    return db
      .all(
        `SELECT payload_json FROM source_units
         WHERE project_id = @project_id AND snapshot_id = @snapshot_id
         ORDER BY source_unit_id ASC`,
        { project_id: projectId, snapshot_id: snapshotId }
      )
      .map(r => jsonParse(r.payload_json));
  }

  function putSymbol(symbol) {
    requireWritable(store);
    const value = validateOrThrow(CONTRACT_IDS.SYMBOL, symbol);
    if (value.projectId !== store._projectId) {
      fail(REASON_CODES.PROJECT_ID_INVALID);
    }
    db.run(
      `INSERT INTO symbols(
         project_id, snapshot_id, symbol_id, name, symbol_kind, derivation_class, payload_json
       ) VALUES (
         @project_id, @snapshot_id, @symbol_id, @name, @symbol_kind, @derivation_class, @payload_json
       )
       ON CONFLICT(project_id, snapshot_id, symbol_id) DO UPDATE SET
         name = excluded.name,
         symbol_kind = excluded.symbol_kind,
         derivation_class = excluded.derivation_class,
         payload_json = excluded.payload_json`,
      {
        project_id: value.projectId,
        snapshot_id: value.snapshotId,
        symbol_id: value.symbolId,
        name: value.name,
        symbol_kind: value.symbolKind,
        derivation_class: value.provenance.derivationClass,
        payload_json: jsonString(value),
      }
    );
    return value;
  }

  function listSymbols(projectId, snapshotId) {
    requireOpen(store);
    return db
      .all(
        `SELECT payload_json FROM symbols
         WHERE project_id = @project_id AND snapshot_id = @snapshot_id
         ORDER BY symbol_id ASC`,
        { project_id: projectId, snapshot_id: snapshotId }
      )
      .map(r => jsonParse(r.payload_json));
  }

  function putRelationship(relationship) {
    requireWritable(store);
    const value = validateOrThrow(CONTRACT_IDS.RELATIONSHIP, relationship);
    if (value.projectId !== store._projectId) {
      fail(REASON_CODES.PROJECT_ID_INVALID);
    }
    db.run(
      `INSERT INTO relationships(
         project_id, snapshot_id, relationship_id, relationship_type,
         from_symbol_id, to_symbol_id, derivation_class, payload_json
       ) VALUES (
         @project_id, @snapshot_id, @relationship_id, @relationship_type,
         @from_symbol_id, @to_symbol_id, @derivation_class, @payload_json
       )
       ON CONFLICT(project_id, snapshot_id, relationship_id) DO UPDATE SET
         relationship_type = excluded.relationship_type,
         from_symbol_id = excluded.from_symbol_id,
         to_symbol_id = excluded.to_symbol_id,
         derivation_class = excluded.derivation_class,
         payload_json = excluded.payload_json`,
      {
        project_id: value.projectId,
        snapshot_id: value.snapshotId,
        relationship_id: value.relationshipId,
        relationship_type: value.relationshipType,
        from_symbol_id: value.fromSymbolId,
        to_symbol_id: value.toSymbolId,
        derivation_class: value.provenance.derivationClass,
        payload_json: jsonString(value),
      }
    );
    return value;
  }

  function listRelationships(projectId, snapshotId) {
    requireOpen(store);
    return db
      .all(
        `SELECT payload_json FROM relationships
         WHERE project_id = @project_id AND snapshot_id = @snapshot_id
         ORDER BY relationship_id ASC`,
        { project_id: projectId, snapshot_id: snapshotId }
      )
      .map(r => jsonParse(r.payload_json));
  }

  function putAnalyzerRun(run) {
    requireWritable(store);
    const value = validateOrThrow(CONTRACT_IDS.ANALYZER_RUN, run);
    if (value.projectId !== store._projectId) {
      fail(REASON_CODES.PROJECT_ID_INVALID);
    }
    db.run(
      `INSERT INTO analyzer_runs(
         project_id, snapshot_id, analyzer_run_id, analyzer_id, analyzer_version,
         input_inventory_hash, status, payload_json
       ) VALUES (
         @project_id, @snapshot_id, @analyzer_run_id, @analyzer_id, @analyzer_version,
         @input_inventory_hash, @status, @payload_json
       )
       ON CONFLICT(project_id, snapshot_id, analyzer_run_id) DO UPDATE SET
         analyzer_id = excluded.analyzer_id,
         analyzer_version = excluded.analyzer_version,
         input_inventory_hash = excluded.input_inventory_hash,
         status = excluded.status,
         payload_json = excluded.payload_json`,
      {
        project_id: value.projectId,
        snapshot_id: value.snapshotId,
        analyzer_run_id: value.analyzerRunId,
        analyzer_id: value.analyzerId,
        analyzer_version: value.analyzerVersion,
        input_inventory_hash: value.inputInventoryHash,
        status: value.status,
        payload_json: jsonString(value),
      }
    );
    return value;
  }

  function putEvidenceMeta(evidence) {
    requireWritable(store);
    const value = validateOrThrow(CONTRACT_IDS.EVIDENCE, evidence);
    if (value.projectId !== store._projectId) {
      fail(REASON_CODES.PROJECT_ID_INVALID);
    }
    db.run(
      `INSERT INTO evidence_meta(
         project_id, snapshot_id, evidence_id, source_unit_id, content_hash,
         evidence_class, trusted_root_id, payload_json
       ) VALUES (
         @project_id, @snapshot_id, @evidence_id, @source_unit_id, @content_hash,
         @evidence_class, @trusted_root_id, @payload_json
       )
       ON CONFLICT(project_id, snapshot_id, evidence_id) DO UPDATE SET
         source_unit_id = excluded.source_unit_id,
         content_hash = excluded.content_hash,
         evidence_class = excluded.evidence_class,
         trusted_root_id = excluded.trusted_root_id,
         payload_json = excluded.payload_json`,
      {
        project_id: value.projectId,
        snapshot_id: value.snapshotId,
        evidence_id: value.evidenceId,
        source_unit_id: value.sourceUnitId,
        content_hash: value.contentHash,
        evidence_class: value.evidenceClass,
        trusted_root_id: value.trustedRootId,
        payload_json: jsonString(value),
      }
    );
    return value;
  }

  function checkIntegrity() {
    requireOpen(store);
    const pragma = db.integrityCheck();
    if (!pragma.ok) {
      return {
        ok: false,
        reasonCode: REASON_CODES.STORE_CORRUPT,
        messages: pragma.messages,
      };
    }

    const version = getMeta(META_KEYS.STORE_SCHEMA_VERSION);
    const compat = assertCompatibleSchemaVersion(version);
    if (!compat.ok) {
      return {
        ok: false,
        reasonCode:
          compat.reason === 'future'
            ? REASON_CODES.MIGRATION_UNSUPPORTED
            : REASON_CODES.MIGRATION_REQUIRED,
        messages: [`storeSchemaVersion=${version}`],
      };
    }

    const requiredTables = [
      'meta',
      'schema_migrations',
      'projects',
      'snapshots',
      'current_pointer',
      'source_units',
      'analyzer_runs',
      'symbols',
      'relationships',
      'evidence_meta',
    ];
    for (const table of requiredTables) {
      const row = db.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = @name`, {
        name: table,
      });
      if (!row) {
        return {
          ok: false,
          reasonCode: REASON_CODES.STORE_CORRUPT,
          messages: [`missing table ${table}`],
        };
      }
    }

    // Current pointer consistency (if present).
    const pointers = db.all('SELECT project_id, snapshot_id FROM current_pointer');
    for (const p of pointers) {
      const snap = db.get(
        `SELECT status FROM snapshots
         WHERE project_id = @project_id AND snapshot_id = @snapshot_id`,
        { project_id: p.project_id, snapshot_id: p.snapshot_id }
      );
      if (!snap || snap.status !== SNAPSHOT_STATUSES.PUBLISHED) {
        return {
          ok: false,
          reasonCode: REASON_CODES.CURRENT_POINTER_MISMATCH,
          messages: [`pointer ${p.project_id} -> ${p.snapshot_id}`],
        };
      }
    }

    return { ok: true, reasonCode: null, messages: ['ok'] };
  }

  function seal() {
    requireWritable(store);
    setMeta(META_KEYS.SEALED_AT, isoNow());
    store._state = STORE_STATES.SEALED;
    store._writeBlocked = true;
    return getStatus();
  }

  function close() {
    if (store._state === STORE_STATES.CLOSED) return;
    try {
      db.close();
    } finally {
      store._state = STORE_STATES.CLOSED;
    }
  }

  function getStatus() {
    return {
      state: store._state,
      projectId: store._projectId,
      readOnly: store._readOnly || store._state === STORE_STATES.SEALED,
      driver: DRIVER_ID,
      storeSchemaVersion: Number(getMeta(META_KEYS.STORE_SCHEMA_VERSION) || 0),
      dbPath: db.path,
    };
  }

  return {
    // lifecycle
    getStatus,
    close,
    seal,
    checkIntegrity,
    withTransaction,

    // entities
    putProject,
    getProject,
    putSnapshot,
    getSnapshot,
    listSnapshots,
    publishSnapshot,
    getCurrentSnapshot,
    putSourceUnit,
    listSourceUnits,
    putSymbol,
    listSymbols,
    putRelationship,
    listRelationships,
    putAnalyzerRun,
    putEvidenceMeta,

    // internals for tests
    _getMeta: getMeta,
    _db: db,
  };
}

module.exports = {
  createSqliteKnowledgeStore,
};
