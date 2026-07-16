/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
'use strict';

const CONTRACT_VERSION = 1;
const PROVIDER_KINDS = Object.freeze(['model', 'embedding', 'vector-store']);
const TRUST_ZONES = Object.freeze(['local', 'private-network', 'external']);
const PAYLOAD_CLASSIFICATIONS = Object.freeze([
  'public-metadata',
  'project-metadata',
  'source-code',
  'database-metadata',
  'runtime-evidence',
  'secret',
  'personal-data',
]);
const LIFECYCLE_STATES = Object.freeze(['declared', 'validating', 'registered', 'rejected']);
const HEALTH_STATES = Object.freeze(['unknown', 'healthy', 'degraded', 'unhealthy']);
const AVAILABILITY_STATES = Object.freeze(['unknown', 'available', 'degraded', 'unavailable']);

const CONTRACTS = Object.freeze({
  MODEL_DESCRIPTOR: 'zeus.model-provider-descriptor',
  EMBEDDING_DESCRIPTOR: 'zeus.embedding-provider-descriptor',
  VECTOR_STORE_DESCRIPTOR: 'zeus.vector-store-provider-descriptor',
  MODEL_REQUEST: 'zeus.model-provider-request',
  MODEL_RESPONSE: 'zeus.model-provider-response',
  EMBEDDING_REQUEST: 'zeus.embedding-provider-request',
  EMBEDDING_RESPONSE: 'zeus.embedding-provider-response',
  VECTOR_STORE_REQUEST: 'zeus.vector-store-provider-request',
  VECTOR_STORE_RESPONSE: 'zeus.vector-store-provider-response',
  PROVIDER_STATUS: 'zeus.provider-status',
  EGRESS_POLICY: 'zeus.egress-policy',
  POLICY_DENIAL: 'zeus.provider-policy-denial',
  CONFIG_PROVENANCE: 'zeus.provider-config-provenance',
});

const KIND_CONTRACTS = Object.freeze({
  model: Object.freeze({
    descriptor: CONTRACTS.MODEL_DESCRIPTOR,
    request: CONTRACTS.MODEL_REQUEST,
    response: CONTRACTS.MODEL_RESPONSE,
  }),
  embedding: Object.freeze({
    descriptor: CONTRACTS.EMBEDDING_DESCRIPTOR,
    request: CONTRACTS.EMBEDDING_REQUEST,
    response: CONTRACTS.EMBEDDING_RESPONSE,
  }),
  'vector-store': Object.freeze({
    descriptor: CONTRACTS.VECTOR_STORE_DESCRIPTOR,
    request: CONTRACTS.VECTOR_STORE_REQUEST,
    response: CONTRACTS.VECTOR_STORE_RESPONSE,
  }),
});

const DATA_LIMITS = Object.freeze({
  maxDepth: 12,
  maxKeys: 256,
  maxItems: 512,
  maxStringBytes: 64 * 1024,
  maxTotalBytes: 256 * 1024,
  maxEvidenceReferences: 64,
  maxCapabilities: 64,
  maxOutputBytes: 128 * 1024,
});

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

function contractRef(id) {
  return `${id}@${CONTRACT_VERSION}`;
}

function descriptorRef(id) {
  return `${id}/v${CONTRACT_VERSION}`;
}

function error(path, message) {
  return { path, message };
}

/**
 * Reject values that could execute code, mutate prototypes, evade field reads,
 * or exhaust an in-process provider boundary. Error text never includes values.
 */
function validatePlainData(value, options = {}) {
  const limits = { ...DATA_LIMITS, ...options };
  const errors = [];
  const active = new WeakSet();
  let keyCount = 0;
  let estimatedBytes = 0;

  function visit(current, path, depth) {
    if (errors.length >= 20) return;
    if (depth > limits.maxDepth) {
      errors.push(error(path, 'maximum nesting depth exceeded'));
      return;
    }
    if (current === null || typeof current === 'boolean') return;
    if (typeof current === 'string') {
      const size = Buffer.byteLength(current, 'utf8');
      estimatedBytes += size;
      if (size > limits.maxStringBytes) errors.push(error(path, 'string size limit exceeded'));
      return;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) errors.push(error(path, 'number must be finite'));
      return;
    }
    if (typeof current !== 'object') {
      errors.push(error(path, 'value must be JSON-compatible data'));
      return;
    }
    if (active.has(current)) {
      errors.push(error(path, 'cyclic data is not allowed'));
      return;
    }
    const prototype = Object.getPrototypeOf(current);
    if (Array.isArray(current)) {
      if (prototype !== Array.prototype) {
        errors.push(error(path, 'exotic array prototypes are not allowed'));
        return;
      }
    } else if (prototype !== Object.prototype && prototype !== null) {
      errors.push(error(path, 'exotic object prototypes are not allowed'));
      return;
    }
    const keys = Reflect.ownKeys(current);
    if (keys.some(key => typeof key === 'symbol')) {
      errors.push(error(path, 'symbol properties are not allowed'));
      return;
    }
    if (Array.isArray(current) && current.length > limits.maxItems) {
      errors.push(error(path, 'array item limit exceeded'));
      return;
    }
    keyCount += keys.length;
    if (keyCount > limits.maxKeys) {
      errors.push(error(path, 'object key limit exceeded'));
      return;
    }
    active.add(current);
    for (const key of keys) {
      if (typeof key !== 'string') continue;
      if (DANGEROUS_KEYS.has(key)) {
        errors.push(error(path, 'dangerous property name is not allowed'));
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || descriptor.get || descriptor.set) {
        errors.push(error(path, 'accessor properties are not allowed'));
        continue;
      }
      visit(descriptor.value, `${path}/${String(key)}`, depth + 1);
    }
    active.delete(current);
  }

  try {
    visit(value, '', 0);
  } catch {
    return [error('', 'input cannot be safely inspected')];
  }
  if (estimatedBytes > limits.maxTotalBytes) {
    errors.push(error('', 'total data size limit exceeded'));
  }
  return errors;
}

function clonePlainData(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clonePlainData);
  const result = Object.create(null);
  for (const key of Object.keys(value)) result[key] = clonePlainData(value[key]);
  return result;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

function validateHeader(value, id) {
  const errors = validatePlainData(value);
  if (errors.length) return errors;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(error('', 'expected an object'));
    return errors;
  }
  if (value.schemaVersion !== CONTRACT_VERSION) {
    errors.push(error('/schemaVersion', 'schemaVersion must be 1'));
  }
  if (value.contract !== contractRef(id)) {
    errors.push(error('/contract', `contract must be ${contractRef(id)}`));
  }
  return errors;
}

function requireIdentifier(errors, value, path) {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    errors.push(error(path, 'identifier is required and must use safe characters'));
  }
}

function validateStringArray(errors, value, path, maxItems = DATA_LIMITS.maxCapabilities) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    errors.push(error(path, 'a non-empty bounded string array is required'));
    return;
  }
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item !== 'string' || !IDENTIFIER_PATTERN.test(item)) {
      errors.push(error(`${path}/${index}`, 'safe identifier is required'));
    } else if (seen.has(item)) {
      errors.push(error(`${path}/${index}`, 'duplicate value is not allowed'));
    }
    seen.add(item);
  }
}

function validateDescriptor(kind, value) {
  const id = KIND_CONTRACTS[kind].descriptor;
  const errors = validateHeader(value, id);
  if (errors.length || !value || typeof value !== 'object' || Array.isArray(value)) return errors;
  if (value.descriptorVersion !== descriptorRef(id)) {
    errors.push(error('/descriptorVersion', `descriptorVersion must be ${descriptorRef(id)}`));
  }
  if (value.kind !== kind) errors.push(error('/kind', `kind must be ${kind}`));
  requireIdentifier(errors, value.id, '/id');
  if (!TRUST_ZONES.includes(value.trustZone)) {
    errors.push(error('/trustZone', 'unknown trust zone'));
  }
  validateStringArray(errors, value.capabilities, '/capabilities');
  if (
    typeof value.displayName !== 'string' ||
    !value.displayName.trim() ||
    Buffer.byteLength(value.displayName, 'utf8') > 160
  ) {
    errors.push(error('/displayName', 'displayName is required'));
  }
  if (kind === 'model' || kind === 'embedding') {
    validateStringArray(errors, value.models, '/models');
  }
  if (kind === 'embedding' || kind === 'vector-store') {
    if (!Number.isInteger(value.dimension) || value.dimension < 1 || value.dimension > 4096) {
      errors.push(error('/dimension', 'dimension must be an integer between 1 and 4096'));
    }
  }
  if (kind === 'vector-store') {
    if (!Number.isInteger(value.maxEntries) || value.maxEntries < 1 || value.maxEntries > 10000) {
      errors.push(error('/maxEntries', 'maxEntries must be an integer between 1 and 10000'));
    }
  }
  return errors;
}

function validateEvidenceReferences(errors, references, path = '/evidenceReferences') {
  if (!Array.isArray(references) || references.length > DATA_LIMITS.maxEvidenceReferences) {
    errors.push(error(path, 'evidenceReferences must be a bounded array'));
    return;
  }
  for (let index = 0; index < references.length; index += 1) {
    const reference = references[index];
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
      errors.push(error(`${path}/${index}`, 'evidence reference must be an object'));
      continue;
    }
    requireIdentifier(errors, reference.id, `${path}/${index}/id`);
    if (
      typeof reference.contract !== 'string' ||
      !/^[a-z0-9][a-z0-9._-]{0,127}@[1-9][0-9]{0,5}$/.test(reference.contract)
    ) {
      errors.push(error(`${path}/${index}/contract`, 'evidence contract reference is required'));
    }
  }
}

function containsNestedClassification(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsNestedClassification);
  return Object.keys(value).some(
    key => key === 'classification' || containsNestedClassification(value[key])
  );
}

function validateHomogeneousInput(errors, input, classification) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    errors.push(error('/input', 'input must be one homogeneous classified payload'));
    return;
  }
  const keys = Object.keys(input);
  if (
    keys.some(key => !['classification', 'content'].includes(key)) ||
    !keys.includes('classification') ||
    !keys.includes('content')
  ) {
    errors.push(error('/input', 'input must contain only classification and content'));
    return;
  }
  if (input.classification !== classification) {
    errors.push(error('/input/classification', 'input classification must match the request'));
  }
  if (containsNestedClassification(input.content)) {
    errors.push(
      error('/input/content', 'nested classifications require separate provider requests')
    );
  }
}

function validateRequest(kind, value) {
  const id = KIND_CONTRACTS[kind].request;
  const errors = validateHeader(value, id);
  if (errors.length || !value || typeof value !== 'object' || Array.isArray(value)) return errors;
  requireIdentifier(errors, value.providerId, '/providerId');
  requireIdentifier(errors, value.correlationId, '/correlationId');
  if (!PAYLOAD_CLASSIFICATIONS.includes(value.classification)) {
    errors.push(error('/classification', 'unknown or missing payload classification'));
  }
  validateEvidenceReferences(errors, value.evidenceReferences);
  if (!Object.prototype.hasOwnProperty.call(value, 'input'))
    errors.push(error('/input', 'input is required'));
  else validateHomogeneousInput(errors, value.input, value.classification);
  if (kind === 'model' || kind === 'embedding')
    requireIdentifier(errors, value.modelId, '/modelId');
  if (kind === 'vector-store') {
    if (!['upsert', 'query', 'delete', 'clear'].includes(value.operation)) {
      errors.push(error('/operation', 'unknown vector-store operation'));
    }
  }
  if (
    value.maxOutputBytes !== undefined &&
    (!Number.isInteger(value.maxOutputBytes) ||
      value.maxOutputBytes < 1 ||
      value.maxOutputBytes > DATA_LIMITS.maxOutputBytes)
  ) {
    errors.push(error('/maxOutputBytes', 'maxOutputBytes is outside the supported bound'));
  }
  return errors;
}

function validateUsage(errors, usage) {
  if (usage === undefined) return;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    errors.push(error('/usage', 'usage must be an object'));
    return;
  }
  for (const key of ['inputUnits', 'outputUnits', 'totalUnits']) {
    if (usage[key] !== undefined && (!Number.isInteger(usage[key]) || usage[key] < 0)) {
      errors.push(error(`/usage/${key}`, 'usage values must be non-negative integers'));
    }
  }
}

function validateResponse(kind, value) {
  const id = KIND_CONTRACTS[kind].response;
  const errors = validateHeader(value, id);
  if (errors.length || !value || typeof value !== 'object' || Array.isArray(value)) return errors;
  requireIdentifier(errors, value.providerId, '/providerId');
  requireIdentifier(errors, value.correlationId, '/correlationId');
  if (kind === 'model' || kind === 'embedding')
    requireIdentifier(errors, value.modelId, '/modelId');
  if (value.advisory !== true) errors.push(error('/advisory', 'provider output must be advisory'));
  if (value.sourceOfTruth !== false) {
    errors.push(error('/sourceOfTruth', 'provider output cannot be a source of truth'));
  }
  validateEvidenceReferences(errors, value.evidenceReferences);
  if (!Object.prototype.hasOwnProperty.call(value, 'output')) {
    errors.push(error('/output', 'structured output is required'));
  }
  validateUsage(errors, value.usage);
  return errors;
}

function validateProviderStatus(value) {
  const errors = validateHeader(value, CONTRACTS.PROVIDER_STATUS);
  if (errors.length || !value || typeof value !== 'object' || Array.isArray(value)) return errors;
  requireIdentifier(errors, value.providerId, '/providerId');
  if (!PROVIDER_KINDS.includes(value.providerKind))
    errors.push(error('/providerKind', 'unknown provider kind'));
  if (!LIFECYCLE_STATES.includes(value.lifecycle))
    errors.push(error('/lifecycle', 'unknown lifecycle state'));
  if (!HEALTH_STATES.includes(value.health)) errors.push(error('/health', 'unknown health state'));
  if (!AVAILABILITY_STATES.includes(value.availability)) {
    errors.push(error('/availability', 'unknown availability state'));
  }
  if (typeof value.reasonCode !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value.reasonCode)) {
    errors.push(error('/reasonCode', 'bounded reasonCode is required'));
  }
  return errors;
}

function validateEgressPolicy(value) {
  const errors = validateHeader(value, CONTRACTS.EGRESS_POLICY);
  if (errors.length || !value || typeof value !== 'object' || Array.isArray(value)) return errors;
  if (!Array.isArray(value.rules) || value.rules.length > 64) {
    errors.push(error('/rules', 'rules must be a bounded array'));
    return errors;
  }
  const seen = new Set();
  value.rules.forEach((rule, index) => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      errors.push(error(`/rules/${index}`, 'rule must be an object'));
      return;
    }
    if (!PAYLOAD_CLASSIFICATIONS.includes(rule.classification)) {
      errors.push(error(`/rules/${index}/classification`, 'unknown payload classification'));
    }
    if (!TRUST_ZONES.includes(rule.trustZone)) {
      errors.push(error(`/rules/${index}/trustZone`, 'unknown trust zone'));
    }
    if (rule.allow !== true) errors.push(error(`/rules/${index}/allow`, 'allow must be true'));
    const key = `${rule.classification}:${rule.trustZone}`;
    if (seen.has(key)) errors.push(error(`/rules/${index}`, 'duplicate policy rule'));
    seen.add(key);
  });
  return errors;
}

function validatePolicyDenial(value) {
  const errors = validateHeader(value, CONTRACTS.POLICY_DENIAL);
  if (errors.length || !value || typeof value !== 'object' || Array.isArray(value)) return errors;
  requireIdentifier(errors, value.providerId, '/providerId');
  requireIdentifier(errors, value.correlationId, '/correlationId');
  if (typeof value.reasonCode !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value.reasonCode)) {
    errors.push(error('/reasonCode', 'bounded reasonCode is required'));
  }
  if (typeof value.message !== 'string' || value.message.length > 160) {
    errors.push(error('/message', 'bounded denial message is required'));
  }
  if (
    value.classification !== undefined &&
    !PAYLOAD_CLASSIFICATIONS.includes(value.classification)
  ) {
    errors.push(error('/classification', 'unknown payload classification'));
  }
  if (value.trustZone !== undefined && !TRUST_ZONES.includes(value.trustZone)) {
    errors.push(error('/trustZone', 'unknown trust zone'));
  }
  return errors;
}

function validateConfigProvenance(value) {
  const errors = validateHeader(value, CONTRACTS.CONFIG_PROVENANCE);
  if (errors.length || !value || typeof value !== 'object' || Array.isArray(value)) return errors;
  if (!['api', 'environment', 'file', 'default', 'test'].includes(value.sourceKind)) {
    errors.push(error('/sourceKind', 'unknown configuration source kind'));
  }
  if (
    typeof value.sourceReference !== 'string' ||
    !/^[a-z0-9._-]{1,64}$/.test(value.sourceReference)
  ) {
    errors.push(error('/sourceReference', 'safe source reference is required'));
  }
  if (!Array.isArray(value.configuredKeys) || value.configuredKeys.length > 64) {
    errors.push(error('/configuredKeys', 'configuredKeys must be a bounded array'));
  } else {
    for (let index = 0; index < value.configuredKeys.length; index += 1) {
      if (!/^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/.test(value.configuredKeys[index])) {
        errors.push(error(`/configuredKeys/${index}`, 'safe configuration key name is required'));
      }
    }
  }
  if (value.redaction !== 'values-omitted') {
    errors.push(error('/redaction', 'redaction must be values-omitted'));
  }
  return errors;
}

const PROVIDER_SCHEMAS = Object.freeze({
  [CONTRACTS.MODEL_DESCRIPTOR]: { version: 1, schema: value => validateDescriptor('model', value) },
  [CONTRACTS.EMBEDDING_DESCRIPTOR]: {
    version: 1,
    schema: value => validateDescriptor('embedding', value),
  },
  [CONTRACTS.VECTOR_STORE_DESCRIPTOR]: {
    version: 1,
    schema: value => validateDescriptor('vector-store', value),
  },
  [CONTRACTS.MODEL_REQUEST]: { version: 1, schema: value => validateRequest('model', value) },
  [CONTRACTS.MODEL_RESPONSE]: { version: 1, schema: value => validateResponse('model', value) },
  [CONTRACTS.EMBEDDING_REQUEST]: {
    version: 1,
    schema: value => validateRequest('embedding', value),
  },
  [CONTRACTS.EMBEDDING_RESPONSE]: {
    version: 1,
    schema: value => validateResponse('embedding', value),
  },
  [CONTRACTS.VECTOR_STORE_REQUEST]: {
    version: 1,
    schema: value => validateRequest('vector-store', value),
  },
  [CONTRACTS.VECTOR_STORE_RESPONSE]: {
    version: 1,
    schema: value => validateResponse('vector-store', value),
  },
  [CONTRACTS.PROVIDER_STATUS]: { version: 1, schema: validateProviderStatus },
  [CONTRACTS.EGRESS_POLICY]: { version: 1, schema: validateEgressPolicy },
  [CONTRACTS.POLICY_DENIAL]: { version: 1, schema: validatePolicyDenial },
  [CONTRACTS.CONFIG_PROVENANCE]: { version: 1, schema: validateConfigProvenance },
});

function normalizeEvidenceReferences(references) {
  return references.map(reference =>
    deepFreeze({ id: reference.id, contract: reference.contract })
  );
}

function normalizeDescriptor(kind, value) {
  const errors = validateDescriptor(kind, value);
  if (errors.length) return { ok: false, errors };
  const normalized = {
    schemaVersion: 1,
    contract: contractRef(KIND_CONTRACTS[kind].descriptor),
    descriptorVersion: descriptorRef(KIND_CONTRACTS[kind].descriptor),
    kind,
    id: value.id,
    displayName: value.displayName.trim(),
    trustZone: value.trustZone,
    capabilities: [...value.capabilities].sort(),
  };
  if (kind === 'model' || kind === 'embedding') normalized.models = [...value.models].sort();
  if (kind === 'embedding' || kind === 'vector-store') normalized.dimension = value.dimension;
  if (kind === 'vector-store') normalized.maxEntries = value.maxEntries;
  return { ok: true, value: deepFreeze(normalized) };
}

function normalizeRequest(kind, value) {
  const errors = validateRequest(kind, value);
  if (errors.length) return { ok: false, errors };
  const normalized = {
    schemaVersion: 1,
    contract: contractRef(KIND_CONTRACTS[kind].request),
    providerId: value.providerId,
    correlationId: value.correlationId,
    classification: value.classification,
    evidenceReferences: normalizeEvidenceReferences(value.evidenceReferences),
    input: {
      classification: value.classification,
      content: clonePlainData(value.input.content),
    },
  };
  if (kind === 'model' || kind === 'embedding') normalized.modelId = value.modelId;
  if (kind === 'vector-store') normalized.operation = value.operation;
  if (value.maxOutputBytes !== undefined) normalized.maxOutputBytes = value.maxOutputBytes;
  return { ok: true, value: deepFreeze(normalized) };
}

module.exports = {
  CONTRACT_VERSION,
  CONTRACTS,
  KIND_CONTRACTS,
  PROVIDER_KINDS,
  TRUST_ZONES,
  PAYLOAD_CLASSIFICATIONS,
  LIFECYCLE_STATES,
  HEALTH_STATES,
  AVAILABILITY_STATES,
  DATA_LIMITS,
  PROVIDER_SCHEMAS,
  contractRef,
  descriptorRef,
  validatePlainData,
  validateDescriptor,
  validateRequest,
  validateResponse,
  validateProviderStatus,
  validateEgressPolicy,
  validatePolicyDenial,
  validateConfigProvenance,
  normalizeDescriptor,
  normalizeRequest,
  normalizeEvidenceReferences,
  clonePlainData,
  deepFreeze,
};
