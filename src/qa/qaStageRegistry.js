/**
 * QA Stage Registry
 *
 * Registers all QA validation stages.
 * All stages are OPTIONAL and disabled by default.
 * This ensures backward compatibility - existing workflows are unaffected.
 *
 * Usage:
 *   Enable in config: qaMode: true
 *   Or via CLI: --qa-mode enabled
 */

const QA_STAGE_REGISTRY = Object.freeze({
  'qa-test-precondition-validation': {
    name: 'qa-test-precondition-validation',
    title: 'Test Precondition Validator',
    description: 'Validates that test preconditions match code implementation',
    enabled: false, // ← DEFAULT OFF - Opt-in only
    stage: require('./qaValidators/testPreconditionValidator'),
    runsAfter: 'build-canonical-analysis',
    optional: true,
    severity: 'ERROR', // ← Inconsistencies are errors
  },

  'qa-regression-risk-analyzer': {
    name: 'qa-regression-risk-analyzer',
    title: 'Regression Risk Analyzer',
    description: 'Analyzes code changes for regression risk',
    enabled: false, // ← DEFAULT OFF
    stage: require('./qaValidators/regressionRiskAnalyzer'),
    runsAfter: 'build-canonical-analysis',
    optional: true,
    severity: 'WARNING',
  },

  'qa-sql-consistency-validator': {
    name: 'qa-sql-consistency-validator',
    title: 'SQL Consistency Validator',
    description: 'Validates SQL filters, joins, and WHERE clauses',
    enabled: false, // ← DEFAULT OFF
    stage: require('./qaValidators/sqlConsistencyValidator'),
    runsAfter: 'build-canonical-analysis',
    optional: true,
    severity: 'ERROR',
  },

  'qa-ibm-i-platform-checker': {
    name: 'qa-ibm-i-platform-checker',
    title: 'IBM i Platform Checker',
    description: 'Checks for IBM i platform best practices and gotchas',
    enabled: false, // ← DEFAULT OFF
    stage: require('./qaValidators/ibmiPlatformChecker'),
    runsAfter: 'build-canonical-analysis',
    optional: true,
    severity: 'WARNING',
  },
});

/**
 * Load QA stages based on configuration
 *
 * @param {Object} config - Configuration object
 * @param {Boolean} config.qaMode - Enable QA mode
 * @param {String} config.qaStrict - Strict mode: 'STRICT' fails on warnings, 'LENIENT' continues
 * @returns {Array} Array of QA stages to run
 */
function loadQAStages(config = {}) {
  if (!config.qaMode) {
    return []; // ← No QA stages if not enabled
  }

  return Object.values(QA_STAGE_REGISTRY)
    .filter(stageConfig => {
      // Enable if: explicitly enabled in config, or qaMode is true
      return stageConfig.enabled || config.qaMode === true;
    })
    .map(stageConfig => ({
      ...stageConfig,
      runner: new (require('./qaStageRunner'))(stageConfig),
    }));
}

/**
 * Get registry metadata (for debugging, CLI help, etc)
 *
 * @returns {Object} Registry metadata
 */
function getRegistryMetadata() {
  return {
    totalStages: Object.keys(QA_STAGE_REGISTRY).length,
    stages: Object.entries(QA_STAGE_REGISTRY).map(([key, config]) => ({
      key,
      name: config.name,
      title: config.title,
      description: config.description,
      enabled: config.enabled,
      severity: config.severity,
    })),
  };
}

module.exports = {
  QA_STAGE_REGISTRY,
  loadQAStages,
  getRegistryMetadata,
};
