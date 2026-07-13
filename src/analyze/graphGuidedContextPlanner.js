/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/

'use strict';

const { estimateTokensFromObject, estimateTokens } = require('../ai/tokenEstimator');
const { buildEvidenceGraph } = require('./evidenceGraphBuilder');

function normalizeName(name) {
  return String(name || '')
    .trim()
    .toUpperCase();
}

function stableHash(str) {
  // Simple stable hash for content (not cryptographic)
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return 'h' + Math.abs(hash).toString(16);
}

function getEvidenceLocations(evidenceList) {
  return (evidenceList || [])
    .map(e => ({
      file: e.file || e.path || null,
      startLine: Number(e.startLine || e.line || 0) || null,
      endLine: Number(e.endLine || e.line || 0) || null,
    }))
    .filter(l => l.file);
}

function findExactMatches(canonical, targets) {
  const selected = [];
  const targetSet = new Set(targets.map(normalizeName));
  const entities = canonical.entities || {};

  // Programs, procedures, tables, fields, etc.
  for (const [kind, list] of Object.entries(entities)) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const name = normalizeName(item.name);
      if (targetSet.has(name) || targetSet.has(item.id)) {
        selected.push({
          id: item.id || `${kind}:${name}`,
          type: kind.toUpperCase().replace(/S$/, ''),
          name: item.name,
          kind: item.kind || null,
          reasons: [`exact-${kind}-match`],
          locations: getEvidenceLocations(item.evidence),
          contentHash: stableHash(JSON.stringify(item)),
          confidence: item.confidence || 'HIGH',
          provenance: item.evidence || [],
        });
      }
    }
  }

  // Source files by name
  for (const sf of canonical.sourceFiles || []) {
    const name = normalizeName(sf.path);
    if (targetSet.has(name)) {
      selected.push({
        id: sf.id || `SOURCE:${sf.path}`,
        type: 'SOURCE',
        name: sf.path,
        reasons: ['exact-source-match'],
        locations: [{ file: sf.path, startLine: 1 }],
        contentHash: stableHash(sf.path),
        confidence: 'HIGH',
      });
    }
  }

  return selected;
}

function traverseGraph(evidenceGraph, seedIds, maxDepth = 2, allowedEdges = null) {
  const paths = [];
  const visited = new Set();
  const queue = seedIds.map(id => ({ id, depth: 0, path: [id] }));

  const edgeAllow = allowedEdges ? new Set(allowedEdges) : null;

  while (queue.length > 0) {
    const { id, depth, path } = queue.shift();
    if (depth > maxDepth || visited.has(id)) continue;
    visited.add(id);

    const neighbors = (evidenceGraph.edges || []).filter(e => {
      if (e.from === id || e.to === id) {
        return !edgeAllow || edgeAllow.has(e.type);
      }
      return false;
    });

    for (const edge of neighbors) {
      const other = edge.from === id ? edge.to : edge.from;
      if (!visited.has(other)) {
        const newPath = [...path, other, edge.type];
        paths.push(newPath);
        queue.push({ id: other, depth: depth + 1, path: newPath });
      }
    }
  }

  return paths;
}

function lexicalRank(items, goal) {
  const goalTerms = normalizeName(goal).split(/\s+/);
  return items
    .map(item => {
      const text = normalizeName(item.name || '') + ' ' + (item.reasons || []).join(' ');
      let score = 0;
      for (const term of goalTerms) {
        if (text.includes(term)) score += 10;
      }
      return { ...item, lexicalScore: score };
    })
    .sort((a, b) => b.lexicalScore - a.lexicalScore);
}

function dedupeByLocationOrHash(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key =
      item.locations && item.locations[0]
        ? `${item.locations[0].file}:${item.locations[0].startLine}:${item.contentHash || ''}`
        : item.contentHash || item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function estimatePlanTokens(plan, options = {}) {
  // Rough: use the estimator on selected + metadata
  const payload = {
    goal: plan.goal,
    selected: plan.selected.map(s => ({
      name: s.name,
      text: s.locations ? s.locations.map(l => l.file).join(',') : '',
    })),
    reasons: plan.selected.flatMap(s => s.reasons || []),
  };
  return estimateTokensFromObject(payload, options);
}

function buildContextPlan({
  canonicalAnalysis,
  evidenceGraph,
  goal,
  targets = [],
  tokenBudget = 8000,
  options = {},
}) {
  if (!canonicalAnalysis) throw new Error('canonicalAnalysis required');

  const normalizedTargets = (targets || []).map(normalizeName).filter(Boolean);
  const planId = `plan:${normalizeName(goal || 'unknown')}:${normalizeName((targets || []).join(',')) || 'default'}`;

  // 1. Exact matches
  let selected = findExactMatches(
    canonicalAnalysis,
    normalizedTargets.length ? normalizedTargets : [normalizeName(goal)]
  );

  // 2. Graph neighborhood if graph available
  let graphPaths = [];
  if (evidenceGraph && evidenceGraph.nodes && selected.length > 0) {
    const seeds = selected.map(s => s.id).filter(Boolean);
    graphPaths = traverseGraph(
      evidenceGraph,
      seeds,
      options.maxGraphDepth || 2,
      options.allowedEdgeTypes || null
    );
    // Add graph neighbors as candidates
    const neighborIds = new Set();
    graphPaths.forEach(p =>
      p.forEach(id => {
        if (typeof id === 'string' && !id.includes(':')) neighborIds.add(id);
      })
    );
    // naive: add some from graph nodes if matching targets loosely
    for (const node of evidenceGraph.nodes || []) {
      if (normalizedTargets.some(t => normalizeName(node.name).includes(t))) {
        selected.push({
          id: node.id,
          type: node.type,
          name: node.name,
          reasons: ['graph-neighbor'],
          locations: node.locations || [],
          contentHash: stableHash(node.id),
          confidence: node.confidence || 'MEDIUM',
          graphPath: graphPaths.find(p => p.includes(node.id)) || [],
        });
      }
    }
  }

  // 3. Lexical fallback / ranking
  selected = lexicalRank(selected, goal);

  // 4. Dedupe
  selected = dedupeByLocationOrHash(selected);

  // 5. Final deterministic sort for reproducibility
  selected.sort((a, b) => {
    if (a.id !== b.id) return String(a.id).localeCompare(String(b.id));
    return 0;
  });

  // 5. Budget: select within token budget, report omissions
  const budget = Number(tokenBudget) || 8000;
  const kept = [];
  let used = 0;
  const omissions = [];

  for (const item of selected) {
    const itemTokens = estimateTokens(JSON.stringify(item), { charsPerToken: 4 });
    if (used + itemTokens <= budget) {
      kept.push({ ...item, estimatedTokens: itemTokens });
      used += itemTokens;
    } else {
      omissions.push({
        id: item.id,
        name: item.name,
        reason: 'token-budget',
        estimatedTokens: itemTokens,
      });
    }
  }

  // Unresolved from canonical
  const unresolved = (canonicalAnalysis.unresolvedPrograms || []).map(u => ({
    symbol: u,
    type: 'DYNAMIC_UNRESOLVED',
  }));

  const plan = {
    schemaVersion: 1,
    kind: 'context-plan',
    planId,
    goal: String(goal || ''),
    targets: normalizedTargets,
    tokenBudget: budget,
    estimatedTokensUsed: used,
    selected: kept,
    omissions,
    graphPaths: graphPaths.slice(0, 50), // bound
    unresolved,
    confidence: kept.length > 0 ? 'MEDIUM' : 'LOW',
    reasonsSummary: kept.flatMap(k => k.reasons || []).slice(0, 20),
    generatedAt: new Date(0).toISOString(), // deterministic; overwritten by repro if needed
    generator: 'graph-guided-context-planner@v1',
  };

  return plan;
}

module.exports = {
  buildContextPlan,
};
