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
'use strict';

const { executeMcpToolCall, listMcpTools, readPackageVersion } = require('./mcpTools');
const { createMcpAuditLogger } = require('./mcpAuditLog');
const { createMcpRedactor } = require('./mcpRedaction');
const { createStdioTransport } = require('./stdioTransport');

const JSONRPC_VERSION = '2.0';
const MCP_PROTOCOL_VERSION = '2024-11-05';

class RpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

function createResponse(id, result) {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    result,
  };
}

function createErrorResponse(id, error, redactor) {
  const sanitizeError = redactor && typeof redactor.sanitizeError === 'function'
    ? redactor.sanitizeError
    : (entry) => ({
      code: Number.isFinite(entry && entry.code) ? entry.code : -32000,
      message: (entry && entry.message) || 'Internal error',
      ...(entry && entry.data !== undefined ? { data: entry.data } : {}),
    });
  const sanitizedError = sanitizeError(error || {});
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    error: sanitizedError,
  };
}

function normalizeToolCallResult(payload, redactor) {
  const sanitizePayload = redactor && typeof redactor.sanitizePayload === 'function'
    ? redactor.sanitizePayload
    : (value) => value;
  const sanitizedPayload = sanitizePayload(payload);
  const text = JSON.stringify(sanitizedPayload, null, 2);
  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
    structuredContent: sanitizedPayload,
    isError: false,
  };
}

function assertJsonRpcRequest(message) {
  if (!message || typeof message !== 'object') {
    throw new RpcError(-32600, 'Invalid Request');
  }
  if (message.jsonrpc !== JSONRPC_VERSION) {
    throw new RpcError(-32600, 'Invalid Request: jsonrpc must be "2.0"');
  }
  if (!message.method || typeof message.method !== 'string') {
    throw new RpcError(-32600, 'Invalid Request: method is required');
  }
}

function normalizeAllowlist(rawAllowlist) {
  if (!Array.isArray(rawAllowlist)) {
    return null;
  }

  const normalized = rawAllowlist
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return normalized.length > 0 ? Array.from(new Set(normalized)) : [];
}

function createToolPolicy(runtime, tools) {
  const defaultAllowlist = tools.map((tool) => tool.name);
  const rawAllowlist = runtime && Object.prototype.hasOwnProperty.call(runtime, 'allowlistedTools')
    ? runtime.allowlistedTools
    : defaultAllowlist;
  const allowlist = normalizeAllowlist(rawAllowlist);
  const allowedSet = new Set(allowlist === null ? defaultAllowlist : allowlist);

  return {
    listTools() {
      return tools.filter((tool) => allowedSet.has(tool.name));
    },
    assertToolAllowed(name) {
      if (allowedSet.has(name)) {
        return;
      }
      const error = new Error(`Tool is not allowed by MCP policy: ${name}`);
      error.code = 'TOOL_NOT_ALLOWED';
      throw error;
    },
  };
}

function parseDryRunFlag(args = {}) {
  const candidate = args.dryRun !== undefined ? args.dryRun : args['dry-run'];
  if (candidate === true) {
    return true;
  }
  if (candidate === false || candidate === undefined || candidate === null) {
    return false;
  }
  const normalized = String(candidate).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function createMcpServer(runtime = {}) {
  const redactor = createMcpRedactor(runtime);
  const auditLogger = createMcpAuditLogger(runtime, redactor);
  const context = {
    allowLegacyNumericCursor: runtime.allowLegacyNumericCursor !== false,
    cwd: runtime.cwd || process.cwd(),
    assessRiskRunner: typeof runtime.assessRiskRunner === 'function' ? runtime.assessRiskRunner : undefined,
    analyzeRunner: typeof runtime.analyzeRunner === 'function' ? runtime.analyzeRunner : undefined,
    bundleRunner: typeof runtime.bundleRunner === 'function' ? runtime.bundleRunner : undefined,
    doctorRunner: typeof runtime.doctorRunner === 'function' ? runtime.doctorRunner : undefined,
    fieldSearchRunner: typeof runtime.fieldSearchRunner === 'function' ? runtime.fieldSearchRunner : undefined,
    impactRunner: typeof runtime.impactRunner === 'function' ? runtime.impactRunner : undefined,
    inspectObjectRunner: typeof runtime.inspectObjectRunner === 'function' ? runtime.inspectObjectRunner : undefined,
    joblogRunner: typeof runtime.joblogRunner === 'function' ? runtime.joblogRunner : undefined,
    queryTableRunner: typeof runtime.queryTableRunner === 'function' ? runtime.queryTableRunner : undefined,
    querySqlRunner: typeof runtime.querySqlRunner === 'function' ? runtime.querySqlRunner : undefined,
    searchSourceRunner: typeof runtime.searchSourceRunner === 'function' ? runtime.searchSourceRunner : undefined,
    workflowRunner: typeof runtime.workflowRunner === 'function' ? runtime.workflowRunner : undefined,
  };
  const stdioInput = runtime.stdioInput || process.stdin;
  const stdioOutput = runtime.stdioOutput || process.stdout;
  const tools = listMcpTools();
  const toolPolicy = createToolPolicy(runtime, tools);

  async function handleRequest(message) {
    assertJsonRpcRequest(message);
    const isNotification = message.id === undefined || message.id === null;
    const method = String(message.method).trim();
    const params = message.params && typeof message.params === 'object' ? message.params : {};

    const respond = (result) => (isNotification
      ? null
      : createResponse(message.id, redactor.sanitizePayload(result)));

    if (method === 'initialize') {
      return respond({
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        serverInfo: {
          name: 'zeus-rpg-promptkit',
          version: readPackageVersion(context.cwd),
        },
      });
    }

    if (method === 'initialized') {
      return null;
    }

    if (method === 'tools/list') {
      return respond({ tools: toolPolicy.listTools() });
    }

    if (method === 'tools/call') {
      const name = params.name;
      const callArgs = params.arguments && typeof params.arguments === 'object'
        ? params.arguments
        : {};
      const profile = callArgs && typeof callArgs.profile === 'string'
        ? callArgs.profile.trim()
        : '';
      const dryRun = parseDryRunFlag(callArgs);
      if (!name || typeof name !== 'string') {
        try {
          auditLogger.appendToolCallEvent({
            toolName: null,
            profile: profile || null,
            dryRun,
            policyDecision: 'refused',
            status: 'error',
            resultCode: -32602,
            errorMessage: 'Invalid params: tools/call requires params.name',
          });
        } catch (_) {
          // Audit must never break MCP response handling.
        }
        throw new RpcError(-32602, 'Invalid params: tools/call requires params.name');
      }
      try {
        toolPolicy.assertToolAllowed(name);
        const payload = await executeMcpToolCall(name, callArgs, context);
        try {
          auditLogger.appendToolCallEvent({
            toolName: name,
            profile: profile || null,
            dryRun,
            policyDecision: 'allowed',
            status: 'success',
            resultCode: 0,
          });
        } catch (_) {
          // Audit must never break MCP response handling.
        }
        return respond(normalizeToolCallResult(payload, redactor));
      } catch (error) {
        let rpcError = null;
        let policyDecision = 'allowed';
        if (error && error.code === 'TOOL_NOT_ALLOWED') {
          policyDecision = 'refused';
          rpcError = new RpcError(-32601, error.message);
        }
        if (!rpcError && error && error.code === 'TOOL_INVALID_ARGUMENTS') {
          rpcError = new RpcError(-32602, error.message);
        }
        if (!rpcError && error && error.code === 'TOOL_NOT_FOUND') {
          rpcError = new RpcError(-32601, error.message);
        }
        if (!rpcError) {
          rpcError = new RpcError(-32000, error.message || 'Tool execution failed');
        }
        try {
          auditLogger.appendToolCallEvent({
            toolName: name,
            profile: profile || null,
            dryRun,
            policyDecision,
            status: 'error',
            resultCode: rpcError.code,
            errorMessage: rpcError.message,
          });
        } catch (_) {
          // Audit must never break MCP response handling.
        }
        throw rpcError;
      }
    }

    throw new RpcError(-32601, `Method not found: ${method}`);
  }

  function startStdio() {
    const transport = createStdioTransport({
      input: stdioInput,
      output: stdioOutput,
      onMessage: async (envelope) => {
        if (envelope.parseError) {
          transport.send(createErrorResponse(null, new RpcError(-32700, 'Parse error'), redactor));
          return;
        }

        try {
          const response = await handleRequest(envelope.payload);
          if (response) {
            transport.send(response);
          }
        } catch (error) {
          const requestId = envelope.payload && Object.prototype.hasOwnProperty.call(envelope.payload, 'id')
            ? envelope.payload.id
            : null;
          transport.send(createErrorResponse(requestId, error, redactor));
        }
      },
    });
    transport.start();
    return transport;
  }

  return {
    handleRequest,
    startStdio,
  };
}

module.exports = {
  createMcpServer,
  RpcError,
};
