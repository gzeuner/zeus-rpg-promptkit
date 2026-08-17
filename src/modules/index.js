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
const productSurface = require('./productSurface');

const builtInModules = Object.freeze({
  registerWithZeus: (...args) => require('./builtInModules').registerWithZeus(...args),
  resolveSelectedModules: (...args) => require('./builtInModules').resolveSelectedModules(...args),
});

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
  registerBuiltInModulesFromHost: commercialModuleLoader.registerBuiltInModules,
  createHostZeus: commercialModuleLoader.createHostZeus,
  LOADER_REASON_CODES: commercialModuleLoader.LOADER_REASON_CODES,
  // Unified built-in capability modules. Registration remains explicit and
  // entitlement-aware; Community-only hosts do not load them automatically.
  builtInModules,
  productSurface,
  registerBuiltInModules: builtInModules.registerWithZeus,
  resolveBuiltInModules: builtInModules.resolveSelectedModules,
};
