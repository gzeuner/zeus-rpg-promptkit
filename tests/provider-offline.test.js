'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Install network poison before importing any provider implementation.
const originalFetch = global.fetch;
const networkRestorers = [];
global.fetch = () => {
  throw new Error('NETWORK_FORBIDDEN_IN_PROVIDER_TEST');
};
for (const [moduleName, methods] of Object.entries({
  'node:net': ['connect', 'createConnection'],
  'node:tls': ['connect'],
  'node:http': ['request', 'get'],
  'node:https': ['request', 'get'],
  'node:dns': ['lookup', 'resolve'],
  'node:dgram': ['createSocket'],
})) {
  const moduleValue = require(moduleName);
  for (const method of methods) {
    const original = moduleValue[method];
    moduleValue[method] = () => {
      throw new Error('NETWORK_FORBIDDEN_IN_PROVIDER_TEST');
    };
    networkRestorers.push(() => {
      moduleValue[method] = original;
    });
  }
}
const net = require('node:net');
const originalSocketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = () => {
  throw new Error('NETWORK_FORBIDDEN_IN_PROVIDER_TEST');
};
networkRestorers.push(() => {
  net.Socket.prototype.connect = originalSocketConnect;
});

const { providers, zeus } = require('../src/api/zeusApi');
const { contractRef, CONTRACTS } = providers.contracts;

function request(kind, providerId, overrides = {}) {
  const { input = {}, ...rest } = overrides;
  const classification = rest.classification || 'public-metadata';
  const contracts = {
    model: CONTRACTS.MODEL_REQUEST,
    embedding: CONTRACTS.EMBEDDING_REQUEST,
    'vector-store': CONTRACTS.VECTOR_STORE_REQUEST,
  };
  const result = {
    schemaVersion: 1,
    contract: contractRef(contracts[kind]),
    providerId,
    correlationId: 'offline-1',
    classification,
    evidenceReferences: [],
    input: { classification, content: input },
    ...rest,
  };
  return result;
}

const localPolicy = providers.policy.createEgressPolicy([
  { classification: 'public-metadata', trustZone: 'local', allow: true },
]);

test.after(() => {
  global.fetch = originalFetch;
  networkRestorers.reverse().forEach(restore => restore());
});

test('Zeus API starts with an empty optional provider registry and no automatic mock', () => {
  assert.equal(zeus.providers.registry.size(), 0);
  assert.deepEqual(zeus.providers.registry.list(), []);
  assert.equal(typeof zeus.analyze, 'function');
  assert.equal(typeof zeus.capabilities.list, 'function');
});

test('offline provider subtree has no transport, process, clock, random, filesystem, or dynamic import', () => {
  const root = path.join(__dirname, '..', 'src', 'providers');
  const files = fs.readdirSync(root).filter(name => name.endsWith('.js'));
  assert.ok(files.length >= 5);
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(
      source,
      /require\(['"](?:node:)?(?:net|tls|http|https|dns|dgram|fs|child_process)['"]\)/,
      file
    );
    assert.doesNotMatch(
      source,
      /\bfetch\s*\(|\bprocess\.env\b|\bMath\.random\b|\bnew Date\b|\bimport\s*\(/,
      file
    );
  }
});

test('deterministic mock model is byte-stable under scrubbed environment and network poison', async () => {
  const registry = providers.createRegistry();
  const mock = providers.testing.createMockModelProvider();
  registry.register(mock);
  const modelRequest = request('model', mock.descriptor.id, {
    modelId: mock.descriptor.models[0],
    input: { b: 2, a: 'same' },
  });
  const first = await registry.invoke(mock.descriptor.id, modelRequest, { policy: localPolicy });
  const second = await registry.invoke(mock.descriptor.id, modelRequest, { policy: localPolicy });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.response.output.mock, true);
});

test('in-memory embedding provider returns fixed finite dimensions deterministically', async () => {
  const registry = providers.createRegistry();
  const embedding = providers.testing.createInMemoryEmbeddingProvider({ dimension: 6 });
  registry.register(embedding);
  const embeddingRequest = request('embedding', embedding.descriptor.id, {
    modelId: embedding.descriptor.models[0],
    input: { texts: ['ALPHA', 'BETA', 'ALPHA'] },
  });
  const first = await registry.invoke(embedding.descriptor.id, embeddingRequest, {
    policy: localPolicy,
  });
  const second = await registry.invoke(embedding.descriptor.id, embeddingRequest, {
    policy: localPolicy,
  });
  assert.deepEqual(first, second);
  assert.equal(first.response.output.dimension, 6);
  assert.equal(first.response.output.embeddings.length, 3);
  assert.equal(first.response.output.embeddings[0].length, 6);
  assert.deepEqual(first.response.output.embeddings[0], first.response.output.embeddings[2]);
  assert.ok(first.response.output.embeddings.flat().every(Number.isFinite));
});

test('in-memory vector store is isolated, bounded, and deterministically ordered', async () => {
  const firstRegistry = providers.createRegistry();
  const secondRegistry = providers.createRegistry();
  const firstStore = providers.testing.createInMemoryVectorStoreProvider({
    dimension: 2,
    maxEntries: 2,
  });
  const secondStore = providers.testing.createInMemoryVectorStoreProvider({
    id: 'test.other-vector-store',
    dimension: 2,
    maxEntries: 2,
  });
  firstRegistry.register(firstStore);
  secondRegistry.register(secondStore);

  const upsert = request('vector-store', firstStore.descriptor.id, {
    operation: 'upsert',
    input: {
      items: [
        { id: 'b', vector: [1, 0], metadata: { label: 'B' } },
        { id: 'a', vector: [1, 0], metadata: { label: 'A' } },
      ],
    },
  });
  assert.equal(
    (await firstRegistry.invoke(firstStore.descriptor.id, upsert, { policy: localPolicy })).ok,
    true
  );
  const query = request('vector-store', firstStore.descriptor.id, {
    operation: 'query',
    input: { vector: [1, 0], limit: 2 },
  });
  const matches = (
    await firstRegistry.invoke(firstStore.descriptor.id, query, { policy: localPolicy })
  ).response.output.matches;
  assert.deepEqual(
    matches.map(match => match.id),
    ['a', 'b']
  );

  const otherQuery = request('vector-store', secondStore.descriptor.id, {
    operation: 'query',
    input: { vector: [1, 0], limit: 2 },
  });
  const other = await secondRegistry.invoke(secondStore.descriptor.id, otherQuery, {
    policy: localPolicy,
  });
  assert.deepEqual(other.response.output.matches, []);

  const overflow = request('vector-store', firstStore.descriptor.id, {
    operation: 'upsert',
    input: { items: [{ id: 'c', vector: [0, 1] }] },
  });
  const rejected = await firstRegistry.invoke(firstStore.descriptor.id, overflow, {
    policy: localPolicy,
  });
  assert.equal(rejected.error.code, 'PROVIDER_EXECUTION_FAILED');
  const after = await firstRegistry.invoke(firstStore.descriptor.id, query, {
    policy: localPolicy,
  });
  assert.deepEqual(
    after.response.output.matches.map(match => match.id),
    ['a', 'b']
  );
});
