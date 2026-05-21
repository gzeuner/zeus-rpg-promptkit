const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('node:stream');

const { createMcpServer } = require('../src/mcp/mcpServer');
const { MCP_AUDIT_SCHEMA_VERSION } = require('../src/mcp/mcpAuditLog');
const { encodeJsonRpcMessage, parseIncomingMessages } = require('../src/mcp/stdioTransport');

test('mcp initialize returns protocol and capabilities', async () => {
  const server = createMcpServer({ cwd: process.cwd() });
  const response = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {},
  });

  assert.equal(response.jsonrpc, '2.0');
  assert.equal(response.id, 1);
  assert.equal(response.result.protocolVersion, '2024-11-05');
  assert.equal(response.result.capabilities.tools.listChanged, false);
});

test('mcp rejects invalid JSON-RPC version with deterministic -32600 error', async () => {
  const server = createMcpServer({ cwd: process.cwd() });
  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '1.0',
      id: 2,
      method: 'initialize',
    }),
    (error) => {
      assert.equal(error.code, -32600);
      assert.equal(error.message, 'Invalid Request: jsonrpc must be "2.0"');
      return true;
    },
  );
});

test('mcp maps unknown methods to deterministic -32601 errors', async () => {
  const server = createMcpServer({ cwd: process.cwd() });
  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'zeus.unknown/method',
    }),
    (error) => {
      assert.equal(error.code, -32601);
      assert.equal(error.message, 'Method not found: zeus.unknown/method');
      return true;
    },
  );
});

test('mcp tools list and call health tool', async () => {
  const server = createMcpServer({ cwd: process.cwd() });
  const listResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 10,
    method: 'tools/list',
  });
  assert.equal(Array.isArray(listResponse.result.tools), true);
  assert.equal(listResponse.result.tools.some((tool) => tool.name === 'zeus.health'), true);

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 11,
    method: 'tools/call',
    params: {
      name: 'zeus.health',
      arguments: {},
    },
  });
  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.ok, true);
  assert.equal(listResponse.result.tools.some((tool) => tool.name === 'zeus.doctor'), true);
  assert.equal(listResponse.result.tools.some((tool) => tool.name === 'zeus.workflow'), true);
  assert.equal(listResponse.result.tools.some((tool) => tool.name === 'zeus.bundle'), true);
  assert.equal(listResponse.result.tools.some((tool) => tool.name === 'zeus.analyze'), true);
  assert.equal(listResponse.result.tools.some((tool) => tool.name === 'zeus.impact'), true);
  assert.equal(listResponse.result.tools.some((tool) => tool.name === 'zeus.assess-risk'), true);
  assert.equal(listResponse.result.tools.some((tool) => tool.name === 'zeus.query-table'), true);
  assert.equal(listResponse.result.tools.some((tool) => tool.name === 'zeus.query-sql'), true);
  assert.equal(listResponse.result.tools.some((tool) => tool.name === 'zeus.search-source'), true);
  assert.equal(listResponse.result.tools.some((tool) => tool.name === 'zeus.field-search'), true);
  assert.equal(listResponse.result.tools.some((tool) => tool.name === 'zeus.joblog'), true);
  assert.equal(listResponse.result.tools.some((tool) => tool.name === 'zeus.inspect-object'), true);
});

test('mcp tools call rejects unknown tool', async () => {
  const server = createMcpServer({ cwd: process.cwd() });
  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: {
        name: 'zeus.unknown',
      },
    }),
    /not allowed/i,
  );
});

test('mcp tools list only includes allowlisted tools', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    allowlistedTools: ['zeus.health'],
  });

  const listResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 13,
    method: 'tools/list',
  });

  assert.deepEqual(
    listResponse.result.tools.map((tool) => tool.name),
    ['zeus.health'],
  );
});

test('mcp tools call rejects tool outside allowlist', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    allowlistedTools: ['zeus.health'],
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 14,
      method: 'tools/call',
      params: {
        name: 'zeus.version',
      },
    }),
    /not allowed/i,
  );
});

test('mcp tools call doctor returns status-only checks without raw details', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    doctorRunner: () => ({
      hasCriticalFailure: true,
      checks: [
        { name: 'Java', status: 'PASS', details: 'java ok' },
        { name: 'JDBC Metadata', status: 'FAIL', details: 'password=super-secret' },
      ],
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 16,
    method: 'tools/call',
    params: {
      name: 'zeus.doctor',
      arguments: {
        profile: 'default-shared',
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.ok, false);
  assert.equal(callResponse.result.structuredContent.profile, 'default-shared');
  assert.equal(callResponse.result.structuredContent.summary.total, 2);
  assert.deepEqual(callResponse.result.structuredContent.summary.statuses, [
    { status: 'FAIL', count: 1 },
    { status: 'PASS', count: 1 },
  ]);
  assert.deepEqual(callResponse.result.structuredContent.checks, [
    { name: 'Java', status: 'PASS' },
    { name: 'JDBC Metadata', status: 'FAIL' },
  ]);
  assert.doesNotMatch(callResponse.result.content[0].text, /super-secret/);
  assert.doesNotMatch(callResponse.result.content[0].text, /password=/i);
});

test('mcp tools call doctor requires profile argument', async () => {
  const server = createMcpServer({ cwd: process.cwd() });
  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 17,
      method: 'tools/call',
      params: {
        name: 'zeus.doctor',
        arguments: {},
      },
    }),
    /profile is required/i,
  );
});

test('mcp tools call query-sql returns deterministic structured rows', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    querySqlRunner: () => ({
      defaultSchema: 'QIWS',
      libraryList: ['QIWS', 'QGPL'],
      columns: ['N', 'LABEL', 'PASSWORD'],
      rows: [
        { N: 1, LABEL: 'A', PASSWORD: 'super-secret', USER: 'MYUSER' },
        { N: 2, LABEL: 'B', PASSWORD: 'other-secret', NOTE: 'token=abc' },
      ],
      rowCount: 2,
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 18,
    method: 'tools/call',
    params: {
      name: 'zeus.query-sql',
      arguments: {
        profile: 'default-shared',
        sql: 'SELECT 1 AS N FROM SYSIBM.SYSDUMMY1',
        maxRows: 10,
        defaultSchema: 'QIWS',
        liblist: 'QIWS,QGPL',
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.ok, true);
  assert.equal(callResponse.result.structuredContent.profile, 'default-shared');
  assert.equal(callResponse.result.structuredContent.defaultSchema, 'QIWS');
  assert.deepEqual(callResponse.result.structuredContent.libraryList, ['QIWS', 'QGPL']);
  assert.deepEqual(callResponse.result.structuredContent.columns, ['N', 'LABEL', 'PASSWORD']);
  assert.deepEqual(callResponse.result.structuredContent.rows, [
    { N: 1, LABEL: 'A', PASSWORD: '[REDACTED]', USER: '[REDACTED]' },
    { N: 2, LABEL: 'B', PASSWORD: '[REDACTED]', NOTE: 'token=[REDACTED]' },
  ]);
  assert.equal(callResponse.result.structuredContent.rowCount, 2);
  assert.deepEqual(
    JSON.parse(callResponse.result.content[0].text),
    callResponse.result.structuredContent,
  );
  assert.doesNotMatch(callResponse.result.content[0].text, /super-secret|other-secret|token=abc|MYUSER/);
});

test('mcp tools call query-table returns deterministic table/column metadata', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    queryTableRunner: () => ({
      table: 'APP_TABLE_00',
      schema: 'APPDATA',
      requestedSchema: null,
      filter: 'CUST%',
      discoveredSchema: 'APPDATA',
      tableInfo: {
        rows: [
          {
            TABLE_SCHEMA: 'APPDATA',
            TABLE_NAME: 'APP_TABLE_00',
          },
        ],
      },
      columns: {
        rows: [
          {
            TABLE_SCHEMA: 'APPDATA',
            TABLE_NAME: 'APP_TABLE_00',
            COLUMN_NAME: 'CUSTOMER_ID',
            DATA_TYPE: 'CHAR',
            LENGTH: 12,
            NUMERIC_SCALE: 0,
            IS_NULLABLE: 'N',
            USER: 'APPUSR',
          },
          {
            TABLE_SCHEMA: 'APPDATA',
            TABLE_NAME: 'APP_TABLE_00',
            COLUMN_NAME: 'TOKEN_COL',
            DATA_TYPE: 'VARCHAR',
            LENGTH: 128,
            NUMERIC_SCALE: 0,
            IS_NULLABLE: 'Y',
            NOTE: 'token=abc123',
          },
        ],
      },
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 181,
    method: 'tools/call',
    params: {
      name: 'zeus.query-table',
      arguments: {
        profile: 'default-shared',
        table: 'app_table_00',
        filter: 'cust%',
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.ok, true);
  assert.equal(callResponse.result.structuredContent.profile, 'default-shared');
  assert.equal(callResponse.result.structuredContent.table, 'APP_TABLE_00');
  assert.equal(callResponse.result.structuredContent.schema, 'APPDATA');
  assert.equal(callResponse.result.structuredContent.requestedSchema, null);
  assert.equal(callResponse.result.structuredContent.filter, 'CUST%');
  assert.equal(callResponse.result.structuredContent.discoveredSchema, 'APPDATA');
  assert.deepEqual(callResponse.result.structuredContent.tableInfo, [
    { TABLE_SCHEMA: 'APPDATA', TABLE_NAME: 'APP_TABLE_00' },
  ]);
  assert.deepEqual(callResponse.result.structuredContent.columns, [
    {
      TABLE_SCHEMA: 'APPDATA',
      TABLE_NAME: 'APP_TABLE_00',
      COLUMN_NAME: 'CUSTOMER_ID',
      DATA_TYPE: 'CHAR',
      LENGTH: 12,
      NUMERIC_SCALE: 0,
      IS_NULLABLE: 'N',
      USER: 'APPUSR',
    },
    {
      TABLE_SCHEMA: 'APPDATA',
      TABLE_NAME: 'APP_TABLE_00',
      COLUMN_NAME: 'TOKEN_COL',
      DATA_TYPE: 'VARCHAR',
      LENGTH: 128,
      NUMERIC_SCALE: 0,
      IS_NULLABLE: 'Y',
      NOTE: 'token=[REDACTED]',
    },
  ]);
  assert.equal(callResponse.result.structuredContent.tableCount, 1);
  assert.equal(callResponse.result.structuredContent.columnCount, 2);
  assert.deepEqual(
    JSON.parse(callResponse.result.content[0].text),
    callResponse.result.structuredContent,
  );
  assert.doesNotMatch(callResponse.result.content[0].text, /abc123/);
});

test('mcp tools call query-table maps invalid filter pattern to -32602', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    queryTableRunner: () => {
      throw new Error('Invalid --filter pattern: BAD-!');
    },
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 182,
      method: 'tools/call',
      params: {
        name: 'zeus.query-table',
        arguments: {
          profile: 'default-shared',
          table: 'APP_TABLE_00',
          filter: 'BAD-!',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /invalid --filter pattern/i);
      return true;
    },
  );
});

test('mcp tools call query-sql rejects non-read-only SQL', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    querySqlRunner: () => {
      const error = new Error('Read-only SQL query must start with SELECT or WITH.');
      throw error;
    },
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 19,
      method: 'tools/call',
      params: {
        name: 'zeus.query-sql',
        arguments: {
          profile: 'default-shared',
          sql: 'UPDATE APP.T SET X = 1',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /read-only sql query/i);
      return true;
    },
  );
});

test('mcp tools call search-source returns deterministic structured payload', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    searchSourceRunner: () => ({
      sourceRoot: '/tmp/src',
      criteria: {
        searchTerm: 'CHAIN(',
        member: null,
        table: null,
        filePattern: '**/*.rpgle',
        caseSensitive: false,
        maxResults: 25,
      },
      noSourceFiles: false,
      resultCount: 2,
      matchedFileCount: 1,
      limitReached: false,
      matches: [
        { file: 'QRPGLESRC/ORDERPGM.rpgle', lineNumber: 41, line: 'chain(e) CUSTID CUSTOMER;' },
        { file: 'QRPGLESRC/ORDERPGM.rpgle', lineNumber: 88, line: 'chain ORDERKEY ORDERS;' },
      ],
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 183,
    method: 'tools/call',
    params: {
      name: 'zeus.search-source',
      arguments: {
        sourceRoot: './src',
        searchTerm: 'CHAIN(',
        filePattern: '*.rpgle',
        maxResults: 25,
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.ok, true);
  assert.equal(callResponse.result.structuredContent.sourceRoot, '/tmp/src');
  assert.deepEqual(callResponse.result.structuredContent.criteria, {
    searchTerm: 'CHAIN(',
    member: null,
    table: null,
    filePattern: '**/*.rpgle',
    caseSensitive: false,
    maxResults: 25,
  });
  assert.equal(callResponse.result.structuredContent.noSourceFiles, false);
  assert.equal(callResponse.result.structuredContent.resultCount, 2);
  assert.equal(callResponse.result.structuredContent.matchedFileCount, 1);
  assert.equal(callResponse.result.structuredContent.limitReached, false);
  assert.deepEqual(callResponse.result.structuredContent.matches, [
    { file: 'QRPGLESRC/ORDERPGM.rpgle', lineNumber: 41, line: 'chain(e) CUSTID CUSTOMER;' },
    { file: 'QRPGLESRC/ORDERPGM.rpgle', lineNumber: 88, line: 'chain ORDERKEY ORDERS;' },
  ]);
  assert.match(callResponse.result.structuredContent.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(
    JSON.parse(callResponse.result.content[0].text),
    callResponse.result.structuredContent,
  );
});

test('mcp tools call search-source applies payload item cap deterministically', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    searchSourceRunner: () => ({
      sourceRoot: '/tmp/src',
      criteria: {
        searchTerm: 'CHAIN(',
        member: null,
        table: null,
        filePattern: '**/*.rpgle',
        caseSensitive: false,
        maxResults: 25,
      },
      noSourceFiles: false,
      resultCount: 3,
      maxPayloadItems: 1,
      payloadResultCount: 1,
      payloadTruncated: true,
      matchedFileCount: 1,
      limitReached: false,
      matches: [
        { file: 'QRPGLESRC/ORDERPGM.rpgle', lineNumber: 41, line: 'chain(e) CUSTID CUSTOMER;' },
      ],
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 18301,
    method: 'tools/call',
    params: {
      name: 'zeus.search-source',
      arguments: {
        sourceRoot: './src',
        searchTerm: 'CHAIN(',
        maxPayloadItems: 1,
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.resultCount, 3);
  assert.equal(callResponse.result.structuredContent.maxPayloadItems, 1);
  assert.equal(callResponse.result.structuredContent.payloadResultCount, 1);
  assert.equal(callResponse.result.structuredContent.payloadTruncated, true);
  assert.equal(callResponse.result.structuredContent.matches.length, 1);
});

test('mcp tools call search-source maps invalid arguments to -32602', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    searchSourceRunner: () => {
      throw new Error('Provide at least one search criterion: --search-term, --member, or --table');
    },
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 1831,
      method: 'tools/call',
      params: {
        name: 'zeus.search-source',
        arguments: {
          sourceRoot: './src',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /provide at least one search criterion/i);
      return true;
    },
  );
});

test('mcp tools call search-source supports deterministic cursor pagination', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-search-source-'));
  const sourceRoot = path.join(tempRoot, 'src');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'A.rpgle'), 'CHAIN(E) CUSTID CUSTOMER;\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, 'B.rpgle'), 'CHAIN ORDERKEY ORDERS;\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, 'C.rpgle'), 'CHAIN ITEMID ITEMS;\n', 'utf8');

  const server = createMcpServer({
    cwd: process.cwd(),
  });

  try {
    const page1 = await server.handleRequest({
      jsonrpc: '2.0',
      id: 18323,
      method: 'tools/call',
      params: {
        name: 'zeus.search-source',
        arguments: {
          sourceRoot,
          searchTerm: 'CHAIN',
          maxResults: 10,
          maxPayloadItems: 2,
        },
      },
    });

    assert.equal(page1.result.isError, false);
    assert.equal(page1.result.structuredContent.resultCount, 3);
    assert.equal(page1.result.structuredContent.cursor, null);
    assert.equal(page1.result.structuredContent.cursorOffset, 0);
    assert.equal(page1.result.structuredContent.maxPayloadItems, 2);
    assert.equal(page1.result.structuredContent.payloadResultCount, 2);
    assert.equal(page1.result.structuredContent.payloadTruncated, true);
    assert.equal(typeof page1.result.structuredContent.nextCursor, 'string');
    assert.notEqual(page1.result.structuredContent.nextCursor, '2');
    assert.equal(page1.result.structuredContent.matches.length, 2);

    const page2 = await server.handleRequest({
      jsonrpc: '2.0',
      id: 18324,
      method: 'tools/call',
      params: {
        name: 'zeus.search-source',
        arguments: {
          sourceRoot,
          searchTerm: 'CHAIN',
          maxResults: 10,
          maxPayloadItems: 2,
          cursor: page1.result.structuredContent.nextCursor,
        },
      },
    });

    assert.equal(page2.result.isError, false);
    assert.equal(page2.result.structuredContent.resultCount, 3);
    assert.equal(page2.result.structuredContent.cursor, page1.result.structuredContent.nextCursor);
    assert.equal(page2.result.structuredContent.cursorOffset, 2);
    assert.equal(page2.result.structuredContent.maxPayloadItems, 2);
    assert.equal(page2.result.structuredContent.payloadResultCount, 1);
    assert.equal(page2.result.structuredContent.payloadTruncated, false);
    assert.equal(page2.result.structuredContent.nextCursor, null);
    assert.equal(page2.result.structuredContent.matches.length, 1);
    assert.notEqual(
      page2.result.structuredContent.matches[0].line,
      page1.result.structuredContent.matches[0].line,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('mcp tools call search-source maps invalid cursor to -32602', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-search-source-'));
  const sourceRoot = path.join(tempRoot, 'src');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'A.rpgle'), 'CHAIN(E) CUSTID CUSTOMER;\n', 'utf8');

  const server = createMcpServer({
    cwd: process.cwd(),
  });

  try {
    await assert.rejects(
      () => server.handleRequest({
        jsonrpc: '2.0',
        id: 18322,
        method: 'tools/call',
        params: {
          name: 'zeus.search-source',
          arguments: {
            sourceRoot,
            searchTerm: 'CHAIN',
            cursor: 'bad-cursor',
          },
        },
      }),
      (error) => {
        assert.equal(error.code, -32602);
        assert.match(error.message, /cursor/i);
        return true;
      },
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('mcp tools call search-source still accepts legacy numeric cursor input', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-search-source-'));
  const sourceRoot = path.join(tempRoot, 'src');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'A.rpgle'), 'CHAIN(E) CUSTID CUSTOMER;\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, 'B.rpgle'), 'CHAIN ORDERKEY ORDERS;\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, 'C.rpgle'), 'CHAIN ITEMID ITEMS;\n', 'utf8');

  const server = createMcpServer({
    cwd: process.cwd(),
  });

  try {
    const page = await server.handleRequest({
      jsonrpc: '2.0',
      id: 18325,
      method: 'tools/call',
      params: {
        name: 'zeus.search-source',
        arguments: {
          sourceRoot,
          searchTerm: 'CHAIN',
          maxResults: 10,
          maxPayloadItems: 2,
          cursor: '2',
        },
      },
    });

    assert.equal(page.result.isError, false);
    assert.equal(page.result.structuredContent.cursor, '2');
    assert.equal(page.result.structuredContent.cursorOffset, 2);
    assert.equal(page.result.structuredContent.matches.length, 1);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('mcp tools call search-source rejects legacy numeric cursor when fallback is disabled', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-search-source-'));
  const sourceRoot = path.join(tempRoot, 'src');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'A.rpgle'), 'CHAIN(E) CUSTID CUSTOMER;\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, 'B.rpgle'), 'CHAIN ORDERKEY ORDERS;\n', 'utf8');

  const server = createMcpServer({
    cwd: process.cwd(),
    allowLegacyNumericCursor: false,
  });

  try {
    await assert.rejects(
      () => server.handleRequest({
        jsonrpc: '2.0',
        id: 18326,
        method: 'tools/call',
        params: {
          name: 'zeus.search-source',
          arguments: {
            sourceRoot,
            searchTerm: 'CHAIN',
            cursor: '1',
          },
        },
      }),
      (error) => {
        assert.equal(error.code, -32602);
        assert.match(error.message, /legacy numeric cursor input is disabled/i);
        return true;
      },
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('mcp tools call field-search returns deterministic structured payload', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    fieldSearchRunner: () => ({
      sourceRoot: '/tmp/src',
      field: 'CUSTID',
      table: 'CUSTOMER',
      maxResults: 50,
      contextLines: 2,
      fileCount: 3,
      resultCount: 2,
      matchedFileCount: 1,
      truncated: false,
      matches: [
        {
          file: 'QRPGLESRC/ORDERPGM.rpgle',
          line: 21,
          text: 'chain(e) CUSTID CUSTOMER;',
          tableContexts: [{ table: 'CUSTOMER', intent: 'READS', role: 'FROM' }],
          contextBefore: [{ lineNo: 20, text: 'if CUSTID > 0;' }],
          contextAfter: [{ lineNo: 22, text: 'if %found(CUSTOMER);' }],
        },
        {
          file: 'QRPGLESRC/ORDERPGM.rpgle',
          line: 55,
          text: 'update CUSTOMER set NAME = :NAME where CUSTID = :CUSTID;',
          tableContexts: [{ table: 'CUSTOMER', intent: 'WRITES', role: 'SET' }],
          contextBefore: [],
          contextAfter: [],
        },
      ],
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1832,
    method: 'tools/call',
    params: {
      name: 'zeus.field-search',
      arguments: {
        sourceRoot: './src',
        field: 'custid',
        table: 'customer',
        maxResults: 50,
        contextLines: 2,
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.ok, true);
  assert.equal(callResponse.result.structuredContent.sourceRoot, '/tmp/src');
  assert.equal(callResponse.result.structuredContent.field, 'CUSTID');
  assert.equal(callResponse.result.structuredContent.table, 'CUSTOMER');
  assert.equal(callResponse.result.structuredContent.maxResults, 50);
  assert.equal(callResponse.result.structuredContent.cursor, null);
  assert.equal(callResponse.result.structuredContent.cursorOffset, 0);
  assert.equal(callResponse.result.structuredContent.nextCursor, null);
  assert.equal(callResponse.result.structuredContent.contextLines, 2);
  assert.equal(callResponse.result.structuredContent.fileCount, 3);
  assert.equal(callResponse.result.structuredContent.resultCount, 2);
  assert.equal(callResponse.result.structuredContent.matchedFileCount, 1);
  assert.equal(callResponse.result.structuredContent.truncated, false);
  assert.deepEqual(callResponse.result.structuredContent.matches, [
    {
      file: 'QRPGLESRC/ORDERPGM.rpgle',
      line: 21,
      text: 'chain(e) CUSTID CUSTOMER;',
      tableContexts: [{ table: 'CUSTOMER', intent: 'READS', role: 'FROM' }],
      contextBefore: [{ lineNo: 20, text: 'if CUSTID > 0;' }],
      contextAfter: [{ lineNo: 22, text: 'if %found(CUSTOMER);' }],
    },
    {
      file: 'QRPGLESRC/ORDERPGM.rpgle',
      line: 55,
      text: 'update CUSTOMER set NAME = :NAME where CUSTID = :CUSTID;',
      tableContexts: [{ table: 'CUSTOMER', intent: 'WRITES', role: 'SET' }],
      contextBefore: [],
      contextAfter: [],
    },
  ]);
  assert.match(callResponse.result.structuredContent.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(
    JSON.parse(callResponse.result.content[0].text),
    callResponse.result.structuredContent,
  );
});

test('mcp tools call field-search maps invalid arguments to -32602', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    fieldSearchRunner: () => {
      throw new Error('Field-search source root not found: /tmp/does-not-exist');
    },
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 1833,
      method: 'tools/call',
      params: {
        name: 'zeus.field-search',
        arguments: {
          sourceRoot: '/tmp/does-not-exist',
          field: 'CUSTID',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /field-search source root not found/i);
      return true;
    },
  );
});

test('mcp tools call field-search maps invalid maxPayloadItems to -32602', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-field-search-'));
  const sourceRoot = path.join(tempRoot, 'src');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'ORDERPGM.rpgle'), 'chain(e) CUSTID CUSTOMER;\n', 'utf8');

  const server = createMcpServer({
    cwd: process.cwd(),
  });

  try {
    await assert.rejects(
      () => server.handleRequest({
        jsonrpc: '2.0',
        id: 18331,
        method: 'tools/call',
        params: {
          name: 'zeus.field-search',
          arguments: {
            sourceRoot,
            field: 'CUSTID',
            maxPayloadItems: 0,
          },
        },
      }),
      (error) => {
        assert.equal(error.code, -32602);
        assert.match(error.message, /maxpayloaditems/i);
        return true;
      },
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('mcp tools call field-search supports deterministic cursor pagination', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-field-search-'));
  const sourceRoot = path.join(tempRoot, 'src');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'A.rpgle'), 'chain(e) CUSTID CUSTOMER;\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, 'B.rpgle'), 'if CUSTID > 0;\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, 'C.rpgle'), 'where CUSTID = :CUSTID;\n', 'utf8');

  const server = createMcpServer({
    cwd: process.cwd(),
  });

  try {
    const page1 = await server.handleRequest({
      jsonrpc: '2.0',
      id: 18332,
      method: 'tools/call',
      params: {
        name: 'zeus.field-search',
        arguments: {
          sourceRoot,
          field: 'CUSTID',
          maxResults: 10,
          maxPayloadItems: 2,
          contextLines: 0,
        },
      },
    });

    assert.equal(page1.result.isError, false);
    assert.equal(page1.result.structuredContent.resultCount, 3);
    assert.equal(page1.result.structuredContent.cursor, null);
    assert.equal(page1.result.structuredContent.cursorOffset, 0);
    assert.equal(page1.result.structuredContent.maxPayloadItems, 2);
    assert.equal(page1.result.structuredContent.payloadResultCount, 2);
    assert.equal(page1.result.structuredContent.payloadTruncated, true);
    assert.equal(typeof page1.result.structuredContent.nextCursor, 'string');
    assert.notEqual(page1.result.structuredContent.nextCursor, '2');
    assert.equal(page1.result.structuredContent.matches.length, 2);

    const page2 = await server.handleRequest({
      jsonrpc: '2.0',
      id: 18333,
      method: 'tools/call',
      params: {
        name: 'zeus.field-search',
        arguments: {
          sourceRoot,
          field: 'CUSTID',
          maxResults: 10,
          maxPayloadItems: 2,
          contextLines: 0,
          cursor: page1.result.structuredContent.nextCursor,
        },
      },
    });

    assert.equal(page2.result.isError, false);
    assert.equal(page2.result.structuredContent.resultCount, 3);
    assert.equal(page2.result.structuredContent.cursor, page1.result.structuredContent.nextCursor);
    assert.equal(page2.result.structuredContent.cursorOffset, 2);
    assert.equal(page2.result.structuredContent.maxPayloadItems, 2);
    assert.equal(page2.result.structuredContent.payloadResultCount, 1);
    assert.equal(page2.result.structuredContent.payloadTruncated, false);
    assert.equal(page2.result.structuredContent.nextCursor, null);
    assert.equal(page2.result.structuredContent.matches.length, 1);
    assert.notEqual(
      page2.result.structuredContent.matches[0].text,
      page1.result.structuredContent.matches[0].text,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('mcp tools call field-search maps invalid cursor to -32602', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-field-search-'));
  const sourceRoot = path.join(tempRoot, 'src');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'A.rpgle'), 'chain(e) CUSTID CUSTOMER;\n', 'utf8');

  const server = createMcpServer({
    cwd: process.cwd(),
  });

  try {
    await assert.rejects(
      () => server.handleRequest({
        jsonrpc: '2.0',
        id: 18334,
        method: 'tools/call',
        params: {
          name: 'zeus.field-search',
          arguments: {
            sourceRoot,
            field: 'CUSTID',
            cursor: 'bad-cursor',
          },
        },
      }),
      (error) => {
        assert.equal(error.code, -32602);
        assert.match(error.message, /cursor/i);
        return true;
      },
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('mcp tools call joblog returns deterministic structured payload', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    joblogRunner: () => ({
      profile: 'default-shared',
      job: 'QPADEV',
      severity: 'ERROR',
      maxMessages: 50,
      rowCount: 2,
      uniqueMessageIdCount: 2,
      limitReached: false,
      columns: ['JOB_NAME', 'MESSAGE_ID', 'MESSAGE_TYPE', 'MESSAGE_TEXT', 'MESSAGE_TIMESTAMP'],
      rows: [
        {
          JOB_NAME: 'QPADEV0001',
          MESSAGE_ID: 'CPF0001',
          MESSAGE_TYPE: 'ERROR',
          MESSAGE_TEXT: 'Failure on update',
          MESSAGE_TIMESTAMP: '2026-05-21-11.20.00.000000',
        },
        {
          JOB_NAME: 'QPADEV0002',
          MESSAGE_ID: 'CPF0002',
          MESSAGE_TYPE: 'ERROR',
          MESSAGE_TEXT: 'Token=abc123',
          MESSAGE_TIMESTAMP: '2026-05-21-11.19.00.000000',
        },
      ],
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1834,
    method: 'tools/call',
    params: {
      name: 'zeus.joblog',
      arguments: {
        profile: 'default-shared',
        job: 'qpadev',
        severity: 'ERROR',
        maxMessages: 50,
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.ok, true);
  assert.equal(callResponse.result.structuredContent.profile, 'default-shared');
  assert.equal(callResponse.result.structuredContent.job, 'QPADEV');
  assert.equal(callResponse.result.structuredContent.severity, 'ERROR');
  assert.equal(callResponse.result.structuredContent.maxMessages, 50);
  assert.equal(callResponse.result.structuredContent.rowCount, 2);
  assert.equal(callResponse.result.structuredContent.uniqueMessageIdCount, 2);
  assert.equal(callResponse.result.structuredContent.limitReached, false);
  assert.deepEqual(callResponse.result.structuredContent.columns, ['JOB_NAME', 'MESSAGE_ID', 'MESSAGE_TYPE', 'MESSAGE_TEXT', 'MESSAGE_TIMESTAMP']);
  assert.deepEqual(callResponse.result.structuredContent.rows, [
    {
      JOB_NAME: 'QPADEV0001',
      MESSAGE_ID: 'CPF0001',
      MESSAGE_TYPE: 'ERROR',
      MESSAGE_TEXT: 'Failure on update',
      MESSAGE_TIMESTAMP: '2026-05-21-11.20.00.000000',
    },
    {
      JOB_NAME: 'QPADEV0002',
      MESSAGE_ID: 'CPF0002',
      MESSAGE_TYPE: 'ERROR',
      MESSAGE_TEXT: 'Token=[REDACTED]',
      MESSAGE_TIMESTAMP: '2026-05-21-11.19.00.000000',
    },
  ]);
  assert.match(callResponse.result.structuredContent.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(
    JSON.parse(callResponse.result.content[0].text),
    callResponse.result.structuredContent,
  );
  assert.doesNotMatch(callResponse.result.content[0].text, /abc123/);
});

test('mcp tools call joblog maps invalid arguments to -32602', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    joblogRunner: () => {
      throw new Error('Invalid option: --severity must be one of WARNING, ERROR, INFO');
    },
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 1835,
      method: 'tools/call',
      params: {
        name: 'zeus.joblog',
        arguments: {
          profile: 'default-shared',
          severity: 'FATAL',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /--severity/);
      return true;
    },
  );
});

test('mcp tools call inspect-object returns deterministic structured payload', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    inspectObjectRunner: () => ({
      profile: 'default-shared',
      lib: 'APPLIB',
      name: 'ORDERPGM',
      type: '*PGM',
      journalOnly: false,
      rowCount: 1,
      columns: ['NAME', 'TYPE', 'LIBRARY', 'OWNER'],
      rows: [
        {
          NAME: 'ORDERPGM',
          TYPE: '*PGM',
          LIBRARY: 'APPLIB',
          OWNER: 'QPGMR',
          TEXT: 'Order entry program',
        },
      ],
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1836,
    method: 'tools/call',
    params: {
      name: 'zeus.inspect-object',
      arguments: {
        profile: 'default-shared',
        lib: 'applib',
        name: 'orderpgm',
        type: '*PGM',
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.ok, true);
  assert.equal(callResponse.result.structuredContent.profile, 'default-shared');
  assert.equal(callResponse.result.structuredContent.lib, 'APPLIB');
  assert.equal(callResponse.result.structuredContent.name, 'ORDERPGM');
  assert.equal(callResponse.result.structuredContent.type, '*PGM');
  assert.equal(callResponse.result.structuredContent.journalOnly, false);
  assert.equal(callResponse.result.structuredContent.rowCount, 1);
  assert.deepEqual(callResponse.result.structuredContent.columns, ['NAME', 'TYPE', 'LIBRARY', 'OWNER']);
  assert.deepEqual(callResponse.result.structuredContent.rows, [
    {
      NAME: 'ORDERPGM',
      TYPE: '*PGM',
      LIBRARY: 'APPLIB',
      OWNER: 'QPGMR',
      TEXT: 'Order entry program',
    },
  ]);
  assert.match(callResponse.result.structuredContent.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(
    JSON.parse(callResponse.result.content[0].text),
    callResponse.result.structuredContent,
  );
});

test('mcp tools call inspect-object maps invalid arguments to -32602', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    inspectObjectRunner: () => {
      throw new Error('Invalid arguments for zeus.inspect-object: type must be one of *PGM, *FILE.');
    },
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 1837,
      method: 'tools/call',
      params: {
        name: 'zeus.inspect-object',
        arguments: {
          profile: 'default-shared',
          lib: 'APPLIB',
          name: 'ORDERPGM',
          type: '*BAD',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /type must be one of/i);
      return true;
    },
  );
});

test('mcp tools call workflow returns deterministic structured payload', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    workflowRunner: () => ({
      profile: 'default-shared',
      program: 'ORDERPGM',
      schemaVersion: 1,
      kind: 'workflow-run-manifest',
      generatedAt: '2026-05-21T11:10:00.000Z',
      preset: {
        available: true,
        name: 'modernization-review',
        title: 'Modernization Review',
        analyzeMode: 'modernization',
        promptTemplateCount: 3,
        workflowKeyCount: 2,
        bundleArtifactCount: 4,
        reviewWorkflow: {
          intendedAudienceCount: 2,
          keyQuestionsAnsweredCount: 3,
          expectedDecisionsCount: 2,
        },
      },
      analyzeRun: {
        available: true,
        status: 'succeeded',
        completedAt: '2026-05-21T11:09:00.000Z',
        generatedArtifactCount: 18,
        safeSharingEnabled: true,
        guidedModeName: 'modernization',
      },
      bundle: {
        available: true,
        zipPath: 'ORDERPGM-modernization-review-bundle.zip',
        totalFiles: 12,
        totalSizeBytes: 4096,
      },
      reproducibility: {
        available: true,
        enabled: true,
        contentFingerprint: 'abc123',
      },
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 184,
    method: 'tools/call',
    params: {
      name: 'zeus.workflow',
      arguments: {
        profile: 'default-shared',
        program: 'orderpgm',
        out: './output',
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.ok, true);
  assert.equal(callResponse.result.structuredContent.profile, 'default-shared');
  assert.equal(callResponse.result.structuredContent.program, 'ORDERPGM');
  assert.equal(callResponse.result.structuredContent.schemaVersion, 1);
  assert.equal(callResponse.result.structuredContent.kind, 'workflow-run-manifest');
  assert.equal(callResponse.result.structuredContent.generatedAt, '2026-05-21T11:10:00.000Z');
  assert.deepEqual(callResponse.result.structuredContent.preset, {
    available: true,
    name: 'modernization-review',
    title: 'Modernization Review',
    analyzeMode: 'modernization',
    promptTemplateCount: 3,
    workflowKeyCount: 2,
    bundleArtifactCount: 4,
    reviewWorkflow: {
      intendedAudienceCount: 2,
      keyQuestionsAnsweredCount: 3,
      expectedDecisionsCount: 2,
    },
  });
  assert.deepEqual(callResponse.result.structuredContent.analyzeRun, {
    available: true,
    status: 'succeeded',
    completedAt: '2026-05-21T11:09:00.000Z',
    generatedArtifactCount: 18,
    safeSharingEnabled: true,
    guidedModeName: 'modernization',
  });
  assert.deepEqual(callResponse.result.structuredContent.bundle, {
    available: true,
    zipPath: 'ORDERPGM-modernization-review-bundle.zip',
    totalFiles: 12,
    totalSizeBytes: 4096,
  });
  assert.deepEqual(callResponse.result.structuredContent.reproducibility, {
    available: true,
    enabled: true,
    contentFingerprint: 'abc123',
  });
  assert.match(callResponse.result.structuredContent.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(
    JSON.parse(callResponse.result.content[0].text),
    callResponse.result.structuredContent,
  );
});

test('mcp tools call workflow maps invalid arguments to -32602', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    workflowRunner: () => {
      throw new Error('Workflow run manifest not found: /tmp/output/ORDERPGM/workflow-run-manifest.json. Run workflow first.');
    },
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 185,
      method: 'tools/call',
      params: {
        name: 'zeus.workflow',
        arguments: {
          program: 'ORDERPGM',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /workflow run manifest not found/i);
      return true;
    },
  );
});

test('mcp tools call bundle returns deterministic structured payload', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    bundleRunner: () => ({
      profile: 'default-shared',
      program: 'ORDERPGM',
      manifest: {
        schemaVersion: 1,
        generatedAt: '2026-05-21T11:05:00.000Z',
        summary: {
          totalFiles: 12,
          totalSizeBytes: 4096,
          jsonFiles: 6,
          markdownFiles: 5,
          htmlFiles: 1,
        },
        safeSharing: {
          enabled: true,
          sourceDir: 'safe-sharing',
          redactionManifestFile: 'safe-sharing/redaction-manifest.json',
        },
      },
      files: {
        count: 3,
        paths: ['analysis-index.json', 'manifest.json', 'report.md'],
      },
      artifacts: {
        count: 3,
        totalSizeBytes: 3072,
        kinds: {
          json: 2,
          markdown: 1,
        },
      },
      analyzeRun: {
        available: true,
        status: 'succeeded',
        completedAt: '2026-05-21T11:00:00.000Z',
        artifactCount: 17,
      },
      sourceProvenance: {
        available: true,
        sourceLib: 'APPLIB',
        transportUsed: 'sftp',
        fileCount: 2,
        exportedFileCount: 2,
        failedFileCount: 0,
        traceableFileCount: 2,
      },
      bundleOutputs: {
        root: '/tmp/bundles',
        analysisBundleFile: 'ORDERPGM-analysis-bundle.zip',
        analysisBundleExists: true,
        safeSharingBundleFile: 'ORDERPGM-safe-sharing-bundle.zip',
        safeSharingBundleExists: true,
      },
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 186,
    method: 'tools/call',
    params: {
      name: 'zeus.bundle',
      arguments: {
        profile: 'default-shared',
        program: 'orderpgm',
        sourceOutputRoot: './output',
        output: './bundles',
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.ok, true);
  assert.equal(callResponse.result.structuredContent.profile, 'default-shared');
  assert.equal(callResponse.result.structuredContent.program, 'ORDERPGM');
  assert.deepEqual(callResponse.result.structuredContent.manifest, {
    schemaVersion: 1,
    generatedAt: '2026-05-21T11:05:00.000Z',
    summary: {
      totalFiles: 12,
      totalSizeBytes: 4096,
      jsonFiles: 6,
      markdownFiles: 5,
      htmlFiles: 1,
    },
    safeSharing: {
      enabled: true,
      sourceDir: 'safe-sharing',
      redactionManifestFile: 'safe-sharing/redaction-manifest.json',
    },
  });
  assert.deepEqual(callResponse.result.structuredContent.files, {
    count: 3,
    paths: ['analysis-index.json', 'manifest.json', 'report.md'],
  });
  assert.deepEqual(callResponse.result.structuredContent.artifacts, {
    count: 3,
    totalSizeBytes: 3072,
    kinds: [
      { kind: 'json', count: 2 },
      { kind: 'markdown', count: 1 },
    ],
  });
  assert.deepEqual(callResponse.result.structuredContent.analyzeRun, {
    available: true,
    status: 'succeeded',
    completedAt: '2026-05-21T11:00:00.000Z',
    artifactCount: 17,
  });
  assert.deepEqual(callResponse.result.structuredContent.sourceProvenance, {
    available: true,
    sourceLib: 'APPLIB',
    transportUsed: 'sftp',
    fileCount: 2,
    exportedFileCount: 2,
    failedFileCount: 0,
    traceableFileCount: 2,
  });
  assert.deepEqual(callResponse.result.structuredContent.bundleOutputs, {
    root: '/tmp/bundles',
    analysisBundleFile: 'ORDERPGM-analysis-bundle.zip',
    analysisBundleExists: true,
    safeSharingBundleFile: 'ORDERPGM-safe-sharing-bundle.zip',
    safeSharingBundleExists: true,
  });
  assert.match(callResponse.result.structuredContent.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(
    JSON.parse(callResponse.result.content[0].text),
    callResponse.result.structuredContent,
  );
});

test('mcp tools call bundle maps invalid arguments to -32602', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    bundleRunner: () => {
      throw new Error('Bundle manifest not found: /tmp/output/ORDERPGM/bundle-manifest.json. Run bundle first.');
    },
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 187,
      method: 'tools/call',
      params: {
        name: 'zeus.bundle',
        arguments: {
          program: 'ORDERPGM',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /bundle manifest not found/i);
      return true;
    },
  );
});

test('mcp tools call analyze returns deterministic structured payload', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    analyzeRunner: () => ({
      profile: 'default-shared',
      program: 'ORDERPGM',
      status: 'succeeded',
      completedAt: '2026-05-21T11:00:00.000Z',
      durationMs: 1234,
      reproducible: true,
      summary: {
        stageCount: 8,
        completedStageCount: 8,
        failedStageCount: 0,
        diagnosticCount: 2,
        errorCount: 0,
        warningCount: 1,
        generatedArtifactCount: 17,
        sourceFileCount: 3,
      },
      artifacts: {
        count: 3,
        files: ['analysis-index.json', 'canonical-analysis.json', 'program-call-tree.json'],
      },
      analysisIndex: {
        available: true,
        selectedMode: 'impact',
        selectedPreset: 'impact-review',
        taskCount: 7,
        guidedModeCount: 5,
      },
      graph: {
        available: true,
        nodeCount: 12,
        edgeCount: 18,
        programCount: 7,
        tableCount: 5,
      },
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 188,
    method: 'tools/call',
    params: {
      name: 'zeus.analyze',
      arguments: {
        profile: 'default-shared',
        program: 'orderpgm',
        out: './output',
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.ok, true);
  assert.equal(callResponse.result.structuredContent.profile, 'default-shared');
  assert.equal(callResponse.result.structuredContent.program, 'ORDERPGM');
  assert.equal(callResponse.result.structuredContent.status, 'succeeded');
  assert.equal(callResponse.result.structuredContent.completedAt, '2026-05-21T11:00:00.000Z');
  assert.equal(callResponse.result.structuredContent.durationMs, 1234);
  assert.equal(callResponse.result.structuredContent.reproducible, true);
  assert.deepEqual(callResponse.result.structuredContent.summary, {
    stageCount: 8,
    completedStageCount: 8,
    failedStageCount: 0,
    diagnosticCount: 2,
    errorCount: 0,
    warningCount: 1,
    generatedArtifactCount: 17,
    sourceFileCount: 3,
  });
  assert.deepEqual(callResponse.result.structuredContent.artifacts, {
    count: 3,
    files: ['analysis-index.json', 'canonical-analysis.json', 'program-call-tree.json'],
  });
  assert.deepEqual(callResponse.result.structuredContent.analysisIndex, {
    available: true,
    selectedMode: 'impact',
    selectedPreset: 'impact-review',
    taskCount: 7,
    guidedModeCount: 5,
  });
  assert.deepEqual(callResponse.result.structuredContent.graph, {
    available: true,
    nodeCount: 12,
    edgeCount: 18,
    programCount: 7,
    tableCount: 5,
  });
  assert.match(callResponse.result.structuredContent.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(
    JSON.parse(callResponse.result.content[0].text),
    callResponse.result.structuredContent,
  );
});

test('mcp tools call analyze maps invalid arguments to -32602', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    analyzeRunner: () => {
      throw new Error('Analyze run manifest not found: /tmp/output/ORDERPGM/analyze-run-manifest.json');
    },
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 189,
      method: 'tools/call',
      params: {
        name: 'zeus.analyze',
        arguments: {
          program: 'ORDERPGM',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /analyze run manifest not found/i);
      return true;
    },
  );
});

test('mcp tools call impact returns deterministic structured payload', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    impactRunner: () => ({
      profile: 'default-shared',
      target: 'ORDERPGM',
      program: 'ORDERPGM',
      graphPath: '/tmp/impact/program-call-tree.json',
      outputProgramDir: '/tmp/impact/ORDERPGM',
      result: {
        target: 'ORDERPGM',
        type: 'PROGRAM',
        directCallers: ['CALLERA', 'CALLERB'],
        indirectCallers: ['CALLERC'],
        totalAffectedPrograms: 3,
        ambiguity: {
          targetAmbiguous: true,
          targetUnresolved: false,
          ambiguousPrograms: ['ORDERPGM'],
          unresolvedPrograms: [],
        },
      },
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 190,
    method: 'tools/call',
    params: {
      name: 'zeus.impact',
      arguments: {
        profile: 'default-shared',
        target: 'orderpgm',
        program: 'orderpgm',
        out: './output',
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.ok, true);
  assert.equal(callResponse.result.structuredContent.service, 'zeus-rpg-promptkit');
  assert.equal(callResponse.result.structuredContent.profile, 'default-shared');
  assert.equal(callResponse.result.structuredContent.target, 'ORDERPGM');
  assert.equal(callResponse.result.structuredContent.program, 'ORDERPGM');
  assert.equal(callResponse.result.structuredContent.type, 'PROGRAM');
  assert.equal(callResponse.result.structuredContent.cursor, null);
  assert.equal(callResponse.result.structuredContent.cursorOffset, 0);
  assert.equal(callResponse.result.structuredContent.nextCursor, null);
  assert.equal(callResponse.result.structuredContent.maxItems, 100);
  assert.deepEqual(callResponse.result.structuredContent.directPrograms, []);
  assert.deepEqual(callResponse.result.structuredContent.indirectPrograms, []);
  assert.deepEqual(callResponse.result.structuredContent.directCallers, ['CALLERA', 'CALLERB']);
  assert.deepEqual(callResponse.result.structuredContent.indirectCallers, ['CALLERC']);
  assert.equal(callResponse.result.structuredContent.directProgramsCount, 0);
  assert.equal(callResponse.result.structuredContent.indirectProgramsCount, 0);
  assert.equal(callResponse.result.structuredContent.directCallersCount, 2);
  assert.equal(callResponse.result.structuredContent.indirectCallersCount, 1);
  assert.equal(callResponse.result.structuredContent.directProgramsTruncated, false);
  assert.equal(callResponse.result.structuredContent.indirectProgramsTruncated, false);
  assert.equal(callResponse.result.structuredContent.directCallersTruncated, false);
  assert.equal(callResponse.result.structuredContent.indirectCallersTruncated, false);
  assert.equal(callResponse.result.structuredContent.totalAffectedPrograms, 3);
  assert.deepEqual(callResponse.result.structuredContent.ambiguity, {
    targetAmbiguous: true,
    targetUnresolved: false,
    ambiguousPrograms: ['ORDERPGM'],
    unresolvedPrograms: [],
  });
  assert.match(callResponse.result.structuredContent.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(
    JSON.parse(callResponse.result.content[0].text),
    callResponse.result.structuredContent,
  );
});

test('mcp tools call impact applies maxItems cap deterministically', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    impactRunner: () => ({
      profile: 'default-shared',
      target: 'ORDERPGM',
      program: 'ORDERPGM',
      result: {
        type: 'PROGRAM',
        directPrograms: ['DP1', 'DP2'],
        indirectPrograms: ['IP1', 'IP2'],
        directCallers: ['DC1', 'DC2'],
        indirectCallers: ['IC1', 'IC2'],
        totalAffectedPrograms: 8,
        ambiguity: {
          targetAmbiguous: false,
          targetUnresolved: false,
          ambiguousPrograms: [],
          unresolvedPrograms: [],
        },
      },
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1901,
    method: 'tools/call',
    params: {
      name: 'zeus.impact',
      arguments: {
        target: 'ORDERPGM',
        maxItems: 1,
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.cursor, null);
  assert.equal(callResponse.result.structuredContent.cursorOffset, 0);
  assert.equal(typeof callResponse.result.structuredContent.nextCursor, 'string');
  assert.notEqual(callResponse.result.structuredContent.nextCursor, '1');
  assert.equal(callResponse.result.structuredContent.maxItems, 1);
  assert.deepEqual(callResponse.result.structuredContent.directPrograms, ['DP1']);
  assert.deepEqual(callResponse.result.structuredContent.indirectPrograms, ['IP1']);
  assert.deepEqual(callResponse.result.structuredContent.directCallers, ['DC1']);
  assert.deepEqual(callResponse.result.structuredContent.indirectCallers, ['IC1']);
  assert.equal(callResponse.result.structuredContent.directProgramsCount, 2);
  assert.equal(callResponse.result.structuredContent.indirectProgramsCount, 2);
  assert.equal(callResponse.result.structuredContent.directCallersCount, 2);
  assert.equal(callResponse.result.structuredContent.indirectCallersCount, 2);
  assert.equal(callResponse.result.structuredContent.directProgramsTruncated, true);
  assert.equal(callResponse.result.structuredContent.indirectProgramsTruncated, true);
  assert.equal(callResponse.result.structuredContent.directCallersTruncated, true);
  assert.equal(callResponse.result.structuredContent.indirectCallersTruncated, true);
});

test('mcp tools call impact supports deterministic cursor pagination', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    impactRunner: () => ({
      profile: 'default-shared',
      target: 'ORDERPGM',
      program: 'ORDERPGM',
      result: {
        type: 'PROGRAM',
        directPrograms: ['DP1', 'DP2', 'DP3'],
        indirectPrograms: ['IP1', 'IP2', 'IP3'],
        directCallers: ['DC1', 'DC2', 'DC3'],
        indirectCallers: ['IC1', 'IC2', 'IC3'],
        totalAffectedPrograms: 12,
        ambiguity: {
          targetAmbiguous: false,
          targetUnresolved: false,
          ambiguousPrograms: [],
          unresolvedPrograms: [],
        },
      },
    }),
  });

  const page1 = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1902,
    method: 'tools/call',
    params: {
      name: 'zeus.impact',
      arguments: {
        target: 'ORDERPGM',
        maxItems: 2,
      },
    },
  });

  assert.equal(page1.result.isError, false);
  assert.equal(page1.result.structuredContent.cursor, null);
  assert.equal(page1.result.structuredContent.cursorOffset, 0);
  assert.equal(typeof page1.result.structuredContent.nextCursor, 'string');
  assert.notEqual(page1.result.structuredContent.nextCursor, '2');
  assert.deepEqual(page1.result.structuredContent.directPrograms, ['DP1', 'DP2']);
  assert.deepEqual(page1.result.structuredContent.indirectPrograms, ['IP1', 'IP2']);
  assert.deepEqual(page1.result.structuredContent.directCallers, ['DC1', 'DC2']);
  assert.deepEqual(page1.result.structuredContent.indirectCallers, ['IC1', 'IC2']);
  assert.equal(page1.result.structuredContent.directProgramsTruncated, true);
  assert.equal(page1.result.structuredContent.indirectProgramsTruncated, true);
  assert.equal(page1.result.structuredContent.directCallersTruncated, true);
  assert.equal(page1.result.structuredContent.indirectCallersTruncated, true);

  const page2 = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1903,
    method: 'tools/call',
    params: {
      name: 'zeus.impact',
      arguments: {
        target: 'ORDERPGM',
        maxItems: 2,
        cursor: page1.result.structuredContent.nextCursor,
      },
    },
  });

  assert.equal(page2.result.isError, false);
  assert.equal(page2.result.structuredContent.cursor, page1.result.structuredContent.nextCursor);
  assert.equal(page2.result.structuredContent.cursorOffset, 2);
  assert.equal(page2.result.structuredContent.nextCursor, null);
  assert.deepEqual(page2.result.structuredContent.directPrograms, ['DP3']);
  assert.deepEqual(page2.result.structuredContent.indirectPrograms, ['IP3']);
  assert.deepEqual(page2.result.structuredContent.directCallers, ['DC3']);
  assert.deepEqual(page2.result.structuredContent.indirectCallers, ['IC3']);
  assert.equal(page2.result.structuredContent.directProgramsTruncated, false);
  assert.equal(page2.result.structuredContent.indirectProgramsTruncated, false);
  assert.equal(page2.result.structuredContent.directCallersTruncated, false);
  assert.equal(page2.result.structuredContent.indirectCallersTruncated, false);
});

test('mcp tools call impact maps invalid arguments to -32602', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    impactRunner: () => {
      throw new Error('Output directory not found: /tmp/does-not-exist');
    },
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 191,
      method: 'tools/call',
      params: {
        name: 'zeus.impact',
        arguments: {
          target: 'ORDERPGM',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /output directory not found/i);
      return true;
    },
  );
});

test('mcp tools call impact maps invalid maxItems to -32602', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    impactRunner: () => ({
      profile: 'default-shared',
      target: 'ORDERPGM',
      program: 'ORDERPGM',
      result: {},
    }),
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 1911,
      method: 'tools/call',
      params: {
        name: 'zeus.impact',
        arguments: {
          target: 'ORDERPGM',
          maxItems: 0,
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /maxitems/i);
      return true;
    },
  );
});

test('mcp tools call impact maps invalid cursor to -32602', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    impactRunner: () => ({
      profile: 'default-shared',
      target: 'ORDERPGM',
      program: 'ORDERPGM',
      result: {},
    }),
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 1912,
      method: 'tools/call',
      params: {
        name: 'zeus.impact',
        arguments: {
          target: 'ORDERPGM',
          cursor: 'bad-cursor',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /cursor/i);
      return true;
    },
  );
});

test('mcp tools call assess-risk returns deterministic structured payload', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    assessRiskRunner: () => ({
      profile: 'default-shared',
      program: 'ORDERPGM',
      summary: {
        riskLevel: 'HIGH',
        distribution: '1 green / 2 yellow / 1 red',
      },
      riskMetrics: {
        totalAccesses: 4,
        greenCount: 1,
        yellowCount: 2,
        redCount: 1,
      },
      recommendations: [
        'Review dynamic SQL usage around ORDERHDR.',
      ],
      accessPoints: [
        {
          type: 'IO',
          subtype: 'CHAIN',
          name: 'ORDERHDR',
          intent: 'READ',
          tables: ['ORDERHDR'],
          assessment: {
            risk: 'MEDIUM',
            score: 65,
            reason: 'Mixed validation pathways',
          },
          evidenceCount: 2,
        },
      ],
      criticalPaths: [
        {
          type: 'DATA-FLOW',
          reason: 'Unbounded data propagation',
          tables: ['ORDERDTL'],
          evidenceCount: 1,
        },
      ],
      accessPointCount: 4,
      criticalPathCount: 2,
      accessPointsTruncated: true,
      criticalPathsTruncated: false,
      maxAccessPoints: 1,
      maxCriticalPaths: 10,
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 192,
    method: 'tools/call',
    params: {
      name: 'zeus.assess-risk',
      arguments: {
        profile: 'default-shared',
        program: 'orderpgm',
        out: './output',
        maxAccessPoints: 1,
        maxCriticalPaths: 10,
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.ok, true);
  assert.equal(callResponse.result.structuredContent.service, 'zeus-rpg-promptkit');
  assert.equal(callResponse.result.structuredContent.profile, 'default-shared');
  assert.equal(callResponse.result.structuredContent.program, 'ORDERPGM');
  assert.deepEqual(callResponse.result.structuredContent.summary, {
    riskLevel: 'HIGH',
    distribution: '1 green / 2 yellow / 1 red',
  });
  assert.deepEqual(callResponse.result.structuredContent.riskMetrics, {
    totalAccesses: 4,
    greenCount: 1,
    yellowCount: 2,
    redCount: 1,
  });
  assert.deepEqual(callResponse.result.structuredContent.recommendations, [
    'Review dynamic SQL usage around ORDERHDR.',
  ]);
  assert.deepEqual(callResponse.result.structuredContent.accessPoints, [
    {
      type: 'IO',
      subtype: 'CHAIN',
      name: 'ORDERHDR',
      intent: 'READ',
      tables: ['ORDERHDR'],
      assessment: {
        risk: 'MEDIUM',
        score: 65,
        reason: 'Mixed validation pathways',
      },
      evidenceCount: 2,
    },
  ]);
  assert.deepEqual(callResponse.result.structuredContent.criticalPaths, [
    {
      type: 'DATA-FLOW',
      reason: 'Unbounded data propagation',
      tables: ['ORDERDTL'],
      evidenceCount: 1,
    },
  ]);
  assert.equal(callResponse.result.structuredContent.accessPointCount, 4);
  assert.equal(callResponse.result.structuredContent.criticalPathCount, 2);
  assert.equal(callResponse.result.structuredContent.accessPointsTruncated, true);
  assert.equal(callResponse.result.structuredContent.criticalPathsTruncated, false);
  assert.equal(callResponse.result.structuredContent.maxAccessPoints, 1);
  assert.equal(callResponse.result.structuredContent.maxCriticalPaths, 10);
  assert.match(callResponse.result.structuredContent.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(
    JSON.parse(callResponse.result.content[0].text),
    callResponse.result.structuredContent,
  );
});

test('mcp tools call assess-risk maps invalid arguments to -32602', async () => {
  const server = createMcpServer({
    cwd: process.cwd(),
    assessRiskRunner: () => {
      throw new Error('Canonical analysis not found for program "ORDERPGM" at /tmp/output/ORDERPGM/canonical-analysis.json. Run analyze first.');
    },
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 193,
      method: 'tools/call',
      params: {
        name: 'zeus.assess-risk',
        arguments: {
          program: 'ORDERPGM',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /canonical analysis not found/i);
      return true;
    },
  );
});

test('mcp stdio returns deterministic parse errors for malformed JSON payloads', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const outputChunks = [];
  output.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));

  const server = createMcpServer({
    cwd: process.cwd(),
    stdioInput: input,
    stdioOutput: output,
  });
  const transport = server.startStdio();

  input.write('{"jsonrpc":"2.0","id":999,"method":"tools/list"\n');
  await new Promise((resolve) => setTimeout(resolve, 20));
  transport.stop();
  input.end();
  output.end();

  const parsed = parseIncomingMessages(Buffer.concat(outputChunks));
  assert.equal(parsed.messages.length, 1);
  assert.deepEqual(JSON.parse(parsed.messages[0]), {
    jsonrpc: '2.0',
    id: null,
    error: {
      code: -32700,
      message: 'Parse error',
    },
  });
});

test('mcp stdio returns deterministic error for denied tools/call', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const outputChunks = [];
  output.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));

  const server = createMcpServer({
    cwd: process.cwd(),
    allowlistedTools: ['zeus.health'],
    stdioInput: input,
    stdioOutput: output,
  });
  const transport = server.startStdio();

  const request = {
    jsonrpc: '2.0',
    id: 15,
    method: 'tools/call',
    params: {
      name: 'zeus.version',
    },
  };

  input.write(encodeJsonRpcMessage(request));
  await new Promise((resolve) => setTimeout(resolve, 20));
  transport.stop();
  input.end();
  output.end();

  const parsed = parseIncomingMessages(Buffer.concat(outputChunks));
  assert.equal(parsed.messages.length, 1);

  const response = JSON.parse(parsed.messages[0]);
  assert.equal(response.jsonrpc, '2.0');
  assert.equal(response.id, 15);
  assert.deepEqual(response.error, {
    code: -32601,
    message: 'Tool is not allowed by MCP policy: zeus.version',
  });
});

test('mcp stdio allows an allowlisted tools/call and returns deterministic result envelope', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const outputChunks = [];
  output.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));

  const server = createMcpServer({
    cwd: process.cwd(),
    allowlistedTools: ['zeus.health'],
    stdioInput: input,
    stdioOutput: output,
  });
  const transport = server.startStdio();

  input.write(encodeJsonRpcMessage({
    jsonrpc: '2.0',
    id: 16,
    method: 'tools/call',
    params: {
      name: 'zeus.health',
      arguments: {},
    },
  }));

  await new Promise((resolve) => setTimeout(resolve, 20));
  transport.stop();
  input.end();
  output.end();

  const parsed = parseIncomingMessages(Buffer.concat(outputChunks));
  assert.equal(parsed.messages.length, 1);
  const response = JSON.parse(parsed.messages[0]);
  assert.equal(response.jsonrpc, '2.0');
  assert.equal(response.id, 16);
  assert.equal(Boolean(response.error), false);
  assert.equal(response.result.isError, false);
  assert.equal(response.result.structuredContent.ok, true);
  assert.equal(response.result.structuredContent.mode, 'local-only');
  assert.match(response.result.structuredContent.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('mcp stdio maps missing tools/call name to deterministic -32602 payload', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const outputChunks = [];
  output.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));

  const server = createMcpServer({
    cwd: process.cwd(),
    stdioInput: input,
    stdioOutput: output,
  });
  const transport = server.startStdio();

  input.write(encodeJsonRpcMessage({
    jsonrpc: '2.0',
    id: 17,
    method: 'tools/call',
    params: {
      arguments: {
        profile: 'default-shared',
      },
    },
  }));

  await new Promise((resolve) => setTimeout(resolve, 20));
  transport.stop();
  input.end();
  output.end();

  const parsed = parseIncomingMessages(Buffer.concat(outputChunks));
  assert.equal(parsed.messages.length, 1);
  assert.deepEqual(JSON.parse(parsed.messages[0]), {
    jsonrpc: '2.0',
    id: 17,
    error: {
      code: -32602,
      message: 'Invalid params: tools/call requires params.name',
    },
  });
});

test('mcp stdio redacts secret-bearing error messages', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const outputChunks = [];
  output.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));

  const server = createMcpServer({
    cwd: process.cwd(),
    querySqlRunner: () => {
      throw new Error('DB failure password=super-secret token=abc123 user=MYUSER');
    },
    stdioInput: input,
    stdioOutput: output,
    sensitiveTerms: ['MYUSER'],
  });
  const transport = server.startStdio();

  const request = {
    jsonrpc: '2.0',
    id: 20,
    method: 'tools/call',
    params: {
      name: 'zeus.query-sql',
      arguments: {
        profile: 'default-shared',
        sql: 'SELECT 1 FROM SYSIBM.SYSDUMMY1',
      },
    },
  };

  input.write(encodeJsonRpcMessage(request));
  await new Promise((resolve) => setTimeout(resolve, 20));
  transport.stop();
  input.end();
  output.end();

  const parsed = parseIncomingMessages(Buffer.concat(outputChunks));
  assert.equal(parsed.messages.length, 1);

  const response = JSON.parse(parsed.messages[0]);
  assert.equal(response.jsonrpc, '2.0');
  assert.equal(response.id, 20);
  assert.equal(response.error.code, -32000);
  assert.match(response.error.message, /\[REDACTED\]/);
  assert.doesNotMatch(response.error.message, /super-secret|abc123|MYUSER/);
});

test('mcp audit trail writes allowed and refused tools/call events', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-audit-'));
  const auditPath = path.join(tempRoot, 'audit', 'mcp-audit.jsonl');

  try {
    const server = createMcpServer({
      cwd: tempRoot,
      auditPath,
      allowlistedTools: ['zeus.health'],
    });

    await server.handleRequest({
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: {
        name: 'zeus.health',
        arguments: {
          profile: 'default-shared',
          dryRun: true,
        },
      },
    });

    await assert.rejects(
      () => server.handleRequest({
        jsonrpc: '2.0',
        id: 22,
        method: 'tools/call',
        params: {
          name: 'zeus.version',
          arguments: {
            profile: 'default-shared',
            'dry-run': 'true',
          },
        },
      }),
      /not allowed/i,
    );

    const entries = fs.readFileSync(auditPath, 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));

    assert.equal(entries.length, 2);
    assert.equal(entries[0].eventType, 'mcp.tools.call');
    assert.equal(entries[0].schemaVersion, MCP_AUDIT_SCHEMA_VERSION);
    assert.equal(entries[0].toolName, 'zeus.health');
    assert.equal(entries[0].profile, 'default-shared');
    assert.equal(entries[0].dryRun, true);
    assert.equal(entries[0].policyDecision, 'allowed');
    assert.equal(entries[0].status, 'success');
    assert.equal(entries[0].resultCode, 0);
    assert.match(entries[0].timestamp, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    assert.deepEqual(Object.keys(entries[0]).sort(), [
      'dryRun',
      'eventType',
      'policyDecision',
      'profile',
      'resultCode',
      'schemaVersion',
      'status',
      'timestamp',
      'toolName',
    ]);

    assert.equal(entries[1].eventType, 'mcp.tools.call');
    assert.equal(entries[1].schemaVersion, MCP_AUDIT_SCHEMA_VERSION);
    assert.equal(entries[1].toolName, 'zeus.version');
    assert.equal(entries[1].profile, 'default-shared');
    assert.equal(entries[1].dryRun, true);
    assert.equal(entries[1].policyDecision, 'refused');
    assert.equal(entries[1].status, 'error');
    assert.equal(entries[1].resultCode, -32601);
    assert.equal(typeof entries[1].errorMessage, 'string');
    assert.match(entries[1].timestamp, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    assert.deepEqual(Object.keys(entries[1]).sort(), [
      'dryRun',
      'errorMessage',
      'eventType',
      'policyDecision',
      'profile',
      'resultCode',
      'schemaVersion',
      'status',
      'timestamp',
      'toolName',
    ]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('mcp audit trail redacts secret-bearing error fields', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-audit-redaction-'));
  const auditPath = path.join(tempRoot, 'audit', 'mcp-audit.jsonl');

  try {
    const server = createMcpServer({
      cwd: tempRoot,
      auditPath,
      querySqlRunner: () => {
        throw new Error('password=super-secret token=abc123');
      },
    });

    await assert.rejects(
      () => server.handleRequest({
        jsonrpc: '2.0',
        id: 23,
        method: 'tools/call',
        params: {
          name: 'zeus.query-sql',
          arguments: {
            profile: 'default-shared',
            sql: 'SELECT 1 FROM SYSIBM.SYSDUMMY1',
          },
        },
      }),
      /tool execution failed|password=/i,
    );

    const entry = JSON.parse(fs.readFileSync(auditPath, 'utf8').trim().split(/\r?\n/)[0]);
    assert.equal(entry.status, 'error');
    assert.equal(entry.resultCode, -32000);
    assert.equal(entry.schemaVersion, MCP_AUDIT_SCHEMA_VERSION);
    assert.match(entry.errorMessage, /\[REDACTED\]/);
    assert.doesNotMatch(entry.errorMessage, /super-secret|abc123/);
    assert.deepEqual(Object.keys(entry).sort(), [
      'dryRun',
      'errorMessage',
      'eventType',
      'policyDecision',
      'profile',
      'resultCode',
      'schemaVersion',
      'status',
      'timestamp',
      'toolName',
    ]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('mcp audit trail supports explicit schema version override', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-audit-schema-'));
  const auditPath = path.join(tempRoot, 'audit', 'mcp-audit.jsonl');

  try {
    const server = createMcpServer({
      cwd: tempRoot,
      auditPath,
      auditSchemaVersion: 'mcp.tools.call.v1-local',
    });

    await server.handleRequest({
      jsonrpc: '2.0',
      id: 24,
      method: 'tools/call',
      params: {
        name: 'zeus.health',
        arguments: {},
      },
    });

    const entry = JSON.parse(fs.readFileSync(auditPath, 'utf8').trim().split(/\r?\n/)[0]);
    assert.equal(entry.schemaVersion, 'mcp.tools.call.v1-local');
    assert.equal(entry.eventType, 'mcp.tools.call');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
