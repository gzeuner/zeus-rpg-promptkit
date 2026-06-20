const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scanRpgFile, scanSourceFiles } = require('../src/scanner/rpgScanner');
const { buildCanonicalAnalysisModel } = require('../src/context/canonicalAnalysisModel');
const { buildContext } = require('../src/context/contextBuilder');

test('scanRpgFile extracts structured embedded SQL semantics for cursors, host variables, and dynamic SQL', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-sql-semantics-'));
  const sourceFile = path.join(tempRoot, 'ORDERPGM.sqlrpgle');

  fs.writeFileSync(sourceFile, `**FREE
dcl-s stmt varchar(500);
dcl-s customerId packed(7);
dcl-s orderId packed(7);
dcl-s status char(10);

dcl-proc main;
  exec sql
    declare C1 cursor for
      select ORDER_ID
        from ORDERS
       where CUSTOMER_ID = :customerId;

  exec sql
    open C1;

  exec sql
    fetch C1 into :orderId;

  exec sql
    update ORDERS
       set STATUS = :status
     where ORDER_ID = :orderId;

  exec sql
    prepare S1 from :stmt;

  exec sql
    execute S1 using :orderId;
end-proc;
`, 'utf8');

  try {
    const result = scanRpgFile(sourceFile);
    assert.deepEqual(
      result.sqlStatements.map((statement) => `${statement.type}:${statement.intent}:${statement.dynamic}:${statement.unresolved}:${statement.tables.join('/')}:${statement.hostVariables.join('/')}`),
      [
        'DECLARE_CURSOR:READ:false:false:ORDERS:CUSTOMERID',
        'OPEN_CURSOR:CURSOR:false:false::',
        'FETCH:READ:false:false::ORDERID',
        'UPDATE:WRITE:false:false:ORDERS:ORDERID/STATUS',
        'PREPARE:OTHER:true:true::STMT',
        'EXECUTE:OTHER:true:true::ORDERID',
      ],
    );
    assert.deepEqual(
      result.sqlStatements[0].cursors,
      [{ name: 'C1', action: 'DECLARE' }],
    );
    assert.deepEqual(
      result.sqlStatements[2].cursors,
      [{ name: 'C1', action: 'FETCH' }],
    );
    assert.deepEqual(result.sqlStatements[4].uncertainty, ['DYNAMIC_SQL', 'UNRESOLVED_SQL']);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('canonical analysis and context projection expose SQL intent, summary, and uncertainty markers', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-sql-canonical-'));
  const sourceFile = path.join(tempRoot, 'ORDERPGM.sqlrpgle');

  fs.writeFileSync(sourceFile, `**FREE
dcl-s stmt varchar(500);
dcl-s customerId packed(7);
dcl-s orderId packed(7);

dcl-proc main;
  exec sql
    declare C1 cursor for
      select ORDER_ID
        from ORDERS
       where CUSTOMER_ID = :customerId;

  exec sql
    fetch C1 into :orderId;

  exec sql
    prepare S1 from :stmt;
end-proc;
`, 'utf8');

  try {
    const scanSummary = scanSourceFiles([sourceFile]);
    const canonicalAnalysis = buildCanonicalAnalysisModel({
      program: 'ORDERPGM',
      sourceRoot: tempRoot,
      sourceFiles: scanSummary.sourceFiles,
      dependencies: {
        tables: scanSummary.tables,
        calls: scanSummary.calls,
        copyMembers: scanSummary.copyMembers,
        sqlStatements: scanSummary.sqlStatements,
        procedures: scanSummary.procedures,
        prototypes: scanSummary.prototypes,
        procedureCalls: scanSummary.procedureCalls,
        nativeFiles: scanSummary.nativeFiles,
        nativeFileAccesses: scanSummary.nativeFileAccesses,
      },
      notes: [],
    });
    const context = buildContext({ canonicalAnalysis });

    assert.equal(context.sql.summary.statementCount, 3);
    assert.equal(context.sql.summary.readStatementCount, 2);
    assert.equal(context.sql.summary.dynamicStatementCount, 1);
    assert.equal(context.sql.summary.cursorStatementCount, 2);
    assert.equal(context.sql.summary.hostVariableCount, 3);
    assert.deepEqual(context.sql.tableNames, ['ORDERS']);
    assert.deepEqual(context.sql.hostVariables, ['CUSTOMERID', 'ORDERID', 'STMT']);
    assert.deepEqual(context.sql.cursors, [{ name: 'C1', actions: ['DECLARE', 'FETCH'] }]);
    assert.ok(context.aiContext.riskHints.includes('Dynamic SQL detected'));
    assert.ok(canonicalAnalysis.relations.some((entry) => entry.type === 'EXECUTES_SQL' && entry.attributes.dynamic === true));
    assert.ok(canonicalAnalysis.relations.some((entry) => entry.type === 'EXECUTES_SQL' && entry.attributes.cursorNames.includes('C1')));
    assert.match(context.summary.text, /SQL statements \(2 read, 0 write, 1 dynamic\)/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('static select statements expose driver table, joins, filters, and canonical join relations', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-sql-joins-'));
  const sourceFile = path.join(tempRoot, 'ORDERPGM.sqlrpgle');

  fs.writeFileSync(sourceFile, `**FREE
dcl-s status char(10);
dcl-s customerId packed(7);

dcl-proc main;
  exec sql
    select o.ORDER_ID, c.CUSTOMER_NAME
      from ORDERS o
      join CUSTOMERS c
        on o.CUSTOMER_ID = c.CUSTOMER_ID
     where o.STATUS = :status
       and o.CUSTOMER_ID = :customerId;
end-proc;
`, 'utf8');

  try {
    const scanSummary = scanSourceFiles([sourceFile]);
    const statement = scanSummary.sqlStatements[0];

    assert.equal(statement.driverTable, 'ORDERS');
    assert.equal(statement.confidence, 'HIGH');
    assert.deepEqual(statement.joins, [{
      table: 'CUSTOMERS',
      alias: 'C',
      joinType: 'INNER',
      condition: 'o.CUSTOMER_ID = c.CUSTOMER_ID',
      hostVariables: [],
    }]);
    assert.deepEqual(statement.filters, [
      { text: 'o.STATUS = :status', hostVariables: ['STATUS'] },
      { text: 'o.CUSTOMER_ID = :customerId;', hostVariables: ['CUSTOMERID'] },
    ]);

    const canonicalAnalysis = buildCanonicalAnalysisModel({
      program: 'ORDERPGM',
      sourceRoot: tempRoot,
      sourceFiles: scanSummary.sourceFiles,
      dependencies: {
        tables: scanSummary.tables,
        calls: scanSummary.calls,
        copyMembers: scanSummary.copyMembers,
        sqlStatements: scanSummary.sqlStatements,
        procedures: scanSummary.procedures,
        prototypes: scanSummary.prototypes,
        procedureCalls: scanSummary.procedureCalls,
        nativeFiles: scanSummary.nativeFiles,
        nativeFileAccesses: scanSummary.nativeFileAccesses,
        modules: scanSummary.modules,
        bindingDirectories: scanSummary.bindingDirectories,
        servicePrograms: scanSummary.servicePrograms,
      },
      notes: [],
    });
    const context = buildContext({ canonicalAnalysis });

    assert.equal(context.sql.statements[0].driverTable, 'ORDERS');
    assert.equal(context.sql.statements[0].confidence, 'HIGH');
    assert.equal(context.sql.statements[0].joins[0].table, 'CUSTOMERS');
    assert.equal(context.sql.statements[0].filters.length, 2);
    assert.ok(canonicalAnalysis.relations.some((entry) => entry.type === 'DRIVES' && entry.from === 'SQL:0001' && entry.to === 'TABLE:ORDERS'));
    assert.ok(canonicalAnalysis.relations.some((entry) => entry.type === 'JOINS_VIA'
      && entry.from === 'TABLE:ORDERS'
      && entry.to === 'TABLE:CUSTOMERS'
      && entry.attributes.joinType === 'INNER'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('declare cursor select statements keep static join semantics and driver relations', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-sql-cursor-joins-'));
  const sourceFile = path.join(tempRoot, 'ORDERPGM.sqlrpgle');

  fs.writeFileSync(sourceFile, `**FREE
dcl-s status char(10);

dcl-proc main;
  exec sql
    declare C1 cursor for
      select o.ORDER_ID, c.CUSTOMER_NAME
        from ORDERS o
        left join CUSTOMERS c
          on o.CUSTOMER_ID = c.CUSTOMER_ID
       where o.STATUS = :status;
end-proc;
`, 'utf8');

  try {
    const scanSummary = scanSourceFiles([sourceFile]);
    const statement = scanSummary.sqlStatements[0];

    assert.equal(statement.type, 'DECLARE_CURSOR');
    assert.equal(statement.intent, 'READ');
    assert.equal(statement.driverTable, 'ORDERS');
    assert.equal(statement.confidence, 'HIGH');
    assert.deepEqual(statement.cursors, [{ name: 'C1', action: 'DECLARE' }]);
    assert.deepEqual(statement.joins, [{
      table: 'CUSTOMERS',
      alias: 'C',
      joinType: 'LEFT',
      condition: 'o.CUSTOMER_ID = c.CUSTOMER_ID',
      hostVariables: [],
    }]);

    const canonicalAnalysis = buildCanonicalAnalysisModel({
      program: 'ORDERPGM',
      sourceRoot: tempRoot,
      sourceFiles: scanSummary.sourceFiles,
      dependencies: {
        tables: scanSummary.tables,
        calls: scanSummary.calls,
        copyMembers: scanSummary.copyMembers,
        sqlStatements: scanSummary.sqlStatements,
        procedures: scanSummary.procedures,
        prototypes: scanSummary.prototypes,
        procedureCalls: scanSummary.procedureCalls,
        nativeFiles: scanSummary.nativeFiles,
        nativeFileAccesses: scanSummary.nativeFileAccesses,
        modules: scanSummary.modules,
        bindingDirectories: scanSummary.bindingDirectories,
        servicePrograms: scanSummary.servicePrograms,
      },
      notes: [],
    });
    const context = buildContext({ canonicalAnalysis });

    assert.equal(context.sql.statements[0].type, 'DECLARE_CURSOR');
    assert.equal(context.sql.statements[0].driverTable, 'ORDERS');
    assert.equal(context.sql.statements[0].joins[0].joinType, 'LEFT');
    assert.ok(canonicalAnalysis.relations.some((entry) => entry.type === 'DRIVES'
      && entry.from === 'SQL:0001'
      && entry.to === 'TABLE:ORDERS'));
    assert.ok(canonicalAnalysis.relations.some((entry) => entry.type === 'JOINS_VIA'
      && entry.from === 'TABLE:ORDERS'
      && entry.to === 'TABLE:CUSTOMERS'
      && entry.attributes.sqlStatementId === 'SQL:0001'
      && entry.attributes.joinType === 'LEFT'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('sqlRpgValidator detects cursor/fetch column count mismatch', () => {
  const { validateEmbeddedSql } = require('../src/validator/sqlRpgValidator');
  const statements = [
    {
      type: 'DECLARE_CURSOR',
      text: 'declare C1 cursor for select a, b, c from t',
      cursors: [{ name: 'C1', action: 'DECLARE' }],
      hostVariables: [],
      selectColumnCount: 3,
    },
    {
      type: 'FETCH',
      text: 'fetch C1 into :x',
      cursors: [{ name: 'C1', action: 'FETCH' }],
      hostVariables: ['X'],
    },
  ];
  const result = validateEmbeddedSql(statements);
  assert.ok(result.validationErrors.length > 0);
  assert.equal(result.validationErrors[0].code, 'CURSOR_FETCH_MISMATCH');
  assert.match(result.validationErrors[0].message, /3 column.*1 INTO/);
});
