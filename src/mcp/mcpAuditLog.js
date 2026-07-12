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

const fs = require('fs');
const path = require('path');
const { sanitizeValue } = require('../security/secretMasking');
const MCP_AUDIT_SCHEMA_VERSION = 'mcp.tools.call.v1';
const MCP_AUDIT_LEGACY_SCHEMA_VERSION = 'mcp.tools.call.v0-legacy';

function resolveMcpAuditPath(runtime = {}) {
  const cwd = runtime.cwd || process.cwd();
  return runtime.auditPath
    ? path.resolve(String(runtime.auditPath))
    : path.resolve(cwd, '.local', 'mcp', 'audit', 'mcp-audit.jsonl');
}

function normalizeMcpAuditEvent(entry, options = {}) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }

  const legacySchemaVersion =
    String(options.legacySchemaVersion || MCP_AUDIT_LEGACY_SCHEMA_VERSION).trim() ||
    MCP_AUDIT_LEGACY_SCHEMA_VERSION;

  const schemaVersion =
    typeof entry.schemaVersion === 'string' && entry.schemaVersion.trim()
      ? entry.schemaVersion.trim()
      : legacySchemaVersion;

  return {
    ...entry,
    schemaVersion,
  };
}

function readMcpAuditEvents(runtime = {}) {
  const auditPath = resolveMcpAuditPath(runtime);
  if (!fs.existsSync(auditPath)) {
    return {
      auditPath,
      events: [],
      parseErrors: [],
    };
  }

  const lines = fs.readFileSync(auditPath, 'utf8').split(/\r?\n/);
  const events = [];
  const parseErrors = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      continue;
    }
    try {
      const parsed = JSON.parse(line);
      const normalized = normalizeMcpAuditEvent(parsed, {
        legacySchemaVersion: runtime.legacyAuditSchemaVersion,
      });
      if (normalized) {
        events.push(normalized);
      }
    } catch (error) {
      parseErrors.push({
        line: index + 1,
        message: String(error && error.message ? error.message : 'Invalid JSON'),
      });
    }
  }

  return {
    auditPath,
    events,
    parseErrors,
  };
}

function createMcpAuditLogger(runtime = {}, redactor = null) {
  const enabled = runtime.auditEnabled !== false;
  const schemaVersion =
    String(runtime.auditSchemaVersion || MCP_AUDIT_SCHEMA_VERSION).trim() ||
    MCP_AUDIT_SCHEMA_VERSION;
  const auditPath = resolveMcpAuditPath(runtime);

  const sanitizePayload =
    redactor && typeof redactor.sanitizePayload === 'function'
      ? redactor.sanitizePayload
      : value => sanitizeValue(value);

  function appendToolCallEvent(event = {}) {
    if (!enabled) {
      return null;
    }

    const entry = sanitizePayload({
      timestamp: new Date().toISOString(),
      schemaVersion,
      eventType: 'mcp.tools.call',
      ...event,
    });

    fs.mkdirSync(path.dirname(auditPath), { recursive: true });
    fs.appendFileSync(auditPath, `${JSON.stringify(entry)}\n`, 'utf8');
    return {
      auditPath,
      event: entry,
    };
  }

  return {
    appendToolCallEvent,
    auditPath,
    enabled,
  };
}

module.exports = {
  createMcpAuditLogger,
  MCP_AUDIT_LEGACY_SCHEMA_VERSION,
  MCP_AUDIT_SCHEMA_VERSION,
  normalizeMcpAuditEvent,
  readMcpAuditEvents,
  resolveMcpAuditPath,
};
