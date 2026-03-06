function buildDependencyGraph(context) {
  const nodes = [];
  const edges = [];
  const nodeSet = new Set();
  const edgeSet = new Set();

  function addNode(id, label, type) {
    const key = `${id}|${type}`;
    if (nodeSet.has(key)) return;
    nodeSet.add(key);
    nodes.push({ id, label, type });
  }

  function addEdge(from, to, relation) {
    const key = `${from}|${to}|${relation}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({ from, to, relation });
  }

  const programName = context.program;
  addNode(`PGM:${programName}`, programName, 'PROGRAM');

  for (const table of context.dependencies.tables || []) {
    const id = `TABLE:${table.name}`;
    addNode(id, table.name, 'TABLE');
    addEdge(`PGM:${programName}`, id, 'USES');
  }

  for (const call of context.dependencies.programCalls || []) {
    const id = `CALL:${call.name}`;
    addNode(id, call.name, call.kind || 'PROGRAM');
    addEdge(`PGM:${programName}`, id, 'CALLS');
  }

  for (const copy of context.dependencies.copyMembers || []) {
    const id = `COPY:${copy.name}`;
    addNode(id, copy.name, 'COPY');
    addEdge(`PGM:${programName}`, id, 'INCLUDES');
  }

  nodes.sort((a, b) => a.id.localeCompare(b.id));
  edges.sort((a, b) => {
    if (a.from !== b.from) return a.from.localeCompare(b.from);
    if (a.to !== b.to) return a.to.localeCompare(b.to);
    return a.relation.localeCompare(b.relation);
  });

  return { nodes, edges };
}

function safeMermaidId(id) {
  return id.replace(/[^A-Za-z0-9_]/g, '_');
}

function renderMermaid(graph) {
  const lines = ['graph TD'];
  for (const node of graph.nodes) {
    const nodeId = safeMermaidId(node.id);
    lines.push(`  ${nodeId}[${node.label}]`);
  }
  for (const edge of graph.edges) {
    const fromId = safeMermaidId(edge.from);
    const toId = safeMermaidId(edge.to);
    lines.push(`  ${fromId} -->|${edge.relation}| ${toId}`);
  }
  return `${lines.join('\n')}\n`;
}

function renderMarkdown(graph, context) {
  return `# Dependency Graph\n\n- Program: ${context.program}\n- Nodes: ${graph.nodes.length}\n- Edges: ${graph.edges.length}\n\n\`\`\`mermaid\n${renderMermaid(graph).trim()}\n\`\`\`\n`;
}

function buildGraphSummary(graph) {
  return {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    files: {
      json: 'dependency-graph.json',
      mermaid: 'dependency-graph.mmd',
      markdown: 'dependency-graph.md',
    },
  };
}

module.exports = {
  buildDependencyGraph,
  renderMermaid,
  renderMarkdown,
  buildGraphSummary,
};

