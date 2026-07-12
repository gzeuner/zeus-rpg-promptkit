/**
 * SQL Consistency Validator
 *
 * Validates SQL statements for:
 * - Proper filter logic
 * - JOIN consistency
 * - WHERE clause correctness
 * - Host variable usage
 */

class SQLConsistencyValidator {
  constructor() {
    this.name = 'SQLConsistencyValidator';
  }

  /**
   * Validate SQL consistency
   *
   * @param {Object} canonicalAnalysis - Canonical analysis model
   * @param {Array} sourceFiles - Source files
   * @param {Object} context - Analysis context
   * @returns {Promise<Object>} Validation result
   */
  async validate(canonicalAnalysis, sourceFiles, context = {}) {
    const issues = [];

    if (!canonicalAnalysis.entities || !canonicalAnalysis.entities.sqlStatements) {
      return {
        validatorName: 'SQLConsistencyValidator',
        timestamp: new Date().toISOString(),
        status: 'NO_SQL_FOUND',
        issues: [],
      };
    }

    for (const sql of canonicalAnalysis.entities.sqlStatements) {
      const sqlIssues = this.validateStatement(sql);
      issues.push(...sqlIssues);
    }

    return {
      validatorName: 'SQLConsistencyValidator',
      timestamp: new Date().toISOString(),
      status: issues.length > 0 ? 'ISSUES_FOUND' : 'CONSISTENT',
      totalStatements: canonicalAnalysis.entities.sqlStatements.length,
      issuesFound: issues.length,
      issues,
    };
  }

  /**
   * Validate a single SQL statement
   *
   * @param {Object} sql - SQL statement
   * @returns {Array} Issues found
   */
  validateStatement(sql) {
    const issues = [];

    // Check for AND <> filters without null handling
    if (this.hasExclusionFilter(sql.whereClause) && !this.hasNullHandling(sql.whereClause)) {
      issues.push({
        type: 'MISSING_NULL_HANDLING',
        severity: 'WARNING',
        statement: sql.type,
        issue: 'Exclusion filter (<>) without NULL handling may have unintended results',
        whereClause: sql.whereClause,
        suggestion: 'Consider: field <> value AND field IS NOT NULL',
      });
    }

    // Check for multiple joins on same table
    if (this.hasMultipleJoinsOnSameTable(sql)) {
      issues.push({
        type: 'DUPLICATE_TABLE_JOIN',
        severity: 'WARNING',
        statement: sql.type,
        issue: 'Same table joined multiple times',
        suggestion: 'Verify this is intentional',
      });
    }

    // Check for missing WHERE clause on DELETE/UPDATE
    if ((sql.type === 'DELETE' || sql.type === 'UPDATE') && !sql.whereClause) {
      issues.push({
        type: 'MISSING_WHERE_CLAUSE',
        severity: 'CRITICAL',
        statement: sql.type,
        issue: 'DELETE or UPDATE without WHERE clause',
        suggestion: 'This will affect all records - verify intentional',
      });
    }

    // Check for host variables in dynamic SQL
    if (sql.hostVariables && sql.hostVariables.length > 0 && sql.type === 'PREPARE') {
      issues.push({
        type: 'DYNAMIC_SQL_DETECTED',
        severity: 'MEDIUM',
        statement: sql.type,
        issue: 'Dynamic SQL with host variables detected',
        hostVariables: sql.hostVariables,
        suggestion: 'Review for SQL injection potential',
      });
    }

    return issues;
  }

  /**
   * Check if WHERE clause has exclusion filter (<>)
   *
   * @param {String} whereClause - WHERE clause
   * @returns {Boolean}
   */
  hasExclusionFilter(whereClause) {
    return whereClause && whereClause.includes('<>');
  }

  /**
   * Check if WHERE clause has NULL handling
   *
   * @param {String} whereClause - WHERE clause
   * @returns {Boolean}
   */
  hasNullHandling(whereClause) {
    return whereClause && (whereClause.includes('IS NOT NULL') || whereClause.includes('IS NULL'));
  }

  /**
   * Check for duplicate table joins
   *
   * @param {Object} sql - SQL statement
   * @returns {Boolean}
   */
  hasMultipleJoinsOnSameTable(sql) {
    if (!sql.joins || sql.joins.length < 2) {
      return false;
    }

    const tables = new Set();
    for (const join of sql.joins) {
      if (tables.has(join.table)) {
        return true;
      }
      tables.add(join.table);
    }

    return false;
  }
}

module.exports = new SQLConsistencyValidator();
