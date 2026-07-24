'use strict';

const fs = require('fs');
const path = require('path');
const { sha256Hex } = require('../content/hash');
const { canonicalizeContent, canonicalizeRelativePath } = require('../content/normalize');
const { createTrustedRootRegistry, realpathSafe } = require('../content/trustedRoots');
const { fail, REASON_CODES } = require('../store/errors');

const DEFAULT_EXTENSIONS = Object.freeze([
  '.rpgle',
  '.sqlrpgle',
  '.rpg',
  '.clle',
  '.clp',
  '.sql',
  '.pf',
  '.lf',
  '.dspf',
  '.prtf',
  '.bnd',
  '.txt',
  '.md',
]);

function guessLanguage(relativePath) {
  const ext = path.extname(relativePath).toLowerCase();
  if (ext === '.sqlrpgle') return 'sqlrpgle';
  if (ext === '.rpgle' || ext === '.rpg') return 'rpgle';
  if (ext === '.clle' || ext === '.clp') return 'clle';
  if (ext === '.sql') return 'sql';
  if (ext === '.md') return 'markdown';
  return ext ? ext.slice(1) : 'unknown';
}

function shouldInclude(relativePath, extensions) {
  const ext = path.extname(relativePath).toLowerCase();
  return extensions.includes(ext);
}

function walkFiles(rootReal, baseRel, extensions, out) {
  let entries;
  try {
    entries = fs.readdirSync(rootReal, { withFileTypes: true });
  } catch {
    fail(REASON_CODES.UNTRUSTED_ROOT, 'failed to read trusted root');
  }
  // Deterministic order
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..') continue;
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(rootReal, entry.name);
    const rel = baseRel ? `${baseRel}/${entry.name}` : entry.name;
    let stat;
    try {
      stat = fs.lstatSync(abs);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) {
      // Resolve and ensure still under root
      let real;
      try {
        real = realpathSafe(abs);
      } catch {
        fail(REASON_CODES.SYMLINK_ESCAPE, 'symlink under trusted root could not be resolved');
      }
      // Parent walk already constrained; re-check containment by prefix of realpath of root
      // Defer to caller registry for put; here skip non-file symlink targets that escape via fail later
      try {
        const st = fs.statSync(real);
        if (st.isDirectory()) {
          walkFiles(real, rel.replace(/\\/g, '/'), extensions, out);
        } else if (st.isFile()) {
          const posix = canonicalizeRelativePath(rel.replace(/\\/g, '/'));
          if (shouldInclude(posix, extensions)) {
            out.push({ absolutePath: real, relativePath: posix });
          }
        }
      } catch {
        fail(REASON_CODES.SYMLINK_ESCAPE, 'symlink target is not accessible under trusted root');
      }
      continue;
    }
    if (stat.isDirectory()) {
      walkFiles(abs, rel.replace(/\\/g, '/'), extensions, out);
    } else if (stat.isFile()) {
      const posix = canonicalizeRelativePath(rel.replace(/\\/g, '/'));
      if (shouldInclude(posix, extensions)) {
        out.push({ absolutePath: abs, relativePath: posix });
      }
    }
  }
}

/**
 * Build a deterministic source inventory from trusted roots.
 * Content is hashed after text canonicalization (BOM/CRLF) for source-like files.
 *
 * @returns {{
 *   units: Array<object>,
 *   inventoryHash: string,
 *   unitCount: number
 * }}
 */
function buildSourceInventory({
  trustedRoots,
  extensions = DEFAULT_EXTENSIONS,
  hashMode = 'text',
} = {}) {
  if (!Array.isArray(trustedRoots) || trustedRoots.length === 0) {
    fail(REASON_CODES.UNTRUSTED_ROOT, 'at least one trusted root is required');
  }
  // Validate roots exist
  createTrustedRootRegistry(trustedRoots);

  const units = [];
  for (const root of trustedRoots) {
    const rootReal = realpathSafe(root.path);
    const files = [];
    walkFiles(rootReal, '', extensions, files);
    for (const file of files) {
      // Symlink escape: ensure real path stays under rootReal
      const realFile = realpathSafe(file.absolutePath);
      const relCheck = path.relative(rootReal, realFile);
      if (
        relCheck.startsWith('..') ||
        path.isAbsolute(relCheck) ||
        relCheck.includes(`..${path.sep}`)
      ) {
        fail(REASON_CODES.SYMLINK_ESCAPE, 'source path escapes trusted root');
      }
      const raw = fs.readFileSync(realFile);
      const { bytes } = canonicalizeContent(raw, {
        mode: hashMode === 'binary' ? 'binary' : 'text',
      });
      const contentHash = sha256Hex(bytes);
      const relativePath = file.relativePath;
      const sourceUnitId = `su:${root.rootId}:${relativePath}`;
      units.push({
        sourceUnitId,
        trustedRootId: root.rootId,
        relativePath,
        contentHash,
        sizeBytes: bytes.length,
        language: guessLanguage(relativePath),
        hashAlgorithm: 'sha256',
        // raw bytes for content store put (canonical)
        _canonicalBytes: bytes,
      });
    }
  }

  units.sort((a, b) => {
    if (a.trustedRootId !== b.trustedRootId) {
      return a.trustedRootId.localeCompare(b.trustedRootId);
    }
    return a.relativePath.localeCompare(b.relativePath);
  });

  const inventoryHash = hashInventory(units);
  return {
    units,
    inventoryHash,
    unitCount: units.length,
  };
}

/**
 * Stable inventory identity hash.
 */
function hashInventory(units) {
  const lines = units.map(
    u => `${u.trustedRootId}\0${u.relativePath}\0${u.contentHash}\0${u.sizeBytes}`
  );
  return sha256Hex(Buffer.from(`${lines.join('\n')}\n`, 'utf8'));
}

function inventoryUnitKey(unit) {
  return `${unit.trustedRootId}\0${unit.relativePath}`;
}

module.exports = {
  DEFAULT_EXTENSIONS,
  buildSourceInventory,
  hashInventory,
  inventoryUnitKey,
  guessLanguage,
};
