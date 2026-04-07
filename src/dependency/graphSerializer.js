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
function toMermaidId(value) {
  const normalized = String(value || '').trim().replace(/[^A-Za-z0-9_]/g, '_');
  if (!normalized) return 'NODE';
  if (/^[0-9]/.test(normalized)) {
    return `N_${normalized}`;
  }
  return normalized;
}

function escapeMermaidLabel(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function renderMermaid(graph) {
  const lines = ['graph TD'];
  const nodes = (graph && graph.nodes) || [];
  const edges = (graph && graph.edges) || [];

  for (const node of nodes) {
    const nodeId = toMermaidId(node.id);
    const nodeLabel = String(node.label || node.id || '');
    const label = escapeMermaidLabel(`${nodeLabel} (${node.type})`);
    lines.push(`${nodeId}["${label}"]`);
  }

  if (nodes.length > 0 && edges.length > 0) {
    lines.push('');
  }

  for (const edge of edges) {
    const from = toMermaidId(edge.from);
    const to = toMermaidId(edge.to);
    lines.push(`${from} -->|${edge.type}| ${to}`);
  }

  return `${lines.join('\n')}\n`;
}

function renderJson(graph) {
  return `${JSON.stringify(graph, null, 2)}\n`;
}

function renderMarkdown(graph) {
  const summary = (graph && graph.summary) || {};
  return `# Dependency Graph

The following diagram shows dependencies for program ${graph && graph.program ? graph.program : 'UNKNOWN'}.

Tables: ${summary.tableCount || 0}
Programs Called: ${summary.programCallCount || 0}
Copy Members: ${summary.copyMemberCount || 0}
Modules: ${summary.moduleCount || 0}
Service Programs: ${summary.serviceProgramCount || 0}
Binding Directories: ${summary.bindingDirectoryCount || 0}
Bind Relationships: ${summary.bindEdgeCount || 0}

\`\`\`mermaid
${renderMermaid(graph).trim()}
\`\`\`
`;
}

function renderCrossProgramMarkdown(graph) {
  const summary = (graph && graph.summary) || {};
  const unresolved = (graph && graph.unresolvedPrograms) || [];
  const unresolvedCount = Array.isArray(summary.unresolvedPrograms)
    ? summary.unresolvedPrograms.length
    : (Number(summary.unresolvedPrograms) || unresolved.length || 0);
  const unresolvedSection = unresolved.length > 0
    ? `## Unresolved Programs

${unresolved.map((name) => `- ${name}`).join('\n')}

`
    : '';

  return `# Cross-Program Dependency Graph

Root Program: ${graph && graph.rootProgram ? graph.rootProgram : 'UNKNOWN'}

## Summary

Programs: ${summary.programCount || 0}
Tables: ${summary.tableCount || 0}
Copy Members: ${summary.copyMemberCount || 0}
Edges: ${summary.edgeCount || 0}
Unresolved Programs: ${unresolvedCount}

${unresolvedSection}## Graph

\`\`\`mermaid
${renderMermaid(graph).trim()}
\`\`\`
`;
}

module.exports = {
  renderJson,
  renderMermaid,
  renderMarkdown,
  renderCrossProgramMarkdown,
};
