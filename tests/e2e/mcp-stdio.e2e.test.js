/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createMcpStdioClient } = require('./support/mcp-stdio-client');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const cliPath = path.join(repositoryRoot, 'cli', 'zeus.js');

function assertNoSensitiveOutput(value, forbiddenPath) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  assert.doesNotMatch(text, /(?:password|secret|credential|private\s*key|BEGIN [A-Z ]+ KEY)/i);
  assert.equal(
    text.includes(forbiddenPath),
    false,
    'private workspace path leaked into MCP output'
  );
}

test('real MCP stdio server supports safe read-only flow and deterministic policy denial', async t => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'zeus-mcp-e2e-'));
  const sourceFile = path.join(workspace, 'synthetic-source.rpgle');
  await fs.writeFile(sourceFile, '** synthetic source fixture only **\n', 'utf8');

  const client = createMcpStdioClient({
    cliPath,
    cwd: workspace,
    allowTools: ['zeus.health'],
  });
  t.after(async () => {
    await client.close();
    await fs.rm(workspace, { recursive: true, force: true });
  });

  const initialize = await client.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'zeus-synthetic-e2e', version: '1.0.0' },
  });
  assert.equal(initialize.result.protocolVersion, '2024-11-05');
  assert.equal(initialize.result.serverInfo.name, 'zeus-rpg-promptkit');

  const toolsList = await client.request('tools/list');
  assert.deepEqual(
    toolsList.result.tools.map(tool => tool.name),
    ['zeus.health']
  );

  const health = await client.request('tools/call', { name: 'zeus.health', arguments: {} });
  assert.equal(health.result.isError, false);
  assert.equal(health.result.structuredContent.ok, true);
  assert.equal(health.result.structuredContent.mode, 'local-only');

  const denied = await client.request('tools/call', {
    name: 'zeus.write-sql',
    arguments: { operation: 'apply', sql: 'UPDATE synthetic_table SET value = 1' },
  });
  assert.equal(denied.error.code, -32601);
  assert.match(denied.error.message, /not allowed by MCP policy/);

  assertNoSensitiveOutput(initialize, workspace);
  assertNoSensitiveOutput(toolsList, workspace);
  assertNoSensitiveOutput(health, workspace);
  assertNoSensitiveOutput(denied, workspace);
  assertNoSensitiveOutput(client.getStderr(), workspace);
});
