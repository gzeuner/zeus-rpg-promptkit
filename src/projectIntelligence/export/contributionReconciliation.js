'use strict';

const {
  canonicalJson,
  cloneJsonValue,
  openContributionPackage,
  sha256Hex,
} = require('./contributionPackage');
const { validateContributionPackage } = require('./contributionValidation');

const CONTRIBUTION_RECONCILIATION_SCHEMA = 'knowledge.contribution.reconciliation@1';
const RECONCILIATION_FINDING_TYPES = Object.freeze([
  'DUPLICATE',
  'STALE',
  'SEMANTIC_CONFLICT',
  'NO_CHANGE',
  'SUPERSEDE',
]);
const RECONCILIATION_ACTIONS = Object.freeze(['accept', 'reject', 'supersede']);

class ContributionReconciliationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ContributionReconciliationError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ContributionReconciliationError(code, message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requirePlainObject(value, field) {
  if (!isPlainObject(value)) fail('RECONCILIATION_INVALID', `${field} must be an object`);
  return value;
}

function cloneStructured(value, field) {
  try {
    return cloneJsonValue(value);
  } catch {
    fail('RECONCILIATION_INVALID', `${field} must contain plain JSON data`);
  }
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sameSnapshot(left, right) {
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  if (left.snapshotId !== right.snapshotId) return false;
  return left.contentHash === undefined || right.contentHash === undefined
    ? true
    : left.contentHash === right.contentHash;
}

function normalizePackage(options) {
  if (typeof options.packageDir === 'string') return openContributionPackage(options);
  if (!isPlainObject(options.package)) fail('RECONCILIATION_INVALID', 'package is required');
  const contribution = options.package;
  if (!isPlainObject(contribution.manifest) || !isPlainObject(contribution.payload)) {
    fail('RECONCILIATION_INVALID', 'package manifest and payload are required');
  }
  return contribution;
}

function normalizeSnapshot(value) {
  requirePlainObject(value, 'currentSnapshot');
  if (typeof value.snapshotId !== 'string' || value.snapshotId.trim() === '') {
    fail('RECONCILIATION_INVALID', 'currentSnapshot.snapshotId is required');
  }
  return cloneStructured(value, 'currentSnapshot');
}

function normalizeExistingContributions(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    fail('RECONCILIATION_INVALID', 'existingContributions must be an array');
  }

  return value
    .map((entry, index) => {
      const source = isPlainObject(entry?.manifest) ? entry.manifest : entry;
      if (!isPlainObject(source)) {
        fail('RECONCILIATION_INVALID', `existingContributions/${index} is invalid`);
      }
      if (typeof source.contributionId !== 'string' || !source.contributionId.trim()) {
        fail('RECONCILIATION_INVALID', `existingContributions/${index} needs contributionId`);
      }
      if (typeof source.packageHash !== 'string' || !source.packageHash.trim()) {
        fail('RECONCILIATION_INVALID', `existingContributions/${index} needs packageHash`);
      }
      return {
        contributionId: source.contributionId,
        packageHash: source.packageHash,
        status: source.status === undefined ? null : source.status,
      };
    })
    .sort((left, right) => {
      return (
        compareStrings(left.contributionId, right.contributionId) ||
        compareStrings(left.packageHash, right.packageHash) ||
        compareStrings(String(left.status), String(right.status))
      );
    });
}

function normalizeSupersededId(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !value.trim()) {
    fail('RECONCILIATION_INVALID', 'supersedesContributionId must be a non-empty string');
  }
  return value;
}

function normalizeValidationPolicy(options, currentSnapshot) {
  const supplied =
    options.validationPolicy === undefined ? options.policy : options.validationPolicy;
  if (supplied === undefined) return { currentSnapshot };
  requirePlainObject(supplied, 'validationPolicy');
  return {
    ...cloneStructured(supplied, 'validationPolicy'),
    currentSnapshot:
      supplied.currentSnapshot === undefined ? currentSnapshot : supplied.currentSnapshot,
  };
}

function makeFinding({ type, contribution, severity, details, evidenceReferences, provenance }) {
  const identity = {
    type,
    contributionId: contribution.manifest.contributionId,
    packageHash: contribution.manifest.packageHash,
    details,
  };
  const findingId = `finding-${sha256Hex(canonicalJson(identity))}`;
  const finding = {
    schema: CONTRIBUTION_RECONCILIATION_SCHEMA,
    findingId,
    conflictId: findingId,
    type,
    severity,
    status: 'open',
    decision: null,
    contributionId: contribution.manifest.contributionId,
    packageHash: contribution.manifest.packageHash,
    evidenceReferences: cloneStructured(evidenceReferences, 'evidenceReferences'),
    provenance: cloneStructured(provenance, 'provenance'),
    details: cloneStructured(details, 'finding.details'),
    decisionHistory: [],
  };
  return Object.freeze(finding);
}

function semanticFindings({ contribution, targetFacts }) {
  const contributionFacts = contribution.payload.facts;
  if (!isPlainObject(contributionFacts) || !isPlainObject(targetFacts)) return [];

  return Object.keys(contributionFacts)
    .filter(key => Object.prototype.hasOwnProperty.call(targetFacts, key))
    .sort(compareStrings)
    .filter(key => canonicalJson(contributionFacts[key]) !== canonicalJson(targetFacts[key]))
    .map(key => ({
      key,
      contributionValue: cloneStructured(contributionFacts[key], `payload.facts.${key}`),
      targetValue: cloneStructured(targetFacts[key], `targetFacts.${key}`),
    }));
}

function chooseAction(findings, supersedesContributionId) {
  if (supersedesContributionId) return 'supersede';
  if (findings.some(finding => finding.type !== 'NO_CHANGE')) return 'reject';
  return 'accept';
}

function buildValidation(options, contribution, currentSnapshot) {
  const policy = normalizeValidationPolicy(options, currentSnapshot);
  return validateContributionPackage({ package: contribution, policy });
}

function reconcileContribution(options = {}) {
  requirePlainObject(options, 'options');
  const contribution = normalizePackage(options);
  const manifest = requirePlainObject(contribution.manifest, 'package.manifest');
  const currentSnapshot = normalizeSnapshot(options.currentSnapshot);
  const existingContributions = normalizeExistingContributions(options.existingContributions);
  const supersedesContributionId = normalizeSupersededId(options.supersedesContributionId);
  const targetFacts =
    options.targetFacts === undefined ? null : cloneStructured(options.targetFacts, 'targetFacts');
  const validation = buildValidation(options, contribution, currentSnapshot);
  const evidenceReferences = Array.isArray(manifest.evidenceReferences)
    ? cloneStructured(manifest.evidenceReferences, 'evidenceReferences')
    : [];
  const provenance = isPlainObject(manifest.provenance)
    ? cloneStructured(manifest.provenance, 'provenance')
    : {};
  const findings = [];

  const duplicateMatches = existingContributions.filter(
    existing =>
      existing.contributionId === manifest.contributionId ||
      existing.packageHash === manifest.packageHash
  );
  if (duplicateMatches.length > 0) {
    findings.push(
      makeFinding({
        type: 'DUPLICATE',
        contribution,
        severity: 'blocking',
        details: {
          matchingContributionIds: duplicateMatches
            .map(existing => existing.contributionId)
            .sort(compareStrings),
        },
        evidenceReferences,
        provenance,
      })
    );
  }

  if (!sameSnapshot(manifest.baseSnapshot, currentSnapshot)) {
    findings.push(
      makeFinding({
        type: 'STALE',
        contribution,
        severity: 'blocking',
        details: {
          baseSnapshot: cloneStructured(manifest.baseSnapshot, 'package.baseSnapshot'),
          currentSnapshot,
        },
        evidenceReferences,
        provenance,
      })
    );
  }

  for (const semanticConflict of semanticFindings({ contribution, targetFacts })) {
    findings.push(
      makeFinding({
        type: 'SEMANTIC_CONFLICT',
        contribution,
        severity: 'blocking',
        details: semanticConflict,
        evidenceReferences,
        provenance,
      })
    );
  }

  if (supersedesContributionId !== null) {
    const superseded = existingContributions.find(
      existing => existing.contributionId === supersedesContributionId
    );
    if (!superseded) {
      fail(
        'RECONCILIATION_INVALID',
        'supersedesContributionId must identify an existing contribution'
      );
    }
    findings.push(
      makeFinding({
        type: 'SUPERSEDE',
        contribution,
        severity: 'review',
        details: {
          supersedesContributionId,
          previousStatus: superseded.status,
        },
        evidenceReferences,
        provenance,
      })
    );
  }

  if (findings.length === 0) {
    findings.push(
      makeFinding({
        type: 'NO_CHANGE',
        contribution,
        severity: 'info',
        details: { comparedFacts: isPlainObject(contribution.payload.facts) },
        evidenceReferences,
        provenance,
      })
    );
  }

  findings.sort((left, right) => compareStrings(left.findingId, right.findingId));
  const action = chooseAction(findings, supersedesContributionId);
  const findingIds = findings.map(finding => finding.findingId);
  const proposal = Object.freeze({
    proposalId: `proposal-${sha256Hex(canonicalJson({ action, findingIds }))}`,
    action,
    status: 'proposed',
    automatic: false,
    findingIds: Object.freeze(findingIds),
    conflictIds: Object.freeze(findingIds),
    decisionHistory: Object.freeze([]),
  });
  const inputFingerprint = sha256Hex(
    canonicalJson({
      package: { manifest, payload: contribution.payload },
      currentSnapshot,
      targetFacts,
      existingContributions,
      supersedesContributionId,
      validationPolicy: normalizeValidationPolicy(options, currentSnapshot),
    })
  );
  const frozenFindings = Object.freeze(findings);
  const proposals = Object.freeze([proposal]);
  return Object.freeze({
    ok: true,
    schema: CONTRIBUTION_RECONCILIATION_SCHEMA,
    status: 'review',
    inputFingerprint,
    contributionId: manifest.contributionId || null,
    packageHash: manifest.packageHash || null,
    validation,
    validationPassed: validation.ok,
    decision: 'review',
    automaticDecision: false,
    evidenceReferences: cloneStructured(evidenceReferences, 'evidenceReferences'),
    provenance: cloneStructured(provenance, 'provenance'),
    findings: frozenFindings,
    proposals,
    suggestions: proposals,
  });
}

module.exports = {
  CONTRIBUTION_RECONCILIATION_SCHEMA,
  RECONCILIATION_FINDING_TYPES,
  RECONCILIATION_ACTIONS,
  ContributionReconciliationError,
  reconcileContribution,
};
