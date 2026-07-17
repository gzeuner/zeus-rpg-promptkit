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

function createOllamaModelAdapter({
  id = 'local.ollama',
  displayName = 'Ollama (local/private opt-in)',
  modelId,
  models = modelId ? [modelId] : undefined,
  endpoint = 'http://127.0.0.1:11434',
  destinationPolicy = { allowLoopback: true },
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
  });
  const descriptor = {
    ...baseDescriptor(
      'model',
      id,
      displayName,
      destinationPolicy.allowLoopback ? 'local' : 'private-network',
      ['local-http', 'opt-in', 'structured-output']
    ),
    models: declaredModels,
  };

  async function invoke(context, request) {
    const response = await transport.requestJson({
      method: 'POST',
      path: '/api/generate',
      signal: context.signal,
      body: {
        model: request.modelId,
        prompt: requestPrompt(request.input.content),
        stream: false,
      },
    });
    const body = response.body || {};
    const message = typeof body.response === 'string' ? body.response : '';
    return baseResponse(
      'model',
      request,
      {
        message,
        done: body.done === true,
        finishReason: typeof body.done_reason === 'string' ? body.done_reason : null,
      },
      {
        inputUnits: Number.isInteger(body.prompt_eval_count) ? body.prompt_eval_count : 0,
        outputUnits: Number.isInteger(body.eval_count) ? body.eval_count : 0,
        totalUnits:
          (Number.isInteger(body.prompt_eval_count) ? body.prompt_eval_count : 0) +
          (Number.isInteger(body.eval_count) ? body.eval_count : 0),
      }
    );
  }

  async function listRemoteModels({ signal } = {}) {
    const response = await transport.requestJson({ method: 'GET', path: '/api/tags', signal });
    const models = Array.isArray(response.body && response.body.models)
      ? response.body.models
          .map(model => model && (model.model || model.name))
          .filter(value => typeof value === 'string')
          .sort()
      : [];
    return Object.freeze({ ok: true, models });
  }

  async function checkHealth({ signal } = {}) {
    const result = await listRemoteModels({ signal });
    return Object.freeze({
      ok: true,
      status: result.models.length >= 0 ? 'healthy' : 'unknown',
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

module.exports = { createOllamaModelAdapter };
