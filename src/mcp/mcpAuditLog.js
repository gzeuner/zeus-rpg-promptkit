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

function createMcpAuditLogger(runtime = {}, redactor = null) {
  const enabled = runtime.auditEnabled !== false;
  const cwd = runtime.cwd || process.cwd();
  const auditPath = runtime.auditPath
    ? path.resolve(String(runtime.auditPath))
    : path.resolve(cwd, '.local', 'mcp', 'audit', 'mcp-audit.jsonl');

  const sanitizePayload = redactor && typeof redactor.sanitizePayload === 'function'
    ? redactor.sanitizePayload
    : (value) => sanitizeValue(value);

  function appendToolCallEvent(event = {}) {
    if (!enabled) {
      return null;
    }

    const entry = sanitizePayload({
      timestamp: new Date().toISOString(),
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
};
