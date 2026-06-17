/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
'use strict';

const {
  escapeSqlLiteral,
  executeReadOnlyDb2QueryWithFallback,
  runReadOnlyDb2Query,
  validateSqlIdentifier,
} = require('./readOnlyQueryService');

function normalizeRowValue(row, ...keys) {
  for (const key of keys) {
    if (row && row[key] !== undefined && row[key] !== null) {
      return row[key];
    }
  }
  return '';
}

function normalizeTableRow(row) {
  const sqlName = String(normalizeRowValue(row, 'SQL_TABLE_NAME', 'sql_table_name', 'TABLE_NAME', 'table_name') || '').trim().toUpperCase();
  return {
    systemName: String(normalizeRowValue(
      row,
      'SYSTEM_TABLE_NAME',
      'system_table_name',
      'SQL_TABLE_NAME',
      'sql_table_name',
      'TABLE_NAME',
      'table_name',
    ) || '').trim().toUpperCase(),
    sqlName,
    schema: String(normalizeRowValue(row, 'TABLE_SCHEMA', 'table_schema') || '').trim().toUpperCase(),
    type: String(normalizeRowValue(row, 'TABLE_TYPE', 'table_type') || '').trim().toUpperCase(),
  };
}

function resolveTableNameBothDirections(dbConfig, tableNameOrAlias, schema, runtime = {}) {
  const resolvedSchema = validateSqlIdentifier(schema, '--schema');
  const searchName = validateSqlIdentifier(tableNameOrAlias, '--table');

  const query = `SELECT SYSTEM_TABLE_NAME, TABLE_NAME AS SQL_TABLE_NAME, TABLE_SCHEMA
FROM QSYS2.SYSTABLES
WHERE TABLE_SCHEMA = ${escapeSqlLiteral(resolvedSchema)}
  AND (SYSTEM_TABLE_NAME = ${escapeSqlLiteral(searchName)} OR TABLE_NAME = ${escapeSqlLiteral(searchName)})
ORDER BY TABLE_SCHEMA, TABLE_NAME
FETCH FIRST 1 ROW ONLY`;

  const result = executeReadOnlyDb2QueryWithFallback({
    dbConfig,
    query,
    maxRows: 1,
    runtime,
    degradedMode: 'empty',
    retryHandlers: {
      '42703': () => ({
        name: 'without-system-table-name',
        query: `SELECT TABLE_NAME AS SQL_TABLE_NAME, TABLE_SCHEMA
FROM QSYS2.SYSTABLES
WHERE TABLE_SCHEMA = ${escapeSqlLiteral(resolvedSchema)}
  AND TABLE_NAME = ${escapeSqlLiteral(searchName)}
ORDER BY TABLE_SCHEMA, TABLE_NAME
FETCH FIRST 1 ROW ONLY`,
      }),
    },
  });

  if (!result.rows || result.rows.length === 0) {
    return {
      searched: {
        tableNameOrAlias: searchName,
        schema: resolvedSchema,
      },
      found: false,
      source: null,
    };
  }

  const normalized = normalizeTableRow(result.rows[0]);
  return {
    systemName: normalized.systemName || normalized.sqlName,
    sqlName: normalized.sqlName,
    schema: normalized.schema || resolvedSchema,
    found: true,
    source: 'QSYS2.SYSTABLES',
  };
}

function listTablesInSchema(dbConfig, schema, runtime = {}) {
  const resolvedSchema = validateSqlIdentifier(schema, '--schema');

  const query = `SELECT SYSTEM_TABLE_NAME, TABLE_NAME AS SQL_TABLE_NAME, TABLE_SCHEMA, TABLE_TYPE
FROM QSYS2.SYSTABLES
WHERE TABLE_SCHEMA = ${escapeSqlLiteral(resolvedSchema)}
ORDER BY TABLE_NAME`;

  const result = executeReadOnlyDb2QueryWithFallback({
    dbConfig,
    query,
    maxRows: 500,
    runtime,
    degradedMode: 'empty',
    retryHandlers: {
      '42703': () => ({
        name: 'without-system-table-name',
        query: `SELECT TABLE_NAME AS SQL_TABLE_NAME, TABLE_SCHEMA, TABLE_TYPE
FROM QSYS2.SYSTABLES
WHERE TABLE_SCHEMA = ${escapeSqlLiteral(resolvedSchema)}
ORDER BY TABLE_NAME`,
      }),
    },
  });

  const tables = (result.rows || []).map((row) => normalizeTableRow(row));
  return {
    tables,
    schema: resolvedSchema,
    count: tables.length,
  };
}

function resolveColumnsWithName(dbConfig, schema, sqlTableName, runtime = {}) {
  const resolvedSchema = validateSqlIdentifier(schema, '--schema');
  const resolvedSqlTableName = validateSqlIdentifier(sqlTableName, '--table');

  const query = `SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, IS_NULLABLE, ORDINAL_POSITION
FROM QSYS2.SYSCOLUMNS
WHERE TABLE_SCHEMA = ${escapeSqlLiteral(resolvedSchema)}
  AND TABLE_NAME = ${escapeSqlLiteral(resolvedSqlTableName)}
ORDER BY ORDINAL_POSITION`;

  const result = runReadOnlyDb2Query({
    dbConfig,
    query,
    maxRows: 500,
    runtime,
  });

  const columns = (result.rows || []).map((row) => ({
    name: String(normalizeRowValue(row, 'COLUMN_NAME', 'column_name') || '').trim().toUpperCase(),
    type: String(normalizeRowValue(row, 'DATA_TYPE', 'data_type') || '').trim().toUpperCase(),
    length: Number(normalizeRowValue(row, 'LENGTH', 'length') || 0),
    scale: Number(normalizeRowValue(row, 'NUMERIC_SCALE', 'numeric_scale') || 0),
    nullable: String(normalizeRowValue(row, 'IS_NULLABLE', 'is_nullable') || '').trim().toUpperCase() === 'YES',
    ordinal: Number(normalizeRowValue(row, 'ORDINAL_POSITION', 'ordinal_position') || 0),
  }));

  return {
    columns,
    table: {
      schema: resolvedSchema,
      sqlTableName: resolvedSqlTableName,
    },
    count: columns.length,
  };
}

function buildResolveObjectsQuery({ name, schema, includeSystemTableName = true }) {
  const resolvedName = validateSqlIdentifier(name, '--table');
  const whereClauses = [
    includeSystemTableName
      ? `(SYSTEM_TABLE_NAME = ${escapeSqlLiteral(resolvedName)} OR TABLE_NAME = ${escapeSqlLiteral(resolvedName)})`
      : `TABLE_NAME = ${escapeSqlLiteral(resolvedName)}`,
  ];

  if (schema) {
    whereClauses.push(`TABLE_SCHEMA = ${escapeSqlLiteral(validateSqlIdentifier(schema, '--schema'))}`);
  }

  const selectedColumns = includeSystemTableName
    ? 'SYSTEM_TABLE_NAME, TABLE_NAME AS SQL_TABLE_NAME, TABLE_SCHEMA, TABLE_TYPE'
    : 'TABLE_NAME AS SQL_TABLE_NAME, TABLE_SCHEMA, TABLE_TYPE';

  return `SELECT ${selectedColumns}
FROM QSYS2.SYSTABLES
WHERE ${whereClauses.join(' AND ')}
ORDER BY TABLE_SCHEMA, TABLE_NAME`;
}

function normalizeRequiredColumns(columns = []) {
  return Array.from(new Set((columns || []).map((column) => validateSqlIdentifier(column, '--require-column'))));
}

function buildResolveObjectDiagnostics({
  catalogResult,
  elapsedMs,
  normalizedSchema,
  objects,
}) {
  const schemas = Array.from(new Set(
    (objects || [])
      .map((entry) => String(entry && entry.schema ? entry.schema : '').trim().toUpperCase())
      .filter(Boolean),
  ));
  const meta = catalogResult && catalogResult.meta ? catalogResult.meta : {};
  const recommendations = [];

  if (!normalizedSchema) {
    recommendations.push('Schema-free resolution searches across visible schemas and can be slower on shared systems.');
    if (schemas.length === 1) {
      recommendations.push(`Use --schema ${schemas[0]} for faster follow-up checks.`);
    } else {
      recommendations.push('Use --schema <LIB> to reduce search scope when the target library is known.');
    }
  }

  if (meta.usedVariant && meta.usedVariant !== 'primary') {
    recommendations.push('A catalog fallback query variant was used because some QSYS2 columns were unavailable.');
  }

  return {
    elapsedMs,
    schemaProvided: Boolean(normalizedSchema),
    schemaFilter: normalizedSchema,
    searchMode: normalizedSchema ? 'schema-bound' : 'schema-discovery',
    scope: normalizedSchema ? 'single-schema' : 'all-visible-schemas',
    attemptCount: Number(meta.attemptCount || 1),
    catalogVariant: meta.usedVariant || 'primary',
    fallbackUsed: Boolean(meta.usedVariant && meta.usedVariant !== 'primary'),
    recommendations,
  };
}

function resolveObjectsByName(
  dbConfig,
  tableNameOrAlias,
  {
    schema = null,
    requireColumns = [],
    includeRowCount = false,
    runtime = {},
  } = {},
) {
  const startedAt = Date.now();
  const normalizedName = validateSqlIdentifier(tableNameOrAlias, '--table');
  const normalizedSchema = schema ? validateSqlIdentifier(schema, '--schema') : null;
  const requiredColumns = normalizeRequiredColumns(requireColumns);

  const result = executeReadOnlyDb2QueryWithFallback({
    dbConfig,
    query: buildResolveObjectsQuery({
      name: normalizedName,
      schema: normalizedSchema,
      includeSystemTableName: true,
    }),
    maxRows: 100,
    runtime,
    degradedMode: 'empty',
    retryHandlers: {
      '42703': () => ({
        name: 'without-system-table-name',
        query: buildResolveObjectsQuery({
          name: normalizedName,
          schema: normalizedSchema,
          includeSystemTableName: false,
        }),
      }),
    },
  });

  const objects = (result.rows || []).map((row) => {
    const normalized = normalizeTableRow(row);
    let columnInfo = null;
    let rowCount = null;
    let rowCountError = '';

    if (requiredColumns.length > 0) {
      columnInfo = resolveColumnsWithName(dbConfig, normalized.schema, normalized.sqlName, runtime);
    }

    if (includeRowCount) {
      try {
        const rowCountResult = runReadOnlyDb2Query({
          dbConfig,
          query: `SELECT COUNT(*) AS ROW_COUNT FROM ${normalized.schema}.${normalized.sqlName}`,
          maxRows: 1,
          runtime: {
            ...runtime,
            scopeLabel: 'DB2 resolve-object row-count connection',
          },
        });
        const row = (rowCountResult.rows || [])[0];
        rowCount = row ? Number(row.ROW_COUNT || row.row_count || Object.values(row)[0] || 0) : 0;
      } catch (error) {
        rowCountError = String(error.message || error);
      }
    }

    const availableColumns = columnInfo ? columnInfo.columns.map((column) => column.name) : [];
    const missingRequiredColumns = requiredColumns.filter((column) => !availableColumns.includes(column));

    return {
      ...normalized,
      requiredColumns,
      availableColumns,
      missingRequiredColumns,
      allRequiredColumnsPresent: missingRequiredColumns.length === 0,
      rowCount,
      rowCountError,
    };
  });

  const diagnostics = buildResolveObjectDiagnostics({
    catalogResult: result,
    elapsedMs: Date.now() - startedAt,
    normalizedSchema,
    objects,
  });

  return {
    searched: {
      tableNameOrAlias: normalizedName,
      schema: normalizedSchema,
      requireColumns: requiredColumns,
      includeRowCount: Boolean(includeRowCount),
    },
    found: objects.length > 0,
    objects,
    count: objects.length,
    diagnostics,
  };
}

module.exports = {
  buildResolveObjectDiagnostics,
  listTablesInSchema,
  resolveObjectsByName,
  resolveColumnsWithName,
  resolveTableNameBothDirections,
};
