'use strict';

const { DESCRIPTOR_VERSION } = require('zeus-rpg-promptkit/module-contract-test');
const { verifyOfflineEntitlement } = require('../../entitlement/verify');
const { REASON_CODES } = require('../../entitlement/reasonCodes');

const MODULE_ID = 'zeus-pro.reference-module';
const CAPABILITY_ID = 'zeus-pro.reference.ping';

function buildDescriptor() {
  return {
    descriptorVersion: DESCRIPTOR_VERSION,
    id: MODULE_ID,
    version: '0.1.0',
    edition: 'professional',
    compatibility: { moduleApi: '>=1.0.0 <2.0.0' },
    capabilities: [{ id: CAPABILITY_ID, version: 1 }],
    safety: { level: 'S1', sideEffects: ['local-read'] },
    runtime: { requiredFeatures: ['node-crypto', 'offline-only'] },
    entitlement: { mode: 'module-managed' },
    docs: {
      title: 'Zeus Pro reference commercial module',
      reference: 'README.md',
    },
  };
}

/**
 * Register the reference commercial module against a public core registrar.
 * Entitlement is enforced here, never in the public core.
 */
async function registerReferenceModule(publicModules, options = {}) {
  if (!publicModules || typeof publicModules.registerModule !== 'function') {
    throw new Error('public module registrar is required');
  }

  const entitlement = verifyOfflineEntitlement(options.licenseDocument, {
    publicKeyPem: options.publicKeyPem,
    now: options.now,
    expectedProductId: options.expectedProductId,
    expectedEdition: options.expectedEdition || 'professional',
    organizationScope: options.organizationScope,
  });

  if (!entitlement.ok) {
    // Entitlement is enforced only in this private module. Do not register
    // commercial capabilities; Community core remains fully usable.
    return {
      ok: false,
      entitlement,
      registration: null,
    };
  }

  const registration = await publicModules.registerModule({
    descriptor: buildDescriptor(),
    register({ capabilityRegistry }) {
      capabilityRegistry.register({
        id: CAPABILITY_ID,
        version: 1,
        title: 'Commercial reference ping',
        description:
          'Harmless commercial reference capability proving registration after offline entitlement.',
        category: 'commercial-reference',
        safety: {
          level: 'S1',
          sideEffects: ['local-read'],
          requiresExplicitApproval: false,
        },
        availability: { api: true, cli: false, mcp: false, viewer: false, vscode: false },
        execute: async () => ({
          ok: true,
          commercial: true,
          advisory: true,
          message: 'reference commercial capability available',
          // never include license material
        }),
      });
    },
    status: {
      availability: 'available',
      reasonCode: REASON_CODES.AVAILABLE,
      message: 'Commercial reference module entitled (offline).',
    },
  });

  return { ok: registration.ok, entitlement, registration };
}

module.exports = {
  MODULE_ID,
  CAPABILITY_ID,
  buildDescriptor,
  registerReferenceModule,
};
