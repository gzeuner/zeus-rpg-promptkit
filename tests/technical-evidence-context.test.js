'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildTechnicalEvidenceContext,
  validateTechnicalEvidenceContext,
} = require('../src/context/technicalEvidenceContext');
const zeusApi = require('../src/api/zeusApi');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'cli', 'zeus.js');
const IDS = Object.freeze({
  source: 'a'.repeat(64),
  program: 'b'.repeat(64),
  data: 'c'.repeat(64),
  edgeOne: 'd'.repeat(64),
  edgeTwo: 'e'.repeat(64),
});

function graphFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'zeus-anonymized-technical-evidence-graph',
    readOnly: true,
    sourceBoundary: {
      mode: 'local-read-only',
      followsSymlinks: false,
      pathDisclosure: 'none',
      contentDisclosure: 'none',
    },
    provenance: { graphFingerprint: 'f'.repeat(64), sourceScan: 'local-parser-evidence-only' },
    privacy: {
      containsRawSource: false,
      containsSourcePaths: false,
      containsSourceNames: false,
      containsCredentials: false,
      containsBusinessTerms: false,
      hashAlgorithm: 'hmac-sha256',
    },
    warnings: [],
    graph: {
      complete: true,
      scannedFiles: 3,
      skippedFiles: 0,
      nodeCount: 3,
      edgeCount: 2,
      byNodeKind: { 'source-file': 1, program: 1, 'data-object': 1 },
      byEdgeKind: { CALLS_PROGRAM: 1, REFERENCES_DATA_OBJECT: 1 },
      byFamily: { RPG: 2, SQL: 1 },
      nodes: [
        { id: IDS.source, kind: 'source-file', sourceType: 'rpgle', family: 'RPG' },
        { id: IDS.program, kind: 'program', family: 'RPG' },
        { id: IDS.data, kind: 'data-object', family: 'SQL' },
      ],
      edges: [
        { id: IDS.edgeOne, kind: 'CALLS_PROGRAM', from: IDS.source, to: IDS.program, count: 1 },
        {
          id: IDS.edgeTwo,
          kind: 'REFERENCES_DATA_OBJECT',
          from: IDS.program,
          to: IDS.data,
          count: 2,
        },
      ],
    },
    ...overrides,
  };
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
}

test('technical evidence context is deterministic, bounded, and contract-valid', () => {
  const first = buildTechnicalEvidenceContext({
    evidence: graphFixture(),
    goalCode: 'dependency-impact',
    targetIds: [IDS.program],
    maxNodes: 3,
    maxEdges: 2,
    tokenBudget: 1000,
  });
  const permuted = graphFixture({
    warnings: ['SCANNER_PARTIAL_FAILURE', 'SOURCE_FILE_UNREADABLE', 'SCANNER_PARTIAL_FAILURE'],
    graph: {
      ...graphFixture().graph,
      nodes: [...graphFixture().graph.nodes].reverse(),
      edges: [...graphFixture().graph.edges].reverse(),
      complete: false,
    },
  });
  const second = buildTechnicalEvidenceContext({
    evidence: permuted,
    goalCode: 'dependency-impact',
    targetIds: [IDS.program],
    maxNodes: 3,
    maxEdges: 2,
    tokenBudget: 1000,
  });

  assert.equal(validateTechnicalEvidenceContext(first).length, 0);
  assert.equal(first.kind, 'zeus-technical-evidence-context');
  assert.equal(first.privacy.containsRawSource, false);
  assert.equal(first.privacy.containsSourcePaths, false);
  assert.deepEqual(first.selection.targets, [IDS.program]);
  assert.equal(first.evidence.nodeCount, 3);
  assert.equal(first.evidence.edgeCount, 2);
  assert.doesNotMatch(JSON.stringify(first), /source-name-canary|C:\\|SELECT\s+\*/i);
  assert.notEqual(first.contextFingerprint, second.contextFingerprint);

  const stableAgain = buildTechnicalEvidenceContext({
    evidence: graphFixture(),
    goalCode: 'dependency-impact',
    targetIds: [IDS.program],
    maxNodes: 3,
    maxEdges: 2,
    tokenBudget: 1000,
  });
  assert.deepEqual(first, stableAgain);
});

test('technical evidence context is exposed through the public API contract surface', () => {
  assert.equal(typeof zeusApi.buildTechnicalEvidenceContext, 'function');
  assert.equal(typeof zeusApi.validateTechnicalEvidenceContext, 'function');
  assert.deepEqual(zeusApi.technicalEvidenceContextContract, {
    id: 'zeus.technical-evidence-context',
    version: 1,
  });
  assert.equal(typeof zeusApi.zeus.buildTechnicalEvidenceContext, 'function');
});

test('technical evidence context fails closed for unsafe fields and boundaries', () => {
  assert.throws(
    () =>
      buildTechnicalEvidenceContext({
        evidence: graphFixture({
          privacy: { ...graphFixture().privacy, containsSourceNames: true },
        }),
      }),
    error => error.code === 'TECHNICAL_EVIDENCE_UNSAFE'
  );

  const unsafeNode = graphFixture();
  unsafeNode.graph.nodes[0].name = 'private-name-canary';
  assert.throws(
    () => buildTechnicalEvidenceContext({ evidence: unsafeNode }),
    error => error.code === 'TECHNICAL_EVIDENCE_UNSAFE'
  );
});

test('technical evidence context preserves uncertainty and reports bounded omissions', () => {
  const result = buildTechnicalEvidenceContext({
    evidence: graphFixture({
      warnings: ['SCANNER_PARTIAL_FAILURE'],
      graph: { ...graphFixture().graph, complete: false },
    }),
    targetIds: [IDS.program],
    maxNodes: 2,
    maxEdges: 0,
    tokenBudget: 1000,
  });

  assert.equal(result.uncertainty.complete, false);
  assert.deepEqual(result.uncertainty.warningCodes, ['SCANNER_PARTIAL_FAILURE']);
  assert.ok(result.selection.omissions.includes('NODE_LIMIT_REACHED'));
  assert.ok(result.selection.omissions.includes('EDGE_LIMIT_REACHED'));
  assert.equal(result.evidence.nodeCount, 2);
  assert.equal(result.evidence.edgeCount, 0);
});

test('technical evidence CLI reads and writes only relative local artifacts', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-technical-evidence-'));
  const input = path.join(cwd, 'graph.json');
  fs.writeFileSync(input, `${JSON.stringify(graphFixture())}\n`, 'utf8');

  const result = runCli(
    [
      'technical-evidence',
      'context',
      '--input',
      'graph.json',
      '--out',
      '.local/context.json',
      '--goal-code',
      'architecture',
      '--json',
    ],
    cwd
  );
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.context.kind, 'zeus-technical-evidence-context');
  assert.deepEqual(payload.artifacts, ['.local/context.json']);
  assert.equal(fs.existsSync(path.join(cwd, '.local', 'context.json')), true);
  assert.doesNotMatch(result.stdout, /private-name-canary|C:\\|source-name-canary/i);

  const absoluteInput = runCli(['technical-evidence', 'context', '--input', input, '--json'], cwd);
  assert.equal(absoluteInput.status, 2);
  assert.match(absoluteInput.stdout, /TECHNICAL_EVIDENCE_PATH_UNSAFE/);
});
