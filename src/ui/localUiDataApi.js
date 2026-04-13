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
const GRAPH_FILE = 'program-call-tree.json';
const CONTEXT_FILE = 'context.json';
const DB2_METADATA_FILE = 'db2-metadata.json';
const TEST_DATA_FILE = 'test-data.json';
const PROMPT_FILE_PATTERN = /^ai_prompt_.*\.md$/i;

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

function toDisplayTitle(filePath) {
  return String(filePath || '')
    .replace(/^safe-sharing\//, '')
    .replace(/^ai_prompt_/, '')
    .replace(/\.md$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function uniqueSorted(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right));
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
      const normalizedPath = normalizeRelativePath(entry.path);
      return {
        path: normalizedPath,
        kind: inferArtifactKind(entry.path),
        sizeBytes: stats.size,
        title: toDisplayTitle(normalizedPath),
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

function collectPromptArtifacts(artifacts) {
  return (Array.isArray(artifacts) ? artifacts : [])
    .filter((artifact) => PROMPT_FILE_PATTERN.test(artifact.path))
    .map((artifact) => ({
      path: artifact.path,
      title: artifact.title,
      workflowHint: artifact.title,
      kind: artifact.kind,
      sizeBytes: artifact.sizeBytes,
    }));
}

function buildRelatedArtifactPaths(node, availablePaths) {
  const result = ['report.md', 'context.json', 'analysis-index.json'];
  if (availablePaths.has('architecture.html')) result.push('architecture.html');
  if (availablePaths.has('program-call-tree.json')) result.push('program-call-tree.json');

  if (node.type === 'PROGRAM') {
    if (availablePaths.has('architecture-report.md')) result.push('architecture-report.md');
    if (availablePaths.has('dependency-graph.json')) result.push('dependency-graph.json');
    if (availablePaths.has('impact-analysis.json')) result.push('impact-analysis.json');
    if (availablePaths.has('impact-analysis.md')) result.push('impact-analysis.md');
  }

  if (node.type === 'TABLE') {
    if (availablePaths.has('db2-metadata.json')) result.push('db2-metadata.json');
    if (availablePaths.has('db2-metadata.md')) result.push('db2-metadata.md');
    if (availablePaths.has('test-data.json')) result.push('test-data.json');
    if (availablePaths.has('test-data.md')) result.push('test-data.md');
  }

  return uniqueSorted(result.filter((entry) => availablePaths.has(entry)));
}

function buildGraphView(programOutputDir, context, artifacts) {
  const graph = readJsonIfExists(path.join(programOutputDir, GRAPH_FILE));
  const availablePaths = new Set((artifacts || []).map((artifact) => artifact.path));
  const promptArtifacts = collectPromptArtifacts(artifacts);

  if (!graph) {
    return {
      available: false,
      summary: {
        nodeCount: 0,
        edgeCount: 0,
        programCount: 0,
        tableCount: 0,
      },
      rootProgram: null,
      viewerArtifact: availablePaths.has('architecture.html') ? 'architecture.html' : null,
      nodes: [],
      edges: [],
    };
  }

  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const adjacency = new Map(nodes.map((node) => [node.id, {
    incoming: [],
    outgoing: [],
  }]));

  for (const edge of edges) {
    if (adjacency.has(edge.from)) {
      adjacency.get(edge.from).outgoing.push(edge.to);
    }
    if (adjacency.has(edge.to)) {
      adjacency.get(edge.to).incoming.push(edge.from);
    }
  }

  const graphNodes = nodes.map((node) => {
    const links = adjacency.get(node.id) || { incoming: [], outgoing: [] };
    const connected = uniqueSorted([...links.incoming, ...links.outgoing]);
    const connectedTables = connected.filter((entry) => nodes.some((candidate) => candidate.id === entry && candidate.type === 'TABLE'));
    const connectedPrograms = connected.filter((entry) => nodes.some((candidate) => candidate.id === entry && candidate.type === 'PROGRAM'));

    return {
      id: node.id,
      type: node.type,
      connectedNodeIds: connected,
      connectedTableIds: connectedTables,
      connectedProgramIds: connectedPrograms,
      incomingCount: links.incoming.length,
      outgoingCount: links.outgoing.length,
      relatedArtifactPaths: buildRelatedArtifactPaths(node, availablePaths),
      relatedPromptPaths: node.type === 'PROGRAM'
        ? promptArtifacts.map((artifact) => artifact.path)
        : promptArtifacts
          .filter((artifact) => /documentation|error analysis|modernization|architecture review/i.test(artifact.title))
          .map((artifact) => artifact.path),
      impactTarget: node.id,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));

  return {
    available: true,
    summary: {
      nodeCount: graphNodes.length,
      edgeCount: edges.length,
      programCount: graphNodes.filter((node) => node.type === 'PROGRAM').length,
      tableCount: graphNodes.filter((node) => node.type === 'TABLE').length,
    },
    rootProgram: graph.rootProgram || (context ? context.program : null),
    viewerArtifact: availablePaths.has('architecture.html') ? 'architecture.html' : null,
    nodes: graphNodes,
    edges,
  };
}

function buildDb2View(programOutputDir, promptArtifacts) {
  const db2Metadata = readJsonIfExists(path.join(programOutputDir, DB2_METADATA_FILE));
  const testData = readJsonIfExists(path.join(programOutputDir, TEST_DATA_FILE));
  const tableMap = new Map();

  for (const table of (db2Metadata && Array.isArray(db2Metadata.tables) ? db2Metadata.tables : [])) {
    const id = `${table.schema || ''}|${table.table || table.systemName || ''}`;
    tableMap.set(id, {
      id,
      qualifiedName: [table.schema, table.table].filter(Boolean).join('.'),
      schema: table.schema || '',
      table: table.table || table.systemName || '',
      matchStatus: table.sourceLink ? table.sourceLink.matchStatus || 'resolved' : 'resolved',
      sourceEvidenceCount: table.sourceLink && Array.isArray(table.sourceLink.sourceEvidence)
        ? table.sourceLink.sourceEvidence.length
        : 0,
      sampleRowCount: 0,
      maskedColumnCount: 0,
      policyEligibility: null,
      relatedPromptPaths: promptArtifacts.map((artifact) => artifact.path),
      relatedArtifactPaths: uniqueSorted(['db2-metadata.json', 'db2-metadata.md']),
    });
  }

  for (const table of (testData && Array.isArray(testData.tables) ? testData.tables : [])) {
    const id = `${table.schema || ''}|${table.table || table.systemName || ''}`;
    const current = tableMap.get(id) || {
      id,
      qualifiedName: [table.schema, table.table].filter(Boolean).join('.'),
      schema: table.schema || '',
      table: table.table || table.systemName || '',
      matchStatus: table.sourceLink ? table.sourceLink.matchStatus || 'resolved' : 'resolved',
      sourceEvidenceCount: table.sourceLink && Array.isArray(table.sourceLink.sourceEvidence)
        ? table.sourceLink.sourceEvidence.length
        : 0,
      sampleRowCount: 0,
      maskedColumnCount: 0,
      policyEligibility: null,
      relatedPromptPaths: promptArtifacts.map((artifact) => artifact.path),
      relatedArtifactPaths: [],
    };
    current.sampleRowCount = Array.isArray(table.rows) ? table.rows.length : 0;
    current.maskedColumnCount = table.policyDecision && Array.isArray(table.policyDecision.maskedColumns)
      ? table.policyDecision.maskedColumns.length
      : 0;
    current.policyEligibility = table.policyDecision ? table.policyDecision.eligibility || null : null;
    current.relatedArtifactPaths = uniqueSorted([
      ...current.relatedArtifactPaths,
      'test-data.json',
      'test-data.md',
    ]);
    tableMap.set(id, current);
  }

  return {
    metadataAvailable: Boolean(db2Metadata),
    testDataAvailable: Boolean(testData),
    metadataSummary: db2Metadata && db2Metadata.summary ? db2Metadata.summary : null,
    testDataSummary: testData && testData.summary ? testData.summary : null,
    tables: Array.from(tableMap.values())
      .sort((left, right) => left.qualifiedName.localeCompare(right.qualifiedName)),
  };
}

function buildPromptView(artifacts) {
  const prompts = collectPromptArtifacts(artifacts);
  return {
    available: prompts.length > 0,
    artifacts: prompts,
  };
}

function buildInteractiveViews(programOutputDir, context, artifacts) {
  const promptView = buildPromptView(artifacts);
  const graphView = buildGraphView(programOutputDir, context, artifacts);
  const db2View = buildDb2View(programOutputDir, promptView.artifacts);

  return {
    summary: {
      graphAvailable: graphView.available,
      db2MetadataAvailable: db2View.metadataAvailable,
      testDataAvailable: db2View.testDataAvailable,
      promptCount: promptView.artifacts.length,
      graphNodeCount: graphView.summary.nodeCount,
      db2TableCount: db2View.tables.length,
    },
    graph: graphView,
    db2: db2View,
    prompts: promptView,
  };
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
  const context = readJsonIfExists(path.join(programOutputDir, CONTEXT_FILE));

  return {
    summary: buildRunSummary(program, programOutputDir, analyzeManifest, bundleManifest, workflowManifest),
    analyzeManifest,
    bundleManifest,
    workflowManifest,
    artifacts,
    views: buildInteractiveViews(programOutputDir, context, artifacts),
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
  buildInteractiveViews,
  inferArtifactKind,
  listAnalysisRuns,
  readAnalysisRun,
  readArtifactContent,
};
