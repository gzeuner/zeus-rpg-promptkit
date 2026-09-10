'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { buildPuiProjection } = require('../../pui/puiProjection');
const { persistFinalKnowledgeCatalog } = require('../knowledgePipeline');
const { buildNeutralPuiKnowledgeCatalog } = require('./puiPatternExtractor');

const PRIVATE_INVENTORY_SCHEMA_VERSION = '1.0.0';
const PUI_TOKEN_PATTERN = /\bPUI\b/;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

function normalizeRunId(value) {
  const runId = String(value || '').trim();
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error('runId must contain only letters, numbers, dots, underscores, or hyphens');
  }
  return runId;
}

function resolveDirectory(value, label, { mustExist = true } = {}) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  const resolved = path.resolve(value.trim());
  if (mustExist && (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory())) {
    throw new Error(`${label} directory not found: ${resolved}`);
  }
  return resolved;
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === '' ||
    (relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function assertSeparateOutputRoots(outputRoot, privateOutputRoot) {
  if (isWithin(outputRoot, privateOutputRoot) || isWithin(privateOutputRoot, outputRoot)) {
    throw new Error(
      'General and private output roots must be separate, non-overlapping directories.'
    );
  }
}

function walkDdsFiles(sourceRoot, currentRoot = sourceRoot, result = []) {
  const entries = fs
    .readdirSync(currentRoot, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const absolutePath = path.join(currentRoot, entry.name);
    if (entry.isDirectory()) {
      walkDdsFiles(sourceRoot, absolutePath, result);
      continue;
    }
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.dds') {
      continue;
    }

    const content = fs.readFileSync(absolutePath, 'utf8');
    if (!PUI_TOKEN_PATTERN.test(content)) {
      continue;
    }
    result.push({
      absolutePath,
      relativePath: path.relative(sourceRoot, absolutePath).split(path.sep).join('/'),
      content,
    });
  }

  return result.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function sha256(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function writeJsonAtomically(targetPath, value) {
  const directory = path.dirname(targetPath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, targetPath);
  } catch (error) {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      /* preserve original error */
    }
    throw error;
  }
}

function privateInventoryPath(privateOutputRoot, runId) {
  return path.join(
    privateOutputRoot,
    'private',
    normalizeRunId(runId),
    'pui-private-inventory.json'
  );
}

function buildPrivateInventory({ sourceRoot, runId, generatedAt, entries }) {
  return {
    kind: 'zeus-pui-private-inventory',
    layer: 'private-local-inventory',
    schemaVersion: PRIVATE_INVENTORY_SCHEMA_VERSION,
    generatedAt,
    generator: {
      name: 'zeus-pui-batch-extractor',
      version: '0.3.0',
    },
    privacyMode: 'local-only',
    sensitive: true,
    localOnly: true,
    reviewRequired: true,
    sourcePolicy: {
      rawSourceTextIncluded: false,
      decodedProjectionIncluded: true,
      intendedForPackaging: false,
      intendedForMcp: false,
    },
    sourceRoot,
    runId,
    entries: entries.map(entry => ({
      relativePath: entry.relativePath,
      sha256: entry.sha256,
      byteLength: entry.byteLength,
      projection: entry.projection,
    })),
  };
}

/**
 * Extract project-neutral UI patterns from a local DDS directory.
 *
 * The final catalog deliberately receives only the merged neutral projection.
 * Source paths, hashes, and decoded projections are written to a distinct
 * local-only inventory and are never returned as part of the final catalog.
 */
function extractPuiBatch({
  sourceRoot,
  outputRoot,
  privateOutputRoot,
  runId,
  generatedAt,
  generatorVersion,
} = {}) {
  const resolvedSourceRoot = resolveDirectory(sourceRoot, 'sourceRoot');
  const resolvedOutputRoot = resolveDirectory(outputRoot, 'outputRoot', { mustExist: false });
  const resolvedPrivateOutputRoot = resolveDirectory(privateOutputRoot, 'privateOutputRoot', {
    mustExist: false,
  });
  assertSeparateOutputRoots(resolvedOutputRoot, resolvedPrivateOutputRoot);
  const normalizedRunId = normalizeRunId(runId);
  const timestamp = generatedAt || new Date().toISOString();
  const files = walkDdsFiles(resolvedSourceRoot);
  const entries = files.map(file => {
    const projection = buildPuiProjection(file.content, { file: file.relativePath });
    return {
      relativePath: file.relativePath,
      sha256: sha256(file.content),
      byteLength: Buffer.byteLength(file.content, 'utf8'),
      projection,
    };
  });
  const mergedProjection = {
    recordFormats: entries.flatMap(entry => entry.projection.recordFormats || []),
  };
  const catalog = buildNeutralPuiKnowledgeCatalog(mergedProjection, {
    generatedAt: timestamp,
    generatorVersion,
  });
  const written = persistFinalKnowledgeCatalog({
    outputRoot: resolvedOutputRoot,
    runId: normalizedRunId,
    catalog,
  });

  const inventoryPath = privateInventoryPath(resolvedPrivateOutputRoot, normalizedRunId);
  writeJsonAtomically(
    inventoryPath,
    buildPrivateInventory({
      sourceRoot: resolvedSourceRoot,
      runId: normalizedRunId,
      generatedAt: timestamp,
      entries,
    })
  );

  return {
    path: written.path,
    privatePath: inventoryPath,
    catalog: written.catalog,
    fileCount: files.length,
    patternCount: written.catalog.patterns.length,
  };
}

module.exports = {
  PRIVATE_INVENTORY_SCHEMA_VERSION,
  PUI_TOKEN_PATTERN,
  buildPrivateInventory,
  extractPuiBatch,
  privateInventoryPath,
  scanPuiDdsFiles: walkDdsFiles,
};
