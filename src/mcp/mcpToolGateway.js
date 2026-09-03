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

const { DEFAULT_MCP_SAFE_TOOL_NAMES } = require('./mcpPolicy');

function normalizeToolCallResult(payload, redactor, options = {}) {
  const sanitizePayload =
    redactor && typeof redactor.sanitizePayload === 'function'
      ? redactor.sanitizePayload
      : value => value;
  const sanitizedPayload = sanitizePayload(payload);
  const text = JSON.stringify(sanitizedPayload, null, 2);
  const maxResponseBytes =
    Number.isInteger(options.maxResponseBytes) && options.maxResponseBytes > 0
      ? options.maxResponseBytes
      : 1024 * 1024;
  const responseBytes = Buffer.byteLength(text, 'utf8');
  if (responseBytes > maxResponseBytes) {
    const error = new Error(
      `Tool result exceeds maximum response size (${responseBytes} bytes > ${maxResponseBytes} bytes). Narrow the query or reduce payload limits.`
    );
    error.code = 'TOOL_RESPONSE_TOO_LARGE';
    throw error;
  }
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

function normalizeAllowlist(rawAllowlist) {
  if (!Array.isArray(rawAllowlist)) {
    return null;
  }

  const normalized = rawAllowlist
    .filter(entry => typeof entry === 'string')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);

  return normalized.length > 0 ? Array.from(new Set(normalized)) : [];
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function createToolPolicy(runtime, tools) {
  const knownToolNames = new Set(tools.map(tool => tool.name));
  const defaultAllowlist = DEFAULT_MCP_SAFE_TOOL_NAMES.filter(toolName =>
    knownToolNames.has(toolName)
  );
  const rawAllowlist =
    runtime && Object.prototype.hasOwnProperty.call(runtime, 'allowlistedTools')
      ? runtime.allowlistedTools
      : defaultAllowlist;
  const allowlist = normalizeAllowlist(rawAllowlist);
  const allowedSet = new Set(allowlist === null ? defaultAllowlist : allowlist);

  return {
    listTools() {
      return tools.filter(tool => allowedSet.has(tool.name));
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

function resultCodeForToolError(error) {
  if (error && error.code === 'TOOL_NOT_ALLOWED') {
    return -32601;
  }
  if (error && error.code === 'TOOL_INVALID_ARGUMENTS') {
    return -32602;
  }
  if (error && error.code === 'TOOL_NOT_FOUND') {
    return -32601;
  }
  return -32000;
}

function createMcpToolGateway(options = {}) {
  const runtime = options.runtime || {};
  const context = options.context || {};
  const redactor = options.redactor || null;
  const auditLogger = options.auditLogger || null;
  const tools = Array.isArray(options.tools) ? options.tools : [];
  const executeMcpToolCall = options.executeMcpToolCall;
  if (typeof executeMcpToolCall !== 'function') {
    throw new TypeError('createMcpToolGateway requires executeMcpToolCall');
  }

  const toolExecutionTimeoutMs = parsePositiveInteger(runtime.toolExecutionTimeoutMs, 30000);
  const maxToolResponseBytes = parsePositiveInteger(runtime.maxToolResponseBytes, 1024 * 1024);
  const toolPolicy = createToolPolicy(runtime, tools);

  function appendAudit(event) {
    try {
      if (auditLogger && typeof auditLogger.appendToolCallEvent === 'function') {
        auditLogger.appendToolCallEvent(event);
      }
    } catch (_) {
      // Audit must never break MCP response handling.
    }
  }

  async function executeToolCallWithTimeout(name, callArgs) {
    let timer = null;
    try {
      return await Promise.race([
        executeMcpToolCall(name, callArgs, context),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const timeoutError = new Error(
              `Tool execution timed out after ${toolExecutionTimeoutMs}ms: ${name}`
            );
            timeoutError.code = 'TOOL_TIMEOUT';
            reject(timeoutError);
          }, toolExecutionTimeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async function call(name, callArgs = {}) {
    const profile = typeof callArgs.profile === 'string' ? callArgs.profile.trim() : '';
    const dryRun = parseDryRunFlag(callArgs);

    try {
      toolPolicy.assertToolAllowed(name);
      const payload = await executeToolCallWithTimeout(name, callArgs);
      const result = normalizeToolCallResult(payload, redactor, {
        maxResponseBytes: maxToolResponseBytes,
      });
      appendAudit({
        toolName: name,
        profile: profile || null,
        dryRun,
        policyDecision: 'allowed',
        status: 'success',
        resultCode: 0,
      });
      return result;
    } catch (error) {
      const policyDecision = error && error.code === 'TOOL_NOT_ALLOWED' ? 'refused' : 'allowed';
      appendAudit({
        toolName: name,
        profile: profile || null,
        dryRun,
        policyDecision,
        status: 'error',
        resultCode: resultCodeForToolError(error),
        errorMessage: error && error.message ? error.message : 'Tool execution failed',
      });
      throw error;
    }
  }

  return {
    call,
    listTools: () => toolPolicy.listTools(),
  };
}

module.exports = {
  createMcpToolGateway,
  normalizeToolCallResult,
  parseDryRunFlag,
};
