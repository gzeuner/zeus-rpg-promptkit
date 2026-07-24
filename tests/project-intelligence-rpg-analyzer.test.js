'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  createRpgAnalyzer,
  createSnapshotEngine,
  sha256Hex,
  canonicalizeContent,
  KnowledgeStoreError,
  probeNodeSqlite,
} = require('../src/projectIntelligence');

const HAS_SQLITE = probeNodeSqlite().available;
const FIXTURE_ORDER = path.join(__dirname, 'fixtures', 'v1-smoke', 'src', 'ORDERPGM.rpgle');
const FIXTURE_INV = path.join(__dirname, 'fixtures', 'v1-smoke', 'src', 'INVPGM.rpgle');
const FIXTURE_FREE = path.join(
  __dirname,
  'fixtures',
  'sanitized-corpus',
  'scanner',
  'core-patterns',
  'freeform-order.rpgle'
);

function unitFromBody(relativePath, body, rootId = 'root-src') {
  const { bytes } = canonicalizeContent(body, { mode: 'text' });
  const contentHash = sha256Hex(bytes);
  return {
    sourceUnitId: `su:${rootId}:${relativePath}`,
    trustedRootId: rootId,
    relativePath,
    contentHash,
    sizeBytes: bytes.length,
    language: relativePath.endsWith('.clle') ? 'clle' : 'rpgle',
    hashAlgorithm: 'sha256',
    body,
    bytes,
  };
}

function analyzeFixtures(files) {
  const analyzer = createRpgAnalyzer();
  const units = [];
  const bodiesByHash = {};
  for (const [relativePath, body] of Object.entries(files)) {
    const u = unitFromBody(relativePath, body);
    units.push(u);
    bodiesByHash[u.contentHash] = u.bytes.toString('utf8');
  }
  const result = analyzer.analyze({
    projectId: 'proj-demo',
    snapshotId: 'snap-test',
    units,
    bodiesByHash,
  });
  return result;
}

test('RPG analyzer extracts programs, procedures, copy, sql, calls with spans', () => {
  const orderBody = fs.readFileSync(FIXTURE_ORDER, 'utf8');
  const invBody = fs.readFileSync(FIXTURE_INV, 'utf8');
  const result = analyzeFixtures({
    'QRPGLESRC/ORDERPGM.rpgle': orderBody,
    'QRPGLESRC/INVPGM.rpgle': invBody,
  });

  assert.equal(result.analyzerId, 'zeus.rpg-ibmi-baseline');
  const kinds = new Set(result.symbols.map(s => s.symbolKind));
  assert.ok(kinds.has('PROGRAM'));
  assert.ok(kinds.has('PROCEDURE') || kinds.has('COPY_MEMBER') || kinds.has('TABLE'));

  // ORDERPGM program symbol
  const order = result.symbols.find(s => s.name === 'ORDERPGM' && s.symbolKind === 'PROGRAM');
  assert.ok(order);
  assert.ok(order.evidenceReferences.length >= 1);
  assert.equal(order.provenance.derivationClass, 'VERIFIED');

  // Copy include
  const copyRel = result.relationships.find(r => r.relationshipType === 'COPY_INCLUDE');
  assert.ok(copyRel, 'expected COPY_INCLUDE relationship');

  // Resolved program call ORDERPGM -> INVPGM
  const call = result.relationships.find(
    r => r.relationshipType === 'PROGRAM_CALL' && r.toSymbolId.includes('INVPGM')
  );
  assert.ok(call, 'expected resolved PROGRAM_CALL to INVPGM');

  // SQL table reference
  const sqlRel = result.relationships.find(r => r.relationshipType === 'SQL_REFERENCE');
  assert.ok(sqlRel, 'expected SQL_REFERENCE');

  // Source spans present and line-bounded
  assert.ok(result.sourceSpans.length >= 1);
  for (const span of result.sourceSpans) {
    assert.ok(span.start.line >= 1);
    assert.ok(span.end.line >= span.start.line);
    assert.ok(span.sourceUnitId);
    assert.ok(span.contentHash);
  }

  // No absolute host paths in evidence relativePath
  for (const ev of result.evidence) {
    if (ev.relativePath) {
      assert.equal(/^[A-Za-z]:[\\/]/.test(ev.relativePath), false);
    }
  }
});

test('unresolved procedure calls produce UNRESOLVED_SYMBOL model', () => {
  const orderBody = fs.readFileSync(FIXTURE_ORDER, 'utf8');
  const result = analyzeFixtures({
    'QRPGLESRC/ORDERPGM.rpgle': orderBody,
  });

  // ProcessOrder is called but not defined in this single unit
  const unresolvedSym = result.symbols.filter(s => s.symbolKind === 'UNRESOLVED_SYMBOL');
  assert.ok(unresolvedSym.length >= 1, 'expected unresolved symbols');
  assert.ok(result.unresolved.length >= 1);
  assert.ok(result.unresolved.every(u => u.name && u.fromSymbolId));

  const dyn = result.relationships.filter(r => r.relationshipType === 'DYNAMIC_UNRESOLVED_CALL');
  assert.ok(dyn.length >= 1);
  assert.ok(dyn.every(r => r.provenance.derivationClass === 'UNRESOLVED'));
});

test('analyzer output is deterministic across runs', () => {
  const body = fs.readFileSync(FIXTURE_FREE, 'utf8');
  const a = analyzeFixtures({ 'freeform-order.rpgle': body });
  const b = analyzeFixtures({ 'freeform-order.rpgle': body });
  assert.deepEqual(
    a.symbols.map(s => s.symbolId),
    b.symbols.map(s => s.symbolId)
  );
  assert.deepEqual(
    a.relationships.map(r => r.relationshipId),
    b.relationships.map(r => r.relationshipId)
  );
  assert.deepEqual(
    a.sourceSpans.map(s => s.spanId),
    b.sourceSpans.map(s => s.spanId)
  );
  assert.deepEqual(a.unresolved, b.unresolved);
});

test('ambiguous same basename across libraries remains separate source units', () => {
  const body = '**free\ncall OTHER;\n';
  const result = analyzeFixtures({
    'LIBA/QRPGLESRC/SAMEPGM.rpgle': body,
    'LIBB/QRPGLESRC/SAMEPGM.rpgle': body,
  });
  const programs = result.symbols.filter(s => s.symbolKind === 'PROGRAM' && s.name === 'SAMEPGM');
  assert.equal(programs.length, 2);
  assert.notEqual(programs[0].symbolId, programs[1].symbolId);
});

test(
  'engine default uses RPG analyzer and publishes extractable graph',
  { skip: !HAS_SQLITE },
  () => {
    const os = require('os');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zpi-rpg-eng-'));
    const src = path.join(root, 'src');
    const knowledgeRoot = path.join(root, 'pk');
    fs.mkdirSync(src, { recursive: true });
    fs.copyFileSync(FIXTURE_ORDER, path.join(src, 'ORDERPGM.rpgle'));
    fs.copyFileSync(FIXTURE_INV, path.join(src, 'INVPGM.rpgle'));

    const engine = createSnapshotEngine({
      knowledgeRoot,
      projectId: 'proj-rpg',
      trustedRoots: [{ rootId: 'root-src', path: src }],
    });
    try {
      const published = engine.fullRebuild();
      assert.equal(published.ok, true);
      assert.equal(published.analyzer.analyzerId, 'zeus.rpg-ibmi-baseline');
      const snapId = published.snapshot.snapshotId;
      const symbols = engine._store.listSymbols('proj-rpg', snapId);
      const rels = engine._store.listRelationships('proj-rpg', snapId);
      assert.ok(symbols.some(s => s.name === 'ORDERPGM'));
      assert.ok(
        rels.some(
          r => r.relationshipType === 'PROGRAM_CALL' || r.relationshipType === 'COPY_INCLUDE'
        )
      );
    } finally {
      engine.close();
    }
  }
);

test('graph projection sorts deterministically for equality views', { skip: !HAS_SQLITE }, () => {
  const os = require('os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zpi-rpg-eq-'));
  const src = path.join(root, 'src');
  const knowledgeRoot = path.join(root, 'pk');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'A.rpgle'), '**free\ncall B;\n', 'utf8');
  fs.writeFileSync(path.join(src, 'B.rpgle'), '**free\n// B\n', 'utf8');
  const engine = createSnapshotEngine({
    knowledgeRoot,
    projectId: 'proj-eq',
    trustedRoots: [{ rootId: 'root-src', path: src }],
  });
  try {
    engine.fullRebuild();
    const id = engine.getCurrentSnapshot().snapshotId;
    const v1 = engine.projectEqualityView(id);
    const v2 = engine.projectEqualityView(id);
    assert.deepEqual(v1, v2);
  } finally {
    engine.close();
  }
});

// silence unused import in non-sqlite environments
void KnowledgeStoreError;
