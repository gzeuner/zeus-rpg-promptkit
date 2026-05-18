const test = require('node:test');
const assert = require('node:assert/strict');

const {
  listTablesInSchema,
  resolveColumnsWithName,
  resolveTableNameBothDirections,
} = require('../src/db2/tableNameResolutionService');

function createRuntimeWithRows(rows, queryChecks = []) {
  return {
    runJavaHelper(_className, args) {
      const query = args[3];
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
      const query = args[3];
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
  const runtime = createRuntimeWithRows(
    [
      {
        SYSTEM_TABLE_NAME: 'TAB_SYS_A',
        SQL_TABLE_NAME: 'TABLE_A',
        TABLE_SCHEMA: 'SCHEMA_A',
      },
    ],
    [
      (query) => {
        assert.match(query, /QSYS2\.SYSTABLES/);
        assert.match(query, /TABLE_SCHEMA = 'SCHEMA_A'/);
      },
    ],
  );

  const resolved = resolveTableNameBothDirections(sampleDbConfig(), 'tab_sys_a', 'schema_a', runtime);
  assert.equal(resolved.found, true);
  assert.equal(resolved.systemName, 'TAB_SYS_A');
  assert.equal(resolved.sqlName, 'TABLE_A');
  assert.equal(resolved.schema, 'SCHEMA_A');
});

test('resolveTableNameBothDirections falls back when SYSTEM_TABLE_NAME is unavailable', () => {
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
  const runtime = createRuntimeWithRows([]);
  const resolved = resolveTableNameBothDirections(sampleDbConfig(), 'TABLE_X', 'SCHEMA_A', runtime);
  assert.equal(resolved.found, false);
  assert.deepEqual(resolved.searched, {
    tableNameOrAlias: 'TABLE_X',
    schema: 'SCHEMA_A',
  });
});

test('listTablesInSchema returns normalized table metadata', () => {
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
