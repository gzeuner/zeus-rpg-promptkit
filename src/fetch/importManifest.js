/*
Copyright 2026 Guido Zeuner

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
const fs = require('fs');
const path = require('path');
const { validateSourceFiles, normalizeRelativePath } = require('../source/sourceIntegrity');
const { memberToExtension } = require('./ifsExporter');

const IMPORT_MANIFEST_FILE = 'zeus-import-manifest.json';
const IMPORT_MANIFEST_SCHEMA_VERSION = 2;
const DEFAULT_NORMALIZATION_POLICY = Object.freeze({
  contentBytes: 'preserve',
  lineEndings: 'preserve',
  localPathFormat: 'relative-forward-slash',
  checksumAlgorithm: 'sha256',
});

function normalizeName(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizePathValue(value) {
  return String(value || '').trim().replace(/\\/g, '/');
}

function buildMemberPath(sourceLib, sourceFile, member) {
  const lib = normalizeName(sourceLib);
  const file = normalizeName(sourceFile);
  const memberName = normalizeName(member);
  if (!lib || !file || !memberName) {
    return '';
  }
  return `/QSYS.LIB/${lib}.LIB/${file}.FILE/${memberName}.MBR`;
}

function inferSourceType(sourceFile) {
  const ext = memberToExtension(sourceFile);
  return normalizeName(ext.startsWith('.') ? ext.slice(1) : ext) || 'SRC';
}

function createNormalizationPolicy(policy = null) {
  const source = policy && typeof policy === 'object' ? policy : DEFAULT_NORMALIZATION_POLICY;
  return {
    contentBytes: String(source.contentBytes || DEFAULT_NORMALIZATION_POLICY.contentBytes),
    lineEndings: String(source.lineEndings || DEFAULT_NORMALIZATION_POLICY.lineEndings),
    localPathFormat: String(source.localPathFormat || DEFAULT_NORMALIZATION_POLICY.localPathFormat),
    checksumAlgorithm: String(source.checksumAlgorithm || DEFAULT_NORMALIZATION_POLICY.checksumAlgorithm),
  };
}

function buildOriginRecord(record, localDestination) {
  const sourceLib = normalizeName(record.sourceLib);
  const sourceFile = normalizeName(record.sourceFile);
  const member = normalizeName(record.member);
  const localPath = normalizeRelativePath(localDestination, record.localPath);

  return {
    sourceLib,
    sourceFile,
    member,
    memberPath: buildMemberPath(sourceLib, sourceFile, member),
    remotePath: record.remotePath || '',
    localPath,
    sourceType: inferSourceType(sourceFile),
  };
}

function buildExportRecord(record, summary, options, normalizationPolicy) {
  return {
    status: record.ok ? 'exported' : 'failed',
    transportRequested: normalizePathValue(options.transport).toLowerCase(),
    transportUsed: summary.transportUsed || null,
    fallbackUsed: Boolean(record.fallbackUsed),
    command: record.command || '',
    streamFileCcsid: Number(options.streamFileCcsid) || null,
    encodingPolicy: summary.encodingPolicy || null,
    normalizationPolicy,
    messages: Array.isArray(record.messages) ? record.messages : [],
    stderr: record.stderr || '',
  };
}

function buildValidationRecord(validationResult) {
  return {
    exists: Boolean(validationResult && validationResult.exists),
    sizeBytes: validationResult ? validationResult.sizeBytes : 0,
    sha256: validationResult ? validationResult.sha256 : null,
    utf8Valid: Boolean(validationResult && validationResult.utf8Valid),
    newlineStyle: validationResult ? validationResult.newlineStyle : 'UNKNOWN',
    status: validationResult ? validationResult.status : 'invalid',
    messages: validationResult ? validationResult.issues.map((issue) => issue.message) : [],
  };
}

function getImportManifestEntryOrigin(entry) {
  const origin = entry && entry.origin && typeof entry.origin === 'object'
    ? entry.origin
    : entry || {};

  return {
    sourceLib: normalizeName(origin.sourceLib),
    sourceFile: normalizeName(origin.sourceFile),
    member: normalizeName(origin.member),
    memberPath: origin.memberPath || buildMemberPath(origin.sourceLib, origin.sourceFile, origin.member),
    remotePath: origin.remotePath || '',
    localPath: normalizePathValue(origin.localPath || entry && entry.localPath),
    sourceType: normalizeName(origin.sourceType || inferSourceType(origin.sourceFile)),
  };
}

function getImportManifestEntryExport(entry, importManifest = null) {
  const exportRecord = entry && entry.export && typeof entry.export === 'object'
    ? entry.export
    : entry || {};
  return {
    status: exportRecord.status || (entry && entry.exported === false ? 'failed' : 'exported'),
    transportRequested: exportRecord.transportRequested || (importManifest && importManifest.transportRequested) || null,
    transportUsed: exportRecord.transportUsed || (entry && entry.transportUsed) || (importManifest && importManifest.transportUsed) || null,
    fallbackUsed: Boolean(exportRecord.fallbackUsed || (entry && entry.fallbackUsed)),
    command: exportRecord.command || (entry && entry.command) || '',
    streamFileCcsid: Number(exportRecord.streamFileCcsid || (entry && entry.streamFileCcsid) || (importManifest && importManifest.streamFileCcsid)) || null,
    encodingPolicy: exportRecord.encodingPolicy || (entry && entry.encodingPolicy) || (importManifest && importManifest.encodingPolicy) || null,
    normalizationPolicy: createNormalizationPolicy(
      exportRecord.normalizationPolicy
      || (entry && entry.normalizationPolicy)
      || (importManifest && importManifest.normalizationPolicy)
      || null,
    ),
    messages: Array.isArray(exportRecord.messages) ? exportRecord.messages : Array.isArray(entry && entry.messages) ? entry.messages : [],
    stderr: exportRecord.stderr || (entry && entry.stderr) || '',
  };
}

function getImportManifestEntryValidation(entry) {
  const validation = entry && entry.validation && typeof entry.validation === 'object'
    ? entry.validation
    : entry || {};

  return {
    exists: Boolean(validation.exists),
    sizeBytes: Number(validation.sizeBytes) || 0,
    sha256: validation.sha256 || null,
    utf8Valid: Boolean(validation.utf8Valid),
    newlineStyle: validation.newlineStyle || 'UNKNOWN',
    status: validation.status || validation.validationStatus || (entry && entry.validationStatus) || 'invalid',
    messages: Array.isArray(validation.messages)
      ? validation.messages
      : Array.isArray(validation.validationMessages)
        ? validation.validationMessages
        : Array.isArray(entry && entry.validationMessages)
          ? entry.validationMessages
          : [],
  };
}

function summarizeImportManifest(importManifest, options = {}) {
  const manifestPath = options.manifestPath || null;
  if (!importManifest || !Array.isArray(importManifest.files)) {
    return null;
  }

  const traceableFiles = importManifest.files.filter((entry) => {
    const origin = getImportManifestEntryOrigin(entry);
    return origin.sourceLib && origin.sourceFile && origin.member && origin.localPath;
  });
  const exportedFileCount = importManifest.files.filter((entry) => getImportManifestEntryExport(entry, importManifest).status === 'exported').length;
  const failedFileCount = importManifest.files.length - exportedFileCount;

  return {
    present: true,
    manifestFile: IMPORT_MANIFEST_FILE,
    manifestPath,
    schemaVersion: Number(importManifest.schemaVersion) || null,
    fetchedAt: importManifest.fetchedAt || null,
    sourceLib: importManifest.remote && importManifest.remote.sourceLib ? normalizeName(importManifest.remote.sourceLib) : null,
    transportRequested: importManifest.transportRequested || null,
    transportUsed: importManifest.transportUsed || null,
    streamFileCcsid: Number(importManifest.streamFileCcsid) || null,
    encodingPolicy: importManifest.encodingPolicy || null,
    normalizationPolicy: createNormalizationPolicy(importManifest.normalizationPolicy),
    fileCount: importManifest.summary && Number.isFinite(Number(importManifest.summary.fileCount))
      ? Number(importManifest.summary.fileCount)
      : importManifest.files.length,
    exportedFileCount: importManifest.summary && Number.isFinite(Number(importManifest.summary.exportedFileCount))
      ? Number(importManifest.summary.exportedFileCount)
      : exportedFileCount,
    failedFileCount: importManifest.summary && Number.isFinite(Number(importManifest.summary.failedFileCount))
      ? Number(importManifest.summary.failedFileCount)
      : failedFileCount,
    invalidFileCount: importManifest.summary && Number.isFinite(Number(importManifest.summary.invalidFileCount))
      ? Number(importManifest.summary.invalidFileCount)
      : 0,
    warningCount: importManifest.summary && Number.isFinite(Number(importManifest.summary.warningCount))
      ? Number(importManifest.summary.warningCount)
      : 0,
    traceableFileCount: traceableFiles.length,
  };
}

function writeImportManifest(localDestination, manifest) {
  fs.mkdirSync(localDestination, { recursive: true });
  const manifestPath = path.join(localDestination, IMPORT_MANIFEST_FILE);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifestPath;
}

function readImportManifest(sourceRoot) {
  const manifestPath = path.join(path.resolve(sourceRoot), IMPORT_MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) {
    return {
      manifestPath,
      manifest: null,
      error: null,
    };
  }

  try {
    return {
      manifestPath,
      manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')),
      error: null,
    };
  } catch (error) {
    return {
      manifestPath,
      manifest: null,
      error,
    };
  }
}

function buildImportManifest({
  options,
  summary,
  exportRecords,
  localDestination,
}) {
  const normalizationPolicy = createNormalizationPolicy();
  const validation = validateSourceFiles(
    exportRecords
      .map((record) => record.localPath)
      .filter(Boolean),
    { rootDir: localDestination },
  );
  const validationByPath = new Map(validation.results.map((result) => [result.path, result]));

  const files = exportRecords.map((record) => {
    const validationResult = validationByPath.get(record.localPath) || null;
    const origin = buildOriginRecord(record, localDestination);
    const exportDetails = buildExportRecord(record, summary, options, normalizationPolicy);
    const validationDetails = buildValidationRecord(validationResult);

    return {
      sourceLib: origin.sourceLib,
      sourceFile: origin.sourceFile,
      member: origin.member,
      memberPath: origin.memberPath,
      remotePath: origin.remotePath,
      localPath: origin.localPath,
      sourceType: origin.sourceType,
      exported: exportDetails.status === 'exported',
      transportUsed: exportDetails.transportUsed,
      fallbackUsed: exportDetails.fallbackUsed,
      command: exportDetails.command,
      streamFileCcsid: exportDetails.streamFileCcsid,
      encodingPolicy: exportDetails.encodingPolicy,
      normalizationPolicy: exportDetails.normalizationPolicy,
      messages: exportDetails.messages,
      stderr: exportDetails.stderr,
      exists: validationDetails.exists,
      sizeBytes: validationDetails.sizeBytes,
      sha256: validationDetails.sha256,
      utf8Valid: validationDetails.utf8Valid,
      newlineStyle: validationDetails.newlineStyle,
      validationStatus: validationDetails.status,
      validationMessages: validationDetails.messages,
      origin,
      export: exportDetails,
      validation: validationDetails,
    };
  });

  return {
    schemaVersion: IMPORT_MANIFEST_SCHEMA_VERSION,
    tool: {
      name: 'zeus-rpg-promptkit',
      command: 'fetch',
    },
    fetchedAt: new Date().toISOString(),
    remote: {
      host: options.host,
      sourceLib: normalizeName(options.sourceLib),
      ifsDir: options.ifsDir,
    },
    request: {
      sourceFiles: Array.isArray(options.files) ? options.files.map((value) => normalizeName(value)).filter(Boolean) : [],
      members: Array.isArray(options.members) ? options.members.map((value) => normalizeName(value)).filter(Boolean) : [],
      replace: options.replace !== false,
    },
    localDestination,
    transportRequested: String(options.transport || '').trim().toLowerCase(),
    transportUsed: summary.transportUsed || null,
    streamFileCcsid: Number(options.streamFileCcsid) || null,
    encodingPolicy: summary.encodingPolicy,
    normalizationPolicy,
    summary: {
      exportedSuccess: summary.exportedSuccess,
      exportedFailed: Math.max(0, Number(summary.exportedTotal || 0) - Number(summary.exportedSuccess || 0)),
      exportedTotal: summary.exportedTotal,
      downloadedCount: summary.downloadedCount,
      fileCount: files.length,
      exportedFileCount: files.filter((entry) => entry.exported).length,
      failedFileCount: files.filter((entry) => !entry.exported).length,
      invalidFileCount: validation.invalidCount,
      warningCount: validation.warningCount,
    },
    files,
    notes: Array.isArray(summary.notes) ? summary.notes : [],
  };
}

module.exports = {
  IMPORT_MANIFEST_FILE,
  IMPORT_MANIFEST_SCHEMA_VERSION,
  buildImportManifest,
  createNormalizationPolicy,
  getImportManifestEntryExport,
  getImportManifestEntryOrigin,
  getImportManifestEntryValidation,
  summarizeImportManifest,
  readImportManifest,
  writeImportManifest,
};
