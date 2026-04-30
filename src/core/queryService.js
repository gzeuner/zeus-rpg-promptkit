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
const { resolveAnalyzeConfig, resolveAnalyzeDbConfig } = require('../config/runtimeConfig');
const { isDbConfigured } = require('../db2/db2Config');
const {
  escapeSqlLiteral,
  executeReadOnlyDb2QueryWithFallback,
  runReadOnlyDb2Query,
  validateReadOnlySql,
  validateSqlIdentifier,
} = require('../db2/readOnlyQueryService');
const { discoverSchema } = require('../db2/schemaDiscovery');

const DEFAULT_MAX_ROWS = 200;

function validateFilterPattern(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) {
    return '';
  }
  if (!/^[A-Z0-9_%$#@]+$/.test(normalized)) {
    throw new Error(`Invalid --filter pattern: ${value}`);
  }
  return normalized;
}

function buildQueryTableQueries({ schema, table, filter }) {
  const whereClauses = [`TABLE_NAME = ${escapeSqlLiteral(table)}`];
  const columnClauses = [`TABLE_NAME = ${escapeSqlLiteral(table)}`];

  if (schema) {
    whereClauses.push(`TABLE_SCHEMA = ${escapeSqlLiteral(schema)}`);
    columnClauses.push(`TABLE_SCHEMA = ${escapeSqlLiteral(schema)}`);
  }

  if (filter) {
    columnClauses.push(`COLUMN_NAME LIKE ${escapeSqlLiteral(filter)}`);
  }

  return {
    tableInfo: `SELECT TABLE_SCHEMA, TABLE_NAME
FROM QSYS2.SYSTABLES
WHERE ${whereClauses.join(' AND ')}
ORDER BY TABLE_SCHEMA, TABLE_NAME`,
    columns: `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, IS_NULLABLE
FROM QSYS2.SYSCOLUMNS
WHERE ${columnClauses.join(' AND ')}
ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`,
  };
}

function parseMaxRows(value) {
  if (value === undefined || value === null || value === true) {
    return DEFAULT_MAX_ROWS;
  }
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Invalid option: --max-rows must be a positive integer');
  }
  return parsed;
}

function normalizeOutput(value) {
  const normalized = String(value || 'table').trim().toLowerCase();
  if (normalized === 'table' || normalized === 'csv') {
    return normalized;
  }
  throw new Error('Invalid option: --output must be one of: table, csv');
}

function toRowMatrix(columns, rows) {
  return (rows || []).map((row) => (columns || []).map((column) => (row && typeof row === 'object' ? row[column] : '')));
}

function requireDbConfig(config) {
  const metadataDb = resolveAnalyzeDbConfig(config, 'metadata');
  if (!isDbConfigured(metadataDb)) {
    const error = new Error('DB2 connection configuration is incomplete for the selected profile.');
    error.code = 'DB2_CONFIG_INCOMPLETE';
    throw error;
  }
  return metadataDb;
}

function executeQueryTable(args, { cwd = process.cwd() } = {}) {
  if (!args.profile || !String(args.profile).trim()) {
    const error = new Error('Missing required option: --profile <name>');
    error.code = 'PROFILE_REQUIRED';
    throw error;
  }
  if (!args.table || !String(args.table).trim()) {
    const error = new Error('Missing required option: --table <name>');
    error.code = 'TABLE_REQUIRED';
    throw error;
  }

  const config = resolveAnalyzeConfig(args, { cwd });
  const dbConfig = requireDbConfig(config);

  const table = validateSqlIdentifier(args.table, '--table');
  const schema = args.schema ? validateSqlIdentifier(args.schema, '--schema') : null;
  const filter = args.filter ? validateFilterPattern(args.filter) : '';
  const discovered = !schema ? discoverSchema(dbConfig, table) : null;
  const effectiveSchema = schema || (discovered && discovered.TABLE_SCHEMA ? String(discovered.TABLE_SCHEMA).trim().toUpperCase() : '');
  const queries = buildQueryTableQueries({ schema: effectiveSchema, table, filter });
  const tableInfo = executeReadOnlyDb2QueryWithFallback({
    dbConfig,
    query: queries.tableInfo,
    maxRows: 50,
    context: {
      table,
      schema: effectiveSchema,
    },
    retryHandlers: {
      SQL0204: ({ context }) => {
        const fallbackSchema = discoverSchema(dbConfig, context.table);
        if (!fallbackSchema || !fallbackSchema.TABLE_SCHEMA) {
          return null;
        }
        return {
          query: buildQueryTableQueries({
            schema: String(fallbackSchema.TABLE_SCHEMA).trim().toUpperCase(),
            table: context.table,
            filter,
          }).tableInfo,
        };
      },
    },
  });
  const columns = executeReadOnlyDb2QueryWithFallback({
    dbConfig,
    query: queries.columns,
    maxRows: 500,
    context: {
      table,
      schema: effectiveSchema,
      filter,
    },
    retryHandlers: {
      SQL0204: ({ context }) => {
        const fallbackSchema = discoverSchema(dbConfig, context.table);
        if (!fallbackSchema || !fallbackSchema.TABLE_SCHEMA) {
          return null;
        }
        return {
          query: buildQueryTableQueries({
            schema: String(fallbackSchema.TABLE_SCHEMA).trim().toUpperCase(),
            table: context.table,
            filter: context.filter,
          }).columns,
        };
      },
    },
  });

  return {
    config,
    table,
    schema: effectiveSchema,
    requestedSchema: schema,
    filter,
    discoveredSchema: !schema && effectiveSchema ? effectiveSchema : '',
    tableInfo,
    columns,
    dbConfig,
  };
}

function executeQuerySql(args, { cwd = process.cwd() } = {}) {
  if (!args.profile || !String(args.profile).trim()) {
    const error = new Error('Missing required option: --profile <name>');
    error.code = 'PROFILE_REQUIRED';
    throw error;
  }
  if (!args.sql || !String(args.sql).trim()) {
    const error = new Error('Missing required option: --sql "SELECT ..."');
    error.code = 'SQL_REQUIRED';
    throw error;
  }

  const sql = String(args.sql).trim();
  const maxRows = parseMaxRows(args['max-rows']);
  const output = normalizeOutput(args.output);
  const config = resolveAnalyzeConfig(args, { cwd });
  const dbConfig = requireDbConfig(config);

  validateReadOnlySql(sql);
  const result = runReadOnlyDb2Query({
    dbConfig,
    query: sql,
    maxRows,
  });
  const columns = Array.isArray(result.columns) ? result.columns : [];

  return {
    config,
    sql,
    maxRows,
    output,
    dbConfig,
    columns,
    rows: result.rows || [],
    rowCount: Number(result.rowCount || (result.rows || []).length || 0),
    matrix: toRowMatrix(columns, result.rows),
  };
}

module.exports = {
  DEFAULT_MAX_ROWS,
  buildQueryTableQueries,
  executeQuerySql,
  executeQueryTable,
  normalizeOutput,
  parseMaxRows,
  toRowMatrix,
  validateFilterPattern,
};
