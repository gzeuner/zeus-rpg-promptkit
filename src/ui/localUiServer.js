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
const http = require('http');
const path = require('path');

const {
  executeListRuns,
  executeReadArtifact,
  executeReadRun,
  executeReadRunViews,
} = require('../core/runExplorerService');
const { renderLocalUiShell } = require('./localUiShell');
const { createPromptWorkbenchService } = require('./promptWorkbenchService');

const DEFAULT_UI_HOST = '127.0.0.1';
const DEFAULT_UI_PORT = 4782;
const MAX_JSON_BODY_BYTES = 512 * 1024;

function normalizeHost(host) {
  const normalized = String(host || DEFAULT_UI_HOST).trim();
  if (!normalized || normalized === 'localhost') {
    return DEFAULT_UI_HOST;
  }
  if (normalized === '127.0.0.1' || normalized === '::1') {
    return normalized;
  }
  throw new Error('Local UI server only supports localhost/loopback binding');
}

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === true) {
    return fallback;
  }
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('Local UI port must be a non-negative integer');
  }
  return parsed;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendMethodNotAllowed(response, methods) {
  response.writeHead(405, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Allow: (Array.isArray(methods) ? methods : []).join(', '),
  });
  response.end(`${JSON.stringify({ error: 'Method not allowed' }, null, 2)}\n`);
}

function sendText(response, statusCode, content, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  response.end(content);
}

function splitPathname(pathname) {
  return String(pathname || '')
    .split('/')
    .filter(Boolean)
    .map((entry) => decodeURIComponent(entry));
}

function readJsonBody(request, options = {}) {
  const maxBytes = Number.isInteger(options.maxBytes) && options.maxBytes > 0
    ? options.maxBytes
    : MAX_JSON_BODY_BYTES;

  return new Promise((resolve, reject) => {
    let bytes = 0;
    let body = '';

    request.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(new Error(`Request body exceeds ${maxBytes} bytes.`));
        return;
      }
      body += chunk.toString('utf8');
    });

    request.on('end', () => {
      const trimmed = body.trim();
      if (!trimmed) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(trimmed));
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${error.message}`));
      }
    });

    request.on('error', reject);
  });
}

async function handlePromptBuilderRequest({
  request,
  response,
  pathname,
  segments,
  promptWorkbenchService,
}) {
  if (!pathname.startsWith('/api/prompt-builder')) {
    return false;
  }

  if (pathname === '/api/prompt-builder/contracts') {
    if (request.method !== 'GET') {
      sendMethodNotAllowed(response, ['GET']);
      return true;
    }
    sendJson(response, 200, promptWorkbenchService.getContract());
    return true;
  }

  if (pathname === '/api/prompt-builder/use-cases') {
    if (request.method !== 'GET') {
      sendMethodNotAllowed(response, ['GET']);
      return true;
    }
    sendJson(response, 200, promptWorkbenchService.listUseCases());
    return true;
  }

  if (pathname === '/api/prompt-builder/modules') {
    if (request.method !== 'GET') {
      sendMethodNotAllowed(response, ['GET']);
      return true;
    }
    sendJson(response, 200, promptWorkbenchService.listModules());
    return true;
  }

  if (pathname === '/api/prompt-builder/preview') {
    if (request.method !== 'POST') {
      sendMethodNotAllowed(response, ['POST']);
      return true;
    }
    const payload = await readJsonBody(request);
    sendJson(response, 200, promptWorkbenchService.previewPrompt(payload));
    return true;
  }

  if (pathname === '/api/prompt-builder/templates') {
    if (request.method === 'GET') {
      sendJson(response, 200, promptWorkbenchService.listTemplates());
      return true;
    }
    if (request.method === 'POST') {
      const payload = await readJsonBody(request);
      sendJson(response, 201, promptWorkbenchService.createTemplate(payload));
      return true;
    }
    sendMethodNotAllowed(response, ['GET', 'POST']);
    return true;
  }

  if (segments[0] === 'api' && segments[1] === 'prompt-builder' && segments[2] === 'templates' && segments.length === 4) {
    const templateId = segments[3];
    if (request.method === 'GET') {
      sendJson(response, 200, promptWorkbenchService.readTemplate(templateId));
      return true;
    }
    if (request.method === 'PUT') {
      const payload = await readJsonBody(request);
      sendJson(response, 200, promptWorkbenchService.updateTemplate(templateId, payload));
      return true;
    }
    if (request.method === 'DELETE') {
      sendJson(response, 200, promptWorkbenchService.deleteTemplate(templateId));
      return true;
    }
    sendMethodNotAllowed(response, ['GET', 'PUT', 'DELETE']);
    return true;
  }

  if (pathname === '/api/prompt-builder/context-sources') {
    if (request.method !== 'GET') {
      sendMethodNotAllowed(response, ['GET']);
      return true;
    }
    sendJson(response, 200, promptWorkbenchService.listContextSources());
    return true;
  }

  if (segments[0] === 'api' && segments[1] === 'prompt-builder' && segments[2] === 'context-sources' && segments[4] === 'prompts' && segments.length === 5) {
    if (request.method !== 'GET') {
      sendMethodNotAllowed(response, ['GET']);
      return true;
    }
    sendJson(response, 200, promptWorkbenchService.listContextSourcePrompts(segments[3]));
    return true;
  }

  if (pathname === '/api/prompt-builder/context-sources/import') {
    if (request.method !== 'POST') {
      sendMethodNotAllowed(response, ['POST']);
      return true;
    }
    const payload = await readJsonBody(request);
    sendJson(response, 200, promptWorkbenchService.importContextPrompt(payload));
    return true;
  }

  sendJson(response, 404, { error: `Route not found: ${pathname}` });
  return true;
}

function createLocalUiRequestHandler({ outputRoot, promptWorkbenchService }) {
  const resolvedOutputRoot = path.resolve(outputRoot);
  const service = promptWorkbenchService || createPromptWorkbenchService();

  return async function handleRequest(request, response) {
    const url = new URL(request.url, 'http://127.0.0.1');
    const pathname = url.pathname;
    const segments = splitPathname(pathname);

    try {
      const promptBuilderHandled = await handlePromptBuilderRequest({
        request,
        response,
        pathname,
        segments,
        promptWorkbenchService: service,
      });
      if (promptBuilderHandled) {
        return;
      }

      if (request.method !== 'GET') {
        sendMethodNotAllowed(response, ['GET']);
        return;
      }

      if (pathname === '/' || pathname === '/index.html') {
        sendText(response, 200, renderLocalUiShell(), 'text/html; charset=utf-8');
        return;
      }

      if (pathname === '/api/health') {
        sendJson(response, 200, {
          ok: true,
          outputRoot: resolvedOutputRoot,
        });
        return;
      }

      if (pathname === '/api/runs') {
        sendJson(response, 200, executeListRuns({
          sourceOutputRoot: resolvedOutputRoot,
        }).runs);
        return;
      }

      if (segments[0] === 'api' && segments[1] === 'runs' && segments.length === 3) {
        sendJson(response, 200, executeReadRun({
          sourceOutputRoot: resolvedOutputRoot,
          program: segments[2],
        }).run);
        return;
      }

      if (segments[0] === 'api' && segments[1] === 'runs' && segments[3] === 'views' && segments.length === 4) {
        sendJson(response, 200, executeReadRunViews({
          sourceOutputRoot: resolvedOutputRoot,
          program: segments[2],
        }).views);
        return;
      }

      if (segments[0] === 'api' && segments[1] === 'runs' && segments[3] === 'artifacts' && segments[4] === 'content') {
        sendJson(response, 200, executeReadArtifact({
          sourceOutputRoot: resolvedOutputRoot,
          program: segments[2],
          path: url.searchParams.get('path'),
        }).artifact);
        return;
      }

      if (segments[0] === 'runs' && segments[2] === 'artifacts' && segments[3] === 'raw') {
        const artifact = executeReadArtifact({
          sourceOutputRoot: resolvedOutputRoot,
          program: segments[1],
          path: url.searchParams.get('path'),
        }).artifact;
        sendText(response, 200, artifact.content, artifact.contentType);
        return;
      }

      sendJson(response, 404, { error: `Route not found: ${pathname}` });
    } catch (error) {
      sendJson(response, /not found/i.test(error.message) ? 404 : 400, {
        error: error.message,
      });
    }
  };
}

async function startLocalUiServer({
  outputRoot,
  host = DEFAULT_UI_HOST,
  port = DEFAULT_UI_PORT,
  templateStorePath,
} = {}) {
  const resolvedHost = normalizeHost(host);
  const resolvedPort = parsePositiveInteger(port, DEFAULT_UI_PORT);
  const resolvedOutputRoot = path.resolve(outputRoot || 'output');
  const promptWorkbenchService = createPromptWorkbenchService({
    templateStorePath,
    outputRoot: resolvedOutputRoot,
  });
  const server = http.createServer(createLocalUiRequestHandler({
    outputRoot: resolvedOutputRoot,
    promptWorkbenchService,
  }));

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(resolvedPort, resolvedHost, resolve);
  });

  const address = server.address();
  const actualPort = address && typeof address === 'object' ? address.port : resolvedPort;
  return {
    server,
    host: resolvedHost,
    port: actualPort,
    outputRoot: resolvedOutputRoot,
    url: `http://${resolvedHost === '::1' ? '[::1]' : resolvedHost}:${actualPort}`,
  };
}

module.exports = {
  DEFAULT_UI_HOST,
  DEFAULT_UI_PORT,
  createLocalUiRequestHandler,
  startLocalUiServer,
};
