/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const GUI_CONTRACT_SCHEMA_VERSION = 1;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;

const WORKFLOW_STEP_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'scope',
    title: 'Confirm scope',
    description: 'Keep the active program and source scope explicit.',
  }),
  Object.freeze({
    id: 'analyze',
    title: 'Analyze',
    description: 'Use the recorded local analysis result as the starting point.',
  }),
  Object.freeze({
    id: 'evidence',
    title: 'Check evidence freshness',
    description: 'Compare recorded hashes with the files available now.',
  }),
  Object.freeze({
    id: 'review',
    title: 'Review evidence',
    description: 'Follow artifacts, graph relationships, prompts, and data views.',
  }),
]);

const GUI_ROLE_PROFILE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'developer',
    label: 'Developer',
    description: 'Understand source behavior, dependencies, and safe implementation impact.',
    assistantRole: 'Senior legacy application developer',
    defaultUseCaseId: 'impact-change-analysis',
    preferredWorkflowPresets: ['refactoring-review', 'dependency-risk'],
    preferredModules: [
      'system-role',
      'toolset-context',
      'implementation-task',
      'quality-guardrails',
    ],
    outputStyle: 'Concrete findings, affected sources, and implementation-ready next steps.',
    safetyLevel: 'S1',
    promptGuidance:
      'Always name the exact system, library, source file, and member before proposing a change.',
  }),
  Object.freeze({
    id: 'architect',
    label: 'Architect',
    description:
      'Turn discovered relationships into a reviewable system map and modernization path.',
    assistantRole: 'Legacy modernization architect',
    defaultUseCaseId: 'modernization-roadmap',
    preferredWorkflowPresets: ['architecture-review', 'modernization-review'],
    preferredModules: ['system-role', 'toolset-context', 'implementation-task', 'output-contract'],
    outputStyle: 'Explicit boundaries, dependencies, decisions, trade-offs, and migration slices.',
    safetyLevel: 'S0',
    promptGuidance:
      'Separate observed evidence from architectural inference and mark unknowns clearly.',
  }),
  Object.freeze({
    id: 'tester',
    label: 'Tester',
    description:
      'Validate assumptions with reproducible checks, journal evidence, and test design.',
    assistantRole: 'Legacy application test engineer',
    defaultUseCaseId: 'test-case-generation',
    preferredWorkflowPresets: ['test-generation-review', 'dependency-risk'],
    preferredModules: [
      'system-role',
      'toolset-context',
      'implementation-task',
      'quality-guardrails',
    ],
    outputStyle: 'Traceable test cases, expected results, evidence gaps, and regression risks.',
    safetyLevel: 'S1',
    promptGuidance:
      'Prefer read-only checks and distinguish observed journal rows from generated test data.',
  }),
  Object.freeze({
    id: 'product-owner',
    label: 'Product Owner',
    description: 'Translate technical evidence into impact, risk, and outcome-oriented decisions.',
    assistantRole: 'Product owner for legacy application change',
    defaultUseCaseId: 'onboarding-knowledge-transfer',
    preferredWorkflowPresets: ['onboarding', 'architecture-review'],
    preferredModules: ['system-role', 'toolset-context', 'implementation-task', 'output-contract'],
    outputStyle:
      'Plain-language impact, decisions needed, confidence, and actionable acceptance criteria.',
    safetyLevel: 'S0',
    promptGuidance:
      'Summarize first, link every important claim to an evidence item, and call out missing context.',
  }),
]);

function normalizeStatus(value) {
  const status = String(value || '')
    .trim()
    .toLowerCase();
  if (/fail|error/.test(status)) return 'failed';
  if (/run|progress|pending/.test(status)) return 'running';
  if (/success|complete|succeed|done/.test(status)) return 'completed';
  return status || 'unknown';
}

function statusLabel(status) {
  return (
    { completed: 'Completed', running: 'In progress', failed: 'Failed', unknown: 'Unknown' }[
      status
    ] || status
  );
}

function buildWorkflowRunCard({
  summary = {},
  analyzeManifest = null,
  workflowManifest = null,
  evidence = null,
} = {}) {
  const runStatus = normalizeStatus(
    summary.status || (analyzeManifest && analyzeManifest.run && analyzeManifest.run.status)
  );
  const evidenceStatus = evidence && evidence.overallStatus ? evidence.overallStatus : 'empty';
  const hasScope = Boolean(summary.program || summary.sourceRoot);
  const hasEvidence = Boolean(evidence && evidence.summary && evidence.summary.total > 0);
  const steps = WORKFLOW_STEP_DEFINITIONS.map(step => {
    let stepStatus = 'pending';
    if (step.id === 'scope') stepStatus = hasScope ? 'completed' : 'pending';
    if (step.id === 'analyze')
      stepStatus =
        runStatus === 'completed'
          ? 'completed'
          : runStatus === 'running'
            ? 'running'
            : runStatus === 'failed'
              ? 'failed'
              : 'pending';
    if (step.id === 'evidence')
      stepStatus =
        evidenceStatus === 'fresh'
          ? 'completed'
          : evidenceStatus === 'changed' || evidenceStatus === 'missing'
            ? 'review'
            : hasEvidence
              ? 'review'
              : 'pending';
    if (step.id === 'review')
      stepStatus =
        hasEvidence && evidenceStatus !== 'changed' && evidenceStatus !== 'missing'
          ? 'completed'
          : 'pending';
    return { ...step, status: stepStatus };
  });

  let nextBestAction = {
    id: 'orient',
    label: 'Open Setup',
    target: 'configure',
    safety: 'S0',
    reason: 'Confirm the local scope before relying on this run.',
  };
  if (runStatus === 'running')
    nextBestAction = {
      id: 'refresh',
      label: 'Refresh run status',
      target: 'refresh',
      safety: 'S1',
      reason: 'The recorded analysis is still in progress.',
    };
  else if (runStatus === 'failed')
    nextBestAction = {
      id: 'inspect-failure',
      label: 'Inspect run artifacts',
      target: 'artifacts',
      safety: 'S0',
      reason: 'Review the saved diagnostics before retrying.',
    };
  else if (evidenceStatus === 'changed' || evidenceStatus === 'missing')
    nextBestAction = {
      id: 'refresh-evidence',
      label: 'Review changed evidence',
      target: 'evidence',
      safety: 'S0',
      reason: 'The current files no longer fully match the recorded evidence.',
    };
  else if (hasEvidence)
    nextBestAction = {
      id: 'review-evidence',
      label: 'Review evidence',
      target: 'evidence',
      safety: 'S0',
      reason: 'The run is ready for an evidence-first review.',
    };

  const preset =
    workflowManifest && workflowManifest.preset && typeof workflowManifest.preset === 'object'
      ? workflowManifest.preset
      : null;
  const reviewWorkflow =
    preset && preset.reviewWorkflow && typeof preset.reviewWorkflow === 'object'
      ? preset.reviewWorkflow
      : null;
  return {
    schemaVersion: GUI_CONTRACT_SCHEMA_VERSION,
    program: summary.program || null,
    status: runStatus,
    statusLabel: statusLabel(runStatus),
    completedAt: summary.completedAt || null,
    scope: {
      program: summary.program || null,
      sourceRoot: summary.sourceRoot || null,
      artifactCount: Number(summary.artifactCount) || 0,
      safeSharingEnabled: Boolean(summary.safeSharingEnabled),
    },
    preset: preset
      ? {
          name: preset.name || summary.workflowPreset || null,
          title: preset.title || preset.name || null,
          description: preset.description || null,
        }
      : summary.workflowPreset
        ? { name: summary.workflowPreset, title: summary.workflowPreset, description: null }
        : null,
    steps,
    reviewWorkflow,
    evidenceStatus,
    nextBestAction,
    repeatable: Boolean(workflowManifest || summary.workflowRunAvailable),
  };
}

function sha256File(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch (error) {
    return null;
  }
}

function compareFile(filePath, recorded) {
  if (!fs.existsSync(filePath)) return 'missing';
  if (!HASH_PATTERN.test(String(recorded || ''))) return 'unverified';
  return sha256File(filePath) === String(recorded).toLowerCase() ? 'fresh' : 'changed';
}

function safeRelative(value) {
  return String(value || '')
    .split(path.sep)
    .join('/')
    .replace(/^\/+/, '');
}

function buildEvidenceExplorer({
  program,
  programOutputDir,
  analyzeManifest = null,
  artifacts = [],
} = {}) {
  const entries = [];
  const manifestArtifacts =
    analyzeManifest && Array.isArray(analyzeManifest.artifacts) ? analyzeManifest.artifacts : [];
  const artifactByPath = new Map(
    manifestArtifacts.map(artifact => [safeRelative(artifact.path), artifact])
  );
  for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
    const relativePath = safeRelative(artifact.path);
    const recorded = artifactByPath.get(relativePath);
    const absolutePath = path.resolve(programOutputDir || '', relativePath);
    entries.push({
      path: relativePath,
      kind: artifact.kind || 'unknown',
      evidenceType: 'artifact',
      present: fs.existsSync(absolutePath),
      sizeBytes: Number(artifact.sizeBytes) || 0,
      recordedSizeBytes: recorded ? Number(recorded.sizeBytes) || 0 : null,
      hashStatus: compareFile(absolutePath, recorded && recorded.sha256),
      recordedAt:
        analyzeManifest && analyzeManifest.run
          ? analyzeManifest.run.completedAt || analyzeManifest.run.startedAt || null
          : null,
    });
  }

  const snapshot =
    analyzeManifest && analyzeManifest.inputs && analyzeManifest.inputs.sourceSnapshot;
  const sourceRoot = snapshot && snapshot.root ? snapshot.root : null;
  for (const source of snapshot && Array.isArray(snapshot.files) ? snapshot.files : []) {
    const relativePath = safeRelative(source.path);
    const absolutePath = sourceRoot ? path.resolve(sourceRoot, relativePath) : '';
    entries.push({
      path: relativePath,
      kind: 'source',
      evidenceType: 'source',
      present: Boolean(absolutePath && fs.existsSync(absolutePath)),
      sizeBytes: Number(source.sizeBytes) || 0,
      recordedSizeBytes: Number(source.sizeBytes) || 0,
      hashStatus: absolutePath ? compareFile(absolutePath, source.sha256) : 'unverified',
      recordedAt:
        analyzeManifest && analyzeManifest.run
          ? analyzeManifest.run.completedAt || analyzeManifest.run.startedAt || null
          : null,
    });
  }

  const counts = entries.reduce((result, entry) => {
    result[entry.hashStatus] = (result[entry.hashStatus] || 0) + 1;
    return result;
  }, {});
  const overallStatus =
    entries.length === 0
      ? 'empty'
      : counts.changed || counts.missing
        ? 'changed'
        : counts.fresh
          ? 'fresh'
          : 'unverified';
  const label =
    {
      fresh: 'Fresh',
      changed: 'Changed since analysis',
      missing: 'Missing',
      unverified: 'Unverified',
      empty: 'No evidence recorded',
    }[overallStatus] || 'Unknown';
  const completedAt =
    analyzeManifest && analyzeManifest.run ? analyzeManifest.run.completedAt || null : null;
  return {
    schemaVersion: GUI_CONTRACT_SCHEMA_VERSION,
    program: program || null,
    overallStatus,
    overallLabel: label,
    summary: {
      total: entries.length,
      fresh: counts.fresh || 0,
      changed: counts.changed || 0,
      missing: counts.missing || 0,
      unverified: counts.unverified || 0,
      sourceCount: entries.filter(entry => entry.evidenceType === 'source').length,
      artifactCount: entries.filter(entry => entry.evidenceType === 'artifact').length,
    },
    entries: entries.sort((left, right) => left.path.localeCompare(right.path)),
    timeline: [
      {
        id: 'analysis',
        label: 'Analysis completed',
        at: completedAt,
        detail: completedAt
          ? 'Recorded in analyze-run-manifest.json.'
          : 'No completion time recorded.',
      },
      {
        id: 'source-snapshot',
        label: 'Source snapshot recorded',
        at: null,
        detail: `${snapshot && snapshot.fileCount ? snapshot.fileCount : 0} source file(s).`,
      },
      {
        id: 'artifact-output',
        label: 'Artifacts available',
        at: completedAt,
        detail: `${entries.filter(entry => entry.evidenceType === 'artifact').length} artifact(s).`,
      },
    ],
    whyKnown: [
      { source: 'analyze-run-manifest.json', role: 'run provenance and recorded hashes' },
      { source: 'local run output', role: 'current artifact files checked read-only' },
      { source: 'recorded source snapshot', role: 'current source files compared when available' },
    ],
    refreshGuidance:
      overallStatus === 'fresh'
        ? 'The available files match the recorded hashes.'
        : 'Re-fetch or re-run analysis before relying on changed, missing, or unverified evidence.',
  };
}

function buildRoleProfileMetadata() {
  return {
    schemaVersion: GUI_CONTRACT_SCHEMA_VERSION,
    localOnly: true,
    storage: 'local-only-template-store',
    secretHandling:
      'Role profiles contain prompt guidance only; credentials and key material are never included.',
    profiles: GUI_ROLE_PROFILE_DEFINITIONS,
  };
}

function resolveRoleProfile(roleId) {
  const normalized = String(roleId || '')
    .trim()
    .toLowerCase();
  return GUI_ROLE_PROFILE_DEFINITIONS.find(profile => profile.id === normalized) || null;
}

module.exports = {
  GUI_CONTRACT_SCHEMA_VERSION,
  GUI_ROLE_PROFILE_DEFINITIONS,
  WORKFLOW_STEP_DEFINITIONS,
  buildEvidenceExplorer,
  buildRoleProfileMetadata,
  buildWorkflowRunCard,
  normalizeStatus,
  resolveRoleProfile,
};
