'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildAgentFailurePlaybook,
  listFailureCodes,
  getFailureEntry,
  isKnownFailureCode,
  FAILURE_ENTRIES,
} = require('../src/mcp/agentFailurePlaybook');
const { buildAgentBootstrapPayload } = require('../src/mcp/agentBootstrap');
const { createMcpServer } = require('../src/mcp/mcpServer');
const { listMcpTools } = require('../src/mcp/mcpTools');

const REQUIRED_CODES = [
  'POLICY_REFUSED',
  'MISSING_PROFILE',
  'ANALYZE_REQUIRED',
  'UNRESOLVED_REFS',
  'PI_ABSENT',
  'INVALID_ARGS',
  'RUNTIME_BACKEND',
  'PATH_OUTSIDE_WORKSPACE',
  'APPROVAL_REQUIRED',
  'TOOL_NOT_ALLOWED',
];

test('failure playbook exposes stable codes and recovery fields', () => {
  const codes = listFailureCodes();
  assert.ok(codes.length >= 10);
  for (const code of REQUIRED_CODES) {
    assert.ok(codes.includes(code), `missing code ${code}`);
    assert.equal(isKnownFailureCode(code), true);
    const entry = getFailureEntry(code);
    assert.ok(entry);
    assert.equal(entry.code, code);
    assert.ok(entry.summary.length > 10);
    assert.ok(Array.isArray(entry.do) && entry.do.length >= 1);
    assert.ok(Array.isArray(entry.dont) && entry.dont.length >= 1);
    assert.ok(Array.isArray(entry.nextTools) && entry.nextTools.length >= 1);
  }

  const full = buildAgentFailurePlaybook({ compact: false });
  assert.equal(full.schemaVersion, 1);
  assert.equal(full.kind, 'zeus.agent-failure-playbook');
  assert.equal(full.resource, 'zeus://metadata/agent-failure-playbook.json');
  assert.equal(full.markdown, 'zeus://docs/ai/agent-failure-playbook.md');
  assert.equal(full.entries.length, FAILURE_ENTRIES.length);
  assert.ok(full.entries[0].do);
  assert.ok(full.entries[0].dont);

  const compact = buildAgentFailurePlaybook({ compact: true });
  assert.equal(compact.entries.length, FAILURE_ENTRIES.length);
  assert.equal(compact.entries[0].do, undefined);
  assert.ok(compact.entries[0].summary);
  assert.ok(Array.isArray(compact.entries[0].nextTools));
});

test('compact playbook is embedded in agent bootstrap', () => {
  const bootstrap = buildAgentBootstrapPayload();
  assert.ok(bootstrap.failurePlaybook);
  assert.equal(bootstrap.failurePlaybook.schemaVersion, 1);
  assert.equal(bootstrap.failurePlaybook.kind, 'zeus.agent-failure-playbook');
  assert.ok(Array.isArray(bootstrap.failurePlaybook.codes));
  for (const code of REQUIRED_CODES) {
    assert.ok(bootstrap.failurePlaybook.codes.includes(code));
  }
  assert.ok(
    bootstrap.communityFallbacks.some(line => /failurePlaybook/i.test(line)),
    'communityFallbacks should mention failurePlaybook'
  );
});

test('MCP resources expose failure playbook json and markdown', async () => {
  const allTools = listMcpTools().map(t => t.name);
  const server = createMcpServer({
    cwd: process.cwd(),
    allowlistedTools: allTools,
  });

  const listResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'resources/list',
    params: {},
  });
  const uris = listResponse.result.resources.map(r => r.uri);
  assert.ok(uris.includes('zeus://metadata/agent-failure-playbook.json'));
  assert.ok(uris.includes('zeus://docs/ai/agent-failure-playbook.md'));

  const jsonResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 2,
    method: 'resources/read',
    params: { uri: 'zeus://metadata/agent-failure-playbook.json' },
  });
  assert.equal(jsonResponse.result.contents[0].mimeType, 'application/json');
  const playbook = JSON.parse(jsonResponse.result.contents[0].text);
  assert.equal(playbook.schemaVersion, 1);
  assert.ok(playbook.entries.some(e => e.code === 'POLICY_REFUSED' && Array.isArray(e.do)));

  const mdResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 3,
    method: 'resources/read',
    params: { uri: 'zeus://docs/ai/agent-failure-playbook.md' },
  });
  assert.equal(mdResponse.result.contents[0].mimeType, 'text/markdown');
  assert.match(mdResponse.result.contents[0].text, /POLICY_REFUSED/);
  assert.match(mdResponse.result.contents[0].text, /ANALYZE_REQUIRED/);
});

test('markdown playbook file is present and lists required codes', () => {
  const mdPath = path.join(__dirname, '..', 'docs', 'ai', 'agent-failure-playbook.md');
  assert.ok(fs.existsSync(mdPath));
  const text = fs.readFileSync(mdPath, 'utf8');
  for (const code of REQUIRED_CODES) {
    assert.ok(text.includes(code), `markdown missing ${code}`);
  }
});
