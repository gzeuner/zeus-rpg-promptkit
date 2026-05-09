/**
 * QA Stage Runner
 * 
 * Executes QA validation stages with error isolation.
 * QA stage failures do NOT stop the main analysis pipeline.
 * Behavior controlled by qaStrict mode.
 */

class QAStageRunner {
  constructor(stageConfig) {
    this.config = stageConfig;
    this.name = stageConfig.name;
    this.severity = stageConfig.severity || 'WARNING';
    this.optional = stageConfig.optional !== false;
  }

  /**
   * Run a QA validation stage
   * 
   * @param {Object} context - Analysis context
   * @returns {Promise<Object>} Stage result
   */
  async run(context) {
    const startTime = Date.now();
    
    try {
      // Call the stage validator
      const validationResult = await this.config.stage.validate(
        context.canonicalAnalysis,
        context.sourceFiles,
        context
      );

      return {
        stageName: this.name,
        status: 'COMPLETED',
        result: validationResult,
        severity: this.severity,
        duration: Date.now() - startTime,
        errors: [],
      };
    } catch (error) {
      // ← Error isolation: QA failures don't crash main pipeline
      return {
        stageName: this.name,
        status: 'FAILED',
        result: null,
        severity: this.severity,
        duration: Date.now() - startTime,
        errors: [
          {
            message: error.message,
            stack: error.stack,
            code: error.code || 'UNKNOWN_ERROR',
          }
        ],
      };
    }
  }

  /**
   * Determine if failure should be fatal based on strictness level
   * 
   * @param {String} qaStrict - Strictness level: 'STRICT' | 'LENIENT'
   * @returns {Boolean} True if should fail hard
   */
  shouldFailHard(qaStrict) {
    if (qaStrict === 'STRICT') {
      return true;  // ← Strict: Any error fails
    }
    if (qaStrict === 'LENIENT') {
      return false;  // ← Lenient: Only log, never fail
    }
    // Default: Errors fail, warnings don't
    return this.severity === 'ERROR';
  }
}

module.exports = QAStageRunner;
