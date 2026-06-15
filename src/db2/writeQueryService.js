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
const { runJavaHelper } = require('../fetch/jt400CommandRunner');
const { ensureDb2ConnectionGuard } = require('../security/connectionGuards');

/**
 * Executes a single DML statement (INSERT, UPDATE, DELETE) against IBM i DB2.
 * Uses Db2WriteQueryRunner (not read-only) via the shared jt400 Java bridge.
 *
 * Returns { rowsAffected: number }.
 * Throws on SQL error or configuration problems.
 */
function executeWriteDb2QueryRaw({ dbConfig, sql, runtime = {} }) {
  const runJavaHelperFn = runtime.runJavaHelper || runJavaHelper;
  const jdbcUrl = buildJdbcUrl(dbConfig, resolveDefaultSchema(dbConfig));
  const result = runJavaHelperFn('Db2WriteQueryRunner', [
    jdbcUrl,
    String(dbConfig.user),
    String(dbConfig.password),
    sql,
  ]);

  if (result.status !== 0) {
    throw new Error((result.stderr || '').trim() || 'DB2 write query failed.');
  }

  let parsed;
  try {
    parsed = JSON.parse((result.stdout || '').trim());
  } catch (_) {
    throw new Error(`Db2WriteQueryRunner returned unexpected output: ${result.stdout}`);
  }

  return { rowsAffected: Number(parsed.rowsAffected) };
}

function runWriteDb2Query({ dbConfig, sql, runtime = {} }) {
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

  return executeWriteDb2QueryRaw({ dbConfig, sql, runtime });
}

module.exports = {
  executeWriteDb2QueryRaw,
  runWriteDb2Query,
};
