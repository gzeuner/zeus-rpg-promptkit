/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
'use strict';

const crypto = require('node:crypto');

const TECHNICAL_EVIDENCE_CONTEXT_SCHEMA_VERSION = 1;
const TECHNICAL_EVIDENCE_CONTEXT_CONTRACT_ID = 'zeus.technical-evidence-context';
const MAX_NODES = 100000;
const MAX_EDGES = 300000;
const MAX_WARNINGS = 128;
const MAX_SELECTION_NODES = 2048;
const MAX_SELECTION_EDGES = 4096;
const GOAL_CODES = new Set([
  'architecture',
  'dependency-impact',
  'context-recall',
  'schema-review',
  'unknown',
]);

const ENVELOPE_FIELDS = new Set([
  'schemaVersion',
  'kind',
  'readOnly',
  'sourceBoundary',
  'provenance',
  'graph',
  'privacy',
  'warnings',
]);
const BOUNDARY_FIELDS = new Set([
  'mode',
  'followsSymlinks',
  'pathDisclosure',
  'contentDisclosure',
  'sourceRootFingerprint',
]);
const PROVENANCE_FIELDS = new Set(['inventoryFingerprint', 'graphFingerprint', 'sourceScan']);
const PRIVACY_FIELDS = new Set([
  'containsRawSource',
  'containsSourcePaths',
  'containsSourceNames',
  'containsCredentials',
  'containsBusinessTerms',
  'hashAlgorithm',
]);
const GRAPH_FIELDS = new Set([
  'complete',
  'scannedFiles',
  'skippedFiles',
  'nodeCount',
  'edgeCount',
  'byNodeKind',
  'byEdgeKind',
  'byFamily',
  'nodes',
  'edges',
]);
const NODE_FIELDS = new Set(['id', 'kind', 'sourceType', 'family', 'confidence', 'observedIn']);
const EDGE_FIELDS = new Set(['id', 'kind', 'from', 'to', 'count', 'confidence']);

class TechnicalEvidenceContextError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TechnicalEvidenceContextError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new TechnicalEvidenceContextError(code, message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertObject(value, code, label) {
  if (!isObject(value)) fail(code, `${label} must be an object`);
}

function assertKnownFields(value, allowed, code, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(code, `${label} contains an unsupported field`);
  }
}

function isSafeToken(value, maxLength = 96) {
  return (
    typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value) && value.length <= maxLength
  );
}

function isOpaqueId(value) {
  return (
    typeof value === 'string' &&
    (/^[a-f0-9]{64}$/i.test(value) || /^opaque-[a-z0-9_-]{8,128}$/i.test(value))
  );
}

function assertOpaqueId(value, code, label) {
  if (!isOpaqueId(value)) fail(code, `${label} must be an opaque identifier`);
}

function assertSafeToken(value, code, label) {
  if (!isSafeToken(value)) fail(code, `${label} must be a bounded technical token`);
}

function assertNonNegativeInteger(value, code, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    fail(code, `${label} must be a bounded non-negative integer`);
  }
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => String(left).localeCompare(String(right)));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, stableValue(value[key])])
  );
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function digest(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function validatePrivacyBoundary(input) {
  assertObject(input, 'TECHNICAL_EVIDENCE_INVALID', 'privacy');
  assertKnownFields(input, PRIVACY_FIELDS, 'TECHNICAL_EVIDENCE_UNSAFE', 'privacy');
  for (const field of [
    'containsRawSource',
    'containsSourcePaths',
    'containsSourceNames',
    'containsCredentials',
    'containsBusinessTerms',
  ]) {
    if (input[field] !== false) fail('TECHNICAL_EVIDENCE_UNSAFE', 'privacy boundary is not closed');
  }
  if (input.hashAlgorithm !== undefined)
    assertSafeToken(input.hashAlgorithm, 'TECHNICAL_EVIDENCE_UNSAFE', 'privacy.hashAlgorithm');
}

function validateBoundary(input) {
  assertObject(input, 'TECHNICAL_EVIDENCE_INVALID', 'sourceBoundary');
  assertKnownFields(input, BOUNDARY_FIELDS, 'TECHNICAL_EVIDENCE_UNSAFE', 'sourceBoundary');
  if (input.mode !== 'local-read-only')
    fail('TECHNICAL_EVIDENCE_UNSAFE', 'source boundary mode is not read-only');
  if (input.followsSymlinks !== false)
    fail('TECHNICAL_EVIDENCE_UNSAFE', 'source boundary follows symlinks');
  if (input.pathDisclosure !== 'none' || input.contentDisclosure !== 'none') {
    fail('TECHNICAL_EVIDENCE_UNSAFE', 'source boundary disclosure is not closed');
  }
  if (input.sourceRootFingerprint !== undefined)
    assertOpaqueId(
      input.sourceRootFingerprint,
      'TECHNICAL_EVIDENCE_UNSAFE',
      'source boundary fingerprint'
    );
}

function validateProvenance(input) {
  if (input === undefined) return;
  assertObject(input, 'TECHNICAL_EVIDENCE_INVALID', 'provenance');
  assertKnownFields(input, PROVENANCE_FIELDS, 'TECHNICAL_EVIDENCE_UNSAFE', 'provenance');
  for (const field of ['inventoryFingerprint', 'graphFingerprint']) {
    if (input[field] !== undefined)
      assertOpaqueId(input[field], 'TECHNICAL_EVIDENCE_UNSAFE', `provenance.${field}`);
  }
  if (input.sourceScan !== undefined)
    assertSafeToken(input.sourceScan, 'TECHNICAL_EVIDENCE_UNSAFE', 'provenance.sourceScan');
}

function validateCountMap(input, code, label) {
  if (input === undefined) return;
  assertObject(input, code, label);
  for (const [key, value] of Object.entries(input)) {
    assertSafeToken(key, code, `${label} key`);
    assertNonNegativeInteger(value, code, `${label} value`, MAX_EDGES);
  }
}

function normalizeNode(node, index) {
  assertObject(node, 'TECHNICAL_EVIDENCE_INVALID', `graph.nodes[${index}]`);
  assertKnownFields(node, NODE_FIELDS, 'TECHNICAL_EVIDENCE_UNSAFE', 'graph node');
  assertOpaqueId(node.id, 'TECHNICAL_EVIDENCE_UNSAFE', 'graph node id');
  assertSafeToken(node.kind, 'TECHNICAL_EVIDENCE_UNSAFE', 'graph node kind');
  for (const field of ['sourceType', 'family', 'confidence']) {
    if (node[field] !== undefined)
      assertSafeToken(node[field], 'TECHNICAL_EVIDENCE_UNSAFE', `graph node ${field}`);
  }
  if (node.observedIn !== undefined) {
    if (!Array.isArray(node.observedIn) || node.observedIn.length > MAX_NODES) {
      fail('TECHNICAL_EVIDENCE_INVALID', 'graph node observedIn must be bounded');
    }
    for (const id of node.observedIn)
      assertOpaqueId(id, 'TECHNICAL_EVIDENCE_UNSAFE', 'graph node observedIn id');
  }
  const normalized = { id: node.id, kind: node.kind };
  for (const field of ['sourceType', 'family', 'confidence']) {
    if (node[field] !== undefined) normalized[field] = node[field];
  }
  return normalized;
}

function normalizeEdge(edge, index) {
  assertObject(edge, 'TECHNICAL_EVIDENCE_INVALID', `graph.edges[${index}]`);
  assertKnownFields(edge, EDGE_FIELDS, 'TECHNICAL_EVIDENCE_UNSAFE', 'graph edge');
  for (const field of ['id', 'from', 'to'])
    assertOpaqueId(edge[field], 'TECHNICAL_EVIDENCE_UNSAFE', `graph edge ${field}`);
  assertSafeToken(edge.kind, 'TECHNICAL_EVIDENCE_UNSAFE', 'graph edge kind');
  if (edge.count !== undefined)
    assertNonNegativeInteger(
      edge.count,
      'TECHNICAL_EVIDENCE_INVALID',
      'graph edge count',
      MAX_EDGES
    );
  if (edge.confidence !== undefined)
    assertSafeToken(edge.confidence, 'TECHNICAL_EVIDENCE_UNSAFE', 'graph edge confidence');
  const normalized = { id: edge.id, kind: edge.kind, from: edge.from, to: edge.to };
  if (edge.count !== undefined) normalized.count = edge.count;
  if (edge.confidence !== undefined) normalized.confidence = edge.confidence;
  return normalized;
}

function normalizeInput(input) {
  assertObject(input, 'TECHNICAL_EVIDENCE_INVALID', 'evidence graph');
  assertKnownFields(input, ENVELOPE_FIELDS, 'TECHNICAL_EVIDENCE_UNSAFE', 'evidence graph');
  if (input.schemaVersion !== undefined && Number(input.schemaVersion) !== 1)
    fail('TECHNICAL_EVIDENCE_UNSUPPORTED', 'evidence graph schema is unsupported');
  if (
    ![
      'zeus-confidential-legacy-source-evidence-graph',
      'zeus-anonymized-technical-evidence-graph',
    ].includes(input.kind)
  ) {
    fail('TECHNICAL_EVIDENCE_UNSUPPORTED', 'evidence graph kind is unsupported');
  }
  if (input.readOnly !== true) fail('TECHNICAL_EVIDENCE_UNSAFE', 'evidence graph is not read-only');
  validateBoundary(input.sourceBoundary);
  validateProvenance(input.provenance);
  validatePrivacyBoundary(input.privacy);
  if (!Array.isArray(input.warnings) || input.warnings.length > MAX_WARNINGS)
    fail('TECHNICAL_EVIDENCE_INVALID', 'warnings must be a bounded array');
  for (const warning of input.warnings)
    assertSafeToken(warning, 'TECHNICAL_EVIDENCE_UNSAFE', 'warning');

  assertObject(input.graph, 'TECHNICAL_EVIDENCE_INVALID', 'graph');
  assertKnownFields(input.graph, GRAPH_FIELDS, 'TECHNICAL_EVIDENCE_UNSAFE', 'graph');
  if (typeof input.graph.complete !== 'boolean')
    fail('TECHNICAL_EVIDENCE_INVALID', 'graph.complete is required');
  if (!Array.isArray(input.graph.nodes) || input.graph.nodes.length > MAX_NODES)
    fail('TECHNICAL_EVIDENCE_INVALID', 'graph.nodes is not bounded');
  if (!Array.isArray(input.graph.edges) || input.graph.edges.length > MAX_EDGES)
    fail('TECHNICAL_EVIDENCE_INVALID', 'graph.edges is not bounded');
  for (const field of ['scannedFiles', 'skippedFiles', 'nodeCount', 'edgeCount']) {
    if (input.graph[field] !== undefined)
      assertNonNegativeInteger(
        input.graph[field],
        'TECHNICAL_EVIDENCE_INVALID',
        `graph.${field}`,
        MAX_EDGES
      );
  }
  validateCountMap(input.graph.byNodeKind, 'TECHNICAL_EVIDENCE_UNSAFE', 'graph.byNodeKind');
  validateCountMap(input.graph.byEdgeKind, 'TECHNICAL_EVIDENCE_UNSAFE', 'graph.byEdgeKind');
  validateCountMap(input.graph.byFamily, 'TECHNICAL_EVIDENCE_UNSAFE', 'graph.byFamily');

  const nodes = input.graph.nodes.map(normalizeNode);
  const edges = input.graph.edges.map(normalizeEdge);
  const nodeIds = new Set();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) fail('TECHNICAL_EVIDENCE_INVALID', 'graph node ids must be unique');
    nodeIds.add(node.id);
  }
  const edgeIds = new Set();
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) fail('TECHNICAL_EVIDENCE_INVALID', 'graph edge ids must be unique');
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to))
      fail('TECHNICAL_EVIDENCE_INVALID', 'graph edge endpoint is unknown');
  }
  nodes.sort((left, right) => left.id.localeCompare(right.id));
  edges.sort((left, right) => left.id.localeCompare(right.id));
  return { complete: input.graph.complete, warnings: sortedUnique(input.warnings), nodes, edges };
}

function normalizeGoalCode(value) {
  const code =
    value === undefined || value === null || String(value).trim() === ''
      ? 'context-recall'
      : String(value).trim();
  if (!GOAL_CODES.has(code))
    fail('TECHNICAL_EVIDENCE_INVALID', 'goalCode is not an approved technical objective');
  return code;
}

function normalizeTargets(targetIds) {
  if (targetIds === undefined || targetIds === null || targetIds === '') return [];
  const values = Array.isArray(targetIds) ? targetIds : String(targetIds).split(',');
  const result = [];
  for (const value of values) {
    const id = String(value).trim();
    if (!id) continue;
    assertOpaqueId(id, 'TECHNICAL_EVIDENCE_UNSAFE', 'target id');
    result.push(id);
  }
  return sortedUnique(result);
}

function normalizeLimit(value, fallback, maximum, label) {
  const candidate = value === undefined ? fallback : Number(value);
  assertNonNegativeInteger(candidate, 'TECHNICAL_EVIDENCE_INVALID', label, maximum);
  return candidate;
}

function estimateNodeCost(node) {
  return (
    8 +
    node.id.length +
    node.kind.length +
    (node.family || '').length +
    (node.sourceType || '').length
  );
}

function estimateEdgeCost(edge) {
  return 8 + edge.id.length + edge.kind.length + edge.from.length + edge.to.length;
}

function rankNodes(nodes, edges, targets) {
  const adjacency = new Map(nodes.map(node => [node.id, new Set()]));
  for (const edge of edges) {
    adjacency.get(edge.from).add(edge.to);
    adjacency.get(edge.to).add(edge.from);
  }
  const distances = new Map();
  const queue = [];
  for (const target of targets) {
    if (adjacency.has(target)) {
      distances.set(target, 0);
      queue.push(target);
    }
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    for (const next of adjacency.get(current)) {
      if (!distances.has(next)) {
        distances.set(next, distances.get(current) + 1);
        queue.push(next);
      }
    }
  }
  const degree = new Map(nodes.map(node => [node.id, adjacency.get(node.id).size]));
  return [...nodes].sort((left, right) => {
    const leftDistance = distances.has(left.id)
      ? distances.get(left.id)
      : targets.length > 0
        ? Number.MAX_SAFE_INTEGER
        : 1;
    const rightDistance = distances.has(right.id)
      ? distances.get(right.id)
      : targets.length > 0
        ? Number.MAX_SAFE_INTEGER
        : 1;
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    const degreeDiff = degree.get(right.id) - degree.get(left.id);
    if (degreeDiff !== 0) return degreeDiff;
    return left.id.localeCompare(right.id);
  });
}

function selectEvidence(input, options) {
  const targetIds = normalizeTargets(options.targetIds);
  const targetSet = new Set(targetIds);
  const maxNodes = normalizeLimit(options.maxNodes, 128, MAX_SELECTION_NODES, 'maxNodes');
  const maxEdges = normalizeLimit(options.maxEdges, 256, MAX_SELECTION_EDGES, 'maxEdges');
  const tokenBudget = normalizeLimit(options.tokenBudget, 4000, 1000000, 'tokenBudget');
  const rankedNodes = rankNodes(input.nodes, input.edges, targetIds);
  const selectedNodes = [];
  let cost = 0;
  for (const node of rankedNodes) {
    const nextCost = cost + estimateNodeCost(node);
    if (selectedNodes.length >= maxNodes || nextCost > tokenBudget * 4) continue;
    selectedNodes.push(node);
    cost = nextCost;
  }
  const selectedNodeIds = new Set(selectedNodes.map(node => node.id));
  const selectedEdges = input.edges
    .filter(edge => selectedNodeIds.has(edge.from) && selectedNodeIds.has(edge.to))
    .sort((left, right) => left.id.localeCompare(right.id));
  const boundedEdges = [];
  for (const edge of selectedEdges) {
    const nextCost = cost + estimateEdgeCost(edge);
    if (boundedEdges.length >= maxEdges || nextCost > tokenBudget * 4) continue;
    boundedEdges.push(edge);
    cost = nextCost;
  }
  const omissions = [];
  if (selectedNodes.length < input.nodes.length) omissions.push('NODE_LIMIT_REACHED');
  if (boundedEdges.length < selectedEdges.length) omissions.push('EDGE_LIMIT_REACHED');
  if (selectedNodes.length + boundedEdges.length === 0 && input.nodes.length > 0)
    omissions.push('TOKEN_BUDGET_REACHED');
  if (targetIds.some(id => !selectedNodeIds.has(id))) omissions.push('TARGET_NOT_SELECTED');
  if (targetIds.some(id => !input.nodes.some(node => node.id === id)))
    omissions.push('TARGET_NOT_FOUND');
  return {
    targets: targetIds.filter(id => targetSet.has(id) && selectedNodeIds.has(id)),
    nodes: selectedNodes,
    edges: boundedEdges,
    omissions: sortedUnique(omissions),
    limits: { maxNodes, maxEdges, tokenBudget },
    estimatedUnits: Math.ceil(cost / 4),
  };
}

function buildTechnicalEvidenceContext(options = {}) {
  const input = normalizeInput(options.evidence || options.graph);
  const selection = selectEvidence(input, options);
  const context = {
    schemaVersion: TECHNICAL_EVIDENCE_CONTEXT_SCHEMA_VERSION,
    kind: 'zeus-technical-evidence-context',
    contractId: TECHNICAL_EVIDENCE_CONTEXT_CONTRACT_ID,
    contractVersion: TECHNICAL_EVIDENCE_CONTEXT_SCHEMA_VERSION,
    readOnly: true,
    localOnly: true,
    privacy: {
      containsRawSource: false,
      containsSourcePaths: false,
      containsSourceNames: false,
      containsCredentials: false,
      containsBusinessTerms: false,
      promptBoundary: 'anonymized-technical-evidence-only',
    },
    objective: { code: normalizeGoalCode(options.goalCode) },
    input: {
      format: 'anonymized-technical-evidence-graph',
      complete: input.complete,
      warnings: input.warnings,
    },
    evidence: {
      nodes: selection.nodes,
      edges: selection.edges,
      nodeCount: selection.nodes.length,
      edgeCount: selection.edges.length,
    },
    selection: {
      strategy: 'deterministic-connectivity-ranking',
      targets: selection.targets,
      limits: selection.limits,
      estimatedUnits: selection.estimatedUnits,
      omissions: selection.omissions,
    },
    uncertainty: {
      complete: input.complete,
      warningCodes: input.warnings,
      claims: [
        'technical-relationships-only',
        'no-source-text',
        'no-private-mapping',
        'no-business-meaning',
      ],
    },
  };
  context.contextFingerprint = digest(context);
  return context;
}

function validateTechnicalEvidenceContext(value) {
  const errors = [];
  if (!isObject(value)) return ['context must be an object'];
  if (value.schemaVersion !== TECHNICAL_EVIDENCE_CONTEXT_SCHEMA_VERSION)
    errors.push('schemaVersion is unsupported');
  if (value.kind !== 'zeus-technical-evidence-context') errors.push('kind is invalid');
  if (value.contractId !== TECHNICAL_EVIDENCE_CONTEXT_CONTRACT_ID)
    errors.push('contractId is invalid');
  if (value.readOnly !== true || value.localOnly !== true)
    errors.push('context must be local-only and read-only');
  if (
    !isOpaqueId(value.contextFingerprint) &&
    !/^[a-f0-9]{64}$/i.test(String(value.contextFingerprint || ''))
  )
    errors.push('contextFingerprint must be a digest');
  return errors;
}

module.exports = {
  GOAL_CODES,
  TECHNICAL_EVIDENCE_CONTEXT_CONTRACT_ID,
  TECHNICAL_EVIDENCE_CONTEXT_SCHEMA_VERSION,
  TechnicalEvidenceContextError,
  buildTechnicalEvidenceContext,
  validateTechnicalEvidenceContext,
};
