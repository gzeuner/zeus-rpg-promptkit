'use strict';

/**
 * Project Intelligence Content Store (ZPI-04).
 *
 * Content-addressed local storage with trusted-root path controls.
 * Garbage collection is design-only (not executed).
 */

const constants = require('./constants');
const hash = require('./hash');
const normalize = require('./normalize');
const trustedRoots = require('./trustedRoots');
const gcDesign = require('./gcDesign');
const contentStore = require('./contentStore');

module.exports = {
  ...constants,
  sha256Hex: hash.sha256Hex,
  requireContentHash: hash.requireContentHash,
  contentObjectRelativePath: hash.contentObjectRelativePath,
  canonicalizeContent: normalize.canonicalizeContent,
  canonicalizeRelativePath: normalize.canonicalizeRelativePath,
  createTrustedRootRegistry: trustedRoots.createTrustedRootRegistry,
  realpathSafe: trustedRoots.realpathSafe,
  isInsideRoot: trustedRoots.isInsideRoot,
  describeContentGarbageCollection: gcDesign.describeContentGarbageCollection,
  runContentGarbageCollection: gcDesign.runContentGarbageCollection,
  createContentStore: contentStore.createContentStore,
  openContentStoreFromKnowledgeRoot: contentStore.openContentStoreFromKnowledgeRoot,
  ensureContentLayout: contentStore.ensureContentLayout,
  writeFileAtomic: contentStore.writeFileAtomic,
};
