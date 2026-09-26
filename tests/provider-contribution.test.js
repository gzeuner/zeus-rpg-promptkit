'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createEgressPolicy } = require('../src/providers/egressPolicy');
const { createProviderRegistry } = require('../src/providers/providerRegistry');
const {
  CONTRACTS,
  KIND_CONTRACTS,
  contractRef,
  descriptorRef,
} = require('../src/providers/contracts');
const { DERIVATION_CLASSES } = require('../src/projectIntelligence/constants');
const publicApi = require('../src/projectIntelligence');
const {
  PROVIDER_CONTRIBUTION_REASON_CODES,
  ProviderContributionError,
  createProviderContribution,
} = require('../src/projectIntelligence/export/providerContribution');

const BASE_SNAPSHOT = Object.freeze({
  snapshotId: 'snapshot-001',
  contentHash: 'a'.repeat(64),
});

function providerDescriptor(overrides = {}) {
  return {
    schemaVersion: 1,
    contract: contractRef(KIND_CONTRACTS.model.descriptor),
    descriptorVersion: descriptorRef(KIND_CONTRACTS.model.descriptor),
    kind: 'model',
    id: 'provider-a',
    displayName: 'Local adapter',
    trustZone: 'local',
    capabilities: ['offline-test'],
    models: ['model-a'],
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    schemaVersion: 1,
    contract: contractRef(CONTRACTS.MODEL_REQUEST),
    providerId: 'provider-a',
    modelId: 'model-a',
    correlationId: 'request-001',
    classification: 'project-metadata',
    evidenceReferences: [{ id: 'evidence-001', contract: 'evidence@1' }],
    input: {
      classification: 'project-metadata',
      content: { fact: 'structured input' },
    },
    ...overrides,
  };
}

function response(overrides = {}) {
  return {
    schemaVersion: 1,
    contract: contractRef(CONTRACTS.MODEL_RESPONSE),
    providerId: 'provider-a',
    modelId: 'model-a',
    correlationId: 'request-001',
    advisory: true,
    sourceOfTruth: false,
    evidenceReferences: [{ id: 'evidence-001', contract: 'evidence@1' }],
    output: { derivedFact: 'structured observation' },
    ...overrides,
  };
}

function registry(onInvoke = () => {}) {
  const providerRegistry = createProviderRegistry();
  providerRegistry.register({ descriptor: providerDescriptor(), invoke: onInvoke });
  return providerRegistry;
}

function bridgeOptions(overrides = {}) {
  return {
    providerRegistry: registry(),
    providerOptIn: true,
    egressPolicy: createEgressPolicy([
      { classification: 'project-metadata', trustZone: 'local', allow: true },
    ]),
    request: request(),
    response: response(),
    contributionId: 'instance-a:contribution-001',
    originInstanceId: 'instance-a',
    baseSnapshot: BASE_SNAPSHOT,
    contractVersions: { 'knowledge.contribution': '1' },
    providerVersion: 'version-001',
    modelDigest: 'b'.repeat(64),
    collectedAt: '2026-09-25T10:00:00.000Z',
    privacyReport: { status: 'passed' },
    qualityReport: { status: 'passed' },
    ...overrides,
  };
}

function assertBridgeError(callback, code) {
  assert.throws(
    callback,
    error => error instanceof ProviderContributionError && error.code === code
  );
}

test('creates a local proposed provider contribution without invoking the provider', () => {
  let invocations = 0;
  const options = bridgeOptions({ providerRegistry: registry(() => (invocations += 1)) });
  const result = createProviderContribution(options);

  assert.equal(result.ok, true);
  assert.equal(result.validation.ok, true);
  assert.equal(result.package.manifest.derivationClass, DERIVATION_CLASSES.INFERRED);
  assert.equal(result.package.manifest.status, 'proposed');
  assert.equal(result.package.manifest.advisory, true);
  assert.equal(result.package.manifest.sourceOfTruth, false);
  assert.deepEqual(result.package.manifest.evidenceReferences, options.request.evidenceReferences);
  assert.deepEqual(result.package.payload.facts, options.response.output);
  assert.equal(result.providerInvoked, false);
  assert.equal(result.localOnly, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.publication, false);
  assert.equal(result.canPublish, false);
  assert.equal(invocations, 0);
});

test('downgrades a requested verified class to inferred', () => {
  const result = createProviderContribution(
    bridgeOptions({ derivationClass: DERIVATION_CLASSES.VERIFIED })
  );

  assert.equal(result.requestedDerivation, DERIVATION_CLASSES.VERIFIED);
  assert.equal(result.derivationClass, DERIVATION_CLASSES.INFERRED);
  assert.equal(result.downgradedFrom, DERIVATION_CLASSES.VERIFIED);
  assert.deepEqual(result.reasonCodes, [PROVIDER_CONTRIBUTION_REASON_CODES.DERIVATION_DOWNGRADED]);
  assert.equal(result.package.manifest.derivationClass, DERIVATION_CLASSES.INFERRED);
});

test('requires registration, explicit opt-in and an exact egress policy', () => {
  assertBridgeError(
    () => createProviderContribution(bridgeOptions({ providerRegistry: createProviderRegistry() })),
    PROVIDER_CONTRIBUTION_REASON_CODES.PROVIDER_NOT_REGISTERED
  );
  assertBridgeError(
    () => createProviderContribution(bridgeOptions({ providerOptIn: false })),
    PROVIDER_CONTRIBUTION_REASON_CODES.PROVIDER_OPT_IN_REQUIRED
  );
  assertBridgeError(
    () => createProviderContribution(bridgeOptions({ egressPolicy: createEgressPolicy([]) })),
    PROVIDER_CONTRIBUTION_REASON_CODES.POLICY_DENIED
  );
});

test('retains request identity and evidence references exactly', () => {
  assertBridgeError(
    () =>
      createProviderContribution(
        bridgeOptions({ response: response({ providerId: 'provider-b' }) })
      ),
    PROVIDER_CONTRIBUTION_REASON_CODES.IDENTITY_MISMATCH
  );
  assertBridgeError(
    () =>
      createProviderContribution(
        bridgeOptions({
          response: response({
            evidenceReferences: [{ id: 'evidence-002', contract: 'evidence@1' }],
          }),
        })
      ),
    PROVIDER_CONTRIBUTION_REASON_CODES.EVIDENCE_MISMATCH
  );
});

test('rejects raw, path-like and authority-bearing provider output', () => {
  for (const output of [
    { rawSource: 'unbounded' },
    { prompt: 'unbounded' },
    { path: 'relative-input.txt' },
    { sourceOfTruth: true },
  ]) {
    assertBridgeError(
      () => createProviderContribution(bridgeOptions({ response: response({ output }) })),
      PROVIDER_CONTRIBUTION_REASON_CODES.OUTPUT_UNSAFE
    );
  }
  assertBridgeError(
    () =>
      createProviderContribution(
        bridgeOptions({ response: response({ output: { 'derived fact': 'value' } }) })
      ),
    PROVIDER_CONTRIBUTION_REASON_CODES.OUTPUT_UNSAFE
  );
  assertBridgeError(
    () =>
      createProviderContribution(
        bridgeOptions({ response: response({ output: { derivedFact: 'x'.repeat(4097) } }) })
      ),
    PROVIDER_CONTRIBUTION_REASON_CODES.OUTPUT_UNSAFE
  );
});

test('requires a passed privacy report and complete provenance metadata', () => {
  assertBridgeError(
    () => createProviderContribution(bridgeOptions({ privacyReport: { status: 'failed' } })),
    PROVIDER_CONTRIBUTION_REASON_CODES.OUTPUT_UNSAFE
  );
  assertBridgeError(
    () => createProviderContribution(bridgeOptions({ modelDigest: 'not-a-digest' })),
    PROVIDER_CONTRIBUTION_REASON_CODES.PROVENANCE_INVALID
  );
  assertBridgeError(
    () => createProviderContribution(bridgeOptions({ collectedAt: 'not-a-timestamp' })),
    PROVIDER_CONTRIBUTION_REASON_CODES.PROVENANCE_INVALID
  );
  assertBridgeError(
    () => createProviderContribution(bridgeOptions({ capability: 'not a label' })),
    PROVIDER_CONTRIBUTION_REASON_CODES.INPUT_INVALID
  );
  assertBridgeError(
    () => createProviderContribution(bridgeOptions({ disclosure: 'not a label' })),
    PROVIDER_CONTRIBUTION_REASON_CODES.INPUT_INVALID
  );
});

test('hashes request evidence without retaining the request payload', () => {
  const options = bridgeOptions({
    request: request({
      input: {
        classification: 'project-metadata',
        content: { prompt: 'private request text' },
      },
    }),
  });
  const first = createProviderContribution(options);
  const second = createProviderContribution(options);
  const serialized = JSON.stringify(first);

  assert.equal(first.requestFingerprint, second.requestFingerprint);
  assert.equal(first.package.hashes.packageHash, second.package.hashes.packageHash);
  assert.equal(serialized.includes('private request text'), false);
  assert.equal(serialized.includes('providerRegistry'), false);
});

test('rejects non-advisory or source-of-truth provider responses', () => {
  assertBridgeError(
    () => createProviderContribution(bridgeOptions({ response: response({ advisory: false }) })),
    PROVIDER_CONTRIBUTION_REASON_CODES.RESPONSE_INVALID
  );
  assertBridgeError(
    () =>
      createProviderContribution(bridgeOptions({ response: response({ sourceOfTruth: true }) })),
    PROVIDER_CONTRIBUTION_REASON_CODES.RESPONSE_INVALID
  );
});

test('exposes the provider contribution bridge through the public API', () => {
  assert.equal(publicApi.createProviderContribution, createProviderContribution);
  assert.equal(publicApi.PROVIDER_CONTRIBUTION_REASON_CODES, PROVIDER_CONTRIBUTION_REASON_CODES);
});
