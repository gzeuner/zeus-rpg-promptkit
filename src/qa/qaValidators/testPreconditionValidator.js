/**
 * Test Precondition Validator
 * 
 * Detects inconsistencies between test preconditions and code behavior.
 * 
 * Example:
 *   Precondition: "ldmlan = 6000"
 *   Code Filter: "WHERE ldmlan <> 6000"
 *   Result: ERROR - Inconsistency detected
 */

class TestPreconditionValidator {
  constructor() {
    this.name = 'TestPreconditionValidator';
  }

  /**
   * Validate test preconditions
   * 
   * @param {Object} canonicalAnalysis - Canonical analysis model
   * @param {Array} sourceFiles - Source files analyzed
   * @param {Object} context - Analysis context (may include test data)
   * @returns {Promise<Object>} Validation result
   */
  async validate(canonicalAnalysis, sourceFiles, context = {}) {
    const inconsistencies = [];
    const warnings = [];

    // Extract SQL filters from all SQL statements
    const sqlFilters = this.extractSQLFilters(canonicalAnalysis);

    // If test data available in context, validate against it
    if (context.testCaseData && Array.isArray(context.testCaseData)) {
      for (const testCase of context.testCaseData) {
        const result = this.validateTestCase(testCase, sqlFilters);
        
        if (result.isInconsistent) {
          inconsistencies.push(result);
        }
        if (result.warnings.length > 0) {
          warnings.push(...result.warnings);
        }
      }
    }

    return {
      validatorName: 'TestPreconditionValidator',
      timestamp: new Date().toISOString(),
      summary: {
        inconsistenciesFound: inconsistencies.length,
        warningsFound: warnings.length,
        status: inconsistencies.length > 0 ? 'INCONSISTENCY_FOUND' : 'CONSISTENT',
      },
      inconsistencies,
      warnings,
      sqlFilters,  // ← For debugging
    };
  }

  /**
   * Extract SQL filters from canonical analysis
   * 
   * @param {Object} canonicalAnalysis - Canonical model
   * @returns {Array} Array of SQL filters found
   */
  extractSQLFilters(canonicalAnalysis) {
    const filters = [];

    if (!canonicalAnalysis.entities || !canonicalAnalysis.entities.sqlStatements) {
      return filters;
    }

    for (const sql of canonicalAnalysis.entities.sqlStatements) {
      // Extract WHERE clause filters
      if (sql.whereClause) {
        filters.push({
          statement: sql.type,
          intent: sql.intent,
          whereClause: sql.whereClause,
          tables: sql.tables || [],
          evidence: sql.evidence,
        });
      }
    }

    return filters;
  }

  /**
   * Validate a single test case against SQL filters
   * 
   * @param {Object} testCase - Test case data
   * @param {Array} sqlFilters - SQL filters from code
   * @returns {Object} Validation result for this test case
   */
  validateTestCase(testCase, sqlFilters) {
    const result = {
      testCase: testCase.id || testCase.name,
      precondition: testCase.precondition || {},
      isInconsistent: false,
      inconsistencyDetails: [],
      warnings: [],
    };

    // Common pattern: ldmlan filters
    if (testCase.precondition.ldmlan !== undefined) {
      const codeExpects = this.extractFilterExpectation(sqlFilters, 'ldmlan');
      
      if (codeExpects && !this.filterMatches(testCase.precondition.ldmlan, codeExpects)) {
        result.isInconsistent = true;
        result.inconsistencyDetails.push({
          field: 'ldmlan',
          preconditionValue: testCase.precondition.ldmlan,
          codeFilterExpectation: codeExpects,
          severity: 'ERROR',
          suggestion: `Update precondition to match code filter: ldmlan ${codeExpects}`,
        });
      }
    }

    return result;
  }

  /**
   * Extract filter expectation from SQL filters
   * 
   * @param {Array} sqlFilters - SQL filters
   * @param {String} fieldName - Field to search for
   * @returns {String|null} Filter expression or null
   */
  extractFilterExpectation(sqlFilters, fieldName) {
    for (const filter of sqlFilters) {
      const regex = new RegExp(`${fieldName}\\s*([<>!=]+)\\s*([\\w\\d']+)`, 'i');
      const match = filter.whereClause.match(regex);
      
      if (match) {
        return `${match[1].trim()} ${match[2].trim()}`;
      }
    }
    return null;
  }

  /**
   * Check if precondition value matches code filter
   * 
   * @param {*} preconditionValue - Value from precondition
   * @param {String} codeFilterExpectation - Filter from code
   * @returns {Boolean} True if matches
   */
  filterMatches(preconditionValue, codeFilterExpectation) {
    // Simple pattern matching
    if (codeFilterExpectation.includes('<>')) {
      return preconditionValue !== this.extractNumber(codeFilterExpectation);
    }
    if (codeFilterExpectation.includes('=')) {
      return preconditionValue === this.extractNumber(codeFilterExpectation);
    }
    if (codeFilterExpectation.includes('<')) {
      return preconditionValue < this.extractNumber(codeFilterExpectation);
    }
    if (codeFilterExpectation.includes('>')) {
      return preconditionValue > this.extractNumber(codeFilterExpectation);
    }
    return false;
  }

  /**
   * Extract number from filter expression
   * 
   * @param {String} expression - Filter expression
   * @returns {Number|String} Extracted value
   */
  extractNumber(expression) {
    const match = expression.match(/(\d+|'[^']*')/);
    if (match) {
      const value = match[1];
      return value.startsWith("'") ? value.slice(1, -1) : Number(value);
    }
    return expression;
  }
}

module.exports = new TestPreconditionValidator();
