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
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');

const { scanClFile } = require('../scanner/clScanner');
const { scanDdsFile } = require('../scanner/ddsScanner');
const { scanRpgFile } = require('../scanner/rpgScanner');
const { sourceTypeFamily } = require('../source/sourceType');

const SCHEMA_VERSION = 1;
const PARSER_VERSION = 2;
const DEFAULT_OUTPUT = '.local/legacy-source-inventory/inventory.json';
const DEFAULT_CACHE_DIRECTORY = '.cache';
const SAFE_SOURCE_TYPES = Object.freeze({
  '.rpg': 'RPG',
  '.rpgle': 'RPGLE',
  '.sqlrpgle': 'SQLRPGLE',
  '.rpgile': 'RPGILE',
  '.rpgleinc': 'RPGLEINC',
  '.clp': 'CLP',
  '.clle': 'CLLE',
  '.dds': 'DDS',
  '.dspf': 'DSPF',
  '.prtf': 'PRTF',
  '.pf': 'PF',
  '.lf': 'LF',
  '.bnd': 'BND',
  '.binder': 'BINDER',
  '.bndsrc': 'BNDSRC',
  '.sql': 'SQL',
});
const SAFE_SQL_KINDS = Object.freeze([
  'CALL',
  'CLOSE',
  'COMMIT',
  'DECLARE',
  'DELETE',
  'EXECUTE',
  'FETCH',
  'INSERT',
  'MERGE',
  'OPEN',
  'PREPARE',
  'ROLLBACK',
  'SELECT',
  'SET',
  'UPDATE',
  'VALUES',
  'OTHER',
]);

class InventoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'InventoryError';
    this.code = code;
  }
}

function hmac(salt, value) {
  return crypto.createHmac('sha256', salt).update(String(value)).digest('hex');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeInteger(value) {
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function pathsOverlap(first, second) {
  return isInside(first, second) || isInside(second, first);
}

function sourceTypeFor(filePath) {
  return SAFE_SOURCE_TYPES[path.extname(filePath).toLowerCase()] || null;
}

function familyFor(sourceType) {
  if (sourceType === 'RPGLEINC') return 'RPG';
  if (sourceType === 'SQL') return 'SQL';
  return sourceTypeFamily(sourceType);
}

function sortedObject(object) {
  return Object.fromEntries(
    Object.entries(object || {}).sort(([left], [right]) => left.localeCompare(right))
  );
}

function increment(object, key, amount = 1) {
  object[key] = (object[key] || 0) + amount;
}

function lineCount(content) {
  return content ? String(content).split('\n').length : 0;
}

function countArray(value) {
  return Array.isArray(value) ? value.length : 0;
}

function emptyFeatureCounts() {
  return {
    calls: 0,
    commands: 0,
    copyMembers: 0,
    diagnostics: 0,
    ddsFiles: 0,
    modules: 0,
    nativeFileAccesses: 0,
    nativeFiles: 0,
    procedures: 0,
    procedureCalls: 0,
    prototypes: 0,
    servicePrograms: 0,
    sqlStatements: 0,
    tables: 0,
  };
}

function buildFeatureCounts(scan) {
  return {
    calls: countArray(scan && scan.calls),
    commands: countArray(scan && scan.commands),
    copyMembers: countArray(scan && scan.copyMembers),
    diagnostics: countArray(scan && scan.diagnostics),
    ddsFiles: countArray(scan && scan.ddsFiles),
    modules: countArray(scan && scan.modules),
    nativeFileAccesses: countArray(scan && scan.nativeFileAccesses),
    nativeFiles: countArray(scan && scan.nativeFiles),
    procedures: countArray(scan && scan.procedures),
    procedureCalls: countArray(scan && scan.procedureCalls),
    prototypes: countArray(scan && scan.prototypes),
    servicePrograms: countArray(scan && scan.servicePrograms),
    sqlStatements: countArray(scan && scan.sqlStatements),
    tables: countArray(scan && scan.tables),
  };
}

function countSqlKinds(content) {
  const counts = {};
  const regex =
    /\b(SELECT|INSERT|UPDATE|DELETE|MERGE|CALL|VALUES|SET|COMMIT|ROLLBACK|DECLARE|OPEN|FETCH|CLOSE|PREPARE|EXECUTE)\b/gi;
  let match = regex.exec(String(content || ''));
  while (match) {
    increment(counts, match[1].toUpperCase());
    match = regex.exec(String(content || ''));
  }
  return sortedObject(counts);
}

function createVirtualFilePath(fileId, sourceType) {
  return path.join(fileId, `source.${String(sourceType || 'src').toLowerCase()}`);
}

function scanContent(fileId, sourceType, content) {
  const virtualPath = createVirtualFilePath(fileId, sourceType);
  const family = familyFor(sourceType);
  if (family === 'CL') return scanClFile(virtualPath, { content, sourceType });
  if (family === 'DDS') return scanDdsFile(virtualPath, { content, sourceType });
  if (family === 'RPG') return scanRpgFile(virtualPath, { content, sourceType });
  return null;
}

function summarizeScan({ fileId, sourceType, content, scan, parserStatus }) {
  const features = scan ? buildFeatureCounts(scan) : emptyFeatureCounts();
  const sqlKinds = sourceType === 'SQL' ? countSqlKinds(content) : {};
  const sqlCount = Object.values(sqlKinds).reduce((sum, value) => sum + value, 0);
  return {
    fileId,
    sourceType,
    family: familyFor(sourceType),
    parserStatus: parserStatus || (scan ? 'aggregated' : 'metadata-only'),
    sizeBytes: Buffer.byteLength(String(content || ''), 'utf8'),
    lines: lineCount(content),
    features: { ...features, sqlStatements: features.sqlStatements + sqlCount },
    sqlKinds,
  };
}

function readUtf8(buffer) {
  return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
}

function walkSourceRoot(sourceRoot) {
  const files = [];
  const counters = { directories: 0, symlinks: 0, totalFiles: 0 };
  const stack = [sourceRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        counters.symlinks += 1;
      } else if (entry.isDirectory()) {
        counters.directories += 1;
        stack.push(entryPath);
      } else if (entry.isFile()) {
        counters.totalFiles += 1;
        const sourceType = sourceTypeFor(entryPath);
        if (sourceType) files.push({ filePath: entryPath, sourceType });
      }
    }
  }
  files.sort((left, right) => left.filePath.localeCompare(right.filePath));
  return { files, counters };
}

function resolveSourceRoot(sourceRoot) {
  if (!sourceRoot || typeof sourceRoot !== 'string') {
    throw new InventoryError('SOURCE_ROOT_REQUIRED', 'A local source root is required.');
  }
  const absolute = path.resolve(sourceRoot);
  let stat;
  try {
    stat = fs.lstatSync(absolute);
  } catch {
    throw new InventoryError('SOURCE_ROOT_UNAVAILABLE', 'The local source root is unavailable.');
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new InventoryError(
      'SOURCE_ROOT_NOT_DIRECTORY',
      'The local source root must be a directory.'
    );
  }
  try {
    fs.accessSync(absolute, fs.constants.R_OK);
    return { absolute, real: fs.realpathSync(absolute) };
  } catch {
    throw new InventoryError('SOURCE_ROOT_NOT_READABLE', 'The local source root is not readable.');
  }
}

function resolveOutput(workspaceRoot, output) {
  if (!output || typeof output !== 'string' || path.isAbsolute(output)) {
    throw new InventoryError(
      'OUTPUT_OUTSIDE_WORKSPACE',
      'The output must be a relative workspace path.'
    );
  }
  const workspace = path.resolve(workspaceRoot || process.cwd());
  const absolute = path.resolve(workspace, output);
  if (!isInside(workspace, absolute)) {
    throw new InventoryError(
      'OUTPUT_OUTSIDE_WORKSPACE',
      'The output must remain inside the workspace.'
    );
  }
  const relative = path.relative(workspace, absolute).replace(/\\/g, '/');
  if (!relative.startsWith('.local/legacy-source-inventory/')) {
    throw new InventoryError(
      'OUTPUT_POLICY_VIOLATION',
      'The output must use the local inventory directory.'
    );
  }
  const directory = path.dirname(absolute);
  fs.mkdirSync(directory, { recursive: true });
  return { absolute, directory, relative };
}

function loadSalt(directory, suppliedSalt) {
  if (suppliedSalt !== undefined) return Buffer.from(String(suppliedSalt), 'utf8');
  const saltPath = path.join(directory, '.salt');
  try {
    return fs.readFileSync(saltPath);
  } catch {
    const salt = crypto.randomBytes(32);
    fs.writeFileSync(saltPath, salt, { mode: 0o600 });
    return salt;
  }
}

function cachePath(cacheDirectory, fileId) {
  return path.join(cacheDirectory, `${fileId}.json`);
}

function readCache(cacheDirectory, fileId, contentHash, sourceType) {
  try {
    const cache = JSON.parse(fs.readFileSync(cachePath(cacheDirectory, fileId), 'utf8'));
    if (
      cache &&
      cache.schemaVersion === SCHEMA_VERSION &&
      cache.parserVersion === PARSER_VERSION &&
      cache.fileId === fileId &&
      cache.contentHash === contentHash &&
      cache.sourceType === sourceType &&
      cache.summary
    ) {
      return cache.summary;
    }
  } catch {
    return null;
  }
  return null;
}

function writeCache(cacheDirectory, summary, contentHash) {
  const cache = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'zeus-confidential-legacy-source-cache-entry',
    parserVersion: PARSER_VERSION,
    fileId: summary.fileId,
    sourceType: summary.sourceType,
    contentHash,
    summary,
  };
  fs.mkdirSync(cacheDirectory, { recursive: true });
  fs.writeFileSync(cachePath(cacheDirectory, summary.fileId), `${JSON.stringify(cache)}\n`, {
    mode: 0o600,
  });
}

function buildArtifact({
  sourceRootFingerprint,
  inventoryFingerprint,
  counters,
  records,
  warnings,
}) {
  const normalizedWarnings = Array.from(new Set(warnings || [])).sort();
  const bySourceType = {};
  const byFamily = {};
  const byParserStatus = {};
  const featureTotals = emptyFeatureCounts();
  const sqlKinds = {};
  let candidateBytes = 0;
  let candidateLines = 0;
  for (const record of records) {
    increment(bySourceType, record.sourceType);
    increment(byFamily, record.family);
    increment(byParserStatus, record.parserStatus);
    candidateBytes += safeInteger(record.sizeBytes);
    candidateLines += safeInteger(record.lines);
    for (const [key, value] of Object.entries(record.features || {})) {
      featureTotals[key] = safeInteger(featureTotals[key]) + safeInteger(value);
    }
    for (const [key, value] of Object.entries(record.sqlKinds || {})) {
      if (SAFE_SQL_KINDS.includes(key)) increment(sqlKinds, key, value);
    }
  }
  const entries = records.map(record => ({
    fileId: record.fileId,
    sourceType: record.sourceType,
    family: record.family,
    parserStatus: record.parserStatus,
    sizeBytes: record.sizeBytes,
    lines: record.lines,
    features: record.features,
    sqlKinds: record.sqlKinds,
  }));
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'zeus-confidential-legacy-source-inventory',
    readOnly: true,
    sourceBoundary: {
      mode: 'local-read-only',
      followsSymlinks: false,
      pathDisclosure: 'none',
      contentDisclosure: 'none',
      sourceRootFingerprint,
    },
    inventory: {
      totalFiles: counters.totalFiles,
      candidateFiles: records.length,
      unsupportedFiles: Math.max(0, counters.totalFiles - records.length),
      directories: counters.directories,
      skippedSymlinks: counters.symlinks,
      candidateBytes,
      candidateLines,
      bySourceType: sortedObject(bySourceType),
      byFamily: sortedObject(byFamily),
      byParserStatus: sortedObject(byParserStatus),
      featureTotals,
      sqlKinds: sortedObject(sqlKinds),
    },
    evidence: {
      available: true,
      complete: normalizedWarnings.length === 0,
      count: entries.length,
      entries,
    },
    privacy: {
      containsRawSource: false,
      containsSourcePaths: false,
      containsCredentials: false,
      containsBusinessTerms: false,
      hashAlgorithm: 'hmac-sha256',
    },
    inventoryFingerprint,
    warnings: normalizedWarnings,
  };
}

function runLegacySourceInventory(options = {}) {
  const source = resolveSourceRoot(options.sourceRoot);
  const output = resolveOutput(
    options.workspaceRoot || process.cwd(),
    options.out || DEFAULT_OUTPUT
  );
  if (pathsOverlap(source.real, output.directory)) {
    throw new InventoryError(
      'SOURCE_OUTPUT_OVERLAP',
      'The source and local artifact boundaries must not overlap.'
    );
  }
  const salt = loadSalt(output.directory, options.salt);
  const sourceRootFingerprint = hmac(salt, source.real);
  const cacheDirectory = path.join(output.directory, DEFAULT_CACHE_DIRECTORY);
  const walked = walkSourceRoot(source.real);
  const records = [];
  const warnings = [];
  const cache = { reusedFiles: 0, reprocessedFiles: 0, invalidatedFiles: 0 };
  const fingerprintParts = [];

  for (const item of walked.files) {
    const relativePath = path.relative(source.real, item.filePath);
    const fileId = hmac(salt, relativePath);
    let buffer;
    try {
      buffer = fs.readFileSync(item.filePath);
    } catch {
      warnings.push('SOURCE_FILE_NOT_READABLE');
      continue;
    }
    const contentHash = sha256(buffer);
    const cached = readCache(cacheDirectory, fileId, contentHash, item.sourceType);
    if (cached) {
      records.push(cached);
      cache.reusedFiles += 1;
      fingerprintParts.push(`${fileId}:${contentHash}`);
      continue;
    }
    let content;
    try {
      content = readUtf8(buffer);
    } catch {
      warnings.push('SOURCE_FILE_INVALID_UTF8');
      continue;
    }
    let scan = null;
    let parserStatus = item.sourceType === 'SQL' ? 'metadata-only' : 'aggregated';
    try {
      scan = scanContent(fileId, item.sourceType, content);
    } catch {
      parserStatus = 'metadata-only';
      warnings.push('SCANNER_PARTIAL_FAILURE');
    }
    const summary = summarizeScan({
      fileId,
      sourceType: item.sourceType,
      content,
      scan,
      parserStatus,
    });
    writeCache(cacheDirectory, summary, contentHash);
    records.push(summary);
    cache.reprocessedFiles += 1;
    fingerprintParts.push(`${fileId}:${contentHash}`);
  }

  const inventoryFingerprint = hmac(salt, fingerprintParts.sort().join('|'));
  const artifact = buildArtifact({
    sourceRootFingerprint,
    inventoryFingerprint,
    counters: walked.counters,
    records,
    warnings,
  });
  fs.writeFileSync(output.absolute, `${JSON.stringify(artifact, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  return {
    ok: true,
    kind: 'legacy-source-inventory-result',
    status: warnings.length === 0 ? 'ready' : 'needs-attention',
    readOnly: true,
    safety: {
      level: 'S1',
      approvalRequired: false,
      sideEffects: ['local-read', 'local-artifact-write'],
    },
    scope: { origin: 'local-source-boundary', sourceRootFingerprint, output: output.relative },
    evidence: {
      available: true,
      complete: warnings.length === 0,
      count: artifact.evidence.count,
      warnings: artifact.warnings,
    },
    artifacts: [output.relative],
    summary: { ...artifact.inventory, cache },
    warnings: artifact.warnings,
    nextCommands: ['node cli/zeus.js agent log summary --json'],
    approvalRequired: false,
  };
}

module.exports = {
  DEFAULT_OUTPUT,
  InventoryError,
  SAFE_SOURCE_TYPES,
  familyFor,
  hmac,
  loadSalt,
  pathsOverlap,
  readUtf8,
  resolveOutput,
  resolveSourceRoot,
  runLegacySourceInventory,
  scanContent,
  walkSourceRoot,
};
