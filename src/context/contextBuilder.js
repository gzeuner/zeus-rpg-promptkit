/*
Copyright 2026 Guido Zeuner

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
const {
  assertCanonicalAnalysisModel,
  buildCanonicalAnalysisModel,
  defaultBindingAnalysis,
  defaultCrossProgramSummary,
  defaultGraphSummary,
  defaultNativeFileUsage,
  defaultSqlAnalysis,
  summarizeSqlStatements,
} = require('./canonicalAnalysisModel');

function sortByName(items) {
  return [...(items || [])].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

function projectDependencies(canonicalAnalysis) {
  const entities = canonicalAnalysis.entities || {};
  const relations = canonicalAnalysis.relations || [];
  const calledProgramNames = new Set(
    relations
      .filter((entry) => entry.type === 'CALLS_PROGRAM')
      .map((entry) => String(entry.to || '').replace(/^PROGRAM:/, ''))
      .filter(Boolean),
  );

  return {
    tables: sortByName((entities.tables || []).map((entry) => ({
      name: entry.name,
      kind: entry.kind || 'TABLE',
      evidenceCount: Number(entry.evidenceCount) || 0,
    }))),
    programCalls: sortByName((entities.programs || [])
      .filter((entry) => calledProgramNames.has(String(entry.name || '')))
      .map((entry) => ({
        name: entry.name,
        kind: entry.kind || 'PROGRAM',
        evidenceCount: Number(entry.evidenceCount) || 0,
      }))),
    copyMembers: sortByName((entities.copyMembers || []).map((entry) => ({
      name: entry.name,
      evidenceCount: Number(entry.evidenceCount) || 0,
    }))),
  };
}

function projectProcedureAnalysis(canonicalAnalysis) {
  const entities = canonicalAnalysis.entities || {};
  const relations = canonicalAnalysis.relations || [];
  const procedures = sortByName((entities.procedures || []).map((entry) => ({
    name: entry.name,
    kind: entry.kind,
    ownerProgram: entry.ownerProgram,
    sourceFile: entry.sourceFile,
    startLine: entry.startLine,
    endLine: entry.endLine,
    sourceForm: entry.sourceForm,
    exported: Boolean(entry.exported),
    evidenceCount: Number(entry.evidenceCount) || 0,
  })));
  const prototypes = sortByName((entities.prototypes || []).map((entry) => ({
    name: entry.name,
    ownerProgram: entry.ownerProgram,
    sourceFile: entry.sourceFile,
    startLine: entry.startLine,
    endLine: entry.endLine,
    sourceForm: entry.sourceForm,
    imported: Boolean(entry.imported),
    externalName: entry.externalName || null,
    evidenceCount: Number(entry.evidenceCount) || 0,
  })));
  const calls = relations
    .filter((entry) => entry.type === 'CALLS_PROCEDURE')
    .map((entry) => {
      const from = String(entry.from || '');
      const to = String(entry.to || '');
      const caller = from.split(':').slice(-1)[0] || from;
      return {
        caller,
        target: String(entry.attributes && entry.attributes.targetName ? entry.attributes.targetName : (to.split(':').slice(-1)[0] || to)),
        resolution: entry.attributes && entry.attributes.resolution ? entry.attributes.resolution : 'UNKNOWN',
        targetKind: entry.attributes && entry.attributes.targetKind ? entry.attributes.targetKind : '',
        evidenceCount: Array.isArray(entry.evidence) ? entry.evidence.length : 0,
      };
    })
    .sort((a, b) => {
      if (a.caller !== b.caller) return a.caller.localeCompare(b.caller);
      if (a.target !== b.target) return a.target.localeCompare(b.target);
      return a.resolution.localeCompare(b.resolution);
    });

  return {
    summary: {
      procedureCount: procedures.length,
      prototypeCount: prototypes.length,
      procedureCallCount: calls.length,
      internalCallCount: calls.filter((entry) => entry.resolution === 'INTERNAL').length,
      externalCallCount: calls.filter((entry) => entry.resolution === 'EXTERNAL').length,
      dynamicCallCount: calls.filter((entry) => entry.resolution === 'DYNAMIC').length,
      unresolvedCallCount: calls.filter((entry) => entry.resolution === 'UNRESOLVED').length,
    },
    procedures,
    prototypes,
    calls,
  };
}

function projectSql(canonicalAnalysis) {
  const sqlStatements = (canonicalAnalysis.entities && canonicalAnalysis.entities.sqlStatements) || [];
  const sqlAnalysis = summarizeSqlStatements(sqlStatements);
  return {
    summary: sqlAnalysis.summary,
    statements: sqlStatements.map((statement) => ({
      type: statement.type,
      intent: statement.intent || 'OTHER',
      text: statement.text,
      tables: statement.tables || [],
      hostVariables: statement.hostVariables || [],
      cursors: statement.cursors || [],
      readsData: Boolean(statement.readsData),
      writesData: Boolean(statement.writesData),
      dynamic: Boolean(statement.dynamic),
      unresolved: Boolean(statement.unresolved),
      uncertainty: statement.uncertainty || [],
      evidence: statement.evidence || [],
    })),
    tableNames: sqlAnalysis.tableNames,
    hostVariables: sqlAnalysis.hostVariables,
    cursors: sqlAnalysis.cursors,
  };
}

function projectBindingAnalysis(canonicalAnalysis) {
  return canonicalAnalysis.enrichments && canonicalAnalysis.enrichments.bindingAnalysis
    ? canonicalAnalysis.enrichments.bindingAnalysis
    : defaultBindingAnalysis();
}

function projectContextFromCanonicalAnalysis(canonicalAnalysis) {
  assertCanonicalAnalysisModel(canonicalAnalysis);

  return {
    program: canonicalAnalysis.rootProgram,
    scannedAt: canonicalAnalysis.generatedAt,
    sourceRoot: canonicalAnalysis.sourceRoot,
    sourceFiles: (canonicalAnalysis.sourceFiles || []).map((entry) => ({
      path: entry.path,
      sizeBytes: Number(entry.sizeBytes) || 0,
      lines: Number(entry.lines) || 0,
    })),
    summary: canonicalAnalysis.enrichments && canonicalAnalysis.enrichments.summary
      ? canonicalAnalysis.enrichments.summary
      : {
        sourceFileCount: 0,
        tableCount: 0,
        programCallCount: 0,
        copyMemberCount: 0,
        sqlStatementCount: 0,
        text: '',
      },
    dependencies: projectDependencies(canonicalAnalysis),
    procedureAnalysis: projectProcedureAnalysis(canonicalAnalysis),
    bindingAnalysis: projectBindingAnalysis(canonicalAnalysis),
    nativeFileUsage: canonicalAnalysis.enrichments && canonicalAnalysis.enrichments.nativeFileUsage
      ? canonicalAnalysis.enrichments.nativeFileUsage
      : defaultNativeFileUsage(),
    sql: projectSql(canonicalAnalysis) || defaultSqlAnalysis(),
    graph: canonicalAnalysis.enrichments && canonicalAnalysis.enrichments.graph
      ? canonicalAnalysis.enrichments.graph
      : defaultGraphSummary(),
    crossProgramGraph: canonicalAnalysis.enrichments && canonicalAnalysis.enrichments.crossProgramGraph
      ? canonicalAnalysis.enrichments.crossProgramGraph
      : defaultCrossProgramSummary(),
    db2Metadata: canonicalAnalysis.enrichments ? canonicalAnalysis.enrichments.db2Metadata : null,
    testData: canonicalAnalysis.enrichments ? canonicalAnalysis.enrichments.testData : null,
    aiContext: canonicalAnalysis.enrichments && canonicalAnalysis.enrichments.aiContext
      ? canonicalAnalysis.enrichments.aiContext
      : {
        programPurposeHint: '',
        primaryTables: [],
        primaryCalls: [],
        riskHints: [],
      },
    notes: canonicalAnalysis.notes || [],
  };
}

function buildContext(input) {
  const canonicalAnalysis = input && input.canonicalAnalysis
    ? input.canonicalAnalysis
    : buildCanonicalAnalysisModel(input || {});
  return projectContextFromCanonicalAnalysis(canonicalAnalysis);
}

module.exports = {
  buildContext,
  projectContextFromCanonicalAnalysis,
};
