'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { runLegacySourceInventory } = require('../src/legacySource/confidentialInventory');
const { runLegacySourceEvidenceGraph } = require('../src/legacySource/confidentialEvidenceGraph');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'cli', 'zeus.js');

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-legacy-graph-'));
  const workspace = path.join(root, 'workspace');
  const source = path.join(root, 'source');
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(source, { recursive: true });

  const canary = ['graph', 'private', 'synthetic', 'marker'].join('-');
  const credentialCanary = ['graph', 'credential', 'synthetic', 'marker'].join('-');
  const hiddenName = ['graph', 'hidden', 'unit'].join('-');
  const files = {
    [`${hiddenName}.rpgle`]: `**free\n// ${canary}\nDCL-S STATUS CHAR(10);\nEXEC SQL\n  SELECT VALUE INTO :STATUS FROM GRAPH_TABLE;\nEND-EXEC;\n`,
    'orchestrator.clle': `PGM\n  /* ${credentialCanary} */\n  CALL PGM(GRAPH_PROGRAM)\nENDPGM\n`,
    'screen.dds': 'A          R SCREEN\nA            FIELD         10A  B\n',
    'query.sql': `SELECT VALUE FROM GRAPH_TABLE WHERE NOTE = '${canary}';\n`,
    'binding.bnd': 'STRPGMEXP PGMLVL(*CURRENT)\nENDPGMEXP\n',
    'include.rpgleinc': `DCL-C MARKER CONST('${canary}');\n`,
    'unrelated.txt': `not a source candidate ${credentialCanary}\n`,
  };
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(source, name), content, 'utf8');
  }
  return { root, workspace, source, canary, credentialCanary, hiddenName };
}

function treeDigest(directory) {
  const hash = crypto.createHash('sha256');
  function visit(current) {
    for (const entry of fs
      .readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const location = path.join(current, entry.name);
      hash.update(entry.name);
      if (entry.isDirectory()) visit(location);
      else if (entry.isFile()) hash.update(fs.readFileSync(location));
    }
  }
  visit(directory);
  return hash.digest('hex');
}

function runGraph(fixture, out = '.local/legacy-source-inventory/evidence-graph.json') {
  runLegacySourceInventory({
    sourceRoot: fixture.source,
    workspaceRoot: fixture.workspace,
    out: '.local/legacy-source-inventory/inventory.json',
    salt: 'synthetic-graph-test-salt',
  });
  return runLegacySourceEvidenceGraph({
    sourceRoot: fixture.source,
    workspaceRoot: fixture.workspace,
    inventory: '.local/legacy-source-inventory/inventory.json',
    out,
    salt: 'synthetic-graph-test-salt',
  });
}

test('legacy-source graph is cross-language, anonymized, and read-only', () => {
  const fixture = createFixture();
  try {
    const before = treeDigest(fixture.source);
    const result = runGraph(fixture);
    const artifactPath = path.join(fixture.workspace, result.artifacts[0]);
    const artifactText = fs.readFileSync(artifactPath, 'utf8');
    const artifact = JSON.parse(artifactText);

    assert.equal(result.ok, true);
    assert.equal(result.readOnly, true);
    assert.equal(artifact.readOnly, true);
    assert.equal(artifact.privacy.containsRawSource, false);
    assert.equal(artifact.privacy.containsSourcePaths, false);
    assert.equal(artifact.privacy.containsSourceNames, false);
    assert.equal(artifact.privacy.containsCredentials, false);
    assert.equal(artifact.graph.complete, true);
    assert.ok(artifact.graph.byFamily.RPG >= 1);
    assert.ok(artifact.graph.byFamily.CL >= 1);
    assert.ok(artifact.graph.byFamily.DDS >= 1);
    assert.ok(artifact.graph.byFamily.SQL >= 1);
    assert.ok(artifact.graph.byEdgeKind.EXECUTES_SQL >= 1);
    assert.ok(artifact.graph.byEdgeKind.REFERENCES_SQL_DATA_OBJECT >= 1);
    assert.ok(artifact.graph.nodes.length > artifact.graph.byFamily.RPG);
    assert.doesNotMatch(artifactText, new RegExp(fixture.canary));
    assert.doesNotMatch(artifactText, new RegExp(fixture.credentialCanary));
    assert.doesNotMatch(artifactText, new RegExp(fixture.hiddenName));
    assert.doesNotMatch(
      artifactText,
      new RegExp(fixture.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    );
    assert.ok(artifact.graph.nodes.every(node => /^[a-f0-9]{64}$/.test(node.id)));
    assert.ok(artifact.graph.edges.every(edge => /^[a-f0-9]{64}$/.test(edge.id)));
    assert.equal(treeDigest(fixture.source), before);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('legacy-source graph is deterministic and linked to the inventory fingerprint', () => {
  const fixture = createFixture();
  try {
    const first = runGraph(fixture);
    const firstText = fs.readFileSync(path.join(fixture.workspace, first.artifacts[0]), 'utf8');
    const second = runGraph(fixture);
    const secondText = fs.readFileSync(path.join(fixture.workspace, second.artifacts[0]), 'utf8');

    assert.equal(firstText, secondText);
    assert.equal(first.summary.nodeCount, second.summary.nodeCount);
    assert.equal(first.summary.edgeCount, second.summary.edgeCount);
    assert.equal(first.summary.scannedFiles, second.summary.scannedFiles);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('legacy-source graph rejects unsafe output and source boundaries', () => {
  const fixture = createFixture();
  try {
    assert.throws(
      () =>
        runLegacySourceEvidenceGraph({
          sourceRoot: fixture.source,
          workspaceRoot: fixture.workspace,
          inventory: '.local/legacy-source-inventory/inventory.json',
          out: '../outside.json',
          salt: 'synthetic-graph-test-salt',
        }),
      error => error.code === 'OUTPUT_OUTSIDE_WORKSPACE'
    );

    assert.throws(
      () =>
        runLegacySourceEvidenceGraph({
          sourceRoot: fixture.workspace,
          workspaceRoot: fixture.workspace,
          inventory: '.local/legacy-source-inventory/inventory.json',
          out: '.local/legacy-source-inventory/evidence-graph.json',
          salt: 'synthetic-graph-test-salt',
        }),
      error => error.code === 'SOURCE_OUTPUT_OVERLAP'
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('legacy-source graph CLI emits only its bounded result', () => {
  const fixture = createFixture();
  try {
    const inventoryRun = spawnSync(
      process.execPath,
      [
        CLI,
        'legacy-source',
        'inventory',
        '--source-root',
        fixture.source,
        '--out',
        '.local/legacy-source-inventory/inventory.json',
        '--json',
      ],
      { cwd: fixture.workspace, encoding: 'utf8' }
    );
    assert.equal(inventoryRun.status, 0, inventoryRun.stderr);

    const graphRun = spawnSync(
      process.execPath,
      [
        CLI,
        'legacy-source',
        'graph',
        '--source-root',
        fixture.source,
        '--inventory',
        '.local/legacy-source-inventory/inventory.json',
        '--out',
        '.local/legacy-source-inventory/evidence-graph.json',
        '--json',
      ],
      { cwd: fixture.workspace, encoding: 'utf8' }
    );
    assert.equal(graphRun.status, 0, graphRun.stderr);
    const payload = JSON.parse(graphRun.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.readOnly, true);
    assert.doesNotMatch(graphRun.stdout, new RegExp(fixture.canary));
    assert.doesNotMatch(graphRun.stdout, new RegExp(fixture.credentialCanary));
    assert.doesNotMatch(graphRun.stdout, new RegExp(fixture.hiddenName));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
