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

const VIS_NETWORK_CDN = 'https://unpkg.com/vis-network/standalone/umd/vis-network.min.js';

function readGraph(graphPath) {
  if (!graphPath || !fs.existsSync(graphPath)) {
    throw new Error(`Cross-program graph file not found: ${graphPath}`);
  }
  const raw = fs.readFileSync(graphPath, 'utf8');
  return JSON.parse(raw);
}

function escapeInlineJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function renderSummary(graph) {
  const summary = (graph && graph.summary) || {};
  const unresolvedCount = Array.isArray(summary.unresolvedPrograms)
    ? summary.unresolvedPrograms.length
    : (Number(summary.unresolvedPrograms) || 0);

  return [
    `Programs discovered: ${Number(summary.programCount) || 0}`,
    `Tables referenced: ${Number(summary.tableCount) || 0}`,
    `Copy members: ${Number(summary.copyMemberCount) || 0}`,
    `Edges: ${Number(summary.edgeCount) || 0}`,
    `Unresolved programs: ${unresolvedCount}`,
  ].join(' | ');
}

function renderHtml(graph) {
  const unresolvedPrograms = (graph && graph.unresolvedPrograms) || [];
  const unresolvedSection = unresolvedPrograms.length > 0
    ? `<div class="unresolved"><strong>Unresolved Programs:</strong> ${unresolvedPrograms.join(', ')}</div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Architecture Viewer</title>
  <script src="${VIS_NETWORK_CDN}"></script>
  <style>
    body {
      margin: 0;
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      background: #f5f7fb;
      color: #1f2937;
    }
    header {
      padding: 16px 20px 8px 20px;
      border-bottom: 1px solid #d6dde8;
      background: #ffffff;
    }
    h1 {
      margin: 0 0 8px 0;
      font-size: 22px;
    }
    .summary {
      font-size: 14px;
      color: #334155;
      margin-bottom: 6px;
    }
    .help {
      font-size: 12px;
      color: #64748b;
      margin-bottom: 8px;
    }
    .unresolved {
      font-size: 13px;
      color: #9f1239;
      margin: 6px 0;
    }
    #network {
      height: calc(100vh - 126px);
      min-height: 540px;
      margin: 14px;
      border: 1px solid #d6dde8;
      border-radius: 8px;
      background: #ffffff;
    }
  </style>
</head>
<body>
  <header>
    <h1>Architecture Viewer</h1>
    <div class="summary">${renderSummary(graph)}</div>
    <div class="help">Mouse wheel: zoom | Drag canvas: pan | Drag nodes: reposition | Click node: highlight connected edges | Double-click node: center</div>
    ${unresolvedSection}
  </header>
  <div id="network"></div>
  <script>
    const graphData = ${escapeInlineJson(graph)};

    const groupStyle = {
      PROGRAM: { color: { background: '#2563eb', border: '#1d4ed8' }, font: { color: '#ffffff' }, shape: 'box' },
      TABLE: { color: { background: '#16a34a', border: '#15803d' }, font: { color: '#ffffff' }, shape: 'box' },
      COPY: { color: { background: '#ea580c', border: '#c2410c' }, font: { color: '#ffffff' }, shape: 'box' }
    };
    const nodeColorByGroup = {
      PROGRAM: { background: '#2563eb', border: '#1d4ed8', font: '#ffffff' },
      TABLE: { background: '#16a34a', border: '#15803d', font: '#ffffff' },
      COPY: { background: '#ea580c', border: '#c2410c', font: '#ffffff' }
    };

    function computeLevels(graph) {
      const levels = {};
      const root = graph.rootProgram;
      if (root) {
        levels[root] = 0;
      }

      const callsEdges = (graph.edges || []).filter((edge) => edge.type === 'CALLS_PROGRAM');
      const queue = root ? [root] : [];
      const visited = new Set(queue);

      while (queue.length > 0) {
        const current = queue.shift();
        const currentLevel = levels[current] || 0;
        for (const edge of callsEdges) {
          if (edge.from !== current) continue;
          if (!(edge.to in levels)) {
            levels[edge.to] = currentLevel + 1;
          } else {
            levels[edge.to] = Math.min(levels[edge.to], currentLevel + 1);
          }
          if (!visited.has(edge.to)) {
            visited.add(edge.to);
            queue.push(edge.to);
          }
        }
      }

      for (const edge of graph.edges || []) {
        if (!(edge.from in levels)) {
          levels[edge.from] = 0;
        }
        if (!(edge.to in levels)) {
          levels[edge.to] = levels[edge.from] + 1;
        }
      }

      return levels;
    }

    const levels = computeLevels(graphData);
    const nodes = new vis.DataSet((graphData.nodes || []).map((node) => ({
      id: node.id,
      label: node.id + '\\n(' + node.type + ')',
      group: node.type,
      title: node.id + ' (' + node.type + ')',
      level: levels[node.id] !== undefined ? levels[node.id] : 0
    })));

    const edges = new vis.DataSet((graphData.edges || []).map((edge, idx) => ({
      id: 'E' + idx,
      from: edge.from,
      to: edge.to,
      label: edge.type,
      arrows: 'to',
      smooth: { type: 'cubicBezier', roundness: 0.2 },
      color: { color: '#94a3b8', highlight: '#0f172a', hover: '#1e293b' },
      width: 1.5
    })));

    const network = new vis.Network(
      document.getElementById('network'),
      { nodes, edges },
      {
        layout: {
          hierarchical: {
            enabled: true,
            direction: 'UD',
            sortMethod: 'directed',
            levelSeparation: 130,
            nodeSpacing: 170
          }
        },
        groups: groupStyle,
        interaction: {
          hover: true,
          dragNodes: true,
          dragView: true,
          zoomView: true,
          multiselect: false
        },
        physics: {
          enabled: false
        },
        edges: {
          font: { align: 'middle', size: 11, color: '#334155' }
        },
        nodes: {
          borderWidth: 1.5,
          margin: 10,
          font: { size: 12, face: 'Segoe UI' }
        }
      }
    );

    function resetEdgeHighlight() {
      const updates = edges.get().map((edge) => ({
        id: edge.id,
        width: 1.5,
        color: { color: '#94a3b8', highlight: '#0f172a', hover: '#1e293b' }
      }));
      edges.update(updates);
    }

    function resetNodeHighlight() {
      const updates = nodes.get().map((node) => ({
        id: node.id,
        color: null,
        font: null,
        borderWidth: 1.5
      }));
      nodes.update(updates);
    }

    network.on('click', (params) => {
      if (!params.nodes || params.nodes.length === 0) {
        resetEdgeHighlight();
        resetNodeHighlight();
        return;
      }

      const selectedNode = params.nodes[0];
      const relatedNodes = new Set([selectedNode, ...(network.getConnectedNodes(selectedNode) || [])]);
      const connected = new Set(network.getConnectedEdges(selectedNode));
      const updates = edges.get().map((edge) => ({
        id: edge.id,
        width: connected.has(edge.id) ? 3 : 1,
        color: connected.has(edge.id)
          ? { color: '#0f172a', highlight: '#0f172a', hover: '#0f172a' }
          : { color: '#cbd5e1', highlight: '#94a3b8', hover: '#94a3b8' }
      }));
      edges.update(updates);

      const nodeUpdates = nodes.get().map((node) => {
        if (relatedNodes.has(node.id)) {
          const groupColor = nodeColorByGroup[node.group] || { background: '#64748b', border: '#475569', font: '#ffffff' };
          return {
            id: node.id,
            color: {
              background: groupColor.background,
              border: groupColor.border
            },
            font: { color: groupColor.font },
            borderWidth: node.id === selectedNode ? 3 : 2
          };
        }
        return {
          id: node.id,
          color: { background: '#e2e8f0', border: '#cbd5e1' },
          font: { color: '#64748b' },
          borderWidth: 1
        };
      });
      nodes.update(nodeUpdates);
    });

    network.on('doubleClick', (params) => {
      if (!params.nodes || params.nodes.length === 0) return;
      network.focus(params.nodes[0], {
        scale: 1.1,
        animation: {
          duration: 350,
          easingFunction: 'easeInOutQuad'
        }
      });
    });
  </script>
</body>
</html>
`;
}

function generateArchitectureViewer({ graphPath, outputPath }) {
  const graph = readGraph(graphPath);
  const html = renderHtml(graph);
  fs.writeFileSync(outputPath, html, 'utf8');
  return outputPath;
}

module.exports = {
  generateArchitectureViewer,
};
