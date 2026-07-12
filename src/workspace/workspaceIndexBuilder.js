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
const fs = require('fs');
const path = require('path');

const { writeJsonReport } = require('../report/jsonReport');
const { listAnalysisRuns } = require('../ui/localUiDataApi');

const WORKSPACE_INDEX_FILE = 'workspace-index.json';

function normalizePathForJson(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function walkFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  const discovered = [];
  const pending = [rootDir];

  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
      } else if (entry.isFile()) {
        discovered.push(absolutePath);
      }
    }
  }

  return discovered.sort((left, right) => left.localeCompare(right));
}

function scanSourceDir(sourceDir) {
  const counts = {};
  for (const filePath of walkFiles(sourceDir)) {
    const relative = path.relative(sourceDir, filePath);
    const segments = relative.split(path.sep).filter(Boolean);
    const sourceFile = String(segments[0] || '')
      .trim()
      .toUpperCase();
    if (!sourceFile) {
      continue;
    }
    counts[sourceFile] = (counts[sourceFile] || 0) + 1;
  }
  return Object.keys(counts)
    .sort((left, right) => left.localeCompare(right))
    .reduce((acc, key) => {
      acc[key] = counts[key];
      return acc;
    }, {});
}

function findReportFiles(workspacePath, outputDir = 'output') {
  const resolvedWorkspace = path.resolve(workspacePath);
  const outputRoot = path.join(resolvedWorkspace, outputDir);
  const reports = [];

  for (const filePath of walkFiles(outputRoot)) {
    const relative = normalizePathForJson(path.relative(resolvedWorkspace, filePath));
    const baseName = path.basename(filePath).toLowerCase();
    if (!/report/.test(baseName) || !/\.md$/i.test(baseName)) {
      continue;
    }
    const stats = fs.statSync(filePath);
    reports.push({
      path: relative,
      title: path.basename(filePath).replace(/\.md$/i, '').replace(/[_-]+/g, ' ').trim(),
      generatedAt: stats.mtime.toISOString(),
    });
  }

  return reports.sort((left, right) => left.path.localeCompare(right.path));
}

function buildWorkspaceIndex(workspacePath, workspaceEntry = {}) {
  const resolvedWorkspace = path.resolve(workspacePath);
  const outputDir = String(workspaceEntry.outputDir || 'output').trim() || 'output';
  const sourceDir = String(workspaceEntry.sourceDir || 'rpg_sources').trim() || 'rpg_sources';
  const runs = listAnalysisRuns(path.join(resolvedWorkspace, outputDir));

  return {
    schemaVersion: 1,
    id: String(workspaceEntry.id || '').trim() || path.basename(resolvedWorkspace).toLowerCase(),
    name: String(workspaceEntry.name || '').trim() || path.basename(resolvedWorkspace),
    system: String(workspaceEntry.system || '').trim() || '',
    library: String(workspaceEntry.library || '').trim() || '',
    generatedAt: new Date().toISOString(),
    programs: runs.map(run => ({
      name: run.program,
      outputDir: normalizePathForJson(path.join(outputDir, run.program)),
      analyzedAt: run.completedAt,
      workflowMode: run.workflowMode,
      artifactCount: run.artifactCount,
    })),
    sourceMembers: scanSourceDir(path.join(resolvedWorkspace, sourceDir)),
    reports: findReportFiles(resolvedWorkspace, outputDir),
  };
}

function readWorkspaceIndex(workspacePath) {
  const resolvedPath = path.join(path.resolve(workspacePath), WORKSPACE_INDEX_FILE);
  if (!fs.existsSync(resolvedPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
}

function writeWorkspaceIndex(workspacePath, workspaceEntry = {}) {
  const resolvedWorkspace = path.resolve(workspacePath);
  fs.mkdirSync(resolvedWorkspace, { recursive: true });
  const index = buildWorkspaceIndex(resolvedWorkspace, workspaceEntry);
  const targetPath = path.join(resolvedWorkspace, WORKSPACE_INDEX_FILE);
  writeJsonReport(targetPath, index);
  return {
    path: targetPath,
    index,
  };
}

module.exports = {
  WORKSPACE_INDEX_FILE,
  buildWorkspaceIndex,
  findReportFiles,
  readWorkspaceIndex,
  scanSourceDir,
  writeWorkspaceIndex,
};
