'use strict';

const fs = require('fs');
const path = require('path');
const { fail, REASON_CODES } = require('../store/errors');
const { canonicalizeRelativePath } = require('./normalize');

function realpathSafe(target) {
  try {
    return fs.realpathSync.native
      ? fs.realpathSync.native(path.resolve(target))
      : fs.realpathSync(path.resolve(target));
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
      // Fall back to resolved path when the leaf does not exist yet.
      const resolved = path.resolve(target);
      const parent = path.dirname(resolved);
      try {
        const realParent = fs.realpathSync.native
          ? fs.realpathSync.native(parent)
          : fs.realpathSync(parent);
        return path.join(realParent, path.basename(resolved));
      } catch {
        return resolved;
      }
    }
    fail(REASON_CODES.PATH_UNSAFE, 'failed to resolve path', {
      code: err && err.code,
    });
  }
}

function isInsideRoot(rootReal, candidateReal) {
  const relative = path.relative(rootReal, candidateReal);
  if (!relative) return true; // exact root
  if (path.isAbsolute(relative)) return false;
  if (relative === '..' || relative.startsWith(`..${path.sep}`)) return false;
  return true;
}

/**
 * Create a trusted-root registry for content ingestion path checks.
 * @param {Array<{ rootId: string, path: string }>} roots
 */
function createTrustedRootRegistry(roots = []) {
  if (!Array.isArray(roots)) {
    fail(REASON_CODES.UNTRUSTED_ROOT, 'trustedRoots must be an array');
  }

  const byId = new Map();
  for (const entry of roots) {
    if (!entry || typeof entry.rootId !== 'string' || !entry.rootId.trim()) {
      fail(REASON_CODES.UNTRUSTED_ROOT, 'trusted rootId is required');
    }
    if (typeof entry.path !== 'string' || !entry.path.trim()) {
      fail(REASON_CODES.UNTRUSTED_ROOT, 'trusted root path is required');
    }
    if (byId.has(entry.rootId)) {
      fail(REASON_CODES.UNTRUSTED_ROOT, 'duplicate trusted rootId');
    }
    const abs = path.resolve(entry.path);
    if (!fs.existsSync(abs)) {
      fail(REASON_CODES.UNTRUSTED_ROOT, 'trusted root path does not exist');
    }
    let stat;
    try {
      stat = fs.lstatSync(abs);
    } catch {
      fail(REASON_CODES.UNTRUSTED_ROOT, 'trusted root path is not accessible');
    }
    if (stat.isSymbolicLink()) {
      // Allow root itself to be a symlink only if realpath stays a directory;
      // still record the real path as the trust boundary.
    }
    const real = realpathSafe(abs);
    const realStat = fs.statSync(real);
    if (!realStat.isDirectory()) {
      fail(REASON_CODES.UNTRUSTED_ROOT, 'trusted root must be a directory');
    }
    byId.set(entry.rootId, {
      rootId: entry.rootId,
      configuredPath: abs,
      realPath: real,
    });
  }

  function get(rootId) {
    const root = byId.get(rootId);
    if (!root) {
      fail(REASON_CODES.UNTRUSTED_ROOT, 'unknown trusted rootId');
    }
    return root;
  }

  /**
   * Resolve a path that must remain inside a trusted root after realpath.
   * Rejects traversal, absolute escape, and symlink escape.
   *
   * @param {string} rootId
   * @param {string} relativePath relative to the trusted root
   * @returns {{ rootId, relativePath, absolutePath, realPath }}
   */
  function resolveUnderRoot(rootId, relativePath) {
    const root = get(rootId);
    const rel = canonicalizeRelativePath(relativePath);
    const candidate = path.resolve(root.realPath, ...rel.split('/'));

    // Structural containment before realpath
    if (!isInsideRoot(root.realPath, candidate)) {
      fail(REASON_CODES.PATH_ESCAPE, 'path escapes trusted root');
    }

    // If path exists, realpath must still be inside root (symlink escape).
    let realCandidate;
    try {
      if (fs.existsSync(candidate)) {
        realCandidate = realpathSafe(candidate);
      } else {
        // Resolve existing parent chain
        realCandidate = realpathSafe(candidate);
      }
    } catch (err) {
      if (err && err.reasonCode) throw err;
      fail(REASON_CODES.PATH_UNSAFE, 'failed to resolve candidate path');
    }

    if (!isInsideRoot(root.realPath, realCandidate)) {
      // Distinguish symlink escape when the logical path looked inside.
      let symlinkEscape = false;
      try {
        const parts = rel.split('/');
        let walk = root.realPath;
        for (const part of parts) {
          walk = path.join(walk, part);
          if (fs.existsSync(walk) && fs.lstatSync(walk).isSymbolicLink()) {
            symlinkEscape = true;
            break;
          }
        }
      } catch {
        // ignore
      }
      fail(
        symlinkEscape ? REASON_CODES.SYMLINK_ESCAPE : REASON_CODES.PATH_ESCAPE,
        symlinkEscape ? 'symlink or junction escapes trusted root' : 'path escapes trusted root'
      );
    }

    return {
      rootId,
      relativePath: rel,
      absolutePath: candidate,
      realPath: realCandidate,
    };
  }

  /**
   * Validate an absolute path is under a registered trusted root.
   */
  function resolveAbsolute(rootId, absolutePath) {
    const root = get(rootId);
    if (typeof absolutePath !== 'string' || !absolutePath.trim()) {
      fail(REASON_CODES.PATH_UNSAFE, 'absolute path is required');
    }
    const abs = path.resolve(absolutePath);
    const real = realpathSafe(abs);
    if (!isInsideRoot(root.realPath, real)) {
      // Check symlink on the path
      let symlinkEscape = false;
      try {
        let walk = abs;
        while (walk && walk !== path.dirname(walk)) {
          if (fs.existsSync(walk) && fs.lstatSync(walk).isSymbolicLink()) {
            const realWalk = realpathSafe(walk);
            if (!isInsideRoot(root.realPath, realWalk)) {
              symlinkEscape = true;
              break;
            }
          }
          const parent = path.dirname(walk);
          if (parent === walk) break;
          walk = parent;
          if (walk === root.realPath || walk === root.configuredPath) break;
        }
      } catch {
        // ignore
      }
      fail(
        symlinkEscape ? REASON_CODES.SYMLINK_ESCAPE : REASON_CODES.UNTRUSTED_ROOT,
        symlinkEscape ? 'symlink or junction escapes trusted root' : 'path is outside trusted root'
      );
    }
    const relative = path.relative(root.realPath, real).split(path.sep).join('/');
    return {
      rootId,
      relativePath: relative || '.',
      absolutePath: abs,
      realPath: real,
    };
  }

  function list() {
    return Array.from(byId.values()).map(r => ({
      rootId: r.rootId,
      path: r.configuredPath,
    }));
  }

  return {
    get,
    list,
    resolveUnderRoot,
    resolveAbsolute,
    size: () => byId.size,
  };
}

module.exports = {
  createTrustedRootRegistry,
  realpathSafe,
  isInsideRoot,
};
