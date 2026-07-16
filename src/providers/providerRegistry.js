/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
*/
'use strict';

const UTIL_MODULE_NAME = 'util';
const { types: utilTypes } = require(UTIL_MODULE_NAME);

const {
  CONTRACTS,
  KIND_CONTRACTS,
  DATA_LIMITS,
  contractRef,
  clonePlainData,
  deepFreeze,
  normalizeDescriptor,
  normalizeConfigProvenance,
  normalizeRequest,
  normalizeEvidenceReferences,
  validatePlainData,
  validateResponse,
} = require('./contracts');
const { createPolicyDenial, evaluateEgressPolicy } = require('./egressPolicy');

const REGISTRATION_KEYS = new Set(['descriptor', 'invoke', 'configProvenance']);
const INVOCATION_OPTION_KEYS = new Set(['policy', 'timeoutMs', 'signal']);
const FIXED_ERRORS = Object.freeze({
  UNKNOWN_PROVIDER: 'No provider is registered with the requested identifier.',
  REQUEST_INVALID: 'The provider request is invalid.',
  PROVIDER_ID_MISMATCH: 'The request provider identity does not match the registered provider.',
  MODEL_NOT_SUPPORTED: 'The requested model is not declared by the provider.',
  PROVIDER_CANCELLED: 'Provider invocation was cancelled before completion.',
  PROVIDER_TIMEOUT: 'Provider invocation exceeded the configured time limit.',
  PROVIDER_EXECUTION_FAILED: 'Provider invocation failed.',
  PROVIDER_RESPONSE_INVALID: 'The provider returned an invalid response contract.',
  RESPONSE_IDENTITY_MISMATCH: 'The response identity does not match the request.',
  EVIDENCE_REFERENCE_MISMATCH: 'The response may only retain request evidence references.',
  OUTPUT_LIMIT_EXCEEDED: 'The provider response exceeded the structured output limit.',
  INVOCATION_OPTIONS_INVALID: 'Provider invocation options are invalid.',
});

function fixedFailure(code) {
  return deepFreeze({ ok: false, error: { code, message: FIXED_ERRORS[code] } });
}

function cloneFrozen(value) {
  return deepFreeze(clonePlainData(value));
}

function isGenuineAbortSignal(signal) {
  try {
    if (!signal || Object.getPrototypeOf(signal) !== AbortSignal.prototype) return false;
    for (const key of ['aborted', 'addEventListener', 'removeEventListener']) {
      if (Object.prototype.hasOwnProperty.call(signal, key)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function readAbortState(signal) {
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted');
  if (!descriptor || typeof descriptor.get !== 'function')
    throw new Error('abort state unavailable');
  return descriptor.get.call(signal);
}

function addAbortListener(signal, listener) {
  EventTarget.prototype.addEventListener.call(signal, 'abort', listener, { once: true });
}

function removeAbortListener(signal, listener) {
  EventTarget.prototype.removeEventListener.call(signal, 'abort', listener);
}

function projectInvocationOptions(options) {
  try {
    if (!options || typeof options !== 'object' || Array.isArray(options)) return null;
    if (utilTypes.isProxy(options)) return null;
    const prototype = Object.getPrototypeOf(options);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const projected = { policy: undefined, timeoutMs: 5000, signal: null };
    for (const key of Reflect.ownKeys(options)) {
      if (
        typeof key !== 'string' ||
        ['__proto__', 'prototype', 'constructor'].includes(key) ||
        !INVOCATION_OPTION_KEYS.has(key)
      ) {
        return null;
      }
      const property = Object.getOwnPropertyDescriptor(options, key);
      if (!property || property.get || property.set) return null;
      projected[key] = property.value;
    }
    if (
      !Number.isInteger(projected.timeoutMs) ||
      projected.timeoutMs < 1 ||
      projected.timeoutMs > 30000
    ) {
      return null;
    }
    if (projected.signal !== null && !isGenuineAbortSignal(projected.signal)) return null;
    return projected;
  } catch {
    return null;
  }
}

function validateRegistrationEnvelope(registration) {
  if (!registration || typeof registration !== 'object' || Array.isArray(registration)) {
    throwRegistration('PROVIDER_REGISTRATION_INVALID');
  }
  if (utilTypes.isProxy(registration)) {
    throwRegistration('PROVIDER_REGISTRATION_INVALID');
  }
  const prototype = Object.getPrototypeOf(registration);
  if (prototype !== Object.prototype && prototype !== null) {
    throwRegistration('PROVIDER_REGISTRATION_INVALID');
  }
  for (const key of Reflect.ownKeys(registration)) {
    if (typeof key !== 'string') {
      throwRegistration('PROVIDER_REGISTRATION_INVALID');
    }
    if (['__proto__', 'prototype', 'constructor'].includes(key)) {
      throwRegistration('PROVIDER_REGISTRATION_INVALID');
    }
    const property = Object.getOwnPropertyDescriptor(registration, key);
    if (!property || property.get || property.set || !REGISTRATION_KEYS.has(key)) {
      throwRegistration('PROVIDER_REGISTRATION_INVALID');
    }
  }
  const descriptorProperty = Object.getOwnPropertyDescriptor(registration, 'descriptor');
  const invokeProperty = Object.getOwnPropertyDescriptor(registration, 'invoke');
  if (!descriptorProperty || !invokeProperty || typeof invokeProperty.value !== 'function') {
    throwRegistration('PROVIDER_REGISTRATION_INVALID');
  }
  return {
    descriptor: descriptorProperty.value,
    invoke: invokeProperty.value,
    configProvenance: Object.getOwnPropertyDescriptor(registration, 'configProvenance')?.value,
  };
}

/** @returns {never} */
function throwRegistration(code) {
  const error = new Error('provider registration rejected');
  error.code = code;
  throw error;
}

function createStatus(descriptor) {
  return deepFreeze({
    schemaVersion: 1,
    contract: contractRef(CONTRACTS.PROVIDER_STATUS),
    providerId: descriptor.id,
    providerKind: descriptor.kind,
    lifecycle: 'registered',
    health: 'unknown',
    availability: 'unknown',
    reasonCode: 'NOT_PROBED',
  });
}

function sameEvidenceReferences(left, right) {
  if (!Array.isArray(left) || left.length !== right.length) return false;
  return left.every(
    (reference, index) =>
      reference.id === right[index].id && reference.contract === right[index].contract
  );
}

function normalizeResponse(kind, response) {
  const normalized = {
    schemaVersion: 1,
    contract: contractRef(KIND_CONTRACTS[kind].response),
    providerId: response.providerId,
    correlationId: response.correlationId,
    advisory: true,
    sourceOfTruth: false,
    evidenceReferences: normalizeEvidenceReferences(response.evidenceReferences),
    output: clonePlainData(response.output),
  };
  if (kind === 'model' || kind === 'embedding') normalized.modelId = response.modelId;
  if (response.usage !== undefined) {
    normalized.usage = {};
    for (const key of ['inputUnits', 'outputUnits', 'totalUnits']) {
      if (response.usage[key] !== undefined) normalized.usage[key] = response.usage[key];
    }
  }
  return deepFreeze(normalized);
}

function createProviderRegistry() {
  const entries = new Map();
  let sealed = false;

  function register(rawRegistration) {
    if (sealed) throwRegistration('PROVIDER_REGISTRY_SEALED');
    let registration;
    try {
      registration = validateRegistrationEnvelope(rawRegistration);
    } catch {
      throwRegistration('PROVIDER_REGISTRATION_INVALID');
    }
    const descriptorDataErrors = validatePlainData(registration.descriptor);
    if (descriptorDataErrors.length) throwRegistration('PROVIDER_DESCRIPTOR_INVALID');
    let kind;
    try {
      kind = registration.descriptor && registration.descriptor.kind;
    } catch {
      throwRegistration('PROVIDER_DESCRIPTOR_INVALID');
    }
    if (!Object.prototype.hasOwnProperty.call(KIND_CONTRACTS, kind)) {
      throwRegistration('PROVIDER_KIND_UNSUPPORTED');
    }
    let normalized;
    try {
      normalized = normalizeDescriptor(kind, registration.descriptor);
    } catch {
      throwRegistration('PROVIDER_DESCRIPTOR_INVALID');
    }
    if (!normalized.ok) throwRegistration('PROVIDER_DESCRIPTOR_INVALID');
    if (entries.has(normalized.value.id)) throwRegistration('DUPLICATE_PROVIDER_ID');

    let provenance = null;
    if (registration.configProvenance !== undefined) {
      const normalizedProvenance = normalizeConfigProvenance(registration.configProvenance);
      if (!normalizedProvenance.ok) {
        throwRegistration('PROVIDER_CONFIG_PROVENANCE_INVALID');
      }
      provenance = normalizedProvenance.value;
    }

    const entry = {
      descriptor: normalized.value,
      status: createStatus(normalized.value),
      invoke: registration.invoke,
      provenance,
    };
    // All validation is complete. This is the sole registry mutation.
    entries.set(normalized.value.id, entry);
    return get(normalized.value.id);
  }

  function get(providerId) {
    const entry = entries.get(providerId);
    if (!entry) return null;
    return cloneFrozen({
      descriptor: entry.descriptor,
      status: entry.status,
      ...(entry.provenance ? { configProvenance: entry.provenance } : {}),
    });
  }

  function list() {
    return Array.from(entries.values())
      .sort(
        (left, right) =>
          left.descriptor.kind.localeCompare(right.descriptor.kind) ||
          left.descriptor.id.localeCompare(right.descriptor.id)
      )
      .map(entry =>
        cloneFrozen({
          descriptor: entry.descriptor,
          status: entry.status,
          ...(entry.provenance ? { configProvenance: entry.provenance } : {}),
        })
      );
  }

  async function invoke(providerId, rawRequest, options = {}) {
    const entry = entries.get(providerId);
    if (!entry) return fixedFailure('UNKNOWN_PROVIDER');
    const invocationOptions = projectInvocationOptions(options);
    if (!invocationOptions) return fixedFailure('INVOCATION_OPTIONS_INVALID');

    const requestDataErrors = validatePlainData(rawRequest);
    if (requestDataErrors.length || !rawRequest || typeof rawRequest !== 'object') {
      return fixedFailure('REQUEST_INVALID');
    }
    let requestProviderId;
    let requestCorrelationId;
    let requestClassification;
    try {
      requestProviderId = rawRequest.providerId;
      requestCorrelationId = rawRequest.correlationId;
      requestClassification = rawRequest.classification;
    } catch {
      return fixedFailure('REQUEST_INVALID');
    }
    if (requestProviderId !== entry.descriptor.id) return fixedFailure('PROVIDER_ID_MISMATCH');

    let policyDecision;
    try {
      const policy = invocationOptions.policy;
      policyDecision = evaluateEgressPolicy({
        providerId: entry.descriptor.id,
        correlationId: requestCorrelationId,
        classification: requestClassification,
        trustZone: entry.descriptor.trustZone,
        ...(policy === undefined ? {} : { policy }),
      });
    } catch {
      policyDecision = {
        allowed: false,
        denial: createPolicyDenial({
          providerId: entry.descriptor.id,
          correlationId: requestCorrelationId,
          reasonCode: 'POLICY_INVALID',
          classification: requestClassification,
          trustZone: entry.descriptor.trustZone,
        }),
      };
    }
    if (!policyDecision.allowed) {
      return deepFreeze({
        ok: false,
        error: { code: 'PROVIDER_POLICY_DENIED' },
        denial: policyDecision.denial,
      });
    }

    const kind = entry.descriptor.kind;
    let requestResult;
    try {
      requestResult = normalizeRequest(kind, rawRequest);
    } catch {
      return fixedFailure('REQUEST_INVALID');
    }
    if (!requestResult.ok) return fixedFailure('REQUEST_INVALID');
    const request = requestResult.value;
    if (
      (kind === 'model' || kind === 'embedding') &&
      !entry.descriptor.models.includes(request.modelId)
    ) {
      return fixedFailure('MODEL_NOT_SUPPORTED');
    }

    const timeoutMs = invocationOptions.timeoutMs;
    const externalSignal = invocationOptions.signal;
    try {
      if (externalSignal && readAbortState(externalSignal))
        return fixedFailure('PROVIDER_CANCELLED');
    } catch {
      return fixedFailure('INVOCATION_OPTIONS_INVALID');
    }

    const controller = new AbortController();
    let externalAborted = false;
    const onAbort = () => {
      externalAborted = true;
      controller.abort();
    };
    try {
      if (externalSignal) {
        addAbortListener(externalSignal, onAbort);
        if (readAbortState(externalSignal)) {
          removeAbortListener(externalSignal, onAbort);
          return fixedFailure('PROVIDER_CANCELLED');
        }
      }
    } catch {
      return fixedFailure('INVOCATION_OPTIONS_INVALID');
    }
    const invocationContext = Object.freeze({
      provider: Object.freeze({
        id: entry.descriptor.id,
        kind,
        trustZone: entry.descriptor.trustZone,
      }),
      signal: controller.signal,
    });

    let timer;
    let response;
    let invocationFailureCode = null;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          const error = new Error('timeout');
          error.code = 'PROVIDER_TIMEOUT';
          reject(error);
        }, timeoutMs);
      });
      const cancelled = new Promise((_, reject) => {
        addAbortListener(controller.signal, () => {
          const error = new Error('cancelled');
          error.code = 'PROVIDER_CANCELLED';
          reject(error);
        });
      });
      response = await Promise.race([
        Promise.resolve().then(() => entry.invoke(invocationContext, request)),
        timeout,
        cancelled,
      ]);
    } catch (error) {
      if (error && error.code === 'PROVIDER_TIMEOUT') {
        invocationFailureCode = 'PROVIDER_TIMEOUT';
      } else if (error && error.code === 'PROVIDER_CANCELLED') {
        invocationFailureCode = externalAborted ? 'PROVIDER_CANCELLED' : 'PROVIDER_TIMEOUT';
      } else {
        invocationFailureCode = 'PROVIDER_EXECUTION_FAILED';
      }
    } finally {
      if (timer) clearTimeout(timer);
      if (externalSignal) {
        try {
          removeAbortListener(externalSignal, onAbort);
        } catch {
          invocationFailureCode = 'INVOCATION_OPTIONS_INVALID';
        }
      }
    }
    if (invocationFailureCode) return fixedFailure(invocationFailureCode);

    try {
      if (validateResponse(kind, response).length) return fixedFailure('PROVIDER_RESPONSE_INVALID');
      if (
        response.providerId !== request.providerId ||
        response.correlationId !== request.correlationId ||
        ((kind === 'model' || kind === 'embedding') && response.modelId !== request.modelId)
      ) {
        return fixedFailure('RESPONSE_IDENTITY_MISMATCH');
      }
      if (!sameEvidenceReferences(response.evidenceReferences, request.evidenceReferences)) {
        return fixedFailure('EVIDENCE_REFERENCE_MISMATCH');
      }
      const outputErrors = validatePlainData(response.output, {
        maxTotalBytes: Math.min(
          request.maxOutputBytes || DATA_LIMITS.maxOutputBytes,
          DATA_LIMITS.maxOutputBytes
        ),
      });
      if (outputErrors.length) return fixedFailure('OUTPUT_LIMIT_EXCEEDED');
      return deepFreeze({ ok: true, response: normalizeResponse(kind, response) });
    } catch {
      return fixedFailure('PROVIDER_RESPONSE_INVALID');
    }
  }

  function seal() {
    sealed = true;
  }

  return Object.freeze({
    register,
    get,
    list,
    invoke,
    seal,
    isSealed: () => sealed,
    size: () => entries.size,
  });
}

module.exports = { FIXED_ERRORS, createProviderRegistry };
