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
const fs = require('fs');
const path = require('path');
const {
  loadProfiles,
  resolveAnalyzeConfig,
  resolveAnalyzeDbConfig,
  resolveJdbcConnection,
  resolveProfile,
} = require('../config/runtimeConfig');
const { isDbConfigured } = require('../db2/db2Config');
const {
  escapeSqlLiteral,
  executeReadOnlyDb2QueryWithFallback,
  runReadOnlyDb2Query,
  runReadOnlyDb2Queries,
  validateReadOnlySql,
  validateSqlIdentifier,
} = require('../db2/readOnlyQueryService');
const { normalizeSqlStatements } = require('../db2/sqlBatch');
const { discoverSchema } = require('../db2/schemaDiscovery');
const { runReadOnlyJdbcQueries } = require('../jdbc/readOnlyJdbcQueryService');

const DEFAULT_MAX_ROWS = 200;

function normalizeLibraryList(value) {
  if (value === undefined || value === null || value === false) {
    return [];
  }

  const entries = Array.isArray(value)
    ? value
    : String(value)
        .split(/[\s,]+/)
        .filter(Boolean);

  return Array.from(new Set(entries.map(entry => validateSqlIdentifier(entry, '--liblist'))));
}

function validateFilterPattern(value) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase();
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

function buildJdbcDescribeTableQueries({ schema, table, includeRowCount = false }) {
  const whereClause = [
    `TABLE_SCHEMA = ${escapeSqlLiteral(schema)}`,
    `TABLE_NAME = ${escapeSqlLiteral(table)}`,
  ].join(' AND ');
  return {
    columns: `SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE, ORDINAL_POSITION
FROM INFORMATION_SCHEMA.COLUMNS
WHERE ${whereClause}
ORDER BY ORDINAL_POSITION`,
    rowCount: includeRowCount ? `SELECT COUNT(*) AS ROW_COUNT FROM ${schema}.${table}` : null,
  };
}

function isOptionEnabled(value) {
  return (
    value === true ||
    ['true', '1', 'yes', 'on'].includes(
      String(value || '')
        .trim()
        .toLowerCase()
    )
  );
}

function parseJdbcTableReference({ table: tableValue, schema: schemaValue } = {}) {
  const rawTable = String(tableValue || '').trim();
  if (!rawTable) throw new Error('Missing required option: --table <schema.table>');

  const explicitSchema = String(schemaValue || '').trim();
  if (explicitSchema) {
    if (rawTable.includes('.')) {
      throw new Error(
        'Use either --table <schema.table> or --schema <schema> --table <table>, not both.'
      );
    }
    return {
      schema: validateSqlIdentifier(explicitSchema, '--schema'),
      table: validateSqlIdentifier(rawTable, '--table'),
    };
  }

  const parts = rawTable.split('.').map(part => part.trim());
  if (parts.length !== 2 || parts.some(part => !part)) {
    throw new Error('JDBC table must be qualified as --table <schema.table>.');
  }
  return {
    schema: validateSqlIdentifier(parts[0], '--table schema'),
    table: validateSqlIdentifier(parts[1], '--table'),
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
  const normalized = String(value || 'table')
    .trim()
    .toLowerCase();
  if (normalized === 'table' || normalized === 'csv' || normalized === 'json') {
    return normalized;
  }
  throw new Error('Invalid option: --output must be one of: table, csv, json');
}

function validateDefaultSchema(value) {
  if (!value) return null;
  return validateSqlIdentifier(String(value).trim(), '--default-schema');
}

function prependSchemaDirective(sql, schema) {
  if (!schema) return sql;
  return `SET CURRENT SCHEMA = '${schema}';
${sql}`;
}

function toRowMatrix(columns, rows) {
  return (rows || []).map(row =>
    (columns || []).map(column => (row && typeof row === 'object' ? row[column] : ''))
  );
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
  // On IBM i a library is the SQL schema; accept --library as an alias for --schema
  // so the override vocabulary stays consistent with `fetch` and `analyze`.
  const schemaArg = args.schema || args.library;
  const schema = schemaArg ? validateSqlIdentifier(schemaArg, '--schema') : null;
  const filter = args.filter ? validateFilterPattern(args.filter) : '';
  const discovered = !schema ? discoverSchema(dbConfig, table) : null;
  const effectiveSchema =
    schema ||
    (discovered && discovered.TABLE_SCHEMA
      ? String(discovered.TABLE_SCHEMA).trim().toUpperCase()
      : '');
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

function executeDescribeJdbcTable(
  args,
  { cwd = process.cwd(), env = process.env, runJdbcQueries = runReadOnlyJdbcQueries } = {}
) {
  if (!args.profile || !String(args.profile).trim()) {
    const error = new Error('Missing required option: --profile <name>');
    error.code = 'PROFILE_REQUIRED';
    throw error;
  }
  if (!args.connection || !String(args.connection).trim()) {
    const error = new Error('Missing required option: --connection <name>');
    error.code = 'JDBC_CONNECTION_REQUIRED';
    throw error;
  }

  const { schema, table } = parseJdbcTableReference({
    table: args.table,
    schema: args.schema,
  });
  const profiles = loadProfiles({ cwd, env, args });
  const profile = resolveProfile(profiles, args.profile, { env });
  const selectedConnection = resolveJdbcConnection(profile, args.connection);
  const includeRowCount = isOptionEnabled(args['include-row-count']);
  const queries = buildJdbcDescribeTableQueries({ schema, table, includeRowCount });
  const statementQueries = [queries.columns, ...(queries.rowCount ? [queries.rowCount] : [])];
  const result = runJdbcQueries({
    jdbcConfig: selectedConnection.config,
    queries: statementQueries,
    maxRows: includeRowCount ? 1 : 500,
  });
  const statements = Array.isArray(result.statements) ? result.statements : [];
  const rowCountResult = statements[1] || null;
  const rowCountRow =
    rowCountResult && Array.isArray(rowCountResult.rows) ? rowCountResult.rows[0] : null;

  return {
    connection: selectedConnection.name,
    schema,
    table,
    columns: statements[0] || { columns: [], rows: [], rowCount: 0 },
    includeRowCount,
    tableRowCount:
      rowCountRow && typeof rowCountRow === 'object'
        ? (rowCountRow.ROW_COUNT ?? rowCountRow.row_count ?? Object.values(rowCountRow)[0] ?? null)
        : null,
  };
}

function resolveQuerySqlText(args, { cwd = process.cwd() } = {}) {
  if (args.file && String(args.file).trim()) {
    const filePath = path.resolve(cwd, String(args.file).trim());
    try {
      return fs.readFileSync(filePath, 'utf8').trim();
    } catch (err) {
      const error = new Error(`Cannot read SQL file: ${filePath} — ${err.message}`);
      error.code = 'SQL_FILE_NOT_FOUND';
      throw error;
    }
  }
  if (args.sql && String(args.sql).trim()) {
    return String(args.sql).trim();
  }
  const error = new Error('Missing required option: --sql "SELECT ..." or --file <path>');
  error.code = 'SQL_REQUIRED';
  throw error;
}

function executeQuerySql(
  args,
  { cwd = process.cwd(), env = process.env, runJdbcQueries = runReadOnlyJdbcQueries } = {}
) {
  if (!args.profile || !String(args.profile).trim()) {
    const error = new Error('Missing required option: --profile <name>');
    error.code = 'PROFILE_REQUIRED';
    throw error;
  }

  const sqlText = resolveQuerySqlText(args, { cwd });
  const maxRows = parseMaxRows(args['max-rows']);
  const output = normalizeOutput(args.output);
  const statements = normalizeSqlStatements({ sql: sqlText });
  if (statements.length === 0) {
    throw new Error('Read-only SQL query is empty.');
  }
  statements.forEach(validateReadOnlySql);

  const connectionName = String(args.connection || '').trim();
  if (connectionName) {
    if (args['default-schema'] || args.liblist) {
      const error = new Error(
        '--default-schema and --liblist are DB2-only options; qualify JDBC table names in SQL instead.'
      );
      error.code = 'JDBC_OPTION_UNSUPPORTED';
      throw error;
    }
    const profiles = loadProfiles({ cwd, env, args });
    const profile = resolveProfile(profiles, args.profile, { env });
    const selectedConnection = resolveJdbcConnection(profile, connectionName);
    const batchResult = runJdbcQueries({
      jdbcConfig: selectedConnection.config,
      queries: statements,
      maxRows,
    });
    const result = batchResult.statements[0] || { columns: [], rows: [], rowCount: 0 };
    const columns = Array.isArray(result.columns) ? result.columns : [];
    return {
      config: null,
      connection: selectedConnection.name,
      databaseKind: 'jdbc',
      sql: statements[0],
      statements: batchResult.statements,
      statementCount: Number(
        batchResult.statementCount || batchResult.statements.length || statements.length
      ),
      batch: statements.length > 1,
      defaultSchema: null,
      libraryList: [],
      maxRows,
      output,
      wide: isOptionEnabled(args.wide),
      dbConfig: null,
      columns,
      rows: result.rows || [],
      rowCount: Number(result.rowCount || (result.rows || []).length || 0),
      matrix: toRowMatrix(columns, result.rows),
    };
  }

  const defaultSchema = validateDefaultSchema(args['default-schema']);
  const libraryList = normalizeLibraryList(args.liblist);
  const config = resolveAnalyzeConfig(args, { cwd, env });
  const dbConfig = requireDbConfig(config);
  const effectiveDbConfig = {
    ...dbConfig,
    ...(defaultSchema ? { defaultSchema } : {}),
    ...(libraryList.length > 0 ? { libraryList: libraryList.join(',') } : {}),
  };

  const batchResult = runReadOnlyDb2Queries({
    dbConfig: effectiveDbConfig,
    queries: statements,
    maxRows,
  });
  const result = batchResult.statements[0] || { columns: [], rows: [], rowCount: 0 };
  const columns = Array.isArray(result.columns) ? result.columns : [];

  return {
    config,
    sql: statements[0],
    statements: batchResult.statements,
    statementCount: Number(
      batchResult.statementCount || batchResult.statements.length || statements.length
    ),
    batch: statements.length > 1,
    defaultSchema,
    libraryList,
    maxRows,
    output,
    wide: isOptionEnabled(args.wide),
    dbConfig: effectiveDbConfig,
    columns,
    rows: result.rows || [],
    rowCount: Number(result.rowCount || (result.rows || []).length || 0),
    matrix: toRowMatrix(columns, result.rows),
  };
}

module.exports = {
  DEFAULT_MAX_ROWS,
  buildQueryTableQueries,
  buildJdbcDescribeTableQueries,
  executeDescribeJdbcTable,
  executeQuerySql,
  executeQueryTable,
  isOptionEnabled,
  normalizeOutput,
  parseMaxRows,
  prependSchemaDirective,
  resolveQuerySqlText,
  toRowMatrix,
  normalizeLibraryList,
  validateDefaultSchema,
  validateFilterPattern,
  parseJdbcTableReference,
};
