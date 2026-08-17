'use strict';

/**
 * Optional caller-supplied organization profiles.
 * Local data-only, deterministic, neutral when absent, fail-closed when malformed.
 * No central Enterprise policy administration.
 */

const { isKnownAdvancedPackId } = require('./advancedValidators');

function isPlainObject(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ALLOWED_PROFILE_KEYS = Object.freeze([
  'id',
  'displayName',
  'allowedRelativeRoots',
  'advancedValidatorIds',
]);
const ALLOWED_PROFILE_KEY_SET = new Set(ALLOWED_PROFILE_KEYS);

/**
 * @returns {{ ok: true, profile: object|null, neutral?: boolean } | { ok: false, code: string, message: string }}
 */
function resolveOrganizationProfile(input) {
  if (input == null) {
    return { ok: true, profile: null, neutral: true };
  }
  if (!isPlainObject(input)) {
    return {
      ok: false,
      code: 'ORGANIZATION_PROFILE_INVALID',
      message: 'organization profile must be a plain object when provided',
    };
  }
  const dangerous = ['__proto__', 'prototype', 'constructor'];
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || dangerous.includes(key)) {
      return {
        ok: false,
        code: 'ORGANIZATION_PROFILE_INVALID',
        message: 'organization profile contains unsafe keys',
      };
    }
    if (!ALLOWED_PROFILE_KEY_SET.has(key)) {
      return {
        ok: false,
        code: 'ORGANIZATION_PROFILE_INVALID',
        message: `unknown organization profile field: ${key}`,
      };
    }
  }
  if (typeof input.id !== 'string' || !PROFILE_ID_PATTERN.test(input.id)) {
    return {
      ok: false,
      code: 'ORGANIZATION_PROFILE_INVALID',
      message: 'organization profile id is required and must use safe characters',
    };
  }
  // Allowed local-only fields (data, not remote admin).
  const allowedRelativeRoots = Array.isArray(input.allowedRelativeRoots)
    ? input.allowedRelativeRoots.map(String)
    : ['.'];
  if (allowedRelativeRoots.length === 0 || allowedRelativeRoots.length > 32) {
    return {
      ok: false,
      code: 'ORGANIZATION_PROFILE_INVALID',
      message: 'allowedRelativeRoots must be a non-empty bounded array',
    };
  }
  if (
    allowedRelativeRoots.some(
      root => root.includes('..') || root.startsWith('/') || /^[A-Za-z]:/.test(root)
    )
  ) {
    return {
      ok: false,
      code: 'ORGANIZATION_PROFILE_INVALID',
      message: 'allowedRelativeRoots must be safe relative roots only',
    };
  }
  const advancedValidatorIds = Array.isArray(input.advancedValidatorIds)
    ? input.advancedValidatorIds.map(String)
    : [];
  if (advancedValidatorIds.length > 32) {
    return {
      ok: false,
      code: 'ORGANIZATION_PROFILE_INVALID',
      message: 'advancedValidatorIds exceeds bound',
    };
  }
  for (const packId of advancedValidatorIds) {
    if (!isKnownAdvancedPackId(packId)) {
      return {
        ok: false,
        code: 'ORGANIZATION_PROFILE_INVALID',
        message: `unknown advancedValidatorId: ${packId || '<empty>'}`,
      };
    }
  }

  return {
    ok: true,
    neutral: false,
    profile: Object.freeze({
      id: input.id,
      allowedRelativeRoots: Object.freeze([...allowedRelativeRoots]),
      advancedValidatorIds: Object.freeze([...advancedValidatorIds].sort()),
      displayName:
        typeof input.displayName === 'string' && input.displayName.trim()
          ? String(input.displayName).trim().slice(0, 120)
          : input.id,
    }),
  };
}

module.exports = {
  ALLOWED_PROFILE_KEYS,
  resolveOrganizationProfile,
};
