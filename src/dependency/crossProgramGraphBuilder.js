const { scanSourceFiles } = require('../scanner/rpgScanner');
const { buildSourceIndex, normalizeProgramName, resolveProgram } = require('./programResolver');

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
}) {
  const root = normalizeProgramName(rootProgram);
  if (!root) {
    throw new Error('Cross-program graph generation requires rootProgram');
  }

  const sourceIndex = buildSourceIndex(sourceFiles || []);
  const visitedPrograms = new Set();
  const scannedFiles = new Set();
  const unresolvedPrograms = new Set();
  const notes = [];

  const nodeSet = new Set();
  const edgeSet = new Set();
  const nodes = [];
  const edges = [];

  function addNode(id, type, label) {
    const normalizedId = normalizeProgramName(id);
    const normalizedType = normalizeProgramName(type);
    const normalizedLabel = normalizeProgramName(label || id);
    if (!normalizedId || !normalizedType) return;

    const key = `${normalizedId}|${normalizedType}`;
    if (nodeSet.has(key)) return;
    nodeSet.add(key);
    nodes.push({
      id: normalizedId,
      type: normalizedType,
      label: normalizedLabel,
    });
  }

  function addEdge(from, to, type) {
    const normalizedFrom = normalizeProgramName(from);
    const normalizedTo = normalizeProgramName(to);
    const normalizedType = normalizeProgramName(type);
    if (!normalizedFrom || !normalizedTo || !normalizedType) return;

    const key = `${normalizedFrom}|${normalizedTo}|${normalizedType}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({
      from: normalizedFrom,
      to: normalizedTo,
      type: normalizedType,
    });
  }

  function walkProgram(programName) {
    const currentProgram = normalizeProgramName(programName);
    if (!currentProgram) return;
    if (visitedPrograms.has(currentProgram)) return;
    visitedPrograms.add(currentProgram);
    addNode(currentProgram, 'PROGRAM', currentProgram);

    const resolved = resolveProgram(currentProgram, sourceIndex);
    if (!resolved || !resolved.path) {
      if (currentProgram !== root) {
        unresolvedPrograms.add(currentProgram);
      }
      return;
    }
    if (resolved.warning) {
      notes.push(resolved.warning);
    }

    if (scannedFiles.has(resolved.path)) {
      return;
    }
    scannedFiles.add(resolved.path);

    const scanResult = scanSourceFiles([resolved.path]);

    const tableNames = new Set(
      (scanResult.tables || []).map((table) => asName(table)).filter(Boolean),
    );
    for (const sqlTable of collectSqlTableNames(scanResult.sqlStatements)) {
      tableNames.add(sqlTable);
    }
    for (const tableName of Array.from(tableNames).sort((a, b) => a.localeCompare(b))) {
      addNode(tableName, 'TABLE', tableName);
      addEdge(currentProgram, tableName, 'USES_TABLE');
    }

    for (const copyName of (scanResult.copyMembers || []).map((copy) => asName(copy)).filter(Boolean).sort((a, b) => a.localeCompare(b))) {
      addNode(copyName, 'COPY', copyName);
      addEdge(currentProgram, copyName, 'INCLUDES_COPY');
    }

    const calledPrograms = (scanResult.calls || [])
      .map((call) => asName(call))
      .filter((name) => Boolean(name) && isStaticProgramIdentifier(name))
      .sort((a, b) => a.localeCompare(b));

    for (const calledProgram of calledPrograms) {
      addNode(calledProgram, 'PROGRAM', calledProgram);
      addEdge(currentProgram, calledProgram, 'CALLS_PROGRAM');

      const calledResolved = resolveProgram(calledProgram, sourceIndex);
      if (!calledResolved || !calledResolved.path) {
        unresolvedPrograms.add(calledProgram);
        continue;
      }
      if (calledResolved.warning) {
        notes.push(calledResolved.warning);
      }
      walkProgram(calledProgram);
    }
  }

  walkProgram(root);

  const sortedNodes = sortNodes(nodes);
  const sortedEdges = sortEdges(edges);
  const unresolved = Array.from(unresolvedPrograms).sort((a, b) => a.localeCompare(b));

  const summary = {
    programCount: sortedNodes.filter((node) => node.type === 'PROGRAM').length,
    tableCount: sortedNodes.filter((node) => node.type === 'TABLE').length,
    copyMemberCount: sortedNodes.filter((node) => node.type === 'COPY').length,
    edgeCount: sortedEdges.length,
    unresolvedPrograms: unresolved.length,
  };

  return {
    rootProgram: root,
    nodes: sortedNodes,
    edges: sortedEdges,
    summary,
    unresolvedPrograms: unresolved,
    notes: Array.from(new Set(notes)).sort((a, b) => a.localeCompare(b)),
  };
}

module.exports = {
  buildCrossProgramGraph,
};
