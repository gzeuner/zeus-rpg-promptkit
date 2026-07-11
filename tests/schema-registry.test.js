const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSchemaRegistry,
  SchemaValidationError,
} = require('../src/core/contracts');

const {
  CONTRACT_IDS,
  INITIAL_SCHEMAS,
} = require('../src/core/contracts/schemas');

test('createSchemaRegistry allows registration and successful validation', () => {
  const registry = createSchemaRegistry();
  registry.register({
    id: 'zeus.test-contract',
    version: 1,
    schema: (v) => (v && v.ok === true ? [] : [{ path: '', message: 'must have ok:true' }]),
  });

  const good = registry.validate('zeus.test-contract', 1, { ok: true, extra: 42 });
  assert.equal(good.ok, true);
  assert.deepEqual(good.value, { ok: true, extra: 42 });

  const bad = registry.validate('zeus.test-contract', 1, { ok: false });
  assert.equal(bad.ok, false);
  assert.ok(Array.isArray(bad.errors));
  assert.ok(bad.errors.length > 0);
});

test('validate returns deterministic structured errors for unknown contract', () => {
  const registry = createSchemaRegistry();
  const res = registry.validate('zeus.does-not-exist', 99, {});
  assert.equal(res.ok, false);
  assert.ok(res.errors.length >= 1);
  assert.match(res.errors[0].message, /Unknown contract or unsupported version/);
});

test('duplicate registration is rejected', () => {
  const registry = createSchemaRegistry();
  registry.register({ id: 'zeus.dup', version: 1, schema: () => [] });
  assert.throws(() => {
    registry.register({ id: 'zeus.dup', version: 1, schema: () => [] });
  }, /Duplicate registration/);
});

test('registry rejects non-positive version and bad ids', () => {
  const registry = createSchemaRegistry();
  assert.throws(() => registry.register({ id: '', version: 1, schema: () => [] }));
  assert.throws(() => registry.register({ id: 'zeus.bad', version: 0, schema: () => [] }));
  assert.throws(() => registry.register({ id: 'zeus.bad', version: 1.5, schema: () => [] }));
});

test('initial contract shells from package 02 are registered and validate basic headers', () => {
  const registry = createSchemaRegistry();

  for (const [id, { version, schema }] of Object.entries(INITIAL_SCHEMAS)) {
    registry.register({ id, version, schema });
  }

  // zeus.run-manifest shell
  const manifestOk = registry.validate(CONTRACT_IDS.RUN_MANIFEST, 1, {
    schemaVersion: 1,
    tool: { name: 'zeus' },
    run: { status: 'succeeded' },
  });
  assert.equal(manifestOk.ok, true);

  const manifestBadVersion = registry.validate(CONTRACT_IDS.RUN_MANIFEST, 1, {
    schemaVersion: 99,
    tool: {},
    run: {},
  });
  assert.equal(manifestBadVersion.ok, false);
  assert.ok(manifestBadVersion.errors.some(e => e.path.includes('schemaVersion')));

  // safety policy shell
  const safetyOk = registry.validate(CONTRACT_IDS.SAFETY_POLICY, 1, {
    schemaVersion: 1,
    level: 'S2',
  });
  assert.equal(safetyOk.ok, true);

  const safetyBad = registry.validate(CONTRACT_IDS.SAFETY_POLICY, 1, {
    schemaVersion: 1,
    level: 'S9',
  });
  assert.equal(safetyBad.ok, false);
});

test('validation errors are bounded and deterministic', () => {
  const registry = createSchemaRegistry();
  registry.register({
    id: 'zeus.multi-error',
    version: 1,
    schema: () => [
      { path: '/b', message: 'second' },
      { path: '/a', message: 'first' },
      { path: '/a', message: 'first' }, // duplicate
      ...Array.from({ length: 30 }, (_, i) => ({ path: `/x${i}`, message: 'many' })),
    ],
  });

  const res = registry.validate('zeus.multi-error', 1, {});
  assert.equal(res.ok, false);
  assert.ok(res.errors.length <= 20);
  // Sorted by path
  assert.equal(res.errors[0].path, '/a');
  assert.equal(res.errors[1].path, '/b');
});

test('validation errors do not leak secrets', () => {
  const registry = createSchemaRegistry();
  registry.register({
    id: 'zeus.secret-test',
    version: 1,
    schema: (v) => {
      if (v && v.password) {
        return [{ path: '/password', message: `bad password value was ${v.password}` }];
      }
      return [];
    },
  });

  const res = registry.validate('zeus.secret-test', 1, { password: 'super-secret-123' });
  assert.equal(res.ok, false);
  const msg = JSON.stringify(res.errors);
  assert.ok(!msg.includes('super-secret-123'));
  assert.ok(msg.includes('[REDACTED]') || msg.includes('bad password'));
});

test('registry can be used via public contracts module', () => {
  const { createSchemaRegistry } = require('../src/core/contracts');
  const r = createSchemaRegistry();
  assert.ok(typeof r.register === 'function');
  assert.ok(typeof r.validate === 'function');
});
