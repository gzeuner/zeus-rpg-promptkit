const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scanSourceFiles } = require('../src/scanner/rpgScanner');
const { buildCanonicalAnalysisModel } = require('../src/context/canonicalAnalysisModel');
const { buildContext } = require('../src/context/contextBuilder');
const { buildDb2SourceLinkage } = require('../src/db2/db2EvidenceLinker');

test('buildDb2SourceLinkage maps DB2 metadata tables back to source evidence and ambiguity diagnostics', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-db2-linkage-'));
  const sourceFile = path.join(tempRoot, 'ORDERPGM.sqlrpgle');

  fs.writeFileSync(sourceFile, `**FREE
dcl-f ORDERS keyed usage(*update);
dcl-proc main;
  exec sql
    select ORDER_ID
      from ORDERS;
end-proc;
`, 'utf8');

  try {
    const scanSummary = scanSourceFiles([sourceFile]);
    const canonicalAnalysis = buildCanonicalAnalysisModel({
      program: 'ORDERPGM',
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
      requestedTables: ['ORDERS', 'INVOICE'],
      exportedTables: [
        { schema: 'APP', table: 'ORDERS', columns: [{ name: 'ORDER_ID', type: 'DECIMAL' }] },
        { schema: 'LEGACY', table: 'ORDERS', columns: [{ name: 'ORDER_ID', type: 'DECIMAL' }] },
      ],
      canonicalAnalysis,
      context,
    });

    const ordersLink = linkage.tableLinks.find((entry) => entry.requestedName === 'ORDERS');
    const invoiceLink = linkage.tableLinks.find((entry) => entry.requestedName === 'INVOICE');

    assert.equal(ordersLink.matchStatus, 'ambiguous');
    assert.equal(ordersLink.matches.length, 2);
    assert.ok(ordersLink.sourceEvidence.length >= 1);
    assert.ok(ordersLink.sqlReferences.length >= 1);
    assert.ok(ordersLink.nativeFiles.length >= 1);
    assert.ok(linkage.diagnostics.some((entry) => entry.code === 'DB2_TABLE_AMBIGUOUS'));

    assert.equal(invoiceLink.matchStatus, 'unresolved');
    assert.ok(linkage.unresolvedTables.includes('INVOICE'));
    assert.ok(linkage.diagnostics.some((entry) => entry.code === 'DB2_TABLE_UNRESOLVED'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
