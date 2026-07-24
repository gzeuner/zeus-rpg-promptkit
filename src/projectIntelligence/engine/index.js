'use strict';

/**
 * Snapshot and incremental update engine (ZPI-06).
 */

const inventory = require('./inventory');
const diffPlanner = require('./diffPlanner');
const invalidation = require('./invalidation');
const baselineAnalyzer = require('./baselineAnalyzer');
const snapshotEngine = require('./snapshotEngine');
const analyzers = require('../analyzers');

module.exports = {
  buildSourceInventory: inventory.buildSourceInventory,
  hashInventory: inventory.hashInventory,
  planInventoryDiff: diffPlanner.planInventoryDiff,
  planInvalidation: invalidation.planInvalidation,
  createBaselineAnalyzer: baselineAnalyzer.createBaselineAnalyzer,
  createRpgAnalyzer: analyzers.createRpgAnalyzer,
  ANALYZER_ID: analyzers.ANALYZER_ID,
  ANALYZER_VERSION: analyzers.ANALYZER_VERSION,
  BASELINE_ANALYZER_ID: baselineAnalyzer.ANALYZER_ID,
  createSnapshotEngine: snapshotEngine.createSnapshotEngine,
  openSnapshotEngine: snapshotEngine.openSnapshotEngine,
};
