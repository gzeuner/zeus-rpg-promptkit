'use strict';

const { DESCRIPTOR_VERSION } = require('../modules/constants');
const { verifyOfflineEntitlement } = require('../entitlement/verify');
const { REASON_CODES: ENTITLEMENT_REASON_CODES } = require('../entitlement/reasonCodes');
const {
  MODULE_ID,
  CAPABILITY_ID,
  MODULE_VERSION,
  REASON_CODES,
  NON_CLAIMS,
  RESULT_CONTRACT_REF,
} = require('./constants');
const { runGenerateAfterEntitlement, denialResult } = require('./engine');

/**
 * Safety S1 with local-artifact-write only.
 * Runtime: node-crypto, local-filesystem, offline-only.
 * Provider/policy/query registries do not belong here.
 */
function buildDescriptor() {
  return {
    descriptorVersion: DESCRIPTOR_VERSION,
    id: MODULE_ID,
    version: MODULE_VERSION,
    edition: 'professional',
    compatibility: { moduleApi: '>=1.0.0 <2.0.0' },
    capabilities: [{ id: CAPABILITY_ID, version: 1 }],
    safety: {
      level: 'S1',
      sideEffects: ['local-artifact-write'],
    },
    runtime: {
      requiredFeatures: ['node-crypto', 'local-filesystem', 'offline-only'],
    },
    entitlement: { mode: 'module-managed' },
    docs: {
      title: 'Zeus Pro Db2 Test Intelligence',
      reference: 'README.md',
    },
  };
}

/**
 * Register the built-in Db2 Test Intelligence module.
 * Entitlement is enforced at registration and again at capability execution
 * before the first property read/enumeration/clone/size operation on input.
 */
async function registerDb2TestIntelligenceModule(publicModules, options = {}) {
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
    return {
      ok: false,
      entitlement,
      registration: null,
    };
  }

  // Capture trusted registration closure — caller/context cannot override these.
  const trusted = Object.freeze({
    licenseDocument: options.licenseDocument,
    publicKeyPem: options.publicKeyPem,
    now: options.now,
    expectedProductId: options.expectedProductId,
    expectedEdition: options.expectedEdition || 'professional',
    organizationScope: options.organizationScope,
    workspaceRoot: options.workspaceRoot || null,
    artifactRoot: options.artifactRoot || null,
  });

  const registration = await publicModules.registerModule({
    descriptor: buildDescriptor(),
    register({ capabilityRegistry }) {
      capabilityRegistry.register({
        id: CAPABILITY_ID,
        version: 1,
        title: 'Db2 Test Intelligence (commercial)',
        description:
          'Deterministic technical test-vector generation from caller-passed canonical Db2 evidence and explicit manual/code-condition rules. Offline only; local artifact write under trusted roots. Never executes database, program, compile, deploy, or network operations.',
        category: 'commercial-db2-test-intelligence',
        safety: {
          level: 'S1',
          sideEffects: ['local-artifact-write'],
          requiresExplicitApproval: false,
        },
        availability: { api: true, cli: false, mcp: false, viewer: false, vscode: false },
        execute: async (_execContext = {}, input = undefined) => {
          // Entitlement BEFORE any property read/enumeration/clone/size on input.
          // Do not touch input (including Object.keys, JSON.stringify, proxies) until ok.
          const live = verifyOfflineEntitlement(trusted.licenseDocument, {
            publicKeyPem: trusted.publicKeyPem,
            now: trusted.now,
            expectedProductId: trusted.expectedProductId,
            expectedEdition: trusted.expectedEdition,
            organizationScope: trusted.organizationScope,
          });
          if (!live.ok) {
            return {
              ok: false,
              commercial: true,
              advisory: true,
              reasonCode: REASON_CODES.ENTITLEMENT_DENIED,
              message: 'Entitlement denied.',
              result: null,
              artifacts: { written: false, files: [] },
              claims: { ...NON_CLAIMS },
            };
          }

          // Ignore caller/context attempts to supply registries, roots, or validators.
          // Trusted roots come only from registration closure.
          try {
            const result = runGenerateAfterEntitlement(input, {
              workspaceRoot: trusted.workspaceRoot,
              artifactRoot: trusted.artifactRoot,
            });
            return {
              ok: result.ok,
              commercial: true,
              advisory: true,
              reasonCode: result.reasonCode,
              message: result.message,
              contractRef: result.contractRef || RESULT_CONTRACT_REF,
              result: result.result,
              artifacts: result.artifacts,
              claims: result.claims,
              projections: result.projections || undefined,
            };
          } catch {
            return denialResult(
              REASON_CODES.INTERNAL_FAILURE,
              'Capability failed inside its isolated boundary.'
            );
          }
        },
      });
    },
    status: {
      availability: 'available',
      reasonCode: ENTITLEMENT_REASON_CODES.AVAILABLE,
      message: 'Db2 Test Intelligence module entitled (offline).',
    },
  });

  return { ok: registration.ok, entitlement, registration };
}

module.exports = {
  MODULE_ID,
  CAPABILITY_ID,
  buildDescriptor,
  registerDb2TestIntelligenceModule,
};
