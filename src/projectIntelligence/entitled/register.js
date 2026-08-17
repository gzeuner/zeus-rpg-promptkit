'use strict';

const { DESCRIPTOR_VERSION } = require('../../modules/constants');
const { verifyOfflineEntitlement } = require('../../entitlement/verify');
const { REASON_CODES } = require('../../entitlement/reasonCodes');
const {
  MODULE_ID,
  MODULE_VERSION,
  CAPABILITY_IDS,
  NON_CLAIMS,
  NON_CLAIM_MESSAGES,
  DEFAULT_RESOURCE_POLICY,
} = require('./constants');
const { validateTrustedRoots } = require('./trustedRoots');
const { evaluateResourcePolicy, cloneDefaultResourcePolicy } = require('./resourcePolicy');
const operations = require('./operations');

function buildDescriptor() {
  return {
    descriptorVersion: DESCRIPTOR_VERSION,
    id: MODULE_ID,
    version: MODULE_VERSION,
    edition: 'professional',
    compatibility: { moduleApi: '>=1.0.0 <2.0.0' },
    capabilities: Object.values(CAPABILITY_IDS).map(id => ({ id, version: 1 })),
    safety: {
      level: 'S1',
      sideEffects: ['local-read', 'local-artifact-write'],
    },
    runtime: { requiredFeatures: ['node-crypto', 'offline-only', 'local-filesystem'] },
    entitlement: { mode: 'module-managed' },
    docs: {
      title: 'Zeus Pro Project Intelligence',
      reference: 'README.md',
    },
  };
}

function recheckEntitlement(options = {}) {
  return verifyOfflineEntitlement(options.licenseDocument, {
    publicKeyPem: options.publicKeyPem,
    now: options.now,
    expectedProductId: options.expectedProductId,
    expectedEdition: options.expectedEdition || 'professional',
    organizationScope: options.organizationScope,
  });
}

function entitlementDeniedResult(entitlement) {
  return {
    ok: false,
    commercial: true,
    advisory: true,
    reasonCode: entitlement.reasonCode || REASON_CODES.ENTITLEMENT_REQUIRED,
    message: entitlement.message || 'Entitlement required for Project Intelligence.',
    claims: { ...NON_CLAIMS },
    nonClaims: [...NON_CLAIM_MESSAGES],
  };
}

function entitledExecute(options, resourcePolicy, handler) {
  return async (_ctx = {}, input = {}) => {
    const live = recheckEntitlement(options);
    if (!live.ok) return entitlementDeniedResult(live);
    return handler(input || {}, { resourcePolicy, options });
  };
}

function registerReadCap(capabilityRegistry, spec) {
  capabilityRegistry.register({
    id: spec.id,
    version: 1,
    title: spec.title,
    description: spec.description,
    category: 'commercial-project-intelligence',
    safety: {
      level: 'S1',
      sideEffects: ['local-read'],
      requiresExplicitApproval: false,
    },
    // ZPI-11: Community thin CLI/MCP adapters dispatch when present
    availability: { api: true, cli: true, mcp: true, viewer: false, vscode: false },
    execute: spec.execute,
  });
}

function registerWriteCap(capabilityRegistry, spec) {
  capabilityRegistry.register({
    id: spec.id,
    version: 1,
    title: spec.title,
    description: spec.description,
    category: 'commercial-project-intelligence',
    safety: {
      level: 'S1',
      sideEffects: ['local-read', 'local-artifact-write'],
      requiresExplicitApproval: false,
    },
    // ZPI-11: Community thin CLI/MCP adapters dispatch when present
    availability: { api: true, cli: true, mcp: true, viewer: false, vscode: false },
    execute: spec.execute,
  });
}

/**
 * Register Zeus Pro Project Intelligence against the public core registrar.
 * Entitlement is enforced at registration and again at capability execute time.
 * ZPI-10: entitled local project operations over Community engines.
 */
async function registerProjectIntelligenceModule(publicModules, options = {}) {
  if (!publicModules || typeof publicModules.registerModule !== 'function') {
    throw new Error('public module registrar is required');
  }

  const entitlement = recheckEntitlement(options);
  if (!entitlement.ok) {
    return {
      ok: false,
      entitlement,
      registration: null,
    };
  }

  const resourcePolicy = cloneDefaultResourcePolicy(options.resourcePolicyOverrides || {});

  const registration = await publicModules.registerModule({
    descriptor: buildDescriptor(),
    register({ capabilityRegistry }) {
      registerReadCap(capabilityRegistry, {
        id: CAPABILITY_IDS.STATUS,
        title: 'Project Intelligence module status',
        description:
          'Reports commercial Project Intelligence availability after offline entitlement recheck.',
        execute: entitledExecute(options, resourcePolicy, async () => ({
          ok: true,
          commercial: true,
          advisory: true,
          reasonCode: REASON_CODES.AVAILABLE,
          moduleId: MODULE_ID,
          moduleVersion: MODULE_VERSION,
          capabilities: Object.values(CAPABILITY_IDS),
          resourcePolicy: {
            policyId: resourcePolicy.policyId,
            policyVersion: resourcePolicy.policyVersion,
            requireExplicitTrustedRoots: resourcePolicy.requireExplicitTrustedRoots,
            allowImplicitWorkspaceScan: resourcePolicy.allowImplicitWorkspaceScan,
            offlineOnly: resourcePolicy.offlineOnly,
            maxContextTokenBudget: resourcePolicy.maxContextTokenBudget,
            maxRetrievalLimit: resourcePolicy.maxRetrievalLimit,
            maxSourceUnitsPerProject: resourcePolicy.maxSourceUnitsPerProject,
          },
          claims: { ...NON_CLAIMS },
          nonClaims: [...NON_CLAIM_MESSAGES],
          operationsAvailable: true,
        })),
      });

      registerReadCap(capabilityRegistry, {
        id: CAPABILITY_IDS.INSPECT_POLICY,
        title: 'Project Intelligence inspect resource policy',
        description:
          'Validates explicit trusted-root declarations and commercial resource policy without indexing.',
        execute: entitledExecute(options, resourcePolicy, async input => {
          const policyEval = evaluateResourcePolicy(
            {
              trustedRoots: input.trustedRoots,
              tokenBudget: input.tokenBudget,
              retrievalLimit: input.retrievalLimit,
            },
            resourcePolicy
          );
          if (!policyEval.ok) {
            return {
              ok: false,
              commercial: true,
              advisory: true,
              reasonCode: policyEval.reasonCode,
              message: policyEval.message,
              claims: { ...NON_CLAIMS },
              nonClaims: [...NON_CLAIM_MESSAGES],
            };
          }

          const roots = validateTrustedRoots(input.trustedRoots || [], {
            maxRoots: 16,
          });
          if (!roots.ok) {
            return {
              ok: false,
              commercial: true,
              advisory: true,
              reasonCode: roots.reasonCode,
              message: roots.message,
              claims: { ...NON_CLAIMS },
              nonClaims: [...NON_CLAIM_MESSAGES],
            };
          }

          return {
            ok: true,
            commercial: true,
            advisory: true,
            reasonCode: REASON_CODES.AVAILABLE,
            policy: policyEval.policy,
            trustedRoots: roots.roots,
            rootCount: roots.rootCount,
            claims: { ...NON_CLAIMS },
            nonClaims: [...NON_CLAIM_MESSAGES],
          };
        }),
      });

      registerWriteCap(capabilityRegistry, {
        id: CAPABILITY_IDS.CREATE_PROJECT,
        title: 'Create project knowledge workspace',
        description:
          'Creates a local project-knowledge workspace under an explicit knowledgeRoot with trusted roots.',
        execute: entitledExecute(options, resourcePolicy, (input, ctx) =>
          operations.createProjectKnowledge(input, ctx)
        ),
      });

      registerWriteCap(capabilityRegistry, {
        id: CAPABILITY_IDS.FULL_INDEX,
        title: 'Full project index',
        description:
          'Runs a full rebuild of the project snapshot and search index over explicit trusted roots.',
        execute: entitledExecute(options, resourcePolicy, (input, ctx) =>
          operations.fullIndex(input, ctx)
        ),
      });

      registerWriteCap(capabilityRegistry, {
        id: CAPABILITY_IDS.INCREMENTAL_UPDATE,
        title: 'Incremental project update',
        description:
          'Applies an incremental snapshot update when source inventory changes under trusted roots.',
        execute: entitledExecute(options, resourcePolicy, (input, ctx) =>
          operations.incrementalUpdate(input, ctx)
        ),
      });

      registerReadCap(capabilityRegistry, {
        id: CAPABILITY_IDS.QUERY,
        title: 'Query project knowledge',
        description:
          'Retrieves hybrid lexical/graph hits from the current or specified snapshot (redacted paths).',
        execute: entitledExecute(options, resourcePolicy, (input, ctx) =>
          operations.queryKnowledge(input, ctx)
        ),
      });

      registerReadCap(capabilityRegistry, {
        id: CAPABILITY_IDS.IMPACT_ANALYSIS,
        title: 'Impact analysis',
        description:
          'Expands query hits through the relationship neighborhood for advisory impact analysis.',
        execute: entitledExecute(options, resourcePolicy, (input, ctx) =>
          operations.impactAnalysis(input, ctx)
        ),
      });

      registerReadCap(capabilityRegistry, {
        id: CAPABILITY_IDS.BUILD_CONTEXT_PACKAGE,
        title: 'Build context package',
        description:
          'Assembles a token-budgeted context package from retrieval hits (paths redacted).',
        execute: entitledExecute(options, resourcePolicy, (input, ctx) =>
          operations.buildContextPackage(input, ctx)
        ),
      });

      registerReadCap(capabilityRegistry, {
        id: CAPABILITY_IDS.INSPECT_SNAPSHOT,
        title: 'Inspect snapshot',
        description: 'Reports snapshot metadata and entity counts without leaking absolute paths.',
        execute: entitledExecute(options, resourcePolicy, (input, ctx) =>
          operations.inspectSnapshot(input, ctx)
        ),
      });

      registerReadCap(capabilityRegistry, {
        id: CAPABILITY_IDS.VERIFY_INTEGRITY,
        title: 'Verify integrity',
        description:
          'Checks store integrity, current-snapshot freshness, and search index integrity.',
        execute: entitledExecute(options, resourcePolicy, (input, ctx) =>
          operations.verifyIntegrity(input, ctx)
        ),
      });
    },
    status: {
      availability: 'available',
      reasonCode: REASON_CODES.AVAILABLE,
      message: 'Commercial Project Intelligence entitled (offline).',
    },
  });

  return { ok: registration.ok, entitlement, registration };
}

module.exports = {
  MODULE_ID,
  MODULE_VERSION,
  CAPABILITY_IDS,
  NON_CLAIMS,
  NON_CLAIM_MESSAGES,
  DEFAULT_RESOURCE_POLICY,
  buildDescriptor,
  registerProjectIntelligenceModule,
  recheckEntitlement,
  validateTrustedRoots,
  evaluateResourcePolicy,
  cloneDefaultResourcePolicy,
};
