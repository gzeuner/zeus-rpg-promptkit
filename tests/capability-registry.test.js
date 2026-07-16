const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createCapabilityRegistry,
  TINY_VERSION_CAPABILITY,
} = require('../src/core/capabilityRegistry');

test('capability registry registers and retrieves by id and alias', () => {
  const reg = createCapabilityRegistry();
  reg.register(TINY_VERSION_CAPABILITY);

  const byId = reg.get('system.version');
  assert.ok(byId);
  assert.equal(byId.id, 'system.version');
  assert.equal(byId.version, 1);

  const byAlias = reg.get('version');
  assert.equal(byAlias.id, 'system.version');
});

test('capability registry rejects duplicate id', () => {
  const reg = createCapabilityRegistry();
  reg.register(TINY_VERSION_CAPABILITY);
  assert.throws(() => reg.register(TINY_VERSION_CAPABILITY), /duplicate capability id/);
});

test('capability registry rejects duplicate alias', () => {
  const reg = createCapabilityRegistry();
  reg.register(TINY_VERSION_CAPABILITY);
  assert.throws(() => {
    reg.register({ ...TINY_VERSION_CAPABILITY, id: 'another', aliases: ['version'] });
  }, /duplicate alias/);
});

test('capability registry execute returns structured result', async () => {
  const reg = createCapabilityRegistry();
  reg.register(TINY_VERSION_CAPABILITY);

  const res = await reg.execute('system.version', { some: 'ctx' }, {});
  assert.equal(res.ok, true);
  assert.equal(res.capability.id, 'system.version');
  assert.ok(res.result && res.result.version);
});

test('capability registry execute returns error envelope on failure', async () => {
  const reg = createCapabilityRegistry();
  reg.register({
    ...TINY_VERSION_CAPABILITY,
    id: 'test.fail',
    aliases: [],
    execute: async () => {
      throw new Error('boom with secret123');
    },
  });

  const res = await reg.execute('test.fail');
  assert.equal(res.ok, false);
  assert.ok(res.error);
  assert.ok(!String(res.error.message).includes('secret123'), 'secrets should be redacted');
});

test('capability registry list is deterministic', () => {
  const reg = createCapabilityRegistry();
  reg.register(TINY_VERSION_CAPABILITY);
  reg.register({
    id: 'test.alpha',
    version: 1,
    title: 'Alpha',
    category: 'test',
    safety: { level: 'S0', sideEffects: [], requiresExplicitApproval: false },
    aliases: [],
    inputContract: null,
    outputContract: null,
    availability: {},
    docs: {},
    execute: async () => ({}),
  });

  const listed = reg.list();
  assert.equal(listed[0].id, 'system.version'); // sorted
  assert.equal(listed[1].id, 'test.alpha');
});

test('capability registry supports filtering', () => {
  const reg = createCapabilityRegistry();
  reg.register(TINY_VERSION_CAPABILITY);
  const listed = reg.list({ safetyLevel: 'S0' });
  assert.ok(listed.length >= 1);
});

test('investigation capability declares its local writes and actual public surfaces', () => {
  const { capabilities } = require('../src/api/zeusApi');
  const searchSource = capabilities.resolve('investigation.search-source');
  assert.ok(searchSource);
  assert.equal(searchSource.safety.level, 'S0');
  assert.deepEqual(searchSource.safety.sideEffects, ['local-read']);
  assert.equal(searchSource.availability.mcp, true);

  const capability = capabilities.resolve('investigation.investigate');
  assert.ok(capability);
  assert.equal(capability.safety.level, 'S1');
  assert.deepEqual(capability.safety.sideEffects, ['local-artifact-write']);
  assert.equal(capability.availability.cli, true);
  assert.equal(capability.availability.api, true);
  assert.equal(capability.availability.mcp, false);
});

test('capability registry can be sealed', () => {
  const reg = createCapabilityRegistry();
  reg.seal();
  assert.throws(() => reg.register(TINY_VERSION_CAPABILITY), /sealed/);
});
