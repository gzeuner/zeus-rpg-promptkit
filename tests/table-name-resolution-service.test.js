const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const {
  buildResolveObjectDiagnostics,
  listTablesInSchema,
  resolveObjectsByName,
  resolveColumnsWithName,
  resolveTableNameBothDirections,
} = require('../src/db2/tableNameResolutionService');
const { SQL_STATEMENT_DELIMITER } = require('../src/db2/sqlBatch');
const { resetConnectionGuardState } = require('../src/security/connectionGuards');

function getExecutedQuery(args) {
  if (!args || args.length < 4) {
    return '';
  }
  if (args[3] === '--statements-file') {
    const filePath = args[4];
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const parts = content.split(SQL_STATEMENT_DELIMITER);
      return (parts[0] || '').trim();
    } catch (err) {
      return '';
    }
  }
  return args[3] || '';
}

function createRuntimeWithRows(rows, queryChecks = []) {
  return {
    runJavaHelper(_className, args) {
      const query = getExecutedQuery(args);
      if (/SYSIBM\.SYSDUMMY1/.test(query)) {
        return {
          status: 0,
          stdout: JSON.stringify({
            columns: ['HEALTHCHECK'],
            rows: [{ HEALTHCHECK: 1 }],
            rowCount: 1,
          }),
          stderr: '',
        };
      }
      for (const check of queryChecks) {
        check(query);
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          columns: [],
          rows,
          rowCount: rows.length,
        }),
        stderr: '',
      };
    },
  };
}

function createRuntimeWithFallbackSequence(sequence) {
  let index = 0;
  return {
    runJavaHelper(_className, args) {
      const query = getExecutedQuery(args);
      if (/SYSIBM\.SYSDUMMY1/.test(query)) {
        return {
          status: 0,
          stdout: JSON.stringify({
            columns: ['HEALTHCHECK'],
            rows: [{ HEALTHCHECK: 1 }],
            rowCount: 1,
          }),
          stderr: '',
        };
      }
      const step = sequence[index];
      index += 1;
      if (typeof step.check === 'function') {
        step.check(query);
      }
      if (step.error) {
        return {
          status: 2,
          stdout: '',
          stderr: step.error,
        };
      }
      const rows = step.rows || [];
      return {
        status: 0,
        stdout: JSON.stringify({
          columns: [],
          rows,
          rowCount: rows.length,
        }),
        stderr: '',
      };
    },
  };
}

function sampleDbConfig() {
  return {
    host: 'ibmi.example.com',
    user: 'ZEUS',
    password: 'secret',
  };
}

test('resolveTableNameBothDirections resolves system and SQL names in schema', () => {
  resetConnectionGuardState();
  const runtime = createRuntimeWithRows(
    [
      {
        SYSTEM_TABLE_NAME: 'TAB_SYS_A',
        SQL_TABLE_NAME: 'TABLE_A',
        TABLE_SCHEMA: 'SCHEMA_A',
      },
    ],
    [
      query => {
        assert.match(query, /QSYS2\.SYSTABLES/);
        assert.match(query, /TABLE_SCHEMA = 'SCHEMA_A'/);
      },
    ]
  );

  const resolved = resolveTableNameBothDirections(
    sampleDbConfig(),
    'tab_sys_a',
    'schema_a',
    runtime
  );
  assert.equal(resolved.found, true);
  assert.equal(resolved.systemName, 'TAB_SYS_A');
  assert.equal(resolved.sqlName, 'TABLE_A');
  assert.equal(resolved.schema, 'SCHEMA_A');
});

test('resolveTableNameBothDirections falls back when SYSTEM_TABLE_NAME is unavailable', () => {
  resetConnectionGuardState();
  const runtime = createRuntimeWithFallbackSequence([
    {
      check(query) {
        assert.match(query, /SELECT SYSTEM_TABLE_NAME/);
      },
      error: 'SQLSTATE=42703 Spalte SYSTEM_TABLE_NAME nicht gefunden',
    },
    {
      check(query) {
        assert.doesNotMatch(query, /SYSTEM_TABLE_NAME/);
        assert.match(query, /SELECT TABLE_NAME AS SQL_TABLE_NAME, TABLE_SCHEMA/);
      },
      rows: [
        {
          SQL_TABLE_NAME: 'TABLE_A',
          TABLE_SCHEMA: 'SCHEMA_A',
        },
      ],
    },
  ]);

  const resolved = resolveTableNameBothDirections(sampleDbConfig(), 'table_a', 'schema_a', runtime);
  assert.equal(resolved.found, true);
  assert.equal(resolved.systemName, 'TABLE_A');
  assert.equal(resolved.sqlName, 'TABLE_A');
  assert.equal(resolved.schema, 'SCHEMA_A');
});

test('resolveTableNameBothDirections returns found=false when no match exists', () => {
  resetConnectionGuardState();
  const runtime = createRuntimeWithRows([]);
  const resolved = resolveTableNameBothDirections(sampleDbConfig(), 'TABLE_X', 'SCHEMA_A', runtime);
  assert.equal(resolved.found, false);
  assert.deepEqual(resolved.searched, {
    tableNameOrAlias: 'TABLE_X',
    schema: 'SCHEMA_A',
  });
});

test('listTablesInSchema returns normalized table metadata', () => {
  resetConnectionGuardState();
  const runtime = createRuntimeWithRows([
    {
      SYSTEM_TABLE_NAME: 'TAB_SYS_A',
      SQL_TABLE_NAME: 'TABLE_A',
      TABLE_SCHEMA: 'SCHEMA_A',
      TABLE_TYPE: 'T',
    },
  ]);

  const result = listTablesInSchema(sampleDbConfig(), 'schema_a', runtime);
  assert.equal(result.schema, 'SCHEMA_A');
  assert.equal(result.count, 1);
  assert.deepEqual(result.tables[0], {
    systemName: 'TAB_SYS_A',
    sqlName: 'TABLE_A',
    schema: 'SCHEMA_A',
    type: 'T',
  });
});

test('listTablesInSchema falls back when SYSTEM_TABLE_NAME is unavailable', () => {
  resetConnectionGuardState();
  const runtime = createRuntimeWithFallbackSequence([
    {
      check(query) {
        assert.match(query, /SELECT SYSTEM_TABLE_NAME, TABLE_NAME AS SQL_TABLE_NAME/);
      },
      error: 'SQLSTATE=42703 Spalte SYSTEM_TABLE_NAME nicht gefunden',
    },
    {
      check(query) {
        assert.doesNotMatch(query, /SYSTEM_TABLE_NAME/);
        assert.match(query, /SELECT TABLE_NAME AS SQL_TABLE_NAME, TABLE_SCHEMA, TABLE_TYPE/);
      },
      rows: [
        {
          SQL_TABLE_NAME: 'TABLE_A',
          TABLE_SCHEMA: 'SCHEMA_A',
          TABLE_TYPE: 'T',
        },
      ],
    },
  ]);

  const result = listTablesInSchema(sampleDbConfig(), 'schema_a', runtime);
  assert.equal(result.schema, 'SCHEMA_A');
  assert.equal(result.count, 1);
  assert.deepEqual(result.tables[0], {
    systemName: 'TABLE_A',
    sqlName: 'TABLE_A',
    schema: 'SCHEMA_A',
    type: 'T',
  });
});

test('resolveColumnsWithName returns typed column metadata', () => {
  resetConnectionGuardState();
  const runtime = createRuntimeWithRows([
    {
      COLUMN_NAME: 'COL_A',
      DATA_TYPE: 'DECIMAL',
      LENGTH: 9,
      NUMERIC_SCALE: 2,
      IS_NULLABLE: 'NO',
      ORDINAL_POSITION: 1,
    },
  ]);

  const result = resolveColumnsWithName(sampleDbConfig(), 'schema_a', 'table_a', runtime);
  assert.equal(result.count, 1);
  assert.deepEqual(result.table, {
    schema: 'SCHEMA_A',
    sqlTableName: 'TABLE_A',
  });
  assert.deepEqual(result.columns[0], {
    name: 'COL_A',
    type: 'DECIMAL',
    length: 9,
    scale: 2,
    nullable: false,
    ordinal: 1,
  });
});

test('resolveObjectsByName matches SQL and system names across schemas and validates required columns', () => {
  resetConnectionGuardState();
  const queries = [];
  const runtime = {
    runJavaHelper(_className, args) {
      const query = getExecutedQuery(args);
      queries.push(query);
      if (/FROM QSYS2\.SYSTABLES/.test(query)) {
        return {
          status: 0,
          stdout: JSON.stringify({
            columns: [],
            rows: [
              {
                SYSTEM_TABLE_NAME: 'ORDHDRP',
                SQL_TABLE_NAME: 'ORDER_HEADER',
                TABLE_SCHEMA: 'APPDATA',
                TABLE_TYPE: 'T',
              },
            ],
            rowCount: 1,
          }),
          stderr: '',
        };
      }
      if (/FROM QSYS2\.SYSCOLUMNS/.test(query)) {
        return {
          status: 0,
          stdout: JSON.stringify({
            columns: [],
            rows: [
              {
                COLUMN_NAME: 'ORDER_ID',
                DATA_TYPE: 'DECIMAL',
                LENGTH: 9,
                NUMERIC_SCALE: 0,
                IS_NULLABLE: 'NO',
                ORDINAL_POSITION: 1,
              },
              {
                COLUMN_NAME: 'CUSTOMER_ID',
                DATA_TYPE: 'DECIMAL',
                LENGTH: 9,
                NUMERIC_SCALE: 0,
                IS_NULLABLE: 'NO',
                ORDINAL_POSITION: 2,
              },
            ],
            rowCount: 2,
          }),
          stderr: '',
        };
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          columns: ['ROW_COUNT'],
          rows: [{ ROW_COUNT: 42 }],
          rowCount: 1,
        }),
        stderr: '',
      };
    },
  };

  const resolved = resolveObjectsByName(sampleDbConfig(), 'ORDHDRP', {
    requireColumns: ['ORDER_ID', 'CASE_ID'],
    includeRowCount: true,
    runtime,
  });

  assert.equal(resolved.found, true);
  assert.equal(resolved.count, 1);
  assert.equal(resolved.objects[0].schema, 'APPDATA');
  assert.equal(resolved.objects[0].sqlName, 'ORDER_HEADER');
  assert.equal(resolved.objects[0].systemName, 'ORDHDRP');
  assert.equal(resolved.objects[0].allRequiredColumnsPresent, false);
  assert.deepEqual(resolved.objects[0].missingRequiredColumns, ['CASE_ID']);
  assert.equal(resolved.objects[0].rowCount, 42);
  assert.equal(resolved.diagnostics.schemaProvided, false);
  assert.equal(resolved.diagnostics.searchMode, 'schema-discovery');
  assert.equal(resolved.diagnostics.attemptCount, 1);
  assert.match(resolved.diagnostics.recommendations.join('\n'), /Use --schema APPDATA/);
  assert.ok(queries.some(query => /FROM QSYS2\.SYSTABLES/.test(query)));
  assert.ok(queries.some(query => /FROM QSYS2\.SYSCOLUMNS/.test(query)));
});

test('buildResolveObjectDiagnostics reports fallback usage and scoped recommendations', () => {
  const diagnostics = buildResolveObjectDiagnostics({
    catalogResult: {
      meta: {
        attemptCount: 2,
        usedVariant: 'without-system-table-name',
      },
    },
    elapsedMs: 3987,
    normalizedSchema: null,
    objects: [
      {
        schema: 'ZEUS1',
      },
    ],
  });

  assert.deepEqual(diagnostics, {
    elapsedMs: 3987,
    schemaProvided: false,
    schemaFilter: null,
    searchMode: 'schema-discovery',
    scope: 'all-visible-schemas',
    attemptCount: 2,
    catalogVariant: 'without-system-table-name',
    fallbackUsed: true,
    recommendations: [
      'Schema-free resolution searches across visible schemas and can be slower on shared systems.',
      'Use --schema ZEUS1 for faster follow-up checks.',
      'A catalog fallback query variant was used because some QSYS2 columns were unavailable.',
    ],
  });
});
