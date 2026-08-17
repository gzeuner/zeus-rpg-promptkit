'use strict';

const { DESCRIPTOR_VERSION } = require('../modules/constants');
const { verifyOfflineEntitlement } = require('../entitlement/verify');
const { REASON_CODES } = require('../entitlement/reasonCodes');
const { MODULE_ID, CAPABILITY_ID, MODULE_VERSION, STOP_CODES, NON_CLAIMS } = require('./constants');
const { buildAttemptHistory } = require('./attemptHistory');
const { runGenerationAssurance } = require('./engine');

const CALLER_RUN_OPTION_KEYS = Object.freeze([
  'providerId',
  'modelId',
  'runId',
  'correlationIdBase',
  'evidenceStore',
  'declaredScopePaths',
  'allowedRelativeRoots',
  'organizationProfile',
  'advancedValidatorIds',
  'timeoutMs',
  'signal',
]);

function buildCapabilityFailure() {
  const history = buildAttemptHistory({
    runId: 'ga-capability',
    attempts: [],
    providerInvocationCount: 0,
    finalDecision: {
      stopCode: STOP_CODES.VALIDATOR_INTERNAL_FAILURE,
      reviewReady: false,
      message: 'Generation Assurance capability input failed inside its isolated boundary.',
    },
  });
  return {
    ok: false,
    commercial: true,
    advisory: true,
    stopCode: STOP_CODES.VALIDATOR_INTERNAL_FAILURE,
    reviewReady: false,
    providerInvocationCount: 0,
    history,
    finalCandidate: null,
    finalValidation: null,
    reviewDiff: null,
    artifacts: { written: false, files: [] },
    claims: Object.freeze({ ...NON_CLAIMS }),
  };
}

/**
 * Provider egress is a remote interaction: S3 with remote-read/remote-write
 * plus local-artifact-write for review artifacts. Explicit approval required.
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
      level: 'S3',
      sideEffects: ['remote-read', 'remote-write', 'local-artifact-write'],
    },
    runtime: { requiredFeatures: ['node-crypto'] },
    entitlement: { mode: 'module-managed' },
    docs: {
      title: 'Zeus Pro Generation Assurance',
      reference: 'README.md',
    },
  };
}

/**
 * Register the built-in Generation Assurance module against a core registrar.
 * Entitlement is enforced here (and again before each provider call in the engine).
 * Does not weaken Community validators or provider policy.
 */
async function registerGenerationAssuranceModule(publicModules, options = {}) {
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

  const registration = await publicModules.registerModule({
    descriptor: buildDescriptor(),
    register({ capabilityRegistry }) {
      capabilityRegistry.register({
        id: CAPABILITY_ID,
        version: 1,
        title: 'Generation Assurance (commercial)',
        description:
          'Bounded generation repair loop using Community validators and provider policy. May invoke authorized providers (remote-read/write). Human-review artifacts only; never mutates the source workspace.',
        category: 'commercial-generation-assurance',
        safety: {
          level: 'S3',
          sideEffects: ['remote-read', 'remote-write', 'local-artifact-write'],
          requiresExplicitApproval: true,
        },
        availability: { api: true, cli: false, mcp: false, viewer: false, vscode: false },
        execute: async (_execContext = {}, input = {}) => {
          try {
            if (options.reviewArtifactRoot && !options.workspaceRoot) {
              return buildCapabilityFailure();
            }
            const suppliedOptions =
              input && input.options && typeof input.options === 'object' ? input.options : {};
            const callerOptions = {};
            for (const key of CALLER_RUN_OPTION_KEYS) {
              if (Object.prototype.hasOwnProperty.call(suppliedOptions, key)) {
                callerOptions[key] = suppliedOptions[key];
              }
            }
            const mergedOptions = {
              ...callerOptions,
              entitlement: {
                licenseDocument: options.licenseDocument,
                publicKeyPem: options.publicKeyPem,
                now: options.now,
                expectedProductId: options.expectedProductId,
                expectedEdition: options.expectedEdition || 'professional',
                organizationScope: options.organizationScope,
              },
              providerRegistry: options.providerRegistry || null,
              egressPolicy: options.egressPolicy,
              policy: options.policy || null,
              workspaceRoot: options.workspaceRoot || null,
              reviewArtifactRoot: options.reviewArtifactRoot || null,
            };
            const result = await runGenerationAssurance({
              candidate: input.candidate,
              options: mergedOptions,
            });
            return {
              ok: result.ok,
              commercial: true,
              advisory: true,
              stopCode: result.stopCode,
              reviewReady: result.reviewReady,
              providerInvocationCount: result.providerInvocationCount,
              history: result.history,
              finalCandidate: result.finalCandidate,
              finalValidation: result.finalValidation,
              reviewDiff: result.reviewDiff,
              artifacts: result.artifacts,
              claims: result.claims,
            };
          } catch {
            return buildCapabilityFailure();
          }
        },
      });
    },
    status: {
      availability: 'available',
      reasonCode: REASON_CODES.AVAILABLE,
      message: 'Generation Assurance module entitled (offline).',
    },
  });

  return { ok: registration.ok, entitlement, registration };
}

module.exports = {
  MODULE_ID,
  CAPABILITY_ID,
  buildDescriptor,
  registerGenerationAssuranceModule,
};
