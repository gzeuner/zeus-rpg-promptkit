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

/**
 * Structured validation error for domain contracts.
 * Path is JSON-pointer style (e.g. '/root/program' or '/entities/0/name').
 * Message is stable, human readable, and must not contain secrets.
 */
class SchemaValidationError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = 'SchemaValidationError';
    this.errors = Array.isArray(errors) ? errors : [];
  }
}

/**
 * Normalize and bound a list of validation errors.
 * - Deduplicates by path+message (stable order)
 * - Limits total count to prevent huge outputs
 * - Strips any obviously sensitive values from messages
 */
function normalizeValidationErrors(errors, { maxErrors = 20 } = {}) {
  if (!Array.isArray(errors) || errors.length === 0) return [];

  const seen = new Set();
  const normalized = [];

  for (const e of errors) {
    if (!e || typeof e !== 'object') continue;

    const path = typeof e.path === 'string' ? e.path : '';
    let message = typeof e.message === 'string' ? e.message : 'invalid value';

    // Redact potential secrets aggressively (very conservative)
    message = message
      .replace(/([A-Za-z0-9+/=]{20,})/g, '[REDACTED]')
      .replace(/\b(password|secret|token|key)\b[^,]*/gi, '[REDACTED]');

    const key = `${path}|${message}`;
    if (seen.has(key)) continue;
    seen.add(key);

    normalized.push({ path, message });

    if (normalized.length >= maxErrors) break;
  }

  // Sort for determinism: by path then message
  normalized.sort((a, b) => {
    if (a.path === b.path) return a.message.localeCompare(b.message);
    return a.path.localeCompare(b.path);
  });

  return normalized;
}

module.exports = {
  SchemaValidationError,
  normalizeValidationErrors,
};
