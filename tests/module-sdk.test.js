'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const {
  normalizeModuleDescriptor,
  createModuleRegistrar,
  createAtomicModuleRegistrar,
  REASON_CODES,
  LIFECYCLE,
  DESCRIPTOR_VERSION,
  MODULE_API_VERSION,
  CAPABILITY_SIDE_EFFECTS,
} = require('../src/modules');
const {
  buildValidDescriptor,
  createMockRegister,
  runModuleContractTests,
} = require('../src/modules/contractTestKit');
const { createCapabilityRegistry } = require('../src/core/capabilityRegistry');
const { CONTRACT_IDS, INITIAL_SCHEMAS } = require('../src/core/contracts/schemas');
const { createZeus } = require('../src/api/zeusApi');

function capability({
  id,
  version = 1,
  aliases = [],
  level = 'S1',
  sideEffects = ['local-read'],
} = {}) {
  return {
    id,
    version,
    aliases,
    title: id,
    safety: { level, sideEffects, requiresExplicitApproval: false },
    execute: async () => ({}),
  };
}

function registerCapabilities(...capabilities) {
  return ({ capabilityRegistry }) => {
    for (const descriptor of capabilities) capabilityRegistry.register(descriptor);
  };
}

function buildMultiCapabilityDescriptor(overrides = {}) {
  return buildValidDescriptor({
    capabilities: [
      { id: 'example.first', version: 1 },
      { id: 'example.second', version: 1 },
    ],
    ...overrides,
  });
}

test('module descriptor contract is registered', () => {
  assert.ok(INITIAL_SCHEMAS[CONTRACT_IDS.MODULE_DESCRIPTOR]);
  assert.ok(INITIAL_SCHEMAS[CONTRACT_IDS.MODULE_STATUS]);
  assert.equal(DESCRIPTOR_VERSION, 'zeus.module-descriptor/v1');
  assert.equal(MODULE_API_VERSION, '1.0.0');
  assert.ok(CAPABILITY_SIDE_EFFECTS.includes('local-read'));
  assert.ok(CAPABILITY_SIDE_EFFECTS.includes('remote-write'));
});

test('module status schema accepts only closed lifecycle, availability, and reason codes', () => {
  const statusSchema = INITIAL_SCHEMAS[CONTRACT_IDS.MODULE_STATUS].schema;
  const validStatus = createAtomicModuleRegistrar().notInstalledStatus();
  assert.deepEqual(statusSchema(validStatus), []);
  assert.ok(statusSchema({ ...validStatus, reasonCode: 'VENDOR_DETAIL' }).length > 0);
  assert.ok(statusSchema({ ...validStatus, availability: 'maybe' }).length > 0);
  assert.ok(statusSchema({ ...validStatus, lifecycle: 'half-registered' }).length > 0);
});

test('valid descriptor normalizes deterministically', () => {
  const a = normalizeModuleDescriptor(buildValidDescriptor());
  const b = normalizeModuleDescriptor(buildValidDescriptor());
  assert.equal(a.ok, true);
  assert.deepEqual(a.descriptor, b.descriptor);
  assert.equal(a.descriptor.edition, 'community');
  assert.equal(a.descriptor.entitlement.mode, 'none');
});

test('rejects missing safety, bad id, and license material', () => {
  assert.equal(normalizeModuleDescriptor(buildValidDescriptor({ safety: null })).ok, false);
  assert.equal(normalizeModuleDescriptor(buildValidDescriptor({ id: 'nopath' })).ok, false);
  assert.equal(normalizeModuleDescriptor(buildValidDescriptor({ licenseKey: 'ABC' })).ok, false);
  assert.equal(
    normalizeModuleDescriptor(
      buildValidDescriptor({ entitlement: { mode: 'module-managed', key: 'x' } })
    ).ok,
    false
  );
});

test('registers module and capability; core does not enforce entitlement', async () => {
  const registrar = createAtomicModuleRegistrar({
    capabilityRegistry: createCapabilityRegistry(),
  });
  const result = await registrar.registerModule({
    descriptor: buildValidDescriptor(),
    register: createMockRegister(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.status.reasonCode, REASON_CODES.AVAILABLE);
  assert.equal(result.status.coreEnforcesEntitlement, false);
  assert.ok(registrar.capabilityRegistry.get('example.inspect'));
});

test('registers multiple declared capabilities in one atomic batch', async () => {
  const registrar = createAtomicModuleRegistrar();
  const result = await registrar.registerModule({
    descriptor: buildMultiCapabilityDescriptor(),
    register: registerCapabilities(
      capability({ id: 'example.first' }),
      capability({ id: 'example.second' })
    ),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(
    registrar.capabilityRegistry.list().map(entry => entry.id),
    ['example.first', 'example.second']
  );
  assert.equal(registrar.listModules().length, 1);
});

test('id conflict on capability 2 leaves host and module state unchanged', async () => {
  const caps = createCapabilityRegistry();
  caps.register(capability({ id: 'example.second' }));
  const before = caps.list().map(entry => ({ id: entry.id, aliases: entry.aliases }));
  const registrar = createAtomicModuleRegistrar({ capabilityRegistry: caps });
  const result = await registrar.registerModule({
    descriptor: buildMultiCapabilityDescriptor(),
    register: registerCapabilities(
      capability({ id: 'example.first' }),
      capability({ id: 'example.second' })
    ),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.reasonCode, REASON_CODES.CAPABILITY_CONFLICT);
  assert.deepEqual(
    caps.list().map(entry => ({ id: entry.id, aliases: entry.aliases })),
    before
  );
  assert.equal(caps.get('example.first'), null);
  assert.equal(registrar.listModules().length, 0);
});

test('alias conflict on capability 2 leaves host and module state unchanged', async () => {
  const caps = createCapabilityRegistry();
  caps.register(capability({ id: 'host.existing', aliases: ['taken-alias'] }));
  const before = caps.list().map(entry => ({ id: entry.id, aliases: entry.aliases }));
  const registrar = createAtomicModuleRegistrar({ capabilityRegistry: caps });
  const result = await registrar.registerModule({
    descriptor: buildMultiCapabilityDescriptor(),
    register: registerCapabilities(
      capability({ id: 'example.first', aliases: ['first-alias'] }),
      capability({ id: 'example.second', aliases: ['taken-alias'] })
    ),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.reasonCode, REASON_CODES.CAPABILITY_CONFLICT);
  assert.deepEqual(
    caps.list().map(entry => ({ id: entry.id, aliases: entry.aliases })),
    before
  );
  assert.equal(caps.get('example.first'), null);
  assert.equal(caps.get('first-alias'), null);
  assert.equal(registrar.listModules().length, 0);
});

test('compatibility createModuleRegistrar surface delegates to atomic registration', async () => {
  const caps = createCapabilityRegistry();
  caps.register(capability({ id: 'example.second' }));
  const registrar = createModuleRegistrar({ capabilityRegistry: caps });
  const result = await registrar.registerModule({
    descriptor: buildMultiCapabilityDescriptor(),
    register: registerCapabilities(
      capability({ id: 'example.first' }),
      capability({ id: 'example.second' })
    ),
  });
  assert.equal(result.ok, false);
  assert.equal(caps.get('example.first'), null);
  assert.equal(registrar.listModules().length, 0);
});

test('concurrent registration reserves module id before awaiting its callback', async () => {
  const registrar = createAtomicModuleRegistrar();
  let releaseFirst;
  let markEntered;
  let secondCallbackCalled = false;
  const entered = new Promise(resolve => {
    markEntered = resolve;
  });
  const release = new Promise(resolve => {
    releaseFirst = resolve;
  });
  const input = {
    descriptor: buildValidDescriptor(),
    async register({ capabilityRegistry }) {
      markEntered();
      await release;
      capabilityRegistry.register(capability({ id: 'example.inspect' }));
    },
  };
  const firstPromise = registrar.registerModule(input);
  await entered;
  const second = await registrar.registerModule({
    descriptor: buildValidDescriptor(),
    register() {
      secondCallbackCalled = true;
    },
  });
  releaseFirst();
  const first = await firstPromise;
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.status.reasonCode, REASON_CODES.DUPLICATE_MODULE_ID);
  assert.equal(secondCallbackCalled, false);
  assert.equal(registrar.listModules().length, 1);
});

test('duplicate module id fails closed', async () => {
  const registrar = createAtomicModuleRegistrar();
  const input = { descriptor: buildValidDescriptor(), register: createMockRegister() };
  assert.equal((await registrar.registerModule(input)).ok, true);
  const second = await registrar.registerModule(input);
  assert.equal(second.ok, false);
  assert.equal(second.status.reasonCode, REASON_CODES.DUPLICATE_MODULE_ID);
});

test('incompatible moduleApi fails closed', async () => {
  const registrar = createAtomicModuleRegistrar();
  const result = await registrar.registerModule({
    descriptor: buildValidDescriptor({ compatibility: { moduleApi: '>=99.0.0' } }),
    register: createMockRegister(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.reasonCode, REASON_CODES.INCOMPATIBLE_CORE);
});

test('missing runtime feature fails closed', async () => {
  const registrar = createAtomicModuleRegistrar({ hostFeatures: ['node-crypto'] });
  const result = await registrar.registerModule({
    descriptor: buildValidDescriptor({
      runtime: { requiredFeatures: ['local-filesystem'] },
    }),
    register: createMockRegister(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.reasonCode, REASON_CODES.RUNTIME_UNAVAILABLE);
});

test('handler failure does not partially register module', async () => {
  const caps = createCapabilityRegistry();
  const registrar = createAtomicModuleRegistrar({ capabilityRegistry: caps });
  const result = await registrar.registerModule({
    descriptor: buildValidDescriptor(),
    register: ({ capabilityRegistry }) => {
      capabilityRegistry.register({
        id: 'example.inspect',
        version: 1,
        title: 'x',
        safety: { level: 'S1', sideEffects: ['local-read'], requiresExplicitApproval: false },
        execute: async () => ({}),
      });
      throw new Error('later failure token=supersecret');
    },
  });
  assert.equal(result.ok, false);
  assert.equal(registrar.listModules().length, 0);
  // ephemeral staging means host caps stay empty
  assert.equal(caps.list().filter(c => c.id === 'example.inspect').length, 0);
  assert.ok(!JSON.stringify(result).includes('supersecret'));
});

test('capability conflict on commit is isolated', async () => {
  const caps = createCapabilityRegistry();
  caps.register({
    id: 'example.inspect',
    version: 1,
    title: 'existing',
    safety: { level: 'S1', sideEffects: ['local-read'], requiresExplicitApproval: false },
    execute: async () => ({}),
  });
  const registrar = createAtomicModuleRegistrar({ capabilityRegistry: caps });
  const result = await registrar.registerModule({
    descriptor: buildValidDescriptor(),
    register: createMockRegister(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.reasonCode, REASON_CODES.CAPABILITY_CONFLICT);
  assert.equal(registrar.listModules().length, 0);
});

test('untrusted path field is denied', async () => {
  const registrar = createAtomicModuleRegistrar();
  const result = await registrar.registerModule({
    descriptor: buildValidDescriptor(),
    register: createMockRegister(),
    modulePath: '/tmp/evil.js',
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.reasonCode, REASON_CODES.POLICY_DENIED);
});

test('module-reported entitlement status is display-only', async () => {
  const registrar = createAtomicModuleRegistrar();
  const result = await registrar.registerModule({
    descriptor: buildValidDescriptor({
      edition: 'professional',
      entitlement: { mode: 'module-managed' },
    }),
    register: createMockRegister(),
    status: {
      availability: 'unavailable',
      reasonCode: REASON_CODES.ENTITLEMENT_EXPIRED,
      message: 'Entitlement expired',
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.status.reasonCode, REASON_CODES.ENTITLEMENT_EXPIRED);
  assert.equal(result.status.coreEnforcesEntitlement, false);
});

test('unknown module reason code fails closed to a fixed neutral code', async () => {
  const registrar = createAtomicModuleRegistrar();
  const result = await registrar.registerModule({
    descriptor: buildValidDescriptor(),
    register: createMockRegister(),
    status: { availability: 'available', reasonCode: 'VENDOR_INTERNAL_FAILURE_42' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.reasonCode, REASON_CODES.MODULE_UNAVAILABLE);
  assert.equal(registrar.capabilityRegistry.get('example.inspect'), null);
  assert.equal(registrar.listModules().length, 0);
});

test('module cannot report core-owned registration reason codes', async () => {
  for (const reasonCode of [
    REASON_CODES.NOT_INSTALLED,
    REASON_CODES.DESCRIPTOR_INVALID,
    REASON_CODES.MODULE_API_INCOMPATIBLE,
    REASON_CODES.DUPLICATE_MODULE_ID,
    REASON_CODES.CAPABILITY_CONFLICT,
    REASON_CODES.MODULE_INITIALIZATION_FAILED,
  ]) {
    const registrar = createAtomicModuleRegistrar();
    const result = await registrar.registerModule({
      descriptor: buildValidDescriptor(),
      register: createMockRegister(),
      status: { availability: 'unavailable', reasonCode },
    });
    assert.equal(result.ok, false);
    assert.equal(result.status.lifecycle, LIFECYCLE.REJECTED);
    assert.equal(result.status.reasonCode, REASON_CODES.MODULE_UNAVAILABLE);
    assert.equal(registrar.capabilityRegistry.get('example.inspect'), null);
    assert.equal(registrar.listModules().length, 0);
  }
});

test('invalid or incoherent module availability fails closed', async () => {
  for (const status of [
    { availability: 'maybe', reasonCode: REASON_CODES.AVAILABLE },
    { availability: 'available', reasonCode: REASON_CODES.ENTITLEMENT_EXPIRED },
    { availability: 'unavailable', reasonCode: REASON_CODES.AVAILABLE },
  ]) {
    const registrar = createAtomicModuleRegistrar();
    const result = await registrar.registerModule({
      descriptor: buildValidDescriptor(),
      register: createMockRegister(),
      status,
    });
    assert.equal(result.ok, false);
    assert.equal(result.status.reasonCode, REASON_CODES.MODULE_UNAVAILABLE);
    assert.equal(registrar.capabilityRegistry.get('example.inspect'), null);
  }
});

test('secret-like module reason code is never published', async () => {
  const registrar = createAtomicModuleRegistrar();
  const supplied = 'TOKEN_customer-123_C:\\Users\\alice\\license.key';
  const result = await registrar.registerModule({
    descriptor: buildValidDescriptor(),
    register: createMockRegister(),
    status: { availability: 'available', reasonCode: supplied },
  });
  const serialized = JSON.stringify(result);
  assert.equal(result.ok, false);
  assert.equal(result.status.reasonCode, REASON_CODES.MODULE_UNAVAILABLE);
  assert.equal(serialized.includes(supplied), false);
  assert.equal(serialized.includes('customer-123'), false);
  assert.equal(serialized.includes('Users'), false);
});

test('registered capability version must exactly match the descriptor', async () => {
  const registrar = createAtomicModuleRegistrar();
  const result = await registrar.registerModule({
    descriptor: buildValidDescriptor(),
    register: registerCapabilities(capability({ id: 'example.inspect', version: 2 })),
  });
  assert.equal(result.ok, false);
  assert.equal(registrar.capabilityRegistry.get('example.inspect'), null);
  assert.equal(registrar.listModules().length, 0);
});

test('additional undeclared capability is rejected', async () => {
  const registrar = createAtomicModuleRegistrar();
  const result = await registrar.registerModule({
    descriptor: buildValidDescriptor(),
    register: registerCapabilities(
      capability({ id: 'example.inspect' }),
      capability({ id: 'example.extra' })
    ),
  });
  assert.equal(result.ok, false);
  assert.equal(registrar.capabilityRegistry.get('example.inspect'), null);
  assert.equal(registrar.capabilityRegistry.get('example.extra'), null);
  assert.equal(registrar.listModules().length, 0);
});

test('declared but missing capability is rejected', async () => {
  const registrar = createAtomicModuleRegistrar();
  const result = await registrar.registerModule({
    descriptor: buildMultiCapabilityDescriptor(),
    register: registerCapabilities(capability({ id: 'example.first' })),
  });
  assert.equal(result.ok, false);
  assert.equal(registrar.capabilityRegistry.get('example.first'), null);
  assert.equal(registrar.listModules().length, 0);
});

test('capability side effects must be declared by the module', async () => {
  const registrar = createAtomicModuleRegistrar();
  const result = await registrar.registerModule({
    descriptor: buildValidDescriptor(),
    register: registerCapabilities(
      capability({ id: 'example.inspect', sideEffects: ['remote-write'] })
    ),
  });
  assert.equal(result.ok, false);
  assert.equal(registrar.capabilityRegistry.get('example.inspect'), null);
  assert.equal(registrar.listModules().length, 0);
});

test('unknown side effects fail closed in module and capability descriptors', async () => {
  assert.equal(
    normalizeModuleDescriptor(
      buildValidDescriptor({ safety: { level: 'S1', sideEffects: ['unknown-effect'] } })
    ).ok,
    false
  );
  const registrar = createAtomicModuleRegistrar();
  const result = await registrar.registerModule({
    descriptor: buildValidDescriptor(),
    register: registerCapabilities(
      capability({ id: 'example.inspect', sideEffects: ['unknown-effect'] })
    ),
  });
  assert.equal(result.ok, false);
  assert.equal(registrar.capabilityRegistry.get('example.inspect'), null);
});

test('atomic module registrar rejects a sealed host before invoking module code', () => {
  const caps = createCapabilityRegistry();
  caps.seal();
  assert.throws(
    () => createAtomicModuleRegistrar({ capabilityRegistry: caps }),
    /registry is sealed/
  );
});

test('host sealed after registrar creation rejects before invoking module code', async () => {
  const caps = createCapabilityRegistry();
  const registrar = createAtomicModuleRegistrar({ capabilityRegistry: caps });
  let callbackCalled = false;
  caps.seal();
  const result = await registrar.registerModule({
    descriptor: buildValidDescriptor(),
    register() {
      callbackCalled = true;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.reasonCode, REASON_CODES.REGISTRATION_FAILED);
  assert.equal(callbackCalled, false);
});

test('host sealed during staging rejects commit without partial state', async () => {
  const caps = createCapabilityRegistry();
  const registrar = createAtomicModuleRegistrar({ capabilityRegistry: caps });
  const result = await registrar.registerModule({
    descriptor: buildValidDescriptor(),
    register({ capabilityRegistry }) {
      capabilityRegistry.register(capability({ id: 'example.inspect' }));
      caps.seal();
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.reasonCode, REASON_CODES.REGISTRATION_FAILED);
  assert.equal(caps.get('example.inspect'), null);
  assert.equal(registrar.listModules().length, 0);
});

test('createZeus exposes modules registrar without commercial deps', async () => {
  const zeus = createZeus();
  assert.equal(typeof zeus.modules.registerModule, 'function');
  assert.equal(zeus.moduleContracts.MODULE_API_VERSION, MODULE_API_VERSION);
  const result = await zeus.modules.registerModule({
    descriptor: buildValidDescriptor({ id: 'demo.module' }),
    register: createMockRegister(),
  });
  assert.equal(result.ok, true);
  // Community core still has analyzers/providers/generationValidation
  assert.ok(zeus.generationValidation);
  assert.ok(zeus.providers);
});

test('contract test kit passes against core', async () => {
  const summary = await runModuleContractTests({ returnResults: false });
  assert.equal(summary.ok, true);
});

test('package export path module-contract-test is present', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.exports['./module-contract-test'], './src/modules/contractTestKit.js');
  assert.ok(fs.existsSync(path.join(__dirname, '../src/modules/contractTestKit.js')));
});

test('community artifacts remain readable without modules', () => {
  const zeus = createZeus();
  assert.equal(zeus.modules.listModules().length, 0);
  assert.equal(zeus.modules.notInstalledStatus().reasonCode, REASON_CODES.NOT_INSTALLED);
  // Existing public surface still available
  assert.equal(typeof zeus.analyze, 'function');
  assert.equal(typeof zeus.contracts.createSchemaRegistry, 'function');
});

test('status rejects secret-like module status payloads', async () => {
  const registrar = createAtomicModuleRegistrar();
  const result = await registrar.registerModule({
    descriptor: buildValidDescriptor(),
    register: createMockRegister(),
    status: {
      availability: 'available',
      reasonCode: 'AVAILABLE',
      licenseKey: 'should-not-appear',
    },
  });
  // licenseKey on status object is extra; we stringify check for secret patterns
  // Our check looks for license key patterns in JSON
  assert.equal(result.ok, false);
  assert.equal(result.status.reasonCode, REASON_CODES.POLICY_DENIED);
});
