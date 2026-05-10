const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { appendBridgeAuditEvent } = require('../src/bridge/bridgeAuditLog');

test('appendBridgeAuditEvent masks secrets in audit output', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-bridge-audit-'));
  try {
    const result = appendBridgeAuditEvent({
      outputRoot: tempRoot,
      event: {
        command: 'bridge plan',
        maskedConfigurationSummary: {
          token: 'abc123',
          user: 'APPUSR',
          password: 'secret-value',
        },
      },
    });
    const lines = fs.readFileSync(result.auditPath, 'utf8').trim().split(/\r?\n/);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.maskedConfigurationSummary.token, '[REDACTED]');
    assert.equal(entry.maskedConfigurationSummary.password, '[REDACTED]');
    assert.equal(entry.maskedConfigurationSummary.user, '[REDACTED]');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
