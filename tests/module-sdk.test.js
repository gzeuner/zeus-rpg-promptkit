'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const {
  normalizeModuleDescriptor,
  createAtomicModuleRegistrar,
  REASON_CODES,
  DESCRIPTOR_VERSION,
  MODULE_API_VERSION,
} = require('../src/modules');
const {
  buildValidDescriptor,
  createMockRegister,
  runModuleContractTests,
} = require('../src/modules/contractTestKit');
const { createCapabilityRegistry } = require('../src/core/capabilityRegistry');
const { CONTRACT_IDS, INITIAL_SCHEMAS } = require('../src/core/contracts/schemas');
const { createZeus } = require('../src/api/zeusApi');

test('module descriptor contract is registered', () => {
  assert.ok(INITIAL_SCHEMAS[CONTRACT_IDS.MODULE_DESCRIPTOR]);
  assert.ok(INITIAL_SCHEMAS[CONTRACT_IDS.MODULE_STATUS]);
  assert.equal(DESCRIPTOR_VERSION, 'zeus.module-descriptor/v1');
  assert.equal(MODULE_API_VERSION, '1.0.0');
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
