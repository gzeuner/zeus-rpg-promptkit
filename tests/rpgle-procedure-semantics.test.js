const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scanRpgFile, scanSourceFiles } = require('../src/scanner/rpgScanner');
const { buildCanonicalAnalysisModel } = require('../src/context/canonicalAnalysisModel');
const { buildContext } = require('../src/context/contextBuilder');

test('scanRpgFile extracts free-form procedures, prototypes, and classified procedure calls', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-proc-free-'));
  const sourceFile = path.join(tempRoot, 'ORDERPGM.rpgle');

  fs.writeFileSync(sourceFile, `**FREE
dcl-pr ProcessOrder extproc('PROCESSORDER');
end-pr;

dcl-proc main;
  callp ProcessOrder();
  call INVPGM;
  callp MissingProc();
  callp(%paddr(SomePtr));
end-proc;

dcl-proc LocalHelper export;
end-proc;
`, 'utf8');

  try {
    const result = scanRpgFile(sourceFile);
    assert.deepEqual(result.calls.map((entry) => entry.name), ['INVPGM']);
    assert.deepEqual(result.procedures.map((entry) => entry.name), ['MAIN', 'LOCALHELPER']);
    assert.deepEqual(result.prototypes.map((entry) => entry.name), ['PROCESSORDER']);

    assert.deepEqual(
      result.procedureCalls.map((entry) => `${entry.ownerName}:${entry.name}:${entry.resolution}`),
      [
        'MAIN:<DYNAMIC>:DYNAMIC',
        'MAIN:MISSINGPROC:UNRESOLVED',
        'MAIN:PROCESSORDER:EXTERNAL',
      ],
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('scanRpgFile extracts fixed-form subroutines and EXSR call ownership', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-proc-fixed-'));
  const sourceFile = path.join(tempRoot, 'LEGACYPGM.rpg');

  fs.writeFileSync(sourceFile, `     FINPUT     IF   E           K DISK
     C                   EXSR      INITSR
     C                   EXSR      MISSING
     C     INITSR        BEGSR
     C                   EVAL      *INLR = *ON
     C                   ENDSR
`, 'utf8');

  try {
    const result = scanRpgFile(sourceFile);
    assert.deepEqual(result.procedures.map((entry) => `${entry.kind}:${entry.name}`), ['SUBROUTINE:INITSR']);
    assert.deepEqual(
      result.procedureCalls.map((entry) => `${entry.ownerName}:${entry.name}:${entry.resolution}:${entry.targetKind}`),
      [
        'LEGACYPGM:INITSR:INTERNAL:SUBROUTINE',
        'LEGACYPGM:MISSING:UNRESOLVED:UNRESOLVED',
      ],
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('canonical analysis model exposes procedure entities and call relations', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-proc-canonical-'));
  const sourceFile = path.join(tempRoot, 'ORDERPGM.rpgle');

  fs.writeFileSync(sourceFile, `**FREE
dcl-pr ProcessOrder extproc('PROCESSORDER');
end-pr;
dcl-proc main;
  callp ProcessOrder();
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
      },
      notes: [],
    });
    const context = buildContext({ canonicalAnalysis });

    assert.ok(canonicalAnalysis.entities.procedures.some((entry) => entry.name === 'MAIN'));
    assert.ok(canonicalAnalysis.entities.prototypes.some((entry) => entry.name === 'PROCESSORDER'));
    assert.ok(canonicalAnalysis.relations.some((entry) => entry.type === 'CALLS_PROCEDURE' && entry.attributes.resolution === 'EXTERNAL'));
    assert.equal(context.procedureAnalysis.summary.procedureCount, 1);
    assert.equal(context.procedureAnalysis.summary.prototypeCount, 1);
    assert.equal(context.procedureAnalysis.summary.externalCallCount, 1);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
