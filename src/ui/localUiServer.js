/*
Copyright 2026 Guido Zeuner

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
  listAnalysisRuns,
  readAnalysisRun,
  readArtifactContent,
} = require('./localUiDataApi');
const { renderLocalUiShell } = require('./localUiShell');

const DEFAULT_UI_HOST = '127.0.0.1';
const DEFAULT_UI_PORT = 4782;

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

function createLocalUiRequestHandler({ outputRoot }) {
  const resolvedOutputRoot = path.resolve(outputRoot);

  return function handleRequest(request, response) {
    const url = new URL(request.url, 'http://127.0.0.1');
    const pathname = url.pathname;
    const segments = splitPathname(pathname);

    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }

    try {
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
        sendJson(response, 200, listAnalysisRuns(resolvedOutputRoot));
        return;
      }

      if (segments[0] === 'api' && segments[1] === 'runs' && segments.length === 3) {
        sendJson(response, 200, readAnalysisRun(resolvedOutputRoot, segments[2]));
        return;
      }

      if (segments[0] === 'api' && segments[1] === 'runs' && segments[3] === 'views' && segments.length === 4) {
        sendJson(response, 200, readAnalysisRun(resolvedOutputRoot, segments[2]).views);
        return;
      }

      if (segments[0] === 'api' && segments[1] === 'runs' && segments[3] === 'artifacts' && segments[4] === 'content') {
        const artifactPath = url.searchParams.get('path');
        const artifact = readArtifactContent(resolvedOutputRoot, segments[2], artifactPath);
        sendJson(response, 200, artifact);
        return;
      }

      if (segments[0] === 'runs' && segments[2] === 'artifacts' && segments[3] === 'raw') {
        const artifactPath = url.searchParams.get('path');
        const artifact = readArtifactContent(resolvedOutputRoot, segments[1], artifactPath);
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

async function startLocalUiServer({ outputRoot, host = DEFAULT_UI_HOST, port = DEFAULT_UI_PORT } = {}) {
  const resolvedHost = normalizeHost(host);
  const resolvedPort = parsePositiveInteger(port, DEFAULT_UI_PORT);
  const resolvedOutputRoot = path.resolve(outputRoot || 'output');
  const server = http.createServer(createLocalUiRequestHandler({
    outputRoot: resolvedOutputRoot,
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
