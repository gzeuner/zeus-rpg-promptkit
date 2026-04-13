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

const { readAnalyzeRunManifest, ANALYZE_RUN_MANIFEST_FILE } = require('../analyze/analyzeRunManifest');
const { SAFE_SHARING_DIR } = require('../sharing/safeSharingArtifactBuilder');

const BUNDLE_MANIFEST_FILE = 'bundle-manifest.json';
const WORKFLOW_MANIFEST_FILE = 'workflow-run-manifest.json';

function inferArtifactKind(fileName) {
  const ext = path.extname(String(fileName || '').toLowerCase());
  if (ext === '.json') return 'json';
  if (ext === '.md') return 'markdown';
  if (ext === '.html') return 'html';
  if (ext === '.mmd') return 'mermaid';
  return ext ? ext.slice(1) : 'unknown';
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeRelativePath(relativePath) {
  return String(relativePath || '').split(path.sep).join('/');
}

function readArtifactEntries(programOutputDir) {
  const entries = [];

  for (const dirent of fs.readdirSync(programOutputDir, { withFileTypes: true })) {
    if (dirent.isFile()) {
      entries.push({
        path: dirent.name,
        absolutePath: path.join(programOutputDir, dirent.name),
      });
    }
  }

  const safeSharingDir = path.join(programOutputDir, SAFE_SHARING_DIR);
  if (fs.existsSync(safeSharingDir)) {
    for (const dirent of fs.readdirSync(safeSharingDir, { withFileTypes: true })) {
      if (!dirent.isFile()) continue;
      entries.push({
        path: `${SAFE_SHARING_DIR}/${dirent.name}`,
        absolutePath: path.join(safeSharingDir, dirent.name),
      });
    }
  }

  return entries
    .map((entry) => {
      const stats = fs.statSync(entry.absolutePath);
      return {
        path: normalizeRelativePath(entry.path),
        kind: inferArtifactKind(entry.path),
        sizeBytes: stats.size,
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function buildRunSummary(program, programOutputDir, analyzeManifest, bundleManifest, workflowManifest) {
  const run = analyzeManifest && analyzeManifest.run ? analyzeManifest.run : {};
  const options = analyzeManifest && analyzeManifest.inputs && analyzeManifest.inputs.options
    ? analyzeManifest.inputs.options
    : {};
  const artifacts = readArtifactEntries(programOutputDir);

  return {
    program,
    status: run.status || null,
    completedAt: run.completedAt || null,
    sourceRoot: analyzeManifest && analyzeManifest.inputs ? analyzeManifest.inputs.sourceRoot || null : null,
    workflowMode: options.guidedMode ? options.guidedMode.name || null : null,
    workflowPreset: options.workflowPreset ? options.workflowPreset.name || null : null,
    reproducible: Boolean(options.reproducibleEnabled),
    artifactCount: artifacts.length,
    safeSharingEnabled: artifacts.some((artifact) => artifact.path.startsWith(`${SAFE_SHARING_DIR}/`)),
    bundleAvailable: Boolean(bundleManifest),
    workflowRunAvailable: Boolean(workflowManifest),
  };
}

function listAnalysisRuns(outputRoot) {
  const resolvedRoot = path.resolve(outputRoot);
  if (!fs.existsSync(resolvedRoot)) {
    return [];
  }

  return fs.readdirSync(resolvedRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const programOutputDir = path.join(resolvedRoot, entry.name);
      const analyzeManifest = readAnalyzeRunManifest(programOutputDir);
      const bundleManifest = readJsonIfExists(path.join(programOutputDir, BUNDLE_MANIFEST_FILE));
      const workflowManifest = readJsonIfExists(path.join(programOutputDir, WORKFLOW_MANIFEST_FILE));
      if (!analyzeManifest && !bundleManifest && !workflowManifest) {
        return null;
      }

      return buildRunSummary(
        entry.name,
        programOutputDir,
        analyzeManifest,
        bundleManifest,
        workflowManifest,
      );
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftTime = left.completedAt ? Date.parse(left.completedAt) : 0;
      const rightTime = right.completedAt ? Date.parse(right.completedAt) : 0;
      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }
      return left.program.localeCompare(right.program);
    });
}

function resolveProgramOutputDir(outputRoot, program) {
  const normalizedProgram = String(program || '').trim();
  if (!normalizedProgram) {
    throw new Error('Program name is required');
  }

  const programOutputDir = path.join(path.resolve(outputRoot), normalizedProgram);
  if (!fs.existsSync(programOutputDir)) {
    throw new Error(`Analysis run not found: ${normalizedProgram}`);
  }
  return programOutputDir;
}

function readAnalysisRun(outputRoot, program) {
  const programOutputDir = resolveProgramOutputDir(outputRoot, program);
  const analyzeManifest = readAnalyzeRunManifest(programOutputDir);
  if (!analyzeManifest) {
    throw new Error(`Analyze manifest not found for run: ${program}`);
  }

  const bundleManifest = readJsonIfExists(path.join(programOutputDir, BUNDLE_MANIFEST_FILE));
  const workflowManifest = readJsonIfExists(path.join(programOutputDir, WORKFLOW_MANIFEST_FILE));
  const artifacts = readArtifactEntries(programOutputDir);

  return {
    summary: buildRunSummary(program, programOutputDir, analyzeManifest, bundleManifest, workflowManifest),
    analyzeManifest,
    bundleManifest,
    workflowManifest,
    artifacts,
  };
}

function resolveArtifactPath(programOutputDir, artifactPath) {
  const relativePath = normalizeRelativePath(artifactPath).replace(/^\/+/, '');
  if (!relativePath) {
    throw new Error('Artifact path is required');
  }

  const absolutePath = path.resolve(programOutputDir, relativePath);
  const rootWithSep = `${path.resolve(programOutputDir)}${path.sep}`;
  if (absolutePath !== path.resolve(programOutputDir) && !absolutePath.startsWith(rootWithSep)) {
    throw new Error(`Artifact path escapes run directory: ${relativePath}`);
  }
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`Artifact not found: ${relativePath}`);
  }

  return {
    relativePath,
    absolutePath,
    kind: inferArtifactKind(relativePath),
  };
}

function inferContentType(kind) {
  if (kind === 'json') return 'application/json; charset=utf-8';
  if (kind === 'html') return 'text/html; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

function readArtifactContent(outputRoot, program, artifactPath) {
  const programOutputDir = resolveProgramOutputDir(outputRoot, program);
  const resolved = resolveArtifactPath(programOutputDir, artifactPath);
  const content = fs.readFileSync(resolved.absolutePath, 'utf8');

  return {
    program: String(program || '').trim(),
    path: resolved.relativePath,
    kind: resolved.kind,
    contentType: inferContentType(resolved.kind),
    content,
  };
}

module.exports = {
  ANALYZE_RUN_MANIFEST_FILE,
  BUNDLE_MANIFEST_FILE,
  WORKFLOW_MANIFEST_FILE,
  inferArtifactKind,
  listAnalysisRuns,
  readAnalysisRun,
  readArtifactContent,
};
