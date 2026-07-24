'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { DEFAULT_STALE_LOCK_MS } = require('./constants');
const { fail, REASON_CODES } = require('./errors');

function nowIso() {
  return new Date().toISOString();
}

function readLockFile(lockPath) {
  try {
    const raw = fs.readFileSync(lockPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we cannot signal it.
    return Boolean(err && err.code === 'EPERM');
  }
}

function isLockStale(lock, { staleMs = DEFAULT_STALE_LOCK_MS, now = Date.now() } = {}) {
  if (!lock || typeof lock !== 'object') return true;
  const acquiredAt = Date.parse(String(lock.acquiredAt || ''));
  if (!Number.isFinite(acquiredAt)) return true;
  if (now - acquiredAt > staleMs) return true;
  if (lock.pid != null && !isProcessAlive(Number(lock.pid))) return true;
  return false;
}

/**
 * Acquire an exclusive writer lock using O_EXCL create semantics (Windows-safe).
 * @returns {{ token: string, lockPath: string, release: function }}
 */
function acquireWriterLock(lockPath, options = {}) {
  const staleMs = options.staleMs == null ? DEFAULT_STALE_LOCK_MS : options.staleMs;
  const now = options.now == null ? Date.now() : options.now;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  const token = crypto.randomBytes(16).toString('hex');
  const payload = {
    token,
    pid: process.pid,
    hostname: os.hostname(),
    acquiredAt: new Date(now).toISOString(),
    owner: options.owner || 'zeus-project-intelligence',
  };

  try {
    const fd = fs.openSync(lockPath, 'wx');
    try {
      fs.writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    if (!err || err.code !== 'EEXIST') {
      fail(REASON_CODES.STORE_LOCKED, 'failed to create writer lock', {
        code: err && err.code,
      });
    }

    const existing = readLockFile(lockPath);
    if (!isLockStale(existing, { staleMs, now })) {
      fail(REASON_CODES.WRITER_CONFLICT, 'another writer holds the project knowledge lock', {
        pid: existing && existing.pid,
      });
    }

    // Stale lock: remove and retry once.
    try {
      fs.unlinkSync(lockPath);
    } catch {
      fail(REASON_CODES.STORE_LOCKED, 'stale writer lock could not be removed');
    }

    try {
      const fd = fs.openSync(lockPath, 'wx');
      try {
        fs.writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      fail(REASON_CODES.WRITER_CONFLICT, 'writer lock re-acquire failed after stale cleanup');
    }
  }

  function release() {
    const current = readLockFile(lockPath);
    if (!current) return false;
    if (current.token !== token) {
      fail(REASON_CODES.STORE_LOCKED, 'writer lock token mismatch on release');
    }
    fs.unlinkSync(lockPath);
    return true;
  }

  return {
    token,
    lockPath,
    acquiredAt: payload.acquiredAt,
    release,
  };
}

function inspectWriterLock(lockPath, options = {}) {
  if (!fs.existsSync(lockPath)) {
    return { held: false, stale: false, lock: null };
  }
  const lock = readLockFile(lockPath);
  const stale = isLockStale(lock, options);
  return { held: true, stale, lock };
}

module.exports = {
  acquireWriterLock,
  inspectWriterLock,
  isLockStale,
  isProcessAlive,
  readLockFile,
  nowIso,
};
