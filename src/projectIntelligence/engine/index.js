'use strict';

/**
 * Snapshot and incremental update engine (ZPI-06).
 */

const inventory = require('./inventory');
const diffPlanner = require('./diffPlanner');
const invalidation = require('./invalidation');
const baselineAnalyzer = require('./baselineAnalyzer');
const snapshotEngine = require('./snapshotEngine');

module.exports = {
  buildSourceInventory: inventory.buildSourceInventory,
  hashInventory: inventory.hashInventory,
  planInventoryDiff: diffPlanner.planInventoryDiff,
  planInvalidation: invalidation.planInvalidation,
  createBaselineAnalyzer: baselineAnalyzer.createBaselineAnalyzer,
  ANALYZER_ID: baselineAnalyzer.ANALYZER_ID,
  ANALYZER_VERSION: baselineAnalyzer.ANALYZER_VERSION,
  createSnapshotEngine: snapshotEngine.createSnapshotEngine,
  openSnapshotEngine: snapshotEngine.openSnapshotEngine,
};
