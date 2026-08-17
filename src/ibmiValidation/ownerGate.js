'use strict';

const {
  ALLOWED_TEMPLATES,
  LIMITS,
  PUB400_HOST_LABEL,
  PUB400_PROFILE_ID,
  REASON_CODES,
} = require('./constants');
const { normalizeObjectName } = require('./names');

function fail(reasonCode, message, missing = []) {
  return {
    ok: false,
    reasonCode,
    message,
    missing,
    liveAccessAuthorized: false,
  };
}

function isPlainObject(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireTrue(pack, key, missing) {
  if (pack[key] !== true) missing.push(key);
}

function requireNonEmptyString(pack, key, missing) {
  if (typeof pack[key] !== 'string' || !pack[key].trim()) missing.push(key);
}

/**
 * Validate owner activation pack (hard gate).
 * Never accepts credentials, private keys, or connection secrets in the pack.
 */
function validateActivationPack(rawPack) {
  if (!isPlainObject(rawPack)) {
    return fail(REASON_CODES.OWNER_GATE_INCOMPLETE, 'activation pack must be an object.', [
      'activationPack',
    ]);
  }

  // Reject credential-bearing fields immediately (fail closed, no echo).
  const forbiddenKeys = [
    'password',
    'passwd',
    'pwd',
    'secret',
    'token',
    'privateKey',
    'private_key',
    'sshKey',
    'ssh_key',
    'credential',
    'credentials',
    'connectionString',
    'connection_string',
    'apiKey',
    'api_key',
  ];
  for (const key of Object.keys(rawPack)) {
    if (forbiddenKeys.includes(key) || /password|secret|credential|private[_-]?key/i.test(key)) {
      return fail(
        REASON_CODES.OWNER_GATE_INCOMPLETE,
        'activation pack must not contain credential fields.',
        ['credentials-forbidden']
      );
    }
  }

  const missing = [];
  requireNonEmptyString(rawPack, 'environmentName', missing);
  requireTrue(rawPack, 'nonProductionConfirmed', missing);
  requireNonEmptyString(rawPack, 'serviceAccount', missing);
  requireNonEmptyString(rawPack, 'commandAllowlistVersion', missing);
  requireNonEmptyString(rawPack, 'cleanupRollbackDocumentId', missing);
  requireNonEmptyString(rawPack, 'redactionPolicyVersion', missing);
  requireTrue(rawPack, 'confirmationTokenProcedure', missing);
  requireNonEmptyString(rawPack, 'acceptanceCriteriaId', missing);
  requireNonEmptyString(rawPack, 'ownerSignatureDate', missing);

  if (!isPlainObject(rawPack.threatModelAck)) {
    missing.push('threatModelAck');
  } else {
    if (typeof rawPack.threatModelAck.who !== 'string' || !rawPack.threatModelAck.who.trim()) {
      missing.push('threatModelAck.who');
    }
    if (typeof rawPack.threatModelAck.when !== 'string' || !rawPack.threatModelAck.when.trim()) {
      missing.push('threatModelAck.when');
    }
  }

  if (!Array.isArray(rawPack.ownedLibraries) || rawPack.ownedLibraries.length === 0) {
    missing.push('ownedLibraries');
  }
  if (!Array.isArray(rawPack.commandAllowlist) || rawPack.commandAllowlist.length === 0) {
    missing.push('commandAllowlist');
  }
  if (!Array.isArray(rawPack.cleanupManifest) || rawPack.cleanupManifest.length === 0) {
    missing.push('cleanupManifest');
  }

  if (missing.length > 0) {
    return fail(
      REASON_CODES.OWNER_GATE_INCOMPLETE,
      'owner activation pack is incomplete.',
      missing
    );
  }

  const ownedLibraries = [];
  for (const entry of rawPack.ownedLibraries.slice(0, LIMITS.maxLibraries)) {
    const name = normalizeObjectName(entry, 'ownedLibrary');
    if (!name.ok) {
      return fail(REASON_CODES.NAME_INVALID, name.message, ['ownedLibraries']);
    }
    ownedLibraries.push(name.value);
  }
  if (rawPack.ownedLibraries.length > LIMITS.maxLibraries) {
    return fail(REASON_CODES.INPUT_INVALID, 'ownedLibraries exceed limit.', ['ownedLibraries']);
  }

  const commandAllowlist = [];
  for (const entry of rawPack.commandAllowlist) {
    const template = String(entry || '')
      .trim()
      .toLowerCase();
    if (!ALLOWED_TEMPLATES.includes(template)) {
      return fail(
        REASON_CODES.TEMPLATE_DENIED,
        'command allowlist contains unknown or disallowed template.',
        ['commandAllowlist']
      );
    }
    if (!commandAllowlist.includes(template)) commandAllowlist.push(template);
  }

  const cleanupManifest = [];
  for (const step of rawPack.cleanupManifest.slice(0, LIMITS.maxCleanupSteps)) {
    if (!isPlainObject(step) || typeof step.action !== 'string') {
      return fail(REASON_CODES.INPUT_INVALID, 'cleanupManifest step is invalid.', [
        'cleanupManifest',
      ]);
    }
    const action = String(step.action).trim().toLowerCase();
    if (action !== 'delete-object' && action !== 'delete-member' && action !== 'report-residual') {
      return fail(REASON_CODES.OPERATION_DENIED, 'cleanupManifest action is not allowlisted.', [
        'cleanupManifest',
      ]);
    }
    cleanupManifest.push({
      action,
      library: step.library ? String(step.library).trim().toUpperCase() : '',
      object: step.object ? String(step.object).trim().toUpperCase() : '',
      sourceFile: step.sourceFile ? String(step.sourceFile).trim().toUpperCase() : '',
      member: step.member ? String(step.member).trim().toUpperCase() : '',
    });
  }

  const profileId =
    typeof rawPack.profileId === 'string' && rawPack.profileId.trim()
      ? rawPack.profileId.trim()
      : '';
  if (profileId && profileId !== PUB400_PROFILE_ID) {
    return fail(
      REASON_CODES.PROFILE_DENIED,
      'only the approved pub-400 profile id is accepted in this package phase.',
      ['profileId']
    );
  }

  const hostLabel =
    typeof rawPack.hostLabel === 'string' && rawPack.hostLabel.trim()
      ? rawPack.hostLabel.trim().toUpperCase()
      : '';
  if (hostLabel && hostLabel !== PUB400_HOST_LABEL) {
    return fail(
      REASON_CODES.TARGET_DENIED,
      'host label is not the approved non-production community host label.',
      ['hostLabel']
    );
  }

  // Production denylist markers (string labels only; no network).
  const environmentName = String(rawPack.environmentName).trim();
  if (/\b(prod|production|live-prod)\b/i.test(environmentName)) {
    return fail(
      REASON_CODES.TARGET_DENIED,
      'environment name indicates production and is denied.',
      ['environmentName']
    );
  }

  const liveAccessAuthorized = rawPack.liveAccessAuthorized === true;

  // Differential-only optional gates
  let differential = null;
  if (rawPack.differential && isPlainObject(rawPack.differential)) {
    const d = rawPack.differential;
    if (d.enabled === true) {
      if (d.testDataIsolated !== true || d.snapshotRestoreProven !== true) {
        return fail(
          REASON_CODES.OWNER_GATE_INCOMPLETE,
          'differential gates require isolated test data and proven snapshot/restore.',
          ['differential']
        );
      }
      if (!Array.isArray(d.sideEffectInventory) || d.sideEffectInventory.length === 0) {
        return fail(
          REASON_CODES.OWNER_GATE_INCOMPLETE,
          'differential side-effect inventory is required.',
          ['differential.sideEffectInventory']
        );
      }
      differential = {
        enabled: true,
        testDataIsolated: true,
        snapshotRestoreProven: true,
        sideEffectInventory: d.sideEffectInventory
          .slice(0, LIMITS.maxSideEffectClasses)
          .map(entry =>
            String(entry || '')
              .trim()
              .toLowerCase()
          )
          .filter(Boolean),
      };
    }
  }

  return {
    ok: true,
    reasonCode: REASON_CODES.OK,
    pack: Object.freeze({
      environmentName,
      nonProductionConfirmed: true,
      serviceAccount: String(rawPack.serviceAccount).trim(),
      commandAllowlistVersion: String(rawPack.commandAllowlistVersion).trim(),
      cleanupRollbackDocumentId: String(rawPack.cleanupRollbackDocumentId).trim(),
      redactionPolicyVersion: String(rawPack.redactionPolicyVersion).trim(),
      confirmationTokenProcedure: true,
      acceptanceCriteriaId: String(rawPack.acceptanceCriteriaId).trim(),
      ownerSignatureDate: String(rawPack.ownerSignatureDate).trim(),
      threatModelAck: Object.freeze({
        who: String(rawPack.threatModelAck.who).trim(),
        when: String(rawPack.threatModelAck.when).trim(),
      }),
      ownedLibraries: Object.freeze(ownedLibraries),
      commandAllowlist: Object.freeze(commandAllowlist),
      cleanupManifest: Object.freeze(cleanupManifest),
      profileId: profileId || null,
      hostLabel: hostLabel || null,
      liveAccessAuthorized,
      differential,
    }),
    liveAccessAuthorized,
    missing: [],
  };
}

module.exports = {
  validateActivationPack,
};
