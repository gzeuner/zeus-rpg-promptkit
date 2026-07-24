'use strict';

const fs = require('fs');
const path = require('path');
const { fail, REASON_CODES } = require('./errors');

const DRIVER_ID = 'node:sqlite';

/**
 * @returns {{ available: boolean, DatabaseSync?: Function, reason?: string }}
 */
function probeNodeSqlite() {
  try {
    const mod = require('node:sqlite');
    if (!mod || typeof mod.DatabaseSync !== 'function') {
      return { available: false, reason: 'DatabaseSync missing' };
    }
    return { available: true, DatabaseSync: mod.DatabaseSync };
  } catch (err) {
    return {
      available: false,
      reason: err && err.message ? String(err.message) : 'node:sqlite unavailable',
    };
  }
}

/**
 * Thin sync SQLite driver over Node's experimental DatabaseSync.
 * Fail-closed when the binding is unavailable.
 */
function openSqliteDatabase(dbPath, { readOnly = false } = {}) {
  const probe = probeNodeSqlite();
  if (!probe.available) {
    fail(
      REASON_CODES.STORE_UNAVAILABLE,
      'SQLite driver unavailable (requires Node.js node:sqlite / DatabaseSync)',
      { driver: DRIVER_ID, reason: probe.reason }
    );
  }

  const resolved = path.resolve(dbPath);
  if (!readOnly) {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
  } else if (!fs.existsSync(resolved)) {
    fail(REASON_CODES.STORE_UNAVAILABLE, 'SQLite database file does not exist');
  }

  let db;
  try {
    db = new probe.DatabaseSync(resolved, { readOnly });
  } catch (err) {
    fail(REASON_CODES.STORE_CORRUPT, 'failed to open SQLite database', {
      code: err && err.code,
      message: err && err.message ? String(err.message) : undefined,
    });
  }

  if (!readOnly) {
    try {
      db.exec('PRAGMA foreign_keys = ON;');
      db.exec('PRAGMA journal_mode = WAL;');
      db.exec('PRAGMA synchronous = NORMAL;');
      db.exec('PRAGMA busy_timeout = 3000;');
    } catch {
      // WAL may fail on some FS; continue with defaults.
      try {
        db.exec('PRAGMA foreign_keys = ON;');
      } catch (err) {
        fail(REASON_CODES.STORE_UNAVAILABLE, 'failed to configure SQLite pragmas', {
          message: err && err.message ? String(err.message) : undefined,
        });
      }
    }
  } else {
    try {
      db.exec('PRAGMA foreign_keys = ON;');
    } catch {
      // ignore
    }
  }

  function exec(sql) {
    db.exec(sql);
  }

  function run(sql, params = {}) {
    const stmt = db.prepare(sql);
    return stmt.run(params);
  }

  function get(sql, params = {}) {
    const stmt = db.prepare(sql);
    return stmt.get(params) || null;
  }

  function all(sql, params = {}) {
    const stmt = db.prepare(sql);
    return stmt.all(params);
  }

  function begin() {
    exec('BEGIN IMMEDIATE;');
  }

  function commit() {
    exec('COMMIT;');
  }

  function rollback() {
    try {
      exec('ROLLBACK;');
    } catch {
      // no active transaction
    }
  }

  function integrityCheck() {
    const rows = all('PRAGMA integrity_check;');
    const messages = rows.map(r => {
      const keys = Object.keys(r);
      return String(r[keys[0]]);
    });
    const ok = messages.length === 1 && messages[0] === 'ok';
    return { ok, messages };
  }

  function close() {
    try {
      db.close();
    } catch {
      // already closed
    }
  }

  return {
    driverId: DRIVER_ID,
    path: resolved,
    readOnly,
    exec,
    run,
    get,
    all,
    begin,
    commit,
    rollback,
    integrityCheck,
    close,
    _db: db,
  };
}

module.exports = {
  DRIVER_ID,
  probeNodeSqlite,
  openSqliteDatabase,
};
