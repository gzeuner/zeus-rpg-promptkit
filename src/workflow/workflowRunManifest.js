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

const WORKFLOW_RUN_MANIFEST_FILE = 'workflow-run-manifest.json';
const WORKFLOW_RUN_MANIFEST_SCHEMA_VERSION = 1;

function buildWorkflowRunManifest({ preset, analyzeManifest, bundleManifest, bundlePath }) {
  return {
    schemaVersion: WORKFLOW_RUN_MANIFEST_SCHEMA_VERSION,
    kind: 'workflow-run-manifest',
    generatedAt: new Date().toISOString(),
    program: analyzeManifest && analyzeManifest.inputs ? analyzeManifest.inputs.program : null,
    preset: preset ? {
      name: preset.name,
      title: preset.title,
      description: preset.description,
      analyzeMode: preset.analyzeMode,
      promptTemplates: [...(preset.promptTemplates || [])],
      workflowKeys: [...(preset.workflowKeys || [])],
      bundleArtifacts: [...(preset.bundleArtifacts || [])],
    } : null,
    analyzeRun: analyzeManifest ? {
      manifestFile: 'analyze-run-manifest.json',
      status: analyzeManifest.run ? analyzeManifest.run.status : null,
      completedAt: analyzeManifest.run ? analyzeManifest.run.completedAt : null,
      generatedArtifactCount: analyzeManifest.summary ? analyzeManifest.summary.generatedArtifactCount : 0,
      guidedMode: analyzeManifest.inputs && analyzeManifest.inputs.options
        ? analyzeManifest.inputs.options.guidedMode
        : null,
    } : null,
    bundle: bundleManifest ? {
      manifestFile: 'bundle-manifest.json',
      zipPath: bundlePath ? path.basename(bundlePath) : null,
      totalFiles: bundleManifest.summary ? bundleManifest.summary.totalFiles : 0,
      totalSizeBytes: bundleManifest.summary ? bundleManifest.summary.totalSizeBytes : 0,
    } : null,
  };
}

function writeWorkflowRunManifest(outputProgramDir, manifest) {
  const manifestPath = path.join(outputProgramDir, WORKFLOW_RUN_MANIFEST_FILE);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifestPath;
}

module.exports = {
  WORKFLOW_RUN_MANIFEST_FILE,
  WORKFLOW_RUN_MANIFEST_SCHEMA_VERSION,
  buildWorkflowRunManifest,
  writeWorkflowRunManifest,
};
