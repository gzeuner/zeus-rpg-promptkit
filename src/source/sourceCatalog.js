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
const path = require('path');
const {
  getImportManifestEntryExport,
  getImportManifestEntryOrigin,
  getImportManifestEntryValidation,
  readImportManifest,
} = require('../fetch/importManifest');
const { normalizeRelativePath } = require('./sourceIntegrity');

function normalizeName(value) {
  return String(value || '').trim().toUpperCase();
}

function toSortedUniquePaths(paths) {
  return Array.from(new Set((paths || []).filter(Boolean).map((entry) => path.resolve(String(entry)))))
    .sort((a, b) => a.localeCompare(b));
}

function inferMemberName(filePath) {
  return normalizeName(path.basename(String(filePath || ''), path.extname(String(filePath || ''))));
}

function inferSourceFile(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length < 2) {
    return '';
  }
  return normalizeName(segments[segments.length - 2]);
}

function inferSourceType(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return normalizeName(ext.startsWith('.') ? ext.slice(1) : ext);
}

function buildIdentity(entry) {
  if (entry.sourceLib && entry.sourceFile && entry.memberName) {
    return `${entry.sourceLib}/${entry.sourceFile}(${entry.memberName})`;
  }
  if (entry.sourceFile && entry.memberName) {
    return `${entry.sourceFile}(${entry.memberName})`;
  }
  return `LOCAL:${entry.relativePath}`;
}

function buildManifestEntryMap(importManifest) {
  const map = new Map();
  if (!importManifest || !Array.isArray(importManifest.files)) {
    return map;
  }

  for (const entry of importManifest.files) {
    const relativePath = String(entry && entry.localPath ? entry.localPath : '').trim().replace(/\\/g, '/');
    if (!relativePath) continue;
    map.set(relativePath, entry);
  }
  return map;
}

function buildSourceCatalog({
  sourceFiles,
  sourceRoot,
  importManifest = undefined,
} = {}) {
  const resolvedRoot = sourceRoot ? path.resolve(sourceRoot) : process.cwd();
  const importManifestResult = importManifest === undefined
    ? readImportManifest(resolvedRoot)
    : { manifestPath: null, manifest: importManifest || null, error: null };
  const manifestEntryMap = buildManifestEntryMap(importManifestResult.manifest);
  const entries = [];
  const byMemberName = new Map();
  const byIdentity = new Map();

  for (const filePath of toSortedUniquePaths(sourceFiles)) {
    const relativePath = normalizeRelativePath(resolvedRoot, filePath);
    const manifestEntry = manifestEntryMap.get(relativePath) || null;
    const manifestOrigin = manifestEntry ? getImportManifestEntryOrigin(manifestEntry) : null;
    const manifestExport = manifestEntry ? getImportManifestEntryExport(manifestEntry, importManifestResult.manifest) : null;
    const manifestValidation = manifestEntry ? getImportManifestEntryValidation(manifestEntry) : null;
    const entry = {
      path: path.resolve(filePath),
      relativePath,
      memberName: normalizeName(manifestOrigin && manifestOrigin.member ? manifestOrigin.member : inferMemberName(filePath)),
      sourceLib: normalizeName(manifestOrigin && manifestOrigin.sourceLib ? manifestOrigin.sourceLib : ''),
      sourceFile: normalizeName(manifestOrigin && manifestOrigin.sourceFile ? manifestOrigin.sourceFile : inferSourceFile(relativePath)),
      sourceType: normalizeName(manifestOrigin && manifestOrigin.sourceType ? manifestOrigin.sourceType : inferSourceType(filePath)),
      provenance: manifestEntry ? 'IMPORT_MANIFEST' : 'LOCAL',
      provenanceDetails: manifestEntry ? {
        memberPath: manifestOrigin.memberPath || '',
        remotePath: manifestOrigin.remotePath || '',
        localPath: manifestOrigin.localPath || relativePath,
        exportStatus: manifestExport.status || null,
        validationStatus: manifestValidation.status || null,
      } : null,
    };
    entry.identity = buildIdentity(entry);

    entries.push(entry);
    byIdentity.set(entry.identity, entry);

    if (!byMemberName.has(entry.memberName)) {
      byMemberName.set(entry.memberName, []);
    }
    byMemberName.get(entry.memberName).push(entry);
  }

  const ambiguousMembers = Array.from(byMemberName.entries())
    .filter(([, matches]) => matches.length > 1)
    .map(([memberName]) => memberName)
    .sort((a, b) => a.localeCompare(b));

  for (const [memberName, matches] of byMemberName.entries()) {
    byMemberName.set(memberName, [...matches].sort((a, b) => {
      if (a.identity !== b.identity) return a.identity.localeCompare(b.identity);
      return a.relativePath.localeCompare(b.relativePath);
    }));
  }

  return {
    sourceRoot: resolvedRoot,
    importManifest: importManifestResult.manifest,
    importManifestPath: importManifestResult.manifestPath,
    importManifestError: importManifestResult.error || null,
    entries: entries.sort((a, b) => {
      if (a.identity !== b.identity) return a.identity.localeCompare(b.identity);
      return a.relativePath.localeCompare(b.relativePath);
    }),
    byMemberName,
    byIdentity,
    summary: {
      fileCount: entries.length,
      distinctMemberCount: byMemberName.size,
      manifestBackedCount: entries.filter((entry) => entry.provenance === 'IMPORT_MANIFEST').length,
      ambiguousMemberCount: ambiguousMembers.length,
      ambiguousMembers,
    },
  };
}

module.exports = {
  buildSourceCatalog,
  buildIdentity,
  inferMemberName,
  normalizeName,
};
