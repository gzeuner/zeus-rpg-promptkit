'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildWorkflowSuggestion } = require('../src/mcp/workflowSuggest');
const { createMcpServer } = require('../src/mcp/mcpServer');

test('workflow suggestion maps a goal to real ordered tools without executing', () => {
  const result = buildWorkflowSuggestion({
    goal: 'Assess dependency risk for ORDERPGM',
    profile: 'dev',
  });
  assert.equal(result.plan, 'risk-review');
  assert.equal(result.readOnly, true);
  assert.equal(result.executionStarted, false);
  assert.deepEqual(
    result.steps.map(step => step.tool),
    [
      'zeus.agent.bootstrap',
      'zeus.help',
      'zeus.doctor',
      'zeus.analyze',
      'zeus.impact',
      'zeus.assess-risk',
    ]
  );
  assert.ok(result.steps.every(step => typeof step.safety === 'string'));
  assert.equal(
    result.steps.some(step => step.approvalRequired),
    false
  );
});

test('MCP workflow suggestion is default-allowlisted and flags explicit PI query', async () => {
  const server = createMcpServer({ cwd: process.cwd() });
  const response = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'zeus.workflow.suggest',
      arguments: { goal: 'Find this in the project knowledge base' },
    },
  });
  const payload = response.result.structuredContent;
  assert.equal(response.result.isError, false);
  assert.equal(payload.plan, 'project-knowledge');
  const query = payload.steps.find(step => step.tool === 'zeus.project-knowledge.query');
  assert.ok(query);
  assert.equal(query.approvalRequired, true);
  assert.equal(query.defaultAllowlisted, false);
});

test('MCP workflow suggestion requires a non-empty goal', async () => {
  const server = createMcpServer({ cwd: process.cwd() });
  await assert.rejects(
    () =>
      server.handleRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'zeus.workflow.suggest', arguments: {} },
      }),
    error => error.code === -32602 && /goal/i.test(error.message)
  );
});
