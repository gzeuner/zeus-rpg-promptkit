'use strict';

/**
 * Deterministic graph neighborhood expansion from seed symbol ids.
 * Uses relationship list from a published snapshot.
 */

function buildAdjacency(relationships) {
  /** @type {Map<string, Set<string>>} */
  const adj = new Map();
  function link(a, b) {
    if (!a || !b) return;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
  }
  for (const rel of relationships || []) {
    link(rel.fromSymbolId, rel.toSymbolId);
  }
  return adj;
}

/**
 * @param {string[]} seedIds
 * @param {Array} relationships
 * @param {number} hops
 * @returns {{ nodes: string[], edges: Array, frontierByHop: string[][] }}
 */
function expandNeighborhood(seedIds, relationships, hops = 1) {
  const adj = buildAdjacency(relationships);
  const visited = new Set();
  let frontier = Array.from(new Set((seedIds || []).filter(Boolean))).sort();
  const frontierByHop = [];
  for (const id of frontier) visited.add(id);

  const maxHops = Math.max(0, Number(hops) || 0);
  for (let h = 0; h < maxHops; h += 1) {
    const next = new Set();
    for (const id of frontier) {
      const neighbors = adj.get(id);
      if (!neighbors) continue;
      for (const n of Array.from(neighbors).sort()) {
        if (!visited.has(n)) {
          visited.add(n);
          next.add(n);
        }
      }
    }
    frontier = Array.from(next).sort();
    frontierByHop.push(frontier);
    if (frontier.length === 0) break;
  }

  const nodeSet = visited;
  const edges = (relationships || [])
    .filter(r => nodeSet.has(r.fromSymbolId) && nodeSet.has(r.toSymbolId))
    .map(r => ({
      relationshipId: r.relationshipId,
      fromSymbolId: r.fromSymbolId,
      toSymbolId: r.toSymbolId,
      relationshipType: r.relationshipType,
    }))
    .sort((a, b) => a.relationshipId.localeCompare(b.relationshipId));

  return {
    nodes: Array.from(nodeSet).sort(),
    edges,
    frontierByHop,
  };
}

/**
 * Seed symbol ids from lexical hits (docId patterns used by engine search docs).
 */
function seedIdsFromHits(hits) {
  const seeds = new Set();
  for (const hit of hits || []) {
    const id = hit.docId || hit.id || '';
    if (id.startsWith('doc:symbol:')) {
      seeds.add(id.slice('doc:symbol:'.length));
    } else if (id.startsWith('sym:')) {
      seeds.add(id);
    } else if (hit.kind === 'symbol' && hit.fields && hit.fields.symbolId) {
      seeds.add(hit.fields.symbolId);
    }
    // Program-like titles from source-unit hits: leave to explicit graph seeds only
  }
  return Array.from(seeds).sort();
}

module.exports = {
  buildAdjacency,
  expandNeighborhood,
  seedIdsFromHits,
};
