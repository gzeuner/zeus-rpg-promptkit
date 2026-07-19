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
};
