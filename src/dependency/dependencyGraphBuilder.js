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
  const nodeSet = new Set();
  const edgeSet = new Set();
  const nodes = [];
  const edges = [];

  function addNode(id, type) {
    const normalizedId = normalizeIdentifier(id);
    const normalizedType = normalizeIdentifier(type);
    if (!normalizedId || !normalizedType) return;
    const key = `${normalizedId}|${normalizedType}`;
    if (nodeSet.has(key)) return;
    nodeSet.add(key);
    nodes.push({ id: normalizedId, type: normalizedType });
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
