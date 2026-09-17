/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0
*/
'use strict';

const { runJavaHelper } = require('../fetch/jt400CommandRunner');
const { SECRET_ENV_SENTINEL } = require('../java/javaRuntime');
const {
  buildSqlRunnerArgs,
  normalizeSqlStatements,
  removeSqlStatementsFile,
} = require('../db2/sqlBatch');
const {
  normalizeReadOnlyBatchResult,
  parseReadOnlyQueryResult,
  validateReadOnlySql,
} = require('../db2/readOnlyQueryService');
const { ensureJdbcConnectionGuard } = require('../security/connectionGuards');

const DEFAULT_JDBC_PROBE_SQL = 'SELECT 1 AS HEALTHCHECK';
const JDBC_DRIVER_CLASS_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/;

function isJdbcConnectionConfigured(jdbcConfig) {
  if (!jdbcConfig || typeof jdbcConfig !== 'object') return false;
  return ['driver', 'url', 'user', 'password'].every(key =>
    Boolean(String(jdbcConfig[key] || '').trim())
  );
}

function validateJdbcDriverClass(value) {
  const driver = String(value || '').trim();
  if (!JDBC_DRIVER_CLASS_PATTERN.test(driver)) {
    throw new Error('JDBC driver must be a fully qualified Java class name.');
  }
  return driver;
}

function validateJdbcUrl(value) {
  const jdbcUrl = String(value || '').trim();
  if (!jdbcUrl || !/^jdbc:/i.test(jdbcUrl) || /[\x00-\x1F\x7F]/.test(jdbcUrl)) {
    throw new Error('JDBC URL must be a non-empty jdbc: URL without control characters.');
  }
  if (/[?;](?:user|username|password|passwd|pwd)\s*=/i.test(jdbcUrl)) {
    throw new Error(
      'JDBC URL must not contain credentials; configure user and password separately.'
    );
  }
  return jdbcUrl;
}

function getJdbcEnvironmentLoadHint(jdbcConfig) {
  const environment = String((jdbcConfig && jdbcConfig.environment) || '').trim();
  if (environment) {
    return ` Load environment variables first: . .\\config\\load-env.ps1 -Environment ${environment}.`;
  }
  return ' Load the environment file that defines this connection before retrying.';
}

function validateJdbcConnectionConfig(jdbcConfig) {
  if (!isJdbcConnectionConfigured(jdbcConfig)) {
    const error = new Error(
      `JDBC connection configuration is incomplete.${getJdbcEnvironmentLoadHint(jdbcConfig)}`
    );
    error.code = 'JDBC_CONFIG_INCOMPLETE';
    throw error;
  }

  return {
    ...jdbcConfig,
    driver: validateJdbcDriverClass(jdbcConfig.driver),
    url: validateJdbcUrl(jdbcConfig.url),
    user: String(jdbcConfig.user).trim(),
    password: String(jdbcConfig.password),
  };
}

function resolveJdbcProbeSql(jdbcConfig) {
  const probeSql = String((jdbcConfig && jdbcConfig.probeSql) || DEFAULT_JDBC_PROBE_SQL).trim();
  validateReadOnlySql(probeSql);
  return probeSql;
}

function executeReadOnlyJdbcQueriesRaw({ jdbcConfig, queries, maxRows = 50, runtime = {} }) {
  const statements = normalizeSqlStatements({ statements: queries });
  if (statements.length === 0) throw new Error('Read-only SQL query is empty.');

  const validatedConfig = validateJdbcConnectionConfig(jdbcConfig);
  const runJavaHelperFn = runtime.runJavaHelper || runJavaHelper;
  const { args: queryArgs, statementFile } = buildSqlRunnerArgs({
    jdbcUrl: validatedConfig.url,
    user: validatedConfig.user,
    passwordSentinel: SECRET_ENV_SENTINEL,
    statements,
    trailingArgs: [String(maxRows)],
    runtime,
  });
  const args = [validatedConfig.driver, ...queryArgs];

  let result;
  try {
    result = runJavaHelperFn('JdbcDiagnosticQueryRunner', args, {
      password: validatedConfig.password,
    });
  } finally {
    removeSqlStatementsFile(statementFile);
  }

  if (result.status !== 0) {
    throw new Error((result.stderr || '').trim() || 'JDBC diagnostic query failed.');
  }
  return normalizeReadOnlyBatchResult(parseReadOnlyQueryResult(result.stdout), statements);
}

function runReadOnlyJdbcQueries({ jdbcConfig, queries, maxRows = 50, runtime = {} }) {
  const validatedConfig = validateJdbcConnectionConfig(jdbcConfig);
  const statements = normalizeSqlStatements({ statements: queries });
  if (statements.length === 0) throw new Error('Read-only SQL query is empty.');
  statements.forEach(validateReadOnlySql);

  if (!runtime.skipConnectionGuard) {
    ensureJdbcConnectionGuard({
      jdbcConfig: validatedConfig,
      scopeLabel: runtime.scopeLabel || 'JDBC read-only connection',
      probeSql: resolveJdbcProbeSql(validatedConfig),
      probe: ({ query, maxRows: probeMaxRows }) =>
        executeReadOnlyJdbcQueriesRaw({
          jdbcConfig: validatedConfig,
          queries: [query],
          maxRows: probeMaxRows,
          runtime: { ...runtime, skipConnectionGuard: true },
        }),
    });
  }

  return executeReadOnlyJdbcQueriesRaw({
    jdbcConfig: validatedConfig,
    queries: statements,
    maxRows,
    runtime,
  });
}

function runReadOnlyJdbcQuery({ jdbcConfig, query, maxRows = 50, runtime = {} }) {
  const batch = runReadOnlyJdbcQueries({
    jdbcConfig,
    queries: normalizeSqlStatements({ sql: query }),
    maxRows,
    runtime,
  });
  return batch.statements[0] || { columns: [], rows: [], rowCount: 0 };
}

module.exports = {
  DEFAULT_JDBC_PROBE_SQL,
  JDBC_DRIVER_CLASS_PATTERN,
  executeReadOnlyJdbcQueriesRaw,
  getJdbcEnvironmentLoadHint,
  isJdbcConnectionConfigured,
  resolveJdbcProbeSql,
  runReadOnlyJdbcQuery,
  runReadOnlyJdbcQueries,
  validateJdbcConnectionConfig,
  validateJdbcDriverClass,
  validateJdbcUrl,
};
