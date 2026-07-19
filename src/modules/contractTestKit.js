'use strict';

/**
 * Public Module Contract Test Kit (Iteration 30).
 * External module authors can require('zeus-rpg-promptkit/module-contract-test').
 * No commercial entitlement implementation is included.
 */

const assert = require('node:assert/strict');
const {
  DESCRIPTOR_VERSION,
  MODULE_API_VERSION,
  REASON_CODES,
  AVAILABILITY,
  CAPABILITY_SIDE_EFFECTS,
} = require('./constants');
const { normalizeModuleDescriptor } = require('./descriptor');
const { createAtomicModuleRegistrar } = require('./moduleRegistrar');
const { createCapabilityRegistry } = require('../core/capabilityRegistry');
const { satisfies } = require('./semverRange');

function buildValidDescriptor(overrides = {}) {
  return {
    descriptorVersion: DESCRIPTOR_VERSION,
    id: 'example.community-module',
    version: '1.0.0',
    edition: 'community',
    compatibility: { moduleApi: '>=1.0.0 <2.0.0' },
    capabilities: [{ id: 'example.inspect', version: 1 }],
    safety: { level: 'S1', sideEffects: ['local-read'] },
    runtime: { requiredFeatures: ['local-filesystem'] },
    entitlement: { mode: 'none' },
    docs: { title: 'Example community module', reference: 'docs/modules/example.md' },
    ...overrides,
  };
}

function createMockRegister(capabilityId = 'example.inspect') {
  return ({ capabilityRegistry }) => {
    capabilityRegistry.register({
      id: capabilityId,
      version: 1,
      title: 'Example inspect',
      description: 'Harmless mock capability for contract tests',
      category: 'module',
      safety: { level: 'S1', sideEffects: ['local-read'], requiresExplicitApproval: false },
      availability: { api: true, cli: false, mcp: false, viewer: false, vscode: false },
      execute: async () => ({ ok: true, advisory: true }),
    });
  };
}

/**
 * Run the standard contract assertions against the current core.
 * Throws AssertionError on failure (usable from node:test or mocha).
 */
async function runModuleContractTests(options = {}) {
  const results = [];
  function check(name, fn) {
    try {
      const out = fn();
      if (out && typeof out.then === 'function') {
        return out
          .then(() => results.push({ name, ok: true }))
          .catch(err => {
            results.push({ name, ok: false, error: String(err && err.message) });
            throw err;
          });
      }
      results.push({ name, ok: true });
    } catch (err) {
      results.push({ name, ok: false, error: String(err && err.message) });
      throw err;
    }
  }

  await check('valid minimal descriptor normalizes', () => {
    const res = normalizeModuleDescriptor(buildValidDescriptor());
    assert.equal(res.ok, true);
    assert.equal(res.descriptor.descriptorVersion, DESCRIPTOR_VERSION);
  });

  await check('invalid descriptor is rejected', () => {
    const res = normalizeModuleDescriptor(buildValidDescriptor({ id: '' }));
    assert.equal(res.ok, false);
  });

  await check('core module API satisfies default range', () => {
    assert.equal(satisfies(MODULE_API_VERSION, '>=1.0.0 <2.0.0'), true);
  });

  await check('valid module registers atomically', async () => {
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

  await check('late capability conflict leaves no partial host registration', async () => {
    const caps = createCapabilityRegistry();
    const baseCapability = {
      version: 1,
      safety: { level: 'S1', sideEffects: ['local-read'], requiresExplicitApproval: false },
      execute: async () => ({}),
    };
    caps.register({ ...baseCapability, id: 'example.second' });
    const registrar = createAtomicModuleRegistrar({ capabilityRegistry: caps });
    const result = await registrar.registerModule({
      descriptor: buildValidDescriptor({
        capabilities: [
          { id: 'example.first', version: 1 },
          { id: 'example.second', version: 1 },
        ],
      }),
      register({ capabilityRegistry }) {
        capabilityRegistry.register({ ...baseCapability, id: 'example.first' });
        capabilityRegistry.register({ ...baseCapability, id: 'example.second' });
      },
    });
    assert.equal(result.ok, false);
    assert.equal(caps.get('example.first'), null);
    assert.equal(registrar.listModules().length, 0);
  });

  await check('duplicate module id is rejected', async () => {
    const registrar = createAtomicModuleRegistrar({
      capabilityRegistry: createCapabilityRegistry(),
    });
    const input = {
      descriptor: buildValidDescriptor(),
      register: createMockRegister(),
    };
    assert.equal((await registrar.registerModule(input)).ok, true);
    const second = await registrar.registerModule(input);
    assert.equal(second.ok, false);
    assert.equal(second.status.reasonCode, REASON_CODES.DUPLICATE_MODULE_ID);
  });

  await check('incompatible core range fails closed', async () => {
    const registrar = createAtomicModuleRegistrar();
    const result = await registrar.registerModule({
      descriptor: buildValidDescriptor({
        compatibility: { moduleApi: '>=9.0.0 <10.0.0' },
      }),
      register: createMockRegister(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.status.reasonCode, REASON_CODES.INCOMPATIBLE_CORE);
  });

  await check('dynamic path registration is denied', async () => {
    const registrar = createAtomicModuleRegistrar();
    const result = await registrar.registerModule({
      descriptor: buildValidDescriptor(),
      register: createMockRegister(),
      path: 'C:\\untrusted\\module.js',
    });
    assert.equal(result.ok, false);
    assert.equal(result.status.reasonCode, REASON_CODES.POLICY_DENIED);
  });

  await check('handler failure does not leave module registered', async () => {
    const caps = createCapabilityRegistry();
    const registrar = createAtomicModuleRegistrar({ capabilityRegistry: caps });
    const result = await registrar.registerModule({
      descriptor: buildValidDescriptor(),
      register: () => {
        throw new Error('init boom secret=abc');
      },
    });
    assert.equal(result.ok, false);
    assert.equal(registrar.listModules().length, 0);
    assert.equal(caps.list().length, 0);
    assert.ok(!JSON.stringify(result.status).includes('secret=abc'));
  });

  await check('not installed status is available', () => {
    const registrar = createAtomicModuleRegistrar();
    const status = registrar.notInstalledStatus();
    assert.equal(status.reasonCode, REASON_CODES.NOT_INSTALLED);
    assert.equal(status.availability, AVAILABILITY.UNAVAILABLE);
  });

  await check('module-reported entitlement code is display-only', async () => {
    const registrar = createAtomicModuleRegistrar();
    const result = await registrar.registerModule({
      descriptor: buildValidDescriptor({
        edition: 'professional',
        entitlement: { mode: 'module-managed' },
      }),
      register: createMockRegister(),
      status: {
        availability: 'unavailable',
        reasonCode: REASON_CODES.ENTITLEMENT_REQUIRED,
        message: 'Commercial entitlement required',
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.status.reasonCode, REASON_CODES.ENTITLEMENT_REQUIRED);
    assert.equal(result.status.coreEnforcesEntitlement, false);
  });

  await check('unknown module reason code fails closed', async () => {
    const registrar = createAtomicModuleRegistrar();
    const result = await registrar.registerModule({
      descriptor: buildValidDescriptor(),
      register: createMockRegister(),
      status: { availability: 'available', reasonCode: 'VENDOR_INTERNAL_DETAIL' },
    });
    assert.equal(result.ok, false);
    assert.equal(result.status.reasonCode, REASON_CODES.MODULE_UNAVAILABLE);
    assert.equal(registrar.capabilityRegistry.get('example.inspect'), null);
  });

  await check('capability version must match descriptor version', async () => {
    const registrar = createAtomicModuleRegistrar();
    const result = await registrar.registerModule({
      descriptor: buildValidDescriptor(),
      register({ capabilityRegistry }) {
        capabilityRegistry.register({
          id: 'example.inspect',
          version: 2,
          safety: { level: 'S1', sideEffects: ['local-read'] },
          execute: async () => ({}),
        });
      },
    });
    assert.equal(result.ok, false);
    assert.equal(registrar.capabilityRegistry.get('example.inspect'), null);
  });

  await check('capability side effects must be covered by module declaration', async () => {
    const registrar = createAtomicModuleRegistrar();
    const result = await registrar.registerModule({
      descriptor: buildValidDescriptor(),
      register({ capabilityRegistry }) {
        capabilityRegistry.register({
          id: 'example.inspect',
          version: 1,
          safety: { level: 'S1', sideEffects: ['remote-write'] },
          execute: async () => ({}),
        });
      },
    });
    assert.equal(result.ok, false);
    assert.equal(registrar.capabilityRegistry.get('example.inspect'), null);
  });

  if (options.returnResults) return results;
  return { ok: true, coreModuleApiVersion: MODULE_API_VERSION, results };
}

module.exports = {
  DESCRIPTOR_VERSION,
  MODULE_API_VERSION,
  REASON_CODES,
  AVAILABILITY,
  CAPABILITY_SIDE_EFFECTS,
  buildValidDescriptor,
  createMockRegister,
  normalizeModuleDescriptor,
  createAtomicModuleRegistrar,
  createCapabilityRegistry,
  runModuleContractTests,
  satisfies,
};
