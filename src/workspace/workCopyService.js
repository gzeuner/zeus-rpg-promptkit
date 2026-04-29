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
const { readImportManifest } = require('../fetch/importManifest');

function normalizeMemberName(value) {
  return String(value || '').trim().toUpperCase();
}

function parseMembersCsv(value) {
  if (value === undefined || value === null || value === true) {
    return [];
  }
  return Array.from(new Set(String(value)
    .split(',')
    .map((entry) => normalizeMemberName(entry))
    .filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

function walkFiles(rootDir) {
  const pending = [rootDir];
  const discovered = [];

  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const resolved = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(resolved);
      } else if (entry.isFile()) {
        discovered.push(resolved);
      }
    }
  }

  return discovered.sort((a, b) => a.localeCompare(b));
}

function buildWorkCopyTargetName(entry, mode) {
  const extension = String(entry.extension || '').trim();
  if (mode === 'original') {
    return `${entry.member}${extension}`;
  }
  if (mode === 'suffixed') {
    return `${entry.member}${extension}.work`;
  }
  return `${entry.member}${extension}.txt`;
}

function discoverFetchedSources(sourceRoot) {
  const resolvedSourceRoot = path.resolve(sourceRoot);
  const manifestResult = readImportManifest(resolvedSourceRoot);
  const entries = [];

  if (manifestResult.manifest && Array.isArray(manifestResult.manifest.files)) {
    for (const fileEntry of manifestResult.manifest.files) {
      const localPath = fileEntry && fileEntry.origin ? fileEntry.origin.localPath : fileEntry.localPath;
      const sourcePath = localPath ? path.join(resolvedSourceRoot, localPath) : '';
      const member = normalizeMemberName(fileEntry && fileEntry.origin ? fileEntry.origin.member : fileEntry.member);
      const extension = path.extname(sourcePath);
      if (!sourcePath || !member || !fs.existsSync(sourcePath) || !extension) {
        continue;
      }
      entries.push({
        member,
        extension,
        relativePath: String(localPath || '').replace(/\\/g, '/'),
        sourcePath,
      });
    }
  }

  if (entries.length > 0) {
    return entries.sort((a, b) => {
      if (a.member !== b.member) return a.member.localeCompare(b.member);
      return a.relativePath.localeCompare(b.relativePath);
    });
  }

  return walkFiles(resolvedSourceRoot)
    .filter((filePath) => path.basename(filePath) !== 'zeus-import-manifest.json')
    .map((filePath) => ({
      member: normalizeMemberName(path.basename(filePath, path.extname(filePath))),
      extension: path.extname(filePath),
      relativePath: path.relative(resolvedSourceRoot, filePath).replace(/\\/g, '/'),
      sourcePath: filePath,
    }))
    .filter((entry) => entry.member && entry.extension)
    .sort((a, b) => {
      if (a.member !== b.member) return a.member.localeCompare(b.member);
      return a.relativePath.localeCompare(b.relativePath);
    });
}

function copyFetchedSourcesToWorkspace({
  sourceRoot,
  targetRoot,
  workCopyMode,
  force = false,
  members = [],
}) {
  const discovered = discoverFetchedSources(sourceRoot);
  const requestedMembers = new Set((members || []).map((entry) => normalizeMemberName(entry)).filter(Boolean));
  const selectedEntries = requestedMembers.size > 0
    ? discovered.filter((entry) => requestedMembers.has(entry.member))
    : discovered;
  const results = [];

  fs.mkdirSync(targetRoot, { recursive: true });

  for (const entry of selectedEntries) {
    const targetName = buildWorkCopyTargetName(entry, workCopyMode);
    const targetPath = path.join(targetRoot, targetName);

    try {
      const existedBefore = fs.existsSync(targetPath);
      if (existedBefore && !force) {
        results.push({
          status: 'already exists',
          member: entry.member,
          source: entry.relativePath,
          target: path.relative(process.cwd(), targetPath).replace(/\\/g, '/'),
          note: 'Use --force to overwrite.',
        });
        continue;
      }

      fs.copyFileSync(entry.sourcePath, targetPath);
      results.push({
        status: 'copied',
        member: entry.member,
        source: entry.relativePath,
        target: path.relative(process.cwd(), targetPath).replace(/\\/g, '/'),
        note: existedBefore && force ? 'Overwritten with --force.' : '',
      });
    } catch (error) {
      results.push({
        status: 'error',
        member: entry.member,
        source: entry.relativePath,
        target: path.relative(process.cwd(), targetPath).replace(/\\/g, '/'),
        note: error.message,
      });
    }
  }

  if (requestedMembers.size > 0) {
    const discoveredMembers = new Set(selectedEntries.map((entry) => entry.member));
    for (const requestedMember of Array.from(requestedMembers).sort((a, b) => a.localeCompare(b))) {
      if (discoveredMembers.has(requestedMember)) {
        continue;
      }
      results.push({
        status: 'skipped',
        member: requestedMember,
        source: '',
        target: '',
        note: 'No fetched source found for requested member.',
      });
    }
  }

  return {
    discoveredCount: discovered.length,
    selectedCount: selectedEntries.length,
    copiedCount: results.filter((entry) => entry.status === 'copied').length,
    skippedCount: results.filter((entry) => entry.status === 'skipped').length,
    existingCount: results.filter((entry) => entry.status === 'already exists').length,
    errorCount: results.filter((entry) => entry.status === 'error').length,
    results,
  };
}

module.exports = {
  buildWorkCopyTargetName,
  copyFetchedSourcesToWorkspace,
  discoverFetchedSources,
  normalizeMemberName,
  parseMembersCsv,
};
