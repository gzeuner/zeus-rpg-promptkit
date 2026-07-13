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

  // Minimal inline canonical (avoids gitignored generated outputs)
  const sample = {
    schemaVersion: 1,
    kind: 'canonical-analysis',
    rootProgram: 'TESTPGM',
    sourceRoot: '/tmp',
    entities: {
      programs: [{ name: 'TESTPGM', evidence: [{ file: 'src/test.rpgle', startLine: 1 }] }],
      procedures: [
        { name: 'MAIN', program: 'TESTPGM', evidence: [{ file: 'src/test.rpgle', startLine: 5 }] },
      ],
      tables: [{ name: 'MYTABLE', evidence: [] }],
    },
    relations: [
      {
        type: 'CALLS_PROGRAM',
        from: 'TESTPGM',
        to: 'OTHERPGM',
        evidence: [{ file: 'src/test.rpgle' }],
      },
    ],
    sqlStatements: [],
    sourceFiles: [],
  };
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
  const sample = {
    schemaVersion: 1,
    kind: 'canonical-analysis',
    rootProgram: 'TESTPGM',
    sourceRoot: '/tmp',
    entities: { programs: [{ name: 'TESTPGM', evidence: [] }], procedures: [] },
    relations: [],
    sqlStatements: [],
    sourceFiles: [],
  };
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
  const sample = {
    schemaVersion: 1,
    kind: 'canonical-analysis',
    rootProgram: 'TESTPGM',
    sourceRoot: '/tmp',
    entities: {
      programs: [{ name: 'TESTPGM', evidence: [] }],
      procedures: [{ name: 'P1', program: 'TESTPGM', evidence: [] }],
      tables: [{ name: 'T1', evidence: [] }],
    },
    relations: [{ type: 'CALLS_PROGRAM', from: 'TESTPGM', to: 'OTHER', evidence: [] }],
    sqlStatements: [],
    sourceFiles: [],
  };
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
