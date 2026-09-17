'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  executeDescribeJdbcTable,
  executeQuerySql,
  parseJdbcTableReference,
} = require('../src/core/queryService');
const {
  executeReadOnlyJdbcQueriesRaw,
  runReadOnlyJdbcQueries,
  validateJdbcConnectionConfig,
  validateJdbcUrl,
} = require('../src/jdbc/readOnlyJdbcQueryService');
const { SECRET_ENV_SENTINEL, buildJavaClassArgs } = require('../src/java/javaRuntime');
const { resolveJdbcConnection } = require('../src/config/runtimeConfig');

const ROOT = path.resolve(__dirname, '..');
const jdbcConfig = {
  driver: 'com.example.readonly.Driver',
  url: 'jdbc:example://reporting.invalid/database',
  user: 'readonly-user',
  password: 'do-not-leak',
};

test('named JDBC connections resolve case-insensitively without accepting URL credentials', () => {
  const selected = resolveJdbcConnection(
    { jdbcConnections: { Reporting: jdbcConfig } },
    'reporting'
  );
  assert.equal(selected.name, 'Reporting');
  assert.equal(selected.config, jdbcConfig);
  assert.throws(() => validateJdbcUrl('jdbc:example://host/db;password=unsafe'), /credentials/);
  assert.throws(
    () => validateJdbcConnectionConfig({ ...jdbcConfig, driver: 'not-a-class' }),
    /fully qualified/
  );
});

test('generic JDBC execution keeps the password out of Java arguments', () => {
  let captured;
  const result = executeReadOnlyJdbcQueriesRaw({
    jdbcConfig,
    queries: ['SELECT 1 AS A', 'SELECT 2 AS B'],
    maxRows: 5,
    runtime: {
      runJavaHelper(className, args, options) {
        captured = { className, args, options };
        return {
          status: 0,
          stdout: JSON.stringify({
            statementCount: 2,
            statements: [
              { columns: ['A'], rows: [{ A: 1 }], rowCount: 1 },
              { columns: ['B'], rows: [{ B: 2 }], rowCount: 1 },
            ],
          }),
          stderr: '',
        };
      },
    },
  });

  assert.equal(captured.className, 'JdbcDiagnosticQueryRunner');
  assert.equal(captured.args[0], jdbcConfig.driver);
  assert.ok(captured.args.includes(SECRET_ENV_SENTINEL));
  assert.equal(captured.args.includes(jdbcConfig.password), false);
  assert.equal(captured.options.password, jdbcConfig.password);
  assert.equal(result.statementCount, 2);
  assert.deepEqual(result.statements[1].rows, [{ B: 2 }]);
});

test('external JDBC statements are validated before Java execution', () => {
  let invoked = false;
  assert.throws(
    () =>
      runReadOnlyJdbcQueries({
        jdbcConfig,
        queries: ['SELECT 1', 'DELETE FROM sensitive_table'],
        runtime: {
          skipConnectionGuard: true,
          runJavaHelper() {
            invoked = true;
          },
        },
      }),
    /SELECT or WITH|non-read-only/
  );
  assert.equal(invoked, false);
});

test('query-sql routes to named JDBC connections and rejects DB2-only overrides', () => {
  const env = {
    ZEUS_JDBC_REPORTING_DRIVER: jdbcConfig.driver,
    ZEUS_JDBC_REPORTING_URL: jdbcConfig.url,
    ZEUS_JDBC_REPORTING_USER: jdbcConfig.user,
    ZEUS_JDBC_REPORTING_PASSWORD: jdbcConfig.password,
  };
  const runJdbcQueries = ({ queries }) => ({
    statementCount: queries.length,
    statements: queries.map(sql => ({ sql, columns: ['A'], rows: [{ A: 1 }], rowCount: 1 })),
  });

  const execution = executeQuerySql(
    { profile: 'external-readonly', connection: 'REPORTING', sql: 'SELECT 1 AS A' },
    { cwd: ROOT, env, runJdbcQueries }
  );
  assert.equal(execution.databaseKind, 'jdbc');
  assert.equal(execution.connection, 'reporting');
  assert.deepEqual(execution.rows, [{ A: 1 }]);

  assert.throws(
    () =>
      executeQuerySql(
        {
          profile: 'external-readonly',
          connection: 'reporting',
          sql: 'SELECT 1',
          'default-schema': 'REPORTING',
        },
        { cwd: ROOT, env, runJdbcQueries }
      ),
    /DB2-only/
  );
});

test('external table description requires a qualified safe identifier', () => {
  assert.deepEqual(parseJdbcTableReference({ table: 'appdata.orders' }), {
    schema: 'APPDATA',
    table: 'ORDERS',
  });
  assert.throws(() => parseJdbcTableReference({ table: 'orders' }), /qualified/);
  assert.throws(() => parseJdbcTableReference({ table: 'APPDATA.orders;DROP' }), /Invalid/);

  let captured;
  const result = executeDescribeJdbcTable(
    { profile: 'external-readonly', connection: 'reporting', table: 'appdata.orders' },
    {
      cwd: ROOT,
      env: {
        ZEUS_JDBC_REPORTING_DRIVER: jdbcConfig.driver,
        ZEUS_JDBC_REPORTING_URL: jdbcConfig.url,
        ZEUS_JDBC_REPORTING_USER: jdbcConfig.user,
        ZEUS_JDBC_REPORTING_PASSWORD: jdbcConfig.password,
      },
      runJdbcQueries({ queries }) {
        captured = queries;
        return {
          statements: [
            {
              columns: ['COLUMN_NAME'],
              rows: [{ COLUMN_NAME: 'ID' }],
              rowCount: 1,
            },
          ],
        };
      },
    }
  );
  assert.equal(result.schema, 'APPDATA');
  assert.match(captured[0], /INFORMATION_SCHEMA\.COLUMNS/);
  assert.equal(result.columns.rows[0].COLUMN_NAME, 'ID');
});

test('Java helpers force UTF-8 output encoding', () => {
  const args = buildJavaClassArgs('JdbcDiagnosticQueryRunner', ['driver'], { cwd: ROOT });
  assert.equal(args[0], '-Dfile.encoding=UTF-8');
});
