const test = require('node:test');
const assert = require('node:assert/strict');

const {
  executeReadOnlyJdbcQueriesRaw,
  getJdbcEnvironmentLoadHint,
  runReadOnlyJdbcQueries,
  validateJdbcConnectionConfig,
  validateJdbcUrl,
} = require('../src/jdbc/readOnlyJdbcQueryService');
const { SECRET_ENV_SENTINEL } = require('../src/java/javaRuntime');

const jdbcConfig = {
  driver: 'net.sourceforge.jtds.jdbc.Driver',
  url: 'jdbc:jtds:sqlserver://rol-evodb.example:1433/ROL',
  user: 'appmodule',
  password: 'top-secret-pw',
};

test('generic JDBC batches preserve secret-safe Java runner arguments', () => {
  let capturedClassName = null;
  let capturedArgs = null;
  let capturedOptions = null;
  const result = executeReadOnlyJdbcQueriesRaw({
    jdbcConfig,
    queries: ['SELECT 1 AS A', 'SELECT 2 AS B'],
    maxRows: 5,
    runtime: {
      timeoutMs: 1200,
      runJavaHelper(className, args, options) {
        capturedClassName = className;
        capturedArgs = args;
        capturedOptions = options;
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

  assert.equal(capturedClassName, 'JdbcDiagnosticQueryRunner');
  assert.equal(capturedArgs[0], jdbcConfig.driver);
  assert.equal(capturedArgs[3], SECRET_ENV_SENTINEL);
  assert.ok(!capturedArgs.includes(jdbcConfig.password));
  assert.equal(capturedOptions.password, jdbcConfig.password);
  assert.equal(capturedOptions.timeout, 1200);
  assert.equal(result.statementCount, 2);
  assert.deepEqual(result.statements[1].rows, [{ B: 2 }]);
});

test('generic JDBC queries reject non-read-only SQL before reaching Java', () => {
  assert.throws(
    () =>
      runReadOnlyJdbcQueries({
        jdbcConfig,
        queries: ['SELECT 1', 'DELETE FROM orders'],
        runtime: { skipConnectionGuard: true },
      }),
    /must start with SELECT or WITH|non-read-only/i
  );
});

test('generic JDBC configuration requires a driver, URL, user, and password', () => {
  assert.throws(
    () => validateJdbcConnectionConfig({ ...jdbcConfig, driver: 'not a driver class' }),
    /fully qualified Java class/i
  );
  assert.throws(() => validateJdbcUrl('https://example.test'), /non-empty jdbc: URL/i);
  assert.throws(
    () => validateJdbcUrl('jdbc:jtds:sqlserver://host/ROL;password=unsafe'),
    /must not contain credentials/i
  );
});

test('incomplete JDBC config names its declared environment loader', () => {
  const config = { ...jdbcConfig, password: '', environment: 'sqlserver-jtds' };
  assert.match(getJdbcEnvironmentLoadHint(config), /load-env\.ps1 -Environment sqlserver-jtds/);
  assert.throws(
    () => validateJdbcConnectionConfig(config),
    /load-env\.ps1 -Environment sqlserver-jtds/
  );
});
