/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
*/
'use strict';

const { createPrivateHttpJsonTransport } = require('./privateHttpTransport');
const { baseDescriptor, baseResponse, requestPrompt } = require('./shared');

function normalizeModels(models) {
  if (
    !Array.isArray(models) ||
    models.length === 0 ||
    models.some(model => typeof model !== 'string')
  ) {
    throw new Error('adapter models are required');
  }
  return [...new Set(models)].sort();
}

function authorizationHeaders(apiKey) {
  if (apiKey === undefined) return {};
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('adapter apiKey is invalid');
  }
  return { authorization: `Bearer ${apiKey}` };
}

function trustZoneForPolicy(destinationPolicy) {
  if (destinationPolicy.allowLoopback) return 'local';
  return 'private-network';
}

function createOpenAICompatibleModelAdapter({
  id = 'private.openai-compatible',
  displayName = 'OpenAI-compatible local/private endpoint (opt-in)',
  modelId,
  models = modelId ? [modelId] : undefined,
  endpoint,
  apiKey,
  destinationPolicy = { allowPrivate: true },
  configProvenance,
  maxResponseBytes,
  timeoutMs,
} = {}) {
  const declaredModels = normalizeModels(models);
  const transport = createPrivateHttpJsonTransport({
    endpoint,
    destinationPolicy,
    maxResponseBytes,
    timeoutMs,
    headers: authorizationHeaders(apiKey),
  });
  const descriptor = {
    ...baseDescriptor('model', id, displayName, trustZoneForPolicy(destinationPolicy), [
      'local-http',
      'openai-compatible',
      'structured-output',
    ]),
    models: declaredModels,
  };

  async function invoke(context, request) {
    const response = await transport.requestJson({
      method: 'POST',
      path: '/v1/chat/completions',
      signal: context.signal,
      body: {
        model: request.modelId,
        stream: false,
        messages: [{ role: 'user', content: requestPrompt(request.input.content) }],
      },
    });
    const body = response.body || {};
    const choice =
      Array.isArray(body.choices) && body.choices.length > 0 && body.choices[0]
        ? body.choices[0]
        : {};
    const message =
      choice && choice.message && typeof choice.message.content === 'string'
        ? choice.message.content
        : '';
    const usage = body.usage || {};
    return baseResponse(
      'model',
      request,
      {
        message,
        finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
      },
      {
        inputUnits: Number.isInteger(usage.prompt_tokens) ? usage.prompt_tokens : 0,
        outputUnits: Number.isInteger(usage.completion_tokens) ? usage.completion_tokens : 0,
        totalUnits: Number.isInteger(usage.total_tokens)
          ? usage.total_tokens
          : (Number.isInteger(usage.prompt_tokens) ? usage.prompt_tokens : 0) +
            (Number.isInteger(usage.completion_tokens) ? usage.completion_tokens : 0),
      }
    );
  }

  async function listRemoteModels({ signal } = {}) {
    const response = await transport.requestJson({ method: 'GET', path: '/v1/models', signal });
    const models = Array.isArray(response.body && response.body.data)
      ? response.body.data
          .map(model => model && model.id)
          .filter(value => typeof value === 'string')
          .sort()
      : [];
    return Object.freeze({ ok: true, models });
  }

  async function checkHealth({ signal } = {}) {
    const result = await listRemoteModels({ signal });
    return Object.freeze({
      ok: true,
      status: 'healthy',
      modelCount: result.models.length,
    });
  }

  return Object.freeze({
    descriptor: Object.freeze(descriptor),
    registration: Object.freeze({
      descriptor: Object.freeze(descriptor),
      invoke,
      ...(configProvenance ? { configProvenance } : {}),
    }),
    invoke,
    listRemoteModels,
    checkHealth,
  });
}

module.exports = { createOpenAICompatibleModelAdapter };
