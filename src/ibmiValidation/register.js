'use strict';

const { DESCRIPTOR_VERSION } = require('../modules/constants');
const { verifyOfflineEntitlement } = require('../entitlement/verify');
const {
  MODULE_ID,
  CAPABILITY_ID,
  DIFF_CAPABILITY_ID,
  MODULE_VERSION,
  REASON_CODES,
  NON_CLAIMS,
} = require('./constants');
const { runCompileValidation, runDifferentialExecution } = require('./engine');

function buildDescriptor() {
  return {
    descriptorVersion: DESCRIPTOR_VERSION,
    id: MODULE_ID,
    version: MODULE_VERSION,
    edition: 'enterprise',
    compatibility: { moduleApi: '>=1.0.0 <2.0.0' },
    capabilities: [
      { id: CAPABILITY_ID, version: 1 },
      { id: DIFF_CAPABILITY_ID, version: 1 },
    ],
    safety: {
      level: 'S4',
      sideEffects: ['remote-write', 'local-artifact-write'],
    },
    runtime: { requiredFeatures: ['node-crypto'] },
    entitlement: { mode: 'module-managed' },
    docs: {
      title: 'Zeus Enterprise IBM i Owner-Gated Validation',
      reference: 'enterprise/docs/ibmi-s4-owner-gated-design.md',
    },
  };
}

function capabilityDenied(reasonCode, message) {
  return {
    ok: false,
    commercial: true,
    enterprise: true,
    reasonCode,
    message,
    claims: { ...NON_CLAIMS },
  };
}

/**
 * Register the owner-gated IBM i validation module.
 * Entitlement edition must be enterprise. Live IBM i remains off by default.
 */
async function registerIbmiCompileValidationModule(publicModules, options = {}) {
  if (!publicModules || typeof publicModules.registerModule !== 'function') {
    throw new Error('public module registrar is required');
  }

  const entitlement = verifyOfflineEntitlement(options.licenseDocument, {
    publicKeyPem: options.publicKeyPem,
    now: options.now,
    expectedProductId: options.expectedProductId,
    expectedEdition: options.expectedEdition || 'enterprise',
    organizationScope: options.organizationScope,
  });

  if (!entitlement.ok) {
    return {
      ok: false,
      entitlement,
      registration: null,
    };
  }

  // Trusted registration-time activation pack (optional). Callers cannot later
  // inject a weaker pack to enable live without re-registration.
  const registrationActivationPack = options.activationPack || null;
  const liveTransportFactory = options.liveTransportFactory || null;

  const registration = await publicModules.registerModule({
    descriptor: buildDescriptor(),
    register({ capabilityRegistry }) {
      capabilityRegistry.register({
        id: CAPABILITY_ID,
        version: 1,
        title: 'IBM i Compile Validation (owner-gated, Enterprise)',
        description:
          'Owner-gated compile diagnostics as evidence. Live access disabled by default. No free-form commands. Never deploys.',
        category: 'commercial-enterprise-ibmi',
        safety: {
          level: 'S4',
          sideEffects: ['remote-write', 'local-artifact-write'],
          requiresExplicitApproval: true,
        },
        availability: { api: true, cli: false, mcp: false, viewer: false, vscode: false },
        execute: async (_execContext = {}, input = {}) => {
          try {
            const activationPack = (input && input.activationPack) || registrationActivationPack;
            const result = await runCompileValidation({
              mode: (input && input.mode) || 'offline',
              activationPack,
              request: (input && input.request) || {},
              confirmationToken: input && input.confirmationToken,
              profileId: input && input.profileId,
              timeoutMs: input && input.timeoutMs,
              transport: input && input.transport,
              liveTransportFactory,
              commandText: input && input.commandText,
            });
            return {
              ...result,
              commercial: true,
              enterprise: true,
            };
          } catch {
            return capabilityDenied(
              REASON_CODES.TRANSPORT_DENIED,
              'compile validation failed inside its isolated boundary.'
            );
          }
        },
      });

      capabilityRegistry.register({
        id: DIFF_CAPABILITY_ID,
        version: 1,
        title: 'IBM i Differential Execution (owner-gated, synthetic)',
        description:
          'Synthetic differential comparison under owner gates. Unexplained differences block approval. Live disabled in this phase.',
        category: 'commercial-enterprise-ibmi',
        safety: {
          level: 'S4',
          sideEffects: ['remote-write', 'local-artifact-write'],
          requiresExplicitApproval: true,
        },
        availability: { api: true, cli: false, mcp: false, viewer: false, vscode: false },
        execute: async (_execContext = {}, input = {}) => {
          try {
            const activationPack = (input && input.activationPack) || registrationActivationPack;
            const result = await runDifferentialExecution({
              mode: (input && input.mode) || 'offline',
              activationPack,
              baselineOutputs: input && input.baselineOutputs,
              candidateOutputs: input && input.candidateOutputs,
              planHash: input && input.planHash,
              confirmationToken: input && input.confirmationToken,
            });
            return {
              ...result,
              commercial: true,
              enterprise: true,
            };
          } catch {
            return capabilityDenied(
              REASON_CODES.TRANSPORT_DENIED,
              'differential execution failed inside its isolated boundary.'
            );
          }
        },
      });
    },
  });

  return {
    ok: true,
    entitlement,
    registration,
  };
}

module.exports = {
  buildDescriptor,
  registerIbmiCompileValidationModule,
};
