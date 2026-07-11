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

const { normalizeValidationErrors, SchemaValidationError } = require('./errors');

/**
 * Creates a schema registry for versioned domain contracts.
 *
 * Each contract is identified by a stable string id + major version number.
 * Validation is additive-friendly: extra properties are allowed by default
 * unless the schema validator explicitly rejects them.
 *
 * Public contract (preferred shape per package 02):
 *
 *   const registry = createSchemaRegistry();
 *   registry.register({ id: 'zeus.run-manifest', version: 1, schema });
 *   const result = registry.validate('zeus.run-manifest', 1, value);
 *   // { ok: true, value } | { ok: false, errors: [{path, message}, ...] }
 */
function createSchemaRegistry(options = {}) {
  const { allowRegistrationAfterUse = false } = options;
  const entries = new Map(); // `${id}@${version}` -> {id, version, validateFn}
  let used = false;

  function makeKey(id, version) {
    return `${id}@${version}`;
  }

  /**
   * Register a contract schema.
   * schema may be:
   *   - a function (value) => Error[]   (recommended for v1)
   *   - an object descriptor (reserved for future richer validation)
   */
  function register({ id, version, schema }) {
    if (used && !allowRegistrationAfterUse) {
      throw new Error('Schema registry is sealed: registration after first use is not allowed');
    }
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new Error('Contract id must be a non-empty string');
    }
    if (!Number.isInteger(version) || version < 1) {
      throw new Error('Contract version must be a positive integer');
    }
    if (schema == null) {
      throw new Error('schema is required');
    }

    const key = makeKey(id, version);
    if (entries.has(key)) {
      throw new Error(`Duplicate registration for contract "${id}" version ${version}`);
    }

    let validateFn;
    if (typeof schema === 'function') {
      validateFn = schema;
    } else if (schema && typeof schema === 'object') {
      // Minimal descriptor support for now: treat as "has schemaVersion" + passthrough
      validateFn = (value) => {
        const errs = [];
        if (value && typeof value === 'object' && 'schemaVersion' in value) {
          if (Number(value.schemaVersion) !== version) {
            errs.push({ path: '/schemaVersion', message: `expected ${version}, got ${value.schemaVersion}` });
          }
        }
        return errs;
      };
    } else {
      throw new Error('schema must be a validation function or descriptor object');
    }

    entries.set(key, { id, version, validateFn });
  }

  /**
   * Validate a value against a registered contract version.
   * Returns a stable result shape. Errors are always deterministic in order.
   */
  function validate(id, version, value) {
    used = true;
    const key = makeKey(id, version);
    const entry = entries.get(key);

    if (!entry) {
      return {
        ok: false,
        errors: normalizeValidationErrors([{
          path: '',
          message: `Unknown contract or unsupported version: ${id} v${version}`,
        }]),
      };
    }

    let rawErrors = [];
    try {
      const result = entry.validateFn(value);
      if (Array.isArray(result)) {
        rawErrors = result;
      } else if (result && Array.isArray(result.errors)) {
        rawErrors = result.errors;
      }
    } catch (e) {
      rawErrors = [{ path: '', message: `validation threw: ${String(e.message || e)}` }];
    }

    const errors = normalizeValidationErrors(rawErrors);

    if (errors.length === 0) {
      return { ok: true, value };
    }

    return { ok: false, errors };
  }

  function listContracts() {
    return Array.from(entries.values())
      .map(({ id, version }) => ({ id, version }))
      .sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version);
  }

  function hasContract(id, version) {
    return entries.has(makeKey(id, version));
  }

  return {
    register,
    validate,
    listContracts,
    hasContract,
    // For introspection in tests / api
    _internal: { size: () => entries.size },
  };
}

module.exports = {
  createSchemaRegistry,
  SchemaValidationError: require('./errors').SchemaValidationError,
};
