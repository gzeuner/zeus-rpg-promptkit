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

test('scanRpgFile extracts native file I/O semantics with procedure ownership and record formats', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-native-io-free-'));
  const sourceFile = path.join(tempRoot, 'ORDERPGM.rpgle');

  fs.writeFileSync(sourceFile, `**FREE
dcl-f ORDERS disk usage(*input) keyed;
dcl-f ORDERUPD disk usage(*update) keyed;
dcl-f SCREEN workstn;
dcl-f REPORT printer;

dcl-proc main;
  chain CustNo ORDERS;
  setll CustNo ORDERUPD;
  reade CustNo ORDERUPD;
  update ORDERUPD;
  delete ORDERUPD;
  exfmt OrderFmt;
  write PrintLine;
end-proc;
`, 'utf8');

  try {
    const result = scanRpgFile(sourceFile);
    assert.deepEqual(
      result.nativeFiles.map((entry) => `${entry.name}:${entry.kind}:${entry.keyed}:${entry.declaredAccess.join('/')}`),
      [
        'ORDERS:DISK:true:READ',
        'ORDERUPD:DISK:true:READ/UPDATE',
        'REPORT:PRINTER:false:',
        'SCREEN:WORKSTN:false:',
      ],
    );
    assert.deepEqual(
      result.nativeFileAccesses.map((entry) => `${entry.ownerName}:${entry.fileName}:${entry.opcode}:${entry.accessKind}:${entry.recordFormat || '-'}`),
      [
        'MAIN:ORDERS:CHAIN:READ:-',
        'MAIN:ORDERUPD:DELETE:DELETE:-',
        'MAIN:ORDERUPD:READE:READ:-',
        'MAIN:ORDERUPD:SETLL:POSITION:-',
        'MAIN:ORDERUPD:UPDATE:UPDATE:-',
        'MAIN:REPORT:WRITE:WRITE:PRINTLINE',
        'MAIN:SCREEN:EXFMT:DISPLAY:ORDERFMT',
      ],
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('scanRpgFile extracts fixed-form native file I/O semantics', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-native-io-fixed-'));
  const sourceFile = path.join(tempRoot, 'LEGACYPGM.rpg');

  fs.writeFileSync(sourceFile, `     FINPUT     IF   E           K DISK
     FSCREEN    CF   E             WORKSTN
     FQPRINT    O    F  132        PRINTER
     C     CUSTNO        CHAIN     INPUT
     C                   READ      INPUT
     C                   EXFMT     DSPFMT
     C                   WRITE     PRTFMT
`, 'utf8');

  try {
    const result = scanRpgFile(sourceFile);
    assert.deepEqual(
      result.nativeFiles.map((entry) => `${entry.name}:${entry.kind}:${entry.keyed}:${entry.declaredAccess.join('/')}`),
      [
        'INPUT:DISK:true:READ',
        'QPRINT:PRINTER:false:WRITE',
        'SCREEN:WORKSTN:false:',
      ],
    );
    assert.deepEqual(
      result.nativeFileAccesses.map((entry) => `${entry.fileName}:${entry.opcode}:${entry.accessKind}:${entry.recordFormat || '-'}`),
      [
        'INPUT:CHAIN:READ:-',
        'INPUT:READ:READ:-',
        'QPRINT:WRITE:WRITE:PRTFMT',
        'SCREEN:EXFMT:DISPLAY:DSPFMT',
      ],
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('canonical analysis model projects native file usage semantics and risk hints', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-native-io-canonical-'));
  const sourceFile = path.join(tempRoot, 'ORDERPGM.rpgle');

  fs.writeFileSync(sourceFile, `**FREE
dcl-f ORDERS disk usage(*input) keyed;
dcl-f SCREEN workstn;

dcl-proc main;
  chain CustNo ORDERS;
  exfmt OrderFmt;
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
      },
      notes: [],
    });
    const context = buildContext({ canonicalAnalysis });

    assert.ok(canonicalAnalysis.entities.nativeFiles.some((entry) => entry.name === 'ORDERS'));
    assert.ok(canonicalAnalysis.relations.some((entry) => entry.type === 'USES_NATIVE_FILE' && entry.to === 'NATIVE_FILE:ORDERS'));
    assert.ok(canonicalAnalysis.relations.some((entry) => entry.type === 'ACCESSES_NATIVE_FILE' && entry.attributes.recordFormat === 'ORDERFMT'));
    assert.equal(context.nativeFileUsage.summary.fileCount, 2);
    assert.equal(context.nativeFileUsage.summary.readOnlyFileCount, 1);
    assert.equal(context.nativeFileUsage.summary.interactiveFileCount, 1);
    assert.ok(context.aiContext.riskHints.includes('Interactive workstation I/O detected'));
    assert.match(context.summary.text, /uses 2 native files/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
