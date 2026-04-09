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
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeIdentifier(value) {
  return String(value || '').trim().toUpperCase();
}

function uniqueSortedStrings(values) {
  return Array.from(new Set(asArray(values).map((value) => String(value || '').trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

function sortEvidence(evidenceList) {
  return asArray(evidenceList)
    .filter((entry) => entry && typeof entry === 'object' && entry.file)
    .map((entry) => ({
      file: String(entry.file || ''),
      ...(Number.isFinite(Number(entry.startLine || entry.line)) ? { startLine: Number(entry.startLine || entry.line) } : {}),
      ...(Number.isFinite(Number(entry.endLine || entry.line || entry.startLine))
        ? { endLine: Number(entry.endLine || entry.line || entry.startLine) }
        : {}),
    }))
    .sort((a, b) => {
      if (a.file !== b.file) return a.file.localeCompare(b.file);
      const aLine = Number(a.startLine || 0);
      const bLine = Number(b.startLine || 0);
      if (aLine !== bLine) return aLine - bLine;
      return Number(a.endLine || 0) - Number(b.endLine || 0);
    });
}

function dedupeEvidence(evidenceList) {
  const seen = new Set();
  const deduped = [];
  for (const entry of sortEvidence(evidenceList)) {
    const key = `${entry.file}|${Number(entry.startLine || 0)}|${Number(entry.endLine || 0)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}

function buildSqlReferenceSummary(statement) {
  return {
    id: statement.id,
    type: statement.type,
    intent: statement.intent || 'OTHER',
    dynamic: Boolean(statement.dynamic),
    unresolved: Boolean(statement.unresolved),
    evidence: dedupeEvidence(statement.evidence),
  };
}

function buildNativeFileSummary(contextFile, nativeFileEntity) {
  return {
    name: contextFile.name,
    kind: contextFile.kind || 'FILE',
    keyed: Boolean(contextFile.keyed),
    mutating: Boolean(contextFile.access && contextFile.access.mutating),
    interactive: Boolean(contextFile.access && contextFile.access.interactive),
    recordFormats: asArray(contextFile.recordFormats).map((entry) => entry.name),
    evidence: dedupeEvidence(nativeFileEntity && nativeFileEntity.evidence),
  };
}

function buildDb2SourceLinkage({ requestedTables, exportedTables, canonicalAnalysis, context }) {
  const normalizedRequestedTables = uniqueSortedStrings(requestedTables);
  const exported = asArray(exportedTables).map((table) => ({
    schema: normalizeIdentifier(table && table.schema),
    table: normalizeIdentifier(table && table.table),
  }));
  const tableEntitiesByName = new Map(asArray(canonicalAnalysis && canonicalAnalysis.entities && canonicalAnalysis.entities.tables)
    .map((entry) => [normalizeIdentifier(entry && entry.name), entry]));
  const sqlStatements = asArray(canonicalAnalysis && canonicalAnalysis.entities && canonicalAnalysis.entities.sqlStatements);
  const nativeFileEntitiesByName = new Map(asArray(canonicalAnalysis && canonicalAnalysis.entities && canonicalAnalysis.entities.nativeFiles)
    .map((entry) => [normalizeIdentifier(entry && entry.name), entry]));
  const contextNativeFilesByName = new Map(asArray(context && context.nativeFileUsage && context.nativeFileUsage.files)
    .map((entry) => [normalizeIdentifier(entry && entry.name), entry]));

  const tableLinks = normalizedRequestedTables.map((requestedName) => {
    const matches = exported.filter((entry) => entry.table === requestedName);
    const matchStatus = matches.length === 0 ? 'unresolved' : matches.length === 1 ? 'resolved' : 'ambiguous';
    const tableEntity = tableEntitiesByName.get(requestedName);
    const sqlReferences = sqlStatements
      .filter((statement) => asArray(statement.tables).some((tableName) => normalizeIdentifier(tableName) === requestedName))
      .map(buildSqlReferenceSummary)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return String(a.id || '').localeCompare(String(b.id || ''));
      });
    const contextNativeFile = contextNativeFilesByName.get(requestedName);
    const nativeFileEntity = nativeFileEntitiesByName.get(requestedName);
    const nativeFiles = contextNativeFile ? [buildNativeFileSummary(contextNativeFile, nativeFileEntity)] : [];
    const sourceEvidence = dedupeEvidence([
      ...(tableEntity && tableEntity.evidence ? tableEntity.evidence : []),
      ...sqlReferences.flatMap((entry) => entry.evidence),
      ...nativeFiles.flatMap((entry) => entry.evidence),
    ]);

    const diagnostics = [];
    if (matchStatus === 'unresolved') {
      diagnostics.push({
        severity: 'warning',
        code: 'DB2_TABLE_UNRESOLVED',
        message: `DB2 metadata did not resolve source table ${requestedName}.`,
        details: {
          requestedTable: requestedName,
        },
      });
    }
    if (matchStatus === 'ambiguous') {
      diagnostics.push({
        severity: 'warning',
        code: 'DB2_TABLE_AMBIGUOUS',
        message: `DB2 metadata resolved source table ${requestedName} to multiple schemas.`,
        details: {
          requestedTable: requestedName,
          matchedSchemas: matches.map((entry) => entry.schema),
        },
      });
    }

    return {
      requestedName,
      matchStatus,
      matches: matches.map((entry) => ({
        schema: entry.schema,
        table: entry.table,
      })),
      sourceEvidence,
      sqlReferences,
      nativeFiles,
      diagnostics,
    };
  });

  const linkByExactKey = new Map();
  for (const link of tableLinks) {
    for (const match of link.matches) {
      linkByExactKey.set(`${match.schema}|${match.table}`, link);
    }
  }

  return {
    tableLinks,
    tableLinkByExactKey: linkByExactKey,
    unresolvedTables: tableLinks.filter((entry) => entry.matchStatus === 'unresolved').map((entry) => entry.requestedName),
    ambiguousTables: tableLinks
      .filter((entry) => entry.matchStatus === 'ambiguous')
      .map((entry) => ({
        requestedName: entry.requestedName,
        matchedSchemas: entry.matches.map((match) => match.schema),
      })),
    diagnostics: tableLinks.flatMap((entry) => entry.diagnostics),
  };
}

function buildCompactDb2TableLink(link, table) {
  return {
    requestedName: link.requestedName,
    matchStatus: link.matchStatus,
    schema: normalizeIdentifier(table && table.schema),
    table: normalizeIdentifier(table && table.table),
    columnCount: asArray(table && table.columns).length,
    foreignKeyCount: asArray(table && table.foreignKeys).length,
    sourceEvidenceCount: asArray(link.sourceEvidence).length,
    sqlReferenceCount: asArray(link.sqlReferences).length,
    nativeFileCount: asArray(link.nativeFiles).length,
    sourceEvidence: dedupeEvidence(link.sourceEvidence),
  };
}

function buildCompactTestDataLink(link, table) {
  return {
    requestedName: link.requestedName,
    matchStatus: link.matchStatus,
    schema: normalizeIdentifier(table && table.schema),
    table: normalizeIdentifier(table && table.table),
    rowCount: Number(table && table.rowCount) || 0,
    status: String(table && table.status || ''),
    sourceEvidenceCount: asArray(link.sourceEvidence).length,
    sqlReferenceCount: asArray(link.sqlReferences).length,
    nativeFileCount: asArray(link.nativeFiles).length,
    sourceEvidence: dedupeEvidence(link.sourceEvidence),
  };
}

module.exports = {
  buildCompactTestDataLink,
  buildCompactDb2TableLink,
  buildDb2SourceLinkage,
  dedupeEvidence,
};
