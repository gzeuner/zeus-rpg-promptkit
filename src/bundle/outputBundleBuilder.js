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
const AdmZip = require('adm-zip');
const {
  ANALYZE_RUN_MANIFEST_FILE,
  readAnalyzeRunManifest,
} = require('../analyze/analyzeRunManifest');
const { cloneReviewWorkflow } = require('../workflow/reviewWorkflowMetadata');
const {
  SAFE_SHARING_DIR,
  REDACTION_MANIFEST_FILE,
  buildSafeArtifactPath,
} = require('../sharing/safeSharingArtifactBuilder');

const MANIFEST_FILE = 'bundle-manifest.json';
const ZIP_MANIFEST_FILE = 'manifest.json';
const README_FILE = 'README.txt';
const BUNDLE_MANIFEST_SCHEMA_VERSION = 1;

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function normalizeProgramName(program) {
  return String(program || '').trim();
}

function resolveIncludeTypes(options) {
  const includeJson = Boolean(options.includeJson);
  const includeMd = Boolean(options.includeMd);
  const includeHtml = Boolean(options.includeHtml);

  if (!includeJson && !includeMd && !includeHtml) {
    return new Set(['.json', '.md', '.html']);
  }

  const selected = new Set();
  if (includeJson) selected.add('.json');
  if (includeMd) selected.add('.md');
  if (includeHtml) selected.add('.html');
  return selected;
}

function inferBundleArtifactKind(fileName) {
  const ext = path.extname(String(fileName || '').toLowerCase());
  if (ext === '.json') return 'json';
  if (ext === '.md') return 'markdown';
  if (ext === '.mmd') return 'mermaid';
  if (ext === '.html') return 'html';
  return ext ? ext.slice(1) : 'unknown';
}

function shouldIncludeFile(fileName, includeTypes) {
  const ext = path.extname(fileName).toLowerCase();
  if (!includeTypes.has(ext)) {
    return false;
  }
  if (fileName === MANIFEST_FILE) {
    return false;
  }
  return true;
}

function mapBundleFiles(programOutputDir, fileNames, includeTypes) {
  return fileNames
    .filter((fileName) => shouldIncludeFile(fileName, includeTypes))
    .sort((a, b) => a.localeCompare(b))
    .map((fileName) => ({
      name: fileName,
      path: path.join(programOutputDir, fileName),
      ext: path.extname(fileName).toLowerCase(),
    }));
}

function collectExplicitBundleFiles(programOutputDir, includeTypes, artifactPaths) {
  return mapBundleFiles(
    programOutputDir,
    Array.from(new Set((Array.isArray(artifactPaths) ? artifactPaths : [])
      .map((entry) => String(entry || '').trim())
      .filter(Boolean))),
    includeTypes,
  ).filter((file) => fs.existsSync(file.path));
}

function collectLegacyBundleFiles(programOutputDir, includeTypes) {
  return mapBundleFiles(
    programOutputDir,
    fs.readdirSync(programOutputDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name),
    includeTypes,
  );
}

function collectSafeSharingBundleFiles(programOutputDir, includeTypes) {
  const safeSharingDir = path.join(programOutputDir, SAFE_SHARING_DIR);
  if (!fs.existsSync(safeSharingDir)) {
    throw new Error(`Safe-sharing artifacts not found: ${safeSharingDir}. Run analyze --safe-sharing first.`);
  }

  return mapBundleFiles(
    programOutputDir,
    fs.readdirSync(safeSharingDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.posix.join(SAFE_SHARING_DIR, entry.name)),
    includeTypes,
  );
}

function collectManifestBundleFiles(programOutputDir, includeTypes, analyzeManifest) {
  if (!analyzeManifest || !Array.isArray(analyzeManifest.artifacts)) {
    return collectLegacyBundleFiles(programOutputDir, includeTypes);
  }

  const fileNames = Array.from(new Set([
    ...analyzeManifest.artifacts.map((artifact) => artifact.path),
    ANALYZE_RUN_MANIFEST_FILE,
  ]));

  return mapBundleFiles(programOutputDir, fileNames, includeTypes)
    .filter((file) => fs.existsSync(file.path));
}

function buildSummary(files) {
  const summary = {
    jsonFiles: 0,
    markdownFiles: 0,
    htmlFiles: 0,
    totalFiles: files.length,
  };

  for (const file of files) {
    if (file.ext === '.json') summary.jsonFiles += 1;
    if (file.ext === '.md') summary.markdownFiles += 1;
    if (file.ext === '.html') summary.htmlFiles += 1;
  }

  return summary;
}

function buildArtifactMetadata(files, analyzeManifest) {
  const analyzeArtifacts = new Map(
    (analyzeManifest && Array.isArray(analyzeManifest.artifacts) ? analyzeManifest.artifacts : [])
      .map((artifact) => [artifact.path, artifact]),
  );

  return files.map((file) => {
    const baseArtifact = analyzeArtifacts.get(file.name);
    return {
      path: file.name,
      kind: baseArtifact && baseArtifact.kind ? baseArtifact.kind : inferBundleArtifactKind(file.name),
      sizeBytes: baseArtifact && Number.isFinite(Number(baseArtifact.sizeBytes))
        ? Number(baseArtifact.sizeBytes)
        : fs.statSync(file.path).size,
      sha256: baseArtifact && typeof baseArtifact.sha256 === 'string' && baseArtifact.sha256
        ? baseArtifact.sha256
        : hashContent(fs.readFileSync(file.path)),
      source: baseArtifact ? 'analyze-manifest' : 'bundle-scan',
    };
  });
}

function buildManifest(program, files, analyzeManifest, workflowPreset, safeSharingEnabled) {
  const artifacts = buildArtifactMetadata(files, analyzeManifest);
  const manifest = {
    schemaVersion: BUNDLE_MANIFEST_SCHEMA_VERSION,
    tool: {
      name: 'zeus-rpg-promptkit',
      command: 'bundle',
    },
    program: normalizeProgramName(program).toUpperCase(),
    generatedAt: new Date().toISOString(),
    files: files.map((file) => file.name),
    artifacts,
    summary: {
      ...buildSummary(files),
      totalSizeBytes: artifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0),
    },
    safeSharing: {
      enabled: Boolean(safeSharingEnabled),
      sourceDir: safeSharingEnabled ? SAFE_SHARING_DIR : null,
      redactionManifestFile: safeSharingEnabled ? path.posix.join(SAFE_SHARING_DIR, REDACTION_MANIFEST_FILE) : null,
    },
  };

  if (analyzeManifest) {
    manifest.analyzeRun = {
      schemaVersion: analyzeManifest.schemaVersion || null,
      manifestFile: ANALYZE_RUN_MANIFEST_FILE,
      status: analyzeManifest.run && analyzeManifest.run.status ? analyzeManifest.run.status : null,
      completedAt: analyzeManifest.run && analyzeManifest.run.completedAt ? analyzeManifest.run.completedAt : null,
      sourceFingerprint: analyzeManifest.inputs
        && analyzeManifest.inputs.sourceSnapshot
        && analyzeManifest.inputs.sourceSnapshot.fingerprint
        ? analyzeManifest.inputs.sourceSnapshot.fingerprint
        : null,
      artifactCount: Array.isArray(analyzeManifest.artifacts) ? analyzeManifest.artifacts.length : 0,
    };
  }

  const effectiveWorkflowPreset = workflowPreset
    || (analyzeManifest
      && analyzeManifest.inputs
      && analyzeManifest.inputs.options
      && analyzeManifest.inputs.options.workflowPreset
      ? analyzeManifest.inputs.options.workflowPreset
      : null);
  if (effectiveWorkflowPreset) {
    manifest.workflowPreset = {
      name: effectiveWorkflowPreset.name || null,
      title: effectiveWorkflowPreset.title || null,
      description: effectiveWorkflowPreset.description || null,
      analyzeMode: effectiveWorkflowPreset.analyzeMode || null,
      promptTemplates: Array.isArray(effectiveWorkflowPreset.promptTemplates)
        ? effectiveWorkflowPreset.promptTemplates
        : [],
      workflowKeys: Array.isArray(effectiveWorkflowPreset.workflowKeys)
        ? effectiveWorkflowPreset.workflowKeys
        : [],
      bundleArtifacts: Array.isArray(effectiveWorkflowPreset.bundleArtifacts)
        ? effectiveWorkflowPreset.bundleArtifacts
        : [],
      reviewWorkflow: cloneReviewWorkflow(effectiveWorkflowPreset.reviewWorkflow),
    };
  }

  return manifest;
}

function buildReadmeText(program, manifest) {
  const lines = [
    `Program: ${normalizeProgramName(program).toUpperCase()}`,
    'Created by: zeus-rpg-promptkit',
    'Contents: reports, prompts, graphs, metadata',
    `Files: ${manifest.summary.totalFiles}`,
  ];
  if (manifest.workflowPreset && manifest.workflowPreset.name) {
    lines.push(`Workflow preset: ${manifest.workflowPreset.name}`);
  }
  if (manifest.safeSharing && manifest.safeSharing.enabled) {
    lines.push('Safe sharing: enabled');
    lines.push(`Redaction manifest: ${manifest.safeSharing.redactionManifestFile}`);
  }
  if (manifest.workflowPreset && manifest.workflowPreset.reviewWorkflow) {
    const reviewWorkflow = manifest.workflowPreset.reviewWorkflow;
    if (reviewWorkflow.intendedAudience.length > 0) {
      lines.push(`Intended audience: ${reviewWorkflow.intendedAudience.join('; ')}`);
    }
    if (reviewWorkflow.keyQuestionsAnswered.length > 0) {
      lines.push('Key questions answered:');
      for (const question of reviewWorkflow.keyQuestionsAnswered) {
        lines.push(`- ${question}`);
      }
    }
    if (reviewWorkflow.expectedDecisions.length > 0) {
      lines.push('Expected decisions:');
      for (const decision of reviewWorkflow.expectedDecisions) {
        lines.push(`- ${decision}`);
      }
    }
    if (reviewWorkflow.interpretationGuidance.length > 0) {
      lines.push('Interpretation guidance:');
      for (const guidance of reviewWorkflow.interpretationGuidance) {
        lines.push(`- ${guidance}`);
      }
    }
    if (reviewWorkflow.recommendedOutputs.length > 0) {
      lines.push('Recommended outputs:');
      for (const output of reviewWorkflow.recommendedOutputs) {
        lines.push(`- ${output.path}: ${output.purpose}`);
      }
    }
  }
  return lines.join('\n');
}

function addZipEntry(zip, entryName, content) {
  zip.addFile(entryName, Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8'));
  const entry = zip.getEntry(entryName);
  if (entry) {
    entry.header.time = new Date(0);
  }
}

function buildOutputBundle({
  program,
  sourceOutputRoot = 'output',
  bundleOutputRoot = 'bundles',
  includeJson = false,
  includeMd = false,
  includeHtml = false,
  safeSharingEnabled = false,
  artifactPaths = null,
  workflowPreset = null,
  bundleFileName = null,
}) {
  const resolvedProgram = normalizeProgramName(program);
  if (!resolvedProgram) {
    throw new Error('Bundle creation requires --program <name>');
  }

  const resolvedSourceRoot = path.resolve(process.cwd(), sourceOutputRoot);
  const resolvedBundleRoot = path.resolve(process.cwd(), bundleOutputRoot);
  const programOutputDir = path.join(resolvedSourceRoot, resolvedProgram);

  if (!fs.existsSync(programOutputDir)) {
    throw new Error(`Program output directory not found: ${programOutputDir}. Run analyze first.`);
  }

  const includeTypes = resolveIncludeTypes({ includeJson, includeMd, includeHtml });
  const analyzeManifest = readAnalyzeRunManifest(programOutputDir);
  const selectedArtifactPaths = safeSharingEnabled && Array.isArray(artifactPaths) && artifactPaths.length > 0
    ? artifactPaths.map((artifactPath) => buildSafeArtifactPath(artifactPath))
    : artifactPaths;
  const files = Array.isArray(selectedArtifactPaths) && selectedArtifactPaths.length > 0
    ? collectExplicitBundleFiles(programOutputDir, includeTypes, selectedArtifactPaths)
    : safeSharingEnabled
      ? collectSafeSharingBundleFiles(programOutputDir, includeTypes)
      : collectManifestBundleFiles(programOutputDir, includeTypes, analyzeManifest);
  const manifest = buildManifest(resolvedProgram, files, analyzeManifest, workflowPreset, safeSharingEnabled);
  const zip = new AdmZip();

  for (const file of files) {
    addZipEntry(zip, file.name, fs.readFileSync(file.path));
  }

  addZipEntry(zip, ZIP_MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  addZipEntry(zip, README_FILE, `${buildReadmeText(resolvedProgram, manifest)}\n`);

  fs.mkdirSync(resolvedBundleRoot, { recursive: true });
  fs.writeFileSync(path.join(programOutputDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const zipPath = path.join(
    resolvedBundleRoot,
    bundleFileName && String(bundleFileName).trim()
      ? String(bundleFileName).trim()
      : `${resolvedProgram}${safeSharingEnabled ? '-safe-sharing' : '-analysis'}-bundle.zip`,
  );
  zip.writeZip(zipPath);

  return {
    program: manifest.program,
    sourceOutputRoot: resolvedSourceRoot,
    programOutputDir,
    bundleOutputRoot: resolvedBundleRoot,
    zipPath,
    manifest,
  };
}

module.exports = {
  buildOutputBundle,
  BUNDLE_MANIFEST_SCHEMA_VERSION,
};
