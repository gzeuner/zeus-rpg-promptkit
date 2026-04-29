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
  resolveAnalyzeConfig,
} = require('../../config/runtimeConfig');
const { isDbConfigured } = require('../../db2/db2Config');
const {
  escapeSqlLiteral,
  executeReadOnlyDb2QueryWithFallback,
  validateSqlIdentifier,
} = require('../../db2/readOnlyQueryService');
const { renderAsciiTable } = require('../helpers/asciiTable');
const { discoverSchema } = require('../../db2/schemaDiscovery');

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

async function runQueryTable(args) {
  if (!args.profile || !String(args.profile).trim()) {
    console.error('Missing required option: --profile <name>');
    process.exit(2);
  }
  if (!args.table || !String(args.table).trim()) {
    console.error('Missing required option: --table <name>');
    process.exit(2);
  }

  const config = resolveAnalyzeConfig(args);
  if (!isDbConfigured(config.db)) {
    console.error('DB2 connection configuration is incomplete for the selected profile.');
    process.exit(2);
  }

  const table = validateSqlIdentifier(args.table, '--table');
  const schema = args.schema
    ? validateSqlIdentifier(args.schema, '--schema')
    : null;
  const filter = args.filter ? validateFilterPattern(args.filter) : '';
  const discovered = !schema ? discoverSchema(config.db, table) : null;
  const effectiveSchema = schema || (discovered && discovered.TABLE_SCHEMA ? String(discovered.TABLE_SCHEMA).trim().toUpperCase() : '');
  const queries = buildQueryTableQueries({ schema: effectiveSchema, table, filter });
  const tableInfo = executeReadOnlyDb2QueryWithFallback({
    dbConfig: config.db,
    query: queries.tableInfo,
    maxRows: 50,
    context: {
      table,
      schema: effectiveSchema,
    },
    retryHandlers: {
      SQL0204: ({ context }) => {
        const fallbackSchema = discoverSchema(config.db, context.table);
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
    dbConfig: config.db,
    query: queries.columns,
    maxRows: 500,
    context: {
      table,
      schema: effectiveSchema,
      filter,
    },
    retryHandlers: {
      SQL0204: ({ context }) => {
        const fallbackSchema = discoverSchema(config.db, context.table);
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

  console.log(`Table lookup: ${effectiveSchema ? `${effectiveSchema}.${table}` : table}`);
  if (!schema && effectiveSchema) {
    console.log(`Schema discovery: ${table} -> ${effectiveSchema}`);
  }
  console.log('');

  if ((tableInfo.rows || []).length === 0) {
    console.log('No matching table metadata found in QSYS2.SYSTABLES.');
  } else {
    console.log('Table Info');
    console.log(renderAsciiTable(
      ['TABLE_SCHEMA', 'TABLE_NAME'],
      tableInfo.rows.map((row) => [row.TABLE_SCHEMA, row.TABLE_NAME]),
    ));
  }

  if ((columns.rows || []).length === 0) {
    console.log('No matching column metadata found in QSYS2.SYSCOLUMNS.');
    return;
  }

  console.log('Columns');
  console.log(renderAsciiTable(
    ['TABLE_SCHEMA', 'TABLE_NAME', 'COLUMN_NAME', 'DATA_TYPE', 'LENGTH', 'NUMERIC_SCALE', 'IS_NULLABLE'],
    columns.rows.map((row) => [
      row.TABLE_SCHEMA,
      row.TABLE_NAME,
      row.COLUMN_NAME,
      row.DATA_TYPE,
      row.LENGTH,
      row.NUMERIC_SCALE,
      row.IS_NULLABLE,
    ]),
    { maxCellWidth: 40 },
  ));
}

module.exports = {
  buildQueryTableQueries,
  runQueryTable,
  validateFilterPattern,
};
