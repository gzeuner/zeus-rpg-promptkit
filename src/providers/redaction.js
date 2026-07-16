/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
*/
'use strict';

const {
  CONTRACTS,
  contractRef,
  deepFreeze,
  validateConfigProvenance,
  validatePlainData,
} = require('./contracts');

/**
 * Build provenance from names only. Values, endpoints, paths, environment
 * contents, and raw configuration objects are deliberately not accepted.
 */
/**
 * @param {{sourceKind?: string, sourceReference?: string, configuredKeys?: string[]}} [options]
 */
function createConfigProvenance(options = {}) {
  if (
    validatePlainData(options).length ||
    !options ||
    typeof options !== 'object' ||
    !Array.isArray(options.configuredKeys || [])
  ) {
    const error = new Error('invalid redacted provider configuration provenance');
    error.code = 'PROVIDER_CONFIG_PROVENANCE_INVALID';
    throw error;
  }
  const { sourceKind, sourceReference, configuredKeys = [] } = options;
  const provenance = {
    schemaVersion: 1,
    contract: contractRef(CONTRACTS.CONFIG_PROVENANCE),
    sourceKind,
    sourceReference,
    configuredKeys: [...new Set(configuredKeys)].sort(),
    redaction: 'values-omitted',
  };
  if (validateConfigProvenance(provenance).length) {
    const error = new Error('invalid redacted provider configuration provenance');
    error.code = 'PROVIDER_CONFIG_PROVENANCE_INVALID';
    throw error;
  }
  return deepFreeze(provenance);
}

module.exports = { createConfigProvenance };
