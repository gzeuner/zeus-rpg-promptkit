/**
 * Regression Risk Analyzer
 *
 * Analyzes code changes between versions to estimate regression risk.
 * Compares old and new versions of the same program.
 *
 * Risk Levels:
 *   LOW: No changes to logic, only cosmetics
 *   MEDIUM: Changes to structure but logic preserved
 *   HIGH: Changes to filters, loops, or conditional logic
 */

class RegressionRiskAnalyzer {
  constructor() {
    this.name = 'RegressionRiskAnalyzer';
  }

  /**
   * Analyze regression risk
   *
   * @param {Object} canonicalAnalysis - Current analysis
   * @param {Array} sourceFiles - Current source files
   * @param {Object} context - Context with oldAnalysis if available
   * @returns {Promise<Object>} Risk analysis result
   */
  async analyze(canonicalAnalysis, sourceFiles, context = {}) {
    const riskFactors = [];

    if (!context.oldCanonicalAnalysis) {
      return {
        analyzerName: 'RegressionRiskAnalyzer',
        timestamp: new Date().toISOString(),
        status: 'NO_BASELINE',
        message: 'No baseline version provided for comparison',
        riskLevel: 'UNKNOWN',
        riskFactors: [],
      };
    }

    // Compare SQL statements
    const sqlRisks = this.analyzeSQLChanges(
      context.oldCanonicalAnalysis.entities.sqlStatements,
      canonicalAnalysis.entities.sqlStatements
    );
    riskFactors.push(...sqlRisks);

    // Compare filters
    const filterRisks = this.analyzeFilterChanges(context.oldCanonicalAnalysis, canonicalAnalysis);
    riskFactors.push(...filterRisks);

    // Compare relations (program calls, etc)
    const relationRisks = this.analyzeRelationChanges(
      context.oldCanonicalAnalysis.relations,
      canonicalAnalysis.relations
    );
    riskFactors.push(...relationRisks);

    const riskLevel = this.calculateRiskLevel(riskFactors);

    return {
      analyzerName: 'RegressionRiskAnalyzer',
      timestamp: new Date().toISOString(),
      status: 'COMPLETED',
      riskLevel,
      summary: {
        totalRiskFactors: riskFactors.length,
        criticalFactors: riskFactors.filter(f => f.severity === 'CRITICAL').length,
        affectedTests: this.suggestAffectedTests(riskFactors),
      },
      riskFactors,
    };
  }

  /**
   * Analyze SQL statement changes
   *
   * @param {Array} oldStatements - Old SQL statements
   * @param {Array} newStatements - New SQL statements
   * @returns {Array} Risk factors
   */
  analyzeSQLChanges(oldStatements = [], newStatements = []) {
    const risks = [];

    // Check for removed or modified WHERE clauses
    const oldWhere = this.extractWherePatterns(oldStatements);
    const newWhere = this.extractWherePatterns(newStatements);

    for (const [pattern, oldCount] of Object.entries(oldWhere)) {
      const newCount = newWhere[pattern] || 0;
      if (oldCount > newCount) {
        risks.push({
          type: 'SQL_FILTER_REMOVED',
          pattern,
          severity: 'CRITICAL',
          message: `WHERE clause filter changed: ${pattern}`,
          recommendation: 'Review affected test cases',
        });
      }
    }

    // Check for changed table joins
    const oldTables = this.extractTableJoins(oldStatements);
    const newTables = this.extractTableJoins(newStatements);

    for (const [table, oldJoins] of Object.entries(oldTables)) {
      const newJoins = newTables[table] || {};
      if (JSON.stringify(oldJoins) !== JSON.stringify(newJoins)) {
        risks.push({
          type: 'SQL_JOIN_CHANGED',
          table,
          severity: 'HIGH',
          message: `JOIN conditions changed for table: ${table}`,
          recommendation: 'Verify data retrieved matches expectations',
        });
      }
    }

    return risks;
  }

  /**
   * Analyze filter logic changes
   *
   * @param {Object} oldAnalysis - Old analysis
   * @param {Object} newAnalysis - New analysis
   * @returns {Array} Risk factors
   */
  analyzeFilterChanges(oldAnalysis, newAnalysis) {
    const risks = [];

    // Compare key filter patterns (ldmlan, SACHGINDEX, etc)
    const commonFilters = ['ldmlan', 'SACHGINDEX', 'VKST', 'faktur'];

    for (const filter of commonFilters) {
      const oldFilter = this.extractFilterByName(oldAnalysis, filter);
      const newFilter = this.extractFilterByName(newAnalysis, filter);

      if (oldFilter && newFilter && oldFilter !== newFilter) {
        risks.push({
          type: 'FILTER_CHANGED',
          filterName: filter,
          oldValue: oldFilter,
          newValue: newFilter,
          severity: 'HIGH',
          message: `Core filter logic changed: ${filter}`,
          recommendation: 'Review all tests using this filter',
        });
      }
    }

    return risks;
  }

  /**
   * Analyze relationship changes (calls, dependencies)
   *
   * @param {Array} oldRelations - Old relations
   * @param {Array} newRelations - New relations
   * @returns {Array} Risk factors
   */
  analyzeRelationChanges(oldRelations = [], newRelations = []) {
    const risks = [];

    const oldCallMap = new Map(
      oldRelations.filter(r => r.type === 'CALLS').map(r => [r.from + '->' + r.to, r])
    );
    const newCallMap = new Map(
      newRelations.filter(r => r.type === 'CALLS').map(r => [r.from + '->' + r.to, r])
    );

    // Check for removed calls
    for (const [key] of oldCallMap) {
      if (!newCallMap.has(key)) {
        risks.push({
          type: 'CALL_REMOVED',
          call: key,
          severity: 'MEDIUM',
          message: `Program call removed: ${key}`,
          recommendation: 'Verify no functional impact',
        });
      }
    }

    // Check for new calls
    for (const [key] of newCallMap) {
      if (!oldCallMap.has(key)) {
        risks.push({
          type: 'CALL_ADDED',
          call: key,
          severity: 'MEDIUM',
          message: `New program call added: ${key}`,
          recommendation: 'Verify new call is tested',
        });
      }
    }

    return risks;
  }

  /**
   * Calculate overall risk level
   *
   * @param {Array} riskFactors - All risk factors
   * @returns {String} Risk level: LOW, MEDIUM, HIGH
   */
  calculateRiskLevel(riskFactors) {
    const criticalCount = riskFactors.filter(f => f.severity === 'CRITICAL').length;
    const highCount = riskFactors.filter(f => f.severity === 'HIGH').length;

    if (criticalCount > 0) return 'HIGH';
    if (highCount > 2) return 'HIGH';
    if (highCount > 0) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Suggest which test cases might be affected
   *
   * @param {Array} riskFactors - Risk factors
   * @returns {Array} Suggested test cases
   */
  suggestAffectedTests(riskFactors) {
    const affected = new Set();

    for (const risk of riskFactors) {
      if (risk.type === 'FILTER_CHANGED') {
        affected.add(`Tests checking ${risk.filterName}`);
      }
      if (risk.type === 'SQL_FILTER_REMOVED') {
        affected.add('Regression tests');
      }
    }

    return Array.from(affected);
  }

  // Helper methods
  extractWherePatterns(statements) {
    const patterns = {};
    for (const stmt of statements) {
      if (stmt.whereClause) {
        patterns[stmt.whereClause] = (patterns[stmt.whereClause] || 0) + 1;
      }
    }
    return patterns;
  }

  extractTableJoins(statements) {
    const joins = {};
    for (const stmt of statements) {
      if (stmt.joins) {
        for (const join of stmt.joins) {
          joins[join.table] = join.condition;
        }
      }
    }
    return joins;
  }

  extractFilterByName(analysis, filterName) {
    if (analysis.entities && analysis.entities.sqlStatements) {
      for (const sql of analysis.entities.sqlStatements) {
        if (sql.whereClause && sql.whereClause.includes(filterName)) {
          return sql.whereClause;
        }
      }
    }
    return null;
  }
}

module.exports = new RegressionRiskAnalyzer();
