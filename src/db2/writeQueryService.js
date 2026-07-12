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

const { buildJdbcUrl, isDbConfigured, resolveDefaultSchema } = require('./db2Config');
const { runJavaHelper, SECRET_ENV_SENTINEL } = require('../fetch/jt400CommandRunner');
const { ensureDb2ConnectionGuard } = require('../security/connectionGuards');
const {
  buildSqlRunnerArgs,
  normalizeSqlStatements,
  removeSqlStatementsFile,
} = require('./sqlBatch');

/**
 * Executes a single DML statement (INSERT, UPDATE, DELETE) against IBM i DB2.
 * Uses Db2WriteQueryRunner (not read-only) via the shared jt400 Java bridge.
 *
 * Returns { rowsAffected: number }.
 * Throws on SQL error or configuration problems.
 */
function parseWriteQueryResult(stdout) {
  let parsed;
  try {
    parsed = JSON.parse((stdout || '').trim());
  } catch (_) {
    throw new Error(`Db2WriteQueryRunner returned unexpected output: ${stdout}`);
  }
  return parsed;
}

function normalizeWriteBatchResult(parsed, statements) {
  if (Array.isArray(parsed.results)) {
    return {
      rowsAffected: Number(parsed.rowsAffected || 0),
      statementCount: Number(parsed.statementCount || parsed.results.length),
      results: parsed.results.map((entry, index) => ({
        sql: entry.sql || statements[index] || '',
        rowsAffected: Number(entry.rowsAffected || 0),
      })),
    };
  }
  return {
    rowsAffected: Number(parsed.rowsAffected),
    statementCount: 1,
    results: [
      {
        sql: statements[0] || '',
        rowsAffected: Number(parsed.rowsAffected),
      },
    ],
  };
}

function executeWriteDb2QueryRaw({ dbConfig, sql, runtime = {} }) {
  const batch = executeWriteDb2QueriesRaw({
    dbConfig,
    statements: normalizeSqlStatements({ sql }),
    runtime,
  });
  return {
    rowsAffected: batch.rowsAffected,
    statementCount: batch.statementCount,
    results: batch.results,
  };
}

function executeWriteDb2QueriesRaw({ dbConfig, statements, runtime = {} }) {
  const normalizedStatements = normalizeSqlStatements({ statements });
  if (normalizedStatements.length === 0) {
    throw new Error('Write SQL statement is empty.');
  }
  const runJavaHelperFn = runtime.runJavaHelper || runJavaHelper;
  const jdbcUrl = buildJdbcUrl(dbConfig, resolveDefaultSchema(dbConfig));
  const { args, statementFile } = buildSqlRunnerArgs({
    jdbcUrl,
    user: String(dbConfig.user),
    passwordSentinel: SECRET_ENV_SENTINEL,
    statements: normalizedStatements,
    runtime,
  });
  let result;
  try {
    result = runJavaHelperFn('Db2WriteQueryRunner', args, { password: String(dbConfig.password) });
  } finally {
    removeSqlStatementsFile(statementFile);
  }

  if (result.status !== 0) {
    throw new Error((result.stderr || '').trim() || 'DB2 write query failed.');
  }

  return normalizeWriteBatchResult(parseWriteQueryResult(result.stdout), normalizedStatements);
}

function runWriteDb2Query({ dbConfig, sql, runtime = {} }) {
  return runWriteDb2Queries({
    dbConfig,
    statements: normalizeSqlStatements({ sql }),
    runtime,
  });
}

function runWriteDb2Queries({ dbConfig, statements, runtime = {} }) {
  if (!isDbConfigured(dbConfig)) {
    throw new Error('DB2 connection configuration is incomplete.');
  }

  if (!runtime.skipConnectionGuard) {
    ensureDb2ConnectionGuard({
      dbConfig,
      scopeLabel: runtime.scopeLabel || 'DB2 write connection',
      probe: ({ query, maxRows }) => {
        const { executeReadOnlyDb2QueryRaw } = require('./readOnlyQueryService');
        return executeReadOnlyDb2QueryRaw({
          dbConfig,
          query,
          maxRows,
          runtime: {
            skipConnectionGuard: true,
            runJavaHelper: runtime.runJavaHelper,
          },
        });
      },
    });
  }

  return executeWriteDb2QueriesRaw({ dbConfig, statements, runtime });
}

module.exports = {
  executeWriteDb2QueriesRaw,
  executeWriteDb2QueryRaw,
  runWriteDb2Queries,
  runWriteDb2Query,
};
