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
} = require('./db2EvidenceLinker');

const JSON_FILE = 'db2-metadata.json';
const MARKDOWN_FILE = 'db2-metadata.md';

function parseJavaJson(stdout) {
  const content = String(stdout || '').trim();
  if (!content) {
    return { tables: [] };
  }
  return JSON.parse(content);
}

function normalizeColumn(column) {
  return {
    name: normalizeIdentifier(column && column.name),
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
  };
}

function normalizeTable(table) {
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

  const normalized = {
    schema: normalizeIdentifier(table && table.schema),
    table: normalizeIdentifier(table && table.table),
    columns,
  };

  if (foreignKeys.length > 0) {
    normalized.foreignKeys = foreignKeys;
  }

  return normalized;
}

function dedupeTables(tables) {
  const byKey = new Map();

  for (const table of tables) {
    const normalized = normalizeTable(table);
    if (!normalized.table) continue;
    const key = `${normalized.schema}|${normalized.table}`;
    if (!byKey.has(key)) {
      byKey.set(key, normalized);
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    if (a.table !== b.table) return a.table.localeCompare(b.table);
    return a.schema.localeCompare(b.schema);
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

function renderDb2MetadataMarkdown(program, tables) {
  const lines = [
    '# DB2 Metadata',
    '',
    `Program: ${normalizeIdentifier(program)}`,
    '',
  ];

  if (!tables || tables.length === 0) {
    lines.push('No DB2 metadata was exported.');
    lines.push('');
    return `${lines.join('\n')}\n`;
  }

  for (const table of tables) {
    lines.push(`## Table ${table.table}`);
    lines.push('');
    lines.push(`Schema: ${table.schema || '(unknown)'}`);
    if (table.sourceLink) {
      lines.push(`Match Status: ${table.sourceLink.matchStatus}`);
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
    lines.push('| Column | Type | Length | Nullable | PK |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const column of table.columns || []) {
      lines.push(`| ${column.name} | ${column.type} | ${renderLength(column)} | ${column.nullable ? 'Yes' : 'No'} | ${column.primaryKey ? 'Yes' : 'No'} |`);
    }
    if ((table.foreignKeys || []).length > 0) {
      lines.push('');
      lines.push('Foreign Keys:');
      for (const foreignKey of table.foreignKeys) {
        const schemaPrefix = foreignKey.referencesSchema ? `${foreignKey.referencesSchema}.` : '';
        lines.push(`- ${foreignKey.column} -> ${schemaPrefix}${foreignKey.referencesTable}.${foreignKey.referencesColumn}`);
      }
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function writeOutputs(outputDir, payload, markdown) {
  fs.writeFileSync(path.join(outputDir, JSON_FILE), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(outputDir, MARKDOWN_FILE), markdown, 'utf8');
}

function exportDb2Metadata({ program, dependencies, dbConfig, outputDir, verbose, canonicalAnalysis, context }) {
  const requestedTables = buildRequestedTableNames(dependencies);
  const defaultSchema = resolveDefaultSchema(dbConfig);
  const summary = {
    status: 'skipped',
    file: JSON_FILE,
    markdownFile: MARKDOWN_FILE,
    tableCount: 0,
  };

  if (!isDbConfigured(dbConfig)) {
    return {
      summary: {
        ...summary,
        reason: 'no DB2 connection configuration was available',
      },
      notes: ['DB2 metadata export was skipped because no DB2 connection configuration was available.'],
    };
  }

  const jdbcUrl = buildJdbcUrl(dbConfig, defaultSchema);
  if (!jdbcUrl) {
    return {
      summary: {
        ...summary,
        reason: 'DB2 connection configuration is incomplete',
      },
      notes: ['DB2 metadata export was skipped because DB2 connection configuration is incomplete.'],
    };
  }

  if (requestedTables.length === 0) {
    const linkage = buildDb2SourceLinkage({
      requestedTables,
      exportedTables: [],
      canonicalAnalysis,
      context,
    });
    const payload = {
      program: normalizeIdentifier(program),
      tables: [],
      tableLinks: linkage.tableLinks,
    };
    writeOutputs(outputDir, payload, renderDb2MetadataMarkdown(program, []));
    return {
      payload,
      summary: {
        status: 'exported',
        file: JSON_FILE,
        markdownFile: MARKDOWN_FILE,
        tableCount: 0,
        requestedTableCount: 0,
        resolvedTableCount: 0,
        unresolvedTableCount: requestedTables.length,
        ambiguousTableCount: 0,
        tables: [],
      },
      notes: linkage.unresolvedTables.length > 0
        ? [`DB2 metadata lookup did not resolve tables: ${linkage.unresolvedTables.join(', ')}.`]
        : [],
    };
  }

  try {
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
      return {
        summary: {
          ...summary,
          reason: `the DB2 helper failed: ${errorText}`,
        },
        notes: [`DB2 metadata export was skipped because the DB2 helper failed: ${errorText}`],
      };
    }

    const parsed = parseJavaJson(result.stdout);
    const tables = dedupeTables(parsed.tables || []);
    const linkage = buildDb2SourceLinkage({
      requestedTables,
      exportedTables: tables,
      canonicalAnalysis,
      context,
    });
    const linkedTables = tables.map((table) => {
      const sourceLink = linkage.tableLinkByExactKey.get(`${normalizeIdentifier(table.schema)}|${normalizeIdentifier(table.table)}`) || null;
      return {
        ...table,
        ...(sourceLink ? { sourceLink } : {}),
      };
    });
    const payload = {
      program: normalizeIdentifier(program),
      tables: linkedTables,
      tableLinks: linkage.tableLinks,
    };
    writeOutputs(outputDir, payload, renderDb2MetadataMarkdown(program, linkedTables));

    const unresolvedTables = linkage.unresolvedTables;
    const notes = [];
    if (unresolvedTables.length > 0) {
      notes.push(`DB2 metadata lookup did not resolve tables: ${unresolvedTables.join(', ')}.`);
    }
    if (linkage.ambiguousTables.length > 0) {
      notes.push(`DB2 metadata lookup matched multiple schemas for tables: ${linkage.ambiguousTables.map((entry) => `${entry.requestedName} (${entry.matchedSchemas.join(', ')})`).join('; ')}.`);
    }

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
        tables: linkedTables.map((table) => {
          const sourceLink = linkage.tableLinkByExactKey.get(`${normalizeIdentifier(table.schema)}|${normalizeIdentifier(table.table)}`) || {
            requestedName: normalizeIdentifier(table.table),
            matchStatus: 'resolved',
            sourceEvidence: [],
            sqlReferences: [],
            nativeFiles: [],
          };
          return buildCompactDb2TableLink(sourceLink, table);
        }),
        ...(unresolvedTables.length > 0 ? { unresolvedTables } : {}),
        ...(linkage.ambiguousTables.length > 0 ? { ambiguousTables: linkage.ambiguousTables } : {}),
      },
      notes,
      diagnostics: linkage.diagnostics,
    };
  } catch (error) {
    return {
      summary: {
        ...summary,
        reason: `the DB2 helper could not run: ${error.message}`,
      },
      notes: [`DB2 metadata export was skipped because the DB2 helper could not run: ${error.message}`],
    };
  }
}

module.exports = {
  exportDb2Metadata,
  renderDb2MetadataMarkdown,
};
