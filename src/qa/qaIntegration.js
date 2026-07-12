/**
 * QA Mode Integration
 *
 * This module integrates the QA system into the existing workflow.
 * Non-breaking: All QA features are optional.
 */

const { loadQAStages } = require('./qaStageRegistry');
const QAStageRunner = require('./qaStageRunner');
const qaReportGenerator = require('../report/qaReportGenerator');

/**
 * Run QA validation pipeline
 *
 * @param {Object} context - Analysis context
 * @param {Object} config - Configuration
 * @returns {Promise<Object>} QA results
 */
async function runQAPipeline(context, config = {}) {
  const qaConfig = config.qa || {};
  const startTime = Date.now();

  // Load QA stages based on config
  const qaStages = loadQAStages(qaConfig);

  if (qaStages.length === 0) {
    return {
      status: 'SKIPPED',
      message: 'QA mode not enabled',
      timestamp: new Date().toISOString(),
    };
  }

  console.log(`[QA] Starting QA pipeline with ${qaStages.length} validation stages...`);

  const qaResults = {};
  const failures = [];

  // Run each QA stage
  for (const stageConfig of qaStages) {
    console.log(`[QA] Running ${stageConfig.name}...`);

    const runner = new QAStageRunner(stageConfig);
    const result = await runner.run(context);

    qaResults[stageConfig.name] = result;

    // Track failures
    if (result.status === 'FAILED' || result.errors?.length > 0) {
      failures.push({
        stage: stageConfig.name,
        errors: result.errors,
      });
    }

    // Check if should fail hard
    if (
      result.status === 'COMPLETED' &&
      result.result &&
      (result.result.inconsistencies?.length > 0 || result.result.issues?.length > 0)
    ) {
      if (runner.shouldFailHard(qaConfig.qaStrict)) {
        failures.push({
          stage: stageConfig.name,
          reason: `QA validation failed with ${qaConfig.qaStrict} mode`,
        });
      }
    }
  }

  const duration = Date.now() - startTime;
  const status = failures.length > 0 ? 'FAILURE' : 'SUCCESS';

  console.log(`[QA] QA pipeline completed in ${duration}ms - Status: ${status}`);

  return {
    status,
    timestamp: new Date().toISOString(),
    duration,
    stagesRun: qaStages.length,
    results: qaResults,
    failures,
  };
}

/**
 * Generate QA report
 *
 * @param {Object} qaResults - QA results
 * @param {Object} config - Report configuration
 * @returns {Object} Generated report
 */
function generateQAReport(qaResults, config = {}) {
  if (qaResults.status === 'SKIPPED') {
    return {
      status: 'SKIPPED',
      message: 'No QA report generated (QA mode not enabled)',
    };
  }

  return qaReportGenerator.generateReport(qaResults.results, config);
}

module.exports = {
  runQAPipeline,
  generateQAReport,
  qaReportGenerator,
};
