const test = require('node:test');
const assert = require('node:assert/strict');

const { __private } = require('../src/mcp/mcpTools');

test('encodeMcpCursor and decodeMcpCursor round-trip opaque cursor state', () => {
  const encoded = __private.encodeMcpCursor('zeus.search-source', 42);
  assert.equal(typeof encoded, 'string');
  assert.ok(encoded.length > 0);

  const decoded = __private.decodeMcpCursor('zeus.search-source', encoded);
  assert.deepEqual(decoded, {
    cursor: encoded,
    offset: 42,
    isLegacyNumeric: false,
  });
});

test('decodeMcpCursor accepts legacy numeric cursor input during transition', () => {
  const decoded = __private.decodeMcpCursor('zeus.field-search', '7');
  assert.deepEqual(decoded, {
    cursor: '7',
    offset: 7,
    isLegacyNumeric: true,
  });
});

test('decodeMcpCursor can reject legacy numeric cursor input in strict mode', () => {
  assert.throws(
    () => __private.decodeMcpCursor('zeus.field-search', '7', { allowLegacyNumericCursor: false }),
    /legacy numeric cursor input is disabled/i,
  );
});

test('decodeMcpCursor rejects cursor token for another tool', () => {
  const encoded = __private.encodeMcpCursor('zeus.search-source', 3);

  assert.throws(
    () => __private.decodeMcpCursor('zeus.impact', encoded),
    /token target does not match this tool/i,
  );
});

test('decodeMcpCursor rejects unsupported cursor version', () => {
  const badVersionCursor = Buffer.from(JSON.stringify({
    v: 999,
    t: 'zeus.search-source',
    o: 1,
  }), 'utf8').toString('base64url');

  assert.throws(
    () => __private.decodeMcpCursor('zeus.search-source', badVersionCursor),
    /unsupported cursor version/i,
  );
});

test('decodeMcpCursor rejects malformed opaque tokens', () => {
  assert.throws(
    () => __private.decodeMcpCursor('zeus.search-source', 'not-a-valid-token'),
    /legacy numeric offset or an opaque versioned token/i,
  );
});
