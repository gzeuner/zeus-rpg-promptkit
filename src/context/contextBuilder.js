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
  defaultCrossProgramSummary,
  defaultGraphSummary,
} = require('./canonicalAnalysisModel');

function sortByName(items) {
  return [...(items || [])].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

function projectDependencies(canonicalAnalysis) {
  const entities = canonicalAnalysis.entities || {};

  return {
    tables: sortByName((entities.tables || []).map((entry) => ({
      name: entry.name,
      kind: entry.kind || 'TABLE',
      evidenceCount: Number(entry.evidenceCount) || 0,
    }))),
    programCalls: sortByName((entities.programs || [])
      .filter((entry) => entry.role !== 'ROOT')
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

function projectSql(canonicalAnalysis) {
  const sqlStatements = (canonicalAnalysis.entities && canonicalAnalysis.entities.sqlStatements) || [];
  return {
    statements: sqlStatements.map((statement) => ({
      type: statement.type,
      text: statement.text,
      tables: statement.tables || [],
      evidence: statement.evidence || [],
    })),
    tableNames: Array.from(new Set(sqlStatements.flatMap((statement) => statement.tables || [])))
      .sort((a, b) => a.localeCompare(b)),
  };
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
    sql: projectSql(canonicalAnalysis),
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
