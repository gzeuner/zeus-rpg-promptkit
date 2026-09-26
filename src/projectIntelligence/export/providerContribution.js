'use strict';

const {
  CONTRACTS,
  TRUST_ZONES,
  validatePlainData,
  validateDescriptor,
  validateRequest,
  validateResponse,
} = require('../../providers/contracts');
const { evaluateEgressPolicy } = require('../../providers/egressPolicy');
const { DERIVATION_CLASSES } = require('../constants');
const {
  canonicalJson,
  createContributionPackage,
  sha256Hex,
  ContributionPackageError,
} = require('./contributionPackage');
const { validateContributionPackage } = require('./contributionValidation');

const PROVIDER_CONTRIBUTION_SCHEMA = 'knowledge.contribution.provider@1';
const PROVIDER_CONTRIBUTION_KIND = 'provider-contribution';
const PROVIDER_CONTRIBUTION_REASON_CODES = Object.freeze({
  INPUT_INVALID: 'FKX.PROVIDER_INPUT_INVALID',
  PROVIDER_NOT_REGISTERED: 'FKX.PROVIDER_NOT_REGISTERED',
  PROVIDER_OPT_IN_REQUIRED: 'FKX.PROVIDER_OPT_IN_REQUIRED',
  TRUST_ZONE_DENIED: 'FKX.PROVIDER_TRUST_ZONE_DENIED',
  POLICY_DENIED: 'FKX.PROVIDER_POLICY_DENIED',
  REQUEST_INVALID: 'FKX.PROVIDER_REQUEST_INVALID',
  RESPONSE_INVALID: 'FKX.PROVIDER_RESPONSE_INVALID',
  IDENTITY_MISMATCH: 'FKX.PROVIDER_IDENTITY_MISMATCH',
  EVIDENCE_MISMATCH: 'FKX.PROVIDER_EVIDENCE_MISMATCH',
  OUTPUT_UNSAFE: 'FKX.PROVIDER_OUTPUT_UNSAFE',
  PROVENANCE_INVALID: 'FKX.PROVIDER_PROVENANCE_INVALID',
  DERIVATION_DOWNGRADED: 'FKX.PROVIDER_DERIVATION_DOWNGRADED',
  VALIDATION_FAILED: 'FKX.PROVIDER_CONTRIBUTION_INVALID',
});

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PROVIDER_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const DERIVED_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

class ProviderContributionError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ProviderContributionError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new ProviderContributionError(code, message, details);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function requireObject(value, field) {
  if (!isPlainObject(value))
    fail(PROVIDER_CONTRIBUTION_REASON_CODES.INPUT_INVALID, `${field} is required`);
  return value;
}

function requireIdentifier(value, field, provider = false) {
  const pattern = provider ? PROVIDER_IDENTIFIER_PATTERN : IDENTIFIER_PATTERN;
  if (typeof value !== 'string' || !pattern.test(value.trim())) {
    fail(PROVIDER_CONTRIBUTION_REASON_CODES.INPUT_INVALID, `${field} is invalid`);
  }
  return value.trim();
}

function requireHash(value, field) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    fail(
      PROVIDER_CONTRIBUTION_REASON_CODES.PROVENANCE_INVALID,
      `${field} must be lowercase sha256 hex`
    );
  }
  return value;
}

function requireTimestamp(value, field) {
  if (value === undefined) {
    fail(PROVIDER_CONTRIBUTION_REASON_CODES.PROVENANCE_INVALID, `${field} is required`);
  }
  const timestamp = String(value).trim();
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    fail(
      PROVIDER_CONTRIBUTION_REASON_CODES.PROVENANCE_INVALID,
      `${field} must be an ISO UTC timestamp`
    );
  }
  const canonical = parsed.toISOString();
  const expected = timestamp.includes('.') ? canonical : canonical.replace('.000Z', 'Z');
  if (!ISO_TIMESTAMP_PATTERN.test(timestamp) || timestamp !== expected) {
    fail(
      PROVIDER_CONTRIBUTION_REASON_CODES.PROVENANCE_INVALID,
      `${field} must be an ISO UTC timestamp`
    );
  }
  return timestamp;
}

function hasSafeDerivedKeys(value) {
  try {
    if (Array.isArray(value)) return value.every(hasSafeDerivedKeys);
    if (!isPlainObject(value)) return true;
    return Object.keys(value).every(
      key => DERIVED_KEY_PATTERN.test(key) && hasSafeDerivedKeys(value[key])
    );
  } catch {
    return false;
  }
}

function sameEvidenceReferences(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every(
    (reference, index) =>
      reference &&
      right[index] &&
      reference.id === right[index].id &&
      reference.contract === right[index].contract
  );
}

function normalizeProvider(options) {
  const registry = options.providerRegistry;
  if (!registry || typeof registry.get !== 'function') {
    fail(
      PROVIDER_CONTRIBUTION_REASON_CODES.PROVIDER_NOT_REGISTERED,
      'an explicit provider registry is required'
    );
  }
  const request = requireObject(options.request, 'request');
  const requestErrors = validateRequest('model', request);
  if (requestErrors.length) {
    fail(
      PROVIDER_CONTRIBUTION_REASON_CODES.REQUEST_INVALID,
      'provider request contract is invalid'
    );
  }

  let registered;
  try {
    registered = registry.get(request.providerId);
  } catch {
    registered = null;
  }
  if (!registered || !isPlainObject(registered.descriptor)) {
    fail(PROVIDER_CONTRIBUTION_REASON_CODES.PROVIDER_NOT_REGISTERED, 'provider is not registered');
  }
  const descriptor = registered.descriptor;
  if (validateDescriptor('model', descriptor).length) {
    fail(
      PROVIDER_CONTRIBUTION_REASON_CODES.PROVIDER_NOT_REGISTERED,
      'registered provider is not compatible'
    );
  }
  if (!TRUST_ZONES.includes(descriptor.trustZone)) {
    fail(
      PROVIDER_CONTRIBUTION_REASON_CODES.TRUST_ZONE_DENIED,
      'provider trust zone is not allowed'
    );
  }
  if (descriptor.id !== request.providerId || !descriptor.models.includes(request.modelId)) {
    fail(
      PROVIDER_CONTRIBUTION_REASON_CODES.PROVIDER_NOT_REGISTERED,
      'registered provider is not compatible'
    );
  }
  if (options.providerOptIn !== true) {
    fail(
      PROVIDER_CONTRIBUTION_REASON_CODES.PROVIDER_OPT_IN_REQUIRED,
      'provider opt-in is required'
    );
  }

  const egress = evaluateEgressPolicy({
    providerId: request.providerId,
    correlationId: request.correlationId,
    classification: request.classification,
    trustZone: descriptor.trustZone,
    policy: options.egressPolicy,
  });
  if (!egress.allowed) {
    fail(
      PROVIDER_CONTRIBUTION_REASON_CODES.POLICY_DENIED,
      'provider egress policy denied the request'
    );
  }

  return { request, descriptor };
}

function normalizeResponse(response, request) {
  requireObject(response, 'response');
  if (validateResponse('model', response).length) {
    fail(
      PROVIDER_CONTRIBUTION_REASON_CODES.RESPONSE_INVALID,
      'provider response contract is invalid'
    );
  }
  if (
    response.providerId !== request.providerId ||
    response.modelId !== request.modelId ||
    response.correlationId !== request.correlationId
  ) {
    fail(
      PROVIDER_CONTRIBUTION_REASON_CODES.IDENTITY_MISMATCH,
      'provider response identity does not match request'
    );
  }
  if (!sameEvidenceReferences(response.evidenceReferences, request.evidenceReferences)) {
    fail(
      PROVIDER_CONTRIBUTION_REASON_CODES.EVIDENCE_MISMATCH,
      'provider response changed request evidence'
    );
  }
  if (
    !isPlainObject(response.output) ||
    !hasSafeDerivedKeys(response.output) ||
    validatePlainData(response.output, {
      maxDepth: 8,
      maxKeys: 128,
      maxItems: 128,
      maxStringBytes: 4096,
      maxTotalBytes: 32 * 1024,
    }).length
  ) {
    fail(
      PROVIDER_CONTRIBUTION_REASON_CODES.OUTPUT_UNSAFE,
      'provider output must be bounded structured data'
    );
  }
  try {
    return {
      ...response,
      output: JSON.parse(canonicalJson(response.output, { rejectSensitiveKeys: true })),
    };
  } catch {
    fail(
      PROVIDER_CONTRIBUTION_REASON_CODES.OUTPUT_UNSAFE,
      'provider output contains a disallowed field or disclosure'
    );
  }
}

function normalizeDerivation(value) {
  if (value === undefined || value === DERIVATION_CLASSES.VERIFIED) {
    return {
      requested: value || DERIVATION_CLASSES.INFERRED,
      effective: DERIVATION_CLASSES.INFERRED,
      downgraded: value === DERIVATION_CLASSES.VERIFIED,
    };
  }
  if (![DERIVATION_CLASSES.INFERRED, DERIVATION_CLASSES.UNRESOLVED].includes(value)) {
    fail(
      PROVIDER_CONTRIBUTION_REASON_CODES.INPUT_INVALID,
      'provider derivation class is unsupported'
    );
  }
  return { requested: value, effective: value, downgraded: false };
}

function createProviderContribution(options = {}) {
  requireObject(options, 'options');
  const { request, descriptor } = normalizeProvider(options);
  const response = normalizeResponse(options.response, request);
  const derivation = normalizeDerivation(options.derivationClass);
  const baseSnapshot = requireObject(options.baseSnapshot, 'baseSnapshot');
  const contractVersions = requireObject(options.contractVersions, 'contractVersions');
  const contributionId = requireIdentifier(options.contributionId, 'contributionId');
  const providerVersion = requireIdentifier(options.providerVersion, 'providerVersion');
  const modelDigest = requireHash(options.modelDigest, 'modelDigest');
  const collectedAt = requireTimestamp(options.collectedAt, 'collectedAt');
  const requestFingerprint = sha256Hex(canonicalJson(request));
  const privacyReport = requireObject(options.privacyReport, 'privacyReport');
  const qualityReport = requireObject(options.qualityReport, 'qualityReport');
  if (privacyReport.status !== 'passed') {
    fail(
      PROVIDER_CONTRIBUTION_REASON_CODES.OUTPUT_UNSAFE,
      'provider output requires a passed privacy report'
    );
  }

  const provenance = {
    collector: 'provider-contribution-bridge',
    collectedAt,
    origin: 'provider',
    kind: 'provider-derived',
    providerId: descriptor.id,
    providerKind: descriptor.kind,
    providerVersion,
    modelId: request.modelId,
    modelDigest,
    requestCorrelationId: request.correlationId,
    requestFingerprint,
    responseContract: CONTRACTS.MODEL_RESPONSE,
    trustZone: descriptor.trustZone,
    capability:
      options.capability === undefined
        ? 'provider-contribution'
        : requireIdentifier(options.capability, 'capability'),
    disclosure:
      options.disclosure === undefined
        ? 'derived-local'
        : requireIdentifier(options.disclosure, 'disclosure'),
  };

  let contribution;
  try {
    contribution = createContributionPackage({
      contributionId,
      originInstanceId: requireIdentifier(options.originInstanceId, 'originInstanceId'),
      baseSnapshot,
      contractVersions,
      derivationClass: derivation.effective,
      evidenceReferences: request.evidenceReferences,
      provenance,
      privacyReport,
      qualityReport: {
        ...qualityReport,
        derivation: 'provider-derived',
      },
      status: 'proposed',
      payload: {
        facts: response.output,
        requestFingerprint,
        provider: {
          id: descriptor.id,
          modelId: request.modelId,
          modelDigest,
          providerVersion,
        },
      },
    });
  } catch (error) {
    if (error instanceof ContributionPackageError) {
      fail(
        PROVIDER_CONTRIBUTION_REASON_CODES.OUTPUT_UNSAFE,
        'provider output cannot cross the contribution boundary'
      );
    }
    throw error;
  }

  const validation = validateContributionPackage({
    package: contribution,
    policy: {
      ...(options.validationPolicy || {}),
      currentSnapshot: baseSnapshot,
    },
  });
  if (!validation.ok) {
    fail(
      PROVIDER_CONTRIBUTION_REASON_CODES.VALIDATION_FAILED,
      'provider contribution failed FKX validation',
      {
        reasonCodes: validation.reasonCodes,
      }
    );
  }

  return deepFreeze({
    ok: true,
    kind: PROVIDER_CONTRIBUTION_KIND,
    schema: PROVIDER_CONTRIBUTION_SCHEMA,
    package: contribution,
    provider: {
      id: descriptor.id,
      trustZone: descriptor.trustZone,
      modelId: request.modelId,
      providerVersion,
      modelDigest,
    },
    requestFingerprint,
    requestedDerivation: derivation.requested,
    derivationClass: derivation.effective,
    downgradedFrom: derivation.downgraded ? DERIVATION_CLASSES.VERIFIED : null,
    reasonCodes: derivation.downgraded
      ? [PROVIDER_CONTRIBUTION_REASON_CODES.DERIVATION_DOWNGRADED]
      : [],
    providerInvoked: false,
    localOnly: true,
    readOnly: true,
    publication: false,
    canPublish: false,
    validation,
  });
}

module.exports = {
  PROVIDER_CONTRIBUTION_SCHEMA,
  PROVIDER_CONTRIBUTION_KIND,
  PROVIDER_CONTRIBUTION_REASON_CODES,
  ProviderContributionError,
  createProviderContribution,
  createProviderContributionPackage: createProviderContribution,
};
