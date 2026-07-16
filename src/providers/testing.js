/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
*/
'use strict';

const { KIND_CONTRACTS, contractRef, descriptorRef } = require('./contracts');

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

function baseDescriptor(kind, id, displayName, capabilities) {
  const descriptorContract = KIND_CONTRACTS[kind].descriptor;
  return {
    schemaVersion: 1,
    contract: contractRef(descriptorContract),
    descriptorVersion: descriptorRef(descriptorContract),
    kind,
    id,
    displayName,
    trustZone: 'local',
    capabilities,
  };
}

function baseResponse(kind, request, output, usage) {
  const response = {
    schemaVersion: 1,
    contract: contractRef(KIND_CONTRACTS[kind].response),
    providerId: request.providerId,
    correlationId: request.correlationId,
    advisory: true,
    sourceOfTruth: false,
    evidenceReferences: request.evidenceReferences.map(reference => ({
      id: reference.id,
      contract: reference.contract,
    })),
    output,
  };
  if (kind === 'model' || kind === 'embedding') response.modelId = request.modelId;
  if (usage) response.usage = usage;
  return response;
}

function createMockModelProvider({ id = 'test.mock-model', modelId = 'mock-v1' } = {}) {
  const descriptor = {
    ...baseDescriptor('model', id, 'Deterministic Mock Model (offline test double)', [
      'structured-output',
    ]),
    models: [modelId],
  };
  return {
    descriptor,
    invoke: async (_context, request) => {
      const canonical = canonicalJson(request.input.content);
      return baseResponse(
        'model',
        request,
        { mock: true, value: canonical },
        {
          inputUnits: Buffer.byteLength(canonical, 'utf8'),
          outputUnits: 1,
          totalUnits: Buffer.byteLength(canonical, 'utf8') + 1,
        }
      );
    },
  };
}

function vectorForText(text, dimension) {
  const vector = Array.from({ length: dimension }, () => 0);
  const bytes = Buffer.from(text, 'utf8');
  for (let index = 0; index < bytes.length; index += 1) {
    const slot = index % dimension;
    vector[slot] = (vector[slot] + bytes[index] * (index + 1)) % 1000003;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude === 0 ? vector : vector.map(value => Number((value / magnitude).toFixed(12)));
}

function createInMemoryEmbeddingProvider({
  id = 'test.memory-embedding',
  modelId = 'deterministic-embedding-v1',
  dimension = 8,
} = {}) {
  const descriptor = {
    ...baseDescriptor('embedding', id, 'Deterministic In-Memory Embedding (offline test double)', [
      'embedding',
    ]),
    models: [modelId],
    dimension,
  };
  return {
    descriptor,
    invoke: async (_context, request) => {
      const texts = request.input && request.input.content && request.input.content.texts;
      if (
        !Array.isArray(texts) ||
        texts.length > 128 ||
        texts.some(text => typeof text !== 'string')
      ) {
        throw new Error('invalid embedding test input');
      }
      const embeddings = texts.map(text => vectorForText(text, dimension));
      const inputUnits = texts.reduce((total, text) => total + Buffer.byteLength(text, 'utf8'), 0);
      return baseResponse(
        'embedding',
        request,
        { dimension, embeddings },
        {
          inputUnits,
          outputUnits: embeddings.length * dimension,
          totalUnits: inputUnits + embeddings.length * dimension,
        }
      );
    },
  };
}

function validateVector(vector, dimension) {
  return (
    Array.isArray(vector) &&
    vector.length === dimension &&
    vector.every(value => typeof value === 'number' && Number.isFinite(value))
  );
}

function cosineSimilarity(left, right) {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return Number((dot / Math.sqrt(leftMagnitude * rightMagnitude)).toFixed(12));
}

function createInMemoryVectorStoreProvider({
  id = 'test.memory-vector-store',
  dimension = 8,
  maxEntries = 256,
} = {}) {
  const records = new Map();
  const descriptor = {
    ...baseDescriptor(
      'vector-store',
      id,
      'Deterministic In-Memory Vector Store (offline test double)',
      ['vector-upsert', 'vector-query']
    ),
    dimension,
    maxEntries,
  };

  async function invoke(_context, request) {
    const input = (request.input && request.input.content) || {};
    if (request.operation === 'upsert') {
      if (!Array.isArray(input.items) || input.items.length > maxEntries) {
        throw new Error('invalid vector test input');
      }
      const staged = new Map(records);
      for (const item of input.items) {
        if (
          !item ||
          typeof item.id !== 'string' ||
          !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(item.id) ||
          !validateVector(item.vector, dimension)
        ) {
          throw new Error('invalid vector test item');
        }
        staged.set(item.id, {
          id: item.id,
          vector: [...item.vector],
          metadata: item.metadata === undefined ? null : item.metadata,
        });
      }
      if (staged.size > maxEntries) throw new Error('vector test store capacity exceeded');
      records.clear();
      for (const [recordId, record] of staged) records.set(recordId, record);
      return baseResponse('vector-store', request, { count: records.size });
    }
    if (request.operation === 'query') {
      if (!validateVector(input.vector, dimension)) throw new Error('invalid vector test query');
      const limit =
        Number.isInteger(input.limit) && input.limit > 0 ? Math.min(input.limit, 100) : 10;
      const matches = Array.from(records.values())
        .map(record => ({
          id: record.id,
          score: cosineSimilarity(input.vector, record.vector),
          metadata: record.metadata,
        }))
        .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
        .slice(0, limit);
      return baseResponse('vector-store', request, { matches });
    }
    if (request.operation === 'delete') {
      if (!Array.isArray(input.ids) || input.ids.some(recordId => typeof recordId !== 'string')) {
        throw new Error('invalid vector test delete');
      }
      for (const recordId of input.ids) records.delete(recordId);
      return baseResponse('vector-store', request, { count: records.size });
    }
    if (request.operation === 'clear') {
      records.clear();
      return baseResponse('vector-store', request, { count: 0 });
    }
    throw new Error('unsupported vector test operation');
  }

  return { descriptor, invoke };
}

module.exports = {
  OFFLINE_TEST_DOUBLES_ONLY: true,
  canonicalJson,
  createMockModelProvider,
  createInMemoryEmbeddingProvider,
  createInMemoryVectorStoreProvider,
};
