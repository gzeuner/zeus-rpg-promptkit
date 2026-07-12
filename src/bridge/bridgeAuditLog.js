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
const fs = require('fs');
const path = require('path');
const { sanitizeValue } = require('../security/secretMasking');

function appendBridgeAuditEvent({ outputRoot, event }) {
  const auditDir = path.join(outputRoot, 'audit');
  fs.mkdirSync(auditDir, { recursive: true });
  const auditPath = path.join(auditDir, 'bridge-audit.jsonl');
  const entry = sanitizeValue({
    timestamp: new Date().toISOString(),
    ...event,
  });
  fs.appendFileSync(auditPath, `${JSON.stringify(entry)}\n`, 'utf8');
  return {
    auditPath,
    event: entry,
  };
}

module.exports = {
  appendBridgeAuditEvent,
};
