'use strict';

/**
 * Zeus Pro Project Intelligence — commercial module vocabulary (ZPI-09/10).
 * Registration, entitlement, resource policy, non-claims, operation capabilities.
 */

const MODULE_ID = 'zeus-pro.project-intelligence';
const MODULE_VERSION = '0.2.0';

const CAPABILITY_IDS = Object.freeze({
  STATUS: 'zeus-pro.project-intelligence.status',
  INSPECT_POLICY: 'zeus-pro.project-intelligence.inspect-policy',
  CREATE_PROJECT: 'zeus-pro.project-intelligence.create-project',
  FULL_INDEX: 'zeus-pro.project-intelligence.full-index',
  INCREMENTAL_UPDATE: 'zeus-pro.project-intelligence.incremental-update',
  QUERY: 'zeus-pro.project-intelligence.query',
  IMPACT_ANALYSIS: 'zeus-pro.project-intelligence.impact-analysis',
  BUILD_CONTEXT_PACKAGE: 'zeus-pro.project-intelligence.build-context-package',
  INSPECT_SNAPSHOT: 'zeus-pro.project-intelligence.inspect-snapshot',
  VERIFY_INTEGRITY: 'zeus-pro.project-intelligence.verify-integrity',
});

const NON_CLAIMS = Object.freeze({
  sourceOfTruth: false,
  advisory: true,
  notCompileResult: true,
  notLiveIbmi: true,
  notImplicitWorkspaceHarvest: true,
  communityReadableWithoutModule: true,
  package09Closed: true,
});

const NON_CLAIM_MESSAGES = Object.freeze([
  'Not source of truth — preserved source evidence remains authoritative',
  'Advisory commercial orchestration only',
  'Not a compile, deploy, or live IBM i execution result',
  'Package 09 remains closed; no live IBM i compile/execute flows',
  'No implicit workspace harvesting without explicit trusted roots',
  'Community project-knowledge artifacts remain readable without this module',
]);

/** Default resource policy for entitled commercial PI operations. */
const DEFAULT_RESOURCE_POLICY = Object.freeze({
  policyId: 'zeus-pro.project-intelligence.resource-policy',
  policyVersion: '1.0.0',
  maxProjects: 32,
  maxSourceUnitsPerProject: 50000,
  maxSourceBytesPerUnit: 8 * 1024 * 1024,
  maxTotalSourceBytes: 2 * 1024 * 1024 * 1024,
  maxContextTokenBudget: 16000,
  maxRetrievalLimit: 200,
  requireExplicitTrustedRoots: true,
  allowImplicitWorkspaceScan: false,
  allowNetwork: false,
  offlineOnly: true,
});

module.exports = {
  MODULE_ID,
  MODULE_VERSION,
  CAPABILITY_IDS,
  NON_CLAIMS,
  NON_CLAIM_MESSAGES,
  DEFAULT_RESOURCE_POLICY,
};
