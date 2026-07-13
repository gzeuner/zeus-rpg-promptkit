const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { createSchemaRegistry } = require('../src/core/contracts/schemaRegistry');
const { CONTRACT_IDS, INITIAL_SCHEMAS } = require('../src/core/contracts/schemas');
const { buildEvidenceGraph } = require('../src/analyze/evidenceGraphBuilder');

test('evidence-graph registers and validates', () => {
  const registry = createSchemaRegistry();
  for (const [id, def] of Object.entries(INITIAL_SCHEMAS)) {
    registry.register({ id, version: def.version, schema: def.schema });
  }
  assert.ok(registry.hasContract(CONTRACT_IDS.EVIDENCE_GRAPH, 1));

  const samplePath = path.join(
    __dirname,
    '../examples/demo-rpg-mini-system/output/PROGRAM_100/canonical-analysis.json'
  );
  const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  const graph = buildEvidenceGraph(sample);
  const res = registry.validate(CONTRACT_IDS.EVIDENCE_GRAPH, 1, graph);
  if (!res.ok) {
    console.error(res.errors);
  }
  assert.ok(res.ok);
  assert.equal(graph.schemaVersion, 1);
  assert.equal(graph.kind, 'evidence-graph');
});

test('evidence-graph is deterministic on repeat builds', () => {
  const samplePath = path.join(
    __dirname,
    '../examples/demo-rpg-mini-system/output/PROGRAM_100/canonical-analysis.json'
  );
  const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  const g1 = buildEvidenceGraph(sample);
  const g2 = buildEvidenceGraph(sample);
  assert.equal(JSON.stringify(g1), JSON.stringify(g2));
  assert.ok(g1.nodes.length > 0);
});

test('evidence-graph rejects invalid doc', () => {
  const registry = createSchemaRegistry();
  for (const [id, def] of Object.entries(INITIAL_SCHEMAS)) {
    registry.register({ id, version: def.version, schema: def.schema });
  }
  const bad = { kind: 'evidence-graph', program: 'FOO', nodes: [], edges: [] };
  const res = registry.validate(CONTRACT_IDS.EVIDENCE_GRAPH, 1, bad);
  assert.ok(!res.ok);
  assert.ok(res.errors.some(e => /schemaVersion/.test(String(e.message))));
});

test('evidence-graph produces typed content from canonical', () => {
  const samplePath = path.join(
    __dirname,
    '../examples/demo-rpg-mini-system/output/PROGRAM_100/canonical-analysis.json'
  );
  const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  const g = buildEvidenceGraph(sample);
  const types = new Set(g.nodes.map(n => n.type));
  assert.ok(types.has('PROGRAM') || types.has('PROCEDURE') || types.has('TABLE'));
  if (g.edges.length > 0) {
    const et = new Set(g.edges.map(e => e.type));
    assert.ok(
      et.has('PROGRAM_CALL') || et.has('BOUND_PROCEDURE_CALL') || et.has('TABLE_REFERENCE')
    );
  }
});
