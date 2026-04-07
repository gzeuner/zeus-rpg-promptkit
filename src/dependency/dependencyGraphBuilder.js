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
function normalizeIdentifier(value) {
  return String(value || '').trim().toUpperCase();
}

function extractName(entry) {
  if (!entry) return '';
  if (typeof entry === 'string') return entry;
  if (typeof entry === 'object' && entry.name) return entry.name;
  return '';
}

function collectSqlTableNames(sqlBlock) {
  const names = new Set();
  for (const statement of (sqlBlock && sqlBlock.statements) || []) {
    for (const table of statement.tables || []) {
      const normalized = normalizeIdentifier(table);
      if (normalized) names.add(normalized);
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

function sortNodes(nodes) {
  return [...nodes].sort((a, b) => {
    if (a.id !== b.id) return a.id.localeCompare(b.id);
    return a.type.localeCompare(b.type);
  });
}

function sortEdges(edges) {
  return [...edges].sort((a, b) => {
    if (a.from !== b.from) return a.from.localeCompare(b.from);
    if (a.to !== b.to) return a.to.localeCompare(b.to);
    return a.type.localeCompare(b.type);
  });
}

function buildDependencyGraph(context) {
  const program = normalizeIdentifier(context && context.program);
  if (!program) {
    throw new Error('Dependency graph generation requires context.program');
  }

  const dependencies = (context && context.dependencies) || {};
  const bindingAnalysis = (context && context.bindingAnalysis) || {};
  const nodeSet = new Set();
  const edgeSet = new Set();
  const nodes = [];
  const edges = [];

  function addNode(id, type, label = null) {
    const normalizedId = normalizeIdentifier(id);
    const normalizedType = normalizeIdentifier(type);
    if (!normalizedId || !normalizedType) return;
    const key = `${normalizedId}|${normalizedType}`;
    if (nodeSet.has(key)) return;
    nodeSet.add(key);
    nodes.push({ id: normalizedId, type: normalizedType, label: label || normalizedId });
  }

  function addEdge(from, to, type) {
    const normalizedFrom = normalizeIdentifier(from);
    const normalizedTo = normalizeIdentifier(to);
    const normalizedType = normalizeIdentifier(type);
    if (!normalizedFrom || !normalizedTo || !normalizedType) return;
    const key = `${normalizedFrom}|${normalizedTo}|${normalizedType}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({ from: normalizedFrom, to: normalizedTo, type: normalizedType });
  }

  addNode(program, 'PROGRAM');

  const dependencyTables = (dependencies.tables || [])
    .map((table) => normalizeIdentifier(extractName(table)))
    .filter(Boolean);
  const sqlTables = collectSqlTableNames((context && context.sql) || {});
  const tableNames = Array.from(new Set([...dependencyTables, ...sqlTables])).sort((a, b) => a.localeCompare(b));
  for (const tableName of tableNames) {
    addNode(tableName, 'TABLE');
    addEdge(program, tableName, 'USES_TABLE');
  }

  const programCalls = (dependencies.programCalls || [])
    .map((call) => normalizeIdentifier(extractName(call)))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  for (const calledProgram of programCalls) {
    addNode(calledProgram, 'PROGRAM');
    addEdge(program, calledProgram, 'CALLS_PROGRAM');
  }

  const copyMembers = (dependencies.copyMembers || [])
    .map((copy) => normalizeIdentifier(extractName(copy)))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  for (const copyMember of copyMembers) {
    addNode(copyMember, 'COPY');
    addEdge(program, copyMember, 'INCLUDES_COPY');
  }

  const modules = (bindingAnalysis.modules || [])
    .map((module) => ({
      id: `MODULE_${normalizeIdentifier(module.name)}`,
      label: normalizeIdentifier(module.name),
      type: normalizeIdentifier(module.kind || 'MODULE'),
      bindingDirectories: (module.bindingDirectories || []).map((entry) => normalizeIdentifier(entry)).filter(Boolean),
      servicePrograms: (module.servicePrograms || []).map((entry) => normalizeIdentifier(entry)).filter(Boolean),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const module of modules) {
    addNode(module.id, 'MODULE', module.label);
    addEdge(program, module.id, 'HAS_MODULE');
    for (const bindingDirectory of module.bindingDirectories) {
      const bindingDirectoryId = `BNDDIR_${bindingDirectory}`;
      addNode(bindingDirectoryId, 'BINDING_DIRECTORY', bindingDirectory);
      addEdge(module.id, bindingDirectoryId, 'USES_BINDING_DIRECTORY');
    }
    for (const serviceProgram of module.servicePrograms) {
      const serviceProgramId = `SRVPGM_${serviceProgram}`;
      addNode(serviceProgramId, 'SERVICE_PROGRAM', serviceProgram);
      addEdge(module.id, serviceProgramId, 'BINDS_SERVICE_PROGRAM');
    }
  }

  const servicePrograms = (bindingAnalysis.servicePrograms || [])
    .map((serviceProgram) => normalizeIdentifier(extractName(serviceProgram)))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  for (const serviceProgram of servicePrograms) {
    addNode(`SRVPGM_${serviceProgram}`, 'SERVICE_PROGRAM', serviceProgram);
  }

  const bindingDirectories = (bindingAnalysis.bindingDirectories || [])
    .map((bindingDirectory) => normalizeIdentifier(extractName(bindingDirectory)))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  for (const bindingDirectory of bindingDirectories) {
    addNode(`BNDDIR_${bindingDirectory}`, 'BINDING_DIRECTORY', bindingDirectory);
  }

  const sortedNodes = sortNodes(nodes);
  const sortedEdges = sortEdges(edges);

  return {
    program,
    nodes: sortedNodes,
    edges: sortedEdges,
    summary: {
      nodeCount: sortedNodes.length,
      edgeCount: sortedEdges.length,
      tableCount: tableNames.length,
      programCallCount: programCalls.length,
      copyMemberCount: copyMembers.length,
      moduleCount: modules.length,
      serviceProgramCount: servicePrograms.length,
      bindingDirectoryCount: bindingDirectories.length,
      bindEdgeCount: sortedEdges.filter((edge) => ['HAS_MODULE', 'USES_BINDING_DIRECTORY', 'BINDS_SERVICE_PROGRAM'].includes(edge.type)).length,
    },
  };
}

function buildGraphSummary(graph) {
  return {
    nodeCount: Number(graph && graph.summary && graph.summary.nodeCount) || 0,
    edgeCount: Number(graph && graph.summary && graph.summary.edgeCount) || 0,
    tableCount: Number(graph && graph.summary && graph.summary.tableCount) || 0,
    programCallCount: Number(graph && graph.summary && graph.summary.programCallCount) || 0,
    copyMemberCount: Number(graph && graph.summary && graph.summary.copyMemberCount) || 0,
    moduleCount: Number(graph && graph.summary && graph.summary.moduleCount) || 0,
    serviceProgramCount: Number(graph && graph.summary && graph.summary.serviceProgramCount) || 0,
    bindingDirectoryCount: Number(graph && graph.summary && graph.summary.bindingDirectoryCount) || 0,
    bindEdgeCount: Number(graph && graph.summary && graph.summary.bindEdgeCount) || 0,
    files: {
      json: 'dependency-graph.json',
      mermaid: 'dependency-graph.mmd',
      markdown: 'dependency-graph.md',
    },
  };
}

module.exports = {
  buildDependencyGraph,
  buildGraphSummary,
};
