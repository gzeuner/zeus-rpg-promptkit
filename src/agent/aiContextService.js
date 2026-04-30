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
const { sanitizeValue, maskSecretsInText } = require('../security/secretMasking');

const SAFETY_RULES = [
  '# Zeus AI Safety Rules',
  '',
  '- No production writes.',
  '- No credential handling in prompts, output, or logs.',
  '- No deployment actions.',
  '- Read-only DB activity only.',
  '- Only use safe local paths inside the current workspace.',
  '- Require explicit user confirmation for risky operations.',
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readTextIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return '';
  }
  return fs.readFileSync(filePath, 'utf8');
}

function sanitizePathLike(workspaceRoot, inputPath) {
  const resolved = path.resolve(workspaceRoot, inputPath);
  const workspacePrefix = `${path.resolve(workspaceRoot)}${path.sep}`;
  if (resolved === path.resolve(workspaceRoot) || resolved.startsWith(workspacePrefix)) {
    return path.relative(workspaceRoot, resolved).split(path.sep).join('/');
  }
  return '';
}

function listDbMetadataFiles(runRoot) {
  const dbRoot = path.join(runRoot, 'db');
  if (!fs.existsSync(dbRoot) || !fs.statSync(dbRoot).isDirectory()) {
    return [];
  }
  return fs.readdirSync(dbRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map((entry) => path.join(dbRoot, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function resolveLatestWorkflowRunRoot({ workspaceRoot, outputRoot }) {
  const runsRoot = path.resolve(workspaceRoot, outputRoot, 'runs');
  if (!fs.existsSync(runsRoot)) {
    return null;
  }

  const candidates = fs.readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const runRoot = path.join(runsRoot, entry.name);
      const workflowContextPath = path.join(runRoot, 'context.json');
      const reportPath = path.join(runRoot, 'report.md');
      const hasWorkflowArtifacts = fs.existsSync(workflowContextPath) || fs.existsSync(reportPath);
      const modifiedAt = fs.statSync(runRoot).mtimeMs;
      return {
        runRoot,
        hasWorkflowArtifacts,
        modifiedAt,
      };
    })
    .filter((entry) => entry.hasWorkflowArtifacts)
    .sort((left, right) => right.modifiedAt - left.modifiedAt);

  return candidates.length > 0 ? candidates[0].runRoot : null;
}

function buildAiPrompt({
  activeProfile,
  taskContext,
  selectedPaths,
  runContext,
  dbMetadataSummary,
}) {
  const profileName = String(activeProfile || '').trim() || 'unknown';
  const selectionLines = selectedPaths.length > 0
    ? selectedPaths.map((entry) => `- ${entry}`).join('\n')
    : '- none';
  const runSummary = runContext && runContext.status
    ? `status=${runContext.status}, runId=${runContext.runId || 'n/a'}`
    : 'no workflow context available';
  const dbSummary = dbMetadataSummary.length > 0
    ? dbMetadataSummary.map((entry) => `- ${entry.file}: ${entry.rowCount} row(s)`).join('\n')
    : '- none';

  return [
    '# Zeus AI Agent Prompt',
    '',
    '## Profile',
    `- Active profile: ${profileName}`,
    '',
    '## Task Context',
    taskContext ? taskContext.trim() : '- no ticket/task context provided',
    '',
    '## Selected Relevant Files',
    selectionLines,
    '',
    '## Analysis Results',
    `- Workflow summary: ${runSummary}`,
    '',
    '## DB Metadata',
    dbSummary,
    '',
    '## Constraints',
    '- no production writes',
    '- no credentials',
    '- no deployments',
    '',
    '## Suggested Next Steps',
    '1. Review report.md and context.json for current findings.',
    '2. Propose a small, reversible implementation plan.',
    '3. Apply changes with tests and explicit risk notes.',
  ].join('\n');
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function generateAiContextBundle({
  workspaceRoot,
  outputRoot = 'analysis',
  runRoot,
  activeProfile = '',
  taskContext = '',
  selectedPaths = [],
  timestamp = new Date(),
}) {
  if (!workspaceRoot || !String(workspaceRoot).trim()) {
    throw new Error('workspaceRoot is required');
  }

  const safeWorkspaceRoot = path.resolve(workspaceRoot);
  const safeOutputRoot = path.resolve(safeWorkspaceRoot, outputRoot);
  const effectiveRunRoot = runRoot
    ? path.resolve(runRoot)
    : resolveLatestWorkflowRunRoot({ workspaceRoot: safeWorkspaceRoot, outputRoot });

  const runTimestamp = timestamp instanceof Date ? timestamp.toISOString().replace(/[:.]/g, '-') : String(timestamp);
  const targetRoot = effectiveRunRoot
    ? path.join(effectiveRunRoot, 'ai-context')
    : path.join(safeOutputRoot, 'runs', runTimestamp, 'ai-context');
  ensureDir(targetRoot);

  const safeSelection = selectedPaths
    .map((entry) => sanitizePathLike(safeWorkspaceRoot, entry))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
  const runContext = effectiveRunRoot ? readJsonIfExists(path.join(effectiveRunRoot, 'context.json')) : null;
  const reportContent = effectiveRunRoot ? readTextIfExists(path.join(effectiveRunRoot, 'report.md')) : '';
  const dbFiles = effectiveRunRoot ? listDbMetadataFiles(effectiveRunRoot) : [];
  const dbMetadataEntries = dbFiles.map((filePath) => {
    const content = readJsonIfExists(filePath);
    const rowCount = Array.isArray(content && content.columns) ? content.columns.length : 0;
    return {
      file: path.basename(filePath),
      rowCount,
      content,
    };
  });

  const aiPrompt = buildAiPrompt({
    activeProfile,
    taskContext,
    selectedPaths: safeSelection,
    runContext,
    dbMetadataSummary: dbMetadataEntries,
  });

  const contextPayload = sanitizeValue({
    generatedAt: new Date().toISOString(),
    activeProfile,
    workspaceRoot: safeWorkspaceRoot,
    outputRoot: safeOutputRoot,
    runRoot: effectiveRunRoot || null,
    selectedPaths: safeSelection,
    runContext: runContext || null,
  });

  fs.writeFileSync(path.join(targetRoot, 'ai_prompt.md'), maskSecretsInText(aiPrompt), 'utf8');
  writeJson(path.join(targetRoot, 'context.json'), contextPayload);
  fs.writeFileSync(path.join(targetRoot, 'report.md'), maskSecretsInText(reportContent || '# No report found\n'), 'utf8');
  fs.writeFileSync(
    path.join(targetRoot, 'relevant_sources.txt'),
    `${safeSelection.length > 0 ? safeSelection.join('\n') : '# no files selected'}\n`,
    'utf8',
  );
  fs.writeFileSync(path.join(targetRoot, 'safety_rules.md'), `${SAFETY_RULES.join('\n')}\n`, 'utf8');

  if (dbMetadataEntries.length > 0) {
    writeJson(path.join(targetRoot, 'db_metadata.json'), sanitizeValue({
      sourceRunRoot: effectiveRunRoot,
      files: dbMetadataEntries.map((entry) => ({
        file: entry.file,
        rowCount: entry.rowCount,
        content: entry.content,
      })),
    }));
  }

  return {
    outputDir: targetRoot,
    runRoot: effectiveRunRoot || null,
    files: {
      aiPrompt: path.join(targetRoot, 'ai_prompt.md'),
      context: path.join(targetRoot, 'context.json'),
      report: path.join(targetRoot, 'report.md'),
      relevantSources: path.join(targetRoot, 'relevant_sources.txt'),
      dbMetadata: dbMetadataEntries.length > 0 ? path.join(targetRoot, 'db_metadata.json') : null,
      safetyRules: path.join(targetRoot, 'safety_rules.md'),
    },
  };
}

module.exports = {
  SAFETY_RULES,
  generateAiContextBundle,
  resolveLatestWorkflowRunRoot,
};

