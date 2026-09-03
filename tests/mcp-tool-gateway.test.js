const test = require('node:test');
const assert = require('node:assert/strict');

const { createMcpToolGateway } = require('../src/mcp/mcpToolGateway');

function createAuditRecorder() {
  const events = [];
  return {
    events,
    appendToolCallEvent(event) {
      events.push(event);
    },
  };
}

test('mcp tool gateway filters tools and returns the stable MCP result envelope', async () => {
  const auditLogger = createAuditRecorder();
  const gateway = createMcpToolGateway({
    runtime: {
      allowlistedTools: ['zeus.allowed'],
    },
    context: { cwd: process.cwd() },
    redactor: {
      sanitizePayload: value => ({ ...value, secret: '[REDACTED]' }),
    },
    auditLogger,
    tools: [
      { name: 'zeus.allowed', description: 'Allowed' },
      { name: 'zeus.hidden', description: 'Hidden' },
    ],
    executeMcpToolCall: async (name, args, context) => ({
      name,
      args,
      cwd: context.cwd,
      secret: 'do-not-leak',
    }),
  });

  assert.deepEqual(
    gateway.listTools().map(tool => tool.name),
    ['zeus.allowed']
  );
  const result = await gateway.call('zeus.allowed', { profile: 'local', dryRun: true });

  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.secret, '[REDACTED]');
  assert.equal(result.structuredContent.name, 'zeus.allowed');
  assert.equal(auditLogger.events.length, 1);
  assert.deepEqual(auditLogger.events[0], {
    toolName: 'zeus.allowed',
    profile: 'local',
    dryRun: true,
    policyDecision: 'allowed',
    status: 'success',
    resultCode: 0,
  });
});

test('mcp tool gateway refuses non-allowlisted tools and audits the policy decision', async () => {
  const auditLogger = createAuditRecorder();
  const gateway = createMcpToolGateway({
    runtime: { allowlistedTools: ['zeus.allowed'] },
    auditLogger,
    tools: [{ name: 'zeus.allowed' }, { name: 'zeus.blocked' }],
    executeMcpToolCall: async () => ({ ok: true }),
  });

  await assert.rejects(
    () => gateway.call('zeus.blocked', { 'dry-run': 'yes' }),
    error => {
      assert.equal(error.code, 'TOOL_NOT_ALLOWED');
      return true;
    }
  );
  assert.equal(auditLogger.events.length, 1);
  assert.equal(auditLogger.events[0].policyDecision, 'refused');
  assert.equal(auditLogger.events[0].resultCode, -32601);
  assert.equal(auditLogger.events[0].dryRun, true);
});

test('mcp tool gateway enforces timeout and response-size limits before success audit', async () => {
  const auditLogger = createAuditRecorder();
  const gateway = createMcpToolGateway({
    runtime: {
      allowlistedTools: ['zeus.slow', 'zeus.large'],
      toolExecutionTimeoutMs: 10,
      maxToolResponseBytes: 80,
    },
    auditLogger,
    tools: [{ name: 'zeus.slow' }, { name: 'zeus.large' }],
    executeMcpToolCall: async name => {
      if (name === 'zeus.slow') {
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      return name === 'zeus.large' ? { data: 'x'.repeat(200) } : { ok: true };
    },
  });

  await assert.rejects(
    () => gateway.call('zeus.slow'),
    error => error.code === 'TOOL_TIMEOUT'
  );
  await assert.rejects(
    () => gateway.call('zeus.large'),
    error => error.code === 'TOOL_RESPONSE_TOO_LARGE'
  );

  assert.equal(auditLogger.events.length, 2);
  assert.deepEqual(
    auditLogger.events.map(event => event.resultCode),
    [-32000, -32000]
  );
  assert.ok(auditLogger.events.every(event => event.status === 'error'));
});
