'use strict';

const crypto = require('node:crypto');
const { LIMITS, PINNED_COMMUNITY_SHA, REASON_CODES, MODES } = require('./constants');
const { normalizeMemberRef } = require('./names');
const { assertNoCommandText, assertTemplateAllowed } = require('./operations');

function fail(reasonCode, message) {
  return { ok: false, reasonCode, message };
}

function isPlainObject(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}

function hashCanonical(value) {
  return crypto.createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}

function fingerprintToken(token) {
  return crypto
    .createHash('sha256')
    .update(String(token || ''), 'utf8')
    .digest('hex');
}

/**
 * Build an immutable compile plan from a validated activation pack + request.
 */
function buildCompilePlan(request, pack, mode = MODES.OFFLINE) {
  if (!isPlainObject(request)) {
    return fail(REASON_CODES.INPUT_INVALID, 'compile plan request must be an object.');
  }
  if (!pack || typeof pack !== 'object') {
    return fail(REASON_CODES.OWNER_GATE_INCOMPLETE, 'validated activation pack is required.');
  }

  const noCmd = assertNoCommandText(request.commandText);
  if (!noCmd.ok) return noCmd;

  const template = assertTemplateAllowed(request.templateId, pack.commandAllowlist);
  if (!template.ok) return template;

  const target = normalizeMemberRef(request.target || {}, pack.ownedLibraries);
  if (!target.ok) return target;

  if (!Array.isArray(request.sources) || request.sources.length === 0) {
    return fail(REASON_CODES.INPUT_INVALID, 'sources array is required.');
  }
  if (request.sources.length > LIMITS.maxSources) {
    return fail(REASON_CODES.INPUT_INVALID, 'too many sources.');
  }

  const sources = [];
  let totalBytes = 0;
  for (const source of request.sources) {
    if (!isPlainObject(source) || typeof source.content !== 'string') {
      return fail(REASON_CODES.INPUT_INVALID, 'each source needs content string.');
    }
    const content = source.content;
    const bytes = Buffer.byteLength(content, 'utf8');
    totalBytes += bytes;
    if (bytes > LIMITS.maxSourceBytes || totalBytes > LIMITS.maxSourceBytes * LIMITS.maxSources) {
      return fail(REASON_CODES.INPUT_INVALID, 'source content exceeds bounds.');
    }
    // Synthetic-only marker for pub-400 phase: sources must declare synthetic.
    if (source.synthetic !== true) {
      return fail(
        REASON_CODES.INPUT_INVALID,
        'only synthetic sources are accepted (synthetic:true required).'
      );
    }
    const member = source.member
      ? normalizeMemberRef(
          {
            library: target.value.library,
            sourceFile: target.value.sourceFile,
            member: source.member,
            object: source.object || source.member,
            memberType: source.memberType || target.value.memberType,
          },
          pack.ownedLibraries
        )
      : { ok: true, value: target.value };
    if (!member.ok) return member;
    sources.push({
      member: member.value.member,
      contentSha256: crypto.createHash('sha256').update(content, 'utf8').digest('hex'),
      byteLength: bytes,
      synthetic: true,
    });
  }

  const resolvedMode = Object.values(MODES).includes(mode) ? mode : MODES.OFFLINE;

  const planBody = {
    schemaVersion: 1,
    kind: 'ibmi-compile-plan',
    communitySha: PINNED_COMMUNITY_SHA,
    mode: resolvedMode,
    environmentName: pack.environmentName,
    profileId: pack.profileId,
    hostLabel: pack.hostLabel,
    serviceAccount: pack.serviceAccount,
    templateId: template.templateId,
    target: target.value,
    sources,
    refuseIfExists: true,
    nonClaims: {
      deployed: false,
      productionValidated: false,
      businessCorrect: false,
    },
    commandAllowlistVersion: pack.commandAllowlistVersion,
    redactionPolicyVersion: pack.redactionPolicyVersion,
  };

  const planJson = canonicalize(planBody);
  if (Buffer.byteLength(planJson, 'utf8') > LIMITS.maxPlanJsonBytes) {
    return fail(REASON_CODES.INPUT_INVALID, 'plan exceeds size bound.');
  }

  const planHash = crypto.createHash('sha256').update(planJson, 'utf8').digest('hex');

  return {
    ok: true,
    plan: Object.freeze({ ...planBody, planHash }),
    planHash,
  };
}

/**
 * Operator confirmation token must bind exactly to the plan hash.
 * Token itself is never stored — only a fingerprint is retained in evidence.
 */
function validateConfirmationToken(token, planHash) {
  if (typeof token !== 'string' || !token.trim()) {
    return fail(REASON_CODES.CONFIRMATION_INVALID, 'confirmation token is required.');
  }
  if (typeof planHash !== 'string' || !/^[a-f0-9]{64}$/.test(planHash)) {
    return fail(REASON_CODES.CONFIRMATION_INVALID, 'plan hash is invalid.');
  }
  // Expected format: "confirm:<planHash>:<nonce>" where nonce is non-empty.
  const parts = token.trim().split(':');
  if (parts.length < 3 || parts[0] !== 'confirm' || parts[1] !== planHash || !parts[2]) {
    return fail(
      REASON_CODES.CONFIRMATION_INVALID,
      'confirmation token does not bind to plan hash.'
    );
  }
  return {
    ok: true,
    confirmationTokenFingerprint: fingerprintToken(token.trim()),
  };
}

module.exports = {
  canonicalize,
  hashCanonical,
  fingerprintToken,
  buildCompilePlan,
  validateConfirmationToken,
};
