'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildWorkflowSuggestion } = require('../src/mcp/workflowSuggest');
const { createMcpServer } = require('../src/mcp/mcpServer');
const { listMcpTools } = require('../src/mcp/mcpTools');

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

test('workflow suggestion includes checkpoints and onFailure recovery metadata', () => {
  const result = buildWorkflowSuggestion({
    goal: 'Assess dependency risk for ORDERPGM',
    profile: 'dev',
  });
  assert.ok(Array.isArray(result.checkpoints));
  assert.ok(result.checkpoints.length >= 2);
  const doctor = result.steps.find(step => step.tool === 'zeus.doctor');
  assert.equal(doctor.checkpoint, 'doctor-ok');
  assert.equal(doctor.onFailure.code, 'MISSING_PROFILE');
  const analyze = result.steps.find(step => step.tool === 'zeus.analyze');
  assert.equal(analyze.checkpoint, 'artifacts-present');
  assert.equal(analyze.onFailure.code, 'ANALYZE_REQUIRED');
  assert.ok(result.checkpoints.some(c => c.id === 'doctor-ok'));
  assert.ok(result.checkpoints.some(c => c.id === 'artifacts-present'));
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
  assert.equal(query.checkpoint, 'pi-query-approval');
  assert.equal(query.onFailure.code, 'APPROVAL_REQUIRED');
  const discover = payload.steps.find(step => step.tool === 'zeus.project-knowledge.discover');
  assert.equal(discover.checkpoint, 'pi-presence');
  assert.equal(discover.onFailure.code, 'PI_ABSENT');
  assert.ok(Array.isArray(payload.checkpoints));
  assert.ok(payload.checkpoints.some(c => c.id === 'pi-query-approval'));
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

test('high-traffic MCP tool schemas include examples and tighter descriptions', () => {
  const byName = new Map(listMcpTools().map(tool => [tool.name, tool]));
  const highTraffic = [
    'zeus.doctor',
    'zeus.workflow.suggest',
    'zeus.analyze',
    'zeus.impact',
    'zeus.search-source',
    'zeus.investigation.start',
  ];
  for (const name of highTraffic) {
    const tool = byName.get(name);
    assert.ok(tool, `${name} should be registered`);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.ok(tool.description.length > 40, `${name} description should be informative`);
    const props = tool.inputSchema.properties || {};
    const hasExample = Object.values(props).some(
      p => Array.isArray(p.examples) && p.examples.length > 0
    );
    assert.ok(hasExample, `${name} should include at least one property example`);
  }

  const suggest = byName.get('zeus.workflow.suggest');
  assert.ok(suggest.inputSchema.properties.goal.examples.length >= 2);
  assert.ok(/checkpoint/i.test(suggest.description));

  const analyze = byName.get('zeus.analyze');
  assert.ok(analyze.inputSchema.properties.program.examples.includes('ORDERPGM'));
  assert.ok(/ANALYZE_REQUIRED|source/i.test(analyze.description));
});
