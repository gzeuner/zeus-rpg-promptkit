const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
  CANONICAL_ANALYSIS_SCHEMA_VERSION,
  buildCanonicalAnalysisModel,
  enrichCanonicalAnalysisModel,
  validateCanonicalAnalysisModel,
} = require('../src/context/canonicalAnalysisModel');
const { buildContext } = require('../src/context/contextBuilder');

test('buildCanonicalAnalysisModel creates a validated semantic core with provenance and projections', () => {
  const sourceRoot = path.resolve('fixtures-root');
  const canonicalAnalysis = buildCanonicalAnalysisModel({
    program: 'orderpgm',
    sourceRoot,
    sourceFiles: [{
      path: path.join(sourceRoot, 'ORDERPGM.rpgle'),
      sizeBytes: 120,
      lines: 12,
    }],
    dependencies: {
      tables: [{
        name: 'orders',
        evidence: [{ file: path.join(sourceRoot, 'ORDERPGM.rpgle'), startLine: 3, endLine: 3 }],
      }],
      calls: [{
        name: 'invpgm',
        kind: 'program',
        evidence: [{ file: path.join(sourceRoot, 'ORDERPGM.rpgle'), startLine: 6, endLine: 6 }],
      }],
      copyMembers: [{
        name: 'QRPGLESRC,ORDCOPY',
        evidence: [{ file: path.join(sourceRoot, 'ORDERPGM.rpgle'), startLine: 2, endLine: 2 }],
      }],
      sqlStatements: [{
        type: 'select',
        text: 'select * from orders',
        tables: ['orders'],
        evidence: [{ file: path.join(sourceRoot, 'ORDERPGM.rpgle'), startLine: 8, endLine: 10 }],
      }],
      nativeFiles: [{
        name: 'orders',
        kind: 'disk',
        declaredAccess: ['READ'],
        keyed: true,
        evidence: [{ file: path.join(sourceRoot, 'ORDERPGM.rpgle'), startLine: 3, endLine: 3 }],
      }],
      nativeFileAccesses: [{
        fileName: 'orders',
        fileKind: 'disk',
        opcode: 'CHAIN',
        accessKind: 'READ',
        ownerProgram: 'orderpgm',
        ownerName: 'orderpgm',
        ownerKind: 'program',
        keyed: true,
        interactive: false,
        mutating: false,
        ownerFile: path.join(sourceRoot, 'ORDERPGM.rpgle'),
        evidence: [{ file: path.join(sourceRoot, 'ORDERPGM.rpgle'), line: 4 }],
      }],
    },
    notes: ['Scanner note'],
    importManifest: {
      schemaVersion: 1,
      fetchedAt: '2026-03-20T10:00:00.000Z',
      transportUsed: 'sftp',
      summary: {
        fileCount: 1,
      },
      files: [{
        localPath: 'ORDERPGM.rpgle',
        sourceLib: 'APPLIB',
        sourceFile: 'QRPGLESRC',
        member: 'ORDERPGM',
        remotePath: '/QSYS.LIB/APPLIB.LIB/QRPGLESRC.FILE/ORDERPGM.MBR',
        sha256: 'abc123',
      }],
    },
  });

  assert.equal(canonicalAnalysis.schemaVersion, CANONICAL_ANALYSIS_SCHEMA_VERSION);
  assert.equal(canonicalAnalysis.rootProgram, 'ORDERPGM');
  assert.equal(canonicalAnalysis.sourceFiles[0].path, 'ORDERPGM.rpgle');
  assert.equal(canonicalAnalysis.sourceFiles[0].provenance.origin, 'imported');
  assert.equal(canonicalAnalysis.sourceFiles[0].provenance.import.member, 'ORDERPGM');
  assert.ok(canonicalAnalysis.entities.programs.some((entry) => entry.id === 'PROGRAM:ORDERPGM' && entry.role === 'ROOT'));
  assert.ok(canonicalAnalysis.relations.some((entry) => entry.type === 'USES_TABLE' && entry.to === 'TABLE:ORDERS'));
  assert.ok(canonicalAnalysis.entities.nativeFiles.some((entry) => entry.id === 'NATIVE_FILE:ORDERS'));
  assert.ok(canonicalAnalysis.relations.some((entry) => entry.type === 'USES_NATIVE_FILE' && entry.to === 'NATIVE_FILE:ORDERS'));
  assert.ok(canonicalAnalysis.relations.some((entry) => entry.type === 'CALLS_PROGRAM' && entry.to === 'PROGRAM:INVPGM'));
  assert.ok(canonicalAnalysis.relations.some((entry) => entry.type === 'EXECUTES_SQL'));

  const projectedContext = buildContext({ canonicalAnalysis });
  assert.equal(projectedContext.program, 'ORDERPGM');
  assert.deepEqual(projectedContext.dependencies.tables.map((entry) => entry.name), ['ORDERS']);
  assert.deepEqual(projectedContext.dependencies.programCalls.map((entry) => entry.name), ['INVPGM']);
  assert.equal(projectedContext.nativeFileUsage.summary.fileCount, 1);
  assert.equal(projectedContext.nativeFileUsage.summary.keyedFileCount, 1);
  assert.equal(projectedContext.sql.statements[0].evidence[0].file, 'ORDERPGM.rpgle');
});

test('enrichCanonicalAnalysisModel updates enrichments while keeping the model valid', () => {
  const canonicalAnalysis = buildCanonicalAnalysisModel({
    program: 'ORDERPGM',
    sourceRoot: process.cwd(),
    sourceFiles: [],
    dependencies: {
      tables: [],
      calls: [],
      copyMembers: [],
      sqlStatements: [],
    },
    notes: [],
  });

  const enriched = enrichCanonicalAnalysisModel(canonicalAnalysis, {
    graph: {
      nodeCount: 4,
      edgeCount: 3,
    },
    notes: ['DB2 export skipped'],
  });

  assert.equal(enriched.enrichments.graph.nodeCount, 4);
  assert.deepEqual(enriched.notes, ['DB2 export skipped']);
  assert.equal(validateCanonicalAnalysisModel(enriched).valid, true);
});

test('validateCanonicalAnalysisModel reports missing root program entity', () => {
  const canonicalAnalysis = buildCanonicalAnalysisModel({
    program: 'ORDERPGM',
    sourceRoot: process.cwd(),
    sourceFiles: [],
    dependencies: {
      tables: [],
      calls: [],
      copyMembers: [],
      sqlStatements: [],
    },
    notes: [],
  });

  const invalid = {
    ...canonicalAnalysis,
    entities: {
      ...canonicalAnalysis.entities,
      programs: [],
    },
  };

  const validation = validateCanonicalAnalysisModel(invalid);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(' '), /Root program entity is missing/);
});
