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
