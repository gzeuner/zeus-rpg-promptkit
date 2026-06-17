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
const { listAnalysisRuns } = require('./localUiDataApi');
const { renderLocalUiShell } = require('./localUiShell');
const { buildUiMetadataPayload } = require('./uiMetadataService');
const { UiActionError, createLocalUiActionService } = require('./localUiActionService');
const { createPromptWorkbenchService } = require('./promptWorkbenchService');
const { collectSensitiveTermsFromEnv, maskSensitiveTermsInText, sanitizeValue } = require('../security/secretMasking');
const { listWorkspaces, readWorkspaceById, touchWorkspace } = require('../workspace/analysisRegistryService');
const { readWorkspaceIndex, WORKSPACE_INDEX_FILE } = require('../workspace/workspaceIndexBuilder');

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

function sendJson(response, statusCode, payload, options = {}) {
  const sensitiveTerms = Array.isArray(options.sensitiveTerms) ? options.sensitiveTerms : [];
  const sanitizedPayload = sanitizeValue(payload, { sensitiveTerms });
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(`${JSON.stringify(sanitizedPayload, null, 2)}\n`);
}

function sendMethodNotAllowed(response, methods) {
  response.writeHead(405, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Allow: (Array.isArray(methods) ? methods : []).join(', '),
  });
  response.end(`${JSON.stringify({ error: 'Method not allowed' }, null, 2)}\n`);
}

function sendText(response, statusCode, content, contentType = 'text/plain; charset=utf-8', sensitiveTerms = []) {
  const sanitized = maskSensitiveTermsInText(content, sensitiveTerms);
  response.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  response.end(sanitized);
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

function requireJsonRequest(request) {
  const contentType = String(request.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw new UiActionError('Invalid request: content-type must be application/json', 400);
  }
}

async function handleUiActionRequest({
  request,
  response,
  pathname,
  segments,
  actionService,
  sensitiveTerms = [],
}) {
  if (!pathname.startsWith('/api/ui-actions')) {
    return false;
  }

  if (segments[0] !== 'api' || segments[1] !== 'ui-actions' || segments.length < 3) {
    sendJson(response, 404, { error: `Route not found: ${pathname}` }, { sensitiveTerms });
    return true;
  }

  const actionName = segments[2];
  if (request.method !== 'POST') {
    sendMethodNotAllowed(response, ['POST']);
    return true;
  }

  try {
    requireJsonRequest(request);
    const payload = await readJsonBody(request);
    const result = await actionService.executeAction(actionName, payload);
    sendJson(response, 200, result, { sensitiveTerms });
  } catch (error) {
    const statusCode = Number.isInteger(error.statusCode)
      ? error.statusCode
      : /^invalid json body:|^request body exceeds/i.test(String(error && error.message))
        ? 400
        : 500;
    sendJson(response, statusCode, {
      error: statusCode === 500 ? 'Internal server error' : (error.message || 'Action failed'),
    }, { sensitiveTerms });
  }
  return true;
}

async function handlePromptBuilderRequest({
  request,
  response,
  pathname,
  segments,
  promptWorkbenchService,
  sensitiveTerms = [],
}) {
  const send = (statusCode, payload) => sendJson(response, statusCode, payload, { sensitiveTerms });

  if (!pathname.startsWith('/api/prompt-builder')) {
    return false;
  }

  if (pathname === '/api/prompt-builder/contracts') {
    if (request.method !== 'GET') {
      sendMethodNotAllowed(response, ['GET']);
      return true;
    }
    send(200, promptWorkbenchService.getContract());
    return true;
  }

  if (pathname === '/api/prompt-builder/use-cases') {
    if (request.method !== 'GET') {
      sendMethodNotAllowed(response, ['GET']);
      return true;
    }
    send(200, promptWorkbenchService.listUseCases());
    return true;
  }

  if (pathname === '/api/prompt-builder/modules') {
    if (request.method !== 'GET') {
      sendMethodNotAllowed(response, ['GET']);
      return true;
    }
    send(200, promptWorkbenchService.listModules());
    return true;
  }

  if (pathname === '/api/prompt-builder/preview') {
    if (request.method !== 'POST') {
      sendMethodNotAllowed(response, ['POST']);
      return true;
    }
    const payload = await readJsonBody(request);
    send(200, promptWorkbenchService.previewPrompt(payload));
    return true;
  }

  if (pathname === '/api/prompt-builder/templates') {
    if (request.method === 'GET') {
      send(200, promptWorkbenchService.listTemplates());
      return true;
    }
    if (request.method === 'POST') {
      const payload = await readJsonBody(request);
      send(201, promptWorkbenchService.createTemplate(payload));
      return true;
    }
    sendMethodNotAllowed(response, ['GET', 'POST']);
    return true;
  }

  if (segments[0] === 'api' && segments[1] === 'prompt-builder' && segments[2] === 'templates' && segments.length === 4) {
    const templateId = segments[3];
    if (request.method === 'GET') {
      send(200, promptWorkbenchService.readTemplate(templateId));
      return true;
    }
    if (request.method === 'PUT') {
      const payload = await readJsonBody(request);
      send(200, promptWorkbenchService.updateTemplate(templateId, payload));
      return true;
    }
    if (request.method === 'DELETE') {
      send(200, promptWorkbenchService.deleteTemplate(templateId));
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
    send(200, promptWorkbenchService.listContextSources());
    return true;
  }

  if (segments[0] === 'api' && segments[1] === 'prompt-builder' && segments[2] === 'context-sources' && segments[4] === 'prompts' && segments.length === 5) {
    if (request.method !== 'GET') {
      sendMethodNotAllowed(response, ['GET']);
      return true;
    }
    send(200, promptWorkbenchService.listContextSourcePrompts(segments[3]));
    return true;
  }

  if (pathname === '/api/prompt-builder/context-sources/import') {
    if (request.method !== 'POST') {
      sendMethodNotAllowed(response, ['POST']);
      return true;
    }
    const payload = await readJsonBody(request);
    send(200, promptWorkbenchService.importContextPrompt(payload));
    return true;
  }

  send(404, { error: `Route not found: ${pathname}` });
  return true;
}

function buildDefaultAnalysisWorkspace({ outputRoot }) {
  return {
    id: 'default',
    name: 'Current Output Root',
    description: 'Fallback workspace when no analyses registry is configured.',
    path: path.resolve(outputRoot),
    outputDir: '.',
    sourceDir: '',
    registeredAt: null,
    lastAccessedAt: null,
  };
}

function listAnalyses(registryPath, outputRoot) {
  if (!registryPath) {
    return [buildDefaultAnalysisWorkspace({ outputRoot })];
  }
  return listWorkspaces(registryPath);
}

function resolveAnalysisWorkspace({ registryPath, workspaceId, outputRoot }) {
  if (workspaceId === 'default') {
    return buildDefaultAnalysisWorkspace({ outputRoot });
  }
  if (!registryPath) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }
  const workspace = readWorkspaceById(registryPath, workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }
  return workspace;
}

function resolveWorkspaceOutputRoot(workspace) {
  if (workspace.id === 'default') {
    return path.resolve(workspace.path);
  }
  return path.resolve(workspace.path, workspace.outputDir || 'output');
}

async function handleAnalysesRequest({
  request,
  response,
  pathname,
  segments,
  registryPath,
  outputRoot,
  sensitiveTerms,
}) {
  if (!pathname.startsWith('/api/analyses')) {
    return false;
  }

  if (pathname === '/api/analyses') {
    if (request.method !== 'GET') {
      sendMethodNotAllowed(response, ['GET']);
      return true;
    }
    sendJson(response, 200, {
      registryPath: registryPath || null,
      workspaces: listAnalyses(registryPath, outputRoot),
    }, { sensitiveTerms });
    return true;
  }

  if (segments[0] !== 'api' || segments[1] !== 'analyses' || segments.length < 3) {
    sendJson(response, 404, { error: `Route not found: ${pathname}` }, { sensitiveTerms });
    return true;
  }

  const workspaceId = segments[2];
  const workspace = resolveAnalysisWorkspace({ registryPath, workspaceId, outputRoot });
  const workspaceOutputRoot = resolveWorkspaceOutputRoot(workspace);

  if (segments.length === 3) {
    if (request.method !== 'GET') {
      sendMethodNotAllowed(response, ['GET']);
      return true;
    }
    sendJson(response, 200, {
      workspace,
      outputRoot: workspaceOutputRoot,
      index: readWorkspaceIndex(workspace.path),
      runs: listAnalysisRuns(workspaceOutputRoot),
    }, { sensitiveTerms });
    return true;
  }

  if (segments.length === 4 && segments[3] === 'index') {
    if (request.method !== 'GET') {
      sendMethodNotAllowed(response, ['GET']);
      return true;
    }
    const index = readWorkspaceIndex(workspace.path);
    if (!index) {
      sendJson(response, 404, { error: `${WORKSPACE_INDEX_FILE} not found for workspace ${workspaceId}` }, { sensitiveTerms });
      return true;
    }
    sendJson(response, 200, index, { sensitiveTerms });
    return true;
  }

  if (segments.length === 4 && segments[3] === 'touch') {
    if (request.method !== 'POST') {
      sendMethodNotAllowed(response, ['POST']);
      return true;
    }
    const touched = registryPath ? touchWorkspace(registryPath, workspaceId) : workspace;
    sendJson(response, 200, {
      ok: true,
      workspace: touched,
    }, { sensitiveTerms });
    return true;
  }

  sendJson(response, 404, { error: `Route not found: ${pathname}` }, { sensitiveTerms });
  return true;
}

function createLocalUiRequestHandler({
  outputRoot,
  promptWorkbenchService,
  actionService,
  registryPath = null,
  sensitiveTerms = [],
}) {
  const resolvedOutputRoot = path.resolve(outputRoot);
  const service = promptWorkbenchService || createPromptWorkbenchService();
  const uiActionService = actionService || createLocalUiActionService();

  return async function handleRequest(request, response) {
    const url = new URL(request.url, 'http://127.0.0.1');
    const pathname = url.pathname;
    const segments = splitPathname(pathname);

    try {
      const analysesHandled = await handleAnalysesRequest({
        request,
        response,
        pathname,
        segments,
        registryPath,
        outputRoot: resolvedOutputRoot,
        sensitiveTerms,
      });
      if (analysesHandled) {
        return;
      }

      const promptBuilderHandled = await handlePromptBuilderRequest({
        request,
        response,
        pathname,
        segments,
        promptWorkbenchService: service,
        sensitiveTerms,
      });
      if (promptBuilderHandled) {
        return;
      }

      const uiActionHandled = await handleUiActionRequest({
        request,
        response,
        pathname,
        segments,
        actionService: uiActionService,
        sensitiveTerms,
      });
      if (uiActionHandled) {
        return;
      }

      if (request.method !== 'GET') {
        sendMethodNotAllowed(response, ['GET']);
        return;
      }

      if (pathname === '/' || pathname === '/index.html') {
        sendText(response, 200, renderLocalUiShell(), 'text/html; charset=utf-8', sensitiveTerms);
        return;
      }

      if (pathname === '/api/health') {
        sendJson(response, 200, {
          ok: true,
          outputRoot: resolvedOutputRoot,
        }, { sensitiveTerms });
        return;
      }

      if (pathname === '/api/ui-metadata') {
        sendJson(response, 200, buildUiMetadataPayload(), { sensitiveTerms });
        return;
      }

      if (pathname === '/api/runs') {
        sendJson(response, 200, executeListRuns({
          sourceOutputRoot: resolvedOutputRoot,
        }).runs, { sensitiveTerms });
        return;
      }

      if (segments[0] === 'api' && segments[1] === 'runs' && segments.length === 3) {
        sendJson(response, 200, executeReadRun({
          sourceOutputRoot: resolvedOutputRoot,
          program: segments[2],
        }).run, { sensitiveTerms });
        return;
      }

      if (segments[0] === 'api' && segments[1] === 'runs' && segments[3] === 'views' && segments.length === 4) {
        sendJson(response, 200, executeReadRunViews({
          sourceOutputRoot: resolvedOutputRoot,
          program: segments[2],
        }).views, { sensitiveTerms });
        return;
      }

      if (segments[0] === 'api' && segments[1] === 'runs' && segments[3] === 'artifacts' && segments[4] === 'content') {
        sendJson(response, 200, executeReadArtifact({
          sourceOutputRoot: resolvedOutputRoot,
          program: segments[2],
          path: url.searchParams.get('path'),
        }).artifact, { sensitiveTerms });
        return;
      }

      if (segments[0] === 'runs' && segments[2] === 'artifacts' && segments[3] === 'raw') {
        const artifact = executeReadArtifact({
          sourceOutputRoot: resolvedOutputRoot,
          program: segments[1],
          path: url.searchParams.get('path'),
        }).artifact;
        sendText(response, 200, artifact.content, artifact.contentType, sensitiveTerms);
        return;
      }

      sendJson(response, 404, { error: `Route not found: ${pathname}` }, { sensitiveTerms });
    } catch (error) {
      sendJson(response, /not found/i.test(error.message) ? 404 : 400, {
        error: error.message,
      }, { sensitiveTerms });
    }
  };
}

async function startLocalUiServer({
  outputRoot,
  host = DEFAULT_UI_HOST,
  port = DEFAULT_UI_PORT,
  templateStorePath,
  actionService,
  actionServiceOptions = {},
  registryPath = null,
  sensitiveTerms = [],
} = {}) {
  const resolvedHost = normalizeHost(host);
  const resolvedPort = parsePositiveInteger(port, DEFAULT_UI_PORT);
  const resolvedOutputRoot = path.resolve(outputRoot || 'output');
  const promptWorkbenchService = createPromptWorkbenchService({
    templateStorePath,
    outputRoot: resolvedOutputRoot,
  });
  const uiActionService = actionService || createLocalUiActionService({
    cwd: actionServiceOptions.cwd || process.cwd(),
    env: actionServiceOptions.env || process.env,
    doctorExecutor: actionServiceOptions.doctorExecutor,
    analyzeExecutor: actionServiceOptions.analyzeExecutor,
    analyzeConfigResolver: actionServiceOptions.analyzeConfigResolver,
    fetchConfigResolver: actionServiceOptions.fetchConfigResolver,
  });
  const resolvedSensitiveTerms = collectSensitiveTermsFromEnv(process.env, sensitiveTerms);
  const server = http.createServer(createLocalUiRequestHandler({
    outputRoot: resolvedOutputRoot,
    promptWorkbenchService,
    actionService: uiActionService,
    registryPath: registryPath ? path.resolve(registryPath) : null,
    sensitiveTerms: resolvedSensitiveTerms,
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
    registryPath: registryPath ? path.resolve(registryPath) : null,
    url: `http://${resolvedHost === '::1' ? '[::1]' : resolvedHost}:${actualPort}`,
  };
}

module.exports = {
  DEFAULT_UI_HOST,
  DEFAULT_UI_PORT,
  createLocalUiRequestHandler,
  startLocalUiServer,
};
