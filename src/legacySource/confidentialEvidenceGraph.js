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

const fs = require('fs');
const path = require('path');

const {
  DEFAULT_OUTPUT: DEFAULT_INVENTORY_OUTPUT,
  InventoryError,
  familyFor,
  hmac,
  loadSalt,
  pathsOverlap,
  readUtf8,
  resolveOutput,
  resolveSourceRoot,
  scanContent,
  walkSourceRoot,
} = require('./confidentialInventory');

const SCHEMA_VERSION = 1;
const DEFAULT_OUTPUT = '.local/legacy-source-inventory/evidence-graph.json';
const DEFAULT_INVENTORY = DEFAULT_INVENTORY_OUTPUT;
const MAX_NODES = 100000;
const MAX_EDGES = 300000;

const SAFE_SQL_INTENTS = new Set([
  'CALL',
  'CLOSE',
  'COMMIT',
  'DECLARE',
  'DELETE',
  'EXECUTE',
  'FETCH',
  'INSERT',
  'MERGE',
  'OPEN',
  'PREPARE',
  'ROLLBACK',
  'SELECT',
  'SET',
  'UPDATE',
  'VALUES',
  'OTHER',
]);

const FIELD_RELATIONS = Object.freeze([
  { field: 'calls', entityKind: 'program', edgeKind: 'CALLS_PROGRAM' },
  { field: 'copyMembers', entityKind: 'include', edgeKind: 'INCLUDES_MEMBER' },
  { field: 'tables', entityKind: 'data-object', edgeKind: 'REFERENCES_DATA_OBJECT' },
  { field: 'nativeFiles', entityKind: 'native-file', edgeKind: 'USES_NATIVE_FILE' },
  { field: 'nativeFileAccesses', entityKind: 'native-file', edgeKind: 'ACCESSES_NATIVE_FILE' },
  { field: 'modules', entityKind: 'module', edgeKind: 'BINDS_MODULE' },
  {
    field: 'bindingDirectories',
    entityKind: 'binding-directory',
    edgeKind: 'BINDS_DIRECTORY',
  },
  {
    field: 'servicePrograms',
    entityKind: 'service-program',
    edgeKind: 'BINDS_SERVICE_PROGRAM',
  },
  { field: 'commands', entityKind: 'command', edgeKind: 'EMITS_COMMAND' },
  { field: 'objectUsages', entityKind: 'object', edgeKind: 'USES_OBJECT' },
  { field: 'ddsFiles', entityKind: 'dds-file', edgeKind: 'DESCRIBES_DDS_FILE' },
  { field: 'procedures', entityKind: 'procedure', edgeKind: 'DECLARES_PROCEDURE' },
  { field: 'procedureCalls', entityKind: 'procedure', edgeKind: 'CALLS_PROCEDURE' },
  { field: 'prototypes', entityKind: 'prototype', edgeKind: 'DECLARES_PROTOTYPE' },
]);

function sortedObject(object) {
  return Object.fromEntries(
    Object.entries(object || {}).sort(([left], [right]) => left.localeCompare(right))
  );
}

function increment(object, key, amount = 1) {
  object[key] = (object[key] || 0) + amount;
}

function normalizeName(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function nameFromItem(item) {
  if (typeof item === 'string') return normalizeName(item);
  if (!item || typeof item !== 'object') return null;
  for (const field of ['name', 'fileName', 'symbol', 'objectName', 'ownerName']) {
    const value = normalizeName(item[field]);
    if (value) return value;
  }
  return null;
}

function entityId(salt, entityKind, name) {
  return hmac(salt, `entity:${entityKind}:${name}`);
}

function addNode(nodes, id, node) {
  const existing = nodes.get(id);
  if (!existing) {
    nodes.set(id, { ...node });
    return;
  }
  if (node.observedIn) {
    existing.observedIn = Array.from(
      new Set([...(existing.observedIn || []), ...node.observedIn])
    ).sort();
  }
}

function addEntity(nodes, salt, entityKind, name, fileId) {
  const normalized = normalizeName(name);
  if (!normalized) return null;
  const id = entityId(salt, entityKind, normalized);
  addNode(nodes, id, {
    id,
    kind: entityKind,
    observedIn: [fileId],
  });
  return id;
}

function addEdge(edges, salt, edgeKind, from, to, amount = 1) {
  const id = hmac(salt, `edge:${edgeKind}:${from}:${to}`);
  const key = `${edgeKind}:${from}:${to}`;
  const existing = edges.get(key);
  if (existing) {
    existing.count += Math.max(1, amount);
    return;
  }
  edges.set(key, { id, kind: edgeKind, from, to, count: Math.max(1, amount) });
}

function addRelationItems({ scan, relation, fileId, salt, nodes, edges }) {
  const values = Array.isArray(scan && scan[relation.field]) ? scan[relation.field] : [];
  for (const item of values) {
    const target = addEntity(nodes, salt, relation.entityKind, nameFromItem(item), fileId);
    if (target) addEdge(edges, salt, relation.edgeKind, fileId, target);
  }
}

function addSqlRelations({ scan, fileId, salt, nodes, edges }) {
  const statements = Array.isArray(scan && scan.sqlStatements) ? scan.sqlStatements : [];
  for (const statement of statements) {
    const intent = normalizeName(statement && statement.intent);
    if (intent && SAFE_SQL_INTENTS.has(intent.toUpperCase())) {
      const target = addEntity(nodes, salt, 'sql-intent', intent.toUpperCase(), fileId);
      if (target) addEdge(edges, salt, 'EXECUTES_SQL', fileId, target);
    }
    for (const table of Array.isArray(statement && statement.tables) ? statement.tables : []) {
      const target = addEntity(nodes, salt, 'sql-data-object', table, fileId);
      if (target) addEdge(edges, salt, 'REFERENCES_SQL_DATA_OBJECT', fileId, target);
    }
    for (const cursor of Array.isArray(statement && statement.cursors) ? statement.cursors : []) {
      const target = addEntity(nodes, salt, 'sql-cursor', nameFromItem(cursor), fileId);
      if (target) addEdge(edges, salt, 'USES_SQL_CURSOR', fileId, target);
    }
  }
}

function addPlainSqlRelations({ content, fileId, salt, nodes, edges }) {
  const text = String(content || '');
  const intentPattern =
    /\b(SELECT|INSERT|UPDATE|DELETE|MERGE|CALL|VALUES|SET|COMMIT|ROLLBACK|DECLARE|OPEN|FETCH|CLOSE|PREPARE|EXECUTE)\b/gi;
  let intentMatch = intentPattern.exec(text);
  while (intentMatch) {
    const target = addEntity(nodes, salt, 'sql-intent', intentMatch[1].toUpperCase(), fileId);
    if (target) addEdge(edges, salt, 'EXECUTES_SQL', fileId, target);
    intentMatch = intentPattern.exec(text);
  }

  const objectPattern =
    /\b(?:FROM|JOIN|INTO|UPDATE|TABLE|CALL)\s+([A-Za-z_#$@][A-Za-z0-9_#$@.]*)/gi;
  let objectMatch = objectPattern.exec(text);
  while (objectMatch) {
    const target = addEntity(nodes, salt, 'sql-data-object', objectMatch[1], fileId);
    if (target) addEdge(edges, salt, 'REFERENCES_SQL_DATA_OBJECT', fileId, target);
    objectMatch = objectPattern.exec(text);
  }
}

function addFileNode(nodes, fileId, sourceType) {
  addNode(nodes, fileId, {
    id: fileId,
    kind: 'source-file',
    sourceType,
    family: familyFor(sourceType),
  });
}

function loadInventory(workspaceRoot, inventoryPath) {
  const output = resolveOutput(workspaceRoot, inventoryPath || DEFAULT_INVENTORY);
  let artifact;
  try {
    artifact = JSON.parse(fs.readFileSync(output.absolute, 'utf8'));
  } catch {
    throw new InventoryError('INVENTORY_UNAVAILABLE', 'A local anonymized inventory is required.');
  }
  if (
    !artifact ||
    artifact.kind !== 'zeus-confidential-legacy-source-inventory' ||
    artifact.readOnly !== true ||
    !artifact.inventoryFingerprint ||
    !artifact.sourceBoundary ||
    artifact.privacy?.containsRawSource !== false ||
    artifact.privacy?.containsSourcePaths !== false ||
    artifact.privacy?.containsCredentials !== false ||
    artifact.privacy?.containsBusinessTerms !== false
  ) {
    throw new InventoryError(
      'INVENTORY_UNSAFE',
      'The local inventory did not pass its privacy boundary.'
    );
  }
  return artifact;
}

function buildGraphArtifact({
  sourceRootFingerprint,
  inventoryFingerprint,
  nodes,
  edges,
  warnings,
  scannedFiles,
  skippedFiles,
}) {
  const nodeEntries = Array.from(nodes.values()).sort((left, right) => {
    if (left.kind !== right.kind) return left.kind.localeCompare(right.kind);
    return left.id.localeCompare(right.id);
  });
  const edgeEntries = Array.from(edges.values()).sort((left, right) => {
    if (left.kind !== right.kind) return left.kind.localeCompare(right.kind);
    if (left.from !== right.from) return left.from.localeCompare(right.from);
    return left.to.localeCompare(right.to);
  });
  const byNodeKind = {};
  const byEdgeKind = {};
  const byFamily = {};
  for (const node of nodeEntries) {
    increment(byNodeKind, node.kind);
    if (node.family) increment(byFamily, node.family);
  }
  for (const edge of edgeEntries) increment(byEdgeKind, edge.kind, edge.count);
  const normalizedWarnings = Array.from(new Set(warnings)).sort();
  const graphFingerprint = hmac(
    sourceRootFingerprint,
    JSON.stringify({ nodes: nodeEntries, edges: edgeEntries })
  );
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'zeus-confidential-legacy-source-evidence-graph',
    readOnly: true,
    sourceBoundary: {
      mode: 'local-read-only',
      followsSymlinks: false,
      pathDisclosure: 'none',
      contentDisclosure: 'none',
      sourceRootFingerprint,
    },
    provenance: {
      inventoryFingerprint,
      graphFingerprint,
      sourceScan: 'local-parser-evidence-only',
    },
    graph: {
      complete: normalizedWarnings.length === 0,
      scannedFiles,
      skippedFiles,
      nodeCount: nodeEntries.length,
      edgeCount: edgeEntries.length,
      byNodeKind: sortedObject(byNodeKind),
      byEdgeKind: sortedObject(byEdgeKind),
      byFamily: sortedObject(byFamily),
      nodes: nodeEntries,
      edges: edgeEntries,
    },
    privacy: {
      containsRawSource: false,
      containsSourcePaths: false,
      containsSourceNames: false,
      containsCredentials: false,
      containsBusinessTerms: false,
      hashAlgorithm: 'hmac-sha256',
    },
    warnings: normalizedWarnings,
  };
}

function runLegacySourceEvidenceGraph(options = {}) {
  const source = resolveSourceRoot(options.sourceRoot);
  const output = resolveOutput(
    options.workspaceRoot || process.cwd(),
    options.out || DEFAULT_OUTPUT
  );
  if (pathsOverlap(source.real, output.directory)) {
    throw new InventoryError(
      'SOURCE_OUTPUT_OVERLAP',
      'The source and local artifact boundaries must not overlap.'
    );
  }

  const workspaceRoot = options.workspaceRoot || process.cwd();
  const inventory = loadInventory(workspaceRoot, options.inventory || DEFAULT_INVENTORY);
  const salt = loadSalt(output.directory, options.salt);
  const sourceRootFingerprint = hmac(salt, source.real);
  if (inventory.sourceBoundary.sourceRootFingerprint !== sourceRootFingerprint) {
    throw new InventoryError(
      'INVENTORY_SOURCE_MISMATCH',
      'The inventory does not match the local source boundary.'
    );
  }

  const nodes = new Map();
  const edges = new Map();
  const warnings = [];
  const walked = walkSourceRoot(source.real);
  let scannedFiles = 0;
  let skippedFiles = 0;

  for (const item of walked.files) {
    const relativePath = path.relative(source.real, item.filePath);
    const fileId = hmac(salt, relativePath);
    addFileNode(nodes, fileId, item.sourceType);
    let content;
    try {
      content = readUtf8(fs.readFileSync(item.filePath));
    } catch {
      skippedFiles += 1;
      warnings.push('SOURCE_FILE_UNREADABLE');
      continue;
    }
    let scan = null;
    try {
      if (familyFor(item.sourceType) !== 'SQL')
        scan = scanContent(fileId, item.sourceType, content);
    } catch {
      warnings.push('SCANNER_PARTIAL_FAILURE');
    }
    if (scan) {
      for (const relation of FIELD_RELATIONS) {
        addRelationItems({ scan, relation, fileId, salt, nodes, edges });
      }
      addSqlRelations({ scan, fileId, salt, nodes, edges });
    }
    if (familyFor(item.sourceType) === 'SQL') {
      addPlainSqlRelations({ content, fileId, salt, nodes, edges });
    }
    scannedFiles += 1;
    if (nodes.size > MAX_NODES || edges.size > MAX_EDGES) {
      warnings.push('GRAPH_LIMIT_REACHED');
      break;
    }
  }

  const artifact = buildGraphArtifact({
    sourceRootFingerprint,
    inventoryFingerprint: inventory.inventoryFingerprint,
    nodes,
    edges,
    warnings,
    scannedFiles,
    skippedFiles: skippedFiles + Math.max(0, walked.files.length - scannedFiles - skippedFiles),
  });
  fs.writeFileSync(output.absolute, `${JSON.stringify(artifact, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  return {
    ok: true,
    kind: 'legacy-source-evidence-graph-result',
    status: artifact.warnings.length === 0 ? 'ready' : 'needs-attention',
    readOnly: true,
    safety: {
      level: 'S1',
      approvalRequired: false,
      sideEffects: ['local-read', 'local-artifact-write'],
    },
    scope: { origin: 'local-source-boundary', sourceRootFingerprint, output: output.relative },
    evidence: {
      available: true,
      complete: artifact.graph.complete,
      count: artifact.graph.edgeCount,
      warnings: artifact.warnings,
    },
    artifacts: [output.relative],
    summary: {
      scannedFiles: artifact.graph.scannedFiles,
      skippedFiles: artifact.graph.skippedFiles,
      nodeCount: artifact.graph.nodeCount,
      edgeCount: artifact.graph.edgeCount,
      byNodeKind: artifact.graph.byNodeKind,
      byEdgeKind: artifact.graph.byEdgeKind,
      byFamily: artifact.graph.byFamily,
    },
    warnings: artifact.warnings,
    nextCommands: ['node cli/zeus.js agent log summary --json'],
    approvalRequired: false,
  };
}

module.exports = {
  DEFAULT_INVENTORY,
  DEFAULT_OUTPUT,
  runLegacySourceEvidenceGraph,
};
