const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('node:child_process');

const {
  resolveJavaClasspathEntries,
  shouldCompileJavaSources,
} = require('../src/java/javaRuntime');

function createTempJavaProject() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-java-runtime-'));
  fs.mkdirSync(path.join(tempRoot, 'java', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, 'java', 'lib'), { recursive: true });
  return tempRoot;
}

test('DB2 batch Java serializer isolates SQL errors and bounds table and batch output', t => {
  const tempRoot = createTempJavaProject();
  try {
    const driverFile = path.join(tempRoot, 'AS400JDBCDriver.java');
    fs.writeFileSync(
      driverFile,
      String.raw`
package com.ibm.as400.access;
import java.lang.reflect.*;
import java.sql.*;
import java.util.Properties;
import java.util.logging.Logger;
public class AS400JDBCDriver implements Driver {
    static {
        try { DriverManager.registerDriver(new AS400JDBCDriver()); }
        catch (SQLException error) { throw new RuntimeException(error); }
    }
    private static <T> T proxy(Class<T> type, InvocationHandler handler) {
        return type.cast(Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type}, handler));
    }
    public Connection connect(String url, Properties properties) {
        if (!acceptsURL(url)) throw new AssertionError("Unexpected JDBC target");
        return proxy(Connection.class, (connection, method, arguments) -> {
            if (!method.getName().equals("createStatement")) return null;
            return proxy(Statement.class, (statement, operation, parameters) -> {
                if (!operation.getName().equals("executeQuery")) return null;
                String sql = (String) parameters[0];
                if (sql.contains("MISSING")) throw new SQLException("SQL0204 missing table", "42704");
                int[] row = {0};
                return proxy(ResultSet.class, (result, getter, indexes) -> {
                    switch (getter.getName()) {
                        case "next": return row[0]++ == 0;
                        case "getMetaData": return proxy(ResultSetMetaData.class, (metadata, field, index) -> {
                            switch (field.getName()) {
                                case "getColumnCount": return 1;
                                case "getColumnLabel": return "VALUE";
                                case "getColumnType": return Types.VARCHAR;
                                default: return null;
                            }
                        });
                        case "getObject": return sql.contains("WIDE") ? "x".repeat(16 * 1024 * 1024) : "value";
                        default: return null;
                    }
                });
            });
        });
    }
    public boolean acceptsURL(String url) { return url.startsWith("jdbc:review:"); }
    public DriverPropertyInfo[] getPropertyInfo(String url, Properties properties) { return new DriverPropertyInfo[0]; }
    public int getMajorVersion() { return 1; }
    public int getMinorVersion() { return 0; }
    public boolean jdbcCompliant() { return false; }
    public Logger getParentLogger() { return Logger.getGlobal(); }
    public static void main(String[] arguments) throws Exception {
      Method extract = Class.forName("Db2TestDataExtractor").getDeclaredMethod("extractTableJson",
          Connection.class, String.class, String.class, String.class, int.class, java.util.List.class, int.class);
      extract.setAccessible(true);
      try (Connection connection = DriverManager.getConnection("jdbc:review:local")) {
        try {
          extract.invoke(null, connection, "jdbc:review:local", "APP", "GOOD", 1, java.util.List.of(), 32);
          throw new AssertionError("The table output budget was not enforced");
        } catch (InvocationTargetException error) {
          if (!(error.getCause() instanceof SQLException)) throw error;
          SQLException cause = (SQLException) error.getCause();
          if (!"54000".equals(cause.getSQLState())) throw error;
          System.out.println("table-budget-enforced");
        }
      }
    }
}
`,
      'utf8'
    );
    const compiled = spawnSync(
      'javac',
      [
        '-d',
        tempRoot,
        path.join(__dirname, '../java/ZeusSecrets.java'),
        path.join(__dirname, '../java/Db2TestDataExtractor.java'),
        driverFile,
      ],
      { encoding: 'utf8', timeout: 30000 }
    );
    if (compiled.error?.code === 'ENOENT') {
      t.skip('JDK is unavailable; the serializer regression requires javac and java.');
      return;
    }
    assert.ifError(compiled.error);
    assert.equal(compiled.status, 0, compiled.stderr);
    const requestFile = path.join(tempRoot, 'requests.tsv');
    const runBatch = tables => {
      fs.writeFileSync(
        requestFile,
        tables
          .map(table =>
            ['APP', table].map(value => Buffer.from(value).toString('base64url')).join('\t')
          )
          .join('\n') + '\n'
      );
      const result = spawnSync(
        'java',
        [
          '-Dfile.encoding=UTF-8',
          '-cp',
          tempRoot,
          'Db2TestDataExtractor',
          'jdbc:review:local',
          'neutral',
          'synthetic-password',
          '--batch-file',
          requestFile,
          '1',
        ],
        { encoding: 'utf8', timeout: 15000, maxBuffer: 32 * 1024 * 1024 }
      );
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const payload = runBatch(['GOOD', 'MISSING', 'AFTER']);
    assert.deepEqual(
      payload.results.map(entry => entry.status),
      ['exported', 'error', 'exported']
    );
    assert.equal(payload.results[0].data.table, 'GOOD');
    assert.match(payload.results[1].error, /SQL0204/);
    assert.equal(payload.results[2].data.table, 'AFTER');
    assert.deepEqual(payload.results[2].data.rows, [{ VALUE: 'value' }]);
    assert.equal(payload.hasMore, false);
    const legacy = spawnSync(
      'java',
      [
        '-Dfile.encoding=UTF-8',
        '-cp',
        tempRoot,
        'Db2TestDataExtractor',
        'jdbc:review:local',
        'neutral',
        'synthetic-password',
        'APP',
        'GOOD',
        '1',
      ],
      { encoding: 'utf8', timeout: 15000 }
    );
    assert.ifError(legacy.error);
    assert.equal(legacy.status, 0, legacy.stderr);
    assert.deepEqual(JSON.parse(legacy.stdout), payload.results[0].data);
    const wide = runBatch(['WIDE', 'MISSING', 'AFTER']);
    assert.equal(wide.results.length, 1);
    assert.equal(wide.hasMore, true);
    assert.equal(wide.results[0].data.rows[0].VALUE.length, 16 * 1024 * 1024);
    const continuation = runBatch(['MISSING', 'AFTER']);
    assert.deepEqual(
      continuation.results.map(entry => entry.status),
      ['error', 'exported']
    );
    assert.equal(continuation.hasMore, false);
    const guard = spawnSync('java', ['-cp', tempRoot, 'com.ibm.as400.access.AS400JDBCDriver'], {
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.ifError(guard.error);
    assert.equal(guard.status, 0, guard.stderr);
    assert.equal(guard.stdout.trim(), 'table-budget-enforced');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveJavaClasspathEntries includes java/bin and jar files from bin and lib', () => {
  const tempRoot = createTempJavaProject();

  try {
    const binJar = path.join(tempRoot, 'java', 'bin', 'jt400.jar');
    const libJar = path.join(tempRoot, 'java', 'lib', 'helper.jar');
    fs.writeFileSync(binJar, '');
    fs.writeFileSync(libJar, '');

    const classpathEntries = resolveJavaClasspathEntries({ cwd: tempRoot });

    assert.deepEqual(classpathEntries, [path.join(tempRoot, 'java', 'bin'), binJar, libJar]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('shouldCompileJavaSources detects missing or stale class files', () => {
  const tempRoot = createTempJavaProject();

  try {
    const sourceFile = path.join(tempRoot, 'java', 'Example.java');
    const classFile = path.join(tempRoot, 'java', 'bin', 'Example.class');
    fs.writeFileSync(sourceFile, 'class Example {}', 'utf8');

    assert.equal(
      shouldCompileJavaSources({
        sourceFiles: [sourceFile],
        binDir: path.join(tempRoot, 'java', 'bin'),
      }),
      true
    );

    fs.writeFileSync(classFile, '', 'utf8');
    const older = new Date(Date.now() - 10_000);
    const newer = new Date(Date.now() - 1_000);
    fs.utimesSync(classFile, older, older);
    fs.utimesSync(sourceFile, newer, newer);

    assert.equal(
      shouldCompileJavaSources({
        sourceFiles: [sourceFile],
        binDir: path.join(tempRoot, 'java', 'bin'),
      }),
      true
    );

    const newest = new Date();
    fs.utimesSync(classFile, newest, newest);

    assert.equal(
      shouldCompileJavaSources({
        sourceFiles: [sourceFile],
        binDir: path.join(tempRoot, 'java', 'bin'),
      }),
      false
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
