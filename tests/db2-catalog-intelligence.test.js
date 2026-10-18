const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildCanonicalAnalysisModel } = require('../src/context/canonicalAnalysisModel');
const { buildContext } = require('../src/context/contextBuilder');
const { buildDb2SourceLinkage } = require('../src/db2/db2EvidenceLinker');
const { buildDb2CatalogSemanticUpdates } = require('../src/db2/catalogSemanticModel');
const {
  buildExtractionPlan,
  buildTestDataPolicy,
  exportTestData,
  resolveMaskingPlanForTable,
} = require('../src/db2/testDataExportService');

function createCanonicalFixture(tempRoot) {
  const sourceFile = path.join(tempRoot, 'ORDERPGM.rpgle');
  fs.writeFileSync(sourceFile, '      * ENTRY\n', 'utf8');

  const canonicalAnalysis = buildCanonicalAnalysisModel({
    program: 'ORDERPGM',
    sourceRoot: tempRoot,
    sourceFiles: [
      {
        path: sourceFile,
        sizeBytes: 16,
        lines: 1,
        sourceType: 'RPGLE',
      },
    ],
    dependencies: {
      tables: [
        {
          name: 'CUSTPF',
          evidence: [{ file: sourceFile, line: 10 }],
        },
      ],
      calls: [
        {
          name: 'INVOICEP',
          evidence: [{ file: sourceFile, line: 22 }],
        },
      ],
      copyMembers: [],
      sqlStatements: [],
      procedures: [],
      prototypes: [
        {
          name: 'POSTINV',
          ownerProgram: 'ORDERPGM',
          sourceFile,
          startLine: 30,
          endLine: 30,
          sourceForm: 'FREE',
          imported: true,
          externalName: 'POSTINV',
          evidence: [{ file: sourceFile, line: 30 }],
        },
      ],
      procedureCalls: [],
      nativeFiles: [],
      nativeFileAccesses: [],
      modules: [],
      bindingDirectories: [],
      servicePrograms: [],
    },
    notes: [],
  });

  return {
    canonicalAnalysis,
    context: buildContext({ canonicalAnalysis }),
  };
}

test('DB2 linkage resolves requested tables by SQL name or system name', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-db2-catalog-linkage-'));
  try {
    const { canonicalAnalysis, context } = createCanonicalFixture(tempRoot);
    const exportedTables = [
      {
        schema: 'APP',
        table: 'CUSTOMERS',
        systemSchema: 'APP',
        systemName: 'CUSTPF',
        objectType: 'TABLE',
        lookupStrategy: 'IBM_I_CATALOG',
        columns: [{ name: 'CUSTNO', type: 'DECIMAL' }],
        foreignKeys: [],
        triggers: [],
        derivedObjects: [],
      },
    ];

    const linkage = buildDb2SourceLinkage({
      requestedTables: ['CUSTPF', 'CUSTOMERS'],
      exportedTables,
      canonicalAnalysis,
      context,
    });

    const systemNameLink = linkage.tableLinks.find(entry => entry.requestedName === 'CUSTPF');
    const sqlNameLink = linkage.tableLinks.find(entry => entry.requestedName === 'CUSTOMERS');

    assert.equal(systemNameLink.matchStatus, 'resolved');
    assert.equal(systemNameLink.matches[0].matchType, 'SYSTEM_NAME');
    assert.equal(sqlNameLink.matchStatus, 'resolved');
    assert.equal(sqlNameLink.matches[0].matchType, 'SQL_NAME');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('DB2 test-data extraction plan matches metadata by dual name and skips ambiguous matches', () => {
  const metadataPayload = {
    tables: [
      {
        schema: 'APP',
        table: 'CUSTOMERS',
        systemSchema: 'APP',
        systemName: 'CUSTPF',
        columns: [{ name: 'CUSTNO', primaryKey: true }],
      },
      {
        schema: 'APP2',
        table: 'CUSTOMERS_ARCHIVE',
        systemSchema: 'APP2',
        systemName: 'CUSTPF',
        columns: [{ name: 'CUSTNO', primaryKey: true }],
      },
    ],
  };

  const resolvedPlan = buildExtractionPlan({
    requestedTables: [{ schema: '', table: 'CUSTOMERS' }],
    metadataPayload,
    defaultSchema: 'APP',
  });
  const ambiguousPlan = buildExtractionPlan({
    requestedTables: [{ schema: '', table: 'CUSTPF' }],
    metadataPayload,
    defaultSchema: 'APP',
  });

  assert.equal(resolvedPlan[0].status, 'pending');
  assert.equal(resolvedPlan[0].table, 'CUSTOMERS');
  assert.equal(resolvedPlan[0].systemName, 'CUSTPF');

  const skippedEntry = ambiguousPlan.find(
    entry => entry.table === 'CUSTPF' && entry.status === 'skipped'
  );
  assert.ok(skippedEntry);
  assert.match(skippedEntry.note, /matched multiple DB2 catalog objects/i);
});

test('DB2 test-data extraction plan applies allowlists and denylists before extraction', () => {
  const metadataPayload = {
    tables: [
      {
        schema: 'APP',
        table: 'CUSTOMERS',
        systemSchema: 'APP',
        systemName: 'CUSTPF',
        columns: [{ name: 'CUSTNO', primaryKey: true }],
      },
      {
        schema: 'APP',
        table: 'AUDITLOG',
        systemSchema: 'APP',
        systemName: 'AUDITPF',
        columns: [{ name: 'AUDITNO', primaryKey: true }],
      },
    ],
  };
  const policy = buildTestDataPolicy({
    allowTables: ['APP.CUSTOMERS', 'APP.AUDITLOG'],
    denyTables: ['APP.AUDITLOG'],
  });

  const plan = buildExtractionPlan({
    requestedTables: [
      { schema: 'APP', table: 'CUSTOMERS' },
      { schema: 'APP', table: 'AUDITLOG' },
    ],
    metadataPayload,
    defaultSchema: 'APP',
    policy,
  });

  const customers = plan.find(entry => entry.table === 'CUSTOMERS');
  const auditLog = plan.find(entry => entry.table === 'AUDITLOG');
  assert.equal(customers.status, 'pending');
  assert.equal(customers.policyDecision.eligibility, 'eligible');
  assert.equal(auditLog.status, 'skipped');
  assert.equal(auditLog.policyDecision.eligibility, 'denied');
  assert.match(auditLog.note, /denylist/i);
});

test('DB2 test-data extraction batches eligible tables and preserves per-table results', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-db2-test-data-batch-'));
  let helperCallCount = 0;
  let requestFilePath = '';
  let requestRows = [];
  let performanceLog = '';
  const originalStderrWrite = process.stderr.write;
  const originalConsoleLog = console.log;
  try {
    process.stderr.write = chunk => {
      performanceLog += String(chunk);
      return true;
    };
    console.log = () => {};
    const result = exportTestData({
      program: 'ORDERPGM',
      dependencies: { tables: [] },
      dbConfig: {
        host: 'ibmi.example.test',
        user: 'ZEUS',
        password: 'synthetic-secret',
        defaultSchema: 'APP',
      },
      outputDir,
      metadataPayload: {
        tables: [
          {
            schema: 'APP',
            table: 'CUSTOMERS',
            systemSchema: 'APP',
            systemName: 'CUSTPF',
            columns: [
              { name: 'ID', primaryKey: true },
              { name: 'EMAIL', primaryKey: false },
            ],
          },
          {
            schema: 'APP',
            table: 'ORDERS',
            systemSchema: 'APP',
            systemName: 'ORDERPF',
            columns: [{ name: 'ORDER_ID', primaryKey: true }],
          },
          {
            schema: 'APP',
            table: 'AUDITLOG',
            systemSchema: 'APP',
            systemName: 'AUDITPF',
            columns: [{ name: 'ID', primaryKey: true }],
          },
        ],
        tableLinks: [],
      },
      testDataConfig: {
        limit: 5,
        maskColumns: ['EMAIL'],
        denyTables: ['APP.AUDITLOG'],
      },
      verbose: true,
      helpers: {
        ensureJavaHelperCompiled(file, className) {
          assert.equal(file, 'Db2TestDataExtractor.java');
          assert.equal(className, 'Db2TestDataExtractor');
        },
        runJavaHelper(className, args, options) {
          helperCallCount += 1;
          assert.equal(className, 'Db2TestDataExtractor');
          assert.equal(args[2], '@ZEUS_SECRET_ENV@');
          assert.equal(args[3], '--batch-file');
          assert.equal(args[5], '5');
          assert.ok(!args.includes('synthetic-secret'));
          assert.equal(options.password, 'synthetic-secret');
          requestFilePath = args[4];
          const lines = fs.readFileSync(requestFilePath, 'utf8').trim().split(/\r?\n/);
          requestRows = lines.map(line =>
            line.split('\t').map(field => Buffer.from(field, 'base64url').toString('utf8'))
          );
          return {
            status: 0,
            stderr: '',
            stdout: JSON.stringify({
              results: [
                {
                  status: 'exported',
                  data: {
                    schema: 'APP',
                    table: 'CUSTOMERS',
                    columns: ['ID', 'EMAIL'],
                    rows: [{ ID: 42, EMAIL: 'private@example.test' }],
                    rowCount: 1,
                  },
                },
                {
                  status: 'error',
                  schema: 'APP',
                  table: 'ORDERS',
                  error: 'DB2 test data extraction failed: SQL0204 missing table',
                },
              ],
            }),
          };
        },
      },
    });

    assert.equal(helperCallCount, 1);
    assert.deepEqual(requestRows, [
      ['APP', 'CUSTOMERS', 'ID'],
      ['APP', 'ORDERS', 'ORDER_ID'],
    ]);
    assert.equal(fs.existsSync(requestFilePath), false);
    const customers = result.payload.tables.find(table => table.table === 'CUSTOMERS');
    const orders = result.payload.tables.find(table => table.table === 'ORDERS');
    const auditLog = result.payload.tables.find(table => table.table === 'AUDITLOG');
    assert.equal(customers.status, 'exported');
    assert.equal(customers.rows[0].EMAIL, 'MASKED');
    assert.equal(orders.status, 'error');
    assert.match(orders.note, /SQL0204/);
    assert.equal(auditLog.status, 'skipped');
    assert.equal(result.summary.tableCount, 1);
    assert.equal(result.summary.skippedTableCount, 2);
    const savedJson = fs.readFileSync(path.join(outputDir, 'test-data.json'), 'utf8');
    assert.doesNotMatch(savedJson, /private@example\.test/);
    assert.equal(result.summary.indexFile, 'test-data-index.json');
    const savedIndex = fs.readFileSync(path.join(outputDir, result.summary.indexFile), 'utf8');
    assert.doesNotMatch(savedIndex, /private@example\.test/);
    const parsedIndex = JSON.parse(savedIndex);
    assert.equal(parsedIndex.kind, 'test-data-index');
    assert.equal(parsedIndex.summary.tableCount, 1);
    assert.match(
      performanceLog,
      /\[perf\] test-data helperMs=\d+\.\d+ responseBytes=\d+ parseMs=\d+\.\d+ maskMs=\d+\.\d+ artifactMs=\d+\.\d+ totalMs=\d+\.\d+/
    );
    assert.doesNotMatch(performanceLog, /private@example\.test|APP\.CUSTOMERS/);
    assert.deepEqual(
      parsedIndex.tables
        .map(table => [
          table.table,
          table.status,
          table.rowCount,
          table.maskedColumnCount,
          table.policyEligibility,
          'rows' in table,
          'columns' in table,
        ])
        .sort((left, right) => left[0].localeCompare(right[0])),
      [
        ['AUDITLOG', 'skipped', 0, 0, 'denied', false, false],
        ['CUSTOMERS', 'exported', 1, 1, 'eligible', false, false],
        ['ORDERS', 'error', 0, 0, 'eligible', false, false],
      ]
    );
  } finally {
    process.stderr.write = originalStderrWrite;
    console.log = originalConsoleLog;
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('DB2 test-data batch connection failures are reported once without per-table retries', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-db2-test-data-connection-'));
  let helperCallCount = 0;
  try {
    const result = exportTestData({
      program: 'ORDERPGM',
      dependencies: { tables: [] },
      dbConfig: {
        host: 'ibmi.example.test',
        user: 'ZEUS',
        password: 'synthetic-secret',
        defaultSchema: 'APP',
      },
      outputDir,
      metadataPayload: {
        tables: [
          { schema: 'APP', table: 'CUSTOMERS', columns: [] },
          { schema: 'APP', table: 'ORDERS', columns: [] },
        ],
        tableLinks: [],
      },
      testDataConfig: {},
      helpers: {
        ensureJavaHelperCompiled() {},
        runJavaHelper() {
          helperCallCount += 1;
          return {
            status: 2,
            stderr: 'SQL30082 sign-on failed',
            stdout: '',
          };
        },
      },
    });

    assert.equal(helperCallCount, 1);
    assert.ok(result.payload.tables.every(table => table.status === 'error'));
    assert.ok(result.payload.tables.every(table => table.note === 'SQL30082 sign-on failed'));
    assert.equal(result.summary.skippedTableCount, 2);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('DB2 test-data batch errors redact the configured password in artifacts', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-db2-error-redaction-'));
  const password = 'synthetic-secret';
  try {
    const result = exportTestData({
      program: 'ORDERPGM',
      dependencies: { tables: [] },
      dbConfig: { host: 'ibmi.example.test', user: 'ZEUS', password, defaultSchema: 'APP' },
      outputDir,
      metadataPayload: {
        tables: [{ schema: 'APP', table: 'CUSTOMERS', columns: [] }],
        tableLinks: [],
      },
      testDataConfig: {},
      helpers: {
        ensureJavaHelperCompiled() {},
        runJavaHelper() {
          return { status: 2, stderr: `SQL30082 sign-on failed for ${password}`, stdout: '' };
        },
      },
    });

    assert.equal(result.payload.tables[0].status, 'error');
    assert.match(result.payload.tables[0].note, /SQL30082/);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-secret/);
    assert.doesNotMatch(
      fs.readFileSync(path.join(outputDir, 'test-data.json'), 'utf8'),
      /synthetic-secret/
    );
    assert.doesNotMatch(
      fs.readFileSync(path.join(outputDir, 'test-data.md'), 'utf8'),
      /synthetic-secret/
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('DB2 test-data continues bounded batches without rereading or exposing denied tables', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-db2-bounded-batches-'));
  const calls = [];
  const tableNames = Array.from(
    { length: 131 },
    (_, index) => `TABLE${String(index).padStart(3, '0')}`
  );
  try {
    const result = exportTestData({
      program: 'ORDERPGM',
      dependencies: { tables: [] },
      dbConfig: { host: 'ibmi.example.test', user: 'ZEUS', password: 'synthetic-secret' },
      outputDir,
      metadataPayload: {
        tables: [...tableNames, 'DENIED'].map(table => ({
          schema: 'APP',
          table,
          columns: [{ name: 'EMAIL' }],
        })),
      },
      testDataConfig: { limit: 1, denyTables: ['APP.DENIED'], maskColumns: ['EMAIL'] },
      helpers: {
        ensureJavaHelperCompiled() {},
        runJavaHelper(className, args) {
          const requested = fs
            .readFileSync(args[4], 'utf8')
            .trim()
            .split('\n')
            .map(line =>
              line.split('\t').map(value => Buffer.from(value, 'base64url').toString('utf8'))
            );
          assert.ok(requested.length <= 64);
          assert.ok(requested.every(([, table]) => table !== 'DENIED'));
          const processed = calls.length === 0 ? requested.slice(0, 3) : requested;
          calls.push(processed.map(([, table]) => table));
          return {
            status: 0,
            stdout: JSON.stringify({
              hasMore: processed.length < requested.length,
              results: processed.map(([schema, table]) => ({
                status: 'exported',
                data: {
                  schema,
                  table,
                  columns: ['EMAIL'],
                  rows: [{ EMAIL: 'private@example.test' }],
                  rowCount: 1,
                },
              })),
            }),
          };
        },
      },
    });
    assert.deepEqual(
      calls.map(entries => entries.length),
      [3, 64, 64]
    );
    assert.deepEqual(calls.flat(), tableNames);
    assert.equal(result.summary.tableCount, 131);
    assert.equal(result.summary.skippedTableCount, 1);
    assert.ok(
      result.payload.tables
        .filter(table => table.status === 'exported')
        .every(table => table.rows[0].EMAIL === 'MASKED')
    );
    assert.doesNotMatch(
      fs.readFileSync(path.join(outputDir, 'test-data.json'), 'utf8'),
      /private@example/
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('DB2 test-data retains completed batches and stops after a later connection failure', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-db2-late-failure-'));
  let calls = 0;
  try {
    const result = exportTestData({
      program: 'ORDERPGM',
      dependencies: { tables: [] },
      dbConfig: { host: 'ibmi.example.test', user: 'ZEUS', password: 'synthetic-secret' },
      outputDir,
      metadataPayload: {
        tables: Array.from({ length: 131 }, (_, index) => ({
          schema: 'APP',
          table: `TABLE${index}`,
          columns: [],
        })),
      },
      testDataConfig: { limit: 1 },
      helpers: {
        ensureJavaHelperCompiled() {},
        runJavaHelper(className, args) {
          calls += 1;
          if (calls === 2) throw new Error('SQL30082 connection failed');
          const entries = fs
            .readFileSync(args[4], 'utf8')
            .trim()
            .split('\n')
            .map(line =>
              line.split('\t').map(value => Buffer.from(value, 'base64url').toString('utf8'))
            );
          return {
            status: 0,
            stdout: JSON.stringify({
              results: entries.map(([schema, table]) => ({
                status: 'exported',
                data: { schema, table, rows: [], columns: [], rowCount: 0 },
              })),
            }),
          };
        },
      },
    });
    assert.equal(calls, 2);
    assert.equal(result.summary.tableCount, 64);
    assert.equal(result.summary.skippedTableCount, 67);
    assert.ok(
      result.payload.tables
        .filter(table => table.status === 'error')
        .every(table => /SQL30082/.test(table.note))
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('DB2 test-data rejects empty or inconsistent continuations without retrying', () => {
  for (const response of [
    { results: [], hasMore: true },
    { results: [{}], hasMore: false },
    { results: [{}, {}], hasMore: true },
    { results: [{}, {}, {}], hasMore: false },
    {
      results: [{ status: 'exported', data: { schema: 'OTHER', table: 'FIRST' } }],
      hasMore: true,
    },
  ]) {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-db2-invalid-batch-'));
    let calls = 0;
    try {
      const result = exportTestData({
        program: 'ORDERPGM',
        dependencies: { tables: [] },
        dbConfig: { host: 'ibmi.example.test', user: 'ZEUS', password: 'synthetic-secret' },
        outputDir,
        metadataPayload: {
          tables: ['FIRST', 'SECOND'].map(table => ({ schema: 'APP', table, columns: [] })),
        },
        testDataConfig: { limit: 1 },
        helpers: {
          ensureJavaHelperCompiled() {},
          runJavaHelper() {
            calls += 1;
            return { status: 0, stdout: JSON.stringify(response) };
          },
        },
      });
      assert.equal(calls, 1);
      assert.equal(result.summary.tableCount, 0);
      assert.ok(result.payload.tables.every(table => /Invalid helper output/.test(table.note)));
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  }
});

test('DB2 test-data masking plan merges global and table-specific masking rules', () => {
  const policy = buildTestDataPolicy({
    maskColumns: ['EMAIL'],
    maskRules: [
      {
        schema: 'APP',
        table: 'CUSTOMERS',
        columns: ['PHONE'],
        value: 'MASKED_PHONE',
      },
    ],
  });

  const maskingPlan = resolveMaskingPlanForTable(
    {
      schema: 'APP',
      table: 'CUSTOMERS',
      systemSchema: 'APP',
      systemName: 'CUSTPF',
    },
    policy
  );

  assert.deepEqual(maskingPlan.maskedColumns, ['EMAIL', 'PHONE']);
  assert.equal(maskingPlan.maskedColumnValues.get('EMAIL').value, 'MASKED');
  assert.equal(maskingPlan.maskedColumnValues.get('PHONE').value, 'MASKED_PHONE');
  assert.equal(maskingPlan.matchedRules.length, 1);
});

test('DB2 catalog semantic updates attach table identity, trigger relations, FK rules, and external object resolution', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-db2-semantic-updates-'));
  try {
    const { canonicalAnalysis, context } = createCanonicalFixture(tempRoot);
    const exportedTables = [
      {
        schema: 'APP',
        table: 'CUSTOMERS',
        systemSchema: 'APP',
        systemName: 'CUSTPF',
        objectType: 'TABLE',
        textDescription: 'Customer master',
        estimatedRowCount: 2400,
        lookupStrategy: 'IBM_I_CATALOG',
        columns: [{ name: 'CUSTNO', type: 'DECIMAL', primaryKey: true }],
        foreignKeys: [
          {
            column: 'COMPANY',
            referencesSchema: 'APP',
            referencesTable: 'COMPANY',
            referencesColumn: 'COMPANY',
            deleteRule: 'CASCADE',
            updateRule: 'RESTRICT',
          },
        ],
        triggers: [
          {
            schema: 'APP',
            name: 'CUSTOMER_AUDIT',
            eventManipulation: 'INSERT',
            actionTiming: 'AFTER',
            actionOrientation: 'ROW',
          },
        ],
        derivedObjects: [
          {
            schema: 'APP',
            name: 'CUSTOMERS_VIEW',
            objectType: 'VIEW',
          },
        ],
      },
    ];
    const linkage = buildDb2SourceLinkage({
      requestedTables: ['CUSTPF'],
      exportedTables,
      canonicalAnalysis,
      context,
    });

    const updates = buildDb2CatalogSemanticUpdates({
      canonicalAnalysis,
      tableLinks: linkage.tableLinks,
      exportedTables,
      externalObjects: [
        {
          requestedName: 'INVOICEP',
          library: 'APP',
          schema: 'APP',
          sqlName: 'INVOICE_PROCESS',
          systemName: 'INVOICEP',
          objectType: '*PGM',
          evidenceSource: 'OBJECT_STATISTICS',
          matchedBy: 'SYSTEM_NAME',
        },
      ],
    });

    assert.ok(
      updates.entities.tables.some(
        entry => entry.db2Identity && entry.db2Identity.systemName === 'CUSTPF'
      )
    );
    assert.ok(updates.entities.db2Triggers.some(entry => entry.name === 'CUSTOMER_AUDIT'));
    assert.ok(updates.entities.externalObjects.some(entry => entry.systemName === 'INVOICEP'));
    assert.ok(
      updates.entities.programs.some(
        entry => entry.name === 'INVOICEP' && entry.resolutionSource === 'CATALOG'
      )
    );
    assert.ok(updates.relations.some(entry => entry.type === 'HAS_TRIGGER'));
    assert.ok(updates.relations.some(entry => entry.type === 'DERIVES_OBJECT'));
    assert.ok(
      updates.relations.some(
        entry => entry.type === 'REFERENCES_TABLE' && entry.attributes.deleteRule === 'CASCADE'
      )
    );
    assert.ok(updates.relations.some(entry => entry.type === 'RESOLVES_TO_EXTERNAL_OBJECT'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
