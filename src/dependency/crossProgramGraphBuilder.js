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
const { scanSourceFiles } = require('../scanner/rpgScanner');
const { buildSourceIndex, normalizeProgramName, resolveProgram } = require('./programSourceResolver');
const { normalizeAnalysisLimits } = require('../analyze/analysisLimits');

function asName(entry) {
  if (!entry) return '';
  if (typeof entry === 'string') return normalizeProgramName(entry);
  if (typeof entry === 'object' && entry.name) return normalizeProgramName(entry.name);
  return '';
}

function collectSqlTableNames(sqlStatements) {
  const names = new Set();
  for (const statement of sqlStatements || []) {
    for (const tableName of statement.tables || []) {
      const normalized = normalizeProgramName(tableName);
      if (normalized) names.add(normalized);
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

function isStaticProgramIdentifier(name) {
  return /^[A-Z0-9_#$@]+$/.test(name);
}

function sortNodes(nodes) {
  return [...nodes].sort((a, b) => {
    if (a.id !== b.id) return a.id.localeCompare(b.id);
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return String(a.label || '').localeCompare(String(b.label || ''));
  });
}

function sortEdges(edges) {
  return [...edges].sort((a, b) => {
    if (a.from !== b.from) return a.from.localeCompare(b.from);
    if (a.to !== b.to) return a.to.localeCompare(b.to);
    return a.type.localeCompare(b.type);
  });
}

function buildCrossProgramGraph({
  rootProgram,
  sourceFiles,
  sourceRoot,
  importManifest,
  scanCache,
  sourceMetadataByPath,
  limits,
}) {
  const root = normalizeProgramName(rootProgram);
  if (!root) {
    throw new Error('Cross-program graph generation requires rootProgram');
  }

  const analysisLimits = normalizeAnalysisLimits(limits);
  const sourceIndex = buildSourceIndex(sourceFiles || [], {
    sourceRoot,
    importManifest,
  });
  const visitedPrograms = new Set();
  const scannedFiles = new Set();
  const unresolvedPrograms = new Set();
  const ambiguousPrograms = new Set();
  const notes = [];
  const diagnostics = [];
  const limitState = {
    maxProgramDepth: false,
    maxPrograms: false,
    maxNodes: false,
    maxEdges: false,
    maxScannedFiles: false,
    maxProgramCallsPerProgram: false,
  };

  const nodeSet = new Set();
  const edgeSet = new Set();
  const nodes = [];
  const edges = [];

  function recordLimit(code, message, details = {}) {
    if (diagnostics.some((entry) => entry.code === code)) {
      return;
    }
    diagnostics.push({
      severity: 'warning',
      code,
      message,
      details,
    });
    notes.push(message);
  }

  function addNode(id, type, label) {
    const normalizedId = normalizeProgramName(id);
    const normalizedType = normalizeProgramName(type);
    const normalizedLabel = normalizeProgramName(label || id);
    if (!normalizedId || !normalizedType) return false;

    const key = `${normalizedId}|${normalizedType}`;
    if (nodeSet.has(key)) return true;
    if (nodes.length >= analysisLimits.maxNodes) {
      limitState.maxNodes = true;
      recordLimit(
        'CROSS_PROGRAM_MAX_NODES_REACHED',
        `Cross-program graph stopped adding nodes after reaching the configured node limit (${analysisLimits.maxNodes}).`,
        { maxNodes: analysisLimits.maxNodes },
      );
      return false;
    }
    nodeSet.add(key);
    nodes.push({
      id: normalizedId,
      type: normalizedType,
      label: normalizedLabel,
    });
    return true;
  }

  function addEdge(from, to, type) {
    const normalizedFrom = normalizeProgramName(from);
    const normalizedTo = normalizeProgramName(to);
    const normalizedType = normalizeProgramName(type);
    if (!normalizedFrom || !normalizedTo || !normalizedType) return false;

    const key = `${normalizedFrom}|${normalizedTo}|${normalizedType}`;
    if (edgeSet.has(key)) return true;
    if (edges.length >= analysisLimits.maxEdges) {
      limitState.maxEdges = true;
      recordLimit(
        'CROSS_PROGRAM_MAX_EDGES_REACHED',
        `Cross-program graph stopped adding edges after reaching the configured edge limit (${analysisLimits.maxEdges}).`,
        { maxEdges: analysisLimits.maxEdges },
      );
      return false;
    }
    edgeSet.add(key);
    edges.push({
      from: normalizedFrom,
      to: normalizedTo,
      type: normalizedType,
    });
    return true;
  }

  function canDescendToProgram(programName, depth) {
    if (depth > analysisLimits.maxProgramDepth) {
      limitState.maxProgramDepth = true;
      recordLimit(
        'CROSS_PROGRAM_MAX_DEPTH_REACHED',
        `Cross-program graph stopped recursion after reaching the configured depth limit (${analysisLimits.maxProgramDepth}).`,
        { maxProgramDepth: analysisLimits.maxProgramDepth, program: programName },
      );
      return false;
    }

    if (!visitedPrograms.has(programName) && visitedPrograms.size >= analysisLimits.maxPrograms) {
      limitState.maxPrograms = true;
      recordLimit(
        'CROSS_PROGRAM_MAX_PROGRAMS_REACHED',
        `Cross-program graph stopped recursion after reaching the configured program limit (${analysisLimits.maxPrograms}).`,
        { maxPrograms: analysisLimits.maxPrograms, program: programName },
      );
      unresolvedPrograms.add(programName);
      return false;
    }

    return true;
  }

  function walkProgram(programName, depth = 0) {
    const currentProgram = normalizeProgramName(programName);
    if (!currentProgram) return;
    if (visitedPrograms.has(currentProgram)) return;
    if (!canDescendToProgram(currentProgram, depth)) return;

    visitedPrograms.add(currentProgram);
    addNode(currentProgram, 'PROGRAM', currentProgram);

    const resolved = resolveProgram(currentProgram, sourceIndex);
    if (!resolved || !resolved.path) {
      if (resolved && resolved.ambiguous) {
        ambiguousPrograms.add(currentProgram);
        if (resolved.warning) {
          notes.push(resolved.warning);
        }
      }
      if (currentProgram !== root) {
        unresolvedPrograms.add(currentProgram);
      }
      return;
    }

    if (!scannedFiles.has(resolved.path) && scannedFiles.size >= analysisLimits.maxScannedFiles) {
      limitState.maxScannedFiles = true;
      recordLimit(
        'CROSS_PROGRAM_MAX_SCANNED_FILES_REACHED',
        `Cross-program graph stopped scanning additional source files after reaching the configured file limit (${analysisLimits.maxScannedFiles}).`,
        { maxScannedFiles: analysisLimits.maxScannedFiles, file: resolved.relativePath || resolved.path },
      );
      return;
    }

    if (scannedFiles.has(resolved.path)) {
      return;
    }
    scannedFiles.add(resolved.path);

    const scanResult = scanSourceFiles([resolved.path], {
      scanCache,
      sourceMetadataByPath,
    });

    const tableNames = new Set(
      (scanResult.tables || []).map((table) => asName(table)).filter(Boolean),
    );
    for (const sqlTable of collectSqlTableNames(scanResult.sqlStatements)) {
      tableNames.add(sqlTable);
    }
    for (const tableName of Array.from(tableNames).sort((a, b) => a.localeCompare(b))) {
      if (!addNode(tableName, 'TABLE', tableName)) {
        break;
      }
      if (!addEdge(currentProgram, tableName, 'USES_TABLE')) {
        break;
      }
    }

    for (const copyName of (scanResult.copyMembers || []).map((copy) => asName(copy)).filter(Boolean).sort((a, b) => a.localeCompare(b))) {
      if (!addNode(copyName, 'COPY', copyName)) {
        break;
      }
      if (!addEdge(currentProgram, copyName, 'INCLUDES_COPY')) {
        break;
      }
    }

    const calledPrograms = (scanResult.calls || [])
      .map((call) => asName(call))
      .filter((name) => Boolean(name) && isStaticProgramIdentifier(name))
      .sort((a, b) => a.localeCompare(b));

    if (calledPrograms.length > analysisLimits.maxProgramCallsPerProgram) {
      limitState.maxProgramCallsPerProgram = true;
      recordLimit(
        'CROSS_PROGRAM_MAX_CALLS_PER_PROGRAM_REACHED',
        `Cross-program graph truncated outgoing calls for ${currentProgram} after reaching the configured per-program call limit (${analysisLimits.maxProgramCallsPerProgram}).`,
        {
          program: currentProgram,
          maxProgramCallsPerProgram: analysisLimits.maxProgramCallsPerProgram,
          detectedCallCount: calledPrograms.length,
        },
      );
    }

    for (const calledProgram of calledPrograms.slice(0, analysisLimits.maxProgramCallsPerProgram)) {
      if (!addNode(calledProgram, 'PROGRAM', calledProgram)) {
        break;
      }
      if (!addEdge(currentProgram, calledProgram, 'CALLS_PROGRAM')) {
        break;
      }

      const calledResolved = resolveProgram(calledProgram, sourceIndex);
      if (!calledResolved || !calledResolved.path) {
        unresolvedPrograms.add(calledProgram);
        if (calledResolved && calledResolved.ambiguous) {
          ambiguousPrograms.add(calledProgram);
          if (calledResolved.warning) {
            notes.push(calledResolved.warning);
          }
        }
        continue;
      }
      walkProgram(calledProgram, depth + 1);
    }
  }

  walkProgram(root, 0);

  const sortedNodes = sortNodes(nodes);
  const sortedEdges = sortEdges(edges);
  const unresolved = Array.from(unresolvedPrograms).sort((a, b) => a.localeCompare(b));
  const ambiguous = Array.from(ambiguousPrograms).sort((a, b) => a.localeCompare(b));
  const truncated = Object.values(limitState).some(Boolean);

  const summary = {
    programCount: sortedNodes.filter((node) => node.type === 'PROGRAM').length,
    tableCount: sortedNodes.filter((node) => node.type === 'TABLE').length,
    copyMemberCount: sortedNodes.filter((node) => node.type === 'COPY').length,
    scannedFileCount: scannedFiles.size,
    edgeCount: sortedEdges.length,
    ambiguousPrograms: ambiguous,
    unresolvedPrograms: unresolved,
    truncated,
    limitDiagnosticsCount: diagnostics.length,
    limitsConfigured: analysisLimits,
    limitsReached: limitState,
  };

  return {
    rootProgram: root,
    nodes: sortedNodes,
    edges: sortedEdges,
    summary,
    sourceCatalog: sourceIndex.summary,
    ambiguousPrograms: ambiguous,
    unresolvedPrograms: unresolved,
    diagnostics,
    notes: Array.from(new Set(notes)).sort((a, b) => a.localeCompare(b)),
  };
}

module.exports = {
  buildCrossProgramGraph,
};
