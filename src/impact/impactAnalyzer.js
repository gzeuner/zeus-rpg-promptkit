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
const {
  buildReproducibilityMetadata,
  hashNormalizedValue,
  normalizeReproducibilitySettings,
} = require('../reproducibility/reproducibility');

function normalizeId(value) {
  return String(value || '').trim().toUpperCase();
}

function sortUnique(values) {
  return Array.from(new Set(Array.from(values || []).map((value) => normalizeId(value)).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

function loadGraph(graphPath) {
  if (!graphPath || !fs.existsSync(graphPath)) {
    throw new Error(`Cross-program graph file not found: ${graphPath}`);
  }

  const raw = fs.readFileSync(graphPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid graph JSON content.');
  }
  return parsed;
}

function buildNodeTypeMap(nodes) {
  const map = new Map();
  for (const node of nodes || []) {
    const id = normalizeId(node && node.id);
    const type = normalizeId(node && node.type);
    if (!id) continue;
    map.set(id, type || 'UNKNOWN');
  }
  return map;
}

function findProgramCallers(seedPrograms, reverseCallersMap) {
  const queue = [...seedPrograms];
  const visited = new Set(seedPrograms);
  const allUpstream = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    const callers = reverseCallersMap.get(current) || [];

    for (const caller of callers) {
      if (visited.has(caller)) continue;
      visited.add(caller);
      allUpstream.add(caller);
      queue.push(caller);
    }
  }

  return allUpstream;
}

function analyzeImpactFromGraph(graph, targetInput) {
  const target = normalizeId(targetInput);
  if (!target) {
    throw new Error('Impact analysis requires a non-empty target.');
  }

  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const nodeTypeMap = buildNodeTypeMap(nodes);
  const type = nodeTypeMap.get(target);
  if (!type) {
    throw new Error(`Target "${target}" not found in graph nodes.`);
  }

  const reverseCallersMap = new Map();
  const directProgramUsersByTable = new Map();
  const directCallersByProgram = new Map();

  for (const edge of edges) {
    const from = normalizeId(edge && edge.from);
    const to = normalizeId(edge && edge.to);
    const relation = normalizeId(edge && edge.type);
    if (!from || !to || !relation) continue;

    if (relation === 'CALLS_PROGRAM' && nodeTypeMap.get(from) === 'PROGRAM') {
      if (!reverseCallersMap.has(to)) reverseCallersMap.set(to, []);
      reverseCallersMap.get(to).push(from);

      if (!directCallersByProgram.has(to)) directCallersByProgram.set(to, []);
      directCallersByProgram.get(to).push(from);
    }

    if (relation === 'USES_TABLE' && nodeTypeMap.get(from) === 'PROGRAM') {
      if (!directProgramUsersByTable.has(to)) directProgramUsersByTable.set(to, []);
      directProgramUsersByTable.get(to).push(from);
    }
  }

  for (const [key, values] of reverseCallersMap.entries()) {
    reverseCallersMap.set(key, sortUnique(values));
  }
  for (const [key, values] of directProgramUsersByTable.entries()) {
    directProgramUsersByTable.set(key, sortUnique(values));
  }
  for (const [key, values] of directCallersByProgram.entries()) {
    directCallersByProgram.set(key, sortUnique(values));
  }

  if (type === 'TABLE') {
    const directPrograms = directProgramUsersByTable.get(target) || [];
    const indirectPrograms = sortUnique(findProgramCallers(directPrograms, reverseCallersMap));
    const totalAffectedPrograms = sortUnique([...directPrograms, ...indirectPrograms]).length;

    return {
      target,
      type,
      directPrograms,
      indirectPrograms,
      totalAffectedPrograms,
    };
  }

  if (type === 'PROGRAM') {
    const directCallers = directCallersByProgram.get(target) || [];
    const indirectCallers = sortUnique(findProgramCallers(directCallers, reverseCallersMap));

    return {
      target,
      type,
      directCallers,
      indirectCallers,
      totalAffectedPrograms: sortUnique([...directCallers, ...indirectCallers]).length,
    };
  }

  return {
    target,
    type,
    directPrograms: [],
    indirectPrograms: [],
    totalAffectedPrograms: 0,
  };
}

function toMarkdownList(values) {
  if (!values || values.length === 0) return '- None';
  return values.map((value) => `- ${value}`).join('\n');
}

function renderImpactMarkdown(result) {
  const isProgram = result.type === 'PROGRAM';
  const directLabel = isProgram ? 'Direct Callers' : 'Directly Affected Programs';
  const indirectLabel = isProgram ? 'Indirect Callers' : 'Indirectly Affected Programs';
  const directItems = isProgram ? result.directCallers : result.directPrograms;
  const indirectItems = isProgram ? result.indirectCallers : result.indirectPrograms;

  return `# Impact Analysis

Target: ${result.target}
Type: ${result.type}

## ${directLabel}

${toMarkdownList(directItems)}

## ${indirectLabel}

${toMarkdownList(indirectItems)}

Total affected programs: ${result.totalAffectedPrograms || 0}
`;
}

function generateImpactAnalysis({
  graphPath,
  target,
  jsonOutputPath,
  markdownOutputPath,
  reproducibility = null,
}) {
  const graph = loadGraph(graphPath);
  const reproducibilitySettings = normalizeReproducibilitySettings(reproducibility);
  const result = analyzeImpactFromGraph(graph, target);
  result.reproducibility = buildReproducibilityMetadata(
    reproducibilitySettings,
    hashNormalizedValue({
      target: result.target,
      type: result.type,
      directPrograms: result.directPrograms || [],
      indirectPrograms: result.indirectPrograms || [],
      directCallers: result.directCallers || [],
      indirectCallers: result.indirectCallers || [],
      totalAffectedPrograms: result.totalAffectedPrograms || 0,
    }),
  );

  fs.writeFileSync(jsonOutputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownOutputPath, renderImpactMarkdown(result), 'utf8');
  return result;
}

module.exports = {
  generateImpactAnalysis,
  analyzeImpactFromGraph,
  renderImpactMarkdown,
  normalizeId,
};
