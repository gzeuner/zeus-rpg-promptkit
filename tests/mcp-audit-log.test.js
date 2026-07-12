const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  MCP_AUDIT_LEGACY_SCHEMA_VERSION,
  MCP_AUDIT_SCHEMA_VERSION,
  createMcpAuditLogger,
  normalizeMcpAuditEvent,
  readMcpAuditEvents,
} = require('../src/mcp/mcpAuditLog');

test('normalizeMcpAuditEvent adds legacy schema version when missing', () => {
  const normalized = normalizeMcpAuditEvent({
    eventType: 'mcp.tools.call',
    toolName: 'zeus.health',
  });

  assert.equal(normalized.schemaVersion, MCP_AUDIT_LEGACY_SCHEMA_VERSION);
  assert.equal(normalized.toolName, 'zeus.health');
});

test('readMcpAuditEvents returns normalized events for legacy and current schema lines', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-audit-read-'));
  const auditPath = path.join(tempRoot, 'audit', 'mcp-audit.jsonl');

  try {
    fs.mkdirSync(path.dirname(auditPath), { recursive: true });
    fs.writeFileSync(
      auditPath,
      [
        JSON.stringify({
          timestamp: '2026-05-20T00:00:00.000Z',
          eventType: 'mcp.tools.call',
          toolName: 'zeus.health',
          status: 'success',
        }),
        JSON.stringify({
          timestamp: '2026-05-20T00:00:01.000Z',
          schemaVersion: MCP_AUDIT_SCHEMA_VERSION,
          eventType: 'mcp.tools.call',
          toolName: 'zeus.version',
          status: 'success',
        }),
      ].join('\n'),
      'utf8'
    );

    const result = readMcpAuditEvents({ auditPath });
    assert.equal(result.events.length, 2);
    assert.equal(result.parseErrors.length, 0);
    assert.equal(result.events[0].schemaVersion, MCP_AUDIT_LEGACY_SCHEMA_VERSION);
    assert.equal(result.events[1].schemaVersion, MCP_AUDIT_SCHEMA_VERSION);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('readMcpAuditEvents tolerates malformed lines and reports parse errors', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-audit-parse-'));
  const auditPath = path.join(tempRoot, 'audit', 'mcp-audit.jsonl');

  try {
    fs.mkdirSync(path.dirname(auditPath), { recursive: true });
    fs.writeFileSync(
      auditPath,
      [
        JSON.stringify({ eventType: 'mcp.tools.call', toolName: 'zeus.health' }),
        '{"eventType":"mcp.tools.call",bad json',
        JSON.stringify({
          schemaVersion: MCP_AUDIT_SCHEMA_VERSION,
          eventType: 'mcp.tools.call',
          toolName: 'zeus.version',
        }),
      ].join('\n'),
      'utf8'
    );

    const result = readMcpAuditEvents({ auditPath });
    assert.equal(result.events.length, 2);
    assert.equal(result.parseErrors.length, 1);
    assert.equal(result.parseErrors[0].line, 2);
    assert.match(result.parseErrors[0].message, /json|expected|unterminated|property/i);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('readMcpAuditEvents returns empty output for missing audit file', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-audit-missing-'));

  try {
    const auditPath = path.join(tempRoot, 'audit', 'mcp-audit.jsonl');
    const result = readMcpAuditEvents({ auditPath });
    assert.equal(result.events.length, 0);
    assert.equal(result.parseErrors.length, 0);
    assert.equal(result.auditPath, path.resolve(auditPath));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('createMcpAuditLogger emits schema version readable by compatibility reader', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-audit-write-read-'));
  const auditPath = path.join(tempRoot, 'audit', 'mcp-audit.jsonl');

  try {
    const logger = createMcpAuditLogger({ cwd: tempRoot, auditPath });
    logger.appendToolCallEvent({
      toolName: 'zeus.health',
      status: 'success',
      resultCode: 0,
      policyDecision: 'allowed',
      dryRun: false,
      profile: null,
    });

    const result = readMcpAuditEvents({ auditPath });
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].schemaVersion, MCP_AUDIT_SCHEMA_VERSION);
    assert.equal(result.events[0].toolName, 'zeus.health');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
