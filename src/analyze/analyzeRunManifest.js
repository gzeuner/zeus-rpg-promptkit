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
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { summarizeImportManifest } = require('../fetch/importManifest');
const {
  buildReproducibilityMetadata,
  buildReproduciblePathReplacements,
  hashNormalizedValue,
  normalizeReproducibilitySettings,
  replaceExactStringsDeep,
} = require('../reproducibility/reproducibility');

const ANALYZE_RUN_MANIFEST_FILE = 'analyze-run-manifest.json';
const MANIFEST_SCHEMA_VERSION = 1;

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function inferArtifactKind(fileName) {
  const lowerName = String(fileName || '').toLowerCase();
  const ext = path.extname(lowerName);

  if (ext === '.json') return 'json';
  if (ext === '.md') return 'markdown';
  if (ext === '.mmd') return 'mermaid';
  if (ext === '.html') return 'html';
  return ext ? ext.slice(1) : 'unknown';
}

function collectArtifactFileNames(outputProgramDir, generatedFiles) {
  if (Array.isArray(generatedFiles) && generatedFiles.length > 0) {
    return Array.from(new Set(
      generatedFiles
        .map((fileName) => String(fileName || '').trim())
        .filter((fileName) => fileName && fileName !== ANALYZE_RUN_MANIFEST_FILE),
    )).sort((a, b) => a.localeCompare(b));
  }

  if (!outputProgramDir || !fs.existsSync(outputProgramDir)) {
    return [];
  }

  return fs.readdirSync(outputProgramDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== ANALYZE_RUN_MANIFEST_FILE)
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function buildArtifacts(outputProgramDir, generatedFiles) {
  const artifactFileNames = collectArtifactFileNames(outputProgramDir, generatedFiles);

  return artifactFileNames.map((fileName) => {
    const absolutePath = path.join(outputProgramDir, fileName);
    const exists = fs.existsSync(absolutePath);
    const sizeBytes = exists ? fs.statSync(absolutePath).size : 0;
    const sha256 = exists ? hashContent(fs.readFileSync(absolutePath)) : null;

    return {
      path: fileName,
      kind: inferArtifactKind(fileName),
      exists,
      sizeBytes,
      sha256,
    };
  });
}

function buildSourceSnapshot(sourceRoot, sourceFiles, reproducibility) {
  const reproducibilitySettings = normalizeReproducibilitySettings(reproducibility);
  const normalizedRoot = sourceRoot ? path.resolve(sourceRoot) : '';
  const files = Array.isArray(sourceFiles) ? sourceFiles : [];
  const entries = files
    .filter(Boolean)
    .map((filePath) => {
      const absolutePath = path.resolve(filePath);
      const stats = fs.existsSync(absolutePath) ? fs.statSync(absolutePath) : null;
      const relativePath = normalizedRoot ? path.relative(normalizedRoot, absolutePath) : path.basename(absolutePath);
      const sha256 = stats ? hashContent(fs.readFileSync(absolutePath)) : null;
      return {
        path: relativePath.split(path.sep).join('/'),
        sizeBytes: stats ? stats.size : 0,
        mtimeMs: reproducibilitySettings.enabled ? null : (stats ? Math.trunc(stats.mtimeMs) : 0),
        sha256,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  const contentFingerprint = hashContent(entries
    .map((entry) => `${entry.path}|${entry.sizeBytes}|${entry.sha256 || ''}`)
    .join('\n'));
  const fingerprint = reproducibilitySettings.enabled
    ? contentFingerprint
    : hashContent(entries.map((entry) => `${entry.path}|${entry.sizeBytes}|${entry.mtimeMs}`).join('\n'));

  return {
    root: normalizedRoot,
    fileCount: entries.length,
    fingerprint,
    contentFingerprint,
    files: entries,
  };
}

function buildSummary(stageReports, diagnostics, artifacts, sourceSnapshot) {
  return {
    stageCount: stageReports.length,
    completedStageCount: stageReports.filter((stage) => stage.status === 'completed').length,
    failedStageCount: stageReports.filter((stage) => stage.status === 'failed').length,
    diagnosticCount: diagnostics.length,
    errorCount: diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length,
    warningCount: diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length,
    generatedArtifactCount: artifacts.length,
    sourceFileCount: sourceSnapshot.fileCount,
  };
}

function buildComparison(previousManifest, currentManifest, reproducibility) {
  const reproducibilitySettings = normalizeReproducibilitySettings(reproducibility);
  if (reproducibilitySettings.enabled) {
    return null;
  }

  if (!previousManifest || typeof previousManifest !== 'object') {
    return null;
  }

  const previousArtifacts = Array.isArray(previousManifest.artifacts) ? previousManifest.artifacts : [];
  const currentArtifacts = Array.isArray(currentManifest.artifacts) ? currentManifest.artifacts : [];
  const previousArtifactPaths = new Set(previousArtifacts.map((artifact) => artifact.path));
  const currentArtifactPaths = new Set(currentArtifacts.map((artifact) => artifact.path));
  const previousSourceFingerprint = previousManifest.inputs && previousManifest.inputs.sourceSnapshot
    ? previousManifest.inputs.sourceSnapshot.fingerprint
    : null;
  const currentSourceFingerprint = currentManifest.inputs.sourceSnapshot.fingerprint;

  return {
    previousRunStatus: previousManifest.run && previousManifest.run.status ? previousManifest.run.status : null,
    previousCompletedAt: previousManifest.run && previousManifest.run.completedAt ? previousManifest.run.completedAt : null,
    sourceFingerprintChanged: previousSourceFingerprint !== null && previousSourceFingerprint !== currentSourceFingerprint,
    addedArtifacts: currentArtifacts
      .map((artifact) => artifact.path)
      .filter((artifactPath) => !previousArtifactPaths.has(artifactPath)),
    removedArtifacts: previousArtifacts
      .map((artifact) => artifact.path)
      .filter((artifactPath) => !currentArtifactPaths.has(artifactPath)),
    stageCountDelta: currentManifest.summary.stageCount - Number(previousManifest.summary && previousManifest.summary.stageCount || 0),
    diagnosticCountDelta: currentManifest.summary.diagnosticCount - Number(previousManifest.summary && previousManifest.summary.diagnosticCount || 0),
    artifactCountDelta: currentManifest.summary.generatedArtifactCount - Number(previousManifest.summary && previousManifest.summary.generatedArtifactCount || 0),
  };
}

function buildAnalyzeRunManifest({
  status,
  context,
  result = null,
  error = null,
  previousManifest = null,
}) {
  const reproducibility = normalizeReproducibilitySettings(context.reproducibility);
  const stageReports = Array.isArray(result && result.stageReports)
    ? result.stageReports
    : Array.isArray(error && error.stageReports) ? error.stageReports : [];
  const diagnostics = stageReports.flatMap((stage) => stage.diagnostics || []);
  const sourceSnapshot = buildSourceSnapshot(
    context.sourceRoot,
    result && Array.isArray(result.sourceFiles) ? result.sourceFiles : [],
    reproducibility,
  );
  const importManifestSummary = summarizeImportManifest(
    result && result.importManifest ? result.importManifest : null,
    {
      manifestPath: result && result.importManifestPath ? result.importManifestPath : null,
    },
  );
  const artifacts = buildArtifacts(
    context.outputProgramDir,
    result && Array.isArray(result.generatedFiles) ? result.generatedFiles : null,
  );

  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    tool: {
      name: 'zeus-rpg-promptkit',
      command: 'analyze',
    },
    run: {
      status,
      startedAt: context.startedAt,
      completedAt: context.completedAt,
      durationMs: context.durationMs,
      cwd: context.cwd,
      outputDir: context.outputProgramDir,
      reproducible: reproducibility.enabled,
      ...(error ? {
        failure: {
          message: error.message,
          ...(error.stageId ? { stageId: error.stageId } : {}),
        },
      } : {}),
    },
    inputs: {
      program: String(context.program || '').trim().toUpperCase(),
      sourceRoot: context.sourceRoot,
      outputRoot: context.outputRoot,
      options: {
        optimizeContextEnabled: Boolean(context.optimizeContextEnabled),
        safeSharingEnabled: Boolean(context.safeSharingEnabled),
        skipTestData: Boolean(context.skipTestData),
        testDataLimit: Number(context.testDataLimit) || null,
        extensions: Array.isArray(context.extensions) ? context.extensions : [],
        reproducibleEnabled: reproducibility.enabled,
        guidedMode: context.guidedMode || null,
        workflowPreset: context.workflowPreset || null,
      },
      sourceSnapshot,
      importManifest: importManifestSummary,
    },
    summary: buildSummary(stageReports, diagnostics, artifacts, sourceSnapshot),
    diagnostics,
    stages: stageReports.map((stage) => ({
      id: stage.id,
      status: stage.status,
      startedAt: stage.startedAt,
      completedAt: stage.completedAt,
      durationMs: stage.durationMs,
      metadata: stage.metadata || {},
      diagnostics: stage.diagnostics || [],
    })),
    artifacts,
  };

  const pathReplacements = reproducibility.enabled
    ? buildReproduciblePathReplacements({
      cwd: context.cwd,
      sourceRoot: context.sourceRoot,
      outputRoot: context.outputRoot,
      outputProgramDir: context.outputProgramDir,
      program: context.program,
    })
    : null;
  const fingerprintSource = {
    tool: manifest.tool,
    status: manifest.run.status,
    inputs: manifest.inputs,
    summary: manifest.summary,
    diagnostics: manifest.diagnostics,
    stages: manifest.stages.map((stage) => ({
      id: stage.id,
      status: stage.status,
      metadata: stage.metadata,
      diagnostics: stage.diagnostics,
    })),
    artifacts: manifest.artifacts.map((artifact) => ({
      path: artifact.path,
      kind: artifact.kind,
      exists: artifact.exists,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
    })),
  };
  const contentFingerprint = hashNormalizedValue(
    reproducibility.enabled
      ? replaceExactStringsDeep(fingerprintSource, pathReplacements)
      : fingerprintSource,
  );
  manifest.reproducibility = buildReproducibilityMetadata(reproducibility, contentFingerprint, {
    runtimeMetadataSuppressed: reproducibility.enabled,
    comparisonSuppressed: reproducibility.enabled,
  });
  manifest.comparison = buildComparison(previousManifest, manifest, reproducibility);

  if (!reproducibility.enabled) {
    return manifest;
  }

  return replaceExactStringsDeep(
    manifest,
    pathReplacements,
  );
}

function readAnalyzeRunManifest(outputProgramDir) {
  const manifestPath = path.join(outputProgramDir, ANALYZE_RUN_MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function writeAnalyzeRunManifest(outputProgramDir, manifest) {
  const manifestPath = path.join(outputProgramDir, ANALYZE_RUN_MANIFEST_FILE);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifestPath;
}

module.exports = {
  ANALYZE_RUN_MANIFEST_FILE,
  MANIFEST_SCHEMA_VERSION,
  buildAnalyzeRunManifest,
  readAnalyzeRunManifest,
  writeAnalyzeRunManifest,
};
