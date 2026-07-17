'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { providers } = require('../src/api/zeusApi');
const { contractRef, CONTRACTS } = providers.contracts;

function request(providerId, modelId, overrides = {}) {
  const classification = overrides.classification || 'public-metadata';
  return {
    schemaVersion: 1,
    contract: contractRef(CONTRACTS.MODEL_REQUEST),
    providerId,
    correlationId: overrides.correlationId || 'local-adapter-1',
    classification,
    evidenceReferences: overrides.evidenceReferences || [],
    input: {
      classification,
      content: overrides.input || { prompt: 'hello' },
    },
    modelId,
    ...(overrides.maxOutputBytes ? { maxOutputBytes: overrides.maxOutputBytes } : {}),
  };
}

function allow(zone = 'local') {
  return providers.policy.createEgressPolicy([
    { classification: 'public-metadata', trustZone: zone, allow: true },
  ]);
}

async function withServer(routes, run) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString('utf8');
    const body = bodyText ? JSON.parse(bodyText) : null;
    calls.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body,
    });
    const handler = routes[`${req.method} ${req.url}`];
    if (!handler) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'missing route' }));
      return;
    }
    const response = await handler({ req, body, calls });
    res.writeHead(
      response.statusCode || 200,
      response.headers || { 'content-type': 'application/json' }
    );
    res.end(response.body === undefined ? '' : JSON.stringify(response.body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await run({
      baseUrl: `http://127.0.0.1:${address.port}`,
      calls,
    });
  } finally {
    await new Promise((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  }
}

test('ollama adapter is opt-in, does not auto-probe, and invokes through the registry', async () => {
  await withServer(
    {
      'POST /api/generate': ({ body }) => ({
        body: {
          model: body.model,
          response: `echo:${body.prompt}`,
          done: true,
          done_reason: 'stop',
          prompt_eval_count: 4,
          eval_count: 2,
        },
      }),
      'GET /api/tags': () => ({
        body: {
          models: [{ model: 'llama3.1' }],
        },
      }),
    },
    async ({ baseUrl, calls }) => {
      const adapter = providers.adapters.createOllamaModelAdapter({
        id: 'local.ollama-test',
        modelId: 'llama3.1',
        endpoint: baseUrl,
        destinationPolicy: { allowLoopback: true },
      });
      assert.equal(calls.length, 0);

      const registry = providers.createRegistry();
      registry.register(adapter.registration);
      const result = await registry.invoke(
        adapter.descriptor.id,
        request(adapter.descriptor.id, 'llama3.1', { input: { z: 1, a: 'two' } }),
        { policy: allow('local') }
      );

      assert.equal(result.ok, true);
      assert.equal(result.response.output.message, 'echo:{"a":"two","z":1}');
      assert.deepEqual(result.response.usage, { inputUnits: 4, outputUnits: 2, totalUnits: 6 });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, '/api/generate');
      assert.deepEqual(calls[0].body, {
        model: 'llama3.1',
        prompt: '{"a":"two","z":1}',
        stream: false,
      });

      const health = await adapter.checkHealth();
      assert.deepEqual(health, { ok: true, status: 'healthy', modelCount: 1 });
      const capabilities = await adapter.listRemoteModels();
      assert.deepEqual(capabilities, { ok: true, models: ['llama3.1'] });
      assert.equal(calls.length, 3);
      assert.equal(calls[1].url, '/api/tags');
      assert.equal(calls[2].url, '/api/tags');
    }
  );
});

test('openai-compatible adapter sends only prompt content and uses explicit auth without leaking it', async () => {
  await withServer(
    {
      'POST /v1/chat/completions': ({ body, req }) => ({
        body: {
          id: 'cmpl-1',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: `reply:${body.messages[0].content}` },
            },
          ],
          usage: {
            prompt_tokens: 7,
            completion_tokens: 3,
            total_tokens: 10,
          },
          authSeen: req.headers.authorization,
        },
      }),
      'GET /v1/models': ({ req }) => ({
        body: {
          data: [{ id: 'private-vllm' }],
          authSeen: req.headers.authorization,
        },
      }),
    },
    async ({ baseUrl, calls }) => {
      const adapter = providers.adapters.createOpenAICompatibleModelAdapter({
        id: 'private.vllm-test',
        endpoint: baseUrl,
        apiKey: 'top-secret-token',
        models: ['private-vllm'],
        destinationPolicy: { allowLoopback: true },
      });
      const registry = providers.createRegistry();
      registry.register(adapter.registration);

      const response = await registry.invoke(
        adapter.descriptor.id,
        request(adapter.descriptor.id, 'private-vllm', {
          input: { source: 'SELECT * FROM ORDERS' },
          evidenceReferences: [{ id: 'evidence-1', contract: 'zeus.evidence@1' }],
        }),
        { policy: allow('local') }
      );
      assert.equal(response.ok, true);
      assert.equal(response.response.output.message, 'reply:{"source":"SELECT * FROM ORDERS"}');
      assert.deepEqual(response.response.usage, {
        inputUnits: 7,
        outputUnits: 3,
        totalUnits: 10,
      });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].headers.authorization, 'Bearer top-secret-token');
      assert.deepEqual(calls[0].body, {
        model: 'private-vllm',
        stream: false,
        messages: [{ role: 'user', content: '{"source":"SELECT * FROM ORDERS"}' }],
      });

      const models = await adapter.listRemoteModels();
      assert.deepEqual(models, { ok: true, models: ['private-vllm'] });
      assert.equal(calls[1].headers.authorization, 'Bearer top-secret-token');
    }
  );
});

test('transport denies loopback, metadata, and public destinations unless explicitly allowed', async () => {
  assert.throws(
    () =>
      providers.adapters.createOllamaModelAdapter({
        endpoint: 'http://user:pass@127.0.0.1:11434',
        modelId: 'llama3.1',
      }),
    /credentials are not allowed/
  );

  const deniedLoopback = providers.adapters.createOpenAICompatibleModelAdapter({
    endpoint: 'http://127.0.0.1:9999',
    models: ['private-vllm'],
    destinationPolicy: {},
  });
  await assert.rejects(
    () => deniedLoopback.checkHealth(),
    error => {
      assert.equal(error.code, 'TRANSPORT_DESTINATION_DENIED');
      return true;
    }
  );

  const deniedPublic = providers.adapters.createOpenAICompatibleModelAdapter({
    endpoint: 'http://93.184.216.34:8080',
    models: ['private-vllm'],
    destinationPolicy: {},
  });
  await assert.rejects(
    () => deniedPublic.checkHealth(),
    error => {
      assert.equal(error.code, 'TRANSPORT_DESTINATION_DENIED');
      return true;
    }
  );

  const deniedMetadata = providers.adapters.createOpenAICompatibleModelAdapter({
    endpoint: 'http://169.254.169.254',
    models: ['private-vllm'],
    destinationPolicy: { allowPrivate: true },
  });
  await assert.rejects(
    () => deniedMetadata.checkHealth(),
    error => {
      assert.equal(error.code, 'TRANSPORT_DESTINATION_DENIED');
      return true;
    }
  );
});

test('redirects are revalidated and oversized responses fail closed', async () => {
  await withServer(
    {
      'GET /v1/models': () => ({
        statusCode: 302,
        headers: { location: 'http://169.254.169.254/v1/models' },
        body: { ignored: true },
      }),
    },
    async ({ baseUrl }) => {
      const adapter = providers.adapters.createOpenAICompatibleModelAdapter({
        endpoint: baseUrl,
        models: ['private-vllm'],
        destinationPolicy: { allowLoopback: true },
      });
      await assert.rejects(
        () => adapter.checkHealth(),
        error => {
          assert.equal(error.code, 'TRANSPORT_DESTINATION_DENIED');
          return true;
        }
      );
    }
  );

  await withServer(
    {
      'POST /api/generate': () => ({
        body: {
          response: 'x'.repeat(150 * 1024),
          done: true,
          prompt_eval_count: 1,
          eval_count: 1,
        },
      }),
    },
    async ({ baseUrl }) => {
      const adapter = providers.adapters.createOllamaModelAdapter({
        id: 'local.ollama-oversize',
        modelId: 'llama3.1',
        endpoint: baseUrl,
        destinationPolicy: { allowLoopback: true },
        maxResponseBytes: 16 * 1024,
      });
      const registry = providers.createRegistry();
      registry.register(adapter.registration);
      const result = await registry.invoke(
        adapter.descriptor.id,
        request(adapter.descriptor.id, 'llama3.1'),
        { policy: allow('local') }
      );
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'PROVIDER_EXECUTION_FAILED');
    }
  );
});

test('registry timeout/cancellation propagate through adapter transport without auto-retries', async () => {
  await withServer(
    {
      'POST /v1/chat/completions': async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return {
          body: {
            choices: [{ message: { content: 'late' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          },
        };
      },
    },
    async ({ baseUrl, calls }) => {
      const adapter = providers.adapters.createOpenAICompatibleModelAdapter({
        endpoint: baseUrl,
        models: ['private-vllm'],
        destinationPolicy: { allowLoopback: true },
      });
      const registry = providers.createRegistry();
      registry.register(adapter.registration);
      const timedOut = await registry.invoke(
        adapter.descriptor.id,
        request(adapter.descriptor.id, 'private-vllm'),
        { policy: allow('local'), timeoutMs: 5 }
      );
      assert.equal(timedOut.error.code, 'PROVIDER_TIMEOUT');
      assert.equal(calls.length, 1);
    }
  );
});

test('explicit health checks are bounded by transport timeout and do not auto-retry', async () => {
  await withServer(
    {
      'GET /api/tags': async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return { body: { models: [{ model: 'llama3.1' }] } };
      },
    },
    async ({ baseUrl, calls }) => {
      const adapter = providers.adapters.createOllamaModelAdapter({
        endpoint: baseUrl,
        modelId: 'llama3.1',
        destinationPolicy: { allowLoopback: true },
        timeoutMs: 5,
      });
      await assert.rejects(
        () => adapter.checkHealth(),
        error => {
          assert.equal(error.code, 'TRANSPORT_TIMEOUT');
          return true;
        }
      );
      assert.equal(calls.length, 1);
    }
  );
});
