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

function parseQualifiedIdentifier(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  if (raw.includes('.')) {
    const [schema, name] = raw.split('.', 2);
    return {
      qualified: normalizeIdentifier(raw.replace(/\//g, '.')),
      schema: normalizeIdentifier(schema),
      systemSchema: '',
      name: normalizeIdentifier(name),
      systemName: '',
    };
  }

  if (raw.includes('/')) {
    const [schema, name] = raw.split('/', 2);
    return {
      qualified: normalizeIdentifier(raw.replace(/\//g, '.')),
      schema: '',
      systemSchema: normalizeIdentifier(schema),
      name: normalizeIdentifier(name),
      systemName: normalizeIdentifier(name),
    };
  }

  return {
    qualified: normalizeIdentifier(raw),
    schema: '',
    systemSchema: '',
    name: normalizeIdentifier(raw),
    systemName: normalizeIdentifier(raw),
  };
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

function normalizeCatalogLookupStrategy(value) {
  const normalized = normalizeIdentifier(value);
  return normalized || 'JDBC_METADATA';
}

function normalizeCatalogTable(table) {
  const schema = normalizeIdentifier(table && (table.schema || table.sqlSchema));
  const sqlName = normalizeIdentifier(table && (table.table || table.sqlName));
  const systemSchema = normalizeIdentifier(table && table.systemSchema);
  const systemName = normalizeIdentifier(table && table.systemName);
  const objectType = normalizeIdentifier(table && table.objectType);
  const lookupStrategy = normalizeCatalogLookupStrategy(table && table.lookupStrategy);

  return {
    ...table,
    schema,
    table: sqlName,
    systemSchema,
    systemName,
    objectType: objectType || 'TABLE',
    lookupStrategy,
    aliases: uniqueSortedStrings([
      sqlName,
      systemName,
      schema && sqlName ? `${schema}.${sqlName}` : '',
      systemSchema && systemName ? `${systemSchema}/${systemName}` : '',
      table && table.requestedName ? normalizeIdentifier(table.requestedName) : '',
    ].filter(Boolean)),
  };
}

function isRequestedTableMatch(requested, table) {
  const normalizedRequested = parseQualifiedIdentifier(requested);
  if (!normalizedRequested) {
    return false;
  }

  const normalizedTable = normalizeCatalogTable(table);
  if (normalizedRequested.schema && normalizedRequested.schema !== normalizedTable.schema) {
    return false;
  }
  if (normalizedRequested.systemSchema && normalizedRequested.systemSchema !== normalizedTable.systemSchema) {
    return false;
  }

  return normalizedTable.aliases.includes(normalizedRequested.qualified)
    || normalizedTable.aliases.includes(normalizedRequested.name)
    || normalizedTable.aliases.includes(normalizedRequested.systemName);
}

function resolveTableMatchType(requested, table) {
  const normalizedRequested = parseQualifiedIdentifier(requested);
  const normalizedTable = normalizeCatalogTable(table);
  if (!normalizedRequested || !normalizedTable) {
    return '';
  }

  if (normalizedRequested.schema && normalizedTable.schema && normalizedRequested.schema === normalizedTable.schema && normalizedRequested.name === normalizedTable.table) {
    return 'SQL_QUALIFIED_NAME';
  }
  if (normalizedRequested.systemSchema && normalizedTable.systemSchema && normalizedRequested.systemSchema === normalizedTable.systemSchema && normalizedRequested.systemName === normalizedTable.systemName) {
    return 'SYSTEM_QUALIFIED_NAME';
  }
  if (normalizedRequested.name && normalizedRequested.name === normalizedTable.table) {
    return 'SQL_NAME';
  }
  if (normalizedRequested.systemName && normalizedRequested.systemName === normalizedTable.systemName) {
    return 'SYSTEM_NAME';
  }
  return 'ALIAS';
}

function buildDb2TableLookupIndex(exportedTables) {
  const aliasIndex = new Map();
  const exactKeyIndex = new Map();

  for (const rawTable of asArray(exportedTables)) {
    const table = normalizeCatalogTable(rawTable);
    for (const alias of table.aliases) {
      if (!aliasIndex.has(alias)) {
        aliasIndex.set(alias, []);
      }
      aliasIndex.get(alias).push(table);
    }

    if (table.schema && table.table) {
      exactKeyIndex.set(`${table.schema}|${table.table}`, table);
    }
    if (table.systemSchema && table.systemName) {
      exactKeyIndex.set(`${table.systemSchema}|${table.systemName}`, table);
    }
  }

  return {
    aliasIndex,
    exactKeyIndex,
  };
}

function buildDb2SourceLinkage({ requestedTables, exportedTables, canonicalAnalysis, context }) {
  const normalizedRequestedTables = uniqueSortedStrings(requestedTables);
  const exported = asArray(exportedTables).map(normalizeCatalogTable);
  const lookupIndex = buildDb2TableLookupIndex(exported);
  const tableEntitiesByName = new Map(asArray(canonicalAnalysis && canonicalAnalysis.entities && canonicalAnalysis.entities.tables)
    .map((entry) => [normalizeIdentifier(entry && entry.name), entry]));
  const sqlStatements = asArray(canonicalAnalysis && canonicalAnalysis.entities && canonicalAnalysis.entities.sqlStatements);
  const nativeFileEntitiesByName = new Map(asArray(canonicalAnalysis && canonicalAnalysis.entities && canonicalAnalysis.entities.nativeFiles)
    .map((entry) => [normalizeIdentifier(entry && entry.name), entry]));
  const contextNativeFilesByName = new Map(asArray(context && context.nativeFileUsage && context.nativeFileUsage.files)
    .map((entry) => [normalizeIdentifier(entry && entry.name), entry]));

  const tableLinks = normalizedRequestedTables.map((requestedName) => {
    const aliasMatches = lookupIndex.aliasIndex.get(parseQualifiedIdentifier(requestedName).qualified) || [];
    const fallbackMatches = aliasMatches.length > 0
      ? aliasMatches
      : exported.filter((entry) => isRequestedTableMatch(requestedName, entry));
    const matches = Array.from(new Map(fallbackMatches
      .map((entry) => [
        [
          normalizeIdentifier(entry.schema),
          normalizeIdentifier(entry.table),
          normalizeIdentifier(entry.systemSchema),
          normalizeIdentifier(entry.systemName),
        ].join('|'),
        {
          schema: normalizeIdentifier(entry.schema),
          table: normalizeIdentifier(entry.table),
          systemSchema: normalizeIdentifier(entry.systemSchema),
          systemName: normalizeIdentifier(entry.systemName),
          objectType: normalizeIdentifier(entry.objectType || 'TABLE') || 'TABLE',
          lookupStrategy: normalizeCatalogLookupStrategy(entry.lookupStrategy),
          matchType: resolveTableMatchType(requestedName, entry),
        },
      ]))
      .values());
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
    const fallbackMatchesByStrategy = matches.filter((entry) => entry.lookupStrategy !== 'IBM_I_CATALOG');
    for (const match of fallbackMatchesByStrategy) {
      diagnostics.push({
        severity: 'info',
        code: 'DB2_TABLE_LOOKUP_FALLBACK',
        message: `DB2 metadata used ${match.lookupStrategy} fallback for source table ${requestedName}.`,
        details: {
          requestedTable: requestedName,
          resolvedSchema: match.schema,
          resolvedTable: match.table,
          lookupStrategy: match.lookupStrategy,
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
          matchedSchemas: matches.map((entry) => entry.schema || entry.systemSchema),
        },
      });
    }

    return {
      requestedName,
      matchStatus,
      matches: matches.map((entry) => ({
        schema: entry.schema,
        table: entry.table,
        systemSchema: entry.systemSchema,
        systemName: entry.systemName,
        objectType: entry.objectType,
        lookupStrategy: entry.lookupStrategy,
        matchType: entry.matchType,
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
      if (match.systemSchema || match.systemName) {
        linkByExactKey.set(`${match.systemSchema}|${match.systemName}`, link);
      }
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
        matchedSchemas: entry.matches.map((match) => match.schema || match.systemSchema),
      })),
    diagnostics: tableLinks.flatMap((entry) => entry.diagnostics),
  };
}

function buildCompactDb2TableLink(link, table) {
  const normalizedTable = normalizeCatalogTable(table);
  const primaryMatch = asArray(link.matches)[0] || {};
  return {
    requestedName: link.requestedName,
    matchStatus: link.matchStatus,
    matchedBy: primaryMatch.matchType || null,
    lookupStrategy: primaryMatch.lookupStrategy || normalizeCatalogLookupStrategy(normalizedTable.lookupStrategy),
    displayName: normalizedTable.table || normalizedTable.systemName,
    schema: normalizedTable.schema,
    table: normalizedTable.table,
    systemSchema: normalizedTable.systemSchema,
    systemName: normalizedTable.systemName,
    objectType: normalizedTable.objectType,
    textDescription: String(normalizedTable.textDescription || '').trim() || null,
    estimatedRowCount: Number.isFinite(Number(normalizedTable.estimatedRowCount)) ? Number(normalizedTable.estimatedRowCount) : null,
    columnCount: asArray(normalizedTable.columns).length,
    foreignKeyCount: asArray(normalizedTable.foreignKeys).length,
    triggerCount: asArray(normalizedTable.triggers).length,
    derivedObjectCount: asArray(normalizedTable.derivedObjects).length,
    sourceEvidenceCount: asArray(link.sourceEvidence).length,
    sqlReferenceCount: asArray(link.sqlReferences).length,
    nativeFileCount: asArray(link.nativeFiles).length,
    sourceEvidence: dedupeEvidence(link.sourceEvidence),
  };
}

function buildCompactTestDataLink(link, table) {
  const normalizedTable = normalizeCatalogTable(table);
  const primaryMatch = asArray(link.matches)[0] || {};
  return {
    requestedName: link.requestedName,
    matchStatus: link.matchStatus,
    matchedBy: primaryMatch.matchType || null,
    displayName: normalizedTable.table || normalizedTable.systemName,
    schema: normalizedTable.schema,
    table: normalizedTable.table,
    systemSchema: normalizedTable.systemSchema,
    systemName: normalizedTable.systemName,
    rowCount: Number(table && table.rowCount) || 0,
    status: String(table && table.status || ''),
    sourceEvidenceCount: asArray(link.sourceEvidence).length,
    sqlReferenceCount: asArray(link.sqlReferences).length,
    nativeFileCount: asArray(link.nativeFiles).length,
    sourceEvidence: dedupeEvidence(link.sourceEvidence),
  };
}

module.exports = {
  buildDb2TableLookupIndex,
  buildCompactTestDataLink,
  buildCompactDb2TableLink,
  buildDb2SourceLinkage,
  dedupeEvidence,
  isRequestedTableMatch,
  normalizeCatalogTable,
  parseQualifiedIdentifier,
};
