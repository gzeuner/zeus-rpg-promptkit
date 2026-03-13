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
const path = require('path');

function normalizeName(name) {
  return String(name || '').trim().toUpperCase();
}

function normalizeEvidenceList(evidenceList, sourceRoot) {
  return (evidenceList || [])
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const filePath = entry.file || entry.path || '';
      const normalizedFile = filePath
        ? path.relative(sourceRoot, filePath).replace(/\\/g, '/')
        : filePath;
      return {
        ...entry,
        file: normalizedFile || filePath,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const af = String(a.file || '');
      const bf = String(b.file || '');
      if (af !== bf) return af.localeCompare(bf);
      const al = Number(a.line || a.startLine || 0);
      const bl = Number(b.line || b.startLine || 0);
      return al - bl;
    });
}

function dedupeByName(items, sourceRoot, withKind) {
  const map = new Map();

  for (const item of items || []) {
    const key = normalizeName(item && item.name ? item.name : item);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        name: key,
        kind: withKind ? normalizeName(item && item.kind ? item.kind : withKind) : undefined,
        evidence: [],
      });
    }

    const target = map.get(key);
    if (withKind && item && item.kind) {
      target.kind = normalizeName(item.kind);
    }
    for (const evidence of normalizeEvidenceList(item && item.evidence, sourceRoot)) {
      const marker = JSON.stringify(evidence);
      const exists = target.evidence.some((entry) => JSON.stringify(entry) === marker);
      if (!exists) {
        target.evidence.push(evidence);
      }
    }
  }

  return Array.from(map.values())
    .map((entry) => ({
      name: entry.name,
      kind: entry.kind,
      evidenceCount: (entry.evidence || []).length,
      evidence: entry.evidence || [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function sortSqlStatements(statements, sourceRoot) {
  const normalized = (statements || []).map((statement) => {
    const evidence = normalizeEvidenceList(statement.evidence || [], sourceRoot);
    return {
      type: normalizeName(statement.type || 'OTHER') || 'OTHER',
      text: String(statement.text || '').trim(),
      tables: Array.from(new Set((statement.tables || []).map((name) => normalizeName(name)).filter(Boolean))).sort(),
      evidence,
    };
  });

  return normalized.sort((a, b) => {
    const ae = a.evidence[0];
    const be = b.evidence[0];
    if (ae && be) {
      if (ae.file !== be.file) return String(ae.file).localeCompare(String(be.file));
      const aLine = Number(ae.startLine || ae.line || 0);
      const bLine = Number(be.startLine || be.line || 0);
      if (aLine !== bLine) return aLine - bLine;
    } else if (ae && !be) {
      return -1;
    } else if (!ae && be) {
      return 1;
    }

    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.text.localeCompare(b.text);
  });
}

function normalizeSourceFiles(sourceFiles, sourceRoot) {
  return (sourceFiles || [])
    .map((entry) => {
      const absolutePath = entry && entry.path ? entry.path : String(entry || '');
      const relPath = absolutePath
        ? path.relative(sourceRoot, absolutePath).replace(/\\/g, '/')
        : absolutePath;

      return {
        path: relPath || absolutePath,
        sizeBytes: Number(entry && entry.sizeBytes ? entry.sizeBytes : 0),
        lines: Number(entry && entry.lines ? entry.lines : 0),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function buildRiskHints(dependencies, sql) {
  const hints = [];
  if ((sql.statements || []).length > 0) {
    hints.push('Embedded SQL detected');
  }
  if ((dependencies.programCalls || []).some((call) => call.kind === 'DYNAMIC' || call.name === '<DYNAMIC>')) {
    hints.push('Dynamic call detected');
  }
  if ((dependencies.programCalls || []).length > 0) {
    hints.push('External program calls detected');
  }
  if ((dependencies.copyMembers || []).length >= 5) {
    hints.push('Many copy members included');
  }
  if (((dependencies.tables || []).length + (dependencies.programCalls || []).length) >= 10) {
    hints.push('Many external dependencies');
  }
  return hints;
}

function mergeSqlTablesIntoDependencies(tables, sqlTableNames) {
  const existing = new Set(tables.map((table) => table.name));
  const merged = [...tables];
  for (const tableName of sqlTableNames) {
    if (!existing.has(tableName)) {
      merged.push({
        name: tableName,
        kind: 'TABLE',
        evidenceCount: 0,
        evidence: [],
      });
      existing.add(tableName);
    }
  }
  return merged.sort((a, b) => a.name.localeCompare(b.name));
}

function buildContext({ program, sourceRoot, sourceFiles, dependencies, notes, graph }) {
  const normalizedSourceRoot = path.resolve(process.cwd(), sourceRoot || '.');
  const normalizedSourceFiles = normalizeSourceFiles(sourceFiles || [], normalizedSourceRoot);

  const tables = dedupeByName(dependencies && dependencies.tables, normalizedSourceRoot, 'TABLE').map((table) => ({
    ...table,
    kind: table.kind || 'TABLE',
  }));
  const programCalls = dedupeByName(dependencies && dependencies.calls, normalizedSourceRoot, 'PROGRAM').map((call) => ({
    ...call,
    kind: call.kind || 'PROGRAM',
  }));
  const copyMembers = dedupeByName(dependencies && dependencies.copyMembers, normalizedSourceRoot);
  const sqlStatements = sortSqlStatements(dependencies && dependencies.sqlStatements, normalizedSourceRoot);
  const sqlTableNames = Array.from(
    new Set(sqlStatements.flatMap((statement) => statement.tables || []).map((name) => normalizeName(name))),
  ).filter(Boolean).sort();

  const mergedTables = mergeSqlTablesIntoDependencies(tables, sqlTableNames);
  const dependencyBlock = {
    tables: mergedTables.map((entry) => ({
      name: entry.name,
      kind: entry.kind,
      evidenceCount: entry.evidenceCount,
    })),
    programCalls: programCalls.map((entry) => ({
      name: entry.name,
      kind: entry.kind,
      evidenceCount: entry.evidenceCount,
    })),
    copyMembers: copyMembers.map((entry) => ({
      name: entry.name,
      evidenceCount: entry.evidenceCount,
    })),
  };

  const sqlBlock = {
    statements: sqlStatements,
    tableNames: sqlTableNames,
  };

  const summary = {
    sourceFileCount: normalizedSourceFiles.length,
    tableCount: dependencyBlock.tables.length,
    programCallCount: dependencyBlock.programCalls.length,
    copyMemberCount: dependencyBlock.copyMembers.length,
    sqlStatementCount: sqlStatements.length,
  };
  summary.text = `Program ${program} references ${summary.tableCount} tables, calls ${summary.programCallCount} programs, includes ${summary.copyMemberCount} copy members, and contains ${summary.sqlStatementCount} SQL statements.`;

  const aiContext = {
    programPurposeHint: '',
    primaryTables: dependencyBlock.tables.slice(0, 10).map((entry) => entry.name),
    primaryCalls: dependencyBlock.programCalls.slice(0, 10).map((entry) => entry.name),
    riskHints: buildRiskHints(dependencyBlock, sqlBlock),
  };

  const normalizedGraph = graph || {
    nodeCount: 0,
    edgeCount: 0,
    tableCount: 0,
    programCallCount: 0,
    copyMemberCount: 0,
    files: {
      json: 'dependency-graph.json',
      mermaid: 'dependency-graph.mmd',
      markdown: 'dependency-graph.md',
    },
  };

  return {
    program: normalizeName(program),
    scannedAt: new Date().toISOString(),
    sourceRoot: normalizedSourceRoot,
    sourceFiles: normalizedSourceFiles,
    summary,
    dependencies: dependencyBlock,
    sql: sqlBlock,
    graph: normalizedGraph,
    db2Metadata: null,
    testData: null,
    aiContext,
    notes: (notes || []).map((note) => String(note)).sort((a, b) => a.localeCompare(b)),
  };
}

module.exports = {
  buildContext,
};
