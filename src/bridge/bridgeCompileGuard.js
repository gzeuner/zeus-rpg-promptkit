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
const { KNOWN_COMPILE_TEMPLATE_IDS } = require('./bridgeDefaults');

function normalizeTemplateId(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function validateCompileTemplateRequest({ templateId, commandText = '', bridgeConfig }) {
  const normalizedTemplate = normalizeTemplateId(templateId);
  if (!normalizedTemplate) {
    throw new Error('Missing required option: --template <id>');
  }
  if (String(commandText || '').trim()) {
    throw new Error(
      'Arbitrary compile command text is not allowed. Use --template with validated parameters.'
    );
  }
  if (!KNOWN_COMPILE_TEMPLATE_IDS.includes(normalizedTemplate)) {
    throw new Error(`Unknown compile template: ${templateId}`);
  }
  if (!bridgeConfig || !bridgeConfig.compile || bridgeConfig.compile.enabled !== true) {
    throw new Error(
      'Compile bridge is disabled. Set profile.bridge.compile.enabled=true to proceed.'
    );
  }

  const allowlist = Array.isArray(bridgeConfig.compile.allowedTemplates)
    ? bridgeConfig.compile.allowedTemplates.map(entry => normalizeTemplateId(entry))
    : [];
  if (allowlist.length > 0 && !allowlist.includes(normalizedTemplate)) {
    throw new Error(
      `Compile template is not allowlisted in profile.bridge.compile.allowedTemplates: ${normalizedTemplate}`
    );
  }

  return normalizedTemplate;
}

module.exports = {
  normalizeTemplateId,
  validateCompileTemplateRequest,
};
