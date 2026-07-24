'use strict';

const crypto = require('crypto');
const CONTRACT_IDS = require('../contractIds');
const { REASON_CODES } = require('../constants');
const { POLICY_ID, POLICY_VERSION, RETRIEVER_ID, RETRIEVER_VERSION } = require('./constants');
const { allocateBudgetSlices, packBucket, estimateItemTokens } = require('./tokenBudget');
const { expandNeighborhood, seedIdsFromHits } = require('./graphExpansion');
const { verifySourceEvidence, loadVerifiedBodies } = require('./sourceVerification');

function packageIdFor(projectId, snapshotId, query) {
  const h = crypto
    .createHash('sha256')
    .update(`${projectId}\0${snapshotId}\0${query}\0${POLICY_ID}@${POLICY_VERSION}`)
    .digest('hex')
    .slice(0, 16);
  return `ctx-${h}`;
}

function comparePriority(a, b) {
  const sa = a.score == null ? 0 : a.score;
  const sb = b.score == null ? 0 : b.score;
  if (sb !== sa) return sb - sa;
  return String(a.id).localeCompare(String(b.id));
}

/**
 * Assemble a Community context package from retrieval hits + snapshot graph.
 */
function assembleContextPackage({
  projectId,
  snapshotId,
  query,
  lexicalResult,
  symbols = [],
  relationships = [],
  evidenceMeta = [],
  contentStore = null,
  tokenBudget,
  expandHops = 1,
  includeBodies = true,
}) {
  const { total, slices } = allocateBudgetSlices(tokenBudget);
  const hits = (lexicalResult && lexicalResult.hits) || [];
  const seeds = seedIdsFromHits(hits);
  const neighborhood = expandNeighborhood(seeds, relationships, expandHops);

  const symbolById = new Map((symbols || []).map(s => [s.symbolId, s]));
  const evidenceByUnit = new Map();
  for (const ev of evidenceMeta || []) {
    if (!evidenceByUnit.has(ev.sourceUnitId)) evidenceByUnit.set(ev.sourceUnitId, []);
    evidenceByUnit.get(ev.sourceUnitId).push(ev);
  }

  // --- Build candidate pools (deterministic sort) ---
  const summaryItems = [
    {
      id: `summary:${projectId}:${snapshotId}`,
      kind: 'summary',
      title: 'project-snapshot',
      text: `Project ${projectId} snapshot ${snapshotId}. Query: ${query}. Seeds: ${seeds.length}. Neighborhood: ${neighborhood.nodes.length}.`,
      reasons: ['snapshot-orientation'],
      score: 1e9,
    },
  ];

  const graphItems = neighborhood.nodes
    .map(id => {
      const sym = symbolById.get(id);
      return {
        id,
        kind: 'symbol',
        title: (sym && sym.name) || id,
        text: sym ? `${sym.symbolKind} ${sym.name} (${sym.symbolId})` : `symbol ${id}`,
        reasons: seeds.includes(id) ? ['query-seed', 'graph-neighborhood'] : ['graph-neighborhood'],
        score: seeds.includes(id) ? 1000 : 100,
        symbolKind: sym && sym.symbolKind,
      };
    })
    .sort(comparePriority);

  // Unresolved symbols bucket
  const unresolvedItems = graphItems
    .filter(g => g.symbolKind === 'UNRESOLVED_SYMBOL')
    .map(g => ({
      ...g,
      kind: 'unresolved',
      reasons: ['unresolved-reference'],
    }))
    .sort(comparePriority);

  // Source evidence candidates from hits with contentHash + related evidence meta
  const sourceCandidates = [];
  for (const hit of hits) {
    const id = hit.docId || hit.id;
    sourceCandidates.push({
      id,
      kind: hit.kind || 'source-unit',
      title: hit.title || id,
      text: hit.title || '',
      contentHash: hit.contentHash || null,
      reasons: ['lexical-hit'],
      score: hit.score || 0,
      fields: hit.fields || {},
    });
  }
  for (const nodeId of neighborhood.nodes) {
    const sym = symbolById.get(nodeId);
    const sourceUnitId =
      (sym && sym.provenance && sym.provenance.sourceUnitId) || (sym && sym._sourceUnitId) || null;
    if (!sym || !sourceUnitId) continue;
    const evList = evidenceByUnit.get(sourceUnitId) || [];
    for (const ev of evList) {
      sourceCandidates.push({
        id: `doc:evidence:${ev.evidenceId}`,
        kind: 'evidence',
        title: ev.relativePath || ev.evidenceId,
        text: ev.relativePath || '',
        contentHash: ev.contentHash,
        reasons: ['graph-linked-evidence'],
        score: 50,
        fields: { relativePath: ev.relativePath || '' },
      });
    }
  }
  // Dedupe source candidates by id
  const sourceMap = new Map();
  for (const c of sourceCandidates) {
    if (!sourceMap.has(c.id) || (sourceMap.get(c.id).score || 0) < (c.score || 0)) {
      sourceMap.set(c.id, c);
    }
  }
  const sourceItems = Array.from(sourceMap.values()).sort(comparePriority);

  // Diagnostics placeholder (structure reserved; empty unless provided)
  const diagnosticItems = [];

  // --- Verify sources before packing ---
  const verification = verifySourceEvidence(contentStore, sourceItems);
  const verifyById = new Map(verification.map(v => [v.id, v]));
  const verifiedSources = [];
  const verifyOmissions = [];
  for (const item of sourceItems) {
    const v = verifyById.get(item.id);
    if (!item.contentHash) {
      // allow metadata-only lexical hits without body
      verifiedSources.push({ ...item, verified: false });
      continue;
    }
    if (v && v.ok) {
      verifiedSources.push({ ...item, verified: true });
    } else {
      verifyOmissions.push({
        entityId: item.id,
        kind: item.kind,
        reasonCode: (v && v.reasonCode) || REASON_CODES.EVIDENCE_MISSING,
        description: (v && v.message) || 'source verification failed',
      });
    }
  }

  if (includeBodies && contentStore) {
    const bodies = loadVerifiedBodies(
      contentStore,
      verifiedSources.filter(s => s.verified),
      { maxChars: 1500 }
    );
    for (const item of verifiedSources) {
      if (bodies.has(item.id)) {
        item.body = bodies.get(item.id);
        item.text = item.body;
      }
    }
  }

  // --- Pack by budget ---
  const summaryPack = packBucket(summaryItems, slices.summary, REASON_CODES.TOKEN_BUDGET_EXCEEDED);
  const graphPack = packBucket(graphItems, slices.graph, REASON_CODES.TOKEN_BUDGET_EXCEEDED);
  const sourcePack = packBucket(verifiedSources, slices.source, REASON_CODES.TOKEN_BUDGET_EXCEEDED);
  const diagPack = packBucket(
    diagnosticItems,
    slices.diagnostics,
    REASON_CODES.TOKEN_BUDGET_EXCEEDED
  );
  const unresolvedPack = packBucket(
    unresolvedItems,
    slices.unresolved,
    REASON_CODES.TOKEN_BUDGET_EXCEEDED
  );

  const selected = [
    ...summaryPack.selected,
    ...graphPack.selected,
    ...sourcePack.selected,
    ...diagPack.selected,
    ...unresolvedPack.selected,
  ];

  const omissions = [
    ...summaryPack.omitted,
    ...graphPack.omitted,
    ...sourcePack.omitted,
    ...diagPack.omitted,
    ...unresolvedPack.omitted,
    ...verifyOmissions,
  ].map(o => ({
    reasonCode: o.reasonCode,
    description: o.description,
    entityId: o.entityId,
  }));

  // Sort omissions deterministically
  omissions.sort((a, b) => {
    const ka = `${a.reasonCode}|${a.entityId || ''}`;
    const kb = `${b.reasonCode}|${b.entityId || ''}`;
    return ka.localeCompare(kb);
  });

  const evidenceReferences = [];
  const seenEv = new Set();
  for (const item of selected) {
    if (item.contentHash || item.kind === 'evidence' || item.kind === 'source-unit') {
      const refId = item.id;
      if (!seenEv.has(refId)) {
        seenEv.add(refId);
        evidenceReferences.push({
          id: refId,
          kind: item.kind,
          contentHash: item.contentHash || undefined,
        });
      }
    }
  }
  evidenceReferences.sort((a, b) => a.id.localeCompare(b.id));

  const usedTokens =
    summaryPack.usedTokens +
    graphPack.usedTokens +
    sourcePack.usedTokens +
    diagPack.usedTokens +
    unresolvedPack.usedTokens;

  const selectedManifest = selected
    .map(item => ({
      id: item.id,
      kind: item.kind,
      reasons: item.reasons || [],
      tokenEstimate: item.tokenEstimate || estimateItemTokens(item),
      verified: item.verified === true ? true : item.verified === false ? false : undefined,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const contextPackage = {
    schemaVersion: 1,
    kind: 'project-knowledge-context-package',
    contractId: CONTRACT_IDS.CONTEXT_PACKAGE,
    projectId,
    snapshotId,
    packageId: packageIdFor(projectId, snapshotId, query),
    policyId: POLICY_ID,
    policyVersion: POLICY_VERSION,
    sourceOfTruth: false,
    advisory: true,
    tokenBudget: total,
    selected: selectedManifest,
    omissions,
    evidenceReferences,
    nonClaims: [
      'Not source of truth',
      'Not a compile or deploy result',
      'Rankings and summaries are derived aids',
      'Preserved source evidence remains authoritative',
    ],
    // Observational assembly metadata (additive)
    assembly: {
      retrieverId: RETRIEVER_ID,
      retrieverVersion: RETRIEVER_VERSION,
      query,
      expandHops,
      seeds,
      neighborhoodSize: neighborhood.nodes.length,
      usedTokens,
      budgetSlices: slices,
      lexicalHitCount: hits.length,
      omissionCount: omissions.length,
    },
  };

  return {
    contextPackage,
    neighborhood,
    verification,
    metrics: {
      tokenBudget: total,
      usedTokens,
      selectedCount: selected.length,
      omissionCount: omissions.length,
      reductionRatio: total > 0 ? Math.round((1 - usedTokens / total) * 1000) / 1000 : 0,
      verifiedSourceCount: verifiedSources.filter(s => s.verified).length,
    },
  };
}

module.exports = {
  assembleContextPackage,
  packageIdFor,
};
