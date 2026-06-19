const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('node:stream');

const { createMcpServer, DEFAULT_MCP_SAFE_TOOL_NAMES } = require('../src/mcp/mcpServer');
const { listMcpTools, __private } = require('../src/mcp/mcpTools');
const { MCP_AUDIT_SCHEMA_VERSION } = require('../src/mcp/mcpAuditLog');
const { encodeJsonRpcMessage, parseIncomingMessages } = require('../src/mcp/stdioTransport');

const ALL_TEST_TOOL_NAMES = listMcpTools().map((tool) => tool.name);

function createTestServer(runtime = {}) {
  return createMcpServer({
    cwd: process.cwd(),
    allowlistedTools: ALL_TEST_TOOL_NAMES,
    ...runtime,
  });
}

test('mcp initialize returns protocol and capabilities', async () => {
  const server = createTestServer({ cwd: process.cwd() });
  const response = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {},
  });

  assert.equal(response.jsonrpc, '2.0');
  assert.equal(response.id, 1);
  assert.equal(response.result.protocolVersion, '2024-11-05');
  assert.equal(response.result.capabilities.prompts.listChanged, false);
  assert.equal(response.result.capabilities.resources.listChanged, false);
  assert.equal(response.result.capabilities.resources.subscribe, false);
  assert.equal(response.result.capabilities.tools.listChanged, false);
});

test('mcp resources list returns curated docs and metadata resources', async () => {
  const server = createTestServer({ cwd: process.cwd() });
  const response = await server.handleRequest({
    jsonrpc: '2.0',
    id: 4,
    method: 'resources/list',
    params: {},
  });

  assert.equal(Array.isArray(response.result.resources), true);
  const uris = response.result.resources.map((resource) => resource.uri);
  assert.ok(uris.includes('zeus://docs/tool-catalog.md'));
  assert.ok(uris.includes('zeus://docs/ai/session-prompt.md'));
  assert.ok(uris.includes('zeus://metadata/command-catalog.json'));
  assert.ok(uris.includes('zeus://metadata/mcp-tools.json'));
  assert.ok(uris.includes('zeus://metadata/workflow-presets.json'));
  assert.ok(uris.includes('zeus://metadata/prompt-contracts.json'));
});

test('mcp resources read returns file-backed and computed resource content', async () => {
  const server = createTestServer({ cwd: process.cwd() });

  const docsResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 5,
    method: 'resources/read',
    params: {
      uri: 'zeus://docs/tool-catalog.md',
    },
  });
  assert.equal(docsResponse.result.contents[0].mimeType, 'text/markdown');
  assert.match(docsResponse.result.contents[0].text, /Zeus RPG PromptKit Tool Catalog/);

  const metadataResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 6,
    method: 'resources/read',
    params: {
      uri: 'zeus://metadata/mcp-tools.json',
    },
  });
  assert.equal(metadataResponse.result.contents[0].mimeType, 'application/json');
  assert.match(metadataResponse.result.contents[0].text, /"defaultAllowlist"/);
  assert.match(metadataResponse.result.contents[0].text, /"zeus\.doctor"/);
});

test('mcp resources read maps missing or unknown uri to deterministic -32602 errors', async () => {
  const server = createTestServer({ cwd: process.cwd() });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 7,
      method: 'resources/read',
      params: {},
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.equal(error.message, 'Invalid params: resources/read requires params.uri');
      return true;
    },
  );

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 8,
      method: 'resources/read',
      params: {
        uri: 'zeus://unknown/not-found.json',
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /unknown resource uri/i);
      return true;
    },
  );
});

test('mcp resources list and read include curated run resources under output root', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-runs-'));
  const outputRoot = path.join(tempRoot, 'output');
  const programDir = path.join(outputRoot, 'ORDERPGM');

  fs.mkdirSync(programDir, { recursive: true });
  fs.writeFileSync(path.join(programDir, 'report.md'), '# Report\n', 'utf8');
  fs.writeFileSync(path.join(programDir, 'analyze-run-manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    tool: { name: 'zeus-rpg-promptkit', command: 'analyze' },
    run: {
      status: 'succeeded',
      completedAt: '2026-04-13T12:00:00.000Z',
    },
    inputs: {
      sourceRoot: '/tmp/src',
      options: {
        guidedMode: { name: 'documentation' },
        workflowPreset: { name: 'onboarding' },
        reproducibleEnabled: false,
      },
    },
  }, null, 2)}\n`, 'utf8');

  try {
    const server = createTestServer({ cwd: tempRoot });
    const listResponse = await server.handleRequest({
      jsonrpc: '2.0',
      id: 9,
      method: 'resources/list',
      params: {},
    });
    const uris = listResponse.result.resources.map((resource) => resource.uri);
    assert.ok(uris.includes('zeus://runs/ORDERPGM/summary.json'));
    assert.ok(uris.includes('zeus://runs/ORDERPGM/views.json'));
    assert.ok(uris.includes('zeus://runs/ORDERPGM/artifacts/report.md'));

    const readSummary = await server.handleRequest({
      jsonrpc: '2.0',
      id: 10,
      method: 'resources/read',
      params: {
        uri: 'zeus://runs/ORDERPGM/summary.json',
      },
    });
    assert.match(readSummary.result.contents[0].text, /"program": "ORDERPGM"/);

    const readArtifact = await server.handleRequest({
      jsonrpc: '2.0',
      id: 11,
      method: 'resources/read',
      params: {
        uri: 'zeus://runs/ORDERPGM/artifacts/report.md',
      },
    });
    assert.equal(readArtifact.result.contents[0].mimeType, 'text/plain');
    assert.match(readArtifact.result.contents[0].text, /# Report/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('mcp prompts list returns session bootstrap and curated template prompts', async () => {
  const server = createTestServer({ cwd: process.cwd() });
  const response = await server.handleRequest({
    jsonrpc: '2.0',
    id: 12,
    method: 'prompts/list',
    params: {},
  });

  assert.equal(Array.isArray(response.result.prompts), true);
  const names = response.result.prompts.map((prompt) => prompt.name);
  assert.ok(names.includes('zeus.session.start'));
  assert.ok(names.includes('zeus.prompt.documentation'));
  assert.ok(names.includes('zeus.prompt.modernization'));
});

test('mcp prompts get returns session bootstrap prompt and template prompt content', async () => {
  const server = createTestServer({ cwd: process.cwd() });

  const sessionResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 13,
    method: 'prompts/get',
    params: {
      name: 'zeus.session.start',
      arguments: {
        profile: 'development',
        environment: 'sandbox',
        goal: 'Analyze program ORDERPGM and summarize dependencies.',
      },
    },
  });
  assert.equal(sessionResponse.result.messages[0].role, 'user');
  assert.match(sessionResponse.result.messages[0].content.text, /Analyze program ORDERPGM and summarize dependencies\./);
  assert.match(sessionResponse.result.messages[0].content.text, /docs\/tool-catalog\.md/);

  const templateResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 14,
    method: 'prompts/get',
    params: {
      name: 'zeus.prompt.documentation',
      arguments: {},
    },
  });
  assert.equal(templateResponse.result.messages[0].role, 'user');
  assert.match(templateResponse.result.messages[0].content.text, /Template: documentation/);
  assert.match(templateResponse.result.messages[0].content.text, /# Program Documentation/);
});

test('mcp prompts get maps missing args and unknown prompt names deterministically', async () => {
  const server = createTestServer({ cwd: process.cwd() });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 15,
      method: 'prompts/get',
      params: {
        name: 'zeus.session.start',
        arguments: {},
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /requires arguments\.goal/i);
      return true;
    },
  );

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 16,
      method: 'prompts/get',
      params: {
        name: 'zeus.prompt.unknown',
        arguments: {},
      },
    }),
    (error) => {
      assert.equal(error.code, -32601);
      assert.match(error.message, /prompt not found/i);
      return true;
    },
  );
});

test('mcp rejects invalid JSON-RPC version with deterministic -32600 error', async () => {
  const server = createTestServer({ cwd: process.cwd() });
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
  const server = createTestServer({ cwd: process.cwd() });
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

test('mcp tools list defaults to the minimal safe surface and excludes risky tools', async () => {
  const server = createMcpServer({ cwd: process.cwd() });
  const listResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 10,
    method: 'tools/list',
  });

  assert.equal(Array.isArray(listResponse.result.tools), true);
  assert.deepEqual(
    listResponse.result.tools.map((tool) => tool.name),
    DEFAULT_MCP_SAFE_TOOL_NAMES,
  );
  assert.equal(listResponse.result.tools.some((tool) => tool.name === 'zeus.write-sql'), false);
  assert.equal(listResponse.result.tools.some((tool) => tool.name === 'zeus.bridge'), false);
  assert.equal(listResponse.result.tools.some((tool) => tool.name === 'zeus.query-sql'), false);
  assert.equal(listResponse.result.tools.some((tool) => tool.name === 'zeus.query-table'), false);
  assert.equal(listResponse.result.tools.some((tool) => tool.name === 'zeus.search-source'), true);
  assert.equal(listResponse.result.tools.some((tool) => tool.name === 'zeus.knowledge'), false);

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
});

test('mcp redaction preserves public tool and service identifiers when env contains uppercase ZEUS term', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    env: {
      ZEUS_FETCH_USER: 'ZEUS',
    },
  });

  const initializeResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 9,
    method: 'initialize',
    params: {},
  });
  const listResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 10,
    method: 'tools/list',
  });
  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 11,
    method: 'tools/call',
    params: {
      name: 'zeus.health',
      arguments: {},
    },
  });

  assert.equal(initializeResponse.result.serverInfo.name, 'zeus-rpg-promptkit');
  assert.equal(listResponse.result.tools.some((tool) => tool.name === 'zeus.health'), true);
  assert.equal(callResponse.result.structuredContent.service, 'zeus-rpg-promptkit');
});

test('normalizeJoblogToolError rewrites missing JOBLOG_INFO failures into actionable guidance', () => {
  const error = new Error('DB2 diagnostic query failed: [SQL0204] JOBLOG_INFO in QSYS2 type *FILE not found.');
  const normalized = __private.normalizeJoblogToolError(error);

  assert.match(normalized.message, /requires QSYS2\.JOBLOG_INFO/i);
  assert.match(normalized.message, /QSYS2\.HISTORY_LOG_INFO/i);
});

test('buildHistoryLogFallbackSeverityClause maps MCP severities to HISTORY_LOG_INFO filters', () => {
  assert.match(__private.buildHistoryLogFallbackSeverityClause('ERROR'), /ESCAPE/);
  assert.match(__private.buildHistoryLogFallbackSeverityClause('WARNING'), /BETWEEN 1 AND 29/);
  assert.match(__private.buildHistoryLogFallbackSeverityClause('INFO'), /INFORMATIONAL/);
  assert.equal(__private.buildHistoryLogFallbackSeverityClause(null), null);
});

test('buildHistoryLogFallbackQuery creates a deterministic compatibility query', () => {
  const query = __private.buildHistoryLogFallbackQuery({
    jobName: 'QPADEV',
    severity: 'ERROR',
    maxMessages: 25,
  });

  assert.match(query, /QSYS2\.HISTORY_LOG_INFO/);
  assert.match(query, /FROM_JOB AS JOB_NAME/);
  assert.match(query, /%\/QPADEV%/);
  assert.match(query, /FETCH FIRST 25 ROWS ONLY/);
});

test('summarizeJoblogRows includes compatibility note for HISTORY_LOG_INFO backend', () => {
  const summary = __private.summarizeJoblogRows({
    profile: 'default-local',
    jobName: 'QPADEV',
    severity: 'ERROR',
    maxMessages: 10,
    backend: 'HISTORY_LOG_INFO',
    result: {
      columns: ['JOB_NAME', 'MESSAGE_ID'],
      rows: [{ JOB_NAME: 'QPADEV0001', MESSAGE_ID: 'CPF0001' }],
    },
  });

  assert.equal(summary.backend, 'HISTORY_LOG_INFO');
  assert.match(summary.compatibilityNote, /best-effort/i);
});

test('evaluateWriteTableAllowlist allows qualified UPDATE target present in allowlist', () => {
  const policy = __private.evaluateWriteTableAllowlist({
    sql: 'UPDATE APPDATA.APP_TABLE_00 SET STATUS = 1 WHERE ID = 1',
    allowTables: ['APPDATA.APP_TABLE_00', 'APPDATA.APP_TABLE_01'],
  });

  assert.equal(policy.allowlistEnabled, true);
  assert.equal(policy.tableAllowed, true);
  assert.equal(policy.targetSchema, 'APPDATA');
  assert.equal(policy.targetTable, 'APP_TABLE_00');
  assert.equal(policy.targetQualifiedName, 'APPDATA.APP_TABLE_00');
  assert.deepEqual(policy.allowTables, ['APPDATA.APP_TABLE_00', 'APPDATA.APP_TABLE_01']);
  assert.equal(policy.blockReason, null);
});

test('evaluateWriteTableAllowlist blocks non-allowlisted target table', () => {
  const policy = __private.evaluateWriteTableAllowlist({
    sql: 'DELETE FROM APPDATA.APP_TABLE_99 WHERE ID = 1',
    allowTables: ['APPDATA.APP_TABLE_00'],
  });

  assert.equal(policy.allowlistEnabled, true);
  assert.equal(policy.tableAllowed, false);
  assert.equal(policy.targetQualifiedName, 'APPDATA.APP_TABLE_99');
  assert.match(policy.blockReason, /not allowlisted/i);
});

test('evaluateWriteStatementGuard blocks UPDATE without top-level WHERE', () => {
  const guard = __private.evaluateWriteStatementGuard({
    statementType: 'UPDATE',
    sql: "UPDATE APPDATA.APP_TABLE_00 SET NOTE = 'WHERE marker'",
  });

  assert.equal(guard.whereRequired, true);
  assert.equal(guard.wherePresent, false);
  assert.equal(guard.predicateSafe, false);
  assert.match(guard.blockReason, /require a top-level WHERE/i);
});

test('evaluateWriteStatementGuard allows DELETE with top-level WHERE', () => {
  const guard = __private.evaluateWriteStatementGuard({
    statementType: 'DELETE',
    sql: 'DELETE FROM APPDATA.APP_TABLE_00 WHERE ID = 1',
  });

  assert.equal(guard.whereRequired, true);
  assert.equal(guard.wherePresent, true);
  assert.equal(guard.predicateSafe, true);
  assert.equal(guard.blockReason, null);
});

test('evaluateWriteStatementGuard blocks trivial always-true WHERE predicate', () => {
  const guard = __private.evaluateWriteStatementGuard({
    statementType: 'DELETE',
    sql: 'DELETE FROM APPDATA.APP_TABLE_00 WHERE 1 = 1',
  });

  assert.equal(guard.whereRequired, true);
  assert.equal(guard.wherePresent, true);
  assert.equal(guard.predicateSafe, false);
  assert.match(guard.blockReason, /non-trivial WHERE predicate/i);
});

test('evaluateWriteStatementGuard blocks weak IS NOT NULL predicate', () => {
  const guard = __private.evaluateWriteStatementGuard({
    statementType: 'UPDATE',
    sql: 'UPDATE APPDATA.APP_TABLE_00 SET STATUS = 1 WHERE STATUS IS NOT NULL',
  });

  assert.equal(guard.whereRequired, true);
  assert.equal(guard.wherePresent, true);
  assert.equal(guard.predicateSafe, false);
  assert.match(guard.blockReason, /is not null filter/i);
});

test('evaluateWriteStatementGuard blocks OR tautology predicate', () => {
  const guard = __private.evaluateWriteStatementGuard({
    statementType: 'DELETE',
    sql: 'DELETE FROM APPDATA.APP_TABLE_00 WHERE ID = 1 OR 1=1',
  });

  assert.equal(guard.whereRequired, true);
  assert.equal(guard.wherePresent, true);
  assert.equal(guard.predicateSafe, false);
  assert.match(guard.blockReason, /or tautology/i);
});

test('resolveWriteRowSafetyPolicy applies secure defaults for UPDATE', () => {
  const policy = __private.resolveWriteRowSafetyPolicy({
    config: {
      testData: {},
    },
    requestedMaxRowsAffected: null,
    statementType: 'UPDATE',
  });

  assert.equal(policy.enabled, true);
  assert.equal(policy.configuredMaxRowsAffected, 100);
  assert.equal(policy.requestedMaxRowsAffected, null);
  assert.equal(policy.effectiveMaxRowsAffected, 100);
  assert.equal(policy.clampApplied, false);
  assert.equal(policy.blockWhenCountUnavailable, true);
});

test('resolveWriteRowSafetyPolicy clamps requested maxRowsAffected to configured limit', () => {
  const policy = __private.resolveWriteRowSafetyPolicy({
    config: {
      testData: {
        writeSafety: {
          enabled: true,
          maxRowsAffected: 50,
        },
      },
    },
    requestedMaxRowsAffected: 200,
    statementType: 'DELETE',
  });

  assert.equal(policy.enabled, true);
  assert.equal(policy.configuredMaxRowsAffected, 50);
  assert.equal(policy.requestedMaxRowsAffected, 200);
  assert.equal(policy.effectiveMaxRowsAffected, 50);
  assert.equal(policy.clampApplied, true);
});

test('resolveWriteRowSafetyPolicy disables limits when explicitly turned off', () => {
  const policy = __private.resolveWriteRowSafetyPolicy({
    config: {
      testData: {
        writeSafety: {
          enabled: false,
          maxRowsAffected: 10,
        },
      },
    },
    requestedMaxRowsAffected: 5,
    statementType: 'UPDATE',
  });

  assert.equal(policy.enabled, false);
  assert.equal(policy.configuredMaxRowsAffected, 10);
  assert.equal(policy.effectiveMaxRowsAffected, null);
});

test('mcp tools call rejects unknown tool', async () => {
  const server = createTestServer({ cwd: process.cwd() });
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

test('mcp tools list only includes explicitly allowlisted tools', async () => {
  const server = createTestServer({
    allowlistedTools: ['zeus.health', 'zeus.search-source'],
  });

  const listResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 13,
    method: 'tools/list',
  });

  assert.deepEqual(
    listResponse.result.tools.map((tool) => tool.name),
    ['zeus.health', 'zeus.search-source'],
  );
});

test('mcp tools call rejects non-default tool when no explicit allowlist is provided', async () => {
  const server = createMcpServer({ cwd: process.cwd() });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 14,
      method: 'tools/call',
      params: {
        name: 'zeus.query-sql',
      },
    }),
    /not allowed/i,
  );
});

test('mcp tools call rejects tool outside explicit allowlist', async () => {
  const server = createTestServer({
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
  const server = createTestServer({
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
  const server = createTestServer({ cwd: process.cwd() });
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
    /"profile" is required/i,
  );
});

test('mcp tools call zeus.help returns structured overview and per-command info (S0)', async () => {
  const server = createTestServer({ cwd: process.cwd() });

  // Overview
  const overview = await server.handleRequest({
    jsonrpc: '2.0',
    id: 50,
    method: 'tools/call',
    params: { name: 'zeus.help', arguments: {} },
  });
  assert.equal(overview.result.isError, false);
  const o = overview.result.structuredContent;
  assert.equal(o.action, 'zeus.help');
  assert.ok(o.help && o.help.defaultTools && o.help.defaultTools.includes('zeus.doctor'));
  assert.ok(Array.isArray(o.help.recommendedSequence));

  // Specific command
  const cmdHelp = await server.handleRequest({
    jsonrpc: '2.0',
    id: 51,
    method: 'tools/call',
    params: { name: 'zeus.help', arguments: { command: 'analyze' } },
  });
  assert.equal(cmdHelp.result.isError, false);
  const c = cmdHelp.result.structuredContent;
  assert.equal(c.action, 'zeus.help');
  assert.equal(c.help.command, 'analyze');
  assert.ok(c.help.purpose && c.help.purpose.length > 5);
  assert.ok(c.help.safety);
});

test('mcp tools call profiles returns masked structured summaries', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    profilesRunner: () => ({
      profileCount: 1,
      selectedProfile: 'demo',
      configSource: 'config/profiles.example.json',
      profiles: [
        {
          name: 'demo',
          extends: ['base'],
          productionSystem: false,
          metadataDb: {
            target: 'demo-host',
            user: 'DEMOUSR',
            passwordSet: true,
          },
          testDataDb: null,
          fetch: {
            target: 'demo-fetch',
            sourceLib: 'DEMO',
            user: 'FETCHUSR',
            passwordSet: true,
          },
        },
      ],
    }),
  });

  const response = await server.handleRequest({
    jsonrpc: '2.0',
    id: 171,
    method: 'tools/call',
    params: {
      name: 'zeus.profiles',
      arguments: {},
    },
  });

  assert.equal(response.result.structuredContent.profileCount, 1);
  assert.equal(response.result.structuredContent.profiles[0].metadataDb.passwordSet, true);
  assert.equal(response.result.structuredContent.profiles[0].metadataDb.user, 'DEMOUSR');
});

test('mcp tools call fetch-member returns deterministic structured payload', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    fetchMemberRunner: () => ({
      operation: 'run',
      profile: 'default',
      sourceLib: 'APPLIB',
      sourceFile: 'QRPGLESRC',
      outDir: '/workspace/output',
      memberCount: 2,
      fetched: [
        {
          member: 'ORDERPGM',
          path: '/workspace/output/QRPGLESRC/ORDERPGM.rpgle',
          linesWritten: 120,
          usedFallback: false,
        },
      ],
      failures: [
        {
          member: 'INVOICEPGM',
          messages: ['not found'],
          stderr: '',
        },
      ],
    }),
  });

  const response = await server.handleRequest({
    jsonrpc: '2.0',
    id: 172,
    method: 'tools/call',
    params: {
      name: 'zeus.fetch-member',
      arguments: {
        profile: 'default',
        member: 'ORDERPGM,INVOICEPGM',
      },
    },
  });

  assert.equal(response.result.structuredContent.ok, false);
  assert.equal(response.result.structuredContent.fetchedCount, 1);
  assert.equal(response.result.structuredContent.failureCount, 1);
  assert.equal(response.result.structuredContent.fetched[0].member, 'ORDERPGM');
  assert.equal(response.result.structuredContent.failures[0].member, 'INVOICEPGM');
});

test('mcp tools call docs-generate-catalog writes bounded outputs and returns deterministic metadata', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-docs-catalog-'));
  fs.mkdirSync(path.join(tempRoot, 'cli', 'commands'), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, 'src', 'docs'), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, 'src', 'workflow'), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, 'cli', 'zeus.js'), `
const command = process.argv[2];
if (command === 'doctor') {}
if (command === 'docs:generate-catalog') {}
console.log('  zeus doctor --profile default');
console.log('  zeus docs:generate-catalog');
`, 'utf8');
  fs.writeFileSync(path.join(tempRoot, 'package.json'), `${JSON.stringify({ version: '9.9.9-test' }, null, 2)}\n`, 'utf8');

  try {
    const server = createTestServer({ cwd: tempRoot });
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 173,
      method: 'tools/call',
      params: {
        name: 'zeus.docs-generate-catalog',
        arguments: {
          output: 'docs/generated-tool-catalog.md',
          jsonOutput: 'docs/generated-tool-catalog.json',
        },
      },
    });

    assert.equal(response.result.structuredContent.ok, true);
    assert.equal(response.result.structuredContent.format, 'markdown');
    assert.equal(response.result.structuredContent.repoRoot, tempRoot);
    assert.match(response.result.structuredContent.markdownPath, /generated-tool-catalog\.md$/);
    assert.match(response.result.structuredContent.jsonPath, /generated-tool-catalog\.json$/);
    assert.match(fs.readFileSync(response.result.structuredContent.markdownPath, 'utf8'), /Zeus RPG PromptKit Tool Catalog/);
    assert.match(fs.readFileSync(response.result.structuredContent.jsonPath, 'utf8'), /"command": "docs:generate-catalog"/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('mcp tools call docs-generate-catalog rejects output paths outside workspace root', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-docs-catalog-'));

  try {
    const server = createTestServer({ cwd: tempRoot });
    await assert.rejects(
      () => server.handleRequest({
        jsonrpc: '2.0',
        id: 174,
        method: 'tools/call',
        params: {
          name: 'zeus.docs-generate-catalog',
          arguments: {
            output: '../escape.md',
          },
        },
      }),
      (error) => {
        assert.equal(error.code, -32602);
        assert.match(error.message, /must resolve inside workspace root/i);
        return true;
      },
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('mcp tools call query-sql returns deterministic structured rows', async () => {
  const server = createTestServer({
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
  const server = createTestServer({
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
  const server = createTestServer({
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

test('mcp tools call resolve-object returns deterministic structured payload', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    resolveObjectRunner: () => ({
      profile: 'default',
      table: 'APP_TABLE_00',
      schema: 'APPDATA',
      requireColumns: ['STATUS'],
      includeRowCount: true,
      found: true,
      diagnostics: {
        searchMode: 'schema-bound',
        attemptCount: 1,
      },
      objectCount: 1,
      objects: [
        {
          schema: 'APPDATA',
          sqlName: 'APP_TABLE_00',
          systemName: 'APP0000',
          type: 'T',
          requiredColumns: ['STATUS'],
          missingRequiredColumns: [],
          allRequiredColumnsPresent: true,
          rowCount: 42,
          rowCountError: null,
        },
      ],
    }),
  });

  const response = await server.handleRequest({
    jsonrpc: '2.0',
    id: 183,
    method: 'tools/call',
    params: {
      name: 'zeus.resolve-object',
      arguments: {
        profile: 'default',
        table: 'APP_TABLE_00',
      },
    },
  });

  assert.equal(response.result.structuredContent.found, true);
  assert.equal(response.result.structuredContent.objectCount, 1);
  assert.equal(response.result.structuredContent.objects[0].rowCount, 42);
});

test('mcp tools call query-sql rejects non-read-only SQL', async () => {
  const server = createTestServer({
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

test('mcp tools call write-sql plan returns deterministic structured payload', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    writeSqlRunner: () => ({
      operation: 'plan',
      profile: 'default-shared',
      mode: 'update',
      statementType: 'UPDATE',
      sqlLength: 42,
      sqlFingerprint: 'a'.repeat(64),
      productionSystem: false,
      writesEnabled: false,
      confirmationRequired: false,
      canApply: false,
      blockReasons: ['MCP write execution is disabled. Set ZEUS_MCP_ENABLE_WRITES=true to enable apply.'],
      rowsAffected: 0,
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 191,
    method: 'tools/call',
    params: {
      name: 'zeus.write-sql',
      arguments: {
        operation: 'plan',
        profile: 'default-shared',
        mode: 'update',
        sql: 'UPDATE APPDATA.APP_TABLE_00 SET STATUS = 1 WHERE ID = 1',
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.ok, true);
  assert.equal(callResponse.result.structuredContent.operation, 'plan');
  assert.equal(callResponse.result.structuredContent.profile, 'default-shared');
  assert.equal(callResponse.result.structuredContent.mode, 'update');
  assert.equal(callResponse.result.structuredContent.statementType, 'UPDATE');
  assert.equal(callResponse.result.structuredContent.sqlLength, 42);
  assert.equal(callResponse.result.structuredContent.writesEnabled, false);
  assert.equal(callResponse.result.structuredContent.canApply, false);
  assert.equal(callResponse.result.structuredContent.rowsAffected, 0);
  assert.match(callResponse.result.structuredContent.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('mcp tools call write-sql apply can execute when gates pass', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    writeSqlRunner: () => ({
      operation: 'apply',
      profile: 'default-shared',
      mode: 'upsert',
      statementType: 'UPDATE',
      sqlLength: 55,
      sqlFingerprint: 'b'.repeat(64),
      productionSystem: false,
      writesEnabled: true,
      confirmationRequired: true,
      canApply: true,
      blockReasons: [],
      rowsAffected: 3,
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 192,
    method: 'tools/call',
    params: {
      name: 'zeus.write-sql',
      arguments: {
        operation: 'apply',
        profile: 'default-shared',
        mode: 'upsert',
        sql: 'UPDATE APPDATA.APP_TABLE_00 SET STATUS = 1 WHERE ID = 1',
        confirmToken: 'demo-token',
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.operation, 'apply');
  assert.equal(callResponse.result.structuredContent.rowsAffected, 3);
  assert.equal(callResponse.result.structuredContent.writesEnabled, true);
  assert.equal(callResponse.result.structuredContent.confirmationRequired, true);
});

test('mcp tools call write-sql maps policy-gated apply to -32601', async () => {
  const server = createTestServer({
    allowlistedTools: ['zeus.write-sql'],
    writeSqlRunner: () => {
      const error = new Error('Tool is not allowed by MCP policy: zeus.write-sql apply blocked. MCP write execution is disabled.');
      error.code = 'TOOL_NOT_ALLOWED';
      throw error;
    },
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 193,
      method: 'tools/call',
      params: {
        name: 'zeus.write-sql',
        arguments: {
          operation: 'apply',
          profile: 'default-shared',
          sql: 'UPDATE APPDATA.APP_TABLE_00 SET STATUS = 1 WHERE ID = 1',
          confirmToken: 'wrong',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32601);
      assert.match(error.message, /tool is not allowed by mcp policy/i);
      return true;
    },
  );
});

test('mcp tools call write-sql maps invalid arguments to -32602', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    writeSqlRunner: () => {
      throw new Error('Invalid arguments for zeus.write-sql: operation must be plan or apply.');
    },
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 194,
      method: 'tools/call',
      params: {
        name: 'zeus.write-sql',
        arguments: {
          operation: 'run',
          profile: 'default-shared',
          sql: 'UPDATE APPDATA.APP_TABLE_00 SET STATUS = 1 WHERE ID = 1',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /operation must be plan or apply/i);
      return true;
    },
  );
});

test('mcp tools call bridge plan returns deterministic structured payload', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    bridgeRunner: () => ({
      operation: 'plan',
      profile: 'default-shared',
      program: 'ORDERPGM',
      status: 'planned',
      dryRun: null,
      plan: {
        planId: 'plan-123456789abc',
        planHash: 'a'.repeat(64),
        riskLevel: 'LOW',
        targetType: 'source-member',
        remoteTarget: {
          targetType: 'source-member',
          library: 'ZEUS1',
          sourceFile: 'QRPGLESRC',
          member: 'ORDERPGM',
        },
      },
      artifacts: {
        jsonPath: '/tmp/output/ORDERPGM/change-plan.json',
        mdPath: '/tmp/output/ORDERPGM/change-plan.md',
      },
      auditPath: '/tmp/output/audit/bridge-audit.jsonl',
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1941,
    method: 'tools/call',
    params: {
      name: 'zeus.bridge',
      arguments: {
        operation: 'plan',
        profile: 'default-shared',
        program: 'ORDERPGM',
        source: './rpg_sources/QRPGLESRC/ORDERPGM.rpgle',
        targetLib: 'ZEUS1',
        targetFile: 'QRPGLESRC',
        targetMember: 'ORDERPGM',
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.ok, true);
  assert.equal(callResponse.result.structuredContent.operation, 'plan');
  assert.equal(callResponse.result.structuredContent.profile, 'default-shared');
  assert.equal(callResponse.result.structuredContent.program, 'ORDERPGM');
  assert.equal(callResponse.result.structuredContent.status, 'planned');
  assert.equal(callResponse.result.structuredContent.plan.planId, 'plan-123456789abc');
  assert.equal(callResponse.result.structuredContent.plan.planHash, 'a'.repeat(64));
  assert.equal(callResponse.result.structuredContent.plan.riskLevel, 'LOW');
  assert.equal(callResponse.result.structuredContent.plan.targetType, 'source-member');
  assert.equal(callResponse.result.structuredContent.artifacts.jsonPath, '/tmp/output/ORDERPGM/change-plan.json');
  assert.equal(callResponse.result.structuredContent.artifacts.mdPath, '/tmp/output/ORDERPGM/change-plan.md');
  assert.equal(callResponse.result.structuredContent.auditPath, '/tmp/output/audit/bridge-audit.jsonl');
  assert.match(callResponse.result.structuredContent.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('mcp tools call bridge maps disallowed operation to -32601 policy refusal', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 1942,
      method: 'tools/call',
      params: {
        name: 'zeus.bridge',
        arguments: {
          operation: 'stage',
          profile: 'default-shared',
          program: 'ORDERPGM',
          dryRun: false,
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32601);
      assert.match(error.message, /requires dryRun=true/i);
      return true;
    },
  );
});

test('mcp tools call bridge maps invalid arguments to -32602', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 1943,
      method: 'tools/call',
      params: {
        name: 'zeus.bridge',
        arguments: {
          operation: 'apply',
          profile: 'default-shared',
          program: 'ORDERPGM',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /operation must be plan, report, stage, or compile-run/i);
      return true;
    },
  );
});

test('mcp tools call search-source rejects relative source-root traversal outside workspace', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-search-source-guard-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const outsideRoot = path.join(tempRoot, 'outside');
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });
  fs.writeFileSync(path.join(outsideRoot, 'A.rpgle'), 'CHAIN(E) CUSTID CUSTOMER;\n', 'utf8');

  const server = createTestServer({
    cwd: workspaceRoot,
  });

  try {
    await assert.rejects(
      () => server.handleRequest({
        jsonrpc: '2.0',
        id: 18201,
        method: 'tools/call',
        params: {
          name: 'zeus.search-source',
          arguments: {
            sourceRoot: '../outside',
            searchTerm: 'CHAIN',
          },
        },
      }),
      (error) => {
        assert.equal(error.code, -32602);
        assert.match(error.message, /--source-root must resolve inside workspace root/i);
        return true;
      },
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('mcp tools call search-source allows relative source-root inside workspace', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-search-source-inside-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const sourceRoot = path.join(workspaceRoot, 'src');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'A.rpgle'), 'CHAIN(E) CUSTID CUSTOMER;\n', 'utf8');

  const server = createTestServer({
    cwd: workspaceRoot,
  });

  try {
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 182015,
      method: 'tools/call',
      params: {
        name: 'zeus.search-source',
        arguments: {
          sourceRoot: 'src',
          searchTerm: 'CHAIN',
        },
      },
    });

    assert.equal(response.result.isError, false);
    assert.equal(response.result.structuredContent.ok, true);
    assert.equal(response.result.structuredContent.resultCount, 1);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('mcp tools call search-source rejects absolute source-root outside workspace without leaking the escaped path', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-search-source-abs-guard-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const outsideRoot = path.join(tempRoot, 'outside');
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });
  fs.writeFileSync(path.join(outsideRoot, 'A.rpgle'), 'CHAIN(E) CUSTID CUSTOMER;\n', 'utf8');

  const server = createTestServer({
    cwd: workspaceRoot,
  });

  try {
    await assert.rejects(
      () => server.handleRequest({
        jsonrpc: '2.0',
        id: 182016,
        method: 'tools/call',
        params: {
          name: 'zeus.search-source',
          arguments: {
            sourceRoot: outsideRoot,
            searchTerm: 'CHAIN',
          },
        },
      }),
      (error) => {
        assert.equal(error.code, -32602);
        assert.match(error.message, /--source-root must resolve inside workspace root/i);
        assert.doesNotMatch(error.message, new RegExp(outsideRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        return true;
      },
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('mcp tools call field-search rejects relative source-root traversal outside workspace', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-field-search-guard-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const outsideRoot = path.join(tempRoot, 'outside');
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });
  fs.writeFileSync(path.join(outsideRoot, 'A.rpgle'), 'CHAIN(E) CUSTID CUSTOMER;\n', 'utf8');

  const server = createTestServer({
    cwd: workspaceRoot,
  });

  try {
    await assert.rejects(
      () => server.handleRequest({
        jsonrpc: '2.0',
        id: 18202,
        method: 'tools/call',
        params: {
          name: 'zeus.field-search',
          arguments: {
            sourceRoot: '../outside',
            field: 'CUSTID',
          },
        },
      }),
      (error) => {
        assert.equal(error.code, -32602);
        assert.match(error.message, /--source-root must resolve inside workspace root/i);
        return true;
      },
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('mcp tools call field-search allows absolute source-root inside workspace', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-field-search-inside-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const sourceRoot = path.join(workspaceRoot, 'src');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'A.rpgle'), 'chain(e) CUSTID CUSTOMER;\n', 'utf8');

  const server = createTestServer({
    cwd: workspaceRoot,
  });

  try {
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 182025,
      method: 'tools/call',
      params: {
        name: 'zeus.field-search',
        arguments: {
          sourceRoot,
          field: 'CUSTID',
        },
      },
    });

    assert.equal(response.result.isError, false);
    assert.equal(response.result.structuredContent.ok, true);
    assert.equal(response.result.structuredContent.resultCount, 1);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('mcp tools call diff returns deterministic structured payload', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    diffRunner: () => ({
      profile: 'default-shared',
      member: 'ORDERPGM',
      fetchRoot: '/tmp/fetched',
      workspaceRoot: '/tmp/workspace',
      workCopyMode: 'txt',
      originalPath: '/tmp/fetched/QRPGLESRC/ORDERPGM.rpgle',
      modifiedPath: '/tmp/workspace/ORDERPGM.rpgle.txt',
      maxPayloadLines: 2,
      payloadLineCount: 2,
      payloadTruncated: true,
      lineCount: 3,
      changedLineCount: 2,
      rows: [
        { line: 1, marker: ' ', original: '**FREE', modified: '**FREE' },
        { line: 2, marker: '~', original: 'A', modified: 'C' },
      ],
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1821,
    method: 'tools/call',
    params: {
      name: 'zeus.diff',
      arguments: {
        profile: 'default-shared',
        member: 'orderpgm',
        maxPayloadLines: 2,
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.ok, true);
  assert.equal(callResponse.result.structuredContent.profile, 'default-shared');
  assert.equal(callResponse.result.structuredContent.member, 'ORDERPGM');
  assert.equal(callResponse.result.structuredContent.fetchRoot, '/tmp/fetched');
  assert.equal(callResponse.result.structuredContent.workspaceRoot, '/tmp/workspace');
  assert.equal(callResponse.result.structuredContent.workCopyMode, 'txt');
  assert.equal(callResponse.result.structuredContent.originalPath, '/tmp/fetched/QRPGLESRC/ORDERPGM.rpgle');
  assert.equal(callResponse.result.structuredContent.modifiedPath, '/tmp/workspace/ORDERPGM.rpgle.txt');
  assert.equal(callResponse.result.structuredContent.maxPayloadLines, 2);
  assert.equal(callResponse.result.structuredContent.payloadLineCount, 2);
  assert.equal(callResponse.result.structuredContent.payloadTruncated, true);
  assert.equal(callResponse.result.structuredContent.lineCount, 3);
  assert.equal(callResponse.result.structuredContent.changedLineCount, 2);
  assert.deepEqual(callResponse.result.structuredContent.rows, [
    { line: 1, marker: ' ', original: '**FREE', modified: '**FREE' },
    { line: 2, marker: '~', original: 'A', modified: 'C' },
  ]);
  assert.match(callResponse.result.structuredContent.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(
    JSON.parse(callResponse.result.content[0].text),
    callResponse.result.structuredContent,
  );
});

test('mcp tools call diff maps invalid arguments to -32602', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    diffRunner: () => {
      throw new Error('No fetched source found for member "ORDERPGM" under /tmp/missing-fetch.');
    },
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 1822,
      method: 'tools/call',
      params: {
        name: 'zeus.diff',
        arguments: {
          profile: 'default-shared',
          member: 'ORDERPGM',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /no fetched source found/i);
      return true;
    },
  );
});

test('mcp tools call generate-test returns deterministic structured payload', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    generateTestRunner: () => ({
      program: 'ORDERPGM',
      format: 'markdown',
      isCritical: true,
      includeChangeScenario: true,
      analysisPath: '/tmp/output/ORDERPGM/canonical-analysis.json',
      outputRoot: '/tmp/output',
      outputPathSuggestion: '/tmp/output/ORDERPGM/test-scenarios.test-plan.md',
      contentLength: 123,
      content: '# Test Scenario\n',
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1823,
    method: 'tools/call',
    params: {
      name: 'zeus.generate-test',
      arguments: {
        program: 'ORDERPGM',
        format: 'markdown',
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.ok, true);
  assert.equal(callResponse.result.structuredContent.program, 'ORDERPGM');
  assert.equal(callResponse.result.structuredContent.format, 'markdown');
  assert.equal(callResponse.result.structuredContent.isCritical, true);
  assert.equal(callResponse.result.structuredContent.includeChangeScenario, true);
  assert.equal(callResponse.result.structuredContent.contentLength, 123);
  assert.equal(callResponse.result.structuredContent.content, '# Test Scenario\n');
  assert.match(callResponse.result.structuredContent.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('mcp tools call generate-test maps invalid arguments to -32602', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    generateTestRunner: () => {
      throw new Error('Invalid arguments for zeus.generate-test: "program" is required');
    },
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 1824,
      method: 'tools/call',
      params: {
        name: 'zeus.generate-test',
        arguments: {
          format: 'markdown',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /"program" is required/i);
      return true;
    },
  );
});

test('mcp tools call generate-checklist returns deterministic structured payload', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    generateChecklistRunner: () => ({
      program: 'ORDERPGM',
      changeType: 'BOTH',
      impact: 'HIGH',
      affectedPrograms: ['ORDERPGM', 'INVPGM'],
      hasCriticalPath: true,
      outputRoot: '/tmp/output',
      analysisPath: '/tmp/output/ORDERPGM/canonical-analysis.json',
      riskPath: '/tmp/output/ORDERPGM/risk-assessment.json',
      outputPathSuggestion: '/tmp/output/ORDERPGM/deployment-checklist.md',
      timeline: { totalHours: 8, workDays: 1, hours: { assess: 2, deploy: 6 } },
      riskAreaCount: 2,
      contentLength: 456,
      content: '# Deployment Checklist\n',
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1825,
    method: 'tools/call',
    params: {
      name: 'zeus.generate-checklist',
      arguments: {
        program: 'ORDERPGM',
        type: 'BOTH',
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.ok, true);
  assert.equal(callResponse.result.structuredContent.program, 'ORDERPGM');
  assert.equal(callResponse.result.structuredContent.changeType, 'BOTH');
  assert.equal(callResponse.result.structuredContent.impact, 'HIGH');
  assert.deepEqual(callResponse.result.structuredContent.affectedPrograms, ['ORDERPGM', 'INVPGM']);
  assert.equal(callResponse.result.structuredContent.hasCriticalPath, true);
  assert.equal(callResponse.result.structuredContent.riskAreaCount, 2);
  assert.equal(callResponse.result.structuredContent.contentLength, 456);
  assert.equal(callResponse.result.structuredContent.content, '# Deployment Checklist\n');
  assert.match(callResponse.result.structuredContent.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('mcp tools call generate-checklist maps invalid arguments to -32602', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    generateChecklistRunner: () => {
      throw new Error('Invalid arguments for zeus.generate-checklist: type must be DDL_CHANGE, CODE_CHANGE, or BOTH.');
    },
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 1826,
      method: 'tools/call',
      params: {
        name: 'zeus.generate-checklist',
        arguments: {
          program: 'ORDERPGM',
          type: 'INVALID',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /type must be ddl_change, code_change, or both/i);
      return true;
    },
  );
});

test('mcp tools call qa returns deterministic structured payload', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    qaRunner: () => ({
      inputPath: '/tmp/output/ORDERPGM/canonical-analysis.json',
      format: 'json',
      strict: 'STRICT',
      qaStatus: 'FAILURE',
      durationMs: 42,
      stageCount: 4,
      failureCount: 1,
      report: {
        format: 'json',
        timestamp: '2026-05-22T00:00:00.000Z',
        reportVersion: '1.0',
        status: '❌ ISSUES FOUND',
        summary: {
          totalIssues: 2,
          criticalCount: 1,
          errorCount: 1,
          warningCount: 0,
        },
        findings: [
          { severity: 'CRITICAL', field: 'STATUS' },
          { severity: 'ERROR', field: 'ACCOUNT' },
        ],
        recommendations: ['Align precondition filter'],
      },
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1827,
    method: 'tools/call',
    params: {
      name: 'zeus.qa',
      arguments: {
        input: './output/ORDERPGM',
        format: 'json',
        strict: 'STRICT',
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.ok, true);
  assert.equal(callResponse.result.structuredContent.inputPath, '/tmp/output/ORDERPGM/canonical-analysis.json');
  assert.equal(callResponse.result.structuredContent.format, 'json');
  assert.equal(callResponse.result.structuredContent.strict, 'STRICT');
  assert.equal(callResponse.result.structuredContent.qaStatus, 'FAILURE');
  assert.equal(callResponse.result.structuredContent.durationMs, 42);
  assert.equal(callResponse.result.structuredContent.stageCount, 4);
  assert.equal(callResponse.result.structuredContent.failureCount, 1);
  assert.deepEqual(callResponse.result.structuredContent.report.summary, {
    totalIssues: 2,
    criticalCount: 1,
    errorCount: 1,
    warningCount: 0,
  });
  assert.match(callResponse.result.structuredContent.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(
    JSON.parse(callResponse.result.content[0].text),
    callResponse.result.structuredContent,
  );
});

test('mcp tools call qa maps invalid arguments to -32602', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    qaRunner: () => {
      throw new Error('Invalid option: --format must be one of jira, markdown, json');
    },
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 1828,
      method: 'tools/call',
      params: {
        name: 'zeus.qa',
        arguments: {
          input: './output/ORDERPGM',
          format: 'xml',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /invalid option: --format/i);
      return true;
    },
  );
});

test('mcp tools call analyses list returns deterministic structured payload', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    analysesRunner: () => ({
      operation: 'list',
      profile: null,
      registryPath: '/tmp/analyses-registry.json',
      workspaceCount: 2,
      workspaces: [
        {
          id: 'workspace_a',
          name: 'Workspace A',
          path: '/tmp/workspace-a',
          outputDir: 'output',
          sourceDir: 'rpg_sources',
          system: '',
          library: '',
          profile: '',
          tags: ['core'],
          registeredAt: '2026-05-22T00:00:00.000Z',
          lastAccessedAt: '2026-05-22T00:10:00.000Z',
          programCount: 3,
        },
        {
          id: 'workspace_b',
          name: 'Workspace B',
          path: '/tmp/workspace-b',
          outputDir: 'output',
          sourceDir: 'rpg_sources',
          system: '',
          library: '',
          profile: '',
          tags: [],
          registeredAt: '2026-05-22T00:01:00.000Z',
          lastAccessedAt: '2026-05-22T00:05:00.000Z',
          programCount: 1,
        },
      ],
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1829,
    method: 'tools/call',
    params: {
      name: 'zeus.analyses',
      arguments: {
        operation: 'list',
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.ok, true);
  assert.equal(callResponse.result.structuredContent.operation, 'list');
  assert.equal(callResponse.result.structuredContent.registryPath, '/tmp/analyses-registry.json');
  assert.equal(callResponse.result.structuredContent.workspaceCount, 2);
  assert.equal(callResponse.result.structuredContent.workspaces.length, 2);
  assert.equal(callResponse.result.structuredContent.workspace, null);
  assert.equal(callResponse.result.structuredContent.index, null);
  assert.match(callResponse.result.structuredContent.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('mcp tools call analyses show returns deterministic structured payload', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    analysesRunner: () => ({
      operation: 'show',
      profile: null,
      registryPath: '/tmp/analyses-registry.json',
      workspace: {
        id: 'workspace_a',
        name: 'Workspace A',
        description: '',
        path: '/tmp/workspace-a',
        outputDir: 'output',
        sourceDir: 'rpg_sources',
        system: '',
        library: '',
        profile: '',
        tags: [],
        registeredAt: '2026-05-22T00:00:00.000Z',
        lastAccessedAt: '2026-05-22T00:10:00.000Z',
      },
      index: {
        available: true,
        generatedAt: '2026-05-22T00:11:00.000Z',
        programCount: 1,
        programs: [
          {
            name: 'ORDERPGM',
            outputDir: 'output/ORDERPGM',
            analyzedAt: '2026-05-22T00:09:00.000Z',
            workflowMode: 'documentation',
            artifactCount: 12,
          },
        ],
        sourceMembers: { QRPGLESRC: 10 },
        reportCount: 1,
        reports: [
          {
            path: 'output/ORDERPGM/architecture-report.md',
            title: 'architecture report',
            generatedAt: '2026-05-22T00:11:00.000Z',
          },
        ],
      },
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1830,
    method: 'tools/call',
    params: {
      name: 'zeus.analyses',
      arguments: {
        operation: 'show',
        id: 'workspace_a',
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.ok, true);
  assert.equal(callResponse.result.structuredContent.operation, 'show');
  assert.equal(callResponse.result.structuredContent.workspace.id, 'workspace_a');
  assert.equal(callResponse.result.structuredContent.index.programCount, 1);
  assert.equal(callResponse.result.structuredContent.workspaces.length, 0);
  assert.equal(callResponse.result.structuredContent.workspaceCount, 0);
  assert.match(callResponse.result.structuredContent.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('mcp tools call analyses maps invalid arguments to -32602', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    analysesRunner: () => {
      throw new Error('Invalid arguments for zeus.analyses: operation must be list or show.');
    },
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 18302,
      method: 'tools/call',
      params: {
        name: 'zeus.analyses',
        arguments: {
          operation: 'open',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /operation must be list or show/i);
      return true;
    },
  );
});

test('mcp knowledge tool is disabled after the privacy reset', async () => {
  const server = createTestServer({ cwd: process.cwd() });
  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 1833,
      method: 'tools/call',
      params: {
        name: 'zeus.knowledge',
        arguments: {},
      },
    }),
    (error) => {
      assert.equal(error.code, -32601);
      assert.match(error.message, /tool is not allowed by mcp policy: zeus\.knowledge/i);
      return true;
    },
  );
});

test('mcp tools call fetch summary returns deterministic structured payload', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    fetchRunner: () => ({
      operation: 'summary',
      profile: 'default-fetch',
      fetchRoot: '/tmp/rpg_sources',
      manifestPath: '/tmp/rpg_sources/zeus-import-manifest.json',
      summary: {
        present: true,
        manifestFile: 'zeus-import-manifest.json',
        manifestPath: '/tmp/rpg_sources/zeus-import-manifest.json',
        schemaVersion: 2,
        fetchedAt: '2026-05-22T00:00:00.000Z',
        sourceLib: 'APPLIB',
        transportRequested: 'auto',
        transportUsed: 'sftp',
        streamFileCcsid: 1208,
        encodingPolicy: 'UTF-8 stream files (CCSID 1208)',
        normalizationPolicy: {
          contentBytes: 'preserve',
          lineEndings: 'preserve',
          localPathFormat: 'relative-forward-slash',
          checksumAlgorithm: 'sha256',
        },
        fileCount: 2,
        exportedFileCount: 2,
        failedFileCount: 0,
        invalidFileCount: 0,
        warningCount: 0,
        traceableFileCount: 2,
      },
      cursor: null,
      cursorOffset: 0,
      nextCursor: null,
      maxPayloadItems: 100,
      payloadResultCount: 0,
      payloadTruncated: false,
      resultCount: 2,
      files: [],
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1831,
    method: 'tools/call',
    params: {
      name: 'zeus.fetch',
      arguments: {
        operation: 'summary',
        profile: 'default-fetch',
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.ok, true);
  assert.equal(callResponse.result.structuredContent.operation, 'summary');
  assert.equal(callResponse.result.structuredContent.profile, 'default-fetch');
  assert.equal(callResponse.result.structuredContent.fetchRoot, '/tmp/rpg_sources');
  assert.equal(callResponse.result.structuredContent.summary.sourceLib, 'APPLIB');
  assert.equal(callResponse.result.structuredContent.summary.fileCount, 2);
  assert.equal(callResponse.result.structuredContent.files.length, 0);
  assert.equal(callResponse.result.structuredContent.nextCursor, null);
  assert.match(callResponse.result.structuredContent.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('mcp tools call fetch files supports deterministic cursor pagination', async () => {
  const files = [
    {
      sourceLib: 'APPLIB',
      sourceFile: 'QRPGLESRC',
      member: 'ALPHA',
      sourceType: 'RPGLE',
      memberPath: '/QSYS.LIB/APPLIB.LIB/QRPGLESRC.FILE/ALPHA.MBR',
      remotePath: '/remote/ALPHA.rpgle',
      localPath: 'QRPGLESRC/ALPHA.rpgle',
      export: {
        status: 'exported',
        transportRequested: 'auto',
        transportUsed: 'sftp',
        fallbackUsed: false,
        streamFileCcsid: 1208,
        encodingPolicy: 'UTF-8 stream files (CCSID 1208)',
      },
      validation: {
        status: 'valid',
        exists: true,
        sizeBytes: 120,
        sha256: 'a'.repeat(64),
        utf8Valid: true,
        newlineStyle: 'LF',
        messageCount: 0,
      },
    },
    {
      sourceLib: 'APPLIB',
      sourceFile: 'QRPGLESRC',
      member: 'BETA',
      sourceType: 'RPGLE',
      memberPath: '/QSYS.LIB/APPLIB.LIB/QRPGLESRC.FILE/BETA.MBR',
      remotePath: '/remote/BETA.rpgle',
      localPath: 'QRPGLESRC/BETA.rpgle',
      export: {
        status: 'exported',
        transportRequested: 'auto',
        transportUsed: 'sftp',
        fallbackUsed: false,
        streamFileCcsid: 1208,
        encodingPolicy: 'UTF-8 stream files (CCSID 1208)',
      },
      validation: {
        status: 'valid',
        exists: true,
        sizeBytes: 90,
        sha256: 'b'.repeat(64),
        utf8Valid: true,
        newlineStyle: 'LF',
        messageCount: 0,
      },
    },
  ];
  const nextCursor = Buffer.from(JSON.stringify({
    v: 1,
    t: 'zeus.fetch',
    o: 1,
  }), 'utf8').toString('base64url');

  const server = createTestServer({
    cwd: process.cwd(),
    fetchRunner: (args) => {
      const incomingCursor = args && typeof args.cursor === 'string' ? args.cursor : null;
      if (!incomingCursor) {
        return {
          operation: 'files',
          profile: null,
          fetchRoot: '/tmp/rpg_sources',
          manifestPath: '/tmp/rpg_sources/zeus-import-manifest.json',
          summary: { fileCount: 2 },
          cursor: null,
          cursorOffset: 0,
          nextCursor,
          maxPayloadItems: 1,
          payloadResultCount: 1,
          payloadTruncated: true,
          resultCount: 2,
          files: [files[0]],
        };
      }
      assert.equal(incomingCursor, nextCursor);
      return {
        operation: 'files',
        profile: null,
        fetchRoot: '/tmp/rpg_sources',
        manifestPath: '/tmp/rpg_sources/zeus-import-manifest.json',
        summary: { fileCount: 2 },
        cursor: nextCursor,
        cursorOffset: 1,
        nextCursor: null,
        maxPayloadItems: 1,
        payloadResultCount: 1,
        payloadTruncated: false,
        resultCount: 2,
        files: [files[1]],
      };
    },
  });

  const firstResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1832,
    method: 'tools/call',
    params: {
      name: 'zeus.fetch',
      arguments: {
        operation: 'files',
        maxPayloadItems: 1,
      },
    },
  });

  assert.equal(firstResponse.result.structuredContent.operation, 'files');
  assert.equal(firstResponse.result.structuredContent.resultCount, 2);
  assert.equal(firstResponse.result.structuredContent.payloadResultCount, 1);
  assert.equal(firstResponse.result.structuredContent.payloadTruncated, true);
  assert.equal(firstResponse.result.structuredContent.cursor, null);
  assert.equal(firstResponse.result.structuredContent.nextCursor, nextCursor);
  assert.equal(firstResponse.result.structuredContent.files[0].member, 'ALPHA');

  const secondResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1833,
    method: 'tools/call',
    params: {
      name: 'zeus.fetch',
      arguments: {
        operation: 'files',
        maxPayloadItems: 1,
        cursor: firstResponse.result.structuredContent.nextCursor,
      },
    },
  });

  assert.equal(secondResponse.result.structuredContent.cursor, nextCursor);
  assert.equal(secondResponse.result.structuredContent.cursorOffset, 1);
  assert.equal(secondResponse.result.structuredContent.nextCursor, null);
  assert.equal(secondResponse.result.structuredContent.payloadTruncated, false);
  assert.equal(secondResponse.result.structuredContent.files[0].member, 'BETA');
});

test('mcp tools call fetch maps invalid arguments to -32602', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    fetchRunner: () => {
      throw new Error('Invalid arguments for zeus.fetch: operation must be summary or files.');
    },
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 1834,
      method: 'tools/call',
      params: {
        name: 'zeus.fetch',
        arguments: {
          operation: 'open',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /operation must be summary or files/i);
      return true;
    },
  );
});

test('mcp tools call test-run show returns deterministic structured payload', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    testRunRunner: () => ({
      operation: 'show',
      profile: null,
      manifestPath: '/tmp/test-run-manifest.json',
      manifest: {
        kind: 'test-run-manifest',
        schemaVersion: 1,
        runId: 'TR-123',
        label: 'Sample run',
        program: 'ORDERPGM',
        status: 'CAPTURED',
        createdAt: '2026-05-22T00:00:00.000Z',
        capturedAt: '2026-05-22T00:05:00.000Z',
        tableCount: 1,
        tables: ['APPLIB.ORDERS'],
        snapshotCount: 1,
        rollbackStatementCount: 2,
      },
      snapshots: [
        {
          table: 'APPLIB.ORDERS',
          beforeRowCount: 1,
          afterRowCount: 1,
          beforeCapturedAt: '2026-05-22T00:00:00.000Z',
          afterCapturedAt: '2026-05-22T00:05:00.000Z',
          afterHasError: false,
          changedRowCount: 1,
        },
      ],
      maxPayloadItems: 100,
      payloadResultCount: 0,
      payloadTruncated: false,
      rollbackStatements: [],
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1835,
    method: 'tools/call',
    params: {
      name: 'zeus.test-run',
      arguments: {
        operation: 'show',
        manifest: './output/test-run-manifest.json',
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.ok, true);
  assert.equal(callResponse.result.structuredContent.operation, 'show');
  assert.equal(callResponse.result.structuredContent.manifestPath, '/tmp/test-run-manifest.json');
  assert.equal(callResponse.result.structuredContent.manifest.program, 'ORDERPGM');
  assert.equal(callResponse.result.structuredContent.manifest.rollbackStatementCount, 2);
  assert.equal(callResponse.result.structuredContent.snapshots.length, 1);
  assert.equal(callResponse.result.structuredContent.rollbackStatements.length, 0);
  assert.match(callResponse.result.structuredContent.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('mcp tools call test-run rollback applies payload cap deterministically', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    testRunRunner: () => ({
      operation: 'rollback',
      profile: null,
      manifestPath: '/tmp/test-run-manifest.json',
      manifest: {
        kind: 'test-run-manifest',
        schemaVersion: 1,
        runId: 'TR-123',
        label: 'Sample run',
        program: 'ORDERPGM',
        status: 'CAPTURED',
        createdAt: '2026-05-22T00:00:00.000Z',
        capturedAt: '2026-05-22T00:05:00.000Z',
        tableCount: 1,
        tables: ['APPLIB.ORDERS'],
        snapshotCount: 1,
        rollbackStatementCount: 3,
      },
      snapshots: [],
      maxPayloadItems: 2,
      payloadResultCount: 2,
      payloadTruncated: true,
      rollbackStatements: [
        'UPDATE APPLIB.ORDERS SET STATUS = 0 WHERE ID = 1;',
        'DELETE FROM APPLIB.ORDERS WHERE ID = 99;',
      ],
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1836,
    method: 'tools/call',
    params: {
      name: 'zeus.test-run',
      arguments: {
        operation: 'rollback',
        manifest: './output/test-run-manifest.json',
        maxPayloadItems: 2,
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.operation, 'rollback');
  assert.equal(callResponse.result.structuredContent.maxPayloadItems, 2);
  assert.equal(callResponse.result.structuredContent.payloadResultCount, 2);
  assert.equal(callResponse.result.structuredContent.payloadTruncated, true);
  assert.equal(callResponse.result.structuredContent.rollbackStatements.length, 2);
  assert.match(callResponse.result.structuredContent.rollbackStatements[0], /^UPDATE APPLIB\.ORDERS/i);
});

test('mcp tools call test-run maps invalid arguments to -32602', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    testRunRunner: () => {
      throw new Error('Invalid arguments for zeus.test-run: operation must be show or rollback.');
    },
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 1837,
      method: 'tools/call',
      params: {
        name: 'zeus.test-run',
        arguments: {
          operation: 'open',
          manifest: './output/test-run-manifest.json',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /operation must be show or rollback/i);
      return true;
    },
  );
});

test('mcp tools call copy-to-workspace plan returns deterministic structured payload', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    copyToWorkspaceRunner: () => ({
      operation: 'plan',
      profile: 'default-shared',
      sourceRoot: '/tmp/rpg_sources',
      targetRoot: '/tmp/workspace',
      workCopyMode: 'txt',
      force: false,
      requestedMemberCount: 2,
      discoveredCount: 4,
      selectedCount: 1,
      copyCandidateCount: 1,
      overwriteCount: 0,
      existingCount: 0,
      skippedCount: 1,
      cursor: null,
      cursorOffset: 0,
      nextCursor: null,
      maxPayloadItems: 100,
      payloadResultCount: 2,
      payloadTruncated: false,
      resultCount: 2,
      entries: [
        {
          status: 'will copy',
          member: 'ORDERPGM',
          source: 'QRPGLESRC/ORDERPGM.rpgle',
          target: 'workspace/ORDERPGM.rpgle.txt',
          note: '',
        },
        {
          status: 'skipped',
          member: 'MISSINGPGM',
          source: '',
          target: '',
          note: 'No fetched source found for requested member.',
        },
      ],
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1838,
    method: 'tools/call',
    params: {
      name: 'zeus.copy-to-workspace',
      arguments: {
        operation: 'plan',
        profile: 'default-shared',
        members: 'ORDERPGM,MISSINGPGM',
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.ok, true);
  assert.equal(callResponse.result.structuredContent.operation, 'plan');
  assert.equal(callResponse.result.structuredContent.profile, 'default-shared');
  assert.equal(callResponse.result.structuredContent.workCopyMode, 'txt');
  assert.equal(callResponse.result.structuredContent.copyCandidateCount, 1);
  assert.equal(callResponse.result.structuredContent.skippedCount, 1);
  assert.equal(callResponse.result.structuredContent.entries.length, 2);
  assert.equal(callResponse.result.structuredContent.entries[0].status, 'will copy');
  assert.match(callResponse.result.structuredContent.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('mcp tools call copy-to-workspace plan supports deterministic cursor pagination', async () => {
  const nextCursor = Buffer.from(JSON.stringify({
    v: 1,
    t: 'zeus.copy-to-workspace',
    o: 1,
  }), 'utf8').toString('base64url');

  const server = createTestServer({
    cwd: process.cwd(),
    copyToWorkspaceRunner: (args) => {
      const incomingCursor = args && typeof args.cursor === 'string' ? args.cursor : null;
      if (!incomingCursor) {
        return {
          operation: 'plan',
          profile: 'default-shared',
          sourceRoot: '/tmp/rpg_sources',
          targetRoot: '/tmp/workspace',
          workCopyMode: 'txt',
          force: false,
          requestedMemberCount: 0,
          discoveredCount: 2,
          selectedCount: 2,
          copyCandidateCount: 2,
          overwriteCount: 0,
          existingCount: 0,
          skippedCount: 0,
          cursor: null,
          cursorOffset: 0,
          nextCursor,
          maxPayloadItems: 1,
          payloadResultCount: 1,
          payloadTruncated: true,
          resultCount: 2,
          entries: [
            {
              status: 'will copy',
              member: 'ALPHA',
              source: 'QRPGLESRC/ALPHA.rpgle',
              target: 'workspace/ALPHA.rpgle.txt',
              note: '',
            },
          ],
        };
      }
      assert.equal(incomingCursor, nextCursor);
      return {
        operation: 'plan',
        profile: 'default-shared',
        sourceRoot: '/tmp/rpg_sources',
        targetRoot: '/tmp/workspace',
        workCopyMode: 'txt',
        force: false,
        requestedMemberCount: 0,
        discoveredCount: 2,
        selectedCount: 2,
        copyCandidateCount: 2,
        overwriteCount: 0,
        existingCount: 0,
        skippedCount: 0,
        cursor: nextCursor,
        cursorOffset: 1,
        nextCursor: null,
        maxPayloadItems: 1,
        payloadResultCount: 1,
        payloadTruncated: false,
        resultCount: 2,
        entries: [
          {
            status: 'will copy',
            member: 'BETA',
            source: 'QRPGLESRC/BETA.rpgle',
            target: 'workspace/BETA.rpgle.txt',
            note: '',
          },
        ],
      };
    },
  });

  const firstResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1839,
    method: 'tools/call',
    params: {
      name: 'zeus.copy-to-workspace',
      arguments: {
        operation: 'plan',
        profile: 'default-shared',
        maxPayloadItems: 1,
      },
    },
  });

  assert.equal(firstResponse.result.structuredContent.payloadResultCount, 1);
  assert.equal(firstResponse.result.structuredContent.payloadTruncated, true);
  assert.equal(firstResponse.result.structuredContent.nextCursor, nextCursor);
  assert.equal(firstResponse.result.structuredContent.entries[0].member, 'ALPHA');

  const secondResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1840,
    method: 'tools/call',
    params: {
      name: 'zeus.copy-to-workspace',
      arguments: {
        operation: 'plan',
        profile: 'default-shared',
        maxPayloadItems: 1,
        cursor: firstResponse.result.structuredContent.nextCursor,
      },
    },
  });

  assert.equal(secondResponse.result.structuredContent.cursor, nextCursor);
  assert.equal(secondResponse.result.structuredContent.cursorOffset, 1);
  assert.equal(secondResponse.result.structuredContent.nextCursor, null);
  assert.equal(secondResponse.result.structuredContent.payloadTruncated, false);
  assert.equal(secondResponse.result.structuredContent.entries[0].member, 'BETA');
});

test('mcp tools call copy-to-workspace maps invalid arguments to -32602', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    copyToWorkspaceRunner: () => {
      throw new Error('Invalid arguments for zeus.copy-to-workspace: operation must be plan.');
    },
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 1841,
      method: 'tools/call',
      params: {
        name: 'zeus.copy-to-workspace',
        arguments: {
          operation: 'apply',
          profile: 'default-shared',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /operation must be plan/i);
      return true;
    },
  );
});

test('mcp tools call serve summary returns deterministic structured payload', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    serveRunner: () => ({
      operation: 'summary',
      profile: 'default-shared',
      outputRoot: '/tmp/output',
      outputRootExists: true,
      host: '127.0.0.1',
      port: 4782,
      bindUrl: 'http://127.0.0.1:4782',
      registryPath: '/tmp/analyses-registry.json',
      registryConfigured: true,
      registryExists: true,
      workspaceCount: 2,
      runCount: 3,
      latestRun: {
        program: 'ORDERPGM',
        status: 'SUCCESS',
        completedAt: '2026-05-22T00:00:00.000Z',
        artifactCount: 15,
        safeSharingEnabled: true,
      },
      apiRoutes: ['/api/health', '/api/runs', '/api/analyses', '/api/prompt-builder/templates'],
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1842,
    method: 'tools/call',
    params: {
      name: 'zeus.serve',
      arguments: {
        operation: 'summary',
        profile: 'default-shared',
      },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.equal(callResponse.result.structuredContent.ok, true);
  assert.equal(callResponse.result.structuredContent.operation, 'summary');
  assert.equal(callResponse.result.structuredContent.profile, 'default-shared');
  assert.equal(callResponse.result.structuredContent.outputRootExists, true);
  assert.equal(callResponse.result.structuredContent.workspaceCount, 2);
  assert.equal(callResponse.result.structuredContent.runCount, 3);
  assert.equal(callResponse.result.structuredContent.latestRun.program, 'ORDERPGM');
  assert.deepEqual(callResponse.result.structuredContent.apiRoutes.slice(0, 2), ['/api/health', '/api/runs']);
  assert.match(callResponse.result.structuredContent.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('mcp tools call serve maps invalid arguments to -32602', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    serveRunner: () => {
      throw new Error('Invalid arguments for zeus.serve: operation must be summary.');
    },
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 1843,
      method: 'tools/call',
      params: {
        name: 'zeus.serve',
        arguments: {
          operation: 'start',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /operation must be summary/i);
      return true;
    },
  );
});

test('mcp tools call joblog sanitizes backend runtime failures into deterministic tool error', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    joblogRunner: () => {
      throw new Error('SQLSTATE=08001 password=super-secret host=prod.example.internal');
    },
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 1823,
      method: 'tools/call',
      params: {
        name: 'zeus.joblog',
        arguments: {
          profile: 'default-shared',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32000);
      assert.match(error.message, /zeus\.joblog failed to query backend service/i);
      assert.doesNotMatch(error.message, /sqlstate|password|prod\.example\.internal/i);
      return true;
    },
  );
});

test('mcp tools call inspect-object sanitizes backend runtime failures into deterministic tool error', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    inspectObjectRunner: () => {
      throw new Error('JDBC handshake failure for host=prod.example.internal token=abc123');
    },
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 1824,
      method: 'tools/call',
      params: {
        name: 'zeus.inspect-object',
        arguments: {
          profile: 'default-shared',
          lib: 'QGPL',
          name: 'ORDERPGM',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32000);
      assert.match(error.message, /zeus\.inspect-object failed to query backend service/i);
      assert.doesNotMatch(error.message, /token=|prod\.example\.internal/i);
      return true;
    },
  );
});

test('mcp tools call enforces tool execution timeout guardrail', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    toolExecutionTimeoutMs: 10,
    diffRunner: async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return {
        profile: 'default-shared',
        member: 'ORDERPGM',
        fetchRoot: '/tmp/fetched',
        workspaceRoot: '/tmp/workspace',
        workCopyMode: 'txt',
        originalPath: '/tmp/fetched/QRPGLESRC/ORDERPGM.rpgle',
        modifiedPath: '/tmp/workspace/ORDERPGM.rpgle.txt',
        maxPayloadLines: 1,
        payloadLineCount: 1,
        payloadTruncated: false,
        lineCount: 1,
        changedLineCount: 0,
        rows: [{ line: 1, marker: ' ', original: 'A', modified: 'A' }],
      };
    },
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 1825,
      method: 'tools/call',
      params: {
        name: 'zeus.diff',
        arguments: {
          profile: 'default-shared',
          member: 'ORDERPGM',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32000);
      assert.match(error.message, /tool execution timed out/i);
      assert.match(error.message, /zeus\.diff/i);
      return true;
    },
  );
});

test('mcp tools call enforces maximum response-size guardrail', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    maxToolResponseBytes: 180,
    diffRunner: () => ({
      profile: 'default-shared',
      member: 'ORDERPGM',
      fetchRoot: '/tmp/fetched',
      workspaceRoot: '/tmp/workspace',
      workCopyMode: 'txt',
      originalPath: '/tmp/fetched/QRPGLESRC/ORDERPGM.rpgle',
      modifiedPath: '/tmp/workspace/ORDERPGM.rpgle.txt',
      maxPayloadLines: 2,
      payloadLineCount: 2,
      payloadTruncated: false,
      lineCount: 2,
      changedLineCount: 2,
      rows: [
        { line: 1, marker: '~', original: 'A'.repeat(120), modified: 'B'.repeat(120) },
        { line: 2, marker: '~', original: 'C'.repeat(120), modified: 'D'.repeat(120) },
      ],
    }),
  });

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 1826,
      method: 'tools/call',
      params: {
        name: 'zeus.diff',
        arguments: {
          profile: 'default-shared',
          member: 'ORDERPGM',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32000);
      assert.match(error.message, /exceeds maximum response size/i);
      return true;
    },
  );
});

test('mcp tools call search-source returns deterministic structured payload', async () => {
  const server = createTestServer({
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
  const server = createTestServer({
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
  const server = createTestServer({
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

  const server = createTestServer({
    cwd: tempRoot,
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

  const server = createTestServer({
    cwd: tempRoot,
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

test('mcp tools call search-source rejects legacy numeric cursor by default', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-search-source-'));
  const sourceRoot = path.join(tempRoot, 'src');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'A.rpgle'), 'CHAIN(E) CUSTID CUSTOMER;\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, 'B.rpgle'), 'CHAIN ORDERKEY ORDERS;\n', 'utf8');

  const server = createTestServer({
    cwd: tempRoot,
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
        assert.match(error.message, /legacy numeric cursor input is no longer supported/i);
        return true;
      },
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('mcp tools call field-search returns deterministic structured payload', async () => {
  const server = createTestServer({
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
  const server = createTestServer({
    cwd: '/tmp',
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

  const server = createTestServer({
    cwd: tempRoot,
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

  const server = createTestServer({
    cwd: tempRoot,
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

  const server = createTestServer({
    cwd: tempRoot,
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

test('mcp tools call field-search rejects legacy numeric cursor by default', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-field-search-'));
  const sourceRoot = path.join(tempRoot, 'src');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'A.rpgle'), 'chain(e) CUSTID CUSTOMER;\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, 'B.rpgle'), 'if CUSTID > 0;\n', 'utf8');

  const server = createTestServer({
    cwd: tempRoot,
  });

  try {
    await assert.rejects(
      () => server.handleRequest({
        jsonrpc: '2.0',
        id: 18336,
        method: 'tools/call',
        params: {
          name: 'zeus.field-search',
          arguments: {
            sourceRoot,
            field: 'CUSTID',
            cursor: '1',
          },
        },
      }),
      (error) => {
        assert.equal(error.code, -32602);
        assert.match(error.message, /legacy numeric cursor input is no longer supported/i);
        return true;
      },
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('mcp tools call joblog returns deterministic structured payload', async () => {
  const server = createTestServer({
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
  assert.equal(callResponse.result.structuredContent.backend, 'JOBLOG_INFO');
  assert.equal(callResponse.result.structuredContent.compatibilityNote, null);
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

test('mcp tools call joblog exposes compatibility note when fallback backend is used', async () => {
  const server = createTestServer({
    cwd: process.cwd(),
    joblogRunner: () => ({
      profile: 'default-local',
      job: null,
      severity: 'ERROR',
      maxMessages: 10,
      backend: 'HISTORY_LOG_INFO',
      compatibilityNote: 'Compatibility mode: results came from HISTORY_LOG_INFO, so the requested severity "ERROR" is best-effort and may not exactly match JOBLOG_INFO semantics.',
      rowCount: 1,
      uniqueMessageIdCount: 1,
      limitReached: false,
      columns: ['JOB_NAME', 'MESSAGE_ID', 'MESSAGE_TYPE', 'MESSAGE_TEXT', 'MESSAGE_TIMESTAMP'],
      rows: [
        {
          JOB_NAME: '477227/QSYS/QINTER',
          MESSAGE_ID: 'CPI1133',
          MESSAGE_TYPE: 'INFORMATIONAL',
          MESSAGE_TEXT: 'All jobs at work station QPADEV003G disconnected.',
          MESSAGE_TIMESTAMP: '2026-05-20 19:43:35.922190',
        },
      ],
    }),
  });

  const callResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 18341,
    method: 'tools/call',
    params: {
      name: 'zeus.joblog',
      arguments: {
        profile: 'default-local',
        severity: 'ERROR',
        maxMessages: 10,
      },
    },
  });

  assert.equal(callResponse.result.structuredContent.backend, 'HISTORY_LOG_INFO');
  assert.match(callResponse.result.structuredContent.compatibilityNote, /best-effort/i);
});

test('mcp tools call joblog maps invalid arguments to -32602', async () => {
  const server = createTestServer({
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
  const server = createTestServer({
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
  const server = createTestServer({
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
  const server = createTestServer({
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
  const server = createTestServer({
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
  const server = createTestServer({
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
  const server = createTestServer({
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
  const server = createTestServer({
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
  const server = createTestServer({
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
  const server = createTestServer({
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
  const server = createTestServer({
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
  const server = createTestServer({
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
  const server = createTestServer({
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
  const server = createTestServer({
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
  const server = createTestServer({
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

test('mcp tools call impact rejects legacy numeric cursor by default', async () => {
  const server = createTestServer({
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

  await assert.rejects(
    () => server.handleRequest({
      jsonrpc: '2.0',
      id: 1914,
      method: 'tools/call',
      params: {
        name: 'zeus.impact',
        arguments: {
          target: 'ORDERPGM',
          cursor: '1',
        },
      },
    }),
    (error) => {
      assert.equal(error.code, -32602);
      assert.match(error.message, /legacy numeric cursor input is no longer supported/i);
      return true;
    },
  );
});

test('mcp tools call assess-risk returns deterministic structured payload', async () => {
  const server = createTestServer({
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
  const server = createTestServer({
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

  const server = createTestServer({
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

  const server = createTestServer({
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

  const server = createTestServer({
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

  const server = createTestServer({
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

  const server = createTestServer({
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
    const server = createTestServer({
      cwd: tempRoot,
      auditPath,
      allowlistedTools: ['zeus.health', 'zeus.doctor'],
    });

    await server.handleRequest({
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: {
        name: 'zeus.doctor',
        arguments: {
          profile: 'default-shared',
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
    assert.equal(entries[0].toolName, 'zeus.doctor');
    assert.equal(entries[0].profile, 'default-shared');
    assert.equal(entries[0].dryRun, false);
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
    const server = createTestServer({
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
    const server = createTestServer({
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
