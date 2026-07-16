'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CONTRACTS,
  KIND_CONTRACTS,
  PAYLOAD_CLASSIFICATIONS,
  TRUST_ZONES,
  PROVIDER_SCHEMAS,
  contractRef,
  descriptorRef,
  validateDescriptor,
  validatePlainData,
  validatePolicyDenial,
  validateProviderStatus,
} = require('../src/providers/contracts');
const {
  createEgressPolicy,
  createPolicyDenial,
  evaluateEgressPolicy,
} = require('../src/providers/egressPolicy');
const { createConfigProvenance } = require('../src/providers/redaction');
const { createProviderRegistry } = require('../src/providers/providerRegistry');
const { createMockModelProvider } = require('../src/providers/testing');
const { createSchemaRegistry } = require('../src/core/contracts');
const { INITIAL_SCHEMAS } = require('../src/core/contracts/schemas');
const CORE_CONTRACT_IDS = require('../src/core/contracts/contractIds');
const { createZeus, providers: singletonProviders } = require('../src/api/zeusApi');

function descriptor(kind, id = `test.${kind}`) {
  const descriptorContract = KIND_CONTRACTS[kind].descriptor;
  const result = {
    schemaVersion: 1,
    contract: contractRef(descriptorContract),
    descriptorVersion: descriptorRef(descriptorContract),
    kind,
    id,
    displayName: `Test ${kind}`,
    trustZone: 'local',
    capabilities: ['offline-test'],
  };
  if (kind === 'model' || kind === 'embedding') result.models = ['test-v1'];
  if (kind === 'embedding' || kind === 'vector-store') result.dimension = 4;
  if (kind === 'vector-store') result.maxEntries = 8;
  return result;
}

function requestFor(providerId, overrides = {}) {
  const { input = { prompt: 'offline input' }, ...rest } = overrides;
  const classification = rest.classification || 'public-metadata';
  return {
    schemaVersion: 1,
    contract: contractRef(CONTRACTS.MODEL_REQUEST),
    providerId,
    modelId: 'test-v1',
    correlationId: 'request-1',
    classification,
    evidenceReferences: [{ id: 'evidence-1', contract: 'zeus.evidence-model@1' }],
    input: { classification, content: input },
    ...rest,
  };
}

function responseFor(request, overrides = {}) {
  return {
    schemaVersion: 1,
    contract: contractRef(CONTRACTS.MODEL_RESPONSE),
    providerId: request.providerId,
    modelId: request.modelId,
    correlationId: request.correlationId,
    advisory: true,
    sourceOfTruth: false,
    evidenceReferences: request.evidenceReferences,
    output: { value: 'advisory-only' },
    usage: { inputUnits: 1, outputUnits: 1, totalUnits: 2 },
    ...overrides,
  };
}

function allow(classification = 'public-metadata', trustZone = 'local') {
  return createEgressPolicy([{ classification, trustZone, allow: true }]);
}

test('all provider contracts are versioned and registered in the core schema registry', () => {
  assert.equal(Object.keys(PROVIDER_SCHEMAS).length, 13);
  const registry = createSchemaRegistry();
  for (const [id, definition] of Object.entries(INITIAL_SCHEMAS)) {
    registry.register({ id, version: definition.version, schema: definition.schema });
  }
  for (const id of Object.values(CONTRACTS)) assert.equal(registry.hasContract(id, 1), true, id);
  for (const id of Object.values(CONTRACTS)) {
    assert.ok(Object.values(CORE_CONTRACT_IDS).includes(id), `missing core contract ID: ${id}`);
  }
});

test('model, embedding, and vector-store descriptors validate required fields and versions', () => {
  for (const kind of ['model', 'embedding', 'vector-store']) {
    assert.deepEqual(validateDescriptor(kind, descriptor(kind)), []);
    assert.ok(validateDescriptor(kind, { ...descriptor(kind), schemaVersion: 2 }).length > 0);
    const missing = { ...descriptor(kind) };
    delete missing.trustZone;
    assert.ok(validateDescriptor(kind, missing).some(item => item.path === '/trustZone'));
  }
});

test('unknown additive descriptor fields are inert and do not enter public registry records', () => {
  const registry = createProviderRegistry();
  const raw = { ...descriptor('model'), futureField: { harmless: true } };
  const record = registry.register({ descriptor: raw, invoke: async () => ({}) });
  assert.equal(record.descriptor.futureField, undefined);
  assert.equal(Object.isFrozen(record.descriptor), true);
});

test('registry uses one global provider ID space and rejects incompatible or duplicate descriptors atomically', () => {
  const registry = createProviderRegistry();
  registry.register({ descriptor: descriptor('model', 'test.shared'), invoke: async () => ({}) });
  assert.throws(
    () =>
      registry.register({
        descriptor: descriptor('embedding', 'test.shared'),
        invoke: async () => ({}),
      }),
    error => error.code === 'DUPLICATE_PROVIDER_ID'
  );
  const incompatible = { ...descriptor('embedding', 'test.incompatible'), schemaVersion: 2 };
  assert.throws(
    () => registry.register({ descriptor: incompatible, invoke: async () => ({}) }),
    error => error.code === 'PROVIDER_DESCRIPTOR_INVALID'
  );
  assert.equal(registry.size(), 1);
});

test('registry listing is deterministic by kind then ID and seal prevents late registration', () => {
  const registry = createProviderRegistry();
  registry.register({ descriptor: descriptor('vector-store', 'test.z'), invoke: async () => ({}) });
  registry.register({ descriptor: descriptor('model', 'test.b'), invoke: async () => ({}) });
  registry.register({ descriptor: descriptor('embedding', 'test.e-a'), invoke: async () => ({}) });
  registry.register({ descriptor: descriptor('model', 'test.m-a'), invoke: async () => ({}) });
  assert.deepEqual(
    registry.list().map(record => `${record.descriptor.kind}:${record.descriptor.id}`),
    ['embedding:test.e-a', 'model:test.b', 'model:test.m-a', 'vector-store:test.z']
  );
  registry.seal();
  assert.equal(registry.isSealed(), true);
  assert.throws(
    () =>
      registry.register({ descriptor: descriptor('model', 'test.late'), invoke: async () => ({}) }),
    error => error.code === 'PROVIDER_REGISTRY_SEALED'
  );
});

test('registry exposes passive lifecycle, health, and availability without a probe', () => {
  const registry = createProviderRegistry();
  const record = registry.register({ descriptor: descriptor('model'), invoke: async () => ({}) });
  assert.deepEqual(
    {
      lifecycle: record.status.lifecycle,
      health: record.status.health,
      availability: record.status.availability,
      reasonCode: record.status.reasonCode,
    },
    {
      lifecycle: 'registered',
      health: 'unknown',
      availability: 'unknown',
      reasonCode: 'NOT_PROBED',
    }
  );
  assert.equal(Object.isFrozen(record.status), true);
  assert.equal(record.invoke, undefined);
});

test('provider lifecycle v1 follows declared, validating, registered, and rejected states', () => {
  const base = {
    schemaVersion: 1,
    contract: contractRef(CONTRACTS.PROVIDER_STATUS),
    providerId: 'test.lifecycle',
    providerKind: 'model',
    health: 'unknown',
    availability: 'unknown',
    reasonCode: 'NOT_PROBED',
  };
  for (const lifecycle of ['declared', 'validating', 'registered', 'rejected']) {
    assert.deepEqual(validateProviderStatus({ ...base, lifecycle }), []);
  }
  for (const lifecycle of ['ready', 'stopped', 'failed']) {
    assert.ok(
      validateProviderStatus({ ...base, lifecycle }).some(item => item.path === '/lifecycle')
    );
  }
});

test('createZeus instances own isolated empty provider registries', () => {
  const first = createZeus();
  const second = createZeus();
  assert.notEqual(first.providers, second.providers);
  assert.notEqual(first.providers.registry, second.providers.registry);
  assert.notEqual(first.providers.registry, singletonProviders.registry);
  assert.equal(first.providers.registry.size(), 0);
  assert.equal(second.providers.registry.size(), 0);
  assert.equal(singletonProviders.registry.size(), 0);
  first.providers.registry.register({
    descriptor: descriptor('model', 'test.instance-only'),
    invoke: async () => ({}),
  });
  assert.equal(first.providers.registry.size(), 1);
  assert.equal(second.providers.registry.size(), 0);
  assert.equal(singletonProviders.registry.size(), 0);
});

test('registry defensively copies descriptors and redacted configuration provenance', () => {
  const raw = descriptor('model');
  const provenance = createConfigProvenance({
    sourceKind: 'environment',
    sourceReference: 'provider-env',
    configuredKeys: ['apiToken', 'endpoint', 'apiToken'],
  });
  const registry = createProviderRegistry();
  registry.register({ descriptor: raw, invoke: async () => ({}), configProvenance: provenance });
  raw.capabilities.push('mutated');
  const record = registry.get(raw.id);
  assert.deepEqual(record.descriptor.capabilities, ['offline-test']);
  assert.deepEqual(record.configProvenance.configuredKeys, ['apiToken', 'endpoint']);
  assert.doesNotMatch(JSON.stringify(record), /https?:|password-value|\/home\//);
  assert.equal(record.configProvenance.value, undefined);
});

test('redacted provenance rejects paths and accepts names without values', () => {
  assert.throws(
    () =>
      createConfigProvenance({
        sourceKind: 'file',
        sourceReference: '/home/user/provider.json',
        configuredKeys: ['token'],
      }),
    error => error.code === 'PROVIDER_CONFIG_PROVENANCE_INVALID'
  );
  const provenance = createConfigProvenance({
    sourceKind: 'api',
    sourceReference: 'trusted-registration',
    configuredKeys: ['modelId'],
  });
  assert.equal(provenance.redaction, 'values-omitted');
});

test('all payload classifications and trust zones require exact explicit allow rules', () => {
  for (const classification of PAYLOAD_CLASSIFICATIONS.filter(value => value !== 'secret')) {
    for (const trustZone of TRUST_ZONES) {
      const decision = evaluateEgressPolicy({
        providerId: 'test.policy',
        correlationId: 'policy-1',
        classification,
        trustZone,
        policy: allow(classification, trustZone),
      });
      assert.equal(decision.allowed, true, `${classification}:${trustZone}`);
    }
  }
});

test('missing classification, unknown classification, and missing policy fail closed', () => {
  const base = { providerId: 'test.policy', correlationId: 'policy-2', trustZone: 'local' };
  const missing = evaluateEgressPolicy({ ...base, policy: allow() }).denial;
  assert.equal(missing.reasonCode, 'CLASSIFICATION_REQUIRED');
  assert.equal(missing.classification, undefined);
  assert.equal(missing.trustZone, 'local');
  const unknown = evaluateEgressPolicy({
    ...base,
    classification: 'unknown-private-value',
    policy: allow(),
  }).denial;
  assert.equal(unknown.reasonCode, 'CLASSIFICATION_UNKNOWN');
  assert.equal(unknown.classification, undefined);
  assert.equal(unknown.trustZone, 'local');
  assert.doesNotMatch(JSON.stringify(unknown), /unknown-private-value/);
  const noPolicy = evaluateEgressPolicy({ ...base, classification: 'public-metadata' }).denial;
  assert.equal(noPolicy.reasonCode, 'POLICY_REQUIRED');
  assert.equal(noPolicy.classification, 'public-metadata');
  assert.equal(noPolicy.trustZone, 'local');

  const hostile = {};
  Object.defineProperty(hostile, 'classification', {
    get() {
      throw new Error('hostile-policy-accessor');
    },
  });
  const hostileDecision = evaluateEgressPolicy(hostile);
  assert.equal(hostileDecision.denial.reasonCode, 'POLICY_INVALID');
  assert.doesNotMatch(JSON.stringify(hostileDecision), /hostile-policy-accessor/);

  const hostileZone = evaluateEgressPolicy({
    providerId: 'test.policy',
    correlationId: 'policy-zone',
    classification: 'source-code',
    trustZone: 'private-zone-value',
    policy: allow('source-code', 'local'),
  }).denial;
  assert.equal(hostileZone.reasonCode, 'TRUST_ZONE_UNKNOWN');
  assert.equal(hostileZone.classification, 'source-code');
  assert.equal(hostileZone.trustZone, undefined);
  assert.doesNotMatch(JSON.stringify(hostileZone), /private-zone-value/);
  assert.throws(
    () => createEgressPolicy([null]),
    error => error.code === 'PROVIDER_POLICY_INVALID' && !/TypeError/.test(error.name)
  );
});

test('secret is always denied before policy evaluation in every trust zone', () => {
  for (const trustZone of TRUST_ZONES) {
    const malformedPolicy = { rules: [{ classification: 'secret', trustZone, allow: true }] };
    const decision = evaluateEgressPolicy({
      providerId: 'test.policy',
      correlationId: 'policy-secret',
      classification: 'secret',
      trustZone,
      policy: malformedPolicy,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.denial.reasonCode, 'SECRET_TRANSMISSION_FORBIDDEN');
    assert.equal(decision.denial.classification, 'secret');
    assert.equal(decision.denial.trustZone, trustZone);
  }
});

test('sensitive payloads require an exact class and target-zone rule, including local', () => {
  for (const classification of [
    'source-code',
    'database-metadata',
    'runtime-evidence',
    'personal-data',
  ]) {
    const wrongZone = evaluateEgressPolicy({
      providerId: 'test.policy',
      correlationId: 'policy-sensitive',
      classification,
      trustZone: 'external',
      policy: allow(classification, 'local'),
    });
    assert.equal(wrongZone.denial.reasonCode, 'POLICY_RULE_REQUIRED');
    assert.equal(wrongZone.denial.classification, classification);
    assert.equal(wrongZone.denial.trustZone, 'external');
    const localMissing = evaluateEgressPolicy({
      providerId: 'test.policy',
      correlationId: 'policy-sensitive',
      classification,
      trustZone: 'local',
      policy: createEgressPolicy([]),
    });
    assert.equal(localMissing.denial.reasonCode, 'POLICY_RULE_REQUIRED');
  }
});

test('policy denial is fixed, bounded, and never echoes blocked content', () => {
  const blocked = 'TOP-SECRET source text and https://private.example/customer';
  const denial = createPolicyDenial({
    providerId: 'test.policy',
    correlationId: 'denial-1',
    reasonCode: 'POLICY_RULE_REQUIRED',
    classification: 'source-code',
    trustZone: 'external',
    blocked,
  });
  const serialized = JSON.stringify(denial);
  assert.doesNotMatch(serialized, /TOP-SECRET|private\.example|customer/);
  assert.equal(denial.blocked, undefined);
  assert.equal(denial.classification, 'source-code');
  assert.equal(denial.trustZone, 'external');
  assert.ok(denial.message.length <= 160);
  assert.deepEqual(validatePolicyDenial(denial), []);
  assert.ok(
    validatePolicyDenial({ ...denial, classification: 'unrecognized' }).some(
      item => item.path === '/classification'
    )
  );

  const hostileIdentity = createPolicyDenial({
    providerId: blocked,
    correlationId: blocked,
    reasonCode: 'POLICY_RULE_REQUIRED',
  });
  assert.equal(hostileIdentity.providerId, 'invalid-provider');
  assert.equal(hostileIdentity.correlationId, 'invalid-request');
  assert.doesNotMatch(JSON.stringify(hostileIdentity), /TOP-SECRET|private\.example/);
});

test('blocked requests never invoke the provider handler', async () => {
  let calls = 0;
  const registry = createProviderRegistry();
  registry.register({
    descriptor: descriptor('model'),
    invoke: async (_context, request) => {
      calls += 1;
      return responseFor(request);
    },
  });
  const result = await registry.invoke('test.model', requestFor('test.model'), {
    policy: createEgressPolicy([]),
  });
  assert.equal(result.ok, false);
  assert.equal(result.denial.reasonCode, 'POLICY_RULE_REQUIRED');
  assert.equal(calls, 0);
});

test('malformed or throwing policy input fails closed before provider invocation', async () => {
  let calls = 0;
  const registry = createProviderRegistry();
  registry.register({
    descriptor: descriptor('model'),
    invoke: async (_context, request) => {
      calls += 1;
      return responseFor(request);
    },
  });
  const malformedPolicy = {};
  Object.defineProperty(malformedPolicy, 'rules', {
    get() {
      throw new Error('private-policy-detail');
    },
  });
  const result = await registry.invoke('test.model', requestFor('test.model'), {
    policy: malformedPolicy,
  });
  assert.equal(result.denial.reasonCode, 'POLICY_INVALID');
  assert.equal(result.denial.classification, 'public-metadata');
  assert.equal(result.denial.trustZone, 'local');
  assert.doesNotMatch(JSON.stringify(result), /private-policy-detail/);
  assert.equal(calls, 0);
});

test('invocation option accessors and fake or decorated signals fail before handler invocation', async () => {
  let calls = 0;
  const registry = createProviderRegistry();
  registry.register({
    descriptor: descriptor('model'),
    invoke: async (_context, request) => {
      calls += 1;
      return responseFor(request);
    },
  });
  const allowedPolicy = allow();
  const timeoutAccessor = { policy: allowedPolicy };
  Object.defineProperty(timeoutAccessor, 'timeoutMs', {
    get() {
      throw new Error('private-timeout-detail');
    },
  });
  const signalAccessor = { policy: allowedPolicy };
  Object.defineProperty(signalAccessor, 'signal', {
    get() {
      throw new Error('private-signal-detail');
    },
  });
  const fakeSignal = {};
  Object.defineProperty(fakeSignal, 'aborted', {
    get() {
      throw new Error('private-aborted-detail');
    },
  });
  const addListenerSignal = new AbortController().signal;
  Object.defineProperty(addListenerSignal, 'addEventListener', {
    get() {
      throw new Error('private-listener-detail');
    },
  });
  const abortedSignal = new AbortController().signal;
  Object.defineProperty(abortedSignal, 'aborted', {
    get() {
      throw new Error('private-aborted-detail');
    },
  });
  const removeListenerSignal = new AbortController().signal;
  Object.defineProperty(removeListenerSignal, 'removeEventListener', {
    get() {
      throw new Error('private-remove-listener-detail');
    },
  });
  for (const options of [
    timeoutAccessor,
    signalAccessor,
    { policy: allowedPolicy, signal: fakeSignal },
    { policy: allowedPolicy, signal: addListenerSignal },
    { policy: allowedPolicy, signal: abortedSignal },
    { policy: allowedPolicy, signal: removeListenerSignal },
    { policy: allowedPolicy, timeoutMs: '5' },
    { policy: allowedPolicy, unexpected: true },
  ]) {
    const result = await registry.invoke('test.model', requestFor('test.model'), options);
    assert.equal(result.error.code, 'INVOCATION_OPTIONS_INVALID');
    assert.doesNotMatch(JSON.stringify(result), /private-/);
  }
  assert.equal(calls, 0);
});

test('v1 input is one homogeneous classified content part and rejects mixed classifications', async () => {
  let calls = 0;
  const registry = createProviderRegistry();
  registry.register({
    descriptor: descriptor('model'),
    invoke: async (_context, request) => {
      calls += 1;
      return responseFor(request);
    },
  });
  const mismatch = requestFor('test.model');
  mismatch.input.classification = 'source-code';
  const nested = requestFor('test.model', {
    input: { parts: [{ classification: 'secret', content: 'hidden' }] },
  });
  const extraPart = requestFor('test.model');
  extraPart.input.otherContent = 'unclassified';
  for (const candidate of [mismatch, nested, extraPart]) {
    const result = await registry.invoke('test.model', candidate, { policy: allow() });
    assert.equal(result.error.code, 'REQUEST_INVALID');
  }
  assert.equal(calls, 0);
});

test('registered trust zone is authoritative and request fields cannot override it', async () => {
  let calls = 0;
  const external = { ...descriptor('model'), trustZone: 'external' };
  const registry = createProviderRegistry();
  registry.register({
    descriptor: external,
    invoke: async (_context, request) => {
      calls += 1;
      return responseFor(request);
    },
  });
  const result = await registry.invoke(
    external.id,
    requestFor(external.id, { trustZone: 'local' }),
    { policy: allow('public-metadata', 'local') }
  );
  assert.equal(result.denial.reasonCode, 'POLICY_RULE_REQUIRED');
  assert.equal(calls, 0);
});

test('valid invocation returns bounded advisory output and deterministic usage metadata', async () => {
  const registry = createProviderRegistry();
  registry.register({
    descriptor: descriptor('model'),
    invoke: async (_context, request) => responseFor(request),
  });
  const result = await registry.invoke('test.model', requestFor('test.model'), { policy: allow() });
  assert.equal(result.ok, true);
  assert.equal(result.response.advisory, true);
  assert.equal(result.response.sourceOfTruth, false);
  assert.deepEqual(result.response.usage, { inputUnits: 1, outputUnits: 1, totalUnits: 2 });
  assert.equal(Object.isFrozen(result.response), true);
});

test('unknown provider, wrong provider identity, and undeclared model fail deterministically', async () => {
  const registry = createProviderRegistry();
  registry.register({
    descriptor: descriptor('model'),
    invoke: async (_context, request) => responseFor(request),
  });
  assert.equal(
    (await registry.invoke('test.missing', requestFor('test.missing'), { policy: allow() })).error
      .code,
    'UNKNOWN_PROVIDER'
  );
  assert.equal(
    (await registry.invoke('test.model', requestFor('test.other'), { policy: allow() })).error.code,
    'PROVIDER_ID_MISMATCH'
  );
  assert.equal(
    (
      await registry.invoke('test.model', requestFor('test.model', { modelId: 'undeclared-v1' }), {
        policy: allow(),
      })
    ).error.code,
    'MODEL_NOT_SUPPORTED'
  );
});

test('provider errors and malformed responses are isolated behind fixed errors', async () => {
  const secret = 'raw-provider-secret-value';
  const throwing = createProviderRegistry();
  throwing.register({
    descriptor: descriptor('model'),
    invoke: async () => {
      throw new Error(secret);
    },
  });
  const failure = await throwing.invoke('test.model', requestFor('test.model'), {
    policy: allow(),
  });
  assert.equal(failure.error.code, 'PROVIDER_EXECUTION_FAILED');
  assert.doesNotMatch(JSON.stringify(failure), new RegExp(secret));

  const malformed = createProviderRegistry();
  malformed.register({ descriptor: descriptor('model'), invoke: async () => ({ secret }) });
  const invalid = await malformed.invoke('test.model', requestFor('test.model'), {
    policy: allow(),
  });
  assert.equal(invalid.error.code, 'PROVIDER_RESPONSE_INVALID');
  assert.doesNotMatch(JSON.stringify(invalid), new RegExp(secret));
});

test('response identity and evidence invention are rejected', async () => {
  for (const responseOverride of [
    { correlationId: 'other-request' },
    {
      evidenceReferences: [
        { id: 'evidence-1', contract: 'zeus.evidence-model@1' },
        { id: 'invented', contract: 'zeus.evidence-model@1' },
      ],
    },
  ]) {
    const registry = createProviderRegistry();
    registry.register({
      descriptor: descriptor('model'),
      invoke: async (_context, request) => responseFor(request, responseOverride),
    });
    const result = await registry.invoke('test.model', requestFor('test.model'), {
      policy: allow(),
    });
    assert.equal(result.ok, false);
    assert.ok(
      ['RESPONSE_IDENTITY_MISMATCH', 'EVIDENCE_REFERENCE_MISMATCH'].includes(result.error.code)
    );
  }
});

test('oversized, cyclic, and non-finite provider outputs are rejected', async () => {
  const cyclic = {};
  cyclic.self = cyclic;
  for (const output of [{ value: 'x'.repeat(1000) }, cyclic, { value: Number.NaN }]) {
    const registry = createProviderRegistry();
    registry.register({
      descriptor: descriptor('model'),
      invoke: async (_context, request) => responseFor(request, { output }),
    });
    const result = await registry.invoke(
      'test.model',
      requestFor('test.model', { maxOutputBytes: 64 }),
      { policy: allow() }
    );
    assert.equal(result.ok, false);
    assert.ok(['PROVIDER_RESPONSE_INVALID', 'OUTPUT_LIMIT_EXCEEDED'].includes(result.error.code));
  }
});

test('timeouts and pre-cancelled invocations are bounded and do not expose exceptions', async () => {
  const registry = createProviderRegistry();
  registry.register({
    descriptor: descriptor('model'),
    invoke: async () => new Promise(() => {}),
  });
  const timedOut = await registry.invoke('test.model', requestFor('test.model'), {
    policy: allow(),
    timeoutMs: 5,
  });
  assert.equal(timedOut.error.code, 'PROVIDER_TIMEOUT');

  const controller = new AbortController();
  controller.abort();
  const cancelled = await registry.invoke('test.model', requestFor('test.model'), {
    policy: allow(),
    signal: controller.signal,
  });
  assert.equal(cancelled.error.code, 'PROVIDER_CANCELLED');
});

test('prototype, accessor, cycle, symbol, function, bigint, and bounds attacks fail before invocation', async () => {
  const accessor = {};
  Object.defineProperty(accessor, 'value', {
    enumerable: true,
    get() {
      throw new Error('getter must never run');
    },
  });
  const polluted = JSON.parse('{"__proto__":{"polluted":true}}');
  const cyclic = {};
  cyclic.self = cyclic;
  const symbol = { [Symbol('hidden')]: 'value' };
  let exoticArrayGetterCalls = 0;
  const exoticArray = [];
  const exoticArrayPrototype = Object.create(Array.prototype);
  Object.defineProperty(exoticArrayPrototype, 'map', {
    get() {
      exoticArrayGetterCalls += 1;
      throw new Error('exotic array getter must never run');
    },
  });
  Object.setPrototypeOf(exoticArray, exoticArrayPrototype);
  const candidates = [
    polluted,
    accessor,
    cyclic,
    symbol,
    { value: () => true },
    { value: 1n },
    { value: Number.POSITIVE_INFINITY },
    { value: 'x'.repeat(70 * 1024) },
    Array.from({ length: 513 }, () => 1),
    exoticArray,
  ];
  for (const candidate of candidates) assert.ok(validatePlainData(candidate).length > 0);

  let calls = 0;
  const registry = createProviderRegistry();
  registry.register({
    descriptor: descriptor('model'),
    invoke: async (_context, request) => {
      calls += 1;
      return responseFor(request);
    },
  });
  for (const candidate of candidates) {
    const result = await registry.invoke(
      'test.model',
      requestFor('test.model', { input: candidate }),
      { policy: allow() }
    );
    assert.equal(result.error.code, 'REQUEST_INVALID');
  }
  assert.equal(calls, 0);
  assert.equal(exoticArrayGetterCalls, 0);
  assert.equal({}.polluted, undefined);
});

test('registration rejects accessors and dangerous envelope fields without executing them', () => {
  const registration = { invoke: async () => ({}) };
  Object.defineProperty(registration, 'descriptor', {
    enumerable: true,
    get() {
      throw new Error('registration getter must never run');
    },
  });
  assert.throws(
    () => createProviderRegistry().register(registration),
    error => error.code === 'PROVIDER_REGISTRATION_INVALID'
  );
  const hostileProxy = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error('private-registration-detail');
      },
    }
  );
  assert.throws(
    () => createProviderRegistry().register(hostileProxy),
    error =>
      error.code === 'PROVIDER_REGISTRATION_INVALID' &&
      !String(error.message).includes('private-registration-detail')
  );
});

test('deterministic mock provider obeys provider and model identity', async () => {
  const registry = createProviderRegistry();
  const mock = createMockModelProvider({ id: 'test.mock-model', modelId: 'mock-v1' });
  registry.register(mock);
  const request = requestFor(mock.descriptor.id, {
    modelId: 'mock-v1',
    input: { z: 1, a: ['stable'] },
  });
  const first = await registry.invoke(mock.descriptor.id, request, { policy: allow() });
  const second = await registry.invoke(mock.descriptor.id, request, { policy: allow() });
  assert.deepEqual(first, second);
  assert.equal(first.response.providerId, mock.descriptor.id);
  assert.equal(first.response.modelId, 'mock-v1');
});
