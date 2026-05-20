const test = require('node:test');
const assert = require('node:assert/strict');

const {
  encodeJsonRpcMessage,
  parseIncomingMessages,
} = require('../src/mcp/stdioTransport');

test('mcp transport parses content-length framed messages', () => {
  const payload = { jsonrpc: '2.0', id: 1, method: 'ping' };
  const encoded = encodeJsonRpcMessage(payload);
  const parsed = parseIncomingMessages(encoded);

  assert.equal(parsed.messages.length, 1);
  assert.deepEqual(JSON.parse(parsed.messages[0]), payload);
  assert.equal(parsed.pending.length, 0);
});

test('mcp transport parses line-delimited JSON messages', () => {
  const line = Buffer.from('{"jsonrpc":"2.0","id":2,"method":"ping"}\n', 'utf8');
  const parsed = parseIncomingMessages(line);

  assert.equal(parsed.messages.length, 1);
  assert.equal(parsed.pending.length, 0);
  assert.equal(JSON.parse(parsed.messages[0]).id, 2);
});

