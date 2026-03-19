const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildSourceCatalog } = require('../src/source/sourceCatalog');
const { buildCrossProgramGraph } = require('../src/dependency/crossProgramGraphBuilder');
const { resolveProgram } = require('../src/dependency/programSourceResolver');
const { writeImportManifest } = require('../src/fetch/importManifest');

test('buildSourceCatalog uses import-manifest identity and exposes ambiguous members', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-source-catalog-'));
  const sourceRoot = path.join(tempRoot, 'src');
  fs.mkdirSync(path.join(sourceRoot, 'QRPGLESRC'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, 'QCLLESRC'), { recursive: true });

  const orderRpg = path.join(sourceRoot, 'QRPGLESRC', 'ORDERPGM.rpgle');
  const orderCl = path.join(sourceRoot, 'QCLLESRC', 'ORDERPGM.clle');
  fs.writeFileSync(orderRpg, '**FREE\n', 'utf8');
  fs.writeFileSync(orderCl, 'PGM\nENDPGM\n', 'utf8');

  writeImportManifest(sourceRoot, {
    schemaVersion: 1,
    tool: { name: 'zeus-rpg-promptkit', command: 'fetch' },
    fetchedAt: '2026-03-19T00:00:00.000Z',
    remote: { host: 'myibmi.example.com', sourceLib: 'SOURCEN', ifsDir: '/home/zeus/rpg_sources' },
    localDestination: sourceRoot,
    transportRequested: 'sftp',
    transportUsed: 'sftp',
    streamFileCcsid: 1208,
    encodingPolicy: 'UTF-8 stream files (CCSID 1208)',
    summary: {},
    files: [
      {
        sourceLib: 'APPLIB',
        sourceFile: 'QRPGLESRC',
        member: 'ORDERPGM',
        localPath: 'QRPGLESRC/ORDERPGM.rpgle',
      },
      {
        sourceLib: 'APPLIB',
        sourceFile: 'QCLLESRC',
        member: 'ORDERPGM',
        localPath: 'QCLLESRC/ORDERPGM.clle',
      },
    ],
  });

  const catalog = buildSourceCatalog({
    sourceRoot,
    sourceFiles: [orderRpg, orderCl],
  });

  assert.equal(catalog.summary.fileCount, 2);
  assert.equal(catalog.summary.ambiguousMemberCount, 1);
  assert.deepEqual(catalog.summary.ambiguousMembers, ['ORDERPGM']);
  assert.deepEqual(
    catalog.entries.map((entry) => entry.identity),
    ['APPLIB/QCLLESRC(ORDERPGM)', 'APPLIB/QRPGLESRC(ORDERPGM)'],
  );

  const resolved = resolveProgram('ORDERPGM', catalog);
  assert.equal(resolved.ambiguous, true);
  assert.equal(resolved.path, null);
  assert.equal(resolved.matches.length, 2);

  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('cross-program graph leaves ambiguous duplicate members unresolved with explicit notes', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-cross-program-ambiguity-'));
  const sourceRoot = path.join(tempRoot, 'src');
  fs.mkdirSync(path.join(sourceRoot, 'QRPGLESRC'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, 'QCLLESRC'), { recursive: true });

  const rootFile = path.join(sourceRoot, 'QRPGLESRC', 'ROOTPGM.rpgle');
  const dupRpg = path.join(sourceRoot, 'QRPGLESRC', 'DUPPGM.rpgle');
  const dupCl = path.join(sourceRoot, 'QCLLESRC', 'DUPPGM.clle');

  fs.writeFileSync(rootFile, '**FREE\nCALL DUPPGM;\n', 'utf8');
  fs.writeFileSync(dupRpg, '**FREE\nDCL-F ORDERS DISK;\n', 'utf8');
  fs.writeFileSync(dupCl, 'PGM\nENDPGM\n', 'utf8');

  writeImportManifest(sourceRoot, {
    schemaVersion: 1,
    tool: { name: 'zeus-rpg-promptkit', command: 'fetch' },
    fetchedAt: '2026-03-19T00:00:00.000Z',
    remote: { host: 'myibmi.example.com', sourceLib: 'SOURCEN', ifsDir: '/home/zeus/rpg_sources' },
    localDestination: sourceRoot,
    transportRequested: 'sftp',
    transportUsed: 'sftp',
    streamFileCcsid: 1208,
    encodingPolicy: 'UTF-8 stream files (CCSID 1208)',
    summary: {},
    files: [
      {
        sourceLib: 'APPLIB',
        sourceFile: 'QRPGLESRC',
        member: 'ROOTPGM',
        localPath: 'QRPGLESRC/ROOTPGM.rpgle',
      },
      {
        sourceLib: 'APPLIB',
        sourceFile: 'QRPGLESRC',
        member: 'DUPPGM',
        localPath: 'QRPGLESRC/DUPPGM.rpgle',
      },
      {
        sourceLib: 'APPLIB',
        sourceFile: 'QCLLESRC',
        member: 'DUPPGM',
        localPath: 'QCLLESRC/DUPPGM.clle',
      },
    ],
  });

  const graph = buildCrossProgramGraph({
    rootProgram: 'ROOTPGM',
    sourceRoot,
    sourceFiles: [rootFile, dupRpg, dupCl],
  });

  assert.ok(graph.nodes.some((node) => node.id === 'DUPPGM' && node.type === 'PROGRAM'));
  assert.ok(graph.edges.some((edge) => edge.from === 'ROOTPGM' && edge.to === 'DUPPGM' && edge.type === 'CALLS_PROGRAM'));
  assert.deepEqual(graph.ambiguousPrograms, ['DUPPGM']);
  assert.deepEqual(graph.unresolvedPrograms, ['DUPPGM']);
  assert.ok(graph.notes.some((note) => note.includes('Ambiguous local sources found for program DUPPGM')));
  assert.equal(graph.sourceCatalog.ambiguousMemberCount, 1);

  fs.rmSync(tempRoot, { recursive: true, force: true });
});
