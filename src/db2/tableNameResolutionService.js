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
  return {
    systemName: String(normalizeRowValue(row, 'SYSTEM_TABLE_NAME', 'system_table_name') || '').trim().toUpperCase(),
    sqlName: String(normalizeRowValue(row, 'SQL_TABLE_NAME', 'sql_table_name', 'TABLE_NAME', 'table_name') || '').trim().toUpperCase(),
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

  const result = runReadOnlyDb2Query({
    dbConfig,
    query,
    maxRows: 1,
    runtime,
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
    systemName: normalized.systemName,
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

  const result = runReadOnlyDb2Query({
    dbConfig,
    query,
    maxRows: 500,
    runtime,
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

module.exports = {
  listTablesInSchema,
  resolveColumnsWithName,
  resolveTableNameBothDirections,
};
