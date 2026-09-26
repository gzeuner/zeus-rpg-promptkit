'use strict';

const {
  CONTRIBUTION_PACKAGE_KIND,
  CONTRIBUTION_PACKAGE_SCHEMA,
  CONTRIBUTION_STATUSES,
  ContributionPackageError,
  canonicalJson,
  openContributionPackage,
  sha256Hex,
} = require('./contributionPackage');
const { DERIVATION_CLASSES } = require('../constants');

const CONTRIBUTION_GATE_STATUSES = Object.freeze(['passed', 'failed']);
const CONTRIBUTION_GATE_CODES = Object.freeze({
  ACCEPTED: 'FKX.GATE_ACCEPTED',
  PACKAGE_INVALID: 'FKX.PACKAGE_INVALID',
  SCHEMA_UNSUPPORTED: 'FKX.SCHEMA_UNSUPPORTED',
  CONTRACT_VERSION_MISMATCH: 'FKX.CONTRACT_VERSION_MISMATCH',
  BASE_SNAPSHOT_MISMATCH: 'FKX.BASE_SNAPSHOT_MISMATCH',
  FRESHNESS_UNKNOWN: 'FKX.FRESHNESS_UNKNOWN',
  FRESHNESS_STALE: 'FKX.FRESHNESS_STALE',
  PROVENANCE_INVALID: 'FKX.PROVENANCE_INVALID',
  EVIDENCE_REQUIRED: 'FKX.EVIDENCE_REQUIRED',
  PRIVACY_FAILED: 'FKX.PRIVACY_FAILED',
  PATH_UNSAFE: 'FKX.PATH_UNSAFE',
  TRUST_ZONE_DENIED: 'FKX.TRUST_ZONE_DENIED',
  CAPABILITY_DENIED: 'FKX.CAPABILITY_DENIED',
  DISCLOSURE_DENIED: 'FKX.DISCLOSURE_DENIED',
  DUPLICATE_CONTRIBUTION: 'FKX.DUPLICATE_CONTRIBUTION',
  LIFECYCLE_REJECTED: 'FKX.LIFECYCLE_REJECTED',
});

const MANIFEST_FIELDS = Object.freeze([
  'kind',
  'schema',
  'contributionId',
  'originInstanceId',
  'baseSnapshot',
  'contractVersions',
  'derivationClass',
  'evidenceReferences',
  'provenance',
  'privacyReport',
  'qualityReport',
  'status',
  'advisory',
  'sourceOfTruth',
  'files',
  'createdAt',
  'manifestHash',
  'packageHash',
]);

const GATE_ORDER = Object.freeze([
  'integrity',
  'schema',
  'contract-versions',
  'base-snapshot',
  'freshness',
  'provenance',
  'evidence',
  'privacy',
  'disclosure-paths',
  'disclosure-policy',
  'trust-zone',
  'capability',
  'idempotency',
  'lifecycle',
]);

const PATH_KEY_PATTERN =
  /^(?:path|file|filename|sourcepath|relativepath|absolutepath|realpath|host|hostname|url|uri)$/i;
const DISCLOSURE_KEY_PATTERN =
  /^(?:raw|rawsource|rawcontent|rawtext|rawdata|secret|token|password|passwd|pwd|credential|authorization|privatekey)$/i;
const ABSOLUTE_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\|\/|(?:file|unc):\/\/)/i;
const URI_PATTERN = /^(?:https?|jdbc|file|unc):/i;
const TRAVERSAL_PATTERN = /(?:^|[\\/])\.\.(?:[\\/]|$)/;
const SECRET_VALUE_PATTERN =
  /\b(?:password|passwd|pwd|secret|token|api[_-]?key|authorization|credential)\s*[:=]/i;
const PRIVATE_KEY_PATTERN = /-----BEGIN [^-]*PRIVATE KEY-----/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isSha256(value) {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function stableList(value) {
  if (!Array.isArray(value)) return null;
  return Array.from(new Set(value.map(item => String(item)))).sort();
}

function sameSnapshot(left, right) {
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  if (!isNonEmptyString(left.snapshotId) || !isNonEmptyString(right.snapshotId)) return false;
  if (left.snapshotId !== right.snapshotId) return false;
  return left.contentHash === undefined || right.contentHash === undefined
    ? true
    : left.contentHash === right.contentHash;
}

function makeGate(id, passed, reasonCode, message) {
  return Object.freeze({
    id,
    status: passed ? 'passed' : 'failed',
    reasonCode,
    message,
  });
}

function normalizePolicy(input) {
  if (input === undefined) {
    return {
      valid: true,
      knownContributionIds: [],
      knownPackageHashes: [],
      allowedTrustZones: [],
      allowedCapabilities: [],
      allowedDisclosure: null,
      requiredContractVersions: {},
      expectedBaseSnapshot: undefined,
      currentSnapshot: undefined,
      requireFreshness: true,
    };
  }

  if (!isPlainObject(input)) {
    return {
      valid: false,
      knownContributionIds: null,
      knownPackageHashes: null,
      allowedTrustZones: null,
      allowedCapabilities: null,
      allowedDisclosure: null,
      requiredContractVersions: null,
      expectedBaseSnapshot: undefined,
      currentSnapshot: undefined,
      requireFreshness: true,
    };
  }

  const normalizeRequiredVersions = value => {
    if (value === undefined) return {};
    if (!isPlainObject(value)) return null;
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (!isNonEmptyString(key) || !isNonEmptyString(value[key])) return null;
      result[key] = value[key].trim();
    }
    return result;
  };

  const normalizeDisclosure = value => {
    if (value === undefined) return null;
    const values = Array.isArray(value) ? value : [value];
    if (values.some(item => !isNonEmptyString(item))) return undefined;
    return Array.from(new Set(values.map(item => item.trim()))).sort();
  };

  const knownContributionIds =
    input.knownContributionIds === undefined ? [] : stableList(input.knownContributionIds);
  const knownPackageHashes =
    input.knownPackageHashes === undefined ? [] : stableList(input.knownPackageHashes);
  const allowedTrustZones =
    input.allowedTrustZones === undefined ? [] : stableList(input.allowedTrustZones);
  const allowedCapabilities =
    input.allowedCapabilities === undefined ? [] : stableList(input.allowedCapabilities);
  const allowedDisclosure = normalizeDisclosure(input.allowedDisclosure);
  const requiredContractVersions = normalizeRequiredVersions(input.requiredContractVersions);
  const requireFreshness = input.requireFreshness === undefined ? true : input.requireFreshness;

  return {
    valid:
      knownContributionIds !== null &&
      knownPackageHashes !== null &&
      allowedTrustZones !== null &&
      allowedCapabilities !== null &&
      allowedDisclosure !== undefined &&
      requiredContractVersions !== null &&
      typeof requireFreshness === 'boolean',
    knownContributionIds,
    knownPackageHashes,
    allowedTrustZones,
    allowedCapabilities,
    allowedDisclosure,
    requiredContractVersions,
    expectedBaseSnapshot: input.expectedBaseSnapshot,
    currentSnapshot: input.currentSnapshot,
    requireFreshness,
  };
}

function findUnsafeDisclosure(value, valuePath = '$') {
  if (typeof value === 'string') {
    const text = value.trim();
    if (ABSOLUTE_PATH_PATTERN.test(text) || TRAVERSAL_PATTERN.test(text)) {
      return { kind: 'path', path: valuePath };
    }
    if (
      URI_PATTERN.test(text) ||
      SECRET_VALUE_PATTERN.test(text) ||
      PRIVATE_KEY_PATTERN.test(text)
    ) {
      return { kind: 'disclosure', path: valuePath };
    }
    return null;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const finding = findUnsafeDisclosure(value[index], `${valuePath}/${index}`);
      if (finding) return finding;
    }
    return null;
  }

  if (!isPlainObject(value)) return null;

  for (const key of Object.keys(value).sort()) {
    const keyPath = `${valuePath}/${key}`;
    if (PATH_KEY_PATTERN.test(key)) return { kind: 'path', path: keyPath };
    if (DISCLOSURE_KEY_PATTERN.test(key)) return { kind: 'disclosure', path: keyPath };
    const finding = findUnsafeDisclosure(value[key], keyPath);
    if (finding) return finding;
  }
  return null;
}

function validateBaseSnapshot(value) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.some(key => !['snapshotId', 'contentHash'].includes(key))) return false;
  return (
    isNonEmptyString(value.snapshotId) &&
    (value.contentHash === undefined || isSha256(value.contentHash))
  );
}

function validateManifestSchema(contribution) {
  if (!isPlainObject(contribution) || !isPlainObject(contribution.manifest)) return false;
  if (!isPlainObject(contribution.payload)) return false;

  const manifest = contribution.manifest;
  if (Object.keys(manifest).some(key => !MANIFEST_FIELDS.includes(key))) return false;
  if (!isNonEmptyString(contribution.kind) || !isNonEmptyString(contribution.schema)) return false;
  if (!isNonEmptyString(manifest.kind) || !isNonEmptyString(manifest.schema)) return false;
  if (!isNonEmptyString(manifest.contributionId)) return false;
  if (!isNonEmptyString(manifest.originInstanceId)) return false;
  if (!validateBaseSnapshot(manifest.baseSnapshot)) return false;

  if (
    !isPlainObject(manifest.contractVersions) ||
    Object.keys(manifest.contractVersions).length === 0
  ) {
    return false;
  }
  if (
    Object.keys(manifest.contractVersions).some(
      key => !isNonEmptyString(key) || !isNonEmptyString(manifest.contractVersions[key])
    )
  ) {
    return false;
  }

  if (!Object.values(DERIVATION_CLASSES).includes(manifest.derivationClass)) return false;
  if (!Array.isArray(manifest.evidenceReferences)) return false;
  if (
    manifest.evidenceReferences.some(
      reference =>
        !isPlainObject(reference) ||
        Object.keys(reference).some(key => !['id', 'contract'].includes(key)) ||
        !isNonEmptyString(reference.id) ||
        !isNonEmptyString(reference.contract)
    )
  ) {
    return false;
  }
  if (!isPlainObject(manifest.provenance)) return false;
  if (!isPlainObject(manifest.privacyReport)) return false;
  if (!isPlainObject(manifest.qualityReport)) return false;
  if (!CONTRIBUTION_STATUSES.includes(manifest.status)) return false;
  if (manifest.advisory !== true || manifest.sourceOfTruth !== false) return false;
  if (!isPlainObject(manifest.files)) return false;
  if (Object.keys(manifest.files).length !== 1 || !isSha256(manifest.files['payload.json'])) {
    return false;
  }
  if (!isSha256(manifest.manifestHash) || !isSha256(manifest.packageHash)) return false;
  if (manifest.createdAt !== undefined && !isNonEmptyString(manifest.createdAt)) return false;
  return true;
}

function verifyIntegrity(contribution) {
  if (!isPlainObject(contribution) || !isPlainObject(contribution.manifest)) return false;
  if (!isPlainObject(contribution.payload)) return false;

  try {
    const payloadBody = `${canonicalJson(contribution.payload)}\n`;
    const payloadHash = sha256Hex(payloadBody);
    const manifestCore = { ...contribution.manifest };
    delete manifestCore.manifestHash;
    delete manifestCore.packageHash;
    const manifestBody = `${canonicalJson(manifestCore)}\n`;
    const manifestHash = sha256Hex(manifestBody);
    const packageHash = sha256Hex(`${manifestHash}:${payloadHash}`);
    const manifest = contribution.manifest;

    if (manifest.files?.['payload.json'] !== payloadHash) return false;
    if (manifest.manifestHash !== manifestHash || manifest.packageHash !== packageHash)
      return false;

    if (isPlainObject(contribution.hashes)) {
      if (
        contribution.hashes.payloadHash !== undefined &&
        contribution.hashes.payloadHash !== payloadHash
      ) {
        return false;
      }
      if (
        contribution.hashes.manifestHash !== undefined &&
        contribution.hashes.manifestHash !== manifestHash
      ) {
        return false;
      }
      if (
        contribution.hashes.packageHash !== undefined &&
        contribution.hashes.packageHash !== packageHash
      ) {
        return false;
      }
    }

    if (isPlainObject(contribution.files)) {
      if (
        contribution.files['payload.json'] !== undefined &&
        contribution.files['payload.json'] !== payloadBody
      ) {
        return false;
      }
      if (
        contribution.files['manifest.json'] !== undefined &&
        contribution.files['manifest.json'] !== `${canonicalJson(manifest)}\n`
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function resolvePackage(options) {
  if (!isPlainObject(options)) {
    throw new ContributionPackageError('PACKAGE_INVALID', 'package input is invalid');
  }
  if (typeof options.packageDir === 'string') return openContributionPackage(options);
  if (isPlainObject(options.package)) return options.package;
  throw new ContributionPackageError('PACKAGE_INVALID', 'package input is required');
}

function safeFingerprint(contribution, policy) {
  try {
    return sha256Hex(
      canonicalJson({
        manifest: contribution.manifest,
        payload: contribution.payload,
        policy,
      })
    );
  } catch {
    return null;
  }
}

function validateContributionPackage(options = {}) {
  const policy = normalizePolicy(options.policy);
  let contribution;
  let packageError = null;
  try {
    contribution = resolvePackage(options);
  } catch (error) {
    packageError = error;
  }

  if (!contribution) {
    const reasonCode =
      packageError?.code === 'SCHEMA_UNSUPPORTED'
        ? CONTRIBUTION_GATE_CODES.SCHEMA_UNSUPPORTED
        : CONTRIBUTION_GATE_CODES.PACKAGE_INVALID;
    const gate = makeGate(
      'integrity',
      false,
      reasonCode,
      'Contribution package could not be opened or verified.'
    );
    return Object.freeze({
      ok: false,
      valid: false,
      status: 'failed',
      canStage: false,
      canPublish: false,
      decision: 'reject',
      contributionId: null,
      packageHash: null,
      gates: Object.freeze([gate]),
      reasonCodes: Object.freeze([reasonCode]),
      inputFingerprint: null,
      errorCode: packageError?.code || 'PACKAGE_INVALID',
    });
  }

  const manifest = contribution.manifest;
  const gates = [];
  const addGate = (id, passed, code, message) => {
    gates.push(makeGate(id, passed, passed ? CONTRIBUTION_GATE_CODES.ACCEPTED : code, message));
  };

  const integrityPassed = verifyIntegrity(contribution);
  addGate(
    'integrity',
    integrityPassed,
    CONTRIBUTION_GATE_CODES.PACKAGE_INVALID,
    integrityPassed
      ? 'Package content and integrity hashes are valid.'
      : 'Package content or integrity hashes are invalid.'
  );

  const schemaPassed =
    contribution.kind === CONTRIBUTION_PACKAGE_KIND &&
    contribution.schema === CONTRIBUTION_PACKAGE_SCHEMA &&
    manifest?.kind === CONTRIBUTION_PACKAGE_KIND &&
    manifest?.schema === CONTRIBUTION_PACKAGE_SCHEMA &&
    validateManifestSchema(contribution);
  addGate(
    'schema',
    schemaPassed,
    CONTRIBUTION_GATE_CODES.SCHEMA_UNSUPPORTED,
    schemaPassed ? 'Package schema is supported.' : 'Package schema is unsupported or malformed.'
  );

  const requiredVersions = policy.requiredContractVersions;
  const contractVersions = manifest?.contractVersions;
  const contractsPassed =
    schemaPassed &&
    policy.valid &&
    isPlainObject(requiredVersions) &&
    isPlainObject(contractVersions) &&
    Object.keys(requiredVersions).every(key => contractVersions[key] === requiredVersions[key]);
  addGate(
    'contract-versions',
    contractsPassed,
    CONTRIBUTION_GATE_CODES.CONTRACT_VERSION_MISMATCH,
    contractsPassed
      ? 'Required contract versions are compatible.'
      : 'Required contract versions are incompatible.'
  );

  const expectedBase = policy.expectedBaseSnapshot;
  const basePassed =
    schemaPassed &&
    policy.valid &&
    (expectedBase === undefined ||
      (validateBaseSnapshot(expectedBase) && sameSnapshot(manifest.baseSnapshot, expectedBase)));
  addGate(
    'base-snapshot',
    basePassed,
    CONTRIBUTION_GATE_CODES.BASE_SNAPSHOT_MISMATCH,
    basePassed
      ? 'Contribution base snapshot is compatible.'
      : 'Contribution base snapshot is incompatible.'
  );

  const currentSnapshot = policy.currentSnapshot;
  const freshnessRequired = policy.requireFreshness !== false;
  const freshnessKnown =
    schemaPassed && policy.valid && (!freshnessRequired || validateBaseSnapshot(currentSnapshot));
  const freshnessCurrent =
    freshnessKnown && (!freshnessRequired || sameSnapshot(manifest.baseSnapshot, currentSnapshot));
  addGate(
    'freshness',
    freshnessKnown && freshnessCurrent,
    !freshnessKnown
      ? CONTRIBUTION_GATE_CODES.FRESHNESS_UNKNOWN
      : CONTRIBUTION_GATE_CODES.FRESHNESS_STALE,
    !freshnessKnown
      ? 'Current snapshot is required for freshness validation.'
      : freshnessCurrent
        ? 'Contribution base snapshot is current.'
        : 'Contribution base snapshot is stale.'
  );

  const provenance = manifest?.provenance;
  const providerDerived =
    isPlainObject(provenance) &&
    (provenance.providerId !== undefined ||
      provenance.provider !== undefined ||
      provenance.origin === 'provider' ||
      provenance.kind === 'provider-derived');
  const provenancePassed =
    schemaPassed &&
    isPlainObject(provenance) &&
    isNonEmptyString(provenance.collector) &&
    isNonEmptyString(provenance.collectedAt) &&
    provenance.sourceOfTruth !== true &&
    provenance.advisory !== false &&
    manifest.advisory === true &&
    manifest.sourceOfTruth === false;
  addGate(
    'provenance',
    provenancePassed,
    CONTRIBUTION_GATE_CODES.PROVENANCE_INVALID,
    provenancePassed
      ? 'Contribution provenance is complete.'
      : 'Contribution provenance is invalid.'
  );

  const evidenceReferences = manifest?.evidenceReferences;
  const evidencePassed =
    schemaPassed &&
    ((manifest.derivationClass !== DERIVATION_CLASSES.VERIFIED && !providerDerived) ||
      (Array.isArray(evidenceReferences) && evidenceReferences.length > 0 && !providerDerived) ||
      (providerDerived &&
        [DERIVATION_CLASSES.INFERRED, DERIVATION_CLASSES.UNRESOLVED].includes(
          manifest.derivationClass
        ) &&
        manifest.status === 'proposed' &&
        manifest.advisory === true &&
        manifest.sourceOfTruth === false));
  addGate(
    'evidence',
    evidencePassed,
    CONTRIBUTION_GATE_CODES.EVIDENCE_REQUIRED,
    evidencePassed
      ? 'Evidence requirements are satisfied.'
      : 'Evidence requirements are not satisfied.'
  );

  const privacyPassed =
    schemaPassed &&
    isPlainObject(manifest.privacyReport) &&
    manifest.privacyReport.status === 'passed';
  addGate(
    'privacy',
    privacyPassed,
    CONTRIBUTION_GATE_CODES.PRIVACY_FAILED,
    privacyPassed ? 'Privacy report passed.' : 'Privacy report did not pass.'
  );

  const unsafeDisclosure = schemaPassed
    ? findUnsafeDisclosure({
        payload: contribution.payload,
        provenance,
        privacyReport: manifest.privacyReport,
        qualityReport: manifest.qualityReport,
        evidenceReferences,
      })
    : { kind: 'path', path: '$' };
  const disclosurePathPassed = !unsafeDisclosure;
  addGate(
    'disclosure-paths',
    disclosurePathPassed,
    unsafeDisclosure?.kind === 'disclosure'
      ? CONTRIBUTION_GATE_CODES.DISCLOSURE_DENIED
      : CONTRIBUTION_GATE_CODES.PATH_UNSAFE,
    disclosurePathPassed
      ? 'Payload disclosure paths are safe.'
      : 'Payload contains a disallowed path or disclosure.'
  );

  const trustZone = provenance && provenance.trustZone;
  const trustPassed =
    schemaPassed &&
    policy.valid &&
    Array.isArray(policy.allowedTrustZones) &&
    (policy.allowedTrustZones.length === 0 ||
      (isNonEmptyString(trustZone) && policy.allowedTrustZones.includes(trustZone)));
  addGate(
    'trust-zone',
    trustPassed,
    CONTRIBUTION_GATE_CODES.TRUST_ZONE_DENIED,
    trustPassed
      ? 'Trust-zone policy permits the contribution.'
      : 'Trust-zone policy denied the contribution.'
  );

  const capability = provenance && provenance.capability;
  const capabilityPassed =
    schemaPassed &&
    policy.valid &&
    Array.isArray(policy.allowedCapabilities) &&
    (policy.allowedCapabilities.length === 0 ||
      (isNonEmptyString(capability) && policy.allowedCapabilities.includes(capability)));
  addGate(
    'capability',
    capabilityPassed,
    CONTRIBUTION_GATE_CODES.CAPABILITY_DENIED,
    capabilityPassed
      ? 'Capability policy permits the contribution.'
      : 'Capability policy denied the contribution.'
  );

  const disclosure = provenance && provenance.disclosure;
  const disclosurePolicyPassed =
    schemaPassed &&
    policy.valid &&
    (policy.allowedDisclosure === null ||
      (Array.isArray(policy.allowedDisclosure) &&
        isNonEmptyString(disclosure) &&
        policy.allowedDisclosure.includes(disclosure)));
  addGate(
    'disclosure-policy',
    disclosurePolicyPassed,
    CONTRIBUTION_GATE_CODES.DISCLOSURE_DENIED,
    disclosurePolicyPassed
      ? 'Disclosure policy permits the contribution.'
      : 'Disclosure policy denied the contribution.'
  );

  const knownContributionIds = policy.knownContributionIds || [];
  const knownPackageHashes = policy.knownPackageHashes || [];
  const duplicate =
    knownContributionIds.includes(String(manifest?.contributionId)) ||
    knownPackageHashes.includes(String(manifest?.packageHash));
  const idempotencyPassed = schemaPassed && policy.valid && !duplicate;
  addGate(
    'idempotency',
    idempotencyPassed,
    CONTRIBUTION_GATE_CODES.DUPLICATE_CONTRIBUTION,
    idempotencyPassed
      ? 'Contribution identity is not duplicated.'
      : duplicate
        ? 'Contribution identity was already observed.'
        : 'Contribution identity could not be checked.'
  );

  const lifecyclePassed =
    schemaPassed &&
    CONTRIBUTION_STATUSES.includes(manifest.status) &&
    ['proposed', 'accepted'].includes(manifest.status) &&
    (!providerDerived || manifest.status === 'proposed');
  addGate(
    'lifecycle',
    lifecyclePassed,
    CONTRIBUTION_GATE_CODES.LIFECYCLE_REJECTED,
    lifecyclePassed
      ? 'Contribution lifecycle permits staging.'
      : 'Contribution lifecycle blocks staging.'
  );

  const orderedGates = GATE_ORDER.map(id => gates.find(gate => gate.id === id));
  const failures = orderedGates.filter(gate => gate.status === 'failed');
  const reasonCodes = failures.map(gate => gate.reasonCode);
  const result = {
    ok: failures.length === 0,
    valid: failures.length === 0,
    status: failures.length === 0 ? 'passed' : 'failed',
    canStage: failures.length === 0,
    canPublish: false,
    decision: failures.length === 0 ? 'accept' : 'reject',
    contributionId: manifest?.contributionId || null,
    packageHash: manifest?.packageHash || null,
    gates: Object.freeze(orderedGates),
    reasonCodes: Object.freeze(reasonCodes),
    inputFingerprint: safeFingerprint(contribution, policy),
    readOnly: true,
  };
  return Object.freeze(result);
}

module.exports = {
  CONTRIBUTION_GATE_STATUSES,
  CONTRIBUTION_GATE_CODES,
  GATE_ORDER,
  validateContributionPackage,
};
