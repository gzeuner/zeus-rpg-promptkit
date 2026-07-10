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

const {
  sanitizeValue,
  collectSensitiveTermsFromEnv,
} = require('../../security/secretMasking');

/**
 * createJsonOutput(args, opts)
 *
 * Centralized helper for consistent machine-readable JSON output across CLI commands.
 * - Supports common flags: --json, --format json, --output json
 * - Applies secret masking by default (using existing sanitizeValue)
 * - Produces deterministic pretty (2 spaces) or compact output
 * - Provides helpers for stdout and file writes
 * - Intended to be used in if (json.isJsonMode) { ... } paths
 *
 * Usage example in a command:
 *   const json = createJsonOutput(args);
 *   if (json.isJsonMode) {
 *     console.log(json.stringify(result));
 *     return;
 *   }
 *   // human readable path...
 *   if (args.out) json.writeFile(args.out, result);
 */
function createJsonOutput(args = {}, opts = {}) {
  const jsonFlag = !!(args && (args.json || args['json-output']));
  const formatRaw = args && (args.format || args.output);
  const format = formatRaw ? String(formatRaw).toLowerCase().trim() : '';

  const isJsonMode = jsonFlag || format === 'json' || opts.forceJson === true;

  const compact = format === 'compact' || opts.compact === true;
  const indent = compact ? 0 : 2;

  const shouldMask = opts.maskSecrets !== false; // default: true for safety

  function getSensitiveTerms() {
    if (!shouldMask) return [];
    return collectSensitiveTermsFromEnv(process.env, opts.additionalSensitiveTerms || []);
  }

  function sanitize(data) {
    if (data == null) return data;
    if (!shouldMask) return data;
    const sensitiveTerms = getSensitiveTerms();
    return sanitizeValue(data, { sensitiveTerms });
  }

  function stringify(data) {
    if (!isJsonMode) return null;
    const sanitized = sanitize(data);
    let str = JSON.stringify(sanitized, null, indent);
    if (indent > 0) str += '\n';
    return str;
  }

  /**
   * Print to stdout if in json mode.
   */
  function print(data) {
    const out = stringify(data);
    if (out != null) {
      process.stdout.write(out);
    }
  }

  /**
   * Write to file (always writes sanitized JSON, even if not isJsonMode, for artifact use).
   * Returns the resolved path or null.
   */
  function writeFile(filePath, data) {
    if (!filePath) return null;
    const sanitized = sanitize(data);
    const content = JSON.stringify(sanitized, null, indent) + (indent > 0 ? '\n' : '');
    const resolved = path.resolve(String(filePath));
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, 'utf8');
    return resolved;
  }

  return {
    isJsonMode,
    indent,
    compact,
    stringify,
    print,
    writeFile,
    // Back-compat alias used by some artifact writers
    writeJsonReport: writeFile,
  };
}

/**
 * Lightweight direct stringify helper for cases where full controller is overkill.
 * Still applies sanitization by default.
 */
function stringifyJson(data, { compact = false, maskSecrets = true, additionalSensitiveTerms = [] } = {}) {
  const indent = compact ? 0 : 2;
  let toSerialize = data;
  if (maskSecrets) {
    const terms = collectSensitiveTermsFromEnv(process.env, additionalSensitiveTerms);
    toSerialize = sanitizeValue(data, { sensitiveTerms: terms });
  }
  let str = JSON.stringify(toSerialize, null, indent);
  if (indent > 0) str += '\n';
  return str;
}

module.exports = {
  createJsonOutput,
  stringifyJson,
};
