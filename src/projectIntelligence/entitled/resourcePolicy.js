'use strict';

const { DEFAULT_RESOURCE_POLICY } = require('./constants');
const { REASON_CODES } = require('../../entitlement/reasonCodes');

function cloneDefaultResourcePolicy(overrides = {}) {
  return Object.freeze({
    ...DEFAULT_RESOURCE_POLICY,
    ...overrides,
    policyId: DEFAULT_RESOURCE_POLICY.policyId,
    policyVersion: DEFAULT_RESOURCE_POLICY.policyVersion,
  });
}

/**
 * Evaluate a commercial PI request against resource policy (registration-time surface).
 * Does not execute indexing or scanning.
 */
function evaluateResourcePolicy(request = {}, policy = DEFAULT_RESOURCE_POLICY) {
  const p = policy || DEFAULT_RESOURCE_POLICY;

  if (p.allowImplicitWorkspaceScan === true) {
    return {
      ok: false,
      reasonCode: REASON_CODES.POLICY_DENIED,
      message: 'Implicit workspace scan is forbidden by commercial PI policy.',
    };
  }
  if (p.allowNetwork === true || p.offlineOnly === false) {
    return {
      ok: false,
      reasonCode: REASON_CODES.POLICY_DENIED,
      message: 'Network-enabled PI policy is not allowed in Community-offline commercial default.',
    };
  }
  if (p.requireExplicitTrustedRoots !== false) {
    if (!Array.isArray(request.trustedRoots) || request.trustedRoots.length === 0) {
      return {
        ok: false,
        reasonCode: REASON_CODES.POLICY_DENIED,
        message: 'Explicit trustedRoots required by resource policy.',
      };
    }
  }
  if (
    request.tokenBudget != null &&
    Number(request.tokenBudget) > Number(p.maxContextTokenBudget)
  ) {
    return {
      ok: false,
      reasonCode: REASON_CODES.POLICY_DENIED,
      message: 'tokenBudget exceeds commercial resource policy maximum.',
    };
  }
  if (
    request.retrievalLimit != null &&
    Number(request.retrievalLimit) > Number(p.maxRetrievalLimit)
  ) {
    return {
      ok: false,
      reasonCode: REASON_CODES.POLICY_DENIED,
      message: 'retrievalLimit exceeds commercial resource policy maximum.',
    };
  }

  return {
    ok: true,
    reasonCode: REASON_CODES.AVAILABLE,
    message: null,
    policy: {
      policyId: p.policyId,
      policyVersion: p.policyVersion,
      maxProjects: p.maxProjects,
      maxSourceUnitsPerProject: p.maxSourceUnitsPerProject,
      maxContextTokenBudget: p.maxContextTokenBudget,
      maxRetrievalLimit: p.maxRetrievalLimit,
      requireExplicitTrustedRoots: p.requireExplicitTrustedRoots,
      allowImplicitWorkspaceScan: p.allowImplicitWorkspaceScan,
      offlineOnly: p.offlineOnly,
    },
  };
}

module.exports = {
  cloneDefaultResourcePolicy,
  evaluateResourcePolicy,
  DEFAULT_RESOURCE_POLICY,
};
