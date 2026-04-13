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
  buildCompactTestDataLink,
  buildDb2TableLookupIndex,
  buildDb2SourceLinkage,
  normalizeCatalogTable,
} = require('./db2EvidenceLinker');

const JSON_FILE = 'test-data.json';
const MARKDOWN_FILE = 'test-data.md';
const DEFAULT_TEST_DATA_LIMIT = 50;
const MARKDOWN_COLUMN_LIMIT = 8;
const MARKDOWN_ROW_LIMIT = 10;

function normalizeMaskColumns(testDataConfig) {
  return Array.from(new Set(
    ((testDataConfig && testDataConfig.maskColumns) || [])
      .map((value) => normalizeIdentifier(value))
      .filter(Boolean),
  )).sort((a, b) => a.localeCompare(b));
}

function writeOutputs(outputDir, payload, markdown) {
  fs.writeFileSync(path.join(outputDir, JSON_FILE), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(outputDir, MARKDOWN_FILE), markdown, 'utf8');
}

function parseJavaJson(stdout) {
  const content = String(stdout || '').trim();
  if (!content) {
    return null;
  }
  return JSON.parse(content);
}

function parseQualifiedTableName(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  if (raw.includes('.')) {
    const [schema, table] = raw.split('.', 2);
    return {
      schema: normalizeIdentifier(schema),
      table: normalizeIdentifier(table),
    };
  }

  if (raw.includes('/')) {
    const [schema, table] = raw.split('/', 2);
    return {
      schema: normalizeIdentifier(schema),
      table: normalizeIdentifier(table),
    };
  }

  return {
    schema: '',
    table: normalizeIdentifier(raw),
  };
}

function buildRequestedTables(dependencies) {
  return Array.from(
    new Set(
      ((dependencies && dependencies.tables) || [])
        .map((entry) => parseQualifiedTableName(entry && entry.name ? entry.name : entry))
        .filter(Boolean)
        .map((entry) => `${entry.schema}|${entry.table}`),
    ),
  )
    .map((key) => {
      const [schema, table] = key.split('|');
      return { schema, table };
    })
    .sort((a, b) => {
      if (a.table !== b.table) return a.table.localeCompare(b.table);
      return a.schema.localeCompare(b.schema);
    });
}

function buildExtractionPlan({ requestedTables, metadataPayload, defaultSchema }) {
  const plan = new Map();
  const metadataTables = (metadataPayload && Array.isArray(metadataPayload.tables) ? metadataPayload.tables : [])
    .map((table) => normalizeCatalogTable({
      ...table,
      columns: Array.isArray(table && table.columns) ? table.columns : [],
    }));
  const lookupIndex = buildDb2TableLookupIndex(metadataTables);

  for (const table of metadataTables) {
    if (!table.table && !table.systemName) continue;
    const key = `${table.schema}|${table.table}`;
    plan.set(key, {
      schema: table.schema,
      table: table.table,
      systemSchema: table.systemSchema,
      systemName: table.systemName,
      columns: table.columns,
      status: 'pending',
    });
  }

  for (const requestedTable of requestedTables) {
    const requestedAliases = [
      requestedTable.schema && requestedTable.table ? `${requestedTable.schema}.${requestedTable.table}` : '',
      requestedTable.schema && requestedTable.table ? `${requestedTable.schema}/${requestedTable.table}` : '',
      requestedTable.table,
    ].filter(Boolean).map((value) => normalizeIdentifier(value));
    const matches = Array.from(new Map(
      requestedAliases.flatMap((alias) => (lookupIndex.aliasIndex.get(alias) || []))
        .map((entry) => [`${entry.schema}|${entry.table}|${entry.systemSchema}|${entry.systemName}`, entry]),
    ).values());

    if (matches.length === 1) {
      const match = matches[0];
      const key = `${match.schema}|${match.table}`;
      if (!plan.has(key)) {
        plan.set(key, {
          schema: match.schema,
          table: match.table,
          systemSchema: match.systemSchema,
          systemName: match.systemName,
          columns: match.columns || [],
          status: 'pending',
        });
      }
      continue;
    }

    if (matches.length > 1) {
      plan.set(`${requestedTable.schema || ''}|${requestedTable.table}`, {
        schema: '',
        table: requestedTable.table,
        systemSchema: '',
        systemName: requestedTable.table,
        columns: [],
        status: 'skipped',
        note: `Skipped because ${requestedTable.table} matched multiple DB2 catalog objects.`,
      });
      continue;
    }

    const schema = requestedTable.schema || defaultSchema;
    const key = `${schema}|${requestedTable.table}`;
    if (plan.has(key)) {
      continue;
    }
    if (!schema) {
      plan.set(`|${requestedTable.table}`, {
        schema: '',
        table: requestedTable.table,
        systemSchema: '',
        systemName: requestedTable.table,
        columns: [],
        status: 'skipped',
        note: 'Skipped because no schema was detected and no default schema/library is configured.',
      });
      continue;
    }

    plan.set(key, {
      schema,
      table: requestedTable.table,
      systemSchema: schema,
      systemName: requestedTable.table,
      columns: [],
      status: 'pending',
    });
  }

  return Array.from(plan.values()).sort((a, b) => {
    if (a.table !== b.table) return a.table.localeCompare(b.table);
    return a.schema.localeCompare(b.schema);
  });
}

function maskRows(rows, columns, maskColumns) {
  if (!maskColumns || maskColumns.size === 0) {
    return rows;
  }

  return rows.map((row) => {
    const masked = {};
    for (const columnName of columns) {
      if (maskColumns.has(normalizeIdentifier(columnName))) {
        masked[columnName] = row[columnName] === null || row[columnName] === undefined ? row[columnName] : 'MASKED';
      } else {
        masked[columnName] = row[columnName];
      }
    }
    return masked;
  });
}

function renderValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value).replace(/\|/g, '\\|');
  }
  return String(value).replace(/\|/g, '\\|');
}

function renderTableMarkdown(table) {
  const lines = [`## Table ${table.table}`, ''];
  lines.push(`Schema: ${table.schema || '(unknown)'}`);
  lines.push('');
  if (table.sourceLink) {
    lines.push(`Match Status: ${table.sourceLink.matchStatus}`);
    if ((table.sourceLink.sourceEvidence || []).length > 0) {
      lines.push('');
      lines.push('Source Evidence:');
      for (const evidence of table.sourceLink.sourceEvidence) {
        lines.push(`- ${evidence.file}:${evidence.startLine || 1}`);
      }
    }
    lines.push('');
  }

  if (table.status && table.status !== 'exported') {
    lines.push(`Status: ${table.status}`);
    if (table.note) {
      lines.push('');
      lines.push(table.note);
    }
    lines.push('');
    return lines;
  }

  lines.push(`Extracted Rows: ${table.rowCount}`);
  if (table.note) {
    lines.push(`Note: ${table.note}`);
  }
  lines.push('');

  const columns = Array.isArray(table.columns) ? table.columns : [];
  if (columns.length === 0) {
    lines.push('No columns were returned.');
    lines.push('');
    return lines;
  }

  const visibleColumns = columns.slice(0, MARKDOWN_COLUMN_LIMIT);
  if (columns.length > visibleColumns.length) {
    lines.push(`Showing ${visibleColumns.length} of ${columns.length} columns.`);
    lines.push('');
  }

  lines.push(`| ${visibleColumns.join(' | ')} |`);
  lines.push(`| ${visibleColumns.map(() => '---').join(' | ')} |`);

  const rows = Array.isArray(table.rows) ? table.rows.slice(0, MARKDOWN_ROW_LIMIT) : [];
  if (rows.length === 0) {
    lines.push(`| ${visibleColumns.map(() => '').join(' | ')} |`);
  } else {
    for (const row of rows) {
      lines.push(`| ${visibleColumns.map((column) => renderValue(row[column])).join(' | ')} |`);
    }
  }

  if ((table.rows || []).length > rows.length) {
    lines.push('');
    lines.push(`Showing ${rows.length} of ${table.rows.length} extracted rows.`);
  }

  lines.push('');
  return lines;
}

function renderTestDataMarkdown(program, rowLimit, tables, notes) {
  const lines = [
    '# Test Data Extract',
    '',
    `Program: ${normalizeIdentifier(program)}`,
    '',
    `Row Limit per Table: ${rowLimit}`,
    '',
  ];

  if (notes.length > 0) {
    lines.push('Notes:');
    for (const note of notes) {
      lines.push(`- ${note}`);
    }
    lines.push('');
  }

  if (!tables || tables.length === 0) {
    lines.push('No test data was extracted.');
    lines.push('');
    return `${lines.join('\n')}\n`;
  }

  for (const table of tables) {
    lines.push(...renderTableMarkdown(table));
  }

  return `${lines.join('\n')}\n`;
}

function createSkippedSummary(reason, note, rowLimit, requestedTableCount) {
  return {
    summary: {
      status: 'skipped',
      file: JSON_FILE,
      markdownFile: MARKDOWN_FILE,
      tableCount: 0,
      requestedTableCount,
      skippedTableCount: requestedTableCount,
      rowLimit,
      reason,
    },
    notes: [note],
  };
}

function exportTestData({
  program,
  dependencies,
  dbConfig,
  outputDir,
  metadataPayload,
  canonicalAnalysis,
  context,
  testDataConfig,
  skipTestData = false,
  verbose = false,
}) {
  const rowLimit = Number(testDataConfig && testDataConfig.limit) || DEFAULT_TEST_DATA_LIMIT;
  const requestedTables = buildRequestedTables(dependencies);

  if (skipTestData) {
    return createSkippedSummary(
      'test data extraction was disabled by CLI flag',
      'Test data extraction was skipped because --skip-test-data was provided.',
      rowLimit,
      requestedTables.length,
    );
  }

  if (!isDbConfigured(dbConfig)) {
    return createSkippedSummary(
      'no DB2 connection configuration was available',
      'Test data extraction was skipped because no DB2 connection configuration was available.',
      rowLimit,
      requestedTables.length,
    );
  }

  const defaultSchema = resolveDefaultSchema(dbConfig);
  const jdbcUrl = buildJdbcUrl(dbConfig, defaultSchema);
  if (!jdbcUrl) {
    return createSkippedSummary(
      'DB2 connection configuration is incomplete',
      'Test data extraction was skipped because DB2 connection configuration is incomplete.',
      rowLimit,
      requestedTables.length,
    );
  }

  const plan = buildExtractionPlan({
    requestedTables,
    metadataPayload,
    defaultSchema,
  });
  const metadataLinkage = metadataPayload && Array.isArray(metadataPayload.tableLinks)
    ? {
      tableLinks: metadataPayload.tableLinks,
      tableLinkByExactKey: new Map(
        metadataPayload.tableLinks.flatMap((link) => (link.matches || []).map((match) => [
          `${normalizeIdentifier(match.schema)}|${normalizeIdentifier(match.table)}`,
          link,
        ])),
      ),
    }
    : buildDb2SourceLinkage({
      requestedTables: requestedTables.map((entry) => entry.table),
      exportedTables: plan,
      canonicalAnalysis,
      context,
    });
  const maskColumns = new Set(normalizeMaskColumns(testDataConfig));
  const notes = [];
  const tables = [];

  if (plan.length === 0) {
    const payload = {
      program: normalizeIdentifier(program),
      rowLimit,
      tables: [],
      notes,
    };
    writeOutputs(outputDir, payload, renderTestDataMarkdown(program, rowLimit, [], notes));
    return {
      payload,
      summary: {
        status: 'exported',
        file: JSON_FILE,
        markdownFile: MARKDOWN_FILE,
        tableCount: 0,
        requestedTableCount: 0,
        skippedTableCount: 0,
        rowLimit,
      },
      notes,
    };
  }

  try {
    ensureJavaHelperCompiled('Db2TestDataExtractor.java', 'Db2TestDataExtractor');
  } catch (error) {
    return createSkippedSummary(
      `the DB2 helper could not run: ${error.message}`,
      `Test data extraction was skipped because the DB2 helper could not run: ${error.message}`,
      rowLimit,
      requestedTables.length,
    );
  }

  for (const entry of plan) {
    if (entry.status === 'skipped') {
      tables.push({
        schema: entry.schema,
        table: entry.table,
        status: 'skipped',
        rowCount: 0,
        columns: [],
        rows: [],
        note: entry.note,
        sourceLink: metadataLinkage.tableLinkByExactKey.get(`${normalizeIdentifier(entry.schema)}|${normalizeIdentifier(entry.table)}`) || null,
      });
      notes.push(`Skipped test data extraction for ${entry.table}: ${entry.note}`);
      continue;
    }

    const primaryKeyColumns = (entry.columns || [])
      .filter((column) => column && column.primaryKey)
      .map((column) => String(column.name || '').trim())
      .filter(Boolean);

    if (verbose) {
      console.log(`[verbose] Extracting test data for ${entry.schema}.${entry.table} (limit ${rowLimit})`);
    }

    const result = runJavaHelper('Db2TestDataExtractor', [
      jdbcUrl,
      String(dbConfig.user),
      String(dbConfig.password),
      entry.schema,
      entry.table,
      String(rowLimit),
      primaryKeyColumns.join(','),
    ]);

    if (result.status !== 0) {
      const errorText = (result.stderr || '').trim() || 'unknown DB2 test data error';
      tables.push({
        schema: entry.schema,
        table: entry.table,
        status: 'error',
        rowCount: 0,
        columns: [],
        rows: [],
        note: errorText,
        sourceLink: metadataLinkage.tableLinkByExactKey.get(`${normalizeIdentifier(entry.schema)}|${normalizeIdentifier(entry.table)}`) || null,
      });
      notes.push(`Test data extraction failed for ${entry.schema}.${entry.table}: ${errorText}`);
      continue;
    }

    try {
      const parsed = parseJavaJson(result.stdout) || {};
      const columns = Array.isArray(parsed.columns) ? parsed.columns : [];
      const rows = maskRows(
        Array.isArray(parsed.rows) ? parsed.rows : [],
        columns,
        maskColumns,
      );
      const tableEntry = {
        schema: normalizeIdentifier(parsed.schema || entry.schema),
        table: normalizeIdentifier(parsed.table || entry.table),
        status: 'exported',
        rowCount: Number.isFinite(Number(parsed.rowCount)) ? Number(parsed.rowCount) : rows.length,
        columns,
        rows,
        sourceLink: metadataLinkage.tableLinkByExactKey.get(
          `${normalizeIdentifier(parsed.schema || entry.schema)}|${normalizeIdentifier(parsed.table || entry.table)}`,
        ) || null,
      };
      if (primaryKeyColumns.length > 0) {
        tableEntry.note = `Rows ordered by primary key: ${primaryKeyColumns.join(', ')}.`;
      }
      tables.push(tableEntry);
    } catch (error) {
      tables.push({
        schema: entry.schema,
        table: entry.table,
        status: 'error',
        rowCount: 0,
        columns: [],
        rows: [],
        note: `Invalid helper output: ${error.message}`,
        sourceLink: metadataLinkage.tableLinkByExactKey.get(`${normalizeIdentifier(entry.schema)}|${normalizeIdentifier(entry.table)}`) || null,
      });
      notes.push(`Test data extraction returned invalid output for ${entry.schema}.${entry.table}: ${error.message}`);
    }
  }

  const sortedNotes = Array.from(new Set(notes)).sort((a, b) => a.localeCompare(b));
  const payload = {
    program: normalizeIdentifier(program),
    rowLimit,
    tables,
    notes: sortedNotes,
  };
  writeOutputs(outputDir, payload, renderTestDataMarkdown(program, rowLimit, tables, sortedNotes));

  return {
    payload,
    summary: {
      status: 'exported',
      file: JSON_FILE,
      markdownFile: MARKDOWN_FILE,
      tableCount: tables.filter((table) => table.status === 'exported').length,
      requestedTableCount: requestedTables.length,
      skippedTableCount: tables.filter((table) => table.status !== 'exported').length,
      rowLimit,
      tables: tables.map((table) => {
        const link = table.sourceLink || {
          requestedName: normalizeIdentifier(table.table),
          matchStatus: 'resolved',
          sourceEvidence: [],
          sqlReferences: [],
          nativeFiles: [],
        };
        return buildCompactTestDataLink(link, table);
      }),
    },
    notes: sortedNotes,
  };
}

module.exports = {
  buildExtractionPlan,
  exportTestData,
  DEFAULT_TEST_DATA_LIMIT,
  renderTestDataMarkdown,
};
