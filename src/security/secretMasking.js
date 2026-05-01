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
const REDACTED_VALUE = '[REDACTED]';
const SENSITIVE_KEY_PATTERN = /(^|[_-])(password|passwd|pwd|pass|secret|token|api[_-]?key|key|authorization|auth|credential|credentials)$/i;
const USER_KEY_PATTERN = /^(user|username)$/i;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function shouldMaskKey(key) {
  return SENSITIVE_KEY_PATTERN.test(String(key || '').trim());
}

function hasCredentialFields(value) {
  return Object.keys(value || {}).some((entry) => shouldMaskKey(entry));
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

function sanitizeValue(value, key = '') {
  if (value === undefined || value === null) {
    return value;
  }

  if (shouldMaskKey(key)) {
    return REDACTED_VALUE;
  }

  if (typeof value === 'string') {
    return maskSecretsInText(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }

  if (isPlainObject(value)) {
    const maskUserFields = hasCredentialFields(value);
    const sanitized = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      if (maskUserFields && USER_KEY_PATTERN.test(String(childKey || '').trim())) {
        sanitized[childKey] = REDACTED_VALUE;
        continue;
      }
      sanitized[childKey] = sanitizeValue(childValue, childKey);
    }
    return sanitized;
  }

  return value;
}

module.exports = {
  REDACTED_VALUE,
  maskSecretsInText,
  sanitizeValue,
  shouldMaskKey,
};

