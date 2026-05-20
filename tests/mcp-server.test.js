const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('node:stream');

const { createMcpServer } = require('../src/mcp/mcpServer');
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
  assert.equal(listResponse.result.tools.some((tool) => tool.name === 'zeus.query-sql'), true);
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
  assert.doesNotMatch(callResponse.result.content[0].text, /super-secret|other-secret|token=abc|MYUSER/);
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
  assert.equal(response.error.code, -32601);
  assert.match(response.error.message, /not allowed/i);
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
    assert.equal(entries[0].toolName, 'zeus.health');
    assert.equal(entries[0].profile, 'default-shared');
    assert.equal(entries[0].dryRun, true);
    assert.equal(entries[0].policyDecision, 'allowed');
    assert.equal(entries[0].status, 'success');
    assert.equal(entries[0].resultCode, 0);

    assert.equal(entries[1].eventType, 'mcp.tools.call');
    assert.equal(entries[1].toolName, 'zeus.version');
    assert.equal(entries[1].profile, 'default-shared');
    assert.equal(entries[1].dryRun, true);
    assert.equal(entries[1].policyDecision, 'refused');
    assert.equal(entries[1].status, 'error');
    assert.equal(entries[1].resultCode, -32601);
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
    assert.match(entry.errorMessage, /\[REDACTED\]/);
    assert.doesNotMatch(entry.errorMessage, /super-secret|abc123/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
