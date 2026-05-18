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
const REDACTED_VALUE = '[REDACTED]';
const SENSITIVE_KEY_PATTERN = /(^|[_-])(password|passwd|pwd|pass|secret|token|api[_-]?key|key|authorization|auth|credential|credentials)$/i;
const USER_KEY_PATTERN = /^(user|username)$/i;
const SENSITIVE_ENV_KEYS = Object.freeze([
  'ZEUS_DB_HOST',
  'ZEUS_DB_USER',
  'ZEUS_DB_DEFAULT_LIBRARY',
  'ZEUS_DB_DEFAULT_SCHEMA',
  'ZEUS_METADATA_DB_HOST',
  'ZEUS_METADATA_DB_USER',
  'ZEUS_METADATA_DB_DEFAULT_LIBRARY',
  'ZEUS_METADATA_DB_DEFAULT_SCHEMA',
  'ZEUS_TESTDATA_DB_HOST',
  'ZEUS_TESTDATA_DB_USER',
  'ZEUS_TESTDATA_DB_DEFAULT_LIBRARY',
  'ZEUS_TESTDATA_DB_DEFAULT_SCHEMA',
  'ZEUS_FETCH_HOST',
  'ZEUS_FETCH_USER',
  'ZEUS_FETCH_SOURCE_LIB',
  'ZEUS_FETCH_SOURCE_LIBRARY',
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function shouldMaskKey(key) {
  return SENSITIVE_KEY_PATTERN.test(String(key || '').trim());
}

function hasCredentialFields(value) {
  return Object.keys(value || {}).some((entry) => shouldMaskKey(entry));
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSensitiveTerms(input = []) {
  const terms = Array.isArray(input) ? input : [input];
  return Array.from(new Set(terms
    .map((entry) => String(entry || '').trim())
    .filter((entry) => entry.length > 1)
    .map((entry) => entry.toUpperCase())))
    .sort((left, right) => right.length - left.length || left.localeCompare(right));
}

function parseSensitiveTermsCsv(value) {
  if (value === undefined || value === null || value === false) {
    return [];
  }
  const raw = Array.isArray(value) ? value.join(',') : String(value);
  return raw
    .split(/[,\n;]+/g)
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function collectSensitiveTermsFromEnv(env = process.env, additionalTerms = []) {
  const terms = [];

  for (const key of SENSITIVE_ENV_KEYS) {
    if (env && env[key]) {
      terms.push(env[key]);
    }
  }

  if (env && env.ZEUS_SENSITIVE_TERMS) {
    terms.push(...parseSensitiveTermsCsv(env.ZEUS_SENSITIVE_TERMS));
  }
  if (env && env.ZEUS_MASK_TERMS) {
    terms.push(...parseSensitiveTermsCsv(env.ZEUS_MASK_TERMS));
  }
  terms.push(...parseSensitiveTermsCsv(additionalTerms));
  return normalizeSensitiveTerms(terms);
}

function maskSensitiveTermsInText(value, sensitiveTerms = []) {
  let text = String(value === undefined || value === null ? '' : value);
  const normalizedTerms = normalizeSensitiveTerms(sensitiveTerms);

  for (const term of normalizedTerms) {
    const escaped = escapeRegExp(term);
    text = text.replace(
      new RegExp(`(^|[^A-Z0-9_#$@])(${escaped})(?=[^A-Z0-9_#$@]|$)`, 'gi'),
      `$1${REDACTED_VALUE}`,
    );
  }

  return text;
}

function maskSecretsInText(value) {
  let text = String(value === undefined || value === null ? '' : value);

  text = text
    .replace(/(\bjdbc:[a-z0-9]+:\/\/)([^:\s/;,@]+):([^@\s/;]+)@/gi, `$1${REDACTED_VALUE}:${REDACTED_VALUE}@`)
    .replace(/(\bjdbc:[^\s?;]+[?;][^\r\n]*?\buser\s*=\s*)([^;&\s]+)/gi, `$1${REDACTED_VALUE}`)
    .replace(/(\bjdbc:[^\s?;]+[?;][^\r\n]*?\b(password|passwd|pwd|pass)\s*=\s*)([^;&\s]+)/gi, `$1${REDACTED_VALUE}`)
    .replace(/(\bjdbc:[^\r\n]*?\b(user|username)\s*=\s*)([^;\s]+)/gi, `$1${REDACTED_VALUE}`)
    .replace(/(\bjdbc:[^\r\n]*?\b(password|passwd|pwd|pass)\s*=\s*)([^;\s]+)/gi, `$1${REDACTED_VALUE}`)
    .replace(/\b(password|passwd|pwd)\s*=\s*([^;\s]+)/gi, `$1=${REDACTED_VALUE}`)
    .replace(/\b(pass)\s*=\s*([^;\s]+)/gi, `$1=${REDACTED_VALUE}`)
    .replace(/\b(credential|credentials)\s*[:=]\s*([^\s,;]+)/gi, `$1=${REDACTED_VALUE}`)
    .replace(/\b(password|passwd|pwd)\s*:\s*([^\s,]+)/gi, `$1: ${REDACTED_VALUE}`)
    .replace(/\b(pass)\s*:\s*([^\s,]+)/gi, `$1: ${REDACTED_VALUE}`)
    .replace(/\b(token|secret|api[_-]?key|authorization|auth|key)\s*[:=]\s*([^\s,;]+)/gi, `$1=${REDACTED_VALUE}`)
    .replace(/\b(authorization)\s+bearer\s+[a-z0-9._~+/-]+=*/gi, `$1 Bearer ${REDACTED_VALUE}`);

  if (/\b(password|passwd|pwd|pass|token|secret|api[_-]?key|authorization|auth|key|credential|credentials)\b/i.test(text)) {
    text = text.replace(/\b(user|username)\s*[:=]\s*([^\s,;]+)/gi, `$1=${REDACTED_VALUE}`);
  }

  return text;
}

function sanitizeValue(value, keyOrOptions = '', maybeOptions = {}) {
  const key = typeof keyOrOptions === 'string' ? keyOrOptions : '';
  const options = typeof keyOrOptions === 'object' && keyOrOptions !== null && !Array.isArray(keyOrOptions)
    ? keyOrOptions
    : maybeOptions;
  const sensitiveTerms = normalizeSensitiveTerms((options && options.sensitiveTerms) || []);

  if (value === undefined || value === null) {
    return value;
  }

  if (shouldMaskKey(key)) {
    return REDACTED_VALUE;
  }

  if (typeof value === 'string') {
    return maskSensitiveTermsInText(maskSecretsInText(value), sensitiveTerms);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, options));
  }

  if (isPlainObject(value)) {
    const maskUserFields = hasCredentialFields(value);
    const sanitized = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      if (maskUserFields && USER_KEY_PATTERN.test(String(childKey || '').trim())) {
        sanitized[childKey] = REDACTED_VALUE;
        continue;
      }
      sanitized[childKey] = sanitizeValue(childValue, childKey, options);
    }
    return sanitized;
  }

  return value;
}

module.exports = {
  REDACTED_VALUE,
  collectSensitiveTermsFromEnv,
  maskSensitiveTermsInText,
  maskSecretsInText,
  normalizeSensitiveTerms,
  parseSensitiveTermsCsv,
  sanitizeValue,
  shouldMaskKey,
};
