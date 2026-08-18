'use strict';

const fs = require('fs');
const path = require('path');
const { sha256Hex } = require('../content/hash');
const { canonicalizeContent, canonicalizeRelativePath } = require('../content/normalize');
const { createTrustedRootRegistry, realpathSafe } = require('../content/trustedRoots');
const { fail, REASON_CODES } = require('../store/errors');

const IMPORT_MANIFEST_FILE = 'zeus-import-manifest.json';

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
  if (path.basename(relativePath).toLowerCase() === IMPORT_MANIFEST_FILE) return false;
  const ext = path.extname(relativePath).toLowerCase();
  return extensions.includes(ext);
}

function safeManifestPath(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const candidate = value.trim().replace(/\\/g, '/');
  if (candidate.startsWith('/') || /^[A-Za-z]:/.test(candidate)) return null;
  try {
    return canonicalizeRelativePath(candidate);
  } catch {
    return null;
  }
}

function safeOriginValue(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (!normalized || normalized.length > 128 || /[\u0000-\u001f]/.test(normalized)) return null;
  return /^[A-Z0-9_$#@.\-]+$/.test(normalized) ? normalized : null;
}

function safeTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildSafeMemberPath(sourceLib, sourceFile, member) {
  if (!sourceLib || !sourceFile || !member) return null;
  return `/QSYS.LIB/${sourceLib}.LIB/${sourceFile}.FILE/${member}.MBR`;
}

function readImportObservation(root) {
  const manifestPath = path.join(root.path, IMPORT_MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) {
    return { state: 'missing', entries: new Map() };
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return { state: 'malformed', entries: new Map() };
  }
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.files)) {
    return { state: 'malformed', entries: new Map() };
  }
  const entries = new Map();
  for (const entry of manifest.files) {
    if (!entry || typeof entry !== 'object') continue;
    const origin = entry.origin && typeof entry.origin === 'object' ? entry.origin : entry;
    const relativePath = safeManifestPath(entry.localPath || origin.localPath);
    if (!relativePath) continue;
    const validation =
      entry.validation && typeof entry.validation === 'object' ? entry.validation : entry;
    const sha256 =
      typeof validation.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(validation.sha256)
        ? validation.sha256.toLowerCase()
        : null;
    if (entries.has(relativePath)) continue;
    const sourceLib = safeOriginValue(origin.sourceLib);
    const sourceFile = safeOriginValue(origin.sourceFile);
    const member = safeOriginValue(origin.member);
    entries.set(relativePath, {
      origin: {
        systemAlias:
          safeOriginValue(root.systemAlias) || safeOriginValue(root.rootId) || 'trusted-root',
        sourceLib,
        sourceFile,
        member,
        memberPath: buildSafeMemberPath(sourceLib, sourceFile, member),
        fetchedAt: safeTimestamp(entry.fetchedAt || manifest.fetchedAt),
        sourceType: safeOriginValue(origin.sourceType),
      },
      sha256,
    });
  }
  return { state: 'valid', entries };
}

function buildImportObservation(root, relativePath, rawBytesHash, contentHash, manifestState) {
  const entry = manifestState.entries.get(relativePath);
  const base = entry
    ? entry.origin
    : {
        systemAlias:
          safeOriginValue(root.systemAlias) || safeOriginValue(root.rootId) || 'trusted-root',
        sourceLib: null,
        sourceFile: null,
        member: null,
        memberPath: null,
        fetchedAt: null,
        sourceType: null,
      };
  let importedCopyIntegrity;
  if (manifestState.state === 'missing') {
    importedCopyIntegrity = { status: 'unknown', reason: 'manifest-missing' };
  } else if (manifestState.state === 'malformed') {
    importedCopyIntegrity = { status: 'unknown', reason: 'manifest-malformed' };
  } else if (!entry || !entry.sha256) {
    importedCopyIntegrity = { status: 'unknown', reason: 'manifest-entry-or-sha-missing' };
  } else if (entry.sha256 === rawBytesHash) {
    importedCopyIntegrity = { status: 'fresh', reason: 'validation-sha256-matches-raw-bytes' };
  } else if (entry.sha256 === contentHash) {
    importedCopyIntegrity = { status: 'unknown', reason: 'raw-vs-canonical-hash-ambiguous' };
  } else {
    importedCopyIntegrity = { status: 'stale', reason: 'validation-sha256-mismatch' };
  }
  const provenance = {
    origin: base,
    importedCopyIntegrity,
  };
  return {
    origin: base,
    importedCopyIntegrity,
    provenanceHash: sha256Hex(Buffer.from(JSON.stringify(base), 'utf8')),
    importObservationHash: sha256Hex(Buffer.from(JSON.stringify(provenance), 'utf8')),
  };
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
    const manifestState = readImportObservation(root);
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
      const rawBytesHash = sha256Hex(raw);
      const relativePath = file.relativePath;
      const observation = buildImportObservation(
        root,
        relativePath,
        rawBytesHash,
        contentHash,
        manifestState
      );
      const sourceUnitId = `su:${root.rootId}:${relativePath}`;
      units.push({
        sourceUnitId,
        trustedRootId: root.rootId,
        relativePath,
        contentHash,
        rawBytesHash,
        sizeBytes: bytes.length,
        language: guessLanguage(relativePath),
        hashAlgorithm: 'sha256',
        ...observation,
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
    u =>
      `${u.trustedRootId}\0${u.relativePath}\0${u.contentHash}\0${u.sizeBytes}\0${u.provenanceHash || ''}\0${u.importObservationHash || ''}`
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
