/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
*/
'use strict';

const {
  CONTRACTS,
  PAYLOAD_CLASSIFICATIONS,
  TRUST_ZONES,
  contractRef,
  deepFreeze,
  validateEgressPolicy,
  validatePlainData,
  validatePolicyDenial,
} = require('./contracts');

const DENIAL_MESSAGES = Object.freeze({
  CLASSIFICATION_REQUIRED: 'Processing denied because payload classification is required.',
  CLASSIFICATION_UNKNOWN: 'Processing denied because the payload classification is unsupported.',
  SECRET_TRANSMISSION_FORBIDDEN: 'Processing denied because secrets are never transmissible.',
  TRUST_ZONE_UNKNOWN: 'Processing denied because the provider trust zone is unsupported.',
  POLICY_REQUIRED: 'Processing denied because an explicit egress policy is required.',
  POLICY_INVALID: 'Processing denied because the egress policy is invalid.',
  POLICY_RULE_REQUIRED: 'Processing denied because no exact allow rule applies.',
});

/** @param {any} [options] */
function createPolicyDenial(options = {}) {
  let providerId;
  let correlationId;
  let reasonCode;
  let classification;
  let trustZone;
  let inspectable = null;
  try {
    if (options && typeof options === 'object' && !Array.isArray(options)) {
      inspectable = Object.create(null);
      for (const key of Reflect.ownKeys(options)) {
        if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) {
          inspectable = null;
          break;
        }
        const property = Object.getOwnPropertyDescriptor(options, key);
        if (!property || property.get || property.set) {
          inspectable = null;
          break;
        }
        if (property.value !== undefined) inspectable[key] = property.value;
      }
    }
  } catch {
    inspectable = null;
  }
  if (inspectable && !validatePlainData(inspectable).length) {
    try {
      providerId = inspectable.providerId;
      correlationId = inspectable.correlationId;
      reasonCode = inspectable.reasonCode;
      classification = inspectable.classification;
      trustZone = inspectable.trustZone;
    } catch {
      reasonCode = 'POLICY_INVALID';
    }
  }
  const safeReason = Object.prototype.hasOwnProperty.call(DENIAL_MESSAGES, reasonCode)
    ? reasonCode
    : 'POLICY_INVALID';
  const safeIdentifier = (value, fallback) =>
    typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(value) ? value : fallback;
  const denial = {
    schemaVersion: 1,
    contract: contractRef(CONTRACTS.POLICY_DENIAL),
    providerId: safeIdentifier(providerId, 'invalid-provider'),
    correlationId: safeIdentifier(correlationId, 'invalid-request'),
    reasonCode: safeReason,
    message: DENIAL_MESSAGES[safeReason],
    ...(PAYLOAD_CLASSIFICATIONS.includes(classification) ? { classification } : {}),
    ...(TRUST_ZONES.includes(trustZone) ? { trustZone } : {}),
  };
  if (validatePolicyDenial(denial).length) {
    throw new Error('failed to create provider policy denial');
  }
  return deepFreeze(denial);
}

/**
 * Evaluate one exact classification -> registered provider trust-zone transition.
 * There are no wildcards and local processing is not implicitly allowed.
 */
/** @param {any} [options] */
function evaluateEgressPolicy(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return {
      allowed: false,
      denial: createPolicyDenial({ reasonCode: 'POLICY_INVALID' }),
    };
  }
  let providerId;
  let correlationId;
  let classification;
  let trustZone;
  let policy;
  try {
    const prototype = Object.getPrototypeOf(options);
    if (prototype !== Object.prototype && prototype !== null) throw new Error('invalid options');
    const projected = Object.create(null);
    for (const key of Reflect.ownKeys(options)) {
      if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) {
        throw new Error('invalid options');
      }
      const property = Object.getOwnPropertyDescriptor(options, key);
      if (!property || property.get || property.set) throw new Error('invalid options');
      if (['providerId', 'correlationId', 'classification', 'trustZone', 'policy'].includes(key)) {
        projected[key] = property.value;
      }
    }
    providerId = projected.providerId;
    correlationId = projected.correlationId;
    classification = projected.classification;
    trustZone = projected.trustZone;
    policy = projected.policy;
  } catch {
    return {
      allowed: false,
      denial: createPolicyDenial({ reasonCode: 'POLICY_INVALID' }),
    };
  }
  const deny = reasonCode => ({
    allowed: false,
    denial: createPolicyDenial({
      providerId,
      correlationId,
      reasonCode,
      classification,
      trustZone,
    }),
  });

  if (classification === undefined || classification === null || classification === '') {
    return deny('CLASSIFICATION_REQUIRED');
  }
  if (!PAYLOAD_CLASSIFICATIONS.includes(classification)) return deny('CLASSIFICATION_UNKNOWN');
  // This check intentionally precedes policy validation: no policy can override it.
  if (classification === 'secret') return deny('SECRET_TRANSMISSION_FORBIDDEN');
  if (!TRUST_ZONES.includes(trustZone)) return deny('TRUST_ZONE_UNKNOWN');
  if (policy === undefined || policy === null) return deny('POLICY_REQUIRED');
  if (validateEgressPolicy(policy).length) return deny('POLICY_INVALID');

  const allowed = policy.rules.some(
    rule =>
      rule.allow === true && rule.classification === classification && rule.trustZone === trustZone
  );
  return allowed ? deepFreeze({ allowed: true }) : deny('POLICY_RULE_REQUIRED');
}

function createEgressPolicy(rules = []) {
  if (validatePlainData(rules).length || !Array.isArray(rules)) {
    const error = new Error('invalid egress policy');
    error.code = 'PROVIDER_POLICY_INVALID';
    throw error;
  }
  const candidate = {
    schemaVersion: 1,
    contract: contractRef(CONTRACTS.EGRESS_POLICY),
    rules,
  };
  if (validateEgressPolicy(candidate).length) {
    const error = new Error('invalid egress policy');
    error.code = 'PROVIDER_POLICY_INVALID';
    throw error;
  }
  const policy = {
    schemaVersion: 1,
    contract: contractRef(CONTRACTS.EGRESS_POLICY),
    rules: rules
      .map(rule => ({
        classification: rule.classification,
        trustZone: rule.trustZone,
        allow: rule.allow,
      }))
      .sort(
        (left, right) =>
          left.classification.localeCompare(right.classification) ||
          left.trustZone.localeCompare(right.trustZone)
      ),
  };
  const errors = validateEgressPolicy(policy);
  if (errors.length) {
    const error = new Error('invalid egress policy');
    error.code = 'PROVIDER_POLICY_INVALID';
    throw error;
  }
  return deepFreeze(policy);
}

module.exports = {
  DENIAL_MESSAGES,
  createEgressPolicy,
  createPolicyDenial,
  evaluateEgressPolicy,
};
