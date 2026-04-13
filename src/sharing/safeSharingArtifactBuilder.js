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
const { renderJson, renderMermaid, renderMarkdown, renderCrossProgramMarkdown } = require('../dependency/graphSerializer');
const { generateMarkdownReport } = require('../report/markdownReport');
const { renderArchitectureReport } = require('../report/architectureReport');
const { buildPrompts, resolvePromptTemplates } = require('../prompt/promptBuilder');
const { getPromptContract } = require('../prompt/promptRegistry');
const { renderHtml } = require('../viewer/architectureViewerGenerator');
const { renderDb2MetadataMarkdown } = require('../db2/metadataExportService');
const { renderTestDataMarkdown } = require('../db2/testDataExportService');
const { readAnalyzeRunManifest } = require('../analyze/analyzeRunManifest');
const {
  normalizeReproducibilitySettings,
  resolveTimestamp,
} = require('../reproducibility/reproducibility');

const SAFE_SHARING_DIR = 'safe-sharing';
const REDACTION_MANIFEST_FILE = 'redaction-manifest.json';
const REDACTION_MANIFEST_SCHEMA_VERSION = 1;

const CATEGORY_PREFIX = Object.freeze({
  PROGRAM: 'PROGRAM',
  TABLE: 'TABLE',
  COPY_MEMBER: 'COPY_MEMBER',
  NATIVE_FILE: 'NATIVE_FILE',
  PROCEDURE: 'PROCEDURE',
  PROTOTYPE: 'PROTOTYPE',
  MODULE: 'MODULE',
  SERVICE_PROGRAM: 'SERVICE_PROGRAM',
  BINDING_DIRECTORY: 'BINDING_DIRECTORY',
  RECORD_FORMAT: 'RECORD_FORMAT',
  SOURCE_FILE: 'SOURCE_FILE',
  SOURCE_LIBRARY: 'SOURCE_LIBRARY',
  SOURCE_FILE_SET: 'SOURCE_FILE_SET',
  MEMBER: 'MEMBER',
  SCHEMA: 'SCHEMA',
  VALUE: 'VALUE',
});

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readTextIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return '';
  }
  return fs.readFileSync(filePath, 'utf8');
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, value, 'utf8');
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function uniqueSortedStrings(values) {
  return Array.from(new Set(asArray(values).map((value) => String(value || '').trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

function normalizePathString(value) {
  return String(value || '').trim().replace(/\\/g, '/');
}

function collectSourceArtifactPaths(analyzeManifest) {
  const artifactPaths = Array.isArray(analyzeManifest && analyzeManifest.artifacts)
    ? analyzeManifest.artifacts.map((artifact) => artifact.path)
    : [];
  return uniqueSortedStrings([
    'analyze-run-manifest.json',
    ...artifactPaths,
  ]);
}

function buildSafeArtifactPath(artifactPath) {
  return `${SAFE_SHARING_DIR}/${String(artifactPath || '').replace(/\\/g, '/')}`;
}

function extractOptimizationReport(analyzeManifest) {
  const stage = asArray(analyzeManifest && analyzeManifest.stages)
    .find((entry) => entry.id === 'optimize-context');
  const metadata = stage && stage.metadata ? stage.metadata : {};
  const safeSharingEnabled = Boolean(analyzeManifest
    && analyzeManifest.inputs
    && analyzeManifest.inputs.options
    && analyzeManifest.inputs.options.safeSharingEnabled);
  return {
    enabled: Boolean(metadata.enabled),
    contextTokens: Number(metadata.contextTokens) || 0,
    optimizedTokens: Number(metadata.optimizedTokens) || Number(metadata.contextTokens) || 0,
    reductionPercent: Number(metadata.reductionPercent) || 0,
    softTokenLimit: 0,
    warning: false,
    safeSharingEnabled,
  };
}

function resolvePromptTemplatesFromManifest(analyzeManifest) {
  const options = analyzeManifest && analyzeManifest.inputs && analyzeManifest.inputs.options
    ? analyzeManifest.inputs.options
    : {};
  const presetTemplates = options.workflowPreset && Array.isArray(options.workflowPreset.promptTemplates)
    ? options.workflowPreset.promptTemplates
    : [];
  const guidedTemplates = options.guidedMode && Array.isArray(options.guidedMode.promptTemplates)
    ? options.guidedMode.promptTemplates
    : [];
  const selected = presetTemplates.length > 0 ? presetTemplates : guidedTemplates;
  return resolvePromptTemplates(selected.length > 0 ? selected : null);
}

function buildArtifactContext(outputProgramDir, sourceArtifactPaths) {
  const canonicalAnalysis = readJsonIfExists(path.join(outputProgramDir, 'canonical-analysis.json'));
  const context = readJsonIfExists(path.join(outputProgramDir, 'context.json'));
  const optimizedContext = readJsonIfExists(path.join(outputProgramDir, 'optimized-context.json'));
  const aiKnowledge = readJsonIfExists(path.join(outputProgramDir, 'ai-knowledge.json'));
  const analysisIndex = readJsonIfExists(path.join(outputProgramDir, 'analysis-index.json'));
  const dependencyGraph = readJsonIfExists(path.join(outputProgramDir, 'dependency-graph.json'));
  const crossProgramGraph = readJsonIfExists(path.join(outputProgramDir, 'program-call-tree.json'));
  const db2Metadata = readJsonIfExists(path.join(outputProgramDir, 'db2-metadata.json'));
  const testData = readJsonIfExists(path.join(outputProgramDir, 'test-data.json'));
  const analyzeManifest = readJsonIfExists(path.join(outputProgramDir, 'analyze-run-manifest.json'));
  const safeArtifactPaths = sourceArtifactPaths.map((artifactPath) => buildSafeArtifactPath(artifactPath));

  return {
    canonicalAnalysis,
    context,
    optimizedContext,
    aiKnowledge,
    analysisIndex,
    dependencyGraph,
    crossProgramGraph,
    db2Metadata,
    testData,
    analyzeManifest,
    sourceArtifactPaths,
    safeArtifactPaths,
  };
}

function createRedactor({ sourceArtifactPaths, safeArtifactPaths, analyzeManifest }) {
  const replacementMap = new Map();
  const categoryCounters = new Map();
  const valueMap = new Map();
  const generatedArtifactPaths = new Set([
    ...sourceArtifactPaths,
    ...safeArtifactPaths,
    REDACTION_MANIFEST_FILE,
    `${SAFE_SHARING_DIR}/${REDACTION_MANIFEST_FILE}`,
  ]);
  const exactFixedPaths = new Map();
  const sourceRoot = analyzeManifest && analyzeManifest.inputs ? analyzeManifest.inputs.sourceRoot : null;
  const outputRoot = analyzeManifest && analyzeManifest.inputs ? analyzeManifest.inputs.outputRoot : null;
  const outputDir = analyzeManifest && analyzeManifest.run ? analyzeManifest.run.outputDir : null;
  const cwd = analyzeManifest && analyzeManifest.run ? analyzeManifest.run.cwd : null;

  if (sourceRoot) exactFixedPaths.set(String(sourceRoot), 'SAFE_SHARING_SOURCE_ROOT');
  if (outputRoot) exactFixedPaths.set(String(outputRoot), 'SAFE_SHARING_OUTPUT_ROOT');
  if (outputDir) exactFixedPaths.set(String(outputDir), 'SAFE_SHARING_OUTPUT_DIR');
  if (cwd) exactFixedPaths.set(String(cwd), 'SAFE_SHARING_WORKSPACE');

  function nextPlaceholder(category) {
    const current = Number(categoryCounters.get(category) || 0) + 1;
    categoryCounters.set(category, current);
    return `${CATEGORY_PREFIX[category] || category}_${String(current).padStart(3, '0')}`;
  }

  function registerExactValue(rawValue, placeholder) {
    const normalized = String(rawValue || '').trim();
    if (!normalized || generatedArtifactPaths.has(normalized)) {
      return;
    }
    if (!replacementMap.has(normalized)) {
      replacementMap.set(normalized, placeholder);
    }
  }

  function registerCategoryValue(category, rawValue) {
    const normalized = String(rawValue || '').trim();
    if (!normalized || generatedArtifactPaths.has(normalized) || replacementMap.has(normalized)) {
      return;
    }
    if (category === 'SOURCE_FILE') {
      const ext = path.extname(normalized);
      registerExactValue(normalized, `${nextPlaceholder(category)}${ext}`);
      return;
    }
    registerExactValue(normalized, nextPlaceholder(category));
  }

  function registerDataValue(rawValue) {
    const normalized = String(rawValue || '').trim();
    if (!normalized) {
      return normalized;
    }
    if (!valueMap.has(normalized)) {
      valueMap.set(normalized, nextPlaceholder('VALUE'));
    }
    return valueMap.get(normalized);
  }

  function pathEndsWith(pathValue, suffixes) {
    return suffixes.some((suffix) => pathValue.endsWith(suffix));
  }

  function isPathFragment(pathValue, fragments) {
    return fragments.some((fragment) => pathValue.includes(fragment));
  }

  function collectString(pathValue, rawValue) {
    const value = String(rawValue || '').trim();
    if (!value || generatedArtifactPaths.has(value)) {
      return;
    }

    if (exactFixedPaths.has(value)) {
      registerExactValue(value, exactFixedPaths.get(value));
      return;
    }

    if (
      pathEndsWith(pathValue, [
        '.rootProgram',
        '.program',
        '.ownerProgram',
        '.catalogSystemName',
        '.catalogSqlName',
      ])
      || isPathFragment(pathValue, [
        '.entities.programs.[].name',
        '.entities.externalObjects.[].name',
        '.dependencies.programCalls.[].name',
        '.programCalls.[].name',
        '.unresolvedPrograms.[]',
        '.ambiguousPrograms.[]',
        '.primaryCalls.[]',
        '.externalObjects.[].requestedName',
        '.externalObjects.[].sqlName',
        '.externalObjects.[].systemName',
      ])
    ) {
      registerCategoryValue('PROGRAM', value);
      return;
    }

    if (
      isPathFragment(pathValue, [
        '.entities.tables.[].name',
        '.dependencies.tables.[].name',
        '.sqlStatements.[].tables.[',
        '.sql.statements.[].tables.[',
        '.db2Metadata.tables.[].requestedName',
        '.db2Metadata.tables.[].displayName',
        '.db2Metadata.tables.[].table',
        '.db2Metadata.tables.[].systemName',
        '.db2Tables.[].requestedName',
        '.db2Tables.[].displayName',
        '.db2Tables.[].table',
        '.db2Tables.[].systemName',
        '.testData.tables.[].table',
        '.testData.tables.[].systemName',
        '.tableLinks.[].requestedName',
        '.matches.[].table',
        '.matches.[].systemName',
        '.unresolvedTables.[]',
      ])
    ) {
      registerCategoryValue('TABLE', value);
      return;
    }

    if (
      isPathFragment(pathValue, [
        '.entities.copyMembers.[].name',
        '.dependencies.copyMembers.[].name',
        '.copyMembers.[].name',
      ])
    ) {
      registerCategoryValue('COPY_MEMBER', value);
      return;
    }

    if (
      isPathFragment(pathValue, [
        '.entities.nativeFiles.[].name',
        '.nativeFileUsage.files.[].name',
        '.nativeFiles.[].name',
      ])
    ) {
      registerCategoryValue('NATIVE_FILE', value);
      return;
    }

    if (
      isPathFragment(pathValue, [
        '.entities.modules.[].name',
        '.bindingAnalysis.modules.[].name',
        '.modules.[].name',
      ])
    ) {
      registerCategoryValue('MODULE', value);
      return;
    }

    if (
      isPathFragment(pathValue, [
        '.entities.servicePrograms.[].name',
        '.bindingAnalysis.servicePrograms.[].name',
        '.servicePrograms.[].name',
      ])
    ) {
      registerCategoryValue('SERVICE_PROGRAM', value);
      return;
    }

    if (
      isPathFragment(pathValue, [
        '.entities.bindingDirectories.[].name',
        '.bindingAnalysis.bindingDirectories.[].name',
        '.bindingDirectories.[]',
      ])
    ) {
      registerCategoryValue('BINDING_DIRECTORY', value);
      return;
    }

    if (
      isPathFragment(pathValue, [
        '.entities.procedures.[].name',
        '.procedureAnalysis.procedures.[].name',
        '.calls.[].caller',
        '.calls.[].target',
        '.exports.[].symbol',
        '.attributes.targetName',
      ])
    ) {
      registerCategoryValue('PROCEDURE', value);
      return;
    }

    if (
      isPathFragment(pathValue, [
        '.entities.prototypes.[].name',
        '.procedureAnalysis.prototypes.[].name',
        '.importedProcedures.[]',
        '.externalName',
      ])
    ) {
      registerCategoryValue('PROTOTYPE', value);
      return;
    }

    if (isPathFragment(pathValue, ['.recordFormats.[].name'])) {
      registerCategoryValue('RECORD_FORMAT', value);
      return;
    }

    if (
      pathEndsWith(pathValue, ['.schema', '.referencesSchema', '.systemSchema', '.library', '.catalogLibrary', '.catalogSchema', '.programLibrary'])
      || isPathFragment(pathValue, ['.matchedSchemas.[]'])
    ) {
      registerCategoryValue('SCHEMA', value);
      return;
    }

    if (pathEndsWith(pathValue, ['.sourceLib'])) {
      registerCategoryValue('SOURCE_LIBRARY', value);
      return;
    }

    if (isPathFragment(pathValue, ['.provenance.import.sourceFile'])) {
      registerCategoryValue('SOURCE_FILE_SET', value);
      return;
    }

    if (pathEndsWith(pathValue, ['.member'])) {
      registerCategoryValue('MEMBER', value);
      return;
    }

    if (
      pathEndsWith(pathValue, ['.sourceRoot', '.outputRoot', '.outputDir', '.cwd'])
      || isPathFragment(pathValue, [
        '.sourceFiles.[].path',
        '.sourceSnapshot.files.[].path',
        '.evidence.[].file',
        '.sourceEvidence.[].file',
      ])
    ) {
      registerCategoryValue('SOURCE_FILE', normalizePathString(value));
    }

    if (
      isPathFragment(pathValue, [
        '.sqlStatements.[].text',
        '.sql.statements.[].text',
        '.snippet',
      ])
    ) {
      const matches = value.matchAll(/\b([A-Z][A-Z0-9_#$@]*)[/.]([A-Z][A-Z0-9_#$@]*)\b/g);
      for (const match of matches) {
        registerCategoryValue('SCHEMA', match[1]);
        registerCategoryValue('TABLE', match[2]);
      }
    }
  }

  function collectObject(value, pathSegments = []) {
    if (Array.isArray(value)) {
      value.forEach((entry) => collectObject(entry, [...pathSegments, '[]']));
      return;
    }
    if (!value || typeof value !== 'object') {
      if (typeof value === 'string') {
        collectString(pathSegments.join('.'), value);
      }
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      collectObject(entry, [...pathSegments, key]);
    }
  }

  function finalize() {
    for (const [rawValue, placeholder] of exactFixedPaths.entries()) {
      registerExactValue(rawValue, placeholder);
    }
  }

  function redactQuotedLiterals(text) {
    return String(text || '').replace(/'([^']*)'/g, (match, literal) => `'${registerDataValue(literal)}'`);
  }

  function redactText(text) {
    if (text === null || text === undefined) {
      return text;
    }
    const raw = String(text);
    if (generatedArtifactPaths.has(raw)) {
      return raw;
    }

    let redacted = redactQuotedLiterals(raw);
    const entries = Array.from(replacementMap.entries())
      .sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]));
    for (const [rawValue, placeholder] of entries) {
      redacted = redacted.replace(new RegExp(escapeRegExp(rawValue), 'g'), placeholder);
    }
    return redacted;
  }

  function shouldRedactDataValue(pathValue) {
    return pathValue.includes('.rows.[]');
  }

  function redactObject(value, pathSegments = []) {
    const pathValue = pathSegments.join('.');
    if (Array.isArray(value)) {
      return value.map((entry) => redactObject(entry, [...pathSegments, '[]']));
    }
    if (!value || typeof value !== 'object') {
      if (typeof value === 'string') {
        const normalized = normalizePathString(value);
        if (replacementMap.has(normalized)) {
          return replacementMap.get(normalized);
        }
        if (replacementMap.has(value)) {
          return replacementMap.get(value);
        }
        if (shouldRedactDataValue(pathValue)) {
          return registerDataValue(value);
        }
        return redactText(value);
      }
      if (shouldRedactDataValue(pathValue) && (typeof value === 'number' || typeof value === 'bigint')) {
        return registerDataValue(value);
      }
      return value;
    }
    const redacted = {};
    for (const [key, entry] of Object.entries(value)) {
      redacted[key] = redactObject(entry, [...pathSegments, key]);
    }
    return redacted;
  }

  function buildSummary() {
    const placeholderCounts = {};
    for (const [category, count] of categoryCounters.entries()) {
      placeholderCounts[category] = count;
    }
    return {
      placeholderCounts,
      replacementCount: replacementMap.size,
      dataValueCount: valueMap.size,
    };
  }

  return {
    collectObject,
    finalize,
    redactObject,
    redactText,
    buildSummary,
  };
}

function buildGeneratedArtifactSet(context) {
  const generated = [];
  const outputProgramDir = context.outputProgramDir;
  const safeDir = path.join(outputProgramDir, SAFE_SHARING_DIR);
  ensureDir(safeDir);

  const redactor = createRedactor({
    sourceArtifactPaths: context.sourceArtifactPaths,
    safeArtifactPaths: context.safeArtifactPaths,
    analyzeManifest: context.analyzeManifest,
  });

  const structuredArtifacts = [
    ['canonical', context.canonicalAnalysis],
    ['context', context.context],
    ['optimizedContext', context.optimizedContext],
    ['aiKnowledge', context.aiKnowledge],
    ['analysisIndex', context.analysisIndex],
    ['dependencyGraph', context.dependencyGraph],
    ['crossProgramGraph', context.crossProgramGraph],
    ['db2Metadata', context.db2Metadata],
    ['testData', context.testData],
    ['analyzeManifest', context.analyzeManifest],
  ];

  for (const [label, value] of structuredArtifacts) {
    if (value) {
      redactor.collectObject(value, [label]);
    }
  }
  redactor.finalize();

  const redactedCanonical = context.canonicalAnalysis ? redactor.redactObject(context.canonicalAnalysis, ['canonical']) : null;
  const redactedContext = context.context ? redactor.redactObject(context.context, ['context']) : null;
  const redactedOptimizedContext = context.optimizedContext ? redactor.redactObject(context.optimizedContext, ['optimizedContext']) : null;
  const redactedAiKnowledge = context.aiKnowledge ? redactor.redactObject(context.aiKnowledge, ['aiKnowledge']) : null;
  const redactedAnalysisIndex = context.analysisIndex ? redactor.redactObject(context.analysisIndex, ['analysisIndex']) : null;
  const redactedDependencyGraph = context.dependencyGraph ? redactor.redactObject(context.dependencyGraph, ['dependencyGraph']) : null;
  const redactedCrossProgramGraph = context.crossProgramGraph ? redactor.redactObject(context.crossProgramGraph, ['crossProgramGraph']) : null;
  const redactedDb2Metadata = context.db2Metadata ? redactor.redactObject(context.db2Metadata, ['db2Metadata']) : null;
  const redactedTestData = context.testData ? redactor.redactObject(context.testData, ['testData']) : null;
  const redactedAnalyzeManifest = context.analyzeManifest ? redactor.redactObject(context.analyzeManifest, ['analyzeManifest']) : null;

  if (redactedCanonical) {
    writeJson(path.join(safeDir, 'canonical-analysis.json'), redactedCanonical);
    generated.push(buildSafeArtifactPath('canonical-analysis.json'));
  }
  if (redactedContext) {
    writeJson(path.join(safeDir, 'context.json'), redactedContext);
    generated.push(buildSafeArtifactPath('context.json'));
  }
  if (redactedOptimizedContext) {
    writeJson(path.join(safeDir, 'optimized-context.json'), redactedOptimizedContext);
    generated.push(buildSafeArtifactPath('optimized-context.json'));
  }
  if (redactedAiKnowledge) {
    writeJson(path.join(safeDir, 'ai-knowledge.json'), redactedAiKnowledge);
    generated.push(buildSafeArtifactPath('ai-knowledge.json'));
  }
  if (redactedAnalysisIndex) {
    writeJson(path.join(safeDir, 'analysis-index.json'), redactedAnalysisIndex);
    generated.push(buildSafeArtifactPath('analysis-index.json'));
  }
  if (redactedDependencyGraph) {
    writeText(path.join(safeDir, 'dependency-graph.json'), renderJson(redactedDependencyGraph));
    writeText(path.join(safeDir, 'dependency-graph.mmd'), renderMermaid(redactedDependencyGraph));
    writeText(path.join(safeDir, 'dependency-graph.md'), renderMarkdown(redactedDependencyGraph));
    generated.push(
      buildSafeArtifactPath('dependency-graph.json'),
      buildSafeArtifactPath('dependency-graph.mmd'),
      buildSafeArtifactPath('dependency-graph.md'),
    );
  }
  if (redactedCrossProgramGraph) {
    writeText(path.join(safeDir, 'program-call-tree.json'), renderJson(redactedCrossProgramGraph));
    writeText(path.join(safeDir, 'program-call-tree.mmd'), renderMermaid(redactedCrossProgramGraph));
    writeText(path.join(safeDir, 'program-call-tree.md'), renderCrossProgramMarkdown(redactedCrossProgramGraph));
    writeText(path.join(safeDir, 'architecture.html'), renderHtml(redactedCrossProgramGraph));
    generated.push(
      buildSafeArtifactPath('program-call-tree.json'),
      buildSafeArtifactPath('program-call-tree.mmd'),
      buildSafeArtifactPath('program-call-tree.md'),
      buildSafeArtifactPath('architecture.html'),
    );
  }
  if (redactedContext) {
    const reportMarkdown = generateMarkdownReport(redactedContext, extractOptimizationReport(context.analyzeManifest));
    writeText(path.join(safeDir, 'report.md'), reportMarkdown);
    generated.push(buildSafeArtifactPath('report.md'));
  }
  if (redactedContext && redactedDependencyGraph) {
    const architectureReport = renderArchitectureReport({
      context: redactedContext,
      graph: redactedDependencyGraph,
      optimizedContext: redactedOptimizedContext,
      mermaidText: '',
    });
    writeText(path.join(safeDir, 'architecture-report.md'), architectureReport);
    generated.push(buildSafeArtifactPath('architecture-report.md'));
  }
  if (redactedAiKnowledge) {
    const promptTemplates = resolvePromptTemplatesFromManifest(context.analyzeManifest);
    buildPrompts({
      aiProjection: redactedAiKnowledge,
      outputDir: safeDir,
      templates: promptTemplates,
    });
    for (const templateName of promptTemplates) {
      generated.push(buildSafeArtifactPath(getPromptContract(templateName).outputFileName));
    }
  }
  if (redactedDb2Metadata) {
    writeJson(path.join(safeDir, 'db2-metadata.json'), redactedDb2Metadata);
    writeText(
      path.join(safeDir, 'db2-metadata.md'),
      renderDb2MetadataMarkdown(redactedDb2Metadata.program, redactedDb2Metadata.tables || []),
    );
    generated.push(buildSafeArtifactPath('db2-metadata.json'), buildSafeArtifactPath('db2-metadata.md'));
  }
  if (redactedTestData) {
    writeJson(path.join(safeDir, 'test-data.json'), redactedTestData);
    writeText(
      path.join(safeDir, 'test-data.md'),
      renderTestDataMarkdown(
        redactedTestData.program,
        redactedTestData.rowLimit,
        redactedTestData.tables || [],
        redactedTestData.notes || [],
      ),
    );
    generated.push(buildSafeArtifactPath('test-data.json'), buildSafeArtifactPath('test-data.md'));
  }
  if (redactedAnalyzeManifest) {
    writeJson(path.join(safeDir, 'analyze-run-manifest.json'), redactedAnalyzeManifest);
    generated.push(buildSafeArtifactPath('analyze-run-manifest.json'));
  }

  const regenerated = new Set(generated);
  for (const artifactPath of context.sourceArtifactPaths) {
    const sourcePath = path.join(outputProgramDir, artifactPath);
    const safePath = path.join(safeDir, artifactPath);
    if (!fs.existsSync(sourcePath) || regenerated.has(buildSafeArtifactPath(artifactPath))) {
      continue;
    }
    const ext = path.extname(artifactPath).toLowerCase();
    if (ext === '.md' || ext === '.mmd' || ext === '.html') {
      writeText(safePath, redactor.redactText(readTextIfExists(sourcePath)));
      generated.push(buildSafeArtifactPath(artifactPath));
    } else if (ext === '.json') {
      writeJson(safePath, redactor.redactObject(readJsonIfExists(sourcePath), ['artifact', artifactPath]));
      generated.push(buildSafeArtifactPath(artifactPath));
    }
  }

  const redactionManifest = {
    schemaVersion: REDACTION_MANIFEST_SCHEMA_VERSION,
    kind: 'safe-sharing-redaction-manifest',
    generatedAt: resolveTimestamp(context.reproducibility),
    sourceArtifactCount: context.sourceArtifactPaths.length,
    redactedArtifactCount: generated.length,
    sourceArtifacts: [...context.sourceArtifactPaths],
    redactedArtifacts: [...generated].sort((a, b) => a.localeCompare(b)),
    safeSharingDirectory: SAFE_SHARING_DIR,
    summary: redactor.buildSummary(),
    notes: [
      'Reverse placeholder mappings are intentionally not exported.',
      'Redacted artifacts preserve workflow structure but replace sensitive identifiers and extracted values.',
    ],
  };
  writeJson(path.join(safeDir, REDACTION_MANIFEST_FILE), redactionManifest);
  generated.push(buildSafeArtifactPath(REDACTION_MANIFEST_FILE));

  return {
    generatedFiles: uniqueSortedStrings(generated),
    redactionManifest,
  };
}

function buildSafeSharingArtifacts({ outputProgramDir, analyzeManifest = null }) {
  const resolvedManifest = analyzeManifest || readAnalyzeRunManifest(outputProgramDir);
  if (!resolvedManifest) {
    throw new Error(`Analyze manifest not found for safe-sharing artifacts: ${outputProgramDir}`);
  }

  const sourceArtifactPaths = collectSourceArtifactPaths(resolvedManifest);
  const context = buildArtifactContext(outputProgramDir, sourceArtifactPaths);
  const reproducibility = normalizeReproducibilitySettings(
    context.analyzeManifest
    && context.analyzeManifest.inputs
    && context.analyzeManifest.inputs.options
    && context.analyzeManifest.inputs.options.reproducibleEnabled,
  );
  return buildGeneratedArtifactSet({
    ...context,
    outputProgramDir,
    reproducibility,
  });
}

module.exports = {
  SAFE_SHARING_DIR,
  REDACTION_MANIFEST_FILE,
  REDACTION_MANIFEST_SCHEMA_VERSION,
  buildSafeArtifactPath,
  buildSafeSharingArtifacts,
};
