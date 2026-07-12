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

const {
  collectSensitiveTermsFromEnv,
  maskSecretsInText,
  maskSensitiveTermsInText,
  sanitizeValue,
} = require('../security/secretMasking');

function createMcpRedactor(runtime = {}) {
  const env = runtime.env || process.env;
  const sensitiveTerms = collectSensitiveTermsFromEnv(env, runtime.sensitiveTerms || []);

  return {
    sanitizeText(value) {
      return maskSensitiveTermsInText(maskSecretsInText(String(value || '')), sensitiveTerms);
    },
    sanitizePayload(payload) {
      return sanitizeValue(payload, { sensitiveTerms });
    },
    sanitizeError(error) {
      const safeError = error && typeof error === 'object' ? error : {};
      return {
        code: Number.isFinite(safeError.code) ? safeError.code : -32000,
        message: maskSensitiveTermsInText(
          maskSecretsInText(String(safeError.message || 'Internal error')),
          sensitiveTerms
        ),
        ...(safeError.data !== undefined
          ? { data: sanitizeValue(safeError.data, { sensitiveTerms }) }
          : {}),
      };
    },
  };
}

module.exports = {
  createMcpRedactor,
};
