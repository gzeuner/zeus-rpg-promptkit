'use strict';

const constants = require('./constants');
const {
  normalizeModuleDescriptor,
  moduleDescriptorSchema,
  redactSecrets,
} = require('./descriptor');
const {
  createModuleRegistrar,
  createAtomicModuleRegistrar,
  fixedStatus,
} = require('./moduleRegistrar');
const { satisfies, parseVersion } = require('./semverRange');
const contractTestKit = require('./contractTestKit');
const commercialModuleLoader = require('./commercialModuleLoader');

module.exports = {
  ...constants,
  normalizeModuleDescriptor,
  moduleDescriptorSchema,
  redactSecrets,
  createModuleRegistrar,
  createAtomicModuleRegistrar,
  fixedStatus,
  satisfies,
  parseVersion,
  contractTestKit,
  // Explicit host/CLI commercial wiring (no paid handlers, no auto-discovery)
  commercialModuleLoader,
  registerCommercialModules: commercialModuleLoader.registerCommercialModules,
  createHostZeus: commercialModuleLoader.createHostZeus,
  LOADER_REASON_CODES: commercialModuleLoader.LOADER_REASON_CODES,
};
