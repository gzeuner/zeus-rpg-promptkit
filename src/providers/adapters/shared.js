/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
*/
'use strict';

const { KIND_CONTRACTS, contractRef, descriptorRef } = require('../contracts');

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

function requestPrompt(content) {
  if (typeof content === 'string') return content;
  return canonicalJson(content);
}

function baseDescriptor(kind, id, displayName, trustZone, capabilities) {
  const descriptorContract = KIND_CONTRACTS[kind].descriptor;
  return Object.freeze({
    schemaVersion: 1,
    contract: contractRef(descriptorContract),
    descriptorVersion: descriptorRef(descriptorContract),
    kind,
    id,
    displayName,
    trustZone,
    capabilities,
  });
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

module.exports = { baseDescriptor, baseResponse, canonicalJson, requestPrompt };
