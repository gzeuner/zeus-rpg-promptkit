const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeBridgeConfig } = require('../src/bridge/bridgeConfig');

test('normalizeBridgeConfig keeps bridge disabled by default', () => {
  const config = normalizeBridgeConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.mode, 'plan-only');
  assert.equal(config.compile.enabled, false);
});

test('normalizeBridgeConfig rejects invalid bridge mode', () => {
  assert.throws(
    () =>
      normalizeBridgeConfig({
        bridge: {
          mode: 'ship-it',
        },
      }),
    /Invalid bridge.mode/
  );
});
