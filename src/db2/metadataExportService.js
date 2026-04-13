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
const fs = require('fs');
const path = require('path');
const { ensureJavaHelperCompiled, runJavaHelper } = require('../fetch/jt400CommandRunner');
const {
  normalizeIdentifier,
  resolveDefaultSchema,
  buildJdbcUrl,
  isDbConfigured,
} = require('./db2Config');
const {
  buildCompactDb2TableLink,
  buildDb2SourceLinkage,
  normalizeCatalogTable,
} = require('./db2EvidenceLinker');
const {
  buildDb2CatalogSemanticUpdates,
  buildExternalCallRequests,
  normalizeExternalObject,
} = require('./catalogSemanticModel');

const JSON_FILE = 'db2-metadata.json';
const MARKDOWN_FILE = 'db2-metadata.md';

function parseJavaJson(stdout) {
  const content = String(stdout || '').trim();
  if (!content) {
    return {};
  }
  return JSON.parse(content);
}

function normalizeColumn(column) {
  return {
    name: normalizeIdentifier(column && column.name),
    systemName: normalizeIdentifier(column && column.systemName),
    type: normalizeIdentifier(column && column.type),
    length: Number.isFinite(Number(column && column.length)) ? Number(column.length) : null,
    precision: Number.isFinite(Number(column && column.precision)) ? Number(column.precision) : null,
    scale: Number.isFinite(Number(column && column.scale)) ? Number(column.scale) : null,
    nullable: Boolean(column && column.nullable),
    primaryKey: Boolean(column && column.primaryKey),
  };
}

function normalizeForeignKey(foreignKey) {
  return {
    column: normalizeIdentifier(foreignKey && foreignKey.column),
    referencesSchema: normalizeIdentifier(foreignKey && foreignKey.referencesSchema),
    referencesTable: normalizeIdentifier(foreignKey && foreignKey.referencesTable),
    referencesColumn: normalizeIdentifier(foreignKey && foreignKey.referencesColumn),
    constraintName: normalizeIdentifier(foreignKey && foreignKey.constraintName),
    updateRule: normalizeIdentifier(foreignKey && foreignKey.updateRule),
    deleteRule: normalizeIdentifier(foreignKey && foreignKey.deleteRule),
  };
}

function normalizeTrigger(trigger) {
  return {
    schema: normalizeIdentifier(trigger && trigger.schema),
    name: normalizeIdentifier(trigger && trigger.name),
    systemSchema: normalizeIdentifier(trigger && trigger.systemSchema),
    systemName: normalizeIdentifier(trigger && trigger.systemName),
    eventManipulation: normalizeIdentifier(trigger && trigger.eventManipulation),
    actionTiming: normalizeIdentifier(trigger && trigger.actionTiming),
    actionOrientation: normalizeIdentifier(trigger && trigger.actionOrientation),
    programName: normalizeIdentifier(trigger && trigger.programName),
    programLibrary: normalizeIdentifier(trigger && trigger.programLibrary),
  };
}

function normalizeDerivedObject(derivedObject) {
  return {
    schema: normalizeIdentifier(derivedObject && derivedObject.schema),
    name: normalizeIdentifier(derivedObject && (derivedObject.name || derivedObject.table)),
    systemSchema: normalizeIdentifier(derivedObject && derivedObject.systemSchema),
    systemName: normalizeIdentifier(derivedObject && derivedObject.systemName),
    objectType: normalizeIdentifier(derivedObject && derivedObject.objectType) || 'VIEW',
    textDescription: String(derivedObject && derivedObject.textDescription || '').trim() || null,
  };
}

function normalizeRawTable(table) {
  const columns = (table && Array.isArray(table.columns) ? table.columns : [])
    .map(normalizeColumn)
    .filter((column) => column.name && column.type);
  const foreignKeys = (table && Array.isArray(table.foreignKeys) ? table.foreignKeys : [])
    .map(normalizeForeignKey)
    .filter((foreignKey) => foreignKey.column && foreignKey.referencesTable && foreignKey.referencesColumn)
    .sort((a, b) => {
      if (a.column !== b.column) return a.column.localeCompare(b.column);
      if (a.referencesSchema !== b.referencesSchema) return a.referencesSchema.localeCompare(b.referencesSchema);
      if (a.referencesTable !== b.referencesTable) return a.referencesTable.localeCompare(b.referencesTable);
      return a.referencesColumn.localeCompare(b.referencesColumn);
    });
  const triggers = (table && Array.isArray(table.triggers) ? table.triggers : [])
    .map(normalizeTrigger)
    .filter((trigger) => trigger.name || trigger.systemName)
    .sort((a, b) => {
      const aName = a.name || a.systemName;
      const bName = b.name || b.systemName;
      if (a.schema !== b.schema) return a.schema.localeCompare(b.schema);
      return aName.localeCompare(bName);
    });
  const derivedObjects = (table && Array.isArray(table.derivedObjects) ? table.derivedObjects : [])
    .map(normalizeDerivedObject)
    .filter((entry) => entry.name || entry.systemName)
    .sort((a, b) => {
      if (a.schema !== b.schema) return a.schema.localeCompare(b.schema);
      const aName = a.name || a.systemName;
      const bName = b.name || b.systemName;
      return aName.localeCompare(bName);
    });

  return normalizeCatalogTable({
    ...table,
    schema: normalizeIdentifier(table && table.schema),
    table: normalizeIdentifier(table && table.table),
    systemSchema: normalizeIdentifier(table && table.systemSchema),
    systemName: normalizeIdentifier(table && table.systemName),
    objectType: normalizeIdentifier(table && table.objectType) || 'TABLE',
    textDescription: String(table && table.textDescription || '').trim() || null,
    estimatedRowCount: Number.isFinite(Number(table && table.estimatedRowCount)) ? Number(table.estimatedRowCount) : null,
    lookupStrategy: normalizeIdentifier(table && table.lookupStrategy) || 'JDBC_METADATA',
    columns,
    foreignKeys,
    triggers,
    derivedObjects,
  });
}

function dedupeTables(tables) {
  const byKey = new Map();

  for (const table of tables) {
    const normalized = normalizeRawTable(table);
    if (!normalized.table && !normalized.systemName) continue;
    const key = [
      normalized.schema,
      normalized.table,
      normalized.systemSchema,
      normalized.systemName,
    ].join('|');
    if (!byKey.has(key)) {
      byKey.set(key, normalized);
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    const aName = a.table || a.systemName;
    const bName = b.table || b.systemName;
    if (aName !== bName) return aName.localeCompare(bName);
    if (a.schema !== b.schema) return a.schema.localeCompare(b.schema);
    return a.systemSchema.localeCompare(b.systemSchema);
  });
}

function buildRequestedTableNames(dependencies) {
  return Array.from(
    new Set(
      ((dependencies && dependencies.tables) || [])
        .map((entry) => normalizeIdentifier(entry && entry.name ? entry.name : entry))
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

function buildRequestedExternalObjectNames(canonicalAnalysis) {
  return Array.from(new Set(buildExternalCallRequests(canonicalAnalysis).map((entry) => entry.requestedName)))
    .sort((a, b) => a.localeCompare(b));
}

function renderLength(column) {
  if (column.length === null || column.length === undefined) {
    return '';
  }
  if (column.scale !== null && column.scale !== undefined) {
    return `${column.length}${column.scale > 0 ? `/${column.scale}` : ''}`;
  }
  if (column.precision !== null && column.precision !== undefined && column.precision !== column.length) {
    return `${column.length}/${column.precision}`;
  }
  return String(column.length);
}

function renderForeignKeyRule(rule) {
  return rule ? ` (${rule})` : '';
}

function renderDb2MetadataMarkdown(program, tables, externalObjects, notes) {
  const lines = [
    '# DB2 Metadata',
    '',
    `Program: ${normalizeIdentifier(program)}`,
    '',
  ];

  if (notes.length > 0) {
    lines.push('Notes:');
    for (const note of notes) {
      lines.push(`- ${note}`);
    }
    lines.push('');
  }

  if ((!tables || tables.length === 0) && (!externalObjects || externalObjects.length === 0)) {
    lines.push('No DB2 metadata was exported.');
    lines.push('');
    return `${lines.join('\n')}\n`;
  }

  for (const table of tables || []) {
    lines.push(`## Table ${table.table || table.systemName}`);
    lines.push('');
    lines.push(`Schema: ${table.schema || '(unknown)'}`);
    if (table.systemSchema || table.systemName) {
      lines.push(`System Name: ${(table.systemSchema || table.schema || '(unknown)')}/${table.systemName || '(unknown)'}`);
    }
    lines.push(`Object Type: ${table.objectType || 'TABLE'}`);
    if (table.textDescription) {
      lines.push(`Text: ${table.textDescription}`);
    }
    if (table.estimatedRowCount !== null && table.estimatedRowCount !== undefined) {
      lines.push(`Estimated Rows: ${table.estimatedRowCount}`);
    }
    if (table.lookupStrategy) {
      lines.push(`Lookup Strategy: ${table.lookupStrategy}`);
    }
    if (table.sourceLink) {
      lines.push(`Match Status: ${table.sourceLink.matchStatus}`);
      if (table.sourceLink.matchedBy) {
        lines.push(`Matched By: ${table.sourceLink.matchedBy}`);
      }
      lines.push('');
      if ((table.sourceLink.sourceEvidence || []).length > 0) {
        lines.push('Source Evidence:');
        for (const evidence of table.sourceLink.sourceEvidence) {
          lines.push(`- ${evidence.file}:${evidence.startLine || 1}`);
        }
        lines.push('');
      }
      if ((table.sourceLink.sqlReferences || []).length > 0) {
        lines.push('Related SQL:');
        for (const statement of table.sourceLink.sqlReferences) {
          lines.push(`- ${statement.type}${statement.dynamic ? ' (dynamic)' : ''}${statement.unresolved ? ' (unresolved)' : ''}`);
        }
        lines.push('');
      }
      if ((table.sourceLink.nativeFiles || []).length > 0) {
        lines.push('Related Native File Usage:');
        for (const nativeFile of table.sourceLink.nativeFiles) {
          const flags = [];
          if (nativeFile.mutating) flags.push('MUTATING');
          if (nativeFile.interactive) flags.push('INTERACTIVE');
          if (nativeFile.keyed) flags.push('KEYED');
          lines.push(`- ${nativeFile.name}${flags.length > 0 ? ` (${flags.join(', ')})` : ''}`);
        }
        lines.push('');
      }
    } else {
      lines.push('');
    }

    lines.push('| Column | System | Type | Length | Nullable | PK |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const column of table.columns || []) {
      lines.push(`| ${column.name} | ${column.systemName || ''} | ${column.type} | ${renderLength(column)} | ${column.nullable ? 'Yes' : 'No'} | ${column.primaryKey ? 'Yes' : 'No'} |`);
    }

    if ((table.foreignKeys || []).length > 0) {
      lines.push('');
      lines.push('Foreign Keys:');
      for (const foreignKey of table.foreignKeys) {
        const schemaPrefix = foreignKey.referencesSchema ? `${foreignKey.referencesSchema}.` : '';
        lines.push(`- ${foreignKey.column} -> ${schemaPrefix}${foreignKey.referencesTable}.${foreignKey.referencesColumn}${renderForeignKeyRule(foreignKey.deleteRule || foreignKey.updateRule)}${foreignKey.deleteRule ? ` delete ${foreignKey.deleteRule}` : ''}${foreignKey.updateRule ? ` update ${foreignKey.updateRule}` : ''}`);
      }
    }

    if ((table.triggers || []).length > 0) {
      lines.push('');
      lines.push('Triggers:');
      for (const trigger of table.triggers) {
        lines.push(`- ${trigger.name || trigger.systemName} [${trigger.actionTiming || 'UNKNOWN'} ${trigger.eventManipulation || 'UNKNOWN'} ${trigger.actionOrientation || 'UNKNOWN'}]${trigger.programLibrary || trigger.programName ? ` via ${(trigger.programLibrary || '')}${trigger.programLibrary && trigger.programName ? '/' : ''}${trigger.programName || ''}` : ''}`);
      }
    }

    if ((table.derivedObjects || []).length > 0) {
      lines.push('');
      lines.push('Derived Objects:');
      for (const derivedObject of table.derivedObjects) {
        const qualifiedName = derivedObject.schema && derivedObject.name
          ? `${derivedObject.schema}.${derivedObject.name}`
          : derivedObject.systemSchema && derivedObject.systemName
            ? `${derivedObject.systemSchema}/${derivedObject.systemName}`
            : derivedObject.name || derivedObject.systemName;
        lines.push(`- ${qualifiedName} [${derivedObject.objectType || 'VIEW'}]${derivedObject.textDescription ? ` ${derivedObject.textDescription}` : ''}`);
      }
    }

    lines.push('');
  }

  if ((externalObjects || []).length > 0) {
    lines.push('## Catalog-Resolved External Objects');
    lines.push('');
    for (const externalObject of externalObjects) {
      const library = externalObject.library || externalObject.schema || '(unknown)';
      const name = externalObject.sqlName || externalObject.systemName || externalObject.requestedName;
      const qualifier = externalObject.systemName ? `${library}/${externalObject.systemName}` : `${library}.${name}`;
      lines.push(`- ${externalObject.requestedName}: ${qualifier} [${externalObject.objectType || 'OBJECT'}]${externalObject.sqlName && externalObject.sqlName !== externalObject.systemName ? ` SQL ${externalObject.sqlName}` : ''}${externalObject.textDescription ? ` ${externalObject.textDescription}` : ''}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function writeOutputs(outputDir, payload, markdown) {
  fs.writeFileSync(path.join(outputDir, JSON_FILE), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(outputDir, MARKDOWN_FILE), markdown, 'utf8');
}

function createSkippedSummary(reason) {
  return {
    status: 'skipped',
    file: JSON_FILE,
    markdownFile: MARKDOWN_FILE,
    tableCount: 0,
    requestedTableCount: 0,
    resolvedTableCount: 0,
    unresolvedTableCount: 0,
    ambiguousTableCount: 0,
    triggerCount: 0,
    derivedObjectCount: 0,
    externalObjectCount: 0,
    catalogResolvedProgramCount: 0,
    catalogResolvedProcedureCount: 0,
    fallbackLookupCount: 0,
    reason,
  };
}

function runTableMetadataExport({ jdbcUrl, dbConfig, defaultSchema, requestedTables, verbose }) {
  if (requestedTables.length === 0) {
    return { tables: [] };
  }

  ensureJavaHelperCompiled('Db2MetadataExporter.java', 'Db2MetadataExporter');
  if (verbose) {
    console.log(`[verbose] Exporting DB2 metadata for ${requestedTables.length} tables`);
  }

  const result = runJavaHelper('Db2MetadataExporter', [
    jdbcUrl,
    String(dbConfig.user),
    String(dbConfig.password),
    defaultSchema,
    requestedTables.join(','),
  ]);

  if (result.status !== 0) {
    const errorText = (result.stderr || '').trim() || 'unknown DB2 metadata error';
    throw new Error(errorText);
  }

  return parseJavaJson(result.stdout);
}

function runExternalObjectExport({ jdbcUrl, dbConfig, requestedNames, verbose }) {
  if (requestedNames.length === 0) {
    return { objects: [] };
  }

  ensureJavaHelperCompiled('Db2ExternalObjectResolver.java', 'Db2ExternalObjectResolver');
  if (verbose) {
    console.log(`[verbose] Resolving ${requestedNames.length} unresolved external IBM i object names`);
  }

  const result = runJavaHelper('Db2ExternalObjectResolver', [
    jdbcUrl,
    String(dbConfig.user),
    String(dbConfig.password),
    requestedNames.join(','),
  ]);

  if (result.status !== 0) {
    const errorText = (result.stderr || '').trim() || 'unknown DB2 external object error';
    throw new Error(errorText);
  }

  return parseJavaJson(result.stdout);
}

function exportDb2Metadata({ program, dependencies, dbConfig, outputDir, verbose, canonicalAnalysis, context }) {
  const requestedTables = buildRequestedTableNames(dependencies);
  const requestedExternalObjects = buildRequestedExternalObjectNames(canonicalAnalysis);
  const defaultSchema = resolveDefaultSchema(dbConfig);
  const summary = createSkippedSummary('no DB2 connection configuration was available');

  if (!isDbConfigured(dbConfig)) {
    return {
      summary,
      notes: ['DB2 metadata export was skipped because no DB2 connection configuration was available.'],
      canonicalUpdates: { entities: {}, relations: [] },
    };
  }

  const jdbcUrl = buildJdbcUrl(dbConfig, defaultSchema);
  if (!jdbcUrl) {
    return {
      summary: createSkippedSummary('DB2 connection configuration is incomplete'),
      notes: ['DB2 metadata export was skipped because DB2 connection configuration is incomplete.'],
      canonicalUpdates: { entities: {}, relations: [] },
    };
  }

  if (requestedTables.length === 0 && requestedExternalObjects.length === 0) {
    const payload = {
      program: normalizeIdentifier(program),
      tables: [],
      tableLinks: [],
      externalObjects: [],
      notes: [],
    };
    writeOutputs(outputDir, payload, renderDb2MetadataMarkdown(program, [], [], []));
    return {
      payload,
      summary: {
        ...createSkippedSummary('no source-linked DB2 tables or unresolved external calls were detected'),
        status: 'exported',
      },
      notes: [],
      canonicalUpdates: { entities: {}, relations: [] },
    };
  }

  try {
    const rawTableExport = runTableMetadataExport({
      jdbcUrl,
      dbConfig,
      defaultSchema,
      requestedTables,
      verbose,
    });
    const rawExternalExport = runExternalObjectExport({
      jdbcUrl,
      dbConfig,
      requestedNames: requestedExternalObjects,
      verbose,
    });

    const tables = dedupeTables(rawTableExport.tables || []);
    const linkage = buildDb2SourceLinkage({
      requestedTables,
      exportedTables: tables,
      canonicalAnalysis,
      context,
    });
    const linkedTables = tables.map((table) => {
      const sourceLink = linkage.tableLinkByExactKey.get(`${normalizeIdentifier(table.schema)}|${normalizeIdentifier(table.table)}`)
        || linkage.tableLinkByExactKey.get(`${normalizeIdentifier(table.systemSchema)}|${normalizeIdentifier(table.systemName)}`)
        || null;
      const compactLink = sourceLink ? buildCompactDb2TableLink(sourceLink, table) : null;
      return {
        ...table,
        ...(sourceLink ? { sourceLink: { ...sourceLink, ...(compactLink ? { matchedBy: compactLink.matchedBy } : {}) } } : {}),
      };
    });
    const normalizedExternalObjects = (rawExternalExport.objects || rawExternalExport.externalObjects || [])
      .map(normalizeExternalObject)
      .sort((a, b) => {
        if (a.requestedName !== b.requestedName) return a.requestedName.localeCompare(b.requestedName);
        if (a.library !== b.library) return a.library.localeCompare(b.library);
        return (a.systemName || a.sqlName).localeCompare(b.systemName || b.sqlName);
      });

    const canonicalUpdates = buildDb2CatalogSemanticUpdates({
      canonicalAnalysis,
      tableLinks: linkage.tableLinks,
      exportedTables: linkedTables,
      externalObjects: normalizedExternalObjects,
    });

    const unresolvedTables = linkage.unresolvedTables;
    const notes = [];
    if (unresolvedTables.length > 0) {
      notes.push(`DB2 metadata lookup did not resolve tables: ${unresolvedTables.join(', ')}.`);
    }
    if (linkage.ambiguousTables.length > 0) {
      notes.push(`DB2 metadata lookup matched multiple catalog objects for tables: ${linkage.ambiguousTables.map((entry) => `${entry.requestedName} (${entry.matchedSchemas.join(', ')})`).join('; ')}.`);
    }
    for (const diagnostic of linkage.diagnostics || []) {
      if (diagnostic.code === 'DB2_TABLE_LOOKUP_FALLBACK') {
        notes.push(diagnostic.message);
      }
    }

    const payload = {
      program: normalizeIdentifier(program),
      tables: linkedTables,
      tableLinks: linkage.tableLinks,
      externalObjects: normalizedExternalObjects,
      notes: uniqueSortedStrings(notes),
    };
    writeOutputs(outputDir, payload, renderDb2MetadataMarkdown(program, linkedTables, normalizedExternalObjects, payload.notes));

    return {
      payload,
      summary: {
        status: 'exported',
        file: JSON_FILE,
        markdownFile: MARKDOWN_FILE,
        tableCount: tables.length,
        requestedTableCount: requestedTables.length,
        resolvedTableCount: linkage.tableLinks.filter((entry) => entry.matchStatus === 'resolved').length,
        unresolvedTableCount: unresolvedTables.length,
        ambiguousTableCount: linkage.ambiguousTables.length,
        triggerCount: linkedTables.reduce((sum, entry) => sum + (entry.triggers || []).length, 0),
        derivedObjectCount: linkedTables.reduce((sum, entry) => sum + (entry.derivedObjects || []).length, 0),
        externalObjectCount: normalizedExternalObjects.length,
        catalogResolvedProgramCount: Object.keys(canonicalUpdates.entities || {}).includes('programs')
          ? canonicalUpdates.entities.programs.length
          : 0,
        catalogResolvedProcedureCount: (
          (canonicalUpdates.entities && canonicalUpdates.entities.prototypes ? canonicalUpdates.entities.prototypes.length : 0)
          + (canonicalUpdates.entities && canonicalUpdates.entities.procedureReferences ? canonicalUpdates.entities.procedureReferences.length : 0)
        ),
        fallbackLookupCount: (linkage.diagnostics || []).filter((entry) => entry.code === 'DB2_TABLE_LOOKUP_FALLBACK').length,
        tables: linkedTables.map((table) => {
          const sourceLink = linkage.tableLinkByExactKey.get(`${normalizeIdentifier(table.schema)}|${normalizeIdentifier(table.table)}`)
            || linkage.tableLinkByExactKey.get(`${normalizeIdentifier(table.systemSchema)}|${normalizeIdentifier(table.systemName)}`)
            || {
              requestedName: normalizeIdentifier(table.table || table.systemName),
              matchStatus: 'resolved',
              matches: [],
              sourceEvidence: [],
              sqlReferences: [],
              nativeFiles: [],
            };
          return buildCompactDb2TableLink(sourceLink, table);
        }),
        externalObjects: normalizedExternalObjects,
        ...(unresolvedTables.length > 0 ? { unresolvedTables } : {}),
        ...(linkage.ambiguousTables.length > 0 ? { ambiguousTables: linkage.ambiguousTables } : {}),
      },
      notes: payload.notes,
      diagnostics: linkage.diagnostics || [],
      canonicalUpdates,
    };
  } catch (error) {
    return {
      summary: createSkippedSummary(`the DB2 helper could not run: ${error.message}`),
      notes: [`DB2 metadata export was skipped because the DB2 helper could not run: ${error.message}`],
      canonicalUpdates: { entities: {}, relations: [] },
    };
  }
}

module.exports = {
  exportDb2Metadata,
  renderDb2MetadataMarkdown,
};
