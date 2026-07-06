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
const { buildJdbcUrl, resolveDefaultSchema, isDbConfigured } = require('./db2Config');
const { runJavaHelper } = require('../fetch/jt400CommandRunner');
const { SECRET_ENV_SENTINEL } = require('../java/javaRuntime');
const {
  executeWithAdaptiveRetry,
  normalizeSqlState,
} = require('./adaptiveQueryService');
const { ensureDb2ConnectionGuard } = require('../security/connectionGuards');

const SQL_IDENTIFIER_PATTERN = /^[A-Z][A-Z0-9_#$@]*$/;
const FORBIDDEN_SQL_PATTERN = /\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|CREATE|TRUNCATE|CALL|GRANT|REVOKE)\b/i;

function stripSqlComments(sql) {
  // Entfernt einzeilige Kommentare (-- ...) und mehrzeilige (/* ... */)
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\r\n]*/g, '')
    .trim();
}

function validateReadOnlySql(query) {
  const normalized = stripSqlComments(String(query || '').trim());
  if (!normalized) {
    throw new Error('Read-only SQL query is empty.');
  }
  if (!/^(SELECT|WITH)\b/i.test(normalized)) {
    throw new Error('Read-only SQL query must start with SELECT or WITH.');
  }
  if (FORBIDDEN_SQL_PATTERN.test(normalized)) {
    throw new Error('Read-only SQL query contains a non-read-only keyword.');
  }
}

function parseReadOnlyQueryResult(stdout) {
  const content = String(stdout || '').trim();
  if (!content) {
    return {
      columns: [],
      rows: [],
      rowCount: 0,
    };
  }
  return JSON.parse(content);
}

function extractSqlState(error) {
  const text = String(error && error.message ? error.message : error || '');
  const match = text.match(/\b(SQL\d{4}|SQLSTATE\s*[=:]?\s*([0-9A-Z]{5}))\b/i);
  if (!match) {
    return '';
  }
  if (match[2]) {
    return String(match[2]).toUpperCase();
  }
  return String(match[1]).toUpperCase();
}

function validateSqlIdentifier(value, label) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) {
    throw new Error(`Missing required option: ${label}`);
  }
  if (!SQL_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return normalized;
}

function escapeSqlLiteral(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function executeReadOnlyDb2QueryRaw({ dbConfig, query, maxRows = 50, runtime = {} }) {
  const runJavaHelperFn = runtime.runJavaHelper || runJavaHelper;
  const jdbcUrl = buildJdbcUrl(dbConfig, resolveDefaultSchema(dbConfig));
  // Security: pass the password via the child-process environment (ZEUS_JV_PASSWORD),
  // not as a CLI argument. The sentinel marks the position; Java resolves it back.
  const result = runJavaHelperFn('Db2DiagnosticQueryRunner', [
    jdbcUrl,
    String(dbConfig.user),
    SECRET_ENV_SENTINEL,
    query,
    String(maxRows),
  ], { password: String(dbConfig.password) });

  if (result.status !== 0) {
    throw new Error((result.stderr || '').trim() || 'DB2 diagnostic query failed.');
  }

  return parseReadOnlyQueryResult(result.stdout);
}

function runReadOnlyDb2Query({ dbConfig, query, maxRows = 50, runtime = {} }) {
  if (!isDbConfigured(dbConfig)) {
    throw new Error('DB2 connection configuration is incomplete.');
  }

  validateReadOnlySql(query);

  if (!runtime.skipConnectionGuard) {
    ensureDb2ConnectionGuard({
      dbConfig,
      scopeLabel: runtime.scopeLabel || 'DB2 read-only connection',
      probe: ({ query: probeQuery, maxRows: probeMaxRows }) => executeReadOnlyDb2QueryRaw({
        dbConfig,
        query: probeQuery,
        maxRows: probeMaxRows,
        runtime: {
          ...runtime,
          skipConnectionGuard: true,
        },
      }),
    });
  }

  return executeReadOnlyDb2QueryRaw({ dbConfig, query, maxRows, runtime });
}

function executeReadOnlyDb2QueryWithFallback({
  dbConfig,
  query,
  maxRows = 200,
  runtime = {},
  context = {},
  retryHandlers = {},
  degradedMode = 'throw',
}) {
  const attemptOrder = [{ name: 'primary', query, maxRows }];
  const queryExecutor = (sql, attemptMaxRows = maxRows) => runReadOnlyDb2Query({
    dbConfig,
    query: sql,
    maxRows: attemptMaxRows,
    runtime,
  });

  const buildFallbackAttempts = ({ error, sqlState }) => {
    const normalizedSqlState = normalizeSqlState(sqlState || extractSqlState(error));
    const handler = retryHandlers[normalizedSqlState] || retryHandlers[sqlState];
    if (typeof handler !== 'function') {
      return [];
    }
    const fallback = handler({
      dbConfig,
      query,
      maxRows,
      runtime,
      context,
      error,
      sqlState: normalizedSqlState || sqlState,
    });
    const fallbacks = Array.isArray(fallback) ? fallback : [fallback];
    return fallbacks
      .filter((entry) => entry && typeof entry.query === 'string')
      .map((entry, index) => ({
        name: entry.name || `fallback-${normalizedSqlState || 'unknown'}-${index + 1}`,
        query: entry.query,
        maxRows: entry.maxRows || maxRows,
      }));
  };

  try {
    const result = executeWithAdaptiveRetry(
      ({ query: sql, maxRows: attemptMaxRows }) => queryExecutor(sql, attemptMaxRows),
      attemptOrder,
      {
        verbose: Boolean(context.verbose),
        onError: ({ error, sqlState, attempts }) => {
          const fallbackAttempts = buildFallbackAttempts({ error, sqlState });
          if (fallbackAttempts.length > 0) {
            attempts.push(...fallbackAttempts);
          }
        },
      },
    );
    if (!result || result.success !== true) {
      if (result && result.degradedMode && degradedMode !== 'throw') {
        return {
          columns: [],
          rows: [],
          rowCount: 0,
          degradedMode: true,
          recommendations: result.recommendations || [],
          meta: {
            degradedMode: true,
            attemptCount: Number(result.attemptCount || 0),
            usedVariant: result.usedVariant || '',
          },
        };
      }
      throw (result && result.lastError) || new Error('Read-only DB2 query failed.');
    }
    return {
      ...result.result,
      meta: {
        degradedMode: false,
        attemptCount: Number(result.attemptCount || 1),
        usedVariant: result.usedVariant || 'primary',
      },
    };
  } catch (error) {
    if (normalizeSqlState(extractSqlState(error)) === '42501' && degradedMode !== 'throw') {
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        degradedMode: true,
        recommendations: ['Metadata query skipped because the current user has no QSYS2 authority.'],
        meta: {
          degradedMode: true,
          attemptCount: 1,
          usedVariant: 'primary',
        },
      };
    }
    throw error;
  }
}

module.exports = {
  executeReadOnlyDb2QueryWithFallback,
  escapeSqlLiteral,
  extractSqlState,
  parseReadOnlyQueryResult,
  runReadOnlyDb2Query,
  executeReadOnlyDb2QueryRaw,
  SQL_IDENTIFIER_PATTERN,
  validateReadOnlySql,
  validateSqlIdentifier,
};
