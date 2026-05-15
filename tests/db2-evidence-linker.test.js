const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scanSourceFiles } = require('../src/scanner/rpgScanner');
const { buildCanonicalAnalysisModel } = require('../src/context/canonicalAnalysisModel');
const { buildContext } = require('../src/context/contextBuilder');
const { buildDb2SourceLinkage } = require('../src/db2/db2EvidenceLinker');
const { readSanitizedFixtureJson, readSanitizedFixtureText } = require('./helpers/fixtureCorpus');

const db2Fixture = readSanitizedFixtureJson('db2', 'catalog-linkage.json');
const sqlAnalysisSource = readSanitizedFixtureText('source', 'sql-analysis', 'PROGRAM_001.sqlrpgle');

test('buildDb2SourceLinkage maps DB2 metadata tables back to source evidence and ambiguity diagnostics', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-db2-linkage-'));
  const sourceFile = path.join(tempRoot, 'PROGRAM_001.sqlrpgle');

  fs.writeFileSync(sourceFile, sqlAnalysisSource, 'utf8');

  try {
    const scanSummary = scanSourceFiles([sourceFile]);
    const canonicalAnalysis = buildCanonicalAnalysisModel({
      program: 'PROGRAM_001',
      sourceRoot: tempRoot,
      sourceFiles: scanSummary.sourceFiles,
      dependencies: {
        tables: scanSummary.tables,
        calls: scanSummary.calls,
        copyMembers: scanSummary.copyMembers,
        sqlStatements: scanSummary.sqlStatements,
        procedures: scanSummary.procedures,
        prototypes: scanSummary.prototypes,
        procedureCalls: scanSummary.procedureCalls,
        nativeFiles: scanSummary.nativeFiles,
        nativeFileAccesses: scanSummary.nativeFileAccesses,
        modules: scanSummary.modules,
        bindingDirectories: scanSummary.bindingDirectories,
        servicePrograms: scanSummary.servicePrograms,
      },
      notes: scanSummary.notes,
    });
    const context = buildContext({ canonicalAnalysis });

    const linkage = buildDb2SourceLinkage({
      requestedTables: db2Fixture.requestedTables,
      exportedTables: db2Fixture.exportedTables,
      canonicalAnalysis,
      context,
    });

    const table001Link = linkage.tableLinks.find((entry) => entry.requestedName === 'TABLE_001');
    const table404Link = linkage.tableLinks.find((entry) => entry.requestedName === 'TABLE_404');

    assert.equal(table001Link.matchStatus, 'ambiguous');
    assert.equal(table001Link.matches.length, 2);
    assert.ok(table001Link.sourceEvidence.length >= 1);
    assert.ok(table001Link.sqlReferences.length >= 1);
    assert.ok(table001Link.nativeFiles.length >= 1);
    assert.ok(linkage.diagnostics.some((entry) => entry.code === 'DB2_TABLE_AMBIGUOUS'));

    assert.equal(table404Link.matchStatus, 'unresolved');
    assert.ok(linkage.unresolvedTables.includes('TABLE_404'));
    assert.ok(linkage.diagnostics.some((entry) => entry.code === 'DB2_TABLE_UNRESOLVED'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
