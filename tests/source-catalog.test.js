const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildSourceCatalog } = require('../src/source/sourceCatalog');
const { buildCrossProgramGraph } = require('../src/dependency/crossProgramGraphBuilder');
const { resolveProgram } = require('../src/dependency/programSourceResolver');
const { copySanitizedFixtureTree } = require('./helpers/fixtureCorpus');

test('buildSourceCatalog uses import-manifest identity and exposes ambiguous members', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-source-catalog-'));
  const sourceRoot = path.join(tempRoot, 'src');
  copySanitizedFixtureTree(path.join('source', 'catalog-ambiguous-root'), sourceRoot);

  const orderRpg = path.join(sourceRoot, 'QRPGLESRC', 'PROGRAM_010.rpgle');
  const orderCl = path.join(sourceRoot, 'QCLLESRC', 'PROGRAM_010.clle');

  const catalog = buildSourceCatalog({
    sourceRoot,
    sourceFiles: [orderRpg, orderCl],
  });

  assert.equal(catalog.summary.fileCount, 2);
  assert.equal(catalog.summary.ambiguousMemberCount, 1);
  assert.deepEqual(catalog.summary.ambiguousMembers, ['PROGRAM_010']);
  assert.deepEqual(
    catalog.entries.map((entry) => entry.identity),
    ['FIXLIB/QCLLESRC(PROGRAM_010)', 'FIXLIB/QRPGLESRC(PROGRAM_010)'],
  );

  const resolved = resolveProgram('PROGRAM_010', catalog);
  assert.equal(resolved.ambiguous, true);
  assert.equal(resolved.path, null);
  assert.equal(resolved.matches.length, 2);

  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('cross-program graph leaves ambiguous duplicate members unresolved with explicit notes', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-cross-program-ambiguity-'));
  const sourceRoot = path.join(tempRoot, 'src');
  copySanitizedFixtureTree(path.join('source', 'catalog-cross-program-root'), sourceRoot);

  const rootFile = path.join(sourceRoot, 'QRPGLESRC', 'CALLERPGM.rpgle');
  const dupRpg = path.join(sourceRoot, 'QRPGLESRC', 'PROGRAM_020.rpgle');
  const dupCl = path.join(sourceRoot, 'QCLLESRC', 'PROGRAM_020.clle');

  const graph = buildCrossProgramGraph({
    rootProgram: 'CALLERPGM',
    sourceRoot,
    sourceFiles: [rootFile, dupRpg, dupCl],
  });

  assert.ok(graph.nodes.some((node) => node.id === 'PROGRAM_020' && node.type === 'PROGRAM'));
  assert.ok(graph.edges.some((edge) => edge.from === 'CALLERPGM' && edge.to === 'PROGRAM_020' && edge.type === 'CALLS_PROGRAM'));
  assert.deepEqual(graph.ambiguousPrograms, ['PROGRAM_020']);
  assert.deepEqual(graph.unresolvedPrograms, ['PROGRAM_020']);
  assert.ok(graph.notes.some((note) => note.includes('Ambiguous local sources found for program PROGRAM_020')));
  assert.equal(graph.sourceCatalog.ambiguousMemberCount, 1);

  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('cross-program graph records explicit diagnostics when large-tree safety limits are reached', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-cross-program-limits-'));
  const sourceRoot = path.join(tempRoot, 'src');
  fs.mkdirSync(sourceRoot, { recursive: true });

  fs.writeFileSync(path.join(sourceRoot, 'ROOTPGM.rpgle'), '**FREE\nCALL SUBPGM001;\nCALL SUBPGM002;\nCALL SUBPGM003;\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, 'SUBPGM001.rpgle'), '**FREE\nCALL SUBPGM010;\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, 'SUBPGM002.rpgle'), '**FREE\nCALL SUBPGM020;\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, 'SUBPGM003.rpgle'), '**FREE\nCALL SUBPGM030;\n', 'utf8');

  const graph = buildCrossProgramGraph({
    rootProgram: 'ROOTPGM',
    sourceRoot,
    sourceFiles: [
      path.join(sourceRoot, 'ROOTPGM.rpgle'),
      path.join(sourceRoot, 'SUBPGM001.rpgle'),
      path.join(sourceRoot, 'SUBPGM002.rpgle'),
      path.join(sourceRoot, 'SUBPGM003.rpgle'),
    ],
    limits: {
      maxProgramDepth: 0,
      maxPrograms: 10,
      maxNodes: 20,
      maxEdges: 20,
      maxScannedFiles: 10,
      maxProgramCallsPerProgram: 2,
    },
  });

  assert.equal(graph.summary.truncated, true);
  assert.equal(graph.summary.limitsReached.maxProgramDepth, true);
  assert.equal(graph.summary.limitsReached.maxProgramCallsPerProgram, true);
  assert.ok(graph.diagnostics.some((entry) => entry.code === 'CROSS_PROGRAM_MAX_DEPTH_REACHED'));
  assert.ok(graph.diagnostics.some((entry) => entry.code === 'CROSS_PROGRAM_MAX_CALLS_PER_PROGRAM_REACHED'));
  assert.ok(graph.notes.some((note) => note.includes('configured depth limit')));

  fs.rmSync(tempRoot, { recursive: true, force: true });
});
