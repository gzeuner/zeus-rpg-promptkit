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

const IMPORT_MANIFEST_FILE = 'zeus-import-manifest.json';
const IMPORT_MANIFEST_SCHEMA_VERSION = 1;

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
  const validation = validateSourceFiles(
    exportRecords
      .map((record) => record.localPath)
      .filter(Boolean),
    { rootDir: localDestination },
  );
  const validationByPath = new Map(validation.results.map((result) => [result.path, result]));

  const files = exportRecords.map((record) => {
    const validationResult = validationByPath.get(record.localPath) || null;
    return {
      sourceLib: String(record.sourceLib || '').trim().toUpperCase(),
      sourceFile: String(record.sourceFile || '').trim().toUpperCase(),
      member: String(record.member || '').trim().toUpperCase(),
      remotePath: record.remotePath,
      localPath: normalizeRelativePath(localDestination, record.localPath),
      exported: Boolean(record.ok),
      fallbackUsed: Boolean(record.fallbackUsed),
      messages: Array.isArray(record.messages) ? record.messages : [],
      stderr: record.stderr || '',
      exists: Boolean(validationResult && validationResult.exists),
      sizeBytes: validationResult ? validationResult.sizeBytes : 0,
      sha256: validationResult ? validationResult.sha256 : null,
      utf8Valid: validationResult ? validationResult.utf8Valid : false,
      newlineStyle: validationResult ? validationResult.newlineStyle : 'UNKNOWN',
      validationStatus: validationResult ? validationResult.status : 'invalid',
      validationMessages: validationResult ? validationResult.issues.map((issue) => issue.message) : [],
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
      sourceLib: String(options.sourceLib || '').trim().toUpperCase(),
      ifsDir: options.ifsDir,
    },
    localDestination,
    transportRequested: String(options.transport || '').trim().toLowerCase(),
    transportUsed: summary.transportUsed || null,
    streamFileCcsid: Number(options.streamFileCcsid) || null,
    encodingPolicy: summary.encodingPolicy,
    summary: {
      exportedSuccess: summary.exportedSuccess,
      exportedTotal: summary.exportedTotal,
      downloadedCount: summary.downloadedCount,
      fileCount: files.length,
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
  readImportManifest,
  writeImportManifest,
};
